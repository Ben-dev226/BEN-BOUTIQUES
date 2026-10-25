/* Admin – noyau : API, utilitaires, routeur, tableau de bord, commandes */
'use strict';
const PFX = (location.pathname.match(/^(.*?)\/admin(?:\/|$)/) || [, ''])[1];   // « /fifi » en mode chemin, « » sinon
const A = window.A = { routes: [], user: null, csrf: '', shop: {}, cats: [] };
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fcfa = n => Number(n || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ') + ' FCFA';
const d2 = s => s ? new Date(s.replace(' ', 'T') + 'Z') : null;
const fmtDT = s => s ? d2(s).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const fmtD = s => s ? d2(s + (s.length <= 10 ? ' 00:00:00' : '')).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
const STATUS = { new: 'Nouvelle', confirmed: 'Confirmée', shipped: 'En livraison', delivered: 'Livrée', cancelled: 'Annulée' };
const NEXT = { new: ['confirmed', 'Confirmer'], confirmed: ['shipped', 'Marquer en livraison'], shipped: ['delivered', 'Marquer livrée'] };
const pill = (cls, txt) => `<span class="pill ${cls}">${esc(txt)}</span>`;
const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

async function api(route, { method = 'GET', params = {}, body, form } = {}) {
  const qs = new URLSearchParams({ r: route });
  for (const [k, v] of Object.entries(params)) if (v !== '' && v != null && v !== false) qs.set(k, v === true ? '1' : v);
  const headers = {};
  if (method !== 'GET') headers['X-CSRF-Token'] = A.csrf;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${PFX}/api/index.php?${qs}`, { method, headers, body: form || (body ? JSON.stringify(body) : undefined), credentials: 'same-origin' });
  let data = null; try { data = await res.json(); } catch {}
  if (res.status === 401) { location.replace(PFX + '/admin/login.html'); throw new Error('Session expirée'); }
  if (!res.ok) { const e = new Error(data?.error || 'Erreur réseau'); e.data = data; e.status = res.status; throw e; }
  return data;
}
let tT;
function toast(msg, err = false) { const t = $('#toast'); t.textContent = msg; t.classList.toggle('err', err); t.classList.add('show'); clearTimeout(tT); tT = setTimeout(() => t.classList.remove('show'), 3000); }
const fail = e => toast(e.message || 'Erreur', true);

function modal(html, { lg = false, onClose } = {}) {
  const w = document.createElement('div'); w.className = 'modal-wrap';
  w.innerHTML = `<div class="modal ${lg ? 'lg' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => { w.remove(); document.removeEventListener('keydown', esc_); onClose?.(); };
  const esc_ = e => { if (e.key === 'Escape') close(); };
  w.addEventListener('mousedown', e => { if (e.target === w) close(); });
  document.addEventListener('keydown', esc_);
  document.body.appendChild(w);
  $$('[data-close]', w).forEach(b => b.addEventListener('click', close));
  const f = $('input,select,textarea', w); f?.focus();
  return { el: w, close, $: s => $(s, w), $$: s => $$(s, w) };
}
function confirmBox(msg, { ok = 'Supprimer', danger = true } = {}) {
  return new Promise(res => {
    const m = modal(`<h2>Confirmation</h2><p>${esc(msg)}</p><div class="foot"><button class="btn" data-close>Annuler</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cOk">${esc(ok)}</button></div>`, { onClose: () => res(false) });
    m.$('#cOk').addEventListener('click', () => { res(true); m.el.remove(); });
  });
}
function pager(p, onGo) {
  if (p.pages <= 1) return `<div class="pager"><span>${p.total} résultat${p.total > 1 ? 's' : ''}</span></div>`;
  return `<div class="pager"><span>${p.total} résultats · page ${p.page}/${p.pages}</span><div><button class="btn sm" data-pg="${p.page - 1}" ${p.page <= 1 ? 'disabled' : ''}>← Précédent</button><button class="btn sm" data-pg="${p.page + 1}" ${p.page >= p.pages ? 'disabled' : ''}>Suivant →</button></div></div>`;
}
function bindPager(root, fn) { $$('[data-pg]', root).forEach(b => b.addEventListener('click', () => fn(+b.dataset.pg))); }

// ── Routeur ───────────────────────────────────────────────
A.route = (re, fn, nav) => A.routes.push({ re, fn, nav });
let cleanup = null;
A.onLeave = fn => { cleanup = fn; };
async function navigate() {
  cleanup?.(); cleanup = null;
  const h = location.hash.replace(/^#/, '') || '/dashboard';
  const view = $('#view');
  for (const r of A.routes) {
    const m = h.match(r.re);
    if (!m) continue;
    $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.nav === r.nav));
    $('#side').classList.remove('open'); $('.scrim')?.remove();
    view.innerHTML = '<div class="loading"><span class="spin"></span></div>';
    try { await r.fn(view, ...m.slice(1)); } catch (e) { if (e.message !== 'Session expirée') view.innerHTML = `<div class="notice err">${esc(e.message)}</div>`; }
    window.scrollTo(0, 0);
    return;
  }
  location.hash = '#/dashboard';
}

// ── Coquille ──────────────────────────────────────────────
const NAV = [
  ['dashboard', '', 'Tableau de bord'], ['audience', '', 'Audience'], ['reports', '', 'Rapports'], ['orders', '', 'Commandes'], ['products', '', 'Produits'], ['categories', '', 'Catégories'],
  ['customers', '', 'Clients'], ['promos', '', 'Codes promo'], ['sep', '', 'Administration'],
  ['appearance', '', 'Apparence', 1], ['pages', '', 'Pages', 1], ['settings', '', 'Paramètres', 1], ['users', '', 'Utilisateurs', 1], ['activity', '', 'Journal', 1],
];
function buildShell() {
  $('#nav').innerHTML = NAV.filter(n => !n[3] || A.user.role === 'admin').map(n => n[0] === 'sep' && A.user.role !== 'admin' ? '' :
    n[0] === 'sep' ? `<div class="sep">${n[2]}</div>` : `<a href="#/${n[0]}" data-nav="${n[0]}">${n[1]} ${n[2]}${n[0] === 'orders' ? '<span class="nbadge" id="ordBadge" hidden>0</span>' : ''}</a>`).join('');
  $('#meName').textContent = A.user.name || A.user.username; $('#meRole').textContent = A.user.role === 'admin' ? 'Administrateur' : 'Gestionnaire';
  const n = (A.shop.shop_name || 'Admin').split(' '), l = n.pop();
  $('#logo').innerHTML = `${esc(n.join(' '))} <span>${esc(l)}</span><small>Espace gestion</small>`;
  document.title = `Admin – ${A.shop.shop_name || ''}`;
  $('#menuBtn').onclick = () => { $('#side').classList.add('open'); const s = document.createElement('div'); s.className = 'scrim'; s.onclick = () => { $('#side').classList.remove('open'); s.remove(); }; document.body.appendChild(s); };
  $('#outBtn').onclick = async () => { try { await api('auth/logout', { method: 'POST' }); } catch {} location.replace(PFX + '/admin/login.html'); };
  $('#pwBtn').onclick = () => passwordModal(false);
}
function passwordModal(forced) {
  const m = modal(`<h2>${forced ? 'Choisissez un nouveau mot de passe' : 'Changer mon mot de passe'}${forced ? '' : '<button data-close aria-label="Fermer">✕</button>'}</h2>
    ${forced ? '<p class="notice" style="margin-bottom:1rem">Pour votre sécurité, vous devez remplacer le mot de passe initial avant de continuer.</p>' : ''}
    <form class="stack" id="pwF"><div id="pwErr"></div>
    <label class="f">Mot de passe actuel<input type="password" name="current" autocomplete="current-password" required></label>
    <label class="f">Nouveau mot de passe<small>8 caractères minimum, avec lettres et chiffres</small><input type="password" name="new" autocomplete="new-password" required minlength="8"></label>
    <label class="f">Confirmer<input type="password" name="again" autocomplete="new-password" required></label>
    <div class="foot">${forced ? '' : '<button type="button" class="btn" data-close>Annuler</button>'}<button class="btn primary">Enregistrer</button></div></form>`);
  if (forced) { m.el.onmousedown = null; }
  m.$('#pwF').addEventListener('submit', async e => {
    e.preventDefault(); const v = Object.fromEntries(new FormData(e.target));
    const err = t => m.$('#pwErr').innerHTML = `<div class="notice err">${esc(t)}</div>`;
    if (v.new !== v.again) return err('Les deux mots de passe ne correspondent pas');
    try { await api('auth/password', { method: 'POST', body: { current: v.current, new: v.new } }); toast('Mot de passe modifié'); m.el.remove(); if (forced) location.reload(); } catch (x) { err(x.message); }
  });
  return m;
}

async function pollOrders() {
  try {
    const d = await api('admin/orders', { params: { size: 5, status: 'new' } });
    const n = d.status_counts.new, b = $('#ordBadge');
    if (b) { b.textContent = n; b.hidden = !n; }
    document.title = (n ? `(${n}) ` : '') + `Admin – ${A.shop.shop_name || ''}`;
  } catch {}
}

(async function boot() {
  try {
    const [me, shop] = await Promise.all([fetch(PFX + '/api/index.php?r=auth/me', { credentials: 'same-origin' }).then(r => r.json()), fetch(PFX + '/api/index.php?r=settings').then(r => r.json())]);
    if (!me.user) return location.replace(PFX + '/admin/login.html');
    Object.assign(A, { user: me.user, csrf: me.csrf, shop });
    $('#app').hidden = false; buildShell();
    if (me.user.must_change_password) return passwordModal(true);
    A.cats = (await api('admin/categories')).categories;
    window.addEventListener('hashchange', navigate); navigate();
    pollOrders(); setInterval(pollOrders, 60000);
  } catch (e) { document.body.innerHTML = `<p style="padding:2rem">Impossible de charger l'administration : ${esc(e.message)}</p>`; }
})();
Object.assign(A, { $, $$, esc, fcfa, fmtDT, fmtD, d2, STATUS, NEXT, pill, debounce, api, toast, fail, modal, confirmBox, pager, bindPager, passwordModal, pollOrders });

// ══ Tableau de bord ═══════════════════════════════════════
A.route(/^\/dashboard$/, async (view) => {
  let days = +(sessionStorage.getItem('fq_days') || 30);
  const draw = async () => {
    const d = await api('admin/stats', { params: { days } });
    const delta = (c, p) => { if (!p) return c ? '<span class="d up">Nouveau</span>' : '<span class="d flat">–</span>'; const x = Math.round((c - p) / p * 100); return `<span class="d ${x > 0 ? 'up' : x < 0 ? 'down' : 'flat'}">${x > 0 ? '▲' : x < 0 ? '▼' : '='} ${Math.abs(x)}% vs période préc.</span>`; };
    const c = d.current, p = d.previous, max = Math.max(1, ...d.series.map(s => s.revenue));
    const W = 720, H = 210, L = 46, B = 22, bw = (W - L) / d.series.length;
    const ticks = [0, .5, 1].map(f => ({ y: H - B - f * (H - B - 10), v: Math.round(max * f) }));
    const bars = d.series.map((s, i) => { const h = Math.max(s.revenue ? 2 : 1, s.revenue / max * (H - B - 10)); return `<rect class="bar ${s.revenue ? '' : 'zero'}" x="${(L + i * bw + bw * .12).toFixed(1)}" y="${(H - B - h).toFixed(1)}" width="${(bw * .76).toFixed(1)}" height="${h.toFixed(1)}" rx="2" data-i="${i}"/>`; }).join('');
    const xl = d.series.map((s, i) => (i % Math.ceil(d.series.length / 7) === 0) ? `<text x="${(L + i * bw + bw / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle">${s.date.slice(8)}/${s.date.slice(5, 7)}</text>` : '').join('');
    const yl = ticks.map(t => `<line class="grid" x1="${L}" x2="${W}" y1="${t.y}" y2="${t.y}"/><text x="${L - 6}" y="${t.y + 4}" text-anchor="end">${t.v >= 1000 ? Math.round(t.v / 1000) + 'k' : t.v}</text>`).join('');
    const maxCat = Math.max(1, ...d.categories.map(x => x.revenue));
    let ins = []; try { ins = (await api('admin/insights')).insights; } catch { /* facultatif */ }
    const pl = d.plan, banner = pl && pl.days_left !== null && pl.days_left <= 7 ? `<div class="card" style="margin-bottom:1rem;border-color:${pl.days_left < 0 ? '#c0392b' : '#E6B422'};background:${pl.days_left < 0 ? '#FDECEA' : '#FFF8E1'}"><b>${pl.days_left < 0 ? `Abonnement expiré : votre boutique sera suspendue dans ${Math.max(0, pl.grace_days + pl.days_left)} jour(s)` : pl.days_left === 0 ? 'Votre abonnement expire aujourd’hui' : `Votre abonnement expire dans ${pl.days_left} jour(s)`}</b><p class="small" style="margin:.3rem 0 0">Renouvelez-le pour que vos clients gardent accès à la boutique. <a href="#/settings">Renouveler maintenant</a></p></div>` : '';
    $('#dashBody').innerHTML = `
      ${banner}
      ${ins.length ? `<div class="card" style="margin-bottom:1rem"><h2>À savoir <a href="#/audience" class="small">Toute l'audience</a></h2>${insightsHtml(ins)}</div>` : ''}
      <div class="kpis">
        <div class="kpi"><div class="l">Chiffre d'affaires</div><div class="v">${fcfa(c.revenue)}</div>${delta(c.revenue, p.revenue)}</div>
        <div class="kpi"><div class="l">Commandes</div><div class="v">${c.orders}</div>${delta(c.orders, p.orders)}</div>
        <div class="kpi"><div class="l">Panier moyen</div><div class="v">${fcfa(c.avg_basket)}</div>${delta(c.avg_basket, p.avg_basket)}</div>
        <a class="kpi" href="#/orders" style="text-decoration:none"><div class="l">À traiter</div><div class="v" style="color:${d.pending_orders ? 'var(--bad)' : 'inherit'}">${d.pending_orders}</div><span class="d flat">nouvelles + confirmées</span></a>
      </div>
      <div class="dash-grid">
        <div class="card wide"><h2>Chiffre d'affaires par jour <span class="muted small">${fcfa(c.paid)} encaissés</span></h2>
          <div class="chart" id="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Chiffre d'affaires quotidien sur ${days} jours">${yl}${bars}${xl}</svg><div class="tip" id="tip" hidden></div></div>
          <details class="small" style="margin-top:.5rem"><summary class="muted">Voir en tableau</summary><div class="tbl-wrap" style="max-height:240px;overflow:auto;margin-top:.5rem"><table><thead><tr><th>Jour</th><th>Commandes</th><th>CA</th></tr></thead><tbody>${d.series.filter(s => s.orders).reverse().map(s => `<tr><td>${fmtD(s.date)}</td><td>${s.orders}</td><td>${fcfa(s.revenue)}</td></tr>`).join('') || '<tr><td colspan=3 class="muted">Aucune vente sur la période</td></tr>'}</tbody></table></div></details></div>
        <div class="card"><h2>Meilleures ventes</h2><div class="list">${d.top_products.map(t => `<div class="it">${t.thumb ? `<img class="thumb" src="${esc(t.thumb)}" alt="">` : '<div class="thumb"></div>'}<div class="g"><b>${esc(t.name)}</b><span class="muted small">${t.qty} vendu${t.qty > 1 ? 's' : ''}</span></div><b>${fcfa(t.revenue)}</b></div>`).join('') || '<div class="empty">Pas encore de ventes</div>'}</div></div>
        <div class="card"><h2>Ventes par catégorie</h2><div class="hbar">${d.categories.map(x => `<div class="row"><span class="nm">${esc(x.name)}</span><div class="track"><div class="fill" style="width:${(x.revenue / maxCat * 100).toFixed(1)}%"></div></div><b>${fcfa(x.revenue)}</b></div>`).join('') || '<div class="empty">Pas encore de ventes</div>'}</div></div>
        <div class="card"><h2>Commandes récentes <a href="#/orders" class="small">Tout voir</a></h2><div class="list">${d.latest_orders.map(o => `<a class="it" href="#/orders/${o.id}" style="text-decoration:none"><div class="g"><b>${esc(o.customer_name)}</b><span class="muted small">${esc(o.number)} · ${fmtDT(o.created_at)}</span></div>${pill(o.status, STATUS[o.status])}<b>${fcfa(o.total)}</b></a>`).join('') || '<div class="empty">Aucune commande</div>'}</div></div>
        <div class="card"><h2>Stock faible <a href="#/products?low=1" class="small">Gérer</a></h2><div class="list">${d.low_stock.map(p => `<a class="it" href="#/products/${p.id}" style="text-decoration:none">${p.thumb ? `<img class="thumb" src="${esc(p.thumb)}" alt="">` : '<div class="thumb"></div>'}<div class="g"><b>${esc(p.name)}</b></div>${pill(p.stock_qty ? 'low' : 'out', p.stock_qty ? `${p.stock_qty} restant${p.stock_qty > 1 ? 's' : ''}` : 'Épuisé')}</a>`).join('') || '<div class="empty">Aucune alerte de stock ✓</div>'}</div></div>
        <div class="card"><h2>Statut des commandes</h2><div class="hbar">${Object.entries(d.by_status).map(([k, n]) => { const tot = Math.max(1, Object.values(d.by_status).reduce((a, b) => a + b, 0)); return `<div class="row"><span class="nm">${STATUS[k]}</span><div class="track"><div class="fill" style="width:${n / tot * 100}%"></div></div><b>${n}</b></div>`; }).join('')}</div>
          <p class="muted small" style="margin-top:.8rem">${d.counts.active_products} produits en ligne · ${d.counts.inactive_products} masqués · ${d.counts.customers} clients</p></div>
      </div>`;
    const tip = $('#tip'), chart = $('#chart');
    $$('.bar', chart).forEach(r => {
      const show = () => { const s = d.series[+r.dataset.i]; tip.hidden = false; tip.innerHTML = `<b>${fmtD(s.date)}</b><br>${fcfa(s.revenue)} · ${s.orders} commande${s.orders > 1 ? 's' : ''}`; const cr = chart.getBoundingClientRect(), rr = r.getBoundingClientRect(); tip.style.left = (rr.left + rr.width / 2 - cr.left) + 'px'; tip.style.top = (rr.top - cr.top) + 'px'; };
      r.addEventListener('mouseenter', show); r.addEventListener('mouseleave', () => tip.hidden = true); r.addEventListener('click', show);
    });
  };
  view.innerHTML = `<div class="page-head"><h1>Tableau de bord</h1><div class="grow"></div><div class="seg" id="range">${[7, 30, 90].map(n => `<button data-d="${n}" class="${n === days ? 'on' : ''}">${n} jours</button>`).join('')}</div></div><div id="dashBody"><div class="loading"><span class="spin"></span></div></div>`;
  $('#range').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; days = +b.dataset.d; sessionStorage.setItem('fq_days', days); $$('#range button').forEach(x => x.classList.toggle('on', x === b)); draw().catch(fail); });
  await draw();
}, 'dashboard');

const insightsHtml = (l) => l.length ? `<div class="insights">${l.map(i => `<div class="ins l-${i.level}"><span class="ico">${i.level === 'good' ? 'Bien' : i.level === 'warn' ? 'Attention' : 'Conseil'}</span><div><b>${esc(i.title)}</b><p>${esc(i.text)}</p>${i.link ? `<a class="small" href="${esc(i.link)}">Agir →</a>` : ''}</div></div>`).join('')}</div>` : '<p class="muted small">Rien à signaler : tout va bien.</p>';
// ══ Rapports personnalisés ════════════════════════════════
A.route(/^\/reports$/, async (view) => {
  const iso = d => d.toISOString().slice(0, 10), now = new Date(), ago = n => iso(new Date(Date.now() - n * 864e5));
  let cfg = JSON.parse(sessionStorage.getItem('fq_rep') || 'null') || { dataset: 'orders', group: 'month', from: ago(89), to: iso(now) }, meta = null, timer = 0;
  const FILTERS = { status: ['Statut', Object.entries(STATUS)], payment: ['Paiement', [['unpaid', 'Non payée'], ['paid', 'Payée']]] };
  const presets = [['7 jours', 6, null], ['30 jours', 29, null], ['90 jours', 89, null], ['Ce mois', 'm0'], ['Mois dernier', 'm1'], ['Cette année', 'y']];
  const range = p => { if (typeof p[1] === 'number') return [ago(p[1]), iso(now)]; if (p[1] === 'y') return [`${now.getFullYear()}-01-01`, iso(now)]; const o = +p[1][1], a = new Date(now.getFullYear(), now.getMonth() - o, 1), b = o ? new Date(now.getFullYear(), now.getMonth(), 0) : now; const f = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; return [f(a), f(b)]; };
  const q = () => JSON.stringify(cfg);
  const cell = (v, t) => v === null || v === undefined ? '' : typeof v === 'number' ? (t === 'pct' ? v + ' %' : t === 'text' ? v : v.toLocaleString('fr-FR')) : esc(v);
  const load = async () => {
    const d = await api('admin/report', { params: { c: q() } }); meta = d; cfg = d.config; sessionStorage.setItem('fq_rep', q());
    const def = d.catalog[cfg.dataset], cols = def.columns[cfg.group] || def.columns['*'], r = d.result;
    $('#rDs').innerHTML = Object.entries(d.catalog).map(([k, v]) => `<option value="${k}" ${k === cfg.dataset ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
    $('#rGroup').innerHTML = def.groups.map(g => `<option value="${g.key}" ${g.key === cfg.group ? 'selected' : ''}>${esc(g.label)}</option>`).join('');
    $('#rPeriod').hidden = !def.period; $('#rFrom').value = cfg.from; $('#rTo').value = cfg.to;
    $('#rFilters').innerHTML = def.filters.map(f => f === 'category' ? `<label class="f">Catégorie<select data-f="category"><option value="">Toutes</option>${d.categories.map(c => `<option ${c === cfg.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>` : `<label class="f">${FILTERS[f][0]}<select data-f="${f}"><option value="">Tous</option>${FILTERS[f][1].map(([k, l]) => `<option value="${k}" ${cfg[f] === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`).join('');
    $('#rCols').innerHTML = cols.map(c => `<label class="chk"><input type="checkbox" value="${c.key}" ${cfg.columns.includes(c.key) ? 'checked' : ''}> ${esc(c.label)}</label>`).join('');
    $('#rTitle').textContent = r.title;
    $('#rTable').innerHTML = `<thead><tr>${r.columns.map(c => `<th style="${c.type !== 'text' ? 'text-align:right' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${r.rows.map(row => `<tr>${row.map((v, i) => `<td style="${r.columns[i].type !== 'text' ? 'text-align:right;white-space:nowrap' : ''}">${cell(v, r.columns[i].type)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${r.columns.length || 1}" class="muted" style="padding:1.2rem">Aucune donnée sur cette période.</td></tr>`}${r.totals ? `<tr style="font-weight:700;background:var(--mint)">${r.totals.map((v, i) => `<td style="${r.columns[i].type !== 'text' ? 'text-align:right;white-space:nowrap' : ''}">${cell(v, r.columns[i].type)}</td>`).join('')}</tr>` : ''}</tbody>`;
    $('#rNote').textContent = r.total_rows > 200 ? `Aperçu : 200 lignes sur ${r.total_rows}. Les exports contiennent tout.` : `${r.total_rows} ligne${r.total_rows > 1 ? 's' : ''}`;
    const link = f => `${PFX}/api/index.php?${new URLSearchParams({ r: 'admin/report/export', format: f, c: q() })}`;
    $('#xCsv').href = link('csv'); $('#xXlsx').href = link('xlsx'); $('#xPdf').href = link('pdf');
  };
  const refresh = (delay = 250) => { clearTimeout(timer); timer = setTimeout(() => load().catch(fail), delay); };
  const saved = async () => {
    const d = await api('admin/reports');
    $('#rSaved').innerHTML = d.reports.length ? d.reports.map(x => `<div class="it"><div class="g"><b>${esc(x.name)}</b><span class="muted small">${esc(meta?.catalog[x.config.dataset]?.label || x.config.dataset)}</span></div><button class="btn sm" data-open="${x.id}">Ouvrir</button><button class="btn sm danger" data-del="${x.id}" aria-label="Supprimer">✕</button></div>`).join('') : '<p class="muted small">Aucun rapport enregistré. Configurez un rapport puis cliquez sur « Enregistrer ».</p>';
    $('#rSaved')._r = d.reports;
  };
  view.innerHTML = `<div class="page-head"><h1>Rapports</h1><div class="grow"></div><a class="btn" id="xCsv" href="#">CSV</a><a class="btn" id="xXlsx" href="#">Excel</a><a class="btn main" id="xPdf" href="#">PDF</a></div>
    <div class="dash-grid"><div class="card wide stack"><h2>Configurer le rapport</h2>
      <div class="grid2"><label class="f">Données<select id="rDs"></select></label><label class="f">Regrouper<select id="rGroup"></select></label></div>
      <div id="rPeriod" class="stack"><div class="grid2"><label class="f">Du<input type="date" id="rFrom"></label><label class="f">Au<input type="date" id="rTo"></label></div><div class="seg" id="rPre">${presets.map((p, i) => `<button type="button" data-i="${i}">${p[0]}</button>`).join('')}</div></div>
      <div class="grid2" id="rFilters"></div>
      <div><div class="small muted" style="margin-bottom:.35rem">Colonnes à inclure</div><div id="rCols" style="display:flex;flex-wrap:wrap;gap:.4rem 1.1rem"></div></div>
      <div style="display:flex;gap:.6rem;flex-wrap:wrap;align-items:center"><button class="btn" id="rSave" type="button">Enregistrer ce rapport</button><span class="muted small">Les exports reprennent exactement ces réglages.</span></div></div>
      <div class="card"><h2>Mes rapports</h2><div class="list" id="rSaved"></div></div></div>
    <div class="card" style="margin-top:1rem"><h2 id="rTitle">Aperçu</h2><div class="tbl-wrap" style="max-height:480px;overflow:auto"><table id="rTable"></table></div><p class="muted small" id="rNote" style="margin-top:.5rem"></p></div>`;
  $('#rDs').addEventListener('change', e => { cfg = { dataset: e.target.value, from: cfg.from, to: cfg.to }; refresh(0); });
  $('#rGroup').addEventListener('change', e => { cfg.group = e.target.value; cfg.columns = []; refresh(0); });
  $('#rFrom').addEventListener('change', e => { cfg.from = e.target.value; refresh(); }); $('#rTo').addEventListener('change', e => { cfg.to = e.target.value; refresh(); });
  $('#rPre').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; [cfg.from, cfg.to] = range(presets[+b.dataset.i]); refresh(0); });
  $('#rFilters').addEventListener('change', e => { cfg[e.target.dataset.f] = e.target.value; refresh(0); });
  $('#rCols').addEventListener('change', () => { cfg.columns = $$('#rCols input:checked').map(i => i.value); refresh(0); });
  $('#rSave').addEventListener('click', async () => { const name = prompt('Nom du rapport :', meta?.result.title.split(' (')[0] || ''); if (!name) return; try { await api('admin/reports', { method: 'POST', body: { name, config: cfg } }); toast('Rapport enregistré'); await saved(); } catch (e) { fail(e); } });
  $('#rSaved').addEventListener('click', async e => { const o = e.target.closest('[data-open]'), d = e.target.closest('[data-del]');
    if (o) { cfg = $('#rSaved')._r.find(x => x.id == o.dataset.open).config; await load(); scrollTo({ top: 0, behavior: 'smooth' }); }
    if (d && confirm('Supprimer ce rapport enregistré ?')) { try { await api('admin/reports', { method: 'DELETE', params: { id: d.dataset.del } }); await saved(); } catch (x) { fail(x); } } });
  await load(); await saved();
}, 'reports');

// ══ Audience ══════════════════════════════════════════════
A.route(/^\/audience$/, async (view) => {
  let days = +(sessionStorage.getItem('fq_days') || 30);
  const bars = (l, unit = '') => { const m = Math.max(1, ...l.map(x => x.n)); return l.length ? `<div class="hbar">${l.map(x => `<div class="row"><span class="nm" title="${esc(x.name || x.ref)}">${esc(x.name || x.ref)}</span><div class="track"><div class="fill" style="width:${(x.n / m * 100).toFixed(1)}%"></div></div><b>${x.n}${unit}</b></div>`).join('')}</div>` : '<p class="muted small">Pas encore de données.</p>'; };
  const draw = async () => {
    const d = await api('admin/analytics', { params: { days } }), t = d.totals;
    const W = 720, H = 190, L = 34, B = 22, n = d.series.length, bw = (W - L) / n, max = Math.max(1, ...d.series.map(s => s.pv));
    const y = v => H - B - v / max * (H - B - 10);
    const bs = d.series.map((s, i) => `<rect class="bar ${s.uv ? '' : 'zero'}" x="${(L + i * bw + bw * .12).toFixed(1)}" y="${y(s.uv).toFixed(1)}" width="${(bw * .76).toFixed(1)}" height="${Math.max(1, H - B - y(s.uv)).toFixed(1)}"><title>${s.date} : ${s.uv} visiteur(s), ${s.pv} page(s) vue(s)</title></rect>`).join('');
    const line = d.series.map((s, i) => `${i ? 'L' : 'M'}${(L + i * bw + bw / 2).toFixed(1)},${y(s.pv).toFixed(1)}`).join('');
    const xl = d.series.map((s, i) => i % Math.ceil(n / 7) === 0 ? `<text x="${(L + i * bw + bw / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle">${s.date.slice(8)}/${s.date.slice(5, 7)}</text>` : '').join('');
    const yl = [0, .5, 1].map(f => `<line class="grid" x1="${L}" x2="${W}" y1="${y(max * f)}" y2="${y(max * f)}"/><text x="${L - 6}" y="${y(max * f) + 4}" text-anchor="end">${Math.round(max * f)}</text>`).join('');
    const funnel = [['Visiteurs', t.uv], ['Ajouts au panier', t.cart], ['Commandes lancées', t.checkout], ['Commandes reçues', t.orders]];
    const dev = d.devices.map(x => ({ ref: x.ref === 'mobile' ? 'Mobile' : 'Ordinateur', n: x.n }));
    const cl = d.clicks.map(x => ({ ref: x.ref === 'whatsapp' ? 'Clics WhatsApp' : x.ref, n: x.n }));
    $('#audBody').innerHTML = `
      <div class="card" style="margin-bottom:1rem"><h2>À savoir</h2>${insightsHtml(d.insights)}</div>
      <div class="kpis">
        <div class="kpi"><div class="l">Visiteurs</div><div class="v">${t.uv}</div><span class="d flat">par jour, sans cookie</span></div>
        <div class="kpi"><div class="l">Pages vues</div><div class="v">${t.pv}</div><span class="d flat">${t.uv ? (t.pv / t.uv).toFixed(1) : '0'} par visiteur</span></div>
        <div class="kpi"><div class="l">Commandes</div><div class="v">${t.orders}</div><span class="d flat">sur la période</span></div>
        <div class="kpi"><div class="l">Conversion</div><div class="v">${d.conversion}%</div><span class="d flat">commandes / visiteurs</span></div>
      </div>
      <div class="dash-grid">
        <div class="card wide"><h2>Visiteurs par jour <span class="muted small">la ligne montre les pages vues</span></h2>
          <div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Visiteurs et pages vues par jour">${yl}${bs}<path d="${line}" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".55"/>${xl}</svg></div></div>
        <div class="card"><h2>Parcours d'achat</h2>${bars(funnel.map(([name, n]) => ({ name, n })))}<p class="muted small" style="margin-top:.6rem">Chaque étape compte des actions, pas des personnes : un même client peut ajouter plusieurs articles.</p></div>
        <div class="card"><h2>D'où viennent les visiteurs</h2>${bars(d.sources)}</div>
        <div class="card"><h2>Produits les plus vus</h2>${bars(d.top_viewed)}</div>
        <div class="card"><h2>Produits les plus ajoutés au panier</h2>${bars(d.top_carted)}</div>
        <div class="card"><h2>Appareils</h2>${bars(dev)}</div>
        <div class="card"><h2>Contacts</h2>${bars(cl)}</div>
        <div class="card"><h2>Google Analytics et Pixel Meta</h2><p class="small">${d.integrations.ga4 ? 'Google Analytics actif' : 'Google Analytics non configuré'}<br>${d.integrations.pixel ? 'Pixel Meta actif' : 'Pixel Meta non configuré'}</p><p class="muted small">Ajoutez vos identifiants dans Paramètres → Boutique. Les visiteurs qui activent « Ne pas suivre » ne sont comptés nulle part.</p></div>
      </div>`;
  };
  view.innerHTML = `<div class="page-head"><h1>Audience</h1><div class="grow"></div><div class="seg" id="range">${[7, 30, 90].map(n => `<button data-d="${n}" class="${n === days ? 'on' : ''}">${n} jours</button>`).join('')}</div></div><div id="audBody"></div>`;
  $('#range').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; days = +b.dataset.d; sessionStorage.setItem('fq_days', days); $$('#range button').forEach(x => x.classList.toggle('on', x === b)); draw().catch(fail); });
  await draw();
}, 'audience');

// ══ Commandes ═════════════════════════════════════════════
A.route(/^\/orders(?:\/(\d+))?(?:\?.*)?$/, async (view, openId) => {
  const f = { status: '', q: '', from: '', to: '', payment: '', page: 1 };
  view.innerHTML = `<div class="page-head"><h1>Commandes</h1><div class="grow"></div><a class="btn" id="exp" href="#">Exporter CSV</a></div>
    <div class="tabs" id="tabs"></div>
    <div class="toolbar"><input type="search" id="q" placeholder="N°, nom ou téléphone…"><label class="small muted">Du <input type="date" id="from" style="width:auto"></label><label class="small muted">au <input type="date" id="to" style="width:auto"></label>
      <select id="pay"><option value="">Tous paiements</option><option value="unpaid">Non payées</option><option value="paid">Payées</option></select></div>
    <div id="list"><div class="loading"><span class="spin"></span></div></div>`;
  const load = async () => {
    const d = await api('admin/orders', { params: { ...f, size: 20 } });
    $('#tabs').innerHTML = [['', 'Toutes', Object.values(d.status_counts).reduce((a, b) => a + b, 0)], ['open', 'En cours', d.status_counts.new + d.status_counts.confirmed + d.status_counts.shipped], ...Object.entries(STATUS).map(([k, l]) => [k, l, d.status_counts[k]])]
      .map(([k, l, n]) => `<button class="tab ${f.status === k ? 'on' : ''}" data-s="${k}">${l}<small>${n}</small></button>`).join('');
    const qs = new URLSearchParams({ r: 'admin/orders/export', status: f.status, q: f.q, from: f.from, to: f.to, payment: f.payment }); $('#exp').href = `${PFX}/api/index.php?${qs}`;
    $('#list').innerHTML = d.orders.length ? `<div class="tbl-wrap"><table><thead><tr><th>N°</th><th>Date</th><th>Client</th><th>Articles</th><th>Total</th><th>Statut</th><th>Paiement</th></tr></thead><tbody>${d.orders.map(o => `<tr class="click" data-id="${o.id}"><td><b>${esc(o.number)}</b></td><td class="nowrap">${fmtDT(o.created_at)}</td><td>${esc(o.customer_name)}<div class="muted small">${esc(o.customer_phone)}</div></td><td>${o.items_count}</td><td class="nowrap"><b>${fcfa(o.total)}</b></td><td>${pill(o.status, o.status_label)}</td><td>${pill(o.payment_status, o.payment_status === 'paid' ? 'Payée' : 'À encaisser')}</td></tr>`).join('')}</tbody></table></div>${pager(d)}<p class="muted small">Total affiché hors annulées : <b>${fcfa(d.sum)}</b></p>` : '<div class="card empty">Aucune commande pour ces critères.</div>';
    $$('#list tr.click').forEach(r => r.addEventListener('click', () => location.hash = `#/orders/${r.dataset.id}`));
    bindPager($('#list'), p => { f.page = p; load().catch(fail); });
  };
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) { f.status = b.dataset.s; f.page = 1; load().catch(fail); } });
  $('#q').addEventListener('input', debounce(e => { f.q = e.target.value; f.page = 1; load().catch(fail); }));
  $('#from').addEventListener('change', e => { f.from = e.target.value; f.page = 1; load().catch(fail); });
  $('#to').addEventListener('change', e => { f.to = e.target.value; f.page = 1; load().catch(fail); });
  $('#pay').addEventListener('change', e => { f.payment = e.target.value; f.page = 1; load().catch(fail); });
  await load();
  if (openId) openOrder(+openId, load);
}, 'orders');

async function openOrder(id, reload) {
  const o = await api('admin/order', { params: { id } });
  const show = o => {
    const m = modal(`<h2>${esc(o.number)} ${pill(o.status, o.status_label)}<button data-close aria-label="Fermer">✕</button></h2>
      <div class="grid2" style="margin-bottom:1rem"><div><b>${esc(o.customer_name)}</b><div>${esc(o.customer_phone)}</div><div class="muted small">${o.delivery_mode === 'pickup' ? 'Retrait en boutique' : '' + esc(o.customer_address)}</div>${o.note ? `<div class="notice small" style="margin-top:.5rem">${esc(o.note)}</div>` : ''}</div>
        <div class="stack" style="align-content:start"><a class="btn wa" target="_blank" rel="noopener" href="${esc(o.whatsapp_customer_url)}">Écrire au client</a><a class="btn" href="tel:+${esc(o.customer_phone)}">Appeler</a></div></div>
      ${o.archived ? '<div class="notice small" style="margin-bottom:.6rem">Commande ancienne : le détail des articles a été archivé pour alléger la base. Les montants, la date et le client sont conservés.</div>' : ''}<table class="otable">${o.items.map(i => `<tr><td>${i.thumb ? `<img class="thumb" style="width:36px;height:36px" src="${esc(i.thumb)}" alt="">` : ''}</td><td>${esc(i.name)}${i.variant_label ? ` <span class="muted">(${esc(i.variant_label)})</span>` : ''}</td><td class="right nowrap">${i.qty} × ${fcfa(i.unit_price)}</td><td class="right nowrap"><b>${fcfa(i.qty * i.unit_price)}</b></td></tr>`).join('')}
        <tr class="t"><td colspan=3 class="right" style="font-weight:400">Sous-total</td><td class="right">${fcfa(o.subtotal)}</td></tr>
        ${o.discount ? `<tr><td colspan=3 class="right muted">Remise ${esc(o.promo_code)}</td><td class="right">-${fcfa(o.discount)}</td></tr>` : ''}
        <tr><td colspan=3 class="right muted">Livraison</td><td class="right">${o.delivery_mode === 'pickup' ? 'Retrait' : fcfa(o.delivery_fee)}</td></tr>
        <tr class="t"><td colspan=3 class="right">Total</td><td class="right" style="color:var(--red)">${fcfa(o.total)}</td></tr></table>
      <div class="steps" style="margin:1rem 0 .6rem">${NEXT[o.status] ? `<button class="btn primary" data-st="${NEXT[o.status][0]}">${NEXT[o.status][1]}</button>` : ''}
        ${o.status !== 'cancelled' && o.status !== 'delivered' ? '<button class="btn danger" data-st="cancelled">Annuler la commande</button>' : ''}
        ${o.status === 'cancelled' ? '<button class="btn" data-st="new">Rouvrir</button>' : ''}
        <button class="btn" data-pay="${o.payment_status === 'paid' ? 'unpaid' : 'paid'}">${o.payment_status === 'paid' ? '✓ Payée (annuler)' : 'Marquer payée'}</button>
        <button class="btn ghost" id="print">Bon de livraison</button></div>
      <label class="f">Note interne<textarea id="anote" placeholder="Visible uniquement par l'équipe">${esc(o.admin_note)}</textarea></label>
      <div style="margin-top:.5rem"><button class="btn sm" id="saveNote">Enregistrer la note</button></div>
      <h3 style="font-size:.9rem;margin:1.2rem 0 .5rem">Historique</h3>${o.events.map(e => `<div class="ev">${esc(e.detail || e.type)}<small>${fmtDT(e.created_at)} · ${esc(e.username)}</small></div>`).join('')}
      ${A.user.role === 'admin' ? '<div class="foot"><button class="btn danger sm" id="delOrder">Supprimer définitivement</button></div>' : ''}`, { lg: true, onClose: () => { if (location.hash.startsWith('#/orders/')) history.replaceState(null, '', '#/orders'); } });
    const upd = async body => { try { const n = await api('admin/order', { method: 'PUT', params: { id: o.id }, body }); m.el.remove(); show(n); reload?.(); A.pollOrders(); toast('Commande mise à jour'); } catch (e) { fail(e); } };
    m.$$('[data-st]').forEach(b => b.addEventListener('click', async () => { if (b.dataset.st === 'cancelled' && !(await confirmBox('Annuler cette commande ? Le stock sera remis en rayon.', { ok: 'Annuler la commande' }))) return; upd({ status: b.dataset.st }); }));
    m.$$('[data-pay]').forEach(b => b.addEventListener('click', () => upd({ payment_status: b.dataset.pay })));
    m.$('#saveNote').addEventListener('click', () => upd({ admin_note: m.$('#anote').value }));
    m.$('#delOrder')?.addEventListener('click', async () => { if (await confirmBox(`Supprimer ${o.number} ? Action irréversible.`)) { try { await api('admin/order', { method: 'DELETE', params: { id: o.id } }); m.el.remove(); toast('Commande supprimée'); reload?.(); } catch (e) { fail(e); } } });
    m.$('#print').addEventListener('click', () => printSlip(o));
  };
  show(o);
}
function printSlip(o) {
  const w = window.open('', '_blank', 'width=800,height=900'); if (!w) return toast('Autorisez les pop-ups pour imprimer', true);
  w.document.write(`<!doctype html><meta charset=utf-8><title>${esc(o.number)}</title><style>body{font:14px system-ui;margin:2rem;color:#000}h1{font-size:1.4rem;margin:0}table{width:100%;border-collapse:collapse;margin:1rem 0}td,th{border-bottom:1px solid #ccc;padding:.4rem;text-align:left}.r{text-align:right}.big{font-size:1.2rem}</style>
  <h1>${esc(A.shop.shop_name)} – Bon de livraison</h1><p><b>${esc(o.number)}</b> · ${fmtDT(o.created_at)}</p>
  <p><b>${esc(o.customer_name)}</b><br>Tél : ${esc(o.customer_phone)}<br>${o.delivery_mode === 'pickup' ? 'Retrait en boutique' : esc(o.customer_address)}</p>${o.note ? `<p>Note : ${esc(o.note)}</p>` : ''}
  <table><tr><th>Article</th><th class=r>Qté</th><th class=r>Prix</th><th class=r>Total</th></tr>${o.items.map(i => `<tr><td>${esc(i.name)}${i.variant_label ? ' (' + esc(i.variant_label) + ')' : ''}</td><td class=r>${i.qty}</td><td class=r>${fcfa(i.unit_price)}</td><td class=r>${fcfa(i.qty * i.unit_price)}</td></tr>`).join('')}</table>
  <p class="r big">${o.discount ? `Remise : -${fcfa(o.discount)}<br>` : ''}${o.delivery_fee ? `Livraison : ${fcfa(o.delivery_fee)}<br>` : ''}<b>À payer : ${o.payment_status === 'paid' ? '0 FCFA (déjà payée)' : fcfa(o.total)}</b></p><script>onload=()=>print()<\/script>`);
  w.document.close();
}
