<?php
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_error('GET required', 405);

$payload = require_auth();
if (($payload['role'] ?? null) !== 'customer') json_error('Customer login required', 403);

$pdo = get_db();
$stmt = $pdo->prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC');
$stmt->execute([$payload['id']]);
json_response(['orders' => $stmt->fetchAll()]);
