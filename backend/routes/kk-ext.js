// Azizo Kitchens v3.1 extension: riders, reassignment, supply, scorecard, alerts, dashboard, economics, promos, corporate accounts, outbox, exports, audit, health.
const fs = require('fs'), os = require('os'), path = require('path');
module.exports = function (router, admin, C) {
  const { db, clean, last9, jparse, slugify, settings, nowEAT, addDays, roadKm, live, rating, statement, kPub, candidates, reassign, notify, bcrypt, limiter, noStore, requireKitchen, requireRider, signRiderToken, expireUnpaid, lastOrderFull, dishFull } = C;
  const ms = t => t ? Date.parse(String(t).replace(' ', 'T') + 'Z') : NaN;
  const mins = (a, b) => (ms(b) - ms(a)) / 60000;
  const csv = rows => rows.map(r => r.map(v => { const x = String(v == null ? '' : v); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; }).join(',')).join('\r\n');
  const sendCsv = (res, name, rows) => { res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` }); res.send('﻿' + csv(rows)); };
  const int = (v, d, lo, hi) => Math.max(lo, Math.min(hi, parseInt(v, 10) || d));

  // ---------- health ----------
  router.get('/health', noStore, (req, res) => {
    let dbOk = false, counts = {}; try { counts = { kitchens: db.prepare('SELECT COUNT(*) AS n FROM kk_kitchens').get().n, liveKitchens: db.prepare(`SELECT COUNT(*) AS n FROM kk_kitchens WHERE ${live()}`).get().n, openOrders: db.prepare("SELECT COUNT(*) AS n FROM kk_orders WHERE status NOT IN ('delivered','cancelled','rejected')").get().n }; dbOk = true; } catch (e) { /* db down */ }
    res.status(dbOk ? 200 : 503).json({ ok: dbOk, time: new Date().toISOString(), counts, mpesa: C.mpesa.isConfigured(), whatsapp: notify.configured(), adminPasswordSet: !!process.env.KITCHENS_ADMIN_PASSWORD });
  });

  // ---------- scorecard (last 30 days) ----------
  function scorecard(kid, days) {
    const S = settings(), rows = db.prepare(`SELECT * FROM kk_orders WHERE kitchen_id = ? AND created_at >= datetime('now', ?) AND NOT (reason = 'Payment not completed')`).all(kid, `-${days || 30} days`);
    const total = rows.length, rejected = rows.filter(o => o.status === 'rejected').length, accepted = rows.filter(o => o.accepted_at).length, delivered = rows.filter(o => o.status === 'delivered').length;
    const acc = rows.filter(o => o.accepted_at), avgAccept = acc.length ? acc.reduce((s, o) => s + mins(o.created_at, o.accepted_at), 0) / acc.length : null, fast = acc.length ? acc.filter(o => mins(o.created_at, o.accepted_at) <= 15).length / acc.length : null;
    const rdy = rows.filter(o => o.ready_at), onTime = rdy.length ? rdy.filter(o => { const t = new Date(ms(o.ready_at) + 3 * 3600000); const m = t.getUTCHours() * 60 + t.getUTCMinutes(), w = S[o.meal] ? S[o.meal].from.split(':') : ['12', '0']; return m <= (+w[0]) * 60 + (+w[1]) && t.toISOString().slice(0, 10) <= o.date; }).length / rdy.length : null;
    const rated = rows.filter(o => o.rating > 0), avgRating = rated.length ? rated.reduce((s, o) => s + o.rating, 0) / rated.length : null, low = rated.filter(o => o.rating <= 2).length;
    const accRate = accepted + rejected ? accepted / (accepted + rejected) : null;
    let score = null, note = 'Not enough orders yet (needs 3).';
    if (total >= 3) { score = Math.round(30 * (accRate == null ? 1 : accRate) + 20 * (fast == null ? 1 : fast) + 30 * (onTime == null ? 1 : onTime) + 20 * (avgRating == null ? 0.8 : avgRating / 5)); note = score >= 80 ? 'Good standing.' : score >= 60 ? 'Needs attention: coach the cook on speed and timing.' : 'Below standard: consider a strike and a coaching call.'; }
    const r1 = x => x == null ? null : Math.round(x * 10) / 10;
    return { days: days || 30, orders: total, delivered, rejected, acceptRate: accRate == null ? null : Math.round(accRate * 100), avgAcceptMin: r1(avgAccept), fastAcceptPct: fast == null ? null : Math.round(fast * 100), onTimePct: onTime == null ? null : Math.round(onTime * 100), avgRating: r1(avgRating), lowRatings: low, score, note };
  }
  function docAlerts(kid) {
    const out = [], today = nowEAT().date, soon = addDays(today, 30);
    for (const k of db.prepare(`SELECT id, name, docs, status FROM kk_kitchens WHERE status NOT IN ('delisted','rejected')${kid ? ' AND id = ' + Number(kid) : ''}`).all()) for (const d of jparse(k.docs, [])) {
      if (!d.expiry || !/^\d{4}-\d{2}-\d{2}$/.test(d.expiry)) continue;
      if (d.expiry < today) out.push({ kitchenId: k.id, kitchen: k.name, type: d.type, expiry: d.expiry, level: 'expired' }); else if (d.expiry <= soon) out.push({ kitchenId: k.id, kitchen: k.name, type: d.type, expiry: d.expiry, level: 'soon' });
    }
    return out;
  }
  router.get('/partner/insights', requireKitchen, noStore, (req, res) => res.json({ scorecard: scorecard(req.user.kitchenId), docAlerts: docAlerts(req.user.kitchenId) }));
  admin.get('/kitchens/:id(\\d+)/scorecard', (req, res) => res.json(scorecard(Number(req.params.id))));

  // ---------- alerts ----------
  admin.get('/alerts', (req, res) => {
    expireUnpaid(); const S = settings();
    const stale = db.prepare("SELECT o.id, o.date, o.meal, o.created_at, k.name AS kitchen FROM kk_orders o JOIN kk_kitchens k ON k.id = o.kitchen_id WHERE o.status = 'new' AND NOT (o.payment = 'mpesa_now' AND o.paid = 0) AND o.created_at < datetime('now', '-15 minutes')").all();
    const waiting = db.prepare("SELECT o.id, o.date, o.meal, o.ready_at, k.name AS kitchen FROM kk_orders o JOIN kk_kitchens k ON k.id = o.kitchen_id WHERE o.status = 'ready' AND o.ready_at < datetime('now', '-30 minutes')").all();
    const lowScore = db.prepare(`SELECT id, name FROM kk_kitchens WHERE ${live()}`).all().map(k => Object.assign({ id: k.id, name: k.name }, scorecard(k.id))).filter(x => x.score != null && x.score < 60).map(x => ({ id: x.id, name: x.name, score: x.score }));
    res.json({ unaccepted: stale, readyWaiting: waiting, docs: docAlerts(), lowScore, outbox: db.prepare("SELECT COUNT(*) AS n FROM kk_outbox WHERE status = 'pending'").get().n, supply: db.prepare("SELECT COUNT(*) AS n FROM kk_supply WHERE status = 'requested'").get().n, applications: db.prepare("SELECT COUNT(*) AS n FROM kk_kitchens WHERE status = 'applied'").get().n });
  });

  // ---------- reassignment ----------
  admin.get('/orders/:id(\\d+)/candidates', (req, res) => {
    const o = lastOrderFull(Number(req.params.id)); if (!o) return res.status(404).json({ error: 'Not found' });
    res.json({ candidates: candidates(o, settings()).map(c => ({ id: c.kitchen.id, name: c.kitchen.name, km: c.km, left: c.left })) });
  });
  admin.post('/orders/:id(\\d+)/reassign', (req, res) => {
    const o = lastOrderFull(Number(req.params.id)); if (!o) return res.status(404).json({ error: 'Not found' });
    if (!['new', 'accepted', 'preparing', 'rejected'].includes(o.status)) return res.status(400).json({ error: 'Only an order the kitchen has not finished can be moved' });
    const S = settings(), c = candidates(o, S).find(x => x.kitchen.id === Number((req.body || {}).kitchenId)); if (!c) return res.status(400).json({ error: 'That kitchen cannot take this order (distance, dishes or capacity)' });
    reassign(o, c.kitchen, S); res.json({ ok: true });
  });

  // ---------- riders ----------
  const riderOut = r => ({ id: r.id, name: r.name, phone: r.phone, active: !!r.active, openOrders: db.prepare("SELECT COUNT(*) AS n FROM kk_orders WHERE rider_id = ? AND status = 'out_for_delivery'").get(r.id).n, delivered: db.prepare("SELECT COUNT(*) AS n FROM kk_orders WHERE rider_id = ? AND status = 'delivered'").get(r.id).n });
  admin.get('/riders', (req, res) => res.json({ riders: db.prepare('SELECT * FROM kk_riders ORDER BY name').all().map(riderOut) }));
  admin.post('/riders', (req, res) => {
    const b = req.body || {}, name = clean(b.name, 60), phone = clean(b.phone, 20), pin = String(b.pin || '');
    if (name.length < 2 || last9(phone).length < 9) return res.status(400).json({ error: 'Enter the rider\'s name and phone' }); if (!/^\d{4,6}$/.test(pin)) return res.status(400).json({ error: 'PIN must be 4 to 6 digits' });
    if (db.prepare("SELECT 1 FROM kk_riders WHERE substr(replace(phone, ' ', ''), -9) = ?").get(last9(phone))) return res.status(409).json({ error: 'A rider with this phone already exists' });
    const r = db.prepare('INSERT INTO kk_riders (name, phone, pin_hash) VALUES (?, ?, ?)').run(name, phone, bcrypt.hashSync(pin, 10)); res.status(201).json({ ok: true, id: r.lastInsertRowid });
  });
  admin.patch('/riders/:id(\\d+)', (req, res) => {
    const r = db.prepare('SELECT * FROM kk_riders WHERE id = ?').get(req.params.id), b = req.body || {}; if (!r) return res.status(404).json({ error: 'Not found' });
    if (b.pin !== undefined && !/^\d{4,6}$/.test(String(b.pin))) return res.status(400).json({ error: 'PIN must be 4 to 6 digits' });
    db.prepare('UPDATE kk_riders SET name = ?, phone = ?, active = ?, pin_hash = ? WHERE id = ?').run(b.name === undefined ? r.name : clean(b.name, 60), b.phone === undefined ? r.phone : clean(b.phone, 20), b.active === undefined ? r.active : (b.active ? 1 : 0), b.pin === undefined ? r.pin_hash : bcrypt.hashSync(String(b.pin), 10), r.id); res.json({ ok: true });
  });
  admin.post('/orders/:id(\\d+)/assign', (req, res) => {
    const o = lastOrderFull(Number(req.params.id)), r = db.prepare('SELECT id FROM kk_riders WHERE id = ? AND active = 1').get(Number((req.body || {}).riderId));
    if (!o) return res.status(404).json({ error: 'Not found' }); if (!r) return res.status(400).json({ error: 'Choose an active rider' }); if (['delivered', 'cancelled', 'rejected'].includes(o.status)) return res.status(400).json({ error: 'This order is closed' });
    db.prepare("UPDATE kk_orders SET rider_id = ?, updated_at = datetime('now') WHERE id = ?").run(r.id, o.id); res.json({ ok: true });
  });
  router.post('/rider/login', limiter(30, 'rlog'), (req, res) => {
    const b = req.body || {}, r = db.prepare("SELECT * FROM kk_riders WHERE substr(replace(phone, ' ', ''), -9) = ? AND active = 1").get(last9(b.phone));
    if (!r || !bcrypt.compareSync(String(b.pin || ''), r.pin_hash)) return res.status(401).json({ error: 'Incorrect phone or PIN' }); res.json({ token: signRiderToken(r), name: r.name });
  });
  const riderOrder = o => { const k = db.prepare('SELECT name, address, phone, lat, lng FROM kk_kitchens WHERE id = ?').get(o.kitchen_id) || {}; return {
    id: o.id, status: o.status, date: o.date, meal: o.meal, mine: !!o.rider_id, kitchen: k.name, kitchenAddress: k.address, kitchenPhone: k.phone, kitchenLat: k.lat, kitchenLng: k.lng, customer: o.name, phone: o.phone, address: o.address, lat: o.lat, lng: o.lng, notes: o.notes,
    items: db.prepare('SELECT name, qty FROM kk_order_items WHERE order_id = ?').all(o.id).map(i => i.qty + ' x ' + i.name), total: o.total, payment: o.payment, collect: (o.paid || o.payment === 'invoice') ? 0 : o.total }; };
  router.get('/rider/orders', requireRider, noStore, (req, res) => {
    expireUnpaid(); const id = req.user.riderId, today = nowEAT().date;
    const rows = db.prepare("SELECT * FROM kk_orders WHERE (rider_id = ? AND status IN ('ready','out_for_delivery')) OR (status = 'ready' AND rider_id IS NULL) OR (status IN ('accepted','preparing') AND date = ?) ORDER BY date, meal, id").all(id, today).filter(o => !(o.payment === 'mpesa_now' && !o.paid));
    res.json({ orders: rows.map(riderOrder) });
  });
  router.post('/rider/orders/:id(\\d+)/pickup', requireRider, (req, res) => {
    const o = lastOrderFull(Number(req.params.id)); if (!o || o.status !== 'ready' || (o.rider_id && o.rider_id !== req.user.riderId)) return res.status(400).json({ error: 'This order is not available to pick up' });
    db.prepare("UPDATE kk_orders SET rider_id = ?, status = 'out_for_delivery', picked_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(req.user.riderId, o.id);
    notify.queue('out_for_delivery', lastOrderFull(o.id), { rider: (db.prepare('SELECT name FROM kk_riders WHERE id = ?').get(req.user.riderId) || {}).name }); res.json({ ok: true });
  });
  router.post('/rider/orders/:id(\\d+)/deliver', requireRider, (req, res) => {
    const o = lastOrderFull(Number(req.params.id)); if (!o || o.status !== 'out_for_delivery' || o.rider_id !== req.user.riderId) return res.status(400).json({ error: 'This order is not on your delivery list' });
    if (String((req.body || {}).code || '').trim() !== String(o.delivery_code)) return res.status(400).json({ error: 'Wrong code. Ask the customer for the 4-digit code from their order message.' });
    db.prepare("UPDATE kk_orders SET status = 'delivered', delivered_at = datetime('now'), paid = CASE WHEN payment IN ('cash','mpesa','mpesa_now') THEN 1 ELSE paid END, updated_at = datetime('now') WHERE id = ?").run(o.id);
    notify.queue('delivered', lastOrderFull(o.id)); res.json({ ok: true });
  });
  router.post('/rider/orders/:id(\\d+)/release', requireRider, (req, res) => {
    const o = lastOrderFull(Number(req.params.id)); if (!o || o.status !== 'out_for_delivery' || o.rider_id !== req.user.riderId) return res.status(400).json({ error: 'This order is not on your delivery list' });
    db.prepare("UPDATE kk_orders SET status = 'ready', rider_id = NULL, picked_at = NULL, notes = substr(notes || ' | Rider released: ' || ?, 1, 300), updated_at = datetime('now') WHERE id = ?").run(clean((req.body || {}).reason, 100) || 'no reason given', o.id); res.json({ ok: true });
  });

  // ---------- meat supply (cooks buy meat from Azizo) ----------
  router.get('/partner/supply', requireKitchen, noStore, (req, res) => {
    res.json({ products: db.prepare('SELECT id, name, price, unit, cat FROM products WHERE in_stock = 1 ORDER BY cat, name LIMIT 300').all(),
      requests: db.prepare('SELECT * FROM kk_supply WHERE kitchen_id = ? ORDER BY id DESC LIMIT 30').all(req.user.kitchenId).map(r => ({ id: r.id, items: jparse(r.items, []), note: r.note, total: r.total, status: r.status, created: r.created_at })) });
  });
  router.post('/partner/supply', requireKitchen, (req, res) => {
    const b = req.body || {}, items = []; let total = 0;
    for (const it of (Array.isArray(b.items) ? b.items.slice(0, 20) : [])) { const p = db.prepare('SELECT id, name, price, unit FROM products WHERE id = ?').get(String(it.productId)); const q = Math.round(Number(it.qty) * 10) / 10; if (!p || !(q > 0 && q <= 200)) continue; items.push({ name: p.name, qty: q, unit: p.unit, price: p.price }); total += Math.round(p.price * q); }
    if (!items.length) return res.status(400).json({ error: 'Choose at least one item and a quantity' });
    db.prepare('INSERT INTO kk_supply (kitchen_id, items, note, total) VALUES (?, ?, ?, ?)').run(req.user.kitchenId, JSON.stringify(items), clean(b.note, 200), total); res.status(201).json({ ok: true, estimate: total });
  });
  admin.get('/supply', (req, res) => res.json({ requests: db.prepare('SELECT s.*, k.name AS kitchen, k.phone FROM kk_supply s JOIN kk_kitchens k ON k.id = s.kitchen_id ' + (req.query.status ? 'WHERE s.status = ? ' : '') + 'ORDER BY s.id DESC LIMIT 200').all(...(req.query.status ? [req.query.status] : [])).map(r => ({ id: r.id, kitchen: r.kitchen, phone: r.phone, items: jparse(r.items, []), note: r.note, total: r.total, status: r.status, created: r.created_at })) }));
  admin.patch('/supply/:id(\\d+)', (req, res) => {
    const r = db.prepare('SELECT * FROM kk_supply WHERE id = ?').get(req.params.id), b = req.body || {}; if (!r) return res.status(404).json({ error: 'Not found' });
    if (!['requested', 'supplied', 'cancelled'].includes(b.status)) return res.status(400).json({ error: 'Unknown status' }); const total = b.total === undefined ? r.total : int(b.total, 0, 0, 1000000);
    db.prepare("UPDATE kk_supply SET status = ?, total = ?, updated_at = datetime('now') WHERE id = ?").run(b.status, total, r.id); res.json({ ok: true });
  });

  // ---------- promos ----------
  admin.get('/promos', (req, res) => res.json({ promos: db.prepare('SELECT * FROM kk_promos ORDER BY id DESC').all().map(p => ({ id: p.id, code: p.code, kind: p.kind, value: p.value, minOrder: p.min_order, maxUses: p.max_uses, used: p.used, expires: p.expires, active: !!p.active, note: p.note })) }));
  const promoIn = (b, e) => { e = e || {}; const kind = ['pct', 'flat', 'freedelivery'].includes(b.kind) ? b.kind : (e.kind || 'pct'); const value = b.value === undefined ? (e.value || 0) : int(b.value, 0, 0, 100000); if (kind === 'pct' && value > 100) return { error: 'A percentage cannot be above 100' };
    return { v: { kind, value, min_order: b.minOrder === undefined ? (e.min_order || 0) : int(b.minOrder, 0, 0, 100000), max_uses: b.maxUses === undefined ? (e.max_uses || 0) : int(b.maxUses, 0, 0, 1000000), expires: b.expires === undefined ? (e.expires || '') : (/^\d{4}-\d{2}-\d{2}$/.test(b.expires) ? b.expires : ''), note: b.note === undefined ? (e.note || '') : clean(b.note, 120), active: b.active === undefined ? (e.active === undefined ? 1 : e.active) : (b.active ? 1 : 0) } }; };
  admin.post('/promos', (req, res) => {
    const code = clean((req.body || {}).code, 30).toUpperCase().replace(/[^A-Z0-9_-]/g, ''); if (code.length < 3) return res.status(400).json({ error: 'Code must be at least 3 letters or numbers' }); if (code === 'LOYALTY') return res.status(400).json({ error: 'That code is reserved' });
    if (db.prepare('SELECT 1 FROM kk_promos WHERE code = ?').get(code)) return res.status(409).json({ error: 'That code already exists' });
    const p = promoIn(req.body || {}); if (p.error) return res.status(400).json({ error: p.error }); const v = p.v;
    db.prepare('INSERT INTO kk_promos (code, kind, value, min_order, max_uses, expires, note, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(code, v.kind, v.value, v.min_order, v.max_uses, v.expires, v.note, v.active); res.status(201).json({ ok: true });
  });
  admin.put('/promos/:id(\\d+)', (req, res) => { const e = db.prepare('SELECT * FROM kk_promos WHERE id = ?').get(req.params.id); if (!e) return res.status(404).json({ error: 'Not found' }); const p = promoIn(req.body || {}, e); if (p.error) return res.status(400).json({ error: p.error }); const v = p.v;
    db.prepare('UPDATE kk_promos SET kind = ?, value = ?, min_order = ?, max_uses = ?, expires = ?, note = ?, active = ? WHERE id = ?').run(v.kind, v.value, v.min_order, v.max_uses, v.expires, v.note, v.active, e.id); res.json({ ok: true }); });
  admin.delete('/promos/:id(\\d+)', (req, res) => { const e = db.prepare('SELECT * FROM kk_promos WHERE id = ?').get(req.params.id); if (!e) return res.status(404).json({ error: 'Not found' }); if (e.used) { db.prepare('UPDATE kk_promos SET active = 0 WHERE id = ?').run(e.id); return res.json({ ok: true, deactivated: true }); } db.prepare('DELETE FROM kk_promos WHERE id = ?').run(e.id); res.json({ ok: true }); });

  // ---------- corporate accounts ----------
  const corpOut = c => ({ id: c.id, name: c.name, code: c.code, contact: c.contact, phone: c.phone, email: c.email, address: c.address, discountPct: c.discount_pct, active: !!c.active, notes: c.notes, orders: db.prepare("SELECT COUNT(*) AS n FROM kk_orders WHERE corp_id = ? AND status = 'delivered'").get(c.id).n, unpaid: db.prepare("SELECT COALESCE(SUM(total),0) AS s FROM kk_orders WHERE corp_id = ? AND status = 'delivered' AND paid = 0").get(c.id).s });
  admin.get('/corporate', (req, res) => res.json({ accounts: db.prepare('SELECT * FROM kk_corporate ORDER BY name').all().map(corpOut) }));
  admin.post('/corporate', (req, res) => {
    const b = req.body || {}, name = clean(b.name, 80); let code = clean(b.code, 30).toUpperCase().replace(/[^A-Z0-9_-]/g, ''); if (name.length < 2) return res.status(400).json({ error: 'Enter the company name' });
    if (!code) code = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) + String(10 + Math.floor(Math.random() * 89)); if (db.prepare('SELECT 1 FROM kk_corporate WHERE code = ?').get(code)) return res.status(409).json({ error: 'That code already exists' });
    const r = db.prepare('INSERT INTO kk_corporate (name, code, contact, phone, email, address, discount_pct, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(name, code, clean(b.contact, 60), clean(b.phone, 20), clean(b.email, 80), clean(b.address, 160), Math.max(0, Math.min(50, Number(b.discountPct) || 0)), clean(b.notes, 200)); res.status(201).json({ ok: true, id: r.lastInsertRowid, code });
  });
  admin.put('/corporate/:id(\\d+)', (req, res) => { const e = db.prepare('SELECT * FROM kk_corporate WHERE id = ?').get(req.params.id), b = req.body || {}; if (!e) return res.status(404).json({ error: 'Not found' });
    db.prepare('UPDATE kk_corporate SET name = ?, contact = ?, phone = ?, email = ?, address = ?, discount_pct = ?, active = ?, notes = ? WHERE id = ?').run(b.name === undefined ? e.name : clean(b.name, 80), b.contact === undefined ? e.contact : clean(b.contact, 60), b.phone === undefined ? e.phone : clean(b.phone, 20), b.email === undefined ? e.email : clean(b.email, 80), b.address === undefined ? e.address : clean(b.address, 160), b.discountPct === undefined ? e.discount_pct : Math.max(0, Math.min(50, Number(b.discountPct) || 0)), b.active === undefined ? e.active : (b.active ? 1 : 0), b.notes === undefined ? e.notes : clean(b.notes, 200), e.id); res.json({ ok: true }); });
  admin.get('/corporate/:id(\\d+)/invoice', (req, res) => {
    const c = db.prepare('SELECT * FROM kk_corporate WHERE id = ?').get(req.params.id); if (!c) return res.status(404).json({ error: 'Not found' }); const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : nowEAT().date.slice(0, 7);
    const rows = db.prepare("SELECT * FROM kk_orders WHERE corp_id = ? AND status = 'delivered' AND date LIKE ? ORDER BY date, id").all(c.id, month + '%');
    res.json({ company: corpOut(c), month, orders: rows.map(o => ({ id: o.id, date: o.date, meal: o.meal, customer: o.name, subtotal: o.subtotal, fee: o.delivery_fee, discount: o.discount, total: o.total, paid: !!o.paid })), totals: { subtotal: rows.reduce((s, o) => s + o.subtotal, 0), fee: rows.reduce((s, o) => s + o.delivery_fee, 0), discount: rows.reduce((s, o) => s + o.discount, 0), total: rows.reduce((s, o) => s + o.total, 0), unpaid: rows.filter(o => !o.paid).reduce((s, o) => s + o.total, 0) } });
  });
  admin.post('/corporate/:id(\\d+)/invoice/paid', (req, res) => { const month = clean((req.body || {}).month, 7); if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Choose a month' }); db.prepare("UPDATE kk_orders SET paid = 1 WHERE corp_id = ? AND status = 'delivered' AND date LIKE ?").run(req.params.id, month + '%'); res.json({ ok: true }); });

  // ---------- outbox (customer messages) ----------
  admin.get('/outbox', (req, res) => res.json({ whatsappApi: notify.configured(), messages: db.prepare('SELECT * FROM kk_outbox WHERE status = ? ORDER BY id DESC LIMIT 200').all(req.query.status === 'sent' ? 'sent' : 'pending') }));
  admin.post('/outbox/:id(\\d+)/sent', (req, res) => { db.prepare("UPDATE kk_outbox SET status = 'sent', sent_at = datetime('now') WHERE id = ?").run(req.params.id); res.json({ ok: true }); });
  admin.post('/outbox/:id(\\d+)/dismiss', (req, res) => { db.prepare("UPDATE kk_outbox SET status = 'dismissed' WHERE id = ?").run(req.params.id); res.json({ ok: true }); });
  admin.post('/outbox/clear', (req, res) => { db.prepare("UPDATE kk_outbox SET status = 'dismissed' WHERE status = 'pending'").run(); res.json({ ok: true }); });

  // ---------- audit ----------
  admin.get('/audit', (req, res) => res.json({ entries: db.prepare('SELECT * FROM kk_audit ORDER BY id DESC LIMIT ?').all(int(req.query.limit, 200, 1, 1000)) }));

  // ---------- dashboard ----------
  admin.get('/dashboard', (req, res) => {
    const days = int(req.query.days, 14, 1, 90), S = settings(), now = nowEAT().date, today = addDays(now, 2), from = addDays(now, -(days - 1)); // includes the next two days of pre-orders
    const base = "FROM kk_orders WHERE date >= ? AND date <= ? AND status NOT IN ('cancelled','rejected') AND NOT (payment = 'mpesa_now' AND paid = 0)";
    const byDay = []; const map = {}; db.prepare(`SELECT date, COUNT(*) AS n, COALESCE(SUM(total),0) AS gmv, COALESCE(SUM(commission_amt),0) AS comm ${base} GROUP BY date`).all(from, today).forEach(r => map[r.date] = r);
    for (let i = 0; i < days + 2; i++) { const d = addDays(from, i); byDay.push({ date: d, n: (map[d] || {}).n || 0, gmv: (map[d] || {}).gmv || 0, comm: (map[d] || {}).comm || 0 }); }
    const phones = db.prepare("SELECT substr(replace(phone, ' ', ''), -9) AS p, COUNT(*) AS n FROM kk_orders WHERE status = 'delivered' GROUP BY p").all(), repeat = phones.length ? Math.round(100 * phones.filter(x => x.n >= 2).length / phones.length) : 0;
    const topDishes = db.prepare("SELECT i.name, SUM(i.qty) AS qty, SUM(i.line_total) AS revenue FROM kk_order_items i JOIN kk_orders o ON o.id = i.order_id WHERE o.date >= ? AND o.date <= ? AND o.status NOT IN ('cancelled','rejected') GROUP BY i.name ORDER BY qty DESC LIMIT 8").all(from, today);
    const dl = db.prepare("SELECT picked_at, ready_at, delivered_at FROM kk_orders WHERE status = 'delivered' AND date >= ? AND delivered_at IS NOT NULL").all(from), avg = a => a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null;
    const doorMin = avg(dl.filter(x => x.picked_at).map(x => mins(x.picked_at, x.delivered_at))), readyToDoor = avg(dl.filter(x => x.ready_at).map(x => mins(x.ready_at, x.delivered_at)));
    const tot = db.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN status IN ('cancelled','rejected') THEN 1 ELSE 0 END) AS bad FROM kk_orders WHERE date >= ? AND date <= ? AND NOT (reason = 'Payment not completed')").get(from, today);
    const weeks = {}; db.prepare("SELECT date, rating FROM kk_orders WHERE rating > 0 AND date >= ?").all(addDays(now, -55)).forEach(o => { const d = new Date(o.date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); const k = d.toISOString().slice(0, 10); (weeks[k] = weeks[k] || []).push(o.rating); });
    const ratingTrend = Object.keys(weeks).sort().map(k => ({ week: k, avg: Math.round(10 * weeks[k].reduce((a, c) => a + c, 0) / weeks[k].length) / 10, n: weeks[k].length }));
    const demandOrders = {}; db.prepare(`SELECT region, COUNT(*) AS n ${base} AND region != '' GROUP BY region`).all(from, today).forEach(r => demandOrders[r.region] = r.n);
    const supply = {}; db.prepare(`SELECT region, COUNT(*) AS k, SUM(capacity) AS cap FROM kk_kitchens WHERE ${live()} GROUP BY region`).all().forEach(r => supply[r.region] = r);
    const regions = [...new Set([...Object.keys(demandOrders), ...Object.keys(supply)])].map(r => ({ region: r, orders: demandOrders[r] || 0, kitchens: (supply[r] || {}).k || 0, capacityPerMeal: (supply[r] || {}).cap || 0 })).sort((a, b) => b.orders - a.orders);
    const unmet = db.prepare('SELECT region, name, SUM(n) AS searches FROM kk_demand WHERE date >= ? GROUP BY area_id ORDER BY searches DESC LIMIT 10').all(from);
    res.json({ days, from, to: today, byDay, totals: { orders: byDay.reduce((s, d) => s + d.n, 0), gmv: byDay.reduce((s, d) => s + d.gmv, 0), commission: byDay.reduce((s, d) => s + d.comm, 0) }, repeatPct: repeat, topDishes, doorMin, readyToDoorMin: readyToDoor, cancelPct: tot.n ? Math.round(100 * tot.bad / tot.n) : 0, ratingTrend, regions, unmet });
  });

  // ---------- economics ----------
  admin.get('/economics', (req, res) => {
    const days = int(req.query.days, 30, 1, 365), S = settings(), now = nowEAT().date, today = addDays(now, 2), from = addDays(now, -(days - 1)), cost = S.deliveryCost || 0;
    const rows = db.prepare("SELECT o.*, k.name AS kname FROM kk_orders o JOIN kk_kitchens k ON k.id = o.kitchen_id WHERE o.status = 'delivered' AND o.date >= ? AND o.date <= ?").all(from, today);
    const agg = list => { const a = { orders: list.length, food: 0, commission: 0, fees: 0, discounts: 0 }; list.forEach(o => { a.food += o.subtotal; a.commission += o.commission_amt; a.fees += o.delivery_fee; a.discounts += o.discount; }); a.deliveryCost = a.orders * cost; a.margin = a.commission + a.fees - a.discounts - a.deliveryCost; a.marginPerOrder = a.orders ? Math.round(a.margin / a.orders) : 0; return a; };
    const by = {}; rows.forEach(o => (by[o.kname] = by[o.kname] || []).push(o));
    const dishes = db.prepare("SELECT i.name, SUM(i.qty) AS qty, SUM(i.line_total) AS revenue, ROUND(SUM(i.line_total * o.commission_pct / 100.0)) AS commission FROM kk_order_items i JOIN kk_orders o ON o.id = i.order_id WHERE o.status = 'delivered' AND o.date >= ? AND o.date <= ? GROUP BY i.name ORDER BY revenue DESC").all(from, today);
    res.json({ days, from, to: today, deliveryCostPerOrder: cost, total: agg(rows), kitchens: Object.keys(by).sort().map(n => Object.assign({ kitchen: n }, agg(by[n]))), dishes });
  });

  // ---------- exports and backups ----------
  admin.get('/export/payouts.csv', (req, res) => {
    const ks = db.prepare("SELECT * FROM kk_kitchens WHERE status != 'rejected' ORDER BY name").all().map(k => Object.assign({ k }, statement(k.id)));
    if (req.query.format === 'mpesa') return sendCsv(res, 'azizo-kitchens-mpesa-payouts.csv', [['Phone', 'Amount', 'Name']].concat(ks.filter(x => x.balance > 0).map(x => [x.k.phone, x.balance, x.k.name])));
    sendCsv(res, 'azizo-kitchens-payouts.csv', [['Kitchen', 'Phone', 'Delivered orders', 'Earned', 'Meat supplies', 'Paid', 'Balance']].concat(ks.map(x => [x.k.name, x.k.phone, x.delivered, x.earned, x.supplies, x.paid, x.balance])));
  });
  admin.get('/export/menu.csv', (req, res) => {
    const site = (process.env.SITE_URL || '').replace(/\/+$/, '');
    sendCsv(res, 'azizo-kitchens-menu.csv', [['Name', 'Description', 'Category', 'Cuisine', 'Price KES', 'Serves', 'Tags', 'Image URL', 'Options']].concat(db.prepare('SELECT * FROM kk_dishes WHERE active = 1 ORDER BY sort_order').all().map(d => [d.name, d.description, d.category, d.tradition, d.price, d.serves, d.tags, d.image ? (d.image[0] === '/' && site ? site + d.image : d.image) : '', jparse(d.options, []).map(g => g.name + ': ' + g.choices.map(c => c.name + (c.price ? ' (+' + c.price + ')' : '')).join(' / ')).join(' | ')])));
  });
  admin.get('/export/orders.csv', (req, res) => {
    const days = int(req.query.days, 30, 1, 365), from = addDays(nowEAT().date, -(days - 1));
    sendCsv(res, 'azizo-kitchens-orders.csv', [['Order', 'Date', 'Meal', 'Kitchen', 'Status', 'Customer', 'Phone', 'Food', 'Delivery', 'Discount', 'Total', 'Commission', 'Payment', 'Paid', 'Rating']].concat(db.prepare('SELECT o.*, k.name AS kname FROM kk_orders o JOIN kk_kitchens k ON k.id = o.kitchen_id WHERE o.date >= ? ORDER BY o.id').all(from).map(o => [o.id, o.date, o.meal, o.kname, o.status, o.name, o.phone, o.subtotal, o.delivery_fee, o.discount, o.total, o.commission_amt, o.payment, o.paid ? 'yes' : 'no', o.rating || ''])));
  });
  admin.get('/backup/kitchens.json', (req, res) => {
    const dump = {}; for (const t of ['kk_dishes', 'kk_kitchens', 'kk_kitchen_dishes', 'kk_orders', 'kk_order_items', 'kk_payouts', 'kk_promos', 'kk_corporate', 'kk_supply', 'kk_riders', 'kk_audit', 'kk_demand']) dump[t] = db.prepare(`SELECT * FROM ${t}`).all().map(r => { if (t === 'kk_kitchens') delete r.password_hash; if (t === 'kk_riders') delete r.pin_hash; return r; });
    dump.settings = settings(); dump.exportedAt = new Date().toISOString(); res.set({ 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="azizo-kitchens-backup.json"' }); res.send(JSON.stringify(dump, null, 1));
  });
  admin.get('/backup/database', async (req, res) => {
    if (res.locals.sub !== 'full') return res.status(403).json({ error: 'Only the full login can download the database' });
    const tmp = path.join(os.tmpdir(), 'azizo-backup-' + Date.now() + '.db');
    try { await db.backup(tmp); res.download(tmp, 'azizo-database-' + nowEAT().date + '.db', () => fs.unlink(tmp, () => {})); } catch (e) { res.status(500).json({ error: 'Backup failed: ' + e.message }); }
  });
};
