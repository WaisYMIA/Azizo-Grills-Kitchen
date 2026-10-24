<?php
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../lib/product_helpers.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();

$pdo = get_db();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // Public — this is what every page's product grid loads on each visit.
    $rows = $pdo->query('SELECT * FROM products ORDER BY category_group, cat, name')->fetchAll();
    $freshItems = [];
    $readyItems = [];
    foreach ($rows as $row) {
        $item = serialize_product($row);
        if ($row['category_group'] === 'freshItems') $freshItems[] = $item;
        else $readyItems[] = $item;
    }
    json_response(['freshItems' => $freshItems, 'readyItems' => $readyItems]);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Creating a product (admin only) — sent as multipart/form-data so the
    // photo file and the text fields arrive in the same request.
    require_admin();

    $id = trim($_POST['id'] ?? '');
    $categoryGroup = trim($_POST['category_group'] ?? '');
    $cat = trim($_POST['cat'] ?? '');
    $name = trim($_POST['name'] ?? '');
    $price = $_POST['price'] ?? null;
    $unit = trim($_POST['unit'] ?? '');

    if ($id === '' || $categoryGroup === '' || $cat === '' || $name === '' || $price === null || $unit === '') {
        json_error('id, category_group, cat, name, price, and unit are all required');
    }
    if (!in_array($categoryGroup, ['freshItems', 'readyItems'], true)) {
        json_error('category_group must be "freshItems" or "readyItems"');
    }

    $existing = $pdo->prepare('SELECT id FROM products WHERE id = ?');
    $existing->execute([$id]);
    if ($existing->fetch()) json_error('A product with this id already exists — use update instead', 409);

    try {
        $imgPath = handle_product_image_upload($id) ?? ($_POST['img'] ?? '');
    } catch (RuntimeException $e) {
        json_error($e->getMessage(), 400);
    }

    $pdo->prepare('INSERT INTO products (id, category_group, cat, kind, name, description, price, unit, img, badges, origin, in_stock, cost_price)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([
            $id, $categoryGroup, $cat, $_POST['kind'] ?? null, $name, $_POST['desc'] ?? '',
            (int)$price, $unit, $imgPath, badges_to_storage($_POST['badges'] ?? ''), $_POST['origin'] ?? '',
            isset($_POST['inStock']) ? (int)!!$_POST['inStock'] : 1, max(0, (int)($_POST['cost_price'] ?? 0)),
        ]);

    $row = $pdo->query('SELECT * FROM products WHERE id = ' . $pdo->quote($id))->fetch();
    json_response(['ok' => true, 'product' => serialize_product($row, true)], 201);
}

json_error('Method not allowed', 405);
