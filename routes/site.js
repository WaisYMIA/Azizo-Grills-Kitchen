// Site-wide switches the admin controls from the dashboard (Settings tab).
// Today: the Event Budget Planner (on/off, a note shown on the page, and the contingency % added to estimates).
const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();
const DEFAULTS = { eventBudget: { enabled: true, note: '', contingencyPct: 10 } };
function read() {
  let saved = {}; try { const v = db.metaGet('site_settings'); if (v) saved = JSON.parse(v); } catch (e) {}
  const eb = Object.assign({}, DEFAULTS.eventBudget, saved.eventBudget || {});
  eb.enabled = eb.enabled !== false && eb.enabled !== 0 && eb.enabled !== '0';
  eb.contingencyPct = Math.min(50, Math.max(0, Number(eb.contingencyPct) || 0));
  eb.note = String(eb.note || '').slice(0, 300);
  return { eventBudget: eb };
}
router.get('/settings', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(read()); });
router.put('/settings', requireAdmin, (req, res) => {
  const b = (req.body || {}).eventBudget || {}, cur = read().eventBudget;
  const next = {
    enabled: 'enabled' in b ? !!b.enabled : cur.enabled,
    note: 'note' in b ? String(b.note || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300) : cur.note,
    contingencyPct: 'contingencyPct' in b ? Math.min(50, Math.max(0, Number(b.contingencyPct) || 0)) : cur.contingencyPct
  };
  db.metaSet('site_settings', JSON.stringify({ eventBudget: next }));
  res.json(read());
});
module.exports = router;
