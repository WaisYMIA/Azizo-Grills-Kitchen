<?php
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_error('GET required', 405);
require_staff();

$id = $_GET['id'] ?? '';
$pdo = get_db();
$orderStmt = $pdo->prepare('SELECT * FROM orders WHERE id = ?');
$orderStmt->execute([$id]);
$order = $orderStmt->fetch();
if (!$order) json_error('Order not found', 404);

$itemsStmt = $pdo->prepare('SELECT * FROM order_items WHERE order_id = ?');
$itemsStmt->execute([$id]);
json_response(['order' => $order, 'items' => $itemsStmt->fetchAll()]);
