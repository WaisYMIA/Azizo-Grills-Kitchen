<?php
//   GET  /api/branch-stock   public - {out: {branchId: [productId,...]}}
//   POST /api/branch-stock   staff  - {branchId, productId, inStock}
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();
$pdo = get_db();
header('Cache-Control: no-store');
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $out = [];
    foreach ($pdo->query('SELECT branch_id, product_id FROM branch_stock_out')->fetchAll() as $r) $out[$r['branch_id']][] = $r['product_id'];
    json_response(['out' => (object)$out]);
}
require_staff();
$b = read_json_body();
$branch = (string)($b['branchId'] ?? ''); $product = (string)($b['productId'] ?? '');
$has = function ($table, $id) use ($pdo) { $q = $pdo->prepare("SELECT 1 FROM $table WHERE id = ?"); $q->execute([$id]); return (bool)$q->fetchColumn(); };
if (!$has('branches', $branch)) json_error('Branch not found', 404);
if (!$has('products', $product)) json_error('Product not found', 404);
if (!empty($b['inStock'])) $pdo->prepare('DELETE FROM branch_stock_out WHERE branch_id = ? AND product_id = ?')->execute([$branch, $product]);
else $pdo->prepare('INSERT IGNORE INTO branch_stock_out (branch_id, product_id) VALUES (?, ?)')->execute([$branch, $product]);
json_response(['ok' => true]);
