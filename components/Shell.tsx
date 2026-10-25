type ReactNode = any;
import type { Shop } from '@/lib/shop';
import { normalizePhone, safeHttpUrl } from '@/lib/util';
import { assetUrl } from '@/lib/storage';

export const Brand = ({ name }: { name: string }) => {
  const p = name.trim().split(/\s+/);
  if (p.length < 2) return <>{name}</>;
  const last = p.pop();
  return <>{p.join(' ')}<span>{last}</span></>;
};
const V = '20261027';

export default function Shell({ shop, nav = '', scripts = [], children }: { shop: Shop; nav?: string; scripts?: string[]; children: ReactNode }) {
  const { s } = shop, wa = normalizePhone(s.whatsapp), logo = s.logo_url ? assetUrl(s.logo_url) : null;
  const brand = logo ? <img src={logo} alt={s.shop_name} className="brand-logo" style={{ maxHeight: 40, width: 'auto' }} /> : <Brand name={s.shop_name} />;
  return (
    <>
      <a className="skip" href="#main">Aller au contenu</a>
      {s.announcement && <div className="announce">{s.announcement}</div>}
      <header className="site-header">
        <a className="brand" href="/" aria-label={`${s.shop_name} – accueil`}>{brand}</a>
        <nav className="main-nav" id="mainNav" aria-label="Navigation principale">
          <a href="/#catalogue" className={nav === 'catalogue' ? 'on' : ''}>Catalogue</a>
          <a href="/?new=1#catalogue">Nouveautés</a>
          <a href="/?promo=1#catalogue">Promos</a>
          <a href="/a-propos" className={nav === 'propos' ? 'on' : ''}>À propos</a>
          <a href="/suivi" className={nav === 'suivi' ? 'on' : ''}>Suivre ma commande</a>
        </nav>
        <div className="header-actions">
          <button className="icon-btn" id="wishBtn" aria-label="Mes favoris" title="Mes favoris">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" /></svg>
            <span className="badge" id="wishBadge" hidden>0</span>
          </button>
          <button className="cart-btn" id="cartBtn" aria-label="Ouvrir le panier">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" /></svg>
            <span className="cart-label">Panier</span><span className="badge" id="cartBadge" hidden>0</span>
          </button>
          <button className="icon-btn burger" id="burger" aria-label="Menu" aria-expanded="false" aria-controls="mainNav"><span /><span /><span /></button>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="site-footer">
        <div className="footer-grid">
          <div>
            <div className="brand brand-lg">{brand}</div>
            <p>{s.tagline}</p>
            <div className="socials">
              {([['facebook', 'Facebook'], ['instagram', 'Instagram'], ['tiktok', 'TikTok']] as const).map(([k, l]) => s[k] && safeHttpUrl(s[k]) ? <a key={k} href={safeHttpUrl(s[k])!} target="_blank" rel="noopener noreferrer">{l}</a> : null)}
            </div>
          </div>
          <div>
            <h4>Boutique</h4>
            <a href="/#catalogue">Catalogue</a><a href="/?new=1#catalogue">Nouveautés</a><a href="/?promo=1#catalogue">Promotions</a><a href="/suivi">Suivre ma commande</a>{s.page_faq.trim() && <a href="/faq">FAQ</a>}
          </div>
          <div>
            <h4>Contact</h4>
            {wa && <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer">WhatsApp : +{wa}</a>}
            {s.email && <a href={`mailto:${s.email}`}>{s.email}</a>}
            {s.address && <span>{s.address}</span>}
            {s.hours && <span>{s.hours}</span>}
          </div>
        </div>
        <p className="copy">© {new Date().getFullYear()} {s.shop_name} – Tous droits réservés · <a href="/conditions">Conditions de vente</a> · <a href="/confidentialite">Confidentialité</a></p>
      </footer>
      {wa && (
        <a className="wa-float" href={`https://wa.me/${wa}?text=${encodeURIComponent("Bonjour, j'aimerais avoir des informations sur vos produits.")}`} target="_blank" rel="noopener noreferrer" aria-label="Discuter sur WhatsApp">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35M12.05 21.8a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.83 9.83 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.89 9.88M20.46 3.49A11.8 11.8 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.9 11.9 0 0 0 5.69 1.45c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.17-3.48-8.42" /></svg>
        </a>
      )}
      <div className="overlay" id="overlay" hidden />
      <aside className="drawer" id="drawer" aria-label="Panier" aria-hidden="true" tabIndex={-1}>
        <div className="drawer-head"><h2 id="drawerTitle">Mon panier</h2><button className="x" id="drawerClose" aria-label="Fermer">✕</button></div>
        <div className="drawer-body" id="drawerBody" /><div className="drawer-foot" id="drawerFoot" />
      </aside>
      <div className="toast" id="toast" role="status" aria-live="polite" />
      <div className="lightbox" id="lightbox" hidden><button className="x" aria-label="Fermer">✕</button><img alt="" /></div>
      <script src={`/assets/js/core.js?v=${V}`} />
      {scripts.map(x => <script key={x} src={`/assets/js/${x}?v=${V}`} />)}
    </>
  );
}
