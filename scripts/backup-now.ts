import './_env';
import { closeDb } from '../lib/db';
import { runBackup } from '../lib/backup';
import { runMaintenance } from '../lib/maintenance';

/** npm run backup            → sauvegarde + envoi Telegram/Drive
 *  npm run backup -- --clean → puis nettoyage (même logique que la tâche quotidienne)
 *  npm run backup -- --dry   → aperçu du nettoyage sans rien supprimer */
(async () => {
  if (process.argv.includes('--dry')) { console.log(JSON.stringify(await runMaintenance({ dryRun: true }), null, 2)); await closeDb(); return; }
  const b = await runBackup('manual'); console.log(JSON.stringify(b, null, 2));
  if (process.argv.includes('--clean')) console.log(JSON.stringify(await runMaintenance({}), null, 2));
  await closeDb(); process.exit(b.ok ? 0 : 1);
})().catch(async e => { console.error('✗', e.message); await closeDb(); process.exit(1); });
