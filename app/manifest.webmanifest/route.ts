import { getShop } from '@/lib/shop';
export const dynamic = 'force-dynamic';
export async function GET() {
  const shop = await getShop(); if (!shop) return new Response('{}', { status: 404 });
  const { s } = shop, color = /^#[0-9a-f]{6}$/i.test(s.primary_color) ? s.primary_color : '#0E0E0E';
  return Response.json({ name: s.shop_name, short_name: s.shop_name.slice(0, 12), description: s.tagline, start_url: shop.base + '/', scope: shop.base + '/', display: 'standalone', background_color: '#0E0E0E', theme_color: color, lang: 'fr',
    icons: [{ src: shop.base + '/icon/192', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: shop.base + '/icon/512', sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: shop.base + '/icon/512?m=1', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] },
    { headers: { 'Content-Type': 'application/manifest+json' } });
}
