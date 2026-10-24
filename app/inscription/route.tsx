import { headers } from 'next/headers';
import { hostFromHeaders, tenantForHost } from '@/lib/tenant';
import { isPlatformRoot } from '@/lib/seo';
import { signupPage } from '@/components/Signup';
export const dynamic = 'force-dynamic';
export async function GET() {
  const host = hostFromHeaders(await headers());
  if (!isPlatformRoot(host) || await tenantForHost(host).catch(() => null)) return new Response('Introuvable', { status: 404 });
  return signupPage(host);
}
