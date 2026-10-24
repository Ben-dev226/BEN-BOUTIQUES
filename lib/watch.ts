import { rows } from './db';
import { quantile } from './perf';
import { sendAlert, alertsConfigured, logWarn } from './log';

const sumB = (r: any[]) => r.reduce((a, x) => { for (const k of ['n', 'errors', 'sum_ms', 'b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6']) a[k] = (a[k] || 0) + Number(x[k]); a.max_ms = Math.max(a.max_ms || 0, Number(x.max_ms)); return a; }, {} as any);
export const probeMinutes = () => Math.max(1, Number(process.env.HEALTH_PROBE_MINUTES || 5));

export async function performanceReport() {
  const since24 = "(now() AT TIME ZONE 'utc') - interval '24 hours'";
  const api = await rows(`SELECT * FROM perf_hourly WHERE key LIKE 'api:%' AND hour >= ${since24} ORDER BY hour`);
  const hours = new Map<string, any[]>(); for (const r of api) (hours.get(String(r.hour).slice(0, 13)) ?? hours.set(String(r.hour).slice(0, 13), []).get(String(r.hour).slice(0, 13))!).push(r);
  const series = [...hours].map(([h, l]) => { const t = sumB(l); return { hour: h.slice(11, 13) + 'h', n: t.n, errors: t.errors, p95: quantile(t, .95), avg: t.n ? Math.round(t.sum_ms / t.n) : 0 }; });
  const byRoute = new Map<string, any[]>(); for (const r of api) (byRoute.get(r.key) ?? byRoute.set(r.key, []).get(r.key)!).push(r);
  const routes = [...byRoute].map(([k, l]) => { const t = sumB(l); return { route: k.slice(4), n: t.n, errors: t.errors, avg: t.n ? Math.round(t.sum_ms / t.n) : 0, p95: quantile(t, .95), max: t.max_ms }; }).filter(x => x.n >= 3).sort((a, b) => b.p95 - a.p95).slice(0, 12);
  const dbt = sumB(await rows(`SELECT * FROM perf_hourly WHERE key = 'db' AND hour >= ${since24}`));
  const apit = sumB(api);
  const health = await rows(`SELECT hour::date::text AS day, SUM(n)::int AS probes, SUM(errors)::int AS fails, SUM(sum_ms)::bigint AS ms FROM perf_hourly WHERE key = 'health' AND hour >= (now() AT TIME ZONE 'utc') - interval '30 days' GROUP BY 1 ORDER BY 1`);
  const probes = health.reduce((a, x) => a + x.probes, 0), fails = health.reduce((a, x) => a + x.fails, 0);
  const perDay = Math.round(1440 / probeMinutes());
  const last = await rows(`SELECT MAX(hour) AS h FROM perf_hourly WHERE key = 'health'`);
  const errors = await rows("SELECT id, type, message, created_at, tenant_id FROM platform_events WHERE level = 'error' ORDER BY id DESC LIMIT 15");
  const security = await rows("SELECT id, type, message, ip, created_at FROM platform_events WHERE level = 'security' ORDER BY id DESC LIMIT 20");
  const types = await rows("SELECT type, COUNT(*)::int AS n FROM platform_events WHERE level IN ('error','security') AND created_at > (now() AT TIME ZONE 'utc') - interval '24 hours' GROUP BY 1 ORDER BY n DESC LIMIT 8");
  const today = health.find(x => x.day === new Date().toISOString().slice(0, 10));
  return {
    uptime: { pct: probes ? Math.round((1 - fails / probes) * 10000) / 100 : null, probes, fails, probe_minutes: probeMinutes(), expected_per_day: perDay, today_coverage: today ? Math.min(100, Math.round(today.probes / perDay * 100)) : 0, last_probe_hour: last[0]?.h ? String(last[0].h) : null,
      days: health.map(x => ({ day: x.day, probes: x.probes, fails: x.fails, avg_ms: x.probes ? Math.round(Number(x.ms) / x.probes) : 0, coverage: Math.min(100, Math.round(x.probes / perDay * 100)) })) },
    api: { n: apit.n || 0, errors: apit.errors || 0, avg: apit.n ? Math.round(apit.sum_ms / apit.n) : 0, p50: quantile(apit, .5), p95: quantile(apit, .95), max: apit.max_ms || 0 },
    db: { n: dbt.n || 0, errors: dbt.errors || 0, avg: dbt.n ? Math.round(dbt.sum_ms / dbt.n) : 0, p50: quantile(dbt, .5), p95: quantile(dbt, .95), max: dbt.max_ms || 0 },
    series, routes, errors, security, types, flood_limit: Number(process.env.FLOOD_PER_MIN || 180), slow_query_ms: Number(process.env.SLOW_QUERY_MS || 1200),
  };
}

/** Résumé quotidien (cron) : alerte si la supervision externe est muette, sinon bilan court. */
export async function dailyDigest() {
  const r = await performanceReport(), lines: string[] = [];
  const silent = r.uptime.today_coverage < 40 && r.uptime.probes > 0;
  if (silent) await logWarn({ type: 'monitor_silent', message: `Supervision externe quasi muette : ${r.uptime.today_coverage}% des contrôles attendus reçus aujourd'hui` });
  lines.push(`Bilan 24 h : ${r.api.n} requêtes API, ${r.api.errors} erreurs, p95 ${r.api.p95} ms · base p95 ${r.db.p95} ms`);
  lines.push(r.uptime.pct === null ? 'Disponibilité : aucun contrôle externe reçu (branchez UptimeRobot sur /api/health).' : `Disponibilité 30 j : ${r.uptime.pct}% (${r.uptime.fails} échec(s) sur ${r.uptime.probes} contrôles)`);
  const exp = await rows(`SELECT t.name, t.slug, t.paid_until::text AS d, (t.paid_until - (now() AT TIME ZONE 'utc')::date)::int AS left, (SELECT v FROM settings s WHERE s.tenant_id = t.id AND s.k = 'whatsapp') AS wa
    FROM tenants t WHERE t.status = 'active' AND t.paid_until IS NOT NULL AND (t.paid_until - (now() AT TIME ZONE 'utc')::date) IN (7, 3, 1, 0, -1, -2) ORDER BY t.paid_until`);
  if (exp.length) lines.push('Abonnements à relancer :\n' + exp.map(x => `• ${x.name} : ${x.left > 0 ? 'expire dans ' + x.left + ' j' : x.left === 0 ? 'expire aujourd\'hui' : 'expiré depuis ' + (-x.left) + ' j'}${x.wa ? ' → https://wa.me/' + x.wa : ''}`).join('\n'));
  const dels = await rows("SELECT name, slug, delete_after::text AS d FROM tenants WHERE delete_after IS NOT NULL ORDER BY delete_after");
  if (dels.length) lines.push('Suppressions programmées :\n' + dels.map(x => `• ${x.name} (${x.slug}) le ${String(x.d).slice(0, 10)}`).join('\n'));
  if (r.types.length) lines.push('Incidents 24 h : ' + r.types.map(t => `${t.type} ×${t.n}`).join(', '));
  if (alertsConfigured()) await sendAlert('' + lines.join('\n'));
  return { lines, silent };
}
