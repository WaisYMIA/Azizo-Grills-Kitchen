const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signCustomerToken, signAdminToken, signStaffToken, SECRET } = require('../middleware/auth');
const jwt = require('jsonwebtoken');
const totp = require('../totp');
function needCode(req, res, body){ if (!totp.enabled() || totp.verify(body.code)) return false; if (!body.code) { res.status(401).json({ error: 'Enter the 6-digit code from your authenticator app', needCode: true }); return true; } bad(req._k, req); res.status(401).json({ error: 'That code is not right or has expired', needCode: true }); return true; }
const crypto = require('crypto');
const router = express.Router();
// v4.1 — login lockout (in memory; this Node backend is the local/phone-test one — the cPanel PHP backend keeps its counters in the database).
const fails = new Map();
function locked(key){ const f = fails.get(key); return f && f.n >= 8 && Date.now() - f.t < 15 * 60e3; }
function bad(key, req){ try { require('../activity').log(req, 'auth', 'login-failed', { actor: key.split(':')[0], outcome: 'fail', detail: key.split(':')[0] + ' sign-in refused' }); } catch (e) {} try { require('../secmon').event(req || {}, 'login-fail', 'low', key.split(':')[0] + ' login failed'); } catch (e) {} bad0(key); }
function bad0(key){ const f = fails.get(key); if (!f || Date.now() - f.t > 15 * 60e3) fails.set(key, { n: 1, t: Date.now() }); else { f.n++; f.t = Date.now(); } }
function same(a, b){ const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
const guard = (scope) => (req, res, next) => { const k = scope + ':' + (req.ip || ''); if (locked(k)) { require('../secmon').event(req, 'lockout', 'med', 'Locked out: ' + scope); return res.status(429).json({ error: 'Too many wrong tries. Please wait 15 minutes and try again.' }); } req._k = k; next(); };
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
  if (!customer || !bcrypt.compareSync(password, customer.password_hash)) { bad(req._k, req); return res.status(401).json({ error: 'Incorrect phone number or password' }); }
  try { require('../activity').log(req, 'auth', 'login', { actor: 'customer #' + customer.id, role: 'customer', detail: 'shop account sign-in' }); } catch (e) {}
  res.json({ token: signCustomerToken(customer), customer: { id: customer.id, name: customer.name, phone: customer.phone } });
});
router.post('/admin-login', guard('admin'), (req, res) => {
  if (sharedOff()) return res.status(403).json({ error: 'Shared passwords are switched off. Sign in with your own username.' });
  const { password } = req.body;
  if (!password || !process.env.ADMIN_PASSWORD || !same(password, process.env.ADMIN_PASSWORD)) { bad(req._k, req); return res.status(401).json({ error: 'Incorrect admin password' }); }
  if (needCode(req, res, req.body || {})) return;
  fails.delete(req._k);
  try { require('../activity').log(req, 'auth', 'login', { actor: 'shared admin password', role: 'owner', detail: 'admin sign-in' }); } catch (e) {}
  res.json({ token: signAdminToken() });
});
// Staff sign in with their own password (STAFF_PASSWORD in .env) — it opens staff.html only
// (orders, stock, today's summary), never the admin tool. Left unset, staff login stays off.
router.post('/staff-login', guard('staff'), (req, res) => {
  if (sharedOff()) return res.status(403).json({ error: 'Shared passwords are switched off. Sign in with your own username.' });
  const { password } = req.body || {};
  if (!process.env.STAFF_PASSWORD) return res.status(503).json({ error: 'Staff login is not set up yet — ask the admin to set STAFF_PASSWORD on the server' });
  if (!password || !same(password, process.env.STAFF_PASSWORD)) { bad(req._k, req); return res.status(401).json({ error: 'Incorrect staff password' }); }
  fails.delete(req._k);
  try { require('../activity').log(req, 'auth', 'login', { actor: 'shared staff password', role: 'staff', detail: 'staff sign-in' }); } catch (e) {}
  res.json({ token: signStaffToken() });
});
// v5.2 personal team accounts (owner, manager, finance, counter). Set TEAM_ONLY=1 to switch the shared admin/staff passwords off once an Owner account exists.
function sharedOff(){ return process.env.TEAM_ONLY === '1' && !!db.prepare("SELECT 1 FROM team_accounts WHERE role = 'owner' AND active = 1").get(); }
router.post('/team-login', guard('team'), (req, res) => {
  const b = req.body || {}, u = String(b.username || '').trim().toLowerCase(), a = db.prepare('SELECT * FROM team_accounts WHERE username = ?').get(u);
  if (!a || !a.active || !bcrypt.compareSync(String(b.password || ''), a.password_hash)) { bad(req._k, req); return res.status(401).json({ error: 'Incorrect username or password' }); }
  if (a.role !== 'counter' && needCode(req, res, b)) return;
  fails.delete(req._k); db.prepare('UPDATE team_accounts SET last_login = ? WHERE id = ?').run(new Date().toISOString().slice(0, 19).replace('T', ' '), a.id);
  const token = jwt.sign({ role: a.role === 'counter' ? 'staff' : 'admin', tr: a.role, uid: a.id, name: a.name }, SECRET, { expiresIn: '12h' });
  try { require('../secmon').audit(req, 'team-login', a.username, a.name + ' (' + a.role + ')'); } catch (e) {}
  res.json({ token, name: a.name, role: a.role });
});
router.post('/team-password', guard('team'), (req, res) => {
  const b = req.body || {}, a = db.prepare('SELECT * FROM team_accounts WHERE username = ? AND active = 1').get(String(b.username || '').trim().toLowerCase()), np = String(b.newPassword || '');
  if (!a || !bcrypt.compareSync(String(b.password || ''), a.password_hash)) { bad(req._k, req); return res.status(401).json({ error: 'Incorrect username or current password' }); }
  if (np.length < 10 || !/[A-Za-z]/.test(np) || !/\d/.test(np)) return res.status(400).json({ error: 'New password needs 10+ characters with a letter and a number' });
  db.prepare('UPDATE team_accounts SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(np, 10), a.id); res.json({ ok: true });
});
module.exports = router;
