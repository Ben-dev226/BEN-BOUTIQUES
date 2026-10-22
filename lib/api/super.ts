import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { rows, one, val, exec } from '../db';
import { ApiError, fail, cookieFrom, passwordProblem, rateLimit, secretKey, pwFingerprint, dummyHash, BCRYPT_COST, clientIp } from './ctx';
import { newSecret, verifyTotp, otpauthUri } from '../totp';
import QRCode from 'qrcode';
import { createTenant, shopsEverCreated, LIFETIME_MAX_SHOPS } from '../tenants';
import { forgetTenants } from '../tenant';
import { deleteObjects } from '../storage';
import { report } from '../analytics';
import { platformInsights } from '../insights';
import { recentPayments } from '../billing';
import { vercelEnabled, addDomain, removeDomain, domainStatus, verifyDomain } from '../vercel';
import { logEvent, logInfo, logSecurity, logWarn, sendAlert, telegramConfigured } from '../log';
import { billingEnabled } from '../billing';
import { db } from '../db';
import { randHex } from '../util';
import { backupStatus, runBackup, remoteOn, passphrase, driveOn, telegramBackupOn, lastRemoteBackupAgeHours } from '../backup';
import { dbUsage, runMaintenance } from '../maintenance';

const COOKIE = 'fq_super', TTL = 60 * 60 * 8;
const key = () => secretKey(':super');          // jamais de clé par défaut en production (rawSecret lève une erreur)
const fp = (u: { password_hash: string; totp_secret: string | null; totp_enabled: boolean }) => pwFingerprint(u.password_hash + '|' + (u.totp_enabled ? u.totp_secret : ''));
const sign = (u: any, csrf: string) => new SignJWT({ sid: u.id, csrf, pf: fp(u) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(`${TTL}s`).sign(key());

export type SReq = { req: Request; url: URL; method: string; ip: string; https: boolean; body: any; sid: number | null; headers: Headers };
const cookie = (v: string, secure: boolean, age = TTL) => `${COOKIE}=${v}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;

async function session(r: SReq) {
  const tok = cookieFrom(r.req.headers.get('cookie'), COOKIE); if (!tok) return null;
  try {
    const { payload } = await jwtVerify(tok, key(), { algorithms: ['HS256'] });
    const u = await one<any>('SELECT id, email, password_hash, totp_secret, totp_enabled FROM super_admins WHERE id = $1', [Number(payload.sid)]);
    return u && payload.pf === fp(u) ? { id: u.id, email: u.email, csrf: String(payload.csrf), totp: !!u.totp_enabled } : null;
  } catch { return null; }
}

const SELECT = `SELECT t.id, t.slug, t.name, t.status, t.plan, t.max_products, t.max_users, t.paid_until::text AS paid_until, t.custom_domain, t.created_at,
  (SELECT COUNT(*)::int FROM products p WHERE p.tenant_id = t.id) AS products, (SELECT COUNT(*)::int FROM orders o WHERE o.tenant_id = t.id) AS orders,
  (SELECT COALESCE(SUM(total),0)::int FROM orders o WHERE o.tenant_id = t.id AND o.status <> 'cancelled') AS revenue,
  (SELECT MAX(created_at) FROM orders o WHERE o.tenant_id = t.id) AS last_order, (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id) AS users FROM tenants t`;
const today = () => new Date().toISOString().slice(0, 10);
const view = (t: any) => ({ ...t, expired: !!t.paid_until && t.paid_until < today() });
const intIn = (v: any, min: number, max: number, name: string) => { const n = parseInt(v, 10); if (!(n >= min && n <= max)) fail(`${name} invalide (${min}–${max})`); return n; };

export async function superHandle(r: SReq, route: string): Promise<{ data?: unknown; status?: number; setCookie?: string }> {
  if (route === 'login') {
    if (r.method !== 'POST') fail('Méthode non autorisée', 405);
    const email = String(r.body.email ?? '').trim().toLowerCase(), pw = String(r.body.password ?? '').slice(0, 200), code = String(r.body.code ?? '').trim();
    const kI = `super_ip:${r.ip}`, kU = `super_u:${email}:${r.ip}`, kG = `super_g:${email}`;
    // par IP (8), par compte depuis cette IP (5), plafond global par compte (30) : on ne peut pas verrouiller le propriétaire depuis l'extérieur
    if (!await rateLimit(kI, 8, 900, false) || !await rateLimit(kU, 5, 900, false) || !await rateLimit(kG, 30, 900, false)) { await logSecurity({ type: 'super_login_locked', ip: r.ip, message: `Connexion super-admin bloquée pour « ${email.slice(0, 60)} »` }); fail('Trop de tentatives. Réessayez dans 15 minutes.', 429); }
    const bad = async (type: string, msg: string, shown: string): Promise<never> => { await logSecurity({ type, ip: r.ip, message: msg }); await rateLimit(kI, 8, 900); await rateLimit(kU, 5, 900); await rateLimit(kG, 30, 900); return fail(shown, 401); };
    const u = await one('SELECT * FROM super_admins WHERE lower(email) = $1', [email]);
    if (!(await bcrypt.compare(pw, u?.password_hash ?? dummyHash())) || !u) await bad('super_login_failed', `Échec de connexion super-admin : « ${email.slice(0, 60)} »`, 'Identifiants incorrects');
    if (u!.totp_enabled) {
      if (!code) return { data: { need_code: true } };                      // mot de passe correct : on demande le code à 6 chiffres
      const step = verifyTotp(u!.totp_secret, code, Number(u!.totp_last));
      // `totp_last < step` : un code ne peut servir qu'une fois (anti-rejeu), même en cas de requêtes simultanées
      if (step === null || !await exec('UPDATE super_admins SET totp_last = $1 WHERE id = $2 AND totp_last < $1', [step, u!.id])) await bad('super_2fa_failed', `Code 2FA incorrect pour ${u!.email}`, 'Code incorrect ou déjà utilisé');
    }
    const csrf = randHex(24);
    await logInfo({ type: 'super_login', ip: r.ip, message: `Connexion super-admin : ${u!.email}${u!.totp_enabled ? ' (2FA)' : ''}` });
    return { data: { email: u!.email, csrf }, setCookie: cookie(await sign(u, csrf), r.https) };
  }
  if (route === 'logout') return { data: { ok: true }, setCookie: cookie('', r.https, 0) };
  const me = await session(r);
  if (route === 'me') return { data: me ? { email: me.email, csrf: me.csrf, totp: me.totp, max_shops: LIFETIME_MAX_SHOPS, created: await shopsEverCreated(), root_domain: process.env.ROOT_DOMAIN || '' } : { email: null } };
  if (!me) fail('Authentification requise', 401);
  if (r.method !== 'GET' && r.headers.get('x-csrf-token') !== me!.csrf) fail('Jeton de sécurité invalide, rechargez la page', 403);

  if (route === 'tenants' && r.method === 'GET') return { data: { tenants: (await rows(SELECT + ' ORDER BY t.id')).map(view), created: await shopsEverCreated(), max_shops: LIFETIME_MAX_SHOPS } };
  if (route === 'domain/status' && r.method === 'GET') {
    const dom = (await one<{ custom_domain: string | null }>('SELECT custom_domain FROM tenants WHERE id = $1', [parseInt(r.url.searchParams.get('id') || '0', 10)]))?.custom_domain;
    if (!dom) return { data: { domain: null } };
    if (!vercelEnabled()) return { data: { domain: dom, automated: false } };
    return { data: { ...(await domainStatus(dom)), automated: true } };
  }
  if (route === 'domain/verify' && r.method === 'POST') {
    const dom = (await one<{ custom_domain: string | null }>('SELECT custom_domain FROM tenants WHERE id = $1', [parseInt(r.url.searchParams.get('id') || '0', 10)]))?.custom_domain;
    if (!dom || !vercelEnabled()) fail('Aucun domaine à vérifier');
    await verifyDomain(dom!); return { data: { ...(await domainStatus(dom!)), automated: true } };
  }
  if (route === 'monitor' && r.method === 'GET') {
    const lv = r.url.searchParams.get('level') || '', ty = r.url.searchParams.get('type') || '', tn = parseInt(r.url.searchParams.get('tenant') || '0', 10);
    const w: string[] = [], v: unknown[] = []; const add = (c: string, x: unknown) => { v.push(x); w.push(c.replace('?', '$' + v.length)); };
    if (['info', 'warn', 'error', 'security'].includes(lv)) add('e.level = ?', lv); if (ty) add('e.type = ?', ty); if (tn) add('e.tenant_id = ?', tn);
    const events = await rows(`SELECT e.id, e.level, e.type, e.message, e.detail, e.ip, e.created_at, e.tenant_id, t.slug FROM platform_events e LEFT JOIN tenants t ON t.id = e.tenant_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY e.id DESC LIMIT 150`, v);
    const c24 = await rows("SELECT level, COUNT(*)::int AS n FROM platform_events WHERE created_at > (now() AT TIME ZONE 'utc') - interval '24 hours' GROUP BY level");
    const failed = await rows("SELECT ip, COUNT(*)::int AS n FROM platform_events WHERE type IN ('login_failed','super_login_failed','login_locked','super_login_locked') AND created_at > (now() AT TIME ZONE 'utc') - interval '24 hours' AND ip <> '' GROUP BY ip ORDER BY n DESC LIMIT 5");
    const types = await rows('SELECT DISTINCT type FROM platform_events ORDER BY type');
    return { data: { health: await healthReport(), counts24h: Object.fromEntries(c24.map(x => [x.level, x.n])), failed_ips: failed, types: types.map(x => x.type), events } };
  }
  if (route === 'analytics' && r.method === 'GET') {
    const days = Math.max(7, Math.min(365, Number(r.url.searchParams.get('days')) || 30));
    const plat = await report(0, days);
    const shops = await rows(`SELECT t.slug, t.name, COALESCE(SUM(CASE WHEN s.metric='pv' THEN s.n END),0)::int AS pv, COALESCE(SUM(CASE WHEN s.metric='uv' THEN s.n END),0)::int AS uv
      FROM tenants t LEFT JOIN stats_daily s ON s.tenant_id = t.id AND s.day >= $1::date GROUP BY t.id ORDER BY uv DESC, t.id`, [plat.from]);
    return { data: { days, landing: plat, shops, insights: await platformInsights(days) } };
  }
  if (route === 'alert/test' && r.method === 'POST') {
    await sendAlert(`✅ Test d'alerte envoyé depuis le panneau super-admin (${me!.email}).`); await logInfo({ type: 'alert_test', ip: r.ip, message: 'Test des alertes déclenché', detail: { by: me!.email } });
    return { data: { ok: true } };
  }
  if (route === '2fa/setup' && r.method === 'POST') {
    const cur = await one('SELECT totp_enabled FROM super_admins WHERE id = $1', [me!.id]); if (cur?.totp_enabled) fail('La double authentification est déjà active. Désactivez-la d’abord pour la reconfigurer.');
    const secret = newSecret(); await exec('UPDATE super_admins SET totp_secret = $1, totp_last = 0 WHERE id = $2', [secret, me!.id]);
    const uri = otpauthUri(secret, me!.email, process.env.PLATFORM_NAME || 'Boutiques');
    return { data: { secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) } };
  }
  if (route === '2fa/enable' && r.method === 'POST') {
    const u = await one('SELECT * FROM super_admins WHERE id = $1', [me!.id]); if (!u?.totp_secret || u.totp_enabled) fail('Lancez d’abord la configuration');
    const step = verifyTotp(u.totp_secret, String(r.body.code ?? ''), 0); if (step === null) fail('Code incorrect : vérifiez l’heure de votre téléphone et réessayez', 400);
    await exec('UPDATE super_admins SET totp_enabled = TRUE, totp_last = $1 WHERE id = $2', [step, me!.id]);
    await logSecurity({ type: 'super_2fa_enabled', ip: r.ip, message: `Double authentification activée (${me!.email})` });
    return { data: { ok: true }, setCookie: cookie(await sign({ ...u, totp_enabled: true }, me!.csrf), r.https) };
  }
  if (route === '2fa/disable' && r.method === 'POST') {
    if (!await rateLimit(`super_2fa_off:${me!.id}`, 5, 900)) fail('Trop de tentatives', 429);
    const u = await one('SELECT * FROM super_admins WHERE id = $1', [me!.id]); if (!u?.totp_enabled) fail('La double authentification n’est pas active');
    const step = verifyTotp(u.totp_secret, String(r.body.code ?? ''), Number(u.totp_last));
    if (!(await bcrypt.compare(String(r.body.password ?? '').slice(0, 200), u.password_hash)) || step === null) fail('Mot de passe ou code incorrect', 403);
    await exec('UPDATE super_admins SET totp_enabled = FALSE, totp_secret = NULL, totp_last = 0 WHERE id = $1', [me!.id]);
    await logSecurity({ type: 'super_2fa_disabled', ip: r.ip, message: `Double authentification DÉSACTIVÉE (${me!.email})` });
    return { data: { ok: true }, setCookie: cookie(await sign({ ...u, totp_enabled: false, totp_secret: null }, me!.csrf), r.https) };
  }
  if (route === 'backup/status' && r.method === 'GET') return { data: { ...(await backupStatus()), usage: await dbUsage() } };
  if (route === 'backup/run' && r.method === 'POST') {
    const b = await runBackup('manual').catch(e => fail(e.message)); await logInfo({ type: 'backup_manual', ip: r.ip, message: `Sauvegarde manuelle par ${me!.email}`, detail: { ok: b.ok } });
    return { data: b };
  }
  if (route === 'maintenance/run' && r.method === 'POST') {
    const dry = r.body.dry_run !== false, force = !!r.body.force && !dry;
    if (!dry) await logWarn({ type: 'maintenance_manual', ip: r.ip, message: `Nettoyage lancé par ${me!.email}${force ? ' (forcé)' : ''}` });
    return { data: await runMaintenance({ dryRun: dry, force, trigger: 'manual' }) };
  }
  if (route === 'payments' && r.method === 'GET') return { data: { payments: await recentPayments(parseInt(r.url.searchParams.get('id') || '0', 10), 20) } };
  if (route === 'tenant' && r.method === 'POST') {
    const b = r.body;
    const t = await createTenant({ slug: String(b.slug ?? ''), name: String(b.name ?? ''), adminUser: String(b.admin_user || 'admin'), adminPassword: String(b.admin_password ?? ''), whatsapp: String(b.whatsapp ?? ''),
      plan: String(b.plan || 'free'), maxProducts: b.max_products ? intIn(b.max_products, 1, 100000, 'Limite produits') : undefined, maxUsers: b.max_users ? intIn(b.max_users, 1, 100, 'Limite utilisateurs') : undefined,
      paidUntil: /^\d{4}-\d{2}-\d{2}$/.test(b.paid_until) ? b.paid_until : null }).catch(e => fail(e.message));
    await logInfo({ type: 'super_tenant_created', tenantId: t.id, ip: r.ip, message: `Boutique créée : ${t.slug}`, detail: { by: me!.email } });
    return { data: t, status: 201 };
  }
  const id = parseInt(r.url.searchParams.get('id') || '0', 10);
  if (route === 'tenant' && r.method === 'PUT') {
    const b = r.body, sets: string[] = [], v: unknown[] = []; const add = (c: string, x: unknown) => { v.push(x); sets.push(`${c} = $${v.length}`); };
    if ('name' in b) { const n = String(b.name).trim().slice(0, 80); if (!n) fail('Nom obligatoire'); add('name', n); }
    if ('status' in b) { if (!['active', 'suspended'].includes(b.status)) fail('Statut invalide'); add('status', b.status); }
    if ('plan' in b) add('plan', String(b.plan).trim().slice(0, 30) || 'free');
    if ('max_products' in b) add('max_products', intIn(b.max_products, 1, 100000, 'Limite produits'));
    if ('max_users' in b) add('max_users', intIn(b.max_users, 1, 100, 'Limite utilisateurs'));
    if ('paid_until' in b) { if (b.paid_until && !/^\d{4}-\d{2}-\d{2}$/.test(b.paid_until)) fail('Date invalide'); add('paid_until', b.paid_until || null); }
    if ('custom_domain' in b) {
      const d = String(b.custom_domain || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
      if (d && !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(d)) fail('Domaine invalide');
      if (d && await one('SELECT 1 FROM tenants WHERE custom_domain = $1 AND id <> $2', [d, id])) fail('Ce domaine est déjà utilisé');
      const prev = (await one<{ custom_domain: string | null }>('SELECT custom_domain FROM tenants WHERE id = $1', [id]))?.custom_domain ?? null;
      if (d !== (prev ?? '')) {
        if (vercelEnabled()) { if (d) await addDomain(d).catch(e => fail(e.message)); if (prev) await removeDomain(prev); }
        add('custom_domain', d || null);
      }
    }
    if (!sets.length) fail('Rien à modifier');
    v.push(id); if (!await exec(`UPDATE tenants SET ${sets.join(', ')} WHERE id = $${v.length}`, v)) fail('Boutique introuvable', 404);
    forgetTenants(); await logInfo({ type: 'super_tenant_updated', tenantId: id, ip: r.ip, message: `Boutique #${id} modifiée (${Object.keys(b).join(', ')})`, detail: { by: me!.email } });
    return { data: view((await one(SELECT + ' WHERE t.id = $1', [id]))!) };
  }
  if (route === 'tenant/password' && r.method === 'POST') {
    const u = String(r.body.username || 'admin'), pw = String(r.body.password ?? ''), pb = passwordProblem(pw, u); if (pb) fail(pb);
    if (!await exec('UPDATE users SET password_hash = $1, must_change_password = TRUE WHERE tenant_id = $2 AND lower(username) = lower($3)', [await bcrypt.hash(pw, BCRYPT_COST), id, u])) fail('Utilisateur introuvable', 404);
    await logWarn({ type: 'super_password_reset', tenantId: id, ip: r.ip, message: `Mot de passe « ${u} » réinitialisé (boutique #${id})`, detail: { by: me!.email } });
    return { data: { ok: true } };
  }
  if (route === 'tenant' && r.method === 'DELETE') {
    const t = await one('SELECT slug FROM tenants WHERE id = $1', [id]); if (!t) fail('Boutique introuvable', 404);
    if (r.url.searchParams.get('confirm') !== t.slug) fail('Confirmation incorrecte : saisissez le slug de la boutique.');
    const dom = (await one<{ custom_domain: string | null }>('SELECT custom_domain FROM tenants WHERE id = $1', [id]))?.custom_domain;
    if (dom && vercelEnabled()) await removeDomain(dom);
    const files = await rows('SELECT path, thumb FROM product_images WHERE tenant_id = $1', [id]);
    await exec('DELETE FROM tenants WHERE id = $1', [id]); forgetTenants();
    await deleteObjects(files.flatMap(f => [f.path, f.thumb]));
    await logWarn({ type: 'super_tenant_deleted', ip: r.ip, message: `Boutique supprimée : ${t.slug}`, detail: { by: me!.email } });
    return { data: { ok: true, note: 'Le plafond à vie continue de compter cette boutique.' } };
  }
  if (route === 'password' && r.method === 'POST') {
    const pb = passwordProblem(String(r.body.new ?? ''), me!.email, 12); if (pb) fail(pb);
    const row = await one('SELECT password_hash FROM super_admins WHERE id = $1', [me!.id]);
    if (!(await bcrypt.compare(String(r.body.current ?? ''), row!.password_hash))) fail('Mot de passe actuel incorrect', 403);
    const nh = await bcrypt.hash(String(r.body.new), BCRYPT_COST);
    await exec('UPDATE super_admins SET password_hash = $1 WHERE id = $2', [nh, me!.id]);
    await logSecurity({ type: 'super_password_changed', ip: r.ip, message: `Mot de passe super-admin modifié (${me!.email})` });
    const u2 = await one('SELECT * FROM super_admins WHERE id = $1', [me!.id]);
    return { data: { ok: true }, setCookie: cookie(await sign(u2, me!.csrf), r.https) };   // les autres sessions sont invalidées
  }
  fail('Route inconnue', 404);
  return {};
}
export { ApiError, val };

/** Contrôles de santé (aussi utilisés par /api/health). Aucun secret n'est renvoyé, seulement des états. */
export async function healthReport() {
  const t0 = Date.now(); let dbOk = false, version = 0, dbMs = 0;
  try { const r = await (await db()).query('SELECT COALESCE(MAX(version),0)::int AS v FROM schema_migrations'); dbOk = true; version = r.rows[0].v; } catch { /* base injoignable */ }
  dbMs = Date.now() - t0;
  const driver = process.env.STORAGE_DRIVER || (process.env.SUPABASE_URL ? 'supabase' : 'local');
  const prod = process.env.NODE_ENV === 'production';
  const checks = [
    { name: 'Base de données', ok: dbOk, info: dbOk ? `${dbMs} ms · schéma v${version}` : 'injoignable' },
    { name: 'Stockage images', ok: driver !== 'supabase' || !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY), info: driver },
    { name: 'AUTH_SECRET', ok: !prod || (process.env.AUTH_SECRET || '').length >= 32, info: (process.env.AUTH_SECRET || '').length >= 32 ? 'défini' : 'absent ou trop court' },
    { name: 'Paiement Chariow', ok: !process.env.CHARIOW_API_KEY || (billingEnabled() && !!process.env.CHARIOW_PULSE_SECRET), info: billingEnabled() ? (process.env.CHARIOW_PULSE_SECRET ? 'configuré' : 'secret du Pulse manquant') : 'non configuré' },
    { name: 'Domaines (Vercel)', ok: true, info: process.env.VERCEL_API_TOKEN && process.env.VERCEL_PROJECT_ID ? 'configuré' : 'manuel' },
    { name: 'Alertes (Telegram / webhook)', ok: true, info: [telegramConfigured() && 'Telegram', process.env.ALERT_WEBHOOK_URL && 'webhook'].filter(Boolean).join(' + ') || 'non configurées (recommandé)' },
    ...(await backupChecks()),
    { name: 'Mode debug Chariow', ok: process.env.CHARIOW_DEBUG !== '1', info: process.env.CHARIOW_DEBUG === '1' ? 'ACTIF : à retirer après les tests' : 'désactivé' },
  ];
  return { ok: checks.every(c => c.ok), checks };
}
export { logEvent };

async function backupChecks() {
  const out: { name: string; ok: boolean; info: string }[] = [];
  try {
    const u = await dbUsage();
    out.push({ name: 'Espace base de données', ok: u.pct < 90, info: `${Math.round(u.bytes / 104857.6) / 10} / ${Math.round(u.quota / 1048576)} Mo (${u.pct} %)` });
    const dests = [telegramBackupOn() && 'Telegram', driveOn() && 'Google Drive'].filter(Boolean).join(' + ');
    if (!dests) out.push({ name: 'Sauvegardes', ok: true, info: 'non configurées (fortement recommandé)' });
    else {
      const h = await lastRemoteBackupAgeHours();
      out.push({ name: 'Sauvegardes', ok: h !== null && h < 36 && !!passphrase(), info: !passphrase() ? 'BACKUP_PASSPHRASE manquant' : h === null ? `${dests} : aucune sauvegarde réussie` : `${dests} · dernière il y a ${h < 1 ? Math.round(h * 60) + ' min' : Math.round(h) + ' h'}` });
    }
  } catch { /* table absente pendant une migration */ }
  return out;
}
