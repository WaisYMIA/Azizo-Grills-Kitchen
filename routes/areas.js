const express = require('express');
const db = require('../db');
const { requireAdmin, requireStaff } = require('../middleware/auth');
const router = express.Router();

function noStore(req, res, next) { res.set('Cache-Control', 'no-store'); next(); }

const DEFAULT_CFG = { baseFee: 100, perKm: 25, bandKm: 2, maxFee: 450, maxKm: 30, roadFactor: 1.3, nearerBranchKm: 2.5 };
function getConfig() {
  let saved = {};
  try { const r = db.prepare("SELECT value FROM meta WHERE key = 'delivery_config'").get(); if (r) saved = JSON.parse(r.value); } catch (e) {}
  return Object.assign({}, DEFAULT_CFG, saved);
}
const toArea = r => ({ id: r.id, region: r.region, name: r.name, corridor: r.corridor || '', lat: r.lat, lng: r.lng, active: !!r.active, sortOrder: r.sort_order });
const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);

// Public: only zones admin has ticked as served. Distance and fee are worked out in the browser
// from the live branch list, so a hidden/closed branch drops out of every quote straight away.
router.get('/', noStore, (req, res) => {
  const rows = db.prepare('SELECT * FROM areas WHERE active = 1 ORDER BY sort_order, name').all();
  res.json({ config: getConfig(), areas: rows.map(toArea) });
});
router.get('/all', requireStaff, noStore, (req, res) => {
  const rows = db.prepare('SELECT * FROM areas ORDER BY sort_order, name').all();
  res.json({ config: getConfig(), areas: rows.map(toArea) });
});

router.post('/config', requireAdmin, (req, res) => {
  const b = req.body || {}, cfg = getConfig(), next = {};
  const limits = { baseFee: [0, 5000], perKm: [0, 500], bandKm: [0.5, 20], maxFee: [0, 20000], maxKm: [1, 200], roadFactor: [1, 2.5], nearerBranchKm: [0, 50] };
  for (const k of Object.keys(limits)) {
    const v = b[k] === undefined ? cfg[k] : Number(b[k]);
    if (!Number.isFinite(v) || v < limits[k][0] || v > limits[k][1]) return res.status(400).json({ error: `${k} must be a number between ${limits[k][0]} and ${limits[k][1]}` });
    next[k] = v;
  }
  db.prepare("INSERT INTO meta (key, value) VALUES ('delivery_config', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(next));
  res.json({ ok: true, config: next });
});

// Tick / untick many zones at once: {active, region?} for a whole region, {active, ids:[...]} for a list,
// or {active, all:true}.
router.post('/bulk', requireAdmin, (req, res) => {
  const b = req.body || {}, active = b.active ? 1 : 0;
  let info;
  if (Array.isArray(b.ids) && b.ids.length) {
    const st = db.prepare('UPDATE areas SET active = ? WHERE id = ?');
    info = { changes: db.transaction(() => b.ids.reduce((n, id) => n + st.run(active, String(id)).changes, 0))() };
  } else if (b.region) info = db.prepare('UPDATE areas SET active = ? WHERE region = ?').run(active, String(b.region));
  else if (b.all) info = db.prepare('UPDATE areas SET active = ?').run(active);
  else return res.status(400).json({ error: 'Say which zones: ids, region or all' });
  res.json({ ok: true, changed: info.changes });
});

router.post('/', requireAdmin, (req, res) => {
  const b = req.body || {}, has = k => Object.prototype.hasOwnProperty.call(b, k);
  let id = clean(b.id, 50).toLowerCase();
  const existing = id ? db.prepare('SELECT * FROM areas WHERE id = ?').get(id) : null;
  const name = clean(b.name, 80);
  if (!existing && (!name || !clean(b.region, 80))) return res.status(400).json({ error: 'A zone needs a region and a name' });
  if (!id) { id = slugify(name); let n = 2; while (db.prepare('SELECT 1 FROM areas WHERE id = ?').get(id)) id = slugify(name) + '-' + n++; }
  const base = existing || { id, region: '', name: '', corridor: '', lat: null, lng: null, active: 0,
    sort_order: db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM areas').get().n };
  const m = {
    id, region: has('region') ? clean(b.region, 80) : base.region, name: has('name') ? name : base.name,
    corridor: has('corridor') ? clean(b.corridor, 60) : base.corridor,
    lat: has('lat') ? Number(b.lat) : base.lat, lng: has('lng') ? Number(b.lng) : base.lng,
    active: has('active') ? (b.active ? 1 : 0) : base.active,
    sort_order: has('sortOrder') && Number.isFinite(Number(b.sortOrder)) ? Math.round(Number(b.sortOrder)) : base.sort_order,
  };
  if (!m.name || !m.region) return res.status(400).json({ error: 'A zone needs a region and a name' });
  if (!Number.isFinite(m.lat) || !Number.isFinite(m.lng)) return res.status(400).json({ error: 'Latitude and longitude are required - they decide distance and delivery fee' });
  if (m.lat < -4.9 || m.lat > 5.1 || m.lng < 33.9 || m.lng > 41.9) return res.status(400).json({ error: 'Those coordinates are outside Kenya - latitude first, e.g. -1.2921, 36.8219' });
  db.prepare(`INSERT INTO areas (id, region, name, corridor, lat, lng, active, sort_order) VALUES (@id, @region, @name, @corridor, @lat, @lng, @active, @sort_order)
    ON CONFLICT(id) DO UPDATE SET region=excluded.region, name=excluded.name, corridor=excluded.corridor, lat=excluded.lat, lng=excluded.lng, active=excluded.active, sort_order=excluded.sort_order`).run(m);
  res.status(existing ? 200 : 201).json({ ok: true, area: toArea(db.prepare('SELECT * FROM areas WHERE id = ?').get(id)) });
});

router.delete('/:id', requireAdmin, (req, res) => {
  const r = db.prepare('DELETE FROM areas WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Zone not found' });
  res.json({ ok: true });
});

module.exports = router;
