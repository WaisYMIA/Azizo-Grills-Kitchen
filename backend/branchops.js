// Azizo Branch Operations (v6.1): branch scorecard, purchases and waste, margins, franchisee pipeline, royalty statements, operations manual.
const express = require('express'), fs = require('fs'), path = require('path'), crypto = require('crypto'), bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken');
const db = require('./db');
const { requireAdmin } = require('./middleware/auth');
const PB = require('./data/playbook.json');
const router = express.Router();
const TZ = Number.isFinite(Number(process.env.TZ_OFFSET_HOURS)) ? Number(process.env.TZ_OFFSET_HOURS) : 3;
db.exec(`
CREATE TABLE IF NOT EXISTS bo_settings (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS bo_purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, branch TEXT NOT NULL, supplier TEXT DEFAULT '', product TEXT NOT NULL, kg REAL NOT NULL, cost INTEGER NOT NULL, ref TEXT DEFAULT '', by_name TEXT DEFAULT '', created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_bo_pur ON bo_purchases(branch, day);
CREATE TABLE IF NOT EXISTS bo_waste (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, branch TEXT NOT NULL, product TEXT NOT NULL, kg REAL NOT NULL, reason TEXT DEFAULT 'other', note TEXT DEFAULT '', by_name TEXT DEFAULT '', created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_bo_was ON bo_waste(branch, day);
CREATE TABLE IF NOT EXISTS bo_yield (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, branch TEXT NOT NULL, product TEXT NOT NULL, kg_in REAL NOT NULL, kg_out REAL NOT NULL, trim_kg REAL DEFAULT 0, note TEXT DEFAULT '', by_name TEXT DEFAULT '', created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_bo_yld ON bo_yield(branch, day);
CREATE TABLE IF NOT EXISTS bo_rejects (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, branch TEXT NOT NULL, supplier TEXT NOT NULL, product TEXT DEFAULT '', kg REAL NOT NULL, reason TEXT DEFAULT 'other', note TEXT DEFAULT '', by_name TEXT DEFAULT '', created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_bo_rej ON bo_rejects(branch, day);
CREATE TABLE IF NOT EXISTS bo_reminders (id INTEGER PRIMARY KEY AUTOINCREMENT, royalty_id INTEGER NOT NULL, at TEXT, by_name TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS bo_portal (franchisee_id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, active INTEGER DEFAULT 1, last_login TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS bo_franchisees (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT DEFAULT '', email TEXT DEFAULT '', branch_id TEXT DEFAULT '', enquiry_id INTEGER, stage TEXT DEFAULT 'enquiry', agreement_at TEXT, fee_paid_at TEXT, royalty_pct REAL, notes TEXT DEFAULT '', created_by TEXT DEFAULT '', created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS bo_royalties (id INTEGER PRIMARY KEY AUTOINCREMENT, franchisee_id INTEGER NOT NULL, period TEXT NOT NULL, gross INTEGER NOT NULL, refunds INTEGER DEFAULT 0, royalty_pct REAL, royalty INTEGER, marketing_pct REAL, marketing INTEGER, total INTEGER, orders INTEGER DEFAULT 0, status TEXT DEFAULT 'issued', issued_at TEXT, paid_at TEXT, note TEXT DEFAULT '', UNIQUE(franchisee_id, period));
`);
const DEF = { margin_target_pct: '30', waste_target_pct: '3', marketing_pct: '0', compliance_target_pct: '90', royalty_due_days: '14' };
const settings = () => { const o = { ...DEF }; for (const r of db.prepare('SELECT k, v FROM bo_settings').all()) if (r.k in DEF) o[r.k] = r.v; return o; };
const growthSet = () => { const o = {}; try { for (const r of db.prepare("SELECT k, v FROM ops_settings WHERE k IN ('franchise_royalty_pct','franchise_fee','franchise_term_years')").all()) o[r.k] = r.v; } catch (e) {} return { royalty: Number(o.franchise_royalty_pct || 5), fee: Number(o.franchise_fee || 300000), term: Number(o.franchise_term_years || 5) }; };
const nowTs = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const eatDay = (ms = Date.now()) => new Date(ms + TZ * 3600000).toISOString().slice(0, 10);
const okDay = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const bound = day => new Date(Date.parse(day + 'T00:00:00Z') - TZ * 3600000).toISOString().slice(0, 19).replace('T', ' ');
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, n);
const who = req => (req.user && req.user.name) || 'admin';
const audit = (req, a, d) => { try { require('./secmon').audit(req, a, d, who(req)); } catch (e) {} };
const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
const branchOf = id => db.prepare('SELECT * FROM branches WHERE id = ?').get(String(id || ''));
const range = q => { let to = okDay(q.to) ? q.to : eatDay(), from = okDay(q.from) ? q.from : addDays(to, -29); if (from > to) [from, to] = [to, from]; if (Date.parse(to) - Date.parse(from) > 366 * 86400000) from = addDays(to, -366); return { from, to, days: Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1 }; };
const ordersFor = (b, from, to) => db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS gross, COALESCE(SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END),0) AS cancelled FROM orders WHERE (branch = ? OR branch = ?) AND created_at >= ? AND created_at < ?").get(b.id, b.name, bound(from), bound(addDays(to, 1)));
const salesFor = (b, from, to) => db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS gross FROM orders WHERE (branch = ? OR branch = ?) AND status = 'completed' AND created_at >= ? AND created_at < ?").get(b.id, b.name, bound(from), bound(addDays(to, 1)));
const refundsFor = (b, from, to) => { try { return db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(r.amount_ok),0) AS amt FROM ops_refunds r JOIN orders o ON o.id = r.order_id WHERE (o.branch = ? OR o.branch = ?) AND r.status IN ('approved','paid') AND o.created_at >= ? AND o.created_at < ?").get(b.id, b.name, bound(from), bound(addDays(to, 1))); } catch (e) { return { n: 0, amt: 0 }; } };

// ---------- settings ----------
router.get('/settings', requireAdmin, noStore, (req, res) => res.json({ ...settings(), system: growthSet() }));
router.put('/settings', requireAdmin, (req, res) => {
  const b = req.body || {};
  for (const k of Object.keys(DEF)) if (b[k] !== undefined) { const v = Number(b[k]); if (isNaN(v) || v < 0 || v > 100) return res.status(400).json({ error: k + ' must be between 0 and 100' }); db.prepare('INSERT INTO bo_settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, String(v)); }
  audit(req, 'branchops-settings', Object.keys(b).join(',')); res.json({ ok: true, ...settings() });
});

// ---------- scorecard ----------
const scoreRow = (b, r, s, expected) => {
    const sales = salesFor(b, r.from, r.to), all = ordersFor(b, r.from, r.to), ref = refundsFor(b, r.from, r.to);
    const comp = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN attention>0 AND resolved=0 THEN 1 ELSE 0 END),0) AS open FROM pb_runs WHERE branch = ? AND status = 'complete' AND code != 'weekly' AND run_date BETWEEN ? AND ?").get(b.id, r.from, r.to);
    const cash = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(ABS(variance)),0) AS gap, COALESCE(SUM(CASE WHEN variance <> 0 THEN 1 ELSE 0 END),0) AS gapdays FROM ops_cashups WHERE (branch = ? OR branch = ?) AND day BETWEEN ? AND ?").get(b.id, b.name, r.from, r.to);
    const pur = db.prepare('SELECT COALESCE(SUM(kg),0) AS kg, COALESCE(SUM(cost),0) AS cost FROM bo_purchases WHERE branch = ? AND day BETWEEN ? AND ?').get(b.id, r.from, r.to);
    const was = db.prepare('SELECT COALESCE(SUM(kg),0) AS kg FROM bo_waste WHERE branch = ? AND day BETWEEN ? AND ?').get(b.id, r.from, r.to);
    const yl = db.prepare('SELECT COALESCE(SUM(kg_in),0) AS i, COALESCE(SUM(kg_out),0) AS o FROM bo_yield WHERE branch = ? AND day BETWEEN ? AND ?').get(b.id, r.from, r.to);
    const trained = new Set(db.prepare("SELECT staff_name, staff_ref FROM pb_training WHERE branch = ? AND passed = 1 AND practical = 1 AND taken_at >= datetime('now','-12 months')").all(b.id).map(x => x.staff_ref || x.staff_name.toLowerCase())).size;
    const pct = (a, d) => d ? Math.round(1000 * a / d) / 10 : null;
    const row = { branch: b.id, name: b.name, listed: !!b.listed, orders: sales.n, sales: sales.gross, avgOrder: sales.n ? Math.round(sales.gross / sales.n) : 0, cancelledPct: pct(all.cancelled, all.n), refundCount: ref.n, refundAmount: ref.amt, refundPct: pct(ref.amt, sales.gross),
      compliancePct: pct(comp.n, expected), openCritical: comp.open, cashDays: cash.n, cashGapDays: cash.gapdays, cashGapTotal: cash.gap, certifiedStaff: trained, purchases: pur.cost, purchasedKg: Math.round(pur.kg * 10) / 10, wasteKg: Math.round(was.kg * 10) / 10, wastePct: pct(was.kg, pur.kg), foodCostPct: pct(pur.cost, sales.gross), yieldPct: pct(yl.o, yl.i) };
    const flags = [];
    if (row.compliancePct != null && row.compliancePct < Number(s.compliance_target_pct)) flags.push('Checklists below ' + s.compliance_target_pct + '%');
    if (row.compliancePct == null || row.compliancePct === 0) { if (b.listed) flags.push('No checklists done'); }
    if (row.openCritical) flags.push(row.openCritical + ' critical failure(s) open');
    if (row.wastePct != null && row.wastePct > Number(s.waste_target_pct)) flags.push('Waste above ' + s.waste_target_pct + '%');
    if (row.foodCostPct != null && row.foodCostPct > 100 - Number(s.margin_target_pct)) flags.push('Food cost above ' + (100 - Number(s.margin_target_pct)) + '% of sales');
    if (row.cashGapDays) flags.push(row.cashGapDays + ' day(s) with a cash gap');
    row.flags = flags; row.status = flags.length === 0 ? 'green' : (row.openCritical || flags.length >= 3 ? 'red' : 'amber'); return row;
  
};
router.get('/scorecard', requireAdmin, noStore, (req, res) => {
  const r = range(req.query), s = settings(), out = [];
  const expected = r.days * PB.checklists.filter(c => c.shift !== 'weekly').length;
  for (const b of db.prepare('SELECT * FROM branches ORDER BY is_main DESC, sort_order, name').all()) out.push(scoreRow(b, r, s, expected));
  res.json({ from: r.from, to: r.to, days: r.days, targets: s, branches: out });
});

// ---------- purchases and waste ----------
const lastRows = (table, q) => { const r = range(q), b = q.branch ? branchOf(q.branch) : null; if (q.branch && !b) return null; const rows = db.prepare(`SELECT * FROM ${table} WHERE day BETWEEN ? AND ? ${b ? 'AND branch = ?' : ''} ORDER BY day DESC, id DESC LIMIT 500`).all(...[r.from, r.to].concat(b ? [b.id] : [])); return { from: r.from, to: r.to, rows }; };
router.get('/purchases', requireAdmin, noStore, (req, res) => { const o = lastRows('bo_purchases', req.query); if (!o) return res.status(400).json({ error: 'Unknown branch' }); res.json({ ...o, totals: { kg: Math.round(o.rows.reduce((a, x) => a + x.kg, 0) * 10) / 10, cost: o.rows.reduce((a, x) => a + x.cost, 0) } }); });
router.post('/purchases', requireAdmin, (req, res) => {
  const b = req.body || {}, br = branchOf(b.branch), kg = Number(b.kg), cost = Math.round(Number(b.cost)), day = okDay(b.day) ? b.day : eatDay();
  if (!br) return res.status(400).json({ error: 'Choose a branch' }); if (clean(b.product, 80).length < 2) return res.status(400).json({ error: 'Write the product or cut' });
  if (!(kg > 0 && kg <= 5000)) return res.status(400).json({ error: 'Weight in kg must be between 0 and 5000' }); if (!(cost > 0 && cost <= 50000000)) return res.status(400).json({ error: 'Cost must be an amount in KSh' });
  if (day > eatDay() || day < addDays(eatDay(), -60)) return res.status(400).json({ error: 'Date must be within the last 60 days and not in the future' });
  const id = db.prepare('INSERT INTO bo_purchases (day, branch, supplier, product, kg, cost, ref, by_name, created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(day, br.id, clean(b.supplier, 80), clean(b.product, 80), kg, cost, clean(b.ref, 40), who(req), nowTs()).lastInsertRowid;
  audit(req, 'purchase-add', `${br.id} ${clean(b.product, 40)} ${kg}kg KSh${cost}`); res.status(201).json({ ok: true, id: Number(id) });
});
router.delete('/purchases/:id(\\d+)', requireAdmin, (req, res) => { const r = db.prepare('SELECT * FROM bo_purchases WHERE id = ?').get(req.params.id); if (!r) return res.status(404).json({ error: 'Not found' }); db.prepare('DELETE FROM bo_purchases WHERE id = ?').run(r.id); audit(req, 'purchase-delete', `${r.branch} ${r.product} ${r.kg}kg KSh${r.cost}`); res.json({ ok: true }); });
const REASONS = ['spoilage', 'trim', 'expired', 'temperature', 'damaged', 'other'];
router.get('/waste', requireAdmin, noStore, (req, res) => { const o = lastRows('bo_waste', req.query); if (!o) return res.status(400).json({ error: 'Unknown branch' }); const by = {}; for (const x of o.rows) by[x.reason] = Math.round(((by[x.reason] || 0) + x.kg) * 10) / 10; res.json({ ...o, reasons: REASONS, byReason: by, totals: { kg: Math.round(o.rows.reduce((a, x) => a + x.kg, 0) * 10) / 10 } }); });
router.post('/waste', requireAdmin, (req, res) => {
  const b = req.body || {}, br = branchOf(b.branch), kg = Number(b.kg), day = okDay(b.day) ? b.day : eatDay(), reason = REASONS.includes(b.reason) ? b.reason : 'other';
  if (!br) return res.status(400).json({ error: 'Choose a branch' }); if (clean(b.product, 80).length < 2) return res.status(400).json({ error: 'Write the product or cut' });
  if (!(kg > 0 && kg <= 2000)) return res.status(400).json({ error: 'Weight in kg must be between 0 and 2000' }); if (day > eatDay() || day < addDays(eatDay(), -60)) return res.status(400).json({ error: 'Date must be within the last 60 days and not in the future' });
  const id = db.prepare('INSERT INTO bo_waste (day, branch, product, kg, reason, note, by_name, created_at) VALUES (?,?,?,?,?,?,?,?)').run(day, br.id, clean(b.product, 80), kg, reason, clean(b.note, 200), who(req), nowTs()).lastInsertRowid;
  audit(req, 'waste-add', `${br.id} ${clean(b.product, 40)} ${kg}kg ${reason}`); res.status(201).json({ ok: true, id: Number(id) });
});
router.delete('/waste/:id(\\d+)', requireAdmin, (req, res) => { const r = db.prepare('SELECT * FROM bo_waste WHERE id = ?').get(req.params.id); if (!r) return res.status(404).json({ error: 'Not found' }); db.prepare('DELETE FROM bo_waste WHERE id = ?').run(r.id); audit(req, 'waste-delete', `${r.branch} ${r.product} ${r.kg}kg`); res.json({ ok: true }); });
// Margin per product: shelf price against the average purchase cost per kg over the last 60 days (matched by product name).
router.get('/margins', requireAdmin, noStore, (req, res) => {
  const br = req.query.branch ? branchOf(req.query.branch) : null, s = settings(), since = addDays(eatDay(), -60);
  const pur = db.prepare(`SELECT lower(product) AS p, SUM(kg) AS kg, SUM(cost) AS cost FROM bo_purchases WHERE day >= ? ${br ? 'AND branch = ?' : ''} GROUP BY lower(product)`).all(...[since].concat(br ? [br.id] : [])), m = Object.fromEntries(pur.map(x => [x.p, x]));
  const rows = db.prepare("SELECT id, name, unit, price FROM products WHERE unit = 'kg' ORDER BY name").all().map(p => { const x = m[p.name.toLowerCase()]; const cost = x && x.kg ? Math.round(x.cost / x.kg) : null; const margin = cost != null && p.price ? Math.round(1000 * (p.price - cost) / p.price) / 10 : null; delete m[p.name.toLowerCase()]; return { id: p.id, name: p.name, price: p.price, costPerKg: cost, marginPct: margin, boughtKg: x ? Math.round(x.kg * 10) / 10 : 0, belowTarget: margin != null && margin < Number(s.margin_target_pct) }; });
  res.json({ since, target: Number(s.margin_target_pct), rows, unmatched: Object.values(m).map(x => ({ product: x.p, kg: Math.round(x.kg * 10) / 10, cost: x.cost })) });
});

// ---------- yield (carcass or primal to saleable cuts) ----------
const k1 = x => Math.round(x * 10) / 10;
router.get('/yield', requireAdmin, noStore, (req, res) => {
  const o = lastRows('bo_yield', req.query); if (!o) return res.status(400).json({ error: 'Unknown branch' });
  const by = {}; for (const x of o.rows) { const b = by[x.product.toLowerCase()] = by[x.product.toLowerCase()] || { product: x.product, runs: 0, kgIn: 0, kgOut: 0, trimKg: 0 }; b.runs++; b.kgIn += x.kg_in; b.kgOut += x.kg_out; b.trimKg += x.trim_kg; }
  const summary = Object.values(by).map(b => ({ product: b.product, runs: b.runs, kgIn: k1(b.kgIn), kgOut: k1(b.kgOut), trimKg: k1(b.trimKg), yieldPct: Math.round(1000 * b.kgOut / b.kgIn) / 10, lossKg: k1(b.kgIn - b.kgOut - b.trimKg) }));
  res.json({ ...o, summary });
});
router.post('/yield', requireAdmin, (req, res) => {
  const b = req.body || {}, br = branchOf(b.branch), kin = Number(b.kg_in), kout = Number(b.kg_out), trim = Number(b.trim_kg || 0), day = okDay(b.day) ? b.day : eatDay();
  if (!br) return res.status(400).json({ error: 'Choose a branch' }); if (clean(b.product, 80).length < 2) return res.status(400).json({ error: 'Write what you started with, for example whole beef side' });
  if (!(kin > 0 && kin <= 5000)) return res.status(400).json({ error: 'Weight started with must be between 0 and 5000 kg' });
  if (!(kout >= 0 && trim >= 0) || isNaN(kout) || isNaN(trim)) return res.status(400).json({ error: 'Weights cannot be negative' });
  if (kout + trim > kin * 1.0001) return res.status(400).json({ error: 'Saleable cuts plus trim add up to more than you started with' });
  if (day > eatDay() || day < addDays(eatDay(), -60)) return res.status(400).json({ error: 'Date must be within the last 60 days and not in the future' });
  const id = db.prepare('INSERT INTO bo_yield (day, branch, product, kg_in, kg_out, trim_kg, note, by_name, created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(day, br.id, clean(b.product, 80), kin, kout, trim, clean(b.note, 200), who(req), nowTs()).lastInsertRowid;
  audit(req, 'yield-add', `${br.id} ${clean(b.product, 40)} in ${kin} out ${kout}`); res.status(201).json({ ok: true, id: Number(id), yieldPct: Math.round(1000 * kout / kin) / 10 });
});
router.delete('/yield/:id(\\d+)', requireAdmin, (req, res) => { const r = db.prepare('SELECT * FROM bo_yield WHERE id = ?').get(req.params.id); if (!r) return res.status(404).json({ error: 'Not found' }); db.prepare('DELETE FROM bo_yield WHERE id = ?').run(r.id); audit(req, 'yield-delete', `${r.branch} ${r.product}`); res.json({ ok: true }); });
// ---------- supplier rejections and scorecard ----------
const REJ = ['temperature', 'quality', 'documents', 'weight', 'other'];
router.get('/rejects', requireAdmin, noStore, (req, res) => { const o = lastRows('bo_rejects', req.query); if (!o) return res.status(400).json({ error: 'Unknown branch' }); res.json({ ...o, reasons: REJ }); });
router.post('/rejects', requireAdmin, (req, res) => {
  const b = req.body || {}, br = branchOf(b.branch), kg = Number(b.kg), day = okDay(b.day) ? b.day : eatDay(), reason = REJ.includes(b.reason) ? b.reason : 'other';
  if (!br) return res.status(400).json({ error: 'Choose a branch' }); if (clean(b.supplier, 80).length < 2) return res.status(400).json({ error: 'Write the supplier name' });
  if (!(kg > 0 && kg <= 5000)) return res.status(400).json({ error: 'Weight in kg must be between 0 and 5000' }); if (day > eatDay() || day < addDays(eatDay(), -60)) return res.status(400).json({ error: 'Date must be within the last 60 days and not in the future' });
  const id = db.prepare('INSERT INTO bo_rejects (day, branch, supplier, product, kg, reason, note, by_name, created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(day, br.id, clean(b.supplier, 80), clean(b.product, 80), kg, reason, clean(b.note, 200), who(req), nowTs()).lastInsertRowid;
  audit(req, 'reject-add', `${br.id} ${clean(b.supplier, 40)} ${kg}kg ${reason}`); res.status(201).json({ ok: true, id: Number(id) });
});
router.delete('/rejects/:id(\\d+)', requireAdmin, (req, res) => { const r = db.prepare('SELECT * FROM bo_rejects WHERE id = ?').get(req.params.id); if (!r) return res.status(404).json({ error: 'Not found' }); db.prepare('DELETE FROM bo_rejects WHERE id = ?').run(r.id); audit(req, 'reject-delete', `${r.branch} ${r.supplier}`); res.json({ ok: true }); });
router.get('/suppliers', requireAdmin, noStore, (req, res) => {
  const r = range(req.query), br = req.query.branch ? branchOf(req.query.branch) : null; if (req.query.branch && !br) return res.status(400).json({ error: 'Unknown branch' });
  const arg = [r.from, r.to].concat(br ? [br.id] : []), bf = br ? ' AND branch = ?' : '', m = {};
  const row = n => { const k = n.trim().toLowerCase(); return m[k] = m[k] || { supplier: n.trim(), deliveries: 0, kg: 0, cost: 0, rejectedKg: 0, rejections: 0, last: '' }; };
  for (const x of db.prepare(`SELECT supplier, COUNT(*) AS n, SUM(kg) AS kg, SUM(cost) AS cost, MAX(day) AS last FROM bo_purchases WHERE day BETWEEN ? AND ?${bf} AND supplier != '' GROUP BY lower(trim(supplier))`).all(...arg)) { const o = row(x.supplier); o.deliveries = x.n; o.kg = x.kg; o.cost = x.cost; o.last = x.last; }
  for (const x of db.prepare(`SELECT supplier, COUNT(*) AS n, SUM(kg) AS kg FROM bo_rejects WHERE day BETWEEN ? AND ?${bf} GROUP BY lower(trim(supplier))`).all(...arg)) { const o = row(x.supplier); o.rejections = x.n; o.rejectedKg = x.kg; }
  const rows = Object.values(m).map(o => ({ ...o, kg: k1(o.kg), rejectedKg: k1(o.rejectedKg), costPerKg: o.kg ? Math.round(o.cost / o.kg) : null, rejectPct: (o.kg + o.rejectedKg) ? Math.round(1000 * o.rejectedKg / (o.kg + o.rejectedKg)) / 10 : null })).map(o => ({ ...o, flag: o.rejectPct != null && o.rejectPct > 5 ? 'Rejects above 5% of delivered weight' : (o.rejections >= 3 ? 'Three or more rejections' : '') })).sort((a, b) => b.cost - a.cost);
  res.json({ from: r.from, to: r.to, rows, unnamed: db.prepare(`SELECT COUNT(*) AS n FROM bo_purchases WHERE day BETWEEN ? AND ?${bf} AND supplier = ''`).get(...arg).n });
});

// ---------- franchisee portal: own login, sees only their own branch and statements ----------
const SECRET = process.env.JWT_SECRET || 'insecure-dev-only-secret-change-me';
const pwOk = p => typeof p === 'string' && p.length >= 10 && /[A-Za-z]/.test(p) && /\d/.test(p);
const tries = new Map();
const lockKey = (req, u) => (req.ip || '') + '|' + u;
const locked = k => { const t = tries.get(k); return !!t && t.n >= 6 && Date.now() - t.at < 15 * 60000; };
const fail = k => { const t = tries.get(k); tries.set(k, { n: t && Date.now() - t.at < 15 * 60000 ? t.n + 1 : 1, at: Date.now() }); };
function requireFranchisee(req, res, next) {
  const h = req.headers.authorization; if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'Please sign in' });
  let p; try { p = jwt.verify(h.slice(7), SECRET); } catch (e) { return res.status(401).json({ error: 'Your session has ended. Please sign in again.' }); }
  if (p.role !== 'franchisee' || !p.fid) return res.status(403).json({ error: 'Franchisee access required' });
  const f = db.prepare('SELECT f.*, p.active AS pactive FROM bo_franchisees f JOIN bo_portal p ON p.franchisee_id = f.id WHERE f.id = ?').get(p.fid);
  if (!f || !f.pactive || f.stage === 'exited') return res.status(401).json({ error: 'This login has been switched off. Please contact Azizo.' });
  req.fr = f; next();
}
router.post('/portal/login', (req, res) => {
  const b = req.body || {}, u = String(b.username || '').trim().toLowerCase(), k = lockKey(req, u);
  if (locked(k)) return res.status(429).json({ error: 'Too many wrong tries. Please wait 15 minutes and try again.' });
  const a = db.prepare('SELECT p.*, f.name, f.stage FROM bo_portal p JOIN bo_franchisees f ON f.id = p.franchisee_id WHERE p.username = ?').get(u);
  if (!a || !a.active || a.stage === 'exited' || !bcrypt.compareSync(String(b.password || ''), a.password_hash)) { fail(k); try { require('./secmon').audit(req, 'franchisee-login-failed', u, 'franchisee'); } catch (e) {} return res.status(401).json({ error: 'Incorrect username or password' }); }
  tries.delete(k); db.prepare('UPDATE bo_portal SET last_login = ? WHERE franchisee_id = ?').run(nowTs(), a.franchisee_id);
  try { require('./secmon').audit(req, 'franchisee-login', u, a.name); } catch (e) {}
  res.json({ token: jwt.sign({ role: 'franchisee', fid: a.franchisee_id }, SECRET, { expiresIn: '8h' }), name: a.name });
});
router.post('/portal/password', requireFranchisee, (req, res) => {
  const b = req.body || {}, a = db.prepare('SELECT * FROM bo_portal WHERE franchisee_id = ?').get(req.fr.id);
  if (!bcrypt.compareSync(String(b.password || ''), a.password_hash)) return res.status(401).json({ error: 'Your current password is not right' });
  if (!pwOk(b.newPassword)) return res.status(400).json({ error: 'New password needs 10+ characters with a letter and a number' });
  db.prepare('UPDATE bo_portal SET password_hash = ? WHERE franchisee_id = ?').run(bcrypt.hashSync(b.newPassword, 10), req.fr.id); req.user = { name: req.fr.name }; audit(req, 'franchisee-password', req.fr.name); res.json({ ok: true });
});
router.get('/portal/me', requireFranchisee, noStore, (req, res) => { const f = req.fr, b = branchOf(f.branch_id), g = growthSet();
  res.json({ name: f.name, stage: f.stage, agreementAt: f.agreement_at, feePaidAt: f.fee_paid_at, royaltyPct: f.royalty_pct != null ? f.royalty_pct : g.royalty, termYears: g.term, branch: b ? { name: b.name, area: b.area, address: b.address, phone: b.phone, hours: b.hours } : null }); });
router.get('/portal/summary', requireFranchisee, noStore, (req, res) => {
  const b = branchOf(req.fr.branch_id); if (!b) return res.json({ branch: null });
  const r = range({ from: day0(Number(req.query.days) === 7 ? 6 : Number(req.query.days) === 90 ? 89 : 29), to: eatDay() }), s = settings(), expected = r.days * PB.checklists.filter(c => c.shift !== 'weekly').length;
  const row = scoreRow(b, r, s, expected); delete row.listed; res.json({ from: r.from, to: r.to, days: r.days, targets: { margin: Number(s.margin_target_pct), waste: Number(s.waste_target_pct), compliance: Number(s.compliance_target_pct) }, branch: row });
});
const day0 = n => addDays(eatDay(), -n);
router.get('/portal/royalties', requireFranchisee, noStore, (req, res) => {
  const rows = db.prepare("SELECT id, period, gross, royalty_pct, royalty, marketing, total, status, issued_at, paid_at FROM bo_royalties WHERE franchisee_id = ? AND status != 'void' ORDER BY period DESC LIMIT 60").all(req.fr.id).map(x => ({ ...x, path: `/statement.html?id=${x.id}&k=${stSig(x.id)}` }));
  res.json({ rows, due: rows.filter(x => x.status === 'issued').reduce((a, x) => a + x.total, 0) });
});

// ---------- franchisees ----------
const STAGES = ['enquiry', 'approved', 'agreement', 'buildout', 'training', 'softlaunch', 'live', 'exited'];
router.get('/franchisees', requireAdmin, noStore, (req, res) => res.json({ stages: STAGES, system: growthSet(), franchisees: db.prepare('SELECT f.*, (SELECT p.username FROM bo_portal p WHERE p.franchisee_id = f.id) AS portal_user, (SELECT p.active FROM bo_portal p WHERE p.franchisee_id = f.id) AS portal_active, (SELECT p.last_login FROM bo_portal p WHERE p.franchisee_id = f.id) AS portal_last, (SELECT l.status FROM pb_launches l WHERE l.branch_id = f.branch_id ORDER BY l.id DESC LIMIT 1) AS launch_status FROM bo_franchisees f ORDER BY f.id DESC').all() }));
router.post('/franchisees', requireAdmin, (req, res) => {
  const b = req.body || {}, name = clean(b.name, 80); if (name.length < 3) return res.status(400).json({ error: 'Write the franchisee name' });
  let enq = null; if (b.enquiry_id) { enq = db.prepare('SELECT * FROM ops_franchise WHERE id = ?').get(Number(b.enquiry_id)); if (!enq) return res.status(400).json({ error: 'Enquiry not found' }); }
  if (b.branch_id && !branchOf(b.branch_id)) return res.status(400).json({ error: 'Branch not found' });
  const ts = nowTs(), id = db.prepare('INSERT INTO bo_franchisees (name, phone, email, branch_id, enquiry_id, stage, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(name, clean(b.phone || (enq && enq.phone), 20), clean(b.email || (enq && enq.email), 120), clean(b.branch_id, 40), enq ? enq.id : null, enq ? 'approved' : 'enquiry', who(req), ts, ts).lastInsertRowid;
  audit(req, 'franchisee-add', name); res.status(201).json({ ok: true, id: Number(id) });
});
router.post('/franchisees/:id(\\d+)/portal', requireAdmin, (req, res) => {
  const f = db.prepare('SELECT * FROM bo_franchisees WHERE id = ?').get(req.params.id); if (!f) return res.status(404).json({ error: 'Not found' }); const b = req.body || {}, cur = db.prepare('SELECT * FROM bo_portal WHERE franchisee_id = ?').get(f.id);
  const u = String(b.username || (cur && cur.username) || '').trim().toLowerCase(); if (!/^[a-z0-9._-]{4,30}$/.test(u)) return res.status(400).json({ error: 'Username must be 4 to 30 letters, numbers, dots, dashes or underscores' });
  if (!pwOk(b.password)) return res.status(400).json({ error: 'Password needs 10+ characters with a letter and a number' });
  const clash = db.prepare('SELECT franchisee_id FROM bo_portal WHERE username = ?').get(u); if (clash && clash.franchisee_id !== f.id) return res.status(409).json({ error: 'That username is already used' });
  const h = bcrypt.hashSync(b.password, 10);
  if (cur) db.prepare('UPDATE bo_portal SET username = ?, password_hash = ?, active = 1 WHERE franchisee_id = ?').run(u, h, f.id); else db.prepare('INSERT INTO bo_portal (franchisee_id, username, password_hash, active, created_at) VALUES (?,?,?,1,?)').run(f.id, u, h, nowTs());
  audit(req, cur ? 'franchisee-login-reset' : 'franchisee-login-create', f.name); res.json({ ok: true, username: u });
});
router.delete('/franchisees/:id(\\d+)/portal', requireAdmin, (req, res) => { const f = db.prepare('SELECT * FROM bo_franchisees WHERE id = ?').get(req.params.id); if (!f) return res.status(404).json({ error: 'Not found' }); db.prepare('UPDATE bo_portal SET active = 0 WHERE franchisee_id = ?').run(f.id); audit(req, 'franchisee-login-off', f.name); res.json({ ok: true }); });
router.patch('/franchisees/:id(\\d+)', requireAdmin, (req, res) => {
  const f = db.prepare('SELECT * FROM bo_franchisees WHERE id = ?').get(req.params.id); if (!f) return res.status(404).json({ error: 'Not found' }); const b = req.body || {};
  const stage = b.stage === undefined ? f.stage : b.stage; if (!STAGES.includes(stage)) return res.status(400).json({ error: 'Unknown stage' });
  const branch_id = b.branch_id === undefined ? f.branch_id : clean(b.branch_id, 40); if (branch_id && !branchOf(branch_id)) return res.status(400).json({ error: 'Branch not found' });
  let pct = b.royalty_pct === undefined ? f.royalty_pct : (b.royalty_pct === '' || b.royalty_pct === null ? null : Number(b.royalty_pct)); if (pct != null && (isNaN(pct) || pct < 0 || pct > 30)) return res.status(400).json({ error: 'Royalty must be 0 to 30 percent' });
  if (['buildout', 'training', 'softlaunch', 'live'].includes(stage) && !f.agreement_at && !(b.agreement_signed === true)) return res.status(409).json({ error: 'Record the signed agreement before moving past the agreement stage' });
  if (stage === 'live') { const L = branch_id && db.prepare('SELECT status FROM pb_launches WHERE branch_id = ? ORDER BY id DESC LIMIT 1').get(branch_id); if (!branch_id || !L || L.status !== 'live') return res.status(409).json({ error: 'Link a branch that has gone live in Playbook > New branch first' }); }
  const day = eatDay();
  db.prepare('UPDATE bo_franchisees SET stage=?, branch_id=?, royalty_pct=?, notes=?, agreement_at=?, fee_paid_at=?, updated_at=? WHERE id=?').run(stage, branch_id, pct, b.notes === undefined ? f.notes : clean(b.notes, 500), b.agreement_signed === true ? (f.agreement_at || day) : (b.agreement_signed === false ? null : f.agreement_at), b.fee_paid === true ? (f.fee_paid_at || day) : (b.fee_paid === false ? null : f.fee_paid_at), nowTs(), f.id);
  audit(req, 'franchisee-' + stage, f.name); res.json({ ok: true });
});

// ---------- royalty statements ----------
const monthOk = p => /^\d{4}-(0[1-9]|1[0-2])$/.test(p || '');
const monthRange = p => { const [y, m] = p.split('-').map(Number), from = `${p}-01`, last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return { from, to: `${p}-${String(last).padStart(2, '0')}` }; };

// ---------- statement links (read-only, one statement, signed) and overdue reminders ----------
const sigKey = () => crypto.createHash('sha256').update('azizo-order-sig|' + (process.env.ORDER_SIG_KEY || process.env.JWT_SECRET || 'insecure-dev-only-secret-change-me')).digest();
const stSig = id => crypto.createHmac('sha256', sigKey()).update('roy-statement|' + id).digest('hex').slice(0, 32);
const stOk = (id, k) => { const a = Buffer.from(stSig(id)), b = Buffer.from(String(k || '')); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const statementOf = id => { const r = db.prepare('SELECT r.*, f.name AS franchisee, f.branch_id FROM bo_royalties r JOIN bo_franchisees f ON f.id = r.franchisee_id WHERE r.id = ?').get(id); if (!r) return null;
  const b = branchOf(r.branch_id), mr = monthRange(r.period);
  const days = db.prepare("SELECT substr(datetime(created_at, '+' || ? || ' hours'), 1, 10) AS day, COUNT(*) AS orders, SUM(total) AS gross FROM orders WHERE (branch = ? OR branch = ?) AND status = 'completed' AND created_at >= ? AND created_at < ? GROUP BY 1 ORDER BY 1").all(TZ, b ? b.id : '', b ? b.name : '', bound(mr.from), bound(addDays(mr.to, 1)));
  return { ...r, ref: 'RS-' + r.period.replace('-', '') + '-' + String(r.id).padStart(4, '0'), branchName: b ? b.name : r.branch_id, days }; };
router.get('/public/statement/:id(\\d+)', noStore, (req, res) => {
  if (!stOk(req.params.id, req.query.k)) return res.status(404).json({ error: 'Statement not found' });
  const s = statementOf(req.params.id); if (!s || s.status === 'void') return res.status(404).json({ error: 'Statement not found' });
  res.json({ statement: { ref: s.ref, franchisee: s.franchisee, branchName: s.branchName, period: s.period, gross: s.gross, refunds: s.refunds, royalty_pct: s.royalty_pct, royalty: s.royalty, marketing_pct: s.marketing_pct, marketing: s.marketing, total: s.total, status: s.status, issued_at: s.issued_at, paid_at: s.paid_at, days: s.days } });
});
const waText = (s, link) => `Hello ${s.franchisee}, your Azizo royalty statement ${s.ref} for ${s.period} is KSh ${Number(s.total).toLocaleString('en-KE')}. View it here: ${link}`;
router.get('/royalties/overdue', requireAdmin, noStore, (req, res) => {
  const dueDays = Number(settings().royalty_due_days), today = eatDay();
  const rows = db.prepare("SELECT r.id, r.period, r.total, r.issued_at, f.name AS franchisee, f.phone FROM bo_royalties r JOIN bo_franchisees f ON f.id = r.franchisee_id WHERE r.status = 'issued' ORDER BY r.issued_at").all().map(r => {
    const issued = String(r.issued_at || '').slice(0, 10), age = issued ? Math.round((Date.parse(today) - Date.parse(issued)) / 86400000) : 0, rem = db.prepare('SELECT COUNT(*) AS n, MAX(at) AS last FROM bo_reminders WHERE royalty_id = ?').get(r.id);
    return { ...r, daysOpen: age, daysOverdue: Math.max(0, age - dueDays), overdue: age > dueDays, reminders: rem.n, lastReminder: rem.last || null }; });
  res.json({ dueDays, rows, overdueTotal: rows.filter(r => r.overdue).reduce((a, r) => a + r.total, 0) });
});
router.get('/royalties/:id(\\d+)/link', requireAdmin, noStore, (req, res) => {
  const s = statementOf(Number(req.params.id)); if (!s) return res.status(404).json({ error: 'Not found' });
  const path_ = `/statement.html?id=${s.id}&k=${stSig(s.id)}`; res.json({ path: path_, text: waText(s, '{SITE}' + path_), phone: (db.prepare('SELECT phone FROM bo_franchisees WHERE id = ?').get(s.franchisee_id) || {}).phone || '' });
});
router.post('/royalties/:id(\\d+)/remind', requireAdmin, (req, res) => {
  const s = statementOf(Number(req.params.id)); if (!s) return res.status(404).json({ error: 'Not found' }); if (s.status !== 'issued') return res.status(409).json({ error: 'Only an unpaid statement can be reminded' });
  db.prepare('INSERT INTO bo_reminders (royalty_id, at, by_name) VALUES (?,?,?)').run(s.id, nowTs(), who(req)); audit(req, 'royalty-remind', `${s.period} #${s.id}`);
  const path_ = `/statement.html?id=${s.id}&k=${stSig(s.id)}`; res.json({ ok: true, path: path_, text: waText(s, '{SITE}' + path_), phone: (db.prepare('SELECT phone FROM bo_franchisees WHERE id = ?').get(s.franchisee_id) || {}).phone || '' });
});
router.get('/royalties', requireAdmin, noStore, (req, res) => {
  const per = monthOk(req.query.period) ? req.query.period : null;
  const rows = db.prepare(`SELECT r.*, f.name AS franchisee, f.branch_id FROM bo_royalties r JOIN bo_franchisees f ON f.id = r.franchisee_id ${per ? 'WHERE r.period = ?' : ''} ORDER BY r.period DESC, r.id DESC LIMIT 300`).all(...(per ? [per] : []));
  res.json({ rows, totals: { due: rows.filter(r => r.status === 'issued').reduce((a, r) => a + r.total, 0), paid: rows.filter(r => r.status === 'paid').reduce((a, r) => a + r.total, 0) }, system: growthSet(), marketingPct: Number(settings().marketing_pct) });
});
router.post('/royalties/generate', requireAdmin, (req, res) => {
  const per = (req.body || {}).period; if (!monthOk(per)) return res.status(400).json({ error: 'Choose a month like 2026-11' });
  const nowMonth = eatDay().slice(0, 7); if (per >= nowMonth) return res.status(400).json({ error: 'A month can be invoiced only after it has ended' });
  const g = growthSet(), mk = Number(settings().marketing_pct), mr = monthRange(per); let made = 0, skipped = 0;
  for (const f of db.prepare("SELECT * FROM bo_franchisees WHERE stage = 'live' AND branch_id != ''").all()) {
    if (db.prepare('SELECT 1 FROM bo_royalties WHERE franchisee_id = ? AND period = ?').get(f.id, per)) { skipped++; continue; }
    const b = branchOf(f.branch_id); if (!b) continue; const s = salesFor(b, mr.from, mr.to), rf = refundsFor(b, mr.from, mr.to), net = Math.max(0, s.gross - rf.amt), pct = f.royalty_pct != null ? f.royalty_pct : g.royalty;
    const roy = Math.round(net * pct / 100), mkt = Math.round(net * mk / 100);
    db.prepare('INSERT INTO bo_royalties (franchisee_id, period, gross, refunds, royalty_pct, royalty, marketing_pct, marketing, total, orders, issued_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(f.id, per, net, rf.amt, pct, roy, mk, mkt, roy + mkt, s.n, nowTs()); made++;
  }
  audit(req, 'royalty-generate', `${per} made ${made}`); res.json({ ok: true, made, skipped });
});
router.patch('/royalties/:id(\\d+)', requireAdmin, (req, res) => {
  const r = db.prepare('SELECT * FROM bo_royalties WHERE id = ?').get(req.params.id); if (!r) return res.status(404).json({ error: 'Not found' }); const st = (req.body || {}).status;
  if (!['paid', 'void', 'issued'].includes(st)) return res.status(400).json({ error: 'Status must be paid, void or issued' });
  db.prepare('UPDATE bo_royalties SET status = ?, paid_at = ?, note = ? WHERE id = ?').run(st, st === 'paid' ? nowTs() : null, clean((req.body || {}).note, 200), r.id); audit(req, 'royalty-' + st, `${r.period} #${r.id}`); res.json({ ok: true });
});
router.get('/royalties/:id(\\d+)/statement', requireAdmin, noStore, (req, res) => {
  const r = db.prepare('SELECT r.*, f.name AS franchisee, f.branch_id FROM bo_royalties r JOIN bo_franchisees f ON f.id = r.franchisee_id WHERE r.id = ?').get(req.params.id); if (!r) return res.status(404).json({ error: 'Not found' });
  const b = branchOf(r.branch_id), mr = monthRange(r.period);
  const days = db.prepare("SELECT substr(datetime(created_at, '+' || ? || ' hours'), 1, 10) AS day, COUNT(*) AS orders, SUM(total) AS gross FROM orders WHERE (branch = ? OR branch = ?) AND status = 'completed' AND created_at >= ? AND created_at < ? GROUP BY 1 ORDER BY 1").all(TZ, b ? b.id : '', b ? b.name : '', bound(mr.from), bound(addDays(mr.to, 1)));
  res.json({ statement: { ...r, ref: 'RS-' + r.period.replace('-', '') + '-' + String(r.id).padStart(4, '0'), branchName: b ? b.name : r.branch_id, days } });
});

// ---------- operations manual ----------
router.get('/manual', requireAdmin, noStore, (req, res) => {
  const br = branchOf(req.query.branch) || db.prepare('SELECT * FROM branches ORDER BY is_main DESC, sort_order LIMIT 1').get(), dir = path.join(__dirname, 'sop'); let sops = [];
  try { sops = fs.readdirSync(dir).filter(f => /^[A-Z]\d\d-[a-z0-9-]+\.md$/.test(f)).sort().map(f => ({ id: f.replace(/\.md$/, ''), text: fs.readFileSync(path.join(dir, f), 'utf8') })); } catch (e) {}
  const g = growthSet(), s = settings();
  res.json({ generated: nowTs(), version: PB.version, branch: br ? { id: br.id, name: br.name, area: br.area, address: br.address, phone: br.phone, hours: br.hours } : null, system: { royaltyPct: g.royalty, fee: g.fee, termYears: g.term, marginTarget: Number(s.margin_target_pct), wasteTarget: Number(s.waste_target_pct), complianceTarget: Number(s.compliance_target_pct) }, checklists: PB.checklists, courses: PB.courses.map(c => ({ code: c.code, title: c.title, sop: c.sop, forRoles: c.for_roles, lessons: c.lessons })), passmark: PB.passmark, validMonths: PB.valid_months, manual: PB.manual, sops });
});
module.exports = { router };
