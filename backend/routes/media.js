// Image library for recipes and blog posts (admin only). Images arrive as base64 data URLs (the admin page resizes them first).
const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();
const DIR = path.join(__dirname, '..', 'uploads', 'media');
const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp' };

router.use(requireAdmin);
router.get('/', (req, res) => {
  fs.mkdirSync(DIR, { recursive: true });
  const files = fs.readdirSync(DIR).filter(f => /\.(jpg|png|webp)$/i.test(f)).map(f => {
    const st = fs.statSync(path.join(DIR, f));
    return { file: f, url: '/uploads/media/' + f, size: st.size, modified: st.mtime.toISOString() };
  }).sort((a, b) => b.modified.localeCompare(a.modified));
  res.set('Cache-Control', 'no-store').json({ files });
});
router.post('/', (req, res) => {
  const b = req.body || {};
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.data || ''));
  if (!m) return res.status(400).json({ error: 'Upload a JPG, PNG or WebP image' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 3 * 1024 * 1024) return res.status(400).json({ error: 'Image is too large (max 3 MB)' });
  const ok = (m[1] === 'jpeg' && buf[0] === 0xFF && buf[1] === 0xD8) || (m[1] === 'png' && buf.slice(1, 4).toString() === 'PNG') || (m[1] === 'webp' && buf.slice(0, 4).toString() === 'RIFF');
  if (!ok) return res.status(400).json({ error: 'That file is not a valid image' });
  const base = String(b.name || 'image').replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image';
  fs.mkdirSync(DIR, { recursive: true });
  const file = `${base}-${Date.now().toString(36)}.${EXT[m[1]]}`;
  fs.writeFileSync(path.join(DIR, file), buf);
  res.status(201).json({ ok: true, file, url: '/uploads/media/' + file });
});
router.delete('/:file', (req, res) => {
  const f = path.basename(req.params.file);
  if (!/^[a-z0-9-]+\.(jpg|png|webp)$/i.test(f)) return res.status(400).json({ error: 'Bad file name' });
  try { fs.unlinkSync(path.join(DIR, f)); } catch (e) { return res.status(404).json({ error: 'File not found' }); }
  res.json({ ok: true });
});
module.exports = router;
