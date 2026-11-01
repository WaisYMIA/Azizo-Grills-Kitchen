// Azizo partner inspection (v4.4): the standard, the scoring and the tamper seal. The score is ALWAYS worked out here, never trusted from the browser.
const crypto = require('crypto');
const db = require('./db');
const STD = require('./inspection-standard.json');
db.exec(`CREATE TABLE IF NOT EXISTS mk_inspections (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT DEFAULT '', partner_id INTEGER NOT NULL, inspector_name TEXT, inspector_title TEXT, visit_type TEXT, inspected_at TEXT,
  score REAL, grade TEXT, stars INTEGER, result TEXT, critical_fails INTEGER DEFAULT 0, answers TEXT, cat_scores TEXT, notes TEXT DEFAULT '', actions TEXT DEFAULT '', action_due TEXT DEFAULT '',
  rep_name TEXT DEFAULT '', rep_role TEXT DEFAULT '', insp_sig TEXT DEFAULT '', rep_sig TEXT DEFAULT '', std_version TEXT, next_due TEXT, seal TEXT, created_at TEXT DEFAULT (datetime('now')));
  CREATE INDEX IF NOT EXISTS idx_mkinsp_partner ON mk_inspections(partner_id, id);`);
const VAL = { pass: 1, partial: 0.5, fail: 0 };
const bandFor = s => STD.bands.find(b => s >= b.min) || STD.bands[STD.bands.length - 1];
/** answers: { itemId: { v: 'pass'|'partial'|'fail'|'na', n: 'finding' } }. Returns {error} or the full result. */
function score(answers) {
  if (!answers || typeof answers !== 'object') return { error: 'Answer every checklist item' };
  const clean = {}, crit = []; let total = 0, applicable = 0, answered = 0, items = 0, wsum = 0;
  const cats = [];
  for (const c of STD.categories) {
    let w = 0, s = 0;
    for (const i of c.items) {
      items++; const a = answers[i.id] || {}, v = String(a.v || ''), n = String(a.n || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, 300);
      if (!(v in VAL) && v !== 'na') return { error: 'Please answer item ' + i.id };
      if (v === 'na' && i.critical) return { error: 'Item ' + i.id + ' is critical and cannot be "Not applicable"' };
      if (v === 'fail' && n.length < 5) return { error: 'Write a short finding for the failed item ' + i.id };
      answered++; clean[i.id] = { v, n };
      if (v === 'na') continue;
      applicable++; w += i.w; s += i.w * VAL[v];
      if (v === 'fail' && i.critical) crit.push(i.id);
    }
    const pct = w ? s / w : null; cats.push({ id: c.id, name: c.name, weight: c.weight, pct: pct === null ? null : Math.round(pct * 1000) / 10 });
    if (pct !== null) { total += c.weight * pct; wsum += c.weight; }
  }
  if (applicable < Math.ceil(items * 0.6)) return { error: 'Too many items marked Not applicable (at least 60% must be assessed)' };
  let sc = wsum ? total / wsum * 100 : 0, capped = false;
  if (crit.length && sc > 59) { sc = 59; capped = true; }
  sc = Math.round(sc * 10) / 10; const b = bandFor(sc);
  const result = crit.length || sc < 60 ? 'Fail' : sc < 70 ? 'Conditional' : 'Pass';
  return { answers: clean, score: sc, grade: b.grade, stars: b.stars, label: b.label, action: b.action, reinspectDays: b.reinspectDays, result, criticalFails: crit, capped, catScores: cats };
}
const key = () => crypto.createHash('sha256').update('azizo-order-sig|' + (process.env.ORDER_SIG_KEY || process.env.JWT_SECRET || 'insecure-dev-only-secret-change-me')).digest();
const seal = r => crypto.createHmac('sha256', key()).update(['insp', r.id, r.ref, r.partner_id, r.score, r.grade, r.inspected_at, r.inspector_name, r.answers].join('|')).digest('hex');
const sealOk = r => !!r.seal && r.seal === seal(r);
module.exports = { STD, score, seal, sealOk, bandFor };
