import bcrypt from 'bcryptjs';
import { timingSafeEqual } from 'crypto';
import { one, exec } from './db';
import { passwordProblem, rateLimit, BCRYPT_COST } from './api/ctx';
import { createTenant } from './tenants';
import { logSecurity } from './log';

export const setupToken = () => process.env.SETUP_TOKEN || '';
export const setupOpen = async () => !(await one('SELECT 1 FROM super_admins LIMIT 1'));
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** Première mise en route sans terminal : crée le compte super-admin et la première boutique. Fermé dès qu'un super-admin existe. */
export async function runSetup(b: any, ip: string): Promise<{ ok: true; slug: string } | { ok: false; error: string; status: number }> {
  const tok = setupToken();
  if (tok.length < 12) return { ok: false, error: 'SETUP_TOKEN n\'est pas défini dans Vercel (12 caractères minimum).', status: 503 };
  if (!await setupOpen()) return { ok: false, error: 'La plateforme est déjà configurée.', status: 403 };
  if (!await rateLimit(`setup:${ip}`, 6, 3600)) return { ok: false, error: 'Trop de tentatives, réessayez plus tard.', status: 429 };
  if (!same(String(b?.token ?? ''), tok)) { await logSecurity({ type: 'setup_bad_token', ip, message: 'Mauvais code sur la page de première configuration' }); return { ok: false, error: 'Code de configuration incorrect.', status: 403 }; }
  const email = String(b?.email ?? '').trim().toLowerCase(), pw = String(b?.password ?? '');
  if (!/^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(email)) return { ok: false, error: 'Email invalide.', status: 400 };
  const pb = passwordProblem(pw, email, 12); if (pb) return { ok: false, error: pb, status: 400 };
  const shop = String(b?.shop_name ?? '').trim(), slug = String(b?.slug ?? '').trim().toLowerCase(), wa = String(b?.whatsapp ?? '').replace(/\D/g, ''), spw = String(b?.shop_password ?? '');
  const withShop = !!(shop || slug || spw);
  if (withShop) {
    if (!shop || !slug) return { ok: false, error: 'Indiquez le nom et l\'adresse de la boutique, ou laissez les deux vides.', status: 400 };
    if (wa.length < 8) return { ok: false, error: 'Numéro WhatsApp invalide (format international, ex. 22670123456).', status: 400 };
    const sp = passwordProblem(spw, 'admin', 8); if (sp) return { ok: false, error: 'Mot de passe de la boutique : ' + sp, status: 400 };
  }
  try {
    if (withShop) await createTenant({ slug, name: shop, adminUser: 'admin', adminPassword: spw, whatsapp: wa, plan: 'free', paidUntil: null, mustChange: false });
  } catch (e: any) { return { ok: false, error: e.message, status: 400 }; }
  await exec('INSERT INTO super_admins (email, password_hash) VALUES ($1,$2) ON CONFLICT (email) DO NOTHING', [email, await bcrypt.hash(pw, BCRYPT_COST)]);
  await logSecurity({ type: 'setup_done', ip, message: `Première configuration terminée (${email}${withShop ? ', boutique ' + slug : ''})` });
  return { ok: true, slug: withShop ? slug : '' };
}
