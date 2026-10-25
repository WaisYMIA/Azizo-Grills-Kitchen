<?php
// Admin view of the catalog including private cost prices (the public /api/products never exposes them).
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../lib/product_helpers.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_error('GET required', 405);
require_admin();
header('Cache-Control: no-store');
$rows = get_db()->query('SELECT * FROM products ORDER BY category_group, cat, name')->fetchAll();
json_response(['products' => array_map(fn($r) => serialize_product($r, true) + ['category_group' => $r['category_group']], $rows)]);
