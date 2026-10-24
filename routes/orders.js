const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin, requireStaff } = require('../middleware/auth');
const router = express.Router();
router.post('/', (req, res) => {
  const { customer_name, customer_phone, fulfilment, branch, pickup_time, notes, area, recurring, delivery_address,
    delivery_lat, delivery_lng, delivery_fee, payment_method, promo_code, items_subtotal, total, items } = req.body;
  if (!customer_phone || !fulfilment || !payment_method || !total || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'customer_phone, fulfilment, payment_method, total, and a non-empty items array are required' });
  }
  let customerId = null;
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const jwt = require('jsonwebtoken');
      const { SECRET } = require('../middleware/auth');
      const decoded = jwt.verify(header.slice(7), SECRET);
      if (decoded.role === 'customer') customerId = decoded.id;
    } catch (e) {}
  }
  const insertOrder = db.prepare(`
    INSERT INTO orders (customer_id, customer_name, customer_phone, fulfilment, branch, pickup_time, notes, area, recurring,
      delivery_address, delivery_lat, delivery_lng, delivery_fee, payment_method, promo_code, items_subtotal, total)
    VALUES (@customer_id, @customer_name, @customer_phone, @fulfilment, @branch, @pickup_time, @notes, @area, @recurring,
      @delivery_address, @delivery_lat, @delivery_lng, @delivery_fee, @payment_method, @promo_code, @items_subtotal, @total)
  `);
  const insertItem = db.prepare(`INSERT INTO order_items (order_id, product_id, name, qty, unit, unit_price, line_total, cost_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const costOf = db.prepare('SELECT cost_price FROM products WHERE id = ?');
  const logStatus = db.prepare("INSERT INTO order_status_log (order_id, status) VALUES (?, 'received')");
  const createOrder = db.transaction(() => {
    const result = insertOrder.run({ customer_id: customerId, customer_name: customer_name || null, customer_phone,
      fulfilment, branch: branch || null, pickup_time: pickup_time || null, notes: notes ? String(notes).slice(0, 300) : null, area: area ? String(area).slice(0, 80) : null,
      recurring: ['Weekly', 'Bi-weekly', 'Monthly'].includes(recurring) ? recurring : null, delivery_address: delivery_address || null,
      delivery_lat: delivery_lat || null, delivery_lng: delivery_lng || null, delivery_fee: delivery_fee || 0,
      payment_method, promo_code: promo_code || null, items_subtotal: items_subtotal || total, total });
    const orderId = result.lastInsertRowid;
    for (const item of items) {
      const c = item.id ? costOf.get(item.id) : null;
      insertItem.run(orderId, item.id || null, item.name, item.qty, item.unit || '', item.price, item.price * item.qty, c ? c.cost_price : 0);
    }
    logStatus.run(orderId);
    return orderId;
  });
  res.status(201).json({ ok: true, orderId: createOrder() });
});
// Orders change the moment staff touch them in admin.html, and the admin tool polls
// this right after every status update (including on a fresh page load) to show the
// current state — so this must never be served from a cache, browser or otherwise.
function noStore(req, res, next) { res.set('Cache-Control', 'no-store'); next(); }
// Staff work-queue. Filters: status (one or comma list), branch, date=today, q (order #, name or phone).
// Items come back with each order so the staff screen can show a whole ticket without extra calls.
const TZ_HOURS = Number.isFinite(Number(process.env.TZ_OFFSET_HOURS)) ? Number(process.env.TZ_OFFSET_HOURS) : 3; // Nairobi = UTC+3
const dayExpr = `date(created_at, '${TZ_HOURS >= 0 ? '+' : '-'}${Math.abs(TZ_HOURS)} hours')`;
const todayExpr = `date('now', '${TZ_HOURS >= 0 ? '+' : '-'}${Math.abs(TZ_HOURS)} hours')`;

router.get('/', requireStaff, noStore, (req, res) => {
  const { status, phone, branch, date, q } = req.query;
  const conditions = []; const params = [];
  if (status) {
    const list = String(status).split(',').map(s => s.trim()).filter(Boolean);
    if (list.length) { conditions.push(`status IN (${list.map(() => '?').join(',')})`); params.push(...list); }
  }
  if (phone) { conditions.push('customer_phone LIKE ?'); params.push(`%${phone}%`); }
  if (branch) { conditions.push('branch = ?'); params.push(branch); }
  if (date === 'today') conditions.push(`${dayExpr} = ${todayExpr}`);
  if (q) {
    const term = String(q).trim();
    conditions.push('(CAST(id AS TEXT) = ? OR customer_name LIKE ? OR customer_phone LIKE ?)');
    params.push(term.replace(/^#/, ''), `%${term}%`, `%${term}%`);
  }
  let query = 'SELECT * FROM orders';
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY created_at DESC, id DESC LIMIT 300';
  const orders = db.prepare(query).all(...params);
  if (orders.length) {
    const ids = orders.map(o => o.id);
    const rows = db.prepare(`SELECT * FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    const byOrder = {};
    rows.forEach(r => { (byOrder[r.order_id] = byOrder[r.order_id] || []).push(r); });
    orders.forEach(o => { o.items = byOrder[o.id] || []; });
  }
  res.json({ orders });
});

// Today's numbers for the staff "Today" tab (cancelled orders are counted separately, never in sales).
// Standing (recurring) orders: the latest recurring order of each customer, with how long ago that
// customer last ordered anything, so staff can see whose cycle is due and message them.
router.get('/standing', requireStaff, noStore, (req, res) => {
  const rows = db.prepare(`
    SELECT o.*, (SELECT MAX(created_at) FROM orders x WHERE x.customer_phone = o.customer_phone AND x.status != 'cancelled') AS last_order_at
    FROM orders o
    WHERE o.recurring IS NOT NULL AND o.recurring != '' AND o.status != 'cancelled'
      AND o.id = (SELECT MAX(id) FROM orders y WHERE y.customer_phone = o.customer_phone AND y.recurring IS NOT NULL AND y.recurring != '' AND y.status != 'cancelled')
    ORDER BY o.id DESC LIMIT 200`).all();
  const itemsOf = db.prepare('SELECT name, qty, unit FROM order_items WHERE order_id = ?');
  res.json({ standing: rows.map(o => ({ id: o.id, customer_name: o.customer_name, customer_phone: o.customer_phone, recurring: o.recurring,
    fulfilment: o.fulfilment, branch: o.branch, area: o.area, delivery_address: o.delivery_address, total: o.total,
    created_at: o.created_at, last_order_at: o.last_order_at, items: itemsOf.all(o.id) })) });
});

// One tap "order this again": copies an earlier order as a new one (current menu prices, same
// delivery details; promo codes are not carried over). Staff use it when a standing customer confirms.
router.post('/:id/repeat', requireStaff, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
  const prod = db.prepare('SELECT price, cost_price FROM products WHERE id = ?');
  const create = db.transaction(() => {
    const lines = items.map(i => { const p = i.product_id ? prod.get(i.product_id) : null; const price = p ? p.price : i.unit_price; return { i, price, cost: p ? p.cost_price : i.cost_price || 0 }; });
    const sub = lines.reduce((s, l) => s + l.price * l.i.qty, 0);
    const total = sub + (o.delivery_fee || 0);
    const r = db.prepare(`INSERT INTO orders (customer_id, customer_name, customer_phone, fulfilment, branch, pickup_time, notes, area, recurring,
        delivery_address, delivery_lat, delivery_lng, delivery_fee, payment_method, items_subtotal, total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(o.customer_id, o.customer_name, o.customer_phone, o.fulfilment, o.branch, o.pickup_time, o.notes,
      o.area, o.recurring, o.delivery_address, o.delivery_lat, o.delivery_lng, o.delivery_fee || 0, o.payment_method === 'mpesa' ? 'cash' : o.payment_method, sub, total);
    const id = r.lastInsertRowid;
    const ins = db.prepare('INSERT INTO order_items (order_id, product_id, name, qty, unit, unit_price, line_total, cost_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    lines.forEach(l => ins.run(id, l.i.product_id, l.i.name, l.i.qty, l.i.unit, l.price, l.price * l.i.qty, l.cost));
    db.prepare("INSERT INTO order_status_log (order_id, status) VALUES (?, 'received')").run(id);
    return { id, total };
  });
  const out = create();
  res.status(201).json({ ok: true, orderId: out.id, total: out.total });
});

router.get('/summary', requireStaff, noStore, (req, res) => {
  const today = `${dayExpr} = ${todayExpr}`;
  const live = `${today} AND status != 'cancelled'`;
  const one = (sql) => db.prepare(sql).get();
  const totals = one(`SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue FROM orders WHERE ${live}`);
  const cancelled = one(`SELECT COUNT(*) AS n FROM orders WHERE ${today} AND status = 'cancelled'`).n;
  const byStatus = {};
  db.prepare(`SELECT status, COUNT(*) AS n FROM orders WHERE ${today} GROUP BY status`).all().forEach(r => { byStatus[r.status] = r.n; });
  const open = one(`SELECT COUNT(*) AS n FROM orders WHERE status IN ('received','preparing','ready','out_for_delivery')`).n;
  res.json({
    date: one(`SELECT ${todayExpr} AS d`).d,
    orders: totals.orders, revenue: totals.revenue, cancelled, openNow: open,
    avgOrder: totals.orders ? Math.round(totals.revenue / totals.orders) : 0,
    byStatus,
    byFulfilment: db.prepare(`SELECT fulfilment, COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue FROM orders WHERE ${live} GROUP BY fulfilment`).all(),
    byPayment: db.prepare(`SELECT payment_method AS method, COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue FROM orders WHERE ${live} GROUP BY payment_method`).all(),
    byBranch: db.prepare(`SELECT COALESCE(branch,'—') AS branch, COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue FROM orders WHERE ${live} GROUP BY branch ORDER BY orders DESC`).all(),
    topItems: db.prepare(`SELECT i.name AS name, i.unit AS unit, SUM(i.qty) AS qty FROM order_items i JOIN orders o ON o.id = i.order_id WHERE ${live.replace(/created_at/g,'o.created_at').replace(/status/g,'o.status')} GROUP BY i.name, i.unit ORDER BY qty DESC LIMIT 8`).all(),
  });
});
router.get('/me/history', requireAuth, noStore, (req, res) => {
  if (req.user.role !== 'customer') return res.status(403).json({ error: 'Customer login required' });
  res.json({ orders: db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC').all(req.user.id) });
});
// ---------- public order tracking ----------
// A customer looks their order up by its number only. The reply carries status information
// only (see below), and lookups are throttled per visitor so numbers can't be swept.
const trackHits = new Map(); // visitor -> timestamps of recent lookups
function trackLimiter(req, res, next) {
  const visitor = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const recent = (trackHits.get(visitor) || []).filter(ts => now - ts < 10 * 60 * 1000);
  if (recent.length >= 30) return res.status(429).json({ error: 'Too many lookups — please wait a few minutes and try again' });
  recent.push(now);
  trackHits.set(visitor, recent);
  if (trackHits.size > 5000) { for (const [k, v] of trackHits) if (!v.some(ts => now - ts < 10 * 60 * 1000)) trackHits.delete(k); }
  next();
}
const last9 = (s) => String(s || '').replace(/\D/g, '').slice(-9);

router.get('/track', trackLimiter, noStore, (req, res) => {
  const id = Number(req.query.id);
  const notFound = () => res.status(404).json({ error: "We couldn't find an order with that number. Check it and try again." });
  if (!Number.isInteger(id) || id <= 0) return notFound();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return notFound();
  // Order number alone is enough to track, so the reply is deliberately status-only: no name,
  // phone, address, items or prices — a stranger guessing numbers learns nothing personal.
  res.json({ order: { id: order.id, status: order.status, fulfilment: order.fulfilment, branch: order.branch,
    pickup_time: order.pickup_time, created_at: order.created_at,
    reviewed: !!db.prepare('SELECT 1 FROM reviews WHERE order_id = ?').get(order.id) } });
});

router.get('/:id', requireStaff, noStore, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({ order, items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id) });
});
router.patch('/:id/status', requireStaff, (req, res) => {
  const { status } = req.body;
  const valid = ['received', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled'];
  if (!valid.includes(status)) return res.status(400).json({ error: `status must be one of: ${valid.join(', ')}` });
  const result = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Order not found' });
  db.prepare('INSERT INTO order_status_log (order_id, status) VALUES (?, ?)').run(req.params.id, status);
  res.json({ ok: true });
});
module.exports = router;
