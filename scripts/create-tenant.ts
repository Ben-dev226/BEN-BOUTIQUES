import './_env';
import crypto from 'node:crypto';
import { arg } from './_env';
import { createTenant, shopsEverCreated, LIFETIME_MAX_SHOPS } from '../lib/tenants';
import { closeDb } from '../lib/db';

/** npm run tenant:create -- --slug fifi --name "FIFI QUALITY" --whatsapp 226XXXXXXXX [--user admin] [--password ...] [--plan free] */
(async () => {
  const slug = arg('slug'), name = arg('name');
  if (!slug || !name) { console.log('Usage : npm run tenant:create -- --slug boutique1 --name "Ma Boutique" --whatsapp 22670000000 [--user admin] [--password MotDePasse1]'); process.exit(1); }
  const generated = !arg('password');
  const password = arg('password') || crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x') + '7a';
  const r = await createTenant({ slug, name, adminUser: arg('user', 'admin'), adminPassword: password, whatsapp: arg('whatsapp'), plan: arg('plan', 'free'),
    maxProducts: arg('max-products') ? +arg('max-products') : undefined, maxUsers: arg('max-users') ? +arg('max-users') : undefined, paidUntil: arg('paid-until') || null });
  const root = process.env.ROOT_DOMAIN;
  console.log(`✓ Boutique « ${name} » créée (#${r.id}) — ${await shopsEverCreated()}/${LIFETIME_MAX_SHOPS} boutiques sur la plateforme.`);
  console.log(`  Adresse : ${root ? `https://${slug}.${root}` : 'http://localhost:3000 (DEFAULT_TENANT=' + slug + ')'}   Admin : /admin/`);
  console.log(`  Identifiant : ${arg('user', 'admin')}   Mot de passe${generated ? ' (généré, à noter)' : ''} : ${password}   (changement demandé à la première connexion)`);
  await closeDb(); process.exit(0);
})().catch(e => { console.error('✗', e.message); process.exit(1); });
