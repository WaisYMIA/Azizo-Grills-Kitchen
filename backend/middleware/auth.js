const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;
const SECRET = JWT_SECRET || 'insecure-dev-only-secret-change-me';
function signCustomerToken(c) { return jwt.sign({ id: c.id, phone: c.phone, role: 'customer' }, SECRET, { expiresIn: '30d' }); }
function signAdminToken() { return jwt.sign({ role: 'admin' }, SECRET, { expiresIn: '12h' }); }
function signStaffToken() { return jwt.sign({ role: 'staff' }, SECRET, { expiresIn: '12h' }); }
function signKitchensAdminToken(sub) { return jwt.sign({ role: 'kitchens', sub: sub || 'full' }, SECRET, { expiresIn: '12h' }); }
function signRiderToken(r) { return jwt.sign({ role: 'krider', riderId: r.id }, SECRET, { expiresIn: '14d' }); }
function signKitchenToken(k) { return jwt.sign({ role: 'kitchen', kitchenId: k.id }, SECRET, { expiresIn: '14d' }); }
function signPartnerToken(p) { return jwt.sign({ role: 'partner', partnerId: p.id }, SECRET, { expiresIn: '14d' }); }
function requireAuth(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  try { req.user = jwt.verify(h.slice(7), SECRET); next(); }
  catch (e) { return res.status(401).json({ error: 'Invalid or expired token' }); }
}
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
  });
}
// Staff (counter / kitchen / dispatch) can work orders and stock; the admin can do all of that too.
function requireStaff(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'staff' && req.user.role !== 'admin') return res.status(403).json({ error: 'Staff access required' });
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
    const sub = req.user.role === 'admin' ? 'full' : (req.user.sub || 'full');
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
// A signed-in marketplace partner butchery (req.user.partnerId).
function requirePartner(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'partner' || !req.user.partnerId) return res.status(403).json({ error: 'Partner access required' });
    next();
  });
}
module.exports = { signPartnerToken, requirePartner, signRiderToken, requireRider, kkAllow, signKitchensAdminToken, signKitchenToken, requireKitchensAdmin, requireKitchen, signCustomerToken, signAdminToken, signStaffToken, requireAuth, requireAdmin, requireStaff, SECRET };
