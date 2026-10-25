<?php
// Admin-only: everything the Reports tab shows, for a date range (+ optional branch), with the previous equal period for comparison.
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../lib/report_data.php';
cors_and_preflight();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_error('GET required', 405);
require_admin();
header('Cache-Control: no-store');
$pdo = get_db();
[$from, $to] = report_range($_GET); $branch = (string)($_GET['branch'] ?? ''); $cogs = (string)($_GET['cogs'] ?? '');
$cur = report_build($pdo, $from, $to, $branch, $cogs)['data'];
$len = r_days_between($from, $to) + 1; $pf = r_add_days($from, -$len); $pt = r_add_days($from, -1);
$prev = report_build($pdo, $pf, $pt, $branch, $cogs)['data'];
$branches = array_map(fn($b) => $b['is_main'] ? $b['name'] . ' (Main)' : $b['name'], $pdo->query('SELECT name, is_main FROM branches ORDER BY sort_order, name')->fetchAll());
json_response(array_merge([
    'range' => ['from' => $from, 'to' => $to, 'days' => $len],
    'previous' => ['range' => ['from' => $pf, 'to' => $pt], 'kpis' => $prev['kpis'], 'pnl' => $prev['pnl']],
    'branchFilter' => $branch, 'branchOptions' => $branches, 'expenseCategories' => EXPENSE_CATEGORIES, 'tzOffset' => (int)TZ_OFFSET_HOURS,
], $cur, ['insights' => report_insights($cur, $prev)]));
