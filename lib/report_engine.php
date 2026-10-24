<?php
// PHP port of backend/lib/reportEngine.js — same maths, so both backends give identical reports.
const EXPENSE_CATEGORIES = ['Stock purchases', 'Salaries & wages', 'Rent', 'Electricity, water & gas', 'Transport & delivery',
    'Packaging', 'Marketing & ads', 'Licences & permits', 'Repairs & maintenance', 'Bank & M-Pesa charges', 'Other'];
const PURCHASES = 'Stock purchases';
const OPEN_STATUSES = ['received', 'preparing', 'ready', 'out_for_delivery'];

function r_last9($s): string { return substr(preg_replace('/\D/', '', (string)$s), -9); }
function r_pct($a, $b): float { return $b ? round($a / $b * 1000) / 10 : 0; }
function r_sum(array $arr, callable $f): float { $t = 0; foreach ($arr as $x) $t += (float)$f($x); return $t; }
function r_utc(string $ts): int { return (new DateTimeImmutable($ts, new DateTimeZone('UTC')))->getTimestamp(); }
function r_local(string $ts, int $tz): array {
    $t = r_utc($ts) + $tz * 3600;
    return ['date' => gmdate('Y-m-d', $t), 'hour' => (int)gmdate('G', $t), 'dow' => (int)gmdate('w', $t), 'time' => gmdate('H:i', $t)];
}
function r_add_days(string $d, int $n): string { return gmdate('Y-m-d', strtotime($d . ' UTC') + $n * 86400); }
function r_days_between(string $a, string $b): int { return (int)round((strtotime($b . ' UTC') - strtotime($a . ' UTC')) / 86400); }
function r_today(int $tz): string { return gmdate('Y-m-d', time() + $tz * 3600); }
function r_group(array $arr, callable $key): array { $m = []; foreach ($arr as $x) $m[$key($x)][] = $x; return $m; }
function r_is_mpesa($m): bool { return (bool)preg_match('/m-?pesa/i', (string)$m); }
function r_is_cash($m): bool { return (bool)preg_match('/cash/i', (string)$m); }
function r_is_delivery($m): bool { return (bool)preg_match('/deliver/i', (string)$m); }

function analyse_reports(array $orders, array $expenses, array $ctx): array {
    $tz = $ctx['tz'];
    $live = array_values(array_filter($orders, fn($o) => $o['status'] !== 'cancelled'));
    $cancelled = array_values(array_filter($orders, fn($o) => $o['status'] === 'cancelled'));
    $revenue = r_sum($live, fn($o) => $o['total']);
    $deliveryFees = r_sum($live, fn($o) => $o['delivery_fee']);
    $itemSales = $revenue - $deliveryFees;
    $lines = [];
    foreach ($live as $o) foreach ($o['items'] as $i) { $i['_o'] = $o['id']; $lines[] = $i; }
    $lineRevenue = r_sum($lines, fn($i) => $i['line_total']);
    $discounts = r_sum($live, fn($o) => max(0, r_sum($o['items'], fn($i) => $i['line_total']) - ($o['items_subtotal'] ?? 0)));
    $costed = array_values(array_filter($lines, fn($i) => (int)$i['cost_price'] > 0));
    $costedRevenue = r_sum($costed, fn($i) => $i['line_total']);
    $cogsCost = r_sum($costed, fn($i) => $i['cost_price'] * $i['qty']);
    $coverage = r_pct($costedRevenue, $lineRevenue);
    $purchases = r_sum(array_filter($expenses, fn($e) => $e['category'] === PURCHASES), fn($e) => $e['amount']);
    $opex = r_sum(array_filter($expenses, fn($e) => $e['category'] !== PURCHASES), fn($e) => $e['amount']);
    $method = $coverage >= 90 ? 'cost_price' : ($purchases > 0 ? 'purchases' : 'cost_price');
    if (in_array($ctx['cogsMethod'] ?? '', ['cost_price', 'purchases'], true)) $method = $ctx['cogsMethod'];
    if ($method === 'purchases') { $cogs = $purchases; $note = 'Cost of goods = stock purchases you recorded in this period (cash basis).'; }
    elseif ($coverage >= 99.5) { $cogs = $cogsCost; $note = 'Cost of goods = cost price × quantity sold, for every item.'; }
    else { $cogs = round($cogsCost + ($lineRevenue - $costedRevenue) * ($costedRevenue ? $cogsCost / $costedRevenue : 0));
        $note = "Only {$coverage}% of item sales have a cost price; the rest is estimated at the same cost ratio. Fill in cost prices for a firmer number."; }
    $grossProfit = $revenue - $cogs; $netProfit = $grossProfit - $opex;

    $cm = [];
    foreach ($live as $o) {
        $k = r_last9($o['customer_phone']) ?: 'o' . $o['id'];
        $c = $cm[$k] ?? ['phone' => $o['customer_phone'], 'name' => '', 'orders' => 0, 'spend' => 0, 'last' => ''];
        $c['orders']++; $c['spend'] += $o['total']; if (!empty($o['customer_name'])) $c['name'] = $o['customer_name'];
        if ($c['last'] === '' || $o['created_at'] > $c['last']) $c['last'] = $o['created_at'];
        $cm[$k] = $c;
    }
    $prior = $ctx['priorPhones'] ?? [];
    $returning = 0; foreach ($cm as $k => $c) if (isset($prior[$k]) || $c['orders'] >= 2) $returning++;
    $nc = count($cm);
    $kpis = ['orders' => count($live), 'revenue' => (int)$revenue, 'itemSales' => (int)$itemSales, 'deliveryFees' => (int)$deliveryFees, 'discounts' => (int)round($discounts),
        'avgOrder' => $live ? (int)round($revenue / count($live)) : 0, 'cancelled' => count($cancelled),
        'cancelledValue' => (int)r_sum($cancelled, fn($o) => $o['total']), 'cancelRate' => r_pct(count($cancelled), count($orders)),
        'customers' => $nc, 'newCustomers' => $nc - $returning, 'returningCustomers' => $returning, 'repeatRate' => r_pct($returning, $nc),
        'ordersPerCustomer' => $nc ? round(count($live) / $nc * 10) / 10 : 0, 'unitsSold' => (int)r_sum($lines, fn($i) => $i['qty'])];
    $pnl = ['revenue' => (int)$revenue, 'itemSales' => (int)$itemSales, 'deliveryFees' => (int)$deliveryFees, 'cogs' => (int)round($cogs), 'cogsMethod' => $method,
        'cogsNote' => $note, 'costCoverage' => $coverage, 'grossProfit' => (int)round($grossProfit), 'grossMargin' => r_pct($grossProfit, $revenue),
        'operatingExpenses' => (int)$opex, 'netProfit' => (int)round($netProfit), 'netMargin' => r_pct($netProfit, $revenue), 'stockPurchases' => (int)$purchases];

    // time patterns
    $n = r_days_between($ctx['from'], $ctx['to']) + 1; $days = [];
    for ($i = 0; $i < $n; $i++) { $d = r_add_days($ctx['from'], $i); $days[$d] = ['date' => $d, 'orders' => 0, 'revenue' => 0, 'expenses' => 0]; }
    $hours = []; for ($h = 0; $h < 24; $h++) $hours[] = ['hour' => $h, 'orders' => 0, 'revenue' => 0];
    $names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; $dows = []; foreach ($names as $d) $dows[] = ['day' => $d, 'orders' => 0, 'revenue' => 0, 'n' => 0];
    foreach ($live as $o) { $l = r_local($o['created_at'], $tz);
        if (isset($days[$l['date']])) { $days[$l['date']]['orders']++; $days[$l['date']]['revenue'] += $o['total']; }
        $hours[$l['hour']]['orders']++; $hours[$l['hour']]['revenue'] += $o['total'];
        $dows[$l['dow']]['orders']++; $dows[$l['dow']]['revenue'] += $o['total']; }
    for ($i = 0; $i < $n; $i++) $dows[(int)gmdate('w', strtotime(r_add_days($ctx['from'], $i) . ' UTC'))]['n']++;
    foreach ($expenses as $e) if (isset($days[$e['expense_date']])) $days[$e['expense_date']]['expenses'] += $e['amount'];
    $daily = array_values($days);
    $weekday = array_map(fn($d) => ['day' => $d['day'], 'orders' => $d['orders'], 'revenue' => $d['revenue'], 'avgRevenue' => $d['n'] ? (int)round($d['revenue'] / $d['n']) : 0], $dows);

    // products
    $info = []; foreach ($ctx['products'] as $p) $info[$p['id']] = $p;
    $pm = [];
    foreach ($lines as $i) {
        $key = $i['product_id'] ?: 'n:' . $i['name']; $pi = $info[$i['product_id']] ?? [];
        $p = $pm[$key] ?? ['id' => $i['product_id'] ?: '', 'name' => $i['name'], 'unit' => $i['unit'] ?: ($pi['unit'] ?? ''), 'cat' => $pi['cat'] ?? 'Other',
            'group' => $pi['category_group'] ?? 'other', 'qty' => 0, 'revenue' => 0, 'cogs' => 0, 'costedRevenue' => 0, 'orders' => 0];
        $p['qty'] += $i['qty']; $p['revenue'] += $i['line_total']; $p['orders']++;
        if ((int)$i['cost_price'] > 0) { $p['cogs'] += $i['cost_price'] * $i['qty']; $p['costedRevenue'] += $i['line_total']; }
        $pm[$key] = $p;
    }
    $products = array_values($pm);
    foreach ($products as &$p) { $p['profit'] = $p['costedRevenue'] ? (int)round($p['costedRevenue'] - $p['cogs']) : null;
        $p['margin'] = $p['costedRevenue'] ? r_pct($p['costedRevenue'] - $p['cogs'], $p['costedRevenue']) : null; $p['share'] = r_pct($p['revenue'], $lineRevenue); }
    unset($p);
    usort($products, fn($a, $b) => $b['revenue'] <=> $a['revenue']);
    $run = 0; foreach ($products as &$p) { $before = $run; $run += $p['revenue'];
        $p['abc'] = $lineRevenue ? ($before / $lineRevenue < 0.8 ? 'A' : ($before / $lineRevenue < 0.95 ? 'B' : 'C')) : 'C'; } unset($p);
    $cats = [];
    foreach ($products as $p) { $c = $cats[$p['cat']] ?? ['category' => $p['cat'], 'revenue' => 0, 'qty' => 0, 'cogs' => 0, 'costedRevenue' => 0];
        $c['revenue'] += $p['revenue']; $c['qty'] += $p['qty']; $c['cogs'] += $p['cogs']; $c['costedRevenue'] += $p['costedRevenue']; $cats[$p['cat']] = $c; }
    $categories = array_map(fn($c) => ['category' => $c['category'], 'revenue' => $c['revenue'], 'qty' => $c['qty'], 'share' => r_pct($c['revenue'], $lineRevenue),
        'margin' => $c['costedRevenue'] ? r_pct($c['costedRevenue'] - $c['cogs'], $c['costedRevenue']) : null], array_values($cats));
    usort($categories, fn($a, $b) => $b['revenue'] <=> $a['revenue']);
    $sold = []; foreach ($products as $p) if ($p['id'] !== '') $sold[$p['id']] = true;
    $noSales = array_values(array_filter($ctx['products'], fn($p) => !isset($sold[$p['id']])));
    $noSalesOut = array_map(fn($p) => ['id' => $p['id'], 'name' => $p['name'], 'cat' => $p['cat'], 'price' => (int)$p['price']], $noSales);
    $soldOut = array_values(array_map(fn($p) => ['id' => $p['id'], 'name' => $p['name']], array_filter($ctx['products'], fn($p) => isset($p['in_stock']) && (int)$p['in_stock'] === 0)));
    $lowMargin = array_slice(array_values(array_filter($products, fn($p) => $p['margin'] !== null && $p['margin'] < 15 && $p['revenue'] > 0)), 0, 10);

    // branches / fulfilment / payments
    $branches = [];
    foreach (r_group($orders, fn($o) => $o['branch'] ?: 'Not recorded') as $name => $os) {
        $lv = array_values(array_filter($os, fn($o) => $o['status'] !== 'cancelled')); $rev = r_sum($lv, fn($o) => $o['total']);
        $branches[] = ['branch' => $name, 'orders' => count($lv), 'revenue' => (int)$rev, 'avgOrder' => $lv ? (int)round($rev / count($lv)) : 0, 'share' => r_pct($rev, $revenue),
            'deliveries' => count(array_filter($lv, fn($o) => r_is_delivery($o['fulfilment']))), 'cancelled' => count($os) - count($lv), 'cancelRate' => r_pct(count($os) - count($lv), count($os))];
    }
    usort($branches, fn($a, $b) => $b['revenue'] <=> $a['revenue']);
    $fulfilment = [];
    foreach (r_group($live, fn($o) => r_is_delivery($o['fulfilment']) ? 'Delivery' : 'Pickup') as $k => $os) {
        $rev = r_sum($os, fn($o) => $o['total']);
        $fulfilment[] = ['type' => $k, 'orders' => count($os), 'revenue' => (int)$rev, 'avgOrder' => (int)round($rev / count($os)), 'share' => r_pct(count($os), count($live))]; }
    $delivered = array_values(array_filter($live, fn($o) => r_is_delivery($o['fulfilment'])));
    $delivery = ['orders' => count($delivered), 'feesCollected' => (int)$deliveryFees, 'avgFee' => $delivered ? (int)round($deliveryFees / count($delivered)) : 0,
        'freeDeliveries' => count(array_filter($delivered, fn($o) => !$o['delivery_fee']))];
    $payments = [];
    foreach (r_group($live, fn($o) => $o['payment_method'] ?: 'Unknown') as $m => $os) {
        $done = array_filter($os, fn($o) => $o['status'] === 'completed'); $open = array_filter($os, fn($o) => in_array($o['status'], OPEN_STATUSES, true));
        $rev = r_sum($os, fn($o) => $o['total']);
        $payments[] = ['method' => $m, 'orders' => count($os), 'revenue' => (int)$rev, 'share' => r_pct($rev, $revenue), 'collected' => (int)r_sum($done, fn($o) => $o['total']),
            'outstanding' => (int)r_sum($open, fn($o) => $o['total']), 'outstandingOrders' => count($open)]; }
    usort($payments, fn($a, $b) => $b['revenue'] <=> $a['revenue']);
    $mp = array_values(array_filter($live, fn($o) => r_is_mpesa($o['payment_method'])));
    $withRec = array_filter($mp, fn($o) => !empty($o['mpesa_receipt']));
    $noRec = array_filter($mp, fn($o) => empty($o['mpesa_receipt']) && $o['status'] === 'completed');
    $tx = $ctx['mpesaTx'] ?? []; $okS = ['success', 'completed'];
    $cash = array_filter($live, fn($o) => r_is_cash($o['payment_method']));
    $recon = ['mpesaOrders' => count($mp), 'mpesaValue' => (int)r_sum($mp, fn($o) => $o['total']), 'mpesaWithReceipt' => count($withRec),
        'mpesaReceiptValue' => (int)r_sum($withRec, fn($o) => $o['total']), 'completedWithoutReceipt' => count($noRec),
        'completedWithoutReceiptValue' => (int)r_sum($noRec, fn($o) => $o['total']),
        'stkSuccess' => count(array_filter($tx, fn($t) => in_array($t['status'], $okS, true))), 'stkPending' => count(array_filter($tx, fn($t) => $t['status'] === 'pending')),
        'stkFailed' => count(array_filter($tx, fn($t) => !in_array($t['status'], array_merge($okS, ['pending']), true))),
        'cashOrders' => count($cash), 'cashToBank' => (int)r_sum(array_filter($cash, fn($o) => $o['status'] === 'completed'), fn($o) => $o['total'])];
    $statusCounts = []; foreach ($orders as $o) $statusCounts[$o['status']] = ($statusCounts[$o['status']] ?? 0) + 1;
    $promos = [];
    foreach (r_group(array_filter($live, fn($o) => !empty($o['promo_code'])), fn($o) => strtoupper($o['promo_code'])) as $code => $os)
        $promos[] = ['code' => $code, 'orders' => count($os), 'revenue' => (int)r_sum($os, fn($o) => $o['total']),
            'discount' => (int)round(r_sum($os, fn($o) => max(0, r_sum($o['items'], fn($i) => $i['line_total']) - ($o['items_subtotal'] ?? 0))))];
    usort($promos, fn($a, $b) => $b['orders'] <=> $a['orders']);

    // customers
    $top = array_values($cm); usort($top, fn($a, $b) => $b['spend'] <=> $a['spend']);
    $top = array_map(fn($c) => $c + ['avgOrder' => (int)round($c['spend'] / $c['orders'])], array_slice($top, 0, 10));
    $edges = [1, 2, 3, 5]; $freq = [];
    foreach ($edges as $i => $min) { $max = $edges[$i + 1] ?? null;
        $label = $max === null ? "$min+ orders" : ($max - $min === 1 ? "$min order" . ($min > 1 ? 's' : '') : "{$min}–" . ($max - 1) . ' orders');
        $freq[] = ['label' => $label, 'customers' => count(array_filter($cm, fn($c) => $c['orders'] >= $min && ($max === null || $c['orders'] < $max)))]; }
    $now = time(); $lapsed = array_values(array_filter($ctx['lifetime'] ?? [], fn($c) => $c['orders'] >= 2 && ($now - r_utc($c['last'])) / 86400 >= 30));
    usort($lapsed, fn($a, $b) => $b['spend'] <=> $a['spend']);
    $lapsed = array_map(fn($c) => $c + ['daysSince' => (int)floor(($now - r_utc($c['last'])) / 86400)], array_slice($lapsed, 0, 15));

    // operations
    $log = $ctx['statusLog'] ?? []; $toReady = []; $toDone = [];
    foreach ($live as $o) { $l = $log[$o['id']] ?? null; if (!$l) continue; $rec = null; $done = null; $rdy = null;
        foreach ($l as $x) { if ($x['status'] === 'received' && !$rec) $rec = $x; if ($x['status'] === 'completed') $done = $x; if (!$rdy && in_array($x['status'], ['ready', 'out_for_delivery'], true)) $rdy = $x; }
        if (!$rec) continue;
        if ($done) $toDone[] = (r_utc($done['at']) - r_utc($rec['at'])) / 60;
        if ($rdy) $toReady[] = (r_utc($rdy['at']) - r_utc($rec['at'])) / 60; }
    $avg = fn($a) => $a ? (int)round(array_sum($a) / count($a)) : null;
    $operations = ['avgMinutesToReady' => $avg($toReady), 'avgMinutesToComplete' => $avg($toDone), 'timedOrders' => count($toDone),
        'openNow' => count(array_filter($orders, fn($o) => in_array($o['status'], OPEN_STATUSES, true)))];

    $totalExp = r_sum($expenses, fn($e) => $e['amount']); $expCat = [];
    foreach (r_group($expenses, fn($e) => $e['category']) as $c => $es) { $a = r_sum($es, fn($e) => $e['amount']);
        $expCat[] = ['category' => $c, 'amount' => (int)$a, 'entries' => count($es), 'share' => r_pct($a, $totalExp)]; }
    usort($expCat, fn($a, $b) => $b['amount'] <=> $a['amount']);

    $peakHour = null; foreach ($hours as $h) if ($peakHour === null || $h['orders'] > $peakHour['orders']) $peakHour = $h;
    $bestDay = null; foreach ($daily as $d) if ($bestDay === null || $d['revenue'] > $bestDay['revenue']) $bestDay = $d;
    $bestWd = null; foreach ($weekday as $d) if ($bestWd === null || $d['avgRevenue'] > $bestWd['avgRevenue']) $bestWd = $d;
    return ['kpis' => $kpis, 'pnl' => $pnl, 'daily' => $daily, 'hours' => $hours, 'weekday' => $weekday, 'products' => $products, 'categories' => $categories,
        'noSales' => array_slice($noSalesOut, 0, 20), 'noSalesCount' => count($noSalesOut), 'soldOut' => $soldOut, 'lowMargin' => $lowMargin,
        'branches' => $branches, 'fulfilment' => $fulfilment, 'delivery' => $delivery, 'payments' => $payments, 'reconciliation' => $recon, 'statusCounts' => (object)$statusCounts,
        'promos' => $promos, 'topCustomers' => $top, 'frequency' => $freq, 'lapsed' => $lapsed, 'operations' => $operations, 'expenseByCategory' => $expCat,
        'peaks' => ['hour' => $kpis['orders'] ? $peakHour['hour'] : null, 'bestDay' => $kpis['orders'] ? $bestDay : null, 'bestWeekday' => $kpis['orders'] ? $bestWd['day'] : null]];
}

function report_insights(array $cur, ?array $prev): array {
    $out = []; $k = $cur['kpis']; $money = fn($n) => 'KSh ' . number_format(round($n));
    if (!$k['orders']) return [['level' => 'info', 'text' => 'No completed or open orders in this period yet.']];
    if ($prev && $prev['kpis']['revenue']) { $p = $prev['kpis']; $ch = r_pct($k['revenue'] - $p['revenue'], $p['revenue']);
        $out[] = ['level' => $ch >= 0 ? 'good' : 'warn', 'text' => 'Sales are ' . ($ch >= 0 ? 'up' : 'down') . ' ' . abs($ch) . '% on the previous period (' . $money($k['revenue']) . ' vs ' . $money($p['revenue']) . ').']; }
    if ($cur['peaks']['hour'] !== null) $out[] = ['level' => 'info', 'text' => 'Busiest hour is ' . str_pad((string)$cur['peaks']['hour'], 2, '0', STR_PAD_LEFT) . ':00 and the strongest weekday is ' . $cur['peaks']['bestWeekday'] . '. Staff and stock the counter for those times.'];
    if ($cur['products']) { $a = count(array_filter($cur['products'], fn($x) => $x['abc'] === 'A'));
        $out[] = ['level' => 'info', 'text' => $cur['products'][0]['name'] . ' is the top seller (' . $cur['products'][0]['share'] . "% of item sales). $a items make up 80% of your sales — never run out of those."]; }
    if ($cur['lowMargin']) $out[] = ['level' => 'warn', 'text' => count($cur['lowMargin']) . ' item(s) earn under 15% margin, e.g. ' . $cur['lowMargin'][0]['name'] . ' (' . $cur['lowMargin'][0]['margin'] . '%). Review price or buying cost.'];
    if ($cur['pnl']['costCoverage'] < 90) $out[] = ['level' => 'warn', 'text' => 'Only ' . $cur['pnl']['costCoverage'] . '% of sales have a cost price, so profit is an estimate. Add cost prices in Products for accurate margins.'];
    if ($k['cancelRate'] >= 8) $out[] = ['level' => 'warn', 'text' => $k['cancelRate'] . '% of orders were cancelled (' . $money($k['cancelledValue']) . ' lost). Check stock-outs and delivery delays.'];
    $r = $cur['reconciliation'];
    if ($r['completedWithoutReceipt']) $out[] = ['level' => 'warn', 'text' => $r['completedWithoutReceipt'] . ' completed M-Pesa order(s) (' . $money($r['completedWithoutReceiptValue']) . ') have no M-Pesa receipt recorded — match them against your statement.'];
    if ($cur['lapsed']) $out[] = ['level' => 'info', 'text' => count($cur['lapsed']) . " regular customers haven't ordered in 30+ days. A WhatsApp nudge or promo code could win them back."];
    if ($cur['noSalesCount']) $out[] = ['level' => 'info', 'text' => $cur['noSalesCount'] . ' menu item(s) had no sales in this period. Consider promoting or removing them.'];
    if ($cur['soldOut']) $out[] = ['level' => 'warn', 'text' => count($cur['soldOut']) . ' item(s) are currently marked sold out, which loses sales.'];
    if ($k['customers'] && $k['repeatRate'] < 25) $out[] = ['level' => 'info', 'text' => 'Only ' . $k['repeatRate'] . '% of customers are repeat buyers. Loyalty offers could lift this.'];
    if ($cur['pnl']['netProfit'] < 0 && $cur['pnl']['operatingExpenses']) $out[] = ['level' => 'warn', 'text' => 'Expenses exceed gross profit in this period (net ' . $money($cur['pnl']['netProfit']) . ').'];
    return $out;
}
