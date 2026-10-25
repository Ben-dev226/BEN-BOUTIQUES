type ReactNode = any;
import { renderChild } from '@/lib/jsx/jsx-runtime';
import type { Shop } from './shop';
import { clientSettings } from './shop';
import { esc, shade, isHex } from './util';
import { assetUrl } from './storage';
import { resolveLook, FONTS } from './themes';

const VER = '20261026';
export type Meta = { title?: string; description?: string; canonical?: string; image?: string; noindex?: boolean; type?: string; jsonld?: unknown; kind?: string; pid?: number; notrack?: boolean };

/**
 * Les pages de la vitrine sont du HTML pur (pas d'hydratation React) : le JavaScript existant
 * (panier, filtres, favoris) pilote le DOM sans conflit, et le client ne télécharge pas le runtime React.
 */
export function htmlPage(shop: Shop | null, meta: Meta, body: ReactNode, status = 200): Response {
  const s = shop?.s, shopName = s?.shop_name ?? 'Boutique';
  const title = meta.title ? (shop ? `${meta.title} – ${shopName}` : meta.title) : s ? (s.seo_title || `${shopName} – ${s.tagline}`) : shopName;
  const desc = meta.description ?? s?.meta_description ?? '';
  const origin = shop?.origin ?? '';
  const abs = (u: string) => (/^https?:\/\//.test(u) ? u : origin + u);
  const canonical = meta.canonical ? abs(meta.canonical) : '';
  const image = abs(meta.image ?? '/icon/512');
  const look = shop ? resolveLook(s!) : null;
  const color = look ? look.primary : '#D91B1B';
  const boot = shop ? `window.FQ=${JSON.stringify({ base: (shop.base || '') + '/', settings: clientSettings(s!), v: VER }).replace(/</g, '\\u003c')};` : '';
  const head = [
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    meta.noindex || !shop ? '<meta name="robots" content="noindex">' : '<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">',
    s?.google_verification ? `<meta name="google-site-verification" content="${esc(s.google_verification)}">` : '',
    canonical ? `<link rel="canonical" href="${esc(canonical)}">` : '',
    shop ? [`<meta property="og:site_name" content="${esc(shopName)}">`, `<meta property="og:type" content="${meta.type ?? 'website'}">`, `<meta property="og:title" content="${esc(title)}">`,
      `<meta property="og:description" content="${esc(desc)}">`, canonical ? `<meta property="og:url" content="${esc(canonical)}">` : '', `<meta property="og:image" content="${esc(image)}">`,
      '<meta property="og:locale" content="fr_FR">', '<meta name="twitter:card" content="summary_large_image">', `<meta name="twitter:title" content="${esc(title)}">`, `<meta name="twitter:description" content="${esc(desc)}">`, `<meta name="twitter:image" content="${esc(image)}">`, `<meta property="og:image:alt" content="${esc(meta.title || shopName)}">`, `<meta name="theme-color" content="${color}">`,
      `<link rel="manifest" href="${shop.base}/manifest.webmanifest">`, `<link rel="icon" type="image/png" sizes="32x32" href="${shop.base}/icon/32"><link rel="icon" type="image/png" sizes="192x192" href="${shop.base}/icon/192">`, `<link rel="apple-touch-icon" href="${shop.base}/icon/192">`].join('\n') : '',
    shop ? '' : '<link rel="icon" type="image/png" sizes="32x32" href="/icon/32"><link rel="apple-touch-icon" href="/icon/192">',
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    `<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?${look ? look.fontCss : FONTS.classic.css}&display=swap" onload="this.onload=null;this.rel='stylesheet'"><noscript><link href="https://fonts.googleapis.com/css2?${look ? look.fontCss : FONTS.classic.css}&display=swap" rel="stylesheet"></noscript>`,
    `<link rel="stylesheet" href="/assets/css/shop.css?v=${VER}">`,
    look ? `<style>:root{${look.vars}}</style>` : '',
    (Array.isArray(meta.jsonld) ? meta.jsonld : meta.jsonld ? [meta.jsonld] : []).map(j => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join(''),
    boot ? `<script>${boot}</script>` : '',
    s?.ga4_id && /^G-[A-Z0-9]{6,14}$/.test(s.ga4_id) ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${s.ga4_id}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${s.ga4_id}');</script>` : '',
    s?.meta_pixel_id && /^\d{8,20}$/.test(s.meta_pixel_id) ? `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${s.meta_pixel_id}');fbq('track','PageView');</script>` : '',
    shop ? `<script src="/assets/a.js?v=${VER}" defer></script>` : '',
  ].filter(Boolean).join('\n');
  const pre = shop?.base || '';
  let inner = renderChild(body);
  if (pre) inner = inner.replace(/(\s(?:href|src|action)=")\/(?!\/|assets\/|fonts\/|_next\/)/g, `$1${pre}/`);
  const html = `<!DOCTYPE html>\n<html lang="fr"${look?.decor ? ` data-decor="${look.decor}"` : ''}${look?.presetId ? ` data-theme="${look.presetId}"` : ''}${shop && !meta.notrack ? ` data-k="${esc(meta.kind || 'o')}"${meta.pid ? ` data-id="${meta.pid}"` : ''}` : ''}><head>\n${head}\n</head><body>${inner}</body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': shop && !shop.priv && status === 200 ? 'public, max-age=0, s-maxage=30, stale-while-revalidate=600' : 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
export { assetUrl };
