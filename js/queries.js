/* Monday Dashboard · ShopifyQL queries (API 2026-07). Every query here was run against a live store. */
(function (MD) {
  'use strict';
  var F = MD.fmt;
  var HUMAN = "WHERE human_or_bot_session = 'human'";
  var FUNNEL = 'sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout';
  function range(p) { return 'SINCE ' + p.from + ' UNTIL ' + p.to; }

  var Q = MD.Q = {};

  Q.sessionsDaily = function (p) {
    return 'FROM sessions SHOW ' + FUNNEL + ', online_store_visitors, pageviews, bounce_rate, average_session_duration ' + HUMAN + ' TIMESERIES day ' + range(p);
  };
  Q.funnelTotal = function (p) {
    return 'FROM sessions SHOW ' + FUNNEL + ', online_store_visitors, bounce_rate ' + HUMAN + ' ' + range(p);
  };
  Q.sessionsBy = function (dim, p, limit) {
    return 'FROM sessions SHOW ' + FUNNEL + ' ' + HUMAN + ' GROUP BY ' + dim + ' ' + range(p) + ' ORDER BY sessions DESC LIMIT ' + (limit || 20);
  };
  Q.botShare = function (p) {
    return 'FROM sessions SHOW sessions GROUP BY human_or_bot_session ' + range(p);
  };
  Q.campaignSessions = function (p) {
    return 'FROM sessions SHOW ' + FUNNEL + ' ' + HUMAN + ' GROUP BY utm_source, utm_medium, utm_campaign, utm_content ' + range(p) + ' ORDER BY sessions DESC LIMIT 40';
  };
  Q.campaignColumns = [
    { label: 'Source', get: function (x) { return x.utm_source || '(none)'; } },
    { label: 'Medium', get: function (x) { return x.utm_medium || ''; } },
    { label: 'Campaign', get: function (x) { return x.utm_campaign || ''; } },
    { label: 'Content', get: function (x) { return x.utm_content || ''; } },
    { label: 'Sessions', n: 1, get: function (x) { return F.num(x.sessions); } },
    { label: 'Cart rate', n: 1, get: function (x) { return F.pct(F.ratio(x.sessions_with_cart_additions, x.sessions)); } },
    { label: 'Conv. rate', n: 1, get: function (x) { return F.pct(F.ratio(x.sessions_that_completed_checkout, x.sessions)); } }
  ];

  /* Shopify's own attribution models on orders and sales. Columns come back as <metric>__<model>. */
  Q.MODELS = [['first_click', 'First click'], ['last_non_direct_click', 'Last non-direct'], ['last_click', 'Last click'], ['linear', 'Linear'], ['any_click', 'Any click']];
  Q.attributionBy = function (dim, p) {
    return 'FROM sales SHOW orders, net_sales, new_customers GROUP BY ' + dim + ' WITH FIRST_CLICK_ATTRIBUTION, LAST_CLICK_ATTRIBUTION, LAST_NON_DIRECT_CLICK_ATTRIBUTION, ANY_CLICK_ATTRIBUTION, LINEAR_ATTRIBUTION ' + range(p);
  };
  Q.attributionUtm = function (p) {
    return 'FROM sales SHOW orders, net_sales GROUP BY utm_source, utm_medium, utm_campaign WITH LAST_NON_DIRECT_CLICK_ATTRIBUTION, FIRST_CLICK_ATTRIBUTION ' + range(p);
  };

  Q.salesTotals = function (p) {
    return 'FROM sales SHOW orders, gross_sales, discounts, sales_reversals, net_sales, shipping_charges, taxes, total_sales, average_order_value, quantity_ordered, new_customers, returning_customers, cost_of_goods_sold, gross_profit ' + range(p);
  };
  Q.payments = function (p) {
    return 'FROM payments SHOW orders_with_transactions, gross_payments, refunded_payments, net_payments GROUP BY payment_gateway, payment_method ' + range(p) + ' ORDER BY gross_payments DESC';
  };
  Q.fulfillment = function (p) {
    return 'FROM fulfillments SHOW orders_fulfilled, orders_shipped, orders_delivered, orders_shipped_fast_rate, orders_delivered_fast_rate, median_hours_order_to_fulfillment, median_days_order_to_delivery GROUP BY shipping_carrier ' + range(p);
  };
  Q.returnsByReason = function (p) {
    return 'FROM returns SHOW returned_quantity GROUP BY product_title_at_time_of_sale, product_variant_title_at_time_of_sale, return_line_item_reason ' + range(p) + ' ORDER BY returned_quantity DESC LIMIT 40';
  };
  Q.inventory = function (p) {
    return 'FROM inventory SHOW ending_inventory_units, inventory_units_sold, inventory_units_sold_per_day, sell_through_rate, days_of_inventory_remaining, days_out_of_stock, ending_inventory_value GROUP BY product_title, product_variant_title ' + range(p) + ' ORDER BY inventory_units_sold DESC LIMIT 60';
  };
  Q.productFunnel = function (p) {
    return "FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_completed_checkout WHERE landing_page_type = 'Product' AND human_or_bot_session = 'human' GROUP BY landing_page_path " + range(p) + ' ORDER BY sessions DESC LIMIT 30';
  };
  Q.productFunnelColumns = [
    { label: 'Product page (as landing page)', get: function (x) { return x.landing_page_path || ''; } },
    { label: 'Sessions', n: 1, get: function (x) { return F.num(x.sessions); } },
    { label: 'Added to cart', n: 1, get: function (x) { return F.num(x.sessions_with_cart_additions); } },
    { label: 'Cart rate', n: 1, get: function (x) { return F.pct(F.ratio(x.sessions_with_cart_additions, x.sessions)); } },
    { label: 'Conv. rate', n: 1, get: function (x) { return F.pct(F.ratio(x.sessions_that_completed_checkout, x.sessions)); } }
  ];
  Q.productFunnelNote = 'Shopify reports product pages only as landing pages, so this shows sessions that started on a product page.';
  Q.searches = function (p) {
    return 'FROM searches SHOW searches GROUP BY search_query, search_results_were_returned ' + range(p) + ' ORDER BY searches DESC LIMIT 25';
  };
  Q.searchColumns = [
    { label: 'Search', get: function (x) { return x.search_query || ''; } },
    { label: 'Searches', n: 1, get: function (x) { return F.num(x.searches); } },
    { label: 'Results', html: 1, get: function (x) { var r = String(x.search_results_were_returned); return /false|no/i.test(r) ? '<span class="badge b-bad">No results</span>' : '<span class="badge b-ok">Results</span>'; } }
  ];
  Q.searchConversion = function (p) {
    return 'FROM search_conversions SHOW sessions_with_searches, search_sessions_with_clicks, search_sessions_with_cart_additions, search_sessions_that_completed_checkout ' + range(p);
  };
  Q.webPerf = function (p) {
    return 'FROM web_performance SHOW page_loads, lcp_p75_ms, inp_p75_ms, p75_cls, lcp_poor_view_count GROUP BY page_type, device_type ' + range(p) + ' ORDER BY page_loads DESC LIMIT 20';
  };
  Q.sessionsHourDow = function (p) {
    return 'FROM sessions SHOW sessions, sessions_that_completed_checkout ' + HUMAN + ' GROUP BY day_of_week, hour_of_day ' + range(p);
  };
})(window.MD = window.MD || {});
