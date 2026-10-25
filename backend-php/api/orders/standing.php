<?php
// GET /api/orders/standing (staff) - each customer's latest recurring order plus when they last ordered anything.
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_error('GET required', 405);
require_staff();
header('Cache-Control: no-store');
$pdo = get_db();
$rows = $pdo->query("SELECT o.*, (SELECT MAX(x.created_at) FROM orders x WHERE x.customer_phone = o.customer_phone AND x.status != 'cancelled') AS last_order_at
    FROM orders o
    WHERE o.recurring IS NOT NULL AND o.recurring != '' AND o.status != 'cancelled'
      AND o.id = (SELECT MAX(y.id) FROM orders y WHERE y.customer_phone = o.customer_phone AND y.recurring IS NOT NULL AND y.recurring != '' AND y.status != 'cancelled')
    ORDER BY o.id DESC LIMIT 200")->fetchAll();
$items = $pdo->prepare('SELECT name, qty, unit FROM order_items WHERE order_id = ?');
$out = [];
foreach ($rows as $o) {
    $items->execute([$o['id']]);
    $out[] = ['id' => (int)$o['id'], 'customer_name' => $o['customer_name'], 'customer_phone' => $o['customer_phone'], 'recurring' => $o['recurring'],
        'fulfilment' => $o['fulfilment'], 'branch' => $o['branch'], 'area' => $o['area'], 'delivery_address' => $o['delivery_address'],
        'total' => (int)$o['total'], 'created_at' => $o['created_at'], 'last_order_at' => $o['last_order_at'], 'items' => $items->fetchAll()];
}
json_response(['standing' => $out]);
