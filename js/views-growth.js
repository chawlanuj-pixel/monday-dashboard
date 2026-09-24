/* Monday Dashboard · growth views: Acquisition, Attribution, Conversion, Products, Retention. */
(function (MD) {
  'use strict';
  var F = MD.fmt, esc = F.esc, sum = MD.sum;
  MD.views = MD.views || {};

  function progress(el) { return function (n) { var l = el.querySelector('.loading'); if (l) l.textContent = 'Loading orders… ' + n; }; }
  function safe(p) { return p.then(function (v) { return { ok: true, v: v }; }, function (e) { return { ok: false, e: e }; }); }
  function sessionNote(p) {
    return MD.crossesSessionChange(p) ? MD.note('<strong>Session counts may shift around 21 to 23 Sep 2026</strong>Shopify updated how it measures sessions around then, and this store\'s session data starts on 23 Sep. Read session and conversion trends across that date with care. Orders and sales are not affected. The dashed red line marks it on charts.', 'warn') : '';
  }
  var MARK = { at: '2026-09-22', label: 'Session change' };

  /* ================= Acquisition ================= */
  MD.views.acquisition = function (el, p, alive) {
    el.innerHTML = '<div class="loading">Loading traffic…</div>';
    var Q = MD.Q;
    return Promise.all([
      safe(MD.ql(Q.sessionsDaily(p))),
      safe(MD.ql(Q.sessionsBy('referring_channel', p))),
      safe(MD.ql(Q.sessionsBy('traffic_type', p))),
      safe(MD.ql(Q.sessionsBy('referrer_name', p, 15))),
      safe(MD.ql(Q.campaignSessions(p))),
      safe(MD.ql(Q.sessionsBy('landing_page_path', p, 20))),
      safe(MD.ql(Q.sessionsBy('session_device_type', p))),
      safe(MD.ql(Q.sessionsBy('session_region', p, 15))),
      safe(MD.ql(Q.botShare(p))),
      MD.ext.on ? safe(MD.ordersDaily(p)) : Promise.resolve({ ok: false }),
      MD.ext.on ? safe(MD.periodOrders(p)) : Promise.resolve({ ok: false })
    ]).then(function (r) {
      if (!alive()) return;
      if (MD.ext.on) {
        var od = {}; if (r[9].ok) r[9].v.forEach(function (x) { od[String(x.day).slice(0, 10)] = x.orders; });
        if (r[0].ok) MD.patchBought(r[0].v, { byDay: od });
        var ords = r[10].ok ? MD.valid(r[10].v.cur) : [];
        var byLp = MD.groupBy(ords, function (e) { return e.landing; });
        [1, 2, 3, 4, 6, 7].forEach(function (i) { if (r[i].ok) MD.patchBought(r[i].v); });
        if (r[5].ok) MD.patchBought(r[5].v, { map: function (x) { return (byLp[x.landing_page_path] || []).length; } });
      }
      var html = MD.extNote() + sessionNote(p);
      var daily = r[0];
      if (daily.ok) {
        var rows = daily.v, days = rows.map(function (x) { return String(x.day).slice(0, 10); });
        var tot = { s: sum(rows, function (x) { return x.sessions; }), v: sum(rows, function (x) { return x.online_store_visitors; }), c: sum(rows, function (x) { return x.sessions_with_cart_additions; }), k: sum(rows, function (x) { return x.sessions_that_completed_checkout; }) };
        var spend = sum(MD.spendIn(p.from, p.to), function (x) { return x.spend; }), clicks = sum(MD.spendIn(p.from, p.to), function (x) { return x.clicks; });
        html += '<div class="card"><h2>Traffic</h2><div class="kpis">' +
          MD.kpi({ label: 'Sessions', value: F.num(tot.s) }) + MD.kpi({ label: 'Visitors', value: F.num(tot.v) }) +
          MD.kpi({ label: 'Add-to-cart rate', value: F.pct(F.ratio(tot.c, tot.s)) }) + MD.kpi({ label: 'Conversion rate', value: F.pct(F.ratio(tot.k, tot.s)), hi: true }) +
          MD.kpi({ label: 'Ad clicks entered', value: F.num(clicks), sub: clicks && tot.s ? 'ad clicks are ' + F.pct(clicks / tot.s) + ' of sessions' : '' }) +
          MD.kpi({ label: 'Spend per session', value: F.money2(F.ratio(spend, tot.s)) }) +
          '</div>' + MD.chart(days, [
            { name: 'Sessions', type: 'bar', color: '#121212', values: rows.map(function (x) { return x.sessions; }), fmt: F.num },
            { name: 'Conversion rate', color: '#2c6ecb', axis: 'right', values: rows.map(function (x) { return x.sessions ? x.sessions_that_completed_checkout / x.sessions : null; }), fmt: F.pct, pct: true }
          ], { xfmt: F.date, marker: MARK }) + '</div>';
      } else html += MD.err(daily.e, 'sessions');

      function sessTable(res, dim, label, opts) {
        opts = opts || {};
        if (!res.ok) return MD.err(res.e, label);
        var rows = res.v, max = Math.max.apply(null, rows.map(function (x) { return x.sessions || 0; }).concat([1]));
        return MD.table([
          { label: label, html: 1, get: function (x) { var k = x[dim] == null || x[dim] === '' ? '(none)' : x[dim]; return esc(k) + MD.bar(x.sessions, max); } },
          { label: 'Sessions', n: 1, get: function (x) { return F.num(x.sessions); } },
          { label: 'Cart rate', n: 1, get: function (x) { return F.pct(F.ratio(x.sessions_with_cart_additions, x.sessions)); } },
          { label: 'Checkout', n: 1, get: function (x) { return F.pct(F.ratio(x.sessions_that_reached_checkout, x.sessions)); } },
          { label: 'Conv. rate', n: 1, get: function (x) { return F.pct(F.ratio(x.sessions_that_completed_checkout, x.sessions)); } }
        ], rows, { empty: 'No sessions.' });
      }

      html += '<div class="cols"><div class="card"><h2>By channel</h2>' + sessTable(r[1], 'referring_channel', 'Channel') + '<h3>By traffic type</h3>' + sessTable(r[2], 'traffic_type', 'Traffic type') + '</div>';
      html += '<div class="card"><h2>By referrer</h2>' + sessTable(r[3], 'referrer_name', 'Referrer') + '</div></div>';

      // UTM campaigns + tracking quality
      var camp = r[4];
      if (camp.ok) {
        var rows4 = camp.v, totS = sum(rows4, function (x) { return x.sessions; });
        var untagged = sum(rows4.filter(function (x) { return !x.utm_source && !x.utm_campaign; }), function (x) { return x.sessions; });
        html += '<div class="card"><h2>UTM campaigns</h2><p class="sub">Sessions and orders by the UTM tags on the link. ' + (totS ? F.pct(untagged / totS) + ' of sessions carry no UTM source or campaign: that is your tracking gap.' : '') + '</p>' + MD.table(MD.Q.campaignColumns, rows4, { empty: 'No campaign sessions.' }) + '</div>';
      } else html += '<div class="card"><h2>UTM campaigns</h2>' + MD.err(camp.e, 'UTM campaigns') + '</div>';

      if (MD.ext.on && r[10].ok) {
        var vo = MD.valid(r[10].v.cur), byC = MD.groupBy(vo, function (e) { return e.lastNonDirectCh; });
        html += '<div class="card"><h2>Orders by channel</h2><p class="sub">From the UTM tags and browser ' + esc(MD.ext.app) + ' saved on each order. Shopify\'s session tables above can\'t show which of those sessions bought.</p>' + MD.table([
          { label: 'Channel', key: 'k' }, { label: 'Orders', n: 1, get: function (x) { return F.num(x.n); } }, { label: 'Share', n: 1, get: function (x) { return F.pct(x.n / vo.length); } },
          { label: 'Net revenue', n: 1, get: function (x) { return F.money(x.rev); } }, { label: 'AOV', n: 1, get: function (x) { return F.money(x.rev / x.n); } }
        ], Object.keys(byC).map(function (k) { return { k: k, n: byC[k].length, rev: sum(byC[k], function (e) { return e.netMerch; }) }; }).sort(function (a, b) { return b.n - a.n; }), { empty: 'No orders in this period.' }) + '</div>';
      }
      html += '<div class="card"><h2>Landing pages</h2><p class="sub">Is the traffic poor, or the page? Compare cart and conversion rates of pages with similar traffic.</p>' + sessTable(r[5], 'landing_page_path', 'Landing page') + '</div>';
      html += '<div class="cols"><div class="card"><h2>Device</h2>' + sessTable(r[6], 'session_device_type', 'Device') + '</div><div class="card"><h2>Region</h2>' + sessTable(r[7], 'session_region', 'State or region') + '</div></div>';
      if (r[8].ok && r[8].v.length) {
        var bots = sum(r[8].v.filter(function (x) { return /bot/i.test(x.human_or_bot_session); }), function (x) { return x.sessions; }), allS = sum(r[8].v, function (x) { return x.sessions; });
        if (bots) html = MD.note('<strong>' + F.pct(bots / allS) + ' of sessions were bots</strong>' + F.num(bots) + ' bot sessions are left out of every traffic and funnel number here, so they will not match Shopify\'s default reports.', 'info') + html;
      }
      el.innerHTML = html;
    });
  };

  /* ================= Attribution ================= */
  MD.views.attribution = function (el, p, alive) {
    el.innerHTML = '<div class="loading">Loading orders…</div>';
    return Promise.all([MD.periodOrders(p, progress(el)), safe(MD.ql(MD.Q.attributionBy('referring_channel', p))), safe(MD.ql(MD.Q.attributionUtm(p)))]).then(function (all3) {
      if (!alive()) return;
      var d = all3[0], sq = all3[1], su = all3[2];
      var valid = MD.valid(d.cur);
      var html = '<div class="card"><h2>Three views, three jobs</h2><p class="sub">Shopify says what the business sold. Meta and Google say what their systems can optimise towards. Only the first one adds up to your order count.</p><div class="kpis">' +
        MD.kpi({ label: 'Shopify orders', value: F.num(valid.length), sub: 'the only true count', hi: true }) +
        MD.kpi({ label: 'Platform-claimed purchases', value: F.dec(sum(MD.spendIn(p.from, p.to), function (x) { return x.purchases; })), sub: 'Meta + Google, as entered' }) +
        MD.kpi({ label: 'Claimed ÷ Shopify orders', value: F.x(F.ratio(sum(MD.spendIn(p.from, p.to), function (x) { return x.purchases; }), valid.length)), sub: 'above 1× means overlap or view-through' }) +
        MD.kpi({ label: 'Orders with a UTM-tagged visit', value: F.pct(F.ratio(valid.filter(function (e) { return e.tagged; }).length, valid.length)), sub: 'tracking quality' }) +
        MD.kpi({ label: 'Orders with no recorded visit', value: F.pct(F.ratio(valid.filter(function (e) { return !e.firstVisit; }).length, valid.length)) }) +
        MD.kpi({ label: 'Median days to convert', value: F.dec(median(valid.map(function (e) { return e.daysToConvert; }).filter(function (x) { return x != null; }))) }) +
        '</div></div>';

      // Shopify's own attribution models
      var M = MD.Q.MODELS;
      if (MD.ext.on) {
        html += MD.extNote();
        var byUtm = MD.groupBy(valid.filter(function (e) { return e.utm.source || e.utm.campaign; }), function (e) { return [e.utm.source, e.utm.medium, e.utm.campaign].join('|'); });
        var urows = Object.keys(byUtm).map(function (k) { var l = byUtm[k], parts = k.split('|'); return { s: parts[0], m: parts[1], c: parts[2], n: l.length, rev: sum(l, function (e) { return e.netMerch; }), newc: l.filter(function (e) { return e.isNew; }).length }; }).sort(function (a, b) { return b.n - a.n; });
        html += '<div class="card"><h2>Orders by UTM campaign</h2><p class="sub">From the UTM tags ' + esc(MD.ext.app) + ' saved on each order. Meta campaign IDs appear as numbers; match them in Ads Manager.</p>' + MD.table([
          { label: 'Source', key: 's' }, { label: 'Medium', key: 'm' }, { label: 'Campaign', key: 'c' }, { label: 'Orders', n: 1, get: function (x) { return F.num(x.n); } },
          { label: 'Share', n: 1, get: function (x) { return F.pct(x.n / Math.max(1, valid.length)); } }, { label: 'Net revenue', n: 1, get: function (x) { return F.money(x.rev); } }, { label: 'New customers', n: 1, get: function (x) { return F.num(x.newc); } }
        ], urows, { empty: 'No orders carry UTM tags in this period.' }) + '</div>';
      } else if (sq.ok) {
        var srows = sq.v.slice().sort(function (x, y) { return (y.orders__last_non_direct_click || 0) - (x.orders__last_non_direct_click || 0); });
        var totalOrders = valid.length;
        html += '<div class="card"><h2>Shopify attribution, five models</h2><p class="sub">Orders by channel under each of Shopify\'s models (bot-free, store time zone). First click shows who introduced the customer; last non-direct is the practical closing view; any click shows every channel that took part, so its column can add up to more than your ' + F.num(totalOrders) + ' orders.</p>' + MD.table(
          [{ label: 'Channel', get: function (x) { return x.referring_channel || '(none)'; } }].concat(M.map(function (m) {
            return { label: m[1] + ' orders', n: 1, get: function (x) { var v = x['orders__' + m[0]]; return v == null ? '' : (m[0] === 'linear' ? F.dec(v) : F.num(v)); } };
          })).concat([
            { label: 'Revenue (last non-direct)', n: 1, get: function (x) { return F.money(x.net_sales__last_non_direct_click); } },
            { label: 'New customers (first click)', n: 1, get: function (x) { return F.num(x.new_customers__first_click); } }
          ]), srows, { empty: 'No attributed orders in this period yet.' }) + '</div>';
      } else html += '<div class="card"><h2>Shopify attribution, five models</h2>' + MD.err(sq.e, 'Shopify attribution') + '</div>';
      if (!MD.ext.on && su.ok && su.v.length) {
        html += '<div class="card"><h2>Orders by UTM campaign</h2>' + MD.table([
          { label: 'Source', get: function (x) { return x.utm_source || '(none)'; } }, { label: 'Medium', get: function (x) { return x.utm_medium || ''; } }, { label: 'Campaign', get: function (x) { return x.utm_campaign || ''; } },
          { label: 'Orders (last non-direct)', n: 1, get: function (x) { return F.num(x.orders__last_non_direct_click); } }, { label: 'Revenue', n: 1, get: function (x) { return F.money(x.net_sales__last_non_direct_click); } },
          { label: 'Orders (first click)', n: 1, get: function (x) { return F.num(x.orders__first_click); } }, { label: 'Revenue', n: 1, get: function (x) { return F.money(x.net_sales__first_click); } }
        ], su.v.sort(function (x, y) { return (y.orders__last_non_direct_click || 0) - (x.orders__last_non_direct_click || 0); })) + '</div>';
      }

      // Channel table under the three Shopify models
      var chans = {};
      function add(model, ch, e) { var r = chans[ch] || (chans[ch] = { ch: ch, first: 0, last: 0, lnd: 0, firstRev: 0, lastRev: 0, lndRev: 0, newFirst: 0 }); r[model]++; r[model + 'Rev'] += e.netMerch; if (model === 'first' && e.isNew) r.newFirst++; }
      valid.forEach(function (e) { add('first', e.firstCh, e); add('last', e.lastCh, e); add('lnd', e.lastNonDirectCh, e); });
      var rows = Object.keys(chans).map(function (k) { return chans[k]; }).sort(function (a, b) { return b.lnd - a.lnd; });
      html += '<div class="card"><h2>Paid platforms in the customer journey</h2><p class="sub">From each order\'s first and last recorded visit, sorted into ad platforms by UTM tags. This is what the Meta and Google rows below are matched against.</p>' + MD.table([
        { label: 'Channel', key: 'ch' },
        { label: 'First click', n: 1, get: function (r) { return F.num(r.first); } }, { label: 'Revenue', n: 1, get: function (r) { return F.money(r.firstRev); } },
        { label: 'New customers (first click)', n: 1, get: function (r) { return F.num(r.newFirst); } },
        { label: 'Last non-direct', n: 1, get: function (r) { return F.num(r.lnd); } }, { label: 'Revenue', n: 1, get: function (r) { return F.money(r.lndRev); } },
        { label: 'Last click', n: 1, get: function (r) { return F.num(r.last); } }
      ], rows, { empty: 'No orders in this period.' }) + '</div>';

      // Platform vs Shopify
      var S = MD.settings, spendRows = MD.spendIn(p.from, p.to);
      var byPlat = MD.groupBy(spendRows, function (x) { return x.platform; });
      var platRows = S.platforms.concat(Object.keys(byPlat).filter(function (k) { return S.platforms.indexOf(k) < 0; })).map(function (pl) {
        var list = byPlat[pl] || [], sp = sum(list, function (x) { return x.spend; });
        var re = new RegExp(pl.split(/\s+/)[0], 'i');
        var lnd = valid.filter(function (e) { return re.test(e.lastNonDirectCh); }), fc = valid.filter(function (e) { return re.test(e.firstCh); });
        var newFc = fc.filter(function (e) { return e.isNew; }).length;
        return { pl: pl, sp: sp, pp: sum(list, function (x) { return x.purchases; }), pr: sum(list, function (x) { return x.revenue; }), lnd: lnd.length, lndRev: sum(lnd, function (e) { return e.netMerch; }), fc: fc.length, newFc: newFc, win: MD.groupBy(list, function (x) { return x.window || 'not set'; }) };
      });
      html += '<div class="card"><h2>Platform claims against Shopify</h2><p class="sub">Platform numbers are what each ad platform reports under its own window (entered in Ad spend). Shopify numbers are orders whose last non-direct or first visit came from that platform.</p>' + MD.table([
        { label: 'Platform', key: 'pl' }, { label: 'Spend', n: 1, get: function (r) { return F.money(r.sp); } },
        { label: 'Claimed purchases', n: 1, get: function (r) { return F.dec(r.pp); } }, { label: 'Claimed ROAS', n: 1, get: function (r) { return F.x(F.ratio(r.pr, r.sp)); } },
        { label: 'Shopify orders (last non-direct)', n: 1, get: function (r) { return F.num(r.lnd); } }, { label: 'Shopify ROAS', n: 1, get: function (r) { return F.x(F.ratio(r.lndRev, r.sp)); } },
        { label: 'New customers (first click)', n: 1, get: function (r) { return F.num(r.newFc); } }, { label: 'CAC on those', n: 1, get: function (r) { return F.money(F.ratio(r.sp, r.newFc)); } },
        { label: 'Window', get: function (r) { return Object.keys(r.win).join(', '); } }
      ], platRows) + '</div>';

      // Incrementality check: weekly spend vs new customers
      var weeks = {}, all = MD.valid(d.all);
      function wk(day) { var dt = new Date(day + 'T00:00:00Z'), dow = (dt.getUTCDay() + 6) % 7; return MD.addDays(day, -dow); }
      all.forEach(function (e) { var w = wk(e.day); var r = weeks[w] || (weeks[w] = { w: w, orders: 0, newc: 0, rev: 0, spend: 0, c: 0 }); r.orders++; if (e.isNew) r.newc++; r.rev += e.netMerch; r.c += MD.contribution(e); });
      MD.spendIn(p.prevFrom, p.to).forEach(function (x) { var w = wk(x.date); var r = weeks[w] || (weeks[w] = { w: w, orders: 0, newc: 0, rev: 0, spend: 0, c: 0 }); r.spend += x.spend; });
      var wrows = Object.keys(weeks).sort().map(function (k) { return weeks[k]; });
      if (wrows.length > 1) html += '<div class="card"><h2>When spend moved, did the business move?</h2><p class="sub">Week by week. If spend rises and new customers, revenue and contribution do not follow, the extra spend is not incremental. For a causal answer, run a geo or holdout test.</p>' +
        MD.chart(wrows.map(function (x) { return x.w; }), [
          { name: 'Ad spend', type: 'bar', color: '#C6FF00', values: wrows.map(function (x) { return x.spend; }), fmt: F.money, money: true },
          { name: 'Contribution before ads', type: 'bar', color: '#121212', values: wrows.map(function (x) { return x.c; }), fmt: F.money, money: true },
          { name: 'New customers', color: '#2c6ecb', axis: 'right', values: wrows.map(function (x) { return x.newc; }), fmt: F.num }
        ], { xfmt: function (w) { return 'wk ' + F.date(w); } }) + '</div>';

      // Exception log
      html += '<div class="card"><h2>Why the numbers differ</h2><p class="sub">Check these before calling a gap a problem.</p><ul style="margin:0;padding-left:18px;line-height:1.7">' + [
        'View-through: Meta can count a purchase after an ad was only seen (1-day view). Shopify never will.',
        'Overlap: one order can be claimed by both Meta and Google. Their sum is not the store total.',
        'Dates: Google Ads reports by click date by default; use "Conversions (by conv. time)" to compare with Shopify\'s order date.',
        'Time lag: Meta 7-day click can keep adding purchases to past days for a week.',
        'Branded search: last-click Google often closes demand Meta created. Compare first click with last non-direct above.',
        'Missing UTMs: untagged links land in Direct or organic. See UTM coverage in Acquisition.',
        'Duplicates, refunds and COD RTO: platforms keep counting a purchase that was cancelled, returned or never delivered.',
        'Time zones: set every ad account to ' + MD.shop.tz + ' so days line up.'
      ].map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>';
      el.innerHTML = html;
    });
  };

  function median(a) { a = a.slice().sort(function (x, y) { return x - y; }); return a.length ? a[Math.floor(a.length / 2)] : null; }

  /* ================= Conversion ================= */
  MD.views.funnel = function (el, p, alive) {
    el.innerHTML = '<div class="loading">Loading funnel…</div>';
    var Q = MD.Q;
    return Promise.all([
      safe(MD.ql(Q.funnelTotal(p))),
      safe(MD.ql(Q.funnelTotal(Object.assign({}, p, { from: p.prevFrom, to: p.prevTo })))),
      safe(MD.ql(Q.sessionsDaily(p))),
      safe(MD.ql(Q.sessionsBy('session_device_type', p))),
      safe(MD.ql(Q.sessionsBy('session_device_browser', p, 10))),
      safe(MD.ql(Q.sessionsBy('landing_page_path', p, 15))),
      safe(MD.ql(Q.sessionsBy('referring_channel', p))),
      safe(MD.ql(Q.productFunnel(p))),
      safe(MD.ql(Q.searches(p))),
      safe(MD.ql(Q.searchConversion(p))),
      safe(MD.ql(Q.webPerf(p))),
      MD.ext.on ? safe(MD.ordersDaily(p)) : Promise.resolve({ ok: false }),
      MD.ext.on ? safe(MD.ordersDaily({ from: p.prevFrom, to: p.prevTo })) : Promise.resolve({ ok: false }),
      MD.ext.on ? safe(MD.periodOrders(p)) : Promise.resolve({ ok: false })
    ]).then(function (r) {
      if (!alive()) return;
      if (MD.ext.on) {
        var od = {}, tot = 0, ptot = 0;
        if (r[11].ok) r[11].v.forEach(function (x) { od[String(x.day).slice(0, 10)] = x.orders; tot += x.orders || 0; });
        if (r[12].ok) r[12].v.forEach(function (x) { ptot += x.orders || 0; });
        if (r[0].ok) MD.patchBought(r[0].v, { total: tot });
        if (r[1].ok) MD.patchBought(r[1].v, { total: ptot });
        if (r[2].ok) MD.patchBought(r[2].v, { byDay: od });
        var byLp = MD.groupBy(r[13].ok ? MD.valid(r[13].v.cur) : [], function (e) { return e.landing; });
        [3, 4, 6].forEach(function (i) { if (r[i].ok) MD.patchBought(r[i].v); });
        if (r[5].ok) MD.patchBought(r[5].v, { map: function (x) { return (byLp[x.landing_page_path] || []).length; } });
        if (r[7].ok) MD.patchBought(r[7].v, { map: function (x) { return (byLp[x.landing_page_path] || []).length; } });
      }
      var html = MD.extNote() + sessionNote(p);
      if (r[0].ok && r[0].v[0]) {
        var t = r[0].v[0], pv = r[1].ok && r[1].v[0] ? r[1].v[0] : {};
        if (MD.ext.on) {
          var o0 = t.sessions_that_completed_checkout, po = pv.sessions_that_completed_checkout;
          html += '<div class="card"><h2>Store funnel</h2><p class="sub">Checkout happens on ' + esc(MD.ext.app) + ', so Shopify\'s checkout step is skipped: sessions → added to cart → orders.</p>' + MD.funnel([
            { label: 'Sessions', value: t.sessions }, { label: 'Added to cart', value: t.sessions_with_cart_additions }, { label: 'Orders', value: o0 }
          ]) + '<div class="kpis" style="margin-top:14px">' +
            MD.kpi({ label: 'Add-to-cart rate', value: F.pct(F.ratio(t.sessions_with_cart_additions, t.sessions)), delta: F.delta(F.ratio(t.sessions_with_cart_additions, t.sessions), F.ratio(pv.sessions_with_cart_additions, pv.sessions)) }) +
            MD.kpi({ label: 'Cart to order', value: F.pct(F.ratio(o0, t.sessions_with_cart_additions)), delta: F.delta(F.ratio(o0, t.sessions_with_cart_additions), F.ratio(po, pv.sessions_with_cart_additions)) }) +
            MD.kpi({ label: 'Store conversion rate', value: F.pct(F.ratio(o0, t.sessions)), sub: 'orders ÷ sessions', delta: F.delta(F.ratio(o0, t.sessions), F.ratio(po, pv.sessions)), hi: true }) +
            MD.kpi({ label: 'Cart abandonment', value: F.pct(Math.max(0, 1 - (F.ratio(o0, t.sessions_with_cart_additions) || 0))), sub: 'carts that did not become orders' }) +
            '</div></div>';
        } else {
        html += '<div class="card"><h2>Store funnel</h2><p class="sub">Shopify\'s open funnel: a session can reach checkout without a recorded cart addition, so steps are not a strict sequence.</p>' + MD.funnel([
            { label: 'Sessions', value: t.sessions },
            { label: 'Added to cart', value: t.sessions_with_cart_additions },
            { label: 'Reached checkout', value: t.sessions_that_reached_checkout },
            { label: 'Completed checkout', value: t.sessions_that_completed_checkout }
          ]) + '<div class="kpis" style="margin-top:14px">' +
            MD.kpi({ label: 'Add-to-cart rate', value: F.pct(F.ratio(t.sessions_with_cart_additions, t.sessions)), delta: F.delta(F.ratio(t.sessions_with_cart_additions, t.sessions), F.ratio(pv.sessions_with_cart_additions, pv.sessions)) }) +
            MD.kpi({ label: 'Cart to checkout', value: F.pct(F.ratio(t.sessions_that_reached_checkout, t.sessions_with_cart_additions)), delta: F.delta(F.ratio(t.sessions_that_reached_checkout, t.sessions_with_cart_additions), F.ratio(pv.sessions_that_reached_checkout, pv.sessions_with_cart_additions)) }) +
            MD.kpi({ label: 'Checkout completion', value: F.pct(F.ratio(t.sessions_that_completed_checkout, t.sessions_that_reached_checkout)), delta: F.delta(F.ratio(t.sessions_that_completed_checkout, t.sessions_that_reached_checkout), F.ratio(pv.sessions_that_completed_checkout, pv.sessions_that_reached_checkout)) }) +
            MD.kpi({ label: 'Store conversion rate', value: F.pct(F.ratio(t.sessions_that_completed_checkout, t.sessions)), delta: F.delta(F.ratio(t.sessions_that_completed_checkout, t.sessions), F.ratio(pv.sessions_that_completed_checkout, pv.sessions)), hi: true }) +
            MD.kpi({ label: 'Cart abandonment', value: F.pct(1 - (F.ratio(t.sessions_that_completed_checkout, t.sessions_with_cart_additions) || 0)), sub: 'carts that did not become orders' }) +
            '</div></div>';
          }
      } else html += MD.err(r[0].e, 'the funnel');

      if (r[2].ok) {
        var rows = r[2].v, days = rows.map(function (x) { return String(x.day).slice(0, 10); });
        html += '<div class="card"><h2>Funnel rates by day</h2>' + MD.chart(days, [
          { name: 'Add-to-cart rate', color: '#121212', values: rows.map(function (x) { return F.ratio(x.sessions_with_cart_additions, x.sessions); }), fmt: F.pct, pct: true },
          { name: 'Reached checkout', color: '#e07a1f', values: rows.map(function (x) { return F.ratio(x.sessions_that_reached_checkout, x.sessions); }), fmt: F.pct, pct: true },
          { name: 'Conversion rate', color: '#2c6ecb', values: rows.map(function (x) { return F.ratio(x.sessions_that_completed_checkout, x.sessions); }), fmt: F.pct, pct: true }
        ], { xfmt: F.date, marker: MARK }) + '</div>';
      }

      function stepTable(res, dim, label) {
        if (!res.ok) return MD.err(res.e, label);
        return MD.table([
          { label: label, get: function (x) { return x[dim] == null || x[dim] === '' ? '(none)' : x[dim]; } },
          { label: 'Sessions', n: 1, get: function (x) { return F.num(x.sessions); } },
          { label: 'Cart rate', n: 1, get: function (x) { return F.pct(F.ratio(x.sessions_with_cart_additions, x.sessions)); } },
          { label: 'Cart → checkout', n: 1, get: function (x) { return F.pct(F.ratio(x.sessions_that_reached_checkout, x.sessions_with_cart_additions)); } },
          { label: 'Checkout → order', n: 1, get: function (x) { return F.pct(F.ratio(x.sessions_that_completed_checkout, x.sessions_that_reached_checkout)); } },
          { label: 'Conv. rate', n: 1, get: function (x) { return F.pct(F.ratio(x.sessions_that_completed_checkout, x.sessions)); } }
        ], res.v, { empty: 'No sessions.' });
      }
      html += '<div class="cols"><div class="card"><h2>By device</h2>' + stepTable(r[3], 'session_device_type', 'Device') + '<h3>By browser</h3>' + stepTable(r[4], 'session_device_browser', 'Browser') + '</div>';
      html += '<div class="card"><h2>By channel</h2>' + stepTable(r[6], 'referring_channel', 'Channel') + '</div></div>';
      html += '<div class="card"><h2>By landing page</h2><p class="sub">Pages that win the cart but lose the checkout usually have a price, shipping or trust problem, not a traffic problem.</p>' + stepTable(r[5], 'landing_page_path', 'Landing page') + '</div>';

      if (r[7].ok) html += '<div class="card"><h2>Product page to cart</h2><p class="sub">Which products get viewed but not added.</p>' + MD.table(MD.Q.productFunnelColumns, r[7].v, { empty: 'No product views recorded.' }) + '</div>';
      else html += '<div class="card"><h2>Product page to cart</h2>' + MD.note(esc(MD.Q.productFunnelNote || r[7].e.message), 'info') + '</div>';
      var sc = r[9].ok && r[9].v[0] ? r[9].v[0] : null;
      html += '<div class="card"><h2>On-site search</h2>' + (sc ? '<div class="kpis" style="margin-bottom:12px">' +
        MD.kpi({ label: 'Sessions that searched', value: F.num(sc.sessions_with_searches) }) + MD.kpi({ label: 'Clicked a result', value: F.pct(F.ratio(sc.search_sessions_with_clicks, sc.sessions_with_searches)) }) +
        MD.kpi({ label: 'Added to cart', value: F.pct(F.ratio(sc.search_sessions_with_cart_additions, sc.sessions_with_searches)) }) + MD.kpi({ label: 'Bought', value: F.pct(F.ratio(sc.search_sessions_that_completed_checkout, sc.sessions_with_searches)), hi: true }) + '</div>' : '') +
        (r[8].ok ? MD.table(MD.Q.searchColumns, r[8].v, { empty: 'No searches recorded.' }) : MD.err(r[8].e, 'searches')) + '</div>';
      if (r[10].ok) {
        function ms(v) { return v == null ? '·' : (v / 1000).toFixed(2) + ' s'; }
        function rate(v, good, poor) { return v == null ? '' : v <= good ? ' <span class="badge b-ok">good</span>' : v <= poor ? ' <span class="badge b-warn">needs work</span>' : ' <span class="badge b-bad">poor</span>'; }
        html += '<div class="card"><h2>Site speed (Core Web Vitals)</h2><p class="sub">75th percentile of real visits, by page type and device. Google\'s targets: LCP under 2.5 s, INP under 200 ms, CLS under 0.1.</p>' + MD.table([
          { label: 'Page type', get: function (x) { return x.page_type || ''; } }, { label: 'Device', get: function (x) { return x.device_type || ''; } },
          { label: 'Page loads', n: 1, get: function (x) { return F.num(x.page_loads); } },
          { label: 'LCP', n: 1, html: 1, get: function (x) { return ms(x.lcp_p75_ms) + rate(x.lcp_p75_ms, 2500, 4000); } },
          { label: 'INP', n: 1, html: 1, get: function (x) { return x.inp_p75_ms == null ? '·' : Math.round(x.inp_p75_ms) + ' ms' + rate(x.inp_p75_ms, 200, 500); } },
          { label: 'CLS', n: 1, html: 1, get: function (x) { return x.p75_cls == null ? '·' : x.p75_cls.toFixed(2) + rate(x.p75_cls, 0.1, 0.25); } }
        ], r[10].v, { empty: 'No page-speed data yet. Shopify collects it from real visits once the store is open.' }) + '</div>';
      }

      html += '<div class="card"><h2>Not in Shopify\'s data</h2><p class="sub">Payment failures and reasons, and shipping-step and coupon-entry drop-off, come from your payment provider, checkout app (GoKwik) or GA4. Track <code>add_shipping_info</code>, <code>add_payment_info</code> and <code>purchase</code> in GA4 to see those steps.</p></div>';
      el.innerHTML = html;
    });
  };

  /* ================= Products ================= */
  MD.views.products = function (el, p, alive) {
    el.innerHTML = '<div class="loading">Loading orders…</div>';
    return Promise.all([MD.periodOrders(p, progress(el)), safe(MD.ql(MD.Q.inventory(p))), safe(MD.ql(MD.Q.returnsByReason(p)))]).then(function (res) {
      if (!alive()) return;
      var d = res[0], inv = res[1], ret = res[2], valid = MD.valid(d.cur);
      var by = {};
      valid.forEach(function (e) {
        e.lines.forEach(function (l) {
          var k = l.title + (l.variant ? ' · ' + l.variant : '');
          var r = by[k] || (by[k] = { k: k, product: l.title, productId: l.productId, units: 0, orders: 0, gross: 0, net: 0, cogs: 0, disc: 0, newUnits: 0, newOrders: 0, returned: 0, known: true });
          r.units += l.qty; r.orders++; r.gross += l.gross; r.net += l.net; r.cogs += l.cogs * (l.qty ? l.qtyNow / l.qty : 1) + (l.qty ? l.cogs * (1 - l.qtyNow / l.qty) : 0); r.disc += l.discount;
          r.returned += l.qty - l.qtyNow;
          if (e.isNew) { r.newUnits += l.qty; r.newOrders++; }
          if (!l.costKnown) r.known = false;
        });
      });
      var rows = Object.keys(by).map(function (k) { var r = by[k]; r.margin = r.net - r.cogs; r.mPct = F.ratio(r.margin, r.net); r.dPct = F.ratio(r.disc, r.gross); return r; });
      function top(key) { return rows.slice().sort(function (a, b) { return b[key] - a[key]; })[0]; }
      var html = '';
      if (rows.length) {
        var tr = top('net'), tu = top('units'), tm = top('margin'), tn = top('newOrders');
        html += '<div class="card"><h2>Best sellers, four ways</h2><p class="sub">These are often four different products.</p><div class="kpis">' +
          MD.kpi({ label: 'By revenue', value: esc(tr.k), sub: F.money(tr.net) }) + MD.kpi({ label: 'By units', value: esc(tu.k), sub: F.num(tu.units) + ' units' }) +
          MD.kpi({ label: 'By margin', value: esc(tm.k), sub: F.money(tm.margin) + (tm.known ? '' : ' (estimated cost)'), hi: true }) +
          MD.kpi({ label: 'By new customers won', value: esc(tn.k), sub: F.num(tn.newOrders) + ' first orders' }) + '</div></div>';
      }
      var maxNet = Math.max.apply(null, rows.map(function (r) { return r.net; }).concat([1]));
      html += '<div class="card"><h2>Products and variants</h2>' + MD.table([
        { label: 'Product', html: 1, get: function (r) { return esc(r.k) + MD.bar(r.net, maxNet); } },
        { label: 'Units', n: 1, get: function (r) { return F.num(r.units); } }, { label: 'Orders', n: 1, get: function (r) { return F.num(r.orders); } },
        { label: 'Net revenue', n: 1, get: function (r) { return F.money(r.net); } }, { label: 'Discount depth', n: 1, get: function (r) { return F.pct(r.dPct); } },
        { label: 'Gross margin', n: 1, get: function (r) { return F.money(r.margin) + ' · ' + F.pct(r.mPct) + (r.known ? '' : '*'); } },
        { label: 'In first orders', n: 1, get: function (r) { return F.num(r.newOrders); } },
        { label: 'Returned / removed', n: 1, get: function (r) { return r.returned ? F.num(r.returned) + ' · ' + F.pct(r.returned / r.units) : ''; } }
      ], rows.sort(function (a, b) { return b.net - a.net; }), { empty: 'No sales in this period.' }) + '<p class="muted" style="font-size:12px;margin:8px 0 0">* estimated with the fallback COGS % because the variant has no cost in Shopify.</p></div>';

      // Bundles: pairs bought together
      var pairs = {};
      valid.forEach(function (e) {
        var t = e.lines.map(function (l) { return l.title; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).sort();
        for (var i = 0; i < t.length; i++) for (var j = i + 1; j < t.length; j++) { var k = t[i] + ' + ' + t[j]; pairs[k] = (pairs[k] || 0) + 1; }
      });
      var pr = Object.keys(pairs).map(function (k) { return { k: k, n: pairs[k] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 12);
      var multi = valid.filter(function (e) { return e.lines.length > 1; }).length;
      html += '<div class="cols"><div class="card"><h2>Bought together</h2><p class="sub">' + F.pct(F.ratio(multi, valid.length)) + ' of orders contain more than one product.</p>' + MD.table([{ label: 'Pair', key: 'k' }, { label: 'Orders', n: 1, get: function (r) { return F.num(r.n); } }], pr, { empty: 'No multi-product orders yet.' }) + '</div>';

      // Inventory
      html += '<div class="card"><h2>Stock cover</h2><p class="sub">Days of stock left at the current sales rate. Low cover on a best seller is lost sales.</p>';
      if (inv.ok) {
        var ir = inv.v.slice().sort(function (a, b) { var ca = a.ending_inventory_units <= 0 ? -1 : (a.days_of_inventory_remaining == null ? 1e9 : a.days_of_inventory_remaining), cb = b.ending_inventory_units <= 0 ? -1 : (b.days_of_inventory_remaining == null ? 1e9 : b.days_of_inventory_remaining); return ca - cb; });
        html += MD.table([
          { label: 'Variant', get: function (x) { return x.product_title + (x.product_variant_title && x.product_variant_title !== 'Default Title' ? ' · ' + x.product_variant_title : ''); } },
          { label: 'On hand', n: 1, get: function (x) { return F.num(x.ending_inventory_units); } }, { label: 'Sold', n: 1, get: function (x) { return F.num(x.inventory_units_sold); } },
          { label: 'Sell-through', n: 1, get: function (x) { return F.pct(x.sell_through_rate); } }, { label: 'Days out of stock', n: 1, get: function (x) { return x.days_out_of_stock ? F.num(x.days_out_of_stock) : ''; } },
          { label: 'Days of cover', n: 1, html: 1, get: function (x) { return x.ending_inventory_units <= 0 ? '<span class="badge b-bad">Out of stock</span>' : x.days_of_inventory_remaining == null ? '<span class="muted">no sales</span>' : (x.days_of_inventory_remaining < 14 ? '<span class="badge b-warn">' + F.dec(x.days_of_inventory_remaining) + '</span>' : F.dec(x.days_of_inventory_remaining)); } },
          { label: 'Stock value', n: 1, get: function (x) { return F.money(x.ending_inventory_value); } }
        ], ir.slice(0, 50)) + '</div></div>';
      } else html += MD.err(inv.e, 'inventory') + '</div></div>';
      html += '<div class="card"><h2>Returns by reason</h2>' + (ret.ok ? MD.table([
        { label: 'Product', get: function (x) { return x.product_title_at_time_of_sale + (x.product_variant_title_at_time_of_sale ? ' · ' + x.product_variant_title_at_time_of_sale : ''); } },
        { label: 'Reason', get: function (x) { return String(x.return_line_item_reason || 'not given').replace(/_/g, ' ').toLowerCase(); } },
        { label: 'Units returned', n: 1, get: function (x) { return F.num(x.returned_quantity); } }
      ], ret.v, { empty: 'No returns in this period.' }) : MD.err(ret.e, 'returns')) + '</div>';
      el.innerHTML = html;
    });
  };

  /* ================= Retention ================= */
  MD.views.retention = function (el, p, alive) {
    el.innerHTML = '<div class="loading">Loading customer history…</div>';
    return MD.loadHistory(24).then(function (h) {
      if (!alive()) return;
      var custs = Object.keys(h.byCustomer).map(function (k) { return { id: k, orders: h.byCustomer[k] }; }).filter(function (c) { return c.orders.length; });
      var html = '';
      if (!custs.length) { el.innerHTML = MD.empty('No customer orders yet. Retention needs a few weeks of orders.'); return; }
      var repeaters = custs.filter(function (c) { return c.orders.length > 1; });
      var gaps = repeaters.map(function (c) { return MD.daysBetween(c.orders[0].day, c.orders[1].day); });
      function repeatWithin(days) {
        var elig = custs.filter(function (c) { return MD.daysBetween(c.orders[0].day, MD.today()) >= days; });
        return { rate: F.ratio(elig.filter(function (c) { return c.orders[1] && MD.daysBetween(c.orders[0].day, c.orders[1].day) <= days; }).length, elig.length), n: elig.length };
      }
      var r30 = repeatWithin(30), r60 = repeatWithin(60), r90 = repeatWithin(90), r180 = repeatWithin(180);
      html += '<div class="card"><h2>Repeat behaviour</h2><p class="sub">From every order in the last 24 months (' + F.num(h.count) + ' orders, ' + F.num(custs.length) + ' customers). A repeat rate only counts customers whose first order is old enough to have had the chance.</p><div class="kpis">' +
        MD.kpi({ label: 'Customers who ordered again', value: F.pct(F.ratio(repeaters.length, custs.length)), sub: F.num(repeaters.length) + ' of ' + F.num(custs.length), hi: true }) +
        MD.kpi({ label: 'Orders per customer', value: F.dec(F.ratio(sum(custs, function (c) { return c.orders.length; }), custs.length)) }) +
        MD.kpi({ label: 'Median days to 2nd order', value: F.dec(median(gaps)), sub: gaps.length + ' customers' }) +
        MD.kpi({ label: '30-day repeat', value: F.pct(r30.rate), sub: r30.n + ' eligible' }) + MD.kpi({ label: '60-day repeat', value: F.pct(r60.rate), sub: r60.n + ' eligible' }) +
        MD.kpi({ label: '90-day repeat', value: F.pct(r90.rate), sub: r90.n + ' eligible' }) + MD.kpi({ label: '180-day repeat', value: F.pct(r180.rate), sub: r180.n + ' eligible' }) +
        MD.kpi({ label: 'First vs repeat order value', value: F.money(F.ratio(sum(custs, function (c) { return c.orders[0].value; }), custs.length)) + ' / ' + F.money(F.ratio(sum(repeaters, function (c) { return sum(c.orders.slice(1), function (o) { return o.value; }); }), sum(repeaters, function (c) { return c.orders.length - 1; }))), sub: 'average, incl. tax' }) +
        '</div></div>';

      // Cohorts by first-order month
      var cohorts = MD.groupBy(custs, function (c) { return MD.monthOf(c.orders[0].day); });
      var months = Object.keys(cohorts).sort().slice(-12);
      var maxAge = 6;
      html += '<div class="card"><h2>Cohorts</h2><p class="sub">Customers grouped by the month of their first order. Each cell is the share who ordered again by that many months later, and revenue per customer so far.</p><div class="scroll"><table class="heat"><thead><tr><th>First order</th><th class="n">Customers</th>' +
        Array.from({ length: maxAge }, function (_, i) { return '<th class="n">+' + (i + 1) + ' mo</th>'; }).join('') + '<th class="n">Revenue / customer</th></tr></thead><tbody>' +
        months.map(function (m) {
          var list = cohorts[m], start = m + '-01', ageMonths = monthsBetween(m, MD.monthOf(MD.today()));
          return '<tr><td>' + F.month(m) + '</td><td class="n">' + F.num(list.length) + '</td>' + Array.from({ length: maxAge }, function (_, i) {
            if (i + 1 > ageMonths) return '<td class="n muted">·</td>';
            var until = MD.addDays(start, Math.round((i + 1) * 30.5));
            var rate = F.ratio(list.filter(function (c) { return c.orders.slice(1).some(function (o) { return o.day < until; }); }).length, list.length);
            return '<td class="n" style="background:rgba(198,255,0,' + Math.min(0.9, (rate || 0) * 3) + ')">' + F.pct(rate) + '</td>';
          }).join('') + '<td class="n">' + F.money(F.ratio(sum(list, function (c) { return sum(c.orders, function (o) { return o.value; }); }), list.length)) + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';

      // RFM
      var today = MD.today();
      var seg = { 'Champions': [], 'Loyal': [], 'New': [], 'Promising': [], 'At risk': [], 'Lapsed one-timers': [], 'Lost': [] };
      custs.forEach(function (c) {
        var last = c.orders[c.orders.length - 1].day, rec = MD.daysBetween(last, today), f = c.orders.length, m = sum(c.orders, function (o) { return o.value; });
        c.rec = rec; c.m = m;
        if (f >= 3 && rec <= 60) seg['Champions'].push(c);
        else if (f >= 2 && rec <= 120) seg['Loyal'].push(c);
        else if (f === 1 && rec <= 30) seg['New'].push(c);
        else if (f === 1 && rec <= 90) seg['Promising'].push(c);
        else if (f >= 2) seg['At risk'].push(c);
        else if (rec <= 180) seg['Lapsed one-timers'].push(c);
        else seg['Lost'].push(c);
      });
      var what = { 'Champions': '3+ orders, bought in the last 60 days. Reward, ask for reviews and referrals.', 'Loyal': '2+ orders, active in the last 120 days. Cross-sell the next product.', 'New': 'First order in the last 30 days. Onboard, then push the second order.', 'Promising': 'One order, 31 to 90 days ago. The second-purchase window is closing.', 'At risk': 'Repeat buyers gone quiet for 120+ days. Win back with a reason to return.', 'Lapsed one-timers': 'One order, 91 to 180 days ago. Try a replenishment reminder.', 'Lost': 'One order, over 180 days ago.' };
      html += '<div class="card"><h2>Customer groups (RFM)</h2><p class="sub">Recency, frequency and value from order history. Export these as customer segments in Shopify to target them.</p>' + MD.table([
        { label: 'Group', key: 'k' }, { label: 'Customers', n: 1, get: function (r) { return F.num(r.n); } }, { label: 'Share', n: 1, get: function (r) { return F.pct(r.s); } },
        { label: 'Avg lifetime value', n: 1, get: function (r) { return F.money(r.v); } }, { label: 'What to do', key: 'w' }
      ], Object.keys(seg).map(function (k) { var l = seg[k]; return { k: k, n: l.length, s: F.ratio(l.length, custs.length), v: F.ratio(sum(l, function (c) { return c.m; }), l.length), w: what[k] }; })) + '</div>';

      // LTV vs CAC payback
      var spend = sum(MD.state.spend, function (x) { return x.spend; });
      var firstInSpend = MD.state.spend.length ? custs.filter(function (c) { return c.orders[0].day >= MD.state.spend.map(function (x) { return x.date; }).sort()[0]; }).length : 0;
      html += '<div class="card"><h2>Lifetime value against acquisition cost</h2><div class="kpis">' +
        MD.kpi({ label: 'Revenue per customer so far', value: F.money(F.ratio(sum(custs, function (c) { return c.m; }), custs.length)), sub: 'incl. tax, all history' }) +
        MD.kpi({ label: 'Blended CAC since spend tracking began', value: F.money(F.ratio(spend, firstInSpend)), sub: F.num(firstInSpend) + ' new customers' }) +
        MD.kpi({ label: 'Value ÷ CAC', value: F.x(F.ratio(F.ratio(sum(custs, function (c) { return c.m; }), custs.length), F.ratio(spend, firstInSpend))), sub: 'revenue basis; see Finance for margin', hi: true }) +
        '</div></div>';
      el.innerHTML = html;
    });
  };
  function monthsBetween(a, b) { var ay = +a.slice(0, 4), am = +a.slice(5, 7), by = +b.slice(0, 4), bm = +b.slice(5, 7); return (by - ay) * 12 + (bm - am); }
})(window.MD = window.MD || {});
