import { renderChild } from '@/lib/jsx/jsx-runtime';
import { shopsEverCreated, LIFETIME_MAX_SHOPS } from '@/lib/tenants';
import { one } from '@/lib/db';
import { esc } from '@/lib/util';

const VER = '20261027';

export async function landingPage(host: string): Promise<Response> {
  const name = process.env.PLATFORM_NAME || 'Ben-Dev Boutiques', root = process.env.ROOT_DOMAIN || '';
  let taken = 0; try { taken = Math.min(LIFETIME_MAX_SHOPS, await shopsEverCreated()); } catch { /* base indisponible : page affichée quand même */ }
  const left = LIFETIME_MAX_SHOPS - taken;
  let demo = process.env.DEMO_URL || '';
  if (!demo) { try { const t = await one<{ slug: string }>("SELECT slug FROM tenants WHERE status = 'active' ORDER BY id LIMIT 1"); if (t && root) demo = `https://${t.slug}.${root}`; } catch { /* idem */ } }
  const wa = (process.env.CONTACT_WHATSAPP || '').replace(/\D/g, ''), mail = process.env.CONTACT_EMAIL || '';
  const signup = (process.env.SIGNUP_MODE || 'review').toLowerCase() !== 'off';
  const contact = signup ? '/inscription' : wa ? `https://wa.me/${wa}?text=${encodeURIComponent('Bonjour, je veux créer ma boutique en ligne.')}` : mail ? `mailto:${mail}?subject=${encodeURIComponent('Créer ma boutique')}` : '#places';
  const origin = `https://${host}`;
  const body = (
    <>
      <a className="skip" href="#main">Aller au contenu</a>
      <div className="wrap">
        <header className="bar">
          <a className="logo" href="/"><i />{name}</a>
          <nav aria-label="Navigation">
            <a href="#etapes">Comment ça marche</a><a href="#fonctions">Fonctions</a><a href="#places">Places</a><a href="#offre">Abonnement</a>
            <a className="btn sun" href={contact}>Créer ma boutique</a>
          </nav>
        </header>
        <main id="main">
          <div className="hero">
            <div>
              <h1>Votre boutique en ligne. Vos commandes sur WhatsApp.</h1>
              <p className="lead">Mettez votre catalogue en ligne en un après-midi. Vos clients choisissent, commandent, et le message de commande arrive tout prêt sur votre WhatsApp. Vous confirmez, vous livrez.</p>
              <div className="cta">
                <a className="btn main" href={contact}>Créer ma boutique</a>
                {demo && <a className="btn line" href={demo}>Visiter une boutique réelle</a>}
              </div>
              <div className="facts">
                <div><b>Zéro commission</b>sur vos ventes</div>
                <div><b>Paiement à la livraison</b>comme vos clients l’attendent</div>
                <div><b>Mobile Money</b>pour l’abonnement</div>
              </div>
            </div>
            <div className="stage" aria-hidden="true">
              <div className="phone"><div className="screen">
                <div className="s-top">FIFI QUALITY <span>Panier 2</span></div>
                <div className="s-search">Rechercher un produit…</div>
                <div className="s-chips"><b>Tout</b><i>Bonnet</i><i>Casquette</i><i>Montre</i></div>
                <div className="s-grid">
                  {[['bonnet', 'Bonnet', '3 500'], ['casquette', 'Casquette', '5 000'], ['montre', 'Montre', '7 500'], ['tshirt', 'T-shirt', '5 000']].map(([f, n, p]) =>
                    <div className="s-card" key={f}><img src={`/landing/${f}.webp`} alt="" width="160" height="160" /><p>{n}</p><small>{p} FCFA</small></div>)}
                </div>
              </div></div>
              <div className="bubble"><b>Nouvelle commande CMD-261020-A7F2</b>2 × Bonnet = 7 000 FCFA<br />Livraison : Gounghin, Ouagadougou<em>Suivi : {root ? `fifi.${root}` : 'votre-boutique'}/suivi?n=CMD-261020-A7F2</em><time>14:32</time></div>
            </div>
          </div>
        </main>
      </div>

      <section id="etapes"><div className="wrap">
        <h2>Du clic du client au colis livré</h2>
        <p className="sub">Pas d’application à installer, pas de formation. Trois étapes, et vous gardez la main sur chacune.</p>
        <div className="steps">
          <div className="step"><div className="n">1</div><h3>Le client commande</h3><p>Il parcourt votre catalogue sur son téléphone, choisit taille ou couleur, ajoute au panier et laisse son numéro et son quartier.</p></div>
          <div className="step"><div className="n">2</div><h3>La commande vous arrive</h3><p>Elle est enregistrée dans votre espace et le message WhatsApp est déjà rédigé : produits, total, adresse, lien de suivi. Le stock baisse tout seul.</p></div>
          <div className="step"><div className="n">3</div><h3>Vous confirmez et livrez</h3><p>Vous changez le statut en un clic. Le client suit sa commande avec son numéro, sans vous écrire pour demander où elle en est.</p></div>
        </div>
      </div></section>

      <section id="fonctions" className="feat"><div className="wrap in">
        <h2>Tout ce qu’il faut pour vendre, rien de superflu</h2>
        <div className="rows">
          <div><h3>Votre catalogue</h3><p>Photos compressées automatiquement, variantes (tailles, couleurs), stock par article, prix barrés, nouveautés, codes promo.</p></div>
          <div><h3>Vos commandes</h3><p>Statuts, paiement encaissé ou non, notes internes, fiche client, export Excel de vos ventes et de vos clients.</p></div>
          <div><h3>Votre image</h3><p>Votre nom, votre logo, votre couleur. Une adresse à votre nom, ou votre propre nom de domaine. Installable sur l’écran d’accueil du téléphone.</p></div>
          <div><h3>Votre équipe</h3><p>Plusieurs comptes avec des droits différents : le vendeur gère les commandes, vous gardez les réglages.</p></div>
          <div><h3>Votre tranquillité</h3><p>Sauvegarde téléchargeable, journal de toutes les actions, mots de passe protégés, connexion limitée contre les tentatives suspectes.</p></div>
        </div>
      </div></section>

      <section id="places" className="places" style={{ marginTop: 96 }}><div className="wrap in">
        <div>
          <h2>50 boutiques, pas une de plus.</h2>
          <p className="sub">Pour que chaque boutique reste suivie de près, la plateforme est limitée à 50 boutiques au total, à vie. Une fois les places prises, il n’y en a plus.</p>
          <div className="count"><span>{left}</span>{left > 1 ? 'places restantes' : left === 1 ? 'place restante' : 'place restante : complet'} sur {LIFETIME_MAX_SHOPS}</div>
          <div className="cta" style={{ marginTop: 28 }}><a className="btn sun" href={contact}>Réserver ma place</a></div>
        </div>
        <div className="dots" role="img" aria-label={`${taken} boutiques créées sur ${LIFETIME_MAX_SHOPS}`}>
          {Array.from({ length: LIFETIME_MAX_SHOPS }, (_, i) => <i key={i} className={i < taken ? 't' : ''} />)}
        </div>
      </div></section>

      <section id="offre" className="offer"><div className="wrap in">
        <div>
          <h2>Un abonnement. Aucune commission.</h2>
          <p className="sub">Vous gardez 100 % de vos ventes : le client vous paie à la livraison ou comme vous en convenez sur WhatsApp. Vous ne payez que l’abonnement de votre boutique.</p>
          <div className="cta" style={{ marginTop: 28 }}><a className="btn main" href={contact}>Demander le tarif</a></div>
        </div>
        <ul className="list">
          <li><b>Mensuel ou annuel</b>, réglé par Mobile Money ou carte</li>
          <li><b>Prolongation automatique</b> dès que le paiement est confirmé</li>
          <li><b>Aucun frais caché</b> : hébergement, images et sécurité inclus</li>
          <li><b>Votre boutique d’abord</b> : importée avec vos produits existants si vous en avez déjà</li>
        </ul>
      </div></section>

      <div className="wrap end"><h2>Votre boutique peut ouvrir cette semaine.</h2><div className="cta"><a className="btn main" href={contact}>Créer ma boutique</a>{demo && <a className="btn line" href={demo}>Voir une boutique réelle</a>}</div></div>
      <footer><div className="wrap"><span>© {new Date().getFullYear()} {name}</span><span>{root ? `${root}` : ''}</span></div></footer>
    </>
  );
  const title = `${name} : créez votre boutique en ligne, commandes sur WhatsApp`;
  const desc = 'Votre catalogue en ligne en un après-midi. Vos clients commandent, le message arrive prêt sur WhatsApp. Sans commission, 50 boutiques maximum.';
  const ld = [{ '@context': 'https://schema.org', '@type': 'Organization', name, url: origin, logo: origin + '/landing/og.png' },
    { '@context': 'https://schema.org', '@type': 'WebSite', name, url: origin, inLanguage: 'fr' },
    { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name, applicationCategory: 'BusinessApplication', operatingSystem: 'Web', description: desc, url: origin, image: origin + '/landing/og.png' }];
  const html = `<!DOCTYPE html>\n<html lang="fr" data-k="l"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(origin + '/')}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta name="robots" content="index,follow,max-image-preview:large"><meta property="og:site_name" content="${esc(name)}"><meta property="og:url" content="${esc(origin + '/')}"><meta property="og:image" content="${esc(origin + '/landing/og.png')}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(origin + '/landing/og.png')}"><meta property="og:type" content="website"><meta property="og:locale" content="fr_FR"><meta name="theme-color" content="#0D3B2C">
<link rel="icon" type="image/png" sizes="32x32" href="/icon/32"><link rel="apple-touch-icon" href="/icon/192"><link rel="preload" href="/fonts/bricolage.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/landing/landing.css?v=${VER}">
${ld.map(j => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('')}<script src="/assets/a.js?v=${VER}" defer></script></head><body>${renderChild(body)}</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300, s-maxage=300', 'X-Content-Type-Options': 'nosniff' } });
}
