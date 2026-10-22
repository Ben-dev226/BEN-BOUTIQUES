import type { NextRequest } from 'next/server';
import Shell from '@/components/Shell';
import ProductCard from '@/components/ProductCard';
import { platformPage } from '@/components/PlatformHome';
import { htmlPage } from '@/lib/html';
import { getShop, queryProducts } from '@/lib/shop';
import { one } from '@/lib/db';

export const dynamic = 'force-dynamic';
/** Page catégorie : rendue côté serveur, indexable (les filtres JS de l'accueil ne le sont pas). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const shop = await getShop(); if (!shop) return platformPage();
  const slug = decodeURIComponent((await params).slug);
  const cat = await one<{ name: string; slug: string }>('SELECT name, slug FROM categories WHERE tenant_id = $1 AND slug = $2', [shop.tenant.id, slug]);
  if (!cat) return htmlPage(shop, { title: 'Catégorie introuvable', noindex: true }, (
    <Shell shop={shop}><section className="page narrow center"><h1>Catégorie introuvable</h1><a className="btn btn-red" href="/">Retour au catalogue</a></section></Shell>), 404);
  const { products, total } = await queryProducts(shop, { category: cat.slug }, 60, '');
  const url = `/c/${encodeURIComponent(cat.slug)}`;
  const ld = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: `${cat.name} – ${shop.s.shop_name}`, url: shop.origin + url,
    breadcrumb: { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Accueil', item: shop.origin + '/' }, { '@type': 'ListItem', position: 2, name: cat.name, item: shop.origin + url }] },
    mainEntity: { '@type': 'ItemList', numberOfItems: total, itemListElement: products.slice(0, 30).map((p: any, i: number) => ({ '@type': 'ListItem', position: i + 1, url: shop.origin + p.url, name: p.name })) } };
  return htmlPage(shop, { title: cat.name, description: `${cat.name} : ${total} produit${total > 1 ? 's' : ''} chez ${shop.s.shop_name}. Commande en ligne, confirmation par WhatsApp.`, kind: 'c', canonical: url, noindex: total === 0, jsonld: ld }, (
    <Shell shop={shop} nav="catalogue">
      <section className="page">
        <nav className="crumbs" aria-label="Fil d'Ariane"><a href="/">Accueil</a> / <span>{cat.name}</span></nav>
        <h1>{cat.name}</h1>
        <p className="muted">{total} produit{total > 1 ? 's' : ''}</p>
        <div className="grid">{products.map((p: any) => <ProductCard key={p.id} p={p} />)}</div>
      </section>
    </Shell>));
}
