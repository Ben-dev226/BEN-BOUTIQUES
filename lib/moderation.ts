import bcrypt from 'bcryptjs';
import { one, rows, exec, val, db } from './db';
import { verifyTotp } from './totp';
import { forgetTenants } from './tenant';
import { removeDomain, vercelEnabled } from './vercel';
import { deleteObjects } from './storage';
import { remoteOn } from './backup';
import { logWarn, logSecurity, sendAlert } from './log';
import { dummyHash } from './api/ctx';

export type Action = 'block' | 'ban' | 'delete' | 'purge';          // delete = programmer ; purge = exécuter
export type Check = { id: string; text: string };
const DELAY = () => Math.max(1, Number(process.env.DELETE_DELAY_DAYS || 7));
const days = (d: string | null) => d ? Math.round((Date.parse(d.slice(0, 10) + 'T00:00:00Z') - Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')) / 864e5) : null;

/** Tout ce qu'il faut savoir avant d'agir sur une boutique : faits chiffrés, blocages (impossible tant que non réglé) et avertissements (à cocher). */
export async function impact(id: number, action: Action) {
  const t: any = await one('SELECT id, slug, name, status, paid_until::text AS paid_until, custom_domain, banned, blocked_at, delete_after::text AS delete_after, created_at FROM tenants WHERE id = $1', [id]);
  if (!t) return null;
  const c = async (sql: string) => Number(await val<number>(sql, [id])) || 0;
  const inprog = await c("SELECT COUNT(*)::int FROM orders WHERE tenant_id = $1 AND status IN ('new','confirmed','shipped')");
  const orders = await c('SELECT COUNT(*)::int FROM orders WHERE tenant_id = $1'), revenue = await c("SELECT COALESCE(SUM(total),0)::bigint FROM orders WHERE tenant_id = $1 AND status <> 'cancelled'");
  const recent = await c("SELECT COUNT(*)::int FROM orders WHERE tenant_id = $1 AND created_at > (now() AT TIME ZONE 'utc') - interval '7 days'");
  const products = await c('SELECT COUNT(*)::int FROM products WHERE tenant_id = $1'), images = await c('SELECT COUNT(*)::int FROM product_images WHERE tenant_id = $1');
  const customers = await c('SELECT COUNT(*)::int FROM customers WHERE tenant_id = $1'), users = await c('SELECT COUNT(*)::int FROM users WHERE tenant_id = $1');
  const pending = await c("SELECT COUNT(*)::int FROM billing_checkouts WHERE tenant_id = $1 AND created_at > (now() AT TIME ZONE 'utc') - interval '3 hours'");
  const paid30 = await c("SELECT COUNT(*)::int FROM billing_payments WHERE tenant_id = $1 AND created_at > (now() AT TIME ZONE 'utc') - interval '30 days'");
  const left = days(t.paid_until);
  const bk: any = await one("SELECT EXTRACT(EPOCH FROM ((now() AT TIME ZONE 'utc') - created_at))::float8 / 3600 AS h, remote_ok FROM backups WHERE ok" + (remoteOn() ? ' AND remote_ok' : '') + ' ORDER BY id DESC LIMIT 1');
  const backupH = bk ? Math.round(Number(bk.h) * 10) / 10 : null, backupOk = backupH !== null && backupH < 24;
  const demo = (process.env.DEMO_URL || '').includes(`//${t.slug}.`);
  const first = Number(await val<number>('SELECT MIN(id) FROM tenants')) === id;
  const del = action === 'delete' || action === 'purge', blockers: string[] = [], warnings: Check[] = [];
  if (inprog) (del ? blockers : warnings as any).push(del ? `${inprog} commande(s) en cours (nouvelle, confirmée ou en livraison) : traitez-les ou annulez-les d'abord.` : { id: 'inprog', text: `${inprog} commande(s) en cours : les clients concernés ne pourront plus être suivis ni livrés par cette boutique.` });
  if (pending) (del ? blockers : warnings as any).push(del ? 'Un paiement d\'abonnement a été lancé il y a moins de 3 h : attendez qu\'il soit confirmé ou expiré.' : { id: 'pending', text: 'Un paiement d\'abonnement vient d\'être lancé : il sera encaissé mais la boutique restera bloquée.' });
  if (action === 'purge' && !backupOk) blockers.push(backupH === null ? 'Aucune sauvegarde réussie' + (remoteOn() ? ' envoyée à distance' : '') + ' : lancez-en une (onglet Sauvegardes).' : `Dernière sauvegarde${remoteOn() ? ' distante' : ''} : il y a ${backupH} h (24 h maximum exigées) : relancez-en une.`);
  if (left !== null && left > 0 && paid30) warnings.push({ id: 'paid', text: `Abonnement payé récemment, valable encore ${left} jour(s). Aucun remboursement n'est fait automatiquement : à régler avec le marchand.` });
  if (recent) warnings.push({ id: 'active', text: `Boutique active : ${recent} commande(s) ces 7 derniers jours.` });
  if (demo || first) warnings.push({ id: 'demo', text: demo ? 'C\'est la boutique de démonstration affichée sur la landing.' : 'C\'est la toute première boutique de la plateforme (souvent la démo ou la vôtre).' });
  if (action !== 'block') warnings.push({ id: 'slot', text: 'Le plafond à vie de boutiques continue de compter celle-ci : aucune place n\'est libérée.' });
  if (del) warnings.push({ id: 'data', text: `Seront effacés définitivement : ${products} produit(s), ${images} image(s), ${orders} commande(s), ${customers} client(s), ${users} utilisateur(s). Seules les sauvegardes les conservent.` });
  if (action === 'ban') warnings.push({ id: 'ban', text: 'Le nom, le numéro WhatsApp et l\'email de cette boutique seront refusés pour toute nouvelle inscription.' });
  return { shop: { id: t.id, slug: t.slug, name: t.name, status: t.status, banned: !!t.banned, blocked: !!t.blocked_at, delete_after: t.delete_after },
    facts: { orders, in_progress: inprog, revenue, products, images, customers, users, days_left: left, last_backup_hours: backupH, custom_domain: t.custom_domain, delay_days: DELAY() }, blockers, warnings };
}

/** Réauthentification : mot de passe du super-admin (+ code 2FA s'il est activé). */
export async function reauth(meId: number, body: any, ip: string): Promise<string | null> {
  const u: any = await one('SELECT id, email, password_hash, totp_secret, totp_enabled, totp_last FROM super_admins WHERE id = $1', [meId]);
  const ok = await bcrypt.compare(String(body.password ?? '').slice(0, 200), u?.password_hash ?? dummyHash());
  if (!u || !ok) { await logSecurity({ type: 'super_reauth_failed', ip, message: 'Mot de passe incorrect lors d\'une action sensible' }); return 'Mot de passe incorrect'; }
  if (u.totp_enabled) {
    const step = verifyTotp(u.totp_secret, String(body.code ?? '').trim(), Number(u.totp_last));
    if (step === null || !await exec('UPDATE super_admins SET totp_last = $1 WHERE id = $2 AND totp_last < $1', [step, u.id])) { await logSecurity({ type: 'super_reauth_failed', ip, message: 'Code 2FA incorrect lors d\'une action sensible' }); return 'Code 2FA incorrect ou déjà utilisé (attendez le suivant)'; }
  }
  return null;
}

/** Vérifie les cases d'avertissement cochées ; renvoie un message d'erreur ou null. */
export function ackProblem(imp: NonNullable<Awaited<ReturnType<typeof impact>>>, ack: unknown): string | null {
  if (imp.blockers.length) return imp.blockers[0];
  const got = new Set(Array.isArray(ack) ? ack.map(String) : []);
  const miss = imp.warnings.filter(w => !got.has(w.id));
  return miss.length ? `Cochez toutes les cases de confirmation (${miss.length} restante(s)).` : null;
}

const banEntries = async (id: number, reason: string, slug: string) => {
  const w: any = await one("SELECT (SELECT v FROM settings WHERE tenant_id = $1 AND k = 'whatsapp') AS wa, (SELECT v FROM settings WHERE tenant_id = $1 AND k = 'email') AS em", [id]);
  const req: any = await one("SELECT whatsapp, email FROM signup_requests WHERE tenant_id = $1", [id]);
  const items: [string, string][] = [['slug', slug]];
  for (const x of [w?.wa, req?.whatsapp]) if (x) items.push(['whatsapp', String(x).replace(/\D/g, '')]);
  for (const x of [w?.em, req?.email]) if (x) items.push(['email', String(x).toLowerCase()]);
  for (const [k, v] of items) if (v) await exec('INSERT INTO banlist (kind, value, reason, tenant_slug) VALUES ($1,$2,$3,$4) ON CONFLICT (kind, value) DO NOTHING', [k, v, reason, slug]);
};
export async function isBanned(slug: string, whatsapp: string, email: string): Promise<boolean> {
  return !!await one("SELECT 1 FROM banlist WHERE (kind = 'slug' AND value = $1) OR (kind = 'whatsapp' AND value = $2 AND $2 <> '') OR (kind = 'email' AND value = $3 AND $3 <> '')", [slug, whatsapp.replace(/\D/g, ''), email.toLowerCase()]);
}

export async function blockTenant(id: number, reason: string, by: string) {
  await exec("UPDATE tenants SET status = 'suspended', blocked_reason = $2, blocked_at = (now() AT TIME ZONE 'utc') WHERE id = $1", [id, reason]); forgetTenants();
  await logWarn({ type: 'tenant_blocked', tenantId: id, message: `Boutique #${id} bloquée : ${reason}`, detail: { by } });
}
export async function unblockTenant(id: number, by: string) {
  const t: any = await one('SELECT banned, delete_after FROM tenants WHERE id = $1', [id]);
  if (t?.banned) throw new Error('Boutique bannie : levez d\'abord le bannissement.');
  if (t?.delete_after) throw new Error('Une suppression est programmée : annulez-la d\'abord.');
  await exec("UPDATE tenants SET status = 'active', blocked_reason = '', blocked_at = NULL WHERE id = $1", [id]); forgetTenants();
  await logWarn({ type: 'tenant_unblocked', tenantId: id, message: `Boutique #${id} débloquée`, detail: { by } });
}
export async function banTenant(id: number, reason: string, by: string) {
  const t: any = await one('SELECT slug FROM tenants WHERE id = $1', [id]);
  await banEntries(id, reason, t.slug);
  await exec("UPDATE tenants SET status = 'suspended', banned = TRUE, ban_reason = $2, banned_at = (now() AT TIME ZONE 'utc'), blocked_at = COALESCE(blocked_at, (now() AT TIME ZONE 'utc')), blocked_reason = CASE WHEN blocked_reason = '' THEN $2 ELSE blocked_reason END WHERE id = $1", [id, reason]); forgetTenants();
  await logSecurity({ type: 'tenant_banned', tenantId: id, message: `Boutique ${t.slug} bannie : ${reason}`, detail: { by } }); await sendAlert(`Boutique bannie : ${t.slug} — ${reason}`);
}
export async function unbanTenant(id: number, by: string) {
  const t: any = await one('SELECT slug FROM tenants WHERE id = $1', [id]);
  await exec('DELETE FROM banlist WHERE tenant_slug = $1', [t.slug]);
  await exec("UPDATE tenants SET banned = FALSE, ban_reason = '', banned_at = NULL WHERE id = $1", [id]); forgetTenants();       // reste bloquée : à débloquer séparément
  await logSecurity({ type: 'tenant_unbanned', tenantId: id, message: `Bannissement levé pour ${t.slug}`, detail: { by } });
}
export async function scheduleDelete(id: number, by: string) {
  await exec("UPDATE tenants SET status = 'suspended', blocked_at = COALESCE(blocked_at, (now() AT TIME ZONE 'utc')), blocked_reason = CASE WHEN blocked_reason = '' THEN 'Suppression programmée' ELSE blocked_reason END, delete_after = (now() AT TIME ZONE 'utc') + ($2 || ' days')::interval WHERE id = $1", [id, String(DELAY())]); forgetTenants();
  await logWarn({ type: 'tenant_delete_scheduled', tenantId: id, message: `Suppression de la boutique #${id} programmée dans ${DELAY()} jours`, detail: { by } });
}
export async function cancelDelete(id: number, by: string) {
  await exec('UPDATE tenants SET delete_after = NULL WHERE id = $1', [id]); forgetTenants();
  await logWarn({ type: 'tenant_delete_cancelled', tenantId: id, message: `Suppression de la boutique #${id} annulée (reste bloquée)`, detail: { by } });
}
/** Suppression définitive (domaine, images, données). Les blocages sont revérifiés ici, jamais seulement à la programmation. */
export async function deleteNow(id: number, by: string) {
  const imp = await impact(id, 'purge'); if (!imp) throw new Error('Boutique introuvable');
  if (imp.blockers.length) throw new Error(imp.blockers[0]);
  const t: any = await one('SELECT slug, custom_domain FROM tenants WHERE id = $1', [id]);
  if (t.custom_domain && vercelEnabled()) await removeDomain(t.custom_domain).catch(() => {});
  const files = await rows('SELECT path, thumb FROM product_images WHERE tenant_id = $1', [id]);
  await exec('DELETE FROM tenants WHERE id = $1', [id]); forgetTenants();
  await deleteObjects(files.flatMap(f => [f.path, f.thumb]));
  await logWarn({ type: 'super_tenant_deleted', message: `Boutique supprimée : ${t.slug}`, detail: { by } }); await sendAlert(`Boutique supprimée : ${t.slug}`);
  return t.slug as string;
}
/** Exécute les suppressions arrivées à échéance (après la sauvegarde quotidienne). Ignore celles qui ne passent plus les contrôles. */
export async function purgeDueTenants() {
  const due = await rows("SELECT id, slug FROM tenants WHERE delete_after IS NOT NULL AND delete_after <= (now() AT TIME ZONE 'utc')");
  const done: string[] = [], skipped: { slug: string; why: string }[] = [];
  for (const t of due) { try { await deleteNow(t.id, 'cron'); done.push(t.slug); } catch (e: any) { skipped.push({ slug: t.slug, why: e.message }); await logWarn({ type: 'tenant_delete_skipped', tenantId: t.id, message: `Suppression reportée (${t.slug}) : ${e.message}` }); } }
  return { done, skipped };
}
export { db };
