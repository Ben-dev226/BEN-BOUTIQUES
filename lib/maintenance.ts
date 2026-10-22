import { db, rows, one, exec } from './db';
import { logInfo, logError, logWarn, sendAlert } from './log';
import { runBackup, lastRemoteBackupAgeHours, remoteOn } from './backup';

/**
 * Libération de la base pour rester sous le quota (Supabase gratuit : 500 Mo).
 *  - toujours : purge des données jetables (limiteurs, anciens événements, paiements en attente périmés) ;
 *  - ≥ DB_WARN_PCT (70 %) : purges plus agressives (journal d'audit, événements) + alerte ;
 *  - ≥ DB_WARN_PCT aussi : COMPACTAGE des commandes terminées de plus de 180 j : la commande (date, client, montants, statut) et
 *    un résumé des ventes par produit/mois sont conservés, seul le détail (articles, historique, adresse, notes) est retiré ;
 *  - ≥ DB_CRIT_PCT malgré tout : suppression des commandes compactées de plus de 2 ans (totaux mensuels conservés).
 *  Toute suppression de détail exige une sauvegarde conservée à distance (Drive/Telegram) de moins de 2 h.
 * Les images vivent dans le stockage (autre quota), pas dans la base.
 */
const num = (k: string, d: number) => { const n = Number(process.env[k]); return Number.isFinite(n) && n > 0 ? n : d; };
export const quotaBytes = () => num('DB_QUOTA_MB', 500) * 1048576;
const WARN = () => num('DB_WARN_PCT', 70), CRIT = () => num('DB_CRIT_PCT', 85), TARGET = () => num('DB_TARGET_PCT', 65);
const ARCHIVE_DAYS = () => Math.max(90, num('ORDERS_ARCHIVE_AFTER_DAYS', 180))   // jamais sous 90 j : le tableau de bord remonte jusqu'à 90 j;
const mb = (n: number) => Math.round((n / 1048576) * 10) / 10;

export async function dbUsage() {
  const bytes = Number((await one('SELECT pg_database_size(current_database())::float8 AS b'))?.b ?? 0), quota = quotaBytes();
  const tables = await rows(`SELECT relname AS name, pg_total_relation_size(relid)::float8 AS bytes, n_live_tup::int AS rows FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 8`);
  const pct = Math.round((bytes / quota) * 1000) / 10;
  return { bytes, quota, pct, level: pct >= CRIT() ? 'critical' : pct >= WARN() ? 'warning' : 'ok', tables, thresholds: { warn: WARN(), crit: CRIT(), target: TARGET() }, archive_after_days: ARCHIVE_DAYS() };
}

type Action = { what: string; rows: number };
export type MaintenanceReport = { dry_run: boolean; before: { mb: number; pct: number }; after: { mb: number; pct: number }; freed_mb: number; actions: Action[]; blocked?: string; backup?: string };

async function vacuum(names: string[]) {
  for (const n of names) { try { await (await db()).query(`VACUUM FULL "${n}"`); } catch { /* non bloquant : l'espace sera réutilisé par autovacuum */ } }
}

/** Garde-fou : aucune suppression de détail sans copie distante réussie de moins de 2 h (une sauvegarde est lancée au besoin). */
async function guard(rep: MaintenanceReport): Promise<boolean> {
  if (rep.blocked) return false;
  if (!remoteOn()) { rep.blocked = 'Compactage bloqué : aucune destination de sauvegarde (Telegram / Drive) n’est configurée.'; }
  else {
    const age = await lastRemoteBackupAgeHours();
    if (age === null || age > 2) { const b = await runBackup('before_cleanup'); rep.backup = b.file_name; if (!(b.ok && b.remote_ok)) rep.blocked = `Compactage bloqué : la sauvegarde préalable a échoué (${b.error}).`; }
  }
  if (rep.blocked) { await logError({ type: 'cleanup_blocked', message: rep.blocked }); await sendAlert(`⚠️ ${rep.blocked}`); return false; }
  return true;
}

/** Compacte un lot de commandes : résumé des ventes → suppression des articles/événements → effacement des textes lourds. */
async function compactBatch(limit: number, where: string): Promise<number> {
  return (await db()).tx(async t => {
    const ids = (await t.query(`SELECT id FROM orders WHERE ${where} ORDER BY id LIMIT ${limit}`)).rows.map(r => r.id as number);
    if (!ids.length) return 0;
    await t.query(`INSERT INTO sales_archive (tenant_id, month, product_key, product_id, name, category_name, qty, revenue)
      SELECT o.tenant_id, date_trunc('month', o.created_at)::date, COALESCE(oi.product_id::text, 'n:' || oi.name), MAX(oi.product_id), MAX(oi.name), COALESCE(MAX(c.name), 'Sans catégorie'),
             SUM(oi.qty)::int, SUM(oi.qty * oi.unit_price)::bigint
      FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN products p ON p.id = oi.product_id LEFT JOIN categories c ON c.id = p.category_id
      WHERE o.id = ANY($1::int[]) AND o.status <> 'cancelled' GROUP BY 1, 2, 3
      ON CONFLICT (tenant_id, month, product_key) DO UPDATE SET qty = sales_archive.qty + EXCLUDED.qty, revenue = sales_archive.revenue + EXCLUDED.revenue`, [ids]);
    await t.query('DELETE FROM order_items WHERE order_id = ANY($1::int[])', [ids]);
    await t.query('DELETE FROM order_events WHERE order_id = ANY($1::int[])', [ids]);
    await t.query(`UPDATE orders SET customer_address = '', note = '', admin_note = '', ip = '', compacted_at = (now() AT TIME ZONE 'utc') WHERE id = ANY($1::int[])`, [ids]);
    return ids.length;
  });
}

export async function runMaintenance(opts: { dryRun?: boolean; force?: boolean; trigger?: 'cron' | 'manual' } = {}): Promise<MaintenanceReport> {
  const dry = !!opts.dryRun, actions: Action[] = [], touched = new Set<string>();
  const u0 = await dbUsage();
  const rep: MaintenanceReport = { dry_run: dry, before: { mb: mb(u0.bytes), pct: u0.pct }, after: { mb: mb(u0.bytes), pct: u0.pct }, freed_mb: 0, actions };
  const del = async (what: string, table: string, where: string, params: unknown[] = []) => {
    const n = dry ? Number((await one(`SELECT COUNT(*)::int AS n FROM ${table} WHERE ${where}`, params))?.n ?? 0) : await exec(`DELETE FROM ${table} WHERE ${where}`, params);
    if (n) { actions.push({ what, rows: n }); touched.add(table); }
  };
  const days = (n: number) => `(now() AT TIME ZONE 'utc') - interval '${Math.floor(n)} days'`;
  const eventDays = num('EVENT_RETENTION_DAYS', 90);

  // 1. toujours
  await del('Limiteurs de débit périmés', 'rate_limits', `ts < ${Date.now() - 2 * 3600_000}`);
  await del('Paiements en attente périmés (+30 j)', 'billing_checkouts', `created_at < ${days(30)}`);
  await del(`Événements plateforme de plus de ${eventDays} j`, 'platform_events', `created_at < ${days(eventDays)}`);
  await del('Compteurs d\'audience de plus de 2 ans', 'stats_daily', `day < (now() AT TIME ZONE 'utc')::date - 730`);
  await del('Anciennes sauvegardes (journal, +180 j)', 'backups', `created_at < ${days(180)}`);

  // 2. à partir de 70 %
  if (u0.level !== 'ok' || opts.force) {
    await del('Événements plateforme de plus de 14 j', 'platform_events', `created_at < ${days(14)}`);
    await del('Journal d’audit de plus de 90 j', 'audit_log', `created_at < ${days(90)}`);
  }

  // les purges ci-dessus peuvent suffire : on libère l'espace puis on re-mesure avant de toucher aux commandes
  let uNow = u0;
  if (!dry && touched.size) { await vacuum([...touched]); touched.clear(); uNow = await dbUsage(); }

  // 3. ≥ 70 % : COMPACTAGE des vieilles commandes terminées — on garde la commande (date, client, montants, statut,
  //    paiement) et le résumé des ventes par produit/mois ; on retire le détail (articles, historique, adresse, notes).
  const done = `status IN ('delivered','cancelled') AND created_at < ${days(ARCHIVE_DAYS())}`;
  const compactable = `${done} AND compacted_at IS NULL`;
  if (uNow.level !== 'ok' || opts.force) {
    const cnt = Number((await one(`SELECT COUNT(*)::int AS n FROM orders WHERE ${compactable}`))?.n ?? 0);
    if (cnt) {
      if (dry) actions.push({ what: `Commandes anciennes compactées (détail archivé, chiffres conservés)`, rows: cnt });
      else if (await guard(rep)) {
        let total = 0;
        for (let i = 0; i < 20; i++) { const n = await compactBatch(2000, compactable); total += n; if (n < 2000) break; }
        if (total) { actions.push({ what: 'Commandes anciennes compactées (détail archivé, chiffres conservés)', rows: total }); ['orders', 'order_items', 'order_events', 'sales_archive'].forEach(t => touched.add(t)); }
      }
    }
  }
  if (!dry && touched.size) { await vacuum([...touched]); touched.clear(); uNow = await dbUsage(); }

  // 4. dernier recours (≥ 85 % malgré tout) : suppression des commandes compactées très anciennes ; les totaux mensuels sont conservés
  const delDays = Math.max(ARCHIVE_DAYS(), num('ORDERS_DELETE_AFTER_DAYS', 730));
  if (uNow.level === 'critical' && !rep.blocked) {
    const old = `compacted_at IS NOT NULL AND created_at < ${days(delDays)}`;
    const cnt = Number((await one(`SELECT COUNT(*)::int AS n FROM orders WHERE ${old}`))?.n ?? 0);
    if (cnt) {
      if (dry) actions.push({ what: `Dernier recours : commandes de plus de ${delDays} j supprimées (totaux mensuels conservés)`, rows: cnt });
      else if (await guard(rep)) {
        const r = await (await db()).tx(async t => {
          await t.query(`INSERT INTO orders_monthly (tenant_id, month, orders, cancelled, revenue)
            SELECT tenant_id, date_trunc('month', created_at)::date, COUNT(*), COUNT(*) FILTER (WHERE status = 'cancelled'), COALESCE(SUM(total) FILTER (WHERE status <> 'cancelled'), 0)
            FROM orders WHERE ${old} GROUP BY 1, 2 ON CONFLICT (tenant_id, month) DO UPDATE SET orders = orders_monthly.orders + EXCLUDED.orders, cancelled = orders_monthly.cancelled + EXCLUDED.cancelled, revenue = orders_monthly.revenue + EXCLUDED.revenue`);
          return (await t.query(`DELETE FROM orders WHERE ${old}`)).rowCount;
        });
        if (r) { actions.push({ what: `Dernier recours : commandes de plus de ${delDays} j supprimées (totaux mensuels conservés)`, rows: r }); touched.add('orders'); }
      }
    }
  }

  if (!dry && touched.size) await vacuum([...touched]);
  const u1 = await dbUsage();
  rep.after = { mb: mb(u1.bytes), pct: u1.pct }; rep.freed_mb = Math.round((u0.bytes - u1.bytes) / 104857.6) / 10;
  if (!dry && actions.length) {
    await logInfo({ type: 'maintenance', message: `Nettoyage base : ${actions.map(a => `${a.what} ×${a.rows}`).join(' ; ')} — ${rep.before.pct}% → ${rep.after.pct}%`.slice(0, 290), detail: rep });
    if (actions.some(a => /compact|recours/i.test(a.what))) await sendAlert(`🧹 Base allégée : ${rep.before.mb} Mo → ${rep.after.mb} Mo (${rep.after.pct} % du quota). Détail des vieilles commandes archivé (chiffres conservés).`);
  }
  if (!dry && u1.level !== 'ok') {
    await logWarn({ type: 'db_quota', message: `Base à ${u1.pct} % du quota (${mb(u1.bytes)} / ${mb(u1.quota)} Mo)` });
    await sendAlert(`${u1.level === 'critical' ? '🔴' : '🟠'} Base de données à ${u1.pct} % du quota (${mb(u1.bytes)} / ${mb(u1.quota)} Mo).${u1.level === 'critical' ? ' Passez à une offre supérieure ou réduisez les données.' : ''}`);
  }
  return rep;
}
