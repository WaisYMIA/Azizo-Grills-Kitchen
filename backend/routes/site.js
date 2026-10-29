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
  return { eventBudget: eb, marketplace: { enabled: !!(saved.marketplace && saved.marketplace.enabled) } };
}
router.get('/settings', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(read()); });
router.put('/settings', requireAdmin, (req, res) => {
  const b = (req.body || {}).eventBudget || {}, cur = read().eventBudget;
  const next = {
    enabled: 'enabled' in b ? !!b.enabled : cur.enabled,
    note: 'note' in b ? String(b.note || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300) : cur.note,
    contingencyPct: 'contingencyPct' in b ? Math.min(50, Math.max(0, Number(b.contingencyPct) || 0)) : cur.contingencyPct
  };
  let all = {}; try { all = JSON.parse(db.metaGet('site_settings') || '{}'); } catch (e) {}
  all.eventBudget = next; db.metaSet('site_settings', JSON.stringify(all));
  res.json(read());
});

// ---------- event enquiries (leads from the Event Budget Planner) ----------
db.exec(`CREATE TABLE IF NOT EXISTS site_leads (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now')), name TEXT, phone TEXT, event_date TEXT DEFAULT '', guests INTEGER DEFAULT 0, venue TEXT DEFAULT '', note TEXT DEFAULT '', estimate INTEGER DEFAULT 0, mode TEXT DEFAULT 'cost', items TEXT DEFAULT '[]', status TEXT DEFAULT 'new', admin_note TEXT DEFAULT '', updated_at TEXT)`);
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, n);
const STATUSES = ['new', 'contacted', 'quoted', 'won', 'lost'];
const hits = new Map();
function leadLimiter(req, res, next) {
  const v = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || 'unknown', now = Date.now();
  const recent = (hits.get(v) || []).filter(t => now - t < 3600000); if (recent.length >= 5) return res.status(429).json({ error: 'Too many requests. Please call or WhatsApp us instead.' });
  recent.push(now); hits.set(v, recent); next();
}
const leadOut = r => ({ id: r.id, created: r.created_at, name: r.name, phone: r.phone, eventDate: r.event_date, guests: r.guests, venue: r.venue, note: r.note, estimate: r.estimate, mode: r.mode, items: (() => { try { return JSON.parse(r.items); } catch (e) { return []; } })(), status: r.status, adminNote: r.admin_note });
router.post('/leads', leadLimiter, (req, res) => {
  const b = req.body || {}; if (b.website) return res.status(201).json({ ok: true });
  if (!read().eventBudget.enabled) return res.status(403).json({ error: 'The planner is not taking requests right now. Please call or WhatsApp us.' });
  const name = clean(b.name, 60), phone = clean(b.phone, 20); if (name.length < 2) return res.status(400).json({ error: 'Enter your name' }); if (phone.replace(/\D/g, '').length < 9) return res.status(400).json({ error: 'Enter a valid phone number' });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.eventDate || '')) ? b.eventDate : '';
  const items = (Array.isArray(b.items) ? b.items.slice(0, 40) : []).map(i => ({ name: clean(i.name, 80), qty: Math.max(0, Math.min(99999, Number(i.qty) || 0)), unit: clean(i.unit, 12), cost: Math.max(0, Math.round(Number(i.cost) || 0)) })).filter(i => i.name);
  const r = db.prepare('INSERT INTO site_leads (name, phone, event_date, guests, venue, note, estimate, mode, items) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(name, phone, date, Math.max(0, Math.min(5000, parseInt(b.guests, 10) || 0)), clean(b.venue, 120), clean(b.note, 400), Math.max(0, Math.round(Number(b.estimate) || 0)), b.mode === 'qty' ? 'qty' : 'cost', JSON.stringify(items));
  res.status(201).json({ ok: true, id: r.lastInsertRowid });
});
router.get('/leads', requireAdmin, (req, res) => { res.set('Cache-Control', 'no-store'); const st = STATUSES.includes(req.query.status) ? req.query.status : null;
  res.json({ leads: db.prepare('SELECT * FROM site_leads ' + (st ? 'WHERE status = ? ' : '') + 'ORDER BY id DESC LIMIT 500').all(...(st ? [st] : [])).map(leadOut), counts: db.prepare('SELECT status, COUNT(*) AS n FROM site_leads GROUP BY status').all() }); });
router.patch('/leads/:id(\\d+)', requireAdmin, (req, res) => {
  const r = db.prepare('SELECT * FROM site_leads WHERE id = ?').get(req.params.id), b = req.body || {}; if (!r) return res.status(404).json({ error: 'Not found' });
  const status = b.status === undefined ? r.status : b.status; if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status' });
  db.prepare("UPDATE site_leads SET status = ?, admin_note = ?, updated_at = datetime('now') WHERE id = ?").run(status, b.adminNote === undefined ? r.admin_note : clean(b.adminNote, 400), r.id); res.json({ ok: true });
});
router.get('/leads.csv', requireAdmin, (req, res) => {
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"', rows = db.prepare('SELECT * FROM site_leads ORDER BY id DESC').all();
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="azizo-event-enquiries.csv"' });
  res.send('\ufeff' + [['Id', 'Received', 'Name', 'Phone', 'Event date', 'Guests', 'Venue', 'Estimate KES', 'Status', 'Note', 'Admin note'].map(q).join(',')].concat(rows.map(r => [r.id, r.created_at, r.name, r.phone, r.event_date, r.guests, r.venue, r.estimate, r.status, r.note, r.admin_note].map(q).join(','))).join('\r\n'));
});
module.exports = router;
