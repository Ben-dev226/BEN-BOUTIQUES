import { healthReport } from '@/lib/api/super';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Pour UptimeRobot / BetterStack : 200 si la base répond, 503 sinon. Aucun détail sensible exposé. */
export async function GET() {
  const h = await healthReport(); const db = h.checks[0].ok;
  return Response.json({ ok: db, db }, { status: db ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
