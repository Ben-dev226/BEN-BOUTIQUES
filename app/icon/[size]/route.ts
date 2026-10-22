import sharp from 'sharp';
import { NextRequest } from 'next/server';
import { getShop } from '@/lib/shop';
import { esc } from '@/lib/util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Icône PWA / partage générée pour chaque boutique : initiale du nom sur la couleur principale. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ size: string }> }) {
  const shop = await getShop(); if (!shop) return new Response('Not found', { status: 404 });
  const size = Math.max(64, Math.min(512, parseInt((await params).size, 10) || 192));
  const maskable = req.nextUrl.searchParams.get('m') === '1';
  const color = /^#[0-9a-f]{6}$/i.test(shop.s.primary_color) ? shop.s.primary_color : '#D91B1B';
  const letter = esc([...shop.s.shop_name.trim()][0]?.toUpperCase() || 'B');
  const fs = Math.round(size * (maskable ? 0.42 : 0.56));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" ${maskable ? '' : `rx="${size * 0.2}"`} fill="#0E0E0E"/><circle cx="50%" cy="50%" r="${size * (maskable ? 0.3 : 0.38)}" fill="${color}"/><text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="${fs * 0.7}" fill="#fff">${letter}</text></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' } });
}
