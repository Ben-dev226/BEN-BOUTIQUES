import sharp from 'sharp';
import { putObject } from './storage';
import { randHex } from './util';
import { fail } from './api/ctx';

const MAX_PX = Number(process.env.IMAGE_MAX_PX || 1400), THUMB_PX = 480;

/** Valide le contenu réel, corrige l'orientation EXIF, redimensionne, convertit en WebP et crée la miniature. */
export async function processProductImage(buf: Buffer, tenantSlug: string) {
  const meta = await sharp(buf, { limitInputPixels: 40_000_000 }).metadata().catch(() => null);
  if (!meta || !['jpeg', 'png', 'webp'].includes(meta.format || '')) fail('Format non autorisé (JPG, PNG ou WebP uniquement)');
  const base = sharp(buf, { limitInputPixels: 40_000_000 }).rotate();
  const main = await base.clone().resize({ width: MAX_PX, height: MAX_PX, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
  const thumb = await base.clone().resize({ width: THUMB_PX, height: THUMB_PX, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  const name = `${new Date().toISOString().slice(2, 4)}${new Date().toISOString().slice(5, 7)}-${randHex(8)}.webp`;
  const path = `${tenantSlug}/products/${name}`, thumbPath = `${tenantSlug}/thumbs/${name}`;
  await Promise.all([putObject(path, main.data, 'image/webp'), putObject(thumbPath, thumb, 'image/webp')]);
  return { path, thumb: thumbPath, width: main.info.width, height: main.info.height };
}

export async function processLogo(buf: Buffer, tenantSlug: string) {
  const meta = await sharp(buf, { limitInputPixels: 40_000_000 }).metadata().catch(() => null);
  if (!meta || !['jpeg', 'png', 'webp'].includes(meta.format || '')) fail('Format non autorisé (JPG, PNG ou WebP uniquement)');
  const out = await sharp(buf, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 480, height: 160, fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).toBuffer();
  const path = `${tenantSlug}/brand/logo-${randHex(6)}.webp`;
  await putObject(path, out, 'image/webp');
  return { path };
}

/** Favicon d'une boutique : image carrée 512 px (PNG), recadrée au centre. */
export async function processFavicon(buf: Buffer, tenantSlug: string) {
  const meta = await sharp(buf, { limitInputPixels: 40_000_000 }).metadata().catch(() => null);
  if (!meta || !['jpeg', 'png', 'webp'].includes(meta.format || '')) fail('Format non autorisé (JPG, PNG ou WebP uniquement)');
  const out = await sharp(buf, { limitInputPixels: 40_000_000 }).rotate().resize(512, 512, { fit: 'cover', position: 'centre' }).png().toBuffer();
  const path = `${tenantSlug}/brand/favicon-${randHex(6)}.png`;
  await putObject(path, out, 'image/png');
  return { path };
}
