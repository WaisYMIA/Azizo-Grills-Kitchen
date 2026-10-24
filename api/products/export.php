<?php
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../lib/xlsx_writer.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_error('GET required', 405);
require_admin();

$pdo = get_db();
$rows = $pdo->query('SELECT * FROM products ORDER BY category_group, cat, name')->fetchAll();

$headers = ['id', 'category_group', 'cat', 'kind', 'name', 'desc', 'price', 'unit', 'img', 'badges', 'origin', 'inStock', 'cost_price'];
$dataRows = array_map(fn($r) => [
    $r['id'], $r['category_group'], $r['cat'], $r['kind'] ?? '', $r['name'], $r['description'] ?? '',
    $r['price'], $r['unit'], $r['img'] ?? '', $r['badges'] ?? '', $r['origin'] ?? '', $r['in_stock'] ? 1 : 0, (int)($r['cost_price'] ?? 0),
], $rows);

$tmpFile = tempnam(sys_get_temp_dir(), 'azizo_export_') . '.xlsx';
xlsx_write($headers, $dataRows, $tmpFile);

header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
header('Content-Disposition: attachment; filename="azizo-products-' . date('Y-m-d') . '.xlsx"');
header('Content-Length: ' . filesize($tmpFile));
readfile($tmpFile);
unlink($tmpFile);
