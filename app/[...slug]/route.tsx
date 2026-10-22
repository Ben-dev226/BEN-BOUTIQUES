import Shell from '@/components/Shell';
import { platformPage } from '@/components/PlatformHome';
import { htmlPage } from '@/lib/html';
import { getShop } from '@/lib/shop';

export const dynamic = 'force-dynamic';
/** Page 404 de la boutique (toute adresse qui ne correspond à aucune autre route). */
export async function GET() {
  const shop = await getShop(); if (!shop) return platformPage();
  return htmlPage(shop, { title: 'Page introuvable', noindex: true }, (
    <Shell shop={shop}><section className="page narrow center"><h1>Page introuvable</h1><p>Cette page n&apos;existe pas ou a été déplacée.</p><a className="btn btn-red" href="/">Retour à la boutique</a></section></Shell>
  ), 404);
}
