import type { NextRequest } from 'next/server';
import { hostFromHeaders, tenantFromHeaders } from '@/lib/tenant';
import { isPlatformRoot } from '@/lib/seo';
import { clientIp } from '@/lib/api/ctx';
import { submitSignup, slugState, slugify, signupMode, placesLeft } from '@/lib/signup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (d: unknown, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });
const allowed = async (req: NextRequest) => { const h = hostFromHeaders(req.headers); return isPlatformRoot(h) && !(await tenantFromHeaders(req.headers).catch(() => null)); };

/** GET ?slug=… : disponibilité d'une adresse. POST : demande d'inscription. Uniquement sur le domaine racine de la plateforme. */
export async function GET(req: NextRequest) {
  if (!await allowed(req) || signupMode() === 'off') return json({ error: 'Indisponible' }, 404);
  const slug = slugify(req.nextUrl.searchParams.get('slug') || '');
  return json({ slug, ...(await slugState(slug)), places: await placesLeft() });
}
export async function POST(req: NextRequest) {
  if (!await allowed(req)) return json({ error: 'Indisponible' }, 404);
  let b: any; try { b = JSON.parse((await req.text()).slice(0, 4000)); } catch { return json({ error: 'Requête invalide' }, 400); }
  const r = await submitSignup(b, clientIp(req.headers));
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}
