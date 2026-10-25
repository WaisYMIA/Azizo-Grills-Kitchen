const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const XLSX = require('xlsx');
const db = require('../db');
const { requireAdmin, requireStaff } = require('../middleware/auth');
const router = express.Router();

// ---------- image uploads ----------
// Stored on disk under backend/uploads (served statically by server.js at /uploads).
// On a host with an ephemeral filesystem (most serverless platforms), this folder
// doesn't survive a redeploy — fine for Render/Railway/cPanel with a persistent disk
// or home-directory storage, worth knowing if you move to something serverless later.
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const safeId = (req.body.id || 'item').replace(/[^a-z0-9_-]/gi, '-');
    cb(null, `${safeId}-${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) return cb(new Error('Only JPG, PNG, WEBP, or GIF images are allowed'));
    cb(null, true);
  },
});

// A separate multer instance for the Excel import — reusing the image-only `upload`
// above would reject every .xlsx file outright (wrong fileFilter, wrong purpose).
// Spreadsheets are read into memory and parsed immediately, never written to the
// uploads/ folder (that's for product photos only), so plain memory storage is fine.
const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const okExt = /\.xlsx$/i.test(file.originalname);
    const okMime = /spreadsheetml|ms-excel/i.test(file.mimetype) || file.mimetype === 'application/octet-stream';
    if (!okExt || !okMime) return cb(new Error('Only .xlsx Excel files are allowed'));
    cb(null, true);
  },
});

function rowToProduct(r) {
  return { id: r.id, cat: r.cat, kind: r.kind || undefined, name: r.name, desc: r.desc,
    price: r.price, unit: r.unit, img: r.img || '', badges: r.badges ? JSON.parse(r.badges) : [], origin: r.origin || '', inStock: r.in_stock !== 0 };
}
// Cost price is private business data: only the admin endpoints expose it, never the public menu.
function withCost(p, r) { p.costPrice = r.cost_price || 0; return p;
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY category_group, cat, name').all();
  res.json({
    freshItems: rows.filter(r => r.category_group === 'fresh').map(rowToProduct),
    readyItems: rows.filter(r => r.category_group === 'ready').map(rowToProduct),
    groceryItems: rows.filter(r => r.category_group === 'groceries').map(rowToProduct),
  });
});

// Admin view of the catalog, including private cost prices (used by admin.html and the reports).
router.get('/admin/list', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY category_group, cat, name').all();
  res.set('Cache-Control', 'no-store');
  res.json({ products: rows.map(r => Object.assign(withCost(rowToProduct(r), r), { category_group: r.category_group })) });
});

// Create or update a product. multipart/form-data with an optional "image" file field
// plus the usual text fields — this is what both "Save Item" and a photo upload in the
// admin tool hit. JSON body (no file) still works for scripted/API use.
router.post('/', requireAdmin, upload.single('image'), (req, res) => {
  const { id, category_group, cat, kind, name, desc, price, unit, origin } = req.body;
  const cost_price = Math.max(0, Math.round(Number(req.body.cost_price) || 0));
  let { img } = req.body;
  let badges = req.body.badges;
  if (typeof badges === 'string') { try { badges = JSON.parse(badges); } catch (e) { badges = badges.split(',').map(s => s.trim()).filter(Boolean); } }
  if (!id || !category_group || !cat || !name || !price || !unit) return res.status(400).json({ error: 'id, category_group, cat, name, price, and unit are required' });
  if (!['fresh', 'ready', 'groceries'].includes(category_group)) return res.status(400).json({ error: "category_group must be 'fresh', 'ready', or 'groceries'" });
  if (req.file) img = `/uploads/${req.file.filename}`; // an uploaded file always wins over a plain img string
  db.prepare(`
    INSERT INTO products (id, category_group, cat, kind, name, desc, price, unit, img, badges, origin, cost_price, updated_at)
    VALUES (@id, @category_group, @cat, @kind, @name, @desc, @price, @unit, @img, @badges, @origin, @cost_price, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET category_group=excluded.category_group, cat=excluded.cat, kind=excluded.kind,
      name=excluded.name, desc=excluded.desc, price=excluded.price, unit=excluded.unit, img=excluded.img,
      badges=excluded.badges, origin=excluded.origin, cost_price=excluded.cost_price, updated_at=datetime('now')
  `).run({ id, category_group, cat, kind: kind || null, name, desc: desc || '', price, unit, img: img || '', badges: JSON.stringify(badges || []), origin: origin || '', cost_price });
  const saved = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  res.json({ ok: true, product: withCost(rowToProduct(saved), saved) });
});

// Staff mark an item sold out / back in stock (no price or wording changes — that stays admin-only).
router.patch('/:id/stock', requireStaff, (req, res) => {
  const inStock = req.body && req.body.inStock ? 1 : 0;
  const result = db.prepare("UPDATE products SET in_stock = ?, updated_at = datetime('now') WHERE id = ?").run(inStock, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Product not found' });
  res.json({ ok: true, inStock: !!inStock });
});

router.delete('/:id', requireAdmin, (req, res) => {
  const result = db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Product not found' });
  res.json({ ok: true });
});

// ---------- bulk Excel export/import ----------
// One sheet, one row per product, columns matching exactly what the product form and
// the database both use — so a round trip (export, edit in Excel, re-import) is lossless.
const EXCEL_COLUMNS = ['id', 'category_group', 'cat', 'kind', 'name', 'desc', 'price', 'unit', 'img', 'badges', 'origin', 'cost_price'];

router.get('/export.xlsx', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY category_group, cat, name').all();
  const sheetRows = rows.map(r => ({
    id: r.id, category_group: r.category_group, cat: r.cat, kind: r.kind || '',
    name: r.name, desc: r.desc || '', price: r.price, unit: r.unit, img: r.img || '',
    badges: r.badges ? JSON.parse(r.badges).join(', ') : '', origin: r.origin || '', cost_price: r.cost_price || 0,
  }));
  const sheet = XLSX.utils.json_to_sheet(sheetRows, { header: EXCEL_COLUMNS });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Products');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="azizo-products.xlsx"');
  res.send(buffer);
});

router.post('/import.xlsx', requireAdmin, uploadExcel.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded — pick an .xlsx file first' });
  let rows;
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
  } catch (e) {
    return res.status(400).json({ error: "Couldn't read that file as an Excel spreadsheet: " + e.message });
  }

  const errors = [];
  const upsert = db.prepare(`
    INSERT INTO products (id, category_group, cat, kind, name, desc, price, unit, img, badges, origin, cost_price, updated_at)
    VALUES (@id, @category_group, @cat, @kind, @name, @desc, @price, @unit, @img, @badges, @origin, @cost_price, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET category_group=excluded.category_group, cat=excluded.cat, kind=excluded.kind,
      name=excluded.name, desc=excluded.desc, price=excluded.price, unit=excluded.unit, img=excluded.img,
      badges=excluded.badges, origin=excluded.origin, cost_price=excluded.cost_price, updated_at=datetime('now')
  `);
  let imported = 0;
  const importAll = db.transaction(() => {
    rows.forEach((row, i) => {
      const rowNum = i + 2; // +1 for header, +1 for 1-indexing
      const id = String(row.id || '').trim();
      const category_group = String(row.category_group || '').trim();
      const cat = String(row.cat || '').trim();
      const name = String(row.name || '').trim();
      const price = Number(row.price);
      const unit = String(row.unit || '').trim();
      if (!id || !category_group || !cat || !name || !price || !unit) {
        errors.push(`Row ${rowNum}: missing id, category_group, cat, name, price, or unit — skipped`);
        return;
      }
      if (!['fresh', 'ready', 'groceries'].includes(category_group)) {
        errors.push(`Row ${rowNum} ("${name}"): category_group must be "fresh", "ready", or "groceries" — skipped`);
        return;
      }
      const badgesArr = String(row.badges || '').split(',').map(s => s.trim()).filter(Boolean);
      upsert.run({
        id, category_group, cat, kind: String(row.kind || '').trim() || null, name,
        desc: String(row.desc || ''), price, unit, img: String(row.img || ''),
        badges: JSON.stringify(badgesArr), origin: String(row.origin || ''),
        cost_price: Math.max(0, Math.round(Number(row.cost_price) || 0)),
      });
      imported++;
    });
  });
  importAll();
  res.json({ ok: true, imported, skipped: errors.length, errors });
});

module.exports = router;
