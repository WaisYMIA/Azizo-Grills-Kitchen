<?php
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../lib/xlsx_reader.php';
require_once __DIR__ . '/../../lib/product_helpers.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('POST required', 405);
require_admin();

if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
    json_error('Upload a .xlsx file as "file"');
}

try {
    $parsed = xlsx_read($_FILES['file']['tmp_name']);
} catch (RuntimeException $e) {
    json_error($e->getMessage(), 400);
}

$required = ['id', 'category_group', 'cat', 'name', 'price', 'unit'];
$missing = array_diff($required, $parsed['headers']);
if ($missing) {
    json_error('Missing required column(s): ' . implode(', ', $missing) .
        '. Columns found: ' . implode(', ', $parsed['headers']));
}

$pdo = get_db();
$insert = $pdo->prepare('INSERT INTO products (id, category_group, cat, kind, name, description, price, unit, img, badges, origin, in_stock, cost_price)
    VALUES (:id, :category_group, :cat, :kind, :name, :description, :price, :unit, :img, :badges, :origin, :in_stock, :cost_price)
    ON DUPLICATE KEY UPDATE
      category_group=VALUES(category_group), cat=VALUES(cat), kind=VALUES(kind), name=VALUES(name),
      description=VALUES(description), price=VALUES(price), unit=VALUES(unit),
      img=IF(VALUES(img) = "", img, VALUES(img)), badges=VALUES(badges), origin=VALUES(origin), in_stock=VALUES(in_stock), cost_price=VALUES(cost_price)');

$created = 0; $updated = 0; $errors = [];
$existingIds = array_column($pdo->query('SELECT id FROM products')->fetchAll(), 'id');

foreach ($parsed['rows'] as $i => $row) {
    $rowNum = $i + 2; // +1 for header, +1 for 1-based display
    $id = trim($row['id'] ?? '');
    $categoryGroup = trim($row['category_group'] ?? '');
    $cat = trim($row['cat'] ?? '');
    $name = trim($row['name'] ?? '');
    $price = trim($row['price'] ?? '');
    $unit = trim($row['unit'] ?? '');

    if ($id === '' || $categoryGroup === '' || $cat === '' || $name === '' || $price === '' || $unit === '') {
        $errors[] = "Row $rowNum: missing a required value (id/category_group/cat/name/price/unit) — skipped.";
        continue;
    }
    if (!in_array($categoryGroup, ['freshItems', 'readyItems'], true)) {
        $errors[] = "Row $rowNum: category_group must be \"freshItems\" or \"readyItems\", got \"$categoryGroup\" — skipped.";
        continue;
    }
    if (!is_numeric($price)) {
        $errors[] = "Row $rowNum: price must be a number, got \"$price\" — skipped.";
        continue;
    }

    try {
        $insert->execute([
            'id' => $id, 'category_group' => $categoryGroup, 'cat' => $cat,
            'kind' => trim($row['kind'] ?? '') ?: null, 'name' => $name,
            'description' => $row['desc'] ?? '', 'price' => (int)$price, 'unit' => $unit,
            'img' => $row['img'] ?? '', 'badges' => badges_to_storage($row['badges'] ?? ''),
            'origin' => $row['origin'] ?? '',
            'in_stock' => isset($row['inStock']) && $row['inStock'] !== '' ? (int)(bool)$row['inStock'] : 1,
            'cost_price' => max(0, (int)($row['cost_price'] ?? 0)),
        ]);
        if (in_array($id, $existingIds, true)) $updated++; else $created++;
    } catch (PDOException $e) {
        $errors[] = "Row $rowNum (id \"$id\"): database error — " . $e->getMessage();
    }
}

json_response(['ok' => true, 'created' => $created, 'updated' => $updated, 'errors' => $errors]);
