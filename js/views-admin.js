/* Monday Dashboard · Ad spend log and Settings. */
(function (MD) {
  'use strict';
  var F = MD.fmt, esc = F.esc;
  MD.views = MD.views || {};

  /* ================= Ad spend ================= */
  MD.views.spend = function (el, p) {
    var S = MD.settings, rows = MD.state.spend.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : a.platform.localeCompare(b.platform); });
    var inP = MD.spendIn(p.from, p.to);
    var byPlat = MD.groupBy(inP, function (r) { return r.platform; });

    var html = '';
    if (MD.storeError) html += MD.err(MD.storeError, 'saved ad spend');
    html += '<div class="card"><h2>Ad spend</h2><p class="sub">Shopify does not know what you spend on ads. Enter each platform\'s daily numbers here (or paste them from Ads Manager and Google Ads). Every view uses them for MER, CAC and contribution after ads. Platform purchases and revenue are what the platform claims, kept next to what Shopify saw.</p>';
    html += '<div class="kpis">' + Object.keys(byPlat).map(function (k) {
      var list = byPlat[k], sp = MD.sum(list, function (r) { return r.spend; }), rev = MD.sum(list, function (r) { return r.revenue; });
      return MD.kpi({ label: k + ' · ' + p.label.toLowerCase(), value: F.money(sp), sub: rev ? 'platform ROAS ' + F.x(rev / sp) : list.length + ' days entered' });
    }).join('') + MD.kpi({ label: 'Total spend · ' + p.label.toLowerCase(), value: F.money(MD.sum(inP, function (r) { return r.spend; })), sub: inP.length + ' entries', hi: true }) + '</div>';

    var missing = MD.dayList(p.from, p.to).filter(function (d) { return d < MD.today() && !inP.some(function (r) { return r.date === d; }); });
    if (missing.length && missing.length < p.days) html += '<div style="margin-top:10px">' + MD.note('<strong>' + missing.length + ' days in this period have no spend entered</strong>MER and CAC for those days treat spend as zero: ' + missing.slice(0, 8).map(F.date).join(', ') + (missing.length > 8 ? ' and more' : '') + '.', 'warn') + '</div>';
    html += '</div>';

    html += '<div class="cols"><div class="card"><h2>Add one day</h2><div class="form" id="sp-form">' +
      '<label>Date<input type="date" name="date" value="' + MD.addDays(MD.today(), -1) + '"></label>' +
      '<label>Platform<select name="platform">' + S.platforms.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('') + '</select></label>' +
      '<label>Spend (' + MD.shop.currency + ')<input type="number" step="0.01" name="spend" required></label>' +
      '<label>Impressions<input type="number" name="impressions"></label>' +
      '<label>Clicks<small>Link / outbound clicks</small><input type="number" name="clicks"></label>' +
      '<label>Platform purchases<input type="number" step="0.01" name="purchases"></label>' +
      '<label>Platform revenue<input type="number" step="0.01" name="revenue"></label>' +
      '<label>Attribution window<small>e.g. 7-day click, 1-day view</small><input type="text" name="window" placeholder="7-day click + 1-day view"></label>' +
      '</div><div class="row" style="margin-top:12px"><button class="btn btn--primary" id="sp-save" type="button">Save day</button><span class="muted" id="sp-msg"></span></div></div>';

    html += '<div class="card"><h2>Paste many days</h2><p class="sub">One row per day and platform, comma or tab separated, with a header row. Columns: <code>date, platform, spend, impressions, clicks, purchases, revenue, window</code>. Only date, platform and spend are required. Existing days are updated.</p>' +
      '<textarea id="sp-csv" placeholder="date,platform,spend,impressions,clicks,purchases,revenue,window&#10;2026-09-24,Meta,4500,52000,610,9,8971,7-day click + 1-day view&#10;2026-09-24,Google,2100,,380,4,3990,DDA"></textarea>' +
      '<div class="row" style="margin-top:10px"><button class="btn btn--primary" id="sp-import" type="button">Import</button><span class="muted" id="sp-imsg"></span></div></div></div>';

    html += '<div class="card"><h2>Entries</h2>' + MD.table([
      { label: 'Date', get: function (r) { return F.date(r.date); } },
      { label: 'Platform', key: 'platform' },
      { label: 'Spend', n: 1, get: function (r) { return F.money(r.spend); } },
      { label: 'Impr.', n: 1, get: function (r) { return r.impressions == null ? '' : F.num(r.impressions); } },
      { label: 'Clicks', n: 1, get: function (r) { return r.clicks == null ? '' : F.num(r.clicks); } },
      { label: 'CPC', n: 1, get: function (r) { return r.clicks ? F.money2(r.spend / r.clicks) : ''; } },
      { label: 'Platform purchases', n: 1, get: function (r) { return r.purchases == null ? '' : F.dec(r.purchases); } },
      { label: 'Platform revenue', n: 1, get: function (r) { return r.revenue == null ? '' : F.money(r.revenue); } },
      { label: 'Platform ROAS', n: 1, get: function (r) { return r.revenue && r.spend ? F.x(r.revenue / r.spend) : ''; } },
      { label: 'Window', get: function (r) { return r.window || ''; } },
      { label: '', html: 1, get: function (r) { return '<button class="btn" data-del="' + esc(r.id) + '" type="button">Delete</button>'; } }
    ], rows.slice(0, 400), { empty: 'No ad spend entered yet.' }) + '</div>';

    el.innerHTML = html;

    MD.$('sp-save').addEventListener('click', function () {
      var f = {}; Array.prototype.forEach.call(MD.$('sp-form').querySelectorAll('[name]'), function (i) { f[i.name] = i.value; });
      if (!f.date || !f.platform || f.spend === '') { MD.$('sp-msg').textContent = 'Date, platform and spend are required.'; return; }
      var row = { date: f.date, platform: f.platform, spend: parseFloat(f.spend), impressions: num(f.impressions), clicks: num(f.clicks), purchases: num(f.purchases), revenue: num(f.revenue), window: f.window };
      this.disabled = true;
      save([row]).then(function () { MD.toast('Saved'); MD.rerender(); }).catch(function (e) { MD.$('sp-msg').textContent = e.message; MD.$('sp-save').disabled = false; });
    });
    MD.$('sp-import').addEventListener('click', function () {
      var parsed = parseCsv(MD.$('sp-csv').value);
      if (parsed.error) { MD.$('sp-imsg').textContent = parsed.error; return; }
      var btn = this; btn.disabled = true;
      MD.$('sp-imsg').textContent = 'Saving ' + parsed.rows.length + ' rows…';
      save(parsed.rows, function (n) { MD.$('sp-imsg').textContent = 'Saved ' + n + ' of ' + parsed.rows.length + '…'; })
        .then(function () { MD.toast('Imported ' + parsed.rows.length + ' rows'); MD.rerender(); })
        .catch(function (e) { MD.$('sp-imsg').textContent = e.message; btn.disabled = false; });
    });
    Array.prototype.forEach.call(el.querySelectorAll('[data-del]'), function (b) {
      b.addEventListener('click', function () {
        b.disabled = true;
        MD.store.deleteSpend(b.getAttribute('data-del')).then(function () {
          MD.state.spend = MD.state.spend.filter(function (r) { return r.id !== b.getAttribute('data-del'); });
          MD.rerender();
        });
      });
    });
    return Promise.resolve();
  };

  function num(v) { return v === '' || v == null ? null : parseFloat(String(v).replace(/[,₹\s]/g, '')); }

  function save(rows, onEach) {
    var i = 0;
    function next() {
      if (i >= rows.length) return MD.store.loadSpend().then(function (all) { MD.state.spend = all; });
      var r = rows[i++];
      return MD.store.saveSpend(r).then(function () { if (onEach) onEach(i); return next(); });
    }
    return next();
  }

  function parseCsv(text) {
    var lines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (lines.length < 2) return { error: 'Paste a header row and at least one data row.' };
    var sep = lines[0].indexOf('\t') >= 0 ? '\t' : ',';
    var head = lines[0].split(sep).map(function (h) { return h.trim().toLowerCase(); });
    var need = ['date', 'platform', 'spend'];
    for (var k = 0; k < need.length; k++) if (head.indexOf(need[k]) < 0) return { error: 'Missing column: ' + need[k] };
    var rows = [];
    for (var i = 1; i < lines.length; i++) {
      var c = splitRow(lines[i], sep), o = {};
      head.forEach(function (h, j) { o[h] = (c[j] || '').trim(); });
      var d = normDate(o.date);
      if (!d) return { error: 'Row ' + (i + 1) + ': date must look like 2026-09-24 or 24/09/2026.' };
      if (!o.platform) return { error: 'Row ' + (i + 1) + ': platform is empty.' };
      var sp = num(o.spend); if (sp == null || isNaN(sp)) return { error: 'Row ' + (i + 1) + ': spend is not a number.' };
      rows.push({ date: d, platform: o.platform, spend: sp, impressions: num(o.impressions), clicks: num(o.clicks), purchases: num(o.purchases), revenue: num(o.revenue), window: o.window || '' });
    }
    return { rows: rows };
  }
  function splitRow(line, sep) {
    if (sep === '\t') return line.split('\t');
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur); return out;
  }
  function normDate(s) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
    if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    return null;
  }

  /* ================= Settings ================= */
  var FIELDS = [
    ['cogsFallbackPct', 'COGS when a variant has no cost', 'Share of net price. Enter real costs per variant in Shopify for accuracy.', 'pct'],
    ['packagingPerOrder', 'Packaging per order', 'Box, filler, tape, insert.', 'money'],
    ['shipCostPerOrder', 'Forward shipping cost per order', 'What the courier charges you on average.', 'money'],
    ['rtoReverseCost', 'Return-to-origin shipping cost', 'Extra cost when a parcel comes back.', 'money'],
    ['gatewayPct', 'Payment gateway fee (prepaid)', 'Share of order value.', 'pct'],
    ['codFeePerOrder', 'COD collection fee per order', 'Courier COD charge.', 'money'],
    ['codRtoRate', 'Expected COD RTO rate', 'Used for orders not yet delivered.', 'pct'],
    ['prepaidRtoRate', 'Expected prepaid RTO rate', 'Used for orders not yet delivered.', 'pct'],
    ['returnRate', 'Expected return rate after delivery', 'Half the item value is counted as lost.', 'pct'],
    ['codShareEstimate', 'COD share of orders (for monthly report)', 'Monthly figures come from Shopify Analytics, which does not split COD.', 'pct'],
    ['repeatReachCost', 'Cost to win a repeat order', 'WhatsApp or email cost per repeat purchase.', 'money'],
    ['gstRate', 'GST rate on shipping', 'Used to take GST out of shipping charged.', 'pct'],
    ['divergenceAlarm', 'Tracking alarm threshold', 'Flag days when platform purchases differ from Shopify orders by more than this.', 'pct'],
    ['targetMer', 'Target MER', 'Revenue ex GST ÷ ad spend.', 'x'],
    ['targetCac', 'Target new-customer CAC', 'Acquisition spend ÷ new customers.', 'money']
  ];

  MD.views.settings = function (el) {
    var S = MD.settings;
    var html = '<div class="card"><h2>Setup checklist</h2><p class="sub">What the dashboard can read right now.</p><div id="checks"><div class="loading">Checking…</div></div></div>';
    html += '<div class="card"><h2>Cost assumptions and targets</h2><p class="sub">Used for contribution, break-even CAC and RTO losses. Saved in the store, shared by everyone who opens the app.</p><div class="form" id="set-form">' +
      FIELDS.map(function (f) {
        var v = S[f[0]];
        var shown = f[3] === 'pct' ? Math.round(v * 1000) / 10 : v;
        return '<label>' + esc(f[1]) + (f[3] === 'pct' ? ' (%)' : f[3] === 'money' ? ' (' + MD.shop.currency + ')' : '') + '<small>' + esc(f[2]) + '</small><input type="number" step="0.01" name="' + f[0] + '" data-kind="' + f[3] + '" value="' + shown + '"></label>';
      }).join('') +
      '<label>Ad platforms<small>Comma separated</small><input type="text" name="platforms" value="' + esc(S.platforms.join(', ')) + '"></label>' +
      '<label>COD gateway names<small>Pattern that marks an order as COD</small><input type="text" name="codPattern" value="' + esc(S.codPattern) + '"></label>' +
      '</div><div class="row" style="margin-top:12px"><button class="btn btn--primary" id="set-save" type="button">Save settings</button><button class="btn" id="set-reset" type="button">Reset to defaults</button><span class="muted" id="set-msg"></span></div></div>';
    html += '<div class="card"><h2>Definitions</h2><p class="sub">The numbers this dashboard uses. Name the version whenever you quote one.</p>' + MD.DEFINITIONS + '</div>';
    el.innerHTML = html;

    MD.$('set-save').addEventListener('click', function () {
      var next = Object.assign({}, MD.settings);
      Array.prototype.forEach.call(MD.$('set-form').querySelectorAll('[name]'), function (i) {
        var k = i.name, kind = i.getAttribute('data-kind');
        if (k === 'platforms') next.platforms = i.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        else if (k === 'codPattern') next.codPattern = i.value || MD.DEFAULT_SETTINGS.codPattern;
        else { var v = parseFloat(i.value); if (!isNaN(v)) next[k] = kind === 'pct' ? v / 100 : v; }
      });
      try { new RegExp(next.codPattern, 'i'); } catch (e) { MD.$('set-msg').textContent = 'COD pattern is not valid.'; return; }
      this.disabled = true;
      var btn = this;
      MD.store.saveSettings(next).then(function () { MD.settings = next; MD.clearOrderCache(); MD.toast('Settings saved'); btn.disabled = false; MD.$('set-msg').textContent = 'Saved.'; })
        .catch(function (e) { MD.$('set-msg').textContent = e.message; btn.disabled = false; });
    });
    MD.$('set-reset').addEventListener('click', function () { MD.settings = JSON.parse(JSON.stringify(MD.DEFAULT_SETTINGS)); MD.rerender(); });

    return runChecks().then(function (items) {
      MD.$('checks').innerHTML = items.map(function (c) { return '<div class="alert a-' + (c.ok ? 'ok' : c.warn ? 'warn' : 'bad') + '"><div><strong>' + esc(c.label) + '</strong>' + c.text + '</div></div>'; }).join('');
    });
  };

  function runChecks() {
    var t = MD.today();
    var checks = [
      MD.ql('FROM sales SHOW orders SINCE -7d UNTIL today').then(function () { return { ok: true, label: 'Shopify analytics (ShopifyQL)', text: 'Sales, sessions and funnel reports load.' }; })
        .catch(function (e) { return { label: 'Shopify analytics (ShopifyQL) is blocked', text: esc(e.message) + '. In the Dev Dashboard, open Monday Dashboard → API access → Protected customer data, select the reasons and the name, email, phone and address fields, and save. Then reopen the app.' }; }),
      MD.gql('{ orders(first: 1) { nodes { id customer { id } customerJourneySummary { firstVisit { source } } } } }').then(function () { return { ok: true, label: 'Orders and customer journeys', text: 'Order, COD, fulfilment and first/last visit data load.' }; })
        .catch(function (e) { return { label: 'Orders are blocked', text: esc(e.message) }; }),
      MD.gql('{ products(first: 50) { nodes { variants(first: 5) { nodes { inventoryItem { unitCost { amount } } } } } } }').then(function (d) {
        var v = [], k = 0; d.products.nodes.forEach(function (p) { p.variants.nodes.forEach(function (x) { v.push(x); if (x.inventoryItem && x.inventoryItem.unitCost) k++; }); });
        var share = v.length ? k / v.length : 0;
        return { ok: share > 0.9, warn: share <= 0.9, label: 'Product costs: ' + F.pct(share) + ' of variants have a cost', text: share > 0.9 ? 'Margins use real costs.' : 'Variants without a cost use the fallback COGS % below. Add "Cost per item" to each variant in Shopify for true margins.' };
      }).catch(function (e) { return { label: 'Product costs could not be read', text: esc(e.message) }; }),
      Promise.resolve(MD.state.spend).then(function (s) {
        var recent = s.filter(function (r) { return r.date >= MD.addDays(t, -7); });
        return recent.length ? { ok: true, label: 'Ad spend is up to date', text: recent.length + ' entries in the last 7 days.' } : { warn: true, label: 'No ad spend in the last 7 days', text: 'MER, CAC and contribution after ads need it. Add it in the Ad spend tab.' };
      })
    ];
    return Promise.all(checks);
  }

  MD.DEFINITIONS = '<dl class="def">' + [
    ['Orders', 'Shopify orders placed in the period, test orders excluded. Cancelled orders are counted separately and left out of revenue.'],
    ['Net merchandise revenue', 'Product sales after discounts, excluding GST and shipping charged. "Booked" is as placed; "retained" is after items were removed or returned.'],
    ['Cash collected', 'Money actually received: prepaid captures plus COD remitted. A finance number, not orders placed.'],
    ['AOV (merchandise)', 'Net merchandise revenue ÷ orders (not cancelled). Shopify\'s own AOV can include shipping and tax, so the two differ.'],
    ['New-customer CAC', 'Ad spend ÷ new customers (customers whose first ever order falls in the period). Not spend ÷ all orders.'],
    ['MER (blended ROAS)', 'Net merchandise revenue ÷ total ad spend, shown on booked and on delivered revenue.'],
    ['Contribution after marketing', 'Revenue ex GST − COGS − shipping cost net of shipping charged − packaging − gateway or COD fees − expected RTO and return losses − ad spend. Costs come from Settings.'],
    ['Realized revenue', 'Placed → paid → shipped → delivered → retained after refunds, as order counts and value.'],
    ['First click / last click', 'From Shopify\'s customer journey: the first and the last recorded visit before the order. Last non-direct uses the first visit when the last one was direct. Shopify stores only these two visits per order here, so "any click" and "linear" live in Shopify\'s own Marketing reports.'],
    ['Platform ROAS', 'Revenue the ad platform claims ÷ its spend, under its own attribution window. Meta + Google purchases is never the store\'s order count.'],
    ['Sessions and conversion rate', 'From Shopify Analytics. Shopify changed how sessions are measured on 21 to 23 Sep 2026, so session metrics may jump across that date even if shoppers did not change. Orders and sales are not affected.'],
    ['Dates', 'Every date is in the store time zone (' + esc(MD.shop.tz) + ') by order date. Ad platforms may report by click date; see the Attribution tab.']
  ].map(function (d) { return '<dt>' + esc(d[0]) + '</dt><dd>' + esc(d[1]) + '</dd>'; }).join('') + '</dl>';
})(window.MD = window.MD || {});
