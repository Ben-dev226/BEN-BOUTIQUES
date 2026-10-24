import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { gzipSync, gunzipSync } from 'zlib';
import { db, rows, one, exec } from './db';
import { logError, logInfo, sendAlert } from './log';

/**
 * Sauvegarde complète de la base (toutes les boutiques) : NDJSON → gzip → chiffrement AES-256-GCM
 * → envoi vers Telegram (canal) et Google Drive. Restauration : scripts/restore.ts.
 *
 * Le fichier ne contient JAMAIS de données en clair vers l'extérieur : sans BACKUP_PASSPHRASE,
 * l'envoi Telegram / Drive est refusé (sauf BACKUP_ALLOW_UNENCRYPTED=1).
 */
const MAGIC = Buffer.from('FQB1');
const SKIP = new Set(['rate_limits', 'schema_migrations']);           // jamais sauvegardés
const OPTIONAL_SKIP = ['platform_events'];                              // volumineux et sans valeur : BACKUP_INCLUDE_EVENTS=1 pour les inclure
const PAGE = 2000;
const TG_PART = 45 * 1024 * 1024;                                       // limite Bot API : 50 Mo

export const passphrase = () => process.env.BACKUP_PASSPHRASE || '';
export const telegramBackupChat = () => process.env.BACKUP_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '';
export const telegramBackupOn = () => !!process.env.TELEGRAM_BOT_TOKEN && !!telegramBackupChat() && process.env.BACKUP_TELEGRAM !== '0';
export const driveOn = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
export const remoteOn = () => telegramBackupOn() || driveOn();
const KEEP = () => Math.max(1, Number(process.env.BACKUP_KEEP || 30));

// ── Chiffrement ────────────────────────────────────────────
export function encrypt(data: Buffer, pass: string): Buffer {
  const salt = randomBytes(16), iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', scryptSync(pass, salt, 32), iv);
  const body = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, body, c.getAuthTag()]);
}
export function decrypt(buf: Buffer, pass: string): Buffer {
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error('Fichier non chiffré ou format inconnu');
  const salt = buf.subarray(4, 20), iv = buf.subarray(20, 32), tag = buf.subarray(buf.length - 16), body = buf.subarray(32, buf.length - 16);
  const d = createDecipheriv('aes-256-gcm', scryptSync(pass, salt, 32), iv); d.setAuthTag(tag);
  try { return Buffer.concat([d.update(body), d.final()]); } catch { throw new Error('Mot de passe de sauvegarde incorrect ou fichier corrompu'); }
}

// ── Dump ───────────────────────────────────────────────────
const q = (id: string) => '"' + id.replace(/"/g, '""') + '"';

/** Tables à sauvegarder, triées pour que les parents précèdent les enfants (clés étrangères). */
export async function tableOrder(t?: { query: Function }): Promise<string[]> {
  const run = (sql: string) => (t ?? { query: async (s: string) => (await db()).query(s) }).query(sql) as Promise<{ rows: any[] }>;
  const tables: string[] = (await run(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`)).rows.map(r => r.table_name);
  const fks = (await run(`SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`)).rows;
  const clean = (n: string) => n.replace(/^public\./, '').replace(/^"|"$/g, '');
  const deps = new Map<string, Set<string>>(tables.map(n => [n, new Set<string>()]));
  for (const f of fks) { const c = clean(f.child), p = clean(f.parent); if (c !== p && deps.has(c) && deps.has(p)) deps.get(c)!.add(p); }
  const out: string[] = [], left = new Set(tables);
  while (left.size) {
    const ready = [...left].filter(n => [...deps.get(n)!].every(p => !left.has(p))).sort();
    if (!ready.length) { out.push(...[...left].sort()); break; }
    for (const n of ready) { out.push(n); left.delete(n); }
  }
  return out;
}

export type Dump = { data: Buffer; rows: number; tables: Record<string, number>; schema: number };

/** Instantané cohérent (transaction REPEATABLE READ), lu par pages pour limiter la mémoire. */
export async function buildDump(): Promise<Dump> {
  const d = await db();
  const skip = new Set([...SKIP, ...(process.env.BACKUP_INCLUDE_EVENTS === '1' ? [] : OPTIONAL_SKIP)]);
  const lines: string[] = [], counts: Record<string, number> = {}; let total = 0;
  const chunks: Buffer[] = [];
  const flush = () => { if (lines.length) { chunks.push(gzipSync(Buffer.from(lines.join('\n') + '\n'))); lines.length = 0; } };
  const schema = Number((await one('SELECT COALESCE(MAX(version),0)::int AS v FROM schema_migrations'))?.v ?? 0);
  await d.tx(async t => {
    await t.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const order = (await tableOrder(t)).filter(n => !skip.has(n));
    lines.push(JSON.stringify({ fq_backup: 1, created: new Date().toISOString(), schema, tables: order }));
    for (const name of order) {
      counts[name] = 0;
      for (let off = 0; ; off += PAGE) {
        const r = await t.query(`SELECT to_jsonb(x) AS j FROM ${q(name)} x ORDER BY x.ctid LIMIT ${PAGE} OFFSET ${off}`);
        if (!r.rows.length) break;
        lines.push(JSON.stringify({ t: name, rows: r.rows.map(x => x.j) }));
        counts[name] += r.rows.length; total += r.rows.length;
        if (lines.length > 20) flush();
        if (r.rows.length < PAGE) break;
      }
    }
    lines.push(JSON.stringify({ end: true, rows: total }));
  });
  flush();
  // concaténation de membres gzip = un flux gzip valide
  return { data: Buffer.concat(chunks), rows: total, tables: counts, schema };
}

/** Fichier prêt à envoyer (chiffré si une phrase secrète est définie). */
export async function buildBackupFile() {
  const dump = await buildDump(), pass = passphrase();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const encrypted = !!pass;
  return { ...dump, encrypted, name: `fq-backup-${stamp}.ndjson.gz${encrypted ? '.enc' : ''}`, file: encrypted ? encrypt(dump.data, pass) : dump.data };
}

/** Relit un fichier de sauvegarde (utilisé par la restauration et les tests). */
export function readBackup(buf: Buffer, pass?: string): { header: any; batches: { t: string; rows: any[] }[]; end: any } {
  const raw = buf.subarray(0, 4).equals(MAGIC) ? decrypt(buf, pass || passphrase()) : buf;
  const lines = gunzipSync(raw).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const header = lines.shift(); if (!header?.fq_backup) throw new Error('Ce fichier n’est pas une sauvegarde FIFI');
  const end = lines.pop(); if (!end?.end) throw new Error('Sauvegarde incomplète (fin de fichier absente)');
  return { header, batches: lines, end };
}

// ── Destinations ───────────────────────────────────────────
const tgBase = () => (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, '');

export async function sendToTelegram(name: string, file: Buffer, note: string): Promise<string> {
  const parts = Math.max(1, Math.ceil(file.length / TG_PART));
  for (let i = 0; i < parts; i++) {
    const slice = file.subarray(i * TG_PART, (i + 1) * TG_PART);
    const fd = new FormData();
    fd.append('chat_id', telegramBackupChat());
    fd.append('caption', (parts > 1 ? `Partie ${i + 1}/${parts} — ` : '') + note);
    fd.append('disable_notification', 'true');
    fd.append('document', new Blob([new Uint8Array(slice)]), parts > 1 ? `${name}.part${String(i + 1).padStart(3, '0')}` : name);
    const res = await fetch(`${tgBase()}/bot${process.env.TELEGRAM_BOT_TOKEN}/sendDocument`, { method: 'POST', body: fd, signal: AbortSignal.timeout(120_000) });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(`Telegram : ${j.description || res.status}`.slice(0, 200));
  }
  return parts > 1 ? `${parts} parties` : 'ok';
}

const gBase = () => (process.env.GOOGLE_API_BASE || 'https://www.googleapis.com').replace(/\/$/, '');
async function googleToken(): Promise<string> {
  const res = await fetch(process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: process.env.GOOGLE_REFRESH_TOKEN!, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(15_000) });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`Google : ${j.error_description || j.error || res.status} (jeton à renouveler ?)`.slice(0, 200));
  return j.access_token;
}
async function gjson(tok: string, path: string, init: RequestInit = {}) {
  const res = await fetch(gBase() + path, { ...init, headers: { Authorization: `Bearer ${tok}`, ...(init.headers || {}) }, signal: AbortSignal.timeout(120_000) });
  if (res.status === 204) return {};
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Drive : ${j.error?.message || res.status}`.slice(0, 200));
  return j;
}
async function driveFolder(tok: string): Promise<string> {
  if (process.env.GOOGLE_DRIVE_FOLDER_ID) return process.env.GOOGLE_DRIVE_FOLDER_ID;
  const saved = await one('SELECT v FROM platform_state WHERE k = $1', ['drive_folder_id']);
  if (saved?.v) return saved.v;
  const f = await gjson(tok, '/drive/v3/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Sauvegardes ${process.env.PLATFORM_NAME || 'FIFI'}`, mimeType: 'application/vnd.google-apps.folder' }) });
  await exec('INSERT INTO platform_state (k, v) VALUES ($1,$2) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v', ['drive_folder_id', f.id]);
  return f.id;
}
export async function sendToDrive(name: string, file: Buffer): Promise<string> {
  const tok = await googleToken(), folder = await driveFolder(tok);
  const start = await fetch(`${gBase()}/upload/drive/v3/files?uploadType=resumable&fields=id`, { method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(file.length) },
    body: JSON.stringify({ name, parents: [folder] }), signal: AbortSignal.timeout(30_000) });
  const loc = start.headers.get('location'); if (!start.ok || !loc) throw new Error(`Drive : démarrage de l’envoi refusé (${start.status}) — dossier introuvable ou droits insuffisants`);
  const up = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(file.length) }, body: new Uint8Array(file), signal: AbortSignal.timeout(240_000) });
  if (!up.ok) throw new Error(`Drive : envoi échoué (${up.status})`);
  // rétention : on garde les N plus récentes
  let removed = 0;
  try {
    const list = await gjson(tok, `/drive/v3/files?q=${encodeURIComponent(`'${folder}' in parents and trashed = false and name contains 'fq-backup-'`)}&orderBy=createdTime%20desc&pageSize=200&fields=files(id)`);
    for (const f of (list.files || []).slice(KEEP())) { await gjson(tok, `/drive/v3/files/${f.id}`, { method: 'DELETE' }); removed++; }
  } catch { /* la rétention ne doit pas faire échouer la sauvegarde */ }
  return removed ? `ok (${removed} ancienne(s) supprimée(s))` : 'ok';
}

// ── Orchestration ──────────────────────────────────────────
export type Dest = { name: 'telegram' | 'drive' | 'ref'; ok: boolean; info: string };
export type BackupResult = { ok: boolean; remote_ok: boolean; file_name: string; bytes: number; rows: number; encrypted: boolean; destinations: Dest[]; error: string; duration_ms: number };
const fmtMB = (n: number) => (n / 1048576).toFixed(n < 1048576 ? 2 : 1) + ' Mo';
let running = false;

export async function runBackup(trigger: 'cron' | 'manual' | 'before_cleanup' = 'manual'): Promise<BackupResult> {
  if (running) throw new Error('Une sauvegarde est déjà en cours');
  running = true; const t0 = Date.now();
  const res: BackupResult = { ok: false, remote_ok: false, file_name: '', bytes: 0, rows: 0, encrypted: false, destinations: [], error: '', duration_ms: 0 };
  try {
    const b = await buildBackupFile();
    Object.assign(res, { file_name: b.name, bytes: b.file.length, rows: b.rows, encrypted: b.encrypted });
    const note = `${process.env.PLATFORM_NAME || 'FIFI'} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ${b.rows} lignes · ${fmtMB(b.file.length)}${b.encrypted ? ' · chiffré' : ''}`;
    const targets: [Dest['name'], () => Promise<string>][] = [];
    const refuse = !b.encrypted && process.env.BACKUP_ALLOW_UNENCRYPTED !== '1';
    if (telegramBackupOn()) targets.push(['telegram', refuse ? async () => { throw new Error('refusé : définissez BACKUP_PASSPHRASE (données non chiffrées)'); } : () => sendToTelegram(b.name, b.file, note)]);
    if (driveOn()) targets.push(['drive', refuse ? async () => { throw new Error('refusé : définissez BACKUP_PASSPHRASE (données non chiffrées)'); } : () => sendToDrive(b.name, b.file)]);
    for (const [name, fn] of targets) { try { res.destinations.push({ name, ok: true, info: await fn() }); } catch (e: any) { res.destinations.push({ name, ok: false, info: String(e.message || e).slice(0, 200) }); } }
    res.remote_ok = res.destinations.some(d => d.ok);
    res.ok = targets.length ? res.remote_ok : true;                  // sans destination : la sauvegarde est valide mais n'est conservée nulle part
    if (!targets.length) res.error = 'Aucune destination configurée (Telegram / Google Drive)';
    else if (!res.ok) res.error = res.destinations.map(d => `${d.name} : ${d.info}`).join(' · ');
  } catch (e: any) { res.error = String(e.message || e).slice(0, 300); }
  res.duration_ms = Date.now() - t0; running = false;
  try {
    await exec('INSERT INTO backups (trigger, file_name, bytes, row_count, encrypted, ok, remote_ok, destinations, error, duration_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [trigger, res.file_name, res.bytes, res.rows, res.encrypted, res.ok, res.remote_ok, JSON.stringify(res.destinations), res.error, res.duration_ms]);
    await exec(`DELETE FROM backups WHERE created_at < (now() AT TIME ZONE 'utc') - interval '180 days'`);
  } catch { /* table absente : ignoré */ }
  if (res.ok && res.remote_ok) await logInfo({ type: 'backup_ok', message: `Sauvegarde ${res.file_name} (${fmtMB(res.bytes)}) envoyée`, detail: res.destinations });
  else { await logError({ type: 'backup_failed', message: `Sauvegarde non conservée : ${res.error}`, detail: res.destinations }); await sendAlert(`SAUVEGARDE ÉCHOUÉE (${trigger}) — ${res.error}`); }
  return res;
}

export async function backupStatus() {
  const list = await rows('SELECT id, created_at, trigger, file_name, bytes::float8 AS bytes, row_count, encrypted, ok, remote_ok, destinations, error, duration_ms FROM backups ORDER BY id DESC LIMIT 20');
  const last = list[0] ?? null;
  const ageH = await lastRemoteBackupAgeHours();
  return {
    config: { telegram: telegramBackupOn(), drive: driveOn(), encrypted: !!passphrase(), keep: KEEP(), drive_folder: !!process.env.GOOGLE_DRIVE_FOLDER_ID ? 'fixé' : 'auto' },
    last, last_ok_age_hours: ageH, backups: list.map(b => ({ ...b, destinations: safeJson(b.destinations) })),
  };
}
const safeJson = (s: string) => { try { return JSON.parse(s); } catch { return []; } };

/** Dernière sauvegarde réussie et conservée à distance, en heures (null = aucune). */
export async function lastRemoteBackupAgeHours(): Promise<number | null> {
  const r = await one("SELECT EXTRACT(EPOCH FROM ((now() AT TIME ZONE 'utc') - created_at))::float8 / 3600 AS h FROM backups WHERE ok AND remote_ok ORDER BY id DESC LIMIT 1");
  return r ? Number(r.h) : null;
}
