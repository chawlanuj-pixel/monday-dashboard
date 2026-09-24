/* Monday Dashboard · Explore (Tableau-style builder over ShopifyQL) and Today (hour by hour). */
(function (MD) {
  'use strict';
  var F = MD.fmt, esc = F.esc, sum = MD.sum;
  MD.views = MD.views || {};
  function safe(p) { return p.then(function (v) { return { ok: true, v: v }; }, function (e) { return { ok: false, e: e }; }); }

  /* Datasets, metrics and dimensions verified against ShopifyQL 2026-07. */
  var DS = {
    sessions: {
      label: 'Traffic and funnel (sessions)', from: 'sessions', human: true,
      metrics: [['sessions', 'Sessions'], ['online_store_visitors', 'Visitors'], ['pageviews', 'Pageviews'], ['bounce_rate', 'Bounce rate', 'pct'], ['average_session_duration', 'Avg session (s)'],
        ['sessions_with_cart_additions', 'Sessions with add to cart'], ['sessions_that_reached_checkout', 'Sessions reaching checkout'], ['sessions_that_completed_checkout', 'Sessions completing checkout'], ['conversion_rate', 'Conversion rate', 'pct']],
      dims: [['referring_channel', 'Channel'], ['referrer_name', 'Referrer'], ['traffic_type', 'Traffic type'], ['landing_page_path', 'Landing page'], ['landing_page_type', 'Landing page type'],
        ['session_device_type', 'Device'], ['session_device_browser', 'Browser'], ['session_device_os', 'OS'], ['session_country', 'Country'], ['session_region', 'State / region'], ['session_city', 'City'],
        ['utm_source', 'UTM source'], ['utm_medium', 'UTM medium'], ['utm_campaign', 'UTM campaign'], ['utm_content', 'UTM content'], ['day_of_week', 'Weekday'], ['hour_of_day', 'Hour of day']],
      defaults: { metrics: ['sessions', 'sessions_with_cart_additions', 'sessions_that_completed_checkout'], dim: 'referring_channel' }
    },
    sales: {
      label: 'Sales and orders', from: 'sales',
      metrics: [['orders', 'Orders'], ['gross_sales', 'Gross sales', 'money'], ['discounts', 'Discounts', 'money'], ['sales_reversals', 'Returns', 'money'], ['net_sales', 'Net sales', 'money'], ['shipping_charges', 'Shipping charged', 'money'],
        ['taxes', 'Taxes', 'money'], ['total_sales', 'Total sales', 'money'], ['average_order_value', 'AOV', 'money'], ['quantity_ordered', 'Units'], ['new_customers', 'New customers'], ['returning_customers', 'Returning customers'],
        ['cost_of_goods_sold', 'COGS', 'money'], ['gross_profit', 'Gross profit', 'money']],
      dims: [['product_title', 'Product'], ['product_variant_title', 'Variant'], ['product_type', 'Product type'], ['product_vendor', 'Vendor'], ['sales_channel', 'Sales channel'], ['discount_code', 'Discount code'], ['discount_title', 'Discount'],
        ['new_or_returning_customer', 'New or returning'], ['shipping_region', 'Shipping state'], ['shipping_city', 'Shipping city'], ['billing_region', 'Billing state'], ['order_referrer_source', 'Order referrer'],
        ['order_utm_source', 'Order UTM source'], ['order_utm_campaign', 'Order UTM campaign'], ['order_landing_page_path', 'Order landing page'], ['customer_cohort_month', 'Customer cohort month'], ['day_of_week', 'Weekday'], ['hour_of_day', 'Hour of day']],
      defaults: { metrics: ['net_sales', 'orders'], dim: 'product_title' }
    },
    attribution: {
      label: 'Attribution (Shopify models)', from: 'sales', model: true,
      metrics: [['orders', 'Orders'], ['net_sales', 'Net sales', 'money'], ['total_sales', 'Total sales', 'money'], ['new_customers', 'New customers']],
      dims: [['referring_channel', 'Channel'], ['referring_platform', 'Platform'], ['traffic_type', 'Traffic type'], ['utm_source', 'UTM source'], ['utm_medium', 'UTM medium'], ['utm_campaign', 'UTM campaign'], ['utm_content', 'UTM content']],
      defaults: { metrics: ['orders', 'net_sales'], dim: 'referring_channel' }
    },
    inventory: {
      label: 'Inventory', from: 'inventory', noTime: true,
      metrics: [['ending_inventory_units', 'Units on hand'], ['inventory_units_sold', 'Units sold'], ['sell_through_rate', 'Sell-through', 'pct'], ['days_of_inventory_remaining', 'Days of cover'], ['days_out_of_stock', 'Days out of stock'], ['ending_inventory_value', 'Stock value', 'money']],
      dims: [['product_title', 'Product'], ['product_variant_title', 'Variant']],
      defaults: { metrics: ['ending_inventory_units', 'inventory_units_sold', 'days_of_inventory_remaining'], dim: 'product_title' }
    },
    fulfillments: {
      label: 'Fulfilment', from: 'fulfillments',
      metrics: [['orders_fulfilled', 'Fulfilled'], ['orders_shipped', 'Shipped'], ['orders_delivered', 'Delivered'], ['median_hours_order_to_fulfillment', 'Median hours to fulfil'], ['median_days_order_to_delivery', 'Median days to deliver']],
      dims: [['shipping_carrier', 'Courier'], ['shipping_region', 'State']],
      defaults: { metrics: ['orders_fulfilled', 'orders_delivered'], dim: 'shipping_carrier' }
    }
  };
  var MODELS = [['LAST_NON_DIRECT_CLICK', 'Last non-direct click', 'last_non_direct_click'], ['FIRST_CLICK', 'First click', 'first_click'], ['LAST_CLICK', 'Last click', 'last_click'], ['LINEAR', 'Linear', 'linear'], ['ANY_CLICK', 'Any click', 'any_click']];
  var CHARTS = [['bar', 'Bars'], ['line', 'Lines'], ['stack', 'Stacked'], ['table', 'Table only'], ['pivot', 'Pivot heatmap (2 dimensions)']];
  var GRAINS = [['', 'No time split'], ['day', 'Day'], ['week', 'Week'], ['month', 'Month']];
  var COLORS = ['#121212', '#2c6ecb', '#e07a1f', '#8a5cf6', '#16a34a', '#b42318', '#0891b2', '#a16207'];

  function saved() { try { return JSON.parse(localStorage.getItem('md-explore') || 'null'); } catch (e) { return null; } }
  function save(c) { try { localStorage.setItem('md-explore', JSON.stringify(c)); } catch (e) {} }

  function build(c, p) {
    var d = DS[c.ds], metrics = c.metrics.length ? c.metrics : d.defaults.metrics;
    var dims = [c.dim, c.dim2].filter(Boolean);
    var q = 'FROM ' + d.from + ' SHOW ' + metrics.join(', ');
    var where = [];
    if (d.human && c.human) where.push("human_or_bot_session = 'human'");
    if (c.filterDim && c.filterVal) where.push(c.filterDim + " = '" + String(c.filterVal).replace(/'/g, "\\'") + "'");
    if (where.length) q += ' WHERE ' + where.join(' AND ');
    if (dims.length) q += ' GROUP BY ' + dims.join(', ');
    if (d.model) q += ' WITH ' + c.model + '_ATTRIBUTION';
    if (c.grain && !d.noTime) q += ' TIMESERIES ' + c.grain;
    q += ' SINCE ' + p.from + ' UNTIL ' + p.to;
    var sortCol = metrics[0] + (d.model ? '__' + modelSuffix(c.model) : '');
    if (!c.grain || d.noTime) q += ' ORDER BY ' + sortCol + ' DESC LIMIT ' + (c.limit || 50);
    else q += ' ORDER BY ' + c.grain + ' ASC';
    return { q: q, metrics: metrics, dims: dims, col: function (m) { return d.model ? m + '__' + modelSuffix(c.model) : m; } };
  }
  function modelSuffix(m) { return MODELS.filter(function (x) { return x[0] === m; })[0][2]; }
  function mInfo(ds, m) { return DS[ds].metrics.filter(function (x) { return x[0] === m; })[0] || [m, m]; }
  function fmtM(ds, m, v) { var t = mInfo(ds, m)[2]; return t === 'money' ? F.money(v) : t === 'pct' ? F.pct(v) : (Math.abs(v) < 100 && v % 1 ? F.dec(v) : F.num(v)); }
  function dimLabel(ds, k) { var x = DS[ds].dims.filter(function (d) { return d[0] === k; })[0]; return x ? x[1] : k; }
  var DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  function dimVal(k, v) { if (v == null || v === '') return '(none)'; if (k === 'day_of_week' && /^\d+$/.test(String(v))) return DOW[+v % 7]; return String(v); }

  MD.views.explore = function (el, p, alive) {
    var c = saved() || { ds: 'sessions', metrics: DS.sessions.defaults.metrics, dim: DS.sessions.defaults.dim, dim2: '', grain: '', chart: 'bar', human: true, model: 'LAST_NON_DIRECT_CLICK', limit: 25 };
    if (!DS[c.ds]) c.ds = 'sessions';
    var d = DS[c.ds];
    var B = build(c, p);
    var html = '<div class="explore"><aside class="card ex-side"><h2>Explore</h2><p class="sub">Build any view: pick what to measure and how to slice it.</p>' +
      '<label class="exl">Data<select id="ex-ds">' + Object.keys(DS).map(function (k) { return '<option value="' + k + '"' + (k === c.ds ? ' selected' : '') + '>' + esc(DS[k].label) + '</option>'; }).join('') + '</select></label>' +
      '<div class="exl">Metrics<div class="ex-checks">' + d.metrics.map(function (m) { return '<label><input type="checkbox" value="' + m[0] + '"' + (B.metrics.indexOf(m[0]) >= 0 ? ' checked' : '') + '> ' + esc(m[1]) + '</label>'; }).join('') + '</div></div>' +
      '<label class="exl">Rows (dimension)<select id="ex-dim"><option value="">None (totals)</option>' + d.dims.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === c.dim ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('') + '</select></label>' +
      '<label class="exl">Break down by (second dimension)<select id="ex-dim2"><option value="">None</option>' + d.dims.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === c.dim2 ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('') + '</select></label>' +
      (d.noTime ? '' : '<label class="exl">Over time<select id="ex-grain">' + GRAINS.map(function (g) { return '<option value="' + g[0] + '"' + (g[0] === (c.grain || '') ? ' selected' : '') + '>' + g[1] + '</option>'; }).join('') + '</select></label>') +
      (d.model ? '<label class="exl">Attribution model<select id="ex-model">' + MODELS.map(function (m) { return '<option value="' + m[0] + '"' + (m[0] === c.model ? ' selected' : '') + '>' + m[1] + '</option>'; }).join('') + '</select></label>' : '') +
      '<label class="exl">Filter<div class="row"><select id="ex-fdim"><option value="">No filter</option>' + d.dims.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === c.filterDim ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('') + '</select><input type="text" id="ex-fval" placeholder="equals…" value="' + esc(c.filterVal || '') + '" style="flex:1;min-width:0"></div></label>' +
      '<label class="exl">Chart<select id="ex-chart">' + CHARTS.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === c.chart ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></label>' +
      '<label class="exl">Rows shown<select id="ex-limit">' + [10, 25, 50, 100, 250].map(function (n) { return '<option' + (n === +c.limit ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>' +
      (d.human ? '<label class="exl" style="flex-direction:row;gap:6px;align-items:center"><input type="checkbox" id="ex-human"' + (c.human ? ' checked' : '') + '> Humans only (remove bots)</label>' : '') +
      '<div class="row" style="margin-top:8px"><button class="btn btn--primary" id="ex-run" type="button">Update</button><button class="btn" id="ex-csv" type="button">CSV</button></div>' +
      '<div class="ex-presets"><div class="muted small">Quick views</div>' + PRESETS.map(function (pr, i) { return '<button class="chip-btn" data-preset="' + i + '" type="button">' + esc(pr.name) + '</button>'; }).join('') + '</div>' +
      '</aside><section class="ex-main"><div class="card" id="ex-out"><div class="loading">Running…</div></div><div class="card"><details><summary>ShopifyQL behind this view</summary><pre class="code">' + esc(B.q) + '</pre></details></div></section></div>';
    el.innerHTML = html;

    function read() {
      var n = { ds: MD.$('ex-ds').value };
      if (n.ds !== c.ds) { var dd = DS[n.ds]; return { ds: n.ds, metrics: dd.defaults.metrics, dim: dd.defaults.dim, dim2: '', grain: '', chart: 'bar', human: true, model: 'LAST_NON_DIRECT_CLICK', limit: 25 }; }
      n.metrics = Array.prototype.map.call(el.querySelectorAll('.ex-checks input:checked'), function (i) { return i.value; });
      n.dim = MD.$('ex-dim').value; n.dim2 = MD.$('ex-dim2').value; if (n.dim2 === n.dim) n.dim2 = '';
      n.grain = MD.$('ex-grain') ? MD.$('ex-grain').value : '';
      n.model = MD.$('ex-model') ? MD.$('ex-model').value : c.model;
      n.chart = MD.$('ex-chart').value; n.limit = +MD.$('ex-limit').value;
      n.human = MD.$('ex-human') ? MD.$('ex-human').checked : true;
      n.filterDim = MD.$('ex-fdim').value; n.filterVal = MD.$('ex-fval').value.trim();
      return n;
    }
    function rerun(n) { save(n); MD.rerender(); }
    MD.$('ex-run').addEventListener('click', function () { rerun(read()); });
    MD.$('ex-ds').addEventListener('change', function () { rerun(read()); });
    ['ex-dim', 'ex-dim2', 'ex-grain', 'ex-model', 'ex-chart', 'ex-limit', 'ex-fdim'].forEach(function (id) { var x = MD.$(id); if (x) x.addEventListener('change', function () { rerun(read()); }); });
    Array.prototype.forEach.call(el.querySelectorAll('.ex-checks input, #ex-human'), function (x) { x.addEventListener('change', function () { rerun(read()); }); });
    Array.prototype.forEach.call(el.querySelectorAll('[data-preset]'), function (b) { b.addEventListener('click', function () { rerun(Object.assign({ human: true, model: 'LAST_NON_DIRECT_CLICK', limit: 25, dim2: '', grain: '', filterDim: '', filterVal: '' }, PRESETS[+b.getAttribute('data-preset')].c)); }); });

    return MD.ql(B.q).then(function (rows) {
      if (!alive()) return;
      MD.$('ex-out').innerHTML = render(c, B, rows);
      MD.$('ex-csv').addEventListener('click', function () { csv(c, B, rows); });
    }).catch(function (e) { if (alive()) MD.$('ex-out').innerHTML = MD.err(e, 'this view') + '<p class="muted small">Some metric and dimension pairs are not allowed together in Shopify\'s data. Try removing the second dimension or a metric.</p>'; });
  };

  var PRESETS = [
    { name: 'Channel funnel', c: { ds: 'sessions', metrics: ['sessions', 'sessions_with_cart_additions', 'sessions_that_reached_checkout', 'sessions_that_completed_checkout'], dim: 'referring_channel', chart: 'bar' } },
    { name: 'Landing pages', c: { ds: 'sessions', metrics: ['sessions', 'bounce_rate', 'sessions_with_cart_additions', 'sessions_that_completed_checkout'], dim: 'landing_page_path', chart: 'table' } },
    { name: 'Device × channel', c: { ds: 'sessions', metrics: ['sessions'], dim: 'referring_channel', dim2: 'session_device_type', chart: 'pivot' } },
    { name: 'Weekday × hour', c: { ds: 'sessions', metrics: ['sessions_with_cart_additions'], dim: 'day_of_week', dim2: 'hour_of_day', chart: 'pivot', limit: 250 } },
    { name: 'Sales by product', c: { ds: 'sales', metrics: ['net_sales', 'quantity_ordered', 'orders'], dim: 'product_title', chart: 'bar' } },
    { name: 'Product × new/returning', c: { ds: 'sales', metrics: ['net_sales'], dim: 'product_title', dim2: 'new_or_returning_customer', chart: 'pivot', limit: 100 } },
    { name: 'Sales by state', c: { ds: 'sales', metrics: ['net_sales', 'orders', 'average_order_value'], dim: 'shipping_region', chart: 'bar' } },
    { name: 'Daily sales', c: { ds: 'sales', metrics: ['net_sales', 'orders'], dim: '', grain: 'day', chart: 'line' } },
    { name: 'Discount codes', c: { ds: 'sales', metrics: ['orders', 'discounts', 'net_sales'], dim: 'discount_code', chart: 'table' } },
    { name: 'Campaigns (first vs last)', c: { ds: 'attribution', metrics: ['orders', 'net_sales', 'new_customers'], dim: 'utm_campaign', model: 'FIRST_CLICK', chart: 'bar' } },
    { name: 'Stock cover', c: { ds: 'inventory', metrics: ['ending_inventory_units', 'inventory_units_sold', 'days_of_inventory_remaining'], dim: 'product_title', chart: 'table', limit: 100 } }
  ];

  function render(c, B, rows) {
    var ds = c.ds, dims = B.dims, grain = DS[ds].noTime ? '' : c.grain;
    if (!rows.length) return MD.empty('No data for this view in the selected period.');
    var cols = [];
    if (grain) cols.push({ label: grain.charAt(0).toUpperCase() + grain.slice(1), get: function (r) { return String(r[grain]).slice(0, grain === 'month' ? 7 : 10); } });
    dims.forEach(function (k) { cols.push({ label: dimLabel(ds, k), get: function (r) { return dimVal(k, r[k]); } }); });
    B.metrics.forEach(function (m, i) {
      var col = B.col(m), max = Math.max.apply(null, rows.map(function (r) { return Math.abs(r[col] || 0); }).concat([1]));
      cols.push({ label: mInfo(ds, m)[1], n: 1, html: 1, get: function (r) { return fmtM(ds, m, r[col]) + (i === 0 && !grain ? MD.bar(Math.abs(r[col] || 0), max) : ''); } });
    });
    var chart = '';
    var m0 = B.metrics[0], c0 = B.col(m0);
    if (c.chart === 'pivot' && dims.length === 2) chart = pivot(ds, rows, dims, c0, m0);
    else if (c.chart !== 'table') {
      if (grain) {
        var times = uniq(rows.map(function (r) { return String(r[grain]).slice(0, 10); }));
        var series;
        if (dims.length) {
          var totals = {}; rows.forEach(function (r) { var k = dimVal(dims[0], r[dims[0]]); totals[k] = (totals[k] || 0) + (r[c0] || 0); });
          var top = Object.keys(totals).sort(function (a, b) { return totals[b] - totals[a]; }).slice(0, 6);
          series = top.map(function (k, i) { return { name: k, type: c.chart === 'line' ? 'line' : 'bar', color: COLORS[i % COLORS.length], values: times.map(function (t) { return sum(rows.filter(function (r) { return String(r[grain]).slice(0, 10) === t && dimVal(dims[0], r[dims[0]]) === k; }), function (r) { return r[c0]; }); }), fmt: function (v) { return fmtM(ds, m0, v); }, money: mInfo(ds, m0)[2] === 'money', pct: mInfo(ds, m0)[2] === 'pct' }; });
        } else {
          series = B.metrics.slice(0, 3).map(function (m, i) { var col = B.col(m), t = mInfo(ds, m)[2]; return { name: mInfo(ds, m)[1], type: c.chart === 'bar' && i === 0 ? 'bar' : 'line', color: COLORS[i], axis: i ? 'right' : 'left', values: times.map(function (tt) { return sum(rows.filter(function (r) { return String(r[grain]).slice(0, 10) === tt; }), function (r) { return r[col]; }); }), fmt: function (v) { return fmtM(ds, m, v); }, money: t === 'money', pct: t === 'pct' }; });
        }
        chart = c.chart === 'stack' ? stacked(times, series) : MD.chart(times, series, { xfmt: grain === 'month' ? function (x) { return F.month(x.slice(0, 7)); } : F.date });
      } else if (dims.length) {
        var top2 = rows.slice(0, 20), labels = top2.map(function (r) { return dims.map(function (k) { return dimVal(k, r[k]); }).join(' · '); });
        chart = hbars(labels, B.metrics.slice(0, c.chart === 'stack' ? 4 : 2).map(function (m, i) { var col = B.col(m); return { name: mInfo(ds, m)[1], color: COLORS[i], values: top2.map(function (r) { return r[col] || 0; }), fmt: function (v) { return fmtM(ds, m, v); } }; }), c.chart === 'stack');
      } else {
        chart = '<div class="kpis">' + B.metrics.map(function (m) { return MD.kpi({ label: mInfo(ds, m)[1], value: fmtM(ds, m, rows[0][B.col(m)]) }); }).join('') + '</div>';
      }
    }
    return chart + '<div style="margin-top:12px">' + MD.table(cols, rows) + '</div><p class="muted small">' + rows.length + ' rows' + (DS[ds].human && c.human ? ' · bots removed' : '') + (DS[ds].model ? ' · ' + MODELS.filter(function (x) { return x[0] === c.model; })[0][1] + ' attribution' : '') + '</p>';
  }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }).sort(); }

  /* Horizontal bars, optionally stacked. */
  function hbars(labels, series, stacked) {
    var rowH = 26, W = 720, lw = 200, H = labels.length * rowH + 30;
    var max = Math.max.apply(null, labels.map(function (_, i) { return stacked ? sum(series, function (s) { return s.values[i]; }) : Math.max.apply(null, series.map(function (s) { return s.values[i]; })); }).concat([1]));
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '">';
    labels.forEach(function (l, i) {
      var y = 6 + i * rowH, x = lw;
      s += '<text x="' + (lw - 6) + '" y="' + (y + 13) + '" text-anchor="end" class="axl">' + esc(String(l).slice(0, 34)) + '</text>';
      series.forEach(function (se, j) {
        var w = (W - lw - 60) * (se.values[i] || 0) / max;
        var h = stacked ? rowH - 6 : (rowH - 6) / series.length, yy = stacked ? y : y + j * h;
        s += '<rect x="' + x + '" y="' + yy + '" width="' + Math.max(0, w) + '" height="' + h + '" fill="' + se.color + '" rx="2"><title>' + esc(l + ' · ' + se.name + ': ' + se.fmt(se.values[i])) + '</title></rect>';
        if (stacked) x += w; else if (j === 0) s += '<text x="' + (x + w + 4) + '" y="' + (y + 13) + '" class="axl">' + esc(se.fmt(se.values[i])) + '</text>';
      });
    });
    s += '</svg><div class="legend">' + series.map(function (q) { return '<span><i style="background:' + q.color + '"></i>' + esc(q.name) + '</span>'; }).join('') + '</div>';
    return s;
  }

  function stacked(times, series) {
    var totals = times.map(function (_, i) { return sum(series, function (s) { return s.values[i]; }); });
    var W = 720, H = 240, pl = 50, pb = 26, pt = 10, iw = W - pl - 10, ih = H - pt - pb, max = Math.max.apply(null, totals.concat([1])), bw = Math.max(3, iw / times.length * 0.7);
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '">';
    for (var g = 0; g <= 4; g++) { var gy = pt + ih * g / 4; s += '<line x1="' + pl + '" x2="' + (W - 10) + '" y1="' + gy + '" y2="' + gy + '" class="grid"/><text x="' + (pl - 6) + '" y="' + (gy + 4) + '" class="ax" text-anchor="end">' + F.num(max * (1 - g / 4)) + '</text>'; }
    times.forEach(function (t, i) {
      var x = pl + iw * (i + 0.5) / times.length - bw / 2, y = pt + ih;
      series.forEach(function (se) { var h = ih * (se.values[i] || 0) / max; y -= h; s += '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + h + '" fill="' + se.color + '"><title>' + esc(t + ' · ' + se.name + ': ' + se.fmt(se.values[i])) + '</title></rect>'; });
      if (i % Math.ceil(times.length / 8) === 0) s += '<text x="' + (x + bw / 2) + '" y="' + (H - 8) + '" class="ax" text-anchor="middle">' + esc(F.date(t)) + '</text>';
    });
    return s + '</svg><div class="legend">' + series.map(function (q) { return '<span><i style="background:' + q.color + '"></i>' + esc(q.name) + '</span>'; }).join('') + '</div>';
  }

  function pivot(ds, rows, dims, col, m) {
    var rk = uniq(rows.map(function (r) { return dimVal(dims[0], r[dims[0]]); })), ck = uniq(rows.map(function (r) { return dimVal(dims[1], r[dims[1]]); }));
    if (dims[1] === 'hour_of_day') ck.sort(function (a, b) { return +a - +b; });
    if (dims[0] === 'day_of_week') rk = DOW.filter(function (d) { return rk.indexOf(d) >= 0; });
    var cell = {}, max = 0;
    rows.forEach(function (r) { var k = dimVal(dims[0], r[dims[0]]) + '|' + dimVal(dims[1], r[dims[1]]); cell[k] = (cell[k] || 0) + (r[col] || 0); max = Math.max(max, cell[k]); });
    var rowTot = {}; rk.forEach(function (a) { rowTot[a] = sum(ck, function (b) { return cell[a + '|' + b] || 0; }); });
    rk.sort(function (a, b) { return dims[0] === 'day_of_week' ? 0 : rowTot[b] - rowTot[a]; });
    return '<div class="scroll"><table class="heatmap"><thead><tr><th>' + esc(dimLabel(ds, dims[0])) + ' \\ ' + esc(dimLabel(ds, dims[1])) + '</th>' + ck.map(function (b) { return '<th class="n">' + esc(b) + '</th>'; }).join('') + '<th class="n">Total</th></tr></thead><tbody>' +
      rk.slice(0, 40).map(function (a) {
        return '<tr><th>' + esc(a) + '</th>' + ck.map(function (b) { var v = cell[a + '|' + b] || 0, t = max ? v / max : 0; return '<td class="hm" style="background:rgba(18,18,18,' + (t * 0.85).toFixed(2) + ');color:' + (t > 0.45 ? '#fff' : '#333') + '" title="' + esc(a + ' · ' + b + ': ' + fmtM(ds, m, v)) + '">' + (v ? fmtM(ds, m, v) : '') + '</td>'; }).join('') + '<td class="n"><b>' + fmtM(ds, m, rowTot[a]) + '</b></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function csv(c, B, rows) {
    var grain = DS[c.ds].noTime ? '' : c.grain, keys = (grain ? [grain] : []).concat(B.dims).concat(B.metrics.map(B.col));
    var text = keys.join(',') + '\n' + rows.map(function (r) { return keys.map(function (k) { var v = r[k] == null ? '' : String(r[k]); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\n');
    try {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
      a.download = 'monday-dashboard-' + c.ds + '-' + MD.today() + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) {
      try { navigator.clipboard.writeText(text); MD.toast('CSV copied to clipboard'); } catch (e2) { MD.toast('Could not export', true); }
    }
  }

  /* ================= Today ================= */
  MD.views.today = function (el, p, alive) {
    el.innerHTML = '<div class="loading">Loading today…</div>';
    var t = MD.today(), lw = MD.addDays(t, -7);
    var S = 'sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout';
    function hourly(ds, metrics, day, human) { return safe(MD.ql('FROM ' + ds + ' SHOW ' + metrics + (human ? " WHERE human_or_bot_session = 'human'" : '') + ' TIMESERIES hour SINCE ' + day + ' UNTIL ' + day)); }
    return Promise.all([hourly('sessions', S, t, true), hourly('sessions', S, lw, true), hourly('sales', 'orders, net_sales', t), hourly('sales', 'orders, net_sales', lw),
      safe(MD.ql("FROM sessions SHOW sessions, sessions_that_completed_checkout WHERE human_or_bot_session = 'human' GROUP BY landing_page_path SINCE " + t + ' UNTIL ' + t + ' ORDER BY sessions DESC LIMIT 10')),
      safe(MD.ql("FROM sessions SHOW sessions, sessions_that_completed_checkout WHERE human_or_bot_session = 'human' GROUP BY referring_channel SINCE " + t + ' UNTIL ' + t + ' ORDER BY sessions DESC LIMIT 10'))
    ]).then(function (r) {
      if (!alive()) return;
      function byHour(res, key) {
        var out = Array.from({ length: 24 }, function () { return 0; });
        if (res.ok) res.v.forEach(function (x) { var h = +new Intl.DateTimeFormat('en-GB', { timeZone: MD.shop.tz, hour: '2-digit', hour12: false }).format(new Date(x.hour)) % 24; out[h] += x[key] || 0; });
        return out;
      }
      var nowH = +new Intl.DateTimeFormat('en-GB', { timeZone: MD.shop.tz, hour: '2-digit', hour12: false }).format(new Date()) % 24;
      function upto(a) { return sum(a.slice(0, nowH + 1), function (x) { return x; }); }
      var sT = byHour(r[0], 'sessions'), sL = byHour(r[1], 'sessions'), cT = byHour(r[0], 'sessions_with_cart_additions'), kT = byHour(r[0], 'sessions_that_reached_checkout');
      var oT = byHour(r[2], 'orders'), oL = byHour(r[3], 'orders'), nT = byHour(r[2], 'net_sales'), nL = byHour(r[3], 'net_sales');
      var html = '<div class="card"><div class="row sb"><h2>Today, hour by hour</h2><span class="muted small">Compared with the same hours last ' + new Date(lw + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' }) + ' · updated ' + new Date().toLocaleTimeString('en-IN', { timeZone: MD.shop.tz, hour: '2-digit', minute: '2-digit' }) + '</span></div><div class="kpis">' +
        MD.kpi({ label: 'Sessions so far', value: F.num(upto(sT)), delta: F.delta(upto(sT), upto(sL)) }) +
        MD.kpi({ label: 'Added to cart', value: F.num(upto(cT)), sub: F.pct(F.ratio(upto(cT), upto(sT))) + ' of sessions' }) +
        MD.kpi({ label: 'Reached checkout', value: F.num(upto(kT)) }) +
        MD.kpi({ label: 'Orders so far', value: F.num(upto(oT)), delta: F.delta(upto(oT), upto(oL)), hi: true }) +
        MD.kpi({ label: 'Net sales so far', value: F.money(upto(nT)), delta: F.delta(upto(nT), upto(nL)) }) +
        MD.kpi({ label: 'Conversion so far', value: F.pct(F.ratio(upto(oT), upto(sT))) }) + '</div>';
      var hrs = Array.from({ length: 24 }, function (_, h) { return String(h); });
      html += MD.chart(hrs, [
        { name: 'Sessions today', type: 'bar', color: '#121212', values: sT.map(function (v, h) { return h <= nowH ? v : null; }), fmt: F.num },
        { name: 'Same hour last week', color: '#9aa0a6', dash: true, values: sL, fmt: F.num },
        { name: 'Orders today', color: '#C6FF00', axis: 'right', values: oT.map(function (v, h) { return h <= nowH ? v : null; }), fmt: F.num }
      ], { xfmt: function (h) { return h + ':00'; } }) + '</div>';
      function mini(res, k, label) { return res.ok ? MD.table([{ label: label, get: function (x) { return x[k] || '(none)'; } }, { label: 'Sessions', n: 1, get: function (x) { return F.num(x.sessions); } }, { label: 'Bought', n: 1, get: function (x) { return F.num(x.sessions_that_completed_checkout); } }], res.v, { empty: 'No sessions yet today.' }) : MD.err(res.e, label); }
      html += '<div class="cols"><div class="card"><h2>Where today\'s visitors landed</h2>' + mini(r[4], 'landing_page_path', 'Landing page') + '</div><div class="card"><h2>Where they came from</h2>' + mini(r[5], 'referring_channel', 'Channel') + '</div></div>';
      el.innerHTML = html;
    });
  };
})(window.MD = window.MD || {});
