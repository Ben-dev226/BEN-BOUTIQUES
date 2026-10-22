import './_env';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { arg } from './_env';
import { db, one, exec, closeDb } from '../lib/db';
import { tenantBySlug } from '../lib/tenant';
import { saveSetting, SETTING_DEFAULTS } from '../lib/settings';
import { putObject } from '../lib/storage';

/**
 * Importe une boutique de la version PHP/SQLite (catalogue, catégories, codes promo, réglages, images) dans une boutique existante.
 *   npm run import:v2 -- --slug fifi --sqlite seed/fifi/boutique.sqlite --uploads seed/fifi/uploads
 */
(async () => {
  const slug = arg('slug'), file = arg('sqlite', 'seed/fifi/boutique.sqlite'), up = arg('uploads', 'seed/fifi/uploads');
  const t = slug && await tenantBySlug(slug);
  if (!t) { console.error('✗ Boutique introuvable : créez-la d’abord avec « npm run tenant:create ».'); process.exit(1); }
  if (!fs.existsSync(file)) { console.error('✗ Fichier introuvable :', file); process.exit(1); }
  if ((await one<{ n: number }>('SELECT COUNT(*)::int AS n FROM products WHERE tenant_id = $1', [t.id]))!.n > 0) { console.error('✗ Cette boutique contient déjà des produits : import annulé.'); process.exit(1); }
  const old = new DatabaseSync(file, { readOnly: true });
  const all = (sql: string) => old.prepare(sql).all() as any[];
  const bool = (v: unknown) => !!Number(v);
  const files: { key: string; src: string }[] = [];
  const keyOf = (p: string, kind: 'products' | 'thumbs') => `${slug}/${kind}/${path.basename(p)}`;

  await (await db()).tx(async tx => {
    const cat = new Map<number, number>(), prod = new Map<number, number>();
    for (const c of all('SELECT * FROM categories ORDER BY id')) cat.set(c.id, (await one('INSERT INTO categories (tenant_id, name, slug, icon, position) VALUES ($1,$2,$3,$4,$5) RETURNING id', [t.id, c.name, c.slug, c.icon, c.position], tx))!.id);
    for (const p of all('SELECT * FROM products ORDER BY id'))
      prod.set(p.id, (await one(`INSERT INTO products (tenant_id, slug, name, description, price, compare_price, sku, category_id, status, is_new, featured, track_stock, stock, views, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
        [t.id, p.slug, p.name, p.description, p.price, p.compare_price, p.sku, p.category_id ? cat.get(p.category_id) ?? null : null, p.status, bool(p.is_new), bool(p.featured), bool(p.track_stock), p.stock, p.views, p.created_at, p.updated_at], tx))!.id);
    for (const i of all('SELECT * FROM product_images ORDER BY product_id, position, id')) {
      const pid = prod.get(i.product_id); if (!pid) continue;
      const main = keyOf(i.path, 'products'), th = keyOf(i.thumb, 'thumbs');
      files.push({ key: main, src: path.join(up, 'products', path.basename(i.path)) }, { key: th, src: path.join(up, 'thumbs', path.basename(i.thumb)) });
      await exec('INSERT INTO product_images (tenant_id, product_id, path, thumb, width, height, alt, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [t.id, pid, main, th, i.width, i.height, i.alt, i.position], tx);
    }
    for (const v of all('SELECT * FROM product_variants ORDER BY id')) if (prod.get(v.product_id))
      await exec('INSERT INTO product_variants (tenant_id, product_id, label, sku, price, stock, position, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [t.id, prod.get(v.product_id), v.label, v.sku, v.price, v.stock, v.position, bool(v.active)], tx);
    for (const c of all('SELECT * FROM promo_codes')) await exec('INSERT INTO promo_codes (tenant_id, code, type, value, min_order, max_uses, used, starts_at, expires_at, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [t.id, c.code, c.type, c.value, c.min_order, c.max_uses, c.used, c.starts_at, c.expires_at, bool(c.active)], tx);
    for (const s of all('SELECT k, v FROM settings')) if (s.k in SETTING_DEFAULTS && s.k !== 'logo_url') await saveSetting(t.id, s.k, s.v, tx);
    console.log(`✓ ${cat.size} catégories, ${prod.size} produits importés.`);
  });
  let n = 0;
  for (const f of files) { if (!fs.existsSync(f.src)) { console.warn('  ! image manquante :', f.src); continue; } await putObject(f.key, fs.readFileSync(f.src), 'image/webp'); n++; }
  console.log(`✓ ${n} images envoyées vers le stockage.`);
  await closeDb(); process.exit(0);
})().catch(e => { console.error('✗', e); process.exit(1); });
