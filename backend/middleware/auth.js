const jwt = require('jsonwebtoken');
const db = require('../db');
db.exec("CREATE TABLE IF NOT EXISTS team_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, password_hash TEXT NOT NULL, active INTEGER DEFAULT 1, last_login TEXT, created_at TEXT, created_by TEXT)");
const JWT_SECRET = process.env.JWT_SECRET;
const SECRET = JWT_SECRET || 'insecure-dev-only-secret-change-me';
function signCustomerToken(c) { return jwt.sign({ id: c.id, phone: c.phone, role: 'customer' }, SECRET, { expiresIn: '30d' }); }
function signAdminToken() { return jwt.sign({ role: 'admin' }, SECRET, { expiresIn: '12h' }); }
function signStaffToken() { return jwt.sign({ role: 'staff' }, SECRET, { expiresIn: '12h' }); }
function signKitchensAdminToken(sub) { return jwt.sign({ role: 'kitchens', sub: sub || 'full' }, SECRET, { expiresIn: '12h' }); }
function signRiderToken(r) { return jwt.sign({ role: 'krider', riderId: r.id }, SECRET, { expiresIn: '14d' }); }
function signKitchenToken(k) { return jwt.sign({ role: 'kitchen', kitchenId: k.id }, SECRET, { expiresIn: '14d' }); }
function signPartnerToken(p) { return jwt.sign({ role: 'partner', partnerId: p.id }, SECRET, { expiresIn: '14d' }); }
function signInspectorToken(name) { return jwt.sign({ role: 'inspector', name: String(name || '').slice(0, 60) }, SECRET, { expiresIn: '12h' }); }
// v5.2 personal team accounts. Tokens carry tr (owner|manager|finance|counter), uid and name.
// Owner = everything. Manager = everything except OWNER_ONLY. Finance = money screens, read-only elsewhere. Counter = staff screens (+ reward requests).
const OWNER_ONLY = [/^\/api\/branchops\/(franchisees|royalties|settings)/, /^\/api\/playbook\/launches/, /^\/api\/ops\/admin\/(team|accounts)/, /^\/api\/auth\/security/, /^\/api\/market\/admin\/(fees|settings)/, /^\/api\/site\/settings/, /^\/api\/products\/import/, /^\/api\/ai\/admin\/settings/, /^\/api\/growth\/admin\/settings/, /^\/api\/insight\/admin\/(activity|mail)/, /^\/api\/growth\/admin\/franchise/];
const FINANCE_OK = [/^\/api\/branchops\/(scorecard|purchases|waste|margins|royalties|yield|rejects|suppliers)/, /^\/api\/market\/admin\/(overview|fees|invoices|partners)/, /^\/api\/ops\/admin\/analytics/, /^\/api\/growth\/admin\/(recon|refunds|digest)/, /^\/api\/insight\/admin\/(reports|pack)/, /^\/api\/reports/, /^\/api\/orders/, /^\/api\/kitchens/];
function teamDeny(req) {
  const tr = req.user && req.user.tr; if (!tr || tr === 'owner') return null;
  const path = String(req.originalUrl || '').split('?')[0], get = req.method === 'GET';
  if (tr === 'manager') return OWNER_ONLY.some(r => r.test(path)) ? 'Only an Owner can do this' : null;
  if (tr === 'finance') { if (/^\/api\/market\/admin\/invoices/.test(path) || /^\/api\/growth\/admin\/refunds/.test(path)) return null; return get && FINANCE_OK.some(r => r.test(path)) ? null : 'Your Finance login can view money screens but not change this'; }
  if (tr === 'counter') return /^\/api\/ops\/admin\/requests/.test(path) ? null : 'Your Counter login does not cover this';
  return 'Not allowed';
}
function requireAuth(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  try {
    req.user = jwt.verify(h.slice(7), SECRET);
    if (req.user.uid) { const a = db.prepare('SELECT active, role FROM team_accounts WHERE id = ?').get(req.user.uid); if (!a || !a.active) return res.status(401).json({ error: 'This account has been switched off. Ask the Owner.' }); req.user.tr = a.role; }
    next();
  }
  catch (e) { return res.status(401).json({ error: 'Invalid or expired token' }); }
}
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    const counterOk = req.user.role === 'staff' && req.user.tr === 'counter' && /^\/api\/ops\/admin\/requests/.test(String(req.originalUrl || ''));
    if (req.user.role !== 'admin' && !counterOk) return res.status(403).json({ error: 'Admin access required' });
    const why = teamDeny(req); if (why) return res.status(403).json({ error: why });
    next();
  });
}
// Staff (counter / kitchen / dispatch) can work orders and stock; the admin can do all of that too.
function requireStaff(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'staff' && req.user.role !== 'admin') return res.status(403).json({ error: 'Staff access required' });
    if (req.user.tr === 'finance' && req.method !== 'GET') return res.status(403).json({ error: 'Your Finance login is read-only on orders and stock' });
    next();
  });
}
// Kitchens Admin: its own password (KITCHENS_ADMIN_PASSWORD); the main admin can also do everything here.
function requireKitchensAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'kitchens' && req.user.role !== 'admin') return res.status(403).json({ error: 'Kitchens admin access required' });
    next();
  });
}
// Sub-roles of the Kitchens Admin: full (default, and the main admin), dispatch (orders, riders, supply) and accounts (payouts, reports).
function kkAllow(...subs) {
  return (req, res, next) => {
    const sub = req.user.role === 'admin' ? (req.user.tr === 'finance' ? 'accounts' : 'full') : (req.user.sub || 'full');
    if (sub === 'full' || subs.includes(sub)) return next();
    return res.status(403).json({ error: 'Your login does not have access to this section' });
  };
}
function requireRider(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'krider' || !req.user.riderId) return res.status(403).json({ error: 'Rider access required' });
    next();
  });
}
// A signed-in Kitchen Partner (req.user.kitchenId).
function requireKitchen(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'kitchen' || !req.user.kitchenId) return res.status(403).json({ error: 'Kitchen partner access required' });
    next();
  });
}
// Azizo inspection officials (own password INSPECTOR_PASSWORD) and the admin may fill in inspection forms.
function requireInspector(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'inspector' && req.user.role !== 'admin') return res.status(403).json({ error: 'Inspector access required' });
    next();
  });
}
// A signed-in marketplace partner butchery (req.user.partnerId).
function requirePartner(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'partner' || !req.user.partnerId) return res.status(403).json({ error: 'Partner access required' });
    next();
  });
}
module.exports = { signInspectorToken, requireInspector, signPartnerToken, requirePartner, signRiderToken, requireRider, kkAllow, signKitchensAdminToken, signKitchenToken, requireKitchensAdmin, requireKitchen, signCustomerToken, signAdminToken, signStaffToken, teamDeny, requireAuth, requireAdmin, requireStaff, SECRET };
