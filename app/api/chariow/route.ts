import { NextRequest } from 'next/server';
import { verifyPulse, creditSale } from '@/lib/billing';
import { logError, logInfo, logSecurity } from '@/lib/log';
import { clientIp } from '@/lib/api/ctx';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Pulse Chariow (webhook) : à déclarer sur https://super.<domaine>/api/chariow ou n'importe quel hôte de la plateforme. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (process.env.CHARIOW_DEBUG === '1') console.log('[chariow:debug] headers', JSON.stringify(Object.fromEntries([...req.headers].filter(([k]) => k.startsWith('x-') || k === 'content-type'))), 'body', raw.slice(0, 4000));   // temporaire : à retirer une fois la vraie structure confirmée
  if (!verifyPulse(raw, req.headers.get('x-chariow-signature'))) { await logSecurity({ type: 'chariow_bad_signature', message: 'Webhook Chariow avec signature invalide', ip: clientIp(req.headers) }); return new Response('invalid signature', { status: 401 }); }
  let payload: any; try { payload = JSON.parse(raw); } catch { return new Response('bad json', { status: 400 }); }
  try {
    const r = await creditSale(payload, req.headers.get('x-pulse-delivery-id'));
    if (r) await logInfo({ type: 'payment_credited', tenantId: r.tenantId, message: `${r.tenant} payé jusqu'au ${r.until}`, detail: { sale: payload?.sale?.id } });
    return Response.json({ ok: true, credited: !!r });
  } catch (e) { await logError({ type: 'chariow_error', message: String((e as Error)?.message), detail: e }); return new Response('error', { status: 500 }); }   // 5xx ⇒ Chariow réessaie
}
