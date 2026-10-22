import { SignJWT, jwtVerify } from 'jose';
import { createHash, createHmac } from 'node:crypto';
import bcryptjs from 'bcryptjs';
import { one, exec, rows, val } from '../db';
import type { Tenant } from '../tenant';
import { loadSettings, type Settings } from '../settings';

export class ApiError extends Error { constructor(msg: string, public status = 400, public extra: Record<string, unknown> = {}) { super(msg); } }
export const fail = (msg: string, status = 400, extra: Record<string, unknown> = {}): never => { throw new ApiError(msg, status, extra); };

export type SessionUser = { id: number; username: string; name: string; role: 'admin' | 'manager'; must_change_password: boolean };
const COOKIE = 'fq_session', TTL = 60 * 60 * 8;
/** Clé de signature. En production : AUTH_SECRET obligatoire (32 caractères minimum), jamais de valeur par défaut. */
export const rawSecret = (): string => {
  const s = process.env.AUTH_SECRET || '';
  if (process.env.NODE_ENV === 'production' && s.length < 32) throw new Error('AUTH_SECRET manquant ou trop court (32 caractères minimum)');
  return s || 'dev-secret-ne-pas-utiliser-en-production';
};
export const BCRYPT_COST = 12;
/** Hash factice (même coût) comparé quand l'identifiant n'existe pas : temps de réponse identique. */
let _dummy = ''; export const dummyHash = () => (_dummy ||= bcryptjs.hashSync('dummy-password-xyz', BCRYPT_COST));
export const secretKey = (suffix = '') => new TextEncoder().encode(rawSecret() + suffix);
const secret = () => secretKey();
/** Empreinte du mot de passe : changer de mot de passe invalide toutes les sessions ouvertes. */
export const pwFingerprint = (hash: string) => createHash('sha256').update('pf:' + hash).digest('hex').slice(0, 16);
/** Clé de suivi de commande (lien WhatsApp) : permet de suivre sans saisir le téléphone, impossible à deviner. */
export const trackKey = (tenantId: number, number: string) => createHmac('sha256', rawSecret()).update(`track:${tenantId}:${number}`).digest('hex').slice(0, 20);

/** IP du client : en-têtes posés par la plateforme d'abord (non falsifiables sur Vercel), puis X-Forwarded-For. */
export function clientIp(h: { get(k: string): string | null }): string {
  const v = h.get('x-vercel-forwarded-for') || h.get('x-real-ip') || (h.get('x-forwarded-for') || '').split(',')[0];
  return (v || '').split(',')[0].trim().slice(0, 45) || '0.0.0.0';
}

export async function signSession(p: { uid: number; tid: number; csrf: string; pf: string }) {
  return new SignJWT(p).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(`${TTL}s`).sign(secret());
}
export async function verifySession(token: string | undefined): Promise<{ uid: number; tid: number; csrf: string; pf: string } | null> {
  if (!token) return null;
  try { const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] }); return payload as any; } catch { return null; }
}
export function cookieFrom(header: string | null, name = COOKIE): string | undefined {
  return header?.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1);
}
export const sessionCookie = (token: string, secure: boolean) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TTL}${secure ? '; Secure' : ''}`;
export const clearCookie = (secure: boolean) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;

/** Utilisateur connecté de cette boutique (pour les pages serveur : aperçu des produits masqués). */
export async function sessionUserFromCookieHeader(cookieHeader: string | null, tenant: Tenant): Promise<(SessionUser & { csrf: string }) | null> {
  const s = await verifySession(cookieFrom(cookieHeader));
  if (!s || s.tid !== tenant.id) return null;
  const u = await one<SessionUser & { password_hash: string }>('SELECT id, username, name, role, must_change_password, password_hash FROM users WHERE id = $1 AND tenant_id = $2 AND active', [s.uid, tenant.id]);
  if (!u || s.pf !== pwFingerprint(u.password_hash)) return null;
  const { password_hash: _h, ...user } = u;
  return { ...user, csrf: s.csrf };
}

export class Ctx {
  url: URL; method: string; headersOut = new Headers(); user: (SessionUser & { csrf: string }) | null = null;
  private _body: any; private _settings?: Settings;
  constructor(public req: Request, public tenant: Tenant) {
    this.url = new URL(req.url);
    let m = req.method.toUpperCase();
    const o = (req.headers.get('x-http-method-override') || '').toUpperCase();
    if (m === 'POST' && ['PUT', 'DELETE', 'PATCH'].includes(o)) m = o;
    this.method = m;
  }
  q(k: string, d = ''): string { return this.url.searchParams.get(k) ?? d; }
  qint(k: string, d = 0): number { const v = this.url.searchParams.get(k); return v === null || v === '' ? d : (parseInt(v, 10) || 0); }
  get query() { return Object.fromEntries(this.url.searchParams.entries()); }
  async body(): Promise<any> {
    if (this._body !== undefined) return this._body;
    try { const j = await this.req.json(); this._body = j && typeof j === 'object' ? j : {}; } catch { this._body = {}; }
    return this._body;
  }
  get ip(): string { return clientIp(this.req.headers); }
  get https(): boolean { return (this.req.headers.get('x-forwarded-proto') || this.url.protocol.replace(':', '')) === 'https'; }
  async settings(): Promise<Settings> { return this._settings ??= await loadSettings(this.tenant.id); }
  json(data: unknown, status = 200): Response {
    const h = new Headers(this.headersOut); h.set('Content-Type', 'application/json; charset=UTF-8'); if (!h.has('Cache-Control')) h.set('Cache-Control', 'no-store');
    return new Response(JSON.stringify(data), { status, headers: h });
  }
}

/** Authentification + CSRF + rôle. */
export async function requireLogin(ctx: Ctx, role?: 'admin', allowPending = false) {
  const s = await verifySession(cookieFrom(ctx.req.headers.get('cookie')));
  if (!s || s.tid !== ctx.tenant.id) fail('Authentification requise', 401);
  const row = await one<SessionUser & { password_hash: string }>('SELECT id, username, name, role, must_change_password, password_hash FROM users WHERE id = $1 AND tenant_id = $2 AND active', [s!.uid, ctx.tenant.id]);
  if (!row || s!.pf !== pwFingerprint(row.password_hash)) fail('Authentification requise', 401);
  const { password_hash: _ph, ...u } = row!;
  if (ctx.method !== 'GET' && ctx.req.headers.get('x-csrf-token') !== s!.csrf) fail('Jeton de sécurité invalide, rechargez la page', 403);
  if (role === 'admin' && u!.role !== 'admin') fail('Accès réservé aux administrateurs', 403);
  if (u!.must_change_password && !allowPending) fail("Vous devez d'abord changer votre mot de passe", 403, { must_change_password: true });
  ctx.user = { ...u!, csrf: s!.csrf };
  return ctx.user;
}

export async function audit(ctx: Ctx, action: string, entity = '', id: string | number | null = null, detail = '') {
  await exec('INSERT INTO audit_log (tenant_id, user_id, username, action, entity, entity_id, detail, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [ctx.tenant.id, ctx.user?.id ?? null, ctx.user?.username ?? null, action, entity, id === null ? null : String(id), detail.slice(0, 500), ctx.ip]);
}

/** true = autorisé. */
export async function rateLimit(key: string, max: number, windowSec: number, hit = true): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  await exec('DELETE FROM rate_limits WHERE ts < $1', [now - 86400]);
  const c = await val<number>('SELECT COUNT(*)::int FROM rate_limits WHERE k = $1 AND ts > $2', [key, now - windowSec]);
  if ((c ?? 0) >= max) return false;
  if (hit) await exec('INSERT INTO rate_limits (k, ts) VALUES ($1,$2)', [key, now]);
  return true;
}

export function passwordProblem(pw: string, username = '', min = 8): string | null {
  if (pw.length < min) return `Le mot de passe doit contenir au moins ${min} caractères`;
  if (pw.length > 200) return 'Mot de passe trop long';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Le mot de passe doit contenir des lettres et des chiffres';
  if (username && pw.toLowerCase().includes(username.toLowerCase())) return "Le mot de passe ne doit pas contenir l'identifiant";
  if (['admin123', 'password1', '12345678a', 'motdepasse1'].includes(pw.toLowerCase())) return 'Mot de passe trop courant';
  return null;
}
export { rows };
