import bcrypt from 'bcryptjs';
import { db, one, exec } from './db';
import { saveSetting, SETTING_DEFAULTS } from './settings';
import { passwordProblem, BCRYPT_COST } from './api/ctx';
import { forgetTenants } from './tenant';

/** Nombre maximum de boutiques créées sur la plateforme, SUPPRESSIONS COMPRISES (plafond « à vie »). */
export const LIFETIME_MAX_SHOPS = Number(process.env.MAX_SHOPS_LIFETIME || 50);
const RESERVED = ['www', 'app', 'api', 'admin', 'super', 'mail', 'ftp', 'static', 'assets', 'cdn', 'dashboard', 'login', 'status'];

export async function shopsEverCreated(): Promise<number> {
  const r = await one<{ v: string }>("SELECT v FROM platform_state WHERE k = 'shops_created'");
  return r ? Number(r.v) || 0 : 0;                          // compteur dédié, incrémenté avec la création : exact même après un incident ou une suppression
}

export type NewTenant = { slug: string; name: string; adminUser?: string; adminPassword: string; adminPasswordHash?: string; whatsapp?: string; plan?: string; maxProducts?: number; maxUsers?: number; paidUntil?: string | null; customDomain?: string | null; mustChange?: boolean };

export async function createTenant(t: NewTenant) {
  const slug = t.slug.toLowerCase().trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/.test(slug)) throw new Error('Slug invalide : 3 à 30 caractères (a-z, 0-9, tiret).');
  if (RESERVED.includes(slug)) throw new Error(`« ${slug} » est un nom réservé.`);
  if (!t.name.trim()) throw new Error('Nom de boutique obligatoire.');
  const user = (t.adminUser || 'admin').toLowerCase();
  if (!t.adminPasswordHash) { const pb = passwordProblem(t.adminPassword, user); if (pb) throw new Error(pb); }
  if (await shopsEverCreated() >= LIFETIME_MAX_SHOPS) throw new Error(`Plafond atteint : ${LIFETIME_MAX_SHOPS} boutiques maximum créées sur cette plateforme.`);
  if (await one('SELECT 1 FROM tenants WHERE slug = $1', [slug])) throw new Error(`Le slug « ${slug} » existe déjà.`);
  const hash = t.adminPasswordHash || await bcrypt.hash(t.adminPassword, BCRYPT_COST);
  const id = await (await db()).tx(async tx => {
    const n = await one<{ v: string }>("UPDATE platform_state SET v = ((v::int) + 1)::text, updated_at = (now() AT TIME ZONE 'utc') WHERE k = 'shops_created' RETURNING v", [], tx);
    if (!n || Number(n.v) > LIFETIME_MAX_SHOPS) throw new Error(`Plafond atteint : ${LIFETIME_MAX_SHOPS} boutiques maximum créées sur cette plateforme.`);   // vérifié dans la transaction : pas de dépassement en cas de créations simultanées
    const id = (await one<{ id: number }>(`INSERT INTO tenants (slug, name, plan, max_products, max_users, paid_until, custom_domain) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [slug, t.name.trim(), t.plan || 'free', t.maxProducts ?? 100, t.maxUsers ?? 3, t.paidUntil || null, t.customDomain || null], tx))!.id;
    await exec('INSERT INTO users (tenant_id, username, name, password_hash, role, must_change_password) VALUES ($1,$2,$3,$4,$5,$6)', [id, user, 'Administrateur', hash, 'admin', t.mustChange ?? true], tx);
    await saveSetting(id, 'shop_name', t.name.trim(), tx);
    if (t.whatsapp) await saveSetting(id, 'whatsapp', t.whatsapp.replace(/\D/g, ''), tx);
    return id;
  });
  forgetTenants();
  return { id, slug };
}
export { SETTING_DEFAULTS };
