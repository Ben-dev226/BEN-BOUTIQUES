import './_env';
import { db, closeDb } from '../lib/db';
(async () => { await db(); console.log('✓ Base de données à jour.'); await closeDb(); process.exit(0); })().catch(e => { console.error('✗', e.message); process.exit(1); });
