// Azizo Marketplace (v4.0): partner butcheries sell under the Azizo Butchery and Grill brand.
//   public:  /status /partners /partners/:slug /apply /partner/login
//   partner: /partner/me /partner/items /partner/orders /partner/invoices /partner/password
//   admin:   /admin/*  (main admin password)
// Everything stays hidden until the admin switches the marketplace on (Marketplace admin > Settings).
const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { requireAdmin, requirePartner, signPartnerToken } = require('../middleware/auth');
const router = express.Router();

const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, max);
const slugify = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'butchery';
const last9 = s => String(s || '').replace(/\D/g, '').slice(-9);
const jparse = (t, d) => { try { const v = JSON.parse(t); return v == null ? d : v; } catch (e) { return d; } };
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
const hits = new Map();
const limiter = (max, key) => (req, res, next) => {
  const v = key + (String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || 'unknown'), now = Date.now();
  const recent = (hits.get(v) || []).filter(t => now - t < 3600000);
  if (recent.length >= max) return res.status(429).json({ error: 'Too many attempts - please try again later' });
  recent.push(now); hits.set(v, recent); next();
};

// ---------- settings (on/off lives in site_settings so the public pages can read it from /api/site/settings) ----------
const DEF = { joiningFee: 0, perInvoiceFee: 0, graceDays: 7, suspendAfterDays: 21, defaultDeliveryFee: 150, minOrder: 500, priceGapPct: 25 };
function siteSettings() { return jparse(db.metaGet('site_settings'), {}); }
const isOn = () => !!(siteSettings().marketplace || {}).enabled;
function setOn(v) { const s = siteSettings(); s.marketplace = { enabled: !!v }; db.metaSet('site_settings', JSON.stringify(s)); }
function settings() { return Object.assign({}, DEF, jparse(db.metaGet('mk_settings'), {})); }
const gate = (req, res, next) => isOn() ? next() : res.status(404).json({ error: 'The marketplace is not open yet', enabled: false });

// ---------- geo ----------
const haversine = (a, b, c, d) => { const r = Math.PI / 180, dl = (c - a) * r, dg = (d - b) * r, h = Math.sin(dl / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dg / 2) ** 2; return 2 * 6371 * Math.asin(Math.sqrt(h)); };
function point(b) {
  if (b.areaId) { const a = db.prepare('SELECT id, name, region, lat, lng FROM areas WHERE id = ?').get(String(b.areaId)); if (a) return { lat: a.lat, lng: a.lng, area: a }; }
  const la = Number(b.lat), ln = Number(b.lng);
  if (Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180 && (la || ln)) return { lat: la, lng: ln };
  return null;
}

// ---------- shapes ----------
const LIVE = "status IN ('pilot','live') AND paused = 0";
function stats(id) {
  const r = db.prepare("SELECT SUM(status = 'completed') AS done, SUM(status = 'cancelled') AS cx FROM orders WHERE partner_id = ?").get(id);
  const done = r.done || 0, cx = r.cx || 0;
  return { orders: done, completionPct: done + cx ? Math.round(done * 100 / (done + cx)) : null };
}
const pub = p => ({ id: p.id, slug: p.slug, name: p.name, area: p.area_id, region: p.region, address: p.address, story: p.story, halal: !!p.halal, tier: p.tier,
  hygieneScore: p.hygiene_score, lastInspection: p.last_inspection || '', licenceVerified: !!p.licence_verified, deliveryMode: p.delivery_mode, deliveryFee: p.delivery_fee, minOrder: p.min_order,
  photos: jparse(p.photos, []), lat: p.lat, lng: p.lng, stats: stats(p.id) });
function itemsOf(p, onlyListed) {
  const rows = db.prepare(`SELECT pi.product_id, pi.price AS pprice, pi.in_stock AS pstock, pr.name, pr.cat, pr.kind, pr.category_group, pr.unit, pr.img, pr.price, pr.badges, pr.in_stock AS gstock, c.sw_name, c.cut_family, COALESCE(c.retired, 0) AS retired
    FROM mk_partner_items pi JOIN products pr ON pr.id = pi.product_id LEFT JOIN mk_catalog c ON c.product_id = pr.id WHERE pi.partner_id = ? ORDER BY pr.category_group, pr.cat, pr.name`).all(p.id);
  const gap = settings().priceGapPct;
  return rows.filter(r => !onlyListed || !r.retired).map(r => {
    const price = r.pprice || r.price;
    return { id: r.product_id, name: r.name, swName: r.sw_name || '', cat: r.cat, group: r.category_group, unit: r.unit, img: r.img || '', badges: jparse(r.badges, []), price, recommended: r.price,
      gapPct: r.price ? Math.round((price - r.price) * 100 / r.price) : 0, farFromRecommended: r.price ? Math.abs(price - r.price) * 100 / r.price > gap : false, inStock: !!r.pstock && r.gstock !== 0 && !r.retired };
  });
}

// ---------- public ----------
router.get('/status', noStore, (req, res) => res.json({ enabled: isOn() }));
router.get('/partners', noStore, gate, (req, res) => {
  const pt = point(req.query), rows = db.prepare(`SELECT * FROM mk_partners WHERE ${LIVE}`).all();
  const out = rows.map(p => Object.assign(pub(p), { distanceKm: pt && p.lat != null ? Math.round(haversine(pt.lat, pt.lng, p.lat, p.lng) * 1.3 * 10) / 10 : null, itemCount: db.prepare('SELECT COUNT(*) AS n FROM mk_partner_items WHERE partner_id = ? AND in_stock = 1').get(p.id).n }));
  out.sort((a, b) => (a.distanceKm == null) - (b.distanceKm == null) || (a.distanceKm - b.distanceKm) || a.name.localeCompare(b.name));
  res.json({ partners: out });
});
router.get('/partners/:slug', noStore, gate, (req, res) => {
  const p = db.prepare(`SELECT * FROM mk_partners WHERE slug = ? AND ${LIVE}`).get(req.params.slug);
  if (!p) return res.status(404).json({ error: 'That butchery is not taking orders right now' });
  res.json({ partner: pub(p), items: itemsOf(p, true) });
});

const PHOTODIR = path.join(__dirname, '..', 'uploads', 'partners');
function readImage(data, maxBytes) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(data || '')); if (!m) return { error: 'Upload a JPG, PNG or WebP image' };
  const buf = Buffer.from(m[2], 'base64'); if (buf.length > maxBytes) return { error: 'Image is too large' };
  const ok = (m[1] === 'jpeg' && buf[0] === 0xFF && buf[1] === 0xD8) || (m[1] === 'png' && buf.slice(1, 4).toString() === 'PNG') || (m[1] === 'webp' && buf.slice(0, 4).toString() === 'RIFF');
  return ok ? { buf, ext: m[1] === 'jpeg' ? 'jpg' : m[1] } : { error: 'That file is not a valid image' };
}
const DMODES = ['own', 'azizo', 'independent'], PAYM = ['till', 'paybill', 'pochi'];
router.post('/apply', limiter(6, 'mapply'), gate, (req, res) => {
  const b = req.body || {}; if (b.website) return res.status(201).json({ ok: true });
  const name = clean(b.name, 80), owner = clean(b.owner, 60), phone = clean(b.phone, 20), email = clean(b.email, 100).toLowerCase(), pass = String(b.password || '');
  if (name.length < 3) return res.status(400).json({ error: 'Enter the name of your butchery' });
  if (owner.length < 2) return res.status(400).json({ error: 'Enter the owner name' });
  if (last9(phone).length < 9) return res.status(400).json({ error: 'Enter a valid phone number' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (pass.length < 6) return res.status(400).json({ error: 'Choose a password of at least 6 characters' });
  if (clean(b.licenceNo, 60).length < 3) return res.status(400).json({ error: 'Enter your business or meat-trade licence number' });
  if (!b.agree) return res.status(400).json({ error: 'Please tick the box to accept the Azizo standards' });
  if (db.prepare('SELECT 1 FROM mk_partners WHERE email = ? OR substr(replace(phone, \' \', \'\'), -9) = ?').get(email, last9(phone))) return res.status(409).json({ error: 'An application with this email or phone already exists. Sign in to the partner portal instead.' });
  const p = point(b); if (!p) return res.status(400).json({ error: 'Choose your area' });
  let slug = slugify(name); for (let i = 2; db.prepare('SELECT 1 FROM mk_partners WHERE slug = ?').get(slug); i++) slug = slugify(name) + '-' + i;
  const r = db.prepare(`INSERT INTO mk_partners (slug, name, owner, phone, email, password_hash, area_id, region, address, lat, lng, story, licence_no, licence_expiry, health_cert_no, halal, delivery_mode, pay_method, pay_account, min_order, delivery_fee)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(slug, name, owner, phone, email, bcrypt.hashSync(pass, 10), p.area ? p.area.id : '', p.area ? p.area.region : '', clean(b.address, 200), p.lat, p.lng,
    clean(b.story, 800), clean(b.licenceNo, 60), clean(b.licenceExpiry, 12), clean(b.healthCertNo, 60), b.halal ? 1 : 0, DMODES.includes(b.deliveryMode) ? b.deliveryMode : 'own', PAYM.includes(b.payMethod) ? b.payMethod : 'till', clean(b.payAccount, 40), settings().minOrder, settings().defaultDeliveryFee);
  const id = r.lastInsertRowid, photos = [];
  for (const d of (Array.isArray(b.photos) ? b.photos.slice(0, 3) : [])) {
    const im = readImage(d, 1500 * 1024); if (im.error) { db.prepare('DELETE FROM mk_partners WHERE id = ?').run(id); return res.status(400).json({ error: im.error }); }
    fs.mkdirSync(PHOTODIR, { recursive: true }); const f = `p${id}-${crypto.randomBytes(5).toString('hex')}.${im.ext}`; fs.writeFileSync(path.join(PHOTODIR, f), im.buf); photos.push('/uploads/partners/' + f);
  }
  if (photos.length) db.prepare('UPDATE mk_partners SET photos = ? WHERE id = ?').run(JSON.stringify(photos), id);
  res.status(201).json({ ok: true, message: 'Thank you! Your application is in. Azizo will contact you to arrange a premises visit and hygiene check.' });
});

// ---------- partner ----------
router.post('/partner/login', limiter(30, 'mplog'), (req, res) => {
  const b = req.body || {}, id = clean(b.login, 100).toLowerCase();
  const p = db.prepare('SELECT * FROM mk_partners WHERE email = ? OR substr(replace(phone, \' \', \'\'), -9) = ?').get(id, last9(id));
  if (!p || !bcrypt.compareSync(String(b.password || ''), p.password_hash || '')) return res.status(401).json({ error: 'Incorrect email/phone or password' });
  if (p.status === 'delisted' || p.status === 'rejected') return res.status(403).json({ error: 'This account is not active. Please contact Azizo.' });
  res.json({ token: signPartnerToken(p) });
});
const myPartner = req => db.prepare('SELECT * FROM mk_partners WHERE id = ?').get(req.user.partnerId);
function invoiceOut(i) { return { id: i.id, periodStart: i.period_start, periodEnd: i.period_end, orders: i.orders_count, gross: i.gross, fee: i.fee, extra: i.extra, total: i.total, status: i.status, dueDate: i.due_date, paidAt: i.paid_at, reference: i.reference, overdue: i.status === 'unpaid' && i.due_date < today() }; }
router.get('/partner/me', requirePartner, noStore, (req, res) => {
  const p = myPartner(req); if (!p) return res.status(404).json({ error: 'Not found' });
  res.json({ partner: Object.assign(pub(p), { owner: p.owner, phone: p.phone, email: p.email, status: p.status, paused: !!p.paused, payMethod: p.pay_method, payAccount: p.pay_account, adminNote: '' }),
    items: itemsOf(p, false), enabled: isOn(),
    catalogue: db.prepare('SELECT pr.id, pr.name, pr.cat, pr.category_group AS grp, pr.unit, pr.price FROM products pr LEFT JOIN mk_catalog c ON c.product_id = pr.id WHERE COALESCE(c.retired, 0) = 0 ORDER BY pr.category_group, pr.cat, pr.name').all(),
    invoices: db.prepare('SELECT * FROM mk_invoices WHERE partner_id = ? ORDER BY id DESC LIMIT 100').all(p.id).map(invoiceOut), gapPct: settings().priceGapPct });
});
router.patch('/partner/me', requirePartner, (req, res) => {
  const p = myPartner(req), b = req.body || {};
  db.prepare("UPDATE mk_partners SET story = ?, phone = ?, delivery_fee = ?, min_order = ?, paused = ?, delivery_mode = ?, pay_method = ?, pay_account = ?, updated_at = datetime('now') WHERE id = ?").run(
    b.story === undefined ? p.story : clean(b.story, 800), b.phone === undefined ? p.phone : clean(b.phone, 20),
    b.deliveryFee === undefined ? p.delivery_fee : Math.max(0, Math.min(1500, Math.round(Number(b.deliveryFee) || 0))), b.minOrder === undefined ? p.min_order : Math.max(0, Math.min(50000, Math.round(Number(b.minOrder) || 0))),
    b.paused === undefined ? p.paused : (b.paused ? 1 : 0), DMODES.includes(b.deliveryMode) ? b.deliveryMode : p.delivery_mode, PAYM.includes(b.payMethod) ? b.payMethod : p.pay_method, b.payAccount === undefined ? p.pay_account : clean(b.payAccount, 40), p.id);
  res.json({ ok: true });
});
router.post('/partner/password', requirePartner, (req, res) => {
  const p = myPartner(req), b = req.body || {};
  if (!bcrypt.compareSync(String(b.current || ''), p.password_hash)) return res.status(401).json({ error: 'Current password is incorrect' });
  if (String(b.next || '').length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  db.prepare('UPDATE mk_partners SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(b.next), 10), p.id); res.json({ ok: true });
});
// List items (at the recommended price) in bulk, or set one item's own price / stock.
router.post('/partner/items/bulk', requirePartner, (req, res) => {
  const p = myPartner(req), ids = Array.isArray((req.body || {}).ids) ? req.body.ids.slice(0, 200).map(String) : [];
  const ins = db.prepare('INSERT OR IGNORE INTO mk_partner_items (partner_id, product_id, price, in_stock) SELECT ?, id, NULL, 1 FROM products WHERE id = ? AND id NOT IN (SELECT product_id FROM mk_catalog WHERE retired = 1)');
  let n = 0; db.transaction(() => { ids.forEach(id => { n += ins.run(p.id, id).changes; }); })();
  res.json({ ok: true, added: n });
});
router.put('/partner/items/:id', requirePartner, (req, res) => {
  const p = myPartner(req), b = req.body || {}, pid = String(req.params.id);
  const pr = db.prepare('SELECT price FROM products WHERE id = ?').get(pid); if (!pr) return res.status(404).json({ error: 'Product not found' });
  const cur = db.prepare('SELECT * FROM mk_partner_items WHERE partner_id = ? AND product_id = ?').get(p.id, pid);
  const price = b.price === undefined ? (cur ? cur.price : null) : (b.price === null || b.price === '' ? null : Math.max(1, Math.min(1000000, Math.round(Number(b.price) || 0)) || 1));
  const stock = b.inStock === undefined ? (cur ? cur.in_stock : 1) : (b.inStock ? 1 : 0);
  db.prepare("INSERT INTO mk_partner_items (partner_id, product_id, price, in_stock, updated_at) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT(partner_id, product_id) DO UPDATE SET price = excluded.price, in_stock = excluded.in_stock, updated_at = datetime('now')").run(p.id, pid, price, stock);
  res.json({ ok: true });
});
router.delete('/partner/items/:id', requirePartner, (req, res) => { db.prepare('DELETE FROM mk_partner_items WHERE partner_id = ? AND product_id = ?').run(req.user.partnerId, String(req.params.id)); res.json({ ok: true }); });
router.get('/partner/orders', requirePartner, noStore, (req, res) => {
  const rows = db.prepare('SELECT * FROM orders WHERE partner_id = ? ORDER BY id DESC LIMIT 200').all(req.user.partnerId);
  const it = db.prepare('SELECT name, qty, unit, unit_price, line_total FROM order_items WHERE order_id = ?');
  res.json({ orders: rows.map(o => ({ id: o.id, status: o.status, createdAt: o.created_at, customer: o.customer_name, phone: o.customer_phone, fulfilment: o.fulfilment, address: o.delivery_address, area: o.area, notes: o.notes, subtotal: o.items_subtotal, deliveryFee: o.delivery_fee, total: o.total, payment: o.payment_method, items: it.all(o.id) })) });
});
const FLOW = ['received', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled'];
router.patch('/partner/orders/:id/status', requirePartner, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ? AND partner_id = ?').get(req.params.id, req.user.partnerId); if (!o) return res.status(404).json({ error: 'Order not found' });
  const st = String((req.body || {}).status || ''); if (!FLOW.includes(st)) return res.status(400).json({ error: 'Unknown status' });
  if (o.status === 'completed' || o.status === 'cancelled') return res.status(400).json({ error: 'This order is already closed' });
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(st, o.id); db.prepare('INSERT INTO order_status_log (order_id, status) VALUES (?, ?)').run(o.id, st); res.json({ ok: true });
});
router.get('/partner/invoices', requirePartner, noStore, (req, res) => res.json({ invoices: db.prepare('SELECT * FROM mk_invoices WHERE partner_id = ? ORDER BY id DESC').all(req.user.partnerId).map(invoiceOut) }));

// ---------- fee engine ----------
// Per line: percent from a category rule, else the partner's tier rule, else the default rule. Flat default rules add once per order.
function feeFor(partner, orderId) {
  const rules = db.prepare('SELECT * FROM mk_fee_rules WHERE active = 1').all();
  const pct = (scope, key) => { const r = rules.find(x => x.scope === scope && x.kind === 'percent' && String(x.key) === String(key)); return r ? r.value : null; };
  const def = pct('default', ''), tier = pct('tier', partner.tier);
  const lines = db.prepare('SELECT oi.line_total AS t, pr.cat AS cat FROM order_items oi LEFT JOIN products pr ON pr.id = oi.product_id WHERE oi.order_id = ?').all(orderId);
  let fee = 0, base = 0;
  for (const l of lines) { base += l.t; const c = pct('category', l.cat); const p = c != null ? c : (tier != null ? tier : (def != null ? def : 0)); fee += l.t * p / 100; }
  fee += rules.filter(r => r.scope === 'default' && r.kind === 'flat').reduce((s, r) => s + r.value, 0);
  return { base, fee: Math.round(fee) };
}
function generateInvoices(partnerId) {
  const S = settings(), partners = db.prepare('SELECT * FROM mk_partners' + (partnerId ? ' WHERE id = ?' : '')).all(...(partnerId ? [partnerId] : []));
  const made = [];
  for (const p of partners) {
    const orders = db.prepare("SELECT id, DATE(created_at) AS d FROM orders WHERE partner_id = ? AND status = 'completed' AND id NOT IN (SELECT order_id FROM mk_order_fees) ORDER BY id").all(p.id);
    const first = !db.prepare('SELECT 1 FROM mk_invoices WHERE partner_id = ?').get(p.id);
    if (!orders.length) continue;
    const extra = S.perInvoiceFee + (first ? S.joiningFee : 0);
    db.transaction(() => {
      let gross = 0, fee = 0; const calc = orders.map(o => Object.assign({ id: o.id }, feeFor(p, o.id)));
      calc.forEach(c => { gross += c.base; fee += c.fee; });
      const r = db.prepare('INSERT INTO mk_invoices (partner_id, period_start, period_end, orders_count, gross, fee, extra, total, due_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(p.id, orders[0].d, today(), orders.length, gross, fee, extra, fee + extra, addDays(today(), S.graceDays));
      const ins = db.prepare('INSERT INTO mk_order_fees (order_id, partner_id, base, fee, invoice_id) VALUES (?, ?, ?, ?, ?)'); calc.forEach(c => ins.run(c.id, p.id, c.base, c.fee, r.lastInsertRowid));
      made.push(r.lastInsertRowid);
    })();
  }
  return made;
}
// Unpaid invoices more than suspendAfterDays past due suspend the partner (it can be lifted by the admin).
function enforce() {
  const S = settings(), cutoff = addDays(today(), -S.suspendAfterDays), out = [];
  db.prepare("SELECT DISTINCT p.id FROM mk_invoices i JOIN mk_partners p ON p.id = i.partner_id WHERE i.status = 'unpaid' AND i.due_date < ? AND p.status IN ('pilot','live')").all(cutoff).forEach(r => {
    db.prepare("UPDATE mk_partners SET status = 'suspended', admin_note = TRIM(admin_note || ' Auto-suspended: invoice unpaid ' || ? || ' days past due.') WHERE id = ?").run(S.suspendAfterDays, r.id); out.push(r.id);
  });
  return out;
}

// ---------- admin ----------
const adminP = p => Object.assign(pub(p), { owner: p.owner, phone: p.phone, email: p.email, status: p.status, paused: !!p.paused, licenceNo: p.licence_no, licenceExpiry: p.licence_expiry, healthCertNo: p.health_cert_no, payMethod: p.pay_method, payAccount: p.pay_account, adminNote: p.admin_note, createdAt: p.created_at });
router.get('/admin/overview', requireAdmin, noStore, (req, res) => {
  const c = db.prepare('SELECT status, COUNT(*) AS n FROM mk_partners GROUP BY status').all(), inv = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS s FROM mk_invoices WHERE status = 'unpaid'").get();
  res.json({ enabled: isOn(), partners: c, unpaid: inv, overdue: db.prepare("SELECT COUNT(*) AS n FROM mk_invoices WHERE status = 'unpaid' AND due_date < ?").get(today()).n });
});
router.get('/admin/settings', requireAdmin, noStore, (req, res) => res.json({ enabled: isOn(), settings: settings() }));
router.put('/admin/settings', requireAdmin, (req, res) => {
  const b = req.body || {}, cur = settings(), nx = {};
  for (const k of Object.keys(DEF)) nx[k] = b.settings && b.settings[k] !== undefined ? Math.max(0, Number(b.settings[k]) || 0) : cur[k];
  db.metaSet('mk_settings', JSON.stringify(nx)); if (b.enabled !== undefined) setOn(b.enabled); res.json({ enabled: isOn(), settings: settings() });
});
router.get('/admin/partners', requireAdmin, noStore, (req, res) => {
  const st = clean(req.query.status, 20); const rows = db.prepare('SELECT * FROM mk_partners ' + (st ? 'WHERE status = ? ' : '') + 'ORDER BY id DESC LIMIT 500').all(...(st ? [st] : []));
  res.json({ partners: rows.map(p => Object.assign(adminP(p), { items: db.prepare('SELECT COUNT(*) AS n FROM mk_partner_items WHERE partner_id = ?').get(p.id).n, unpaid: db.prepare("SELECT COALESCE(SUM(total),0) AS s FROM mk_invoices WHERE partner_id = ? AND status = 'unpaid'").get(p.id).s })) });
});
router.get('/admin/partners/:id(\\d+)', requireAdmin, noStore, (req, res) => {
  const p = db.prepare('SELECT * FROM mk_partners WHERE id = ?').get(req.params.id); if (!p) return res.status(404).json({ error: 'Not found' });
  const items = itemsOf(p, false);
  res.json({ partner: adminP(p), items, farItems: items.filter(i => i.farFromRecommended), audits: db.prepare('SELECT * FROM mk_audits WHERE partner_id = ? ORDER BY id DESC').all(p.id), invoices: db.prepare('SELECT * FROM mk_invoices WHERE partner_id = ? ORDER BY id DESC').all(p.id).map(invoiceOut) });
});
const STATUS = ['applied', 'pilot', 'live', 'suspended', 'delisted', 'rejected'], TIERS = ['associate', 'partner', 'premium'];
router.patch('/admin/partners/:id(\\d+)', requireAdmin, (req, res) => {
  const p = db.prepare('SELECT * FROM mk_partners WHERE id = ?').get(req.params.id); if (!p) return res.status(404).json({ error: 'Not found' }); const b = req.body || {};
  if (b.status !== undefined && !STATUS.includes(b.status)) return res.status(400).json({ error: 'Unknown status' });
  if (b.tier !== undefined && !TIERS.includes(b.tier)) return res.status(400).json({ error: 'Unknown tier' });
  if (b.newPassword !== undefined && String(b.newPassword).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  db.prepare("UPDATE mk_partners SET status = ?, tier = ?, paused = ?, licence_verified = ?, delivery_mode = ?, admin_note = ?, password_hash = ? WHERE id = ?").run(
    b.status === undefined ? p.status : b.status, b.tier === undefined ? p.tier : b.tier, b.paused === undefined ? p.paused : (b.paused ? 1 : 0), b.licenceVerified === undefined ? p.licence_verified : (b.licenceVerified ? 1 : 0),
    DMODES.includes(b.deliveryMode) ? b.deliveryMode : p.delivery_mode, b.adminNote === undefined ? p.admin_note : clean(b.adminNote, 500), b.newPassword ? bcrypt.hashSync(String(b.newPassword), 10) : p.password_hash, p.id);
  res.json({ ok: true });
});
router.post('/admin/partners/:id(\\d+)/audit', requireAdmin, (req, res) => {
  const p = db.prepare('SELECT * FROM mk_partners WHERE id = ?').get(req.params.id); if (!p) return res.status(404).json({ error: 'Not found' }); const b = req.body || {};
  const score = Math.round(Number(b.score)); if (!Number.isFinite(score) || score < 0 || score > 100) return res.status(400).json({ error: 'Score must be 0 to 100' });
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? b.date : today();
  db.prepare('INSERT INTO mk_audits (partner_id, score, notes, audit_date) VALUES (?, ?, ?, ?)').run(p.id, score, clean(b.notes, 500), d);
  db.prepare('UPDATE mk_partners SET hygiene_score = ?, last_inspection = ? WHERE id = ?').run(score, d, p.id); res.json({ ok: true });
});
router.get('/admin/fees', requireAdmin, noStore, (req, res) => res.json({ rules: db.prepare('SELECT * FROM mk_fee_rules ORDER BY id').all().map(r => ({ id: r.id, scope: r.scope, key: r.key, kind: r.kind, value: r.value, active: !!r.active })), settings: settings() }));
router.put('/admin/fees', requireAdmin, (req, res) => {
  const rules = Array.isArray((req.body || {}).rules) ? req.body.rules.slice(0, 100) : null; if (!rules) return res.status(400).json({ error: 'rules array required' });
  for (const r of rules) { if (!['default', 'category', 'tier'].includes(r.scope) || !['percent', 'flat'].includes(r.kind) || !(Number(r.value) >= 0) || (r.kind === 'percent' && Number(r.value) > 100)) return res.status(400).json({ error: 'Each rule needs a scope, a kind and a value (percent 0 to 100)' }); }
  db.transaction(() => { db.prepare('DELETE FROM mk_fee_rules').run(); const ins = db.prepare('INSERT INTO mk_fee_rules (scope, key, kind, value, active) VALUES (?, ?, ?, ?, ?)'); rules.forEach(r => ins.run(r.scope, clean(r.key, 60), r.kind, Number(r.value), r.active === false ? 0 : 1)); })();
  res.json({ ok: true });
});
router.get('/admin/invoices', requireAdmin, noStore, (req, res) => {
  const st = clean(req.query.status, 10);
  res.json({ invoices: db.prepare('SELECT i.*, p.name AS partner_name FROM mk_invoices i JOIN mk_partners p ON p.id = i.partner_id ' + (st ? 'WHERE i.status = ? ' : '') + 'ORDER BY i.id DESC LIMIT 500').all(...(st ? [st] : [])).map(i => Object.assign(invoiceOut(i), { partner: i.partner_name, partnerId: i.partner_id })) });
});
router.post('/admin/invoices/generate', requireAdmin, (req, res) => res.json({ ok: true, created: generateInvoices(parseInt((req.body || {}).partnerId, 10) || null) }));
router.post('/admin/enforce', requireAdmin, (req, res) => res.json({ ok: true, suspended: enforce() }));
router.patch('/admin/invoices/:id(\\d+)', requireAdmin, (req, res) => {
  const i = db.prepare('SELECT * FROM mk_invoices WHERE id = ?').get(req.params.id); if (!i) return res.status(404).json({ error: 'Not found' }); const b = req.body || {};
  if (!['unpaid', 'paid', 'void'].includes(b.status)) return res.status(400).json({ error: 'Unknown status' });
  db.prepare("UPDATE mk_invoices SET status = ?, reference = ?, paid_at = ? WHERE id = ?").run(b.status, b.reference === undefined ? i.reference : clean(b.reference, 60), b.status === 'paid' ? today() : null, i.id);
  if (b.status === 'void') db.prepare('DELETE FROM mk_order_fees WHERE invoice_id = ?').run(i.id); // voided orders can be invoiced again
  res.json({ ok: true });
});
router.get('/admin/catalog', requireAdmin, noStore, (req, res) => res.json({ items: db.prepare('SELECT pr.id, pr.name, pr.cat, pr.category_group AS grp, pr.unit, pr.price, COALESCE(c.sw_name, \'\') AS swName, COALESCE(c.cut_family, \'\') AS cutFamily, COALESCE(c.retired, 0) AS retired, (SELECT COUNT(*) FROM mk_partner_items x WHERE x.product_id = pr.id) AS sellers FROM products pr LEFT JOIN mk_catalog c ON c.product_id = pr.id ORDER BY pr.category_group, pr.cat, pr.name').all() }));
router.put('/admin/catalog/:id', requireAdmin, (req, res) => {
  const id = String(req.params.id), b = req.body || {}; if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(id)) return res.status(404).json({ error: 'Product not found' });
  const c = db.prepare('SELECT * FROM mk_catalog WHERE product_id = ?').get(id) || { sw_name: '', cut_family: '', retired: 0 };
  db.prepare('INSERT INTO mk_catalog (product_id, sw_name, cut_family, retired) VALUES (?, ?, ?, ?) ON CONFLICT(product_id) DO UPDATE SET sw_name = excluded.sw_name, cut_family = excluded.cut_family, retired = excluded.retired').run(id,
    b.swName === undefined ? c.sw_name : clean(b.swName, 80), b.cutFamily === undefined ? c.cut_family : clean(b.cutFamily, 60), b.retired === undefined ? c.retired : (b.retired ? 1 : 0)); res.json({ ok: true });
});

// Used by orders.js
router.priceOrder = function (partnerId, items) {
  const p = db.prepare(`SELECT * FROM mk_partners WHERE id = ? AND ${LIVE}`).get(partnerId);
  if (!p || !isOn()) return { error: 'This butchery is not taking orders right now' };
  let subtotal = 0; const lines = [];
  for (const it of items) {
    const r = db.prepare('SELECT pi.price AS pprice, pi.in_stock AS pstock, pr.price, pr.name, pr.unit, pr.in_stock AS gstock, COALESCE(c.retired, 0) AS retired FROM mk_partner_items pi JOIN products pr ON pr.id = pi.product_id LEFT JOIN mk_catalog c ON c.product_id = pr.id WHERE pi.partner_id = ? AND pi.product_id = ?').get(p.id, String(it.id || ''));
    if (!r || !r.pstock || r.gstock === 0 || r.retired) return { error: (r ? r.name : 'An item') + ' is not available from this butchery right now' };
    const price = r.pprice || r.price; it.price = price; it.name = r.name; it.unit = r.unit; subtotal += Math.round(price * it.qty);
  }
  if (subtotal < p.min_order) return { error: 'This butchery\'s minimum order is KSh ' + p.min_order };
  return { partner: p, subtotal };
};
module.exports = router;
