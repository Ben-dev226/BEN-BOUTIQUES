import type { NextRequest } from 'next/server';
import { clientIp } from '@/lib/api/ctx';
import { runSetup } from '@/lib/setup';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  let b: any; try { b = JSON.parse((await req.text()).slice(0, 4000)); } catch { return Response.json({ error: 'Requête invalide' }, { status: 400 }); }
  const r = await runSetup(b, clientIp(req.headers));
  return Response.json(r.ok ? r : { error: r.error }, { status: r.ok ? 200 : r.status, headers: { 'Cache-Control': 'no-store' } });
}
