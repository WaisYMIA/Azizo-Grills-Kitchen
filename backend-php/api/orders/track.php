<?php
// Public order tracking by order number only; status-only reply. Lookups are throttled per visitor.
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_error('GET required', 405);
header('Cache-Control: no-store');

// Throttle: 30 lookups / 10 min per visitor, kept in a small temp file (no extra DB table).
$visitor = md5($_SERVER['REMOTE_ADDR'] ?? 'unknown');
$file = sys_get_temp_dir() . '/azizo_track_' . $visitor . '.json';
$now = time();
$hits = is_file($file) ? (json_decode((string)@file_get_contents($file), true) ?: []) : [];
$hits = array_values(array_filter($hits, fn($t) => $now - $t < 600));
if (count($hits) >= 30) json_error('Too many lookups — please wait a few minutes and try again', 429);
$hits[] = $now;
@file_put_contents($file, json_encode($hits));

$id = (int)($_GET['id'] ?? 0);
$notFound = fn() => json_error("We couldn't find an order with that number. Check it and try again.", 404);
if ($id <= 0) $notFound();

$pdo = get_db();
$q = $pdo->prepare('SELECT id, status, fulfilment, branch, pickup_time, created_at FROM orders WHERE id = ?');
$q->execute([$id]);
$o = $q->fetch();
if (!$o) $notFound();
// Status-only reply: no name, phone, address, items or prices.
json_response(['order' => ['id' => (int)$o['id'], 'status' => $o['status'], 'fulfilment' => $o['fulfilment'],
    'branch' => $o['branch'], 'pickup_time' => $o['pickup_time'], 'created_at' => $o['created_at'],
    'reviewed' => (bool)$pdo->query('SELECT 1 FROM reviews WHERE order_id = ' . (int)$o['id'])->fetchColumn()]]);
