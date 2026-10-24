import { NextRequest } from 'next/server';
import { runBackup } from '@/lib/backup';
import { runMaintenance } from '@/lib/maintenance';
import { logError } from '@/lib/log';
import { purgeDueTenants } from '@/lib/moderation';
import { timingSafeEqual } from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Tâche quotidienne (vercel.json) : sauvegarde → nettoyage. Authentifiée par CRON_SECRET (Vercel l'envoie en Bearer). */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || '';
  if (secret.length < 16) return Response.json({ error: 'CRON_SECRET non défini (16 caractères minimum)' }, { status: 503 });
  const got = Buffer.from((req.headers.get('authorization') || '').replace(/^Bearer /, '')), want = Buffer.from(secret);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return Response.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const backup = await runBackup('cron');
    const maintenance = await runMaintenance({ trigger: 'cron' });
    const purge = await purgeDueTenants();
    return Response.json({ ok: backup.ok, backup: { ok: backup.ok, file: backup.file_name, bytes: backup.bytes, rows: backup.rows, destinations: backup.destinations, error: backup.error }, maintenance, purge });
  } catch (e: any) { await logError({ type: 'cron_failed', message: String(e.message || e).slice(0, 250) }); return Response.json({ error: 'Échec de la tâche' }, { status: 500 }); }
}
