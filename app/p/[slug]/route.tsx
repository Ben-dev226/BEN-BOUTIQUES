import type { NextRequest } from 'next/server';
import { headers } from 'next/headers';
import Shell from '@/components/Shell';
import ProductCard from '@/components/ProductCard';
import { platformPage } from '@/components/PlatformHome';
import { htmlPage } from '@/lib/html';
import { getShop, plainText } from '@/lib/shop';
import { loadProductDetail, countView, isBot } from '@/lib/api/public';
import { sessionUserFromCookieHeader } from '@/lib/api/ctx';
import { fcfa } from '@/lib/util';

export const dynamic = 'force-dynamic';
const jsonScript = (o: unknown) => JSON.stringify(o).replace(/</g, '\\u003c');

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const shop = await getShop(); if (!shop) return platformPage();
  const h = await headers(), preview = req.nextUrl.searchParams.has('preview');
  const user = await sessionUserFromCookieHeader(h.get('cookie'), shop.tenant);
  const P: any = await loadProductDetail(shop.tenant.id, shop.s, { slug: decodeURIComponent((await params).slug) }, preview && !!user);
  if (!P) return htmlPage(shop, { title: 'Produit introuvable', noindex: true }, (
    <Shell shop={shop}><section className="page narrow center"><h1>Produit introuvable</h1><p>Ce produit n&apos;existe plus ou n&apos;est plus disponible.</p><a className="btn btn-red" href="/">Retour au catalogue</a></section></Shell>
  ), 404);
  const s = shop.s;
  if (!user && !isBot(h.get('user-agent') || '')) await countView(shop.tenant.id, P.id);
  const hasVar = P.variants.length > 0;
  const absUrl = (u: string) => (u.startsWith('http') ? u : shop.origin + u);
  const plain = plainText(P.description || '');
  const desc = (plain || `${P.name} – ${fcfa(P.price)} chez ${s.shop_name}`).slice(0, 180);
  const ld: any = { '@context': 'https://schema.org', '@type': 'Product', name: P.name, description: desc, sku: P.sku || String(P.id), image: P.images.map((i: any) => absUrl(i.url)),
    offers: { '@type': 'Offer', url: shop.origin + P.url, priceCurrency: 'XOF', price: P.price, availability: 'https://schema.org/' + (P.in_stock ? 'InStock' : 'OutOfStock') } };
  if (P.category_name) ld.category = P.category_name;
  ld.brand = { '@type': 'Brand', name: s.shop_name };
  ld.offers.seller = { '@type': 'Organization', name: s.shop_name };
  ld.offers.priceValidUntil = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
  ld.offers.itemCondition = 'https://schema.org/NewCondition';
  const crumbs = [{ name: 'Accueil', url: '/' }, ...(P.category ? [{ name: P.category_name, url: `/c/${encodeURIComponent(P.category)}` }] : []), { name: P.name, url: P.url }];
  const ldAll = [ld, { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: shop.origin + c.url })) }];
  const share = encodeURIComponent(shop.origin + P.url);
  return htmlPage(shop, { title: P.name, description: desc, canonical: P.url, image: P.images[0]?.url, type: 'product', kind: 'p', pid: P.id, notrack: preview, noindex: preview, jsonld: ldAll }, (
    <Shell shop={shop} scripts={['produit.js']}>
      <section className="page product" id="product" data-id={P.id}>
        <nav className="crumbs" aria-label="Fil d'Ariane"><a href="/">Accueil</a> / {P.category && <><a href={`/c/${encodeURIComponent(P.category)}`}>{P.category_name}</a> / </>}<span>{P.name}</span></nav>
        <div className="pd-grid">
          <div className="gallery">
            <div className="gal-main" id="galMain">
              {P.images.length ? P.images.map((im: any, i: number) => <img key={im.id} src={im.url} alt={im.alt || P.name} width={im.width || undefined} height={im.height || undefined} loading={i ? 'lazy' : undefined} {...(i ? {} : { fetchPriority: 'high' as const })} data-full={im.url} />)
                : <div className="ph big">{P.name.slice(0, 1)}</div>}
            </div>
            {P.images.length > 1 && <div className="gal-thumbs" id="galThumbs">{P.images.map((im: any, i: number) => <button key={im.id} className={i ? '' : 'on'} data-i={i} aria-label={`Image ${i + 1}`}><img src={im.thumb} alt="" loading="lazy" /></button>)}</div>}
          </div>
          <div className="pd-info">
            <div className="tags inline">{P.is_new && <span className="tag">Nouveau</span>}{P.discount_pct ? <span className="tag tag-sale">-{P.discount_pct}%</span> : null}</div>
            <h1>{P.name}</h1>
            <div className="pd-price"><span className="price" id="pdPrice">{fcfa(P.price)}</span>{P.compare_price ? <s className="old">{fcfa(P.compare_price)}</s> : null}</div>
            <p className={`stock ${P.in_stock ? (P.low_stock ? 'warn' : 'ok') : 'out'}`} id="pdStock">{!P.in_stock ? 'Épuisé' : P.low_stock ? `Plus que ${P.stock_qty} en stock` : 'En stock'}</p>
            {hasVar && <fieldset className="variants" id="variants"><legend>Option <span id="varChosen" className="muted" /></legend>
              {P.variants.map((v: any) => <label key={v.id} className={`var ${v.in_stock ? '' : 'off'}`}><input type="radio" name="variant" value={v.id} data-price={v.price} data-label={v.label} data-max={v.stock_qty ?? ''} disabled={!v.in_stock} /><span>{v.label}</span></label>)}
            </fieldset>}
            <div className="buy-row">
              <div className="qty" aria-label="Quantité"><button type="button" id="qMinus" aria-label="Moins">−</button><input id="qty" type="number" defaultValue={1} min={1} max={99} inputMode="numeric" /><button type="button" id="qPlus" aria-label="Plus">+</button></div>
              <button className="btn btn-red btn-lg" id="addBtn" disabled={!P.in_stock}>{P.in_stock ? 'Ajouter au panier' : 'Indisponible'}</button>
            </div>
            {P.in_stock && <button className="btn btn-wa btn-lg block" id="buyNow">Commander maintenant</button>}
            <ul className="assure"><li>Confirmation de la commande par WhatsApp</li><li>{s.delivery_note}</li><li>Paiement à la livraison</li></ul>
            <div className="share"><span>Partager :</span>
              <a target="_blank" rel="noopener noreferrer" href={`https://wa.me/?text=${encodeURIComponent(P.name + ' – ' + shop.origin + P.url)}`}>WhatsApp</a>
              <a target="_blank" rel="noopener noreferrer" href={`https://www.facebook.com/sharer/sharer.php?u=${share}`}>Facebook</a>
              <button type="button" id="copyLink">Copier le lien</button>
            </div>
            {P.description_html && <div className="prose"><h2>Description</h2><div dangerouslySetInnerHTML={{ __html: P.description_html }} /></div>}
          </div>
        </div>
        {P.related.length > 0 && <section className="related"><h2>Vous aimerez aussi</h2><div className="grid">{P.related.map((r: any) => <ProductCard key={r.id} p={r} />)}</div></section>}
      </section>
      <div className="sticky-buy" id="stickyBuy" hidden>
        <div><strong>{fcfa(P.price)}</strong><span>{P.name}</span></div>
        <button className="btn btn-red" id="stickyAdd" disabled={!P.in_stock}>Ajouter</button>
      </div>
      <script dangerouslySetInnerHTML={{ __html: 'window.FQ_PRODUCT=' + jsonScript({ id: P.id, slug: P.slug, name: P.name, price: P.price, image: P.thumb, hasVariants: hasVar, inStock: P.in_stock, max: P.stock_qty }) + ';' }} />
    </Shell>
  ));
}
