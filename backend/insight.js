// Azizo insight module (v5.5): report catalogue + Excel export, unified audit centre, privacy-safe visitor analytics, cPanel email settings.
const express = require('express');
const crypto = require('crypto');
const db = require('./db');
const activity = require('./activity');
const mailer = require('./mailer');
const X = require('./lib/xlsxout');
const { requireAdmin } = require('./middleware/auth');
const CAT = require('./data/reports.json');
const router = express.Router();
const TZ = Number.isFinite(Number(process.env.TZ_OFFSET_HOURS)) ? Number(process.env.TZ_OFFSET_HOURS) : 3;

db.exec(`CREATE TABLE IF NOT EXISTS site_visits (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, day TEXT NOT NULL, path TEXT NOT NULL, source TEXT DEFAULT 'direct', device TEXT DEFAULT 'desktop', vid TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_visits_day ON site_visits(day);`);
const nowTs = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const eatDay = (ms = Date.now()) => new Date(ms + TZ * 3600000).toISOString().slice(0, 10);
const okDay = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const utcBound = d => new Date(Date.parse(d + 'T00:00:00Z') - TZ * 3600000).toISOString().slice(0, 19).replace('T', ' ');
function range(q) { let to = okDay(q.to) ? q.to : eatDay(), from = okDay(q.from) ? q.from : addDays(to, -29); if (from > to) [from, to] = [to, from]; if (Date.parse(to) - Date.parse(from) > 400 * 86400000) from = addDays(to, -400); return { from, to }; }
const roleOf = req => (req.user && req.user.tr) || 'owner';
const toLocal = s => { const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(s || '')); if (!m) return String(s || '').length === 10 ? String(s) + ' 00:00:00' : ''; return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + TZ * 3600000).toISOString().slice(0, 19).replace('T', ' '); };
const ms = s => { const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null; };
const num = v => (v == null || v === '' || isNaN(Number(v))) ? null : Number(v);

// ---------- report engine ----------
function expand(sql) {
  return sql.replace(/\{\{DAY:([^}]+)\}\}/g, (m, e) => `date(${e}, '+${TZ} hours')`).replace(/\{\{HOUR:([^}]+)\}\}/g, (m, e) => `CAST(strftime('%H', ${e}, '+${TZ} hours') AS INTEGER)`);
}
function prepare(def, p) {
  const params = [], sql = expand(def.sql).replace(/:(fromd|tod|from|to|branch)\b/g, (m, k) => { params.push({ from: p.fromUtc, to: p.toUtc, fromd: p.from, tod: p.to, branch: p.branch || '' }[k]); return '?'; });
  return { sql, params };
}
function runReport(def, q, limit) {
  const r = range(q), p = { from: r.from, to: r.to, fromUtc: utcBound(r.from), toUtc: utcBound(addDays(r.to, 1)), branch: String(q.branch || '').slice(0, 40) };
  const cap = Math.max(1, Math.min(limit || 100000, 100000)), pr = prepare(def, p);
  const raw = db.prepare(pr.sql).all(...pr.params), total = raw.length, rows = raw.slice(0, cap);
  const colIdx = {}; def.cols.forEach((c, i) => { if (!(c.k in colIdx)) colIdx[c.k] = i; });
  const sums = {}; for (const c of def.cols) if (c.calc === 'share') sums[c.of] = rows.reduce((s, x) => s + (num(x[c.of]) || 0), 0);
  const nowMs = Date.now();
  const out = rows.map(x => def.cols.map(c => {
    if (c.calc === 'mins') { const a = ms(x[c.a]), b = ms(x[c.b]); return a != null && b != null && b >= a ? Math.round((b - a) / 60000) : null; }
    if (c.calc === 'age') { const a = ms(x[c.a]); return a != null ? Math.max(0, Math.round((nowMs - a) / 60000)) : null; }
    if (c.calc === 'share') { const s = sums[c.of]; return s ? Math.round((num(x[c.of]) || 0) / s * 1000) / 10 : null; }
    if (c.calc === 'ratio') { const b = num(x[c.b]); return b ? Math.round((num(x[c.a]) || 0) / b * 100) / 100 : null; }
    if (c.calc === 'pct') { const b = num(x[c.b]); return b ? Math.round((num(x[c.a]) || 0) / b * 1000) / 10 : null; }
    let v = x[c.k]; if (v == null) return v;
    if (c.eat) { const l = toLocal(v); v = c.t === 'date' ? l.slice(0, 10) : c.t === 'time' ? l.slice(11, 16) : l.slice(0, 16); }
    else if (c.t === 'datetime' && typeof v === 'string') v = v.slice(0, 16);
    if (['int', 'money', 'pct', 'num'].includes(c.t)) { const n = num(v); return n == null ? v : n; }
    return v;
  }));
  const cell = (k, i) => out.map(r => r[i]);
  const totals = (def.totals || []).map(t => {
    const i = t.c ? (colIdx[t.c] != null ? colIdx[t.c] : -1) : -1, vals = i >= 0 ? cell(t.c, i).map(num).filter(v => v != null) : [];
    let v = t.fn === 'count' ? total : t.fn === 'sum' ? vals.reduce((a, b) => a + b, 0) : t.fn === 'max' ? (vals.length ? Math.max(...vals) : null) : (vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10 : null);
    return { label: t.l, value: v, type: t.t || 'int' };
  });
  return { key: def.key, title: def.title, desc: def.desc, group: def.group, columns: def.cols.map(c => ({ label: c.l, type: c.t === 'time' ? 'text' : c.t })), rows: out, rowCount: total, truncated: total > cap, totals, period: r, branch: p.branch };
}
const allowed = (def, role) => def.roles.includes(role);
const findDef = k => CAT.find(d => d.key === k);
const metaRows = (res, req, extra) => [['Report', res.title], ['What it shows', res.desc], ['Period (Nairobi dates)', res.period.from + ' to ' + res.period.to], ['Branch filter', res.branch || 'All branches'],
  ['Generated (Nairobi time)', toLocal(nowTs()).slice(0, 16)], ['Generated by', (req.user && (req.user.name || req.user.role)) + ' (' + roleOf(req) + ')'], ['Rows', res.rowCount + (res.truncated ? ' (cut off at the export limit)' : '')],
  ['Time and money', 'All times are Nairobi time (UTC+3). Money is in whole Kenya shillings (KSh).'], ['Order definitions', 'Closed = completed. Unsuccessful = cancelled, or M-Pesa payment failed and never completed. Sales figures use completed orders only.'],
  ['Confidential', 'Contains business data' + (res.group === 'Customers' || res.group === 'Audit' ? ' and personal data (Kenya Data Protection Act). Share only with people who need it.' : '. Share only with people who need it.')], ...(extra || [])];
const sheetOf = (res, name) => ({ name, columns: res.columns, rows: res.rows });
const note = (req, action, detail) => activity.log(req, 'export', action, { detail });

router.get('/admin/reports', requireAdmin, (req, res) => {
  const role = roleOf(req); const list = CAT.filter(d => allowed(d, role)).map(d => ({ key: d.key, group: d.group, title: d.title, desc: d.desc, branch: !!d.branch }));
  res.json({ role, reports: list, today: eatDay() });
});
router.get('/admin/reports/:key', requireAdmin, (req, res) => {
  const def = findDef(req.params.key); if (!def) return res.status(404).json({ error: 'Unknown report' }); if (!allowed(def, roleOf(req))) return res.status(403).json({ error: 'Your login cannot open this report' });
  try { const r = runReport(def, req.query, Math.min(Number(req.query.limit) || 100, 500)); res.json(r); } catch (e) { console.error('[azizo] report', def.key, e.message); res.status(500).json({ error: 'Could not build that report' }); }
});
router.get('/admin/reports/:key/export.xlsx', requireAdmin, (req, res) => {
  const def = findDef(req.params.key); if (!def) return res.status(404).json({ error: 'Unknown report' }); if (!allowed(def, roleOf(req))) return res.status(403).json({ error: 'Your login cannot export this report' });
  let r; try { r = runReport(def, req.query, 100000); } catch (e) { return res.status(500).json({ error: 'Could not build that report' }); }
  const sheets = [{ name: 'README', kv: true, rows: metaRows(r, req) }, { name: 'Summary', columns: [{ label: 'Measure', type: 'text' }, { label: 'Value', type: 'num' }], rows: r.totals.map(t => [t.label, t.value]) }, sheetOf(r, 'Data')];
  const buf = X.workbook(sheets, { title: r.title }); note(req, 'export-report', def.key + ' ' + r.period.from + '..' + r.period.to + ' rows=' + r.rowCount);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="azizo-${def.key}-${r.period.from}-to-${r.period.to}.xlsx"`); res.send(buf);
});
router.get('/admin/pack.xlsx', requireAdmin, (req, res) => {
  const role = roleOf(req), defs = CAT.filter(d => allowed(d, role) && (!req.query.group || d.group === req.query.group)), results = [];
  for (const d of defs) { try { results.push(runReport(d, req.query, 50000)); } catch (e) { /* a missing optional table should not sink the pack */ } }
  if (!results.length) return res.status(404).json({ error: 'Nothing to export' });
  const per = results[0].period, summary = []; results.forEach(r => r.totals.forEach(t => summary.push([r.title, t.label, t.value])));
  const sheets = [{ name: 'README', kv: true, rows: [['Azizo full data pack', 'One workbook with every report your login may see.'], ['Period (Nairobi dates)', per.from + ' to ' + per.to], ['Generated (Nairobi time)', toLocal(nowTs()).slice(0, 16)], ['Generated by', (req.user && (req.user.name || req.user.role)) + ' (' + role + ')'],
    ['Time and money', 'Nairobi time (UTC+3). Whole Kenya shillings.'], ['Order definitions', 'Closed = completed. Unsuccessful = cancelled or M-Pesa payment failed. Sales use completed orders only.'], ['Confidential', 'Contains business and personal data. Share only with people who need it.'],
    ...results.map((r, i) => ['Sheet ' + (i + 3) + ': ' + r.title, r.rowCount + ' rows. ' + r.desc])] },
    { name: 'Summary', columns: [{ label: 'Report', type: 'text' }, { label: 'Measure', type: 'text' }, { label: 'Value', type: 'num' }], rows: summary }, ...results.map(r => sheetOf(r, r.title.replace(/[()]/g, '')))];
  note(req, 'export-pack', per.from + '..' + per.to + ' sheets=' + results.length);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="azizo-data-pack-${per.from}-to-${per.to}.xlsx"`); res.send(X.workbook(sheets, { title: 'Azizo data pack' }));
});

// ---------- audit centre (owner) ----------
router.get('/admin/activity', requireAdmin, (req, res) => {
  const r = range(req.query), lim = Math.min(Number(req.query.limit) || 100, 500), off = Math.max(0, Number(req.query.offset) || 0), q = String(req.query.q || '').trim().slice(0, 60), cat = String(req.query.category || ''), who = String(req.query.actor || '').trim().slice(0, 60), outcome = String(req.query.outcome || '');
  const a = utcBound(r.from), b = utcBound(addDays(r.to, 1)), rows = [];
  if (cat !== 'security-events') {
    const w = ['ts >= ?', 'ts < ?'], p = [a, b]; if (cat) { w.push('category = ?'); p.push(cat); } if (who) { w.push('actor LIKE ?'); p.push('%' + who + '%'); } if (outcome) { w.push('outcome = ?'); p.push(outcome); }
    if (q) { w.push('(action LIKE ? OR detail LIKE ? OR target LIKE ? OR ip LIKE ?)'); p.push(...Array(4).fill('%' + q + '%')); }
    for (const x of db.prepare(`SELECT id, ts, category, action, actor, role, ip, target, detail, outcome FROM activity_log WHERE ${w.join(' AND ')} ORDER BY id DESC LIMIT 2000`).all(...p)) rows.push({ ...x, source: 'activity' });
  }
  if (!cat || cat === 'security' || cat === 'security-events') {
    const w = ['ts >= ?', 'ts < ?'], p = [a, b]; if (who) { w.push('actor LIKE ?'); p.push('%' + who + '%'); } if (q) { w.push('(type LIKE ? OR detail LIKE ? OR ip LIKE ? OR path LIKE ?)'); p.push(...Array(4).fill('%' + q + '%')); }
    if (!outcome || outcome === 'fail') for (const x of db.prepare(`SELECT id, ts, sev, type, ip, path, actor, detail FROM sec_events WHERE ${w.join(' AND ')} ORDER BY id DESC LIMIT 2000`).all(...p)) rows.push({ id: x.id, ts: x.ts, category: 'security', action: x.type, actor: x.actor || '', role: '', ip: x.ip, target: x.path || '', detail: x.detail || '', outcome: 'fail', severity: x.sev, source: 'security' });
  }
  rows.sort((x, y) => (y.ts > x.ts ? 1 : y.ts < x.ts ? -1 : y.id - x.id)); const page = rows.slice(off, off + lim).map(x => ({ ...x, when: toLocal(x.ts).slice(0, 16) }));
  const cats = db.prepare('SELECT category, COUNT(*) n FROM activity_log WHERE ts >= ? AND ts < ? GROUP BY category ORDER BY n DESC').all(a, b);
  res.json({ rows: page, total: rows.length, categories: cats, period: r, failedLogins: db.prepare("SELECT COUNT(*) n FROM activity_log WHERE action = 'login-failed' AND ts >= ? AND ts < ?").get(a, b).n });
});
router.get('/admin/activity/verify', requireAdmin, (req, res) => { const v = activity.verify(); activity.log(req, 'security', 'verify-audit-chain', { detail: v.ok ? 'intact, ' + v.checked + ' rows' : 'BROKEN at row ' + v.brokenAtId, outcome: v.ok ? 'ok' : 'fail' }); res.json(v); });

// ---------- visitors ----------
const BOT = /(bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|headless|lighthouse|curl|wget|python|scrapy|uptime)/i;
const hits = new Map();
router.post('/hit', (req, res) => {
  res.status(204).end();
  try {
    const ip = String(req.ip || '').replace(/^::ffff:/, ''), now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < 60000); if (arr.length >= 90) return; arr.push(now); hits.set(ip, arr); if (hits.size > 5000) hits.clear();
    const ua = String(req.headers['user-agent'] || ''); if (!ua || BOT.test(ua)) return;
    const b = req.body || {}; let path = String(b.p || '').split(/[?#]/)[0].slice(0, 120); if (!/^\/[A-Za-z0-9._\-\/]*$/.test(path) || path.includes('..') || path.includes('//')) return; if (/(admin|staff|operations|marketplace-admin|security-center|inspector|partner-portal|kitchens-admin)/i.test(path)) return;
    if (path.endsWith('/')) path += 'index.html'; if (path === '/') path = '/index.html';
    const ref = String(b.r || '').slice(0, 200), utm = String(b.u || '').toLowerCase().replace(/[^a-z0-9_\-]/g, '').slice(0, 30); let host = ''; try { host = new URL(ref).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) {}
    let source = utm || (!host ? 'direct' : /google\./.test(host) ? 'google' : /bing\.|duckduckgo|yahoo/.test(host) ? 'other search' : /facebook|fb\.|l\.facebook/.test(host) ? 'facebook' : /instagram/.test(host) ? 'instagram' : /(^|\.)t\.co$|twitter|x\.com/.test(host) ? 'x/twitter' : /tiktok/.test(host) ? 'tiktok' : /whatsapp|wa\.me/.test(host) ? 'whatsapp' : /youtube/.test(host) ? 'youtube' : 'other site');
    const own = String(req.headers.host || '').split(':')[0].replace(/^www\./, ''); if (host && host === own) source = 'internal';
    const w = Number(b.w) || 0, device = /ipad|tablet/i.test(ua) ? 'tablet' : /mobi|android|iphone/i.test(ua) ? 'mobile' : (w && w < 700 ? 'mobile' : 'desktop'), day = eatDay();
    const salt = crypto.createHash('sha256').update('azizo-visit|' + (process.env.ORDER_SIG_KEY || process.env.JWT_SECRET || 'dev')).digest('hex');
    const vid = crypto.createHash('sha256').update(salt + '|' + ip + '|' + ua + '|' + day).digest('hex').slice(0, 16); // changes daily, cannot be traced back to a person
    if (source === 'internal') { const seen = db.prepare('SELECT 1 FROM site_visits WHERE vid = ? AND day = ? LIMIT 1').get(vid, day); if (seen) source = (db.prepare('SELECT source FROM site_visits WHERE vid = ? AND day = ? ORDER BY id LIMIT 1').get(vid, day) || {}).source || 'direct'; else source = 'direct'; }
    db.prepare('INSERT INTO site_visits (ts, day, path, source, device, vid) VALUES (?,?,?,?,?,?)').run(nowTs(), day, path, source, device, vid);
  } catch (e) {}
});
router.get('/admin/visitors', requireAdmin, (req, res) => {
  const r = range(req.query), span = Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86400000) + 1, pf = addDays(r.from, -span), pt = addDays(r.from, -1);
  const tot = (f, t) => db.prepare('SELECT COUNT(DISTINCT vid) v, COUNT(*) p FROM site_visits WHERE day >= ? AND day <= ?').get(f, t);
  const cur = tot(r.from, r.to), prev = tot(pf, pt), orders = db.prepare("SELECT COUNT(*) n FROM orders WHERE created_at >= ? AND created_at < ? AND status <> 'cancelled'").get(utcBound(r.from), utcBound(addDays(r.to, 1))).n;
  const rep = k => runReport(findDef(k), { from: r.from, to: r.to }, 200);
  res.json({ period: r, visitorDays: cur.v, views: cur.p, prevVisitorDays: prev.v, prevViews: prev.p, orders, orderRatePct: cur.v ? Math.round(orders / cur.v * 1000) / 10 : null, daily: rep('visitors_daily'), pages: rep('visitors_pages'), sources: rep('visitors_sources'), devices: rep('visitors_devices'), funnel: rep('funnel_daily'),
    note: 'Visitors are counted per day from an anonymous code that changes daily. Nothing personal is stored. "Visitor-days" adds up each day\'s unique visitors, so the same person on two days counts twice.' });
});

// ---------- email settings (owner) ----------
router.get('/admin/mail', requireAdmin, (req, res) => res.json({ settings: mailer.publicConfig(), presets: { ssl: { port: 465, hint: 'Recommended for cPanel: SSL/TLS on port 465' }, starttls: { port: 587, hint: 'STARTTLS on port 587' } } }));
router.put('/admin/mail', requireAdmin, (req, res) => {
  const r = mailer.save(req.body || {}); if (r.errors) return res.status(400).json({ error: r.errors.join('. ') });
  activity.log(req, 'settings', 'mail-settings', { detail: 'changed: ' + r.changed.join(', ') }); res.json({ ok: true, settings: mailer.publicConfig() });
});
router.post('/admin/mail/test', requireAdmin, async (req, res) => {
  const to = String((req.body || {}).to || '').trim(); if (!mailer.isEmail(to)) return res.status(400).json({ error: 'Enter the email address to send the test to' });
  const who = (req.user && (req.user.name || req.user.role)) || 'admin', r = await mailer.sendMail({ to, force: true, subject: 'Azizo test email', text: 'This is a test email from your Azizo website.\n\nIf you can read this, your cPanel mailbox settings work.\nSent by ' + who + '.' }, who);
  activity.log(req, 'settings', 'mail-test', { target: to, outcome: r.ok ? 'ok' : 'fail', detail: r.ok ? 'test email sent' : r.error }); res.status(r.ok ? 200 : 400).json(r.ok ? { ok: true } : { error: r.error });
});
router.get('/admin/mail/log', requireAdmin, (req, res) => res.json({ log: db.prepare('SELECT id, ts, to_addr, subject, status, error, by_name FROM email_log ORDER BY id DESC LIMIT 100').all().map(x => ({ ...x, when: toLocal(x.ts).slice(0, 16) })) }));
module.exports = { router, runReport, CAT };
