import { exec, one, rows } from './db';

const METRICS = new Set(['pv', 'cart', 'checkout', 'click']);
const mem = new Map<string, { n: number; reset: number }>();
const allowed = (ip: string) => { const now = Date.now(), e = mem.get(ip); if (!e || e.reset < now) { if (mem.size > 5000) mem.clear(); mem.set(ip, { n: 1, reset: now + 60_000 }); return true; } return ++e.n <= 90; };

const bump = (tid: number, metric: string, ref = '') =>
  exec(`INSERT INTO stats_daily (tenant_id, day, metric, ref, n) VALUES ($1, (now() AT TIME ZONE 'utc')::date, $2, $3, 1) ON CONFLICT (tenant_id, day, metric, ref) DO UPDATE SET n = stats_daily.n + 1`, [tid, metric, ref]);

/** Domaine d'origine, sans chemin ni paramètres ; vide si interne. */
export function sourceOf(referrer: string, ownHost: string): string {
  try { const h = new URL(referrer).hostname.toLowerCase().replace(/^(www|m|l|lm)\./, ''); if (!h || h === ownHost.replace(/^www\./, '')) return ''; return h.slice(0, 60); } catch { return ''; }
}
const label = (h: string) => /google\./.test(h) ? 'Google' : /facebook\.|fb\.com|fb\.me/.test(h) ? 'Facebook' : /instagram\./.test(h) ? 'Instagram' : /(^|\.)t\.co$|twitter\.|x\.com/.test(h) ? 'X' : /whatsapp/.test(h) ? 'WhatsApp' : /tiktok\./.test(h) ? 'TikTok' : /bing\.|duckduckgo|yahoo\./.test(h) ? 'Moteurs de recherche' : h;

export async function record(tid: number, ownHost: string, ip: string, ua: string, b: any) {
  if (!allowed(ip) || /bot|crawl|spider|preview|headless|facebookexternalhit/i.test(ua)) return;
  const t = String(b?.t || 'pv'); if (!METRICS.has(t)) return;
  const id = Math.max(0, Math.min(2_000_000_000, parseInt(b?.id, 10) || 0));
  if (t === 'pv') {
    await bump(tid, 'pv');
    if (b?.k === 'p' && id) await bump(tid, 'prod', String(id));
    if (b?.u) {                                        // premier passage du jour pour ce navigateur
      await bump(tid, 'uv'); await bump(tid, 'dev', b?.m ? 'mobile' : 'desktop');
      let src = label(sourceOf(String(b?.r || ''), ownHost)) || 'Direct';
      const known = await one('SELECT 1 FROM stats_daily WHERE tenant_id = $1 AND day = (now() AT TIME ZONE \'utc\')::date AND metric = \'src\' AND ref = $2', [tid, src]);
      if (!known && Number((await one<{ n: number }>('SELECT COUNT(*)::int AS n FROM stats_daily WHERE tenant_id = $1 AND day = (now() AT TIME ZONE \'utc\')::date AND metric = \'src\'', [tid]))?.n) >= 30) src = 'Autres';
      await bump(tid, 'src', src);
    }
  } else if (t === 'click') {
    const ref = String(b?.ref || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 24); if (ref) await bump(tid, 'click', ref);
  } else await bump(tid, t, t === 'cart' && id ? String(id) : '');
}

const D = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
/** Série quotidienne + totaux + répartitions pour un tenant (0 = plateforme). */
export async function report(tid: number, days: number) {
  const from = D(days - 1);
  const all = await rows<{ day: string; metric: string; ref: string; n: number }>(`SELECT day::text AS day, metric, ref, n FROM stats_daily WHERE tenant_id = $1 AND day >= $2::date`, [tid, from]);
  const ser = new Map<string, { pv: number; uv: number }>(); for (let i = days - 1; i >= 0; i--) ser.set(D(i), { pv: 0, uv: 0 });
  const tot: Record<string, number> = {}, by: Record<string, Record<string, number>> = {};
  for (const r of all) {
    if (r.metric === 'pv' || r.metric === 'uv') { const e = ser.get(r.day); if (e) e[r.metric] += r.n; }
    tot[r.metric] = (tot[r.metric] || 0) + r.n;
    (by[r.metric] ||= {})[r.ref] = (by[r.metric][r.ref] || 0) + r.n;
  }
  const top = (m: string, k = 8) => Object.entries(by[m] || {}).sort((a, b) => b[1] - a[1]).slice(0, k).map(([ref, n]) => ({ ref, n }));
  return { from, series: [...ser].map(([date, v]) => ({ date, ...v })), totals: { pv: tot.pv || 0, uv: tot.uv || 0, cart: tot.cart || 0, checkout: tot.checkout || 0 },
    sources: top('src'), devices: top('dev'), clicks: top('click'), prod: top('prod', 10), cart: top('cart', 10) };
}
