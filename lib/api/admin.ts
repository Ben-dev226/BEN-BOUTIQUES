import bcrypt from 'bcryptjs';
import { db, rows, one, val, exec, Q, type Db } from '../db';
import { Ctx, fail, audit, requireLogin, passwordProblem, BCRYPT_COST } from './ctx';
import { PRODUCT_SELECT, formatProduct, productImages, productVariants, productFilters, productOrderSql, uniqueSlug, ORDER_STATUSES, csvResponse } from '../catalog';
import { listProducts } from './public';
import { rateLimit } from './ctx';
import { report } from '../analytics';
import { GRACE_DAYS } from '../tenant';
import { runReport, normalize as normReport, CATALOG as REPORTS } from '../reports';
import { toXlsx } from '../xlsx';
import { toPdf, cellText } from '../pdf';
import { shopInsights } from '../insights';
import { SETTING_DEFAULTS, LONG_SETTINGS, loadSettings, saveSetting, type Settings } from '../settings';
import { assetUrl, deleteObjects, copyObject } from '../storage';
import { processProductImage, processLogo } from '../images';
import { billingPlans, billingEnabled, startCheckout, splitPhone, recentPayments } from '../billing';
import { originOf } from '../catalog';
import { cleanStr, normalizePhone, randHex, isHex, safeHttpUrl } from '../util';

const dateStr = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const imgPathOk = (tenantSlug: string, p: string) => new RegExp(`^${tenantSlug.replace(/[^a-z0-9-]/gi, '')}/products/[a-z0-9-]+\\.webp$`).test(p);
const thumbOf = (p: string) => p.replace('/products/', '/thumbs/');
const intOrNull = (v: any) => (v === '' || v === null || v === undefined ? null : parseInt(v, 10) || 0);

// ── Tableau de bord ───────────────────────────────────────
export async function adminAnalytics(ctx: Ctx) {
  const tid = ctx.tenant.id, days = Math.max(7, Math.min(365, ctx.qint('days', 30)));
  const r = await report(tid, days);
  const ids = [...new Set([...r.prod, ...r.cart].map(x => Number(x.ref)).filter(Boolean))];
  const names = new Map((ids.length ? await rows('SELECT id, name FROM products WHERE tenant_id = $1 AND id = ANY($2::int[])', [tid, ids]) : []).map((x: any) => [String(x.id), x.name]));
  const orders = Number(await val<number>("SELECT COUNT(*)::int FROM orders WHERE tenant_id = $1 AND status <> 'cancelled' AND created_at::date >= $2::date", [tid, r.from])) || 0;
  const named = (l: { ref: string; n: number }[]) => l.map(x => ({ name: names.get(x.ref) || 'Produit supprimé', n: x.n }));
  return ctx.json({ days, series: r.series, totals: { ...r.totals, orders }, sources: r.sources, devices: r.devices, clicks: r.clicks, top_viewed: named(r.prod), top_carted: named(r.cart),
    insights: await shopInsights(tid, days, await ctx.settings()), conversion: r.totals.uv ? Math.round(orders / r.totals.uv * 1000) / 10 : 0, since: r.from, integrations: { ga4: !!(await ctx.settings()).ga4_id, pixel: !!(await ctx.settings()).meta_pixel_id } });
}
const cfgOf = (ctx: Ctx) => { try { return JSON.parse(ctx.q('c') || '{}'); } catch { return {}; } };
export async function adminReport(ctx: Ctx) {
  const cfg = normReport(cfgOf(ctx)), r = await runReport(ctx.tenant.id, cfg);
  const cats = (await rows('SELECT name FROM categories WHERE tenant_id = $1 ORDER BY position, lower(name)', [ctx.tenant.id])).map((x: any) => x.name).concat('Sans catégorie');
  return ctx.json({ config: cfg, catalog: REPORTS, categories: cats, result: { ...r, rows: r.rows.slice(0, 200), total_rows: r.rows.length } });
}
export async function adminReportExport(ctx: Ctx) {
  const cfg = normReport(cfgOf(ctx)), r = await runReport(ctx.tenant.id, cfg), fmt = ctx.q('format') || 'csv', s = await ctx.settings();
  const base = `rapport-${cfg.dataset}-${new Date().toISOString().slice(0, 10)}`;
  await audit(ctx, 'report_export', 'report', null, `${cfg.dataset}/${cfg.group || 'detail'} ${fmt}`);
  const hd = (type: string, name: string) => ({ 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
  if (fmt === 'xlsx') return new Response(toXlsx(r, { shop: s.shop_name }) as any, { headers: hd('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base + '.xlsx') });
  if (fmt === 'pdf') return new Response((await toPdf(r, { shop: s.shop_name, color: s.primary_color })) as any, { headers: hd('application/pdf', base + '.pdf') });
  return csvResponse(base + '.csv', r.columns.map(c => c.label), [...r.rows, ...(r.totals ? [r.totals] : [])].map(row => row.map((v, i) => v ?? '')));
}
export async function adminReportsList(ctx: Ctx) {
  return ctx.json({ reports: (await rows('SELECT id, name, config, created_by, created_at FROM saved_reports WHERE tenant_id = $1 ORDER BY id DESC', [ctx.tenant.id])).map((x: any) => ({ id: x.id, name: x.name, config: JSON.parse(x.config), created_by: x.created_by, created_at: x.created_at })) });
}
export async function adminReportSave(ctx: Ctx) {
  const b = await ctx.body(), name = cleanStr(b.name, 80); if (!name) fail('Donnez un nom au rapport');
  if (Number(await val<number>('SELECT COUNT(*)::int FROM saved_reports WHERE tenant_id = $1', [ctx.tenant.id])) >= 25) fail('25 rapports enregistrés au maximum : supprimez-en un', 402);
  const cfg = normReport(b.config || {}), row: any = await one('INSERT INTO saved_reports (tenant_id, name, config, created_by) VALUES ($1,$2,$3,$4) RETURNING id', [ctx.tenant.id, name, JSON.stringify(cfg), ctx.user?.username ?? '']);
  return ctx.json({ id: row.id });
}
export async function adminReportDelete(ctx: Ctx) { await exec('DELETE FROM saved_reports WHERE id = $1 AND tenant_id = $2', [ctx.qint('id'), ctx.tenant.id]); return ctx.json({ ok: true }); }
export async function adminInsights(ctx: Ctx) { return ctx.json({ insights: (await shopInsights(ctx.tenant.id, 30, await ctx.settings())).slice(0, 4) }); }
export async function adminStats(ctx: Ctx) {
  const tid = ctx.tenant.id, days = Math.max(7, Math.min(365, ctx.qint('days', 30)));
  const today = new Date(); const from = dateStr(addDays(today, -(days - 1))), prevFrom = dateStr(addDays(today, -(2 * days - 1)));
  const kpi = async (a: string, b?: string) => {
    const r: any = await one(`SELECT COUNT(*)::int AS orders, COALESCE(SUM(total),0)::int AS revenue,
      COALESCE(SUM(CASE WHEN payment_status='paid' THEN total ELSE 0 END),0)::int AS paid, COUNT(DISTINCT customer_phone)::int AS customers
      FROM orders WHERE tenant_id = $1 AND status <> 'cancelled' AND created_at::date >= $2::date${b ? ' AND created_at::date < $3::date' : ''}`, b ? [tid, a, b] : [tid, a]);
    r.avg_basket = r.orders ? Math.floor(r.revenue / r.orders) : 0; return r;
  };
  const cur = await kpi(from), prev = await kpi(prevFrom, from);
  const m = new Map((await rows(`SELECT created_at::date::text AS d, COUNT(*)::int AS n, COALESCE(SUM(total),0)::int AS t FROM orders WHERE tenant_id = $1 AND status <> 'cancelled' AND created_at::date >= $2::date GROUP BY 1`, [tid, from])).map(r => [r.d, r]));
  const start = new Date(from + 'T00:00:00Z');
  const series = Array.from({ length: days }, (_, i) => { const d = dateStr(addDays(start, i)); return { date: d, orders: m.get(d)?.n ?? 0, revenue: m.get(d)?.t ?? 0 }; });
  const byStatus: Record<string, number> = Object.fromEntries(Object.keys(ORDER_STATUSES).map(k => [k, 0]));
  for (const r of await rows('SELECT status, COUNT(*)::int AS n FROM orders WHERE tenant_id = $1 GROUP BY status', [tid])) byStatus[r.status] = r.n;
  const top = await rows(`SELECT oi.product_id, oi.name, SUM(oi.qty)::int AS qty, SUM(oi.qty * oi.unit_price)::int AS revenue, MAX(oi.image) AS image
    FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.tenant_id = $1 AND o.status <> 'cancelled' AND o.created_at::date >= $2::date
    GROUP BY oi.product_id, oi.name ORDER BY revenue DESC LIMIT 5`, [tid, from]);
  const cats = await rows(`SELECT COALESCE(c.name,'Sans catégorie') AS cname, SUM(oi.qty*oi.unit_price)::int AS revenue FROM order_items oi
    JOIN orders o ON o.id = oi.order_id LEFT JOIN products p ON p.id = oi.product_id LEFT JOIN categories c ON c.id = p.category_id
    WHERE o.tenant_id = $1 AND o.status <> 'cancelled' AND o.created_at::date >= $2::date GROUP BY 1 ORDER BY revenue DESC LIMIT 6`, [tid, from]);
  const s = await ctx.settings();
  const pending = await val<number>("SELECT COUNT(*)::int FROM orders WHERE tenant_id = $1 AND status IN ('new','confirmed')", [tid]);
  const { where, q } = productFilters(tid, { low_stock: '1' }, true, Number(s.low_stock_threshold));
  const low = await rows(`${PRODUCT_SELECT}${where} ORDER BY p.stock ASC LIMIT 8`, q.params);
  const latest = await rows('SELECT id, number, customer_name, total, status, created_at FROM orders WHERE tenant_id = $1 ORDER BY id DESC LIMIT 6', [tid]);
  const counts = await one(`SELECT (SELECT COUNT(*)::int FROM products WHERE tenant_id = $1 AND status='active') AS active_products,
    (SELECT COUNT(*)::int FROM products WHERE tenant_id = $1 AND status<>'active') AS inactive_products, (SELECT COUNT(*)::int FROM customers WHERE tenant_id = $1) AS customers`, [tid]);
  return ctx.json({ days, current: cur, previous: prev, series, by_status: byStatus,
    top_products: top.map(r => ({ id: r.product_id, name: r.name, qty: r.qty, revenue: r.revenue, thumb: assetUrl(r.image ? thumbOf(r.image) : null) })),
    categories: cats.map(r => ({ name: r.cname, revenue: r.revenue })), pending_orders: pending, low_stock: low.map(r => formatProduct(r, s, true)), latest_orders: latest, counts,
    plan: { name: ctx.tenant.plan, max_products: ctx.tenant.max_products, max_users: ctx.tenant.max_users, paid_until: ctx.tenant.paid_until, days_left: ctx.tenant.paid_until ? Math.round((Date.parse(ctx.tenant.paid_until + 'T00:00:00Z') - Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')) / 864e5) : null, grace: !!ctx.tenant.grace, grace_days: GRACE_DAYS(), products: (counts as any).active_products + (counts as any).inactive_products } });
}

// ── Produits ──────────────────────────────────────────────
export async function adminProducts(ctx: Ctx) {
  const size = Math.max(5, Math.min(100, ctx.qint('size', 20)));
  const r = await listProducts(ctx, true, size, 'newest');
  return ctx.json(r);
}

export async function adminProductGet(ctx: Ctx) {
  const id = ctx.qint('id'), tid = ctx.tenant.id;
  const r = await one(`${PRODUCT_SELECT} WHERE p.tenant_id = $1 AND p.id = $2`, [tid, id]);
  if (!r) fail('Produit introuvable', 404);
  const p: any = formatProduct(r, await ctx.settings(), true);
  p.description = r.description; p.images = await productImages(id, tid); p.variants = await productVariants(id, tid, false);
  return ctx.json(p);
}

async function assertProductQuota(ctx: Ctx) {
  const n = await val<number>('SELECT COUNT(*)::int FROM products WHERE tenant_id = $1', [ctx.tenant.id]) ?? 0;
  if (n >= ctx.tenant.max_products) fail(`Limite de votre offre atteinte (${ctx.tenant.max_products} produits). Contactez-nous pour passer à l'offre supérieure.`, 402);
}

export async function adminProductSave(ctx: Ctx, update: boolean) {
  const b = await ctx.body(), tid = ctx.tenant.id, id0 = update ? ctx.qint('id') : 0;
  const name = cleanStr(b.name, 140);
  if (name.length < 2) fail('Le nom du produit est obligatoire');
  const price = parseInt(b.price, 10); if (!(price >= 0) || price > 100_000_000) fail('Prix invalide');
  let compare = intOrNull(b.compare_price); if (compare !== null && compare <= price) compare = null;
  const status = ['active', 'draft', 'archived'].includes(b.status) ? b.status : 'active';
  const catId = b.category_id ? parseInt(b.category_id, 10) : null;
  if (catId && !await one('SELECT 1 FROM categories WHERE id = $1 AND tenant_id = $2', [catId, tid])) fail('Catégorie inconnue');
  const track = !!b.track_stock, stock = Math.max(0, parseInt(b.stock, 10) || 0), desc = cleanStr(b.description, 5000), sku = cleanStr(b.sku, 40);
  const variants = (Array.isArray(b.variants) ? b.variants : []).map((v: any) => ({ id: parseInt(v?.id, 10) || 0, label: cleanStr(v?.label, 60), sku: cleanStr(v?.sku, 40),
    price: intOrNull(v?.price) === null ? null : Math.max(0, intOrNull(v?.price)!), stock: Math.max(0, parseInt(v?.stock, 10) || 0), active: v && 'active' in v ? !!v.active : true })).filter((v: any) => v.label);
  if (variants.length > 40) fail('40 variantes maximum');
  const images = (Array.isArray(b.images) ? b.images : []).map((im: any) => ({ path: String(im?.path ?? ''), alt: cleanStr(im?.alt, 140), width: parseInt(im?.width, 10) || 0, height: parseInt(im?.height, 10) || 0 }));
  for (const im of images) if (!imgPathOk(ctx.tenant.slug, im.path)) fail('Image invalide, renvoyez-la');
  if (images.length > 12) fail('12 images maximum par produit');
  if (!update) await assertProductQuota(ctx);

  let id = id0, slug = ''; const toDelete: string[] = [];
  await (await db()).tx(async t => {
    if (update) {
      if (!await one('SELECT 1 FROM products WHERE id = $1 AND tenant_id = $2', [id, tid], t)) fail('Produit introuvable', 404);
      slug = await uniqueSlug(tid, String(b.slug || '') || name, 'products', id, t);
      await exec('UPDATE products SET slug=$1, name=$2, description=$3, price=$4, compare_price=$5, sku=$6, category_id=$7, status=$8, is_new=$9, featured=$10, track_stock=$11, stock=$12, updated_at=(now() AT TIME ZONE \'utc\') WHERE id=$13 AND tenant_id=$14',
        [slug, name, desc, price, compare, sku, catId, status, !!b.is_new, !!b.featured, track, stock, id, tid], t);
    } else {
      slug = await uniqueSlug(tid, name, 'products', null, t);
      id = (await one('INSERT INTO products (tenant_id, slug, name, description, price, compare_price, sku, category_id, status, is_new, featured, track_stock, stock) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id',
        [tid, slug, name, desc, price, compare, sku, catId, status, !!b.is_new, !!b.featured, track, stock], t))!.id;
    }
    const keep: number[] = [];
    for (const [pos, v] of variants.entries()) {
      if (v.id && await one('SELECT 1 FROM product_variants WHERE id = $1 AND product_id = $2', [v.id, id], t)) {
        await exec('UPDATE product_variants SET label=$1, sku=$2, price=$3, stock=$4, position=$5, active=$6 WHERE id=$7 AND product_id=$8', [v.label, v.sku, v.price, v.stock, pos, v.active, v.id, id], t); keep.push(v.id);
      } else keep.push((await one('INSERT INTO product_variants (tenant_id, product_id, label, sku, price, stock, position, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id', [tid, id, v.label, v.sku, v.price, v.stock, pos, v.active], t))!.id);
    }
    await exec('DELETE FROM product_variants WHERE product_id = $1 AND NOT (id = ANY($2::int[]))', [id, keep], t);
    const cur = await rows('SELECT id, path, thumb FROM product_images WHERE product_id = $1', [id], t);
    const newPaths = new Set(images.map((i: any) => i.path));
    for (const r of cur) if (!newPaths.has(r.path)) { await exec('DELETE FROM product_images WHERE id = $1', [r.id], t); toDelete.push(r.path, r.thumb); }
    const have = new Set(cur.map(r => r.path));
    for (const [pos, im] of images.entries()) {
      if (have.has(im.path)) await exec('UPDATE product_images SET position=$1, alt=$2 WHERE product_id=$3 AND path=$4', [pos, im.alt, id, im.path], t);
      else await exec('INSERT INTO product_images (tenant_id, product_id, path, thumb, width, height, alt, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [tid, id, im.path, thumbOf(im.path), im.width, im.height, im.alt, pos], t);
    }
  });
  await deleteObjects(toDelete);
  await audit(ctx, update ? 'product_update' : 'product_create', 'product', id, name);
  return ctx.json({ id, slug }, update ? 200 : 201);
}

export async function adminProductDelete(ctx: Ctx) {
  const id = ctx.qint('id'), tid = ctx.tenant.id;
  const name = await val<string>('SELECT name FROM products WHERE id = $1 AND tenant_id = $2', [id, tid]);
  if (name === undefined) fail('Produit introuvable', 404);
  const files = await rows('SELECT path, thumb FROM product_images WHERE product_id = $1', [id]);
  await exec('DELETE FROM products WHERE id = $1 AND tenant_id = $2', [id, tid]);
  await deleteObjects(files.flatMap(f => [f.path, f.thumb]));
  await audit(ctx, 'product_delete', 'product', id, name!);
  return ctx.json({ ok: true });
}

export async function adminProductDuplicate(ctx: Ctx) {
  const id = parseInt((await ctx.body()).id, 10) || 0, tid = ctx.tenant.id;
  const p = await one('SELECT * FROM products WHERE id = $1 AND tenant_id = $2', [id, tid]);
  if (!p) fail('Produit introuvable', 404);
  await assertProductQuota(ctx);
  const name = p.name.slice(0, 130) + ' (copie)';
  const nid = await (await db()).tx(async t => {
    const nid: number = (await one(`INSERT INTO products (tenant_id, slug, name, description, price, compare_price, sku, category_id, status, is_new, featured, track_stock, stock)
      VALUES ($1,$2,$3,$4,$5,$6,'',$7,'draft',$8,FALSE,$9,$10) RETURNING id`, [tid, await uniqueSlug(tid, name, 'products', null, t), name, p.description, p.price, p.compare_price, p.category_id, p.is_new, p.track_stock, p.stock], t))!.id;
    const d = new Date().toISOString();
    for (const [i, im] of (await rows('SELECT * FROM product_images WHERE product_id = $1 ORDER BY position, id', [id], t)).entries()) {
      const nn = `${d.slice(2, 4)}${d.slice(5, 7)}-${randHex(8)}.webp`, np = `${ctx.tenant.slug}/products/${nn}`, nt = `${ctx.tenant.slug}/thumbs/${nn}`;
      await copyObject(im.path, np).catch(() => {}); await copyObject(im.thumb, nt).catch(() => {});
      await exec('INSERT INTO product_images (tenant_id, product_id, path, thumb, width, height, alt, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [tid, nid, np, nt, im.width, im.height, im.alt, i], t);
    }
    for (const [i, v] of (await rows('SELECT * FROM product_variants WHERE product_id = $1 ORDER BY position, id', [id], t)).entries())
      await exec('INSERT INTO product_variants (tenant_id, product_id, label, sku, price, stock, position, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [tid, nid, v.label, '', v.price, v.stock, i, v.active], t);
    return nid;
  });
  await audit(ctx, 'product_duplicate', 'product', nid, `copie de #${id}`);
  return ctx.json({ id: nid }, 201);
}

export async function adminProductBulk(ctx: Ctx) {
  const b = await ctx.body(), tid = ctx.tenant.id;
  let ids: number[] = [...new Set<number>((Array.isArray(b.ids) ? b.ids : []).map((x: any) => parseInt(x, 10)).filter(Boolean))];
  if (!ids.length) fail('Aucun produit sélectionné');
  const U = "updated_at = (now() AT TIME ZONE 'utc')";
  switch (b.action) {
    case 'activate': case 'draft': case 'archive': {
      const s = { activate: 'active', draft: 'draft', archive: 'archived' }[b.action as 'activate'];
      await exec(`UPDATE products SET status = $1, ${U} WHERE tenant_id = $2 AND id = ANY($3::int[])`, [s, tid, ids]); break;
    }
    case 'category': {
      const cat = b.category_id ? parseInt(b.category_id, 10) : null;
      if (cat && !await one('SELECT 1 FROM categories WHERE id = $1 AND tenant_id = $2', [cat, tid])) fail('Catégorie inconnue');
      await exec(`UPDATE products SET category_id = $1, ${U} WHERE tenant_id = $2 AND id = ANY($3::int[])`, [cat, tid, ids]); break;
    }
    case 'merge': {
      if (ids.length < 2) fail('Sélectionnez au moins 2 produits à fusionner');
      // chaque identifiant doit être un produit de CETTE boutique (sinon on pourrait rattacher des images à la boutique d'un autre)
      const mine = await val<number>('SELECT COUNT(*)::int FROM products WHERE tenant_id = $1 AND id = ANY($2::int[])', [tid, ids]) ?? 0;
      if (mine !== ids.length) fail('Produit introuvable', 404);
      ids.sort((a, c) => a - c); const keep = ids.shift()!; const drop: string[] = [];
      await (await db()).tx(async t => {
        let n = await val<number>('SELECT COUNT(*)::int FROM product_images WHERE product_id = $1 AND tenant_id = $2', [keep, tid], t) ?? 0;
        let pos = await val<number>('SELECT COALESCE(MAX(position),-1)+1 FROM product_images WHERE product_id = $1', [keep], t) ?? 0;
        for (const im of await rows('SELECT id, path, thumb FROM product_images WHERE tenant_id = $1 AND product_id = ANY($2::int[]) ORDER BY product_id, position, id', [tid, ids], t)) {
          if (n >= 12) { drop.push(im.path, im.thumb); await exec('DELETE FROM product_images WHERE id = $1', [im.id], t); continue; }
          await exec('UPDATE product_images SET product_id = $1, position = $2 WHERE id = $3', [keep, pos++, im.id], t); n++;
        }
        await exec('DELETE FROM products WHERE tenant_id = $1 AND id = ANY($2::int[])', [tid, ids], t);
      });
      await deleteObjects(drop);
      await audit(ctx, 'product_merge', 'product', keep, `fusion de ${ids.length + 1} produits`);
      return ctx.json({ ok: true, id: keep, count: ids.length + 1 });
    }
    case 'delete': {
      const files = await rows('SELECT path, thumb FROM product_images WHERE tenant_id = $1 AND product_id = ANY($2::int[])', [tid, ids]);
      await exec('DELETE FROM products WHERE tenant_id = $1 AND id = ANY($2::int[])', [tid, ids]);
      await deleteObjects(files.flatMap(f => [f.path, f.thumb])); break;
    }
    default: fail('Action inconnue');
  }
  await audit(ctx, 'product_bulk_' + b.action, 'product', null, `${ids.length} produit(s)`);
  return ctx.json({ ok: true, count: ids.length });
}

export async function adminProductStock(ctx: Ctx) {
  const b = await ctx.body(), tid = ctx.tenant.id, pid = parseInt(b.id, 10) || 0, vid = parseInt(b.variant_id, 10) || 0;
  const cur = vid ? await val<number>('SELECT stock FROM product_variants WHERE id = $1 AND product_id = $2 AND tenant_id = $3', [vid, pid, tid])
    : await val<number>('SELECT stock FROM products WHERE id = $1 AND tenant_id = $2', [pid, tid]);
  if (cur === undefined) fail('Introuvable', 404);
  const nw = Math.max(0, b.set !== undefined && b.set !== null ? parseInt(b.set, 10) || 0 : cur! + (parseInt(b.delta, 10) || 0));
  await exec(`UPDATE ${vid ? 'product_variants' : 'products'} SET stock = $1 WHERE id = $2 AND tenant_id = $3`, [nw, vid || pid, tid]);
  if (!vid) await exec('UPDATE products SET track_stock = TRUE WHERE id = $1 AND tenant_id = $2', [pid, tid]);
  await audit(ctx, 'stock_update', 'product', pid, `${cur} → ${nw}`);
  return ctx.json({ stock: nw });
}

export async function adminUpload(ctx: Ctx) {
  let form: FormData;
  try { form = await ctx.req.formData(); } catch { return fail('Aucun fichier reçu (champ « image »)'); }
  const f = form.get('image');
  if (!f || typeof f === 'string') fail('Aucun fichier reçu (champ « image »)');
  const file = f as File;
  if (file.size > 8 * 1024 * 1024) fail('Image trop lourde (8 Mo maximum)', 413);
  const buf = Buffer.from(await file.arrayBuffer());
  if (ctx.q('kind') === 'logo') {
    const { path } = await processLogo(buf, ctx.tenant.slug);
    const old = (await ctx.settings()).logo_url;
    await saveSetting(ctx.tenant.id, 'logo_url', path);
    if (old && old.startsWith(ctx.tenant.slug + '/')) await deleteObjects([old]);
    await audit(ctx, 'logo_update', 'settings');
    return ctx.json({ path, url: assetUrl(path) }, 201);
  }
  const r = await processProductImage(buf, ctx.tenant.slug);
  return ctx.json({ ...r, url: assetUrl(r.path), thumb_url: assetUrl(r.thumb) }, 201);
}

// ── Catégories ────────────────────────────────────────────
export async function adminCategories(ctx: Ctx) {
  const r = await rows('SELECT c.id, c.name, c.slug, c.icon, c.position, (SELECT COUNT(*)::int FROM products p WHERE p.category_id = c.id) AS products FROM categories c WHERE c.tenant_id = $1 ORDER BY c.position, lower(c.name)', [ctx.tenant.id]);
  return ctx.json({ categories: r });
}
export async function adminCategorySave(ctx: Ctx, update: boolean) {
  const b = await ctx.body(), tid = ctx.tenant.id; let id = update ? ctx.qint('id') : 0;
  const name = cleanStr(b.name, 60); if (!name) fail('Le nom est obligatoire');
  const slug = await uniqueSlug(tid, String(b.slug || '') || name, 'categories', id || null);
  const icon = cleanStr(b.icon, 8), pos = parseInt(b.position, 10) || 0;
  if (id) { if (!await exec('UPDATE categories SET name=$1, slug=$2, icon=$3, position=$4 WHERE id=$5 AND tenant_id=$6', [name, slug, icon, pos, id, tid])) fail('Catégorie introuvable', 404); }
  else id = (await one('INSERT INTO categories (tenant_id, name, slug, icon, position) VALUES ($1,$2,$3,$4,$5) RETURNING id', [tid, name, slug, icon, pos]))!.id;
  await audit(ctx, update ? 'category_save' : 'category_create', 'category', id, name);
  return ctx.json({ id, slug }, 201);
}
export async function adminCategoryDelete(ctx: Ctx) {
  const id = ctx.qint('id'); await exec('DELETE FROM categories WHERE id = $1 AND tenant_id = $2', [id, ctx.tenant.id]);
  await audit(ctx, 'category_delete', 'category', id); return ctx.json({ ok: true });
}

// ── Promotions ────────────────────────────────────────────
const promoRow = (r: any) => ({ id: r.id, code: r.code, type: r.type, value: r.value, min_order: r.min_order, max_uses: r.max_uses ?? null, used: r.used, starts_at: r.starts_at, expires_at: r.expires_at, active: !!r.active });
export async function adminPromos(ctx: Ctx) { return ctx.json({ promos: (await rows('SELECT * FROM promo_codes WHERE tenant_id = $1 ORDER BY id DESC', [ctx.tenant.id])).map(promoRow) }); }
export async function adminPromoSave(ctx: Ctx, update: boolean) {
  const b = await ctx.body(), tid = ctx.tenant.id; let id = update ? ctx.qint('id') : 0;
  const code = String(b.code ?? '').replace(/[^A-Za-z0-9_-]/g, '').toUpperCase();
  if (code.length < 3 || code.length > 30) fail('Code : 3 à 30 caractères (lettres, chiffres, - _)');
  const type = b.type === 'fixed' ? 'fixed' : 'percent', value = parseInt(b.value, 10) || 0;
  if (value < 1 || (type === 'percent' && value > 100)) fail('Valeur invalide');
  const date = (v: any, endOfDay = false) => { v = String(v ?? '').trim(); if (!v) return null; const d = new Date(v.length <= 10 ? v + 'T00:00:00Z' : v.replace(' ', 'T') + 'Z'); if (isNaN(+d)) fail('Date invalide'); return v.length <= 10 ? `${v} ${endOfDay ? '23:59:59' : '00:00:00'}` : d.toISOString().slice(0, 19).replace('T', ' '); };
  const starts = date(b.starts_at), exp = date(b.expires_at, true);
  const mx = intOrNull(b.max_uses), args = [code, type, value, Math.max(0, parseInt(b.min_order, 10) || 0), mx === null ? null : Math.max(1, mx), starts, exp, !!b.active];
  try {
    if (id) { if (!await exec('UPDATE promo_codes SET code=$1, type=$2, value=$3, min_order=$4, max_uses=$5, starts_at=$6, expires_at=$7, active=$8 WHERE id=$9 AND tenant_id=$10', [...args, id, tid])) fail('Code introuvable', 404); }
    else id = (await one('INSERT INTO promo_codes (code, type, value, min_order, max_uses, starts_at, expires_at, active, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id', [...args, tid]))!.id;
  } catch (e: any) { if (/unique|duplicate/i.test(e.message)) fail('Ce code existe déjà'); throw e; }
  await audit(ctx, 'promo_save', 'promo', id, code);
  return ctx.json({ id }, 201);
}
export async function adminPromoDelete(ctx: Ctx) { const id = ctx.qint('id'); await exec('DELETE FROM promo_codes WHERE id = $1 AND tenant_id = $2', [id, ctx.tenant.id]); await audit(ctx, 'promo_delete', 'promo', id); return ctx.json({ ok: true }); }

// ── Clients ───────────────────────────────────────────────
const customersSql = (q: string, tid: number, limit?: number) => {
  const p = new Q(); const w = [`c.tenant_id = ${p.add(tid)}`];
  if (q) { const l = p.add('%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%'); w.push(`(c.name ILIKE ${l} OR c.phone ILIKE ${l})`); }
  return { sql: `SELECT c.*, COUNT(o.id)::int AS orders, COALESCE(SUM(CASE WHEN o.status <> 'cancelled' THEN o.total END),0)::int AS spent, MAX(o.created_at) AS last_order
    FROM customers c LEFT JOIN orders o ON o.customer_id = c.id WHERE ${w.join(' AND ')} GROUP BY c.id ORDER BY MAX(o.created_at) DESC NULLS LAST, c.id DESC${limit ? ' LIMIT ' + limit : ''}`, params: p.params };
};
export async function adminCustomers(ctx: Ctx) {
  const { sql, params } = customersSql(ctx.q('q').trim(), ctx.tenant.id, 500);
  return ctx.json({ customers: (await rows(sql, params)).map(r => ({ id: r.id, name: r.name, phone: r.phone, email: r.email, address: r.address, notes: r.notes, orders: r.orders, spent: r.spent, last_order: r.last_order, created_at: r.created_at })) });
}
export async function adminCustomerUpdate(ctx: Ctx) {
  const b = await ctx.body();
  await exec('UPDATE customers SET name=$1, email=$2, address=$3, notes=$4 WHERE id=$5 AND tenant_id=$6', [cleanStr(b.name, 80), cleanStr(b.email, 120), cleanStr(b.address, 300), cleanStr(b.notes, 1000), ctx.qint('id'), ctx.tenant.id]);
  return ctx.json({ ok: true });
}
export async function adminCustomersExport(ctx: Ctx) {
  const { sql, params } = customersSql('', ctx.tenant.id);
  return csvResponse(`clients-${dateStr(new Date())}.csv`, ['Nom', 'Téléphone', 'Email', 'Adresse', 'Commandes', 'Total dépensé (FCFA)', 'Dernière commande', 'Notes'],
    (await rows(sql, params)).map(r => [r.name, r.phone, r.email, r.address, r.orders, r.spent, r.last_order, r.notes]));
}

// ── Paramètres, utilisateurs, journal, sauvegarde ─────────
const settingsForAdmin = (s: Settings) => ({ ...s, logo_path: s.logo_url, logo_url: assetUrl(s.logo_url) ?? '' });
export async function adminSettingsGet(ctx: Ctx) { return ctx.json({ settings: settingsForAdmin(await ctx.settings()) }); }
export async function adminSettingsSave(ctx: Ctx) {
  const b = await ctx.body(), changed: string[] = [];
  for (const [k, raw] of Object.entries(b)) {
    if (!(k in SETTING_DEFAULTS) || k === 'logo_url') continue;
    let v = cleanStr(raw, LONG_SETTINGS.includes(k) ? 2000 : 300);
    if (['delivery_fee', 'free_delivery_min', 'low_stock_threshold'].includes(k)) v = String(Math.max(0, parseInt(v, 10) || 0));
    if (k === 'whatsapp') { v = normalizePhone(v); if (v.length < 8) fail('Numéro WhatsApp invalide (format international, ex. 22670123456)'); }
    if (k === 'pickup_enabled') v = v === '1' || v === 'true' ? '1' : '0';
    if (k === 'order_prefix') v = v.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'CMD';
    if (k === 'primary_color' && !isHex(v)) fail('Couleur invalide (ex. #D91B1B)');
    if (['facebook', 'instagram', 'tiktok'].includes(k) && v && !safeHttpUrl(v)) fail('Lien invalide : saisissez une adresse complète commençant par https:// (ex. https://instagram.com/maboutique)');
    if (['facebook', 'instagram', 'tiktok'].includes(k) && v) v = safeHttpUrl(v)!;
    if (k === 'google_verification') { v = v.replace(/^.*content=["']?([\w-]+).*$/, '$1').trim(); if (v && !/^[\w-]{10,100}$/.test(v)) fail('Code Google invalide : collez uniquement le code de vérification'); }
    if (k === 'ga4_id') { v = v.trim().toUpperCase(); if (v && !/^G-[A-Z0-9]{6,14}$/.test(v)) fail('ID Google Analytics invalide (format G-XXXXXXXXXX)'); }
    if (k === 'meta_pixel_id') { v = v.trim(); if (v && !/^\d{8,20}$/.test(v)) fail('ID Pixel Meta invalide (chiffres uniquement)'); }
    if (k === 'email' && v && !/^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(v)) fail('Email invalide');
    await saveSetting(ctx.tenant.id, k, v); changed.push(k);
  }
  if (b.remove_logo) { const old = (await ctx.settings()).logo_url; await saveSetting(ctx.tenant.id, 'logo_url', ''); if (old) await deleteObjects([old]); changed.push('logo'); }
  await audit(ctx, 'settings_update', 'settings', null, changed.join(', '));
  return ctx.json({ settings: settingsForAdmin(await loadSettings(ctx.tenant.id)) });
}

const userRow = (r: any) => ({ id: r.id, username: r.username, name: r.name, role: r.role, active: !!r.active, last_login_at: r.last_login_at, created_at: r.created_at });
export async function adminUsers(ctx: Ctx) { return ctx.json({ users: (await rows('SELECT * FROM users WHERE tenant_id = $1 ORDER BY id', [ctx.tenant.id])).map(userRow), max_users: ctx.tenant.max_users }); }
export async function adminUserSave(ctx: Ctx, update: boolean) {
  const b = await ctx.body(), tid = ctx.tenant.id, me = ctx.user!; let id = update ? ctx.qint('id') : 0;
  const role = b.role === 'admin' ? 'admin' : 'manager', active = !!b.active, name = cleanStr(b.name, 80);
  await (await db()).tx(async t => {
    if (id) {
      if (id === me.id && (!active || role !== 'admin')) fail('Vous ne pouvez pas retirer vos propres droits');
      const u = await one('SELECT username FROM users WHERE id = $1 AND tenant_id = $2', [id, tid], t); if (!u) fail('Utilisateur introuvable', 404);
      await exec('UPDATE users SET name=$1, role=$2, active=$3 WHERE id=$4 AND tenant_id=$5', [name, role, active, id, tid], t);
      if (b.password) { const pb = passwordProblem(String(b.password), u!.username); if (pb) fail(pb); await exec('UPDATE users SET password_hash=$1, must_change_password=TRUE WHERE id=$2', [await bcrypt.hash(String(b.password), BCRYPT_COST), id], t); }
    } else {
      const n = await val<number>('SELECT COUNT(*)::int FROM users WHERE tenant_id = $1', [tid], t) ?? 0;
      if (n >= ctx.tenant.max_users) fail(`Limite de votre offre atteinte (${ctx.tenant.max_users} utilisateurs).`, 402);
      const un = String(b.username ?? '').replace(/[^a-z0-9._-]/gi, '').toLowerCase();
      if (un.length < 3) fail('Identifiant : 3 caractères minimum');
      const pb = passwordProblem(String(b.password ?? ''), un); if (pb) fail(pb);
      if (await one('SELECT 1 FROM users WHERE tenant_id = $1 AND lower(username) = $2', [tid, un], t)) fail('Cet identifiant existe déjà');
      id = (await one('INSERT INTO users (tenant_id, username, name, password_hash, role, active, must_change_password) VALUES ($1,$2,$3,$4,$5,$6,TRUE) RETURNING id', [tid, un, name, await bcrypt.hash(String(b.password), BCRYPT_COST), role, active], t))!.id;
    }
    if ((await val<number>("SELECT COUNT(*)::int FROM users WHERE tenant_id = $1 AND role = 'admin' AND active", [tid], t) ?? 0) < 1) fail('Il doit rester au moins un administrateur actif');
  });
  await audit(ctx, 'user_save', 'user', id);
  return ctx.json({ id }, 201);
}
export async function adminUserDelete(ctx: Ctx) {
  const id = ctx.qint('id'); if (id === ctx.user!.id) fail('Vous ne pouvez pas supprimer votre propre compte');
  await exec('DELETE FROM users WHERE id = $1 AND tenant_id = $2', [id, ctx.tenant.id]);
  await audit(ctx, 'user_delete', 'user', id); return ctx.json({ ok: true });
}
export async function adminActivity(ctx: Ctx) {
  return ctx.json({ activity: await rows('SELECT id, username, action, entity, entity_id, detail, ip, created_at FROM audit_log WHERE tenant_id = $1 ORDER BY id DESC LIMIT 200', [ctx.tenant.id]) });
}
/** Sauvegarde JSON complète des données de CETTE boutique. */
export async function adminBackup(ctx: Ctx) {
  const tid = ctx.tenant.id, data: Record<string, unknown> = { exported_at: new Date().toISOString(), tenant: { slug: ctx.tenant.slug, name: ctx.tenant.name } };
  for (const t of ['categories', 'products', 'product_images', 'product_variants', 'customers', 'promo_codes', 'orders', 'order_items', 'order_events', 'settings'])
    data[t] = await rows(`SELECT * FROM ${t} WHERE tenant_id = $1`, [tid]);
  data.users = await rows('SELECT id, username, name, role, active, created_at FROM users WHERE tenant_id = $1', [tid]);
  await audit(ctx, 'backup', 'database');
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${ctx.tenant.slug}-${dateStr(new Date())}.json"`, 'Cache-Control': 'no-store' } });
}

// ── Abonnement (paiement Chariow) ─────────────────────────
export async function adminBilling(ctx: Ctx) {
  const t = ctx.tenant, today = new Date().toISOString().slice(0, 10), s = await ctx.settings();
  return ctx.json({ plan: t.plan, paid_until: t.paid_until, expired: !!t.paid_until && t.paid_until < today, grace: !!t.grace, can_pay: billingEnabled(), options: billingPlans().map(({ id, ...o }) => ({ key: id, ...o })),
    defaults: { email: s.email, whatsapp: s.whatsapp }, payments: await recentPayments(t.id) });
}
export async function adminBillingCheckout(ctx: Ctx) {
  if (!billingEnabled()) fail("Le paiement en ligne n'est pas encore activé. Contactez-nous.", 503);
  if (!await rateLimit(`bill:${ctx.tenant.id}`, 10, 3600)) fail('Trop de tentatives, réessayez plus tard.', 429);
  const b = await ctx.body(), plan = billingPlans().find(p => p.id === String(b.key));
  if (!plan) return fail('Formule inconnue');
  const email = cleanStr(b.email, 255).toLowerCase(), first = cleanStr(b.first_name, 50), last = cleanStr(b.last_name, 50);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('Email invalide');
  if (!first || !last) fail('Prénom et nom obligatoires');
  const phone = splitPhone(normalizePhone(cleanStr(b.phone, 30)));
  if (!phone) fail('Téléphone invalide (format international, ex. 22670123456)');
  try {
    const url = await startCheckout({ plan, tenantId: ctx.tenant.id, slug: ctx.tenant.slug, email, firstName: first, lastName: last, phone: phone!, redirectUrl: `${originOf(ctx)}/admin/#/settings`, ip: ctx.ip });
    await audit(ctx, 'billing_checkout', 'tenant', ctx.tenant.id, plan.label);
    return ctx.json({ checkout_url: url });
  } catch (e: any) { return fail(e.message, 502); }
}
