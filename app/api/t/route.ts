import type { NextRequest } from 'next/server';
import { hostFromHeaders, tenantFromHeaders } from '@/lib/tenant';
import { isPlatformRoot } from '@/lib/seo';
import { record } from '@/lib/analytics';
import { clientIp } from '@/lib/api/ctx';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Collecte des visites : compteurs agrégés, aucun cookie, aucune IP ni identifiant conservé. Répond toujours 204. */
export async function POST(req: NextRequest) {
  try {
    const host = hostFromHeaders(req.headers), t = await tenantFromHeaders(req.headers).catch(() => null);
    const tid = t ? (t.status === 'active' ? t.id : -1) : isPlatformRoot(host) ? 0 : -1;
    if (tid >= 0) {
      const txt = (await req.text()).slice(0, 600);
      await record(tid, host, clientIp(req.headers), req.headers.get('user-agent') || '', JSON.parse(txt));
    }
  } catch { /* la mesure ne doit jamais gêner le visiteur */ }
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
