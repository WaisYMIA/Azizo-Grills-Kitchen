<?php
// POST /api/orders/:id/repeat (staff) - copies an earlier order as a new one at current menu prices.
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('POST required', 405);
require_staff();
$pdo = get_db();
$q = $pdo->prepare('SELECT * FROM orders WHERE id = ?'); $q->execute([$_GET['id'] ?? 0]);
$o = $q->fetch();
if (!$o) json_error('Order not found', 404);
$it = $pdo->prepare('SELECT * FROM order_items WHERE order_id = ?'); $it->execute([$o['id']]);
$prod = $pdo->prepare('SELECT price, cost_price FROM products WHERE id = ?');
$pdo->beginTransaction();
try {
    $lines = []; $sub = 0;
    foreach ($it->fetchAll() as $i) {
        $p = false;
        if (!empty($i['product_id'])) { $prod->execute([$i['product_id']]); $p = $prod->fetch(); }
        $price = $p ? (int)$p['price'] : (int)$i['unit_price'];
        $lines[] = [$i, $price, $p ? (int)$p['cost_price'] : (int)($i['cost_price'] ?? 0)];
        $sub += $price * (int)$i['qty'];
    }
    $total = $sub + (int)($o['delivery_fee'] ?? 0);
    $pdo->prepare('INSERT INTO orders (customer_id, customer_name, customer_phone, fulfilment, branch, pickup_time, notes, area, recurring,
        delivery_address, delivery_lat, delivery_lng, delivery_fee, payment_method, items_subtotal, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$o['customer_id'], $o['customer_name'], $o['customer_phone'], $o['fulfilment'], $o['branch'], $o['pickup_time'], $o['notes'], $o['area'], $o['recurring'],
            $o['delivery_address'], $o['delivery_lat'], $o['delivery_lng'], (int)($o['delivery_fee'] ?? 0), $o['payment_method'] === 'mpesa' ? 'cash' : $o['payment_method'], $sub, $total]);
    $newId = (int)$pdo->lastInsertId();
    $ins = $pdo->prepare('INSERT INTO order_items (order_id, product_id, name, qty, unit, unit_price, line_total, cost_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    foreach ($lines as [$i, $price, $cost]) $ins->execute([$newId, $i['product_id'], $i['name'], $i['qty'], $i['unit'], $price, $price * (int)$i['qty'], $cost]);
    $pdo->prepare("INSERT INTO order_status_log (order_id, status) VALUES (?, 'received')")->execute([$newId]);
    $pdo->commit();
} catch (Throwable $e) { $pdo->rollBack(); json_error('Could not repeat the order', 500); }
json_response(['ok' => true, 'orderId' => $newId, 'total' => $total], 201);
