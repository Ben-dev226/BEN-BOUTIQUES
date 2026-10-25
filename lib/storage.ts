import fs from 'node:fs/promises';
import path from 'node:path';

/** Stockage des images : Supabase Storage en production, dossier public/uploads en local. */
const driver = () => (process.env.STORAGE_DRIVER || (process.env.SUPABASE_URL ? 'supabase' : 'local'));
const bucket = () => process.env.SUPABASE_BUCKET || 'uploads';

let sb: any;
async function client() {
  if (sb) return sb;
  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants');
  return (sb = createClient(url, key, { auth: { persistSession: false } }));
}

export async function putObject(key: string, data: Buffer, contentType: string): Promise<void> {
  if (driver() === 'supabase') {
    const { error } = await (await client()).storage.from(bucket()).upload(key, data, { contentType, cacheControl: '31536000', upsert: false });
    if (error) throw new Error('Stockage : ' + error.message);
    return;
  }
  const f = path.join(process.cwd(), 'public', 'uploads', key);
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, data);
}

export async function deleteObjects(keys: string[]): Promise<void> {
  keys = keys.filter(k => k && !k.includes('..'));
  if (!keys.length) return;
  if (driver() === 'supabase') { await (await client()).storage.from(bucket()).remove(keys).catch(() => {}); return; }
  await Promise.all(keys.map(k => fs.unlink(path.join(process.cwd(), 'public', 'uploads', k)).catch(() => {})));
}

/** URL publique d'une clé de stockage (ex. « fifi/products/abc.webp »). */
export function assetUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  if (/^https?:\/\//.test(key) || key.startsWith('/')) return key;
  if (driver() === 'supabase') return `${(process.env.SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1/object/public/${bucket()}/${key}`;
  return '/uploads/' + key;
}

export async function copyObject(from: string, to: string): Promise<void> {
  if (driver() === 'supabase') {
    const { error } = await (await client()).storage.from(bucket()).copy(from, to);
    if (error) throw new Error('Stockage : ' + error.message);
    return;
  }
  const root = path.join(process.cwd(), 'public', 'uploads');
  await fs.mkdir(path.dirname(path.join(root, to)), { recursive: true });
  await fs.copyFile(path.join(root, from), path.join(root, to));
}

/** Lit un objet stocké (clé « boutique/brand/x.png ») : fichier local ou téléchargement public. */
export async function readObject(key: string): Promise<Buffer | null> {
  try {
    if (!key || key.includes('..')) return null;
    if (driver() === 'supabase') { const r = await fetch(assetUrl(key)!); return r.ok ? Buffer.from(await r.arrayBuffer()) : null; }
    return await fs.readFile(path.join(process.cwd(), 'public', 'uploads', key));
  } catch { return null; }
}
