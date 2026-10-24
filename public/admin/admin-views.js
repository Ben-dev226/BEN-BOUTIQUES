/* Admin – produits, catégories, clients, promos, paramètres, utilisateurs, journal */
'use strict';
(() => {
const { $, $$, esc, fcfa, fmtDT, fmtD, pill, debounce, api, toast, fail, modal, confirmBox, pager, bindPager } = A;
const catOptions = (sel, blank = 'Sans catégorie') => `<option value="">${blank}</option>` + A.cats.map(c => `<option value="${c.id}" ${String(sel) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
const hashQuery = () => new URLSearchParams((location.hash.split('?')[1] || ''));

// ══ Produits : liste ══════════════════════════════════════
A.route(/^\/products(?:\?.*)?$/, async (view) => {
  const hq = hashQuery();
  const f = { q: '', status: '', category: '', low_stock: hq.get('low') || '', page: 1, sort: 'newest' };
  let selected = new Set(), rows = [];
  view.innerHTML = `<div class="page-head"><h1>Produits</h1><div class="grow"></div><a class="btn primary" href="#/products/new">+ Nouveau produit</a></div>
    <div class="toolbar"><input type="search" id="q" placeholder="Nom, SKU, catégorie…">
      <select id="st"><option value="">Tous statuts</option><option value="active">En ligne</option><option value="draft">Brouillon</option><option value="archived">Archivés</option></select>
      <select id="cat"><option value="">Toutes catégories</option>${A.cats.map(c => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join('')}</select>
      <select id="sort"><option value="newest">Plus récents</option><option value="oldest">Plus anciens</option><option value="name">Nom A–Z</option><option value="price_asc">Prix ↑</option><option value="price_desc">Prix ↓</option><option value="popular">Plus vus</option><option value="stock">Stock ↑</option></select>
      <label class="chk"><input type="checkbox" id="low" ${f.low_stock ? 'checked' : ''}> Stock faible</label></div>
    <div id="bulk"></div><div id="list"><div class="loading"><span class="spin"></span></div></div>`;
  const bulk = () => {
    const n = selected.size;
    $('#bulk').innerHTML = n ? `<div class="bulk"><b>${n} sélectionné${n > 1 ? 's' : ''}</b><button class="btn sm" data-b="activate">Mettre en ligne</button><button class="btn sm" data-b="draft">Brouillon</button><button class="btn sm" data-b="archive">Archiver</button>
      <select id="bcat" style="width:auto;color:#000"><option value="__">Changer de catégorie…</option>${catOptions('', 'Sans catégorie')}</select>
      <button class="btn sm" data-b="merge" title="Regroupe les produits sélectionnés en un seul avec une galerie">Fusionner</button><button class="btn sm" data-b="delete">Supprimer</button></div>` : '';
    $$('#bulk [data-b]').forEach(b => b.addEventListener('click', async () => {
      const a = b.dataset.b, ids = [...selected];
      if (a === 'delete' && !(await confirmBox(`Supprimer ${ids.length} produit(s) et leurs images ?`))) return;
      if (a === 'merge' && !(await confirmBox(`Fusionner ${ids.length} produits en un seul (le plus ancien est conservé, les autres photos deviennent sa galerie) ?`, { ok: 'Fusionner', danger: false }))) return;
      try { await api('admin/product/bulk', { method: 'POST', body: { ids, action: a } }); toast('Fait'); selected.clear(); load(); } catch (e) { fail(e); }
    }));
    $('#bcat')?.addEventListener('change', async e => { if (e.target.value === '__') return; try { await api('admin/product/bulk', { method: 'POST', body: { ids: [...selected], action: 'category', category_id: e.target.value || null } }); toast('Catégorie modifiée'); selected.clear(); load(); } catch (x) { fail(x); } });
  };
  const statusPill = p => pill(p.status, { active: 'En ligne', draft: 'Brouillon', archived: 'Archivé' }[p.status]);
  const load = async () => {
    const d = await api('admin/products', { params: { ...f, size: 20 } }); rows = d.products; bulk();
    $('#list').innerHTML = rows.length ? `<div class="tbl-wrap"><table><thead><tr><th style="width:30px"><input type="checkbox" id="all" aria-label="Tout sélectionner"></th><th>Produit</th><th>Catégorie</th><th>Prix</th><th>Stock</th><th>Statut</th><th>Vues</th><th></th></tr></thead><tbody>${rows.map(p => `<tr data-id="${p.id}">
      <td><input type="checkbox" class="sel" value="${p.id}" ${selected.has(p.id) ? 'checked' : ''}></td>
      <td><a class="cellp" href="#/products/${p.id}" style="text-decoration:none">${p.thumb ? `<img class="thumb" src="${esc(p.thumb)}" alt="" loading="lazy">` : '<div class="thumb"></div>'}<span><b>${esc(p.name)}</b><span class="muted small">${p.has_variants ? 'Avec options' : (p.sku ? esc(p.sku) : '')}</span></span></a></td>
      <td>${esc(p.category_name || '–')}</td><td class="nowrap">${fcfa(p.price)}${p.compare_price ? `<div class="muted small"><s>${fcfa(p.compare_price)}</s></div>` : ''}</td>
      <td class="nowrap">${p.stock_qty === null ? '<span class="muted">Illimité</span>' : (p.has_variants ? p.stock_qty : `<span class="stockctl"><button data-s="-1" aria-label="Retirer 1">−</button><b>${p.stock_qty}</b><button data-s="1" aria-label="Ajouter 1">+</button></span>`) + (p.stock_qty === 0 ? ' ' + pill('out', 'Épuisé') : p.low_stock ? ' ' + pill('low', 'Faible') : '')}</td>
      <td>${statusPill(p)}</td><td>${p.views}</td>
      <td class="nowrap right"><a class="btn sm ghost" href="#/products/${p.id}">Modifier</a> <button class="btn sm ghost" data-dup title="Dupliquer">⧉</button> <a class="btn sm ghost" target="_blank" href="/p/${encodeURIComponent(p.slug)}?preview=1" title="Voir">↗</a></td></tr>`).join('')}</tbody></table></div>${pager(d)}` : '<div class="card empty">Aucun produit. <a href="#/products/new">Créer le premier</a></div>';
    $('#all')?.addEventListener('change', e => { rows.forEach(p => e.target.checked ? selected.add(p.id) : selected.delete(p.id)); $$('.sel').forEach(c => c.checked = e.target.checked); bulk(); });
    $$('.sel').forEach(c => c.addEventListener('change', () => { c.checked ? selected.add(+c.value) : selected.delete(+c.value); bulk(); }));
    $$('[data-dup]').forEach(b => b.addEventListener('click', async () => { try { const r = await api('admin/product/duplicate', { method: 'POST', body: { id: +b.closest('tr').dataset.id } }); toast('Copie créée (brouillon)'); location.hash = `#/products/${r.id}`; } catch (e) { fail(e); } }));
    $$('.stockctl button').forEach(b => b.addEventListener('click', async () => { try { await api('admin/product/stock', { method: 'POST', body: { id: +b.closest('tr').dataset.id, delta: +b.dataset.s } }); load(); } catch (e) { fail(e); } }));
    bindPager($('#list'), p => { f.page = p; load().catch(fail); });
  };
  const set = (k, v) => { f[k] = v; f.page = 1; load().catch(fail); };
  $('#q').addEventListener('input', debounce(e => set('q', e.target.value)));
  $('#st').addEventListener('change', e => set('status', e.target.value)); $('#cat').addEventListener('change', e => set('category', e.target.value));
  $('#sort').addEventListener('change', e => set('sort', e.target.value)); $('#low').addEventListener('change', e => set('low_stock', e.target.checked ? '1' : ''));
  await load();
}, 'products');

// ══ Produit : formulaire ══════════════════════════════════
async function shrink(file) {           // réduit les grosses photos de téléphone avant envoi
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 900 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .88));
    return blob && blob.size < file.size ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
}

A.route(/^\/products\/(new|\d+)$/, async (view, idArg) => {
  const isNew = idArg === 'new';
  const p = isNew ? { name: '', description: '', price: '', compare_price: '', sku: '', category_id: '', status: 'active', is_new: false, featured: false, track_stock: false, stock: 0, images: [], variants: [] }
    : await api('admin/product', { params: { id: idArg } });
  p.compare_price ??= ''; p.category_id ??= '';
  let dirty = false; const mark = () => { dirty = true; }; window.onbeforeunload = () => dirty ? 'Modifications non enregistrées' : undefined; A.onLeave(() => { window.onbeforeunload = null; });
  view.innerHTML = `<div class="page-head"><a href="#/products" class="btn sm ghost">← Produits</a><h1>${isNew ? 'Nouveau produit' : 'Modifier le produit'}</h1><div class="grow"></div>${isNew ? '' : `<a class="btn sm" target="_blank" href="/p/${encodeURIComponent(p.slug)}?preview=1">Voir sur la boutique ↗</a>`}</div>
  <form id="pf" class="pform" novalidate><div class="stack">
    <div class="card stack"><label class="f">Nom du produit<input id="name" required maxlength="140" value="${esc(p.name)}" placeholder="Ex. : Bonnet tricoté noir"></label>
      <label class="f">Description<small>Astuce : **texte** = gras · une ligne commençant par « - » = liste à puces</small><textarea id="desc" rows="6" maxlength="5000" placeholder="Matière, taille, entretien…">${esc(p.description)}</textarea></label></div>
    <div class="card"><h2>Photos <span class="muted small">La première est la photo principale · 12 max</span></h2><div class="imgs" id="imgs"></div><input type="file" id="file" accept="image/jpeg,image/png,image/webp" multiple hidden></div>
    <div class="card"><h2>Options (tailles, couleurs…) <span class="muted small">facultatif</span></h2><div id="vars"></div>
      <div class="toolbar" style="margin:.6rem 0 0"><button type="button" class="btn sm" id="addVar">+ Ajouter une option</button><input id="quick" placeholder="Ajout rapide : S, M, L, XL" style="max-width:260px"><button type="button" class="btn sm ghost" id="quickBtn">Ajouter</button></div>
      <p class="muted small" style="margin-top:.5rem">Si le produit a des options, le client doit en choisir une. Prix vide = prix du produit.</p></div>
  </div><div class="stack" style="align-content:start">
    <div class="card stack"><label class="f">Statut<select id="status"><option value="active">En ligne</option><option value="draft">Brouillon (masqué)</option><option value="archived">Archivé (masqué)</option></select></label>
      <label class="f">Catégorie<select id="cat">${catOptions(p.category_id)}</select></label>
      <label class="chk"><input type="checkbox" id="isnew" ${p.is_new ? 'checked' : ''}> Badge « Nouveau »</label><label class="chk"><input type="checkbox" id="feat" ${p.featured ? 'checked' : ''}> Mis en avant (en tête du catalogue)</label></div>
    <div class="card stack"><label class="f">Prix (FCFA)<input id="price" type="number" min="0" step="50" inputmode="numeric" required value="${esc(p.price)}"></label>
      <label class="f">Ancien prix barré <small>Affiche une promotion si supérieur au prix</small><input id="cmp" type="number" min="0" step="50" inputmode="numeric" value="${esc(p.compare_price)}"></label>
      <label class="f">Référence (SKU)<input id="sku" maxlength="40" value="${esc(p.sku || '')}"></label></div>
    <div class="card stack"><label class="chk"><input type="checkbox" id="track" ${p.track_stock ? 'checked' : ''}> Suivre le stock</label>
      <label class="f" id="stockWrap">Quantité en stock<input id="stock" type="number" min="0" value="${p.stock || 0}"></label><p class="muted small" id="stockHint">Sans suivi, le produit est toujours disponible.</p></div>
  </div><div class="savebar" style="grid-column:1/-1"><a class="btn" href="#/products">Annuler</a><button class="btn primary" id="save">${isNew ? 'Créer le produit' : 'Enregistrer'}</button></div></form>`;
  $('#status').value = p.status;
  const syncStock = () => { const t = $('#track').checked, hasV = p.variants.length > 0; $('#stockWrap').hidden = !t || hasV; $('#stockHint').textContent = t ? (hasV ? 'Le stock se gère par option ci-dessus.' : 'Le produit est marqué « Épuisé » à 0.') : 'Sans suivi, le produit est toujours disponible.'; };
  const drawImgs = () => {
    $('#imgs').innerHTML = p.images.map((im, i) => `<div class="im" data-i="${i}"><img src="${esc(im.thumb || im.url)}" alt="">${i === 0 ? '<span class="cv">Principale</span>' : ''}<div class="ac">${i > 0 ? '<button type="button" data-m="-1" title="Reculer">◀</button>' : ''}${i < p.images.length - 1 ? '<button type="button" data-m="1" title="Avancer">▶</button>' : ''}<button type="button" data-rm title="Retirer"></button></div></div>`).join('') +
      (p.images.length < 12 ? `<div class="drop" id="drop" tabindex="0" role="button"><span style="font-size:1.4rem">＋</span>Ajouter des photos<span>ou glisser-déposer</span></div>` : '');
    $$('#imgs .im').forEach(el => { const i = +el.dataset.i;
      $$('[data-m]', el).forEach(b => b.addEventListener('click', () => { const j = i + +b.dataset.m; [p.images[i], p.images[j]] = [p.images[j], p.images[i]]; mark(); drawImgs(); }));
      $('[data-rm]', el).addEventListener('click', () => { p.images.splice(i, 1); mark(); drawImgs(); }); });
    const dz = $('#drop'); if (!dz) return;
    dz.addEventListener('click', () => $('#file').click()); dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') $('#file').click(); });
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); }); dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); upload([...e.dataTransfer.files]); });
  };
  async function upload(files) {
    files = files.filter(f => f.type.startsWith('image/')).slice(0, 12 - p.images.length);
    for (const file of files) {
      const ph = { url: '', thumb: '', pending: true }; p.images.push(ph); drawImgs(); const el = $$('#imgs .im').pop(); if (el) el.insertAdjacentHTML('beforeend', '<div style="position:absolute;inset:0;background:rgba(255,255,255,.8);display:grid;place-items:center"><span class="spin"></span></div>');
      try { const fd = new FormData(); fd.append('image', await shrink(file)); const r = await api('admin/upload', { method: 'POST', form: fd }); Object.assign(ph, { path: r.path, url: r.url, thumb: r.thumb_url, width: r.width, height: r.height, pending: false }); mark(); }
      catch (e) { p.images.splice(p.images.indexOf(ph), 1); fail(e); }
      drawImgs();
    }
  }
  $('#file').addEventListener('change', e => { upload([...e.target.files]); e.target.value = ''; });
  const drawVars = () => {
    $('#vars').innerHTML = p.variants.length ? `<div class="var-row h"><span>Nom</span><span>Prix (opt.)</span><span>Stock</span><span>Actif</span><span></span></div>` + p.variants.map((v, i) => `<div class="var-row" data-i="${i}">
      <input data-k="label" value="${esc(v.label)}" placeholder="Ex. : M – Noir" maxlength="60" aria-label="Nom de l'option"><input data-k="price" type="number" min="0" value="${v.price ?? ''}" placeholder="${esc(p.price || 'prix')}" aria-label="Prix">
      <input data-k="stock" type="number" min="0" value="${v.stock ?? 0}" aria-label="Stock"><label class="chk"><input type="checkbox" data-k="active" ${v.active !== false ? 'checked' : ''}></label><button type="button" class="btn sm danger" data-rv aria-label="Supprimer">✕</button></div>`).join('') : '<p class="muted small">Aucune option : le produit est vendu tel quel.</p>';
    $$('#vars .var-row[data-i]').forEach(r => { const i = +r.dataset.i;
      $$('input[data-k]', r).forEach(inp => inp.addEventListener('input', () => { const k = inp.dataset.k; p.variants[i][k] = inp.type === 'checkbox' ? inp.checked : (k === 'label' ? inp.value : (inp.value === '' ? (k === 'price' ? null : 0) : +inp.value)); mark(); }));
      $('[data-rv]', r).addEventListener('click', () => { p.variants.splice(i, 1); mark(); drawVars(); syncStock(); }); });
  };
  $('#addVar').addEventListener('click', () => { p.variants.push({ label: '', price: null, stock: 0, active: true }); drawVars(); syncStock(); $$('#vars .var-row input').pop()?.focus(); mark(); });
  $('#quickBtn').addEventListener('click', () => { $('#quick').value.split(',').map(s => s.trim()).filter(Boolean).forEach(l => p.variants.push({ label: l, price: null, stock: 0, active: true })); $('#quick').value = ''; drawVars(); syncStock(); mark(); });
  $('#quick').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#quickBtn').click(); } });
  $('#track').addEventListener('change', syncStock); $('#pf').addEventListener('input', mark);
  drawImgs(); drawVars(); syncStock();
  $('#pf').addEventListener('submit', async e => {
    e.preventDefault();
    if (p.images.some(i => i.pending)) return toast('Envoi des photos en cours…', true);
    if (!$('#name').value.trim()) { $('#name').focus(); return toast('Le nom est obligatoire', true); }
    if ($('#price').value === '') { $('#price').focus(); return toast('Indiquez le prix', true); }
    const body = { name: $('#name').value, description: $('#desc').value, price: +$('#price').value, compare_price: $('#cmp').value, sku: $('#sku').value, category_id: $('#cat').value || null, status: $('#status').value,
      is_new: $('#isnew').checked, featured: $('#feat').checked, track_stock: $('#track').checked, stock: +$('#stock').value || 0,
      images: p.images.map(i => ({ path: i.path, alt: i.alt || '', width: i.width, height: i.height })), variants: p.variants };
    const b = $('#save'); b.disabled = true;
    try { const r = await api(isNew ? 'admin/products' : 'admin/product', { method: isNew ? 'POST' : 'PUT', params: isNew ? {} : { id: p.id }, body }); dirty = false; toast(isNew ? 'Produit créé' : 'Modifications enregistrées'); if (isNew) location.hash = `#/products/${r.id}`; else { Object.assign(p, { slug: r.slug }); b.disabled = false; } }
    catch (x) { fail(x); b.disabled = false; }
  });
}, 'products');

// ══ Catégories ════════════════════════════════════════════
A.route(/^\/categories$/, async (view) => {
  const draw = async () => {
    A.cats = (await api('admin/categories')).categories;
    view.innerHTML = `<div class="page-head"><h1>Catégories</h1><div class="grow"></div><button class="btn primary" id="add">+ Nouvelle catégorie</button></div>
    ${A.cats.length ? `<div class="tbl-wrap"><table><thead><tr><th>Nom</th><th>Adresse (slug)</th><th>Produits</th><th>Ordre</th><th></th></tr></thead><tbody>${A.cats.map(c => `<tr><td><b>${esc(c.icon)} ${esc(c.name)}</b></td><td class="muted">${esc(c.slug)}</td><td>${c.products}</td><td>${c.position}</td><td class="right nowrap"><button class="btn sm ghost" data-e="${c.id}">Modifier</button> <button class="btn sm danger" data-d="${c.id}">Supprimer</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="card empty">Aucune catégorie</div>'}`;
    const edit = c => { const m = modal(`<h2>${c ? 'Modifier' : 'Nouvelle'} catégorie<button data-close>✕</button></h2><form class="stack" id="cf"><label class="f">Nom<input name="name" required maxlength="60" value="${esc(c?.name || '')}"></label>
      <div class="grid2"><label class="f">Icône (emoji, facultatif)<input name="icon" maxlength="4" value="${esc(c?.icon || '')}"></label><label class="f">Ordre d'affichage<input name="position" type="number" value="${c?.position ?? A.cats.length}"></label></div>
      <div class="foot"><button type="button" class="btn" data-close>Annuler</button><button class="btn primary">Enregistrer</button></div></form>`);
      m.$('#cf').addEventListener('submit', async e => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); try { await api('admin/categories', { method: c ? 'PUT' : 'POST', params: c ? { id: c.id } : {}, body: { ...v, position: +v.position } }); m.el.remove(); toast('Enregistré'); draw(); } catch (x) { fail(x); } }); };
    $('#add').onclick = () => edit(null);
    $$('[data-e]').forEach(b => b.onclick = () => edit(A.cats.find(c => c.id === +b.dataset.e)));
    $$('[data-d]').forEach(b => b.onclick = async () => { const c = A.cats.find(c => c.id === +b.dataset.d); if (await confirmBox(`Supprimer « ${c.name} » ? ${c.products ? `Ses ${c.products} produits resteront sans catégorie.` : ''}`)) { try { await api('admin/categories', { method: 'DELETE', params: { id: c.id } }); toast('Supprimée'); draw(); } catch (x) { fail(x); } } });
  };
  await draw();
}, 'categories');

// ══ Clients ═══════════════════════════════════════════════
A.route(/^\/customers$/, async (view) => {
  view.innerHTML = `<div class="page-head"><h1>Clients</h1><div class="grow"></div><a class="btn" href="/api/index.php?r=admin/customers/export">Exporter CSV</a></div><div class="toolbar"><input type="search" id="q" placeholder="Nom ou téléphone…"></div><div id="list"></div>`;
  const load = async q => {
    const { customers } = await api('admin/customers', { params: { q } });
    $('#list').innerHTML = customers.length ? `<div class="tbl-wrap"><table><thead><tr><th>Client</th><th>Téléphone</th><th>Commandes</th><th>Total dépensé</th><th>Dernière commande</th><th></th></tr></thead><tbody>${customers.map(c => `<tr><td><b>${esc(c.name)}</b>${c.notes ? `<div class="muted small">${esc(c.notes)}</div>` : ''}</td><td>${esc(c.phone)}</td><td>${c.orders}${c.orders > 2 ? ' ' + pill('active', 'Fidèle') : ''}</td><td class="nowrap">${fcfa(c.spent)}</td><td>${fmtD(c.last_order?.slice(0, 10))}</td>
      <td class="right nowrap"><a class="btn sm wa" target="_blank" rel="noopener" href="https://wa.me/${esc(c.phone)}">WhatsApp</a> <button class="btn sm ghost" data-e="${c.id}">Fiche</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="card empty">Aucun client pour le moment. Ils apparaissent automatiquement à chaque commande.</div>';
    $$('[data-e]').forEach(b => b.onclick = () => { const c = customers.find(x => x.id === +b.dataset.e); const m = modal(`<h2>${esc(c.name)}<button data-close>✕</button></h2><form class="stack" id="cf"><div class="grid2"><label class="f">Nom<input name="name" value="${esc(c.name)}" required></label><label class="f">Email<input name="email" type="email" value="${esc(c.email)}"></label></div>
      <label class="f">Adresse<input name="address" value="${esc(c.address)}"></label><label class="f">Notes internes<textarea name="notes">${esc(c.notes)}</textarea></label><p class="muted small">Tél. ${esc(c.phone)} · client depuis le ${fmtD(c.created_at.slice(0, 10))}</p>
      <div class="foot"><button type="button" class="btn" data-close>Fermer</button><button class="btn primary">Enregistrer</button></div></form>`);
      m.$('#cf').addEventListener('submit', async e => { e.preventDefault(); try { await api('admin/customers', { method: 'PUT', params: { id: c.id }, body: Object.fromEntries(new FormData(e.target)) }); m.el.remove(); toast('Enregistré'); load($('#q').value); } catch (x) { fail(x); } }); });
  };
  $('#q').addEventListener('input', debounce(e => load(e.target.value).catch(fail))); await load('');
}, 'customers');

// ══ Codes promo ═══════════════════════════════════════════
A.route(/^\/promos$/, async (view) => {
  const draw = async () => {
    const { promos } = await api('admin/promos');
    view.innerHTML = `<div class="page-head"><h1>Codes promo</h1><div class="grow"></div><button class="btn primary" id="add">+ Nouveau code</button></div>
    ${promos.length ? `<div class="tbl-wrap"><table><thead><tr><th>Code</th><th>Remise</th><th>Minimum</th><th>Utilisations</th><th>Validité</th><th>État</th><th></th></tr></thead><tbody>${promos.map(p => { const exp = p.expires_at && p.expires_at < new Date().toISOString().replace('T', ' ');
      return `<tr><td><b style="font-family:monospace">${esc(p.code)}</b></td><td>${p.type === 'percent' ? p.value + ' %' : fcfa(p.value)}</td><td>${p.min_order ? fcfa(p.min_order) : '–'}</td><td>${p.used}${p.max_uses ? ' / ' + p.max_uses : ''}</td><td class="small">${p.starts_at ? 'dès le ' + fmtD(p.starts_at.slice(0, 10)) + '<br>' : ''}${p.expires_at ? 'jusqu\'au ' + fmtD(p.expires_at.slice(0, 10)) : 'Sans limite'}</td><td>${exp ? pill('cancelled', 'Expiré') : p.active ? pill('active', 'Actif') : pill('draft', 'Désactivé')}</td>
      <td class="right nowrap"><button class="btn sm ghost" data-e="${p.id}">Modifier</button> <button class="btn sm danger" data-d="${p.id}">✕</button></td></tr>`; }).join('')}</tbody></table></div>` : '<div class="card empty">Aucun code promo. Créez par exemple BIENVENUE10 (−10 %) pour fidéliser vos clients.</div>'}`;
    const edit = p => { const m = modal(`<h2>${p ? 'Modifier' : 'Nouveau'} code promo<button data-close>✕</button></h2><form class="stack" id="pf">
      <label class="f">Code<small>Lettres et chiffres, sans espace</small><input name="code" required maxlength="30" value="${esc(p?.code || '')}" style="text-transform:uppercase"></label>
      <div class="grid2"><label class="f">Type<select name="type"><option value="percent" ${p?.type === 'percent' ? 'selected' : ''}>Pourcentage (%)</option><option value="fixed" ${p?.type === 'fixed' ? 'selected' : ''}>Montant fixe (FCFA)</option></select></label><label class="f">Valeur<input name="value" type="number" min="1" required value="${p?.value ?? ''}"></label></div>
      <div class="grid2"><label class="f">Commande minimale (FCFA)<input name="min_order" type="number" min="0" value="${p?.min_order || 0}"></label><label class="f">Nombre d'utilisations max<small>vide = illimité</small><input name="max_uses" type="number" min="1" value="${p?.max_uses ?? ''}"></label></div>
      <div class="grid2"><label class="f">Début<input name="starts_at" type="date" value="${p?.starts_at?.slice(0, 10) || ''}"></label><label class="f">Fin<input name="expires_at" type="date" value="${p?.expires_at?.slice(0, 10) || ''}"></label></div>
      <label class="chk"><input type="checkbox" name="active" ${p?.active !== false ? 'checked' : ''}> Code actif</label>
      <div class="foot"><button type="button" class="btn" data-close>Annuler</button><button class="btn primary">Enregistrer</button></div></form>`);
      m.$('#pf').addEventListener('submit', async e => { e.preventDefault(); const fd = new FormData(e.target), v = Object.fromEntries(fd); v.active = fd.has('active'); try { await api('admin/promos', { method: p ? 'PUT' : 'POST', params: p ? { id: p.id } : {}, body: v }); m.el.remove(); toast('Enregistré'); draw(); } catch (x) { fail(x); } }); };
    $('#add').onclick = () => edit(null);
    $$('[data-e]').forEach(b => b.onclick = () => edit(promos.find(p => p.id === +b.dataset.e)));
    $$('[data-d]').forEach(b => b.onclick = async () => { if (await confirmBox('Supprimer ce code promo ?')) { try { await api('admin/promos', { method: 'DELETE', params: { id: b.dataset.d } }); draw(); } catch (x) { fail(x); } } });
  };
  await draw();
}, 'promos');

// ══ Paramètres ════════════════════════════════════════════
A.route(/^\/settings$/, async (view) => {
  const { settings: s } = await api('admin/settings');
  const inp = (k, label, hint = '', type = 'text', extra = '') => `<label class="f">${label}${hint ? `<small>${hint}</small>` : ''}<input name="${k}" type="${type}" value="${esc(s[k])}" ${extra}></label>`;
  const area = (k, label, hint = '', rows = 3) => `<label class="f">${label}${hint ? `<small>${hint}</small>` : ''}<textarea name="${k}" rows="${rows}">${esc(s[k])}</textarea></label>`;
  view.innerHTML = `<div class="page-head"><h1>Paramètres</h1></div><form id="sf" class="stack" style="max-width:820px">
    <div class="card stack"><h2>Boutique</h2><div class="grid2">${inp('shop_name', 'Nom de la boutique')}${inp('tagline', 'Slogan')}</div>${inp('hero_title', "Titre de la page d'accueil")}${area('hero_text', "Texte d'accueil")}${area('about_text', 'Page « À propos »', 'Une ligne par paragraphe')}${inp('seo_title', 'Titre pour Google', 'Facultatif, environ 60 caractères. Par défaut : nom + slogan')}${area('meta_description', 'Description pour Google', 'Environ 150 caractères', 2)}${inp('google_verification', 'Code Google Search Console', 'Facultatif : collez le code de la balise de vérification')}<div class="grid2">${inp('ga4_id', 'Google Analytics (ID)', 'Facultatif, ex. G-ABC123XYZ')}${inp('meta_pixel_id', 'Pixel Meta / Facebook (ID)', 'Facultatif, chiffres uniquement')}</div>${inp('announcement', 'Bandeau d\'annonce', 'Affiché tout en haut du site (vide = aucun). Ex. : −10 % avec le code BIENVENUE10')}</div>
    <div class="card stack"><h2>Apparence</h2><div class="grid2"><label class="f">Couleur principale<small>Boutons, bandeau, accents</small><input name="primary_color" type="color" value="${esc(s.primary_color || '#D91B1B')}" style="height:44px;padding:2px"></label>
      <div class="f">Logo<small>PNG/JPG/WebP – fond transparent conseillé</small><div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap"><img id="logoPrev" src="${esc(s.logo_url)}" alt="" style="max-height:44px;max-width:140px;${s.logo_url ? '' : 'display:none'}"><input type="file" id="logoFile" accept="image/*" style="max-width:220px"><button type="button" class="btn sm danger" id="logoRm" ${s.logo_url ? '' : 'hidden'}>Retirer</button></div></div></div></div>
    <div class="card stack"><h2>Contact & réseaux</h2><div class="grid2">${inp('whatsapp', 'Numéro WhatsApp des commandes', 'Format international sans +, ex. 22670123456', 'tel')}${inp('phone_display', 'Téléphone affiché (facultatif)')}${inp('email', 'Email', '', 'email')}${inp('hours', 'Horaires')}</div>${inp('address', 'Adresse')}<div class="grid2">${inp('facebook', 'Facebook (URL)')}${inp('instagram', 'Instagram (URL)')}${inp('tiktok', 'TikTok (URL)')}</div></div>
    <div class="card stack"><h2>Livraison</h2><div class="grid2">${inp('delivery_fee', 'Frais de livraison (FCFA)', '0 = à confirmer par WhatsApp', 'number', 'min=0')}${inp('free_delivery_min', 'Livraison offerte dès (FCFA)', '0 = jamais', 'number', 'min=0')}</div>${inp('delivery_note', 'Message livraison affiché aux clients')}<label class="chk"><input type="checkbox" name="pickup_enabled" ${s.pickup_enabled === '1' ? 'checked' : ''}> Proposer le retrait en boutique</label></div>
    <div class="card stack"><h2>Commandes & stock</h2><div class="grid2">${inp('order_prefix', 'Préfixe des numéros de commande', 'Ex. FQ → FQ-261015-AB12')}${inp('low_stock_threshold', 'Alerte stock faible à partir de', 'unités', 'number', 'min=0')}</div></div>
    <div class="savebar"><button class="btn primary">Enregistrer les paramètres</button></div></form>
    <div class="card stack" id="bill" style="max-width:820px;margin-top:1rem"><h2>Abonnement</h2><p class="muted small">Chargement…</p></div>
    <div class="card stack" style="max-width:820px;margin-top:1rem"><h2>Sauvegarde</h2><p class="muted small">Téléchargez une copie complète des données de votre boutique (produits, commandes, clients) au format JSON. Conservez-la en lieu sûr, idéalement chaque semaine. Les photos sont stockées séparément et en sécurité.</p><div><a class="btn" href="/api/index.php?r=admin/backup">Télécharger la sauvegarde</a></div></div>`;
  api('admin/billing').then(b => {
    const st = !b.paid_until ? 'Sans échéance' : (b.expired ? `<b style="color:#c0392b">Expiré le ${esc(b.paid_until)}</b>` : `Actif jusqu’au <b>${esc(b.paid_until)}</b>`);
    $('#bill').innerHTML = `<h2>Abonnement</h2><p>Offre <b>${esc(b.plan)}</b> · ${st}</p>` + (b.can_pay && b.options.length ? `<form id="bf" class="stack"><div class="grid2"><label class="f">Prénom<input name="first_name" required></label><label class="f">Nom<input name="last_name" required></label></div>
      <div class="grid2"><label class="f">Email<input name="email" type="email" value="${esc(b.defaults.email)}" required></label><label class="f">Téléphone<input name="phone" value="${esc(b.defaults.whatsapp)}" required></label></div>
      <div class="row" style="display:flex;gap:.5rem;flex-wrap:wrap">${b.options.map(o => `<button class="btn primary" name="key" value="${esc(o.key)}">Payer / prolonger : ${esc(o.label)}</button>`).join('')}</div><small class="muted">Paiement sécurisé par Chariow (Mobile Money, carte). Votre abonnement est prolongé automatiquement dès confirmation.</small></form>` : '<p class="muted small">Le paiement en ligne n’est pas encore activé : contactez-nous pour renouveler.</p>') +
      (b.payments.length ? `<table class="tbl"><thead><tr><th>Date</th><th>Durée</th><th>Montant</th><th>Valable jusqu’au</th></tr></thead><tbody>${b.payments.map(p => `<tr><td>${esc(String(p.created_at).slice(0, 10))}</td><td>${p.months} mois</td><td>${Number(p.amount).toLocaleString('fr-FR')} ${esc(p.currency)}</td><td>${esc(p.paid_until)}</td></tr>`).join('')}</tbody></table>` : '');
    const f = $('#bf'); if (f) f.addEventListener('submit', async e => { e.preventDefault(); const v = Object.fromEntries(new FormData(f)); v.key = e.submitter?.value; if (!v.key) return;
      try { const r = await api('admin/billing/checkout', { method: 'POST', body: v }); location.href = r.checkout_url; } catch (x) { fail(x); } });
  }).catch(() => { $('#bill').hidden = true; });
  $('#logoFile').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; try { const fd = new FormData(); fd.append('image', f); const r = await api('admin/upload', { method: 'POST', form: fd, params: { kind: 'logo' } }); $('#logoPrev').src = r.url; $('#logoPrev').style.display = ''; $('#logoRm').hidden = false; A.shop.logo_url = r.url; toast('Logo mis à jour'); } catch (x) { fail(x); } e.target.value = ''; });
  $('#logoRm').addEventListener('click', async () => { try { await api('admin/settings', { method: 'PUT', body: { remove_logo: true } }); $('#logoPrev').style.display = 'none'; $('#logoRm').hidden = true; A.shop.logo_url = ''; toast('Logo retiré'); } catch (x) { fail(x); } });
  $('#sf').addEventListener('submit', async e => { e.preventDefault(); const fd = new FormData(e.target), v = Object.fromEntries(fd); v.pickup_enabled = fd.has('pickup_enabled') ? '1' : '0';
    try { const r = await api('admin/settings', { method: 'PUT', body: v }); Object.assign(A.shop, r.settings); toast('Paramètres enregistrés'); } catch (x) { fail(x); } });
}, 'settings');

// ══ Utilisateurs ══════════════════════════════════════════
A.route(/^\/users$/, async (view) => {
  const draw = async () => {
    const { users } = await api('admin/users');
    view.innerHTML = `<div class="page-head"><h1>Utilisateurs</h1><div class="grow"></div><button class="btn primary" id="add">+ Nouvel utilisateur</button></div>
    <div class="tbl-wrap"><table><thead><tr><th>Identifiant</th><th>Nom</th><th>Rôle</th><th>Dernière connexion</th><th>État</th><th></th></tr></thead><tbody>${users.map(u => `<tr><td><b>${esc(u.username)}</b></td><td>${esc(u.name)}</td><td>${u.role === 'admin' ? 'Administrateur' : 'Gestionnaire'}</td><td>${u.last_login_at ? fmtDT(u.last_login_at) : '–'}</td><td>${u.active ? pill('active', 'Actif') : pill('draft', 'Désactivé')}</td><td class="right nowrap"><button class="btn sm ghost" data-e="${u.id}">Modifier</button>${u.id !== A.user.id ? ` <button class="btn sm danger" data-d="${u.id}">✕</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
    <p class="muted small" style="margin-top:.8rem"><b>Administrateur</b> : accès complet. <b>Gestionnaire</b> : produits, commandes, clients et promos (pas de paramètres, utilisateurs ni sauvegarde).</p>`;
    const edit = u => { const m = modal(`<h2>${u ? 'Modifier' : 'Nouvel'} utilisateur<button data-close>✕</button></h2><form class="stack" id="uf"><div id="uErr"></div>
      ${u ? `<p><b>${esc(u.username)}</b></p>` : '<label class="f">Identifiant<input name="username" required minlength="3" autocomplete="off"></label>'}
      <label class="f">Nom affiché<input name="name" value="${esc(u?.name || '')}"></label>
      <div class="grid2"><label class="f">Rôle<select name="role"><option value="manager" ${u?.role !== 'admin' ? 'selected' : ''}>Gestionnaire</option><option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>Administrateur</option></select></label>
      <label class="f">${u ? 'Nouveau mot de passe' : 'Mot de passe initial'}<small>${u ? 'laisser vide = inchangé' : 'à changer à la 1re connexion'}</small><input name="password" type="password" autocomplete="new-password" ${u ? '' : 'required'}></label></div>
      <label class="chk"><input type="checkbox" name="active" ${u?.active !== false ? 'checked' : ''}> Compte actif</label><div class="foot"><button type="button" class="btn" data-close>Annuler</button><button class="btn primary">Enregistrer</button></div></form>`);
      m.$('#uf').addEventListener('submit', async e => { e.preventDefault(); const fd = new FormData(e.target), v = Object.fromEntries(fd); v.active = fd.has('active'); try { await api('admin/users', { method: u ? 'PUT' : 'POST', params: u ? { id: u.id } : {}, body: v }); m.el.remove(); toast('Enregistré'); draw(); } catch (x) { m.$('#uErr').innerHTML = `<div class="notice err">${esc(x.message)}</div>`; } }); };
    $('#add').onclick = () => edit(null);
    $$('[data-e]').forEach(b => b.onclick = () => edit(users.find(u => u.id === +b.dataset.e)));
    $$('[data-d]').forEach(b => b.onclick = async () => { if (await confirmBox('Supprimer cet utilisateur ?')) { try { await api('admin/users', { method: 'DELETE', params: { id: b.dataset.d } }); draw(); } catch (x) { fail(x); } } });
  };
  await draw();
}, 'users');

// ══ Journal ═══════════════════════════════════════════════
A.route(/^\/activity$/, async (view) => {
  const { activity } = await api('admin/activity');
  view.innerHTML = `<div class="page-head"><h1>Journal d'activité</h1></div><div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Détail</th><th>IP</th></tr></thead><tbody>${activity.map(a => `<tr><td class="nowrap">${fmtDT(a.created_at)}</td><td>${esc(a.username || '–')}</td><td><code>${esc(a.action)}</code></td><td>${esc(a.detail)}${a.entity_id ? ` <span class="muted small">#${esc(a.entity_id)}</span>` : ''}</td><td class="muted small">${esc(a.ip)}</td></tr>`).join('') || '<tr><td colspan=5 class="empty">Rien pour le moment</td></tr>'}</tbody></table></div>`;
}, 'activity');
})();
