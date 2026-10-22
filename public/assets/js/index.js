/* Catalogue : filtres, recherche, pagination progressive, favoris */
(() => {
'use strict';
const { $, $$, esc, fcfa, api, store, wish, toast } = window.FQ;
document.body.dataset.page = 'catalogue';
const grid = $('#grid'), more = $('#loadMore'), sec = $('#catalogue');
const SIZE = 12;
let st = { page: 1, pages: +sec.dataset.pages || 1, total: +sec.dataset.total, loading: false, favs: false };
let ctl = null;

function params() {
  const g = id => $('#' + id);
  return { q: g('q').value.trim(), category: $('.chip.on')?.dataset.cat || '', sort: g('sort').value, min: g('min').value, max: g('max').value,
    new: g('fNew').checked, promo: g('fPromo').checked, in_stock: g('fStock').checked };
}
function pushURL() {
  const p = params(), u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) u.set(k, v === true ? '1' : v);
  if (st.favs) u.set('favs', '1');
  history.replaceState(null, '', location.pathname + (u.toString() ? '?' + u : '') + '#catalogue');
}

function cardHTML(p) {
  const img = p.thumb ? `<img src="${esc(p.thumb)}" alt="${esc(p.name)}" loading="lazy" decoding="async" width="480" height="480">` : `<div class="ph">${esc(p.name[0] || '?')}</div>`;
  let tags = '';
  if (!p.in_stock) tags = '<span class="tag tag-out">Épuisé</span>';
  else { if (p.is_new) tags += '<span class="tag">Nouveau</span>'; if (p.discount_pct) tags += `<span class="tag tag-sale">-${p.discount_pct}%</span>`; else if (p.low_stock) tags += `<span class="tag tag-warn">Plus que ${p.stock_qty}</span>`; }
  const act = p.has_variants ? `<a class="quick" href="${esc(p.url)}" aria-label="Choisir les options">⋯</a>` : (p.in_stock ? `<button class="quick" data-add="${p.id}" aria-label="Ajouter au panier">+</button>` : '');
  return `<article class="card" data-id="${p.id}" data-name="${esc(p.name)}" data-price="${p.price}" data-img="${esc(p.thumb || '')}" data-slug="${esc(p.slug)}">
    <a class="card-media" href="${esc(p.url)}">${img}<span class="tags">${tags}</span></a>
    <button class="heart" data-wish="${p.id}" aria-label="Ajouter aux favoris" aria-pressed="false"><svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg></button>
    <div class="card-body"><div class="cat">${esc(p.category_name || '')}</div><h3><a href="${esc(p.url)}">${esc(p.name)}</a></h3>
    <div class="card-foot"><div class="prices"><span class="price">${fcfa(p.price)}</span>${p.compare_price ? `<s class="old">${fcfa(p.compare_price)}</s>` : ''}</div>${act}</div></div></article>`;
}

function skeletons(n = 4) { grid.insertAdjacentHTML('beforeend', Array(n).fill('<div class="skeleton sk"></div>').join('')); }

async function load(reset) {
  if (st.loading && !reset) return;
  ctl?.abort(); ctl = new AbortController(); st.loading = true;
  if (reset) { st.page = 1; grid.innerHTML = ''; } else st.page++;
  skeletons(reset ? 8 : 4); more.hidden = true;
  try {
    const p = params();
    if (st.favs) p.ids = wish.ids().join(',') || '0';
    const d = await api('products', { params: { ...p, page: st.page }, signal: ctl.signal });
    $$('.sk', grid).forEach(s => s.remove());
    st.pages = d.pages; st.total = d.total;
    if (!d.products.length && reset) grid.innerHTML = `<div class="empty"><p>${st.favs ? 'Aucun favori pour le moment. Touchez le cœur d\'un produit pour l\'ajouter.' : 'Aucun produit ne correspond à votre recherche.'}</p><button class="btn btn-red" id="emptyReset">Voir tout le catalogue</button></div>`;
    else grid.insertAdjacentHTML('beforeend', d.products.map(cardHTML).join(''));
    $('#count').textContent = `${d.total} produit${d.total > 1 ? 's' : ''}${st.favs ? ' en favoris' : ''}`;
    wish.sync(grid);
    more.hidden = st.page >= st.pages;
  } catch (e) {
    if (e.name === 'AbortError') return;
    $$('.sk', grid).forEach(s => s.remove()); toast('Impossible de charger les produits', true); more.hidden = false;
  } finally { st.loading = false; }
}

function change() { pushURL(); load(true); }
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

$('#q').addEventListener('input', debounce(() => { st.favs = false; change(); }, 300));
$('#sort').addEventListener('change', change);
['min', 'max'].forEach(id => $('#' + id).addEventListener('input', debounce(change, 500)));
['fNew', 'fPromo', 'fStock'].forEach(id => $('#' + id).addEventListener('change', change));
$('#chips').addEventListener('click', e => { const c = e.target.closest('.chip'); if (!c) return; $$('.chip').forEach(x => x.classList.toggle('on', x === c)); st.favs = false; change(); });
$('#moreFilters').addEventListener('click', e => { const a = $('#advFilters'); a.hidden = !a.hidden; e.currentTarget.setAttribute('aria-expanded', !a.hidden); });
function reset() {
  $('#q').value = ''; $('#sort').value = ''; $('#min').value = ''; $('#max').value = '';
  ['fNew', 'fPromo', 'fStock'].forEach(id => $('#' + id).checked = false);
  $$('.chip').forEach(x => x.classList.toggle('on', !x.dataset.cat)); st.favs = false; change();
}
$('#resetFilters').addEventListener('click', reset);
document.addEventListener('click', e => { if (e.target.id === 'emptyReset') reset(); });
more.addEventListener('click', () => load(false));
$('#showWish').addEventListener('click', () => { st.favs = true; change(); window.scrollTo({ top: sec.offsetTop - 70, behavior: 'smooth' }); });
document.addEventListener('fq:showwish', () => { st.favs = true; change(); sec.scrollIntoView({ behavior: 'smooth' }); });
document.addEventListener('fq:wish', () => { $('#showWish').hidden = !wish.ids().length || st.favs; if (st.favs) { /* retire immédiatement les cartes dé-favorisées */ $$('.card', grid).forEach(c => { if (!wish.has(c.dataset.id)) c.remove(); }); } });

// défilement infini
if ('IntersectionObserver' in window) {
  new IntersectionObserver(es => { if (es[0].isIntersecting && !more.hidden && !st.loading && st.page < st.pages) load(false); }, { rootMargin: '400px' }).observe($('#more'));
}
// état initial : la page 1 est déjà rendue côté serveur
more.hidden = st.pages <= 1;
wish.sync(grid);
if (new URLSearchParams(location.search).get('favs')) { st.favs = true; load(true); }
})();
