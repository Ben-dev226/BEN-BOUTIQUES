import { NextResponse, type NextRequest } from 'next/server';

/**
 * Mode « chemin » : sans nom de domaine (adresse *.vercel.app ou localhost), la plateforme est à la racine
 * et chaque boutique vit sous /<adresse-courte>/ (vitrine, /admin/, /api/...). Le préfixe est retiré avant le
 * routage et transmis à l'application dans l'en-tête interne x-shop-base (toujours effacé s'il vient du client).
 */
const PLATFORM = new Set(['api', 'setup', 'inscription', 'super', 'assets', 'fonts', 'landing', 'conditions', 'confidentialite', 'robots.txt', 'sitemap.xml', '_next', 'favicon.ico',
  'admin', 'p', 'c', 'suivi', 'a-propos', 'icon', 'sw.js', 'manifest.webmanifest']);

export function middleware(req: NextRequest) {
  const host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');
  const h = new Headers(req.headers); h.delete('x-shop-base');
  if (host.endsWith('.vercel.app') || host === 'localhost' || host === '127.0.0.1') {
    const m = req.nextUrl.pathname.match(/^\/([a-z0-9][a-z0-9-]{1,38})(\/.*)?$/);
    if (m && !PLATFORM.has(m[1])) {
      const url = req.nextUrl.clone();
      h.set('x-shop-base', '/' + m[1]);
      url.pathname = m[2] && m[2] !== '/' ? m[2] : '/';
      return NextResponse.rewrite(url, { request: { headers: h } });
    }
  }
  return NextResponse.next({ request: { headers: h } });
}
export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
