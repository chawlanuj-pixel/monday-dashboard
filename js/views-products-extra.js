/* Monday Dashboard · Products: winner-to-loser waterfall and products with no sign of attention. */
(function (MD) {
  'use strict';
  var F = MD.fmt, esc = F.esc, sum = MD.sum;
  function safe(p) { return p.then(function (v) { return { ok: true, v: v }; }, function (e) { return { ok: false, e: e }; }); }
  var base = MD.views.products;

  function loadCatalog() {
    var all = [];
    function page(after) {
      return MD.gql('query ($after: String) { products(first: 100, after: $after, query: "status:active") { pageInfo { hasNextPage endCursor } nodes { id title handle productType createdAt onlineStoreUrl totalInventory priceRangeV2 { minVariantPrice { amount } } } } }', { after: after || null }).then(function (d) {
        all = all.concat(d.products.nodes);
        return d.products.pageInfo.hasNextPage && all.length < 3000 ? page(d.products.pageInfo.endCursor) : all;
      });
    }
    return page();
  }

  MD.views.products = function (el, p, alive) {
    var r = 'SINCE ' + p.from + ' UNTIL ' + p.to;
    var extra = Promise.all([
      safe(MD.ql('FROM sales SHOW net_sales, quantity_ordered, orders, cost_of_goods_sold GROUP BY product_title ' + r + ' ORDER BY net_sales DESC LIMIT 1000')),
      safe(MD.ql("FROM sessions SHOW sessions, sessions_with_cart_additions WHERE landing_page_type = 'Product' GROUP BY landing_page_path " + r + ' LIMIT 1000')),
      safe(MD.loadAbandoned ? MD.loadAbandoned(p.from, p.to) : Promise.resolve([])),
      safe(loadCatalog())
    ]);
    return base(el, p, alive).then(function () { return extra; }).then(function (res) {
      if (!alive()) return;
      var html = '';
      var sales = res[0].ok ? res[0].v : [], S = MD.settings;

      // ---------- winners to losers ----------
      if (res[0].ok) {
        var rows = sales.filter(function (x) { return x.net_sales > 0; }).sort(function (a, b) { return b.net_sales - a.net_sales; });
        var tot = sum(rows, function (x) { return x.net_sales; });
        var cum = 0;
        rows.forEach(function (x) {
          cum += x.net_sales; x.cum = cum / (tot || 1);
          x.cogsUsed = x.cost_of_goods_sold > 0.05 * x.net_sales ? x.cost_of_goods_sold : x.net_sales * S.cogsFallbackPct;
          x.margin = x.net_sales - x.cogsUsed;
          x.tier = x.cum - x.net_sales / (tot || 1) < 0.8 ? 'Winner' : x.cum <= 0.95 ? 'Middle' : 'Tail';
        });
        var winners = rows.filter(function (x) { return x.tier === 'Winner'; });
        html += '<div class="card"><h2>Winners to losers</h2><p class="sub">Every product that sold, from biggest to smallest, with the running share of net sales. Winners together make 80% of sales; the tail makes the last 5%.</p>';
        if (rows.length) {
          var show = rows.slice(0, 40);
          html += '<div class="kpis" style="margin-bottom:10px">' + MD.kpi({ label: 'Products that sold', value: F.num(rows.length) }) +
            MD.kpi({ label: 'Winners (80% of sales)', value: F.num(winners.length), sub: F.pct(winners.length / rows.length) + ' of selling products', hi: true }) +
            MD.kpi({ label: 'Tail (last 5% of sales)', value: F.num(rows.filter(function (x) { return x.tier === 'Tail'; }).length) }) + '</div>';
          html += MD.chart(show.map(function (x) { return x.product_title; }), [
            { name: 'Net sales', type: 'bar', color: '#121212', values: show.map(function (x) { return x.net_sales; }), fmt: F.money, money: true },
            { name: 'Running share of sales', color: '#e07a1f', axis: 'right', values: show.map(function (x) { return x.cum; }), fmt: F.pct, pct: true }
          ], { xfmt: function (t) { return String(t).slice(0, 12); }, height: 240 });
          html += MD.table([
            { label: '#', get: function (x) { return rows.indexOf(x) + 1; } },
            { label: 'Product', key: 'product_title' },
            { label: 'Net sales', n: 1, get: function (x) { return F.money(x.net_sales); } }, { label: 'Units', n: 1, get: function (x) { return F.num(x.quantity_ordered); } },
            { label: 'Orders', n: 1, get: function (x) { return F.num(x.orders); } }, { label: 'Gross margin', n: 1, get: function (x) { return F.money(x.margin) + (x.cost_of_goods_sold > 0.05 * x.net_sales ? '' : '*'); } },
            { label: 'Running share', n: 1, get: function (x) { return F.pct(x.cum); } },
            { label: '', html: 1, get: function (x) { return '<span class="badge ' + (x.tier === 'Winner' ? 'b-ok' : x.tier === 'Middle' ? 'b-off' : 'b-warn') + '">' + x.tier + '</span>'; } }
          ], rows) + '<p class="muted small">* margin uses the fallback COGS % because the product has no cost in Shopify.</p>';
        } else html += MD.empty('No product sales in this period yet.');
        html += '</div>';
      }

      // ---------- no sign of attention ----------
      if (res[3].ok) {
        var sold = {}; sales.forEach(function (x) { if (x.quantity_ordered > 0 || x.net_sales > 0) sold[x.product_title] = true; });
        var landed = {}; if (res[1].ok) res[1].v.forEach(function (x) { var m = String(x.landing_page_path || '').match(/\/products\/([^/?#]+)/); if (m) landed[m[1]] = (landed[m[1]] || 0) + x.sessions; });
        var inCheckout = {}; if (res[2].ok) res[2].v.forEach(function (c) { c.lineItems.nodes.forEach(function (li) { if (li.product) inCheckout[li.product.id] = true; }); });
        var cat = res[3].v;
        var groups = { unseen: [], landedNoSale: [], hidden: [] };
        cat.forEach(function (pr) {
          var price = pr.priceRangeV2 ? parseFloat(pr.priceRangeV2.minVariantPrice.amount) : 0;
          var o = { t: pr.title, type: pr.productType, inv: pr.totalInventory, value: Math.max(0, pr.totalInventory || 0) * price, age: MD.daysBetween(MD.dayOf(pr.createdAt), MD.today()), landed: landed[pr.handle] || 0, checkout: !!inCheckout[pr.id] };
          if (sold[pr.title]) return;
          if (!pr.onlineStoreUrl) groups.hidden.push(o);
          else if (!o.landed && !o.checkout) groups.unseen.push(o);
          else groups.landedNoSale.push(o);
        });
        var cols = [
          { label: 'Product', key: 't' }, { label: 'Type', key: 'type' },
          { label: 'Days live', n: 1, get: function (x) { return F.num(x.age); } }, { label: 'In stock', n: 1, get: function (x) { return x.inv == null ? '' : F.num(x.inv); } },
          { label: 'Stock at retail', n: 1, get: function (x) { return F.money(x.value); } }
        ];
        html += '<div class="card"><h2>Products nobody is looking at</h2><p class="sub">Active products with no sale in ' + esc(p.label.toLowerCase()) + ', split by how much attention they got. Shopify does not report product-page views, so "no sign of attention" means: no one landed on its page, no one bought it and it never reached a checkout. Phase 2 event tracking will add true views.</p><div class="kpis" style="margin-bottom:10px">' +
          MD.kpi({ label: 'No sign of attention', value: F.num(groups.unseen.length), sub: F.money(sum(groups.unseen, function (x) { return x.value; })) + ' of stock at retail', hi: true }) +
          MD.kpi({ label: 'Seen but not sold', value: F.num(groups.landedNoSale.length), sub: 'landed on or reached checkout' }) +
          MD.kpi({ label: 'Active but not on the online store', value: F.num(groups.hidden.length), sub: 'shoppers cannot see these' }) +
          MD.kpi({ label: 'Active products', value: F.num(cat.length) }) + '</div>' +
          '<h3>No sign of attention</h3>' + MD.table(cols, groups.unseen.sort(function (a, b) { return b.value - a.value; }), { empty: 'Every active product got some attention.' }) +
          '<h3>Seen but not sold</h3>' + MD.table(cols.concat([{ label: 'Landing sessions', n: 1, get: function (x) { return F.num(x.landed); } }, { label: 'Reached checkout', get: function (x) { return x.checkout ? 'Yes' : ''; } }]), groups.landedNoSale.sort(function (a, b) { return b.landed - a.landed; }), { empty: 'None.' }) +
          (groups.hidden.length ? '<h3>Active but not published to the online store</h3>' + MD.table(cols, groups.hidden) : '') + '</div>';
      } else html += MD.err(res[3].e, 'the product catalogue');

      el.insertAdjacentHTML('afterbegin', html);
    });
  };
})(window.MD = window.MD || {});
