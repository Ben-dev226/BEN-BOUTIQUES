import { cache } from 'react';
import { headers } from 'next/headers';
import { tenantFromHeaders, baseFromHeaders, type Tenant } from './tenant';
import { loadSettings, publicSettings, type Settings } from './settings';
import { PRODUCT_SELECT, formatProduct, productFilters, productOrderSql } from './catalog';
import { rows, val } from './db';
import { assetUrl } from './storage';

export type Shop = { tenant: Tenant; s: Settings; origin: string; base: string };

/** Boutique correspondant au nom de domaine de la requête (null = domaine inconnu). */
export const getShop = cache(async (): Promise<Shop | null> => {
  const h = await headers();
  const tenant = await tenantFromHeaders(h), base = baseFromHeaders(h);
  if (!tenant || tenant.status !== 'active') return null;
  const host = (h.get('x-forwarded-host') || h.get('host') || '').split(',')[0].trim();
  const proto = (h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https')).split(',')[0];
  return { tenant, s: await loadSettings(tenant.id), origin: `${proto}://${host}${base}`, base };
});

export const clientSettings = (s: Settings) => { const p = publicSettings(s); return { ...p, logo_url: assetUrl(p.logo_url) ?? '' }; };

export async function queryProducts(shop: Shop, params: Record<string, string>, size: number, sort: string) {
  const { where, q } = productFilters(shop.tenant.id, params, false, Number(shop.s.low_stock_threshold));
  const total = (await val<number>(`SELECT COUNT(*)::int FROM products p LEFT JOIN categories c ON c.id = p.category_id${where}`, q.params)) ?? 0;
  const lim = q.add(size);
  const r = await rows(`${PRODUCT_SELECT}${where} ORDER BY ${productOrderSql(sort)} LIMIT ${lim}`, q.params);
  return { products: r.map(x => formatProduct(x, shop.s)), total };
}

export const plainText = (t: string) => t.replace(/\*\*?/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
export const jsonLd = (o: unknown) => JSON.stringify(o).replace(/</g, '\\u003c');
