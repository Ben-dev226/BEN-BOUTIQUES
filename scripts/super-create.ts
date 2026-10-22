import './_env';
import bcrypt from 'bcryptjs';
import { arg } from './_env';
import { db, exec, closeDb } from '../lib/db';
import { passwordProblem } from '../lib/api/ctx';

/** npm run super:create -- --email vous@ben-dev.com --password MotDePasse2026  (12 caractères minimum ; crée ou remplace le mot de passe)
 *  Ajouter --reset-2fa si vous avez perdu votre application d'authentification. */
(async () => {
  const email = arg('email').toLowerCase(), pw = arg('password');
  if (!email || !pw) { console.error('Usage : npm run super:create -- --email moi@exemple.com --password MotDePasse2026'); process.exit(1); }
  const pb = passwordProblem(pw, email, 12); if (pb) { console.error('✗', pb); process.exit(1); }
  await db();
  await exec('INSERT INTO super_admins (email, password_hash) VALUES ($1,$2) ON CONFLICT (email) DO UPDATE SET password_hash = excluded.password_hash', [email, await bcrypt.hash(pw, 12)]);
  if (process.argv.includes('--reset-2fa')) { await exec('UPDATE super_admins SET totp_secret = NULL, totp_enabled = FALSE, totp_last = 0 WHERE email = $1', [email]); console.log('✓ Double authentification désactivée (à réactiver dans le panneau).'); }
  console.log(`✓ Super-admin ${email} prêt. Panneau : ${process.env.ROOT_DOMAIN ? `https://super.${process.env.ROOT_DOMAIN}` : 'http://localhost:3000'}/super/`);
  await closeDb(); process.exit(0);
})().catch(e => { console.error('✗', e.message); process.exit(1); });
