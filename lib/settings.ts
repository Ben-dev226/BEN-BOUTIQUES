import { rows, exec, type Db } from './db';

export const SETTING_DEFAULTS: Record<string, string> = {
  shop_name: 'Ma boutique', tagline: 'Mode & accessoires', hero_title: 'Bienvenue dans notre boutique',
  hero_text: 'Découvrez notre sélection. Commande simple via WhatsApp, livraison rapide.',
  about_text: "Nous sélectionnons avec soin chaque article de notre boutique.\nCommandez en quelques clics : nous confirmons chaque commande sur WhatsApp et organisons la livraison.",
  meta_description: 'Boutique en ligne – commandez en quelques clics, confirmation par WhatsApp, livraison rapide.',
  whatsapp: '', phone_display: '', email: '', address: '', hours: '', facebook: '', instagram: '', tiktok: '', announcement: '',
  currency: 'FCFA', delivery_fee: '0', free_delivery_min: '0', delivery_note: 'Frais de livraison confirmés par WhatsApp selon votre quartier.',
  seo_title: '', google_verification: '', ga4_id: '', meta_pixel_id: '', pickup_enabled: '1', low_stock_threshold: '3', order_prefix: 'CMD', primary_color: '#D91B1B', logo_url: '',
};
export const PUBLIC_SETTINGS = ['shop_name', 'tagline', 'hero_title', 'hero_text', 'about_text', 'meta_description', 'whatsapp', 'phone_display', 'email', 'address', 'hours',
  'facebook', 'instagram', 'tiktok', 'announcement', 'currency', 'delivery_fee', 'free_delivery_min', 'delivery_note', 'pickup_enabled', 'primary_color', 'logo_url', 'seo_title'];
export const LONG_SETTINGS = ['hero_text', 'about_text', 'meta_description', 'delivery_note'];

export type Settings = Record<string, string>;

export async function loadSettings(tenantId: number, t?: Db): Promise<Settings> {
  const s = { ...SETTING_DEFAULTS };
  for (const r of await rows<{ k: string; v: string }>('SELECT k, v FROM settings WHERE tenant_id = $1', [tenantId], t)) if (r.k in s) s[r.k] = r.v;
  return s;
}
export const publicSettings = (s: Settings): Settings => Object.fromEntries(PUBLIC_SETTINGS.map(k => [k, s[k]]));
export async function saveSetting(tenantId: number, k: string, v: string, t?: Db) {
  await exec('INSERT INTO settings (tenant_id, k, v) VALUES ($1,$2,$3) ON CONFLICT (tenant_id, k) DO UPDATE SET v = excluded.v', [tenantId, k, v], t);
}
