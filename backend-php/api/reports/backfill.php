<?php
// Copies each product's CURRENT cost price onto past order lines that have no cost yet (older sales then get a margin).
// Lines that already carry a cost are never changed. POST { scope: "all"|"range", from, to, preview: true|false }
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../lib/report_data.php';
cors_and_preflight();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('POST required', 405);
require_admin();
$b = read_json_body(); $pdo = get_db(); $range = ''; $params = [];
if (($b['scope'] ?? '') === 'range') {
    [$from, $to] = report_range($b);
    $range = ' AND oi.order_id IN (SELECT id FROM orders WHERE created_at >= ? AND created_at < ?)';
    $params = [report_utc_bound($from), report_utc_bound(r_add_days($to, 1))];
}
$where = "oi.cost_price = 0 AND p.cost_price > 0$range";
$st = $pdo->prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT oi.order_id) AS o FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE $where");
$st->execute($params); $f = $st->fetch();
if (empty($b['preview'])) {
    $up = $pdo->prepare("UPDATE order_items oi JOIN products p ON p.id = oi.product_id SET oi.cost_price = p.cost_price WHERE $where");
    $up->execute($params);
}
json_response(['ok' => true, 'preview' => !empty($b['preview']), 'lines' => (int)$f['n'], 'orders' => (int)$f['o']]);
