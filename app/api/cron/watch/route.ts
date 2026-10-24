import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { dailyDigest } from '@/lib/watch';
import { flush } from '@/lib/perf';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Bilan quotidien de surveillance (vercel.json), authentifié par CRON_SECRET. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || '';
  if (secret.length < 16) return Response.json({ error: 'CRON_SECRET non défini' }, { status: 503 });
  const got = Buffer.from((req.headers.get('authorization') || '').replace(/^Bearer /, '')), want = Buffer.from(secret);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return Response.json({ error: 'Non autorisé' }, { status: 401 });
  await flush(true);
  return Response.json(await dailyDigest());
}
