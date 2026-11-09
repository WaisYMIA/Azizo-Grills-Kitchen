// Azizo Playbook (v6.0): daily checklists, training and certification, and the new-branch wizard with its readiness test.
const express = require('express');
const db = require('./db');
const { requireAdmin, requireStaff } = require('./middleware/auth');
const CAT = require('./data/playbook.json');
const router = express.Router();
const TZ = Number.isFinite(Number(process.env.TZ_OFFSET_HOURS)) ? Number(process.env.TZ_OFFSET_HOURS) : 3;

db.exec(`
CREATE TABLE IF NOT EXISTS pb_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, branch TEXT NOT NULL, run_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', answers TEXT DEFAULT '{}', done INTEGER DEFAULT 0, total INTEGER DEFAULT 0, fails INTEGER DEFAULT 0, attention INTEGER DEFAULT 0, resolved INTEGER DEFAULT 0, resolve_note TEXT DEFAULT '', started_by TEXT DEFAULT '', completed_by TEXT DEFAULT '', completed_at TEXT, updated_at TEXT, UNIQUE(code, branch, run_date));
CREATE TABLE IF NOT EXISTS pb_training (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_name TEXT NOT NULL, staff_ref TEXT DEFAULT '', branch TEXT NOT NULL, course TEXT NOT NULL, score INTEGER NOT NULL, passed INTEGER NOT NULL, practical INTEGER DEFAULT 0, practical_by TEXT DEFAULT '', practical_at TEXT, recorded_by TEXT DEFAULT '', taken_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_pb_training_b ON pb_training(branch, course);
CREATE TABLE IF NOT EXISTS pb_launches (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, branch_id TEXT NOT NULL, type TEXT DEFAULT 'own', grill INTEGER DEFAULT 0, status TEXT DEFAULT 'draft', manual TEXT DEFAULT '{}', created_by TEXT DEFAULT '', created_at TEXT, live_at TEXT);
`);
const nowTs = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const eatDay = (ms = Date.now()) => new Date(ms + TZ * 3600000).toISOString().slice(0, 10);
const okDay = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, n);
const who = req => (req.user && req.user.name) || (req.user && req.user.role === 'staff' ? 'staff' : 'admin');
const audit = (req, a, d) => { try { require('./secmon').audit(req, a, d, who(req)); } catch (e) {} };
const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
const CL = Object.fromEntries(CAT.checklists.map(c => [c.code, c]));
const CO = Object.fromEntries(CAT.courses.map(c => [c.code, c]));
const branchOk = id => db.prepare('SELECT * FROM branches WHERE id = ?').get(String(id || ''));

// Score a checklist run. tick: ok true/false/'na'; temp: number inside min..max; num: number; text: any text. A failure needs a written action.
function evaluate(cl, ans) {
  let done = 0, fails = 0, attention = 0, missingNote = 0; const per = {};
  for (const it of cl.items) {
    const a = (ans && ans[it.id]) || {}; let st = null;
    if (a.ok === 'na') st = 'na';
    else if (it.type === 'tick') st = a.ok === true ? 'ok' : a.ok === false ? 'fail' : null;
    else if (it.type === 'temp') { const v = a.value === '' || a.value == null ? NaN : Number(a.value); st = isNaN(v) ? null : (v >= it.min && v <= it.max ? 'ok' : 'fail'); }
    else if (it.type === 'num') { const v = a.value === '' || a.value == null ? NaN : Number(a.value); st = isNaN(v) || v < 0 ? null : 'ok'; }
    else st = clean(a.value, 500) ? 'ok' : null;
    per[it.id] = st;
    if (st) done++;
    if (st === 'fail') { fails++; if (it.crit) attention++; if (!clean(a.note, 300)) missingNote++; }
  }
  return { done, total: cl.items.length, fails, attention, missingNote, per };
}
function sanitiseAnswers(cl, ans) {
  const out = {};
  for (const it of cl.items) {
    const a = (ans && ans[it.id]) || {}; const o = {};
    if (a.ok === true || a.ok === false || a.ok === 'na') o.ok = a.ok;
    if (a.value !== undefined && a.value !== null && a.value !== '') o.value = it.type === 'text' ? clean(a.value, 500) : (isNaN(Number(a.value)) ? undefined : Number(a.value));
    if (a.note) o.note = clean(a.note, 300);
    if (Object.keys(o).length) out[it.id] = o;
  }
  return out;
}

router.get('/catalogue', requireStaff, noStore, (req, res) => {
  res.json({ passmark: CAT.passmark, validMonths: CAT.valid_months, core: CAT.core, grill: CAT.grill, checklists: CAT.checklists,
    courses: CAT.courses.map(c => ({ code: c.code, title: c.title, sop: c.sop, forRoles: c.for_roles, lessons: c.lessons, quiz: c.quiz.map(q => ({ q: q.q, o: q.o })) })) });
});

// ---------- checklists ----------
router.get('/checklists/run', requireStaff, noStore, (req, res) => {
  const cl = CL[req.query.code]; const br = branchOk(req.query.branch); if (!cl || !br) return res.status(400).json({ error: 'Unknown checklist or branch' });
  const date = okDay(req.query.date) ? req.query.date : eatDay();
  const r = db.prepare('SELECT * FROM pb_runs WHERE code = ? AND branch = ? AND run_date = ?').get(cl.code, br.id, date);
  res.json({ run: r ? { ...r, answers: JSON.parse(r.answers || '{}') } : null, date });
});
router.get('/today', requireStaff, noStore, (req, res) => {
  const br = branchOk(req.query.branch); if (!br) return res.status(400).json({ error: 'Unknown branch' });
  const date = eatDay(); const rows = db.prepare('SELECT code, status, done, total, fails, attention, resolved FROM pb_runs WHERE branch = ? AND run_date = ?').all(br.id, date);
  res.json({ date, branch: br.id, runs: Object.fromEntries(rows.map(r => [r.code, r])) });
});
router.post('/checklists/run', requireStaff, (req, res) => {
  const b = req.body || {}, cl = CL[b.code], br = branchOk(b.branch); if (!cl || !br) return res.status(400).json({ error: 'Unknown checklist or branch' });
  const today = eatDay(), date = okDay(b.date) ? b.date : today;
  if (date > today || date < addDays(today, -1)) return res.status(400).json({ error: 'You can fill in today\'s or yesterday\'s checklist only' });
  const ans = sanitiseAnswers(cl, b.answers), ev = evaluate(cl, ans);
  const ex = db.prepare('SELECT * FROM pb_runs WHERE code = ? AND branch = ? AND run_date = ?').get(cl.code, br.id, date);
  if (ex && ex.status === 'complete') return res.status(409).json({ error: 'This checklist was already completed and signed' });
  let status = 'open', by = '', at = null;
  if (b.complete) {
    if (ev.done < ev.total) return res.status(400).json({ error: `Answer every line first (${ev.total - ev.done} left)` });
    if (ev.missingNote) return res.status(400).json({ error: 'Write what you did about each line that failed' });
    status = 'complete'; by = who(req); at = nowTs();
  }
  const ts = nowTs();
  if (ex) db.prepare('UPDATE pb_runs SET answers=?, done=?, total=?, fails=?, attention=?, status=?, completed_by=?, completed_at=?, updated_at=? WHERE id=?').run(JSON.stringify(ans), ev.done, ev.total, ev.fails, ev.attention, status, by, at, ts, ex.id);
  else db.prepare('INSERT INTO pb_runs (code, branch, run_date, status, answers, done, total, fails, attention, started_by, completed_by, completed_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(cl.code, br.id, date, status, JSON.stringify(ans), ev.done, ev.total, ev.fails, ev.attention, who(req), by, at, ts);
  if (status === 'complete') audit(req, 'checklist-' + cl.code + (ev.attention ? '-attention' : ''), `${br.id} ${date} fails ${ev.fails} critical ${ev.attention}`);
  res.json({ ok: true, status, done: ev.done, total: ev.total, fails: ev.fails, attention: ev.attention });
});

// ---------- manager view ----------
router.get('/compliance', requireAdmin, noStore, (req, res) => {
  let to = okDay(req.query.to) ? req.query.to : eatDay(), from = okDay(req.query.from) ? req.query.from : addDays(to, -6);
  if (from > to) [from, to] = [to, from]; if (Date.parse(to) - Date.parse(from) > 92 * 86400000) from = addDays(to, -92);
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1, daily = CAT.checklists.filter(c => c.shift !== 'weekly').length;
  const branches = db.prepare('SELECT id, name FROM branches ORDER BY is_main DESC, sort_order, name').all();
  const rows = db.prepare("SELECT branch, COUNT(*) AS done, SUM(fails) AS fails, SUM(CASE WHEN attention>0 AND resolved=0 THEN 1 ELSE 0 END) AS open_attention FROM pb_runs WHERE status='complete' AND run_date BETWEEN ? AND ? AND code != 'weekly' GROUP BY branch").all(from, to);
  const m = Object.fromEntries(rows.map(r => [r.branch, r]));
  const out = branches.map(b => { const r = m[b.id] || { done: 0, fails: 0, open_attention: 0 }; const exp = days * daily; return { branch: b.id, name: b.name, expected: exp, done: r.done, pct: exp ? Math.round(100 * r.done / exp) : 0, fails: r.fails || 0, openAttention: r.open_attention || 0 }; });
  const att = db.prepare("SELECT id, code, branch, run_date, fails, attention, completed_by, answers FROM pb_runs WHERE status='complete' AND attention > 0 AND resolved = 0 ORDER BY run_date DESC LIMIT 100").all().map(r => {
    const cl = CL[r.code], a = JSON.parse(r.answers || '{}'), items = [];
    for (const it of cl.items) if (it.crit) { const x = a[it.id] || {}; const bad = it.type === 'tick' ? x.ok === false : it.type === 'temp' ? (x.value !== undefined && (x.value < it.min || x.value > it.max)) : false; if (bad) items.push({ id: it.id, t: it.t, value: x.value, note: x.note || '' }); }
    return { id: r.id, code: r.code, title: cl.title, branch: r.branch, date: r.run_date, by: r.completed_by, items };
  });
  res.json({ from, to, days, branches: out, attention: att });
});
router.get('/runs', requireAdmin, noStore, (req, res) => {
  const br = branchOk(req.query.branch), date = okDay(req.query.date) ? req.query.date : eatDay(); if (!br) return res.status(400).json({ error: 'Unknown branch' });
  res.json({ date, runs: db.prepare('SELECT id, code, status, done, total, fails, attention, resolved, resolve_note, started_by, completed_by, completed_at FROM pb_runs WHERE branch = ? AND run_date = ? ORDER BY id').all(br.id, date) });
});
router.patch('/runs/:id(\\d+)/resolve', requireAdmin, (req, res) => {
  const r = db.prepare('SELECT * FROM pb_runs WHERE id = ?').get(req.params.id); if (!r) return res.status(404).json({ error: 'Not found' });
  const note = clean((req.body || {}).note, 300); if (note.length < 3) return res.status(400).json({ error: 'Write what was done to fix it' });
  db.prepare('UPDATE pb_runs SET resolved = 1, resolve_note = ? WHERE id = ?').run(note + ' (' + who(req) + ')', r.id); audit(req, 'checklist-resolved', `${r.branch} ${r.run_date} ${r.code}`); res.json({ ok: true });
});

// ---------- training ----------
router.post('/training/attempt', requireAdmin, (req, res) => {
  const b = req.body || {}, co = CO[b.course], br = branchOk(b.branch), name = clean(b.staff_name, 80);
  if (!co || !br || name.length < 3) return res.status(400).json({ error: 'Staff name, branch and course are needed' });
  const ans = Array.isArray(b.answers) ? b.answers : []; if (ans.length !== co.quiz.length) return res.status(400).json({ error: 'Answer every question' });
  let right = 0; const review = co.quiz.map((q, i) => { const ok = Number(ans[i]) === q.a; if (ok) right++; return { ok, answer: q.a, why: q.why }; });
  const score = Math.round(100 * right / co.quiz.length), passed = score >= CAT.passmark ? 1 : 0;
  const id = db.prepare('INSERT INTO pb_training (staff_name, staff_ref, branch, course, score, passed, recorded_by, taken_at) VALUES (?,?,?,?,?,?,?,?)').run(name, clean(b.staff_ref, 20).replace(/\D/g, '').slice(-9), br.id, co.code, score, passed, who(req), nowTs()).lastInsertRowid;
  audit(req, 'training-attempt', `${name} ${co.code} ${score}%`); res.json({ ok: true, id: Number(id), score, passed: !!passed, passmark: CAT.passmark, review });
});
function expiry(takenAt) { const d = new Date(takenAt.replace(' ', 'T') + 'Z'); d.setUTCMonth(d.getUTCMonth() + CAT.valid_months); return d.toISOString().slice(0, 10); }
function certRows(branch) {
  const rows = db.prepare('SELECT * FROM pb_training WHERE branch = ? AND passed = 1 ORDER BY id').all(branch), today = eatDay(), map = {};
  for (const r of rows) { const k = (r.staff_ref || r.staff_name.toLowerCase()) + '|' + r.course, cur = map[k]; if (!cur || r.id > cur.id) map[k] = r; }
  return Object.values(map).map(r => ({ id: r.id, staff: r.staff_name, ref: r.staff_ref, course: r.course, score: r.score, practical: !!r.practical, practicalBy: r.practical_by, expires: expiry(r.taken_at), valid: expiry(r.taken_at) >= today, certified: !!r.practical && expiry(r.taken_at) >= today }));
}
router.get('/training/matrix', requireAdmin, noStore, (req, res) => {
  const br = branchOk(req.query.branch); if (!br) return res.status(400).json({ error: 'Unknown branch' });
  const rows = certRows(br.id), staff = {};
  for (const r of rows) { const k = r.ref || r.staff.toLowerCase(); (staff[k] = staff[k] || { name: r.staff, ref: r.ref, courses: {} }).courses[r.course] = r; }
  res.json({ branch: br.id, courses: CAT.courses.map(c => ({ code: c.code, title: c.title })), staff: Object.values(staff) });
});
router.patch('/training/:id(\\d+)/practical', requireAdmin, (req, res) => {
  const r = db.prepare('SELECT * FROM pb_training WHERE id = ?').get(req.params.id); if (!r || !r.passed) return res.status(404).json({ error: 'Not found' });
  const done = (req.body || {}).done === false ? 0 : 1;
  db.prepare('UPDATE pb_training SET practical = ?, practical_by = ?, practical_at = ? WHERE id = ?').run(done, done ? who(req) : '', done ? nowTs() : null, r.id); audit(req, 'training-practical', `${r.staff_name} ${r.course} ${done}`); res.json({ ok: true });
});

// ---------- new-branch wizard ----------
const slug = s => String(s || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
function readiness(L) {
  const b = db.prepare('SELECT * FROM branches WHERE id = ?').get(L.branch_id), checks = [];
  checks.push({ k: 'details', t: 'Branch details complete (address, phone, map position)', ok: !!(b && b.address && b.phone && b.lat != null && b.lng != null), auto: true, detail: b ? '' : 'Branch missing' });
  const np = db.prepare('SELECT COUNT(*) AS n FROM products').get().n; checks.push({ k: 'menu', t: 'Menu and prices loaded (at least 10 products)', ok: np >= 10, auto: true, detail: np + ' products' });
  const cert = certRows(L.branch_id), need = CAT.core.concat(L.grill ? CAT.grill : []);
  for (const c of need) { const n = new Set(cert.filter(x => x.course === c && x.certified).map(x => x.ref || x.staff.toLowerCase())).size; checks.push({ k: 'train_' + c, t: `Two certified staff for "${CO[c].title}"`, ok: n >= 2, auto: true, detail: n + ' certified' }); }
  const since = addDays(eatDay(), -14);
  for (const code of ['open', 'close']) { const r = db.prepare("SELECT COUNT(*) AS n FROM pb_runs WHERE branch = ? AND code = ? AND status = 'complete' AND run_date >= ? AND NOT (attention > 0 AND resolved = 0)").get(L.branch_id, code, since).n; checks.push({ k: 'dry_' + code, t: `Practice ${code === 'open' ? 'opening' : 'closing'} checklist completed in the last 14 days`, ok: r >= 1, auto: true, detail: r + ' completed' }); }
  const man = JSON.parse(L.manual || '{}');
  for (const m of CAT.manual) { const na = m.k === 'agreement' && L.type !== 'franchise', v = man[m.k]; checks.push({ k: 'man_' + m.k, t: m.t, ok: na || !!(v && v.done), auto: false, na, by: v && v.done ? v.by : '', at: v && v.done ? v.at : '' }); }
  return checks;
}
const launchOut = L => { const c = readiness(L); return { id: L.id, name: L.name, branch: L.branch_id, type: L.type, grill: !!L.grill, status: L.status, createdAt: L.created_at, liveAt: L.live_at, passed: c.filter(x => x.ok).length, total: c.length, checks: c }; };
router.get('/launches', requireAdmin, noStore, (req, res) => res.json({ launches: db.prepare('SELECT * FROM pb_launches ORDER BY id DESC').all().map(L => { const o = launchOut(L); delete o.checks; return o; }) }));
router.get('/launches/:id(\\d+)', requireAdmin, noStore, (req, res) => {
  const L = db.prepare('SELECT * FROM pb_launches WHERE id = ?').get(req.params.id); if (!L) return res.status(404).json({ error: 'Not found' });
  res.json({ launch: launchOut(L), inherits: { products: db.prepare('SELECT COUNT(*) AS n FROM products').get().n, checklists: CAT.checklists.length, checklistItems: CAT.checklists.reduce((a, c) => a + c.items.length, 0), courses: CAT.courses.length, questions: CAT.courses.reduce((a, c) => a + c.quiz.length, 0), note: 'The branch uses the same menu, prices, delivery rules, order messages, reward rules and checklists as every other branch. Change them once in Operations.' } });
});
router.post('/launches', requireAdmin, (req, res) => {
  const b = req.body || {}, name = clean(b.name, 60), address = clean(b.address, 160), phone = clean(b.phone, 20), area = clean(b.area, 60);
  const lat = b.lat === '' || b.lat == null ? null : Number(b.lat), lng = b.lng === '' || b.lng == null ? null : Number(b.lng);
  if (name.length < 3 || !area) return res.status(400).json({ error: 'Branch name and area are needed' });
  if ((lat != null && (isNaN(lat) || lat < -5 || lat > 5)) || (lng != null && (isNaN(lng) || lng < 33 || lng > 43))) return res.status(400).json({ error: 'The map position does not look like a place in Kenya' });
  if (phone && !/^\+?[\d][\d\s\-()]{5,19}$/.test(phone)) return res.status(400).json({ error: 'Phone number does not look right' });
  let id = slug(name) || 'branch', n = 2; while (db.prepare('SELECT 1 FROM branches WHERE id = ?').get(id)) id = slug(name).slice(0, 36) + '-' + n++;
  const type = b.type === 'franchise' ? 'franchise' : 'own', so = db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM branches').get().n;
  const tx = db.transaction(() => {
    db.prepare("INSERT INTO branches (id, name, area, address, query, lat, lng, phone, hours, is_main, listed, sort_order) VALUES (?,?,?,?,?,?,?,?,?,0,0,?)").run(id, name, area, address, clean(b.query, 160) || (name + ' ' + area), lat, lng, phone, clean(b.hours, 60) || 'Open 24 hours', so);
    return db.prepare('INSERT INTO pb_launches (name, branch_id, type, grill, created_by, created_at) VALUES (?,?,?,?,?,?)').run(name, id, type, b.grill ? 1 : 0, who(req), nowTs()).lastInsertRowid;
  });
  const lid = tx(); audit(req, 'branch-launch-start', id); res.status(201).json({ ok: true, id: Number(lid), branch: id });
});
router.patch('/launches/:id(\\d+)/manual', requireAdmin, (req, res) => {
  const L = db.prepare('SELECT * FROM pb_launches WHERE id = ?').get(req.params.id); if (!L) return res.status(404).json({ error: 'Not found' });
  const k = String((req.body || {}).key || ''); if (!CAT.manual.some(m => m.k === k)) return res.status(400).json({ error: 'Unknown item' });
  const man = JSON.parse(L.manual || '{}'); man[k] = (req.body || {}).done === false ? { done: false } : { done: true, by: who(req), at: nowTs().slice(0, 10) };
  db.prepare('UPDATE pb_launches SET manual = ? WHERE id = ?').run(JSON.stringify(man), L.id); audit(req, 'branch-launch-tick', L.branch_id + ' ' + k); res.json({ ok: true });
});
router.post('/launches/:id(\\d+)/golive', requireAdmin, (req, res) => {
  const L = db.prepare('SELECT * FROM pb_launches WHERE id = ?').get(req.params.id); if (!L) return res.status(404).json({ error: 'Not found' });
  const bad = readiness(L).filter(c => !c.ok); if (bad.length) return res.status(409).json({ error: 'Not ready yet: ' + bad.length + ' item(s) still open', open: bad.map(c => c.t) });
  db.transaction(() => { db.prepare('UPDATE branches SET listed = 1 WHERE id = ?').run(L.branch_id); db.prepare("UPDATE pb_launches SET status = 'live', live_at = ? WHERE id = ?").run(nowTs(), L.id); })();
  audit(req, 'branch-golive', L.branch_id); res.json({ ok: true });
});
module.exports = { router, evaluate };
