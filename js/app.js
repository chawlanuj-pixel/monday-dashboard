/* Monday Dashboard · shell: routing, period, shared loading. */
(function (MD) {
  'use strict';
  var $ = MD.$;
  MD.views = MD.views || {};

  var state = MD.state = { view: 'founder', period: MD.period('30d'), spend: [], ready: null, renderToken: 0 };

  function readHash() {
    var h = (location.hash || '').replace(/^#/, '').split('&'), o = {};
    h.forEach(function (kv) { var p = kv.split('='); if (p[0]) o[p[0]] = decodeURIComponent(p[1] || ''); });
    return o;
  }
  function writeHash() {
    try { history.replaceState(null, '', '#v=' + state.view + '&p=' + state.period.key); } catch (e) {}
  }

  function select(view) {
    if (!MD.views[view]) view = 'founder';
    state.view = view;
    Array.prototype.forEach.call(document.querySelectorAll('#tabs [data-view]'), function (b) {
      var on = b.getAttribute('data-view') === view;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) $('view-title').textContent = b.textContent;
    });
    $('tabs').classList.remove('open');
    writeHash();
    render();
  }

  function render() {
    var token = ++state.renderToken;
    var el = $('view');
    el.innerHTML = '<div class="loading">Loading…</div>';
    state.ready.then(function () {
      if (token !== state.renderToken) return;
      return MD.views[state.view](el, state.period, function () { return token === state.renderToken; });
    }).then(function () {
      if (token !== state.renderToken) return;
      $('foot').textContent = state.period.label + ' (' + MD.fmt.date(state.period.from) + ' to ' + MD.fmt.date(state.period.to) + ') · compared with ' + state.period.compareLabel + ' · all dates in ' + MD.shop.tz + ' · updated ' +
        new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: MD.shop.tz });
    }).catch(function (e) {
      if (token !== state.renderToken) return;
      el.innerHTML = MD.err(e, 'this view');
    });
  }
  MD.rerender = render;

  /* Shared: orders for the period and its comparison period, marked new/returning. */
  MD.periodOrders = function (p, onProgress) {
    return Promise.all([MD.loadOrders(p.prevFrom, p.to, onProgress), MD.loadHistory(24).catch(function () { return null; })]).then(function (r) {
      var res = r[0], hist = r[1];
      if (hist) MD.markNew(res.orders, hist);
      return {
        cur: MD.inRange(res.orders, p.from, p.to),
        prev: MD.inRange(res.orders, p.prevFrom, p.prevTo),
        all: res.orders, truncated: res.truncated, tests: res.tests, hist: hist
      };
    });
  };

  /* Shared: ad spend rows in a date range, by platform. */
  MD.spendIn = function (from, to) {
    return state.spend.filter(function (r) { return r.date >= from && r.date <= to; });
  };

  function boot() {
    var h = readHash();
    if (h.p) { var o = document.querySelector('#period option[value="' + h.p + '"]'); if (o) { $('period').value = h.p; state.period = MD.period(h.p); } }
    state.ready = MD.loadShop().then(function (shop) {
      $('shopname').textContent = shop.name;
      state.period = MD.period($('period').value);
      return Promise.all([
        MD.detectExternalCheckout(),
        MD.store.loadSettings().then(function (s) { if (s) MD.settings = Object.assign({}, MD.DEFAULT_SETTINGS, s); }).catch(function (e) { MD.storeError = e; }),
        MD.store.loadSpend().then(function (rows) { state.spend = rows; }).catch(function (e) { MD.storeError = e; })
      ]);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#tabs [data-view]'), function (b) {
      b.addEventListener('click', function () { select(b.getAttribute('data-view')); });
    });
    $('nav-toggle').addEventListener('click', function () { var o = $('tabs').classList.toggle('open'); this.setAttribute('aria-expanded', o ? 'true' : 'false'); });
    $('period').addEventListener('change', function () { state.period = MD.period($('period').value); writeHash(); render(); });
    $('refresh').addEventListener('click', function () { MD.clearCache(); MD.clearOrderCache(); render(); });
    select(h.v || 'founder');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window.MD = window.MD || {});
