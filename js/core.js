/* Monday Dashboard · core helpers: API, dates, formatting, charts, storage. */
(function (MD) {
  'use strict';

  var API = 'shopify:admin/api/2026-07/graphql.json';

  /* ---------------- API ---------------- */
  MD.gql = function (query, variables) {
    return fetch(API, { method: 'POST', body: JSON.stringify({ query: query, variables: variables || {} }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.errors && j.errors.length) {
          var e = new Error(j.errors.map(function (x) { return x.message; }).join('; '));
          e.graphql = j.errors;
          throw e;
        }
        return j.data;
      });
  };

  /* Run ShopifyQL and return rows as objects keyed by column name. */
  var qlCache = {};
  MD.ql = function (query) {
    if (qlCache[query]) return qlCache[query];
    var p = MD.gql('query ($q: String!) { shopifyqlQuery(query: $q) { tableData { columns { name dataType displayName } rows } parseErrors } }', { q: query })
      .then(function (d) {
        var r = d.shopifyqlQuery;
        if (r.parseErrors && r.parseErrors.length) throw new Error('ShopifyQL: ' + r.parseErrors.join('; '));
        var cols = r.tableData ? r.tableData.columns : [];
        var rows = r.tableData ? r.tableData.rows : [];
        return rows.map(function (row) {
          var o = {};
          cols.forEach(function (c, i) {
            var v = Array.isArray(row) ? row[i] : row[c.name];
            if (/INTEGER|MONEY|FLOAT|DECIMAL|PERCENT|NUMBER|DURATION/.test(c.dataType)) v = v == null || v === '' ? null : parseFloat(v);
            o[c.name] = v;
          });
          return o;
        });
      });
    qlCache[query] = p;
    p.catch(function () { delete qlCache[query]; });
    return p;
  };
  MD.clearCache = function () { qlCache = {}; };

  /* ---------------- shop ---------------- */
  MD.shop = { currency: 'INR', tz: 'Asia/Kolkata', taxesIncluded: true, name: '' };
  MD.loadShop = function () {
    return MD.gql('{ shop { name currencyCode ianaTimezone taxesIncluded myshopifyDomain } currentAppInstallation { id } }').then(function (d) {
      MD.shop = { name: d.shop.name, currency: d.shop.currencyCode, tz: d.shop.ianaTimezone || 'Asia/Kolkata', taxesIncluded: d.shop.taxesIncluded, domain: d.shop.myshopifyDomain, installId: d.currentAppInstallation.id };
      MD.fmt.init();
      return MD.shop;
    });
  };

  /* ---------------- dates (store time zone) ---------------- */
  function partsIn(tz, d) {
    var f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    return f.format(d); // YYYY-MM-DD
  }
  MD.today = function () { return partsIn(MD.shop.tz, new Date()); };
  MD.dayOf = function (iso) { return partsIn(MD.shop.tz, new Date(iso)); };
  MD.addDays = function (ymd, n) {
    var d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  MD.daysBetween = function (a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5); };
  MD.dayList = function (from, to) { var out = [], d = from; while (d <= to) { out.push(d); d = MD.addDays(d, 1); } return out; };
  MD.monthOf = function (ymd) { return ymd.slice(0, 7); };

  /* Period presets. Each returns {from, to, prevFrom, prevTo, label}. */
  MD.period = function (key) {
    var t = MD.today(), y = MD.addDays(t, -1), from, to, label;
    if (key === 'today') { from = t; to = t; label = 'Today'; }
    else if (key === 'yesterday') { from = y; to = y; label = 'Yesterday'; }
    else if (key === '7d') { from = MD.addDays(t, -6); to = t; label = 'Last 7 days'; }
    else if (key === '90d') { from = MD.addDays(t, -89); to = t; label = 'Last 90 days'; }
    else if (key === 'mtd') { from = t.slice(0, 8) + '01'; to = t; label = 'Month to date'; }
    else { from = MD.addDays(t, -29); to = t; label = 'Last 30 days'; }
    var len = MD.daysBetween(from, to) + 1;
    // Single days compare with the same weekday last week; ranges with the previous equal range.
    var shift = len === 1 ? 7 : len;
    return { key: key, from: from, to: to, prevFrom: MD.addDays(from, -shift), prevTo: MD.addDays(to, -shift), label: label, days: len, compareLabel: len === 1 ? 'same day last week' : 'previous ' + len + ' days' };
  };

  /* Shopify's session measurement change. Session-based metrics shift across it. */
  MD.SESSION_CHANGE = { from: '2026-09-21', to: '2026-09-23' };
  MD.crossesSessionChange = function (p) { return p.prevFrom <= MD.SESSION_CHANGE.to && p.to >= MD.SESSION_CHANGE.from; };

  /* ---------------- formatting ---------------- */
  var F = MD.fmt = {};
  F.init = function () {
    F._money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: MD.shop.currency, maximumFractionDigits: 0 });
    F._money2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: MD.shop.currency, maximumFractionDigits: 2 });
  };
  F.init();
  var num = new Intl.NumberFormat('en-IN');
  var num1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
  F.money = function (v) { return v == null || isNaN(v) ? '·' : F._money.format(v); };
  F.money2 = function (v) { return v == null || isNaN(v) ? '·' : F._money2.format(v); };
  F.num = function (v) { return v == null || isNaN(v) ? '·' : num.format(Math.round(v)); };
  F.dec = function (v) { return v == null || isNaN(v) ? '·' : num1.format(v); };
  F.pct = function (v) { return v == null || isNaN(v) || !isFinite(v) ? '·' : num1.format(v * 100) + '%'; };
  F.x = function (v) { return v == null || isNaN(v) || !isFinite(v) ? '·' : num1.format(v) + '×'; };
  F.date = function (ymd) { return ymd ? new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : ''; };
  F.month = function (ym) { return new Date(ym + '-01T00:00:00Z').toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' }); };
  F.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  F.ratio = function (a, b) { return b ? a / b : null; };
  F.delta = function (cur, prev, invert) {
    if (prev == null || cur == null || !isFinite(cur) || !isFinite(prev)) return '';
    if (prev === 0) return cur === 0 ? '<span class="d d0">no change</span>' : '<span class="d d0">new</span>';
    var ch = (cur - prev) / Math.abs(prev), good = invert ? ch < 0 : ch > 0;
    return '<span class="d ' + (Math.abs(ch) < 0.005 ? 'd0' : (good ? 'dup' : 'ddown')) + '">' + (ch > 0 ? '▲ ' : ch < 0 ? '▼ ' : '') + num1.format(Math.abs(ch) * 100) + '%</span>';
  };

  /* ---------------- small UI helpers ---------------- */
  var esc = F.esc;
  MD.$ = function (id) { return document.getElementById(id); };
  MD.kpi = function (o) {
    return '<div class="kpi' + (o.hi ? ' kpi--hi' : '') + '"' + (o.tip ? ' title="' + esc(o.tip) + '"' : '') + '><small>' + esc(o.label) + '</small><b>' + o.value + '</b>' +
      '<small class="kpi-sub">' + (o.delta || '') + (o.sub ? ' <span>' + o.sub + '</span>' : '') + '</small></div>';
  };
  MD.empty = function (msg) { return '<div class="empty">' + esc(msg) + '</div>'; };
  MD.err = function (e, what) {
    var m = e && e.message ? e.message : String(e);
    var hint = '';
    if (/access denied|not approved|protected customer data|ACCESS_DENIED/i.test(m)) hint = ' This needs protected customer data access for the app. See Settings → Setup checklist.';
    return '<div class="alert a-bad"><div><strong>Could not load ' + esc(what || 'data') + '</strong>' + esc(m) + hint + '</div></div>';
  };
  MD.table = function (cols, rows, opts) {
    opts = opts || {};
    if (!rows.length) return MD.empty(opts.empty || 'No data for this period.');
    var h = '<div class="scroll"><table><thead><tr>' + cols.map(function (c) { return '<th class="' + (c.n ? 'n' : '') + '">' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr' + (r._cls ? ' class="' + r._cls + '"' : '') + '>' + cols.map(function (c) {
        var v = c.get ? c.get(r) : r[c.key];
        return '<td class="' + (c.n ? 'n' : '') + '">' + (c.html ? v : esc(v)) + '</td>';
      }).join('') + '</tr>';
    });
    if (opts.total) h += '<tr class="total">' + cols.map(function (c) { var v = opts.total[c.key]; return '<td class="' + (c.n ? 'n' : '') + '">' + (v == null ? '' : (c.html ? v : esc(v))) + '</td>'; }).join('') + '</tr>';
    return h + '</tbody></table></div>';
  };
  MD.bar = function (v, max) { return '<div class="bar"><i style="width:' + (max ? Math.max(1.5, Math.min(100, v / max * 100)) : 0) + '%"></i></div>'; };
  MD.note = function (html, tone) { return '<div class="alert a-' + (tone || 'info') + '"><div>' + html + '</div></div>'; };

  /* ---------------- charts (inline SVG) ---------------- */
  /* series: [{name, values:[...], color, axis:'left'|'right', type:'line'|'bar', fmt}] labels: [...] */
  MD.chart = function (labels, series, opts) {
    opts = opts || {};
    var W = 720, H = opts.height || 220, pl = 56, pr = series.some(function (s) { return s.axis === 'right'; }) ? 56 : 14, pt = 12, pb = 26;
    var iw = W - pl - pr, ih = H - pt - pb, n = labels.length;
    if (!n) return MD.empty('No data.');
    function range(axis) {
      var vals = [];
      series.forEach(function (s) { if ((s.axis || 'left') === axis) s.values.forEach(function (v) { if (v != null && isFinite(v)) vals.push(v); }); });
      var max = Math.max.apply(null, vals.concat([0])), min = Math.min.apply(null, vals.concat([0]));
      if (max === min) max = min + 1;
      return { min: min, max: max * 1.08 };
    }
    var rl = range('left'), rr = range('right');
    function y(v, axis) { var r = axis === 'right' ? rr : rl; return pt + ih - (v - r.min) / (r.max - r.min) * ih; }
    function x(i) { return pl + (n === 1 ? iw / 2 : i * iw / (n - 1)); }
    var bw = Math.max(2, Math.min(28, iw / n * 0.6));
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(opts.title || 'Chart') + '">';
    for (var g = 0; g <= 4; g++) {
      var gy = pt + ih * g / 4, vL = rl.max - (rl.max - rl.min) * g / 4;
      s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + gy + '" y2="' + gy + '" class="grid"/>';
      s += '<text x="' + (pl - 6) + '" y="' + (gy + 4) + '" class="ax" text-anchor="end">' + esc(short(vL, series.filter(function (q) { return (q.axis || 'left') === 'left'; })[0])) + '</text>';
      if (pr > 20) { var vR = rr.max - (rr.max - rr.min) * g / 4; s += '<text x="' + (W - pr + 6) + '" y="' + (gy + 4) + '" class="ax">' + esc(short(vR, series.filter(function (q) { return q.axis === 'right'; })[0])) + '</text>'; }
    }
    if (opts.marker) {
      var mi = labels.indexOf(opts.marker.at);
      var right = x(mi) > W - pr - 110;
      if (mi >= 0) s += '<line x1="' + x(mi) + '" x2="' + x(mi) + '" y1="' + pt + '" y2="' + (pt + ih) + '" class="mark"/><text x="' + (x(mi) + (right ? -4 : 4)) + '" y="' + (pt + 10) + '" class="ax mk" text-anchor="' + (right ? 'end' : 'start') + '">' + esc(opts.marker.label) + '</text>';
    }
    var bars = series.filter(function (q) { return q.type === 'bar'; });
    bars.forEach(function (q, bi) {
      q.values.forEach(function (v, i) {
        if (v == null) return;
        var bx = x(i) - bw / 2 + (bars.length > 1 ? (bi - (bars.length - 1) / 2) * bw / bars.length : 0);
        var y0 = y(0, q.axis), y1 = y(v, q.axis);
        s += '<rect x="' + bx + '" y="' + Math.min(y0, y1) + '" width="' + (bw / bars.length) + '" height="' + Math.abs(y0 - y1) + '" fill="' + q.color + '" rx="2"><title>' + esc(labels[i] + ': ' + (q.fmt ? q.fmt(v) : v)) + '</title></rect>';
      });
    });
    series.filter(function (q) { return q.type !== 'bar'; }).forEach(function (q) {
      var d = '';
      q.values.forEach(function (v, i) { if (v == null) return; d += (d ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v, q.axis).toFixed(1); });
      s += '<path d="' + d + '" fill="none" stroke="' + q.color + '" stroke-width="2.2" ' + (q.dash ? 'stroke-dasharray="5 4"' : '') + '/>';
      q.values.forEach(function (v, i) { if (v == null) return; s += '<circle cx="' + x(i) + '" cy="' + y(v, q.axis) + '" r="' + (n > 40 ? 0 : 2.5) + '" fill="' + q.color + '"><title>' + esc(labels[i] + ': ' + (q.fmt ? q.fmt(v) : v)) + '</title></circle>'; });
    });
    var step = Math.ceil(n / 8);
    labels.forEach(function (l, i) {
      var last = i === n - 1;
      if (!(i % step === 0 || last)) return;
      if (last && i % step !== 0 && i % step < step / 2) return; // too close to the previous label
      s += '<text x="' + x(i) + '" y="' + (H - 8) + '" class="ax" text-anchor="' + (last && n > 1 ? 'end' : i === 0 && n > 1 ? 'start' : 'middle') + '">' + esc(opts.xfmt ? opts.xfmt(l) : l) + '</text>';
    });
    s += '</svg><div class="legend">' + series.map(function (q) { return '<span><i style="background:' + q.color + '"></i>' + esc(q.name) + (q.axis === 'right' ? ' (right)' : '') + '</span>'; }).join('') + '</div>';
    return s;
  };
  function short(v, s) {
    if (s && s.pct) return Math.round(v * 1000) / 10 + '%';
    var a = Math.abs(v);
    var t = a >= 1e7 ? (v / 1e7).toFixed(1) + 'Cr' : a >= 1e5 ? (v / 1e5).toFixed(1) + 'L' : a >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : (Math.round(v * 10) / 10).toString();
    return (s && s.money ? '₹' : '') + t;
  }

  /* Horizontal funnel: steps [{label, value}] */
  MD.funnel = function (steps) {
    var max = steps[0] ? steps[0].value : 0;
    return '<div class="funnel">' + steps.map(function (s, i) {
      var prev = i ? steps[i - 1].value : null;
      return '<div class="fstep"><div class="flabel">' + esc(s.label) + '</div><div class="fbar"><i style="width:' + (max ? Math.max(1, s.value / max * 100) : 0) + '%"></i><span>' + F.num(s.value) + (s.money != null ? ' · ' + F.money(s.money) : '') + '</span></div><div class="frate">' +
        (i ? F.pct(F.ratio(s.value, prev)) + ' of previous' : '') + (i && max ? ' · ' + F.pct(s.value / max) + ' of first' : '') + '</div></div>';
    }).join('') + '</div>';
  };

  /* ---------------- storage (app-owned metaobjects) ---------------- */
  MD.store = {};
  MD.store.loadSettings = function () {
    return MD.gql('{ metaobjects(type: "$app:settings", first: 1) { nodes { id handle field(key: "data") { jsonValue } } } }').then(function (d) {
      var n = d.metaobjects.nodes[0];
      MD.store.settingsId = n ? n.id : null;
      return n && n.field ? n.field.jsonValue : null;
    });
  };
  MD.store.saveSettings = function (data) {
    return MD.gql('mutation ($h: MetaobjectHandleInput!, $m: MetaobjectUpsertInput!) { metaobjectUpsert(handle: $h, metaobject: $m) { metaobject { id } userErrors { field message } } }',
      { h: { type: '$app:settings', handle: 'main' }, m: { fields: [{ key: 'data', value: JSON.stringify(data) }] } })
      .then(function (d) { var e = d.metaobjectUpsert.userErrors; if (e.length) throw new Error(e.map(function (x) { return x.message; }).join('; ')); return d; });
  };
  MD.store.loadSpend = function () {
    var all = [];
    function page(after) {
      return MD.gql('query ($a: String) { metaobjects(type: "$app:ad_spend", first: 250, after: $a) { pageInfo { hasNextPage endCursor } nodes { id handle fields { key value } } } }', { a: after || null }).then(function (d) {
        d.metaobjects.nodes.forEach(function (n) {
          var o = { id: n.id, handle: n.handle };
          n.fields.forEach(function (f) { o[f.key] = f.value; });
          ['spend', 'impressions', 'clicks', 'purchases', 'revenue'].forEach(function (k) { o[k] = o[k] == null || o[k] === '' ? null : parseFloat(o[k]); });
          all.push(o);
        });
        return d.metaobjects.pageInfo.hasNextPage ? page(d.metaobjects.pageInfo.endCursor) : all;
      });
    }
    return page();
  };
  MD.store.spendHandle = function (date, platform) { return ('s-' + date + '-' + platform).toLowerCase().replace(/[^a-z0-9-]+/g, '-'); };
  MD.store.saveSpend = function (row) {
    var fields = [
      { key: 'key', value: row.date + ' · ' + row.platform },
      { key: 'date', value: row.date },
      { key: 'platform', value: row.platform },
      { key: 'spend', value: String(row.spend || 0) }
    ];
    ['impressions', 'clicks'].forEach(function (k) { if (row[k] != null && row[k] !== '') fields.push({ key: k, value: String(Math.round(row[k])) }); });
    ['purchases', 'revenue'].forEach(function (k) { if (row[k] != null && row[k] !== '') fields.push({ key: k, value: String(row[k]) }); });
    if (row.window) fields.push({ key: 'window', value: row.window });
    return MD.gql('mutation ($h: MetaobjectHandleInput!, $m: MetaobjectUpsertInput!) { metaobjectUpsert(handle: $h, metaobject: $m) { metaobject { id } userErrors { field message } } }',
      { h: { type: '$app:ad_spend', handle: MD.store.spendHandle(row.date, row.platform) }, m: { fields: fields } })
      .then(function (d) { var e = d.metaobjectUpsert.userErrors; if (e.length) throw new Error(e.map(function (x) { return x.message; }).join('; ')); return d; });
  };
  MD.store.deleteSpend = function (id) {
    return MD.gql('mutation ($id: ID!) { metaobjectDelete(id: $id) { deletedId userErrors { message } } }', { id: id });
  };

  MD.toast = function (msg, isError) { try { shopify.toast.show(msg, { isError: !!isError }); } catch (e) { console.log(msg); } };
})(window.MD = window.MD || {});
