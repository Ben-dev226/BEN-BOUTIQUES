/* Mesure d'audience sans cookie : un compteur par jour, rien de personnel n'est stocké. */
(function () {
  var d = document.documentElement, ua = navigator.userAgent;
  window.FQ = window.FQ || {};
  var on = d.dataset.k && navigator.doNotTrack !== '1' && !/bot|crawl|spider|headless/i.test(ua);
  function send(o) { if (!on) return; try { var s = JSON.stringify(o); if (!(navigator.sendBeacon && navigator.sendBeacon('/api/t', new Blob([s], { type: 'text/plain' })))) fetch('/api/t', { method: 'POST', body: s, keepalive: true, headers: { 'Content-Type': 'text/plain' } }); } catch (e) {} }
  var GA = { cart: ['add_to_cart', 'AddToCart'], checkout: ['begin_checkout', 'InitiateCheckout'], order: ['purchase', 'Purchase'] };
  FQ.track = function (t, id, extra) {
    var g = GA[t];
    if (g) { try { window.gtag && gtag('event', g[0], Object.assign({ currency: 'XOF' }, extra || {})); window.fbq && fbq('track', g[1], Object.assign({ currency: 'XOF' }, extra || {})); } catch (e) {} }
    if (t !== 'order') send({ t: t, id: id || 0 });
  };
  if (!on) return;
  var today = new Date().toISOString().slice(0, 10), first = 1;
  try { first = localStorage.getItem('fq_a') !== today; if (first) localStorage.setItem('fq_a', today); } catch (e) {}
  send({ t: 'pv', k: d.dataset.k, id: +d.dataset.id || 0, u: first ? 1 : 0, m: /Mobi|Android|iPhone/i.test(ua) ? 1 : 0, r: first ? document.referrer : '' });
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
    var h = a.getAttribute('href') || '';
    if (/wa\.me|whatsapp\.com/.test(h)) send({ t: 'click', ref: 'whatsapp' });
    else if (a.dataset.ev) send({ t: 'click', ref: a.dataset.ev });
  }, true);
})();
