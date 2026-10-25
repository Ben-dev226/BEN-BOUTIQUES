import { one } from './db';

export type Tenant = { id: number; slug: string; name: string; custom_domain: string | null; status: 'active' | 'suspended'; plan: string; max_products: number; max_users: number; paid_until: string | null; grace?: boolean };

const cache = new Map<string, { t: Tenant | null; exp: number }>();
const COLS = 'id, slug, name, custom_domain, status, plan, max_products, max_users, paid_until::text AS paid_until';

export function cleanHost(h: string | null | undefined): string { return (h || '').toLowerCase().split(',')[0].trim().replace(/:\d+$/, ''); }
export const hostFromHeaders = (h: { get(k: string): string | null }) => cleanHost(h.get('x-forwarded-host') || h.get('host'));

/** Abonnement échu (paid_until dépassée) ⇒ boutique traitée comme suspendue. Sans date : jamais d'échéance. */
export const GRACE_DAYS = () => Math.max(0, Number(process.env.GRACE_DAYS ?? 3));
const effective = (t: Tenant | null | undefined): Tenant | null => {
  if (!t) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (!t.paid_until || t.paid_until >= today) return t;
  const lim = new Date(new Date(t.paid_until + 'T00:00:00Z').getTime() + GRACE_DAYS() * 86400000).toISOString().slice(0, 10);
  return lim >= today ? { ...t, grace: true } : { ...t, status: 'suspended' };   // échéance dépassée : période de grâce, puis suspension
};

export async function tenantBySlug(slug: string): Promise<Tenant | null> {
  return effective(await one<Tenant>(`SELECT ${COLS} FROM tenants WHERE slug = $1`, [slug]));
}

/** Préfixe de boutique (mode chemin, ex. « /fifi »), posé par le middleware ; chaîne vide sinon. */
export const baseFromHeaders = (h: { get(k: string): string | null }) => { const b = h.get('x-shop-base') || ''; return /^\/[a-z0-9-]{2,40}$/.test(b) ? b : ''; };
export const tenantFromHeaders = (h: { get(k: string): string | null }) => tenantForHost(hostFromHeaders(h), baseFromHeaders(h));

export async function tenantForHost(host: string, base = ''): Promise<Tenant | null> {
  const key = host + base;
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.t;
  const t = base ? effective(await tenantBySlug(base.slice(1))) : await lookup(host);
  cache.set(key, { t, exp: Date.now() + (t ? 30_000 : 5_000) });
  return t;
}
export const forgetTenants = () => cache.clear();

async function lookup(host: string): Promise<Tenant | null> {
  const root = (process.env.ROOT_DOMAIN || '').toLowerCase();
  if (root && host.endsWith('.' + root)) {
    const label = host.slice(0, -(root.length + 1));
    if (!label.includes('.') && !['www', 'app', 'super'].includes(label)) return tenantBySlug(label);
    return null;                                           // www.ben-dev.com, super.ben-dev.com… : pas une boutique
  }
  if (root && host === root) return null;                  // page de la plateforme
  const custom = await one<Tenant>(`SELECT ${COLS} FROM tenants WHERE custom_domain = $1`, [host.replace(/^www\./, '')]);
  if (custom) return effective(custom);
  return null;                                             // *.vercel.app / localhost sans préfixe : la landing de la plateforme
}

/** Hôte du panneau super-admin : super.<ROOT_DOMAIN> (ou tout hôte de dev / aperçu). */
export function isSuperHost(host: string): boolean {
  const root = (process.env.ROOT_DOMAIN || '').toLowerCase();
  if (!root) return true;
  // en production le panneau n'est servi QUE sur super.<domaine> ; *.vercel.app seulement si SUPER_ALLOW_VERCEL_APP=1 (mise en route)
  return host === 'super.' + root || host === 'localhost' || host === '127.0.0.1' || (process.env.SUPER_ALLOW_VERCEL_APP === '1' && host.endsWith('.vercel.app'));
}
