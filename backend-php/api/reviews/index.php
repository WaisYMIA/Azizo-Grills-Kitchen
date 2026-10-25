<?php
// Verified reviews, routed by .htaccess:
//   GET    /api/reviews        public - approved reviews + average
//   POST   /api/reviews        customer - order number + phone, completed orders only, one per order
//   GET    /api/reviews/all    admin
//   PATCH  /api/reviews/:id    admin - {status: pending|approved|hidden, reply}
//   DELETE /api/reviews/:id    admin
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();
$pdo = get_db();
header('Cache-Control: no-store');
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$rid = (int)($_GET['id'] ?? 0);
$last9 = fn($s) => substr(preg_replace('/\D/', '', (string)$s), -9);
$clean = fn($v, $max) => mb_substr(trim(preg_replace('/[\x00-\x1f]/', ' ', (string)($v ?? ''))), 0, $max);
$pub = fn($r) => ['id' => (int)$r['id'], 'name' => $r['name'] ?: 'Customer', 'rating' => (int)$r['rating'], 'comment' => $r['comment'] ?? '',
    'photo' => $r['photo'] ?? '', 'branch' => $r['branch'] ?? '', 'reply' => $r['reply'] ?? '', 'date' => $r['created_at']];

if ($method === 'GET' && $action === 'all') {
    require_admin();
    $rows = $pdo->query('SELECT r.*, o.customer_phone, o.total FROM reviews r LEFT JOIN orders o ON o.id = r.order_id ORDER BY r.id DESC LIMIT 300')->fetchAll();
    json_response(['reviews' => array_map(fn($r) => $pub($r) + ['orderId' => (int)$r['order_id'], 'status' => $r['status'], 'phone' => $r['customer_phone'] ?? '', 'total' => (int)($r['total'] ?? 0)], $rows)]);
}
if ($method === 'GET') {
    $rows = $pdo->query("SELECT * FROM reviews WHERE status = 'approved' ORDER BY id DESC LIMIT 60")->fetchAll();
    $agg = $pdo->query("SELECT COUNT(*) AS n, AVG(rating) AS a FROM reviews WHERE status = 'approved'")->fetch();
    json_response(['count' => (int)$agg['n'], 'average' => $agg['n'] ? round((float)$agg['a'], 1) : 0, 'reviews' => array_map($pub, $rows)]);
}
if ($method === 'PATCH' && $rid > 0) {
    require_admin();
    $q = $pdo->prepare('SELECT * FROM reviews WHERE id = ?'); $q->execute([$rid]); $r = $q->fetch();
    if (!$r) json_error('Review not found', 404);
    $b = read_json_body();
    $status = array_key_exists('status', $b) ? (string)$b['status'] : $r['status'];
    if (!in_array($status, ['pending', 'approved', 'hidden'], true)) json_error('Status must be pending, approved or hidden');
    $reply = array_key_exists('reply', $b) ? $clean($b['reply'], 400) : $r['reply'];
    $pdo->prepare('UPDATE reviews SET status = ?, reply = ? WHERE id = ?')->execute([$status, $reply, $rid]);
    json_response(['ok' => true]);
}
if ($method === 'DELETE' && $rid > 0) {
    require_admin();
    $q = $pdo->prepare('SELECT * FROM reviews WHERE id = ?'); $q->execute([$rid]); $r = $q->fetch();
    if (!$r) json_error('Review not found', 404);
    if (!empty($r['photo'])) @unlink(__DIR__ . '/../../uploads/reviews/' . basename($r['photo']));
    $pdo->prepare('DELETE FROM reviews WHERE id = ?')->execute([$rid]);
    json_response(['ok' => true]);
}
if ($method === 'POST') {
    // 5 submissions / hour per visitor, kept in a small temp file.
    $file = sys_get_temp_dir() . '/azizo_rev_' . md5($_SERVER['REMOTE_ADDR'] ?? 'x') . '.json';
    $now = time(); $hits = is_file($file) ? (json_decode((string)@file_get_contents($file), true) ?: []) : [];
    $hits = array_values(array_filter($hits, fn($t) => $now - $t < 3600));
    if (count($hits) >= 5) json_error('Too many attempts - please try again later', 429);
    $hits[] = $now; @file_put_contents($file, json_encode($hits));

    $b = read_json_body();
    $id = (int)($b['orderId'] ?? 0); $rating = (int)($b['rating'] ?? 0);
    if ($id <= 0) json_error('Enter your order number');
    if ($rating < 1 || $rating > 5) json_error('Choose 1 to 5 stars');
    $q = $pdo->prepare('SELECT * FROM orders WHERE id = ?'); $q->execute([$id]); $o = $q->fetch();
    if (!$o || $last9($o['customer_phone']) !== $last9($b['phone'] ?? '') || strlen($last9($b['phone'] ?? '')) < 9) json_error('We could not match that order number and phone number', 404);
    if ($o['status'] !== 'completed') json_error('You can review an order once it has been completed');
    $dup = $pdo->prepare('SELECT 1 FROM reviews WHERE order_id = ?'); $dup->execute([$id]);
    if ($dup->fetchColumn()) json_error('This order already has a review - thank you!', 409);

    $photo = '';
    if (!empty($b['photo'])) {
        if (!preg_match('#^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$#', (string)$b['photo'], $m)) json_error('Photo must be a JPG, PNG or WebP image');
        $bin = base64_decode($m[2], true);
        if ($bin === false || strlen($bin) > 900 * 1024) json_error('Photo is too large (max 900 KB)');
        $ok = ($m[1] === 'jpeg' && substr($bin, 0, 2) === "\xFF\xD8") || ($m[1] === 'png' && substr($bin, 1, 3) === 'PNG') || ($m[1] === 'webp' && substr($bin, 0, 4) === 'RIFF');
        if (!$ok) json_error('That file is not a valid image');
        $dir = __DIR__ . '/../../uploads/reviews'; if (!is_dir($dir)) @mkdir($dir, 0755, true);
        $name = 'rev-' . $id . '-' . time() . '.' . ($m[1] === 'jpeg' ? 'jpg' : $m[1]);
        file_put_contents($dir . '/' . $name, $bin);
        $photo = '/uploads/reviews/' . $name;
    }
    $parts = preg_split('/\s+/', $clean($b['name'] ?? $o['customer_name'], 60), -1, PREG_SPLIT_NO_EMPTY);
    $short = $parts ? $parts[0] . (isset($parts[1]) ? ' ' . mb_substr($parts[1], 0, 1) . '.' : '') : 'Customer';
    $pdo->prepare('INSERT INTO reviews (order_id, name, rating, comment, photo, branch, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
        ->execute([$id, $short, $rating, $clean($b['comment'] ?? '', 600), $photo, $o['branch'] ?? '', 'pending']);
    json_response(['ok' => true, 'message' => 'Thank you! Your review will appear once we have checked it.'], 201);
}
json_error('Not found', 404);
