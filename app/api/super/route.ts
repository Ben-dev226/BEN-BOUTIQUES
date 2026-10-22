import { NextRequest } from 'next/server';
import { ApiError, clientIp } from '@/lib/api/ctx';
import { superHandle } from '@/lib/api/super';
import { hostFromHeaders, isSuperHost } from '@/lib/tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(req: NextRequest): Promise<Response> {
  const out = (d: unknown, status = 200, cookie?: string) => { const h = new Headers({ 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' }); if (cookie) h.append('Set-Cookie', cookie); return new Response(JSON.stringify(d), { status, headers: h }); };
  try {
    if (!isSuperHost(hostFromHeaders(req.headers))) return out({ error: 'Introuvable' }, 404);
    let method = req.method; const o = (req.headers.get('x-http-method-override') || '').toUpperCase(); if (method === 'POST' && ['PUT', 'DELETE'].includes(o)) method = o;
    const body = method === 'GET' || method === 'DELETE' ? {} : await req.json().catch(() => ({}));
    const https = (req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '')) === 'https';
    const ip = clientIp(req.headers);
    const r = await superHandle({ req, url: req.nextUrl, method, ip, https, body: body && typeof body === 'object' ? body : {}, sid: null, headers: req.headers }, (req.nextUrl.searchParams.get('r') || '').replace(/^\/|\/$/g, ''));
    return out(r.data, r.status, r.setCookie);
  } catch (e: any) {
    if (e instanceof ApiError) return out({ error: e.message, ...e.extra }, e.status);
    console.error('[super]', e); return out({ error: 'Erreur serveur' }, 500);
  }
}
export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
