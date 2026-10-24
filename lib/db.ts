/**
 * Accès base de données.
 *  - DATABASE_URL défini  → PostgreSQL (Supabase, Neon…) via `pg`
 *  - sinon                → PGlite (vrai Postgres embarqué) dans .data/ : développement et tests sans rien installer
 */
import { MIGRATIONS } from './schema';

export type Result = { rows: any[]; rowCount: number };
export interface Db { query(sql: string, params?: unknown[]): Promise<Result>; script(sql: string): Promise<void>; }
export interface Driver extends Db { tx<T>(fn: (t: Db) => Promise<T>): Promise<T>; close?(): Promise<void>; }

/** Crochet de mesure (installé par lib/perf.ts) : durée de chaque requête SQL. */
const timed = async <T>(sql: string, run: () => Promise<T>): Promise<T> => {
  const t0 = Date.now(); const obs = (globalThis as any).__dbObs as ((ms: number, sql: string, err: boolean) => void) | undefined;
  try { const r = await run(); obs?.(Date.now() - t0, sql, false); return r; } catch (e) { obs?.(Date.now() - t0, sql, true); throw e; }
};
const PARSERS: Record<number, (v: string) => unknown> = {
  20: v => Number(v),                 // int8
  1700: v => Number(v),               // numeric
  1114: v => v.slice(0, 19),          // timestamp → 'YYYY-MM-DD HH:MM:SS'
  1184: v => v.slice(0, 19),
  1082: v => v,                       // date → 'YYYY-MM-DD'
};

async function makeDriver(): Promise<Driver> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const pg = await import('pg');
    for (const [oid, fn] of Object.entries(PARSERS)) pg.types.setTypeParser(Number(oid), fn as any);
    const local = /localhost|127\.0\.0\.1/.test(url);
    const pool = new pg.Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX || 5), ssl: local ? undefined : { rejectUnauthorized: false } });
    const wrap = (c: { query: (s: string, p?: unknown[]) => Promise<any> }): Db => ({
      async query(sql, params) { const r = await timed(sql, () => c.query(sql, params as any[])); return { rows: r.rows, rowCount: r.rowCount ?? 0 }; },
      async script(sql) { await c.query(sql); },
    });
    return {
      ...wrap(pool),
      async tx(fn) {
        const c = await pool.connect();
        try { await c.query('BEGIN'); const r = await fn(wrap(c)); await c.query('COMMIT'); return r; }
        catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
        finally { c.release(); }
      },
    };
  }
  if (process.env.VERCEL || (process.env.NODE_ENV === 'production' && process.env.ALLOW_LOCAL_DB !== '1'))
    throw new Error('DATABASE_URL absent : ajoutez la chaîne de connexion Supabase dans les variables d\'environnement Vercel (Production), puis redéployez.');
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = process.env.PGLITE_DIR || '.data/pg';
  (await import('node:fs')).mkdirSync(dir.replace(/\/[^/]+$/, ''), { recursive: true });
  const db = new PGlite(dir, { parsers: PARSERS as any });
  await db.waitReady;
  const wrap = (c: { query: (s: string, p?: unknown[]) => Promise<any>; exec: (s: string) => Promise<any> }): Db => ({
    async query(sql, params) { const r = await timed(sql, () => c.query(sql, params as any[])); return { rows: r.rows, rowCount: Math.max(r.affectedRows ?? 0, r.rows.length) }; },
    async script(sql) { await c.exec(sql); },
  });
  let chain: Promise<unknown> = Promise.resolve();      // PGlite = 1 connexion : on sérialise les transactions
  return {
    ...wrap(db),
    close: () => db.close(),
    tx(fn) {
      const run = chain.then(() => db.transaction(async t => fn(wrap(t))));
      chain = run.catch(() => {});
      return run as Promise<any>;
    },
  };
}

const g = globalThis as unknown as { __db?: Promise<Driver> };

async function init(): Promise<Driver> {
  const d = await makeDriver();
  if (process.env.AUTO_MIGRATE !== '0') await migrate(d);
  return d;
}
export function db(): Promise<Driver> { return (g.__db ??= init().catch(e => { g.__db = undefined; throw e; })); }

export async function migrate(d: Driver): Promise<number> {
  await d.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE \'utc\'))');
  let applied = 0;
  for (const [i, sql] of MIGRATIONS.entries()) {
    const v = i + 1;
    await d.tx(async t => {
      await t.query('SELECT pg_advisory_xact_lock(7342001)');
      const done = await t.query('SELECT 1 FROM schema_migrations WHERE version = $1', [v]);
      if (done.rows.length) return;
      await t.script(sql);
      await t.query('INSERT INTO schema_migrations (version) VALUES ($1)', [v]);
      applied++;
    });
  }
  return applied;
}

// ── Raccourcis ────────────────────────────────────────────
export async function rows<T = any>(sql: string, params: unknown[] = [], t?: Db): Promise<T[]> { return ((t ?? await db()).query(sql, params)).then(r => r.rows as T[]); }
export async function one<T = any>(sql: string, params: unknown[] = [], t?: Db): Promise<T | undefined> { return (await rows<T>(sql, params, t))[0]; }
export async function exec(sql: string, params: unknown[] = [], t?: Db): Promise<number> { return ((t ?? await db()).query(sql, params)).then(r => r.rowCount); }
export async function val<T = any>(sql: string, params: unknown[] = [], t?: Db): Promise<T | undefined> { const r = await one<Record<string, T>>(sql, params, t); return r ? Object.values(r)[0] : undefined; }

/** Constructeur de paramètres : q.add(x) renvoie "$n" */
export class Q { params: unknown[] = []; add(v: unknown) { this.params.push(v); return '$' + this.params.length; } }

/** Ferme proprement la base (indispensable pour PGlite avant la fin d'un script). */
export async function closeDb() { const d = await g.__db; await d?.close?.(); g.__db = undefined; }
