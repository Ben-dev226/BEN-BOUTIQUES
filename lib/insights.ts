import { rows, val } from './db';
import { report } from './analytics';
import { SETTING_DEFAULTS, type Settings } from './settings';

export type Insight = { level: 'good' | 'warn' | 'tip'; title: string; text: string; link?: string };
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const RANK = { warn: 0, tip: 1, good: 2 };

/** Observations en clair, calculées sur la période, avec une action à mener. */
export async function shopInsights(tid: number, days: number, s: Settings): Promise<Insight[]> {
  const out: Insight[] = [];
  const r2 = await report(tid, days * 2), cur = r2.series.slice(days), prev = r2.series.slice(0, days);
  const sum = (a: { pv: number; uv: number }[], k: 'pv' | 'uv') => a.reduce((x, y) => x + y[k], 0);
  const uv = sum(cur, 'uv'), puv = sum(prev, 'uv');
  const r = await report(tid, days);
  const orders = Number(await val<number>("SELECT COUNT(*)::int FROM orders WHERE tenant_id = $1 AND status <> 'cancelled' AND created_at::date >= $2::date", [tid, r.from])) || 0;
  const t = r.totals;

  if (!uv) out.push({ level: 'tip', title: 'Aucune visite mesurée', text: 'Partagez le lien de la boutique sur WhatsApp, Facebook et Instagram : les visites apparaîtront ici dès le premier passage.', link: '#/settings' });
  else {
    if (puv >= 10) { const d = pct(uv - puv, puv); if (d >= 20) out.push({ level: 'good', title: `Fréquentation en hausse de ${d}%`, text: `${uv} visiteurs contre ${puv} sur la période précédente. Ce qui a changé récemment fonctionne : continuez.` }); else if (d <= -20) out.push({ level: 'warn', title: `Fréquentation en baisse de ${-d}%`, text: `${uv} visiteurs contre ${puv} avant. Relancez vos clients par WhatsApp avec une nouveauté ou une promotion.`, link: '#/promos' }); }
    if (uv >= 30 && orders / uv < 0.01) out.push({ level: 'warn', title: 'Beaucoup de visites, très peu de commandes', text: `${orders} commande${orders > 1 ? 's' : ''} pour ${uv} visiteurs (${(orders / uv * 100).toFixed(1)}%). Vérifiez les prix, la note de livraison et la clarté des photos.`, link: '#/settings' });
    else if (uv >= 30 && orders / uv >= 0.04) out.push({ level: 'good', title: `Bonne conversion : ${(orders / uv * 100).toFixed(1)}%`, text: 'Plus de 4 visiteurs sur 100 commandent : votre boutique convertit bien, développez le trafic.' });
    if (t.cart >= 8 && t.checkout / t.cart < 0.3) out.push({ level: 'warn', title: `${100 - pct(t.checkout, t.cart)}% des ajouts au panier n'arrivent pas à la commande`, text: 'Les clients remplissent le panier puis partent. Précisez les frais de livraison dans la note de livraison et proposez un code promo de bienvenue.', link: '#/promos' });
    if (t.checkout >= 5 && orders / t.checkout < 0.4) out.push({ level: 'warn', title: 'Le formulaire de commande décourage', text: `Seulement ${orders} commande${orders > 1 ? 's' : ''} pour ${t.checkout} formulaires ouverts. Contactez par WhatsApp les clients qui ont hésité.` });
    const mob = r.devices.find(d => d.ref === 'mobile')?.n || 0, dev = r.devices.reduce((a, d) => a + d.n, 0);
    if (dev >= 20 && mob / dev >= 0.7) out.push({ level: 'tip', title: `${pct(mob, dev)}% de vos visiteurs sont sur mobile`, text: 'Soignez les photos pour le téléphone : cadrage vertical, produit bien centré, première image la plus parlante.', link: '#/products' });
    const srcTot = r.sources.reduce((a, d) => a + d.n, 0), direct = r.sources.find(d => d.ref === 'Direct')?.n || 0, google = r.sources.find(d => d.ref === 'Google')?.n || 0;
    if (srcTot >= 20 && !google) out.push({ level: 'tip', title: 'Google ne vous envoie encore aucun visiteur', text: 'Remplissez le titre et la description pour Google, ajoutez le code Search Console et envoyez votre sitemap.', link: '#/settings' });
    if (srcTot >= 20 && direct / srcTot >= 0.8) out.push({ level: 'tip', title: 'Presque tout le trafic arrive en direct', text: 'Les visiteurs viennent de liens partagés en privé. Publiez le lien d\'un produit sur vos réseaux pour toucher de nouvelles personnes.' });
    if (days >= 14) {
      const byDow = new Array(7).fill(0); for (const d of cur) byDow[new Date(d.date + 'T00:00:00Z').getUTCDay()] += d.uv;
      const best = byDow.indexOf(Math.max(...byDow));
      if (uv >= 30 && byDow[best] / uv >= 0.25) out.push({ level: 'tip', title: `Votre meilleur jour : le ${DAYS[best]}`, text: `${pct(byDow[best], uv)}% des visiteurs viennent ce jour-là. Publiez vos nouveautés la veille ou le matin même.` });
    }
    const carted = new Set(r.cart.map(c => c.ref));
    const noCart = r.prod.find(p => p.n >= 15 && !carted.has(p.ref));
    if (noCart) { const p = await rows('SELECT name FROM products WHERE tenant_id = $1 AND id = $2', [tid, Number(noCart.ref)]); if (p[0]) out.push({ level: 'warn', title: `« ${p[0].name} » est très vu mais jamais ajouté au panier`, text: `${noCart.n} vues, aucun ajout. Revoyez le prix, les photos et la description de ce produit.`, link: `#/products/${noCart.ref}` }); }
    const ids = r.cart.slice(0, 5).map(c => Number(c.ref)).filter(Boolean);
    if (ids.length) {
      const low = await rows('SELECT id, name, stock FROM products WHERE tenant_id = $1 AND id = ANY($2::int[]) AND track_stock AND stock <= $3 ORDER BY stock LIMIT 1', [tid, ids, Number(s.low_stock_threshold) || 3]);
      if (low[0]) out.push({ level: 'warn', title: `« ${low[0].name} » plaît mais le stock est ${low[0].stock > 0 ? 'bas (' + low[0].stock + ')' : 'épuisé'}`, text: 'Ce produit est souvent ajouté au panier : réapprovisionnez-le avant de perdre des ventes.', link: `#/products/${low[0].id}` });
    }
  }
  // hygiène du catalogue (utile même sans trafic)
  const noImg = Number(await val<number>("SELECT COUNT(*)::int FROM products p WHERE p.tenant_id = $1 AND p.status = 'active' AND NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id)", [tid])) || 0;
  if (noImg) out.push({ level: 'warn', title: `${noImg} produit${noImg > 1 ? 's' : ''} en ligne sans photo`, text: 'Un produit sans photo se vend très peu et ne ressort pas dans Google Images.', link: '#/products' });
  const noDesc = Number(await val<number>("SELECT COUNT(*)::int FROM products WHERE tenant_id = $1 AND status = 'active' AND trim(description) = ''", [tid])) || 0;
  if (noDesc) out.push({ level: 'tip', title: `${noDesc} produit${noDesc > 1 ? 's' : ''} sans description`, text: 'Quelques lignes (matière, taille, usage) aident à vendre et à être trouvé sur Google.', link: '#/products' });
  if (s.meta_description === SETTING_DEFAULTS.meta_description) out.push({ level: 'tip', title: 'La description pour Google est celle par défaut', text: 'Décrivez votre boutique en une phrase (ce que vous vendez, où vous livrez) pour attirer plus de clics sur Google.', link: '#/settings' });
  return out.sort((a, b) => RANK[a.level] - RANK[b.level]);
}

export async function platformInsights(days: number): Promise<Insight[]> {
  const out: Insight[] = [], l = await report(0, days), t = l.totals, wa = l.clicks.find(c => c.ref === 'whatsapp')?.n || 0;
  if (t.uv >= 30) { const c = pct(wa, t.uv); out.push(c >= 5 ? { level: 'good', title: `La landing convertit : ${c}% cliquent sur WhatsApp`, text: `${wa} contacts pour ${t.uv} visiteurs.` } : { level: 'warn', title: `Seulement ${c}% des visiteurs de la landing vous contactent`, text: 'Rendez le bouton WhatsApp plus visible ou ajoutez une preuve (boutique réelle, témoignage).' }); }
  else out.push({ level: 'tip', title: 'Peu de visites sur la landing', text: `${t.uv} visiteurs sur ${days} jours. Partagez le lien et soumettez le sitemap à Google Search Console.` });
  const idle = await rows(`SELECT t.name FROM tenants t WHERE t.status = 'active' AND t.created_at < now() - interval '14 days' AND NOT EXISTS (SELECT 1 FROM stats_daily s WHERE s.tenant_id = t.id AND s.metric = 'pv' AND s.day >= (now() AT TIME ZONE 'utc')::date - $1::int)`, [days]);
  if (idle.length) out.push({ level: 'warn', title: `${idle.length} boutique${idle.length > 1 ? 's' : ''} sans aucune visite`, text: `${idle.slice(0, 4).map(x => x.name).join(', ')}${idle.length > 4 ? '…' : ''} : aidez ces vendeurs à partager leur lien, ils risquent de ne pas renouveler.` });
  const soon = await rows(`SELECT name, paid_until::text AS d FROM tenants WHERE status = 'active' AND paid_until IS NOT NULL AND paid_until BETWEEN (now() AT TIME ZONE 'utc')::date AND (now() AT TIME ZONE 'utc')::date + 7 ORDER BY paid_until`);
  if (soon.length) out.push({ level: 'warn', title: `${soon.length} abonnement${soon.length > 1 ? 's' : ''} expire${soon.length > 1 ? 'nt' : ''} sous 7 jours`, text: soon.slice(0, 5).map(x => `${x.name} (${x.d})`).join(', ') });
  const top = await rows(`SELECT t.name, SUM(s.n)::int AS uv FROM stats_daily s JOIN tenants t ON t.id = s.tenant_id WHERE s.metric = 'uv' AND s.day >= $1::date GROUP BY t.id ORDER BY uv DESC LIMIT 1`, [l.from]);
  if (top[0]?.uv >= 20) out.push({ level: 'good', title: `« ${top[0].name} » est la boutique la plus visitée`, text: `${top[0].uv} visiteurs sur ${days} jours : un bon exemple à montrer aux prospects.` });
  return out.sort((a, b) => RANK[a.level] - RANK[b.level]);
}
