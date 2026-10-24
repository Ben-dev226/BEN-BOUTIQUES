import Shell from '@/components/Shell';
import { platformPage } from '@/components/PlatformHome';
import { htmlPage } from '@/lib/html';
import { getShop } from '@/lib/shop';
import { normalizePhone } from '@/lib/util';

type Sec = [string, string[]];
const page = async (kind: 'privacy' | 'terms') => {
  const shop = await getShop(); if (!shop) return platformPage();
  const s = shop.s, wa = normalizePhone(s.whatsapp), contact = [wa && `WhatsApp : +${wa}`, s.email, s.address].filter(Boolean).join(' · ') || 'via les moyens de contact indiqués en bas de page';
  const days = Math.max(90, Number(process.env.ORDERS_ARCHIVE_AFTER_DAYS || 180));
  const ga = !!(s.ga4_id || s.meta_pixel_id);
  const secs: Sec[] = kind === 'privacy' ? [
    ['Qui sommes-nous', [`${s.shop_name} exploite cette boutique en ligne. Pour toute question sur vos données : ${contact}.`]],
    ['Données collectées', ['Lors d\'une commande : votre nom, votre numéro de téléphone, votre adresse de livraison (si livraison) et une éventuelle note. Ces informations servent uniquement à préparer, livrer et confirmer votre commande, et à vous recontacter à son sujet.', 'Nous ne vendons ni ne louons vos données. Elles sont hébergées chez nos prestataires techniques (base de données et stockage de la plateforme).']],
    ['Mesure d\'audience', ['Nous comptons les visites de manière anonyme, sans cookie et sans enregistrer votre adresse IP : seuls des totaux (visiteurs, pages vues, produits consultés) sont conservés.', ...(ga ? [`Cette boutique utilise aussi ${[s.ga4_id && 'Google Analytics', s.meta_pixel_id && 'le Pixel Meta (Facebook)'].filter(Boolean).join(' et ')} pour mesurer et améliorer ses publicités et son audience. Ces services peuvent déposer des cookies. Vous pouvez les refuser dans les réglages de votre navigateur ou activer « Ne pas suivre ».`] : [])]],
    ['Stockage sur votre appareil', ['Votre panier, vos favoris et vos informations de commande sont enregistrés dans votre navigateur pour vous éviter de les ressaisir. Vous pouvez les effacer à tout moment en vidant les données du site.']],
    ['Durée de conservation', [`Le détail des commandes (adresse, notes) est effacé automatiquement après environ ${days} jours ; seuls des totaux de ventes sont gardés à des fins statistiques.`]],
    ['Vos droits', [`Vous pouvez demander l'accès, la correction ou la suppression de vos données en nous contactant (${contact}).`]],
  ] : [
    ['Commander', ['Vous choisissez vos articles, validez votre panier et renseignez vos coordonnées. Votre commande est ensuite confirmée avec vous par WhatsApp ou par téléphone : elle n\'est définitive qu\'après cette confirmation.']],
    ['Prix', [`Les prix sont indiqués en ${s.currency || 'FCFA'}, toutes taxes comprises. Ils peuvent évoluer, mais le prix appliqué est celui affiché au moment de votre commande, sauf erreur manifeste.`]],
    ['Livraison et retrait', [s.delivery_note || 'Les frais et délais de livraison sont confirmés lors de la prise de commande.', ...(Number(s.delivery_fee) ? [`Frais de livraison standard : ${Number(s.delivery_fee).toLocaleString('fr-FR')} ${s.currency || 'FCFA'}.`] : []), ...(Number(s.free_delivery_min) ? [`Livraison offerte à partir de ${Number(s.free_delivery_min).toLocaleString('fr-FR')} ${s.currency || 'FCFA'} d'achats.`] : []), ...(s.pickup_enabled === '1' ? ['Le retrait en boutique est possible : nous vous indiquons le lieu et l\'heure lors de la confirmation.'] : [])]],
    ['Paiement', ['Le paiement s\'effectue à la livraison ou au retrait, sauf accord différent convenu avec la boutique lors de la confirmation.']],
    ['Disponibilité', ['Les stocks sont mis à jour régulièrement. Si un article devient indisponible après votre commande, nous vous le signalons et vous proposons une alternative ou l\'annulation.']],
    ['Retours et échanges', ['Si un article ne correspond pas à votre commande ou présente un défaut, contactez-nous dès la réception : nous cherchons avec vous une solution (échange ou remboursement) selon les conditions convenues lors de la vente.']],
    ['Contact', [`${s.shop_name} : ${contact}.`]],
  ];
  const title = kind === 'privacy' ? 'Politique de confidentialité' : 'Conditions de vente';
  return htmlPage(shop, { title, description: `${title} de ${s.shop_name}.`, canonical: kind === 'privacy' ? '/confidentialite' : '/conditions', kind: 'o' }, (
    <Shell shop={shop}>
      <section className="page narrow">
        <h1>{title}</h1>
        <p className="muted">Dernière mise à jour : {new Date().toISOString().slice(0, 10)}</p>
        {secs.map(([h, ps]) => <div key={h}><h2>{h}</h2>{ps.map((t, i) => <p key={i}>{t}</p>)}</div>)}
      </section>
    </Shell>));
};
export const privacyPage = () => page('privacy');
export const termsPage = () => page('terms');
