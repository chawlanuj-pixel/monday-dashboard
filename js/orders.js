/* Monday Dashboard · order-level data: loading, classification, economics. */
(function (MD) {
  'use strict';

  var MONEY = '{ shopMoney { amount } }';
  var VISIT = '{ occurredAt source sourceType landingPage referrerUrl utmParameters { source medium campaign content term } }';
  var ORDERS_Q = 'query ($q: String!, $after: String) { orders(first: 15, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) { pageInfo { hasNextPage endCursor } nodes {' +
    ' id name createdAt cancelledAt cancelReason test sourceName paymentGatewayNames displayFinancialStatus displayFulfillmentStatus returnStatus taxesIncluded discountCodes' +
    ' subtotalPriceSet ' + MONEY + ' currentSubtotalPriceSet ' + MONEY + ' totalDiscountsSet ' + MONEY + ' totalTaxSet ' + MONEY + ' totalShippingPriceSet ' + MONEY +
    ' totalPriceSet ' + MONEY + ' currentTotalPriceSet ' + MONEY + ' totalRefundedSet ' + MONEY + ' totalReceivedSet ' + MONEY +
    ' shippingAddress { province provinceCode city zip } customer { id }' +
    ' customerJourneySummary { daysToConversion firstVisit ' + VISIT + ' lastVisit ' + VISIT + ' }' +
    ' fulfillments(first: 5) { status displayStatus createdAt inTransitAt deliveredAt }' +
    ' lineItems(first: 20) { nodes { quantity currentQuantity sku title variantTitle product { id title productType } variant { id inventoryItem { unitCost { amount } } }' +
    ' originalTotalSet ' + MONEY + ' discountedTotalSet ' + MONEY + ' taxLines { priceSet ' + MONEY + ' } } } } } }';

  var HISTORY_Q = 'query ($q: String!, $after: String) { orders(first: 250, after: $after, query: $q, sortKey: CREATED_AT) { pageInfo { hasNextPage endCursor } nodes { id createdAt cancelledAt test customer { id } currentSubtotalPriceSet { shopMoney { amount } } } } }';

  function amt(m) { return m && m.shopMoney ? parseFloat(m.shopMoney.amount) || 0 : 0; }

  /* ---------- channel classification ---------- */
  var RULES = [
    ['Meta ads', /(^|\W)(facebook|fb|instagram|ig|meta)(\W|$)/i, /(cpc|paid|ads?|cpm|ppc|social_paid|paid_social)/i],
    ['Google ads', /(^|\W)(google|youtube|gdn|pmax)(\W|$)/i, /(cpc|paid|ads?|ppc|pmax|shopping|display|video)/i],
    ['Email', /(klaviyo|email|mailchimp|newsletter|omnisend)/i, null],
    ['WhatsApp', /(whatsapp|wa\b|interakt|wati|gupshup|kwikengage)/i, null],
    ['Influencer', /(influencer|creator|affiliate|collab)/i, null],
    ['SMS', /(^|\W)sms(\W|$)/i, null]
  ];
  MD.channelOf = function (visit) {
    if (!visit) return 'Direct / unknown';
    var u = visit.utmParameters || {};
    var src = [u.source, u.medium, u.campaign].filter(Boolean).join(' ');
    var med = u.medium || '';
    for (var i = 0; i < RULES.length; i++) {
      var r = RULES[i];
      if (r[1].test(src) && (!r[2] || r[2].test(med) || r[2].test(src))) return r[0];
      if (r[0] === 'Influencer' && r[1].test(med)) return r[0];
    }
    var s = (visit.source || '').toLowerCase(), t = (visit.sourceType || '').toLowerCase();
    if (u.source) {
      if (/facebook|instagram|fb|ig|meta/.test(u.source.toLowerCase())) return 'Meta organic / untagged';
      if (/google/.test(u.source.toLowerCase())) return 'Google organic / untagged';
      return 'Other tagged (' + u.source + ')';
    }
    if (/facebook|instagram/.test(s)) return 'Meta organic / untagged';
    if (/google|bing|yahoo|duckduckgo/.test(s) || t === 'search') return 'Organic search';
    if (/whatsapp/.test(s)) return 'WhatsApp';
    if (t === 'social') return 'Organic social';
    if (t === 'email') return 'Email';
    if (s === 'direct' || t === 'direct' || !s) return 'Direct / unknown';
    return 'Referral (' + (visit.source || 'other') + ')';
  };
  MD.hasUtm = function (visit) { return !!(visit && visit.utmParameters && (visit.utmParameters.source || visit.utmParameters.campaign)); };
  MD.isDirect = function (ch) { return ch === 'Direct / unknown'; };

  /* ---------- settings defaults ---------- */
  MD.DEFAULT_SETTINGS = {
    cogsFallbackPct: 0.30,
    packagingPerOrder: 25,
    shipCostPerOrder: 70,
    rtoReverseCost: 70,
    gatewayPct: 0.02,
    codFeePerOrder: 35,
    codRtoRate: 0.20,
    prepaidRtoRate: 0.03,
    returnRate: 0.02,
    targetMer: 3,
    targetCac: 400,
    platforms: ['Meta', 'Google'],
    codPattern: 'cash on delivery|\\bcod\\b|gokwik cod|cash_on_delivery'
  };
  MD.settings = JSON.parse(JSON.stringify(MD.DEFAULT_SETTINGS));

  /* ---------- enrich one order ---------- */
  function enrich(o) {
    var S = MD.settings, codRe = new RegExp(S.codPattern || MD.DEFAULT_SETTINGS.codPattern, 'i');
    var e = { raw: o, id: o.id, name: o.name, day: MD.dayOf(o.createdAt), created: o.createdAt };
    e.cancelled = !!o.cancelledAt;
    e.test = !!o.test;
    e.cod = (o.paymentGatewayNames || []).some(function (g) { return codRe.test(g); });
    e.gateway = (o.paymentGatewayNames || [])[0] || 'none';
    e.channel = o.sourceName || 'web';
    e.fin = o.displayFinancialStatus || '';
    e.ful = o.displayFulfillmentStatus || '';
    e.customer = o.customer ? o.customer.id : null;
    e.state = o.shippingAddress ? (o.shippingAddress.province || o.shippingAddress.provinceCode || 'Unknown') : 'Unknown';
    e.codes = o.discountCodes || [];

    var lines = o.lineItems.nodes, taxIncl = o.taxesIncluded;
    var gross = 0, net = 0, netCurrent = 0, tax = 0, cogs = 0, cogsKnown = 0, units = 0, unitsCurrent = 0;
    e.lines = lines.map(function (li) {
      var lg = amt(li.originalTotalSet), ln = amt(li.discountedTotalSet);
      var lt = (li.taxLines || []).reduce(function (s, t) { return s + amt(t.priceSet); }, 0);
      var exTax = taxIncl ? ln - lt : ln;
      var cost = li.variant && li.variant.inventoryItem && li.variant.inventoryItem.unitCost ? parseFloat(li.variant.inventoryItem.unitCost.amount) : null;
      var cur = li.currentQuantity != null ? li.currentQuantity : li.quantity;
      var lineCogs = cost != null ? cost * li.quantity : exTax * S.cogsFallbackPct;
      gross += taxIncl && ln ? lg * (ln - lt) / ln : lg;
      net += exTax; tax += lt; units += li.quantity; unitsCurrent += cur;
      netCurrent += li.quantity ? exTax * cur / li.quantity : 0;
      cogs += lineCogs; if (cost != null) cogsKnown += exTax;
      return { title: li.product ? li.product.title : li.title, productId: li.product ? li.product.id : null, type: li.product ? li.product.productType : '', variant: li.variantTitle || '', sku: li.sku || '', qty: li.quantity, qtyNow: cur, gross: lg, net: exTax, discount: lg - ln, cogs: lineCogs, costKnown: cost != null };
    });
    e.units = units;
    e.grossMerch = gross;                  // before discounts, ex tax
    e.discounts = Math.max(0, gross - net);   // ex tax, so gross − discounts = net
    e.netMerch = net;                      // after discounts, ex tax, as booked
    e.netMerchRetained = netCurrent;       // after removals/returns
    e.tax = amt(o.totalTaxSet);
    e.shipping = amt(o.totalShippingPriceSet);
    e.total = amt(o.totalPriceSet);
    e.refunded = amt(o.totalRefundedSet);
    e.received = amt(o.totalReceivedSet);
    e.cogs = cogs;
    e.cogsCoverage = net ? cogsKnown / net : 0;

    // Fulfilment stages
    var fs = o.fulfillments || [];
    e.shipped = fs.some(function (f) { return f.status !== 'CANCELLED' && f.status !== 'ERROR'; });
    e.delivered = fs.some(function (f) { return f.displayStatus === 'DELIVERED' || f.deliveredAt; });
    e.failedDelivery = fs.some(function (f) { return /FAILURE|NOT_DELIVERED|ATTEMPTED_DELIVERY/.test(f.displayStatus || ''); });
    e.rto = e.shipped && !e.delivered && (e.cancelled || /FAILURE|NOT_DELIVERED|CANCELED/.test(fs.map(function (f) { return f.displayStatus; }).join(' ')));
    var f0 = fs[0];
    e.dispatchHours = f0 ? (new Date(f0.inTransitAt || f0.createdAt) - new Date(o.createdAt)) / 36e5 : null;
    var del = fs.filter(function (f) { return f.deliveredAt; })[0];
    e.deliveryDays = del ? (new Date(del.deliveredAt) - new Date(o.createdAt)) / 864e5 : null;
    e.paid = /^(PAID|PARTIALLY_REFUNDED|REFUNDED|PARTIALLY_PAID)$/.test(e.fin) || e.received > 0;
    e.returned = e.refunded > 0 || /RETURN/.test(o.returnStatus || '') && o.returnStatus !== 'NO_RETURN';

    // Attribution (Shopify's first and last recorded visits)
    var j = o.customerJourneySummary;
    e.firstVisit = j ? j.firstVisit : null;
    e.lastVisit = j ? j.lastVisit : null;
    e.daysToConvert = j ? j.daysToConversion : null;
    e.firstCh = MD.channelOf(e.firstVisit);
    e.lastCh = MD.channelOf(e.lastVisit || e.firstVisit);
    e.lastNonDirectCh = !MD.isDirect(e.lastCh) ? e.lastCh : e.firstCh;
    e.tagged = MD.hasUtm(e.lastVisit) || MD.hasUtm(e.firstVisit);
    e.landing = (e.firstVisit && e.firstVisit.landingPage) ? pathOf(e.firstVisit.landingPage) : '(none recorded)';
    var u = (e.lastVisit || e.firstVisit || {}).utmParameters || {};
    e.utm = { source: u.source || '', medium: u.medium || '', campaign: u.campaign || '', content: u.content || '' };
    return e;
  }
  function pathOf(url) { try { return new URL(url, 'https://x.invalid').pathname; } catch (err) { return url; } }
  MD.pathOf = pathOf;

  /* Expected per-order costs from settings. Returns {fees, ship, pack, rtoLoss, returnLoss, total}. */
  MD.orderCosts = function (e) {
    var S = MD.settings;
    var fees = e.cod ? S.codFeePerOrder : S.gatewayPct * e.total;
    var ship = e.shipped || !e.cancelled ? S.shipCostPerOrder : 0;
    var pack = e.cancelled && !e.shipped ? 0 : S.packagingPerOrder;
    var rtoRate = e.cod ? S.codRtoRate : S.prepaidRtoRate;
    // Known outcomes beat expectations: delivered orders carry no RTO risk, RTO orders carry the full loss.
    var rtoLoss = e.rto ? (S.shipCostPerOrder + S.rtoReverseCost + S.packagingPerOrder) : (e.delivered || e.cancelled ? 0 : rtoRate * (S.shipCostPerOrder + S.rtoReverseCost + S.packagingPerOrder));
    var returnLoss = e.delivered ? S.returnRate * e.netMerch * 0.5 : 0;
    return { fees: fees, ship: ship, pack: pack, rtoLoss: rtoLoss, returnLoss: returnLoss, total: fees + ship + pack + rtoLoss + returnLoss };
  };

  /* Contribution before ads for one order (ex GST). Cancelled-before-dispatch orders contribute 0. */
  MD.contribution = function (e) {
    if (e.cancelled && !e.shipped) return 0;
    var c = MD.orderCosts(e);
    var rev = e.rto ? 0 : e.netMerchRetained + e.shipping * (MD.shop.taxesIncluded ? 1 / 1.18 : 1);
    var cogs = e.rto ? 0 : e.cogs * (e.units ? e.netMerchRetained / Math.max(e.netMerch, 0.01) : 1);
    return rev - cogs - c.total;
  };

  /* ---------- loaders ---------- */
  var orderCache = {};
  MD.loadOrders = function (from, to, onProgress) {
    var key = from + '|' + to;
    if (orderCache[key]) return orderCache[key];
    var q = 'created_at:>=' + from + 'T00:00:00' + tzOffset() + ' created_at:<=' + to + 'T23:59:59' + tzOffset();
    var all = [], pages = 0, MAX = 60;
    function page(after) {
      return MD.gql(ORDERS_Q, { q: q, after: after || null }).then(function (d) {
        all = all.concat(d.orders.nodes); pages++;
        if (onProgress) onProgress(all.length);
        if (d.orders.pageInfo.hasNextPage && pages < MAX) return page(d.orders.pageInfo.endCursor);
        return { orders: all.filter(function (o) { return !o.test; }).map(enrich), truncated: d.orders.pageInfo.hasNextPage, tests: all.filter(function (o) { return o.test; }).length };
      });
    }
    var p = page();
    orderCache[key] = p;
    p.catch(function () { delete orderCache[key]; });
    return p;
  };
  MD.clearOrderCache = function () { orderCache = {}; historyP = null; };

  /* Light history of every order (for first-order detection, cohorts and repeat). */
  var historyP = null;
  MD.loadHistory = function (monthsBack) {
    if (historyP) return historyP;
    var from = MD.addDays(MD.today(), -Math.round((monthsBack || 24) * 30.5));
    var all = [];
    function page(after) {
      return MD.gql(HISTORY_Q, { q: 'created_at:>=' + from, after: after || null }).then(function (d) {
        all = all.concat(d.orders.nodes);
        if (d.orders.pageInfo.hasNextPage && all.length < 25000) return page(d.orders.pageInfo.endCursor);
        return all;
      });
    }
    historyP = page().then(function (rows) {
      var byCustomer = {}, firstOrder = {};
      rows.forEach(function (o) {
        if (o.test || !o.customer) return;
        var c = o.customer.id;
        (byCustomer[c] = byCustomer[c] || []).push({ id: o.id, day: MD.dayOf(o.createdAt), value: amt(o.currentSubtotalPriceSet), cancelled: !!o.cancelledAt });
      });
      Object.keys(byCustomer).forEach(function (c) {
        var list = byCustomer[c].filter(function (x) { return !x.cancelled; }).sort(function (a, b) { return a.day < b.day ? -1 : 1; });
        byCustomer[c] = list;
        if (list[0]) firstOrder[c] = list[0].id;
      });
      return { from: from, byCustomer: byCustomer, firstOrder: firstOrder, count: rows.length };
    });
    historyP.catch(function () { historyP = null; });
    return historyP;
  };

  /* Mark each enriched order new or returning using history. */
  MD.markNew = function (orders, hist) {
    orders.forEach(function (e) {
      if (!e.customer) { e.isNew = null; return; }
      var list = hist.byCustomer[e.customer] || [];
      var idx = list.map(function (x) { return x.id; }).indexOf(e.id);
      e.isNew = idx === 0 || (idx < 0 && !list.some(function (x) { return x.day < e.day; }));
      e.orderIndex = idx;
    });
  };

  function tzOffset() {
    // Offset of the store time zone, e.g. +05:30. Falls back to +05:30 for IST stores.
    try {
      var s = new Intl.DateTimeFormat('en-US', { timeZone: MD.shop.tz, timeZoneName: 'longOffset' }).format(new Date());
      var m = s.match(/GMT([+-]\d{2}:\d{2})/);
      return m ? m[1] : (s.indexOf('GMT') >= 0 ? '+00:00' : '+05:30');
    } catch (err) { return '+05:30'; }
  }

  /* ---------- aggregation helpers ---------- */
  MD.sum = function (arr, f) { return arr.reduce(function (s, x) { var v = f(x); return s + (v && isFinite(v) ? v : 0); }, 0); };
  MD.groupBy = function (arr, f) { var g = {}; arr.forEach(function (x) { var k = f(x); (g[k] = g[k] || []).push(x); }); return g; };
  MD.inRange = function (orders, from, to) { return orders.filter(function (e) { return e.day >= from && e.day <= to; }); };
  MD.valid = function (orders) { return orders.filter(function (e) { return !e.cancelled; }); };
})(window.MD = window.MD || {});
