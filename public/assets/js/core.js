/* Noyau boutique : utilitaires, panier, favoris, tiroir de commande */
(() => {
'use strict';
const FQ = window.FQ, BASE = FQ.base, S = FQ.settings;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fcfa = n => Number(n || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ') + ' FCFA';
/* Stockage propre à chaque boutique : sans domaine, toutes les boutiques partagent la même adresse (même localStorage), il faut donc préfixer. */
const NS = BASE === '/' ? '' : BASE;
const store = {
  get(k, d) { try { const v = localStorage.getItem(NS + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch {} }
};

async function api(route, { method = 'GET', params = {}, body, signal } = {}) {
  const qs = new URLSearchParams({ r: route });
  for (const [k, v] of Object.entries(params)) if (v !== '' && v != null && v !== false) qs.set(k, v === true ? '1' : v);
  const res = await fetch(`${BASE}api/index.php?${qs}`, {
    method, signal, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin'
  });
  let data = null; try { data = await res.json(); } catch {}
  if (!res.ok) { const e = new Error(data?.error || 'Erreur réseau'); e.data = data; e.status = res.status; throw e; }
  return data;
}

let toastT;
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.classList.toggle('err', err); t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

// ── Favoris ───────────────────────────────────────────────
const wish = {
  ids: () => store.get('fq_wish', []),
  has: id => wish.ids().includes(Number(id)),
  toggle(id) {
    id = Number(id); let a = wish.ids();
    a = a.includes(id) ? a.filter(x => x !== id) : [...a, id];
    store.set('fq_wish', a); wish.sync(); return a.includes(id);
  },
  sync(root = document) {
    const a = wish.ids();
    $$('[data-wish]', root).forEach(b => b.setAttribute('aria-pressed', a.includes(+b.dataset.wish)));
    const bd = $('#wishBadge'); bd.textContent = a.length; bd.hidden = !a.length;
    document.dispatchEvent(new CustomEvent('fq:wish'));
  }
};

// ── Panier ────────────────────────────────────────────────
const key = (id, v) => `${id}:${v || 0}`;
let cart = store.get('fq_cart2', []);
let view = 'cart', promo = null, issues = [], busy = false;
const save = () => { store.set('fq_cart2', cart); badge(); };
const count = () => cart.reduce((s, i) => s + i.q, 0);
const subtotal = () => cart.reduce((s, i) => s + i.p * i.q, 0);
function badge() { const b = $('#cartBadge'); b.textContent = count(); b.hidden = !count(); }

function addToCart(it, qty = 1) {
  const k = key(it.id, it.v), ex = cart.find(c => key(c.id, c.v) === k);
  const max = it.max ?? ex?.max ?? 99;
  const nq = Math.min((ex ? ex.q : 0) + qty, 99, max || 99);
  if (nq <= (ex?.q || 0) && ex) { toast('Quantité maximale en stock atteinte', true); return false; }
  if (ex) Object.assign(ex, { q: nq, p: it.p, max: it.max ?? ex.max });
  else cart.push({ id: it.id, v: it.v || 0, q: Math.min(qty, max || 99), n: it.n, p: it.p, i: it.i || '', l: it.l || '', s: it.s || '', max: it.max ?? null });
  save(); promo = null;
  FQ.track && FQ.track('cart', it.id, { value: it.p * qty, items: [{ item_id: String(it.id), item_name: it.n, price: it.p, quantity: qty }], content_ids: [String(it.id)], content_type: 'product' });
  toast(`${it.n} ajouté au panier`);
  return true;
}

async function refreshCart() {
  if (!cart.length) return;
  try {
    const d = await api('cart/refresh', { method: 'POST', body: { items: cart.map(c => ({ id: c.id, variant_id: c.v, qty: c.q })) } });
    const byKey = Object.fromEntries(d.lines.map(l => [l.key, l]));
    const removed = new Set((d.issues || []).filter(i => i.remove).map(i => i.key));
    cart = cart.filter(c => !removed.has(key(c.id, c.v)) && byKey[key(c.id, c.v)]).map(c => {
      const l = byKey[key(c.id, c.v)];
      return { ...c, n: l.name, p: l.unit_price, q: l.qty, i: l.image || c.i, l: l.variant_label, max: l.max, s: l.slug };
    });
    issues = d.issues || [];
    save();
  } catch { /* hors-ligne : on garde le panier local */ }
}

const drawer = $('#drawer'), overlay = $('#overlay');
let lastFocus = null;
function openDrawer(v = 'cart') {
  view = v; lastFocus = document.activeElement; if (v === 'checkout') FQ.track && FQ.track('checkout', 0, { value: subtotal() });
  overlay.hidden = false; requestAnimationFrame(() => overlay.classList.add('show'));
  drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden';
  render(); refreshCart().then(render); drawer.focus();
}
function closeDrawer() {
  drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); overlay.classList.remove('show');
  setTimeout(() => { overlay.hidden = true; }, 250); document.body.style.overflow = '';
  lastFocus?.focus?.();
}

function thumb(i) { return i.i ? `<img src="${esc(i.i)}" alt="" loading="lazy">` : `<div class="ph">${esc(i.n[0] || '?')}</div>`; }

function totals() {
  const sub = subtotal(); const disc = promo ? Math.min(promo.discount, sub) : 0;
  const mode = $('input[name=mode]:checked')?.value || 'delivery';
  const fee = mode === 'pickup' ? 0 : ((+S.free_delivery_min > 0 && sub - disc >= +S.free_delivery_min) ? 0 : +S.delivery_fee || 0);
  return { sub, disc, fee, total: sub - disc + fee, mode };
}
function sumHTML(t) {
  return `<div class="sum"><div><span>Sous-total</span><span>${fcfa(t.sub)}</span></div>
    ${t.disc ? `<div class="disc"><span>Remise ${esc(promo.code)}</span><span>-${fcfa(t.disc)}</span></div>` : ''}
    <div><span>Livraison</span><span>${t.mode === 'pickup' ? 'Retrait boutique' : (t.fee ? fcfa(t.fee) : (+S.delivery_fee ? 'Offerte' : 'À confirmer'))}</span></div>
    <div class="tot"><span>Total</span><span>${fcfa(t.total)}</span></div></div>`;
}

function render() {
  const body = $('#drawerBody'), foot = $('#drawerFoot'), title = $('#drawerTitle');
  if (view === 'cart') {
    title.textContent = 'Mon panier';
    if (!cart.length) {
      body.innerHTML = `<div class="empty-cart"><div class="big"></div><p>Votre panier est vide.<br>Ajoutez des articles pour commander.</p></div>`; foot.hidden = true; return;
    }
    body.innerHTML = (issues.length ? `<div class="notice">${issues.map(i => esc(i.problem)).join('<br>')}</div>` : '') +
      cart.map(i => `<div class="line" data-k="${key(i.id, i.v)}">${thumb(i)}
        <div><a class="nm" href="${BASE}p/${encodeURIComponent(i.s)}" style="text-decoration:none">${esc(i.n)}</a>${i.l ? `<div class="vl">${esc(i.l)}</div>` : ''}
        <div class="lp">${fcfa(i.p)} × ${i.q} = ${fcfa(i.p * i.q)}</div>
        <div class="mini-qty"><button data-d="-1" aria-label="Moins">−</button><b>${i.q}</b><button data-d="1" aria-label="Plus">+</button></div></div>
        <button class="rm" data-rm aria-label="Retirer ${esc(i.n)}">✕</button></div>`).join('');
    foot.hidden = false;
    foot.innerHTML = `<div class="sum"><div class="tot"><span>Sous-total</span><span>${fcfa(subtotal())}</span></div></div>
      <button class="btn btn-red block btn-lg" id="goCheckout">Commander</button>
      <button class="btn-link" id="clearCart" style="margin-top:.7rem;display:block;margin-inline:auto;color:#888">Vider le panier</button>`;
  } else if (view === 'checkout') {
    title.textContent = 'Finaliser la commande';
    const me = store.get('fq_me', {}), t = totals();
    const pick = S.pickup_enabled === '1';
    body.innerHTML = `<form class="form" id="coForm" novalidate>
      <div id="coErr"></div>
      <label>Nom complet<input name="name" required autocomplete="name" value="${esc(me.name || '')}" maxlength="80"></label>
      <label>Téléphone / WhatsApp<input name="phone" required type="tel" inputmode="tel" autocomplete="tel" placeholder="70 12 34 56" value="${esc(me.phone || '')}"></label>
      ${pick ? `<div class="seg"><label><input type="radio" name="mode" value="delivery" checked><span>Livraison</span></label><label><input type="radio" name="mode" value="pickup"><span>Retrait</span></label></div>` : '<input type="hidden" name="mode" value="delivery">'}
      <label id="addrWrap">Quartier / adresse de livraison<textarea name="address" maxlength="300" placeholder="Ex. : Gounghin, près de la pharmacie…">${esc(me.address || '')}</textarea></label>
      <label>Note (facultatif)<input name="note" maxlength="500" placeholder="Taille, couleur, heure de livraison…"></label>
      <div class="hp" aria-hidden="true"><input name="website" tabindex="-1" autocomplete="off"></div>
      <label>Code promo<span class="promo-row"><input id="promoIn" placeholder="Votre code" value="${esc(promo?.code || '')}" autocapitalize="characters"><button type="button" class="btn btn-ghost-dark" id="promoBtn">Appliquer</button></span></label>
      <p class="muted" style="font-size:.8rem">${esc(S.delivery_note || '')}</p>
      <div id="coSum">${sumHTML(t)}</div></form>`;
    foot.hidden = false;
    foot.innerHTML = `<button class="btn btn-red block btn-lg" id="coSubmit" form="coForm">Confirmer la commande</button>
      <button class="btn-link" id="backCart" style="margin-top:.7rem;display:block;margin-inline:auto;color:#888">← Modifier le panier</button>`;
    syncAddr();
  } else if (view === 'done') {
    title.textContent = 'Commande enregistrée';
    const d = drawer._done; foot.hidden = true;
    body.innerHTML = `<div class="done"><div class="ok">✓</div><h3>Merci ${esc(d.name.split(' ')[0])} !</h3>
      <div class="num">${esc(d.order.number)}</div>
      <p>Dernière étape : envoyez votre commande sur WhatsApp pour que nous la confirmions.</p>
      <a class="btn btn-wa btn-lg block" href="${esc(d.whatsapp_url)}" target="_blank" rel="noopener">Envoyer sur WhatsApp</a>
      <a class="btn btn-ghost-dark block" href="${esc(d.tracking_url || BASE + 'suivi?n=' + encodeURIComponent(d.order.number))}">Suivre ma commande</a>
      <button class="btn-link" id="closeDone" style="margin-top:1rem">Continuer mes achats</button></div>`;
  }
}

function syncAddr() {
  const w = $('#addrWrap'); if (!w) return;
  w.hidden = ($('input[name=mode]:checked')?.value === 'pickup');
}

async function submitOrder(e) {
  e.preventDefault();
  if (busy) return;
  const f = e.target, v = Object.fromEntries(new FormData(f));
  const err = $('#coErr'), show = m => { err.innerHTML = `<div class="notice err" role="alert">${esc(m)}</div>`; err.scrollIntoView({ block: 'nearest' }); };
  if (!v.name.trim()) return show('Indiquez votre nom');
  if (v.phone.replace(/\D/g, '').length < 8) return show('Numéro de téléphone invalide');
  if (v.mode === 'delivery' && v.address.trim().length < 3) return show('Indiquez votre quartier ou adresse de livraison');
  busy = true; const btn = $('#coSubmit'); btn.disabled = true; btn.textContent = 'Envoi en cours…';
  try {
    const d = await api('orders', { method: 'POST', body: { name: v.name, phone: v.phone, delivery_mode: v.mode, address: v.address, note: v.note, website: v.website, promo: promo?.code || '',
      items: cart.map(c => ({ id: c.id, variant_id: c.v, qty: c.q })) } });
    store.set('fq_me', { name: v.name, phone: v.phone, address: v.address });
    FQ.track && FQ.track('order', 0, { value: subtotal(), transaction_id: d.number || undefined }); drawer._done = { ...d, name: v.name }; cart = []; promo = null; issues = []; save(); view = 'done'; render();
  } catch (ex) {
    if (ex.data?.issues) { issues = ex.data.issues; await refreshCart(); view = 'cart'; render(); toast(ex.message, true); }
    else show(ex.message);
    btn.disabled = false; btn.textContent = 'Confirmer la commande';
  } finally { busy = false; }
}

async function applyPromo() {
  const code = $('#promoIn').value.trim(); if (!code) { promo = null; return render(); }
  try {
    const d = await api('promo/check', { method: 'POST', body: { code, items: cart.map(c => ({ id: c.id, variant_id: c.v, qty: c.q })) } });
    promo = d; toast(`Code ${d.code} appliqué : -${fcfa(d.discount)}`);
  } catch (ex) { promo = null; toast(ex.message, true); }
  const keep = Object.fromEntries(new FormData($('#coForm'))); render();
  for (const [k, val] of Object.entries(keep)) { const el = $(`#coForm [name=${k}]`); if (el && el.type !== 'radio') el.value = val; else if (el) $$(`#coForm [name=${k}]`).forEach(r => r.checked = r.value === val); }
  syncAddr(); $('#coSum').innerHTML = sumHTML(totals());
}

drawer.addEventListener('click', e => {
  const t = e.target.closest('button,a'); if (!t) return;
  const line = t.closest('.line');
  if (t.dataset.d && line) { const it = cart.find(c => key(c.id, c.v) === line.dataset.k); const nq = it.q + +t.dataset.d;
    if (nq < 1) return; if (it.max != null && nq > it.max) return toast('Stock maximum atteint', true); it.q = Math.min(99, nq); promo = null; save(); render(); }
  else if (t.dataset.rm !== undefined && line) { cart = cart.filter(c => key(c.id, c.v) !== line.dataset.k); promo = null; save(); render(); }
  else if (t.id === 'goCheckout') { view = 'checkout'; render(); }
  else if (t.id === 'backCart') { view = 'cart'; render(); }
  else if (t.id === 'clearCart') { cart = []; promo = null; save(); render(); }
  else if (t.id === 'promoBtn') applyPromo();
  else if (t.id === 'closeDone') closeDrawer();
});
drawer.addEventListener('submit', e => { if (e.target.id === 'coForm') submitOrder(e); });
drawer.addEventListener('change', e => { if (e.target.name === 'mode') { syncAddr(); $('#coSum').innerHTML = sumHTML(totals()); } });
$('#drawerClose').addEventListener('click', closeDrawer);
overlay.addEventListener('click', closeDrawer);
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (drawer.classList.contains('open')) closeDrawer(); const lb = $('#lightbox'); if (!lb.hidden) lb.hidden = true; } });
$('#cartBtn').addEventListener('click', () => openDrawer('cart'));

// ── Interactions globales ─────────────────────────────────
$('#burger').addEventListener('click', e => { const n = $('#mainNav'); const o = n.classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', o); });
$('#wishBtn').addEventListener('click', () => {
  if (document.body.dataset.page === 'catalogue') document.dispatchEvent(new CustomEvent('fq:showwish'));
  else location.href = `${BASE}?favs=1#catalogue`;
});
document.addEventListener('click', e => {
  const add = e.target.closest('[data-add]');
  if (add) { const c = add.closest('.card'); if (c && addToCart({ id: +c.dataset.id, n: c.dataset.name, p: +c.dataset.price, i: c.dataset.img, s: c.dataset.slug })) { add.classList.add('done'); add.textContent = '✓'; setTimeout(() => { add.classList.remove('done'); add.textContent = '+'; }, 1200); } return; }
  const w = e.target.closest('[data-wish]');
  if (w) { e.preventDefault(); const on = wish.toggle(w.dataset.wish); toast(on ? 'Ajouté aux favoris' : 'Retiré des favoris'); }
  const lb = e.target.closest('.lightbox'); if (lb && e.target !== lb.querySelector('img')) lb.hidden = true;
});
function lightbox(src, alt) { const l = $('#lightbox'); $('img', l).src = src; $('img', l).alt = alt || ''; l.hidden = false; }

badge(); wish.sync();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register(`${BASE}sw.js`, { scope: BASE }).catch(() => {});

Object.assign(window.FQ, { $, $$, esc, fcfa, api, toast, store, wish, lightbox, cart: { add: addToCart, open: openDrawer, checkout: () => openDrawer('checkout'), count } });
})();
