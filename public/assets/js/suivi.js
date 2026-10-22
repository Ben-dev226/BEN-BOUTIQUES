(() => {
'use strict';
const { $, esc, fcfa, api } = window.FQ;
const STEPS = [['new', 'Commande reçue'], ['confirmed', 'Confirmée'], ['shipped', 'En livraison'], ['delivered', 'Livrée']];
const fmt = s => new Date(s.replace(' ', 'T') + 'Z').toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const KEY = new URLSearchParams(location.search).get('k') || '';
async function run(n, phone = '') {
  const out = $('#trackResult'); out.innerHTML = '<p class="muted">Recherche…</p>';
  try {
    const o = await api('orders/track', { params: { n, ...(phone ? { phone } : {}), ...(KEY ? { k: KEY } : {}) } });
    const idx = STEPS.findIndex(s => s[0] === o.status);
    const when = {}; o.events.forEach(e => { if (e.type === 'created') when.new = e.created_at; });
    const steps = o.status === 'cancelled' ? '<p><span class="status-pill cancelled">Commande annulée</span></p>'
      : `<ol class="timeline">${STEPS.map((s, i) => `<li class="${i <= idx ? 'on' : ''} ${i === idx ? 'now' : ''}"><strong>${s[1]}</strong>${when[s[0]] ? `<small>${fmt(when[s[0]])}</small>` : ''}</li>`).join('')}</ol>`;
    out.innerHTML = `<div class="track-card"><p><strong>${esc(o.number)}</strong> · <span class="status-pill ${o.status}">${esc(o.status_label)}</span></p>
      <p class="muted">Passée le ${fmt(o.created_at)} · ${o.delivery_mode === 'pickup' ? 'Retrait en boutique' : 'Livraison'}</p>${steps}
      <ul style="list-style:none;display:grid;gap:.3rem;font-size:.9rem">${o.items.map(i => `<li>${i.qty} × ${esc(i.name)}${i.variant_label ? ` (${esc(i.variant_label)})` : ''} – ${fcfa(i.unit_price * i.qty)}</li>`).join('')}</ul>
      <p style="margin-top:.8rem"><strong>Total : ${fcfa(o.total)}</strong> · ${o.payment_status === 'paid' ? 'Payée' : 'Paiement à la livraison'}</p></div>`;
  } catch (e) { out.innerHTML = `<div class="notice err">${esc(e.message)}</div>`; }
}
$('#trackForm').addEventListener('submit', e => { e.preventDefault(); const n = $('#tNum').value.trim(); if (n) { history.replaceState(null, '', '?n=' + encodeURIComponent(n)); run(n, $('#tPhone').value.trim()); } });
if ($('#tNum').value && KEY) run($('#tNum').value);
})();
