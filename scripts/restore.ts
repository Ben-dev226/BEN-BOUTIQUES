import './_env';
import { readFileSync } from 'fs';
import { arg } from './_env';
import { db, closeDb } from '../lib/db';
import { readBackup, tableOrder } from '../lib/backup';

/**
 * Restaure une sauvegarde (Drive / Telegram) dans la base pointée par DATABASE_URL.
 *   npm run restore -- --file fq-backup-20261020-030000.ndjson.gz.enc --passphrase "…" [--wipe --yes]
 * Sans --wipe : refuse si la base contient déjà des boutiques. Avec --wipe --yes : vide les tables puis restaure.
 * Fichier envoyé en plusieurs parties Telegram : cat fichier.part001 fichier.part002 > fichier avant de restaurer.
 */
(async () => {
  const file = arg('file'); if (!file) { console.error('Usage : npm run restore -- --file <fichier> --passphrase "<phrase>" [--wipe --yes]'); process.exit(1); }
  const pass = arg('passphrase') || process.env.BACKUP_PASSPHRASE || '';
  const wipe = process.argv.includes('--wipe'), yes = process.argv.includes('--yes');
  let bk; try { bk = readBackup(readFileSync(file), pass); } catch (e: any) { console.error('✗', e.message); process.exit(1); }
  console.log(`Sauvegarde du ${bk.header.created} · schéma v${bk.header.schema} · ${bk.end.rows} lignes`);
  const d = await db();
  const tables = new Set(await tableOrder());
  const unknown = bk.header.tables.filter((t: string) => !tables.has(t));
  if (unknown.length) { console.error('✗ Tables absentes de la base cible (migrations à jour ?) :', unknown.join(', ')); process.exit(1); }
  const has = Number((await d.query('SELECT COUNT(*)::int AS n FROM tenants')).rows[0].n);
  if (has && !wipe) { console.error(`✗ La base contient déjà ${has} boutique(s). Utilisez --wipe --yes pour la remplacer.`); process.exit(1); }
  if (wipe && !yes) { console.error('✗ --wipe efface toutes les données : ajoutez --yes pour confirmer.'); process.exit(1); }
  await d.tx(async t => {
    if (wipe) await t.query(`TRUNCATE ${bk.header.tables.map((x: string) => `"${x}"`).join(', ')} RESTART IDENTITY CASCADE`);
    for (const b of bk.batches) {
      if (!tables.has(b.t)) throw new Error('Table inconnue : ' + b.t);
      await t.query(`INSERT INTO "${b.t}" SELECT * FROM jsonb_populate_recordset(null::"${b.t}", $1::jsonb)`, [JSON.stringify(b.rows)]);
    }
    // vérification : autant de lignes restaurées que dans la sauvegarde, table par table
    const want: Record<string, number> = {}; for (const b of bk.batches) want[b.t] = (want[b.t] ?? 0) + b.rows.length;
    for (const [n, w] of Object.entries(want)) { const got = Number((await t.query(`SELECT COUNT(*)::int AS n FROM "${n}"`)).rows[0].n); if (got !== w) throw new Error(`Contrôle échoué sur ${n} : ${got} lignes au lieu de ${w}`); }
    // remise à niveau des compteurs (SERIAL) pour que les prochains ids ne rentrent pas en collision
    const withId = (await t.query(`SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'id'`)).rows.map(r => r.table_name as string);
    for (const n of (bk.header.tables as string[]).filter(x => withId.includes(x))) {
      const seq = (await t.query(`SELECT pg_get_serial_sequence($1, 'id') AS s`, [`"${n}"`])).rows[0]?.s;
      if (seq) await t.query(`SELECT setval($1, GREATEST(COALESCE((SELECT MAX(id) FROM "${n}"), 0), 1), (SELECT COUNT(*) > 0 FROM "${n}"))`, [seq]);
    }
  });
  console.log(`✓ ${bk.end.rows} lignes restaurées dans ${bk.header.tables.length} tables.`);
  await closeDb();
})().catch(async e => { console.error('✗', e.message); await closeDb(); process.exit(1); });
