// Security Center for the Node backend (v4.3). Same log, blocking, scanner detection and order seals as the PHP/cPanel backend.
const crypto = require('crypto');
const db = require('./db');
db.exec(`
  CREATE TABLE IF NOT EXISTS sec_events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, sev TEXT NOT NULL DEFAULT 'low', type TEXT NOT NULL DEFAULT '', ip TEXT DEFAULT '', ua TEXT DEFAULT '', path TEXT DEFAULT '', actor TEXT DEFAULT '', detail TEXT DEFAULT '');
  CREATE INDEX IF NOT EXISTS idx_sec_events_ts ON sec_events(ts);
  CREATE TABLE IF NOT EXISTS sec_blocks (ip TEXT PRIMARY KEY, until_ts INTEGER NOT NULL DEFAULT 0, reason TEXT DEFAULT '', auto_block INTEGER DEFAULT 1, strikes INTEGER DEFAULT 1, created_ts INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS sec_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, actor TEXT DEFAULT '', ip TEXT DEFAULT '', action TEXT DEFAULT '', detail TEXT DEFAULT '');
`);
if (!db.prepare("SELECT 1 FROM pragma_table_info('orders') WHERE name = 'sig'").get()) db.exec('ALTER TABLE orders ADD COLUMN sig TEXT');
try { if (!db.prepare("SELECT 1 FROM pragma_table_info('kk_orders') WHERE name = 'sig'").get()) db.exec('ALTER TABLE kk_orders ADD COLUMN sig TEXT'); } catch (e) {}
const W = { 'login-fail': 0.5, lockout: 3, 'rate-limit': 1, probe: 4, scanner: 2, 'scanner-ua': 10, 'token-forged': 3, 'mpesa-forged': 6, 'mpesa-amount': 6, 'order-tamper': 4, 'fee-tamper': 1, forbidden: 1.5, 'bad-method': 2, oversize: 2 };
const nowTs = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const ipOf = req => String((req && (req.ip || (req.socket && req.socket.remoteAddress))) || '').replace(/^::ffff:/, '');
const exempt = ip => /^(127\.|::1$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) || String(process.env.SEC_ALLOW_IPS || '').split(',').map(s => s.trim()).includes(ip);
const isLocalReq = req => exempt(ipOf(req));
function event(req, type, sev, detail, actor) {
  try {
    const ip = ipOf(req);
    db.prepare('INSERT INTO sec_events (ts, sev, type, ip, ua, path, actor, detail) VALUES (?,?,?,?,?,?,?,?)').run(nowTs(), sev || 'low', type, ip, String((req.headers && req.headers['user-agent']) || '').slice(0, 160), String(req.path || req.url || '').slice(0, 160), actor || '', String(detail || '').replace(/[\x00-\x1f]/g, ' ').slice(0, 400));
    if (process.env.SEC_AUTO_BLOCK !== '0' && !exempt(ip)) {
      const rows = db.prepare('SELECT type, COUNT(*) n FROM sec_events WHERE ip = ? AND ts >= ? GROUP BY type').all(ip, new Date(Date.now() - 600000).toISOString().slice(0, 19).replace('T', ' '));
      if (rows.reduce((s, r) => s + (W[r.type] || 0) * r.n, 0) >= 10) block(ip, 0, 'Automatic: repeated attack events', true);
    }
  } catch (e) { console.error('[azizo] sec event failed', e.message); }
}
function block(ip, seconds, reason, auto) {
  const now = Math.floor(Date.now() / 1000), r = db.prepare('SELECT * FROM sec_blocks WHERE ip = ?').get(ip);
  const strikes = r ? r.strikes + (auto && r.until_ts < now ? 1 : 0) : 1;
  if (!seconds) seconds = strikes <= 1 ? 3600 : strikes === 2 ? 86400 : 7 * 86400;
  db.prepare('INSERT INTO sec_blocks (ip, until_ts, reason, auto_block, strikes, created_ts) VALUES (?,?,?,?,?,?) ON CONFLICT(ip) DO UPDATE SET until_ts = excluded.until_ts, reason = excluded.reason, auto_block = excluded.auto_block, strikes = ?').run(ip, now + seconds, String(reason).slice(0, 200), auto ? 1 : 0, strikes, now, strikes);
  db.prepare('INSERT INTO sec_events (ts, sev, type, ip, detail, actor) VALUES (?,?,?,?,?,?)').run(nowTs(), 'high', auto ? 'auto-block' : 'manual-block', ip, reason, auto ? 'system' : 'admin');
}
function audit(req, action, detail, actor) { try { db.prepare('INSERT INTO sec_audit (ts, actor, ip, action, detail) VALUES (?,?,?,?,?)').run(nowTs(), actor || 'admin', ipOf(req), action, String(detail || '').slice(0, 400)); } catch (e) {} }
const RULES = [
  [/(union\s+(all\s+)?select\b|['"]\s*(or|and)\s+['"]?\d+['"]?\s*=\s*['"]?\d+|\b(sleep|benchmark)\s*\(\s*\d|;\s*(drop|truncate|alter)\s+table|\bxp_cmdshell\b|\bload_file\s*\(|into\s+(out|dump)file|information_schema\.)/i, 'SQL injection'],
  [/(<\s*script\b|<\s*iframe\b|javascript\s*:|\bon(error|load|mouseover|focus)\s*=\s*["']?\w)/i, 'Script injection'],
  [/(\.\.\/|\.\.\\|%2e%2e[\/\\%])/i, 'Path traversal'],
  [/(etc\/passwd|etc\/shadow|proc\/self\/|php:\/\/(input|filter)|expect:\/\/|<\?php|\$\{jndi:|\b(eval|assert|system|passthru|shell_exec|base64_decode)\s*\()/i, 'Code/file inclusion'],
  [/(;|\|\||&&|\|)\s*(cat|wget|curl|bash|sh|nc|powershell)\s+[\w\/\-.]/i, 'Command injection'],
];
const SCAN_UA = /(sqlmap|nikto|nmap|masscan|acunetix|wpscan|dirbuster|gobuster|havij|nessus|openvas|zgrab|w3af|metasploit|nuclei|hydra)/i;
const DECOY = /^\/(wp-login\.php|wp-admin|wp-content|xmlrpc\.php|phpmyadmin|pma|adminer|admin\.php|shell\.php|\.env|\.git|server-status|cgi-bin|actuator)(\/|$)/i;
/** Express middleware: refuse blocked addresses, log/stop attack signatures and scanner decoys. Enforced for outside visitors; on this machine/LAN it only logs. */
function guard(req, res, next) {
  const ip = ipOf(req), local = isLocalReq(req) && !process.env.SEC_FORCE_STRICT;
  if (!local) { const b = db.prepare('SELECT until_ts FROM sec_blocks WHERE ip = ?').get(ip); if (b && b.until_ts > Date.now() / 1000) return res.status(403).json({ error: 'Access from your address is temporarily blocked.' }); }
  if (DECOY.test(req.path)) { event(req, 'scanner', 'high', 'Probe of a decoy address: ' + req.path); return res.status(404).type('text').send('Not found'); }
  const ua = String(req.headers['user-agent'] || ''), m = ua.match(SCAN_UA);
  if (m) { event(req, 'scanner-ua', 'high', 'Hacking tool: ' + m[1]); if (!local) return res.status(403).json({ error: 'Request blocked for security reasons' }); }
  const hay = decodeURIComponent((req.originalUrl || '').replace(/%(?![0-9a-f]{2})/gi, '%25')) + ' ' + (req.body && typeof req.body === 'object' ? JSON.stringify(req.body).slice(0, 8192) : '');
  for (const [rx, name] of RULES) { const mm = hay.match(rx); if (mm) { event(req, 'probe', 'high', name + ': ' + mm[0].trim().slice(0, 80)); if (!local) return res.status(403).json({ error: 'Request blocked for security reasons' }); break; } }
  next();
}
// ---- order seals ----
const sigKey = () => crypto.createHash('sha256').update('azizo-order-sig|' + (process.env.ORDER_SIG_KEY || process.env.JWT_SECRET || 'insecure-dev-only-secret-change-me')).digest();
function sigCalc(o) {
  const items = db.prepare('SELECT product_id, qty, unit_price, line_total FROM order_items WHERE order_id = ? ORDER BY id').all(o.id).map(r => `${r.product_id || ''}:${Number(r.qty).toFixed(2)}:${Math.round(r.unit_price)}:${Math.round(r.line_total)};`).join('');
  return crypto.createHmac('sha256', sigKey()).update([o.id, o.customer_phone, o.fulfilment, o.payment_method, Math.round(o.total), Math.round(o.items_subtotal || 0), Math.round(o.delivery_fee || 0), o.partner_id || 0, items].join('|')).digest('hex');
}
function sign(id) { const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id); if (o) db.prepare('UPDATE orders SET sig = ? WHERE id = ?').run(sigCalc(o), id); }
function verifyRecent(req, days) {
  const rows = db.prepare("SELECT * FROM orders WHERE created_at >= datetime('now', ?) ORDER BY id DESC LIMIT 3000").all('-' + (days + 1) + ' days');
  const res = { checked: 0, ok: 0, unsigned: 0, tampered: [] };
  for (const o of rows) { res.checked++; if (!o.sig) { res.unsigned++; continue; } if (o.sig === sigCalc(o)) res.ok++; else { res.tampered.push(o.id); if (!db.prepare("SELECT 1 FROM sec_events WHERE type = 'order-tampered' AND detail LIKE ?").get('Order #' + o.id + ' %')) event(req, 'order-tampered', 'crit', 'Order #' + o.id + ' no longer matches its signature (changed outside the website)'); } }
  return res;
}
function kkSigCalc(o) {
  const items = db.prepare('SELECT dish_id, qty, unit_price, line_total, options_text FROM kk_order_items WHERE order_id = ? ORDER BY id').all(o.id).map(r => `${r.dish_id || ''}:${r.qty}:${Math.round(r.unit_price)}:${Math.round(r.line_total)}:${r.options_text || ''};`).join('');
  return crypto.createHmac('sha256', sigKey()).update(['kk', o.id, o.phone, Math.round(o.subtotal), Math.round(o.delivery_fee), Math.round(o.discount || 0), Math.round(o.total), o.date, o.meal, items].join('|')).digest('hex');
}
function kkSign(id) { try { const o = db.prepare('SELECT * FROM kk_orders WHERE id = ?').get(id); if (o) db.prepare('UPDATE kk_orders SET sig = ? WHERE id = ?').run(kkSigCalc(o), id); } catch (e) {} }
function kkVerifyRecent(req, days) {
  const res = { checked: 0, ok: 0, unsigned: 0, tampered: [] }; let rows = [];
  try { rows = db.prepare("SELECT * FROM kk_orders WHERE created_at >= datetime('now', ?) ORDER BY id DESC LIMIT 3000").all('-' + (days + 1) + ' days'); } catch (e) { return res; }
  for (const o of rows) { res.checked++; if (!o.sig) { res.unsigned++; continue; } if (o.sig === kkSigCalc(o)) res.ok++; else { res.tampered.push(o.id); if (!db.prepare("SELECT 1 FROM sec_events WHERE type = 'order-tampered' AND detail LIKE ?").get('Kitchens order #' + o.id + ' %')) event(req, 'order-tampered', 'crit', 'Kitchens order #' + o.id + ' no longer matches its signature (changed outside the website)'); } }
  return res;
}
// ---- admin API ----
const express = require('express');
const { requireAdmin } = require('./middleware/auth');
const router = express.Router();
router.use(requireAdmin);
router.get('/', (req, res) => {
  const q = req.query, days = Math.max(1, Math.min(180, parseInt(q.days, 10) || 7)), since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const rank = { info: 0, low: 1, med: 2, high: 3, crit: 4 };
  const where = ['ts >= ?'], par = [since];
  if (q.sev && rank[q.sev] !== undefined) { const ok = Object.keys(rank).filter(k => rank[k] >= rank[q.sev]); where.push('sev IN (' + ok.map(() => '?').join(',') + ')'); par.push(...ok); }
  if (q.type) { where.push('type = ?'); par.push(String(q.type).slice(0, 32)); }
  if (q.ip) { where.push('ip = ?'); par.push(String(q.ip).slice(0, 45)); }
  if (q.q) { const like = '%' + String(q.q).replace(/[%_]/g, '').slice(0, 60) + '%'; where.push('(detail LIKE ? OR path LIKE ? OR ua LIKE ?)'); par.push(like, like, like); }
  const Wh = where.join(' AND ');
  if (q.csv) {
    const rows = db.prepare(`SELECT ts, sev, type, ip, path, actor, detail, ua FROM sec_events WHERE ${Wh} ORDER BY id DESC LIMIT 5000`).all(...par);
    const cell = v => { v = String(v == null ? '' : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="azizo-security-log.csv"' });
    return res.send(['Time (UTC),Severity,Type,IP address,Path,Who,Detail,Browser'].concat(rows.map(r => Object.values(r).map(cell).join(','))).join('\n'));
  }
  if (q.events) {
    const lim = Math.max(1, Math.min(200, parseInt(q.limit, 10) || 50)), off = Math.max(0, parseInt(q.offset, 10) || 0);
    return res.json({ total: db.prepare(`SELECT COUNT(*) n FROM sec_events WHERE ${Wh}`).get(...par).n, events: db.prepare(`SELECT id, ts, sev, type, ip, ua, path, actor, detail FROM sec_events WHERE ${Wh} ORDER BY id DESC LIMIT ${lim} OFFSET ${off}`).all(...par) });
  }
  const since7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 19).replace('T', ' '), rows = db.prepare('SELECT ts, sev, type, ip FROM sec_events WHERE ts >= ? ORDER BY id DESC LIMIT 6000').all(since7);
  const d24 = Date.now() - 86400000, sum = { events24: 0, events7d: rows.length, high24: 0, loginFails24: 0, lockouts24: 0, probes24: 0, tamper24: 0, forged24: 0 }, byType = {}, ips = {}, hours = new Array(24).fill(0);
  for (const r of rows) {
    const t = Date.parse(r.ts.replace(' ', 'T') + 'Z'); byType[r.type] = (byType[r.type] || 0) + 1; if (t < d24) continue;
    sum.events24++; if (r.sev === 'high' || r.sev === 'crit') sum.high24++;
    if (r.type === 'login-fail') sum.loginFails24++; if (r.type === 'lockout') sum.lockouts24++;
    if (['probe', 'scanner', 'scanner-ua'].includes(r.type)) sum.probes24++; if (['order-tamper', 'fee-tamper', 'order-tampered'].includes(r.type)) sum.tamper24++; if (['token-forged', 'mpesa-forged', 'mpesa-amount'].includes(r.type)) sum.forged24++;
    hours[Math.min(23, Math.floor((Date.now() - t) / 3600000))]++;
    if (!['auto-block', 'manual-block', 'unblock'].includes(r.type)) { const o = ips[r.ip] = ips[r.ip] || { ip: r.ip, n: 0, points: 0, last: r.type }; o.n++; o.points += W[r.type] || 0; }
  }
  const top = Object.values(ips).sort((a, b) => b.points - a.points || b.n - a.n).slice(0, 10);
  const sortedTypes = Object.fromEntries(Object.entries(byType).sort((a, b) => b[1] - a[1]));
  const unsigned = db.prepare("SELECT COUNT(*) n FROM orders WHERE sig IS NULL AND created_at >= datetime('now','-7 days')").get().n;
  const checks = [
    { ok: !!process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32, label: 'JWT secret is strong and not the shipped default', fix: 'Set JWT_SECRET (32+ random characters) in .env.' },
    { ok: !!process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD !== 'majani90' && process.env.ADMIN_PASSWORD.length >= 10, label: 'Admin password is not the default and is 10+ characters', fix: 'Change ADMIN_PASSWORD in .env.' },
    { ok: process.env.SEC_AUTO_BLOCK !== '0', label: 'Attackers are blocked automatically', fix: 'Remove SEC_AUTO_BLOCK=0 from .env.' },
    { ok: !!process.env.SEC_ALERT_EMAIL, label: 'Security alert emails are switched on', fix: 'The cPanel (PHP) backend sends the emails; set SEC_ALERT_EMAIL there.' },
    { ok: unsigned === 0, label: 'Every recent order carries a tamper signature', fix: unsigned + ' order(s) from the last 7 days have no signature.' },
  ];
  res.json({ checks, summary: sum, hours: hours.reverse(), byType: sortedTypes, topIps: top, blocks: db.prepare('SELECT ip, until_ts, reason, auto_block, strikes, created_ts FROM sec_blocks WHERE until_ts > ? ORDER BY until_ts DESC LIMIT 200').all(Math.floor(Date.now() / 1000)), audit: db.prepare('SELECT ts, actor, ip, action, detail FROM sec_audit ORDER BY id DESC LIMIT 100').all(), myIp: ipOf(req), now: Math.floor(Date.now() / 1000) });
});
router.post('/', (req, res) => {
  const b = req.body || {}, a = String(b.action || '');
  const validIp = v => /^[0-9a-f:.]{3,45}$/i.test(String(v || '')) ? String(v) : null;
  if (a === 'block') { const ip = validIp(b.ip); if (!ip) return res.status(400).json({ error: 'Enter a valid IP address' }); if (ip === ipOf(req) && !b.force) return res.status(400).json({ error: 'That is your own address — blocking it would lock you out.' }); block(ip, Math.max(1, Math.min(8760, parseInt(b.hours, 10) || 24)) * 3600, 'Blocked by admin: ' + String(b.reason || 'manual').slice(0, 120), false); audit(req, 'block-ip', ip); return res.json({ ok: true }); }
  if (a === 'unblock') { const ip = validIp(b.ip); if (!ip) return res.status(400).json({ error: 'Enter a valid IP address' }); db.prepare('DELETE FROM sec_blocks WHERE ip = ?').run(ip); event(req, 'unblock', 'info', 'Unblocked by admin: ' + ip, 'admin'); audit(req, 'unblock-ip', ip); return res.json({ ok: true }); }
  if (a === 'verify-orders') { const dd = Math.max(1, Math.min(365, parseInt(b.days, 10) || 30)); const r = verifyRecent(req, dd); r.kitchens = kkVerifyRecent(req, dd); audit(req, 'verify-orders', 'checked ' + (r.checked + r.kitchens.checked) + ', tampered ' + (r.tampered.length + r.kitchens.tampered.length)); return res.json(r); }
  if (a === 'revoke-all') return res.status(501).json({ error: 'Sign-out-everyone is available on the cPanel (PHP) backend. Here, change JWT_SECRET in .env and restart.' });
  res.status(400).json({ error: 'Unknown action' });
});
module.exports = { guard, event, router, sign, kkSign, audit, verifyRecent };
