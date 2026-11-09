// Azizo growth & money module (v5.4): settings, referrals, subscriptions, refunds, daily digest, cash-up/M-Pesa reconciliation,
// order-message outbox (WhatsApp/SMS adapters) and partner price bands. Every number is editable from Operations > Growth settings.
const express = require('express');
const crypto = require('crypto');
const db = require('./db');
const { requireAdmin, requireStaff, requireAuth } = require('./middleware/auth');
const router = express.Router();

db.exec(`
  CREATE TABLE IF NOT EXISTS ops_settings (k TEXT PRIMARY KEY, v TEXT);
  CREATE TABLE IF NOT EXISTS ops_ref_codes (customer_id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL);
  CREATE TABLE IF NOT EXISTS ops_referrals (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, referrer_id INTEGER, referrer_phone9 TEXT, referred_id INTEGER, referred_phone9 TEXT UNIQUE, referred_name TEXT DEFAULT '', status TEXT DEFAULT 'pending', created_at TEXT, paid_at TEXT);
  CREATE TABLE IF NOT EXISTS ops_subs (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, phone9 TEXT, name TEXT DEFAULT '', items_json TEXT NOT NULL, fulfilment TEXT DEFAULT 'delivery', branch TEXT DEFAULT '', partner_id INTEGER, freq TEXT DEFAULT 'weekly', weekday INTEGER DEFAULT 6, next_date TEXT, status TEXT DEFAULT 'active', created_at TEXT, last_notified TEXT DEFAULT '');
  CREATE TABLE IF NOT EXISTS ops_refunds (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, partner_id INTEGER, phone9 TEXT, name TEXT DEFAULT '', reason TEXT, details TEXT DEFAULT '', amount_req INTEGER DEFAULT 0, amount_ok INTEGER DEFAULT 0, status TEXT DEFAULT 'requested', resolution TEXT DEFAULT '', handled_by TEXT DEFAULT '', mpesa_ref TEXT DEFAULT '', created_at TEXT, decided_at TEXT, paid_at TEXT);
  CREATE TABLE IF NOT EXISTS ops_cashups (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, branch TEXT NOT NULL, expected INTEGER DEFAULT 0, counted INTEGER DEFAULT 0, variance INTEGER DEFAULT 0, note TEXT DEFAULT '', by_name TEXT DEFAULT '', created_at TEXT, UNIQUE(day, branch));
  CREATE TABLE IF NOT EXISTS ops_franchise (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT DEFAULT '', town TEXT DEFAULT '', budget TEXT DEFAULT '', premises TEXT DEFAULT '', timeline TEXT DEFAULT '', experience TEXT DEFAULT '', message TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'new', note TEXT DEFAULT '', handled_by TEXT DEFAULT '', created_at TEXT, updated_at TEXT);
  CREATE TABLE IF NOT EXISTS ops_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, event TEXT, order_id INTEGER, phone TEXT, text TEXT, provider TEXT, status TEXT);
`);
const TZ = Number.isFinite(Number(process.env.TZ_OFFSET_HOURS)) ? Number(process.env.TZ_OFFSET_HOURS) : 3;
const nowTs = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const eatDay = (d = new Date()) => new Date(d.getTime() + TZ * 3600000).toISOString().slice(0, 10);
const dayExpr = `date(created_at, '+${TZ} hours')`;
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, n);
const last9 = s => String(s || '').replace(/\D/g, '').slice(-9);
const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
const audit = (req, a, d, actor) => { try { require('./secmon').audit(req, a, d, actor); } catch (e) {} };
const who = req => (req.user && req.user.name) || 'admin';

// ---------------- settings (defaults are typical Nairobi market values; the Owner edits them) ----------------
const DEFAULTS = {
  referral_on: '1', referral_referrer_pts: '100', referral_friend_pts: '100', referral_min_order: '1000', referral_max_month: '20',
  franchise_on: '1', franchise_invest_min: '3000000', franchise_invest_max: '6000000', franchise_fee: '300000', franchise_royalty_pct: '5', franchise_term_years: '5', franchise_territory: 'Greater Nairobi and nearby towns; the area around each outlet is agreed in the signed agreement',
  redeem_on: '0', redeem_max_pct: '20', redeem_min_order: '1000',
  price_mode: 'enforce', price_band_pct: '15',
  refund_window_hours: '24',
  sub_on: '1', sub_min_order: '1500', sub_max_per_customer: '3', sub_freqs: 'weekly,fortnightly,monthly',
  cash_tolerance: '50',
  digest_wa: '', digest_email: '',
  msg_on: '0', msg_provider: 'manual',
  tpl_received: 'Hi {name}, we got your Azizo order #{order} (KSh {total}). We will confirm shortly.',
  tpl_preparing: 'Hi {name}, your Azizo order #{order} is being prepared.',
  tpl_ready: 'Hi {name}, your Azizo order #{order} is ready.',
  tpl_out_for_delivery: 'Hi {name}, your Azizo order #{order} is on its way. {codeLine}Track: {link}',
  tpl_completed: 'Thank you {name}! Order #{order} is complete. Anything wrong? Tell us within {refundHours} hours on WhatsApp +254724888057.',
  tpl_sub_due: 'Hi {name}, your regular Azizo order is due. Open {link} to order it in one tap.',
};
const SECRET_KEYS = [];
function settings() { const o = { ...DEFAULTS }; for (const r of db.prepare('SELECT k, v FROM ops_settings').all()) if (r.k in DEFAULTS) o[r.k] = r.v; return o; }
const S = k => settings()[k];
const N = k => Number(S(k)) || 0;
function validate(k, v) {
  v = String(v == null ? '' : v).trim();
  if (/^(referral_on|sub_on|msg_on|redeem_on|franchise_on)$/.test(k)) return v === '1' || v === 'true' ? '1' : '0';
  if (/_pts$|_min_order$|_max_month$|refund_window_hours|sub_min_order|sub_max_per_customer|cash_tolerance$/.test(k)) { const n = Math.round(Number(v)); if (!Number.isFinite(n) || n < 0 || n > 1000000) throw new Error(k + ' must be a number'); return String(n); }
  if (/^franchise_(invest_min|invest_max|fee|term_years)$/.test(k)) { const n = Math.round(Number(v)); if (!Number.isFinite(n) || n < 0 || n > 1e10) throw new Error(k.replace(/_/g, ' ') + ' must be a number'); return String(n); }
  if (k === 'franchise_royalty_pct') { const n = Number(v); if (!(n >= 0 && n <= 30)) throw new Error('Royalty must be 0 to 30 percent'); return String(n); }
  if (k === 'redeem_max_pct') { const n = Number(v); if (!(n >= 1 && n <= 100)) throw new Error('Rewards limit must be 1 to 100 percent'); return String(Math.round(n)); }
  if (k === 'price_band_pct') { const n = Number(v); if (!(n >= 1 && n <= 100)) throw new Error('Price band must be 1 to 100 percent'); return String(n); }
  if (k === 'price_mode') { if (!['off', 'warn', 'enforce'].includes(v)) throw new Error('Price mode must be off, warn or enforce'); return v; }
  if (k === 'msg_provider') { if (!['manual', 'whatsapp', 'sms'].includes(v)) throw new Error('Unknown provider'); return v; }
  if (k === 'sub_freqs') { const f = v.split(',').map(x => x.trim()).filter(x => ['weekly', 'fortnightly', 'monthly'].includes(x)); if (!f.length) throw new Error('Pick at least one frequency'); return f.join(','); }
  if (k === 'digest_wa') return last9(v) ? '254' + last9(v) : '';
  if (k === 'digest_email') { if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw new Error('Digest email looks wrong'); return v.slice(0, 120); }
  return v.slice(0, 500);
}
router.get('/admin/settings', requireAdmin, noStore, (req, res) => res.json({ settings: settings(), defaults: DEFAULTS, providers: { whatsapp: !!(process.env.WA_TOKEN && process.env.WA_PHONE_ID), sms: !!(process.env.AT_API_KEY && process.env.AT_USERNAME) } }));
router.put('/admin/settings', requireAdmin, (req, res) => {
  try {
    const b = req.body || {}, ch = [];
    db.transaction(() => { for (const k of Object.keys(b)) { if (!(k in DEFAULTS)) continue; const v = validate(k, b[k]); db.prepare('INSERT INTO ops_settings (k, v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v); ch.push(k); } })();
    audit(req, 'growth-settings', ch.join(','), who(req)); res.json({ ok: true, settings: settings() });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
// ---------------- pay with points at checkout (v5.6) ----------------
// 1 point = KSh 1 (100 points = KSh 100). Logged-in customers only; the balance is read from the account's own phone number, never from the request.
const last9p = p => String(p || '').replace(/\D/g, '').slice(-9);
function balanceFor(customerId) {
  const c = db.prepare('SELECT phone FROM customers WHERE id = ?').get(customerId); if (!c) return null;
  const p9 = last9p(c.phone), p = require('./ops').pointsFor(p9); return { phone9: p9, balance: Math.max(0, p.earned + p.adj) };
}
function redeemCheck(customerId, points, itemsSubtotal) {
  const s = settings(); points = Math.floor(Number(points) || 0);
  if (s.redeem_on !== '1') return { error: 'Paying with points is not available right now' };
  if (!customerId) return { error: 'Sign in to your account to pay with points' };
  if (points < 100 || points % 100) return { error: 'Choose a multiple of 100 points' };
  if (itemsSubtotal < Number(s.redeem_min_order)) return { error: 'Points can be used on orders of KSh ' + s.redeem_min_order + ' or more' };
  const max = Math.floor(itemsSubtotal * Number(s.redeem_max_pct) / 100 / 100) * 100;
  if (points > max) return { error: 'You can pay up to KSh ' + max + ' of this order with points (' + s.redeem_max_pct + '% limit)' };
  const b = balanceFor(customerId); if (!b || points > b.balance) return { error: 'You do not have that many points' };
  return { discount: points, phone9: b.phone9 };
}
function recordRedemption(phone9, points, orderId) { db.prepare('INSERT INTO ops_loyalty_adj (phone9, points, note, created_at) VALUES (?,?,?,?)').run(phone9, -points, 'Redeemed on order #' + orderId, new Date().toISOString().slice(0, 19).replace('T', ' ')); }
function returnRedemption(orderId) {
  const r = db.prepare("SELECT phone9, points FROM ops_loyalty_adj WHERE note = ?").get('Redeemed on order #' + orderId); if (!r) return;
  if (db.prepare("SELECT 1 FROM ops_loyalty_adj WHERE note = ?").get('Returned: order #' + orderId + ' cancelled')) return;
  db.prepare('INSERT INTO ops_loyalty_adj (phone9, points, note, created_at) VALUES (?,?,?,?)').run(r.phone9, -r.points, 'Returned: order #' + orderId + ' cancelled', new Date().toISOString().slice(0, 19).replace('T', ' '));
}
router.get('/points', (req, res, next) => customer(req, res, next), noStore, (req, res) => {
  const s = settings(), b = balanceFor(req.user.id); if (!b) return res.status(404).json({ error: 'Account not found' });
  res.json({ on: s.redeem_on === '1', points: b.balance, worthKes: Math.floor(b.balance / 100) * 100, maxPct: Number(s.redeem_max_pct), minOrder: Number(s.redeem_min_order) });
});
// ---------------- franchise enquiries (v5.6) ----------------
const franchiseHits = new Map();
router.post('/franchise-apply', (req, res) => {
  const k = req.ip || '', now = Date.now(), a = (franchiseHits.get(k) || []).filter(t => now - t < 3600000); if (a.length >= 5) return res.status(429).json({ error: 'Too many enquiries from this connection. Please try again later.' }); a.push(now); franchiseHits.set(k, a);
  const b = req.body || {}, s = settings(); if (b.website) return res.json({ ok: true, ref: 'FR-00000' });
  if (s.franchise_on !== '1') return res.status(400).json({ error: 'Franchise enquiries are not open right now' });
  const name = clean(b.name, 80), phone = String(b.phone || '').replace(/[^\d+]/g, '').slice(0, 16), email = clean(b.email, 120), town = clean(b.town, 80);
  if (name.length < 2) return res.status(400).json({ error: 'Please enter your name' }); if (last9(phone).length < 9) return res.status(400).json({ error: 'Please enter a phone number we can reach on WhatsApp' });
  if (email && !/^[^\s@<>",;:]+@[^\s@<>",;:]+\.[^\s@<>",;:]{2,}$/.test(email)) return res.status(400).json({ error: 'That email address does not look right' }); if (town.length < 2) return res.status(400).json({ error: 'Tell us the town or area you have in mind' });
  const pick = (v, list) => list.includes(v) ? v : ''; const budget = pick(b.budget, ['under_2m', '2m_4m', '4m_6m', 'over_6m']), premises = pick(b.premises, ['own', 'lease', 'none']), timeline = pick(b.timeline, ['0_3', '3_6', '6_12', 'later']);
  if (!budget || !premises || !timeline) return res.status(400).json({ error: 'Please answer the budget, premises and timing questions' }); if (!b.consent) return res.status(400).json({ error: 'Please tick the box to let us contact you about this enquiry' });
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const id = db.prepare('INSERT INTO ops_franchise (name, phone, email, town, budget, premises, timeline, experience, message, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(name, phone, email, town, budget, premises, timeline, clean(b.experience, 500), clean(b.message, 800), ts, ts).lastInsertRowid;
  try { const m = require('./mailer'), c = m.config(), to = c.alert_to || c.from_email; if (m.isEmail(to)) m.sendMail({ to, subject: 'New franchise enquiry FR-' + String(id).padStart(5, '0'), text: 'New franchise enquiry\n\nName: ' + name + '\nPhone: ' + phone + '\nTown: ' + town + '\nBudget: ' + budget + '\n\nOpen Operations > Growth > Franchise to follow up.' }, 'system').catch(() => {}); } catch (e) {}
  res.status(201).json({ ok: true, ref: 'FR-' + String(id).padStart(5, '0'), message: 'Thank you. We have your enquiry and will call or WhatsApp you within three working days.' });
});
router.get('/admin/franchise', requireAdmin, noStore, (req, res) => res.json({ applications: db.prepare('SELECT * FROM ops_franchise ORDER BY id DESC LIMIT 300').all(), statuses: ['new', 'contacted', 'meeting', 'approved', 'declined'] }));
router.patch('/admin/franchise/:id', requireAdmin, (req, res) => {
  const b = req.body || {}, r = db.prepare('SELECT * FROM ops_franchise WHERE id = ?').get(Number(req.params.id)); if (!r) return res.status(404).json({ error: 'Not found' });
  const st = ['new', 'contacted', 'meeting', 'approved', 'declined'].includes(b.status) ? b.status : r.status;
  db.prepare('UPDATE ops_franchise SET status = ?, note = ?, handled_by = ?, updated_at = ? WHERE id = ?').run(st, b.note === undefined ? r.note : clean(b.note, 500), who(req), new Date().toISOString().slice(0, 19).replace('T', ' '), r.id);
  audit(req, 'franchise-' + st, 'FR-' + r.id); res.json({ ok: true });
});
router.get('/config', noStore, (req, res) => { const s = settings(); res.json({ subscriptions: { on: s.sub_on === '1', min: Number(s.sub_min_order), freqs: s.sub_freqs.split(','), max: Number(s.sub_max_per_customer) }, referral: { on: s.referral_on === '1', friendPts: Number(s.referral_friend_pts), referrerPts: Number(s.referral_referrer_pts), minOrder: Number(s.referral_min_order) }, refundHours: Number(s.refund_window_hours), redeem: { on: s.redeem_on === '1', maxPct: Number(s.redeem_max_pct), minOrder: Number(s.redeem_min_order) }, franchise: { on: s.franchise_on === '1', investMin: Number(s.franchise_invest_min), investMax: Number(s.franchise_invest_max), fee: Number(s.franchise_fee), royaltyPct: Number(s.franchise_royalty_pct), termYears: Number(s.franchise_term_years), territory: s.franchise_territory } }); });

// ---------------- partner price band ----------------
// base = Azizo recommended price (products.price). Returns {ok, min, max}
function priceBand(base) { const pct = N('price_band_pct'), mode = S('price_mode'); return { mode, min: Math.ceil(base * (1 - pct / 100)), max: Math.floor(base * (1 + pct / 100)), pct }; }
function checkPartnerPrice(base, price) { const b = priceBand(base); if (b.mode === 'off' || price == null) return { ok: true, ...b }; return { ok: price >= b.min && price <= b.max, ...b }; }
router.get('/admin/price-check', requireAdmin, noStore, (req, res) => {
  const rows = db.prepare('SELECT pi.partner_id, p.name AS partner, pi.product_id, pr.name AS item, pr.price AS base, pi.price FROM mk_partner_items pi JOIN products pr ON pr.id = pi.product_id JOIN mk_partners p ON p.id = pi.partner_id WHERE pi.price IS NOT NULL').all();
  const out = rows.map(r => ({ ...r, ...priceBand(r.base) })).filter(r => r.price < r.min || r.price > r.max);
  res.json({ mode: S('price_mode'), pct: N('price_band_pct'), outside: out });
});
router.post('/admin/price-reset', requireAdmin, (req, res) => {
  const b = req.body || {}; const r = db.prepare("UPDATE mk_partner_items SET price = NULL, updated_at = datetime('now') WHERE partner_id = ? AND product_id = ?").run(parseInt(b.partnerId, 10) || 0, String(b.productId || ''));
  audit(req, 'price-reset', b.partnerId + '/' + b.productId, who(req)); res.json({ ok: true, changed: r.changes });
});

// ---------------- messages (outbox + WhatsApp / SMS adapters) ----------------
const EVENTS = ['received', 'preparing', 'ready', 'out_for_delivery', 'completed', 'sub_due'];
function render(tpl, o, extra) { const s = settings(); const link = (process.env.SITE_URL || 'https://www.azizobutchery.co.ke') + '/index.html?track=' + (o ? o.id : ''); const v = { name: (o && o.customer_name || (extra && extra.name) || 'there').split(' ')[0], order: o ? o.id : '', total: o ? o.total : '', link: (extra && extra.link) || link, refundHours: s.refund_window_hours, codeLine: o && o.delivery_code ? 'Your delivery code is shown on the tracking page. ' : '' }; return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)); }
async function deliver(provider, phone, text) {
  const to = '254' + last9(phone);
  if (provider === 'whatsapp') { const r = await fetch('https://graph.facebook.com/v20.0/' + process.env.WA_PHONE_ID + '/messages', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.WA_TOKEN }, body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }) }); return r.ok; }
  if (provider === 'sms') { const r = await fetch('https://api.africastalking.com/version1/messaging', { method: 'POST', headers: { apiKey: process.env.AT_API_KEY, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username: process.env.AT_USERNAME, to: '+' + to, message: text, ...(process.env.AT_SENDER ? { from: process.env.AT_SENDER } : {}) }) }); return r.ok; }
  return false;
}
/** Record (and, if a provider is configured and switched on, send) a customer message for an order event. Never throws. */
function notify(event, orderId, extra) {
  try {
    const s = settings(); if (!EVENTS.includes(event) || s.msg_on !== '1') return;
    const o = orderId ? db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) : null; const phone = o ? o.customer_phone : (extra && extra.phone); if (!phone) return;
    const text = render(s['tpl_' + event], o, extra); const live = (s.msg_provider === 'whatsapp' && process.env.WA_TOKEN && process.env.WA_PHONE_ID) || (s.msg_provider === 'sms' && process.env.AT_API_KEY && process.env.AT_USERNAME);
    const id = db.prepare('INSERT INTO ops_outbox (ts, event, order_id, phone, text, provider, status) VALUES (?,?,?,?,?,?,?)').run(nowTs(), event, orderId || null, phone, text, live ? s.msg_provider : 'manual', live ? 'queued' : 'manual').lastInsertRowid;
    db.prepare('DELETE FROM ops_outbox WHERE id < ?').run(Number(id) - 1500);
    if (live) deliver(s.msg_provider, phone, text).then(ok => db.prepare('UPDATE ops_outbox SET status = ? WHERE id = ?').run(ok ? 'sent' : 'failed', id)).catch(() => db.prepare("UPDATE ops_outbox SET status = 'failed' WHERE id = ?").run(id));
  } catch (e) {}
}
router.get('/admin/outbox', requireAdmin, noStore, (req, res) => res.json({ messages: db.prepare('SELECT * FROM ops_outbox ORDER BY id DESC LIMIT 100').all(), on: S('msg_on') === '1', provider: S('msg_provider') }));
router.post('/admin/outbox/:id(\\d+)/done', requireAdmin, (req, res) => { db.prepare("UPDATE ops_outbox SET status = 'sent-manually' WHERE id = ? AND status = 'manual'").run(req.params.id); res.json({ ok: true }); });

// ---------------- referrals ----------------
function codeFor(cid) { let r = db.prepare('SELECT code FROM ops_ref_codes WHERE customer_id = ?').get(cid); if (r) return r.code; for (let i = 0; i < 20; i++) { const c = 'AZ' + crypto.randomBytes(4).toString('hex').slice(0, 5).toUpperCase().replace(/[01OI]/g, 'X'); try { db.prepare('INSERT INTO ops_ref_codes (customer_id, code) VALUES (?,?)').run(cid, c); return c; } catch (e) {} } return null; }
function pay(phone9, pts, note) { db.prepare('INSERT INTO ops_loyalty_adj (phone9, points, note, created_at) VALUES (?,?,?,?)').run(phone9, pts, note, nowTs()); }
function settleReferrals() {
  const s = settings(); if (s.referral_on !== '1') return 0; let n = 0;
  for (const r of db.prepare("SELECT * FROM ops_referrals WHERE status = 'pending'").all()) {
    const o = db.prepare("SELECT COALESCE(SUM(total),0) t FROM orders WHERE status = 'completed' AND customer_phone LIKE ? AND created_at >= ?").get('%' + r.referred_phone9, r.created_at).t;
    if (o < Number(s.referral_min_order)) continue;
    const m = db.prepare("SELECT COUNT(*) n FROM ops_referrals WHERE referrer_id = ? AND status = 'paid' AND substr(paid_at,1,7) = ?").get(r.referrer_id, nowTs().slice(0, 7)).n;
    if (m >= Number(s.referral_max_month)) continue;
    pay(r.referrer_phone9, Number(s.referral_referrer_pts), 'Referral reward: friend ordered'); pay(r.referred_phone9, Number(s.referral_friend_pts), 'Welcome reward: referred by a friend');
    db.prepare("UPDATE ops_referrals SET status = 'paid', paid_at = ? WHERE id = ?").run(nowTs(), r.id); n++;
  }
  return n;
}
const customer = (req, res, next) => requireAuth(req, res, () => req.user.role === 'customer' ? next() : res.status(403).json({ error: 'Customer login required' }));
router.get('/referral', customer, noStore, (req, res) => {
  settleReferrals(); const s = settings(), code = codeFor(req.user.id), rows = db.prepare('SELECT status FROM ops_referrals WHERE referrer_id = ?').all(req.user.id);
  const mine = db.prepare('SELECT status, code FROM ops_referrals WHERE referred_id = ?').get(req.user.id);
  res.json({ on: s.referral_on === '1', code, friends: rows.length, rewarded: rows.filter(r => r.status === 'paid').length, pointsEarned: rows.filter(r => r.status === 'paid').length * Number(s.referral_referrer_pts), friendPts: Number(s.referral_friend_pts), referrerPts: Number(s.referral_referrer_pts), minOrder: Number(s.referral_min_order), usedCode: mine || null });
});
router.post('/referral/apply', customer, (req, res) => {
  const s = settings(); if (s.referral_on !== '1') return res.status(400).json({ error: 'Referrals are not running right now' });
  const code = clean((req.body || {}).code, 12).toUpperCase(), me = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.user.id), ref = db.prepare('SELECT customer_id FROM ops_ref_codes WHERE code = ?').get(code);
  if (!ref) return res.status(404).json({ error: 'That code is not valid' }); if (ref.customer_id === me.id) return res.status(400).json({ error: 'You cannot use your own code' });
  const rc = db.prepare('SELECT * FROM customers WHERE id = ?').get(ref.customer_id), p9 = last9(me.phone);
  if (last9(rc.phone) === p9) return res.status(400).json({ error: 'You cannot use your own code' });
  if (db.prepare("SELECT 1 FROM orders WHERE customer_phone LIKE ? AND status = 'completed' LIMIT 1").get('%' + p9)) return res.status(400).json({ error: 'Codes are for new customers who have not completed an order yet' });
  if (db.prepare('SELECT 1 FROM ops_referrals WHERE referred_phone9 = ? OR referred_id = ?').get(p9, me.id)) return res.status(400).json({ error: 'You have already used a referral code' });
  db.prepare('INSERT INTO ops_referrals (code, referrer_id, referrer_phone9, referred_id, referred_phone9, referred_name, created_at) VALUES (?,?,?,?,?,?,?)').run(code, rc.id, last9(rc.phone), me.id, p9, me.name, nowTs());
  res.json({ ok: true, message: 'Code applied. After your first completed order of KSh ' + s.referral_min_order + '+ you both get ' + s.referral_friend_pts + ' points.' });
});
router.get('/admin/referrals', requireAdmin, noStore, (req, res) => { settleReferrals(); res.json({ referrals: db.prepare('SELECT id, code, referrer_phone9, referred_phone9, referred_name, status, created_at, paid_at FROM ops_referrals ORDER BY id DESC LIMIT 200').all() }); });
router.patch('/admin/referrals/:id(\\d+)', requireAdmin, (req, res) => { db.prepare("UPDATE ops_referrals SET status = 'void' WHERE id = ? AND status = 'pending'").run(req.params.id); audit(req, 'referral-void', req.params.id, who(req)); res.json({ ok: true }); });

// ---------------- subscriptions (standing orders). The customer confirms each delivery in one tap; nothing is charged or placed without them. ----------------
const GAP = { weekly: 7, fortnightly: 14, monthly: 28 };
const addDays = (ymd, n) => new Date(new Date(ymd + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
function nextOn(weekday, from) { let d = addDays(from, 1); for (let i = 0; i < 8; i++) { if (new Date(d + 'T00:00:00Z').getUTCDay() === weekday) return d; d = addDays(d, 1); } return d; }
const subOut = x => ({ id: x.id, items: JSON.parse(x.items_json), fulfilment: x.fulfilment, branch: x.branch, partnerId: x.partner_id, freq: x.freq, weekday: x.weekday, nextDate: x.next_date, status: x.status, due: x.status === 'active' && x.next_date <= eatDay() });
router.post('/subs', customer, (req, res) => {
  const s = settings(); if (s.sub_on !== '1') return res.status(400).json({ error: 'Standing orders are not available right now' });
  const b = req.body || {}, items = (Array.isArray(b.items) ? b.items : []).slice(0, 40).map(i => ({ id: clean(i && i.id, 60), qty: Math.max(1, Math.min(200, parseInt(i && i.qty, 10) || 1)) })).filter(i => i.id);
  if (!items.length) return res.status(400).json({ error: 'Add items to your cart first' });
  const freq = String(b.freq || 'weekly'); if (!s.sub_freqs.split(',').includes(freq)) return res.status(400).json({ error: 'Pick how often' });
  let sum = 0; for (const i of items) { const p = db.prepare('SELECT price FROM products WHERE id = ?').get(i.id.split('::')[0]); if (!p) return res.status(400).json({ error: 'An item is no longer on the menu' }); sum += p.price * i.qty; }
  if (sum < Number(s.sub_min_order)) return res.status(400).json({ error: 'Standing orders start from KSh ' + s.sub_min_order + ' (your items are about KSh ' + sum + ')' });
  if (db.prepare("SELECT COUNT(*) n FROM ops_subs WHERE customer_id = ? AND status != 'cancelled'").get(req.user.id).n >= Number(s.sub_max_per_customer)) return res.status(400).json({ error: 'You can have up to ' + s.sub_max_per_customer + ' standing orders' });
  const wd = Math.max(0, Math.min(6, parseInt(b.weekday, 10) || 0)), c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.user.id);
  const id = db.prepare('INSERT INTO ops_subs (customer_id, phone9, name, items_json, fulfilment, branch, partner_id, freq, weekday, next_date, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(c.id, last9(c.phone), c.name, JSON.stringify(items), b.fulfilment === 'pickup' ? 'pickup' : 'delivery', clean(b.branch, 40), parseInt(b.partnerId, 10) || null, freq, wd, nextOn(wd, eatDay()), nowTs()).lastInsertRowid;
  res.json({ ok: true, id: Number(id), nextDate: db.prepare('SELECT next_date n FROM ops_subs WHERE id = ?').get(id).n });
});
router.get('/subs', customer, noStore, (req, res) => res.json({ subs: db.prepare("SELECT * FROM ops_subs WHERE customer_id = ? AND status != 'cancelled' ORDER BY id DESC").all(req.user.id).map(subOut) }));
router.patch('/subs/:id(\\d+)', customer, (req, res) => {
  const x = db.prepare("SELECT * FROM ops_subs WHERE id = ? AND customer_id = ? AND status != 'cancelled'").get(req.params.id, req.user.id); if (!x) return res.status(404).json({ error: 'Not found' });
  const a = String((req.body || {}).action || '');
  if (a === 'pause') db.prepare("UPDATE ops_subs SET status = 'paused' WHERE id = ?").run(x.id);
  else if (a === 'resume') db.prepare("UPDATE ops_subs SET status = 'active', next_date = ? WHERE id = ?").run(nextOn(x.weekday, eatDay()), x.id);
  else if (a === 'cancel') db.prepare("UPDATE ops_subs SET status = 'cancelled' WHERE id = ?").run(x.id);
  else if (a === 'skip' || a === 'advance') db.prepare('UPDATE ops_subs SET next_date = ? WHERE id = ?').run(addDays(x.next_date > eatDay() ? x.next_date : eatDay(), a === 'skip' ? GAP[x.freq] : GAP[x.freq]), x.id);
  else return res.status(400).json({ error: 'Unknown action' });
  res.json({ ok: true, sub: subOut(db.prepare('SELECT * FROM ops_subs WHERE id = ?').get(x.id)) });
});
router.get('/admin/subs', requireAdmin, noStore, (req, res) => res.json({ subs: db.prepare("SELECT id, name, phone9, freq, next_date, status, fulfilment, branch FROM ops_subs WHERE status != 'cancelled' ORDER BY next_date LIMIT 300").all(), dueToday: db.prepare("SELECT COUNT(*) n FROM ops_subs WHERE status = 'active' AND next_date <= ?").get(eatDay()).n }));
function remindSubs() { const t = eatDay(); for (const x of db.prepare("SELECT * FROM ops_subs WHERE status = 'active' AND next_date <= ? AND last_notified != ?").all(t, t)) { notify('sub_due', null, { phone: x.phone9, name: x.name }); db.prepare('UPDATE ops_subs SET last_notified = ? WHERE id = ?').run(t, x.id); } }

// ---------------- refunds ----------------
const REASONS = ['late', 'wrong_item', 'missing_item', 'quality', 'overcharged', 'other'];
router.post('/refund-request', (req, res) => {
  const hits = refundHits, k = req.ip || '', now = Date.now(), a = (hits.get(k) || []).filter(t => now - t < 3600000); if (a.length >= 10) return res.status(429).json({ error: 'Too many requests. Please use WhatsApp.' }); a.push(now); hits.set(k, a);
  const b = req.body || {}, id = parseInt(b.orderId, 10) || 0, o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id), reason = String(b.reason || '');
  if (!o || last9(o.customer_phone) !== last9(b.phone)) return res.status(404).json({ error: 'We could not match that order number and phone number' });
  if (!REASONS.includes(reason)) return res.status(400).json({ error: 'Pick what went wrong' });
  if (!['completed', 'out_for_delivery', 'ready'].includes(o.status)) return res.status(400).json({ error: 'You can ask for a refund once your order has been delivered or collected' });
  const closed = db.prepare("SELECT MAX(changed_at) t FROM order_status_log WHERE order_id = ? AND status = 'completed'").get(id).t || o.created_at, hrs = (Date.now() - new Date(String(closed).replace(' ', 'T') + 'Z').getTime()) / 3600000;
  if (hrs > N('refund_window_hours')) return res.status(400).json({ error: 'The ' + S('refund_window_hours') + '-hour window has passed. Please message us on WhatsApp +254724888057.' });
  if (db.prepare("SELECT 1 FROM ops_refunds WHERE order_id = ? AND status IN ('requested','approved')").get(id)) return res.status(400).json({ error: 'We already have a request for this order' });
  const r = db.prepare('INSERT INTO ops_refunds (order_id, partner_id, phone9, name, reason, details, amount_req, created_at) VALUES (?,?,?,?,?,?,?,?)').run(id, o.partner_id || null, last9(o.customer_phone), clean(o.customer_name, 60), reason, clean(b.details, 500), Math.max(0, Math.min(o.total, parseInt(b.amount, 10) || 0)), nowTs());
  res.json({ ok: true, ref: 'RF-' + String(r.lastInsertRowid).padStart(5, '0'), message: 'Thank you. We have your request and will reply within one working day.' });
});
const refundHits = new Map();
router.get('/admin/refunds', requireAdmin, noStore, (req, res) => {
  const rows = db.prepare("SELECT r.*, o.total AS order_total, o.branch, o.payment_method, p.name AS partner FROM ops_refunds r JOIN orders o ON o.id = r.order_id LEFT JOIN mk_partners p ON p.id = r.partner_id ORDER BY (r.status = 'requested') DESC, r.id DESC LIMIT 200").all();
  res.json({ refunds: rows, byReason: db.prepare("SELECT reason, COUNT(*) n, COALESCE(SUM(amount_ok),0) paid FROM ops_refunds GROUP BY reason ORDER BY n DESC").all(), byPartner: db.prepare("SELECT COALESCE(p.name,'Azizo own') partner, COUNT(*) n FROM ops_refunds r LEFT JOIN mk_partners p ON p.id = r.partner_id GROUP BY 1 ORDER BY n DESC LIMIT 10").all(), openCount: db.prepare("SELECT COUNT(*) n FROM ops_refunds WHERE status = 'requested'").get().n, reasons: REASONS });
});
router.patch('/admin/refunds/:id(\\d+)', requireAdmin, (req, res) => {
  const r = db.prepare('SELECT * FROM ops_refunds WHERE id = ?').get(req.params.id); if (!r) return res.status(404).json({ error: 'Not found' }); const b = req.body || {}, a = String(b.action || ''), tr = req.user && req.user.tr;
  if (a === 'paid') {
    if (r.status !== 'approved') return res.status(400).json({ error: 'Approve it first' });
    db.prepare("UPDATE ops_refunds SET status = 'paid', mpesa_ref = ?, paid_at = ? WHERE id = ?").run(clean(b.mpesaRef, 30), nowTs(), r.id);
  } else if (tr === 'finance') return res.status(403).json({ error: 'Finance can mark a refund as paid, not approve it' });
  else if (a === 'approve') { if (r.status !== 'requested') return res.status(400).json({ error: 'Already decided' }); const o = db.prepare('SELECT total FROM orders WHERE id = ?').get(r.order_id), amt = Math.max(0, Math.min(o.total, parseInt(b.amount, 10) || r.amount_req || 0)); db.prepare("UPDATE ops_refunds SET status = 'approved', amount_ok = ?, resolution = ?, handled_by = ?, decided_at = ? WHERE id = ?").run(amt, clean(b.resolution, 300), who(req), nowTs(), r.id); }
  else if (a === 'reject') { if (r.status !== 'requested') return res.status(400).json({ error: 'Already decided' }); if (clean(b.resolution, 300).length < 5) return res.status(400).json({ error: 'Write a short reason for the customer' }); db.prepare("UPDATE ops_refunds SET status = 'rejected', resolution = ?, handled_by = ?, decided_at = ? WHERE id = ?").run(clean(b.resolution, 300), who(req), nowTs(), r.id); }
  else return res.status(400).json({ error: 'Unknown action' });
  audit(req, 'refund-' + a, 'RF-' + r.id + ' order ' + r.order_id, who(req)); res.json({ ok: true });
});

// ---------------- daily digest ----------------
function digest(day) {
  day = day || eatDay(new Date(Date.now() - 86400000)); const base = `FROM orders WHERE status != 'cancelled' AND ${dayExpr} = ?`;
  const t = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(total),0) s ' + base).get(day), canc = db.prepare(`SELECT COUNT(*) n FROM orders WHERE status = 'cancelled' AND ${dayExpr} = ?`).get(day).n;
  const top = db.prepare(`SELECT oi.name, SUM(oi.qty) q FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status != 'cancelled' AND date(o.created_at, '+${TZ} hours') = ? GROUP BY oi.name ORDER BY SUM(oi.line_total) DESC LIMIT 3`).all(day);
  const br = db.prepare(`SELECT COALESCE(NULLIF(branch,''),'delivery/other') b, COALESCE(SUM(total),0) s ${base} GROUP BY 1 ORDER BY s DESC LIMIT 1`).get(day);
  const q = sql => { try { return db.prepare(sql).get().n; } catch (e) { return 0; } };
  const d = { day, orders: t.n, revenue: t.s, avg: t.n ? Math.round(t.s / t.n) : 0, cancelled: canc, top: top.map(x => x.name), topBranch: br ? br.b : '', openTickets: q("SELECT COUNT(*) n FROM ops_tickets WHERE status = 'open'"), refundsOpen: q("SELECT COUNT(*) n FROM ops_refunds WHERE status = 'requested'"), refundsToPay: q("SELECT COUNT(*) n FROM ops_refunds WHERE status = 'approved'"), subsDue: q(`SELECT COUNT(*) n FROM ops_subs WHERE status = 'active' AND next_date <= '${eatDay()}'`), mpesaMissing: reconFor(day).mpesa.missing.length, cashMissing: reconFor(day).cash.filter(c => !c.counted_entered && c.expected > 0).length };
  d.text = `Azizo daily digest, ${day}\nOrders: ${d.orders} (KSh ${d.revenue}, average ${d.avg}). Cancelled: ${d.cancelled}.\n` + (d.top.length ? 'Top sellers: ' + d.top.join(', ') + '.\n' : '') + (d.topBranch ? 'Busiest: ' + d.topBranch + '.\n' : '') +
    `Needs you: ${d.refundsOpen} refund request(s), ${d.refundsToPay} refund(s) to pay, ${d.openTickets} open ticket(s), ${d.subsDue} standing order(s) due.\n` + (d.mpesaMissing ? `Check: ${d.mpesaMissing} M-Pesa order(s) with no confirmed payment.\n` : '') + (d.cashMissing ? `Check: cash-up missing for ${d.cashMissing} branch(es).\n` : '');
  return d;
}
router.get('/admin/digest', requireAdmin, noStore, (req, res) => { const d = digest(/^\d{4}-\d{2}-\d{2}$/.test(req.query.day || '') ? req.query.day : null); const wa = S('digest_wa'); res.json({ ...d, waLink: wa ? 'https://wa.me/' + wa + '?text=' + encodeURIComponent(d.text) : '' }); });

// ---------------- cash-up and M-Pesa reconciliation ----------------
function reconFor(day) {
  const orders = db.prepare(`SELECT id, customer_name, total, payment_method, mpesa_receipt, branch, status, partner_id FROM orders WHERE status != 'cancelled' AND ${dayExpr} = ?`).all(day);
  const mp = orders.filter(o => o.payment_method === 'mpesa'), txns = db.prepare(`SELECT id, order_id, amount, status, mpesa_receipt FROM mpesa_transactions WHERE ${dayExpr} = ?`).all(day);
  const okByOrder = new Map(); txns.filter(t => t.status === 'success' && t.order_id).forEach(t => okByOrder.set(t.order_id, (okByOrder.get(t.order_id) || 0) + t.amount));
  const missing = mp.filter(o => !okByOrder.has(o.id) && !o.mpesa_receipt).map(o => ({ order: o.id, total: o.total, name: o.customer_name })), mismatch = mp.filter(o => okByOrder.has(o.id) && Math.abs(okByOrder.get(o.id) - o.total) > 1).map(o => ({ order: o.id, total: o.total, paid: okByOrder.get(o.id) }));
  const orphans = txns.filter(t => t.status === 'success' && (!t.order_id || !db.prepare('SELECT 1 FROM orders WHERE id = ?').get(t.order_id))).map(t => ({ amount: t.amount, receipt: t.mpesa_receipt }));
  const cashBy = {}; orders.filter(o => o.payment_method === 'cash' && o.status === 'completed' && !o.partner_id).forEach(o => { const b = o.branch || 'delivery/other'; cashBy[b] = (cashBy[b] || 0) + o.total; });
  const saved = db.prepare('SELECT * FROM ops_cashups WHERE day = ?').all(day), tol = N('cash_tolerance');
  const names = new Set([...Object.keys(cashBy), ...saved.map(s => s.branch)]);
  const cash = [...names].map(b => { const s = saved.find(x => x.branch === b), exp = cashBy[b] || 0; return { branch: b, expected: exp, counted_entered: !!s, counted: s ? s.counted : null, variance: s ? s.counted - exp : null, note: s ? s.note : '', by: s ? s.by_name : '', flag: s ? Math.abs(s.counted - exp) > tol : false }; });
  return { day, mpesa: { orders: mp.length, amount: mp.reduce((a, o) => a + o.total, 0), confirmed: [...okByOrder.values()].reduce((a, b) => a + b, 0), missing, mismatch, orphans }, cash, tolerance: tol };
}
router.get('/admin/recon', requireAdmin, noStore, (req, res) => res.json(reconFor(/^\d{4}-\d{2}-\d{2}$/.test(req.query.day || '') ? req.query.day : eatDay())));
router.post('/cashup', requireStaff, (req, res) => {
  const b = req.body || {}, day = /^\d{4}-\d{2}-\d{2}$/.test(b.day || '') ? b.day : eatDay(), branch = clean(b.branch, 40), counted = Math.round(Number(b.counted));
  if (!branch || !Number.isFinite(counted) || counted < 0) return res.status(400).json({ error: 'Branch and counted cash are needed' });
  const exp = (reconFor(day).cash.find(c => c.branch === branch) || { expected: 0 }).expected;
  db.prepare('INSERT INTO ops_cashups (day, branch, expected, counted, variance, note, by_name, created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(day, branch) DO UPDATE SET expected = excluded.expected, counted = excluded.counted, variance = excluded.variance, note = excluded.note, by_name = excluded.by_name, created_at = excluded.created_at').run(day, branch, exp, counted, counted - exp, clean(b.note, 200), who(req), nowTs());
  audit(req, 'cashup', day + ' ' + branch + ' var ' + (counted - exp), who(req)); res.json({ ok: true, expected: exp, variance: counted - exp, flag: Math.abs(counted - exp) > N('cash_tolerance') });
});

function hourly() { try { settleReferrals(); remindSubs(); } catch (e) {} try { require('./mailer').maybeDigest(); } catch (e) {} }
if (!process.env.GROWTH_NO_TIMER) setInterval(hourly, 3600000).unref();
module.exports = { router, redeemCheck, recordRedemption, returnRedemption, notify, checkPartnerPrice, priceBand, settleReferrals, remindSubs, digest, hourly, settings };
