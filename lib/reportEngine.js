// Pure reporting maths: give it rows, get numbers. No database or HTTP in here, so it is easy to test
// and the PHP backend mirrors the same logic (backend-php/lib/report_engine.php).
const EXPENSE_CATEGORIES = ['Stock purchases', 'Salaries & wages', 'Rent', 'Electricity, water & gas', 'Transport & delivery',
  'Packaging', 'Marketing & ads', 'Licences & permits', 'Repairs & maintenance', 'Bank & M-Pesa charges', 'Other'];
const PURCHASES = 'Stock purchases';
const isMpesa = (m) => /m-?pesa/i.test(String(m || ''));
const isCash = (m) => /cash/i.test(String(m || ''));
const OPEN = ['received', 'preparing', 'ready', 'out_for_delivery'];
const last9 = (s) => String(s || '').replace(/\D/g, '').slice(-9);
const round = (n) => Math.round(n || 0);
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

function parseUtc(ts) { return new Date(String(ts).replace(' ', 'T') + (String(ts).endsWith('Z') ? '' : 'Z')).getTime(); }
function localOf(ts, tz) {
  const d = new Date(parseUtc(ts) + tz * 3600000);
  const iso = d.toISOString();
  return { date: iso.slice(0, 10), hour: d.getUTCHours(), dow: d.getUTCDay(), time: iso.slice(11, 16) };
}
function addDays(dateStr, n) { const d = new Date(dateStr + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000); }
function todayLocal(tz) { return new Date(Date.now() + tz * 3600000).toISOString().slice(0, 10); }
function previousRange(from, to) { const len = daysBetween(from, to) + 1; return { from: addDays(from, -len), to: addDays(from, -1) }; }

/**
 * orders:   rows from `orders`, each with .items = rows from order_items
 * expenses: rows from `expenses`
 * ctx: { tz, from, to, products (array of product rows), priorPhones:Set of last9 seen before `from`,
 *        lifetime: [{phone,name,orders,spend,last}] for lapsed-customer detection, mpesaTx: rows, statusLog: {orderId:[{status,at}]} }
 */
function analyse(orders, expenses, ctx) {
  const tz = ctx.tz;
  const live = orders.filter(o => o.status !== 'cancelled');
  const cancelled = orders.filter(o => o.status === 'cancelled');
  const sum = (arr, f) => arr.reduce((t, x) => t + (Number(f(x)) || 0), 0);

  // ---- headline numbers ----
  const revenue = sum(live, o => o.total);
  const deliveryFees = sum(live, o => o.delivery_fee);
  const itemSales = revenue - deliveryFees;
  const lines = live.flatMap(o => o.items.map(i => Object.assign({}, i, { _o: o })));
  const lineRevenue = sum(lines, i => i.line_total);
  const discounts = sum(live, o => Math.max(0, sum(o.items, i => i.line_total) - (o.items_subtotal || 0)));
  const costedLines = lines.filter(i => i.cost_price > 0);
  const costedRevenue = sum(costedLines, i => i.line_total);
  const cogsCost = sum(costedLines, i => i.cost_price * i.qty);
  const coverage = pct(costedRevenue, lineRevenue);
  const grossProfitCosted = costedRevenue - cogsCost;
  const purchases = sum(expenses.filter(e => e.category === PURCHASES), e => e.amount);
  const opex = sum(expenses.filter(e => e.category !== PURCHASES), e => e.amount);

  // COGS method: cost prices if they cover most sales, otherwise recorded stock purchases (cash basis).
  let cogsMethod = coverage >= 90 ? 'cost_price' : (purchases > 0 ? 'purchases' : 'cost_price');
  if (ctx.cogsMethod === 'cost_price' || ctx.cogsMethod === 'purchases') cogsMethod = ctx.cogsMethod;
  let cogs, cogsNote;
  if (cogsMethod === 'purchases') { cogs = purchases; cogsNote = 'Cost of goods = stock purchases you recorded in this period (cash basis).'; }
  else if (coverage >= 99.5) { cogs = cogsCost; cogsNote = 'Cost of goods = cost price × quantity sold, for every item.'; }
  else { cogs = round(cogsCost + (lineRevenue - costedRevenue) * (costedRevenue ? cogsCost / costedRevenue : 0));
    cogsNote = `Only ${coverage}% of item sales have a cost price; the rest is estimated at the same cost ratio. Fill in cost prices for a firmer number.`; }
  // Delivery fees are income too, so profit is measured on all revenue less cost of goods.
  const grossProfitAll = revenue - cogs;
  const netProfit = grossProfitAll - opex;

  const customersMap = new Map();
  live.forEach(o => {
    const k = last9(o.customer_phone) || ('o' + o.id);
    const c = customersMap.get(k) || { phone: o.customer_phone, name: o.customer_name || '', orders: 0, spend: 0, last: '' };
    c.orders++; c.spend += o.total; if (o.customer_name) c.name = o.customer_name;
    if (!c.last || o.created_at > c.last) c.last = o.created_at;
    customersMap.set(k, c);
  });
  const customers = [...customersMap.entries()];
  const prior = ctx.priorPhones || new Set();
  const returning = customers.filter(([k, c]) => prior.has(k) || c.orders >= 2).length;
  const kpis = {
    orders: live.length, revenue, itemSales, deliveryFees, discounts: round(discounts),
    avgOrder: live.length ? round(revenue / live.length) : 0,
    cancelled: cancelled.length, cancelledValue: sum(cancelled, o => o.total), cancelRate: pct(cancelled.length, orders.length),
    customers: customers.length, newCustomers: customers.length - returning, returningCustomers: returning,
    repeatRate: pct(returning, customers.length),
    ordersPerCustomer: customers.length ? Math.round((live.length / customers.length) * 10) / 10 : 0,
    unitsSold: sum(lines, i => i.qty),
  };
  const pnl = { revenue, itemSales, deliveryFees, cogs: round(cogs), cogsMethod, cogsNote, costCoverage: coverage,
    grossProfit: round(grossProfitAll), grossMargin: pct(grossProfitAll, revenue), operatingExpenses: opex,
    netProfit: round(netProfit), netMargin: pct(netProfit, revenue), stockPurchases: purchases };

  // ---- time patterns ----
  const days = {}; const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: 0, revenue: 0 }));
  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => ({ day: d, orders: 0, revenue: 0, dates: new Set() }));
  const n = daysBetween(ctx.from, ctx.to) + 1;
  for (let i = 0; i < n; i++) { const d = addDays(ctx.from, i); days[d] = { date: d, orders: 0, revenue: 0, expenses: 0 }; }
  live.forEach(o => {
    const l = localOf(o.created_at, tz); o._l = l;
    if (days[l.date]) { days[l.date].orders++; days[l.date].revenue += o.total; }
    hours[l.hour].orders++; hours[l.hour].revenue += o.total;
    dows[l.dow].orders++; dows[l.dow].revenue += o.total;
  });
  for (let i = 0; i < n; i++) { const l = new Date(addDays(ctx.from, i) + 'T00:00:00Z').getUTCDay(); dows[l].dates.add(i); }
  expenses.forEach(e => { if (days[e.expense_date]) days[e.expense_date].expenses += e.amount; });
  const daily = Object.values(days);
  const weekday = dows.map(d => ({ day: d.day, orders: d.orders, revenue: d.revenue, avgRevenue: d.dates.size ? round(d.revenue / d.dates.size) : 0 }));

  // ---- products ----
  const prodInfo = new Map((ctx.products || []).map(p => [p.id, p]));
  const pm = new Map();
  lines.forEach(i => {
    const key = i.product_id || ('n:' + i.name);
    const info = prodInfo.get(i.product_id) || {};
    const p = pm.get(key) || { id: i.product_id || '', name: i.name, unit: i.unit || info.unit || '', cat: info.cat || 'Other',
      group: info.category_group || 'other', qty: 0, revenue: 0, cogs: 0, costedRevenue: 0, orders: 0 };
    p.qty += i.qty; p.revenue += i.line_total; p.orders++;
    if (i.cost_price > 0) { p.cogs += i.cost_price * i.qty; p.costedRevenue += i.line_total; }
    pm.set(key, p);
  });
  const products = [...pm.values()].map(p => ({ ...p, profit: p.costedRevenue ? round(p.costedRevenue - p.cogs) : null,
    margin: p.costedRevenue ? pct(p.costedRevenue - p.cogs, p.costedRevenue) : null, share: pct(p.revenue, lineRevenue) }))
    .sort((a, b) => b.revenue - a.revenue);
  // ABC (Pareto): A = items making the first 80% of sales, B = next 15%, C = last 5%
  let run = 0; products.forEach(p => { const before = run; run += p.revenue; p.abc = lineRevenue ? (before / lineRevenue < 0.8 ? 'A' : before / lineRevenue < 0.95 ? 'B' : 'C') : 'C'; });
  const catMap = new Map();
  products.forEach(p => { const c = catMap.get(p.cat) || { category: p.cat, revenue: 0, qty: 0, cogs: 0, costedRevenue: 0 };
    c.revenue += p.revenue; c.qty += p.qty; c.cogs += p.cogs; c.costedRevenue += p.costedRevenue; catMap.set(p.cat, c); });
  const categories = [...catMap.values()].map(c => ({ category: c.category, revenue: c.revenue, qty: c.qty, share: pct(c.revenue, lineRevenue),
    margin: c.costedRevenue ? pct(c.costedRevenue - c.cogs, c.costedRevenue) : null })).sort((a, b) => b.revenue - a.revenue);
  const sold = new Set(products.map(p => p.id).filter(Boolean));
  const noSales = (ctx.products || []).filter(p => !sold.has(p.id)).map(p => ({ id: p.id, name: p.name, cat: p.cat, price: p.price }));
  const soldOut = (ctx.products || []).filter(p => p.in_stock === 0).map(p => ({ id: p.id, name: p.name }));
  const lowMargin = products.filter(p => p.margin !== null && p.margin < 15 && p.revenue > 0).slice(0, 10);

  // ---- branches / fulfilment / payments / status ----
  const group = (arr, keyFn) => { const m = new Map(); arr.forEach(o => { const k = keyFn(o); (m.get(k) || m.set(k, []).get(k)).push(o); }); return m; };
  const branches = [...group(orders, o => o.branch || 'Not recorded').entries()].map(([name, os]) => {
    const lv = os.filter(o => o.status !== 'cancelled'); const rev = sum(lv, o => o.total);
    return { branch: name, orders: lv.length, revenue: rev, avgOrder: lv.length ? round(rev / lv.length) : 0, share: pct(rev, revenue),
      deliveries: lv.filter(o => /deliver/i.test(o.fulfilment)).length, cancelled: os.length - lv.length, cancelRate: pct(os.length - lv.length, os.length) };
  }).sort((a, b) => b.revenue - a.revenue);
  const fulfilment = [...group(live, o => /deliver/i.test(o.fulfilment) ? 'Delivery' : 'Pickup').entries()].map(([k, os]) =>
    ({ type: k, orders: os.length, revenue: sum(os, o => o.total), avgOrder: round(sum(os, o => o.total) / os.length), share: pct(os.length, live.length) }));
  const delivered = live.filter(o => /deliver/i.test(o.fulfilment));
  const delivery = { orders: delivered.length, feesCollected: deliveryFees, avgFee: delivered.length ? round(deliveryFees / delivered.length) : 0,
    freeDeliveries: delivered.filter(o => !o.delivery_fee).length };
  const payments = [...group(live, o => o.payment_method || 'Unknown').entries()].map(([m, os]) => {
    const done = os.filter(o => o.status === 'completed'); const open = os.filter(o => OPEN.includes(o.status));
    return { method: m, orders: os.length, revenue: sum(os, o => o.total), share: pct(sum(os, o => o.total), revenue),
      collected: sum(done, o => o.total), outstanding: sum(open, o => o.total), outstandingOrders: open.length };
  }).sort((a, b) => b.revenue - a.revenue);
  const mpesaOrders = live.filter(o => isMpesa(o.payment_method));
  const noReceipt = mpesaOrders.filter(o => !o.mpesa_receipt && o.status === 'completed');
  const tx = ctx.mpesaTx || [];
  const reconciliation = {
    mpesaOrders: mpesaOrders.length, mpesaValue: sum(mpesaOrders, o => o.total),
    mpesaWithReceipt: mpesaOrders.filter(o => o.mpesa_receipt).length, mpesaReceiptValue: sum(mpesaOrders.filter(o => o.mpesa_receipt), o => o.total),
    completedWithoutReceipt: noReceipt.length, completedWithoutReceiptValue: sum(noReceipt, o => o.total),
    stkSuccess: tx.filter(t => t.status === 'success' || t.status === 'completed').length, stkPending: tx.filter(t => t.status === 'pending').length,
    stkFailed: tx.filter(t => !['success', 'completed', 'pending'].includes(t.status)).length,
    cashOrders: live.filter(o => isCash(o.payment_method)).length,
    cashToBank: sum(live.filter(o => isCash(o.payment_method) && o.status === 'completed'), o => o.total),
  };
  const statusCounts = {}; orders.forEach(o => { statusCounts[o.status] = (statusCounts[o.status] || 0) + 1; });
  const promos = [...group(live.filter(o => o.promo_code), o => String(o.promo_code).toUpperCase()).entries()].map(([code, os]) =>
    ({ code, orders: os.length, revenue: sum(os, o => o.total), discount: round(sum(os, o => Math.max(0, sum(o.items, i => i.line_total) - (o.items_subtotal || 0)))) }))
    .sort((a, b) => b.orders - a.orders);

  // ---- customers ----
  const topCustomers = customers.map(([, c]) => c).sort((a, b) => b.spend - a.spend).slice(0, 10).map(c => ({ ...c, avgOrder: round(c.spend / c.orders) }));
  const buckets = [1, 2, 3, 5].map((min, i, a) => ({ label: i === a.length - 1 ? `${min}+ orders` : (a[i + 1] - min === 1 ? `${min} order${min > 1 ? 's' : ''}` : `${min}–${a[i + 1] - 1} orders`),
    customers: customers.filter(([, c]) => c.orders >= min && (i === a.length - 1 || c.orders < a[i + 1])).length }));
  const nowMs = Date.now();
  const lapsed = (ctx.lifetime || []).filter(c => c.orders >= 2 && (nowMs - parseUtc(c.last)) / 86400000 >= 30)
    .sort((a, b) => b.spend - a.spend).slice(0, 15).map(c => ({ ...c, daysSince: Math.floor((nowMs - parseUtc(c.last)) / 86400000) }));

  // ---- operations ----
  const log = ctx.statusLog || {}; const mins = { completed: [], ready: [] };
  live.forEach(o => { const l = log[o.id]; if (!l) return; const rec = l.find(x => x.status === 'received'); if (!rec) return;
    const done = l.filter(x => x.status === 'completed').pop(); const rdy = l.find(x => x.status === 'ready' || x.status === 'out_for_delivery');
    if (done) mins.completed.push((parseUtc(done.at) - parseUtc(rec.at)) / 60000);
    if (rdy) mins.ready.push((parseUtc(rdy.at) - parseUtc(rec.at)) / 60000); });
  const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
  const operations = { avgMinutesToReady: avg(mins.ready), avgMinutesToComplete: avg(mins.completed), timedOrders: mins.completed.length,
    openNow: orders.filter(o => OPEN.includes(o.status)).length };

  // ---- expenses ----
  const expCat = [...group(expenses, e => e.category).entries()].map(([category, es]) => ({ category, amount: sum(es, e => e.amount), entries: es.length,
    share: pct(sum(es, e => e.amount), sum(expenses, e => e.amount)) })).sort((a, b) => b.amount - a.amount);

  const peakHour = hours.reduce((m, h) => h.orders > m.orders ? h : m, hours[0]);
  const bestDay = daily.reduce((m, d) => d.revenue > m.revenue ? d : m, daily[0]);
  const bestWeekday = weekday.reduce((m, d) => d.avgRevenue > m.avgRevenue ? d : m, weekday[0]);
  return { kpis, pnl, daily, hours, weekday, products, categories, noSales: noSales.slice(0, 20), noSalesCount: noSales.length, soldOut, lowMargin,
    branches, fulfilment, delivery, payments, reconciliation, statusCounts, promos, topCustomers, frequency: buckets, lapsed, operations,
    expenseByCategory: expCat, peaks: { hour: kpis.orders ? peakHour.hour : null, bestDay: kpis.orders ? bestDay : null, bestWeekday: kpis.orders ? bestWeekday.day : null } };
}

function insights(cur, prev) {
  const out = []; const k = cur.kpis, p = prev ? prev.kpis : null; const money = (n) => 'KSh ' + Math.round(n).toLocaleString('en-KE');
  if (!k.orders) return [{ level: 'info', text: 'No completed or open orders in this period yet.' }];
  if (p && p.revenue) { const ch = pct(k.revenue - p.revenue, p.revenue);
    out.push({ level: ch >= 0 ? 'good' : 'warn', text: `Sales are ${ch >= 0 ? 'up' : 'down'} ${Math.abs(ch)}% on the previous period (${money(k.revenue)} vs ${money(p.revenue)}).` }); }
  if (cur.peaks.hour !== null) out.push({ level: 'info', text: `Busiest hour is ${String(cur.peaks.hour).padStart(2, '0')}:00 and the strongest weekday is ${cur.peaks.bestWeekday}. Staff and stock the counter for those times.` });
  if (cur.products[0]) out.push({ level: 'info', text: `${cur.products[0].name} is the top seller (${cur.products[0].share}% of item sales). ${cur.products.filter(x => x.abc === 'A').length} items make up 80% of your sales — never run out of those.` });
  if (cur.lowMargin.length) out.push({ level: 'warn', text: `${cur.lowMargin.length} item(s) earn under 15% margin, e.g. ${cur.lowMargin[0].name} (${cur.lowMargin[0].margin}%). Review price or buying cost.` });
  if (cur.pnl.costCoverage < 90) out.push({ level: 'warn', text: `Only ${cur.pnl.costCoverage}% of sales have a cost price, so profit is an estimate. Add cost prices in Products for accurate margins.` });
  if (k.cancelRate >= 8) out.push({ level: 'warn', text: `${k.cancelRate}% of orders were cancelled (${money(k.cancelledValue)} lost). Check stock-outs and delivery delays.` });
  if (cur.reconciliation.completedWithoutReceipt) out.push({ level: 'warn', text: `${cur.reconciliation.completedWithoutReceipt} completed M-Pesa order(s) (${money(cur.reconciliation.completedWithoutReceiptValue)}) have no M-Pesa receipt recorded — match them against your statement.` });
  if (cur.lapsed.length) out.push({ level: 'info', text: `${cur.lapsed.length} regular customers haven't ordered in 30+ days. A WhatsApp nudge or promo code could win them back.` });
  if (cur.noSalesCount) out.push({ level: 'info', text: `${cur.noSalesCount} menu item(s) had no sales in this period. Consider promoting or removing them.` });
  if (cur.soldOut.length) out.push({ level: 'warn', text: `${cur.soldOut.length} item(s) are currently marked sold out, which loses sales.` });
  if (k.customers && k.repeatRate < 25) out.push({ level: 'info', text: `Only ${k.repeatRate}% of customers are repeat buyers. Loyalty offers could lift this.` });
  if (cur.pnl.netProfit < 0 && cur.pnl.operatingExpenses) out.push({ level: 'warn', text: `Expenses exceed gross profit in this period (net ${money(cur.pnl.netProfit)}).` });
  return out;
}

module.exports = { analyse, insights, EXPENSE_CATEGORIES, PURCHASES, localOf, addDays, daysBetween, todayLocal, previousRange, last9 };
