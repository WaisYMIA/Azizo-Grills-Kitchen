<?php
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../lib/product_helpers.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('POST required', 405);
require_admin();

// multipart/form-data (so a replacement photo can ride along), not JSON —
// same reasoning as products/index.php's create endpoint.
$id = trim($_POST['id'] ?? '');
if ($id === '') json_error('id is required');

$pdo = get_db();
$existingStmt = $pdo->prepare('SELECT * FROM products WHERE id = ?');
$existingStmt->execute([$id]);
$existing = $existingStmt->fetch();
if (!$existing) json_error('No product with that id', 404);

try {
    $newImg = handle_product_image_upload($id);
} catch (RuntimeException $e) {
    json_error($e->getMessage(), 400);
}

// Only overwrite fields actually sent — lets admin.html send just the changed
// fields (e.g. only a new photo) without clobbering everything else.
$fields = [
    'category_group' => $_POST['category_group'] ?? $existing['category_group'],
    'cat' => $_POST['cat'] ?? $existing['cat'],
    'kind' => array_key_exists('kind', $_POST) ? $_POST['kind'] : $existing['kind'],
    'name' => $_POST['name'] ?? $existing['name'],
    'description' => array_key_exists('desc', $_POST) ? $_POST['desc'] : $existing['description'],
    'price' => isset($_POST['price']) ? (int)$_POST['price'] : $existing['price'],
    'unit' => $_POST['unit'] ?? $existing['unit'],
    'img' => $newImg ?? (array_key_exists('img', $_POST) ? $_POST['img'] : $existing['img']),
    'badges' => array_key_exists('badges', $_POST) ? badges_to_storage($_POST['badges']) : $existing['badges'],
    'origin' => array_key_exists('origin', $_POST) ? $_POST['origin'] : $existing['origin'],
    'in_stock' => isset($_POST['inStock']) ? (int)!!$_POST['inStock'] : $existing['in_stock'],
    'cost_price' => isset($_POST['cost_price']) ? max(0, (int)$_POST['cost_price']) : (int)($existing['cost_price'] ?? 0),
];

$pdo->prepare('UPDATE products SET category_group=?, cat=?, kind=?, name=?, description=?, price=?, unit=?, img=?, badges=?, origin=?, in_stock=?, cost_price=? WHERE id=?')
    ->execute([...array_values($fields), $id]);

$updatedStmt = $pdo->prepare('SELECT * FROM products WHERE id = ?');
$updatedStmt->execute([$id]);
json_response(['ok' => true, 'product' => serialize_product($updatedStmt->fetch(), true)]);
