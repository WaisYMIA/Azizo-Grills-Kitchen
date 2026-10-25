// Azizo Kitchens: partner home-kitchens marketplace (Phase 1).
//   public:   /config /areas /search /orders (POST) /orders/track /orders/:id/rate /apply
//   partner:  /partner/login /partner/me /partner/dishes/:id /partner/orders /partner/statement /partner/documents
//   admin:    /admin-login and /admin/* (Kitchens Admin role; main admin works too)
const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { signKitchensAdminToken, signKitchenToken, requireKitchensAdmin, requireKitchen, signRiderToken, requireRider } = require('../middleware/auth');
const mpesa = require('./mpesa');
const notify = require('./kk-notify');
const router = express.Router();
const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, max);
const slugify = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'kitchen';
const last9 = s => String(s || '').replace(/\D/g, '').slice(-9);
const lines = t => String(t || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const jparse = (t, d) => { try { return JSON.parse(t); } catch (e) { return d; } };
const TAGS = ['vegetarian', 'spicy', 'fish', 'halal', 'no-pork', 'gluten-free'];
const PRIVATE = path.join(__dirname, '..', 'private', 'kitchen-docs');
const IMGDIR = path.join(__dirname, '..', 'uploads', 'kitchens');
const TZ = () => Number(process.env.TZ_OFFSET_HOURS !== undefined && process.env.TZ_OFFSET_HOURS !== '' ? process.env.TZ_OFFSET_HOURS : 3);

// ---------- settings ----------
const DEFAULTS = { commissionPct: 20, lunch: { label: 'Lunch', from: '12:00', to: '14:00', cutoff: '10:30' }, dinner: { label: 'Dinner', from: '18:00', to: '20:00', cutoff: '16:30' },
  fee: { base: 100, perKm: 25, bandKm: 2, max: 400 }, defaultRadiusKm: 4, roadFactor: 1.3, zoneCap: 4, zoneCaps: {}, minOrder: 300, holdMinutes: 120, deliveryCost: 150, autoReassign: false, loyaltyEvery: 8 };
function settings() {
  const r = db.prepare("SELECT value FROM meta WHERE key = 'kk_settings'").get(); const s = r ? jparse(r.value, {}) : {};
  return Object.assign({}, DEFAULTS, s, { lunch: Object.assign({}, DEFAULTS.lunch, s.lunch), dinner: Object.assign({}, DEFAULTS.dinner, s.dinner), fee: Object.assign({}, DEFAULTS.fee, s.fee), zoneCaps: s.zoneCaps || {} });
}
const hm = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
function nowEAT() { const d = new Date(Date.now() + TZ() * 3600000); return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() }; }
const addDays = (ds, n) => { const d = new Date(ds + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function slotOpen(date, meal, S) {
  const n = nowEAT(); if (!['lunch', 'dinner'].includes(meal)) return { ok: false, why: 'Choose lunch or dinner' };
  if (date < n.date || date > addDays(n.date, 2)) return { ok: false, why: 'Choose today, tomorrow or the day after' };
  if (date === n.date && n.min >= hm(S[meal].cutoff)) return { ok: false, why: `${S[meal].label} orders for today closed at ${S[meal].cutoff}` };
  return { ok: true };
}
// ---------- geo ----------
const rad = x => x * Math.PI / 180;
function haversine(a, b, c, d) { const R = 6371, dLat = rad(c - a), dLng = rad(d - b); const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
const roadKm = (k, lat, lng, S) => Math.round(haversine(k.lat, k.lng, lat, lng) * S.roadFactor * 10) / 10;
function feeFor(km, S) { const band = Math.max(S.fee.bandKm, Math.ceil(km / S.fee.bandKm) * S.fee.bandKm); return Math.min(S.fee.max, Math.round((S.fee.base + S.fee.perKm * band) / 10) * 10); }
function point(b) {
  if (b.areaId) { const a = db.prepare('SELECT lat, lng, name, region FROM areas WHERE id = ?').get(String(b.areaId)); if (a) return { lat: a.lat, lng: a.lng, area: a }; }
  const lat = Number(b.lat), lng = Number(b.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat || lng)) return { lat, lng, area: null };
  return null;
}
// ---------- shapes ----------
const dishPub = d => ({ id: d.id, slug: d.slug, name: d.name, tradition: d.tradition, category: d.category, meal: d.meal, price: d.price, serves: d.serves, description: d.description, image: d.image, tags: String(d.tags || '').split(',').filter(Boolean), options: jparse(d.options, []) });
const dishFull = d => Object.assign(dishPub(d), { tagsCsv: d.tags || '', components: lines(d.components), method: lines(d.method), packaging: d.packaging, tips: d.tips, active: !!d.active, sort: d.sort_order });
function rating(kid) { const r = db.prepare('SELECT COUNT(*) AS n, AVG(rating) AS a FROM kk_orders WHERE kitchen_id = ? AND rating > 0').get(kid); return { avg: r.n ? Math.round(r.a * 10) / 10 : 0, count: r.n }; }
const firstName = n => clean(n, 60).split(/\s+/)[0] || 'Cook';
const kPub = k => { const r = rating(k.id); return { id: k.id, slug: k.slug, name: k.name, cook: firstName(k.cook_name), bio: k.bio, specialities: k.specialities, region: k.region, rating: r.avg, ratingCount: r.count, prepMin: k.prep_min }; };
function queuePos(k) { if (k.status !== 'queued') return 0; return db.prepare("SELECT COUNT(*) AS n FROM kk_kitchens WHERE status = 'queued' AND region = ? AND id <= ?").get(k.region, k.id).n; }
const live = () => "status IN ('pilot','live') AND paused = 0";
function slotUsed(kid, date, meal) { return db.prepare("SELECT COUNT(*) AS n FROM kk_orders WHERE kitchen_id = ? AND date = ? AND meal = ? AND status NOT IN ('cancelled','rejected')").get(kid, date, meal).n; }

// ---------- rate limit ----------
const hits = new Map();
const limiter = (max, key) => (req, res, next) => {
  const v = key + (String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || 'unknown'), now = Date.now();
  const recent = (hits.get(v) || []).filter(t => now - t < 3600000);
  if (recent.length >= max) return res.status(429).json({ error: 'Too many attempts - please try again later' });
  recent.push(now); hits.set(v, recent); next();
};
// ---------- images and docs ----------
function readImage(data, maxBytes) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(data || '')); if (!m) return { error: 'Upload a JPG, PNG or WebP image' };
  const buf = Buffer.from(m[2], 'base64'); if (buf.length > maxBytes) return { error: 'Image is too large' };
  const ok = (m[1] === 'jpeg' && buf[0] === 0xFF && buf[1] === 0xD8) || (m[1] === 'png' && buf.slice(1, 4).toString() === 'PNG') || (m[1] === 'webp' && buf.slice(0, 4).toString() === 'RIFF');
  if (!ok) return { error: 'That file is not a valid image' };
  return { buf, ext: m[1] === 'jpeg' ? 'jpg' : m[1] };
}
function saveDoc(kid, type, data) {
  const im = readImage(data, 1500 * 1024); if (im.error) return { error: im.error };
  fs.mkdirSync(PRIVATE, { recursive: true });
  const file = `k${kid}-${slugify(type)}-${crypto.randomBytes(5).toString('hex')}.${im.ext}`; fs.writeFileSync(path.join(PRIVATE, file), im.buf); return { file };
}
const DOC_TYPES = ['id', 'permit', 'health', 'kra', 'premises', 'other'];
function addDocs(k, b) {
  const docs = jparse(k.docs, []);
  const nums = b.docNumbers || {};
  for (const t of DOC_TYPES) if (nums[t] && (nums[t].no || nums[t].expiry)) {
    let d = docs.find(x => x.type === t && !x.file && !x.superseded); if (!d) { d = { type: t }; docs.push(d); }
    d.no = clean(nums[t].no, 60); d.expiry = clean(nums[t].expiry, 12);
  }
  for (const im of (Array.isArray(b.docImages) ? b.docImages : []).slice(0, 6)) {
    if (!im || !DOC_TYPES.includes(im.type)) continue;
    const r = saveDoc(k.id, im.type, im.data); if (r.error) return { error: `${im.type}: ${r.error}` };
    docs.push({ type: im.type, file: r.file, uploaded: new Date().toISOString().slice(0, 10) });
  }
  return { docs };
}


// ---------- v3.1 shared helpers ----------
function nearestArea(lat, lng) { let best = null, bd = 1e9; for (const a of db.prepare('SELECT id, name, region, lat, lng FROM areas').all()) { const d = haversine(lat, lng, a.lat, a.lng); if (d < bd) { bd = d; best = a; } } return best && bd < 8 ? best : null; }
function logDemand(p, areaId) {
  try { const a = p.area ? { id: String(areaId), name: p.area.name, region: p.area.region } : nearestArea(p.lat, p.lng); if (!a) return;
    db.prepare("INSERT INTO kk_demand (date, area_id, region, name, n) VALUES (?, ?, ?, ?, 1) ON CONFLICT(date, area_id) DO UPDATE SET n = n + 1").run(nowEAT().date, a.id, a.region || '', a.name || ''); } catch (e) { /* ignore */ }
}
function expireUnpaid() { db.prepare("UPDATE kk_orders SET status = 'cancelled', reason = 'Payment not completed', updated_at = datetime('now') WHERE payment = 'mpesa_now' AND paid = 0 AND status = 'new' AND created_at < datetime('now', '-20 minutes')").run(); }
function promoCheck(codeIn, subtotal, fee) {
  const code = clean(codeIn, 30).toUpperCase(); if (!code) return { ok: false, error: 'Enter a promo code' };
  const p = db.prepare('SELECT * FROM kk_promos WHERE code = ? AND active = 1').get(code); if (!p) return { ok: false, error: 'That promo code is not valid' };
  if (p.expires && p.expires < nowEAT().date) return { ok: false, error: 'That promo code has expired' };
  if (p.max_uses && p.used >= p.max_uses) return { ok: false, error: 'That promo code has been fully used' };
  if (subtotal < p.min_order) return { ok: false, error: `This code needs at least KSh ${p.min_order} of food` };
  const discount = p.kind === 'freedelivery' ? fee : p.kind === 'flat' ? Math.min(p.value, subtotal) : Math.round(subtotal * Math.min(100, p.value) / 100);
  return { ok: true, code, kind: p.kind, value: p.value, discount, id: p.id };
}
function deliveredCount(phone) { return db.prepare("SELECT COUNT(*) AS n FROM kk_orders WHERE status = 'delivered' AND substr(replace(phone, ' ', ''), -9) = ?").get(last9(phone)).n; }
function candidates(o, S) {
  const items = db.prepare('SELECT dish_id FROM kk_order_items WHERE order_id = ?').all(o.id).map(x => x.dish_id), out = [];
  for (const k of db.prepare(`SELECT * FROM kk_kitchens WHERE ${live()} AND lat IS NOT NULL AND id != ?`).all(o.kitchen_id)) {
    const km = roadKm(k, o.lat, o.lng, S); if (km > k.radius_km) continue;
    if (!items.every(d => db.prepare('SELECT 1 FROM kk_kitchen_dishes kd JOIN kk_dishes d ON d.id = kd.dish_id WHERE kd.kitchen_id = ? AND kd.dish_id = ? AND kd.available = 1 AND d.active = 1').get(k.id, d))) continue;
    const left = k.capacity - slotUsed(k.id, o.date, o.meal); if (left <= 0) continue; out.push({ kitchen: k, km, left });
  }
  return out.sort((a, b) => a.km - b.km);
}
function reassign(o, k, S) {
  const pct = k.commission_pct == null ? S.commissionPct : k.commission_pct, comm = Math.round(o.subtotal * pct / 100);
  db.prepare("UPDATE kk_orders SET kitchen_id = ?, status = 'new', reassigned_from = COALESCE(reassigned_from, ?), commission_pct = ?, commission_amt = ?, kitchen_amt = ?, reason = '', accepted_at = NULL, updated_at = datetime('now') WHERE id = ?").run(k.id, o.kitchen_id, pct, comm, o.subtotal - comm, o.id);
  notify.queue('reassigned', db.prepare('SELECT * FROM kk_orders WHERE id = ?').get(o.id), { kitchen: k.name });
}
function lastOrderFull(id) { return db.prepare('SELECT * FROM kk_orders WHERE id = ?').get(id); }

// ================= PUBLIC =================
router.get('/config', noStore, (req, res) => {
  const S = settings();
  res.json({ lunch: S.lunch, dinner: S.dinner, fee: S.fee, minOrder: S.minOrder, holdMinutes: S.holdMinutes, now: nowEAT(), tz: TZ(), mpesaStk: mpesa.isConfigured(), loyaltyEvery: S.loyaltyEvery, tagList: TAGS,
    traditions: [...new Set(db.prepare('SELECT tradition FROM kk_dishes WHERE active = 1').all().map(r => r.tradition).filter(Boolean))].sort(),
    categories: [...new Set(db.prepare('SELECT category FROM kk_dishes WHERE active = 1 ORDER BY sort_order').all().map(r => r.category))] });
});
router.get('/areas', noStore, (req, res) => {
  res.json({ areas: db.prepare('SELECT id, region, name, lat, lng FROM areas ORDER BY region, name').all() });
});
router.get('/dishes', noStore, (req, res) => res.json({ dishes: db.prepare('SELECT * FROM kk_dishes WHERE active = 1 ORDER BY sort_order').all().map(dishPub) }));

// Kitchens that cover the customer's point, with their menus and slot availability for a date.
router.get('/search', noStore, (req, res) => {
  const S = settings(), p = point({ areaId: req.query.area, lat: req.query.lat, lng: req.query.lng });
  if (!p) return res.status(400).json({ error: 'Choose your area or share your location' });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : nowEAT().date;
  const out = [];
  for (const k of db.prepare(`SELECT * FROM kk_kitchens WHERE ${live()} AND lat IS NOT NULL`).all()) {
    const km = roadKm(k, p.lat, p.lng, S); if (km > k.radius_km) continue;
    const menu = db.prepare('SELECT d.* FROM kk_kitchen_dishes kd JOIN kk_dishes d ON d.id = kd.dish_id WHERE kd.kitchen_id = ? AND kd.available = 1 AND d.active = 1 ORDER BY d.sort_order').all(k.id).map(dishPub);
    if (!menu.length) continue;
    const slots = {}; for (const m of ['lunch', 'dinner']) { const o = slotOpen(date, m, S); slots[m] = { open: o.ok, why: o.why || '', left: Math.max(0, k.capacity - slotUsed(k.id, date, m)) }; }
    out.push(Object.assign(kPub(k), { distanceKm: km, fee: feeFor(km, S), minOrder: S.minOrder, slots, menu }));
  }
  out.sort((a, b) => a.distanceKm - b.distanceKm);
  if (!out.length) logDemand(p, req.query.area);
  res.json({ date, area: p.area ? { name: p.area.name, region: p.area.region } : null, kitchens: out });
});

router.post('/orders', limiter(10, 'ord'), async (req, res) => {
  const b = req.body || {}, S = settings();
  if (b.website) return res.status(201).json({ ok: true });
  expireUnpaid();
  const k = db.prepare(`SELECT * FROM kk_kitchens WHERE id = ? AND ${live()}`).get(Number(b.kitchenId));
  if (!k) return res.status(404).json({ error: 'This kitchen is not taking orders right now' });
  const name = clean(b.name, 60), phone = clean(b.phone, 20), address = clean(b.address, 200);
  if (name.length < 2) return res.status(400).json({ error: 'Enter your name' });
  if (last9(phone).length < 9) return res.status(400).json({ error: 'Enter a valid phone number' });
  if (address.length < 4) return res.status(400).json({ error: 'Enter your delivery address' });
  const p = point(b); if (!p) return res.status(400).json({ error: 'Choose your area or share your location' });
  const km = roadKm(k, p.lat, p.lng, S); if (km > k.radius_km) return res.status(400).json({ error: 'Sorry, this kitchen does not deliver that far' });
  const date = clean(b.date, 10), meal = clean(b.meal, 8), so = slotOpen(date, meal, S); if (!so.ok) return res.status(400).json({ error: so.why });
  if (slotUsed(k.id, date, meal) >= k.capacity) return res.status(409).json({ error: 'This kitchen is fully booked for that slot. Try another kitchen or time' });
  const items = Array.isArray(b.items) ? b.items.slice(0, 30) : []; if (!items.length) return res.status(400).json({ error: 'Your basket is empty' });
  const lineRows = []; let subtotal = 0;
  for (const it of items) {
    const d = db.prepare('SELECT d.* FROM kk_kitchen_dishes kd JOIN kk_dishes d ON d.id = kd.dish_id WHERE kd.kitchen_id = ? AND kd.dish_id = ? AND kd.available = 1 AND d.active = 1').get(k.id, Number(it.dishId));
    if (!d) return res.status(400).json({ error: 'One of the dishes is no longer available from this kitchen' });
    if (d.meal !== 'both' && d.meal !== meal) return res.status(400).json({ error: `${d.name} is not served at ${meal}` });
    const qty = Math.max(1, Math.min(20, parseInt(it.qty, 10) || 1)); let unit = d.price; const picked = [];
    for (const g of jparse(d.options, [])) {
      const want = it.options && it.options[g.name]; const ch = g.choices.find(c => c.name === want);
      if (g.required && !ch) return res.status(400).json({ error: `Choose ${g.name.toLowerCase()} for ${d.name}` });
      if (ch) { unit += ch.price || 0; picked.push(`${g.name}: ${ch.name}`); }
    }
    lineRows.push({ d, qty, unit, text: picked.join(', '), total: unit * qty }); subtotal += unit * qty;
  }
  if (subtotal < S.minOrder) return res.status(400).json({ error: `Minimum order is KSh ${S.minOrder} of food` });
  const fee = feeFor(km, S);
  // company account, promo code, loyalty
  let corp = null; if (clean(b.corpCode, 30)) { corp = db.prepare('SELECT * FROM kk_corporate WHERE code = ? AND active = 1').get(clean(b.corpCode, 30).toUpperCase()); if (!corp) return res.status(400).json({ error: 'That company code is not valid' }); }
  let payment = ['cash', 'mpesa', 'mpesa_now', 'invoice'].includes(b.payment) ? b.payment : 'cash';
  if (payment === 'invoice' && !corp) return res.status(400).json({ error: 'Invoice payment needs a valid company code' });
  if (payment === 'mpesa_now' && !mpesa.isConfigured()) return res.status(400).json({ error: 'Paying with M-Pesa now is not available yet. Choose pay on delivery.' });
  let discount = corp && corp.discount_pct ? Math.round(subtotal * corp.discount_pct / 100) : 0, promoCode = '', promoId = null;
  if (clean(b.promo, 30)) { const pr = promoCheck(b.promo, subtotal, fee); if (!pr.ok) return res.status(400).json({ error: pr.error }); discount += pr.discount; promoCode = pr.code; promoId = pr.id; }
  else if (S.loyaltyEvery > 0 && (deliveredCount(phone) + 1) % S.loyaltyEvery === 0) { discount += fee; promoCode = 'LOYALTY'; }
  discount = Math.min(discount, subtotal + fee);
  const total = subtotal + fee - discount, pct = k.commission_pct == null ? S.commissionPct : k.commission_pct;
  const commission = Math.round(subtotal * pct / 100), code = String(1000 + crypto.randomInt(9000));
  const region = p.area ? p.area.region : ((nearestArea(p.lat, p.lng) || {}).region || '');
  const id = db.transaction(() => {
    const r = db.prepare(`INSERT INTO kk_orders (kitchen_id, name, phone, address, area_id, lat, lng, distance_km, date, meal, notes, subtotal, delivery_fee, total, payment, commission_pct, commission_amt, kitchen_amt, delivery_code, promo_code, discount, corp_id, region)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(k.id, name, phone, address, b.areaId ? String(b.areaId) : '', p.lat, p.lng, km, date, meal, clean(b.notes, 300), subtotal, fee, total, payment, pct, commission, subtotal - commission, code, promoCode, discount, corp ? corp.id : null, region);
    for (const l of lineRows) db.prepare('INSERT INTO kk_order_items (order_id, dish_id, name, qty, unit_price, options_text, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)').run(r.lastInsertRowid, l.d.id, l.d.name, l.qty, l.unit, l.text, l.total);
    if (promoId) db.prepare('UPDATE kk_promos SET used = used + 1 WHERE id = ?').run(promoId);
    return r.lastInsertRowid;
  })();
  notify.queue('placed', lastOrderFull(id), { kitchen: k.name });
  let stk = null;
  if (payment === 'mpesa_now') {
    try { const r = await mpesa.initiateStk(phone, total, 'AzizoK-' + id, 'Azizo Kitchens order'); db.prepare('UPDATE kk_orders SET mpesa_checkout = ? WHERE id = ?').run(r.checkoutRequestId, id); stk = { started: true }; }
    catch (e) { stk = { started: false, error: e.message }; }
  }
  res.status(201).json({ ok: true, id, total, fee, discount, promo: promoCode, deliveryCode: code, kitchen: kPub(k).name, window: `${S[meal].from}-${S[meal].to}`, payment, stk, message: 'Order received. Your kitchen will confirm shortly.' });
});
router.post('/promo/check', limiter(60, 'promo'), (req, res) => {
  const b = req.body || {}, S = settings(), k = db.prepare('SELECT * FROM kk_kitchens WHERE id = ?').get(Number(b.kitchenId)), p = point(b);
  const subtotal = Math.max(0, parseInt(b.subtotal, 10) || 0), fee = k && p ? feeFor(roadKm(k, p.lat, p.lng, S), S) : S.fee.base;
  const r = promoCheck(b.code, subtotal, fee); if (!r.ok) return res.status(400).json({ error: r.error }); res.json({ ok: true, code: r.code, discount: r.discount, kind: r.kind });
});
router.get('/corporate/check', limiter(60, 'corp'), (req, res) => {
  const c = db.prepare('SELECT name, discount_pct FROM kk_corporate WHERE code = ? AND active = 1').get(clean(req.query.code, 30).toUpperCase()); if (!c) return res.status(404).json({ error: 'That company code is not valid' }); res.json({ name: c.name, discountPct: c.discount_pct });
});
router.get('/loyalty', limiter(60, 'loy'), (req, res) => {
  const S = settings(), n = deliveredCount(req.query.phone), e = S.loyaltyEvery; res.json({ every: e, delivered: n, untilFree: e > 0 ? e - (n % e) - 1 : null });
});
router.post('/orders/:id(\\d+)/pay', limiter(10, 'pay'), async (req, res) => {
  const o = db.prepare('SELECT * FROM kk_orders WHERE id = ?').get(req.params.id), b = req.body || {};
  if (!o || last9(o.phone) !== last9(b.phone)) return res.status(404).json({ error: 'We could not find that order and phone number' });
  if (o.payment !== 'mpesa_now' || o.paid || o.status !== 'new') return res.status(400).json({ error: 'This order does not need a payment' });
  try { const r = await mpesa.initiateStk(o.phone, o.total, 'AzizoK-' + o.id, 'Azizo Kitchens order'); db.prepare('UPDATE kk_orders SET mpesa_checkout = ? WHERE id = ?').run(r.checkoutRequestId, o.id); res.json({ ok: true }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
router.post('/orders/:id(\\d+)/pay-rider', limiter(10, 'payr'), (req, res) => {
  const o = db.prepare('SELECT * FROM kk_orders WHERE id = ?').get(req.params.id), b = req.body || {};
  if (!o || last9(o.phone) !== last9(b.phone)) return res.status(404).json({ error: 'We could not find that order and phone number' });
  if (o.payment !== 'mpesa_now' || o.paid) return res.status(400).json({ error: 'Nothing to change' });
  db.prepare("UPDATE kk_orders SET payment = 'mpesa' WHERE id = ?").run(o.id); res.json({ ok: true });
});
const orderPub = (o, S) => {
  const k = db.prepare('SELECT name FROM kk_kitchens WHERE id = ?').get(o.kitchen_id);
  return { id: o.id, status: o.status, kitchen: k ? k.name : '', date: o.date, meal: o.meal, window: S[o.meal] ? `${S[o.meal].from}-${S[o.meal].to}` : '', total: o.total, fee: o.delivery_fee, payment: o.payment, rating: o.rating, reason: o.reason, paid: !!o.paid, discount: o.discount, promo: o.promo_code, code: ['delivered', 'cancelled', 'rejected'].includes(o.status) ? '' : o.delivery_code, rider: o.rider_id ? ((db.prepare('SELECT name FROM kk_riders WHERE id = ?').get(o.rider_id) || {}).name || '') : '',
    items: db.prepare('SELECT name, qty, options_text, line_total FROM kk_order_items WHERE order_id = ?').all(o.id).map(i => ({ name: i.name, qty: i.qty, options: i.options_text, total: i.line_total })) };
};
router.get('/orders/track', noStore, limiter(60, 'trk'), (req, res) => {
  const o = db.prepare('SELECT * FROM kk_orders WHERE id = ?').get(Number(req.query.id));
  if (!o || last9(o.phone) !== last9(req.query.phone)) return res.status(404).json({ error: 'We could not find that order and phone number' });
  res.json(orderPub(o, settings()));
});
router.post('/orders/:id(\\d+)/rate', limiter(20, 'rate'), (req, res) => {
  const o = db.prepare('SELECT * FROM kk_orders WHERE id = ?').get(req.params.id), b = req.body || {};
  if (!o || last9(o.phone) !== last9(b.phone)) return res.status(404).json({ error: 'We could not find that order and phone number' });
  if (o.status !== 'delivered') return res.status(400).json({ error: 'You can rate an order once it is delivered' });
  if (o.rating) return res.status(409).json({ error: 'This order is already rated. Thank you!' });
  const r = parseInt(b.rating, 10); if (!(r >= 1 && r <= 5)) return res.status(400).json({ error: 'Choose 1 to 5 stars' });
  db.prepare('UPDATE kk_orders SET rating = ?, review = ?, updated_at = datetime(\'now\') WHERE id = ?').run(r, clean(b.comment, 500), o.id);
  res.json({ ok: true });
});

// ---------- application ----------
router.post('/apply', limiter(6, 'app'), (req, res) => {
  const b = req.body || {}, S = settings();
  if (b.website) return res.status(201).json({ ok: true });
  const name = clean(b.name, 80), cook = clean(b.cookName, 80), phone = clean(b.phone, 20), email = clean(b.email, 100).toLowerCase(), pass = String(b.password || '');
  if (name.length < 3) return res.status(400).json({ error: 'Give your kitchen a name (at least 3 letters)' });
  if (cook.length < 2) return res.status(400).json({ error: 'Enter the cook\'s name' });
  if (last9(phone).length < 9) return res.status(400).json({ error: 'Enter a valid phone number' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (pass.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.prepare('SELECT 1 FROM kk_kitchens WHERE email = ? OR substr(replace(phone, \' \', \'\'), -9) = ?').get(email, last9(phone))) return res.status(409).json({ error: 'A kitchen with this email or phone is already registered. Please log in' });
  const p = point(b); if (!p) return res.status(400).json({ error: 'Choose your area and drop your kitchen pin (or share your location)' });
  const area = b.areaId ? db.prepare('SELECT region, name FROM areas WHERE id = ?').get(String(b.areaId)) : null;
  const region = area ? area.region : clean(b.region, 60);
  if (!clean(b.address, 200)) return res.status(400).json({ error: 'Enter the kitchen address or landmark' });
  if (!b.agree) return res.status(400).json({ error: 'Please accept the partner terms' });
  let slug = slugify(name), n = 1; while (db.prepare('SELECT 1 FROM kk_kitchens WHERE slug = ?').get(slug)) slug = slugify(name) + '-' + (++n);
  const cap = Number(S.zoneCaps[region] || S.zoneCap), liveInRegion = db.prepare("SELECT COUNT(*) AS n FROM kk_kitchens WHERE region = ? AND status IN ('pilot','live')").get(region).n;
  const status = liveInRegion >= cap ? 'queued' : 'applied';
  const r = db.prepare(`INSERT INTO kk_kitchens (slug, name, cook_name, phone, email, password_hash, bio, specialities, experience, address, area_id, region, lat, lng, radius_km, capacity, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(slug, name, cook, phone, email, bcrypt.hashSync(pass, 10), clean(b.bio, 600), clean(b.specialities, 200), clean(b.experience, 300), clean(b.address, 200),
    b.areaId ? String(b.areaId) : '', region, p.lat, p.lng, S.defaultRadiusKm, Math.max(1, Math.min(60, parseInt(b.capacity, 10) || 10)), status);
  const k = db.prepare('SELECT * FROM kk_kitchens WHERE id = ?').get(r.lastInsertRowid);
  const dd = addDocs(k, b); if (dd.error) { db.prepare('DELETE FROM kk_kitchens WHERE id = ?').run(k.id); return res.status(400).json({ error: dd.error }); }
  db.prepare('UPDATE kk_kitchens SET docs = ? WHERE id = ?').run(JSON.stringify(dd.docs), k.id);
  res.status(201).json({ ok: true, status, queuePosition: queuePos(Object.assign(k, { status })), token: signKitchenToken(k),
    message: status === 'queued' ? 'Thank you! Your area is full right now, so you are on the waiting list. We will contact you when a place opens.' : 'Thank you! Your application is in. We will contact you to arrange a tasting and kitchen visit.' });
});

// ================= PARTNER =================
router.post('/partner/login', limiter(30, 'plog'), (req, res) => {
  const b = req.body || {}, id = clean(b.login, 100).toLowerCase();
  const k = db.prepare('SELECT * FROM kk_kitchens WHERE email = ? OR substr(replace(phone, \' \', \'\'), -9) = ?').get(id, last9(id));
  if (!k || !bcrypt.compareSync(String(b.password || ''), k.password_hash || '')) return res.status(401).json({ error: 'Incorrect email/phone or password' });
  if (k.status === 'delisted' || k.status === 'rejected') return res.status(403).json({ error: 'This kitchen account is not active. Please contact Azizo.' });
  res.json({ token: signKitchenToken(k) });
});
const partnerOrders = (kid, where, args) => db.prepare(`SELECT * FROM kk_orders WHERE kitchen_id = ? AND NOT (payment = 'mpesa_now' AND paid = 0) ${where} ORDER BY id DESC LIMIT 200`).all(kid, ...(args || [])).map(o =>
  Object.assign({ id: o.id, status: o.status, customer: o.name, phone: o.phone, address: o.address, date: o.date, meal: o.meal, notes: o.notes, subtotal: o.subtotal, fee: o.delivery_fee, total: o.total, payment: o.payment, earn: o.kitchen_amt, commission: o.commission_amt, rating: o.rating, review: o.review, created: o.created_at, reason: o.reason },
    { items: db.prepare('SELECT name, qty, options_text FROM kk_order_items WHERE order_id = ?').all(o.id).map(i => ({ name: i.name, qty: i.qty, options: i.options_text })) }));
function statement(kid) {
  const e = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(subtotal),0) AS gross, COALESCE(SUM(commission_amt),0) AS comm, COALESCE(SUM(kitchen_amt),0) AS net FROM kk_orders WHERE kitchen_id = ? AND status = 'delivered'").get(kid);
  const paid = db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM kk_payouts WHERE kitchen_id = ?').get(kid).s;
  const sup = db.prepare("SELECT COALESCE(SUM(total),0) AS s FROM kk_supply WHERE kitchen_id = ? AND status = 'supplied'").get(kid).s;
  return { delivered: e.n, gross: e.gross, commission: e.comm, earned: e.net, paid, supplies: sup, balance: e.net - paid - sup, payouts: db.prepare('SELECT amount, reference, note, created_at FROM kk_payouts WHERE kitchen_id = ? ORDER BY id DESC LIMIT 50').all(kid) };
}
router.get('/partner/me', requireKitchen, noStore, (req, res) => {
  const k = db.prepare('SELECT * FROM kk_kitchens WHERE id = ?').get(req.user.kitchenId); if (!k) return res.status(404).json({ error: 'Kitchen not found' });
  const S = settings(), r = rating(k.id);
  res.json({ kitchen: { id: k.id, name: k.name, cook: k.cook_name, phone: k.phone, email: k.email, bio: k.bio, specialities: k.specialities, address: k.address, region: k.region, radiusKm: k.radius_km, capacity: k.capacity, prepMin: k.prep_min, status: k.status, paused: !!k.paused, strikes: k.strikes, queuePosition: queuePos(k), rating: r.avg, ratingCount: r.count, commissionPct: k.commission_pct == null ? S.commissionPct : k.commission_pct, docs: jparse(k.docs, []).map(d => ({ type: d.type, no: d.no || '', expiry: d.expiry || '', hasFile: !!d.file })) },
    dishes: db.prepare('SELECT d.*, kd.available FROM kk_kitchen_dishes kd JOIN kk_dishes d ON d.id = kd.dish_id WHERE kd.kitchen_id = ? AND d.active = 1 ORDER BY d.sort_order').all(k.id).map(d => Object.assign(dishFull(d), { available: !!d.available })),
    allDishes: db.prepare('SELECT id, name, tradition, category, price FROM kk_dishes WHERE active = 1 ORDER BY sort_order').all(), settings: { lunch: S.lunch, dinner: S.dinner, holdMinutes: S.holdMinutes }, statement: statement(k.id) });
});
router.patch('/partner/me', requireKitchen, (req, res) => {
  const k = db.prepare('SELECT * FROM kk_kitchens WHERE id = ?').get(req.user.kitchenId), b = req.body || {};
  db.prepare("UPDATE kk_kitchens SET bio = ?, phone = ?, capacity = ?, prep_min = ?, paused = ?, specialities = ?, updated_at = datetime('now') WHERE id = ?").run(
    b.bio === undefined ? k.bio : clean(b.bio, 600), b.phone === undefined ? k.phone : clean(b.phone, 20), b.capacity === undefined ? k.capacity : Math.max(1, Math.min(60, parseInt(b.capacity, 10) || k.capacity)),
    b.prepMin === undefined ? k.prep_min : Math.max(10, Math.min(180, parseInt(b.prepMin, 10) || k.prep_min)), b.paused === undefined ? k.paused : (b.paused ? 1 : 0), b.specialities === undefined ? k.specialities : clean(b.specialities, 200), k.id);
  res.json({ ok: true });
});
router.post('/partner/password', requireKitchen, (req, res) => {
  const k = db.prepare('SELECT * FROM kk_kitchens WHERE id = ?').get(req.user.kitchenId), b = req.body || {};
  if (!bcrypt.compareSync(String(b.current || ''), k.password_hash)) return res.status(401).json({ error: 'Current password is incorrect' });
  if (String(b.next || '').length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  db.prepare('UPDATE kk_kitchens SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(b.next), 10), k.id); res.json({ ok: true });
});
router.post('/partner/documents', requireKitchen, (req, res) => {
  const k = db.prepare('SELECT * FROM kk_kitchens WHERE id = ?').get(req.user.kitchenId), dd = addDocs(k, req.body || {}); if (dd.error) return res.status(400).json({ error: dd.error });
  db.prepare("UPDATE kk_kitchens SET docs = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(dd.docs), k.id); res.json({ ok: true });
});
router.post('/partner/dishes/:id(\\d+)/available', requireKitchen, (req, res) => {
  const r = db.prepare('UPDATE kk_kitchen_dishes SET available = ? WHERE kitchen_id = ? AND dish_id = ?').run((req.body || {}).available ? 1 : 0, req.user.kitchenId, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'You are not approved for this dish yet' }); res.json({ ok: true });
});
router.get('/partner/orders', requireKitchen, noStore, (req, res) => {
  expireUnpaid();
  const scope = req.query.scope, n = nowEAT();
  if (scope === 'history') return res.json({ orders: partnerOrders(req.user.kitchenId, "AND status IN ('delivered','cancelled','rejected')") });
  res.json({ orders: partnerOrders(req.user.kitchenId, "AND status NOT IN ('delivered','cancelled','rejected')"), today: n.date });
});
router.patch('/partner/orders/:id(\\d+)/status', requireKitchen, (req, res) => {
  const o = db.prepare('SELECT * FROM kk_orders WHERE id = ? AND kitchen_id = ?').get(req.params.id, req.user.kitchenId); if (!o) return res.status(404).json({ error: 'Order not found' });
  const to = String((req.body || {}).status), allowed = { new: ['accepted', 'rejected'], accepted: ['preparing', 'ready', 'rejected'], preparing: ['ready', 'rejected'] };
  if (!(allowed[o.status] || []).includes(to)) return res.status(400).json({ error: `An order that is "${o.status}" cannot be marked "${to}"` });
  if (to === 'rejected' && !clean(req.body.reason, 200)) return res.status(400).json({ error: 'Please give a short reason' });
  db.prepare("UPDATE kk_orders SET status = ?, reason = ?, updated_at = datetime('now'), ready_at = CASE WHEN ? = 'ready' THEN datetime('now') ELSE ready_at END, accepted_at = CASE WHEN ? = 'accepted' THEN datetime('now') ELSE accepted_at END WHERE id = ?").run(to, to === 'rejected' ? clean(req.body.reason, 200) : o.reason, to, to, o.id);
  let moved = null;
  if (to === 'rejected') { const S = settings(); if (S.autoReassign) { const c = candidates(o, S)[0]; if (c) { reassign(lastOrderFull(o.id), c.kitchen, S); moved = c.kitchen.name; } } if (!moved) notify.queue('rejected', lastOrderFull(o.id)); }
  else if (to === 'accepted' || to === 'ready') notify.queue(to, lastOrderFull(o.id));
  res.json({ ok: true, reassignedTo: moved });
});
router.get('/partner/statement', requireKitchen, noStore, (req, res) => res.json(statement(req.user.kitchenId)));

// ================= ADMIN =================
router.post('/admin-login', limiter(30, 'alog'), (req, res) => {
  const pw = String((req.body || {}).password || ''), E = process.env;
  const roles = [['KITCHENS_ADMIN_PASSWORD', 'full'], ['KITCHENS_DISPATCH_PASSWORD', 'dispatch'], ['KITCHENS_ACCOUNTS_PASSWORD', 'accounts']].filter(r => E[r[0]]);
  if (!roles.length) return res.status(503).json({ error: 'Kitchens Admin is not set up yet: set KITCHENS_ADMIN_PASSWORD on the server' });
  const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  const hit = roles.find(r => same(E[r[0]], pw)); if (!hit) return res.status(401).json({ error: 'Incorrect Kitchens Admin password' });
  res.json({ token: signKitchensAdminToken(hit[1]), role: hit[1] });
});
const admin = express.Router(); admin.use(requireKitchensAdmin, noStore);
// Sub-logins: dispatch (orders, riders, supply, outbox) and accounts (money views). The full login and the main admin can do everything.
const PERM = {
  dispatch: [/^GET \/(overview|orders|riders|supply|alerts|outbox|dashboard|dishes|settings)/, /^GET \/kitchens(\/\d+)?$/, /^(POST|PATCH|PUT) \/(orders|riders|supply|outbox)/],
  accounts: [/^GET \/(overview|orders|payouts|economics|dashboard|supply|export|settings|dishes|alerts)/, /^GET \/kitchens(\/\d+)?$/, /^POST \/payouts/],
};
admin.use((req, res, next) => {
  const sub = req.user.role === 'admin' ? 'full' : (req.user.sub || 'full'); res.locals.sub = sub; if (sub === 'full') return next();
  if ((PERM[sub] || []).some(r => r.test(req.method + ' ' + req.path))) return next();
  res.status(403).json({ error: 'Your login does not have access to this section' });
});
admin.use((req, res, next) => { // audit trail of every change
  if (req.method === 'GET') return next();
  res.on('finish', () => { if (res.statusCode < 400) { try { const b = Object.assign({}, req.body || {}); ['data', 'password', 'pin', 'docImages'].forEach(k => delete b[k]);
    db.prepare('INSERT INTO kk_audit (actor, action, target, detail) VALUES (?, ?, ?, ?)').run(res.locals.sub, req.method + ' ' + req.path, req.path, JSON.stringify(b).slice(0, 400)); } catch (e) { /* ignore */ } } });
  next();
});
const kAdmin = (k, hide) => {
  const r = rating(k.id), st = statement(k.id), S = settings();
  return { id: k.id, slug: k.slug, name: k.name, cook: k.cook_name, phone: k.phone, email: k.email, bio: k.bio, specialities: k.specialities, experience: k.experience, address: k.address, areaId: k.area_id, region: k.region, lat: k.lat, lng: k.lng, radiusKm: k.radius_km,
    capacity: k.capacity, prepMin: k.prep_min, status: k.status, paused: !!k.paused, commissionPct: k.commission_pct, effectiveCommission: k.commission_pct == null ? S.commissionPct : k.commission_pct, vetting: jparse(k.vetting, {}), notes: k.notes, strikes: k.strikes,
    docs: hide ? [] : jparse(k.docs, []), rating: r.avg, ratingCount: r.count, orders: db.prepare('SELECT COUNT(*) AS n FROM kk_orders WHERE kitchen_id = ?').get(k.id).n, balance: st.balance, earned: st.earned, paid: st.paid, queuePosition: queuePos(k),
    approvedDishes: db.prepare('SELECT dish_id FROM kk_kitchen_dishes WHERE kitchen_id = ?').all(k.id).map(x => x.dish_id), created: k.created_at, approvedAt: k.approved_at };
};
admin.get('/overview', (req, res) => {
  const by = {}; db.prepare('SELECT status, COUNT(*) AS n FROM kk_kitchens GROUP BY status').all().forEach(r => by[r.status] = r.n);
  const regions = db.prepare("SELECT region, SUM(CASE WHEN status IN ('pilot','live') THEN 1 ELSE 0 END) AS live, SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued, COUNT(*) AS total FROM kk_kitchens WHERE region != '' GROUP BY region ORDER BY region").all();
  const n = nowEAT(), S = settings();
  const today = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS gmv, COALESCE(SUM(commission_amt),0) AS comm FROM kk_orders WHERE date = ? AND status NOT IN ('cancelled','rejected')").get(n.date);
  res.json({ byStatus: by, regions: regions.map(r => Object.assign(r, { cap: Number(S.zoneCaps[r.region] || S.zoneCap) })), today, newApplications: by.applied || 0, openOrders: db.prepare("SELECT COUNT(*) AS n FROM kk_orders WHERE status NOT IN ('delivered','cancelled','rejected')").get().n, date: n.date });
});
admin.get('/kitchens', (req, res) => {
  const st = req.query.status; const rows = st ? db.prepare('SELECT * FROM kk_kitchens WHERE status = ? ORDER BY id').all(st) : db.prepare('SELECT * FROM kk_kitchens ORDER BY id DESC').all();
  res.json({ kitchens: rows.map(k => kAdmin(k, res.locals.sub !== 'full')) });
});
admin.get('/kitchens/:id(\\d+)', (req, res) => { const k = db.prepare('SELECT * FROM kk_kitchens WHERE id = ?').get(req.params.id); if (!k) return res.status(404).json({ error: 'Not found' }); res.json(kAdmin(k, res.locals.sub !== 'full')); });
const STATUSES = ['applied', 'queued', 'vetting', 'pilot', 'live', 'paused', 'delisted', 'rejected'];
admin.patch('/kitchens/:id(\\d+)', (req, res) => {
  const k = db.prepare('SELECT * FROM kk_kitchens WHERE id = ?').get(req.params.id); if (!k) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {}, S = settings(), v = b.vetting === undefined ? jparse(k.vetting, {}) : b.vetting;
  let status = b.status === undefined ? k.status : String(b.status); if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status' });
  if (['pilot', 'live'].includes(status) && !['pilot', 'live'].includes(k.status)) {
    const keys = ['taste', 'consistency', 'hygiene', 'premises', 'documents', 'reliability', 'attitude'], vals = keys.map(x => Number(v[x]));
    const complete = vals.every(x => x >= 1 && x <= 5), avg = complete ? vals.reduce((a, c) => a + c, 0) / vals.length : 0;
    const fails = !complete ? 'Complete all seven vetting scores first' : avg < 4 ? `Vetting average is ${avg.toFixed(1)}; 4.0 is required` : (Number(v.hygiene) <= 1 || Number(v.documents) <= 1) ? 'Hygiene and documents cannot score 1' : '';
    if (fails && !(b.override && clean(b.notes === undefined ? k.notes : b.notes, 400))) return res.status(409).json({ error: fails + '. To override, tick override and add a note.' });
    const cap = Number(S.zoneCaps[k.region] || S.zoneCap), liveN = db.prepare("SELECT COUNT(*) AS n FROM kk_kitchens WHERE region = ? AND status IN ('pilot','live') AND id != ?").get(k.region, k.id).n;
    if (liveN >= cap && !b.override) return res.status(409).json({ error: `${k.region} already has ${liveN} of ${cap} kitchens. Raise the zone cap or tick override.` });
    if (!db.prepare('SELECT 1 FROM kk_kitchen_dishes WHERE kitchen_id = ?').get(k.id) && !Array.isArray(b.approvedDishes)) return res.status(409).json({ error: 'Approve at least one dish (after the tasting) before going live' });
  }
  const num = (x, d, lo, hi) => x === undefined ? d : Math.max(lo, Math.min(hi, Number(x) || d));
  db.transaction(() => {
    db.prepare(`UPDATE kk_kitchens SET name = ?, status = ?, radius_km = ?, capacity = ?, prep_min = ?, commission_pct = ?, vetting = ?, notes = ?, strikes = ?, lat = ?, lng = ?, bio = ?, region = ?,
      approved_at = CASE WHEN ? IN ('pilot','live') AND approved_at IS NULL THEN datetime('now') ELSE approved_at END, updated_at = datetime('now') WHERE id = ?`).run(
      b.name === undefined ? k.name : clean(b.name, 80), status, num(b.radiusKm, k.radius_km, 0.5, 30), num(b.capacity, k.capacity, 1, 60), num(b.prepMin, k.prep_min, 10, 180),
      b.commissionPct === undefined ? k.commission_pct : (b.commissionPct === null || b.commissionPct === '' ? null : num(b.commissionPct, 20, 0, 60)), JSON.stringify(v || {}), b.notes === undefined ? k.notes : clean(b.notes, 1000),
      b.strikes === undefined ? k.strikes : Math.max(0, Math.min(9, parseInt(b.strikes, 10) || 0)), b.lat === undefined ? k.lat : Number(b.lat), b.lng === undefined ? k.lng : Number(b.lng), b.bio === undefined ? k.bio : clean(b.bio, 600), b.region === undefined ? k.region : clean(b.region, 60), status, k.id);
    if (Array.isArray(b.approvedDishes)) {
      const ids = b.approvedDishes.map(Number).filter(Number.isInteger);
      db.prepare('DELETE FROM kk_kitchen_dishes WHERE kitchen_id = ? AND dish_id NOT IN (' + (ids.length ? ids.map(() => '?').join(',') : '0') + ')').run(k.id, ...ids);
      for (const id of ids) db.prepare('INSERT OR IGNORE INTO kk_kitchen_dishes (kitchen_id, dish_id, available) VALUES (?, ?, 1)').run(k.id, id);
    }
  })();
  res.json({ ok: true });
});
admin.delete('/kitchens/:id(\\d+)', (req, res) => {
  const o = db.prepare('SELECT COUNT(*) AS n FROM kk_orders WHERE kitchen_id = ?').get(req.params.id).n; if (o) return res.status(409).json({ error: 'This kitchen has orders. Delist it instead of deleting.' });
  db.prepare('DELETE FROM kk_kitchen_dishes WHERE kitchen_id = ?').run(req.params.id); db.prepare('DELETE FROM kk_kitchens WHERE id = ?').run(req.params.id); res.json({ ok: true });
});
admin.get('/kitchens/:id(\\d+)/docs/:file', (req, res) => {
  const f = path.basename(req.params.file), k = db.prepare('SELECT docs FROM kk_kitchens WHERE id = ?').get(req.params.id);
  if (!k || !jparse(k.docs, []).some(d => d.file === f)) return res.status(404).json({ error: 'Not found' });
  const p = path.join(PRIVATE, f); if (!fs.existsSync(p)) return res.status(404).json({ error: 'File missing' });
  res.type(path.extname(f).slice(1) === 'jpg' ? 'jpeg' : path.extname(f).slice(1)).send(fs.readFileSync(p));
});
admin.patch('/kitchens/:id(\\d+)/docs', (req, res) => {
  const k = db.prepare('SELECT docs FROM kk_kitchens WHERE id = ?').get(req.params.id); if (!k) return res.status(404).json({ error: 'Not found' });
  const docs = jparse(k.docs, []), b = req.body || {}; const d = docs[Number(b.index)]; if (!d) return res.status(404).json({ error: 'Document not found' });
  d.verified = !!b.verified; d.verifiedOn = b.verified ? nowEAT().date : ''; if (b.note !== undefined) d.note = clean(b.note, 200);
  db.prepare('UPDATE kk_kitchens SET docs = ? WHERE id = ?').run(JSON.stringify(docs), req.params.id); res.json({ ok: true });
});
// dishes
admin.get('/dishes', (req, res) => res.json({ dishes: db.prepare('SELECT * FROM kk_dishes ORDER BY sort_order, id').all().map(dishFull) }));
function dishInput(b, e) {
  e = e || {}; const pick = (k, max, d) => b[k] === undefined ? (e[k] !== undefined ? e[k] : d) : clean(b[k], max);
  const arr = k => Array.isArray(b[k]) ? b[k].map(x => clean(x, 300)).filter(Boolean).join('\n') : (b[k] === undefined ? e[k] || '' : lines(b[k]).map(x => clean(x, 300)).join('\n'));
  let options = e.options || '[]'; if (b.options !== undefined) { const o = Array.isArray(b.options) ? b.options : jparse(b.options, null); if (!Array.isArray(o)) return { error: 'Options must be a list' };
    options = JSON.stringify(o.map(g => ({ name: clean(g.name, 40), required: !!g.required, choices: (g.choices || []).map(c => ({ name: clean(c.name, 40), price: Math.max(0, parseInt(c.price, 10) || 0) })).filter(c => c.name) })).filter(g => g.name && g.choices.length)); }
  const price = b.price === undefined ? e.price : parseInt(b.price, 10); if (!(price >= 0 && price <= 100000)) return { error: 'Enter a price' };
  const image = pick('image', 300, ''); if (image && !/^(\/uploads\/|https?:\/\/)/i.test(image)) return { error: 'Image must be an uploaded file or a web address' };
  return { v: { name: pick('name', 100, ''), tradition: pick('tradition', 30, ''), category: pick('category', 30, 'Combo'), meal: ['lunch', 'dinner', 'both'].includes(b.meal) ? b.meal : (e.meal || 'both'), price, serves: Math.max(1, Math.min(50, parseInt(b.serves === undefined ? e.serves : b.serves, 10) || 1)),
    description: pick('description', 400, ''), components: arr('components'), method: arr('method'), options, packaging: pick('packaging', 200, ''), tips: pick('tips', 300, ''), image, tags: (b.tags === undefined ? String(e.tags || '') : (Array.isArray(b.tags) ? b.tags : String(b.tags).split(',')).map(x => clean(x, 20).toLowerCase()).filter(x => TAGS.includes(x)).join(',')), tags: (b.tags === undefined ? String(e.tags || '') : (Array.isArray(b.tags) ? b.tags : String(b.tags).split(',')).map(x => clean(x, 20).toLowerCase()).filter(x => TAGS.includes(x)).join(',')), active: b.active === undefined ? (e.active === undefined ? 1 : e.active) : (b.active ? 1 : 0), sort_order: b.sort === undefined ? (e.sort_order || 0) : parseInt(b.sort, 10) || 0 } };
}
admin.post('/dishes', (req, res) => {
  const p = dishInput(req.body || {}); if (p.error) return res.status(400).json({ error: p.error }); if (!p.v.name) return res.status(400).json({ error: 'Give the dish a name' });
  let slug = slugify(p.v.name), n = 1; while (db.prepare('SELECT 1 FROM kk_dishes WHERE slug = ?').get(slug)) slug = slugify(p.v.name) + '-' + (++n);
  const v = p.v, r = db.prepare('INSERT INTO kk_dishes (slug, name, tradition, category, meal, price, serves, description, components, method, options, packaging, tips, image, tags, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(slug, v.name, v.tradition, v.category, v.meal, v.price, v.serves, v.description, v.components, v.method, v.options, v.packaging, v.tips, v.image, v.tags, v.active, v.sort_order || 999);
  res.status(201).json({ ok: true, id: r.lastInsertRowid });
});
admin.put('/dishes/:id(\\d+)', (req, res) => {
  const e = db.prepare('SELECT * FROM kk_dishes WHERE id = ?').get(req.params.id); if (!e) return res.status(404).json({ error: 'Not found' });
  const p = dishInput(req.body || {}, e); if (p.error) return res.status(400).json({ error: p.error }); const v = p.v;
  db.prepare('UPDATE kk_dishes SET name = ?, tradition = ?, category = ?, meal = ?, price = ?, serves = ?, description = ?, components = ?, method = ?, options = ?, packaging = ?, tips = ?, image = ?, tags = ?, active = ?, sort_order = ? WHERE id = ?').run(v.name, v.tradition, v.category, v.meal, v.price, v.serves, v.description, v.components, v.method, v.options, v.packaging, v.tips, v.image, v.tags, v.active, v.sort_order, e.id);
  res.json({ ok: true });
});
admin.delete('/dishes/:id(\\d+)', (req, res) => {
  if (db.prepare('SELECT 1 FROM kk_order_items WHERE dish_id = ?').get(req.params.id)) return res.status(409).json({ error: 'This dish has been ordered. Hide it (untick Active) instead of deleting.' });
  db.prepare('DELETE FROM kk_kitchen_dishes WHERE dish_id = ?').run(req.params.id); db.prepare('DELETE FROM kk_dishes WHERE id = ?').run(req.params.id); res.json({ ok: true });
});
admin.post('/upload', (req, res) => {
  const im = readImage((req.body || {}).data, 3 * 1024 * 1024); if (im.error) return res.status(400).json({ error: im.error });
  fs.mkdirSync(IMGDIR, { recursive: true }); const file = `${slugify((req.body || {}).name || 'dish').slice(0, 30)}-${crypto.randomBytes(4).toString('hex')}.${im.ext}`; fs.writeFileSync(path.join(IMGDIR, file), im.buf);
  res.status(201).json({ ok: true, url: '/uploads/kitchens/' + file });
});
admin.get('/images', (req, res) => { fs.mkdirSync(IMGDIR, { recursive: true }); res.json({ files: fs.readdirSync(IMGDIR).filter(f => /\.(jpg|png|webp)$/i.test(f)).map(f => ({ file: f, url: '/uploads/kitchens/' + f })) }); });
// orders
admin.get('/orders', (req, res) => {
  expireUnpaid();
  const w = [], a = []; if (req.query.status) { w.push('o.status = ?'); a.push(req.query.status); } if (req.query.kitchen) { w.push('o.kitchen_id = ?'); a.push(Number(req.query.kitchen)); } if (req.query.date) { w.push('o.date = ?'); a.push(req.query.date); }
  const rows = db.prepare(`SELECT o.*, k.name AS kitchen_name FROM kk_orders o LEFT JOIN kk_kitchens k ON k.id = o.kitchen_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY o.id DESC LIMIT 300`).all(...a);
  res.json({ orders: rows.map(o => ({ id: o.id, kitchen: o.kitchen_name, kitchenId: o.kitchen_id, customer: o.name, phone: o.phone, address: o.address, date: o.date, meal: o.meal, status: o.status, subtotal: o.subtotal, fee: o.delivery_fee, total: o.total, payment: o.payment, commission: o.commission_amt, notes: o.notes, reason: o.reason, rating: o.rating, review: o.review, km: o.distance_km, created: o.created_at, paid: !!o.paid, discount: o.discount, promo: o.promo_code, riderId: o.rider_id, region: o.region, reassigned: !!o.reassigned_from, acceptedAt: o.accepted_at, mpesaReceipt: o.mpesa_receipt, code: o.delivery_code, corp: o.corp_id,
    items: db.prepare('SELECT name, qty, options_text FROM kk_order_items WHERE order_id = ?').all(o.id).map(i => ({ name: i.name, qty: i.qty, options: i.options_text })) })) });
});
admin.patch('/orders/:id(\\d+)', (req, res) => {
  const o = db.prepare('SELECT * FROM kk_orders WHERE id = ?').get(req.params.id); if (!o) return res.status(404).json({ error: 'Not found' });
  const to = String((req.body || {}).status || ''); if (!['out_for_delivery', 'delivered', 'cancelled'].includes(to)) return res.status(400).json({ error: 'Use out_for_delivery, delivered or cancelled' });
  if (to === 'out_for_delivery' && o.status !== 'ready') return res.status(400).json({ error: 'Only a ready order can go out for delivery' });
  if (to === 'delivered' && !['ready', 'out_for_delivery'].includes(o.status)) return res.status(400).json({ error: 'Only a ready or out-for-delivery order can be delivered' });
  if (to === 'cancelled' && ['delivered', 'cancelled', 'rejected'].includes(o.status)) return res.status(400).json({ error: 'This order is already closed' });
  db.prepare(`UPDATE kk_orders SET status = ?, reason = ?, updated_at = datetime('now'), picked_at = CASE WHEN ? = 'out_for_delivery' THEN datetime('now') ELSE picked_at END,
    delivered_at = CASE WHEN ? = 'delivered' THEN datetime('now') ELSE delivered_at END, paid = CASE WHEN ? = 'delivered' AND payment IN ('cash','mpesa') THEN 1 ELSE paid END WHERE id = ?`).run(to, to === 'cancelled' ? clean(req.body.reason, 200) : o.reason, to, to, to, o.id);
  const n = lastOrderFull(o.id), rd = n.rider_id ? db.prepare('SELECT name FROM kk_riders WHERE id = ?').get(n.rider_id) : null;
  notify.queue(to, n, { rider: rd && rd.name }); res.json({ ok: true });
});
// payouts
admin.get('/payouts', (req, res) => res.json({ kitchens: db.prepare("SELECT * FROM kk_kitchens WHERE status != 'rejected' ORDER BY name").all().map(k => Object.assign({ id: k.id, name: k.name, phone: k.phone }, statement(k.id))) }));
admin.post('/payouts', (req, res) => {
  const b = req.body || {}, amt = parseInt(b.amount, 10), k = db.prepare('SELECT id FROM kk_kitchens WHERE id = ?').get(Number(b.kitchenId));
  if (!k) return res.status(404).json({ error: 'Kitchen not found' }); if (!(amt > 0)) return res.status(400).json({ error: 'Enter the amount paid' });
  db.prepare('INSERT INTO kk_payouts (kitchen_id, amount, reference, note) VALUES (?, ?, ?, ?)').run(k.id, amt, clean(b.reference, 60), clean(b.note, 200)); res.json({ ok: true });
});
// settings
admin.get('/settings', (req, res) => res.json(settings()));
admin.post('/settings', (req, res) => {
  const b = req.body || {}, S = settings(), n = (v, d, lo, hi) => { const x = Number(v === undefined ? d : v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d; };
  const slot = (k, def) => { const s = Object.assign({}, def, b[k] || {}); for (const f of ['from', 'to', 'cutoff']) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s[f])) return null; return { label: clean(s.label, 20) || def.label, from: s.from, to: s.to, cutoff: s.cutoff }; };
  const lunch = slot('lunch', S.lunch), dinner = slot('dinner', S.dinner); if (!lunch || !dinner) return res.status(400).json({ error: 'Times must look like 12:30' });
  const caps = {}; for (const [r, c] of Object.entries(b.zoneCaps || S.zoneCaps)) { const x = parseInt(c, 10); if (x > 0) caps[clean(r, 60)] = Math.min(50, x); }
  const next = { commissionPct: n(b.commissionPct, S.commissionPct, 0, 60), lunch, dinner, fee: { base: n((b.fee || {}).base, S.fee.base, 0, 2000), perKm: n((b.fee || {}).perKm, S.fee.perKm, 0, 200), bandKm: n((b.fee || {}).bandKm, S.fee.bandKm, 0.5, 20), max: n((b.fee || {}).max, S.fee.max, 0, 5000) },
    defaultRadiusKm: n(b.defaultRadiusKm, S.defaultRadiusKm, 0.5, 30), roadFactor: n(b.roadFactor, S.roadFactor, 1, 2.5), zoneCap: Math.round(n(b.zoneCap, S.zoneCap, 1, 50)), zoneCaps: caps, minOrder: Math.round(n(b.minOrder, S.minOrder, 0, 20000)), holdMinutes: Math.round(n(b.holdMinutes, S.holdMinutes, 30, 480)),
    deliveryCost: Math.round(n(b.deliveryCost, S.deliveryCost, 0, 2000)), autoReassign: b.autoReassign === undefined ? !!S.autoReassign : !!b.autoReassign, loyaltyEvery: Math.round(n(b.loyaltyEvery, S.loyaltyEvery, 0, 50)) };
  db.prepare("INSERT INTO meta (key, value) VALUES ('kk_settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(next)); res.json({ ok: true, settings: next });
});
require('./kk-ext')(router, admin, { db, clean, last9, jparse, slugify, settings, nowEAT, addDays, roadKm, point, feeFor, slotUsed, live, rating, statement, kPub, kAdmin, candidates, reassign, notify, mpesa, bcrypt, limiter, noStore, requireKitchen, requireRider, signRiderToken, expireUnpaid, lastOrderFull, haversine, lines, dishFull, TAGS, last9 });
router.use('/admin', admin);
module.exports = router;
