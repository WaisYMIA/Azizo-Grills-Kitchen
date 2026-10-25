// Cooking hub API: recipes + blog posts, categories, reader comments, reader submissions, import/export.
const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();
const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, max);
const lines = t => String(t || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const slugify = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'recipe';
const autoApprove = () => db.metaGet('recipes_autoapprove') === '1';

// Throttle reader posts per visitor (8 per hour across comments and submissions).
const hits = new Map();
function limiter(req, res, next) {
  const v = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || 'unknown', now = Date.now();
  const recent = (hits.get(v) || []).filter(t => now - t < 3600000);
  if (recent.length >= 8) return res.status(429).json({ error: 'Too many posts - please try again later' });
  recent.push(now); hits.set(v, recent); next();
}

const shape = (r, stats) => ({
  id: r.id, kind: r.kind, slug: r.slug, title: r.title, category: r.category, style: r.style, cuisine: r.cuisine, difficulty: r.difficulty,
  prep: r.prep_min, cook: r.cook_min, servings: r.servings, summary: r.summary, ingredients: lines(r.ingredients), steps: lines(r.steps),
  tips: r.tips, body: r.body, tags: r.tags, badge: r.badge, image: r.image, featured: !!r.featured, status: r.status,
  date: r.created_at, updated: r.updated_at,
  ratingAvg: stats && stats.n ? Math.round(stats.a * 10) / 10 : 0, ratingCount: stats ? stats.n : 0, commentCount: stats ? stats.c : 0
});
function statsMap() {
  const m = {};
  for (const x of db.prepare(`SELECT recipe_id, COUNT(*) AS c, SUM(CASE WHEN rating > 0 THEN 1 ELSE 0 END) AS n, AVG(CASE WHEN rating > 0 THEN rating END) AS a
    FROM recipe_comments WHERE status = 'approved' AND is_staff = 0 GROUP BY recipe_id`).all()) m[x.recipe_id] = x;
  return m;
}
const cats = () => db.prepare('SELECT id, name, icon, sort_order AS sort FROM recipe_cats ORDER BY sort_order, name').all();

function input(b, existing) {
  const e = existing || {};
  const pick = (k, max, def) => b[k] === undefined ? (e[k] !== undefined ? e[k] : def) : clean(b[k], max);
  const arr = k => Array.isArray(b[k]) ? b[k].map(x => clean(x, 400)).filter(Boolean).join('\n') : (b[k] === undefined ? e[k] || '' : String(b[k]).split(/\r?\n/).map(x => clean(x, 400)).filter(Boolean).join('\n'));
  const num = (k, def) => b[k] === undefined ? (e[k] !== undefined ? e[k] : def) : Math.max(0, Math.min(5000, parseInt(b[k], 10) || 0));
  const kind = b.kind === undefined ? (e.kind || 'recipe') : (b.kind === 'article' ? 'article' : 'recipe');
  const status = b.status === undefined ? (e.status || 'draft') : (b.status === 'published' ? 'published' : 'draft');
  const image = pick('image', 300, ''); if (image && !/^(\/uploads\/|https?:\/\/|[A-Za-z0-9_.\-\/]+\.(jpg|jpeg|png|webp|svg)$)/i.test(image)) return { error: 'Image must be an uploaded file or a web address' };
  return { v: {
    kind, title: pick('title', 140, ''), category: pick('category', 60, ''), style: pick('style', 40, ''), cuisine: pick('cuisine', 40, ''), difficulty: pick('difficulty', 20, ''),
    prep_min: num('prep', e.prep_min || 0), cook_min: num('cook', e.cook_min || 0), servings: num('servings', e.servings || 0),
    summary: pick('summary', 400, ''), ingredients: arr('ingredients'), steps: arr('steps'), tips: pick('tips', 1000, ''), body: b.body === undefined ? (e.body || '') : String(b.body).slice(0, 30000),
    tags: pick('tags', 200, ''), badge: pick('badge', 40, ''), image, featured: b.featured === undefined ? (e.featured ? 1 : 0) : (b.featured ? 1 : 0), status
  } };
}
function uniqueSlug(want, selfId) {
  let s = slugify(want), n = 1;
  while (db.prepare('SELECT id FROM recipes WHERE slug = ? AND id != ?').get(s, selfId || 0)) { n++; s = slugify(want) + '-' + n; }
  return s;
}
const COLS = ['kind', 'title', 'category', 'style', 'cuisine', 'difficulty', 'prep_min', 'cook_min', 'servings', 'summary', 'ingredients', 'steps', 'tips', 'body', 'tags', 'badge', 'image', 'featured', 'status'];
function insert(v, slug, date) {
  const r = db.prepare(`INSERT INTO recipes (slug, ${COLS.join(', ')}, created_at, updated_at) VALUES (?, ${COLS.map(() => '?').join(', ')}, COALESCE(?, datetime('now')), datetime('now'))`).run(slug, ...COLS.map(c => v[c]), date || null);
  return r.lastInsertRowid;
}

// ---------- public ----------
router.get('/', noStore, (req, res) => {
  const st = statsMap();
  const rows = db.prepare("SELECT * FROM recipes WHERE status = 'published' ORDER BY featured DESC, id DESC").all();
  res.json({ categories: cats(), settings: { autoApprove: autoApprove() }, recipes: rows.map(r => shape(r, st[r.id])) });
});
router.get('/:id(\\d+)/comments', noStore, (req, res) => {
  const rows = db.prepare("SELECT id, parent_id, name, comment, rating, is_staff, created_at FROM recipe_comments WHERE recipe_id = ? AND status = 'approved' ORDER BY id").all(req.params.id);
  res.json({ comments: rows.map(c => ({ id: c.id, parentId: c.parent_id, name: c.name, comment: c.comment, rating: c.rating, staff: !!c.is_staff, date: c.created_at })) });
});
router.post('/:id(\\d+)/comments', limiter, (req, res) => {
  const b = req.body || {};
  if (b.website) return res.status(201).json({ ok: true, message: 'Thank you!' }); // honeypot
  const r = db.prepare("SELECT id FROM recipes WHERE id = ? AND status = 'published'").get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Recipe not found' });
  const name = clean(b.name, 50), comment = clean(b.comment, 1200);
  if (name.length < 2) return res.status(400).json({ error: 'Please enter your name' });
  if (comment.length < 2) return res.status(400).json({ error: 'Please write a comment' });
  if (/https?:\/\/|www\./i.test(comment) && (comment.match(/https?:\/\/|www\./gi) || []).length > 1) return res.status(400).json({ error: 'Please keep links out of comments' });
  let parent = 0, rating = 0;
  if (b.parentId) {
    const p = db.prepare('SELECT id, parent_id FROM recipe_comments WHERE id = ? AND recipe_id = ?').get(b.parentId, r.id);
    if (!p) return res.status(400).json({ error: 'The comment you are replying to was not found' });
    parent = p.parent_id || p.id;
  } else rating = Math.max(0, Math.min(5, parseInt(b.rating, 10) || 0));
  const status = autoApprove() ? 'approved' : 'pending';
  db.prepare('INSERT INTO recipe_comments (recipe_id, parent_id, name, comment, rating, status) VALUES (?, ?, ?, ?, ?, ?)').run(r.id, parent, name, comment, rating, status);
  res.status(201).json({ ok: true, status, message: status === 'approved' ? 'Thanks! Your comment is live.' : 'Thanks! Your comment will appear once we have checked it.' });
});
router.post('/submit', limiter, (req, res) => {
  const b = req.body || {};
  if (b.website) return res.status(201).json({ ok: true });
  const kind = ['recipe', 'question', 'feedback'].includes(b.kind) ? b.kind : 'recipe';
  const name = clean(b.name, 60), message = clean(b.message, 6000);
  if (name.length < 2) return res.status(400).json({ error: 'Please enter your name' });
  if (message.length < 5) return res.status(400).json({ error: 'Please write your message or recipe' });
  db.prepare('INSERT INTO recipe_submissions (kind, name, contact, title, message) VALUES (?, ?, ?, ?, ?)').run(kind, name, clean(b.contact, 80), clean(b.title, 140), message);
  res.status(201).json({ ok: true, message: 'Thank you! We have received it and will be in touch if we need more.' });
});

// ---------- admin ----------
const admin = express.Router();
admin.use(requireAdmin, noStore);
admin.get('/all', (req, res) => {
  const st = statsMap();
  const pend = db.prepare("SELECT recipe_id, COUNT(*) AS n FROM recipe_comments WHERE status = 'pending' GROUP BY recipe_id").all();
  const pm = {}; pend.forEach(x => pm[x.recipe_id] = x.n);
  const rows = db.prepare('SELECT * FROM recipes ORDER BY id DESC').all();
  res.json({ categories: cats(), settings: { autoApprove: autoApprove() },
    pending: { comments: db.prepare("SELECT COUNT(*) AS n FROM recipe_comments WHERE status = 'pending'").get().n, submissions: db.prepare("SELECT COUNT(*) AS n FROM recipe_submissions WHERE status = 'new'").get().n },
    recipes: rows.map(r => Object.assign(shape(r, st[r.id]), { pendingComments: pm[r.id] || 0 })) });
});
admin.post('/settings', (req, res) => { db.metaSet('recipes_autoapprove', req.body && req.body.autoApprove ? '1' : '0'); res.json({ ok: true }); });
admin.post('/', (req, res) => {
  const p = input(req.body || {}); if (p.error) return res.status(400).json({ error: p.error });
  if (!p.v.title) return res.status(400).json({ error: 'Give it a title' });
  const id = insert(p.v, uniqueSlug((req.body || {}).slug || p.v.title));
  res.status(201).json({ ok: true, id });
});
admin.post('/bulk', (req, res) => {
  const b = req.body || {}; const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isInteger);
  if (!ids.length) return res.status(400).json({ error: 'Nothing selected' });
  const run = (sql, ...a) => db.transaction(() => ids.forEach(id => db.prepare(sql).run(...a, id)))();
  if (b.action === 'publish') run("UPDATE recipes SET status = 'published', updated_at = datetime('now') WHERE id = ?");
  else if (b.action === 'draft') run("UPDATE recipes SET status = 'draft', updated_at = datetime('now') WHERE id = ?");
  else if (b.action === 'feature') run('UPDATE recipes SET featured = 1 WHERE id = ?');
  else if (b.action === 'unfeature') run('UPDATE recipes SET featured = 0 WHERE id = ?');
  else if (b.action === 'category') run("UPDATE recipes SET category = ?, updated_at = datetime('now') WHERE id = ?", clean(b.category, 60));
  else if (b.action === 'delete') db.transaction(() => ids.forEach(id => { db.prepare('DELETE FROM recipe_comments WHERE recipe_id = ?').run(id); db.prepare('DELETE FROM recipes WHERE id = ?').run(id); }))();
  else return res.status(400).json({ error: 'Unknown action' });
  res.json({ ok: true, count: ids.length });
});
admin.get('/export', (req, res) => {
  const rows = db.prepare('SELECT * FROM recipes ORDER BY id').all();
  res.json({ categories: cats(), recipes: rows.map(r => shape(r)) });
});
admin.post('/import', (req, res) => {
  const list = Array.isArray(req.body && req.body.recipes) ? req.body.recipes : null;
  if (!list) return res.status(400).json({ error: 'Choose a recipes export file' });
  let added = 0, updated = 0;
  db.transaction(() => {
    for (const c of (req.body.categories || [])) if (c && c.name) db.prepare('INSERT OR IGNORE INTO recipe_cats (name, icon, sort_order) VALUES (?, ?, ?)').run(clean(c.name, 60), clean(c.icon, 8), parseInt(c.sort, 10) || 0);
    for (const r of list) {
      const p = input(r); if (p.error || !p.v.title) continue;
      const ex = r.slug ? db.prepare('SELECT * FROM recipes WHERE slug = ?').get(String(r.slug)) : null;
      if (ex) { db.prepare(`UPDATE recipes SET ${COLS.map(c => c + ' = ?').join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...COLS.map(c => p.v[c]), ex.id); updated++; }
      else { insert(p.v, uniqueSlug(r.slug || p.v.title), r.date); added++; }
    }
  })();
  res.json({ ok: true, added, updated });
});
// categories
admin.post('/categories', (req, res) => {
  const name = clean((req.body || {}).name, 60); if (!name) return res.status(400).json({ error: 'Enter a category name' });
  if (db.prepare('SELECT 1 FROM recipe_cats WHERE name = ?').get(name)) return res.status(409).json({ error: 'That category already exists' });
  const next = (db.prepare('SELECT MAX(sort_order) AS m FROM recipe_cats').get().m || 0) + 1;
  db.prepare('INSERT INTO recipe_cats (name, icon, sort_order) VALUES (?, ?, ?)').run(name, clean(req.body.icon, 8), next);
  res.status(201).json({ ok: true });
});
admin.patch('/categories/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM recipe_cats WHERE id = ?').get(req.params.id); if (!c) return res.status(404).json({ error: 'Category not found' });
  const b = req.body || {}; const name = b.name === undefined ? c.name : clean(b.name, 60); if (!name) return res.status(400).json({ error: 'Enter a name' });
  if (name !== c.name && db.prepare('SELECT 1 FROM recipe_cats WHERE name = ?').get(name)) return res.status(409).json({ error: 'That name is already used' });
  db.transaction(() => {
    db.prepare('UPDATE recipe_cats SET name = ?, icon = ?, sort_order = ? WHERE id = ?').run(name, b.icon === undefined ? c.icon : clean(b.icon, 8), b.sort === undefined ? c.sort_order : parseInt(b.sort, 10) || 0, c.id);
    if (name !== c.name) db.prepare('UPDATE recipes SET category = ? WHERE category = ?').run(name, c.name);
  })();
  res.json({ ok: true });
});
admin.delete('/categories/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM recipe_cats WHERE id = ?').get(req.params.id); if (!c) return res.status(404).json({ error: 'Category not found' });
  const n = db.prepare('SELECT COUNT(*) AS n FROM recipes WHERE category = ?').get(c.name).n;
  if (n) return res.status(400).json({ error: `${n} item(s) still use this category. Move them first.` });
  db.prepare('DELETE FROM recipe_cats WHERE id = ?').run(c.id); res.json({ ok: true });
});
// comments
admin.get('/comments', (req, res) => {
  const rows = db.prepare('SELECT c.*, r.title AS recipe_title FROM recipe_comments c LEFT JOIN recipes r ON r.id = c.recipe_id ORDER BY c.id DESC LIMIT 500').all();
  res.json({ comments: rows.map(c => ({ id: c.id, recipeId: c.recipe_id, recipeTitle: c.recipe_title || '(deleted)', parentId: c.parent_id, name: c.name, comment: c.comment, rating: c.rating, status: c.status, staff: !!c.is_staff, date: c.created_at })) });
});
admin.post('/comments/:id/reply', (req, res) => {
  const c = db.prepare('SELECT * FROM recipe_comments WHERE id = ?').get(req.params.id); if (!c) return res.status(404).json({ error: 'Comment not found' });
  const text = clean((req.body || {}).comment, 1200); if (!text) return res.status(400).json({ error: 'Write a reply' });
  db.prepare('INSERT INTO recipe_comments (recipe_id, parent_id, name, comment, status, is_staff) VALUES (?, ?, ?, ?, ?, 1)').run(c.recipe_id, c.parent_id || c.id, 'Azizo Butchery', text, 'approved');
  if (c.status === 'pending') db.prepare("UPDATE recipe_comments SET status = 'approved' WHERE id = ?").run(c.id);
  res.status(201).json({ ok: true });
});
admin.patch('/comments/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM recipe_comments WHERE id = ?').get(req.params.id); if (!c) return res.status(404).json({ error: 'Comment not found' });
  const b = req.body || {}; const status = b.status === undefined ? c.status : String(b.status);
  if (!['pending', 'approved', 'hidden'].includes(status)) return res.status(400).json({ error: 'Status must be pending, approved or hidden' });
  db.prepare('UPDATE recipe_comments SET status = ?, comment = ? WHERE id = ?').run(status, b.comment === undefined ? c.comment : clean(b.comment, 1200), c.id); res.json({ ok: true });
});
admin.post('/comments/bulk', (req, res) => {
  const b = req.body || {}; const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isInteger);
  if (!ids.length || !['approved', 'hidden', 'delete'].includes(b.action)) return res.status(400).json({ error: 'Nothing to do' });
  db.transaction(() => ids.forEach(id => b.action === 'delete' ? db.prepare('DELETE FROM recipe_comments WHERE id = ? OR parent_id = ?').run(id, id) : db.prepare('UPDATE recipe_comments SET status = ? WHERE id = ?').run(b.action, id)))();
  res.json({ ok: true });
});
admin.delete('/comments/:id', (req, res) => { db.prepare('DELETE FROM recipe_comments WHERE id = ? OR parent_id = ?').run(req.params.id, req.params.id); res.json({ ok: true }); });
// submissions
admin.get('/submissions', (req, res) => res.json({ submissions: db.prepare('SELECT * FROM recipe_submissions ORDER BY id DESC LIMIT 300').all() }));
admin.patch('/submissions/:id', (req, res) => {
  const st = String((req.body || {}).status || ''); if (!['new', 'read', 'converted'].includes(st)) return res.status(400).json({ error: 'Bad status' });
  db.prepare('UPDATE recipe_submissions SET status = ? WHERE id = ?').run(st, req.params.id); res.json({ ok: true });
});
admin.delete('/submissions/:id', (req, res) => { db.prepare('DELETE FROM recipe_submissions WHERE id = ?').run(req.params.id); res.json({ ok: true }); });
// single item (after the fixed paths above)
admin.get('/:id(\\d+)', (req, res) => { const r = db.prepare('SELECT * FROM recipes WHERE id = ?').get(req.params.id); if (!r) return res.status(404).json({ error: 'Not found' }); res.json(shape(r)); });
admin.put('/:id(\\d+)', (req, res) => {
  const r = db.prepare('SELECT * FROM recipes WHERE id = ?').get(req.params.id); if (!r) return res.status(404).json({ error: 'Not found' });
  const p = input(req.body || {}, r); if (p.error) return res.status(400).json({ error: p.error });
  if (!p.v.title) return res.status(400).json({ error: 'Give it a title' });
  const slug = (req.body || {}).slug ? uniqueSlug(req.body.slug, r.id) : r.slug;
  db.prepare(`UPDATE recipes SET slug = ?, ${COLS.map(c => c + ' = ?').join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(slug, ...COLS.map(c => p.v[c]), r.id);
  res.json({ ok: true, slug });
});
admin.delete('/:id(\\d+)', (req, res) => {
  db.transaction(() => { db.prepare('DELETE FROM recipe_comments WHERE recipe_id = ?').run(req.params.id); db.prepare('DELETE FROM recipes WHERE id = ?').run(req.params.id); })();
  res.json({ ok: true });
});
router.use('/admin', admin);
module.exports = router;
