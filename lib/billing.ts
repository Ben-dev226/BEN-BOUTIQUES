import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, one, rows, exec } from './db';
import { forgetTenants } from './tenant';
import { logWarn } from './log';

/**
 * Abonnements via Chariow.
 *  CHARIOW_API_KEY       clé API (scope checkout.write)
 *  CHARIOW_PULSE_SECRET  secret « whsec_… » du Pulse (Automation → Pulses)
 *  CHARIOW_PLANS         JSON : [{"id":"prd_xxx","months":1,"label":"1 mois"},{"id":"prd_yyy","months":12,"label":"1 an"}]
 *                        (id = identifiant ou slug du produit Chariow ; l'option optionnelle "plan" renomme l'offre de la boutique)
 */
export type PlanOption = { id: string; months: number; label: string; plan?: string };
export const chariowBase = () => (process.env.CHARIOW_API_BASE || 'https://api.chariow.com/v1').replace(/\/$/, '');

export function billingPlans(): PlanOption[] {
  try { const a = JSON.parse(process.env.CHARIOW_PLANS || '[]'); return Array.isArray(a) ? a.filter(p => p?.id && p.months > 0).map(p => ({ id: String(p.id), months: +p.months, label: String(p.label || `${p.months} mois`), plan: p.plan })) : []; } catch { return []; }
}
export const billingEnabled = () => !!process.env.CHARIOW_API_KEY && billingPlans().length > 0;

const COUNTRY: Record<string, string> = { '226': 'BF', '225': 'CI', '221': 'SN', '223': 'ML', '228': 'TG', '229': 'BJ', '227': 'NE', '237': 'CM', '241': 'GA', '243': 'CD', '242': 'CG', '224': 'GN', '233': 'GH', '234': 'NG', '212': 'MA', '216': 'TN', '213': 'DZ', '33': 'FR', '32': 'BE', '41': 'CH', '1': 'US' };
/** « 22670123456 » → { number: '70123456', country_code: 'BF' } */
export function splitPhone(full: string): { number: string; country_code: string } | null {
  const d = full.replace(/\D/g, '');
  for (const len of [3, 2, 1]) { const cc = COUNTRY[d.slice(0, len)]; if (cc && d.length - len >= 6) return { number: d.slice(len), country_code: cc }; }
  return null;
}

/** Le champ `errors` de Chariow peut être un tableau, une chaîne ou un objet { champ: [messages] } : on aplatit défensivement. */
export function errorText(j: any): string {
  const flat = (v: any): string[] => v == null ? [] : typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(flat) : typeof v === 'object' ? Object.values(v).flatMap(flat) : [String(v)];
  return [...new Set([...flat(j?.errors), ...flat(j?.message)])].join(' · ').slice(0, 300);
}

export async function startCheckout(o: { plan: PlanOption; tenantId: number; slug: string; email: string; firstName: string; lastName: string; phone: { number: string; country_code: string }; redirectUrl: string; ip: string }): Promise<string> {
  const key = process.env.CHARIOW_API_KEY; if (!key) throw new Error('Paiement non configuré');
  const res = await fetch(`${chariowBase()}/checkout`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' }, signal: AbortSignal.timeout(20000),
    body: JSON.stringify({ product_id: o.plan.id, email: o.email, first_name: o.firstName, last_name: o.lastName, phone: o.phone, redirect_url: /^https:\/\//.test(o.redirectUrl) ? o.redirectUrl : undefined, customer_ip: o.ip !== '0.0.0.0' ? o.ip : undefined,
      custom_metadata: { tenant_id: String(o.tenantId), slug: o.slug, months: String(o.plan.months) } }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) { await logWarn({ type: 'checkout_failed', tenantId: o.tenantId, message: `Chariow checkout HTTP ${res.status}`, detail: j }); throw new Error(res.status === 422 || res.status === 400 ? errorText(j) || 'Données de paiement invalides' : 'Le service de paiement est indisponible, réessayez.'); }
  const url = j?.data?.payment?.checkout_url;
  if (!url || j?.data?.step !== 'payment') throw new Error('Paiement impossible pour le moment.');
  await exec('INSERT INTO billing_checkouts (tenant_id, email, product_id) VALUES ($1,$2,$3)', [o.tenantId, o.email.toLowerCase(), o.plan.id]).catch(() => {});
  return String(url);
}

export function verifyPulse(raw: string, header: string | null): boolean {
  const secret = process.env.CHARIOW_PULSE_SECRET; if (!secret || !header) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(header.trim().toLowerCase()), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const addMonthsFrom = (base: string, n: number) => { const d = new Date(base + 'T00:00:00Z'); const day = d.getUTCDate(); d.setUTCMonth(d.getUTCMonth() + n); if (d.getUTCDate() !== day) d.setUTCDate(0); return d.toISOString().slice(0, 10); };

/** Crédite un paiement réussi. Idempotent (sale_id unique). Retourne null si ignoré. */
export async function creditSale(p: any, deliveryId: string | null): Promise<{ tenant: string; until: string; tenantId: number } | null> {
  if (p?.event !== 'successful.sale') return null;
  const saleId = String(p.sale?.id ?? ''), productKeys = [p.product?.id, p.product?.slug].filter(Boolean).map(String);
  const plan = billingPlans().find(x => productKeys.includes(x.id));
  let tid = parseInt(p.sale?.custom_metadata?.tenant_id, 10);
  if (!tid && p.customer?.email && plan) {      // secours : dernier checkout en attente créé avec cet email pour ce produit
    tid = (await one<{ tenant_id: number }>('SELECT tenant_id FROM billing_checkouts WHERE lower(email) = lower($1) AND product_id = $2 AND created_at > (now() AT TIME ZONE \'utc\') - interval \'3 days\' ORDER BY id DESC LIMIT 1', [String(p.customer.email), plan.id]))?.tenant_id ?? 0;
  }
  if (!saleId || !plan || !tid) { await logWarn({ type: 'payment_unmatched', message: 'Vente Chariow reçue mais non rattachée à une boutique/offre', detail: { sale: saleId, products: productKeys, email: p.customer?.email } }); return null; }
  return (await db()).tx(async t => {
    if (await one('SELECT 1 FROM billing_payments WHERE sale_id = $1', [saleId], t)) return null;
    const tenant = await one<{ slug: string; paid_until: string | null }>('SELECT slug, paid_until::text AS paid_until FROM tenants WHERE id = $1 FOR UPDATE', [tid], t);
    if (!tenant) return null;
    const today = new Date().toISOString().slice(0, 10);
    const base = tenant.paid_until && tenant.paid_until > today ? tenant.paid_until : today;
    const until = addMonthsFrom(base, plan.months);
    await exec('UPDATE tenants SET paid_until = $1, status = \'active\'' + (plan.plan ? ', plan = $3' : '') + ' WHERE id = $2', plan.plan ? [until, tid, plan.plan] : [until, tid], t);
    await exec('INSERT INTO billing_payments (tenant_id, sale_id, delivery_id, product_id, months, amount, currency, paid_until_before, paid_until_after) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [tid, saleId, deliveryId, plan.id, plan.months, Number(p.sale?.amount?.value) || 0, String(p.sale?.amount?.currency ?? ''), tenant.paid_until, until], t);
    forgetTenants();
    return { tenant: tenant.slug, until, tenantId: tid };
  });
}

export const recentPayments = (tid: number, n = 10) => rows('SELECT sale_id, months, amount, currency, paid_until_after::text AS paid_until, created_at FROM billing_payments WHERE tenant_id = $1 ORDER BY id DESC LIMIT $2', [tid, n]);
