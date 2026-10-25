const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();
const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
const last9 = s => String(s || '').replace(/\D/g, '').slice(-9);
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const DIR = path.join(__dirname, '..', 'uploads', 'reviews');

// Throttle submissions per visitor (5 per hour).
const hits = new Map();
function limiter(req, res, next) {
  const v = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || 'unknown', now = Date.now();
  const recent = (hits.get(v) || []).filter(t => now - t < 3600000);
  if (recent.length >= 5) return res.status(429).json({ error: 'Too many attempts - please try again later' });
  recent.push(now); hits.set(v, recent); next();
}

const shortName = n => { const p = clean(n, 60).split(/\s+/).filter(Boolean); return p.length ? (p[0] + (p[1] ? ' ' + p[1][0] + '.' : '')) : 'Customer'; };
const pub = r => ({ id: r.id, name: r.name || 'Customer', rating: r.rating, comment: r.comment || '', photo: r.photo || '', branch: r.branch || '', reply: r.reply || '', date: r.created_at });

// Public: approved reviews plus the average.
router.get('/', noStore, (req, res) => {
  const rows = db.prepare("SELECT * FROM reviews WHERE status = 'approved' ORDER BY id DESC LIMIT 60").all();
  const agg = db.prepare("SELECT COUNT(*) AS n, AVG(rating) AS avg FROM reviews WHERE status = 'approved'").get();
  res.json({ count: agg.n, average: agg.n ? Math.round(agg.avg * 10) / 10 : 0, reviews: rows.map(pub) });
});

// Customer: order number + the phone used on the order, completed orders only, one review each.
router.post('/', limiter, (req, res) => {
  const b = req.body || {};
  const id = Number(b.orderId), rating = Number(b.rating);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Enter your order number' });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Choose 1 to 5 stars' });
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order || last9(order.customer_phone) !== last9(b.phone) || last9(b.phone).length < 9) return res.status(404).json({ error: 'We could not match that order number and phone number' });
  if (order.status !== 'completed') return res.status(400).json({ error: 'You can review an order once it has been completed' });
  if (db.prepare('SELECT 1 FROM reviews WHERE order_id = ?').get(id)) return res.status(409).json({ error: 'This order already has a review - thank you!' });

  let photo = '';
  if (b.photo) {
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.photo));
    if (!m) return res.status(400).json({ error: 'Photo must be a JPG, PNG or WebP image' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 900 * 1024) return res.status(400).json({ error: 'Photo is too large (max 900 KB)' });
    const ok = (m[1] === 'jpeg' && buf[0] === 0xFF && buf[1] === 0xD8) || (m[1] === 'png' && buf.slice(1, 4).toString() === 'PNG') || (m[1] === 'webp' && buf.slice(0, 4).toString() === 'RIFF');
    if (!ok) return res.status(400).json({ error: 'That file is not a valid image' });
    fs.mkdirSync(DIR, { recursive: true });
    const file = `rev-${id}-${Date.now()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
    fs.writeFileSync(path.join(DIR, file), buf);
    photo = '/uploads/reviews/' + file;
  }
  db.prepare('INSERT INTO reviews (order_id, name, rating, comment, photo, branch, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, shortName(b.name || order.customer_name), rating, clean(b.comment, 600), photo, order.branch || '', 'pending');
  res.status(201).json({ ok: true, message: 'Thank you! Your review will appear once we have checked it.' });
});

// Admin moderation.
router.get('/all', requireAdmin, noStore, (req, res) => {
  const rows = db.prepare('SELECT r.*, o.customer_phone, o.total FROM reviews r LEFT JOIN orders o ON o.id = r.order_id ORDER BY r.id DESC LIMIT 300').all();
  res.json({ reviews: rows.map(r => Object.assign(pub(r), { orderId: r.order_id, status: r.status, phone: r.customer_phone || '', total: r.total || 0 })) });
});
router.patch('/:id', requireAdmin, (req, res) => {
  const r = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Review not found' });
  const b = req.body || {};
  const status = b.status === undefined ? r.status : String(b.status);
  if (!['pending', 'approved', 'hidden'].includes(status)) return res.status(400).json({ error: 'Status must be pending, approved or hidden' });
  const reply = b.reply === undefined ? r.reply : clean(b.reply, 400);
  db.prepare('UPDATE reviews SET status = ?, reply = ? WHERE id = ?').run(status, reply, r.id);
  res.json({ ok: true });
});
router.delete('/:id', requireAdmin, (req, res) => {
  const r = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Review not found' });
  if (r.photo) { try { fs.unlinkSync(path.join(DIR, path.basename(r.photo))); } catch (e) {} }
  db.prepare('DELETE FROM reviews WHERE id = ?').run(r.id);
  res.json({ ok: true });
});
module.exports = router;
