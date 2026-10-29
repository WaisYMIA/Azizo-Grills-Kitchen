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

    // v4.0 marketplace: an order for a partner butchery is re-priced from that partner's own price list and pays the partner directly.
    $partner = null;
    if (!empty($body['partnerId'])) {
        if (!in_array($body['payment_method'], ['cash', 'partner_pay'], true)) json_error('Pay the butchery directly (cash or its till) for this order');
        $ss = $pdo->prepare("SELECT svalue FROM kk_meta WHERE skey = 'site_settings'"); $ss->execute(); $sr = $ss->fetch(); $sj = $sr ? (json_decode($sr['svalue'], true) ?: []) : [];
        $pst = $pdo->prepare("SELECT * FROM mk_partners WHERE id = ? AND status IN ('pilot','live') AND paused = 0"); $pst->execute([(int)$body['partnerId']]); $partner = $pst->fetch();
        if (!$partner || empty($sj['marketplace']['enabled'])) json_error('This butchery is not taking orders right now');
        $sub = 0; $q = $pdo->prepare('SELECT pi.price AS pprice, pi.in_stock AS pstock, pr.price, pr.name, pr.unit, pr.in_stock AS gstock, COALESCE(c.retired, 0) AS retired FROM mk_partner_items pi JOIN products pr ON pr.id = pi.product_id LEFT JOIN mk_catalog c ON c.product_id = pr.id WHERE pi.partner_id = ? AND pi.product_id = ?');
        foreach ($body['items'] as $k => $it) {
            $qty = (float)($it['qty'] ?? 0); if ($qty <= 0 || $qty > 1000) json_error('Each item needs a quantity above zero');
            $q->execute([$partner['id'], (string)($it['id'] ?? '')]); $r = $q->fetch();
            if (!$r || !$r['pstock'] || (int)$r['gstock'] === 0 || $r['retired']) json_error(($r ? $r['name'] : 'An item') . ' is not available from this butchery right now');
            $price = (int)($r['pprice'] ?: $r['price']); $body['items'][$k] = ['id' => $it['id'], 'name' => $r['name'], 'unit' => $r['unit'], 'price' => $price, 'qty' => round($qty, 2)]; $sub += (int)round($price * round($qty, 2));
        }
        if ($sub < (int)$partner['min_order']) json_error("This butchery's minimum order is KSh " . (int)$partner['min_order']);
        $body['items_subtotal'] = $sub; $body['delivery_fee'] = ($body['fulfilment'] === 'delivery') ? (int)$partner['delivery_fee'] : 0; $body['total'] = $sub + $body['delivery_fee'];
        $body['notes'] = '[Partner: ' . $partner['name'] . '] ' . ($body['notes'] ?? '');
    }
    // v4.1 security: public order endpoint is throttled, fields are bounded, and every price is taken from the server's own price list.
    rate_limit('order-ip', 40, 3600);
    $cl = fn($v, $n) => mb_substr(trim(preg_replace('/[\x00-\x08\x0b\x0c\x0e-\x1f]/', ' ', (string)($v ?? ''))), 0, $n);
    if (!in_array($body['fulfilment'], ['pickup', 'delivery'], true)) json_error('fulfilment must be pickup or delivery');
    if (count($body['items']) > 100) json_error('Too many items in one order');
    if (strlen(preg_replace('/\D/', '', (string)$body['customer_phone'])) < 9 || strlen((string)$body['customer_phone']) > 20) json_error('Enter a valid phone number');
    rate_limit('order-phone', 15, 3600, substr(preg_replace('/\D/', '', (string)$body['customer_phone']), -9));
    $body['customer_name'] = $cl($body['customer_name'] ?? '', 80); $body['delivery_address'] = $cl($body['delivery_address'] ?? '', 300); $body['area'] = $cl($body['area'] ?? '', 80);
    $body['branch'] = $cl($body['branch'] ?? '', 60); $body['pickup_time'] = $cl($body['pickup_time'] ?? '', 40); $body['payment_method'] = $cl($body['payment_method'], 20);
    $body['notes'] = $cl($body['notes'] ?? '', 300); $body['promo_code'] = $cl($body['promo_code'] ?? '', 30);
    if (!in_array($body['payment_method'], ['cash', 'mpesa', 'partner_pay', 'card'], true)) json_error('Unknown payment method');
    if (empty($partner)) {
        $pq = $pdo->prepare('SELECT name, price, unit, in_stock FROM products WHERE id = ?'); $sub = 0;
        foreach ($body['items'] as $k => $it) {
            $qty = round((float)($it['qty'] ?? 0), 2); if ($qty <= 0 || $qty > 1000) json_error('Each item needs a quantity above zero');
            $pq->execute([(string)($it['id'] ?? '')]); $pr = $pq->fetch();
            if (!$pr) json_error('An item in your cart is no longer on the menu. Please refresh the page and try again.');
            if ((int)$pr['in_stock'] === 0) json_error($pr['name'] . ' is out of stock right now');
            $body['items'][$k] = ['id' => $it['id'], 'name' => $pr['name'], 'unit' => $pr['unit'], 'price' => (int)$pr['price'], 'qty' => $qty]; $sub += (int)round($pr['price'] * $qty);
        }
        $clientBefore = (int)($body['items_subtotal'] ?? $body['total']) + (int)($body['delivery_fee'] ?? 0); $claimed = max(0, $clientBefore - (int)$body['total']);
        $maxFee = 450; $dq = $pdo->prepare("SELECT svalue FROM kk_meta WHERE skey = 'delivery_config'"); $dq->execute(); if ($dr = $dq->fetch()) { $dc = json_decode($dr['svalue'], true); if (isset($dc['maxFee'])) $maxFee = max(0, (int)$dc['maxFee']); }
        $fee = $body['fulfilment'] === 'delivery' ? max(0, min((int)($body['delivery_fee'] ?? 0), $maxFee)) : 0;
        $off = $body['promo_code'] !== '' ? min($claimed, (int)round($sub * MAX_DISCOUNT_PCT / 100)) : 0;
        $body['items_subtotal'] = $sub; $body['delivery_fee'] = $fee; $body['total'] = max(1, $sub + $fee - $off);
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
            delivery_address, delivery_lat, delivery_lng, delivery_fee, payment_method, promo_code, items_subtotal, total, partner_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([
                $customerId, $body['customer_name'] ?? null, $body['customer_phone'], $body['fulfilment'],
                $body['branch'] ?? null, $body['pickup_time'] ?? null, isset($body['notes']) ? mb_substr((string)$body['notes'], 0, 300) : null,
                isset($body['area']) ? mb_substr((string)$body['area'], 0, 80) : null,
                in_array($body['recurring'] ?? '', ['Weekly', 'Bi-weekly', 'Monthly'], true) ? $body['recurring'] : null, $body['delivery_address'] ?? null,
                $body['delivery_lat'] ?? null, $body['delivery_lng'] ?? null, $body['delivery_fee'] ?? 0,
                $body['payment_method'], $body['promo_code'] ?? null, $body['items_subtotal'] ?? $body['total'], $body['total'], $partner ? (int)$partner['id'] : null,
            ]);
        $orderId = (int)$pdo->lastInsertId();

        $itemStmt = $pdo->prepare('INSERT INTO order_items (order_id, product_id, name, qty, unit, unit_price, line_total, cost_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        $costStmt = $pdo->prepare('SELECT cost_price FROM products WHERE id = ?');
        foreach ($body['items'] as $item) {
            $cost = 0;
            if (!empty($item['id'])) { $costStmt->execute([$item['id']]); $cost = (int)($costStmt->fetchColumn() ?: 0); }
            $itemStmt->execute([$orderId, $item['id'] ?? null, $item['name'], $item['qty'], $item['unit'] ?? '', $item['price'], (int)round($item['price'] * $item['qty']), $cost]);
        }
        $pdo->prepare("INSERT INTO order_status_log (order_id, status) VALUES (?, 'received')")->execute([$orderId]);
        $pdo->commit();
    } catch (Exception $e) {
        $pdo->rollBack();
        error_log('[azizo] order save failed: ' . $e->getMessage()); json_error('We could not save the order. Please try again or WhatsApp us.', 500);
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
