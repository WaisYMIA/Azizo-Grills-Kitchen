const express = require('express');
const db = require('../db');
const { requireAdmin, requireStaff } = require('../middleware/auth');
const router = express.Router();

// Branch details change the moment admin edits them, and customers' checkout pickers
// should reflect that on their very next page load — never serve this from a cache.
function noStore(req, res, next) { res.set('Cache-Control', 'no-store'); next(); }

function toBranch(r) {
  return {
    id: r.id, name: r.name, area: r.area || '', address: r.address || '', query: r.query || '',
    lat: r.lat, lng: r.lng, phone: r.phone || '', hours: r.hours || '',
    isMain: !!r.is_main, listed: !!r.listed, sortOrder: r.sort_order,
  };
}

// Public: only the branches admin has ticked "Show on website" for. The WhatsApp ordering
// number is deliberately NOT part of a branch — it stays one shared number site-wide
// (CONFIG.WA_NUMBER); a branch's own `phone` is only for calling that branch.
router.get('/', noStore, (req, res) => {
  const rows = db.prepare('SELECT * FROM branches WHERE listed = 1 ORDER BY is_main DESC, sort_order, name').all();
  res.json({ branches: rows.map(toBranch) });
});

router.get('/all', requireStaff, noStore, (req, res) => {
  const rows = db.prepare('SELECT * FROM branches ORDER BY is_main DESC, sort_order, name').all();
  res.json({ branches: rows.map(toBranch) });
});

function slugify(s) {
  return String(s || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
const PHONE_RE = /^\+?[\d][\d\s\-()]{5,19}$/;
const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

function listedCountExcluding(id) {
  return db.prepare('SELECT COUNT(*) AS n FROM branches WHERE listed = 1 AND id != ?').get(id).n;
}

// Create or update (by id). Partial updates are fine — fields left out keep their value.
router.post('/', requireAdmin, (req, res) => {
  const body = req.body || {};
  const name = clean(body.name, 80);
  let id = clean(body.id, 40).toLowerCase();
  const existing = id ? db.prepare('SELECT * FROM branches WHERE id = ?').get(id) : null;
  if (!existing && !name) return res.status(400).json({ error: 'A branch needs a name' });
  if (!id) id = slugify(name);
  if (!/^[a-z0-9-]{2,40}$/.test(id)) return res.status(400).json({ error: 'Branch id must be 2–40 letters, numbers or dashes' });

  const base = existing || { id, name: '', area: '', address: '', query: '', lat: null, lng: null, phone: '',
    hours: 'Open 24 hours', is_main: 0, listed: 0, sort_order: (db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM branches').get().n) };
  const has = k => Object.prototype.hasOwnProperty.call(body, k);

  const merged = {
    id,
    name: has('name') ? name : base.name,
    area: has('area') ? clean(body.area, 60) : base.area,
    address: has('address') ? clean(body.address, 160) : base.address,
    query: has('query') ? clean(body.query, 200) : base.query,
    lat: has('lat') ? Number(body.lat) : base.lat,
    lng: has('lng') ? Number(body.lng) : base.lng,
    phone: has('phone') ? clean(body.phone, 24) : base.phone,
    hours: has('hours') ? clean(body.hours, 60) : base.hours,
    is_main: has('isMain') ? (body.isMain ? 1 : 0) : base.is_main,
    listed: has('listed') ? (body.listed ? 1 : 0) : base.listed,
    sort_order: has('sortOrder') && Number.isFinite(Number(body.sortOrder)) ? Math.round(Number(body.sortOrder)) : base.sort_order,
  };

  if (!merged.name) return res.status(400).json({ error: 'A branch needs a name' });
  if (!Number.isFinite(merged.lat) || !Number.isFinite(merged.lng)) {
    return res.status(400).json({ error: 'Latitude and longitude are required — delivery fees are measured from this pin' });
  }
  // Loose Kenya-wide box: catches swapped or mistyped coordinates without blocking future branches elsewhere.
  if (merged.lat < -4.9 || merged.lat > 5.1 || merged.lng < 33.9 || merged.lng > 41.9) {
    return res.status(400).json({ error: 'Those coordinates are outside Kenya — check latitude/longitude (latitude first, e.g. -1.2921, 36.8219)' });
  }
  if (merged.phone && !PHONE_RE.test(merged.phone)) {
    return res.status(400).json({ error: 'Phone number looks invalid — use digits, e.g. 0712 345 678 or +254712345678' });
  }
  // A blank map search text is fine: the site then pins the exact coordinates instead.
  if (!merged.address) merged.address = `${merged.area || merged.name}, Nairobi`;
  if (merged.is_main) merged.listed = 1; // the main branch is always shown
  if (!merged.listed && listedCountExcluding(id) === 0) {
    return res.status(400).json({ error: 'At least one branch must stay listed on the website' });
  }

  const save = db.transaction(() => {
    if (merged.is_main) db.prepare('UPDATE branches SET is_main = 0 WHERE id != ?').run(id);
    db.prepare(`
      INSERT INTO branches (id, name, area, address, query, lat, lng, phone, hours, is_main, listed, sort_order, updated_at)
      VALUES (@id, @name, @area, @address, @query, @lat, @lng, @phone, @hours, @is_main, @listed, @sort_order, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, area=excluded.area, address=excluded.address, query=excluded.query,
        lat=excluded.lat, lng=excluded.lng, phone=excluded.phone, hours=excluded.hours, is_main=excluded.is_main,
        listed=excluded.listed, sort_order=excluded.sort_order, updated_at=datetime('now')
    `).run(merged);
  });
  save();
  res.status(existing ? 200 : 201).json({ ok: true, branch: toBranch(db.prepare('SELECT * FROM branches WHERE id = ?').get(id)) });
});

// Quick show/hide — what the checkbox in admin.html calls.
router.patch('/:id/listed', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM branches WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Branch not found' });
  const listed = req.body && req.body.listed ? 1 : 0;
  if (!listed && row.is_main) return res.status(400).json({ error: 'The main branch always stays listed — make another branch the main one first' });
  if (!listed && listedCountExcluding(row.id) === 0) return res.status(400).json({ error: 'At least one branch must stay listed on the website' });
  db.prepare("UPDATE branches SET listed = ?, updated_at = datetime('now') WHERE id = ?").run(listed, row.id);
  res.json({ ok: true, branch: toBranch(db.prepare('SELECT * FROM branches WHERE id = ?').get(row.id)) });
});

router.delete('/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM branches WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Branch not found' });
  if (row.is_main) return res.status(400).json({ error: "Can't delete the main branch — make another branch the main one first" });
  if (row.listed && listedCountExcluding(row.id) === 0) return res.status(400).json({ error: 'At least one branch must stay listed on the website' });
  db.prepare('DELETE FROM branches WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;
