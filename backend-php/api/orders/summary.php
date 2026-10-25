<?php
// Today's numbers for the staff "Today" tab. Cancelled orders are counted separately, never in sales.
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_error('GET required', 405);
require_staff();
header('Cache-Control: no-store');

$pdo = get_db();
$h = (int)TZ_OFFSET_HOURS;
$today = "DATE(DATE_ADD(created_at, INTERVAL $h HOUR)) = DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL $h HOUR))";
$live = "$today AND status <> 'cancelled'";
$one = fn($sql) => $pdo->query($sql)->fetch();
$all = fn($sql) => $pdo->query($sql)->fetchAll();

$totals = $one("SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue FROM orders WHERE $live");
$byStatus = [];
foreach ($all("SELECT status, COUNT(*) AS n FROM orders WHERE $today GROUP BY status") as $r) $byStatus[$r['status']] = (int)$r['n'];
$liveO = str_replace(['created_at', 'status'], ['o.created_at', 'o.status'], $live);
json_response([
    'date' => $one("SELECT DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL $h HOUR)) AS d")['d'],
    'orders' => (int)$totals['orders'], 'revenue' => (int)$totals['revenue'],
    'cancelled' => (int)$one("SELECT COUNT(*) AS n FROM orders WHERE $today AND status = 'cancelled'")['n'],
    'openNow' => (int)$one("SELECT COUNT(*) AS n FROM orders WHERE status IN ('received','preparing','ready','out_for_delivery')")['n'],
    'avgOrder' => $totals['orders'] ? (int)round($totals['revenue'] / $totals['orders']) : 0,
    'byStatus' => $byStatus,
    'byFulfilment' => $all("SELECT fulfilment, COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue FROM orders WHERE $live GROUP BY fulfilment"),
    'byPayment' => $all("SELECT payment_method AS method, COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue FROM orders WHERE $live GROUP BY payment_method"),
    'byBranch' => $all("SELECT COALESCE(branch,'—') AS branch, COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue FROM orders WHERE $live GROUP BY branch ORDER BY orders DESC"),
    'topItems' => $all("SELECT i.name AS name, i.unit AS unit, SUM(i.qty) AS qty FROM order_items i JOIN orders o ON o.id = i.order_id WHERE $liveO GROUP BY i.name, i.unit ORDER BY qty DESC LIMIT 8"),
]);
