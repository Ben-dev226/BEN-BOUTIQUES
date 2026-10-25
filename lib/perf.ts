import { db } from './db';
import { logSecurity, logWarn, logError } from './log';

/**
 * Mesure de performance et détection d'anomalies, sans service externe.
 *  - chaque requête API et chaque requête SQL est chronométrée ; les compteurs sont agrégés par heure
 *    (7 classes de durée) et écrits en base au plus une fois par minute et par instance ;
 *  - surveillance de comportements anormaux : inondation de requêtes par IP, balayage de routes, pic de trafic, taux d'erreurs.
 */
const EDGES = [50, 100, 250, 500, 1000, 3000];                  // classes : <50, <100, <250, <500, <1000, <3000, ≥3000 ms
type Acc = { n: number; errors: number; sum: number; max: number; b: number[] };
const g = globalThis as any;
const acc: Map<string, Acc> = (g.__perfAcc ??= new Map());
const ips: Map<string, { n: number; bad: number; reset: number; blockedUntil: number; flagged: number }> = (g.__perfIps ??= new Map());
const state = (g.__perfState ??= { lastFlush: 0, lastCheck: 0, alerted: new Map<string, number>() }) as { lastFlush: number; lastCheck: number; alerted: Map<string, number> };

const FLOOD = () => Number(process.env.FLOOD_PER_MIN || 180);
const cls = (ms: number) => { const i = EDGES.findIndex(e => ms < e); return i < 0 ? 6 : i; };

export function observe(key: string, ms: number, error = false) {
  if (acc.size > 400 && !acc.has(key)) key = 'api:autres';
  let a = acc.get(key); if (!a) acc.set(key, a = { n: 0, errors: 0, sum: 0, max: 0, b: [0, 0, 0, 0, 0, 0, 0] });
  a.n++; if (error) a.errors++; a.sum += ms; if (ms > a.max) a.max = ms; a.b[cls(ms)]++;
}
const SLOW_SQL = () => Number(process.env.SLOW_QUERY_MS || 1200);
g.__dbObs = (ms: number, sql: string, err: boolean) => {
  if (sql.includes('perf_hourly')) return;                       // ne pas se mesurer soi-même
  observe('db', ms, err);
  if (ms >= SLOW_SQL()) void logWarn({ type: 'slow_query', message: `Requête SQL lente : ${ms} ms`, detail: sql.replace(/\s+/g, ' ').slice(0, 220) });
};

/** Appelé à chaque requête API : renvoie true si l'IP est temporairement bloquée (inondation). */
export function guardIp(ip: string): boolean {
  const now = Date.now(); if (!ip) return false;
  if (ips.size > 4000) for (const [k, v] of ips) if (v.reset < now && v.blockedUntil < now) ips.delete(k);
  let e = ips.get(ip); if (!e || e.reset < now) ips.set(ip, e = { n: 0, bad: 0, reset: now + 60_000, blockedUntil: e?.blockedUntil ?? 0, flagged: e?.flagged ?? 0 });
  if (e.blockedUntil > now) return true;
  if (++e.n > FLOOD()) {
    e.blockedUntil = now + 10 * 60_000;
    void logSecurity({ type: 'request_flood', message: `${e.n} requêtes en 1 minute depuis une même adresse : bloquée 10 min`, ip, detail: { limit: FLOOD() } });
    return true;
  }
  return false;
}
/** Réponse refusée/inconnue (401, 403, 404, 429) : trop d'échecs en peu de temps = balayage ou tentative d'intrusion. */
export function noteBad(ip: string, status: number, route: string) {
  const e = ips.get(ip); if (!e || !ip) return; e.bad++;
  if (e.bad >= 30 && Date.now() - e.flagged > 30 * 60_000) { e.flagged = Date.now(); void logSecurity({ type: 'scan_suspected', message: `${e.bad} requêtes refusées en 1 minute (dernière : ${status} ${route})`, ip }); }
}

const hourOf = () => new Date().toISOString().slice(0, 13) + ':00:00';
export async function flush(force = false): Promise<void> {
  const now = Date.now(); if (!force && now - state.lastFlush < 60_000) return; state.lastFlush = now;
  if (!acc.size) return;
  const items = [...acc]; acc.clear(); const h = hourOf();
  try {
    const d = await db();
    await Promise.all(items.map(([k, a]) => d.query(`INSERT INTO perf_hourly (hour, key, n, errors, sum_ms, max_ms, b0, b1, b2, b3, b4, b5, b6) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (hour, key) DO UPDATE SET n = perf_hourly.n + EXCLUDED.n, errors = perf_hourly.errors + EXCLUDED.errors, sum_ms = perf_hourly.sum_ms + EXCLUDED.sum_ms, max_ms = GREATEST(perf_hourly.max_ms, EXCLUDED.max_ms),
      b0 = perf_hourly.b0 + EXCLUDED.b0, b1 = perf_hourly.b1 + EXCLUDED.b1, b2 = perf_hourly.b2 + EXCLUDED.b2, b3 = perf_hourly.b3 + EXCLUDED.b3, b4 = perf_hourly.b4 + EXCLUDED.b4, b5 = perf_hourly.b5 + EXCLUDED.b5, b6 = perf_hourly.b6 + EXCLUDED.b6`,
      [h, k, a.n, a.errors, a.sum, a.max, ...a.b])));
    if (now - state.lastCheck > 5 * 60_000) { state.lastCheck = now; await checkAnomalies(h); }
  } catch { for (const [k, a] of items) { const x = acc.get(k); if (!x) acc.set(k, a); } }   // base indisponible : on garde en mémoire
}

const once = (k: string, ttl = 3600_000) => { const t = Date.now(); if (t - (state.alerted.get(k) || 0) < ttl) return false; state.alerted.set(k, t); return true; };
async function checkAnomalies(h: string) {
  const d = await db();
  const cur = (await d.query("SELECT COALESCE(SUM(n),0)::int AS n, COALESCE(SUM(errors),0)::int AS e FROM perf_hourly WHERE hour = $1 AND key LIKE 'api:%'", [h])).rows[0];
  const base = (await d.query("SELECT COALESCE(SUM(n),0)::float / 6 AS avg FROM perf_hourly WHERE key LIKE 'api:%' AND hour >= ($1::timestamp - interval '6 hours') AND hour < $1::timestamp", [h])).rows[0];
  if (cur.n >= 300 && cur.n > 5 * Math.max(60, Number(base.avg)) && once('spike:' + h)) await logSecurity({ type: 'traffic_spike', message: `Pic de trafic API : ${cur.n} requêtes cette heure (moyenne ${Math.round(base.avg)}/h)`, detail: { n: cur.n, avg: base.avg } });
  if (cur.n >= 20 && cur.e / cur.n >= 0.2 && once('errrate:' + h)) await logError({ type: 'error_rate', message: `Taux d'erreurs élevé : ${cur.e} sur ${cur.n} requêtes API cette heure` });
  const hist = (await d.query("SELECT n, b4, b5, b6 FROM perf_hourly WHERE hour = $1 AND key = 'db'", [h])).rows[0];
  if (hist && hist.n >= 20 && (hist.b5 + hist.b6) / hist.n >= 0.1 && once('dbslow:' + h)) await logWarn({ type: 'db_slow', message: `Base de données lente : ${Math.round((hist.b5 + hist.b6) / hist.n * 100)}% des requêtes dépassent 1 s cette heure` });
}

/** Quantile approximatif à partir des 7 classes (borne haute de la classe, max observé pour la dernière). */
export function quantile(r: { n: number; max_ms: number; b0: number; b1: number; b2: number; b3: number; b4: number; b5: number; b6: number }, q: number): number {
  const b = [r.b0, r.b1, r.b2, r.b3, r.b4, r.b5, r.b6], tot = b.reduce((x, y) => x + y, 0); if (!tot) return 0;
  let c = 0; for (let i = 0; i < 7; i++) { c += b[i]; if (c >= tot * q) return i < 6 ? Math.min(EDGES[i], r.max_ms || EDGES[i]) : r.max_ms; }
  return r.max_ms;
}
