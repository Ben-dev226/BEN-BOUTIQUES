import { healthReport } from '@/lib/api/super';
import { observe, flush } from '@/lib/perf';
import { sendAlert, alertsConfigured } from '@/lib/log';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
let lastAlert = 0;
/** Pour UptimeRobot / BetterStack : 200 si la base répond, 503 sinon. Chaque appel alimente l'historique de disponibilité. */
export async function GET() {
  const t0 = Date.now(), h = await healthReport(), db = h.checks[0].ok, ms = Date.now() - t0;
  observe('health', ms, !db);
  await flush(true);
  if (!db && alertsConfigured() && Date.now() - lastAlert > 10 * 60_000) { lastAlert = Date.now(); await sendAlert('[PANNE] La base de données ne répond pas (contrôle de santé en échec).'); }
  return Response.json({ ok: db, db, ms }, { status: db ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
