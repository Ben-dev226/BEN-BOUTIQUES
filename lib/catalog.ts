import { rows, one, val, exec, Q, type Db } from './db';
import { assetUrl } from './storage';
import { fcfa, slugify } from './util';
import { fail, type Ctx } from './api/ctx';
import type { Settings } from './settings';

// ── Produits ──────────────────────────────────────────────
export const PRODUCT_SELECT = `SELECT p.*, c.name AS category_name, c.slug AS category_slug,
  (SELECT thumb FROM product_images i WHERE i.product_id = p.id ORDER BY i.position, i.id LIMIT 1) AS thumb,
  (SELECT path  FROM product_images i WHERE i.product_id = p.id ORDER BY i.position, i.id LIMIT 1) AS image,
  (SELECT COUNT(*)::int FROM product_variants v WHERE v.product_id = p.id AND v.active) AS variant_count,
  (SELECT COALESCE(SUM(v.stock),0)::int FROM product_variants v WHERE v.product_id = p.id AND v.active) AS variant_stock
  FROM products p LEFT JOIN categories c ON c.id = p.category_id`;

export const productUrl = (slug: string) => `/p/${encodeURIComponent(slug)}`;

export function formatProduct(r: any, s: Settings, admin = false) {
  const tracked = !!r.track_stock, hasVar = r.variant_count > 0;
  const stockQty = hasVar ? r.variant_stock : r.stock;
  const price = r.price, compare = r.compare_price ?? null, onSale = compare !== null && compare > price;
  const out: Record<string, unknown> = {
    id: r.id, slug: r.slug, name: r.name, price, compare_price: onSale ? compare : null,
    discount_pct: onSale ? Math.round((compare - price) / compare * 100) : 0,
    category: r.category_slug, category_name: r.category_name,
    image: assetUrl(r.image), thumb: assetUrl(r.thumb),
    is_new: !!r.is_new, featured: !!r.featured, in_stock: !tracked || stockQty > 0, has_variants: hasVar,
    low_stock: tracked && stockQty > 0 && stockQty <= Number(s.low_stock_threshold),
    stock_qty: tracked ? stockQty : null, url: productUrl(r.slug),
  };
  if (admin) Object.assign(out, { status: r.status, sku: r.sku, track_stock: tracked, stock: r.stock, views: r.views, created_at: r.created_at, updated_at: r.updated_at, category_id: r.category_id });
  return out;
}

export async function productImages(pid: number, tenantId: number) {
  return (await rows('SELECT id, path, thumb, width, height, alt FROM product_images WHERE product_id = $1 AND tenant_id = $2 ORDER BY position, id', [pid, tenantId]))
    .map(i => ({ id: i.id, path: i.path, thumb_path: i.thumb, url: assetUrl(i.path), thumb: assetUrl(i.thumb), width: i.width, height: i.height, alt: i.alt }));
}
export async function productVariants(pid: number, tenantId: number, onlyActive = true) {
  return (await rows(`SELECT id, label, sku, price, stock, active FROM product_variants WHERE product_id = $1 AND tenant_id = $2${onlyActive ? ' AND active' : ''} ORDER BY position, id`, [pid, tenantId]))
    .map(v => ({ id: v.id, label: v.label, sku: v.sku, price: v.price ?? null, stock: v.stock, active: !!v.active }));
}

const VAR_STOCK = `(CASE WHEN EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.active) THEN (SELECT SUM(v.stock) FROM product_variants v WHERE v.product_id = p.id AND v.active) ELSE p.stock END)`;

/** WHERE commun liste publique / admin (toujours borné à la boutique). */
export function productFilters(tenantId: number, f: Record<string, string>, admin: boolean, lowThreshold: number): { where: string; q: Q } {
  const q = new Q(); const w = [`p.tenant_id = ${q.add(tenantId)}`];
  if (!admin) w.push("p.status = 'active'");
  else if (['active', 'draft', 'archived'].includes(f.status)) w.push(`p.status = ${q.add(f.status)}`);
  const s = (f.q || '').trim();
  if (s) { const like = '%' + s.replace(/[\\%_]/g, m => '\\' + m) + '%'; const p = q.add(like); w.push(`(p.name ILIKE ${p} OR p.description ILIKE ${p} OR p.sku ILIKE ${p} OR c.name ILIKE ${p})`); }
  if (f.ids !== undefined && f.ids !== '') {
    const ids = f.ids.split(',').map(x => parseInt(x, 10)).filter(Boolean).slice(0, 60);
    w.push(ids.length ? `p.id = ANY(${q.add(ids)}::int[])` : 'FALSE');
  }
  if (f.category) w.push(`c.slug = ${q.add(f.category)}`);
  if (f.min !== undefined && f.min !== '') w.push(`p.price >= ${q.add(parseInt(f.min, 10) || 0)}`);
  if (f.max !== undefined && f.max !== '') w.push(`p.price <= ${q.add(parseInt(f.max, 10) || 0)}`);
  if (f.promo) w.push('p.compare_price IS NOT NULL AND p.compare_price > p.price');
  if (f.new) w.push('p.is_new');
  if (f.featured) w.push('p.featured');
  if (f.in_stock) w.push(`(NOT p.track_stock OR ${VAR_STOCK} > 0)`);
  if (admin && f.low_stock) w.push(`(p.track_stock AND ${VAR_STOCK} <= ${q.add(lowThreshold)})`);
  return { where: ' WHERE ' + w.join(' AND '), q };
}

export function productOrderSql(sort: string): string {
  switch (sort) {
    case 'price_asc': return 'p.price ASC, p.id DESC';
    case 'price_desc': return 'p.price DESC, p.id DESC';
    case 'name': return 'lower(p.name) ASC, p.id DESC';
    case 'popular': return 'p.views DESC, p.id DESC';
    case 'discount': return '(CASE WHEN p.compare_price > p.price THEN (p.compare_price - p.price) * 1.0 / p.compare_price ELSE 0 END) DESC, p.id DESC';
    case 'oldest': return 'p.id ASC';
    case 'newest': return 'p.id DESC';
    case 'stock': return 'p.stock ASC, p.id DESC';
    default: return 'p.featured DESC, p.id DESC';
  }
}

export async function uniqueSlug(tenantId: number, base: string, table: 'products' | 'categories', exceptId: number | null = null, t?: Db): Promise<string> {
  const b = slugify(base) || 'article'; let slug = b, n = 2;
  for (;;) {
    const r = await one<{ id: number }>(`SELECT id FROM ${table} WHERE tenant_id = $1 AND slug = $2`, [tenantId, slug], t);
    if (!r || (exceptId !== null && r.id === exceptId)) return slug;
    slug = `${b}-${n++}`;
  }
}

// ── Promotions & livraison ────────────────────────────────
export async function evaluatePromo(tenantId: number, code: string, subtotal: number, t?: Db) {
  const p = await one('SELECT * FROM promo_codes WHERE tenant_id = $1 AND lower(code) = lower($2)', [tenantId, code.trim()], t);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  if (!p || !p.active) fail('Code promo invalide');
  if (p.starts_at && p.starts_at > now) fail("Ce code n'est pas encore actif");
  if (p.expires_at && p.expires_at < now) fail('Ce code a expiré');
  if (p.max_uses !== null && p.used >= p.max_uses) fail("Ce code a atteint sa limite d'utilisation");
  if (subtotal < p.min_order) fail(`Commande minimale de ${fcfa(p.min_order)} pour ce code`);
  const discount = p.type === 'percent' ? Math.floor(subtotal * Math.min(100, p.value) / 100) : Math.min(p.value, subtotal);
  return { promo: p, discount };
}

export function deliveryFeeFor(s: Settings, mode: string, subtotalAfterDiscount: number): number {
  if (mode === 'pickup') return 0;
  const free = Number(s.free_delivery_min) || 0;
  return free > 0 && subtotalAfterDiscount >= free ? 0 : Number(s.delivery_fee) || 0;
}

// ── Commandes ─────────────────────────────────────────────
export const ORDER_STATUSES: Record<string, string> = { new: 'Nouvelle', confirmed: 'Confirmée', shipped: 'En livraison', delivered: 'Livrée', cancelled: 'Annulée' };

export async function generateOrderNumber(tenantId: number, prefixSetting: string, t: Db): Promise<string> {
  const prefix = prefixSetting.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'CMD';
  const d = new Date().toISOString();
  for (let i = 0; i < 20; i++) {
    const n = `${prefix}-${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}-${Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;
    if (!(await one('SELECT 1 FROM orders WHERE tenant_id = $1 AND number = $2', [tenantId, n], t))) return n;
  }
  return fail('Impossible de générer un numéro de commande', 500);
}

export function orderWhatsappMessage(o: any, items: any[], shopName: string, trackUrl: string): string {
  const L = [`*Nouvelle commande ${shopName}*`, `N° *${o.number}*`, ''];
  for (const it of items) {
    L.push(`• ${it.name}${it.variant_label ? ` (${it.variant_label})` : ''}`);
    L.push(`   ${it.qty} × ${fcfa(it.unit_price)} = *${fcfa(it.unit_price * it.qty)}*`);
  }
  L.push('', `Sous-total : ${fcfa(o.subtotal)}`);
  if (o.discount > 0) L.push(`Remise${o.promo_code ? ` (${o.promo_code})` : ''} : -${fcfa(o.discount)}`);
  if (o.delivery_mode === 'pickup') L.push('Retrait en boutique'); else if (o.delivery_fee > 0) L.push(`Livraison : ${fcfa(o.delivery_fee)}`);
  L.push(`*Total : ${fcfa(o.total)}*`, '', `${o.customer_name} – ${o.customer_phone}`);
  if (o.delivery_mode === 'delivery' && o.customer_address) L.push(`${o.customer_address}`);
  if (o.note) L.push(`${o.note}`);
  L.push('', `Suivi : ${trackUrl}`);
  return L.join('\n');
}

export async function orderEvent(t: Db, tenantId: number, orderId: number, username: string, type: string, detail = '') {
  await exec('INSERT INTO order_events (tenant_id, order_id, username, type, detail) VALUES ($1,$2,$3,$4,$5)', [tenantId, orderId, username, type, detail.slice(0, 500)], t);
}

/** sign = -1 retire du stock, +1 restitue. Les décrémentations sont conditionnelles (pas de survente). */
export async function applyOrderStock(t: Db, tenantId: number, orderId: number, sign: 1 | -1) {
  const items = await rows('SELECT product_id, variant_id, qty FROM order_items WHERE order_id = $1 AND tenant_id = $2', [orderId, tenantId], t);
  for (const it of items) {
    if (!it.product_id) continue;
    const p = await one('SELECT track_stock FROM products WHERE id = $1 AND tenant_id = $2', [it.product_id, tenantId], t);
    if (!p?.track_stock) continue;
    const tbl = it.variant_id ? 'product_variants' : 'products', id = it.variant_id ?? it.product_id;
    if (sign < 0) {
      const n = await exec(`UPDATE ${tbl} SET stock = stock - $1 WHERE id = $2 AND tenant_id = $3 AND stock >= $1`, [it.qty, id, tenantId], t);
      if (!n) fail('Stock insuffisant', 409);
    } else await exec(`UPDATE ${tbl} SET stock = stock + $1 WHERE id = $2 AND tenant_id = $3`, [it.qty, id, tenantId], t);
  }
}

export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (s && '=+-@\t\r'.includes(s[0])) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
export function csvResponse(filename: string, header: string[], data: unknown[][]): Response {
  const body = '﻿' + [header, ...data].map(r => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
  return new Response(body, { headers: { 'Content-Type': 'text/csv; charset=UTF-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' } });
}

export function originOf(ctx: Ctx): string {
  const h = ctx.req.headers; const host = (h.get('x-forwarded-host') || h.get('host') || ctx.url.host).split(',')[0].trim();
  return `${ctx.https ? 'https' : 'http'}://${host}${ctx.base}`;
}
export { val };
