import { fcfa } from '@/lib/util';

/** Doit rester aligné avec cardHTML() de public/assets/js/core.js. */
export default function ProductCard({ p }: { p: any }) {
  return (
    <article className="card" data-id={p.id} data-name={p.name} data-price={p.price} data-img={p.thumb ?? ''} data-slug={p.slug}>
      <a className="card-media" href={p.url}>
        {p.thumb ? <img src={p.thumb} alt={p.name} loading="lazy" decoding="async" width={480} height={480} /> : <div className="ph">{p.name.slice(0, 1)}</div>}
        <span className="tags">
          {!p.in_stock ? <span className="tag tag-out">Épuisé</span> : <>
            {p.is_new && <span className="tag">Nouveau</span>}
            {p.discount_pct ? <span className="tag tag-sale">-{p.discount_pct}%</span> : p.low_stock ? <span className="tag tag-warn">Plus que {p.stock_qty}</span> : null}
          </>}
        </span>
      </a>
      <button className="heart" data-wish={p.id} aria-label="Ajouter aux favoris" aria-pressed="false"><svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" /></svg></button>
      <div className="card-body">
        <div className="cat">{p.category_name ?? ''}</div>
        <h3><a href={p.url}>{p.name}</a></h3>
        <div className="card-foot">
          <div className="prices"><span className="price">{fcfa(p.price)}</span>{p.compare_price ? <s className="old">{fcfa(p.compare_price)}</s> : null}</div>
          {p.has_variants ? <a className="quick" href={p.url} aria-label="Choisir les options">⋯</a> : p.in_stock ? <button className="quick" data-add={p.id} aria-label="Ajouter au panier">+</button> : null}
        </div>
      </div>
    </article>
  );
}
