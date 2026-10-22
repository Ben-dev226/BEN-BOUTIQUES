import { db } from './db';

/**
 * Journal central : une ligne JSON dans les logs Vercel (toujours) + une ligne en base pour tout ce qui compte
 * (warn / error / security, et quelques info métier). N'échoue jamais : un souci de log ne doit pas casser une requête.
 * Alerte externe facultative : ALERT_WEBHOOK_URL (Slack, Discord, ntfy…) pour error et security, avec anti-spam.
 */
export type Level = 'info' | 'warn' | 'error' | 'security';
export type EventInput = { type: string; message?: string; tenantId?: number | null; detail?: unknown; ip?: string };

const lastAlert = new Map<string, number>();
const RETENTION_DAYS = Number(process.env.EVENT_RETENTION_DAYS || 90);
let lastPurge = 0;

function scrub(v: unknown): string {
  let s = typeof v === 'string' ? v : v instanceof Error ? `${v.message}\n${(v.stack || '').split('\n').slice(1, 6).join('\n')}` : v === undefined ? '' : JSON.stringify(v);
  s = s.replace(/(authorization|cookie|password|secret|token|signature)["':= ]+[^\s,"'}]+/gi, '$1=[masqué]');
  return s.slice(0, 2000);
}

export const telegramConfigured = () => !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_CHAT_ID;
export const alertsConfigured = () => !!process.env.ALERT_WEBHOOK_URL || telegramConfigured();

/** Envoie un texte sur tous les canaux configurés (Telegram et/ou webhook Slack/Discord/ntfy). Ne lève jamais d'erreur. */
export async function sendAlert(text: string): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  if (process.env.ALERT_WEBHOOK_URL) jobs.push(fetch(process.env.ALERT_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(5000) }));
  if (telegramConfigured()) {
    const base = (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, '');
    jobs.push(fetch(`${base}/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: text.slice(0, 3500), disable_web_page_preview: true }), signal: AbortSignal.timeout(5000) }));
  }
  await Promise.allSettled(jobs);
}

export async function logEvent(level: Level, e: EventInput): Promise<void> {
  try {
    const row = { level, type: e.type, tenant: e.tenantId ?? null, message: (e.message ?? '').slice(0, 300), detail: scrub(e.detail), ip: (e.ip ?? '').slice(0, 45) };
    console[level === 'info' ? 'log' : level === 'warn' ? 'warn' : 'error'](JSON.stringify({ t: new Date().toISOString(), ...row }));
    await (await db()).query('INSERT INTO platform_events (level, type, tenant_id, message, detail, ip) VALUES ($1,$2,$3,$4,$5,$6)', [row.level, row.type, row.tenant, row.message, row.detail, row.ip]);
    if (Date.now() - lastPurge > 6 * 3600_000) { lastPurge = Date.now(); await (await db()).query(`DELETE FROM platform_events WHERE created_at < (now() AT TIME ZONE 'utc') - ($1 || ' days')::interval`, [String(RETENTION_DAYS)]); }
    if ((level === 'error' || level === 'security') && alertsConfigured()) {
      const k = level + ':' + e.type, now = Date.now();
      if (now - (lastAlert.get(k) ?? 0) > 10 * 60_000) {
        lastAlert.set(k, now);
        const text = `[${level.toUpperCase()}] ${e.type}${row.tenant ? ` (boutique #${row.tenant})` : ''} — ${row.message}`;
        await sendAlert(text);
      }
    }
  } catch { /* jamais bloquant */ }
}
export const logInfo = (e: EventInput) => logEvent('info', e);
export const logWarn = (e: EventInput) => logEvent('warn', e);
export const logError = (e: EventInput) => logEvent('error', e);
export const logSecurity = (e: EventInput) => logEvent('security', e);
