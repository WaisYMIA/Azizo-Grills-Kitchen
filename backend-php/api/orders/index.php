<?php
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/jwt.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();

$pdo = get_db();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = read_json_body();
    $required = ['customer_phone', 'fulfilment', 'payment_method', 'total', 'items'];
    foreach ($required as $f) {
        if (empty($body[$f])) json_error("customer_phone, fulfilment, payment_method, total, and a non-empty items array are required");
    }
    if (!is_array($body['items']) || count($body['items']) === 0) {
        json_error('customer_phone, fulfilment, payment_method, total, and a non-empty items array are required');
    }

    $customerId = null;
    $token = bearer_token();
    if ($token) {
        $payload = jwt_verify($token);
        if ($payload && ($payload['role'] ?? null) === 'customer') $customerId = $payload['id'];
    }

    $pdo->beginTransaction();
    try {
        $pdo->prepare('INSERT INTO orders (customer_id, customer_name, customer_phone, fulfilment, branch, pickup_time, notes, area, recurring,
            delivery_address, delivery_lat, delivery_lng, delivery_fee, payment_method, promo_code, items_subtotal, total)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([
                $customerId, $body['customer_name'] ?? null, $body['customer_phone'], $body['fulfilment'],
                $body['branch'] ?? null, $body['pickup_time'] ?? null, isset($body['notes']) ? mb_substr((string)$body['notes'], 0, 300) : null,
                isset($body['area']) ? mb_substr((string)$body['area'], 0, 80) : null,
                in_array($body['recurring'] ?? '', ['Weekly', 'Bi-weekly', 'Monthly'], true) ? $body['recurring'] : null, $body['delivery_address'] ?? null,
                $body['delivery_lat'] ?? null, $body['delivery_lng'] ?? null, $body['delivery_fee'] ?? 0,
                $body['payment_method'], $body['promo_code'] ?? null, $body['items_subtotal'] ?? $body['total'], $body['total'],
            ]);
        $orderId = (int)$pdo->lastInsertId();

        $itemStmt = $pdo->prepare('INSERT INTO order_items (order_id, product_id, name, qty, unit, unit_price, line_total, cost_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        $costStmt = $pdo->prepare('SELECT cost_price FROM products WHERE id = ?');
        foreach ($body['items'] as $item) {
            $cost = 0;
            if (!empty($item['id'])) { $costStmt->execute([$item['id']]); $cost = (int)($costStmt->fetchColumn() ?: 0); }
            $itemStmt->execute([$orderId, $item['id'] ?? null, $item['name'], $item['qty'], $item['unit'] ?? '', $item['price'], $item['price'] * $item['qty'], $cost]);
        }
        $pdo->prepare("INSERT INTO order_status_log (order_id, status) VALUES (?, 'received')")->execute([$orderId]);
        $pdo->commit();
    } catch (Exception $e) {
        $pdo->rollBack();
        json_error('Could not save the order: ' . $e->getMessage(), 500);
    }

    json_response(['ok' => true, 'orderId' => $orderId], 201);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    require_staff();
    header('Cache-Control: no-store');
    $conditions = []; $params = [];
    if (!empty($_GET['status'])) {
        $list = array_values(array_filter(array_map('trim', explode(',', $_GET['status']))));
        if ($list) { $conditions[] = 'status IN (' . implode(',', array_fill(0, count($list), '?')) . ')'; array_push($params, ...$list); }
    }
    if (!empty($_GET['phone'])) { $conditions[] = 'customer_phone LIKE ?'; $params[] = '%' . $_GET['phone'] . '%'; }
    if (!empty($_GET['branch'])) { $conditions[] = 'branch = ?'; $params[] = $_GET['branch']; }
    if (($_GET['date'] ?? '') === 'today') {
        $conditions[] = 'DATE(DATE_ADD(created_at, INTERVAL ' . (int)TZ_OFFSET_HOURS . ' HOUR)) = DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL ' . (int)TZ_OFFSET_HOURS . ' HOUR))';
    }
    if (!empty($_GET['q'])) {
        $term = trim($_GET['q']);
        $conditions[] = '(CAST(id AS CHAR) = ? OR customer_name LIKE ? OR customer_phone LIKE ?)';
        array_push($params, ltrim($term, '#'), "%$term%", "%$term%");
    }
    $sql = 'SELECT * FROM orders' . ($conditions ? ' WHERE ' . implode(' AND ', $conditions) : '') . ' ORDER BY created_at DESC, id DESC LIMIT 300';
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $orders = $stmt->fetchAll();
    if ($orders) {
        $ids = array_column($orders, 'id');
        $it = $pdo->prepare('SELECT * FROM order_items WHERE order_id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')');
        $it->execute($ids);
        $by = [];
        foreach ($it->fetchAll() as $row) $by[$row['order_id']][] = $row;
        foreach ($orders as &$o) $o['items'] = $by[$o['id']] ?? [];
        unset($o);
    }
    json_response(['orders' => $orders]);
}

json_error('Method not allowed', 405);
