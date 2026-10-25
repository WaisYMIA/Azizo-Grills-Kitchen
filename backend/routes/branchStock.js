const express = require('express');
const db = require('../db');
const { requireStaff } = require('../middleware/auth');
const router = express.Router();

// Public: {out: {branchId: [productId, ...]}} - only what is currently unavailable at each branch.
router.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const out = {};
  db.prepare('SELECT branch_id, product_id FROM branch_stock_out').all().forEach(r => { (out[r.branch_id] = out[r.branch_id] || []).push(r.product_id); });
  res.json({ out });
});

// Staff: {branchId, productId, inStock}
router.post('/', requireStaff, (req, res) => {
  const b = req.body || {};
  const branchId = String(b.branchId || ''), productId = String(b.productId || '');
  if (!db.prepare('SELECT 1 FROM branches WHERE id = ?').get(branchId)) return res.status(404).json({ error: 'Branch not found' });
  if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(productId)) return res.status(404).json({ error: 'Product not found' });
  if (b.inStock) db.prepare('DELETE FROM branch_stock_out WHERE branch_id = ? AND product_id = ?').run(branchId, productId);
  else db.prepare('INSERT OR IGNORE INTO branch_stock_out (branch_id, product_id) VALUES (?, ?)').run(branchId, productId);
  res.json({ ok: true });
});
module.exports = router;
