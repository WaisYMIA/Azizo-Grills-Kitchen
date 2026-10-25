<?php
// Cooking hub API (mirrors the Node backend), routed by .htaccess to ?p=<path after /api/recipes>
//   GET  /api/recipes                        public list + categories
//   GET  /api/recipes/:id/comments           public approved comments
//   POST /api/recipes/:id/comments           reader comment / reply
//   POST /api/recipes/submit                 reader recipe / question
//   admin (Bearer admin token): /admin/all, POST /admin, PUT|DELETE|GET /admin/:id, /admin/bulk, /admin/export, /admin/import,
//   /admin/settings, /admin/categories[/:id], /admin/comments[/:id|/bulk|/:id/reply], /admin/submissions[/:id]
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();
$pdo = get_db();
header('Cache-Control: no-store');
$method = $_SERVER['REQUEST_METHOD'];
$parts = array_values(array_filter(explode('/', trim((string)($_GET['p'] ?? ''), '/')), fn($x) => $x !== ''));

$clean = fn($v, $max) => mb_substr(trim(preg_replace('/[\x00-\x08\x0b\x0c\x0e-\x1f]/', ' ', (string)($v ?? ''))), 0, $max);
$lines = fn($t) => array_values(array_filter(array_map('trim', preg_split('/\r?\n/', (string)$t)), fn($x) => $x !== ''));
$slugify = function ($t) { $s = trim(preg_replace('/[^a-z0-9]+/', '-', strtolower((string)$t)), '-'); return substr($s, 0, 80) ?: 'recipe'; };
$one = function ($sql, $args = []) use ($pdo) { $q = $pdo->prepare($sql); $q->execute($args); return $q->fetch(); };
$run = function ($sql, $args = []) use ($pdo) { $q = $pdo->prepare($sql); $q->execute($args); return $q; };
$setting = fn($k) => ($r = $one('SELECT svalue FROM site_settings WHERE skey = ?', [$k])) ? $r['svalue'] : null;
$autoApprove = fn() => $setting('recipes_autoapprove') === '1';
$cats = fn() => array_map(fn($c) => ['id' => (int)$c['id'], 'name' => $c['name'], 'icon' => $c['icon'], 'sort' => (int)$c['sort_order']], $pdo->query('SELECT * FROM recipe_cats ORDER BY sort_order, name')->fetchAll());
$stats = function () use ($pdo) {
    $m = [];
    foreach ($pdo->query("SELECT recipe_id, COUNT(*) AS c, SUM(CASE WHEN rating > 0 THEN 1 ELSE 0 END) AS n, AVG(CASE WHEN rating > 0 THEN rating END) AS a FROM recipe_comments WHERE status = 'approved' AND is_staff = 0 GROUP BY recipe_id")->fetchAll() as $x) $m[(int)$x['recipe_id']] = $x;
    return $m;
};
$shape = function ($r, $st = null) use ($lines) {
    return ['id' => (int)$r['id'], 'kind' => $r['kind'], 'slug' => $r['slug'], 'title' => $r['title'], 'category' => $r['category'], 'style' => $r['style'], 'cuisine' => $r['cuisine'], 'difficulty' => $r['difficulty'],
        'prep' => (int)$r['prep_min'], 'cook' => (int)$r['cook_min'], 'servings' => (int)$r['servings'], 'summary' => $r['summary'], 'ingredients' => $lines($r['ingredients']), 'steps' => $lines($r['steps']),
        'tips' => (string)$r['tips'], 'body' => (string)$r['body'], 'tags' => $r['tags'], 'badge' => $r['badge'], 'image' => $r['image'], 'featured' => (bool)$r['featured'], 'status' => $r['status'],
        'date' => $r['created_at'], 'updated' => $r['updated_at'],
        'ratingAvg' => ($st && (int)$st['n']) ? round((float)$st['a'], 1) : 0, 'ratingCount' => $st ? (int)$st['n'] : 0, 'commentCount' => $st ? (int)$st['c'] : 0];
};
$limit = function () {
    $file = sys_get_temp_dir() . '/azizo_rec_' . md5($_SERVER['REMOTE_ADDR'] ?? 'x') . '.json';
    $now = time(); $hits = is_file($file) ? (json_decode((string)@file_get_contents($file), true) ?: []) : [];
    $hits = array_values(array_filter($hits, fn($t) => $now - $t < 3600));
    if (count($hits) >= 8) json_error('Too many posts - please try again later', 429);
    $hits[] = $now; @file_put_contents($file, json_encode($hits));
};
$input = function ($b, $e = null) use ($clean) {
    $e = $e ?: [];
    $pick = function ($k, $max, $def) use ($b, $e, $clean) { return array_key_exists($k, $b) ? $clean($b[$k], $max) : ($e[$k] ?? $def); };
    $arr = function ($k) use ($b, $e, $clean) {
        if (!array_key_exists($k, $b)) return $e[$k] ?? '';
        $v = is_array($b[$k]) ? $b[$k] : preg_split('/\r?\n/', (string)$b[$k]);
        return implode("\n", array_values(array_filter(array_map(fn($x) => $clean($x, 400), $v), fn($x) => $x !== '')));
    };
    $num = fn($k, $def) => array_key_exists($k, $b) ? max(0, min(5000, (int)$b[$k])) : (int)($e[$k] ?? $def);
    $kind = array_key_exists('kind', $b) ? ($b['kind'] === 'article' ? 'article' : 'recipe') : ($e['kind'] ?? 'recipe');
    $status = array_key_exists('status', $b) ? ($b['status'] === 'published' ? 'published' : 'draft') : ($e['status'] ?? 'draft');
    $image = $pick('image', 300, '');
    if ($image !== '' && !preg_match('#^(/uploads/|https?://|[A-Za-z0-9_.\-/]+\.(jpg|jpeg|png|webp|svg)$)#i', $image)) return ['error' => 'Image must be an uploaded file or a web address'];
    return ['v' => ['kind' => $kind, 'title' => $pick('title', 140, ''), 'category' => $pick('category', 60, ''), 'style' => $pick('style', 40, ''), 'cuisine' => $pick('cuisine', 40, ''), 'difficulty' => $pick('difficulty', 20, ''),
        'prep_min' => $num('prep', $e['prep_min'] ?? 0), 'cook_min' => $num('cook', $e['cook_min'] ?? 0), 'servings' => $num('servings', $e['servings'] ?? 0),
        'summary' => $pick('summary', 400, ''), 'ingredients' => $arr('ingredients'), 'steps' => $arr('steps'), 'tips' => $pick('tips', 1000, ''),
        'body' => array_key_exists('body', $b) ? mb_substr((string)$b['body'], 0, 30000) : ($e['body'] ?? ''),
        'tags' => $pick('tags', 200, ''), 'badge' => $pick('badge', 40, ''), 'image' => $image,
        'featured' => array_key_exists('featured', $b) ? (!empty($b['featured']) ? 1 : 0) : (int)($e['featured'] ?? 0), 'status' => $status]];
};
$uniqueSlug = function ($want, $selfId = 0) use ($slugify, $one) {
    $base = $slugify($want); $s = $base; $n = 1;
    while ($one('SELECT id FROM recipes WHERE slug = ? AND id != ?', [$s, $selfId])) { $n++; $s = $base . '-' . $n; }
    return $s;
};
$COLS = ['kind', 'title', 'category', 'style', 'cuisine', 'difficulty', 'prep_min', 'cook_min', 'servings', 'summary', 'ingredients', 'steps', 'tips', 'body', 'tags', 'badge', 'image', 'featured', 'status'];
$insert = function ($v, $slug, $date = null) use ($pdo, $COLS) {
    $when = $date ? (substr((string)$date, 0, 10) . ' 00:00:00') : date('Y-m-d H:i:s');
    $pdo->prepare('INSERT INTO recipes (slug, ' . implode(', ', $COLS) . ', created_at, updated_at) VALUES (?, ' . implode(', ', array_fill(0, count($COLS), '?')) . ', ?, ?)')
        ->execute(array_merge([$slug], array_map(fn($c) => $v[$c], $COLS), [$when, date('Y-m-d H:i:s')]));
    return (int)$pdo->lastInsertId();
};
$update = function ($id, $slug, $v) use ($pdo, $COLS) {
    $pdo->prepare('UPDATE recipes SET slug = ?, ' . implode(', ', array_map(fn($c) => "$c = ?", $COLS)) . ', updated_at = ? WHERE id = ?')
        ->execute(array_merge([$slug], array_map(fn($c) => $v[$c], $COLS), [date('Y-m-d H:i:s'), $id]));
};

// ---------- public ----------
if ($parts === [] && $method === 'GET') {
    $st = $stats();
    $rows = $pdo->query("SELECT * FROM recipes WHERE status = 'published' ORDER BY featured DESC, id DESC")->fetchAll();
    json_response(['categories' => $cats(), 'settings' => ['autoApprove' => $autoApprove()], 'recipes' => array_map(fn($r) => $shape($r, $st[(int)$r['id']] ?? null), $rows)]);
}
if (count($parts) === 1 && $parts[0] === 'submit' && $method === 'POST') {
    $limit(); $b = read_json_body();
    if (!empty($b['website'])) json_response(['ok' => true], 201);
    $kind = in_array($b['kind'] ?? '', ['recipe', 'question', 'feedback'], true) ? $b['kind'] : 'recipe';
    $name = $clean($b['name'] ?? '', 60); $msg = $clean($b['message'] ?? '', 6000);
    if (mb_strlen($name) < 2) json_error('Please enter your name');
    if (mb_strlen($msg) < 5) json_error('Please write your message or recipe');
    $run('INSERT INTO recipe_submissions (kind, name, contact, title, message) VALUES (?, ?, ?, ?, ?)', [$kind, $name, $clean($b['contact'] ?? '', 80), $clean($b['title'] ?? '', 140), $msg]);
    json_response(['ok' => true, 'message' => 'Thank you! We have received it and will be in touch if we need more.'], 201);
}
if (count($parts) === 2 && ctype_digit($parts[0]) && $parts[1] === 'comments') {
    $rid = (int)$parts[0];
    if ($method === 'GET') {
        $rows = $run("SELECT id, parent_id, name, comment, rating, is_staff, created_at FROM recipe_comments WHERE recipe_id = ? AND status = 'approved' ORDER BY id", [$rid])->fetchAll();
        json_response(['comments' => array_map(fn($c) => ['id' => (int)$c['id'], 'parentId' => (int)$c['parent_id'], 'name' => $c['name'], 'comment' => $c['comment'], 'rating' => (int)$c['rating'], 'staff' => (bool)$c['is_staff'], 'date' => $c['created_at']], $rows)]);
    }
    if ($method === 'POST') {
        $limit(); $b = read_json_body();
        if (!empty($b['website'])) json_response(['ok' => true, 'message' => 'Thank you!'], 201);
        if (!$one("SELECT id FROM recipes WHERE id = ? AND status = 'published'", [$rid])) json_error('Recipe not found', 404);
        $name = $clean($b['name'] ?? '', 50); $comment = $clean($b['comment'] ?? '', 1200);
        if (mb_strlen($name) < 2) json_error('Please enter your name');
        if (mb_strlen($comment) < 2) json_error('Please write a comment');
        if (preg_match_all('#https?://|www\.#i', $comment) > 1) json_error('Please keep links out of comments');
        $parent = 0; $rating = 0;
        if (!empty($b['parentId'])) {
            $p = $one('SELECT id, parent_id FROM recipe_comments WHERE id = ? AND recipe_id = ?', [(int)$b['parentId'], $rid]);
            if (!$p) json_error('The comment you are replying to was not found');
            $parent = (int)($p['parent_id'] ?: $p['id']);
        } else $rating = max(0, min(5, (int)($b['rating'] ?? 0)));
        $status = $autoApprove() ? 'approved' : 'pending';
        $run('INSERT INTO recipe_comments (recipe_id, parent_id, name, comment, rating, status) VALUES (?, ?, ?, ?, ?, ?)', [$rid, $parent, $name, $comment, $rating, $status]);
        json_response(['ok' => true, 'status' => $status, 'message' => $status === 'approved' ? 'Thanks! Your comment is live.' : 'Thanks! Your comment will appear once we have checked it.'], 201);
    }
}

// ---------- admin ----------
if (($parts[0] ?? '') !== 'admin') json_error('Not found', 404);
require_admin();
array_shift($parts);
$a = $parts[0] ?? ''; $b2 = $parts[1] ?? ''; $b3 = $parts[2] ?? '';
$body = in_array($method, ['POST', 'PUT', 'PATCH'], true) ? read_json_body() : [];

if ($a === 'all' && $method === 'GET') {
    $st = $stats(); $pm = [];
    foreach ($pdo->query("SELECT recipe_id, COUNT(*) AS n FROM recipe_comments WHERE status = 'pending' GROUP BY recipe_id")->fetchAll() as $x) $pm[(int)$x['recipe_id']] = (int)$x['n'];
    $rows = $pdo->query('SELECT * FROM recipes ORDER BY id DESC')->fetchAll();
    json_response(['categories' => $cats(), 'settings' => ['autoApprove' => $autoApprove()],
        'pending' => ['comments' => (int)$pdo->query("SELECT COUNT(*) FROM recipe_comments WHERE status = 'pending'")->fetchColumn(), 'submissions' => (int)$pdo->query("SELECT COUNT(*) FROM recipe_submissions WHERE status = 'new'")->fetchColumn()],
        'recipes' => array_map(fn($r) => $shape($r, $st[(int)$r['id']] ?? null) + ['pendingComments' => $pm[(int)$r['id']] ?? 0], $rows)]);
}
if ($a === 'settings' && $method === 'POST') {
    $run('REPLACE INTO site_settings (skey, svalue) VALUES (?, ?)', ['recipes_autoapprove', !empty($body['autoApprove']) ? '1' : '0']);
    json_response(['ok' => true]);
}
if ($a === '' && $method === 'POST') {
    $p = $input($body); if (isset($p['error'])) json_error($p['error']);
    if ($p['v']['title'] === '') json_error('Give it a title');
    json_response(['ok' => true, 'id' => $insert($p['v'], $uniqueSlug($body['slug'] ?? $p['v']['title']))], 201);
}
if ($a === 'bulk' && $method === 'POST') {
    $ids = array_values(array_filter(array_map('intval', (array)($body['ids'] ?? [])), fn($x) => $x > 0));
    if (!$ids) json_error('Nothing selected');
    $act = $body['action'] ?? ''; $now = date('Y-m-d H:i:s');
    foreach ($ids as $id) {
        if ($act === 'publish') $run("UPDATE recipes SET status = 'published', updated_at = ? WHERE id = ?", [$now, $id]);
        elseif ($act === 'draft') $run("UPDATE recipes SET status = 'draft', updated_at = ? WHERE id = ?", [$now, $id]);
        elseif ($act === 'feature') $run('UPDATE recipes SET featured = 1 WHERE id = ?', [$id]);
        elseif ($act === 'unfeature') $run('UPDATE recipes SET featured = 0 WHERE id = ?', [$id]);
        elseif ($act === 'category') $run('UPDATE recipes SET category = ?, updated_at = ? WHERE id = ?', [$clean($body['category'] ?? '', 60), $now, $id]);
        elseif ($act === 'delete') { $run('DELETE FROM recipe_comments WHERE recipe_id = ?', [$id]); $run('DELETE FROM recipes WHERE id = ?', [$id]); }
        else json_error('Unknown action');
    }
    json_response(['ok' => true, 'count' => count($ids)]);
}
if ($a === 'export' && $method === 'GET') {
    json_response(['categories' => $cats(), 'recipes' => array_map(fn($r) => $shape($r), $pdo->query('SELECT * FROM recipes ORDER BY id')->fetchAll())]);
}
if ($a === 'import' && $method === 'POST') {
    if (!isset($body['recipes']) || !is_array($body['recipes'])) json_error('Choose a recipes export file');
    $added = 0; $updated = 0;
    foreach ((array)($body['categories'] ?? []) as $c) if (!empty($c['name'])) $run('INSERT IGNORE INTO recipe_cats (name, icon, sort_order) VALUES (?, ?, ?)', [$clean($c['name'], 60), $clean($c['icon'] ?? '', 8), (int)($c['sort'] ?? 0)]);
    foreach ($body['recipes'] as $r) {
        $p = $input($r); if (isset($p['error']) || $p['v']['title'] === '') continue;
        $ex = !empty($r['slug']) ? $one('SELECT * FROM recipes WHERE slug = ?', [(string)$r['slug']]) : null;
        if ($ex) { $update((int)$ex['id'], $ex['slug'], $p['v']); $updated++; }
        else { $insert($p['v'], $uniqueSlug($r['slug'] ?? $p['v']['title']), $r['date'] ?? null); $added++; }
    }
    json_response(['ok' => true, 'added' => $added, 'updated' => $updated]);
}
if ($a === 'categories') {
    if ($method === 'POST' && $b2 === '') {
        $name = $clean($body['name'] ?? '', 60); if ($name === '') json_error('Enter a category name');
        if ($one('SELECT 1 FROM recipe_cats WHERE name = ?', [$name])) json_error('That category already exists', 409);
        $next = (int)$pdo->query('SELECT COALESCE(MAX(sort_order), 0) FROM recipe_cats')->fetchColumn() + 1;
        $run('INSERT INTO recipe_cats (name, icon, sort_order) VALUES (?, ?, ?)', [$name, $clean($body['icon'] ?? '', 8), $next]);
        json_response(['ok' => true], 201);
    }
    $c = ctype_digit($b2) ? $one('SELECT * FROM recipe_cats WHERE id = ?', [(int)$b2]) : null;
    if (!$c) json_error('Category not found', 404);
    if ($method === 'PATCH') {
        $name = array_key_exists('name', $body) ? $clean($body['name'], 60) : $c['name']; if ($name === '') json_error('Enter a name');
        if ($name !== $c['name'] && $one('SELECT 1 FROM recipe_cats WHERE name = ?', [$name])) json_error('That name is already used', 409);
        $run('UPDATE recipe_cats SET name = ?, icon = ?, sort_order = ? WHERE id = ?', [$name, array_key_exists('icon', $body) ? $clean($body['icon'], 8) : $c['icon'], array_key_exists('sort', $body) ? (int)$body['sort'] : (int)$c['sort_order'], (int)$c['id']]);
        if ($name !== $c['name']) $run('UPDATE recipes SET category = ? WHERE category = ?', [$name, $c['name']]);
        json_response(['ok' => true]);
    }
    if ($method === 'DELETE') {
        $n = (int)$one('SELECT COUNT(*) AS n FROM recipes WHERE category = ?', [$c['name']])['n'];
        if ($n) json_error("$n item(s) still use this category. Move them first.");
        $run('DELETE FROM recipe_cats WHERE id = ?', [(int)$c['id']]); json_response(['ok' => true]);
    }
}
if ($a === 'comments') {
    if ($b2 === '' && $method === 'GET') {
        $rows = $pdo->query('SELECT c.*, r.title AS recipe_title FROM recipe_comments c LEFT JOIN recipes r ON r.id = c.recipe_id ORDER BY c.id DESC LIMIT 500')->fetchAll();
        json_response(['comments' => array_map(fn($c) => ['id' => (int)$c['id'], 'recipeId' => (int)$c['recipe_id'], 'recipeTitle' => $c['recipe_title'] ?? '(deleted)', 'parentId' => (int)$c['parent_id'], 'name' => $c['name'], 'comment' => $c['comment'], 'rating' => (int)$c['rating'], 'status' => $c['status'], 'staff' => (bool)$c['is_staff'], 'date' => $c['created_at']], $rows)]);
    }
    if ($b2 === 'bulk' && $method === 'POST') {
        $ids = array_values(array_filter(array_map('intval', (array)($body['ids'] ?? [])), fn($x) => $x > 0)); $act = $body['action'] ?? '';
        if (!$ids || !in_array($act, ['approved', 'hidden', 'delete'], true)) json_error('Nothing to do');
        foreach ($ids as $id) { if ($act === 'delete') $run('DELETE FROM recipe_comments WHERE id = ? OR parent_id = ?', [$id, $id]); else $run('UPDATE recipe_comments SET status = ? WHERE id = ?', [$act, $id]); }
        json_response(['ok' => true]);
    }
    $c = ctype_digit($b2) ? $one('SELECT * FROM recipe_comments WHERE id = ?', [(int)$b2]) : null;
    if (!$c) json_error('Comment not found', 404);
    if ($b3 === 'reply' && $method === 'POST') {
        $text = $clean($body['comment'] ?? '', 1200); if ($text === '') json_error('Write a reply');
        $run("INSERT INTO recipe_comments (recipe_id, parent_id, name, comment, status, is_staff) VALUES (?, ?, 'Azizo Butchery', ?, 'approved', 1)", [(int)$c['recipe_id'], (int)($c['parent_id'] ?: $c['id']), $text]);
        if ($c['status'] === 'pending') $run("UPDATE recipe_comments SET status = 'approved' WHERE id = ?", [(int)$c['id']]);
        json_response(['ok' => true], 201);
    }
    if ($method === 'PATCH') {
        $status = array_key_exists('status', $body) ? (string)$body['status'] : $c['status'];
        if (!in_array($status, ['pending', 'approved', 'hidden'], true)) json_error('Status must be pending, approved or hidden');
        $run('UPDATE recipe_comments SET status = ?, comment = ? WHERE id = ?', [$status, array_key_exists('comment', $body) ? $clean($body['comment'], 1200) : $c['comment'], (int)$c['id']]);
        json_response(['ok' => true]);
    }
    if ($method === 'DELETE') { $run('DELETE FROM recipe_comments WHERE id = ? OR parent_id = ?', [(int)$c['id'], (int)$c['id']]); json_response(['ok' => true]); }
}
if ($a === 'submissions') {
    if ($b2 === '' && $method === 'GET') json_response(['submissions' => $pdo->query('SELECT * FROM recipe_submissions ORDER BY id DESC LIMIT 300')->fetchAll()]);
    if (ctype_digit($b2) && $method === 'PATCH') {
        $st = (string)($body['status'] ?? ''); if (!in_array($st, ['new', 'read', 'converted'], true)) json_error('Bad status');
        $run('UPDATE recipe_submissions SET status = ? WHERE id = ?', [$st, (int)$b2]); json_response(['ok' => true]);
    }
    if (ctype_digit($b2) && $method === 'DELETE') { $run('DELETE FROM recipe_submissions WHERE id = ?', [(int)$b2]); json_response(['ok' => true]); }
}
if (ctype_digit($a)) {
    $id = (int)$a; $r = $one('SELECT * FROM recipes WHERE id = ?', [$id]);
    if (!$r) json_error('Not found', 404);
    if ($method === 'GET') json_response($shape($r));
    if ($method === 'PUT') {
        $p = $input($body, $r); if (isset($p['error'])) json_error($p['error']);
        if ($p['v']['title'] === '') json_error('Give it a title');
        $slug = !empty($body['slug']) ? $uniqueSlug($body['slug'], $id) : $r['slug'];
        $update($id, $slug, $p['v']); json_response(['ok' => true, 'slug' => $slug]);
    }
    if ($method === 'DELETE') { $run('DELETE FROM recipe_comments WHERE recipe_id = ?', [$id]); $run('DELETE FROM recipes WHERE id = ?', [$id]); json_response(['ok' => true]); }
}
json_error('Not found', 404);
