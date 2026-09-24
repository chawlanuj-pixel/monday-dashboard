/* Monday Dashboard · order-based views: Founder, Revenue & orders, Finance & ops. */
(function (MD) {
  'use strict';
  var F = MD.fmt, esc = F.esc, sum = MD.sum;
  MD.views = MD.views || {};

  /* ---------- shared metrics for a set of orders ---------- */
  MD.metrics = function (orders, from, to) {
    var valid = MD.valid(orders);
    var spendRows = MD.spendIn(from, to);
    var m = {
      placed: orders.length,
      orders: valid.length,
      cancelled: orders.length - valid.length,
      units: sum(valid, function (e) { return e.units; }),
      gross: sum(valid, function (e) { return e.grossMerch; }),
      discounts: sum(valid, function (e) { return e.discounts; }),
      net: sum(valid, function (e) { return e.netMerch; }),
      retained: sum(valid, function (e) { return e.rto ? 0 : e.netMerchRetained; }),
      delivered: sum(valid.filter(function (e) { return e.delivered; }), function (e) { return e.netMerchRetained; }),
      deliveredOrders: valid.filter(function (e) { return e.delivered; }).length,
      shipping: sum(valid, function (e) { return e.shipping; }),
      tax: sum(valid, function (e) { return e.tax; }),
      total: sum(valid, function (e) { return e.total; }),
      refunded: sum(orders, function (e) { return e.refunded; }),
      received: sum(orders, function (e) { return e.received; }),
      cod: valid.filter(function (e) { return e.cod; }).length,
      codValue: sum(valid.filter(function (e) { return e.cod; }), function (e) { return e.netMerch; }),
      newCustomers: valid.filter(function (e) { return e.isNew === true; }).length,
      newRevenue: sum(valid.filter(function (e) { return e.isNew === true; }), function (e) { return e.netMerch; }),
      returningOrders: valid.filter(function (e) { return e.isNew === false; }).length,
      contribution: sum(orders, MD.contribution),
      cogs: sum(valid, function (e) { return e.cogs; }),
      spend: sum(spendRows, function (r) { return r.spend; }),
      platformRevenue: sum(spendRows, function (r) { return r.revenue; }),
      platformPurchases: sum(spendRows, function (r) { return r.purchases; }),
      clicks: sum(spendRows, function (r) { return r.clicks; }),
      spendDays: MD.groupBy(spendRows, function (r) { return r.date; })
    };
    m.aov = F.ratio(m.net, m.orders);
    m.mer = F.ratio(m.net, m.spend);
    m.merDelivered = F.ratio(m.delivered, m.spend);
    m.cac = F.ratio(m.spend, m.newCustomers);
    m.afterAds = m.contribution - m.spend;
    m.codShare = F.ratio(m.cod, m.orders);
    m.discountRate = F.ratio(m.discounts, m.gross);
    m.newShare = F.ratio(m.newCustomers, m.orders);
    return m;
  };

  function progress(el) { return function (n) { var l = el.querySelector('.loading'); if (l) l.textContent = 'Loading orders… ' + n; }; }

  function truncNote(d) {
    var h = '';
    if (d.truncated) h += MD.note('<strong>Showing the latest orders only</strong>This period has more orders than the dashboard loads at once. Use a shorter period for exact totals.', 'warn');
    if (d.tests) h += '<p class="muted" style="font-size:12px;margin:0 0 8px">' + d.tests + ' test orders excluded.</p>';
    return h;
  }

  /* ================= Founder ================= */
  MD.views.founder = function (el, p, alive) {
    el.innerHTML = '<div class="loading">Loading orders…</div>';
    return MD.periodOrders(p, progress(el)).then(function (d) {
      if (!alive()) return;
      var c = MD.metrics(d.cur, p.from, p.to), v = MD.metrics(d.prev, p.prevFrom, p.prevTo), S = MD.settings;
      var html = truncNote(d);

      html += '<div class="card"><div class="row sb"><h2>Business truth</h2><span class="muted" style="font-size:12px">vs ' + esc(p.compareLabel) + '</span></div><p class="sub">What the store actually sold, what it cost to get, and what was left.</p><div class="kpis">' + [
        MD.kpi({ label: 'Orders', value: F.num(c.orders), delta: F.delta(c.orders, v.orders), sub: c.cancelled ? c.cancelled + ' cancelled' : '' }),
        MD.kpi({ label: 'Net merchandise revenue', value: F.money(c.net), delta: F.delta(c.net, v.net), sub: 'ex GST, after discounts', hi: true }),
        MD.kpi({ label: 'New customers', value: F.num(c.newCustomers), delta: F.delta(c.newCustomers, v.newCustomers), sub: F.pct(c.newShare) + ' of orders' }),
        MD.kpi({ label: 'Ad spend', value: F.money(c.spend), delta: F.delta(c.spend, v.spend, true), sub: c.spend ? '' : 'none entered' }),
        MD.kpi({ label: 'MER', value: F.x(c.mer), delta: F.delta(c.mer, v.mer), sub: 'target ' + F.x(S.targetMer), hi: true }),
        MD.kpi({ label: 'New-customer CAC', value: F.money(c.cac), delta: F.delta(c.cac, v.cac, true), sub: 'target ' + F.money(S.targetCac) }),
        MD.kpi({ label: 'Contribution after ads', value: F.money(c.afterAds), delta: F.delta(c.afterAds, v.afterAds), sub: F.money(F.ratio(c.afterAds, c.orders)) + ' per order', hi: true }),
        MD.kpi({ label: 'Prepaid / COD', value: F.pct(1 - (c.codShare || 0)) + ' / ' + F.pct(c.codShare || 0), sub: F.num(c.cod) + ' COD orders' }),
        MD.kpi({ label: 'Delivered revenue', value: F.money(c.delivered), delta: F.delta(c.delivered, v.delivered), sub: F.num(c.deliveredOrders) + ' orders delivered' }),
        MD.kpi({ label: 'AOV (merchandise)', value: F.money(c.aov), delta: F.delta(c.aov, v.aov), sub: F.dec(F.ratio(c.units, c.orders)) + ' units per order' })
      ].join('') + '</div></div>';

      // Guardrails
      var A = [];
      if (c.spend && c.mer != null && c.mer < S.targetMer) A.push(['warn', 'MER is below target', 'MER is ' + F.x(c.mer) + ' against a target of ' + F.x(S.targetMer) + '. Check whether spend grew faster than new customers.']);
      if (c.cac != null && c.cac > S.targetCac) A.push(['warn', 'New-customer CAC is above target', F.money(c.cac) + ' against ' + F.money(S.targetCac) + '.']);
      if (c.spend && v.spend && c.spend > v.spend * 1.15 && c.newCustomers <= v.newCustomers) A.push(['bad', 'Spend rose but new customers did not', 'Spend is up ' + F.pct(c.spend / v.spend - 1) + ' while new customers went from ' + v.newCustomers + ' to ' + c.newCustomers + '. Platform ROAS may be claiming demand you already had.']);
      if (c.afterAds < 0 && c.orders) A.push(['bad', 'Contribution after ads is negative', 'The period lost ' + F.money(-c.afterAds) + ' after product, fulfilment and ad costs.']);
      if (c.codShare > 0.5) A.push(['info', 'More than half of orders are COD', 'COD orders carry RTO risk. See Finance & ops for delivery and RTO by state.']);
      var noSpend = MD.dayList(p.from, p.to).filter(function (x) { return x < MD.today() && !c.spendDays[x]; }).length;
      if (noSpend && noSpend < p.days) A.push(['warn', noSpend + (noSpend === 1 ? ' day has' : ' days have') + ' no ad spend entered', 'MER and CAC treat those days as zero spend.']);
      if (!c.spend) A.push(['info', 'No ad spend entered for this period', 'Add it in the Ad spend tab to see MER, CAC and contribution after ads.']);
      if (A.length) html += '<div class="card"><h2>Watch-outs</h2>' + A.map(function (a) { return MD.note('<strong>' + esc(a[1]) + '</strong>' + esc(a[2]), a[0]); }).join('') + '</div>';

      // Trend
      var days = MD.dayList(p.days === 1 ? p.prevFrom : p.from, p.to);
      var byDay = MD.groupBy(MD.valid(d.all), function (e) { return e.day; });
      var spendByDay = MD.groupBy(MD.spendIn(days[0], p.to), function (r) { return r.date; });
      html += '<div class="card"><h2>Daily revenue, spend and orders</h2><p class="sub">' + (p.days === 1 ? 'The last 8 days, for context.' : '') + '</p>' + MD.chart(days, [
        { name: 'Net merchandise revenue', type: 'bar', color: '#121212', values: days.map(function (x) { return sum(byDay[x] || [], function (e) { return e.netMerch; }); }), fmt: F.money, money: true },
        { name: 'Ad spend', type: 'bar', color: '#C6FF00', values: days.map(function (x) { return sum(spendByDay[x] || [], function (r) { return r.spend; }); }), fmt: F.money, money: true },
        { name: 'Orders', color: '#2c6ecb', axis: 'right', values: days.map(function (x) { return (byDay[x] || []).length; }), fmt: F.num }
      ], { xfmt: F.date }) + '</div>';

      // Scorecard
      html += '<div class="card"><h2>ROAS next to what it should sit beside</h2><p class="sub">Every ROAS number here sits beside new customers, retained revenue and contribution.</p>' + MD.table([
        { label: 'Measure', key: 'k' }, { label: p.label, n: 1, key: 'a' }, { label: 'Before', n: 1, key: 'b' }, { label: 'Change', n: 1, html: 1, key: 'c' }
      ], [
        { k: 'Ad spend', a: F.money(c.spend), b: F.money(v.spend), c: F.delta(c.spend, v.spend, true) },
        { k: 'Platform-claimed revenue', a: F.money(c.platformRevenue), b: F.money(v.platformRevenue), c: F.delta(c.platformRevenue, v.platformRevenue) },
        { k: 'Platform ROAS (claimed)', a: F.x(F.ratio(c.platformRevenue, c.spend)), b: F.x(F.ratio(v.platformRevenue, v.spend)), c: F.delta(F.ratio(c.platformRevenue, c.spend), F.ratio(v.platformRevenue, v.spend)) },
        { k: 'MER on booked revenue', a: F.x(c.mer), b: F.x(v.mer), c: F.delta(c.mer, v.mer) },
        { k: 'MER on delivered revenue', a: F.x(c.merDelivered), b: F.x(v.merDelivered), c: F.delta(c.merDelivered, v.merDelivered) },
        { k: 'New customers', a: F.num(c.newCustomers), b: F.num(v.newCustomers), c: F.delta(c.newCustomers, v.newCustomers) },
        { k: 'Retained revenue (after RTO and returns)', a: F.money(c.retained), b: F.money(v.retained), c: F.delta(c.retained, v.retained) },
        { k: 'Contribution before ads', a: F.money(c.contribution), b: F.money(v.contribution), c: F.delta(c.contribution, v.contribution) },
        { k: 'Contribution after ads', a: F.money(c.afterAds), b: F.money(v.afterAds), c: F.delta(c.afterAds, v.afterAds) },
        { k: 'Platform-claimed ÷ Shopify revenue', a: F.x(F.ratio(c.platformRevenue, c.net)), b: F.x(F.ratio(v.platformRevenue, v.net)), c: '' }
      ]) + '<p class="muted" style="font-size:12px;margin:8px 0 0">If platform-claimed revenue is above Shopify revenue, the platforms are double counting the same orders or counting view-throughs.</p></div>';

      el.innerHTML = html;
    });
  };

  /* ================= Revenue & orders ================= */
  function safe(pr) { return pr.then(function (v) { return { ok: true, v: v }; }, function (e) { return { ok: false, e: e }; }); }

  MD.views.revenue = function (el, p, alive) {
    el.innerHTML = '<div class="loading">Loading orders…</div>';
    return Promise.all([MD.periodOrders(p, progress(el)), safe(MD.ql(MD.Q.payments(p))), safe(MD.ql(MD.Q.salesTotals(p)))]).then(function (res) {
      if (!alive()) return;
      var d = res[0], pay = res[1], shq = res[2];
      var cur = d.cur, valid = MD.valid(cur), c = MD.metrics(cur, p.from, p.to), v = MD.metrics(d.prev, p.prevFrom, p.prevTo);
      var html = truncNote(d);

      html += '<div class="card"><h2>Sales, step by step</h2><p class="sub">From list price to what the store keeps. Merchandise figures exclude GST and shipping.</p>' + MD.table([
        { label: '', key: 'k' }, { label: 'Amount', n: 1, key: 'a' }, { label: 'Before', n: 1, key: 'b' }
      ], [
        { k: 'Gross merchandise (before discounts)', a: F.money(c.gross), b: F.money(v.gross) },
        { k: '− Discounts', a: F.money(c.discounts), b: F.money(v.discounts) },
        { k: '= Net merchandise, booked', a: F.money(c.net), b: F.money(v.net), _cls: 'hl' },
        { k: '− Removed, returned or lost to RTO', a: F.money(c.net - c.retained), b: F.money(v.net - v.retained) },
        { k: '= Net merchandise, retained', a: F.money(c.retained), b: F.money(v.retained), _cls: 'hl' },
        { k: '+ Shipping charged', a: F.money(c.shipping), b: F.money(v.shipping) },
        { k: '+ GST collected', a: F.money(c.tax), b: F.money(v.tax) },
        { k: 'Total sales (what customers were charged)', a: F.money(c.total), b: F.money(v.total) },
        { k: 'Refunded', a: F.money(c.refunded), b: F.money(v.refunded) },
        { k: 'Cash received so far', a: F.money(c.received), b: F.money(v.received) }
      ]) + '</div>';

      // Cash collected and Shopify cross-check
      html += '<div class="cols"><div class="card"><h2>Cash collected</h2><p class="sub">Money that actually moved, by gateway and method (Shopify payments report). COD shows up here only once the courier remits and the order is marked paid.</p>' +
        (pay.ok ? MD.table([
          { label: 'Gateway', get: function (x) { return x.payment_gateway || '(none)'; } }, { label: 'Method', get: function (x) { return x.payment_method || ''; } },
          { label: 'Orders', n: 1, get: function (x) { return F.num(x.orders_with_transactions); } }, { label: 'Collected', n: 1, get: function (x) { return F.money(x.gross_payments); } },
          { label: 'Refunded', n: 1, get: function (x) { return F.money(x.refunded_payments); } }, { label: 'Net', n: 1, get: function (x) { return F.money(x.net_payments); } }
        ], pay.v, { empty: 'No payments in this period.' }) : MD.err(pay.e, 'payments')) + '</div>';
      if (shq.ok && shq.v[0]) {
        var t = shq.v[0];
        html += '<div class="card"><h2>Shopify\'s own figures</h2><p class="sub">Shopify Analytics definitions, for reconciling with its reports. Shopify net sales deduct returns and exclude tax and shipping; total sales adds them back.</p>' + MD.table([{ label: '', key: 'k' }, { label: 'Shopify', n: 1, key: 'a' }], [
          { k: 'Orders', a: F.num(t.orders) }, { k: 'Gross sales', a: F.money(t.gross_sales) }, { k: 'Discounts', a: F.money(t.discounts) }, { k: 'Returns (sales reversals)', a: F.money(t.sales_reversals) },
          { k: 'Net sales', a: F.money(t.net_sales), _cls: 'hl' }, { k: 'Shipping charges', a: F.money(t.shipping_charges) }, { k: 'Taxes', a: F.money(t.taxes) }, { k: 'Total sales', a: F.money(t.total_sales) },
          { k: 'Average order value (Shopify)', a: F.money(t.average_order_value) }, { k: 'Cost of goods sold', a: F.money(t.cost_of_goods_sold) }, { k: 'Gross profit', a: F.money(t.gross_profit) }
        ]) + '</div></div>';
      } else html += '<div class="card"><h2>Shopify\'s own figures</h2>' + (shq.ok ? MD.empty('No sales.') : MD.err(shq.e, 'Shopify sales')) + '</div></div>';

      // Realized funnel
      var paid = valid.filter(function (e) { return e.paid; }), shipped = valid.filter(function (e) { return e.shipped; }), delivered = valid.filter(function (e) { return e.delivered; });
      var kept = delivered.filter(function (e) { return !e.returned; });
      html += '<div class="card"><h2>Realized revenue</h2><p class="sub">Orders placed → paid → shipped → delivered → kept after returns. COD orders count as paid only once Shopify marks them paid.</p>' + MD.funnel([
        { label: 'Placed (not cancelled)', value: valid.length, money: c.net },
        { label: 'Paid', value: paid.length, money: sum(paid, function (e) { return e.netMerch; }) },
        { label: 'Shipped', value: shipped.length, money: sum(shipped, function (e) { return e.netMerch; }) },
        { label: 'Delivered', value: delivered.length, money: sum(delivered, function (e) { return e.netMerchRetained; }) },
        { label: 'Kept (no refund or return)', value: kept.length, money: sum(kept, function (e) { return e.netMerchRetained; }) }
      ]) + '<p class="muted" style="font-size:12px;margin:10px 0 0">Recent orders are still moving through these steps, so the last stages always look low for the most recent days.</p></div>';

      // Order quality
      function seg(label, list) {
        var n = list.length, net = sum(list, function (e) { return e.netMerch; });
        return { k: label, o: F.num(n), s: F.pct(F.ratio(n, valid.length)), r: F.money(net), a: F.money(F.ratio(net, n)) };
      }
      var cols = [{ label: '', key: 'k' }, { label: 'Orders', n: 1, key: 'o' }, { label: 'Share', n: 1, key: 's' }, { label: 'Net revenue', n: 1, key: 'r' }, { label: 'AOV', n: 1, key: 'a' }];
      var byChannel = MD.groupBy(valid, function (e) { return e.channel; });
      var byGateway = MD.groupBy(valid, function (e) { return e.gateway; });
      var byFin = MD.groupBy(valid, function (e) { return e.fin || 'UNKNOWN'; });
      html += '<div class="cols">';
      html += '<div class="card"><h2>Order quality</h2>' + MD.table(cols, [
        seg('Prepaid', valid.filter(function (e) { return !e.cod; })),
        seg('Cash on delivery', valid.filter(function (e) { return e.cod; })),
        seg('New customers', valid.filter(function (e) { return e.isNew === true; })),
        seg('Returning customers', valid.filter(function (e) { return e.isNew === false; })),
        seg('Used a discount', valid.filter(function (e) { return e.discounts > 0; })),
        seg('Full price', valid.filter(function (e) { return !e.discounts; })),
        seg('Refunded (fully or partly)', valid.filter(function (e) { return e.refunded > 0; }))
      ]) + '<p class="muted" style="font-size:12px;margin:8px 0 0">' + F.num(c.cancelled) + ' cancelled orders are left out' + (c.cancelled ? ': ' + Object.entries(MD.groupBy(cur.filter(function (e) { return e.cancelled; }), function (e) { return e.raw.cancelReason || 'OTHER'; })).map(function (x) { return x[0].toLowerCase() + ' ' + x[1].length; }).join(', ') : '') + '.</p></div>';
      html += '<div class="card"><h2>Payment status</h2>' + MD.table(cols, Object.keys(byFin).map(function (k) { return seg(k.replace(/_/g, ' ').toLowerCase(), byFin[k]); })) +
        '<h3>Payment method</h3>' + MD.table(cols, Object.keys(byGateway).map(function (k) { return seg(k, byGateway[k]); })) +
        '<h3>Sales channel</h3>' + MD.table(cols, Object.keys(byChannel).map(function (k) { return seg(k, byChannel[k]); })) + '</div>';
      html += '</div>';

      // Discounts
      var byCode = {};
      valid.forEach(function (e) { (e.codes.length ? e.codes : (e.discounts ? ['(automatic)'] : [])).forEach(function (code) { var r = byCode[code] || (byCode[code] = { code: code, n: 0, disc: 0, net: 0 }); r.n++; r.disc += e.discounts; r.net += e.netMerch; }); });
      var codes = Object.keys(byCode).map(function (k) { return byCode[k]; }).sort(function (a, b) { return b.n - a.n; });
      html += '<div class="card"><h2>Discounts</h2><div class="kpis">' +
        MD.kpi({ label: 'Discount rate', value: F.pct(c.discountRate), delta: F.delta(c.discountRate, v.discountRate, true), sub: F.money(c.discounts) + ' given' }) +
        MD.kpi({ label: 'Orders with a discount', value: F.pct(F.ratio(valid.filter(function (e) { return e.discounts > 0; }).length, valid.length)) }) +
        MD.kpi({ label: 'AOV with a discount', value: F.money(F.ratio(sum(valid.filter(function (e) { return e.discounts > 0; }), function (e) { return e.netMerch; }), valid.filter(function (e) { return e.discounts > 0; }).length)), sub: 'vs ' + F.money(F.ratio(sum(valid.filter(function (e) { return !e.discounts; }), function (e) { return e.netMerch; }), valid.filter(function (e) { return !e.discounts; }).length)) + ' full price' }) +
        '</div><h3>By code</h3>' + MD.table([
          { label: 'Code', key: 'code' }, { label: 'Orders', n: 1, get: function (r) { return F.num(r.n); } }, { label: 'Discount', n: 1, get: function (r) { return F.money(r.disc); } },
          { label: 'Net revenue', n: 1, get: function (r) { return F.money(r.net); } }, { label: 'AOV', n: 1, get: function (r) { return F.money(r.net / r.n); } }, { label: 'Depth', n: 1, get: function (r) { return F.pct(r.disc / (r.net + r.disc)); } }
        ], codes, { empty: 'No discounted orders.' }) + '<p class="muted" style="font-size:12px;margin:8px 0 0">Offer-level detail (tiers, stacking, missed upsells) is in the NOTIC Discounts app.</p></div>';

      // Daily table
      var byDay = MD.groupBy(cur, function (e) { return e.day; });
      html += '<div class="card"><h2>By day</h2>' + MD.table([
        { label: 'Date', get: function (r) { return F.date(r.d); } }, { label: 'Orders', n: 1, key: 'o' }, { label: 'Units', n: 1, key: 'u' }, { label: 'Net revenue', n: 1, key: 'n' },
        { label: 'AOV', n: 1, key: 'a' }, { label: 'New customers', n: 1, key: 'nc' }, { label: 'COD', n: 1, key: 'cod' }, { label: 'Cancelled', n: 1, key: 'x' }
      ], MD.dayList(p.from, p.to).reverse().map(function (x) {
        var l = byDay[x] || [], vl = MD.valid(l), net = sum(vl, function (e) { return e.netMerch; });
        return { d: x, o: F.num(vl.length), u: F.num(sum(vl, function (e) { return e.units; })), n: F.money(net), a: F.money(F.ratio(net, vl.length)), nc: F.num(vl.filter(function (e) { return e.isNew; }).length), cod: F.num(vl.filter(function (e) { return e.cod; }).length), x: F.num(l.length - vl.length) };
      })) + '</div>';

      el.innerHTML = html;
    });
  };

  /* ================= Finance & ops ================= */
  MD.views.ops = function (el, p, alive) {
    el.innerHTML = '<div class="loading">Loading orders…</div>';
    return Promise.all([MD.periodOrders(p, progress(el)), safe(MD.ql(MD.Q.fulfillment(p)))]).then(function (res) {
      if (!alive()) return;
      var d = res[0], ful = res[1];
      var cur = d.cur, valid = MD.valid(cur), S = MD.settings, c = MD.metrics(cur, p.from, p.to);
      var html = truncNote(d);
      var n = valid.length || 1;

      // Unit economics per order
      var costs = valid.map(MD.orderCosts);
      var rev = sum(valid, function (e) { return e.rto ? 0 : e.netMerchRetained; });
      var shipIn = sum(valid, function (e) { return e.shipping * (MD.shop.taxesIncluded ? 1 / 1.18 : 1); });
      var cogs = sum(valid, function (e) { return e.rto ? 0 : e.cogs; });
      var rows = [
        ['Net merchandise revenue (retained, ex GST)', rev],
        ['+ Shipping charged (ex GST)', shipIn],
        ['− COGS', -cogs],
        ['− Forward shipping cost', -sum(costs, function (x) { return x.ship; })],
        ['− Packaging', -sum(costs, function (x) { return x.pack; })],
        ['− Gateway and COD fees', -sum(costs, function (x) { return x.fees; })],
        ['− RTO losses (actual and expected)', -sum(costs, function (x) { return x.rtoLoss; })],
        ['− Expected return losses', -sum(costs, function (x) { return x.returnLoss; })]
      ];
      var before = sum(rows, function (r) { return r[1]; });
      rows.push(['= Contribution before ads', before]);
      rows.push(['− Ad spend', -c.spend]);
      rows.push(['= Contribution after ads', before - c.spend]);
      var cogsCov = F.ratio(sum(valid, function (e) { return e.cogsCoverage * e.netMerch; }), sum(valid, function (e) { return e.netMerch; }));
      var firstOrders = valid.filter(function (e) { return e.isNew; });
      var cbaFirst = F.ratio(sum(firstOrders, MD.contribution), firstOrders.length);
      html += '<div class="cols"><div class="card"><h2>Unit economics</h2><p class="sub">Per period and per order. Costs you have not entered use the assumptions in Settings.</p>' + MD.table([
        { label: '', key: 'k' }, { label: 'Period', n: 1, key: 'a' }, { label: 'Per order', n: 1, key: 'b' }, { label: '% of revenue', n: 1, key: 'c' }
      ], rows.map(function (r) { return { k: r[0], a: F.money(r[1]), b: F.money(r[1] / n), c: F.pct(rev ? r[1] / rev : null), _cls: /^=/.test(r[0]) ? 'hl' : '' }; })) +
        '<p class="muted" style="font-size:12px;margin:8px 0 0">Real product costs cover ' + F.pct(cogsCov) + ' of revenue; the rest uses the fallback COGS of ' + F.pct(S.cogsFallbackPct) + '.</p></div>';

      html += '<div class="card"><h2>Break-even</h2><p class="sub">How much you can pay for a customer before the first order loses money.</p><div class="kpis">' +
        MD.kpi({ label: 'Break-even CAC (first order)', value: F.money(cbaFirst), sub: 'contribution of an average first order', hi: true }) +
        MD.kpi({ label: 'Actual new-customer CAC', value: F.money(c.cac), sub: c.cac && cbaFirst ? (c.cac > cbaFirst ? 'above break-even: first orders lose money' : 'below break-even') : '' }) +
        MD.kpi({ label: 'Break-even MER', value: F.x(F.ratio(rev, before)), sub: 'revenue ÷ contribution before ads' }) +
        MD.kpi({ label: 'Actual MER', value: F.x(c.mer), sub: 'target ' + F.x(S.targetMer) }) +
        '</div><p class="muted" style="font-size:12px;margin:10px 0 0">A CAC above first-order break-even can still pay back if customers reorder. See Retention for repeat rates.</p></div></div>';

      // COD vs prepaid
      function payRow(label, list) {
        var sh = list.filter(function (e) { return e.shipped; }), dl = list.filter(function (e) { return e.delivered; }), rt = list.filter(function (e) { return e.rto; });
        var all = cur.filter(function (e) { return list.indexOf(e) >= 0 || (e.cancelled && (label === 'COD' ? e.cod : !e.cod)); });
        return { k: label, o: F.num(list.length), x: F.pct(F.ratio(all.length - list.length, all.length)), s: F.num(sh.length), dr: F.pct(F.ratio(dl.length, sh.length)), rto: F.pct(F.ratio(rt.length, sh.length)), cpo: F.money(F.ratio(sum(list, MD.contribution), list.length)) };
      }
      html += '<div class="card"><h2>COD and prepaid</h2><p class="sub">Delivery and RTO rates use shipped orders only. Contribution per order includes expected RTO for parcels still in transit.</p>' + MD.table([
        { label: '', key: 'k' }, { label: 'Orders', n: 1, key: 'o' }, { label: 'Cancelled', n: 1, key: 'x' }, { label: 'Shipped', n: 1, key: 's' }, { label: 'Delivered', n: 1, key: 'dr' }, { label: 'RTO', n: 1, key: 'rto' }, { label: 'Contribution / order', n: 1, key: 'cpo' }
      ], [payRow('Prepaid', valid.filter(function (e) { return !e.cod; })), payRow('COD', valid.filter(function (e) { return e.cod; }))]) + '</div>';

      // By state
      var byState = MD.groupBy(valid, function (e) { return e.state; });
      var st = Object.keys(byState).map(function (k) {
        var l = byState[k], sh = l.filter(function (e) { return e.shipped; });
        return { k: k, o: l.length, cod: F.ratio(l.filter(function (e) { return e.cod; }).length, l.length), dl: F.ratio(sh.filter(function (e) { return e.delivered; }).length, sh.length), rto: F.ratio(sh.filter(function (e) { return e.rto; }).length, sh.length), net: sum(l, function (e) { return e.netMerch; }), c: sum(l, MD.contribution) };
      }).sort(function (a, b) { return b.o - a.o; });
      html += '<div class="card"><h2>By state</h2><p class="sub">Where COD and RTO hurt. Small states have few orders, so treat big swings with care.</p>' + MD.table([
        { label: 'State', key: 'k' }, { label: 'Orders', n: 1, get: function (r) { return F.num(r.o); } }, { label: 'Net revenue', n: 1, get: function (r) { return F.money(r.net); } },
        { label: 'COD share', n: 1, get: function (r) { return F.pct(r.cod); } }, { label: 'Delivered', n: 1, get: function (r) { return F.pct(r.dl); } }, { label: 'RTO', n: 1, get: function (r) { return F.pct(r.rto); } },
        { label: 'Contribution', n: 1, get: function (r) { return F.money(r.c); } }
      ], st.slice(0, 30)) + '</div>';

      // Fulfilment speed
      var disp = valid.map(function (e) { return e.dispatchHours; }).filter(function (x) { return x != null && x >= 0; }).sort(function (a, b) { return a - b; });
      var dlv = valid.map(function (e) { return e.deliveryDays; }).filter(function (x) { return x != null && x >= 0; }).sort(function (a, b) { return a - b; });
      function med(a) { return a.length ? a[Math.floor(a.length / 2)] : null; }
      function p90(a) { return a.length ? a[Math.floor(a.length * 0.9)] : null; }
      var unshippedOld = valid.filter(function (e) { return !e.shipped && MD.daysBetween(e.day, MD.today()) >= 2; });
      html += '<div class="card"><h2>Fulfilment</h2><div class="kpis">' +
        MD.kpi({ label: 'Median time to dispatch', value: disp.length ? F.dec(med(disp)) + ' h' : '·', sub: disp.length ? '90% within ' + F.dec(p90(disp)) + ' h' : 'no shipped orders' }) +
        MD.kpi({ label: 'Median order to delivery', value: dlv.length ? F.dec(med(dlv)) + ' days' : '·', sub: dlv.length ? '90% within ' + F.dec(p90(dlv)) + ' days' : 'no delivery scans yet' }) +
        MD.kpi({ label: 'Failed delivery attempts', value: F.num(valid.filter(function (e) { return e.failedDelivery; }).length) }) +
        MD.kpi({ label: 'Not shipped after 2+ days', value: F.num(unshippedOld.length), sub: unshippedOld.slice(0, 4).map(function (e) { return e.name; }).join(', '), hi: unshippedOld.length > 0 }) +
        MD.kpi({ label: 'Refunds', value: F.money(c.refunded), sub: F.num(cur.filter(function (e) { return e.refunded > 0; }).length) + ' orders' }) +
        '</div><p class="muted" style="font-size:12px;margin:10px 0 0">Delivery dates appear only when your courier app sends delivery scans to Shopify.</p>' +
        (ful.ok && ful.v.length ? '<h3>By courier</h3>' + MD.table([
          { label: 'Courier', get: function (x) { return x.shipping_carrier || '(not set)'; } }, { label: 'Fulfilled', n: 1, get: function (x) { return F.num(x.orders_fulfilled); } },
          { label: 'Shipped', n: 1, get: function (x) { return F.num(x.orders_shipped); } }, { label: 'Delivered', n: 1, get: function (x) { return F.num(x.orders_delivered); } },
          { label: 'Shipped fast', n: 1, get: function (x) { return F.pct(x.orders_shipped_fast_rate); } }, { label: 'Delivered fast', n: 1, get: function (x) { return F.pct(x.orders_delivered_fast_rate); } },
          { label: 'Median hours to fulfil', n: 1, get: function (x) { return F.dec(x.median_hours_order_to_fulfillment); } }, { label: 'Median days to deliver', n: 1, get: function (x) { return F.dec(x.median_days_order_to_delivery); } }
        ], ful.v) : '') + '</div>';

      el.innerHTML = html;
    });
  };
})(window.MD = window.MD || {});
