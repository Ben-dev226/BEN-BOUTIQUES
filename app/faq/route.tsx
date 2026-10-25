import Shell from '@/components/Shell';
import { platformPage } from '@/components/PlatformHome';
import { htmlPage } from '@/lib/html';
import { getShop } from '@/lib/shop';
import { renderRich, parseFaq } from '@/lib/util';

export const dynamic = 'force-dynamic';
export async function GET() {
  const shop = await getShop(); if (!shop) return platformPage();
  const text = shop.s.page_faq.trim();
  if (!text) return htmlPage(shop, { title: 'Page introuvable', noindex: true }, <Shell shop={shop}><section className="page narrow center"><h1>Page introuvable</h1><a className="btn btn-red" href="/">Retour à la boutique</a></section></Shell>, 404);
  const qa = parseFaq(text);
  const ld = qa.length ? { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: qa.slice(0, 30).map(x => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a.replace(/\*\*?/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') } })) } : undefined;
  return htmlPage(shop, { title: 'Questions fréquentes', description: `Questions fréquentes sur ${shop.s.shop_name}.`, canonical: '/faq', jsonld: ld, kind: 'o' }, (
    <Shell shop={shop}>
      <section className="page narrow">
        <h1>Questions fréquentes</h1>
        <div className="prose" dangerouslySetInnerHTML={{ __html: renderRich(text) }} />
      </section>
    </Shell>));
}
