import { rows } from './db';
import { ORDER_STATUSES } from './catalog';

export type Col = { key: string; label: string; type: 'text' | 'int' | 'money' | 'pct' };
export type Config = { dataset: string; from?: string; to?: string; group?: string; columns?: string[]; status?: string; payment?: string; category?: string };
export type Result = { title: string; columns: Col[]; rows: (string | number | null)[][]; totals: (string | number | null)[] | null; truncated: boolean };

const T = (key: string, label: string): Col => ({ key, label, type: 'text' });
const I = (key: string, label: string): Col => ({ key, label, type: 'int' });
const M = (key: string, label: string): Col => ({ key, label, type: 'money' });
const P = (key: string, label: string): Col => ({ key, label, type: 'pct' });
export const MAX_ROWS = 20000;

/** Catalogue des rapports : jeux de données, regroupements et colonnes disponibles (envoyé à l'interface). */
export const CATALOG: Record<string, { label: string; period: boolean; groups: { key: string; label: string }[]; columns: Record<string, Col[]>; filters: string[] }> = {
  orders: { label: 'Ventes et commandes', period: true, filters: ['status', 'payment'],
    groups: [{ key: '', label: 'Détail (une ligne par commande)' }, { key: 'day', label: 'Par jour' }, { key: 'week', label: 'Par semaine' }, { key: 'month', label: 'Par mois' }, { key: 'status', label: 'Par statut' }, { key: 'payment', label: 'Par paiement' }, { key: 'mode', label: 'Par mode de livraison' }],
    columns: { '': [T('number', 'N°'), T('date', 'Date'), T('customer', 'Client'), T('phone', 'Téléphone'), T('mode', 'Mode'), T('status', 'Statut'), T('payment', 'Paiement'), M('subtotal', 'Sous-total'), M('discount', 'Remise'), M('delivery', 'Livraison'), M('total', 'Total'), T('promo', 'Code promo'), T('items', 'Articles')],
      '*': [T('label', 'Période / groupe'), I('orders', 'Commandes'), M('revenue', "Chiffre d'affaires"), M('paid', 'Encaissé'), M('avg', 'Panier moyen'), I('cancelled', 'Annulées')] } },
  products: { label: 'Ventes par produit', period: true, filters: ['category'],
    groups: [{ key: 'product', label: 'Par produit' }, { key: 'category', label: 'Par catégorie' }, { key: 'month', label: 'Par mois' }],
    columns: { product: [T('name', 'Produit'), T('category', 'Catégorie'), I('qty', 'Quantité'), M('revenue', "Chiffre d'affaires")], category: [T('name', 'Catégorie'), I('qty', 'Quantité'), M('revenue', "Chiffre d'affaires")], month: [T('name', 'Mois'), I('qty', 'Quantité'), M('revenue', "Chiffre d'affaires")] } },
  customers: { label: 'Clients', period: true, filters: [], groups: [{ key: '', label: 'Classement par dépenses' }],
    columns: { '': [T('name', 'Client'), T('phone', 'Téléphone'), T('email', 'Email'), I('orders', 'Commandes'), M('spent', 'Total dépensé'), M('avg', 'Panier moyen'), T('first', 'Première commande'), T('last', 'Dernière commande')] } },
  stock: { label: 'Inventaire et stock', period: false, filters: ['category'], groups: [{ key: '', label: 'Une ligne par produit' }],
    columns: { '': [T('name', 'Produit'), T('sku', 'Référence'), T('category', 'Catégorie'), T('status', 'Statut'), M('price', 'Prix'), T('stock', 'Stock'), M('value', 'Valeur du stock'), I('views', 'Vues')] } },
  audience: { label: 'Audience', period: true, filters: [], groups: [{ key: 'day', label: 'Par jour' }, { key: 'week', label: 'Par semaine' }, { key: 'month', label: 'Par mois' }],
    columns: { '*': [T('label', 'Période'), I('uv', 'Visiteurs'), I('pv', 'Pages vues'), I('cart', 'Ajouts au panier'), I('checkout', 'Commandes lancées'), I('orders', 'Commandes reçues'), P('conv', 'Conversion')] } },
};
const PAY: Record<string, string> = { unpaid: 'Non payée', paid: 'Payée' }, MODE: Record<string, string> = { delivery: 'Livraison', pickup: 'Retrait' };
const dstr = (v: any) => (v ? String(v).slice(0, 10) : '');
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function normalize(c: any): Config {
  const ds = CATALOG[c?.dataset] ? c.dataset : 'orders', def = CATALOG[ds];
  const group = def.groups.some(g => g.key === (c?.group ?? '')) ? (c?.group ?? '') : def.groups[0].key;
  const today = new Date().toISOString().slice(0, 10), ago = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const all = def.columns[group] || def.columns['*'];
  const cols = Array.isArray(c?.columns) ? c.columns.filter((k: any) => all.some(x => x.key === k)) : [];
  return { dataset: ds, group, from: isDate(c?.from) ? c.from : ago, to: isDate(c?.to) ? c.to : today, columns: cols.length ? cols : all.map(x => x.key),
    status: Object.keys(ORDER_STATUSES).includes(c?.status) ? c.status : '', payment: ['paid', 'unpaid'].includes(c?.payment) ? c.payment : '', category: String(c?.category || '').slice(0, 80) };
}

const bucket = (d: string, g: string) => g === 'month' ? d.slice(0, 7) : g === 'week' ? (() => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); })() : d;
const SQLB: Record<string, string> = { day: "created_at::date::text", week: "date_trunc('week', created_at)::date::text", month: "to_char(created_at, 'YYYY-MM')" };

export async function runReport(tid: number, raw: any): Promise<Result> {
  const c = normalize(raw), def = CATALOG[c.dataset], g = c.group || '';
  const all = def.columns[g] || def.columns['*'], cols = all.filter(x => c.columns!.includes(x.key));
  let data: Record<string, any>[] = [], totals: Record<string, any> | null = null, truncated = false;
  const range = `du ${c.from} au ${c.to}`;

  if (c.dataset === 'orders') {
    const p: any[] = [tid, c.from, c.to]; let w = 'o.tenant_id = $1 AND o.created_at::date >= $2::date AND o.created_at::date <= $3::date';
    if (c.status) { p.push(c.status); w += ` AND o.status = $${p.length}`; } if (c.payment) { p.push(c.payment); w += ` AND o.payment_status = $${p.length}`; }
    if (!g) {
      const r = await rows(`SELECT o.*, (SELECT string_agg(qty || ' x ' || name, ' | ' ORDER BY id) FROM order_items WHERE order_id = o.id) AS items FROM orders o WHERE ${w} ORDER BY o.id DESC LIMIT ${MAX_ROWS + 1}`, p);
      truncated = r.length > MAX_ROWS;
      data = r.slice(0, MAX_ROWS).map(o => ({ number: o.number, date: String(o.created_at).slice(0, 16).replace('T', ' '), customer: o.customer_name, phone: o.customer_phone, mode: MODE[o.delivery_mode], status: ORDER_STATUSES[o.status], payment: PAY[o.payment_status], subtotal: o.subtotal, discount: o.discount, delivery: o.delivery_fee, total: o.total, promo: o.promo_code, items: o.items || '' }));
      const live = data.filter((_, i) => r[i].status !== 'cancelled');
      totals = { number: 'Total', subtotal: sum(live, 'subtotal'), discount: sum(live, 'discount'), delivery: sum(live, 'delivery'), total: sum(live, 'total') };
    } else {
      const expr = SQLB[g] || (g === 'status' ? 'o.status' : g === 'payment' ? 'o.payment_status' : 'o.delivery_mode');
      const r = await rows(`SELECT ${expr.replace(/created_at/g, 'o.created_at')} AS label, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE o.status = 'cancelled')::int AS cancelled,
        COALESCE(SUM(o.total) FILTER (WHERE o.status <> 'cancelled'),0)::bigint AS revenue, COALESCE(SUM(o.total) FILTER (WHERE o.payment_status = 'paid' AND o.status <> 'cancelled'),0)::bigint AS paid,
        COUNT(*) FILTER (WHERE o.status <> 'cancelled')::int AS live FROM orders o WHERE ${w} GROUP BY 1 ORDER BY 1 ${SQLB[g] ? 'ASC' : ''}`, p);
      data = r.map(x => ({ label: g === 'status' ? ORDER_STATUSES[x.label] : g === 'payment' ? PAY[x.label] : g === 'mode' ? MODE[x.label] : x.label, orders: x.live, revenue: Number(x.revenue), paid: Number(x.paid), avg: x.live ? Math.floor(Number(x.revenue) / x.live) : 0, cancelled: x.cancelled }));
      const o = sum(data, 'orders'), rev = sum(data, 'revenue');
      totals = { label: 'Total', orders: o, revenue: rev, paid: sum(data, 'paid'), avg: o ? Math.floor(rev / o) : 0, cancelled: sum(data, 'cancelled') };
    }
  } else if (c.dataset === 'products') {
    const p: any[] = [tid, c.from, c.to]; let w = "o.tenant_id = $1 AND o.status <> 'cancelled' AND o.created_at::date >= $2::date AND o.created_at::date <= $3::date";
    let wa = 'tenant_id = $1 AND month >= date_trunc(\'month\', $2::date)::date AND month <= $3::date';
    if (c.category) { p.push(c.category); w += ` AND COALESCE(cat.name,'Sans catégorie') = $${p.length}`; wa += ` AND category_name = $${p.length}`; }
    const live = await rows(`SELECT oi.name, COALESCE(cat.name,'Sans catégorie') AS category, to_char(o.created_at,'YYYY-MM') AS month, SUM(oi.qty)::int AS qty, SUM(oi.qty*oi.unit_price)::bigint AS revenue
      FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN products pr ON pr.id = oi.product_id LEFT JOIN categories cat ON cat.id = pr.category_id WHERE ${w} GROUP BY 1,2,3`, p);
    const arch = await rows(`SELECT name, category_name AS category, to_char(month,'YYYY-MM') AS month, qty, revenue FROM sales_archive WHERE ${wa}`, p);
    const m = new Map<string, any>();
    for (const x of [...live, ...arch]) {
      const k = g === 'category' ? x.category : g === 'month' ? x.month : x.name + '\u0000' + x.category;
      const e = m.get(k) || { name: g === 'category' ? x.category : g === 'month' ? x.month : x.name, category: x.category, qty: 0, revenue: 0 };
      e.qty += Number(x.qty); e.revenue += Number(x.revenue); m.set(k, e);
    }
    data = [...m.values()].sort((a, b) => g === 'month' ? a.name.localeCompare(b.name) : b.revenue - a.revenue);
    totals = { name: 'Total', qty: sum(data, 'qty'), revenue: sum(data, 'revenue') };
  } else if (c.dataset === 'customers') {
    const r = await rows(`SELECT cu.name, cu.phone, cu.email, COUNT(*)::int AS orders, SUM(o.total)::bigint AS spent, MIN(o.created_at) AS first, MAX(o.created_at) AS last
      FROM orders o JOIN customers cu ON cu.id = o.customer_id WHERE o.tenant_id = $1 AND o.status <> 'cancelled' AND o.created_at::date >= $2::date AND o.created_at::date <= $3::date GROUP BY cu.id ORDER BY spent DESC LIMIT ${MAX_ROWS}`, [tid, c.from, c.to]);
    data = r.map(x => ({ name: x.name, phone: x.phone, email: x.email, orders: x.orders, spent: Number(x.spent), avg: Math.floor(Number(x.spent) / x.orders), first: dstr(x.first), last: dstr(x.last) }));
    totals = { name: `${data.length} clients`, orders: sum(data, 'orders'), spent: sum(data, 'spent') };
  } else if (c.dataset === 'stock') {
    const p: any[] = [tid]; let w = 'p.tenant_id = $1'; if (c.category) { p.push(c.category); w += ` AND COALESCE(cat.name,'Sans catégorie') = $2`; }
    const r = await rows(`SELECT p.name, p.sku, COALESCE(cat.name,'Sans catégorie') AS category, p.status, p.price, p.track_stock, p.stock, p.views FROM products p LEFT JOIN categories cat ON cat.id = p.category_id WHERE ${w} ORDER BY p.name LIMIT ${MAX_ROWS}`, p);
    const ST: Record<string, string> = { active: 'En ligne', draft: 'Brouillon', archived: 'Archivé' };
    data = r.map(x => ({ name: x.name, sku: x.sku, category: x.category, status: ST[x.status], price: x.price, stock: x.track_stock ? x.stock : 'Illimité', value: x.track_stock ? x.price * x.stock : 0, views: x.views }));
    totals = { name: `${data.length} produits`, value: sum(data, 'value'), views: sum(data, 'views') };
  } else {
    const st = await rows("SELECT day::text AS day, metric, SUM(n)::int AS n FROM stats_daily WHERE tenant_id = $1 AND day >= $2::date AND day <= $3::date AND metric IN ('pv','uv','cart','checkout') GROUP BY 1,2", [tid, c.from, c.to]);
    const od = await rows("SELECT created_at::date::text AS day, COUNT(*)::int AS n FROM orders WHERE tenant_id = $1 AND status <> 'cancelled' AND created_at::date >= $2::date AND created_at::date <= $3::date GROUP BY 1", [tid, c.from, c.to]);
    const m = new Map<string, any>(); const ent = (d: string) => { const k = bucket(d, g); let e = m.get(k); if (!e) m.set(k, e = { label: k, uv: 0, pv: 0, cart: 0, checkout: 0, orders: 0 }); return e; };
    for (const x of st) ent(x.day)[x.metric] += x.n; for (const x of od) ent(x.day).orders += x.n;
    data = [...m.values()].sort((a, b) => a.label.localeCompare(b.label)); for (const e of data) e.conv = e.uv ? Math.round(e.orders / e.uv * 1000) / 10 : 0;
    const t = { label: 'Total', uv: sum(data, 'uv'), pv: sum(data, 'pv'), cart: sum(data, 'cart'), checkout: sum(data, 'checkout'), orders: sum(data, 'orders'), conv: 0 }; t.conv = t.uv ? Math.round(t.orders / t.uv * 1000) / 10 : 0; totals = t;
  }
  const pick = (o: Record<string, any> | null) => o && cols.map(x => (o[x.key] === undefined ? null : o[x.key]));
  const first = cols[0]?.key; const tr = totals ? pick(totals) : null; if (tr && first && tr[0] === null) tr[0] = 'Total';
  return { title: `${def.label}${g ? ' – ' + (def.groups.find(x => x.key === g)?.label || '') : ''}${def.period ? ' (' + range + ')' : ''}`, columns: cols, rows: data.map(o => pick(o)!), totals: tr, truncated };
}
const sum = (a: Record<string, any>[], k: string) => a.reduce((s, x) => s + (Number(x[k]) || 0), 0);
