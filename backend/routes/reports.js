// Admin-only business reports (sales, products, branches, customers, payments, accounting) and expense records.
const express = require('express');
const XLSX = require('xlsx');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const E = require('../lib/reportEngine');
const router = express.Router();
const TZ = Number.isFinite(Number(process.env.TZ_OFFSET_HOURS)) ? Number(process.env.TZ_OFFSET_HOURS) : 3;
router.use(requireAdmin, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function range(q) {
  const today = E.todayLocal(TZ);
  let to = DATE_RE.test(q.to || '') ? q.to : today;
  let from = DATE_RE.test(q.from || '') ? q.from : E.addDays(to, -29);
  if (from > to) [from, to] = [to, from];
  if (E.daysBetween(from, to) > 800) from = E.addDays(to, -800);
  return { from, to };
}
const shift = (d, h) => `datetime('${d} 00:00:00', '${h >= 0 ? '-' : '+'}${Math.abs(h)} hours')`; // local midnight -> UTC

function loadOrders(from, to, branch) {
  const nextDay = E.addDays(to, 1);
  const params = []; let where = `created_at >= ${shift(from, TZ)} AND created_at < ${shift(nextDay, TZ)}`;
  if (branch) { where += ' AND branch = ?'; params.push(branch); }
  const orders = db.prepare(`SELECT * FROM orders WHERE ${where} ORDER BY created_at`).all(...params);
  if (orders.length) {
    const byId = {}; orders.forEach(o => { o.items = []; byId[o.id] = o; });
    const ids = orders.map(o => o.id);
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      db.prepare(`SELECT * FROM order_items WHERE order_id IN (${chunk.map(() => '?').join(',')})`).all(...chunk).forEach(r => byId[r.order_id].items.push(r));
    }
  }
  return orders;
}
function loadExpenses(from, to, branch) {
  let sql = 'SELECT * FROM expenses WHERE expense_date BETWEEN ? AND ?'; const params = [from, to];
  if (branch) { sql += ' AND branch = ?'; params.push(branch); }
  return db.prepare(sql + ' ORDER BY expense_date, id').all(...params);
}
function build(from, to, branch, cogsMethod) {
  const orders = loadOrders(from, to, branch);
  const expenses = loadExpenses(from, to, branch);
  const products = db.prepare('SELECT id, cat, category_group, name, unit, price, in_stock FROM products').all();
  const prior = new Set(db.prepare(`SELECT DISTINCT customer_phone FROM orders WHERE status != 'cancelled' AND created_at < ${shift(from, TZ)}`).all().map(r => E.last9(r.customer_phone)));
  const lifetime = Object.values(db.prepare("SELECT customer_phone, customer_name, total, created_at FROM orders WHERE status != 'cancelled'").all().reduce((m, o) => {
    const k = E.last9(o.customer_phone); const c = m[k] || (m[k] = { phone: o.customer_phone, name: '', orders: 0, spend: 0, last: '' });
    c.orders++; c.spend += o.total; if (o.customer_name) c.name = o.customer_name; if (o.created_at > c.last) c.last = o.created_at; return m; }, {}));
  const ids = orders.map(o => o.id); const statusLog = {};
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    db.prepare(`SELECT order_id, status, changed_at FROM order_status_log WHERE order_id IN (${chunk.map(() => '?').join(',')}) ORDER BY id`).all(...chunk)
      .forEach(r => (statusLog[r.order_id] = statusLog[r.order_id] || []).push({ status: r.status, at: r.changed_at }));
  }
  const mpesaTx = ids.length ? db.prepare(`SELECT status FROM mpesa_transactions WHERE order_id IN (${ids.slice(0, 900).map(() => '?').join(',')})`).all(...ids.slice(0, 900)) : [];
  return { orders, expenses, ...{ data: E.analyse(orders, expenses, { tz: TZ, from, to, products, priorPhones: prior, lifetime, statusLog, mpesaTx, cogsMethod }) } };
}

router.get('/overview', (req, res) => {
  const { from, to } = range(req.query); const branch = req.query.branch || '';
  const cur = build(from, to, branch, req.query.cogs).data;
  const pr = E.previousRange(from, to); const prev = build(pr.from, pr.to, branch, req.query.cogs).data;
  const branchList = db.prepare('SELECT name, is_main FROM branches ORDER BY sort_order, name').all().map(b => b.is_main ? `${b.name} (Main)` : b.name);
  res.json({ range: { from, to, days: E.daysBetween(from, to) + 1 }, previous: { range: pr, kpis: prev.kpis, pnl: prev.pnl }, branchFilter: branch,
    branchOptions: branchList, expenseCategories: E.EXPENSE_CATEGORIES, tzOffset: TZ, ...cur, insights: E.insights(cur, prev) });
});

// ---------- expenses ----------
router.get('/expenses', (req, res) => {
  const { from, to } = range(req.query);
  res.json({ expenses: loadExpenses(from, to, req.query.branch || ''), categories: E.EXPENSE_CATEGORIES });
});
function cleanExpense(b) {
  const amount = Math.round(Number(b.amount)); const category = String(b.category || '').trim();
  const date = String(b.expense_date || '').trim();
  if (!DATE_RE.test(date)) return { error: 'Pick a valid date' };
  if (!E.EXPENSE_CATEGORIES.includes(category)) return { error: 'Pick a category from the list' };
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) return { error: 'Enter an amount above 0' };
  return { v: { expense_date: date, category, description: String(b.description || '').slice(0, 200), amount, branch: String(b.branch || '').slice(0, 80) || null, paid_via: String(b.paid_via || '').slice(0, 40) || null } };
}
router.post('/expenses', (req, res) => {
  const c = cleanExpense(req.body || {}); if (c.error) return res.status(400).json({ error: c.error });
  const r = db.prepare('INSERT INTO expenses (expense_date, category, description, amount, branch, paid_via) VALUES (@expense_date,@category,@description,@amount,@branch,@paid_via)').run(c.v);
  res.status(201).json({ ok: true, id: r.lastInsertRowid });
});
router.put('/expenses/:id', (req, res) => {
  const c = cleanExpense(req.body || {}); if (c.error) return res.status(400).json({ error: c.error });
  const r = db.prepare('UPDATE expenses SET expense_date=@expense_date, category=@category, description=@description, amount=@amount, branch=@branch, paid_via=@paid_via WHERE id=@id').run({ ...c.v, id: req.params.id });
  if (!r.changes) return res.status(404).json({ error: 'Expense not found' });
  res.json({ ok: true });
});
router.delete('/expenses/:id', (req, res) => {
  const r = db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Expense not found' });
  res.json({ ok: true });
});

// ---------- cost backfill ----------
// Orders placed before cost prices existed (or before you filled them in) have cost 0 on their lines.
// This copies each product's CURRENT cost price onto those lines, so older sales get a margin too.
// Only lines with no cost yet are touched; lines that already carry a cost are never changed.
// body: { scope: 'all' | 'range', from, to, preview: true|false }
router.post('/backfill-costs', (req, res) => {
  const b = req.body || {}; let rangeSql = ''; const params = [];
  if (b.scope === 'range') {
    const { from, to } = range(b);
    rangeSql = ` AND order_id IN (SELECT id FROM orders WHERE created_at >= ${shift(from, TZ)} AND created_at < ${shift(E.addDays(to, 1), TZ)})`;
  }
  const where = `cost_price = 0 AND product_id IN (SELECT id FROM products WHERE cost_price > 0)${rangeSql}`;
  const found = db.prepare(`SELECT COUNT(*) AS lines, COUNT(DISTINCT order_id) AS orders FROM order_items WHERE ${where}`).get(...params);
  if (b.preview) return res.json({ ok: true, preview: true, lines: found.lines, orders: found.orders });
  db.prepare(`UPDATE order_items SET cost_price = (SELECT p.cost_price FROM products p WHERE p.id = order_items.product_id) WHERE ${where}`).run(...params);
  res.json({ ok: true, preview: false, lines: found.lines, orders: found.orders });
});

// ---------- accountant pack (.xlsx) ----------
router.get('/export.xlsx', (req, res) => {
  const { from, to } = range(req.query); const branch = req.query.branch || '';
  const { orders, expenses, data: d } = build(from, to, branch, req.query.cogs);
  const wb = XLSX.utils.book_new();
  const add = (name, rows, header) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{}], header ? { header } : undefined), name);
  const p = d.pnl;
  add('Profit & Loss', [
    { Item: 'Period', 'KSh': `${from} to ${to}${branch ? ' — ' + branch : ''}` },
    { Item: 'Item sales', KSh: p.itemSales }, { Item: 'Delivery fees', KSh: p.deliveryFees }, { Item: 'Total revenue', KSh: p.revenue },
    { Item: 'Cost of goods sold', KSh: -p.cogs }, { Item: 'Gross profit', KSh: p.grossProfit }, { Item: 'Gross margin %', KSh: p.grossMargin },
    ...d.expenseByCategory.filter(e => e.category !== E.PURCHASES).map(e => ({ Item: 'Expense: ' + e.category, KSh: -e.amount })),
    { Item: 'Total operating expenses', KSh: -p.operatingExpenses }, { Item: 'Net profit (before income tax)', KSh: p.netProfit }, { Item: 'Net margin %', KSh: p.netMargin },
    { Item: 'Stock purchases recorded (memo)', KSh: p.stockPurchases }, { Item: 'Basis of cost of goods', KSh: p.cogsNote },
  ]);
  add('Daily sales', d.daily.map(x => ({ Date: x.date, Orders: x.orders, 'Revenue KSh': x.revenue, 'Expenses KSh': x.expenses })));
  add('Products', d.products.map(x => ({ Item: x.name, Category: x.cat, Unit: x.unit, Qty: x.qty, 'Revenue KSh': x.revenue, 'Cost KSh': round0(x.cogs), 'Profit KSh': x.profit, 'Margin %': x.margin, 'Share %': x.share, Class: x.abc })));
  add('Branches', d.branches.map(x => ({ Branch: x.branch, Orders: x.orders, 'Revenue KSh': x.revenue, 'Avg order KSh': x.avgOrder, 'Share %': x.share, Cancelled: x.cancelled })));
  add('Payments', d.payments.map(x => ({ Method: x.method, Orders: x.orders, 'Revenue KSh': x.revenue, 'Collected (completed) KSh': x.collected, 'Outstanding KSh': x.outstanding })));
  add('Expenses', expenses.map(x => ({ Date: x.expense_date, Category: x.category, Description: x.description, 'Amount KSh': x.amount, Branch: x.branch, 'Paid via': x.paid_via })));
  add('Sales ledger', orders.map(o => { const l = E.localOf(o.created_at, TZ); return { 'Order #': o.id, Date: l.date, Time: l.time, Customer: o.customer_name, Phone: o.customer_phone,
    Branch: o.branch, Fulfilment: o.fulfilment, Payment: o.payment_method, 'M-Pesa receipt': o.mpesa_receipt, Status: o.status, 'Items KSh': o.items_subtotal, 'Delivery KSh': o.delivery_fee, 'Total KSh': o.total, 'Promo': o.promo_code }; }));
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="azizo-accountant-pack-${from}-to-${to}.xlsx"`);
  res.send(buf);
});
function round0(n) { return Math.round(n || 0); }
module.exports = router;
