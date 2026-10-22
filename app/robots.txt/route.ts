import { headers } from 'next/headers';
import { getShop } from '@/lib/shop';
import { hostFromHeaders } from '@/lib/tenant';
import { isPlatformRoot, platformOrigin } from '@/lib/seo';
export const dynamic = 'force-dynamic';
export async function GET() {
  const shop = await getShop();
  let body: string;
  if (shop) body = `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\nDisallow: /suivi\nDisallow: /*?\n\nSitemap: ${shop.origin}/sitemap.xml\n`;
  else if (isPlatformRoot(hostFromHeaders(await headers()))) body = `User-agent: *\nAllow: /\nDisallow: /super\nDisallow: /api/\n\nSitemap: ${platformOrigin()}/sitemap.xml\n`;
  else body = 'User-agent: *\nDisallow: /\n';
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=UTF-8', 'Cache-Control': 'public, max-age=3600' } });
}
