// Azizo Operations module (v5.0): analytics, loyalty points, support tickets, privacy requests, SOP library,
// partner dashboard + statements, go-live gate, onboarding checklist, named inspector accounts.
// Mounted at /api/ops. The PHP twin is backend-php/api/ops/index.php (keep the two in step).
const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { requireAuth, requireAdmin, requirePartner, requireKitchen, signInspectorToken } = require('./middleware/auth');
const router = express.Router();

db.exec(`
  CREATE TABLE IF NOT EXISTS ops_events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, day TEXT NOT NULL, name TEXT NOT NULL, branch TEXT DEFAULT '');
  CREATE INDEX IF NOT EXISTS idx_opsev_day ON ops_events(day, name);
  CREATE TABLE IF NOT EXISTS ops_tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT DEFAULT '', scope TEXT NOT NULL, owner_id INTEGER NOT NULL, owner_name TEXT DEFAULT '', subject TEXT NOT NULL, category TEXT DEFAULT 'general', priority TEXT DEFAULT 'normal', status TEXT DEFAULT 'open', created_at TEXT, updated_at TEXT);
  CREATE TABLE IF NOT EXISTS ops_ticket_msgs (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL, from_role TEXT, from_name TEXT, body TEXT NOT NULL, created_at TEXT);
  CREATE TABLE IF NOT EXISTS ops_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, name TEXT DEFAULT '', phone TEXT DEFAULT '', note TEXT DEFAULT '', points INTEGER DEFAULT 0, status TEXT DEFAULT 'open', resolution TEXT DEFAULT '', created_at TEXT, resolved_at TEXT);
  CREATE TABLE IF NOT EXISTS ops_loyalty_adj (id INTEGER PRIMARY KEY AUTOINCREMENT, phone9 TEXT NOT NULL, points INTEGER NOT NULL, note TEXT DEFAULT '', created_at TEXT);
  CREATE TABLE IF NOT EXISTS ops_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, title TEXT DEFAULT '', password_hash TEXT NOT NULL, active INTEGER DEFAULT 1, created_at TEXT, last_login TEXT);
  CREATE TABLE IF NOT EXISTS ops_onboarding (partner_id INTEGER NOT NULL, key TEXT NOT NULL, done INTEGER DEFAULT 0, by_name TEXT DEFAULT '', at TEXT, PRIMARY KEY (partner_id, key));
`);

const nowTs = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, max);
const last9 = s => String(s || '').replace(/\D/g, '').slice(-9);
const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
const hits = new Map();
const limiter = (max, key) => (req, res, next) => {
  const v = key + (String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || 'unknown'), now = Date.now();
  const recent = (hits.get(v) || []).filter(t => now - t < 3600000);
  if (recent.length >= max) return res.status(429).json({ error: 'Too many attempts - please try again later' });
  recent.push(now); hits.set(v, recent); next();
};
const audit = (req, action, detail, actor) => { try { require('./secmon').audit(req, action, detail, actor); } catch (e) {} };

// ---------------- anonymous funnel events (no personal data) ----------------
const EVENTS = ['visit', 'cart_add', 'checkout_open', 'order_placed', 'slot_chosen', 'reorder'];
router.post('/event', limiter(300, 'opsev'), (req, res) => {
  const b = req.body || {}, name = String(b.name || ''); if (!EVENTS.includes(name)) return res.status(400).json({ error: 'Unknown event' });
  const ts = nowTs(); db.prepare('INSERT INTO ops_events (ts, day, name, branch) VALUES (?,?,?,?)').run(ts, ts.slice(0, 10), name, clean(b.branch, 40)); res.json({ ok: true });
});

// ---------------- loyalty (Azizo Rewards) ----------------
// 1 point per KES 100 on completed orders (butchery, partners and Kitchens). 100 points = KES 100 reward, issued by staff after a request.
const TIERS = [{ name: 'Bronze', min: 0 }, { name: 'Silver', min: 300 }, { name: 'Gold', min: 1000 }];
function pointsFor(phone9) {
  if (phone9.length < 9) return { earned: 0, adj: 0 };
  const like = '%' + phone9;
  const a = db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE status = 'completed' AND customer_phone LIKE ?").get(like).s;
  let b = 0; try { b = db.prepare("SELECT COALESCE(SUM(total),0) s FROM kk_orders WHERE status IN ('delivered','completed') AND phone LIKE ?").get(like).s; } catch (e) {}
  const adj = db.prepare('SELECT COALESCE(SUM(points),0) s FROM ops_loyalty_adj WHERE phone9 = ?').get(phone9).s;
  return { earned: Math.floor((a + b) / 100), adj };
}
const tierOf = p => { let t = TIERS[0]; for (const x of TIERS) if (p >= x.min) t = x; const n = TIERS.find(x => x.min > p); return { tier: t.name, next: n ? n.name : '', toNext: n ? n.min - p : 0 }; };
router.get('/loyalty', limiter(40, 'opsloy'), noStore, (req, res) => {
  const phone9 = last9(req.query.phone), no = parseInt(req.query.orderNo, 10) || 0;
  if (phone9.length < 9 || !no) return res.status(400).json({ error: 'Enter your phone number and one of your order numbers' });
  const o = db.prepare('SELECT customer_phone FROM orders WHERE id = ?').get(no);
  if (!o || last9(o.customer_phone) !== phone9) return res.status(404).json({ error: 'We could not match that phone number and order number' });
  const p = pointsFor(phone9), bal = Math.max(0, p.earned + p.adj);
  res.json(Object.assign({ points: bal, earned: p.earned, redeemed: -Math.min(0, p.adj), worthKes: Math.floor(bal / 100) * 100, rule: '1 point per KES 100 on completed orders; 100 points = KES 100 reward' }, tierOf(p.earned)));
});
router.post('/loyalty/redeem', limiter(10, 'opsred'), (req, res) => {
  const b = req.body || {}, phone9 = last9(b.phone), no = parseInt(b.orderNo, 10) || 0, pts = Math.floor(Number(b.points) || 0);
  const o = no && db.prepare('SELECT customer_phone, customer_name FROM orders WHERE id = ?').get(no);
  if (!o || last9(o.customer_phone) !== phone9) return res.status(404).json({ error: 'We could not match that phone number and order number' });
  const p = pointsFor(phone9), bal = p.earned + p.adj; if (pts < 100 || pts % 100 || pts > bal) return res.status(400).json({ error: 'Choose a multiple of 100 points, up to your balance of ' + bal });
  if (db.prepare("SELECT 1 FROM ops_requests WHERE kind = 'reward' AND status = 'open' AND phone = ?").get(phone9)) return res.status(400).json({ error: 'You already have a reward request waiting. We will contact you on WhatsApp.' });
  db.prepare("INSERT INTO ops_requests (kind, name, phone, note, points, created_at) VALUES ('reward', ?, ?, ?, ?, ?)").run(clean(o.customer_name, 60), phone9, 'Reward request', pts, nowTs());
  res.json({ ok: true, message: 'Request received. Azizo will confirm your KES ' + pts + ' reward on WhatsApp.' });
});

// ---------------- privacy requests (Kenya Data Protection Act 2019) ----------------
router.post('/privacy-request', limiter(6, 'opspriv'), (req, res) => {
  const b = req.body || {}, kind = ['delete', 'export', 'stop-marketing'].includes(b.kind) ? b.kind : ''; const phone9 = last9(b.phone);
  if (!kind || phone9.length < 9) return res.status(400).json({ error: 'Choose a request type and enter your phone number' });
  db.prepare('INSERT INTO ops_requests (kind, name, phone, note, created_at) VALUES (?,?,?,?,?)').run(kind, clean(b.name, 60), phone9, clean(b.note, 400), nowTs());
  res.json({ ok: true, message: 'Request received. We will confirm within 7 days.' });
});
router.get('/admin/requests', requireAdmin, noStore, (req, res) => res.json({ requests: db.prepare('SELECT * FROM ops_requests ORDER BY (status = \'open\') DESC, id DESC LIMIT 300').all() }));
router.patch('/admin/requests/:id(\\d+)', requireAdmin, (req, res) => {
  const r = db.prepare('SELECT * FROM ops_requests WHERE id = ?').get(req.params.id); if (!r) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {}, st = b.status === 'done' || b.status === 'declined' ? b.status : ''; if (!st) return res.status(400).json({ error: 'Choose done or declined' });
  if (st === 'done' && r.kind === 'reward') { const bal = (() => { const p = pointsFor(r.phone); return p.earned + p.adj; })(); if (bal < r.points) return res.status(400).json({ error: 'Customer balance is now only ' + bal }); db.prepare('INSERT INTO ops_loyalty_adj (phone9, points, note, created_at) VALUES (?,?,?,?)').run(r.phone, -r.points, 'Reward #' + r.id, nowTs()); }
  db.prepare('UPDATE ops_requests SET status = ?, resolution = ?, resolved_at = ? WHERE id = ?').run(st, clean(b.resolution, 300), nowTs(), r.id); audit(req, 'request-' + st, r.kind + ' #' + r.id); res.json({ ok: true });
});

// ---------------- support tickets (partners and Kitchens) ----------------
const who = req => req.user.role === 'partner' ? { scope: 'partner', id: req.user.partnerId } : { scope: 'kitchen', id: req.user.kitchenId };
function requireOwner(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role === 'partner' && req.user.partnerId) return next();
    if (req.user.role === 'kitchen' && req.user.kitchenId) return next();
    res.status(403).json({ error: 'Partner or kitchen access required' });
  });
}
function ownerName(w) {
  try { if (w.scope === 'partner') return (db.prepare('SELECT name FROM mk_partners WHERE id = ?').get(w.id) || {}).name || ''; return (db.prepare('SELECT name FROM kk_kitchens WHERE id = ?').get(w.id) || {}).name || ''; } catch (e) { return ''; }
}
const CATS = ['general', 'payment', 'order-problem', 'hygiene', 'supplies', 'technical', 'complaint'];
router.get('/tickets', requireOwner, noStore, (req, res) => { const w = who(req); res.json({ tickets: db.prepare('SELECT * FROM ops_tickets WHERE scope = ? AND owner_id = ? ORDER BY id DESC LIMIT 100').all(w.scope, w.id) }); });
router.post('/tickets', requireOwner, limiter(30, 'opstk'), (req, res) => {
  const w = who(req), b = req.body || {}, subject = clean(b.subject, 120), body = clean(b.body, 2000);
  if (subject.length < 4 || body.length < 5) return res.status(400).json({ error: 'Add a subject and a message' });
  const ts = nowTs(), name = ownerName(w), r = db.prepare('INSERT INTO ops_tickets (scope, owner_id, owner_name, subject, category, priority, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run(w.scope, w.id, name, subject, CATS.includes(b.category) ? b.category : 'general', b.priority === 'urgent' ? 'urgent' : 'normal', ts, ts);
  const ref = 'SUP-' + String(r.lastInsertRowid).padStart(5, '0'); db.prepare('UPDATE ops_tickets SET ref = ? WHERE id = ?').run(ref, r.lastInsertRowid);
  db.prepare('INSERT INTO ops_ticket_msgs (ticket_id, from_role, from_name, body, created_at) VALUES (?,?,?,?,?)').run(r.lastInsertRowid, w.scope, name, body, ts);
  res.json({ ok: true, ref, id: Number(r.lastInsertRowid) });
});
function ticketFor(req, res) { const w = who(req), t = db.prepare('SELECT * FROM ops_tickets WHERE id = ? AND scope = ? AND owner_id = ?').get(req.params.id, w.scope, w.id); if (!t) res.status(404).json({ error: 'Not found' }); return t; }
router.get('/tickets/:id(\\d+)', requireOwner, noStore, (req, res) => { const t = ticketFor(req, res); if (t) res.json({ ticket: t, messages: db.prepare('SELECT from_role, from_name, body, created_at FROM ops_ticket_msgs WHERE ticket_id = ? ORDER BY id').all(t.id) }); });
router.post('/tickets/:id(\\d+)/reply', requireOwner, limiter(60, 'opstr'), (req, res) => {
  const t = ticketFor(req, res); if (!t) return; const body = clean((req.body || {}).body, 2000); if (body.length < 2) return res.status(400).json({ error: 'Write a message' });
  const ts = nowTs(); db.prepare('INSERT INTO ops_ticket_msgs (ticket_id, from_role, from_name, body, created_at) VALUES (?,?,?,?,?)').run(t.id, t.scope, t.owner_name, body, ts); db.prepare("UPDATE ops_tickets SET status = 'open', updated_at = ? WHERE id = ?").run(ts, t.id); res.json({ ok: true });
});
router.get('/admin/tickets', requireAdmin, noStore, (req, res) => res.json({ tickets: db.prepare("SELECT * FROM ops_tickets ORDER BY (status = 'closed'), (priority = 'urgent') DESC, updated_at DESC LIMIT 300").all(), open: db.prepare("SELECT COUNT(*) n FROM ops_tickets WHERE status = 'open'").get().n }));
router.get('/admin/tickets/:id(\\d+)', requireAdmin, noStore, (req, res) => { const t = db.prepare('SELECT * FROM ops_tickets WHERE id = ?').get(req.params.id); if (!t) return res.status(404).json({ error: 'Not found' }); res.json({ ticket: t, messages: db.prepare('SELECT from_role, from_name, body, created_at FROM ops_ticket_msgs WHERE ticket_id = ? ORDER BY id').all(t.id) }); });
router.post('/admin/tickets/:id(\\d+)/reply', requireAdmin, (req, res) => {
  const t = db.prepare('SELECT * FROM ops_tickets WHERE id = ?').get(req.params.id); if (!t) return res.status(404).json({ error: 'Not found' }); const b = req.body || {}, body = clean(b.body, 2000), ts = nowTs();
  if (body.length >= 2) db.prepare('INSERT INTO ops_ticket_msgs (ticket_id, from_role, from_name, body, created_at) VALUES (?,?,?,?,?)').run(t.id, 'azizo', 'Azizo head office', body, ts);
  const st = b.close ? 'closed' : (body.length >= 2 ? 'answered' : t.status); db.prepare('UPDATE ops_tickets SET status = ?, updated_at = ? WHERE id = ?').run(st, ts, t.id); audit(req, 'ticket-' + st, t.ref); res.json({ ok: true });
});

// ---------------- SOP library ----------------
const SOP_DIR = path.join(__dirname, 'sop');
function sopList() {
  let out = []; try { out = fs.readdirSync(SOP_DIR).filter(f => /^[A-Z]\d\d-[a-z0-9-]+\.md$/.test(f)).sort(); } catch (e) {}
  return out.map(f => { const t = fs.readFileSync(path.join(SOP_DIR, f), 'utf8'); const m = /^Scope:\s*(.+)$/m.exec(t); return { id: f.replace(/\.md$/, ''), code: f.slice(0, 3), title: (/^#\s+(.+)$/m.exec(t) || [, f])[1], scope: m ? m[1].trim() : 'all' }; });
}
function requireSopReader(req, res, next) { requireAuth(req, res, () => { if (['partner', 'kitchen', 'inspector', 'admin', 'kitchens'].includes(req.user.role)) return next(); res.status(403).json({ error: 'Sign in to a partner, kitchen or Azizo account to read the SOPs' }); }); }
router.get('/sops', requireSopReader, noStore, (req, res) => res.json({ sops: sopList() }));
router.get('/sops/:id', requireSopReader, noStore, (req, res) => {
  const f = String(req.params.id); if (!/^[A-Z]\d\d-[a-z0-9-]+$/.test(f)) return res.status(400).json({ error: 'Bad id' });
  try { res.json({ id: f, markdown: fs.readFileSync(path.join(SOP_DIR, f + '.md'), 'utf8') }); } catch (e) { res.status(404).json({ error: 'Not found' }); }
});

// ---------------- partner dashboard + statements ----------------
const ymd = d => d.toISOString().slice(0, 10);
router.get('/partner/dashboard', requirePartner, noStore, (req, res) => {
  const pid = req.user.partnerId, now = new Date(), t0 = ymd(now), d7 = ymd(new Date(now - 6 * 86400000)), d30 = ymd(new Date(now - 29 * 86400000));
  const sum = (from) => db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM orders WHERE partner_id = ? AND status != 'cancelled' AND substr(created_at,1,10) >= ?").get(pid, from);
  const open = db.prepare("SELECT COUNT(*) n FROM orders WHERE partner_id = ? AND status IN ('received','preparing','ready','out_for_delivery')").get(pid).n;
  const daily = db.prepare("SELECT substr(created_at,1,10) d, COUNT(*) n, COALESCE(SUM(total),0) s FROM orders WHERE partner_id = ? AND status != 'cancelled' AND substr(created_at,1,10) >= ? GROUP BY d ORDER BY d").all(pid, d7);
  const top = db.prepare("SELECT oi.name, SUM(oi.qty) q, SUM(oi.line_total) s FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.partner_id = ? AND o.status != 'cancelled' AND substr(o.created_at,1,10) >= ? GROUP BY oi.name ORDER BY s DESC LIMIT 5").all(pid, d30);
  const rate = db.prepare("SELECT COUNT(*) n, AVG(r.rating) a FROM reviews r JOIN orders o ON o.id = r.order_id WHERE o.partner_id = ? AND r.status != 'rejected'").get(pid);
  const done = db.prepare("SELECT COUNT(*) n FROM orders WHERE partner_id = ? AND status = 'completed' AND substr(created_at,1,10) >= ?").get(pid, d30).n, canc = db.prepare("SELECT COUNT(*) n FROM orders WHERE partner_id = ? AND status = 'cancelled' AND substr(created_at,1,10) >= ?").get(pid, d30).n;
  const out = db.prepare('SELECT COUNT(*) n FROM mk_partner_items WHERE partner_id = ? AND in_stock = 0').get(pid).n, listed = db.prepare('SELECT COUNT(*) n FROM mk_partner_items WHERE partner_id = ?').get(pid).n;
  const tk = db.prepare("SELECT COUNT(*) n FROM ops_tickets WHERE scope = 'partner' AND owner_id = ? AND status = 'answered'").get(pid).n;
  const p = db.prepare('SELECT status, last_inspection FROM mk_partners WHERE id = ?').get(pid) || {};
  res.json({ today: sum(t0), week: sum(d7), month: sum(d30), openOrders: open, daily, top, rating: { count: rate.n, avg: rate.a ? Math.round(rate.a * 10) / 10 : null }, completionPct30: done + canc ? Math.round(done * 100 / (done + canc)) : null, itemsListed: listed, itemsSoldOut: out, answeredTickets: tk, status: p.status, nextInspection: p.last_inspection || '' });
});
router.get('/partner/statement', requirePartner, noStore, (req, res) => {
  const pid = req.user.partnerId, from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : ymd(new Date(Date.now() - 29 * 86400000)), to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : ymd(new Date());
  const rows = db.prepare("SELECT o.id, substr(o.created_at,1,10) d, o.status, o.items_subtotal, o.delivery_fee, o.total, COALESCE(f.fee,0) fee FROM orders o LEFT JOIN mk_order_fees f ON f.order_id = o.id WHERE o.partner_id = ? AND substr(o.created_at,1,10) BETWEEN ? AND ? ORDER BY o.id").all(pid, from, to);
  const ok = rows.filter(r => r.status !== 'cancelled'), tot = ok.reduce((a, r) => ({ gross: a.gross + r.total, fee: a.fee + r.fee }), { gross: 0, fee: 0 }); tot.net = tot.gross - tot.fee; tot.orders = ok.length; tot.cancelled = rows.length - ok.length;
  if (req.query.format === 'csv') { const q = v => '"' + String(v).replace(/"/g, '""') + '"'; res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="azizo-statement-' + from + '-to-' + to + '.csv"');
    return res.send(['Order,Date,Status,Items,Delivery,Total,Azizo fee,Net to you'].concat(rows.map(r => [r.id, r.d, r.status, r.items_subtotal, r.delivery_fee, r.total, r.fee, r.status === 'cancelled' ? 0 : r.total - r.fee].map(q).join(','))).join('\n')); }
  const p = db.prepare('SELECT name, owner, phone FROM mk_partners WHERE id = ?').get(pid) || {};
  res.json({ partner: p, from, to, rows, totals: tot, note: 'Customers pay you directly. "Azizo fee" is what Azizo invoices you for these orders.' });
});

// ---------------- onboarding checklist + go-live gate ----------------
const ONB = [['sop_read', 'SOP handbook read and signed by owner'], ['training', 'Food-safety and brand training completed'], ['contract', 'Partner agreement signed'], ['premises', 'Premises photographed and address confirmed'], ['payments', 'Till / M-Pesa details verified']];
function gateFor(pid) {
  const p = db.prepare('SELECT * FROM mk_partners WHERE id = ?').get(pid) || {}, last = db.prepare('SELECT score, result, critical_fails FROM mk_inspections WHERE partner_id = ? ORDER BY id DESC LIMIT 1').get(pid);
  const done = Object.fromEntries(db.prepare('SELECT key, done FROM ops_onboarding WHERE partner_id = ?').all(pid).map(r => [r.key, !!r.done]));
  const items = db.prepare('SELECT COUNT(*) n FROM mk_partner_items WHERE partner_id = ?').get(pid).n;
  const checks = [{ key: 'licence', label: 'Business licence and health certificate verified', ok: !!p.licence_verified && !!p.health_cert_no },
    { key: 'inspection', label: 'Premises inspection passed (score 70+ with no critical fail)', ok: !!last && last.score >= 70 && !last.critical_fails },
    { key: 'items', label: 'At least 5 items listed with prices', ok: items >= 5 }]
    .concat(ONB.map(o => ({ key: o[0], label: o[1], ok: !!done[o[0]], manual: true })));
  return { ok: checks.every(c => c.ok), checks, partnerStatus: p.status };
}
router.get('/admin/gate/:id(\\d+)', requireAdmin, noStore, (req, res) => res.json(gateFor(Number(req.params.id))));
router.put('/admin/onboarding/:id(\\d+)', requireAdmin, (req, res) => {
  const k = String((req.body || {}).key || ''); if (!ONB.some(o => o[0] === k)) return res.status(400).json({ error: 'Unknown step' });
  db.prepare('INSERT INTO ops_onboarding (partner_id, key, done, by_name, at) VALUES (?,?,?,?,?) ON CONFLICT(partner_id, key) DO UPDATE SET done = excluded.done, by_name = excluded.by_name, at = excluded.at').run(req.params.id, k, (req.body || {}).done ? 1 : 0, 'admin', nowTs()); audit(req, 'onboarding', 'partner ' + req.params.id + ' ' + k + '=' + ((req.body || {}).done ? 1 : 0)); res.json({ ok: true });
});
router.get('/partner/onboarding', requirePartner, noStore, (req, res) => res.json(gateFor(req.user.partnerId)));

// ---------------- named inspector accounts ----------------
router.get('/admin/accounts', requireAdmin, noStore, (req, res) => res.json({ accounts: db.prepare('SELECT id, username, name, title, active, created_at, last_login FROM ops_accounts ORDER BY id').all() }));
router.post('/admin/accounts', requireAdmin, (req, res) => {
  const b = req.body || {}, u = clean(b.username, 30).toLowerCase(), n = clean(b.name, 60), pw = String(b.password || '');
  if (!/^[a-z0-9._-]{3,30}$/.test(u) || n.length < 3 || pw.length < 8) return res.status(400).json({ error: 'Username (3+ letters/numbers), full name and a password of 8+ characters are needed' });
  if (db.prepare('SELECT 1 FROM ops_accounts WHERE username = ?').get(u)) return res.status(400).json({ error: 'That username is taken' });
  db.prepare('INSERT INTO ops_accounts (username, name, title, password_hash, created_at) VALUES (?,?,?,?,?)').run(u, n, clean(b.title, 60), bcrypt.hashSync(pw, 10), nowTs()); audit(req, 'account-create', u); res.json({ ok: true });
});
router.patch('/admin/accounts/:id(\\d+)', requireAdmin, (req, res) => {
  const a = db.prepare('SELECT * FROM ops_accounts WHERE id = ?').get(req.params.id); if (!a) return res.status(404).json({ error: 'Not found' }); const b = req.body || {};
  if (b.password !== undefined && String(b.password).length < 8) return res.status(400).json({ error: 'Password must be 8+ characters' });
  db.prepare('UPDATE ops_accounts SET active = ?, password_hash = ? WHERE id = ?').run(b.active === undefined ? a.active : (b.active ? 1 : 0), b.password ? bcrypt.hashSync(String(b.password), 10) : a.password_hash, a.id); audit(req, 'account-update', a.username); res.json({ ok: true });
});
// used by routes/market.js inspector login
function accountLogin(username, password) {
  const a = db.prepare('SELECT * FROM ops_accounts WHERE username = ? AND active = 1').get(String(username || '').trim().toLowerCase());
  if (!a || !bcrypt.compareSync(String(password || ''), a.password_hash)) return null;
  db.prepare('UPDATE ops_accounts SET last_login = ? WHERE id = ?').run(nowTs(), a.id); return { name: a.name, title: a.title, token: signInspectorToken(a.name) };
}

// ---------------- analytics (admin) ----------------
router.get('/admin/analytics', requireAdmin, noStore, (req, res) => {
  const days = Math.max(1, Math.min(365, parseInt(req.query.days, 10) || 30)), from = ymd(new Date(Date.now() - (days - 1) * 86400000));
  const base = "FROM orders WHERE status != 'cancelled' AND substr(created_at,1,10) >= ?";
  const t = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(total),0) s ' + base).get(from), canc = db.prepare("SELECT COUNT(*) n FROM orders WHERE status = 'cancelled' AND substr(created_at,1,10) >= ?").get(from).n;
  const daily = db.prepare('SELECT substr(created_at,1,10) d, COUNT(*) n, COALESCE(SUM(total),0) s ' + base + ' GROUP BY d ORDER BY d').all(from);
  const hrs = Array(24).fill(0); db.prepare('SELECT CAST(substr(created_at,12,2) AS INTEGER) h, COUNT(*) n ' + base + ' GROUP BY h').all(from).forEach(r => { hrs[(r.h + 3) % 24] += r.n; });
  const top = db.prepare("SELECT oi.name, SUM(oi.qty) q, SUM(oi.line_total) s FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status != 'cancelled' AND substr(o.created_at,1,10) >= ? GROUP BY oi.name ORDER BY s DESC LIMIT 10").all(from);
  const byBranch = db.prepare("SELECT COALESCE(NULLIF(branch,''),'(delivery/other)') b, COUNT(*) n, COALESCE(SUM(total),0) s " + base + ' GROUP BY b ORDER BY s DESC').all(from);
  const ful = db.prepare('SELECT fulfilment f, COUNT(*) n ' + base + ' GROUP BY f').all(from);
  const ph = db.prepare('SELECT customer_phone p, COUNT(*) n ' + base + ' GROUP BY p').all(from), repeat = ph.filter(x => x.n > 1).length;
  let kk = { orders: 0, revenue: 0, cancelled: 0 }; try { const k = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM kk_orders WHERE status NOT IN ('cancelled','rejected') AND substr(created_at,1,10) >= ?").get(from); kk = { orders: k.n, revenue: k.s, cancelled: db.prepare("SELECT COUNT(*) n FROM kk_orders WHERE status IN ('cancelled','rejected') AND substr(created_at,1,10) >= ?").get(from).n }; } catch (e) {}
  const ev = Object.fromEntries(db.prepare('SELECT name, COUNT(*) n FROM ops_events WHERE day >= ? GROUP BY name').all(from).map(r => [r.name, r.n]));
  const rv = db.prepare("SELECT COUNT(*) n, AVG(rating) a FROM reviews WHERE status != 'rejected' AND substr(created_at,1,10) >= ?").get(from);
  const conv = (a, b) => a ? Math.round(b * 1000 / a) / 10 : null;
  res.json({ days, from, orders: t.n, revenue: t.s, aov: t.n ? Math.round(t.s / t.n) : 0, cancelled: canc, cancelPct: t.n + canc ? Math.round(canc * 1000 / (t.n + canc)) / 10 : 0, customers: ph.length, repeatCustomers: repeat, repeatPct: ph.length ? Math.round(repeat * 1000 / ph.length) / 10 : 0,
    daily, hoursEAT: hrs, top, byBranch, fulfilment: ful, kitchens: kk, funnel: { visits: ev.visit || 0, cartAdds: ev.cart_add || 0, checkouts: ev.checkout_open || 0, placed: ev.order_placed || 0, visitToCartPct: conv(ev.visit, ev.cart_add), cartToCheckoutPct: conv(ev.cart_add, ev.checkout_open), checkoutToOrderPct: conv(ev.checkout_open, ev.order_placed) }, rating: { count: rv.n, avg: rv.a ? Math.round(rv.a * 10) / 10 : null }, openTickets: db.prepare("SELECT COUNT(*) n FROM ops_tickets WHERE status = 'open'").get().n, openRequests: db.prepare("SELECT COUNT(*) n FROM ops_requests WHERE status = 'open'").get().n });
});

module.exports = { router, gateFor, accountLogin };
