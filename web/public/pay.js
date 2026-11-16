/* global document, window, location */
// Sampan Pay button script. Add <script src="https://<sampan site>/pay.js" defer></script> to a page, then:
//   <button data-sampan-invoice="<id>">  opens the status page of an invoice your server made (recommended);
//   <button data-sampan-usd="12.50" data-sampan-merchant="bitcoincash:z..." data-sampan-order="A-1001">
//       makes an invoice from the browser (no webhook: read its status from your server with GET /api/pay/invoice/:id);
//   <button data-sampan-demo>  the Sampan demo shop's order (same site only).
// The status page opens in a new tab. The button fires "sampan:invoice" (detail = the invoice) or "sampan:error"
// (detail = { status, error }) so the page can react. No text of its own: the label is the merchant's.
(function () {
  'use strict';
  var script = document.currentScript;
  var origin = script && script.src ? new URL(script.src).origin : location.origin;
  var SELECTOR = '[data-sampan-invoice],[data-sampan-usd],[data-sampan-demo]';

  function emit(el, name, detail) {
    el.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail }));
  }

  function statusUrl(id) {
    return origin + '/pay/i/' + encodeURIComponent(id);
  }

  function request(el) {
    if (el.hasAttribute('data-sampan-demo')) return { path: '/api/pay/demo/order', body: {} };
    var body = { usd: Number(el.getAttribute('data-sampan-usd')), merchantAddress: el.getAttribute('data-sampan-merchant') || '' };
    var order = el.getAttribute('data-sampan-order');
    if (order) body.orderId = order;
    return { path: '/api/pay/invoice', body: body };
  }

  function open(el) {
    var id = el.getAttribute('data-sampan-invoice');
    if (id) {
      window.open(statusUrl(id), '_blank', 'noopener');
      return;
    }
    // The tab is opened inside the click, before the network answers, so pop-up blockers let it through.
    var tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    var req = request(el);
    el.disabled = true;
    fetch(origin + req.path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req.body) })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw { status: res.status, error: data && data.error };
          return data;
        });
      })
      .then(function (invoice) {
        if (tab) tab.location.href = statusUrl(invoice.id);
        else location.href = statusUrl(invoice.id);
        emit(el, 'sampan:invoice', invoice);
      })
      .catch(function (e) {
        if (tab) tab.close();
        emit(el, 'sampan:error', { status: (e && e.status) || 0, error: (e && e.error) || 'network' });
      })
      .then(function () {
        el.disabled = false;
      });
  }

  document.addEventListener('click', function (event) {
    var el = event.target && event.target.closest ? event.target.closest(SELECTOR) : null;
    if (!el) return;
    event.preventDefault();
    open(el);
  });
})();
