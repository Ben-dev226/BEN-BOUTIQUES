import bcrypt from 'bcryptjs';
import { db, rows, one, val, exec, type Db } from '../db';
import { Ctx, fail, rateLimit, requireLogin, signSession, sessionCookie, clearCookie, passwordProblem, audit, verifySession, cookieFrom, pwFingerprint, trackKey, BCRYPT_COST, dummyHash } from './ctx';
import { PRODUCT_SELECT, formatProduct, productImages, productVariants, productFilters, productOrderSql, evaluatePromo, deliveryFeeFor, generateOrderNumber,
  orderWhatsappMessage, orderEvent, applyOrderStock, ORDER_STATUSES, originOf } from '../catalog';
import { publicSettings } from '../settings';
import { assetUrl } from '../storage';
import { logSecurity, logWarn } from '../log';
import { cleanStr, normalizePhone, randHex, renderRich } from '../util';

const PAGE_SIZE = Number(process.env.PAGE_SIZE || 12);

export async function apiSettings(ctx: Ctx) {
  ctx.headersOut.set('Cache-Control', 'public, max-age=30');
  const s = publicSettings(await ctx.settings());
  return ctx.json({ ...s, logo_url: assetUrl(s.logo_url) ?? '' });
}

export async function apiCategories(ctx: Ctx) {
  const r = await rows(`SELECT c.id, c.name, c.slug, c.icon, (SELECT COUNT(*)::int FROM products p WHERE p.category_id = c.id AND p.status = 'active') AS count
    FROM categories c WHERE c.tenant_id = $1 ORDER BY c.position, lower(c.name)`, [ctx.tenant.id]);
  return ctx.json({ categories: r });
}

export async function listProducts(ctx: Ctx, admin: boolean, size: number, defaultSort: string) {
  const s = await ctx.settings();
  const page = Math.max(1, ctx.qint('page', 1));
  const { where, q } = productFilters(ctx.tenant.id, ctx.query as Record<string, string>, admin, Number(s.low_stock_threshold));
  const total = await val<number>(`SELECT COUNT(*)::int FROM products p LEFT JOIN categories c ON c.id = p.category_id${where}`, q.params) ?? 0;
  const lim = q.add(size), off = q.add((page - 1) * size);
  const r = await rows(`${PRODUCT_SELECT}${where} ORDER BY ${productOrderSql(ctx.q('sort', defaultSort))} LIMIT ${lim} OFFSET ${off}`, q.params);
  return { products: r.map(x => formatProduct(x, s, admin)), total, page, page_size: size, pages: Math.ceil(total / size) };
}
export async function apiProducts(ctx: Ctx) { return ctx.json(await listProducts(ctx, false, PAGE_SIZE, '')); }

/** Détail complet (API + page serveur). */
export async function loadProductDetail(tenantId: number, s: Record<string, string>, by: { slug?: string; id?: number }, allowInactive = false) {
  const r = await one(`${PRODUCT_SELECT} WHERE p.tenant_id = $1 AND ${by.slug ? 'p.slug = $2' : 'p.id = $2'}`, [tenantId, by.slug ?? by.id]);
  if (!r || (!allowInactive && r.status !== 'active')) return null;
  const p: any = formatProduct(r, s);
  p.description = r.description; p.description_html = renderRich(r.description); p.sku = r.sku; p.status = r.status;
  p.images = await productImages(r.id, tenantId);
  p.variants = (await productVariants(r.id, tenantId)).map(v => ({ id: v.id, label: v.label, price: v.price ?? r.price, in_stock: !r.track_stock || v.stock > 0, stock_qty: r.track_stock ? v.stock : null }));
  const rel = await rows(`${PRODUCT_SELECT} WHERE p.tenant_id = $1 AND p.status = 'active' AND p.id <> $2 AND p.category_id IS NOT DISTINCT FROM $3 ORDER BY p.featured DESC, p.id DESC LIMIT 4`, [tenantId, r.id, r.category_id]);
  p.related = rel.map(x => formatProduct(x, s));
  return p;
}
export const isBot = (ua: string) => /bot|crawl|spider|preview|whatsapp|facebookexternalhit/i.test(ua);
export async function countView(tenantId: number, id: number) { await exec('UPDATE products SET views = views + 1 WHERE id = $1 AND tenant_id = $2', [id, tenantId]); }

export async function apiProduct(ctx: Ctx) {
  const slug = cleanStr(ctx.q('slug'), 160), id = ctx.qint('id');
  if (!slug && !id) fail('Produit non précisé');
  const p = await loadProductDetail(ctx.tenant.id, await ctx.settings(), slug ? { slug } : { id });
  if (!p) fail('Produit introuvable', 404);
  if (!isBot(ctx.req.headers.get('user-agent') || '') && !cookieFrom(ctx.req.headers.get('cookie'))) await countView(ctx.tenant.id, p.id);
  return ctx.json(p);
}

// ── Panier ────────────────────────────────────────────────
export type Line = { key: string; product_id: number; variant_id: number | null; name: string; variant_label: string; unit_price: number; qty: number; image: string | null; image_path: string; slug: string; max: number | null };

/** Valide des lignes {id, variant_id?, qty} : prix et stock lus en base, jamais fournis par le client. */
export async function resolveCartLines(tenantId: number, items: any[], strict: boolean, t?: Db) {
  if (!Array.isArray(items) || !items.length) fail('Votre panier est vide');
  if (items.length > 50) fail('Panier trop volumineux');
  const lines = new Map<string, Line>(); const issues: any[] = [];
  for (const it of items) {
    const pid = parseInt(it?.id, 10) || 0, vid = parseInt(it?.variant_id, 10) || 0;
    let qty = Math.max(1, Math.min(99, parseInt(it?.qty, 10) || 1));
    const key = `${pid}:${vid}`;
    const p = await one(`${PRODUCT_SELECT} WHERE p.tenant_id = $1 AND p.id = $2`, [tenantId, pid], t);
    if (!p || p.status !== 'active') { issues.push({ key, id: pid, variant_id: vid, problem: 'Produit indisponible', remove: true }); continue; }
    const tracked = !!p.track_stock;
    let price = p.price, label = '', avail = tracked ? p.stock : Infinity, realVid: number | null = null;
    if (p.variant_count > 0) {
      const v = await one('SELECT * FROM product_variants WHERE id = $1 AND product_id = $2 AND tenant_id = $3 AND active', [vid, pid, tenantId], t);
      if (!v) { issues.push({ key, id: pid, variant_id: vid, name: p.name, problem: `Choisissez une option pour « ${p.name} »`, remove: true }); continue; }
      label = v.label; realVid = v.id; if (v.price !== null) price = v.price; avail = tracked ? v.stock : Infinity;
    }
    if (qty > avail) {
      issues.push({ key, id: pid, variant_id: vid, name: p.name, problem: `${avail <= 0 ? 'Épuisé' : `Stock limité à ${avail}`} : « ${p.name}${label ? ` (${label})` : ''} »`, max: Math.max(0, avail), remove: avail <= 0 });
      if (avail <= 0) continue;
      qty = avail;
    }
    const ex = lines.get(key);
    if (ex) { ex.qty = Math.min(99, ex.qty + qty); continue; }
    lines.set(key, { key, product_id: pid, variant_id: realVid, name: p.name, variant_label: label, unit_price: price, qty, image: assetUrl(p.thumb), image_path: p.thumb ?? '', slug: p.slug, max: tracked ? avail : null });
  }
  if (strict && issues.length) fail(issues[0].problem, 409, { issues });
  return { lines: [...lines.values()], issues };
}

export async function apiCartRefresh(ctx: Ctx) {
  const { lines, issues } = await resolveCartLines(ctx.tenant.id, (await ctx.body()).items, false);
  return ctx.json({ lines: lines.map(({ image_path, ...l }) => l), issues, subtotal: lines.reduce((a, l) => a + l.unit_price * l.qty, 0) });
}

export async function apiPromoCheck(ctx: Ctx) {
  if (!await rateLimit(`promo:${ctx.tenant.id}:${ctx.ip}`, 20, 600)) fail("Trop d'essais, réessayez plus tard", 429);
  const b = await ctx.body();
  const { lines } = await resolveCartLines(ctx.tenant.id, b.items, false);
  const sub = lines.reduce((a, l) => a + l.unit_price * l.qty, 0);
  const { promo, discount } = await evaluatePromo(ctx.tenant.id, cleanStr(b.code, 40), sub);
  return ctx.json({ code: promo.code, type: promo.type, value: promo.value, discount });
}

export async function apiOrderCreate(ctx: Ctx) {
  const b = await ctx.body();
  if (b.website) return ctx.json({ ok: true });                         // honeypot anti-bot
  if (!await rateLimit(`order:${ctx.tenant.id}:${ctx.ip}`, 6, 3600)) fail('Trop de commandes depuis cette connexion. Réessayez plus tard.', 429);
  const s = await ctx.settings();
  const name = cleanStr(b.name, 80), phone = normalizePhone(cleanStr(b.phone, 30)), addr = cleanStr(b.address, 300), note = cleanStr(b.note, 500);
  const mode = b.delivery_mode === 'pickup' && s.pickup_enabled === '1' ? 'pickup' : 'delivery';
  if (name.length < 2) fail('Indiquez votre nom');
  if (phone.length < 8 || phone.length > 15) fail('Numéro de téléphone invalide');
  if (mode === 'delivery' && addr.length < 3) fail('Indiquez votre quartier / adresse de livraison');
  const tid = ctx.tenant.id;

  const result = await (await db()).tx(async t => {
    const { lines } = await resolveCartLines(tid, b.items, true, t);
    const subtotal = lines.reduce((a, l) => a + l.unit_price * l.qty, 0);
    let discount = 0, promoCode = '';
    if (b.promo) {
      const r = await evaluatePromo(tid, cleanStr(b.promo, 40), subtotal, t);
      const n = await exec('UPDATE promo_codes SET used = used + 1 WHERE id = $1 AND (max_uses IS NULL OR used < max_uses)', [r.promo.id], t);
      if (!n) fail("Ce code a atteint sa limite d'utilisation");
      discount = r.discount; promoCode = r.promo.code;
    }
    const fee = deliveryFeeFor(s, mode, subtotal - discount), total = subtotal - discount + fee;
    const cid = (await one('INSERT INTO customers (tenant_id, name, phone, address) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, phone) DO UPDATE SET address = CASE WHEN customers.address = \'\' THEN excluded.address ELSE customers.address END RETURNING id',
      [tid, name, phone, addr], t))!.id;
    const number = await generateOrderNumber(tid, s.order_prefix, t);
    const oid = (await one(`INSERT INTO orders (tenant_id, number, customer_id, customer_name, customer_phone, customer_address, delivery_mode, note, subtotal, discount, delivery_fee, total, promo_code, ip)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`, [tid, number, cid, name, phone, mode === 'delivery' ? addr : '', mode, note, subtotal, discount, fee, total, promoCode, ctx.ip], t))!.id;
    for (const l of lines) await exec('INSERT INTO order_items (tenant_id, order_id, product_id, variant_id, name, variant_label, unit_price, qty, image) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [tid, oid, l.product_id, l.variant_id, l.name, l.variant_label, l.unit_price, l.qty, l.image_path], t);
    await applyOrderStock(t, tid, oid, -1);
    await orderEvent(t, tid, oid, 'client', 'created', 'Commande passée depuis la boutique');
    const order = (await one('SELECT * FROM orders WHERE id = $1', [oid], t))!;
    const items = await rows('SELECT * FROM order_items WHERE order_id = $1', [oid], t);
    return { order, items, subtotal, discount, fee };
  });

  const trackUrl = `${originOf(ctx)}/suivi?n=${encodeURIComponent(result.order.number)}&k=${trackKey(tid, result.order.number)}`;
  const msg = orderWhatsappMessage(result.order, result.items, s.shop_name, trackUrl);
  return ctx.json({
    order: { number: result.order.number, total: result.order.total, subtotal: result.subtotal, discount: result.discount, delivery_fee: result.fee },
    whatsapp_url: `https://wa.me/${normalizePhone(s.whatsapp)}?text=${encodeURIComponent(msg)}`, tracking_url: trackUrl,
  }, 201);
}

export async function apiOrderTrack(ctx: Ctx) {
  if (!await rateLimit(`track:${ctx.tenant.id}:${ctx.ip}`, 30, 600)) fail('Trop de recherches, réessayez plus tard', 429);
  const n = cleanStr(ctx.q('n'), 40).toUpperCase();
  const o = await one('SELECT * FROM orders WHERE tenant_id = $1 AND number = $2', [ctx.tenant.id, n]);
  const phone = normalizePhone(ctx.q('phone')), k = ctx.q('k');
  const keyOk = !!o && k.length === 20 && k === trackKey(ctx.tenant.id, o.number);
  // sans la clé du lien WhatsApp, le téléphone de la commande est OBLIGATOIRE (sinon un numéro deviné livrerait le contenu d'une commande)
  const phoneOk = !!o && phone.length >= 8 && phone.slice(-8) === o.customer_phone.slice(-8);
  if (!o || !(keyOk || phoneOk)) fail('Commande introuvable. Vérifiez le numéro et le téléphone utilisé pour commander.', 404);
  const items = await rows('SELECT name, variant_label, unit_price, qty FROM order_items WHERE order_id = $1', [o.id]);
  const events = await rows("SELECT type, created_at FROM order_events WHERE order_id = $1 AND type IN ('created','status') ORDER BY id", [o.id]);
  return ctx.json({ number: o.number, status: o.status, status_label: ORDER_STATUSES[o.status], payment_status: o.payment_status, created_at: o.created_at, total: o.total,
    delivery_mode: o.delivery_mode, name: o.customer_name.slice(0, 1) + '•••', items, events });
}

// ── Auth ──────────────────────────────────────────────────
export async function apiLogin(ctx: Ctx) {
  const b = await ctx.body(); const username = cleanStr(b.username, 60), password = String(b.password ?? '');
  const kIp = `login_ip:${ctx.tenant.id}:${ctx.ip}`, kU = `login_u:${ctx.tenant.id}:${username.toLowerCase()}:${ctx.ip}`, kG = `login_g:${ctx.tenant.id}:${username.toLowerCase()}`;
  // par IP (10), par compte depuis cette IP (5), et plafond global par compte (40) : un tiers ne peut pas verrouiller l'administrateur
  if (!await rateLimit(kIp, 10, 900, false) || !await rateLimit(kU, 5, 900, false) || !await rateLimit(kG, 40, 900, false)) { await logSecurity({ type: 'login_locked', tenantId: ctx.tenant.id, ip: ctx.ip, message: `Connexion bloquée (trop de tentatives) pour « ${username} »` }); fail('Trop de tentatives. Réessayez dans 15 minutes.', 429); }
  const u = await one('SELECT * FROM users WHERE tenant_id = $1 AND lower(username) = lower($2) AND active', [ctx.tenant.id, username]);
  const ok = await bcrypt.compare(password, u?.password_hash ?? dummyHash());
  if (!u || !ok) { await logWarn({ type: 'login_failed', tenantId: ctx.tenant.id, ip: ctx.ip, message: `Échec de connexion pour « ${username.slice(0, 40)} »` }); await rateLimit(kIp, 10, 900); await rateLimit(kU, 5, 900); await rateLimit(kG, 40, 900); fail('Identifiant ou mot de passe incorrect', 401); }
  const csrf = randHex(24);
  ctx.headersOut.append('Set-Cookie', sessionCookie(await signSession({ uid: u!.id, tid: ctx.tenant.id, csrf, pf: pwFingerprint(u!.password_hash) }), ctx.https, ctx.base));
  await exec('UPDATE users SET last_login_at = (now() AT TIME ZONE \'utc\') WHERE id = $1', [u!.id]);
  ctx.user = { id: u!.id, username: u!.username, name: u!.name, role: u!.role, must_change_password: u!.must_change_password, csrf };
  await audit(ctx, 'login', 'user', u!.id);
  return ctx.json({ id: u!.id, username: u!.username, name: u!.name, role: u!.role, must_change_password: u!.must_change_password, csrf });
}
export async function apiLogout(ctx: Ctx) { ctx.headersOut.append('Set-Cookie', clearCookie(ctx.https, ctx.base)); return ctx.json({ ok: true }); }
export async function apiMe(ctx: Ctx) {
  const { sessionUserFromCookieHeader } = await import('./ctx');
  const u = await sessionUserFromCookieHeader(ctx.req.headers.get('cookie'), ctx.tenant);
  if (!u) return ctx.json({ user: null });
  return ctx.json({ user: { id: u.id, username: u.username, name: u.name, role: u.role, must_change_password: u.must_change_password }, csrf: u.csrf });
}
export async function apiChangePassword(ctx: Ctx) {
  const u = await requireLogin(ctx, undefined, true);
  const b = await ctx.body();
  const row = await one('SELECT password_hash FROM users WHERE id = $1', [u.id]);
  if (!(await bcrypt.compare(String(b.current ?? ''), row!.password_hash))) fail('Mot de passe actuel incorrect', 403);
  const nw = String(b.new ?? '');
  const pb = passwordProblem(nw, u.username); if (pb) fail(pb);
  if (nw === b.current) fail('Le nouveau mot de passe doit être différent');
  const newHash = await bcrypt.hash(nw, BCRYPT_COST);
  await exec('UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2', [newHash, u.id]);
  // toutes les autres sessions de cet utilisateur sont invalidées ; celle-ci est renouvelée
  ctx.headersOut.append('Set-Cookie', sessionCookie(await signSession({ uid: u.id, tid: ctx.tenant.id, csrf: u.csrf, pf: pwFingerprint(newHash) }), ctx.https, ctx.base));
  await audit(ctx, 'password_change', 'user', u.id);
  return ctx.json({ ok: true });
}
export { verifySession };
