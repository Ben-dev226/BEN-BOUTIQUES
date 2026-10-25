import type { NextRequest } from 'next/server';
import { hostFromHeaders } from '@/lib/tenant';
import { htmlPage } from '@/lib/html';
import Shell from '@/components/Shell';
import ProductCard from '@/components/ProductCard';
import { getShop, queryProducts } from '@/lib/shop';
import { rows } from '@/lib/db';
import { normalizePhone } from '@/lib/util';
import { platformPage } from '@/components/PlatformHome';

const SORTS = ['price_asc', 'price_desc', 'name', 'popular', 'discount'];

export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const shop = await getShop();
  if (!shop) {
    const h = hostFromHeaders(req.headers);
    if (process.env.ROOT_DOMAIN && h === 'super.' + process.env.ROOT_DOMAIN) return Response.redirect(`https://${h}/super`, 307);
    return await platformPage();
  }
  const sp = req.nextUrl.searchParams;
  const q: Record<string, string> = {};
  for (const k of ['q', 'category', 'sort', 'min', 'max', 'promo', 'new', 'in_stock']) q[k] = sp.get(k) ?? '';
  const sort = SORTS.includes(q.sort) ? q.sort : '';
  const size = Number(process.env.PAGE_SIZE || 12);
  const [{ products, total }, cats] = await Promise.all([queryProducts(shop, q, size, sort), rows(`SELECT c.name, c.slug, (SELECT COUNT(*)::int FROM products p WHERE p.category_id = c.id AND p.status = 'active') AS n FROM categories c WHERE c.tenant_id = $1 ORDER BY c.position, lower(c.name)`, [shop.tenant.id])]);
  const filtered = Object.entries(q).some(([k, v]) => k !== 'sort' && v !== '');
  const { s } = shop, wa = normalizePhone(s.whatsapp);
  const social = [s.facebook, s.instagram, s.tiktok].filter(Boolean);
  const ld = [{ '@context': 'https://schema.org', '@type': 'OnlineStore', '@id': shop.origin + '/#store', name: s.shop_name, url: shop.origin + '/', description: s.meta_description, image: shop.origin + '/icon/512', logo: shop.origin + '/icon/512',
    address: s.address ? { '@type': 'PostalAddress', streetAddress: s.address } : undefined, telephone: wa ? '+' + wa : undefined, email: s.email || undefined, openingHours: s.hours || undefined, currenciesAccepted: 'XOF', sameAs: social.length ? social : undefined },
    { '@context': 'https://schema.org', '@type': 'WebSite', name: s.shop_name, url: shop.origin + '/', potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: shop.origin + '/?q={search_term_string}' }, 'query-input': 'required name=search_term_string' } }];
  const page = (
    <Shell shop={shop} nav="catalogue" scripts={['index.js']}>
      {!filtered && (
        <section className="hero"><div className="hero-in">
          <span className="eyebrow">{s.tagline}</span>
          <h1>{s.hero_title}</h1><p>{s.hero_text}</p>
          <div className="hero-cta">
            <a className="btn btn-red" href="#catalogue">Voir le catalogue</a>
            {wa && <a className="btn btn-ghost" href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer">Nous contacter</a>}
          </div>
          <ul className="hero-points"><li>✓ Commande en 2 minutes</li><li>✓ Confirmation par WhatsApp</li><li>✓ Livraison rapide</li></ul>
        </div></section>
      )}
      <section className="catalogue" id="catalogue" data-total={total} data-pages={Math.ceil(total / size)}>
        <div className="filters" id="filters">
          <div className="search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input type="search" id="q" placeholder="Rechercher un produit…" defaultValue={q.q} aria-label="Rechercher" enterKeyHint="search" /></div>
          <select id="sort" aria-label="Trier" defaultValue={sort}>
            {[['', 'Pertinence'], ['price_asc', 'Prix croissant'], ['price_desc', 'Prix décroissant'], ['name', 'Nom A–Z'], ['popular', 'Populaires'], ['discount', 'Meilleures remises']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <button className="btn btn-ghost-dark" id="moreFilters" aria-expanded="false" aria-controls="advFilters">Filtres</button>
        </div>
        <div className="adv" id="advFilters" hidden>
          <label>Prix min <input type="number" id="min" min={0} step={500} inputMode="numeric" defaultValue={q.min} placeholder="0" /></label>
          <label>Prix max <input type="number" id="max" min={0} step={500} inputMode="numeric" defaultValue={q.max} placeholder="∞" /></label>
          <label className="chk"><input type="checkbox" id="fNew" defaultChecked={!!q.new} /> Nouveautés</label>
          <label className="chk"><input type="checkbox" id="fPromo" defaultChecked={!!q.promo} /> En promo</label>
          <label className="chk"><input type="checkbox" id="fStock" defaultChecked={!!q.in_stock} /> En stock</label>
          <button className="btn-link" id="resetFilters" type="button">Réinitialiser</button>
        </div>
        <div className="chips" id="chips" role="tablist" aria-label="Catégories">
          <button className={`chip ${q.category ? '' : 'on'}`} data-cat="">Tout</button>
          {cats.filter(c => c.n).map(c => <button key={c.slug} className={`chip ${q.category === c.slug ? 'on' : ''}`} data-cat={c.slug}>{c.name} <small>{c.n}</small></button>)}
        </div>
        <div className="result-line"><span id="count">{total} produit{total > 1 ? 's' : ''}</span><button className="btn-link" id="showWish" hidden>Voir mes favoris</button></div>
        <div className="grid" id="grid" aria-live="polite">
          {products.map(p => <ProductCard key={p.id as number} p={p} />)}
          {!products.length && <div className="empty"><p>Aucun produit ne correspond à votre recherche.</p><button className="btn btn-red" id="emptyReset">Voir tout le catalogue</button></div>}
        </div>
        <div className="more" id="more"><button className="btn btn-ghost-dark" id="loadMore" hidden={total <= size}>Voir plus de produits</button></div>
      </section>
    </Shell>
  );
  return htmlPage(shop, { kind: 'h', canonical: '/', noindex: Object.keys(Object.fromEntries(sp)).length > 0, jsonld: ld }, page);
}
