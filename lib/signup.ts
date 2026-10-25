import bcrypt from 'bcryptjs';
import { one, val, exec, rows } from './db';
import { createTenant, shopsEverCreated, LIFETIME_MAX_SHOPS } from './tenants';
import { passwordProblem, rateLimit, BCRYPT_COST } from './api/ctx';
import { normalizePhone } from './util';
import { sendAlert, logInfo, logSecurity } from './log';
import { isBanned } from './moderation';

export type SignupMode = 'off' | 'review' | 'auto';
export const signupMode = (): SignupMode => { const m = (process.env.SIGNUP_MODE || 'review').toLowerCase(); return m === 'off' || m === 'auto' ? m : 'review'; };
export const trialDays = () => Math.max(0, Number(process.env.TRIAL_DAYS ?? 7));
const RESERVED = ["www", "app", "api", "admin", "super", "mail", "ftp", "static", "assets", "cdn", "dashboard", "login", "status", "inscription", "setup", "fonts", "landing", "conditions", "confidentialite", "p", "c", "suivi", "a-propos", "icon", "sitemap", "robots", "manifest"];
const MAX_PENDING = 30;
const clean = (s: unknown, n: number) => String(s ?? '').replace(/[\u0000-\u001F<>]/g, '').trim().slice(0, n);

export const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

export async function slugState(slug: string): Promise<{ ok: boolean; reason?: string }> {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/.test(slug)) return { ok: false, reason: 'Utilisez 3 à 30 caractères : lettres, chiffres et tirets.' };
  if (RESERVED.includes(slug)) return { ok: false, reason: 'Ce nom est réservé.' };
  if (await one('SELECT 1 FROM tenants WHERE slug = $1', [slug]) || await one("SELECT 1 FROM signup_requests WHERE slug = $1 AND status = 'pending'", [slug])) return { ok: false, reason: 'Cette adresse est déjà prise.' };
  return { ok: true };
}
export async function placesLeft() { return Math.max(0, LIFETIME_MAX_SHOPS - await shopsEverCreated() - Number(await val<number>("SELECT COUNT(*)::int FROM signup_requests WHERE status = 'pending'") || 0)); }

export async function submitSignup(b: any, ip: string): Promise<{ ok: true; mode: SignupMode; slug: string; url?: string } | { ok: false; error: string; status: number }> {
  const mode = signupMode(); if (mode === 'off') return { ok: false, error: 'Les inscriptions sont fermées pour le moment.', status: 403 };
  if (clean(b?.website, 50)) return { ok: true, mode, slug: '' };                                  // pot de miel : on fait semblant
  if (!await rateLimit(`signup:${ip}`, 4, 3600)) return { ok: false, error: 'Trop de tentatives, réessayez plus tard.', status: 429 };
  const name = clean(b?.name, 60), slug = slugify(clean(b?.slug, 40) || name), wa = normalizePhone(clean(b?.whatsapp, 30)), email = clean(b?.email, 120).toLowerCase(), pw = String(b?.password ?? '');
  if (name.length < 2) return { ok: false, error: 'Indiquez le nom de votre boutique.', status: 400 };
  if (wa.length < 8) return { ok: false, error: 'Numéro WhatsApp invalide (format international, ex. 22670123456).', status: 400 };
  if (email && !/^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(email)) return { ok: false, error: 'Email invalide.', status: 400 };
  const pb = passwordProblem(pw, 'admin'); if (pb) return { ok: false, error: pb, status: 400 };
  if (await isBanned(slug, wa, email)) { await logSecurity({ type: 'signup_banned', ip, message: `Inscription refusée (liste noire) : ${slug}` }); return { ok: false, error: 'Inscription impossible. Contactez-nous.', status: 403 }; }
  const st = await slugState(slug); if (!st.ok) return { ok: false, error: st.reason!, status: 409 };
  if (await placesLeft() <= 0) return { ok: false, error: 'Toutes les places sont prises pour le moment.', status: 409 };
  const hash = await bcrypt.hash(pw, BCRYPT_COST);
  if (mode === 'auto') {
    const r = await createFromRequest({ slug, name, whatsapp: wa, hash });
    await sendAlert(`Nouvelle boutique créée automatiquement : ${name} (${slug}) — https://wa.me/${wa}`);
    return { ok: true, mode, slug, url: r.url };
  }
  if (Number(await val<number>("SELECT COUNT(*)::int FROM signup_requests WHERE status = 'pending'")) >= MAX_PENDING) return { ok: false, error: 'Trop de demandes en attente, réessayez plus tard.', status: 429 };
  await exec('INSERT INTO signup_requests (slug, name, whatsapp, email, password_hash, ip) VALUES ($1,$2,$3,$4,$5,$6)', [slug, name, wa, email, hash, ip]);
  await logInfo({ type: 'signup_request', message: `Demande d'inscription : ${name} (${slug})`, ip });
  await sendAlert(`Demande d'inscription : ${name} (${slug})\nWhatsApp : https://wa.me/${wa}\nÀ valider dans le super-admin → Demandes.`);
  return { ok: true, mode, slug };
}

export async function createFromRequest(r: { slug: string; name: string; whatsapp: string; hash: string }) {
  const days = trialDays(), until = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const t = await createTenant({ slug: r.slug, name: r.name, adminUser: 'admin', adminPassword: '', adminPasswordHash: r.hash, whatsapp: r.whatsapp, plan: 'free', paidUntil: until, mustChange: false });
  const root = process.env.ROOT_DOMAIN;
  return { id: t.id, url: root ? `https://${r.slug}.${root}` : `/${r.slug}/`, until };
}

export async function listRequests() { return rows("SELECT id, slug, name, whatsapp, email, status, created_at, decided_at, tenant_id FROM signup_requests ORDER BY (status = 'pending') DESC, id DESC LIMIT 100"); }
export async function approveRequest(id: number) {
  const r: any = await one("SELECT * FROM signup_requests WHERE id = $1", [id]); if (!r) throw new Error('Demande introuvable');
  if (await isBanned(r.slug, r.whatsapp, r.email)) throw new Error('Cette demande correspond à une boutique bannie (adresse, WhatsApp ou email en liste noire).');
  if (r.status !== 'pending') throw new Error('Demande déjà traitée');
  const t = await createFromRequest({ slug: r.slug, name: r.name, whatsapp: r.whatsapp, hash: r.password_hash });
  await exec("UPDATE signup_requests SET status = 'approved', tenant_id = $2, decided_at = (now() AT TIME ZONE 'utc'), password_hash = '' WHERE id = $1", [id, t.id]);
  return { ...t, whatsapp: r.whatsapp, name: r.name, slug: r.slug, days: trialDays() };
}
export async function rejectRequest(id: number) {
  const n = await exec("UPDATE signup_requests SET status = 'rejected', decided_at = (now() AT TIME ZONE 'utc'), password_hash = '' WHERE id = $1 AND status = 'pending'", [id]);
  if (!n) throw new Error('Demande introuvable ou déjà traitée');
}
export { logSecurity };
