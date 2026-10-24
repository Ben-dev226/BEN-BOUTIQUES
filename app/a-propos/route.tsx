import Shell from '@/components/Shell';
import { platformPage } from '@/components/PlatformHome';
import { htmlPage } from '@/lib/html';
import { getShop } from '@/lib/shop';
import { normalizePhone, renderRich } from '@/lib/util';

export const dynamic = 'force-dynamic';
export async function GET() {
  const shop = await getShop(); if (!shop) return platformPage();
  const s = shop.s, wa = normalizePhone(s.whatsapp);
  return htmlPage(shop, { title: 'À propos', description: s.about_text.slice(0, 160), canonical: '/a-propos' }, (
    <Shell shop={shop} nav="propos">
      <section className="page narrow">
        <span className="eyebrow dark">Notre histoire</span>
        <h1>À propos de {s.shop_name}</h1>
        <div className="prose big" dangerouslySetInnerHTML={{ __html: renderRich(s.about_text) }} />
        <div className="values">
          <div><strong>Qualité contrôlée</strong><p>Chaque article est vérifié avant d&apos;être mis en vente.</p></div>
          <div><strong>Prix justes</strong><p>Des tarifs clairs, sans mauvaise surprise.</p></div>
          <div><strong>Commande simple</strong><p>Panier en ligne, confirmation et échanges sur WhatsApp.</p></div>
          <div><strong>Livraison rapide</strong><p>{s.delivery_note}</p></div>
        </div>
        <div className="contact-card">
          <h2>Nous contacter</h2>
          {wa && <p><a className="btn btn-wa" href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer">Écrire sur WhatsApp</a></p>}
          {s.address && <p>{s.address}</p>}{s.hours && <p>{s.hours}</p>}
          {s.email && <p><a href={`mailto:${s.email}`}>{s.email}</a></p>}
        </div>
      </section>
    </Shell>
  ));
}
