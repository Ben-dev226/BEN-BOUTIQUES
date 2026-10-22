import { db, rows, one, val, exec, Q } from '../db';
import { Ctx, fail, audit } from './ctx';
import { ORDER_STATUSES, applyOrderStock, orderEvent, csvResponse } from '../catalog';
import { assetUrl } from '../storage';
import { cleanStr, fcfa } from '../util';

function filters(ctx: Ctx) {
  const q = new Q(); const w = [`o.tenant_id = ${q.add(ctx.tenant.id)}`];
  const s = ctx.q('status');
  if (s === 'open') w.push("o.status IN ('new','confirmed','shipped')"); else if (s in ORDER_STATUSES) w.push(`o.status = ${q.add(s)}`);
  if (['paid', 'unpaid'].includes(ctx.q('payment'))) w.push(`o.payment_status = ${q.add(ctx.q('payment'))}`);
  const t = ctx.q('q').trim();
  if (t) { const l = q.add('%' + t.replace(/[\\%_]/g, m => '\\' + m) + '%'); w.push(`(o.number ILIKE ${l} OR o.customer_name ILIKE ${l} OR o.customer_phone ILIKE ${l})`); }
  const d = (v: string) => /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '';
  if (d(ctx.q('from'))) w.push(`o.created_at::date >= ${q.add(d(ctx.q('from')))}::date`);
  if (d(ctx.q('to'))) w.push(`o.created_at::date <= ${q.add(d(ctx.q('to')))}::date`);
  return { where: ' WHERE ' + w.join(' AND '), q };
}
const orderRow = (o: any) => ({ archived: !!o.compacted_at, id: o.id, number: o.number, customer_name: o.customer_name, customer_phone: o.customer_phone, customer_address: o.customer_address, delivery_mode: o.delivery_mode, note: o.note,
  status: o.status, status_label: ORDER_STATUSES[o.status], payment_status: o.payment_status, subtotal: o.subtotal, discount: o.discount, delivery_fee: o.delivery_fee, total: o.total,
  promo_code: o.promo_code, admin_note: o.admin_note, created_at: o.created_at, updated_at: o.updated_at });

export async function adminOrders(ctx: Ctx) {
  const size = Math.max(5, Math.min(100, ctx.qint('size', 20))), page = Math.max(1, ctx.qint('page', 1));
  const { where, q } = filters(ctx);
  const tot: any = await one(`SELECT COUNT(*)::int AS n, COALESCE(SUM(CASE WHEN o.status <> 'cancelled' THEN o.total END),0)::int AS sum FROM orders o${where}`, q.params);
  const lim = q.add(size), off = q.add((page - 1) * size);
  const r = await rows(`SELECT o.*, (SELECT COALESCE(SUM(qty),0)::int FROM order_items WHERE order_id = o.id) AS items_count FROM orders o${where} ORDER BY o.id DESC LIMIT ${lim} OFFSET ${off}`, q.params);
  const counts: Record<string, number> = Object.fromEntries(Object.keys(ORDER_STATUSES).map(k => [k, 0]));
  for (const c of await rows('SELECT status, COUNT(*)::int AS n FROM orders WHERE tenant_id = $1 GROUP BY status', [ctx.tenant.id])) counts[c.status] = c.n;
  return ctx.json({ orders: r.map(o => ({ ...orderRow(o), items_count: o.items_count })), total: tot.n, sum: tot.sum, page, pages: Math.ceil(tot.n / size), status_counts: counts });
}

async function orderDetail(ctx: Ctx, id: number) {
  const o = await one('SELECT * FROM orders WHERE id = $1 AND tenant_id = $2', [id, ctx.tenant.id]);
  if (!o) fail('Commande introuvable', 404);
  const items = await rows('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [id]);
  const events = await rows('SELECT username, type, detail, created_at FROM order_events WHERE order_id = $1 ORDER BY id DESC', [id]);
  const s = await ctx.settings();
  const msg = `Bonjour ${o.customer_name}, votre commande ${o.number} chez ${s.shop_name} est : ${ORDER_STATUSES[o.status]}. Total : ${fcfa(o.total)}. Merci !`;
  return { ...orderRow(o), items: items.map(i => ({ id: i.id, product_id: i.product_id, name: i.name, variant_label: i.variant_label, unit_price: i.unit_price, qty: i.qty, thumb: assetUrl(i.image ? i.image.replace('/products/', '/thumbs/') : null) })),
    events, whatsapp_customer_url: `https://wa.me/${o.customer_phone}?text=${encodeURIComponent(msg)}` };
}
export async function adminOrderGet(ctx: Ctx) { return ctx.json(await orderDetail(ctx, ctx.qint('id'))); }

export async function adminOrderUpdate(ctx: Ctx) {
  const id = ctx.qint('id'), b = await ctx.body(), tid = ctx.tenant.id;
  const o = await one('SELECT * FROM orders WHERE id = $1 AND tenant_id = $2', [id, tid]);
  if (!o) fail('Commande introuvable', 404);
  const U = "updated_at = (now() AT TIME ZONE 'utc')";
  await (await db()).tx(async t => {
    let pay = b.payment_status;
    if (b.status !== undefined && b.status !== o.status) {
      if (!(b.status in ORDER_STATUSES)) fail('Statut inconnu');
      if (o.compacted_at) fail('Commande archivée : son statut n’est plus modifiable.', 409);
      if (b.status === 'cancelled') await applyOrderStock(t, tid, id, 1); else if (o.status === 'cancelled') await applyOrderStock(t, tid, id, -1);
      await exec(`UPDATE orders SET status = $1, ${U} WHERE id = $2`, [b.status, id], t);
      await orderEvent(t, tid, id, ctx.user!.username, 'status', `${ORDER_STATUSES[o.status]} → ${ORDER_STATUSES[b.status]}`);
      if (b.status === 'delivered' && pay === undefined) pay = 'paid';
    }
    if (['paid', 'unpaid'].includes(pay) && pay !== o.payment_status) {
      await exec(`UPDATE orders SET payment_status = $1, ${U} WHERE id = $2`, [pay, id], t);
      await orderEvent(t, tid, id, ctx.user!.username, 'payment', pay === 'paid' ? 'Marquée payée' : 'Marquée non payée');
    }
    if ('admin_note' in b) await exec('UPDATE orders SET admin_note = $1 WHERE id = $2', [cleanStr(b.admin_note, 1000), id], t);
  });
  await audit(ctx, 'order_update', 'order', id, o.number);
  return ctx.json(await orderDetail(ctx, id));
}

export async function adminOrderDelete(ctx: Ctx) {
  const id = ctx.qint('id'), tid = ctx.tenant.id;
  const o = await one('SELECT number, status FROM orders WHERE id = $1 AND tenant_id = $2', [id, tid]);
  if (!o) fail('Commande introuvable', 404);
  await (await db()).tx(async t => { if (o.status !== 'cancelled') await applyOrderStock(t, tid, id, 1); await exec('DELETE FROM orders WHERE id = $1 AND tenant_id = $2', [id, tid], t); });
  await audit(ctx, 'order_delete', 'order', id, o.number);
  return ctx.json({ ok: true });
}

export async function adminOrdersExport(ctx: Ctx) {
  const { where, q } = filters(ctx);
  const r = await rows(`SELECT o.*, (SELECT string_agg(qty || ' x ' || name || CASE WHEN variant_label <> '' THEN ' (' || variant_label || ')' ELSE '' END, ' | ' ORDER BY id) FROM order_items WHERE order_id = o.id) AS items FROM orders o${where} ORDER BY o.id DESC`, q.params);
  return csvResponse(`commandes-${new Date().toISOString().slice(0, 10)}.csv`,
    ['N°', 'Date', 'Client', 'Téléphone', 'Mode', 'Adresse', 'Articles', 'Sous-total', 'Remise', 'Livraison', 'Total', 'Code promo', 'Statut', 'Paiement', 'Note client', 'Note interne'],
    r.map(o => [o.number, o.created_at, o.customer_name, o.customer_phone, o.delivery_mode === 'pickup' ? 'Retrait' : 'Livraison', o.customer_address, o.items, o.subtotal, o.discount, o.delivery_fee, o.total, o.promo_code, ORDER_STATUSES[o.status], o.payment_status === 'paid' ? 'Payé' : 'Non payé', o.note, o.admin_note]));
}
