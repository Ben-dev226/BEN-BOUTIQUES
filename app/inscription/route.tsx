import { headers } from 'next/headers';
import { hostFromHeaders, tenantFromHeaders } from '@/lib/tenant';
import { isPlatformRoot } from '@/lib/seo';
import { signupPage } from '@/components/Signup';
export const dynamic = 'force-dynamic';
export async function GET() {
  const hs = await headers(), host = hostFromHeaders(hs);
  if (!isPlatformRoot(host) || hs.get('x-shop-base') || await tenantFromHeaders(hs).catch(() => null)) return new Response('Introuvable', { status: 404 });
  return signupPage(host);
}
