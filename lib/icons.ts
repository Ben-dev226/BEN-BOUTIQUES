import sharp from 'sharp';
import { esc } from './util';
import { readObject } from './storage';
import type { Shop } from './shop';

/** Icône de la plateforme (landing, super-admin) : initiale sur fond vert, point jaune. */
const platformSvg = (size: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0E3B2B"/><text x="30" y="46" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="42" fill="#F1F5EC">B</text><circle cx="49" cy="17" r="6" fill="#F5C22E"/></svg>`;
const HEAD = { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' };

export async function platformIcon(size: number): Promise<Response> {
  const png = await sharp(Buffer.from(platformSvg(size))).png().toBuffer();
  return new Response(new Uint8Array(png), { headers: HEAD });
}

/** Icône d'une boutique : son favicon envoyé depuis l'admin, sinon l'initiale du nom sur la couleur principale. */
export async function shopIcon(shop: Shop, size: number, maskable = false): Promise<Response> {
  const fav = shop.s.favicon_url && !maskable ? await readObject(shop.s.favicon_url) : null;
  if (fav) {
    const png = await sharp(fav).resize(size, size, { fit: 'cover' }).png().toBuffer().catch(() => null);
    if (png) return new Response(new Uint8Array(png), { headers: HEAD });
  }
  const color = /^#[0-9a-f]{6}$/i.test(shop.s.primary_color) ? shop.s.primary_color : '#D91B1B';
  const letter = esc([...shop.s.shop_name.trim()][0]?.toUpperCase() || 'B');
  const fs = Math.round(size * (maskable ? 0.42 : 0.56));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" ${maskable ? '' : `rx="${size * 0.2}"`} fill="#0E0E0E"/><circle cx="50%" cy="50%" r="${size * (maskable ? 0.3 : 0.38)}" fill="${color}"/><text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="${fs * 0.7}" fill="#fff">${letter}</text></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return new Response(new Uint8Array(png), { headers: HEAD });
}
