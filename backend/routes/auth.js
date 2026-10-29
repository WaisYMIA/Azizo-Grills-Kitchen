const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signCustomerToken, signAdminToken, signStaffToken } = require('../middleware/auth');
const crypto = require('crypto');
const router = express.Router();
// v4.1 — login lockout (in memory; this Node backend is the local/phone-test one — the cPanel PHP backend keeps its counters in the database).
const fails = new Map();
function locked(key){ const f = fails.get(key); return f && f.n >= 8 && Date.now() - f.t < 15 * 60e3; }
function bad(key){ const f = fails.get(key); if (!f || Date.now() - f.t > 15 * 60e3) fails.set(key, { n: 1, t: Date.now() }); else { f.n++; f.t = Date.now(); } }
function same(a, b){ const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
const guard = (scope) => (req, res, next) => { const k = scope + ':' + (req.ip || ''); if (locked(k)) return res.status(429).json({ error: 'Too many wrong tries. Please wait 15 minutes and try again.' }); req._k = k; next(); };
router.post('/register', (req, res) => {
  const { name, phone, password } = req.body;
  if (!name || !phone || !password) return res.status(400).json({ error: 'name, phone, and password are all required' });
  if (String(password).length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return res.status(400).json({ error: 'Password must be at least 8 characters with a letter and a number' });
  const existing = db.prepare('SELECT id FROM customers WHERE phone = ?').get(phone);
  if (existing) return res.status(409).json({ error: 'An account with this phone number already exists' });
  const password_hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO customers (name, phone, password_hash) VALUES (?, ?, ?)').run(name, phone, password_hash);
  const customer = { id: result.lastInsertRowid, name, phone };
  res.status(201).json({ token: signCustomerToken(customer), customer });
});
router.post('/login', guard('cust'), (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ error: 'phone and password are required' });
  const customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
  if (!customer || !bcrypt.compareSync(password, customer.password_hash)) { bad(req._k); return res.status(401).json({ error: 'Incorrect phone number or password' }); }
  res.json({ token: signCustomerToken(customer), customer: { id: customer.id, name: customer.name, phone: customer.phone } });
});
router.post('/admin-login', guard('admin'), (req, res) => {
  const { password } = req.body;
  if (!password || !process.env.ADMIN_PASSWORD || !same(password, process.env.ADMIN_PASSWORD)) { bad(req._k); return res.status(401).json({ error: 'Incorrect admin password' }); }
  fails.delete(req._k);
  res.json({ token: signAdminToken() });
});
// Staff sign in with their own password (STAFF_PASSWORD in .env) — it opens staff.html only
// (orders, stock, today's summary), never the admin tool. Left unset, staff login stays off.
router.post('/staff-login', guard('staff'), (req, res) => {
  const { password } = req.body || {};
  if (!process.env.STAFF_PASSWORD) return res.status(503).json({ error: 'Staff login is not set up yet — ask the admin to set STAFF_PASSWORD on the server' });
  if (!password || !same(password, process.env.STAFF_PASSWORD)) { bad(req._k); return res.status(401).json({ error: 'Incorrect staff password' }); }
  fails.delete(req._k);
  res.json({ token: signStaffToken() });
});
module.exports = router;
