/* Monday Dashboard · Journeys: winning landing pages, funnel waterfalls, first-to-converting landing journeys. */
(function (MD) {
  'use strict';
  var F = MD.fmt, esc = F.esc, sum = MD.sum;
  MD.views = MD.views || {};
  function safe(p) { return p.then(function (v) { return { ok: true, v: v }; }, function (e) { return { ok: false, e: e }; }); }
  var HUMAN = "WHERE human_or_bot_session = 'human'";
  var FUN = 'sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout';

  /* Waterfall: first bar full, each next bar shows what is left and the drop in red. */
  MD.waterfall = function (steps, opts) {
    opts = opts || {};
    var W = 720, H = opts.height || 230, pl = 10, pr = 10, pt = 22, pb = 44;
    var n = steps.length, max = steps[0] ? steps[0].value || 0 : 0;
    if (!n || !max) return MD.empty('No sessions for this page yet.');
    var slot = (W - pl - pr) / n, bw = Math.min(90, slot * 0.62), ih = H - pt - pb;
    function y(v) { return pt + ih - v / max * ih; }
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Journey waterfall">';
    steps.forEach(function (st, i) {
      var x = pl + slot * i + (slot - bw) / 2, prev = i ? steps[i - 1].value : st.value, drop = Math.max(0, prev - st.value);
      var top = Math.min(y(prev), y(st.value)), dropH = i ? y(st.value) - y(prev) : 0;
      if (i && drop) {
        s += '<rect x="' + x + '" y="' + y(prev) + '" width="' + bw + '" height="' + dropH + '" fill="#f3c1bb" rx="2"><title>Dropped: ' + F.num(drop) + '</title></rect>';
        if (dropH >= 20) s += '<text x="' + (x + bw / 2) + '" y="' + (y(prev) + dropH / 2 + 4) + '" text-anchor="middle" class="wf-drop">−' + F.num(drop) + '</text>';
      }
      s += '<rect x="' + x + '" y="' + y(st.value) + '" width="' + bw + '" height="' + Math.max(0, pt + ih - y(st.value)) + '" fill="' + (i === n - 1 ? '#C6FF00' : '#121212') + '" rx="2"><title>' + esc(st.label) + ': ' + F.num(st.value) + '</title></rect>';
      s += '<text x="' + (x + bw / 2) + '" y="' + (top - 5) + '" text-anchor="middle" class="wf-val">' + F.num(st.value) + '</text>';
      s += '<text x="' + (x + bw / 2) + '" y="' + (H - 26) + '" text-anchor="middle" class="ax">' + esc(st.label) + '</text>';
      s += '<text x="' + (x + bw / 2) + '" y="' + (H - 12) + '" text-anchor="middle" class="ax">' + (i ? F.pct(F.ratio(st.value, prev)) + ' kept' + (drop && dropH < 20 ? ' · −' + F.num(drop) : '') : '100%') + '</text>';
    });
    return s + '</svg>';
  };

  MD.views.journeys = function (el, p, alive) {
    el.innerHTML = '<div class="loading">Loading journeys…</div>';
    var r = 'SINCE ' + p.from + ' UNTIL ' + p.to;
    return Promise.all([
      safe(MD.ql('FROM sessions SHOW ' + FUN + ', bounce_rate ' + HUMAN + ' GROUP BY landing_page_path ' + r + ' ORDER BY sessions DESC LIMIT 60')),
      safe(MD.ql('FROM sessions SHOW ' + FUN + ', bounce_rate ' + HUMAN + ' GROUP BY landing_page_type ' + r)),
      safe(MD.ql('FROM sales SHOW orders, net_sales GROUP BY order_landing_page_path ' + r + ' ORDER BY orders DESC LIMIT 60')),
      safe(MD.ql('FROM sessions SHOW ' + FUN + ' ' + HUMAN + ' GROUP BY landing_page_path, referring_channel ' + r + ' ORDER BY sessions DESC LIMIT 60')),
      MD.periodOrders(p).then(function (d) { return { ok: true, v: d }; }, function (e) { return { ok: false, e: e }; })
    ]).then(function (res) {
      if (!alive()) return;
      var html = '';
      var lp = res[0].ok ? res[0].v : [], sales = {};
      if (res[2].ok) res[2].v.forEach(function (x) { sales[x.order_landing_page_path || ''] = x; });
      var totS = sum(lp, function (x) { return x.sessions; }), totC = sum(lp, function (x) { return x.sessions_that_completed_checkout; });
      var storeCvr = F.ratio(totC, totS);
      var minS = Math.max(20, Math.round(totS * 0.01));
      lp.forEach(function (x) {
        var sl = sales[x.landing_page_path] || {};
        x.cvr = F.ratio(x.sessions_that_completed_checkout, x.sessions);
        x.cart = F.ratio(x.sessions_with_cart_additions, x.sessions);
        x.orders = sl.orders || 0; x.net = sl.net_sales || 0;
        x.rps = F.ratio(x.net, x.sessions);
        x.enough = x.sessions >= minS;
        x.lift = storeCvr ? (x.cvr || 0) / storeCvr : null;
      });

      // ---------- store-wide journey waterfall ----------
      var all = { label: 'Sessions', value: totS };
      html += '<div class="card"><h2>The journey, store-wide</h2><p class="sub">Every human session in the period, and where shoppers dropped out. Red is the drop at each step.</p>' + MD.waterfall([
        all,
        { label: 'Added to cart', value: sum(lp, function (x) { return x.sessions_with_cart_additions; }) },
        { label: 'Reached checkout', value: sum(lp, function (x) { return x.sessions_that_reached_checkout; }) },
        { label: 'Bought', value: totC }
      ]) + '<p class="muted small">Shopify\'s funnel is open: a session can reach checkout without a recorded cart addition (buy-now), so a later step can be larger than the one before.</p></div>';

      // ---------- winning landing pages ----------
      var ranked = lp.filter(function (x) { return x.enough; }).sort(function (a, b) { return (b.cvr || 0) - (a.cvr || 0) || b.sessions - a.sessions; });
      var small = lp.filter(function (x) { return !x.enough; });
      html += '<div class="card"><h2>Winning landing pages</h2><p class="sub">Ranked by conversion, among pages with at least ' + F.num(minS) + ' sessions so small samples don\'t top the list. Store conversion is ' + F.pct(storeCvr) + '. Revenue per session tells you what a visit to that page is worth, which caps what you can pay per click.</p>' +
        (res[0].ok ? MD.table(lpCols(storeCvr, true), ranked, { empty: 'No landing page has ' + minS + ' sessions yet. Pages with fewer are listed below.' }) : MD.err(res[0].e, 'landing pages'));
      if (small.length) html += '<details><summary>' + small.length + ' pages with fewer than ' + minS + ' sessions</summary>' + MD.table(lpCols(storeCvr, false), small) + '</details>';
      html += '</div>';

      // ---------- per-page waterfall ----------
      var sel = MD.state.journeyPage && lp.some(function (x) { return x.landing_page_path === MD.state.journeyPage; }) ? MD.state.journeyPage : (ranked[0] || lp[0] || {}).landing_page_path;
      var pg = lp.filter(function (x) { return x.landing_page_path === sel; })[0];
      html += '<div class="card"><div class="row sb"><h2>Landing page waterfall</h2><select id="jr-page">' + lp.map(function (x) { return '<option value="' + esc(x.landing_page_path) + '"' + (x.landing_page_path === sel ? ' selected' : '') + '>' + esc(x.landing_page_path || '(none)') + ' · ' + F.num(x.sessions) + ' sessions</option>'; }).join('') + '</select></div>';
      if (pg) {
        html += MD.waterfall([
          { label: 'Landed', value: pg.sessions }, { label: 'Stayed', value: Math.round(pg.sessions * (1 - (pg.bounce_rate || 0))) },
          { label: 'Added to cart', value: pg.sessions_with_cart_additions }, { label: 'Reached checkout', value: pg.sessions_that_reached_checkout }, { label: 'Bought', value: pg.sessions_that_completed_checkout }
        ]) + '<div class="kpis" style="margin-top:10px">' +
          MD.kpi({ label: 'Bounce rate', value: F.pct(pg.bounce_rate), sub: 'left after one page' }) + MD.kpi({ label: 'Cart rate', value: F.pct(pg.cart), sub: 'store ' + F.pct(F.ratio(sum(lp, function (x) { return x.sessions_with_cart_additions; }), totS)) }) +
          MD.kpi({ label: 'Conversion', value: F.pct(pg.cvr), sub: pg.lift != null ? F.x(pg.lift) + ' the store rate' : '', hi: true }) + MD.kpi({ label: 'Revenue per session', value: F.money2(pg.rps) }) + '</div>';
        if (res[3].ok) {
          var byCh = res[3].v.filter(function (x) { return x.landing_page_path === sel; });
          if (byCh.length) html += '<h3>Same page, by channel</h3><p class="muted small">Is the traffic poor or the page? If one channel converts on this page and another doesn\'t, it\'s the traffic.</p>' + MD.table([
            { label: 'Channel', get: function (x) { return x.referring_channel || '(none)'; } }, { label: 'Sessions', n: 1, get: function (x) { return F.num(x.sessions); } },
            { label: 'Cart rate', n: 1, get: function (x) { return F.pct(F.ratio(x.sessions_with_cart_additions, x.sessions)); } }, { label: 'Reached checkout', n: 1, get: function (x) { return F.pct(F.ratio(x.sessions_that_reached_checkout, x.sessions)); } },
            { label: 'Conversion', n: 1, get: function (x) { return F.pct(F.ratio(x.sessions_that_completed_checkout, x.sessions)); } }
          ], byCh);
        }
      } else html += MD.empty('No landing pages yet.');
      html += '</div>';

      // ---------- by page type ----------
      if (res[1].ok && res[1].v.length) {
        html += '<div class="card"><h2>By type of landing page</h2>' + MD.table([
          { label: 'Page type', get: function (x) { return x.landing_page_type || '(other)'; } }, { label: 'Sessions', n: 1, get: function (x) { return F.num(x.sessions); } },
          { label: 'Bounce', n: 1, get: function (x) { return F.pct(x.bounce_rate); } }, { label: 'Cart rate', n: 1, get: function (x) { return F.pct(F.ratio(x.sessions_with_cart_additions, x.sessions)); } },
          { label: 'Reached checkout', n: 1, get: function (x) { return F.pct(F.ratio(x.sessions_that_reached_checkout, x.sessions)); } }, { label: 'Conversion', n: 1, get: function (x) { return F.pct(F.ratio(x.sessions_that_completed_checkout, x.sessions)); } }
        ], res[1].v.sort(function (a, b) { return b.sessions - a.sessions; })) + '</div>';
      }

      // ---------- first landing → converting landing ----------
      html += '<div class="card"><h2>First landing page to converting landing page</h2><p class="sub">For each order, Shopify records the page of the shopper\'s first visit and of the visit that ended in the purchase. This shows which pages introduce buyers and which pages close them.</p>';
      if (res[4].ok) {
        var orders = MD.valid(res[4].v.cur).filter(function (e) { return e.firstVisit || e.lastVisit; });
        if (!orders.length) html += MD.empty('No orders with a recorded journey in this period yet.');
        else {
          var pairs = {}, firsts = {}, closers = {};
          orders.forEach(function (e) {
            var a = e.firstVisit ? MD.pathOf(e.firstVisit.landingPage || '') || '(none)' : '(none)';
            var b = e.lastVisit ? MD.pathOf(e.lastVisit.landingPage || '') || '(none)' : a;
            var k = a + '→' + b, visits = e.raw.customerJourneySummary && e.raw.customerJourneySummary.momentsCount ? e.raw.customerJourneySummary.momentsCount.count : null;
            var r2 = pairs[k] || (pairs[k] = { a: a, b: b, n: 0, rev: 0, days: [], visits: [] });
            r2.n++; r2.rev += e.netMerch; if (e.daysToConvert != null) r2.days.push(e.daysToConvert); if (visits != null) r2.visits.push(visits);
            firsts[a] = (firsts[a] || 0) + 1; closers[b] = (closers[b] || 0) + 1;
          });
          var pl = Object.keys(pairs).map(function (k) { return pairs[k]; }).sort(function (x, y) { return y.n - x.n; });
          var same = sum(pl.filter(function (x) { return x.a === x.b; }), function (x) { return x.n; });
          html += '<div class="kpis">' + MD.kpi({ label: 'Orders with a recorded journey', value: F.num(orders.length) }) +
            MD.kpi({ label: 'Converted on the page they first landed on', value: F.pct(same / orders.length), sub: 'the rest came back through another page' }) +
            MD.kpi({ label: 'Median days to convert', value: F.dec(median(orders.map(function (e) { return e.daysToConvert; }).filter(function (x) { return x != null; }))) }) +
            MD.kpi({ label: 'Median visits before buying', value: F.dec(median(orders.map(function (e) { var j = e.raw.customerJourneySummary; return j && j.momentsCount ? j.momentsCount.count : null; }).filter(function (x) { return x != null; }))), hi: true }) + '</div>';
          html += '<h3>Top journeys</h3>' + MD.table([
            { label: 'First landed on', key: 'a' }, { label: '', html: 1, get: function () { return '→'; } }, { label: 'Converted from', key: 'b' },
            { label: 'Orders', n: 1, get: function (x) { return F.num(x.n); } }, { label: 'Share', n: 1, get: function (x) { return F.pct(x.n / orders.length); } },
            { label: 'Revenue', n: 1, get: function (x) { return F.money(x.rev); } }, { label: 'Median days', n: 1, get: function (x) { return F.dec(median(x.days)); } }, { label: 'Median visits', n: 1, get: function (x) { return F.dec(median(x.visits)); } }
          ], pl.slice(0, 25));
          function topList(obj) { return Object.keys(obj).map(function (k) { return { k: k, n: obj[k] }; }).sort(function (x, y) { return y.n - x.n; }).slice(0, 10); }
          html += '<div class="cols" style="margin-top:12px"><div><h3>Pages that introduce buyers</h3>' + MD.table([{ label: 'First landing page', key: 'k' }, { label: 'Orders started here', n: 1, get: function (x) { return F.num(x.n); } }], topList(firsts)) + '</div>' +
            '<div><h3>Pages that close buyers</h3>' + MD.table([{ label: 'Converting landing page', key: 'k' }, { label: 'Orders closed here', n: 1, get: function (x) { return F.num(x.n); } }], topList(closers)) + '</div></div>';

          // Visits-to-purchase waterfall
          var buckets = [0, 0, 0, 0];
          orders.forEach(function (e) { var j = e.raw.customerJourneySummary, c = j && j.momentsCount ? j.momentsCount.count : null; if (c == null) return; buckets[Math.min(3, Math.max(1, c) - 1)]++; });
          var known = sum(buckets, function (x) { return x; });
          if (known) html += '<h3>How many visits it took</h3>' + MD.table([{ label: 'Visits before buying', key: 'k' }, { label: 'Orders', n: 1, key: 'n' }, { label: 'Share', n: 1, key: 's' }],
            ['1 (bought on first visit)', '2', '3', '4 or more'].map(function (k, i) { return { k: k, n: F.num(buckets[i]), s: F.pct(buckets[i] / known) }; }));
        }
      } else html += MD.err(res[4].e, 'orders');
      html += '<p class="muted small">Shopify stores the first and the converting visit for each order, not every page in between. The full page-by-page path needs Phase 2 event tracking.</p></div>';

      el.innerHTML = html;
      var s = el.querySelector('#jr-page');
      if (s) s.addEventListener('change', function () { MD.state.journeyPage = s.value; MD.rerender(); });
    });
  };

  function lpCols(storeCvr, verdict) {
    var c = [
      { label: 'Landing page', get: function (x) { return x.landing_page_path || '(none)'; } },
      { label: 'Sessions', n: 1, get: function (x) { return F.num(x.sessions); } },
      { label: 'Bounce', n: 1, get: function (x) { return F.pct(x.bounce_rate); } },
      { label: 'Cart rate', n: 1, get: function (x) { return F.pct(x.cart); } },
      { label: 'Checkout', n: 1, get: function (x) { return F.pct(F.ratio(x.sessions_that_reached_checkout, x.sessions)); } },
      { label: 'Conversion', n: 1, html: 1, get: function (x) { return '<b>' + F.pct(x.cvr) + '</b>'; } },
      { label: 'Orders', n: 1, get: function (x) { return F.num(x.orders); } },
      { label: 'Revenue / session', n: 1, get: function (x) { return F.money2(x.rps); } }
    ];
    if (verdict) c.push({ label: '', html: 1, get: function (x) {
      if (x.lift == null) return '';
      return x.lift >= 1.25 ? '<span class="badge b-ok">Winner</span>' : x.lift <= 0.6 ? '<span class="badge b-bad">Leaking</span>' : '<span class="badge b-off">Average</span>';
    } });
    return c;
  }
  function median(a) { a = a.slice().sort(function (x, y) { return x - y; }); return a.length ? a[Math.floor(a.length / 2)] : null; }
})(window.MD = window.MD || {});
