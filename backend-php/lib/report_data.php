<?php
require_once __DIR__ . '/report_engine.php';
require_once __DIR__ . '/../db.php';

/** Validated from/to (YYYY-MM-DD, Nairobi days). Defaults to the last 30 days. */
function report_range(array $q): array {
    $tz = (int)TZ_OFFSET_HOURS; $re = '/^\d{4}-\d{2}-\d{2}$/';
    $to = preg_match($re, $q['to'] ?? '') ? $q['to'] : r_today($tz);
    $from = preg_match($re, $q['from'] ?? '') ? $q['from'] : r_add_days($to, -29);
    if ($from > $to) [$from, $to] = [$to, $from];
    if (r_days_between($from, $to) > 800) $from = r_add_days($to, -800);
    return [$from, $to];
}
function report_utc_bound(string $localDate): string { return gmdate('Y-m-d H:i:s', strtotime($localDate . ' 00:00:00 UTC') - (int)TZ_OFFSET_HOURS * 3600); }
function in_list(int $n): string { return implode(',', array_fill(0, $n, '?')); }

function report_load_orders(PDO $pdo, string $from, string $to, string $branch): array {
    $sql = 'SELECT * FROM orders WHERE created_at >= ? AND created_at < ?'; $params = [report_utc_bound($from), report_utc_bound(r_add_days($to, 1))];
    if ($branch !== '') { $sql .= ' AND branch = ?'; $params[] = $branch; }
    $st = $pdo->prepare($sql . ' ORDER BY created_at'); $st->execute($params); $orders = $st->fetchAll();
    $byId = []; foreach ($orders as $i => $o) { $orders[$i]['items'] = []; $byId[$o['id']] = $i; }
    foreach (array_chunk(array_keys($byId), 500) as $chunk) {
        $it = $pdo->prepare('SELECT * FROM order_items WHERE order_id IN (' . in_list(count($chunk)) . ')'); $it->execute($chunk);
        foreach ($it->fetchAll() as $row) $orders[$byId[$row['order_id']]]['items'][] = $row;
    }
    return $orders;
}
function report_load_expenses(PDO $pdo, string $from, string $to, string $branch): array {
    $sql = 'SELECT id, DATE_FORMAT(expense_date, "%Y-%m-%d") AS expense_date, category, description, amount, branch, paid_via FROM expenses WHERE expense_date BETWEEN ? AND ?';
    $params = [$from, $to]; if ($branch !== '') { $sql .= ' AND branch = ?'; $params[] = $branch; }
    $st = $pdo->prepare($sql . ' ORDER BY expense_date, id'); $st->execute($params);
    return array_map(fn($e) => $e + [], $st->fetchAll());
}
function report_build(PDO $pdo, string $from, string $to, string $branch, string $cogs): array {
    $tz = (int)TZ_OFFSET_HOURS;
    $orders = report_load_orders($pdo, $from, $to, $branch); $expenses = report_load_expenses($pdo, $from, $to, $branch);
    $products = $pdo->query('SELECT id, cat, category_group, name, unit, price, in_stock FROM products')->fetchAll();
    $prior = []; $st = $pdo->prepare("SELECT DISTINCT customer_phone FROM orders WHERE status <> 'cancelled' AND created_at < ?"); $st->execute([report_utc_bound($from)]);
    foreach ($st->fetchAll() as $r) $prior[r_last9($r['customer_phone'])] = true;
    $life = [];
    foreach ($pdo->query("SELECT customer_phone, customer_name, total, created_at FROM orders WHERE status <> 'cancelled'") as $o) {
        $k = r_last9($o['customer_phone']); $c = $life[$k] ?? ['phone' => $o['customer_phone'], 'name' => '', 'orders' => 0, 'spend' => 0, 'last' => ''];
        $c['orders']++; $c['spend'] += $o['total']; if (!empty($o['customer_name'])) $c['name'] = $o['customer_name']; if ($o['created_at'] > $c['last']) $c['last'] = $o['created_at']; $life[$k] = $c; }
    $ids = array_column($orders, 'id'); $log = []; $tx = [];
    foreach (array_chunk($ids, 500) as $chunk) {
        $q = $pdo->prepare('SELECT order_id, status, changed_at FROM order_status_log WHERE order_id IN (' . in_list(count($chunk)) . ') ORDER BY id'); $q->execute($chunk);
        foreach ($q->fetchAll() as $r) $log[$r['order_id']][] = ['status' => $r['status'], 'at' => $r['changed_at']];
        $q = $pdo->prepare('SELECT status FROM mpesa_transactions WHERE order_id IN (' . in_list(count($chunk)) . ')'); $q->execute($chunk);
        foreach ($q->fetchAll() as $r) $tx[] = $r;
    }
    $data = analyse_reports($orders, $expenses, ['tz' => $tz, 'from' => $from, 'to' => $to, 'products' => $products, 'priorPhones' => $prior,
        'lifetime' => array_values($life), 'statusLog' => $log, 'mpesaTx' => $tx, 'cogsMethod' => $cogs]);
    return ['orders' => $orders, 'expenses' => $expenses, 'data' => $data];
}
