import './_env';
import { arg } from './_env';
import { db, rows, exec, closeDb } from '../lib/db';
import { shopsEverCreated, LIFETIME_MAX_SHOPS } from '../lib/tenants';

/**
 * Gestion des boutiques (en attendant le panneau super-admin) :
 *   npm run tenant:admin -- list
 *   npm run tenant:admin -- suspend  --slug boutique1
 *   npm run tenant:admin -- activate --slug boutique1
 *   npm run tenant:admin -- set --slug boutique1 [--plan pro] [--max-products 500] [--max-users 5] [--paid-until 2027-01-31] [--domain maboutique.com]
 *   npm run tenant:admin -- reset-password --slug boutique1 --user admin --password NouveauMdp1
 */
(async () => {
  const cmd = process.argv[2], slug = arg('slug');
  await db();
  if (cmd === 'list') {
    console.table(await rows(`SELECT slug, name, status, plan, max_products, max_users, paid_until::text AS paid_until, custom_domain, (SELECT COUNT(*)::int FROM products p WHERE p.tenant_id = t.id) AS products FROM tenants t ORDER BY id`));
    console.log(`${await shopsEverCreated()}/${LIFETIME_MAX_SHOPS} boutiques créées (suppressions comprises).`);
  } else if (!slug) { console.error('--slug requis'); process.exitCode = 1; }
  else if (cmd === 'suspend' || cmd === 'activate') console.log(await exec('UPDATE tenants SET status = $1 WHERE slug = $2', [cmd === 'suspend' ? 'suspended' : 'active', slug]) ? '✓ fait (effet sous 20 s)' : '✗ boutique introuvable');
  else if (cmd === 'set') {
    const sets: string[] = [], v: unknown[] = [];
    const add = (col: string, val: unknown) => { v.push(val); sets.push(`${col} = $${v.length}`); };
    if (arg('plan')) add('plan', arg('plan')); if (arg('max-products')) add('max_products', +arg('max-products')); if (arg('max-users')) add('max_users', +arg('max-users'));
    if (arg('paid-until')) add('paid_until', arg('paid-until') === 'none' ? null : arg('paid-until')); if (arg('domain')) add('custom_domain', arg('domain') === 'none' ? null : arg('domain').toLowerCase());
    if (!sets.length) { console.error('rien à modifier'); process.exitCode = 1; } else { v.push(slug); console.log(await exec(`UPDATE tenants SET ${sets.join(', ')} WHERE slug = $${v.length}`, v) ? '✓ mis à jour' : '✗ boutique introuvable'); }
  } else if (cmd === 'reset-password') {
    const bcrypt = (await import('bcryptjs')).default, { passwordProblem, BCRYPT_COST } = await import('../lib/api/ctx');
    const pb = passwordProblem(arg('password'), arg('user', 'admin')); if (pb) { console.error('✗', pb); process.exitCode = 1; }
    else console.log(await exec('UPDATE users SET password_hash = $1, must_change_password = TRUE WHERE tenant_id = (SELECT id FROM tenants WHERE slug = $2) AND lower(username) = lower($3)', [await bcrypt.hash(arg('password'), BCRYPT_COST), slug, arg('user', 'admin')]) ? '✓ mot de passe réinitialisé' : '✗ utilisateur introuvable');
  } else { console.error('commande inconnue'); process.exitCode = 1; }
  await closeDb(); process.exit();
})().catch(e => { console.error('✗', e.message); process.exit(1); });
