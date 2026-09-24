/* Monday Dashboard · Performance report (MMC audit format) and Carts & checkouts. */
(function (MD) {
  'use strict';
  var F = MD.fmt, esc = F.esc, sum = MD.sum;
  MD.views = MD.views || {};
  function safe(p) { return p.then(function (v) { return { ok: true, v: v }; }, function (e) { return { ok: false, e: e }; }); }
  var HUMAN = "WHERE human_or_bot_session = 'human'";
  var TAGS = {
    data: '<span class="tag tag-data">Data-backed</span>',
    inf: '<span class="tag tag-inf">Strategic inference</span>',
    exp: '<span class="tag tag-exp">Experimental</span>',
    asm: '<span class="tag tag-asm">Assumption</span>'
  };
  MD.TAGS = TAGS;

  /* ================= data ================= */
  function monthKey(v) { return String(v).slice(0, 7); }
  function monthsBack(n) {
    var t = MD.today(), y = +t.slice(0, 4), m = +t.slice(5, 7), out = [];
    for (var i = n - 1; i >= 0; i--) { var mm = m - i, yy = y; while (mm < 1) { mm += 12; yy--; } out.push(yy + '-' + ('0' + mm).slice(-2)); }
    return out;
  }

  function loadMonthly(nMonths) {
    var months = monthsBack(nMonths), since = months[0] + '-01', until = MD.today();
    var r = 'SINCE ' + since + ' UNTIL ' + until;
    return Promise.all([
      MD.ql('FROM sales SHOW orders, gross_sales, discounts, sales_reversals, net_sales, shipping_charges, taxes, total_sales, quantity_ordered, new_customers, returning_customers, cost_of_goods_sold TIMESERIES month ' + r),
      safe(MD.ql('FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout ' + HUMAN + ' TIMESERIES month ' + r)),
      safe(MD.ql('FROM sales SHOW orders, net_sales, total_sales GROUP BY referring_channel WITH LAST_NON_DIRECT_CLICK_ATTRIBUTION ' + r)),
      safe(MD.ql('FROM sales SHOW net_sales, orders GROUP BY product_title ' + r + ' ORDER BY net_sales DESC LIMIT 25')),
      safe(MD.ql('FROM sessions SHOW sessions, sessions_that_completed_checkout ' + HUMAN + ' GROUP BY session_device_type ' + r))
    ]).then(function (res) {
      var sales = {}, sess = {};
      res[0].forEach(function (x) { sales[monthKey(x.month)] = x; });
      if (res[1].ok) res[1].v.forEach(function (x) { sess[monthKey(x.month)] = x; });
      var spendBy = MD.groupBy(MD.state.spend.filter(function (s) { return s.date >= since; }), function (s) { return s.date.slice(0, 7); });
      var rows = months.map(function (m) {
        var s = sales[m] || {}, se = sess[m] || {}, sp = spendBy[m] || [];
        return buildMonth(m, s, se, sp);
      });
      return { months: rows, since: since, until: until, channels: res[2], products: res[3], devices: res[4], sessionsOk: res[1].ok, sessionsErr: res[1].e };
    });
  }

  /* Economics for one month from ShopifyQL aggregates and Settings. */
  function buildMonth(m, s, se, sp) {
    var S = MD.settings, n = v(s.orders);
    var o = {
      m: m, orders: n, gross: v(s.gross_sales), discounts: Math.abs(v(s.discounts)), reversals: Math.abs(v(s.sales_reversals)), net: v(s.net_sales),
      shipping: v(s.shipping_charges), taxes: v(s.taxes), total: v(s.total_sales), units: v(s.quantity_ordered), newc: v(s.new_customers), ret: v(s.returning_customers),
      cogsReported: v(s.cost_of_goods_sold),
      sessions: v(se.sessions), atc: v(se.sessions_with_cart_additions), reached: v(se.sessions_that_reached_checkout), completed: v(se.sessions_that_completed_checkout),
      spend: sum(sp, function (x) { return x.spend; }), claimedRev: sum(sp, function (x) { return x.revenue; }), claimedPurch: sum(sp, function (x) { return x.purchases; }),
      impressions: sum(sp, function (x) { return x.impressions; }), clicks: sum(sp, function (x) { return x.clicks; }), spendDays: sp.length
    };
    o.cogsEstimated = !(o.cogsReported > 0.05 * o.net);
    o.cogs = o.cogsEstimated ? o.net * S.cogsFallbackPct : o.cogsReported;
    o.econ = economics(o, S);
    o.aovTotal = F.ratio(o.total, n); o.aovNet = F.ratio(o.net, n);
    o.mer = F.ratio(o.net, o.spend); o.merTotal = F.ratio(o.total, o.spend);
    o.cvr = F.ratio(n, o.sessions);
    o.returnPct = F.ratio(o.ret, o.ret + o.newc);
    o.cac = F.ratio(o.spend, o.newc);
    return o;
  }
  function v(x) { return x == null || isNaN(x) ? 0 : +x; }

  /* Contribution before ads, per period, with optional scenario overrides. */
  function economics(o, S, over) {
    over = over || {};
    var n = o.orders, gst = 1 + (S.gstRate == null ? 0.18 : S.gstRate);
    var discounts = over.discountRate != null ? o.gross * over.discountRate : o.discounts;
    var net = o.gross - discounts - o.reversals;
    var cogs = o.cogsEstimated ? net * S.cogsFallbackPct : o.cogs * (o.net ? net / o.net : 1);
    var shipIn = (over.shippingRecovered ? n * S.shipCostPerOrder : o.shipping / gst);
    var codShare = S.codShareEstimate == null ? 0.4 : S.codShareEstimate;
    var fees = (1 - codShare) * S.gatewayPct * (net + shipIn) * gst + codShare * n * S.codFeePerOrder;
    var rtoRate = codShare * S.codRtoRate + (1 - codShare) * S.prepaidRtoRate;
    var rto = n * rtoRate * (S.shipCostPerOrder + S.rtoReverseCost + S.packagingPerOrder);
    var shipCost = n * S.shipCostPerOrder, pack = n * S.packagingPerOrder;
    var contribution = net - cogs - shipCost + shipIn - pack - fees - rto;
    return { net: net, discounts: discounts, cogs: cogs, shipIn: shipIn, shipCost: shipCost, pack: pack, fees: fees, rto: rto, contribution: contribution, perOrder: F.ratio(contribution, n), breakEvenMer: contribution > 0 && net > 0 ? net / contribution : null };
  }
  MD.reportEconomics = economics;

  function totals(rows) {
    var keys = ['orders', 'gross', 'discounts', 'reversals', 'net', 'shipping', 'taxes', 'total', 'units', 'newc', 'ret', 'cogs', 'cogsReported', 'sessions', 'atc', 'reached', 'completed', 'spend', 'claimedRev', 'claimedPurch', 'impressions', 'clicks'];
    var t = { m: 'Total' };
    keys.forEach(function (k) { t[k] = sum(rows, function (r) { return r[k]; }); });
    t.cogsEstimated = rows.some(function (r) { return r.cogsEstimated && r.orders; });
    t.cogs = sum(rows, function (r) { return r.cogs; });
    t.econ = economics(t, MD.settings);
    t.aovTotal = F.ratio(t.total, t.orders); t.aovNet = F.ratio(t.net, t.orders);
    t.mer = F.ratio(t.net, t.spend); t.merTotal = F.ratio(t.total, t.spend);
    t.cvr = F.ratio(t.orders, t.sessions); t.returnPct = F.ratio(t.ret, t.ret + t.newc); t.cac = F.ratio(t.spend, t.newc);
    return t;
  }

  /* ================= Performance report ================= */
  MD.views.report = function (el, p, alive) {
    var n = +(MD.state.reportMonths || 12);
    el.innerHTML = '<div class="loading">Building the report…</div>';
    return Promise.all([loadMonthly(n), MD.loadHistory(24).catch(function () { return null; })]).then(function (res) {
      if (!alive()) return;
      var D = res[0], hist = res[1], rows = D.months, T = totals(rows), S = MD.settings, E = T.econ;
      var active = rows.filter(function (r) { return r.orders || r.spend || r.sessions; });
      var html = '<div class="row sb noprint" style="margin-bottom:12px"><div class="row"><label class="muted">Report covers <select id="rep-months">' +
        [3, 6, 12, 24].map(function (k) { return '<option value="' + k + '"' + (k === n ? ' selected' : '') + '>last ' + k + ' months</option>'; }).join('') +
        '</select></label></div><button class="btn btn--primary" id="rep-print" type="button">Download as PDF</button></div>';

      html += '<div class="report-head"><div class="eyebrow">Performance report · ' + esc(MD.shop.name) + '</div><h2 class="rh">What the business actually produced</h2><p class="muted">Shopify from ' + F.month(rows[0].m) + ' to ' + F.month(rows[rows.length - 1].m) +
        ' · ad spend as entered in Monday Dashboard · all dates ' + esc(MD.shop.tz) + ' · prepared ' + F.date(MD.today()) + '</p></div>';

      if (!active.length) { el.innerHTML = html + MD.empty('No sales, sessions or spend in this range yet. The report fills in as the store trades.'); bind(el); return; }

      // Channel attribution (Shopify, last non-direct)
      var ch = D.channels.ok ? D.channels.v : [];
      var paidRe = /social|paid|meta|facebook|instagram/i;
      var socialSales = sum(ch.filter(function (x) { return paidRe.test(x.referring_channel || ''); }), function (x) { return x.total_sales__last_non_direct_click; });
      var socialOrders = sum(ch.filter(function (x) { return paidRe.test(x.referring_channel || ''); }), function (x) { return x.orders__last_non_direct_click; });

      // ---------- headline ----------
      var be = E.breakEvenMer;
      html += '<div class="card"><h2>The headline</h2><div class="kpis">' + [
        MD.kpi({ label: 'Ad spend', value: F.money(T.spend), sub: T.spend ? '' : 'none entered' }),
        MD.kpi({ label: 'Shopify total sales', value: F.money(T.total), sub: 'all channels' }),
        MD.kpi({ label: 'Orders (actual)', value: F.num(T.orders), sub: 'Shopify' }),
        MD.kpi({ label: 'True blended MER', value: F.x(T.mer), sub: 'net sales ÷ spend', hi: true }),
        MD.kpi({ label: 'Platform-claimed revenue', value: F.money(T.claimedRev), sub: T.claimedRev && T.total ? F.pct(T.claimedRev / T.total) + ' of all store sales' : '' }),
        MD.kpi({ label: 'Platform-claimed purchases', value: F.dec(T.claimedPurch), sub: T.orders ? F.pct(T.claimedPurch / T.orders) + ' of all orders' : '' }),
        MD.kpi({ label: 'Social-attributed sales', value: F.money(socialSales), sub: 'Shopify, last non-direct' }),
        MD.kpi({ label: 'Break-even MER', value: F.x(be), sub: be == null ? 'contribution is negative before ads' : (T.mer != null ? (T.mer >= be ? 'achieved' : 'not achieved') : ''), hi: true }),
        MD.kpi({ label: 'Sessions', value: F.num(T.sessions), sub: 'bots removed' }),
        MD.kpi({ label: 'Site conversion', value: F.pct(T.cvr), sub: 'orders ÷ sessions' }),
        MD.kpi({ label: 'AOV', value: F.money(T.aovTotal), sub: 'total-sales basis · ' + F.money(T.aovNet) + ' net' }),
        MD.kpi({ label: 'Cost per order', value: F.money(F.ratio(T.spend, T.orders)), sub: 'spend ÷ Shopify orders' }),
        MD.kpi({ label: 'New customers', value: F.num(T.newc) }),
        MD.kpi({ label: 'Returning customers', value: F.num(T.ret), sub: F.pct(T.returnPct) + ' of customers' }),
        MD.kpi({ label: 'Discount leakage', value: F.money(T.discounts), sub: F.pct(F.ratio(T.discounts, T.gross)) + ' of gross' }),
        MD.kpi({ label: 'Contribution after ads', value: F.money(E.contribution - T.spend), sub: n + ' months', hi: true })
      ].join('') + '</div>';
      if (T.claimedRev && T.total) {
        html += MD.note('<strong>Read the revenue figures together.</strong>Ad platforms reported ' + F.money(T.claimedRev) + ' of revenue and ' + F.dec(T.claimedPurch) + ' purchases. The whole store, across every channel, took ' + F.num(T.orders) + ' orders worth ' + F.money(T.total) +
          '. Shopify attributes ' + F.money(socialSales) + ' to social. The platforms credited themselves with ' + F.pct(T.claimedPurch / Math.max(T.orders, 1)) + ' of every order.', T.claimedPurch > 0.8 * T.orders ? 'bad' : 'info');
      }
      html += '</div>';

      // ---------- over-attribution + per-order economics ----------
      html += '<div class="cols">';
      html += '<div class="card"><h2>Platform claims against Shopify</h2>' + MD.table([{ label: 'Measure', key: 'k' }, { label: 'Platforms reported', n: 1, key: 'a' }, { label: 'Shopify actual', n: 1, key: 'b' }, { label: 'Gap', n: 1, key: 'c' }], [
        { k: 'Purchases / orders', a: F.dec(T.claimedPurch), b: F.num(T.orders) + ' (all sources)', c: T.orders ? 'claimed ' + F.pct(T.claimedPurch / T.orders) : '' },
        { k: 'Orders attributed to social', a: '', b: F.num(socialOrders), c: socialOrders ? 'over-counts ' + F.x(T.claimedPurch / socialOrders) : '' },
        { k: 'Revenue', a: F.money(T.claimedRev), b: F.money(T.total) + ' (all sources)', c: T.total ? 'claimed ' + F.pct(T.claimedRev / T.total) : '' },
        { k: 'Revenue attributed to social', a: '', b: F.money(socialSales), c: socialSales ? 'over-counts ' + F.x(T.claimedRev / socialSales) : '' },
        { k: 'Defensible measure: blended MER', a: '', b: F.x(T.mer), c: '', _cls: 'hl' }
      ]) + '<p class="muted small">Platform numbers are as entered in Ad spend. Shopify\'s "direct" bucket also holds referrer-stripped in-app browser traffic, so true platform contribution sits between the social-only read and the platform claim.</p></div>';

      html += '<div class="card"><h2>Per-order economics</h2>' + MD.table([{ label: '', key: 'k' }, { label: 'Per order', n: 1, key: 'a' }, { label: 'Period', n: 1, key: 'b' }], [
        econRow('Gross sales', T.gross), econRow('Discounts (' + F.pct(F.ratio(T.discounts, T.gross)) + ' of gross)', -T.discounts), econRow('Returns and reversals (' + F.pct(F.ratio(T.reversals, T.gross)) + ')', -T.reversals),
        econRow('Net sales', E.net, 'hl'), econRow('COGS' + (T.cogsEstimated ? ' at ' + F.pct(S.cogsFallbackPct) + ' ▲' : ''), -E.cogs), econRow('Shipping cost ▲', -E.shipCost), econRow('Shipping recovered (ex GST)', E.shipIn),
        econRow('Packaging ▲', -E.pack), econRow('Gateway and COD fees ▲', -E.fees), econRow('RTO losses ▲', -E.rto), econRow('Contribution', E.contribution, 'hl'),
        { k: 'CAC (spend ÷ new customers)', a: F.money(-T.cac), b: F.money(-T.spend) },
        { k: 'Net per new customer', a: F.money(E.perOrder - (T.cac || 0)), b: '', _cls: 'hl' }
      ]) + '<p class="muted small">▲ ' + TAGS.asm + ' from Settings. ' + (T.cogsEstimated ? 'Add "Cost per item" to variants in Shopify to replace the COGS estimate.' : 'COGS comes from Shopify product costs.') + '</p>';
      function econRow(k, val, cls) { return { k: k, a: F.money(F.ratio(val, T.orders)), b: F.money(val), _cls: cls || '' }; }
      html += (be != null ? MD.note('<strong>Break-even MER is ' + F.x(be) + '. The period delivered ' + F.x(T.mer) + '.</strong>' + (T.mer == null ? 'No ad spend has been entered.' : T.mer >= be ? 'Above break-even: every rupee of spend returned contribution.' : 'Below break-even: spend cost more than the orders it bought contributed.'), T.mer != null && T.mer < be ? 'bad' : 'ok') : MD.note('<strong>Orders lose money before any ad spend.</strong>Fix price, discount or shipping before spending more.', 'bad')) + '</div></div>';

      // ---------- month by month ----------
      html += '<div class="card"><h2>Every month, both systems, side by side</h2>' + MD.table([
        { label: 'Month', get: function (r) { return r.m === 'Total' ? 'Total' : F.month(r.m); } },
        { label: 'Ad spend', n: 1, get: function (r) { return F.num(r.spend); } }, { label: 'Claimed revenue', n: 1, get: function (r) { return F.num(r.claimedRev); } },
        { label: 'Shopify sales', n: 1, get: function (r) { return F.num(r.total); } }, { label: 'Orders', n: 1, get: function (r) { return F.num(r.orders); } },
        { label: 'AOV', n: 1, get: function (r) { return F.num(r.aovTotal); } },
        { label: 'True MER', n: 1, html: 1, get: function (r) { return r.mer == null ? '·' : '<b style="color:' + (be && r.mer >= be ? '#0c7a3d' : '#b42318') + '">' + F.x(r.mer) + '</b>'; } },
        { label: 'Sessions', n: 1, get: function (r) { return F.num(r.sessions); } }, { label: 'Site CVR', n: 1, html: 1, get: function (r) { return F.pct(r.cvr) + (integrityFlag(r) ? '*' : ''); } },
        { label: 'New cust.', n: 1, get: function (r) { return F.num(r.newc); } }, { label: 'Returning %', n: 1, get: function (r) { return F.pct(r.returnPct); } },
        { label: 'Contribution after ads', n: 1, get: function (r) { return F.num(r.econ.contribution - r.spend); } }
      ], active.concat([Object.assign({ _cls: 'total' }, T)])) + '<p class="muted small">MER uses net sales (ex GST, after discounts and returns). Green months cleared break-even (' + F.x(be) + '). * Conversion distorted by a checkout tracking gap; see Data integrity.</p>';
      var best = active.filter(function (r) { return r.mer != null && r.spend > 0; }).sort(function (a, b) { return b.mer - a.mer; });
      if (best.length > 1) {
        var bySpend = best.slice().sort(function (a, b) { return b.spend - a.spend; });
        html += '<div class="kpis" style="margin-top:12px">' + MD.kpi({ label: 'Best month on efficiency', value: F.month(best[0].m), sub: F.x(best[0].mer) + ' MER on ' + F.money(best[0].spend) }) +
          MD.kpi({ label: 'Worst month on efficiency', value: F.month(best[best.length - 1].m), sub: F.x(best[best.length - 1].mer) + ' MER on ' + F.money(best[best.length - 1].spend) }) +
          MD.kpi({ label: 'Biggest budget', value: F.month(bySpend[0].m), sub: F.money(bySpend[0].spend) + ' at ' + F.x(bySpend[0].mer) + ' MER' }) + '</div>';
      }
      html += '<h3>Spend against what the store banked</h3>' + MD.chart(active.map(function (r) { return r.m; }), [
        { name: 'Ad spend', type: 'bar', color: '#1c3f8f', values: active.map(function (r) { return r.spend; }), fmt: F.money, money: true },
        { name: 'Shopify total sales', type: 'bar', color: '#f5b400', values: active.map(function (r) { return r.total; }), fmt: F.money, money: true }
      ], { xfmt: F.month }) + '</div>';

      // ---------- trajectory ----------
      html += '<div class="card"><h2>The trajectory</h2><h3>True MER against break-even</h3>' + MD.chart(active.map(function (r) { return r.m; }), [
        { name: 'True MER', color: '#f5b400', values: active.map(function (r) { return r.mer; }), fmt: F.x },
        { name: 'Break-even MER', color: '#b42318', dash: true, values: active.map(function () { return be; }), fmt: F.x }
      ], { xfmt: F.month }) + '<h3>Orders and average order value</h3>' + MD.chart(active.map(function (r) { return r.m; }), [
        { name: 'Orders', type: 'bar', color: '#1c3f8f', values: active.map(function (r) { return r.orders; }), fmt: F.num },
        { name: 'AOV (total sales)', color: '#f5b400', axis: 'right', values: active.map(function (r) { return r.aovTotal; }), fmt: F.money, money: true }
      ], { xfmt: F.month }) + (D.sessionsOk ? '<h3>Site conversion rate</h3>' + MD.chart(active.map(function (r) { return r.m; }), [
        { name: 'Site conversion', type: 'bar', color: '#1c3f8f', values: active.map(function (r) { return r.cvr; }), fmt: F.pct, pct: true }
      ], { xfmt: F.month }) : '') + '</div>';

      // ---------- product mix ----------
      if (D.products.ok && D.products.v.length) {
        var pr = D.products.v, netAll = sum(pr, function (x) { return x.net_sales; }) || 1;
        var combos = pr.filter(function (x) { return /combo|bundle|set|kit|hamper|pack of|gift/i.test(x.product_title || ''); });
        html += '<div class="card"><h2>What the store actually sold</h2>' + MD.table([
          { label: 'Product', html: 1, get: function (x) { return esc(x.product_title) + MD.bar(x.net_sales, pr[0].net_sales); } }, { label: 'Net sales', n: 1, get: function (x) { return F.money(x.net_sales); } },
          { label: 'Orders containing', n: 1, get: function (x) { return F.num(x.orders); } }, { label: 'Sales per order', n: 1, get: function (x) { return F.money(F.ratio(x.net_sales, x.orders)); } },
          { label: 'Share of net', n: 1, get: function (x) { return F.pct(x.net_sales / netAll); } }
        ], pr) + (combos.length ? MD.note('<strong>Bundles and sets: ' + F.money(sum(combos, function (x) { return x.net_sales; })) + ', ' + F.pct(sum(combos, function (x) { return x.net_sales; }) / netAll) + ' of net sales.</strong>Their sales per order average ' + F.money(F.ratio(sum(combos, function (x) { return x.net_sales; }), sum(combos, function (x) { return x.orders; }))) + ' against a store AOV of ' + F.money(T.aovNet) + ' (net).', 'info') : '') + '</div>';
      }

      // ---------- funnel & site ----------
      html += '<div class="card"><h2>Funnel and site</h2><div class="cols"><div>' + MD.table([{ label: 'Stage', key: 'k' }, { label: 'Volume', n: 1, key: 'a' }, { label: 'Rate', n: 1, key: 'b' }], [
        { k: 'Ad impressions (entered)', a: F.num(T.impressions), b: '' },
        { k: 'Ad clicks (entered)', a: F.num(T.clicks), b: T.impressions ? F.pct(T.clicks / T.impressions) + ' CTR' : '' },
        { k: 'Sessions (Shopify, human)', a: F.num(T.sessions), b: T.clicks ? F.pct(T.sessions / T.clicks) + ' of clicks' : '' },
        { k: 'Sessions with cart additions', a: F.num(T.atc), b: F.pct(F.ratio(T.atc, T.sessions)) },
        { k: 'Sessions reaching checkout', a: F.num(T.reached), b: F.pct(F.ratio(T.reached, T.atc)) + ' of cart' },
        { k: 'Orders', a: F.num(T.orders), b: F.pct(T.cvr) + ' of sessions', _cls: 'hl' }
      ]) + '</div><div>' + (D.devices.ok ? MD.table([{ label: 'Device', get: function (x) { return x.session_device_type || '(none)'; } }, { label: 'Sessions', n: 1, get: function (x) { return F.num(x.sessions); } },
        { label: 'Share', n: 1, get: function (x) { return F.pct(x.sessions / Math.max(1, sum(D.devices.v, function (y) { return y.sessions; }))); } }, { label: 'CVR', n: 1, get: function (x) { return F.pct(F.ratio(x.sessions_that_completed_checkout, x.sessions)); } }], D.devices.v) : '') + '</div></div>';
      html += '<h3>Attribution by source (Shopify, last non-direct)</h3>' + MD.table([{ label: 'Source', get: function (x) { return x.referring_channel || '(none)'; } }, { label: 'Orders', n: 1, get: function (x) { return F.num(x.orders__last_non_direct_click); } },
        { label: 'Net sales', n: 1, get: function (x) { return F.money(x.net_sales__last_non_direct_click); } }, { label: 'Total sales', n: 1, get: function (x) { return F.money(x.total_sales__last_non_direct_click); } },
        { label: 'Share of orders', n: 1, get: function (x) { return F.pct(F.ratio(x.orders__last_non_direct_click, T.orders)); } }], ch.slice().sort(function (a, b) { return b.orders__last_non_direct_click - a.orders__last_non_direct_click; }), { empty: 'No attributed orders yet.' }) + '</div>';

      // ---------- customers & repeat ----------
      var q = MD.groupBy(active, function (r) { var mo = +r.m.slice(5, 7); return r.m.slice(0, 4) + ' Q' + Math.ceil(mo / 3); });
      var r90 = repeat90(hist);
      var c1 = E.perOrder || 0, reach = S.repeatReachCost == null ? 15 : S.repeatReachCost;
      html += '<div class="card"><h2>Customers and repeat behaviour</h2><div class="cols"><div>' + MD.table([{ label: 'Quarter', key: 'k' }, { label: 'Returning customer rate', n: 1, key: 'a' }, { label: 'New customers', n: 1, key: 'b' }],
        Object.keys(q).map(function (k) { var l = q[k]; return { k: k, a: F.pct(F.ratio(sum(l, function (r) { return r.ret; }), sum(l, function (r) { return r.ret + r.newc; }))), b: F.num(sum(l, function (r) { return r.newc; })) }; })) + '</div><div>' +
        '<div class="kpis">' + MD.kpi({ label: '90-day repeat rate', value: F.pct(r90.rate), sub: r90.n ? r90.n + ' customers old enough' : 'not enough history yet', hi: true }) + MD.kpi({ label: 'Max CAC at that rate', value: F.money(c1 + (r90.rate || 0) * (c1 - reach)) }) + '</div></div></div>' +
        '<h3>What each repeat rate lets you pay for a customer</h3>' + MD.table([{ label: '90-day repeat rate', key: 'r' }, { label: 'Contribution per acquired customer (before CAC)', n: 1, key: 'c' }, { label: 'Max defensible CAC', n: 1, key: 'm' }, { label: 'Against actual CAC ' + F.money(T.cac), key: 'v', html: 1 }],
          [0.1, 0.2, 0.3, 0.35].map(function (rr) { var cpa = c1 + rr * (c1 - reach); return { r: F.pct(rr), c: F.money(cpa), m: F.money(cpa), v: T.cac == null ? '' : cpa >= T.cac ? '<span class="badge b-ok">Works</span>' : '<span class="badge b-bad">Does not work</span>', _cls: r90.rate != null && Math.abs(rr - r90.rate) < 0.05 ? 'hl' : '' }; })) +
        '<p class="muted small">First-order contribution ' + F.money(c1) + '; a repeat order is assumed to cost ' + F.money(reach) + ' to win back (WhatsApp or email) ' + TAGS.asm + '.</p></div>';

      // ---------- margin leakage ----------
      var sc2 = economics(T, S, { discountRate: Math.min(0.02, F.ratio(T.discounts, T.gross) || 0) });
      var scBoth = economics(T, S, { discountRate: Math.min(0.02, F.ratio(T.discounts, T.gross) || 0), shippingRecovered: true });
      var subsidy = E.shipCost - E.shipIn;
      html += '<div class="card"><h2>Margin leakage</h2><div class="kpis">' +
        MD.kpi({ label: 'Discounts', value: F.money(T.discounts), sub: F.pct(F.ratio(T.discounts, T.gross)) + ' of gross' }) +
        MD.kpi({ label: 'Shipping subsidy', value: F.money(subsidy), sub: F.money(F.ratio(subsidy, T.orders)) + ' per order ' + (subsidy > 0 ? 'paid by you' : 'recovered') }) +
        MD.kpi({ label: 'Returns and reversals', value: F.money(T.reversals), sub: F.pct(F.ratio(T.reversals, T.gross)) + ' of gross (booked, not RTO)' }) + '</div>' +
        '<h3>Discount by month</h3>' + MD.table([{ label: 'Month', get: function (r) { return F.month(r.m); } }, { label: 'Discounts', n: 1, get: function (r) { return F.money(r.discounts); } }, { label: '% of gross', n: 1, get: function (r) { return F.pct(F.ratio(r.discounts, r.gross)); } }], active) +
        '<h3>What closing the leaks does</h3>' + MD.table([{ label: 'Scenario', key: 'k' }, { label: 'Contribution per order', n: 1, key: 'a' }, { label: 'Break-even MER', n: 1, key: 'b' }, { label: 'Against actual ' + F.x(T.mer), key: 'c', html: 1 }], [
          scen('As traded', E), scen('Discount cut to 2%', sc2), scen('Discount cut and shipping recovered', scBoth)
        ]) + '<p class="muted small">Both fixes are pricing and policy decisions. Neither needs new creative or more spend.</p></div>';
      function scen(k, e) { return { k: k, a: F.money(e.perOrder), b: F.x(e.breakEvenMer), c: T.mer == null || e.breakEvenMer == null ? '' : T.mer >= e.breakEvenMer ? '<span class="badge b-ok">Clears it</span>' : '<span class="badge b-bad">Misses by ' + F.x(e.breakEvenMer - T.mer) + '</span>' }; }

      // ---------- data integrity ----------
      html += integrity(active, D);

      // ---------- after the ads stopped ----------
      var lastSpend = -1; active.forEach(function (r, i) { if (r.spend > 0) lastSpend = i; });
      if (lastSpend >= 0 && lastSpend < active.length - 1 && active.slice(lastSpend + 1).every(function (r) { return !r.spend; })) {
        var dark = active.slice(lastSpend);
        html += '<div class="card"><h2>After the ads stopped</h2>' + MD.table([{ label: 'Month', get: function (r) { return F.month(r.m); } }, { label: 'Ad spend', n: 1, get: function (r) { return F.num(r.spend); } }, { label: 'Store revenue', n: 1, get: function (r) { return F.money(r.total); } },
          { label: 'Orders', n: 1, get: function (r) { return F.num(r.orders); } }, { label: 'Change', n: 1, html: 1, get: function (r, i) { return ''; } }, { label: 'Returning %', n: 1, get: function (r) { return F.pct(r.returnPct); } }], dark) +
          MD.note('<strong>Revenue fell ' + F.pct(1 - F.ratio(dark[1].total, dark[0].total)) + ' in the first month without ads.</strong>What is left is the organic and repeat base. That cohort is the asset a relaunch starts from.', 'warn') + '</div>';
      }

      // ---------- findings ----------
      html += '<div class="card"><h2>What the data tells us</h2><p class="sub">Findings ranked by business impact, generated from the numbers above.</p><ol class="findings">' + findings(T, E, active, sc2, socialSales, r90, D).map(function (f) {
        return '<li><strong>' + esc(f.h) + '</strong> ' + f.tag + '<div>' + esc(f.t) + '</div></li>';
      }).join('') + '</ol></div>';

      html += '<div class="card"><h2>Evidence tags</h2>' + MD.table([{ label: 'Tag', key: 't', html: 1 }, { label: 'Meaning', key: 'm' }, { label: 'How to treat it', key: 'h' }], [
        { t: TAGS.data, m: 'Directly supported by the store\'s own data', h: 'Act on it' }, { t: TAGS.inf, m: 'Strongly suggested by the data but not directly proven', h: 'Act on it, and verify as you go' },
        { t: TAGS.exp, m: 'Directionally promising, sample too small to be certain', h: 'Test once before scaling' }, { t: TAGS.asm, m: 'A figure from Settings, not from the data', h: 'Replace with a real number before deciding' }
      ]) + MD.note('<strong>The three numbers to watch.</strong>Blended MER, because no platform\'s attribution can inflate it. Contribution per order, because it says whether an order was worth taking. 90-day repeat rate, because it sets the most you can pay for a customer.', 'info') + '</div>';

      el.innerHTML = html;
      bind(el);
    });
  };

  function bind(el) {
    var s = el.querySelector('#rep-months');
    if (s) s.addEventListener('change', function () { MD.state.reportMonths = s.value; MD.rerender(); });
    var b = el.querySelector('#rep-print');
    if (b) b.addEventListener('click', function () { window.print(); });
  }

  function integrityFlag(r) { return r.orders >= 20 && r.completed != null && Math.abs(1 - F.ratio(r.completed, r.orders)) > 0.15; }

  function integrity(active, D) {
    var S = MD.settings;
    var h = '<div class="card"><h2>Data integrity</h2><p class="sub">The checks that catch broken tracking before it makes a healthy business look dead.</p>';
    if (D.sessionsOk) {
      h += '<h3>Sessions recorded completing checkout against real orders</h3>' + MD.table([
        { label: 'Month', get: function (r) { return F.month(r.m); } }, { label: 'Real orders', n: 1, get: function (r) { return F.num(r.orders); } },
        { label: 'Sessions completing checkout', n: 1, get: function (r) { return F.num(r.completed); } }, { label: 'Reported CVR', n: 1, get: function (r) { return F.pct(F.ratio(r.completed, r.sessions)); } },
        { label: 'Discrepancy', n: 1, html: 1, get: function (r) { if (!r.orders) return ''; var d = F.ratio(r.completed, r.orders) - 1; return Math.abs(d) > 0.15 && r.orders >= 20 ? '<span class="badge b-bad">' + F.pct(d) + '</span>' : '<span class="badge b-ok">Accurate</span>'; } },
        { label: 'Checkout ÷ cart sessions', n: 1, html: 1, get: function (r) { var x = F.ratio(r.reached, r.atc); return x == null ? '' : x > 1 ? '<span class="badge b-warn">' + F.dec(x) + '</span>' : F.dec(x); } }
      ], active.filter(function (r) { return r.orders || r.sessions; })) +
        '<p class="muted small">More checkout sessions than cart sessions means shoppers skip the cart (buy-now or direct-checkout), so cart-based comparisons across that change are not like for like.</p>';
    } else h += MD.err(D.sessionsErr, 'sessions');
    var days = MD.groupBy(MD.state.spend.filter(function (x) { return x.purchases != null; }), function (x) { return x.date; });
    var dkeys = Object.keys(days).sort().slice(-60);
    if (dkeys.length) {
      h += '<h3>Daily: platform purchases against Shopify orders</h3><p class="muted small">Alarm at ' + F.pct(S.divergenceAlarm || 0.15) + ' divergence. Load Revenue & orders for exact daily Shopify counts within the last 60 days.</p><div id="int-daily" class="loading">Loading daily orders…</div>';
      setTimeout(function () { dailyReconcile(dkeys, days); }, 0);
    }
    return h + '</div>';
  }

  function dailyReconcile(dkeys, days) {
    var from = dkeys[0], to = dkeys[dkeys.length - 1];
    MD.ql('FROM sales SHOW orders TIMESERIES day SINCE ' + from + ' UNTIL ' + to).then(function (rows) {
      var by = {}; rows.forEach(function (r) { by[String(r.day).slice(0, 10)] = r.orders; });
      var alarm = MD.settings.divergenceAlarm || 0.15, flagged = 0;
      var out = dkeys.slice().reverse().map(function (d) {
        var claimed = sum(days[d], function (x) { return x.purchases; }), shop = by[d] || 0, div = shop ? claimed / shop - 1 : null;
        if (div != null && Math.abs(div) > alarm) flagged++;
        return { d: d, c: claimed, s: shop, div: div };
      });
      var el = document.getElementById('int-daily'); if (!el) return;
      el.className = '';
      el.innerHTML = (flagged ? MD.note('<strong>' + flagged + ' of ' + out.length + ' days diverge by more than ' + F.pct(alarm) + '</strong>Check the pixel and Conversions API, or whether the platforms are claiming view-through and organic orders.', 'warn') : MD.note('<strong>Platform purchases track Shopify orders.</strong>No day diverges beyond the alarm.', 'ok')) +
        MD.table([{ label: 'Date', get: function (r) { return F.date(r.d); } }, { label: 'Platform purchases', n: 1, get: function (r) { return F.dec(r.c); } }, { label: 'Shopify orders', n: 1, get: function (r) { return F.num(r.s); } },
          { label: 'Divergence', n: 1, html: 1, get: function (r) { return r.div == null ? '<span class="muted">no orders</span>' : Math.abs(r.div) > alarm ? '<span class="badge b-bad">' + F.pct(r.div) + '</span>' : F.pct(r.div); } }], out.slice(0, 31));
    }).catch(function (e) { var el = document.getElementById('int-daily'); if (el) el.innerHTML = MD.err(e, 'daily orders'); });
  }

  function repeat90(hist) {
    if (!hist) return { rate: null, n: 0 };
    var custs = Object.keys(hist.byCustomer).map(function (k) { return hist.byCustomer[k]; }).filter(function (l) { return l.length; });
    var elig = custs.filter(function (l) { return MD.daysBetween(l[0].day, MD.today()) >= 90 && l[0].day >= hist.from; });
    return { rate: elig.length ? F.ratio(elig.filter(function (l) { return l[1] && MD.daysBetween(l[0].day, l[1].day) <= 90; }).length, elig.length) : null, n: elig.length };
  }

  /* Rule-based findings, ranked by money at stake. */
  function findings(T, E, active, sc2, socialSales, r90, D) {
    var S = MD.settings, out = [];
    function add(score, h, t, tag) { out.push({ s: score, h: h, t: t, tag: tag }); }
    if (T.claimedRev && T.total) {
      var factor = socialSales ? T.claimedRev / socialSales : T.claimedRev / T.net;
      if (factor > 1.2) add(T.claimedRev - socialSales, 'Ad platforms over-reported by about ' + F.x(factor), 'They claimed ' + F.money(T.claimedRev) + ' against ' + F.money(socialSales) + ' that Shopify attributes to social. Report blended MER and contribution, not platform ROAS, and reconcile platform purchases with Shopify orders daily.', TAGS.data);
    }
    if (T.spend && E.breakEvenMer && T.mer < E.breakEvenMer) add(E.breakEvenMer * T.spend - T.net, 'MER ' + F.x(T.mer) + ' is below break-even of ' + F.x(E.breakEvenMer), 'Every order covers its product and fulfilment cost, but not what it cost to acquire. Contribution after ads was ' + F.money(E.contribution - T.spend) + '.', TAGS.data);
    if (T.cac && E.perOrder != null && T.cac > E.perOrder) add((T.cac - E.perOrder) * T.newc, 'The business lost about ' + F.money(T.cac - E.perOrder) + ' on every new customer', F.money(E.perOrder) + ' contribution against a ' + F.money(T.cac) + ' CAC. Profit depends on the second order; see the repeat table.', TAGS.inf);
    var dr = F.ratio(T.discounts, T.gross);
    if (dr > 0.03) add(T.discounts - T.gross * 0.02, 'Discounts cost ' + F.money(T.discounts) + ', ' + F.pct(dr) + ' of gross', 'Cutting the discount rate to 2% moves contribution per order from ' + F.money(E.perOrder) + ' to ' + F.money(sc2.perOrder) + '. A permanent discount is a price cut that can never be taken back.', TAGS.data);
    var sub = E.shipCost - E.shipIn;
    if (sub > 0 && T.orders) add(sub, 'Shipping is subsidised by about ' + F.money(sub / T.orders) + ' per order', 'Customers paid ' + F.money(E.shipIn) + ' (ex GST) against an assumed ' + F.money(E.shipCost) + ' of courier cost. A free-shipping threshold that lifts basket size recovers it.', TAGS.asm);
    var bad = active.filter(integrityFlag);
    if (bad.length) add(sum(bad, function (r) { return r.total; }), 'Checkout tracking diverged from real orders in ' + bad.length + ' month' + (bad.length > 1 ? 's' : ''), bad.map(function (r) { return F.month(r.m) + ': ' + F.num(r.completed) + ' recorded vs ' + F.num(r.orders) + ' real'; }).join('; ') + '. Conversion in those months is not real; do not make budget decisions on it.', TAGS.data);
    if (T.cvr != null && T.sessions > 1000) add(0, 'Site conversion is ' + F.pct(T.cvr) + (T.cvr > 0.03 ? ', above the 1.5 to 3% Indian D2C norm' : T.cvr < 0.015 ? ', below the 1.5 to 3% Indian D2C norm' : ', within the Indian D2C norm'), T.cvr > 0.03 ? 'The store is not the problem. Spend effort upstream of the click and in the P&L.' : 'Look at landing pages and checkout before adding spend.', TAGS.data);
    var withSpend = active.filter(function (r) { return r.spend > 0 && r.mer != null; });
    if (withSpend.length >= 4) {
      var top = withSpend.slice().sort(function (a, b) { return b.spend - a.spend; }).slice(0, 2), bestM = withSpend.slice().sort(function (a, b) { return b.mer - a.mer; })[0];
      if (top.every(function (r) { return r.mer < T.mer; })) add(sum(top, function (r) { return r.spend; }) * 0.2, 'The biggest budgets were the least efficient months', F.month(top[0].m) + ' and ' + F.month(top[1].m) + ' carried the most spend at ' + F.x(top[0].mer) + ' and ' + F.x(top[1].mer) + ' MER; ' + F.month(bestM.m) + ' did ' + F.x(bestM.mer) + ' on ' + F.money(bestM.spend) + '. Scale into the season, not before it.', TAGS.inf);
    }
    var qs = active.filter(function (r) { return r.ret + r.newc > 20; });
    if (qs.length >= 6) {
      var first = qs.slice(0, 3), last = qs.slice(-3);
      var a = F.ratio(sum(first, function (r) { return r.ret; }), sum(first, function (r) { return r.ret + r.newc; })), b = F.ratio(sum(last, function (r) { return r.ret; }), sum(last, function (r) { return r.ret + r.newc; }));
      if (a != null && b != null) add(0, 'Returning-customer share moved from ' + F.pct(a) + ' to ' + F.pct(b), b > a ? 'The cohort is maturing. Retention flows (replenishment reminders, post-purchase, reviews) turn this into allowable CAC.' : 'Fewer customers are coming back. Fix retention before scaling acquisition.', TAGS.data);
    }
    if (r90.rate != null) add(0, '90-day repeat rate is ' + F.pct(r90.rate), 'On ' + r90.n + ' customers old enough to judge. This sets the most you can pay for a new customer; see the table in Customers and repeat.', r90.n > 200 ? TAGS.data : TAGS.exp);
    if (T.cogsEstimated && T.orders) add(0, 'Product costs are estimated at ' + F.pct(S.cogsFallbackPct), 'Break-even and contribution move sharply with COGS. Add the real cost per item to each variant in Shopify.', TAGS.asm);
    if (!T.spend) add(0, 'No ad spend has been entered for this period', 'MER, CAC, break-even and contribution after ads need it. Add it in the Ad spend tab.', TAGS.asm);
    return out.sort(function (a, b) { return b.s - a.s; }).slice(0, 10);
  }

  /* ================= Carts & checkouts ================= */
  var AB_Q = 'query ($q: String, $after: String) { abandonedCheckouts(first: 50, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) { pageInfo { hasNextPage endCursor } nodes { id name createdAt updatedAt completedAt discountCodes customer { id numberOfOrders } shippingAddress { province } subtotalPriceSet { shopMoney { amount } } totalPriceSet { shopMoney { amount } } lineItems(first: 20) { nodes { title variantTitle quantity product { id title } originalTotalPriceSet { shopMoney { amount } } } } } } }';
  function amt(m) { return m && m.shopMoney ? parseFloat(m.shopMoney.amount) || 0 : 0; }
  var DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  function dowIndex(v) {
    if (typeof v === 'number' || /^\d+$/.test(String(v))) return (+v) % 7;
    var s = String(v).slice(0, 3).toLowerCase(); var i = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(s); return i < 0 ? 0 : i;
  }

  MD.loadAbandoned = loadAbandoned;
  function loadAbandoned(from, to) {
    var all = [];
    function page(after) {
      return MD.gql(AB_Q, { q: 'created_at:>=' + from + ' created_at:<=' + to + 'T23:59:59', after: after || null }).then(function (d) {
        all = all.concat(d.abandonedCheckouts.nodes);
        return d.abandonedCheckouts.pageInfo.hasNextPage && all.length < 2000 ? page(d.abandonedCheckouts.pageInfo.endCursor) : all;
      });
    }
    return page();
  }

  MD.views.carts = function (el, p, alive) {
    el.innerHTML = '<div class="loading">Loading carts and checkouts…</div>';
    var r = 'SINCE ' + p.from + ' UNTIL ' + p.to;
    var metric = MD.state.cartMetric || 'sessions_with_cart_additions';
    return Promise.all([
      safe(MD.ql('FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout ' + HUMAN + ' ' + r)),
      safe(MD.ql('FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout ' + HUMAN + ' GROUP BY day_of_week, hour_of_day ' + r)),
      safe(MD.ql('FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout ' + HUMAN + ' TIMESERIES day ' + r)),
      safe(MD.ql("FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout WHERE landing_page_type = 'Product' AND human_or_bot_session = 'human' GROUP BY landing_page_path " + r + ' ORDER BY sessions_with_cart_additions DESC LIMIT 25')),
      safe(loadAbandoned(p.from, p.to))
    ]).then(function (res) {
      if (!alive()) return;
      var html = '';
      var t = res[0].ok && res[0].v[0] ? res[0].v[0] : null;
      if (t) {
        html += '<div class="card"><h2>Carts and checkouts</h2><p class="sub">Sessions, bots removed. A session counts once however many items it adds.</p><div class="kpis">' +
          MD.kpi({ label: 'Sessions that added to cart', value: F.num(t.sessions_with_cart_additions), sub: F.pct(F.ratio(t.sessions_with_cart_additions, t.sessions)) + ' of sessions' }) +
          MD.kpi({ label: 'Sessions that started checkout', value: F.num(t.sessions_that_reached_checkout), sub: F.pct(F.ratio(t.sessions_that_reached_checkout, t.sessions)) + ' of sessions' }) +
          MD.kpi({ label: 'Sessions that bought', value: F.num(t.sessions_that_completed_checkout), hi: true }) +
          MD.kpi({ label: 'Cart abandonment', value: F.pct(1 - (F.ratio(t.sessions_that_completed_checkout, t.sessions_with_cart_additions) || 0)), sub: 'added to cart, did not buy' }) +
          MD.kpi({ label: 'Checkout abandonment', value: F.pct(1 - (F.ratio(t.sessions_that_completed_checkout, t.sessions_that_reached_checkout) || 0)), sub: 'started checkout, did not buy' }) +
          '</div></div>';
      } else html += res[0].ok ? '' : MD.err(res[0].e, 'sessions');

      // Heatmap
      if (res[1].ok) {
        var grid = {}, max = 0;
        res[1].v.forEach(function (x) { var k = dowIndex(x.day_of_week) + '-' + (+x.hour_of_day); grid[k] = x; max = Math.max(max, x[metric] || 0); });
        var labels = { sessions_with_cart_additions: 'Added to cart', sessions_that_reached_checkout: 'Started checkout', sessions_that_completed_checkout: 'Bought', sessions: 'All sessions' };
        html += '<div class="card"><div class="row sb"><h2>When it happens</h2><div class="seg" id="cart-metric">' + Object.keys(labels).map(function (k) { return '<button type="button" data-m="' + k + '" aria-pressed="' + (k === metric) + '">' + labels[k] + '</button>'; }).join('') + '</div></div>' +
          '<p class="sub">Sessions by weekday and hour (' + esc(MD.shop.tz) + '). Darker is busier. Use it to time ads, WhatsApp and email sends.</p><div class="scroll"><table class="heatmap"><thead><tr><th></th>' +
          Array.from({ length: 24 }, function (_, h) { return '<th class="n">' + h + '</th>'; }).join('') + '<th class="n">Total</th></tr></thead><tbody>' +
          DOW.map(function (d, di) {
            var rowTot = 0;
            return '<tr><th>' + d + '</th>' + Array.from({ length: 24 }, function (_, h) {
              var x = grid[di + '-' + h], val = x ? x[metric] || 0 : 0; rowTot += val;
              return '<td class="hm" style="background:rgba(18,18,18,' + (max ? (val / max * 0.85).toFixed(2) : 0) + ');color:' + (max && val / max > 0.45 ? '#fff' : '#333') + '" title="' + d + ' ' + h + ':00 · ' + val + '">' + (val || '') + '</td>';
            }).join('') + '<td class="n"><b>' + F.num(rowTot) + '</b></td></tr>';
          }).join('') + '</tbody></table></div>';
        var hours = Array.from({ length: 24 }, function (_, h) { return sum(DOW.map(function (_, di) { return grid[di + '-' + h]; }).filter(Boolean), function (x) { return x[metric]; }); });
        var peakH = hours.indexOf(Math.max.apply(null, hours));
        var days = DOW.map(function (_, di) { return sum(Array.from({ length: 24 }, function (_, h) { return grid[di + '-' + h]; }).filter(Boolean), function (x) { return x[metric]; }); });
        var peakD = days.indexOf(Math.max.apply(null, days));
        if (max) html += '<p class="muted small">Peak hour ' + peakH + ':00 to ' + (peakH + 1) + ':00 · busiest day ' + DOW[peakD] + '.</p>';
        html += '</div>';
      }

      // Daily trend
      if (res[2].ok && res[2].v.length > 1) {
        var rows = res[2].v, dl = rows.map(function (x) { return String(x.day).slice(0, 10); });
        html += '<div class="card"><h2>By day</h2>' + MD.chart(dl, [
          { name: 'Added to cart', type: 'bar', color: '#121212', values: rows.map(function (x) { return x.sessions_with_cart_additions; }), fmt: F.num },
          { name: 'Started checkout', type: 'bar', color: '#e07a1f', values: rows.map(function (x) { return x.sessions_that_reached_checkout; }), fmt: F.num },
          { name: 'Bought', color: '#2c6ecb', values: rows.map(function (x) { return x.sessions_that_completed_checkout; }), fmt: F.num }
        ], { xfmt: F.date }) + '</div>';
      }

      // Product pages → cart
      if (res[3].ok) html += '<div class="card"><h2>Product pages that win or lose the cart</h2><p class="sub">Sessions that began on a product page. Shopify does not report cart additions per product, so this is the closest product-level view until Phase 2 event tracking.</p>' + MD.table([
        { label: 'Product page', get: function (x) { return x.landing_page_path; } }, { label: 'Sessions', n: 1, get: function (x) { return F.num(x.sessions); } },
        { label: 'Added to cart', n: 1, get: function (x) { return F.num(x.sessions_with_cart_additions); } }, { label: 'Cart rate', n: 1, get: function (x) { return F.pct(F.ratio(x.sessions_with_cart_additions, x.sessions)); } },
        { label: 'Started checkout', n: 1, get: function (x) { return F.num(x.sessions_that_reached_checkout); } }, { label: 'Bought', n: 1, get: function (x) { return F.num(x.sessions_that_completed_checkout); } }
      ], res[3].v, { empty: 'No product-page sessions yet.' }) + '</div>';

      // Abandoned checkouts
      html += '<div class="card"><h2>Abandoned checkouts</h2><p class="sub">Checkouts where the shopper gave contact details and left. These are the products people were about to buy.</p>';
      if (res[4].ok) {
        var ab = res[4].v, rec = ab.filter(function (x) { return x.completedAt; }), open = ab.filter(function (x) { return !x.completedAt; });
        var val = sum(open, function (x) { return amt(x.totalPriceSet); });
        html += '<div class="kpis">' + MD.kpi({ label: 'Abandoned checkouts', value: F.num(ab.length) }) + MD.kpi({ label: 'Value left behind', value: F.money(val), sub: 'not recovered', hi: true }) +
          MD.kpi({ label: 'Recovered later', value: F.num(rec.length), sub: F.pct(F.ratio(rec.length, ab.length)) + ' recovery rate' }) +
          MD.kpi({ label: 'Average abandoned basket', value: F.money(F.ratio(sum(ab, function (x) { return amt(x.totalPriceSet); }), ab.length)) }) +
          MD.kpi({ label: 'From returning customers', value: F.pct(F.ratio(ab.filter(function (x) { return x.customer && x.customer.numberOfOrders > 0; }).length, ab.length)) }) + '</div>';
        var prod = {};
        ab.forEach(function (x) {
          x.lineItems.nodes.forEach(function (li) {
            var k = (li.product ? li.product.title : li.title) + (li.variantTitle ? ' · ' + li.variantTitle : '');
            var r2 = prod[k] || (prod[k] = { k: k, n: 0, units: 0, value: 0, rec: 0 });
            r2.n++; r2.units += li.quantity; r2.value += amt(li.originalTotalPriceSet); if (x.completedAt) r2.rec++;
          });
        });
        var pl = Object.keys(prod).map(function (k) { return prod[k]; }).sort(function (a, b) { return b.value - a.value; });
        html += '<h3>Products left in checkout</h3>' + MD.table([
          { label: 'Product', html: 1, get: function (x) { return esc(x.k) + MD.bar(x.value, pl[0] ? pl[0].value : 1); } }, { label: 'Checkouts', n: 1, get: function (x) { return F.num(x.n); } },
          { label: 'Units', n: 1, get: function (x) { return F.num(x.units); } }, { label: 'Value', n: 1, get: function (x) { return F.money(x.value); } }, { label: 'Recovered', n: 1, get: function (x) { return F.pct(F.ratio(x.rec, x.n)); } }
        ], pl.slice(0, 25), { empty: 'No abandoned checkouts in this period.' });
        var byHour = Array.from({ length: 24 }, function () { return 0; });
        ab.forEach(function (x) { var h = +new Intl.DateTimeFormat('en-GB', { timeZone: MD.shop.tz, hour: '2-digit', hour12: false }).format(new Date(x.createdAt)) % 24; byHour[h]++; });
        if (ab.length) html += '<h3>When checkouts are abandoned</h3>' + MD.chart(byHour.map(function (_, h) { return String(h); }), [{ name: 'Abandoned checkouts', type: 'bar', color: '#b42318', values: byHour, fmt: F.num }], { xfmt: function (h) { return h + ':00'; }, height: 160 });
        html += '<h3>Latest</h3>' + MD.table([
          { label: 'When', get: function (x) { return new Date(x.createdAt).toLocaleString('en-IN', { timeZone: MD.shop.tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } },
          { label: 'Items', get: function (x) { return x.lineItems.nodes.map(function (li) { return li.quantity + '× ' + (li.product ? li.product.title : li.title) + (li.variantTitle ? ' (' + li.variantTitle + ')' : ''); }).join(', '); } },
          { label: 'Value', n: 1, get: function (x) { return F.money(amt(x.totalPriceSet)); } },
          { label: 'Customer', get: function (x) { return x.customer ? (x.customer.numberOfOrders > 0 ? 'Returning (' + x.customer.numberOfOrders + ' orders)' : 'New') : 'Guest'; } },
          { label: 'State', get: function (x) { return x.shippingAddress ? x.shippingAddress.province || '' : ''; } },
          { label: 'Code', get: function (x) { return (x.discountCodes || []).join(', '); } },
          { label: 'Status', html: 1, get: function (x) { return x.completedAt ? '<span class="badge b-ok">Recovered</span>' : '<span class="badge b-warn">Open</span>'; } }
        ], ab.slice(0, 50), { empty: 'No abandoned checkouts in this period.' });
      } else html += MD.err(res[4].e, 'abandoned checkouts');
      html += '</div>';

      html += '<div class="card"><h2>Coming in Phase 2</h2><p class="sub">Shopify does not keep these, so they need event tracking (a Web Pixel) and a small data store: every add-to-cart click with the product, variant and time; products added but never taken to checkout (abandoned carts); remove-from-cart; and the checkout step where each shopper stopped.</p></div>';
      el.innerHTML = html;
      Array.prototype.forEach.call(el.querySelectorAll('#cart-metric [data-m]'), function (b) {
        b.addEventListener('click', function () { MD.state.cartMetric = b.getAttribute('data-m'); MD.rerender(); });
      });
    });
  };
})(window.MD = window.MD || {});
