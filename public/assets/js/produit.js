/* Fiche produit */
(() => {
'use strict';
const { $, $$, esc, fcfa, toast, cart, lightbox, store, wish } = window.FQ;
const P = window.FQ_PRODUCT;
const main = $('#galMain'), thumbs = $('#galThumbs'), qty = $('#qty');
let variant = null;

// Galerie
if (main) {
  main.addEventListener('click', e => { if (e.target.tagName === 'IMG') lightbox(e.target.dataset.full || e.target.src, e.target.alt); });
  if (thumbs) {
    thumbs.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; main.scrollTo({ left: main.clientWidth * +b.dataset.i, behavior: 'smooth' }); });
    let t; main.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(() => { const i = Math.round(main.scrollLeft / main.clientWidth); $$('button', thumbs).forEach((b, k) => b.classList.toggle('on', k === i)); }, 60); }, { passive: true });
  }
}

// Quantité
const maxQty = () => Math.min(99, variant?.max ?? P.max ?? 99);
const clamp = () => { qty.value = Math.max(1, Math.min(maxQty() || 99, parseInt(qty.value) || 1)); };
$('#qMinus').addEventListener('click', () => { qty.value = (parseInt(qty.value) || 1) - 1; clamp(); });
$('#qPlus').addEventListener('click', () => { qty.value = (parseInt(qty.value) || 1) + 1; clamp(); });
qty.addEventListener('change', clamp);

// Variantes
$$('#variants input').forEach(r => r.addEventListener('change', () => {
  variant = { id: +r.value, price: +r.dataset.price, label: r.dataset.label, max: r.dataset.max === '' ? null : +r.dataset.max };
  $('#pdPrice').textContent = fcfa(variant.price); $('#varChosen').textContent = '· ' + variant.label;
  const s = $('#pdStock'); if (variant.max != null) { s.textContent = variant.max <= 3 ? `Plus que ${variant.max} en stock` : 'En stock'; s.className = 'stock ' + (variant.max <= 3 ? 'warn' : 'ok'); }
  clamp();
}));

function item() {
  if (P.hasVariants && !variant) { toast('Choisissez une option', true); $('#variants').scrollIntoView({ behavior: 'smooth', block: 'center' }); return null; }
  return { id: P.id, v: variant?.id || 0, n: P.name, p: variant?.price ?? P.price, i: P.image || '', l: variant?.label || '', s: P.slug, max: variant?.max ?? P.max };
}
function add(open) {
  const it = item(); if (!it) return;
  clamp(); const ok = cart.add(it, parseInt(qty.value) || 1);
  if (ok && open) cart.checkout();
}
$('#addBtn').addEventListener('click', () => add(false));
$('#buyNow')?.addEventListener('click', () => add(true));
$('#stickyAdd')?.addEventListener('click', () => add(false));
$('#copyLink').addEventListener('click', async () => {
  const url = location.origin + location.pathname + '?slug=' + encodeURIComponent(P.slug);
  try { if (navigator.share) await navigator.share({ title: P.name, url }); else { await navigator.clipboard.writeText(url); toast('Lien copié'); } } catch {}
});

// Barre d'achat collante (mobile) quand le bouton principal sort de l'écran
const sticky = $('#stickyBuy');
if (sticky && 'IntersectionObserver' in window) new IntersectionObserver(es => { sticky.hidden = es[0].isIntersecting || window.innerWidth >= 860; }).observe($('#addBtn'));
wish.sync();
})();
