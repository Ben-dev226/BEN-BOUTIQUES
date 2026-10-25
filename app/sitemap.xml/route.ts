import { getShop } from '@/lib/shop';
import { rows } from '@/lib/db';
import { esc } from '@/lib/util';
import { headers } from 'next/headers';
import { hostFromHeaders } from '@/lib/tenant';
import { isPlatformRoot, platformOrigin } from '@/lib/seo';
import { assetUrl } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export async function GET() {
  const shop = await getShop();
  const xml = (b: string) => new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${b}\n</urlset>`, { headers: { 'Content-Type': 'application/xml; charset=UTF-8', 'Cache-Control': 'public, max-age=3600' } });
  if (!shop) {
    if (!isPlatformRoot(hostFromHeaders(await headers()))) return new Response('Not found', { status: 404 });
    return xml(`<url><loc>${esc(platformOrigin(hostFromHeaders(await headers())))}/</loc><priority>1.0</priority></url><url><loc>${esc(platformOrigin(hostFromHeaders(await headers())))}/inscription</loc><priority>0.8</priority></url>`);
  }
  const o = shop.origin, tid = shop.tenant.id;
  const u = (loc: string, mod?: string, pri = '0.6') => `<url><loc>${esc(loc)}</loc>${mod ? `<lastmod>${esc(mod.slice(0, 10))}</lastmod>` : ''}<priority>${pri}</priority></url>`;
  const out = [u(o + '/', undefined, '1.0'), u(o + '/a-propos', undefined, '0.4'), u(o + '/conditions', undefined, '0.2'), u(o + '/confidentialite', undefined, '0.2')];
  const abs = (u: string) => (/^https?:\/\//.test(u) ? u : o + u);
  const imgs = new Map<number, string[]>();
  for (const i of await rows('SELECT product_id, path FROM product_images WHERE tenant_id = $1 ORDER BY position, id', [tid])) { const l = imgs.get(i.product_id) ?? []; if (l.length < 5) l.push(abs(assetUrl(i.path) || '')); imgs.set(i.product_id, l); }
  for (const r of await rows("SELECT id, slug, updated_at FROM products WHERE tenant_id = $1 AND status = 'active' ORDER BY id DESC", [tid]))
    out.push(`<url><loc>${esc(`${o}/p/${encodeURIComponent(r.slug)}`)}</loc><lastmod>${esc(String(r.updated_at).slice(0, 10))}</lastmod><priority>0.8</priority>${(imgs.get(r.id) ?? []).filter(Boolean).map(x => `<image:image><image:loc>${esc(x)}</image:loc></image:image>`).join('')}</url>`);
  for (const r of await rows("SELECT c.slug FROM categories c WHERE c.tenant_id = $1 AND EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.id AND p.status = 'active')", [tid])) out.push(u(`${o}/c/${encodeURIComponent(r.slug)}`, undefined, '0.7'));
  return xml(out.join('\n'));
}
