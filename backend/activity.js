// Tamper-evident activity log (v5.5). Every row stores a SHA-256 hash of its content plus the previous row's hash, so an edited,
// deleted or inserted row breaks the chain and shows up in "Verify integrity".
const crypto = require('crypto');
const db = require('./db');
db.exec(`CREATE TABLE IF NOT EXISTS activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, category TEXT DEFAULT '', action TEXT DEFAULT '', actor TEXT DEFAULT '', role TEXT DEFAULT '', ip TEXT DEFAULT '', target TEXT DEFAULT '', detail TEXT DEFAULT '', outcome TEXT DEFAULT 'ok', prev_hash TEXT DEFAULT '', hash TEXT DEFAULT '');
  CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity_log(ts);`);
const nowTs = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const clean = (v, n) => String(v == null ? '' : v).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ').trim().slice(0, n);
const ipOf = req => String((req && (req.ip || (req.socket && req.socket.remoteAddress))) || '').replace(/^::ffff:/, '');
const hashOf = (p, r) => crypto.createHash('sha256').update([p, r.ts, r.category, r.action, r.actor, r.role, r.ip, r.target, r.detail, r.outcome].join('␟')).digest('hex');
function categoryOf(a) {
  a = String(a).toLowerCase();
  if (/login|logout|password|passcode|2fa|totp/.test(a)) return 'auth';
  if (/export|download/.test(a)) return 'export';
  if (/team|account|owner/.test(a)) return 'team';
  if (/refund|cashup|cash-up|price|payout|mpesa|payment/.test(a)) return 'money';
  if (/setting|mail|config|ai-|key/.test(a)) return 'settings';
  if (/inspect|golive|partner|market/.test(a)) return 'marketplace';
  if (/order/.test(a)) return 'orders';
  if (/block|security|lock/.test(a)) return 'security';
  return 'admin';
}
function log(req, category, action, o) {
  try {
    o = o || {}; const u = (req && req.user) || {};
    const r = { ts: nowTs(), category: clean(category || categoryOf(action), 20), action: clean(action, 60), actor: clean(o.actor || u.name || u.role || '', 80), role: clean(o.role || u.tr || (u.role === 'admin' ? 'owner' : u.role) || '', 20),
      ip: clean(ipOf(req), 60), target: clean(o.target, 100), detail: clean(o.detail, 500), outcome: o.outcome === 'fail' ? 'fail' : 'ok' };
    db.transaction(() => {
      const last = db.prepare('SELECT hash FROM activity_log ORDER BY id DESC LIMIT 1').get(); const prev = last ? last.hash : '';
      db.prepare('INSERT INTO activity_log (ts, category, action, actor, role, ip, target, detail, outcome, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(r.ts, r.category, r.action, r.actor, r.role, r.ip, r.target, r.detail, r.outcome, prev, hashOf(prev, r));
    })();
  } catch (e) { console.error('[azizo] activity log failed', e.message); }
}
function verify() {
  let prev = '', n = 0;
  for (const r of db.prepare('SELECT * FROM activity_log ORDER BY id').iterate()) {
    n++; if (r.prev_hash !== prev || r.hash !== hashOf(prev, r)) return { ok: false, checked: n, brokenAtId: r.id };
    prev = r.hash;
  }
  return { ok: true, checked: n, brokenAtId: null };
}
// one-time carry-over of the older admin audit rows so history is not lost
try {
  if (!db.prepare('SELECT 1 FROM activity_log LIMIT 1').get()) {
    const old = db.prepare('SELECT * FROM sec_audit ORDER BY id').all(); let prev = '';
    db.transaction(() => { for (const a of old) {
      const r = { ts: a.ts, category: categoryOf(a.action), action: clean(a.action, 60), actor: clean(a.actor, 80), role: '', ip: clean(a.ip, 60), target: '', detail: clean(a.detail, 500), outcome: 'ok' };
      const h = hashOf(prev, r); db.prepare('INSERT INTO activity_log (ts, category, action, actor, role, ip, target, detail, outcome, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(r.ts, r.category, r.action, r.actor, r.role, r.ip, r.target, r.detail, r.outcome, prev, h); prev = h; } })();
  }
} catch (e) { /* sec_audit may not exist yet on a brand-new database */ }
module.exports = { log, verify, categoryOf };
