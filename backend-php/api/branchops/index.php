<?php
// Azizo Branch Operations API (mirrors backend/branchops.js): scorecard, purchases and waste, margins, franchisees, royalty statements, manual.
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../lib/jwt.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();
$pdo = get_db(); header('Cache-Control: no-store');
$M = $_SERVER['REQUEST_METHOD'];
$P = array_values(array_filter(explode('/', trim((string)($_GET['p'] ?? ''), '/')), fn($x) => $x !== ''));
$body = in_array($M, ['POST', 'PUT', 'PATCH'], true) ? read_json_body() : [];
$a = $P[0] ?? ''; $b1 = $P[1] ?? ''; $b2 = $P[2] ?? '';
$CAT = json_decode(file_get_contents(__DIR__ . '/../../data/playbook.json'), true);
$now = fn() => gmdate('Y-m-d H:i:s');
$tz = (int)TZ_OFFSET_HOURS;
$eatDay = fn() => gmdate('Y-m-d', time() + $tz * 3600);
$okDay = fn($d) => is_string($d) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) && strtotime($d . ' 00:00:00 UTC') !== false;
$addDays = fn($d, $n) => gmdate('Y-m-d', strtotime($d . ' 00:00:00 UTC') + $n * 86400);
$bound = fn($d) => gmdate('Y-m-d H:i:s', strtotime($d . ' 00:00:00 UTC') - $tz * 3600);
$clean = fn($v, $n) => mb_substr(trim(preg_replace('/[\x00-\x08\x0b\x0c\x0e-\x1f]/', ' ', (string)($v ?? ''))), 0, $n);
$one = function ($sql, $p = []) use ($pdo) { $q = $pdo->prepare($sql); $q->execute($p); return $q->fetch(); };
$all = function ($sql, $p = []) use ($pdo) { $q = $pdo->prepare($sql); $q->execute($p); return $q->fetchAll(); };
$run = function ($sql, $p = []) use ($pdo) { $q = $pdo->prepare($sql); $q->execute($p); return $q; };
$who = function () { $p = jwt_payload_quiet(); return $p['name'] ?? 'admin'; };
$audit = function ($act, $det) use ($who) { try { audit_log($act, $det, $who()); } catch (Throwable $e) {} };
$branchOk = fn($id) => $one('SELECT * FROM branches WHERE id = ?', [(string)$id]);
$pct = fn($a, $d) => $d ? round(1000 * $a / $d) / 10 : null;
$r1 = fn($x) => round($x * 10) / 10;
$DEF = ['margin_target_pct' => '30', 'waste_target_pct' => '3', 'marketing_pct' => '0', 'compliance_target_pct' => '90', 'royalty_due_days' => '14'];
$settings = function () use ($all, $DEF) { $o = $DEF; try { foreach ($all('SELECT k, v FROM bo_settings') as $r) if (array_key_exists($r['k'], $DEF)) $o[$r['k']] = $r['v']; } catch (Throwable $e) {} return $o; };
$growthSet = function () use ($all) { $o = []; try { foreach ($all("SELECT k, v FROM ops_settings WHERE k IN ('franchise_royalty_pct','franchise_fee','franchise_term_years')") as $r) $o[$r['k']] = $r['v']; } catch (Throwable $e) {} return ['royalty' => (float)($o['franchise_royalty_pct'] ?? 5), 'fee' => (float)($o['franchise_fee'] ?? 300000), 'term' => (float)($o['franchise_term_years'] ?? 5)]; };
$range = function ($q) use ($okDay, $eatDay, $addDays) { $to = $okDay($q['to'] ?? '') ? $q['to'] : $eatDay(); $from = $okDay($q['from'] ?? '') ? $q['from'] : $addDays($to, -29); if ($from > $to) { $t = $from; $from = $to; $to = $t; } if (strtotime($to . ' UTC') - strtotime($from . ' UTC') > 366 * 86400) $from = $addDays($to, -366); return [$from, $to, (int)round((strtotime($to . ' UTC') - strtotime($from . ' UTC')) / 86400) + 1]; };
$salesFor = function ($b, $from, $to) use ($one, $bound, $addDays) { $r = $one("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS gross FROM orders WHERE (branch = ? OR branch = ?) AND status = 'completed' AND created_at >= ? AND created_at < ?", [$b['id'], $b['name'], $bound($from), $bound($addDays($to, 1))]); return ['n' => (int)$r['n'], 'gross' => (int)$r['gross']]; };
$ordersFor = function ($b, $from, $to) use ($one, $bound, $addDays) { $r = $one("SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END),0) AS cancelled FROM orders WHERE (branch = ? OR branch = ?) AND created_at >= ? AND created_at < ?", [$b['id'], $b['name'], $bound($from), $bound($addDays($to, 1))]); return ['n' => (int)$r['n'], 'cancelled' => (int)$r['cancelled']]; };
$refundsFor = function ($b, $from, $to) use ($one, $bound, $addDays) { try { $r = $one("SELECT COUNT(*) AS n, COALESCE(SUM(r.amount_ok),0) AS amt FROM ops_refunds r JOIN orders o ON o.id = r.order_id WHERE (o.branch = ? OR o.branch = ?) AND r.status IN ('approved','paid') AND o.created_at >= ? AND o.created_at < ?", [$b['id'], $b['name'], $bound($from), $bound($addDays($to, 1))]); return ['n' => (int)$r['n'], 'amt' => (int)$r['amt']]; } catch (Throwable $e) { return ['n' => 0, 'amt' => 0]; } };
$monthOk = fn($p) => is_string($p) && preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $p);
$monthRange = function ($p) { [$y, $m] = array_map('intval', explode('-', $p)); return [$p . '-01', $p . '-' . str_pad((string)cal_days_in_month_safe($y, $m), 2, '0', STR_PAD_LEFT)]; };
function cal_days_in_month_safe($y, $m) { return (int)gmdate('t', gmmktime(0, 0, 0, $m, 1, $y)); }
$REASONS = ['spoilage', 'trim', 'expired', 'temperature', 'damaged', 'other'];
$STAGES = ['enquiry', 'approved', 'agreement', 'buildout', 'training', 'softlaunch', 'live', 'exited'];
$kg1 = fn($x) => round((float)$x * 10) / 10;


$stSig = fn($id) => substr(hash_hmac('sha256', 'roy-statement|' . $id, order_sig_key()), 0, 32);
$statementOf = function ($id) use ($one, $all, $branchOk, $monthRange, $bound, $addDays, $tz) {
    $r = $one('SELECT r.*, f.name AS franchisee, f.branch_id FROM bo_royalties r JOIN bo_franchisees f ON f.id = r.franchisee_id WHERE r.id = ?', [(int)$id]); if (!$r) return null;
    $b = $branchOk($r['branch_id']); [$mf, $mt] = $monthRange($r['period']); $d = [];
    foreach ($all("SELECT created_at, total FROM orders WHERE (branch = ? OR branch = ?) AND status = 'completed' AND created_at >= ? AND created_at < ? ORDER BY created_at", [$b ? $b['id'] : '', $b ? $b['name'] : '', $bound($mf), $bound($addDays($mt, 1))]) as $o) { $k = gmdate('Y-m-d', strtotime($o['created_at'] . ' UTC') + $tz * 3600); $d[$k] = $d[$k] ?? ['day' => $k, 'orders' => 0, 'gross' => 0]; $d[$k]['orders']++; $d[$k]['gross'] += (int)$o['total']; }
    ksort($d); foreach (['id', 'franchisee_id', 'gross', 'refunds', 'royalty', 'marketing', 'total', 'orders'] as $k) $r[$k] = (int)$r[$k]; $r['royalty_pct'] = (float)$r['royalty_pct']; $r['marketing_pct'] = (float)$r['marketing_pct'];
    $r['ref'] = 'RS-' . str_replace('-', '', $r['period']) . '-' . str_pad((string)$r['id'], 4, '0', STR_PAD_LEFT); $r['branchName'] = $b ? $b['name'] : $r['branch_id']; $r['days'] = array_values($d); return $r;
};
$waText = fn($s, $link) => 'Hello ' . $s['franchisee'] . ', your Azizo royalty statement ' . $s['ref'] . ' for ' . $s['period'] . ' is KSh ' . number_format($s['total']) . '. View it here: ' . $link;
if ($a === 'public' && $b1 === 'statement' && ctype_digit($b2) && $M === 'GET') {
    $s = hash_equals($stSig($b2), (string)($_GET['k'] ?? '')) ? $statementOf($b2) : null; if (!$s || $s['status'] === 'void') json_error('Statement not found', 404);
    json_response(['statement' => array_intersect_key($s, array_flip(['ref', 'franchisee', 'branchName', 'period', 'gross', 'refunds', 'royalty_pct', 'royalty', 'marketing_pct', 'marketing', 'total', 'status', 'issued_at', 'paid_at', 'days']))]);
}

$scoreRow = function ($b, $from, $to, $s, $expected) use ($salesFor, $ordersFor, $refundsFor, $one, $all, $pct, $r1) {
    $cut = gmdate('Y-m-d H:i:s', strtotime('-12 months'));
        $sales = $salesFor($b, $from, $to); $ord = $ordersFor($b, $from, $to); $ref = $refundsFor($b, $from, $to);
        $comp = $one("SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN attention>0 AND resolved=0 THEN 1 ELSE 0 END),0) AS o FROM pb_runs WHERE branch = ? AND status = 'complete' AND code != 'weekly' AND run_date BETWEEN ? AND ?", [$b['id'], $from, $to]);
        $cash = $one('SELECT COUNT(*) AS n, COALESCE(SUM(ABS(variance)),0) AS gap, COALESCE(SUM(CASE WHEN variance <> 0 THEN 1 ELSE 0 END),0) AS gd FROM ops_cashups WHERE (branch = ? OR branch = ?) AND day BETWEEN ? AND ?', [$b['id'], $b['name'], $from, $to]);
        $pur = $one('SELECT COALESCE(SUM(kg),0) AS kg, COALESCE(SUM(cost),0) AS cost FROM bo_purchases WHERE branch = ? AND day BETWEEN ? AND ?', [$b['id'], $from, $to]);
        $was = $one('SELECT COALESCE(SUM(kg),0) AS kg FROM bo_waste WHERE branch = ? AND day BETWEEN ? AND ?', [$b['id'], $from, $to]);
        $yl = $one('SELECT COALESCE(SUM(kg_in),0) AS i, COALESCE(SUM(kg_out),0) AS o FROM bo_yield WHERE branch = ? AND day BETWEEN ? AND ?', [$b['id'], $from, $to]);
        $tr = []; foreach ($all('SELECT staff_name, staff_ref FROM pb_training WHERE branch = ? AND passed = 1 AND practical = 1 AND taken_at >= ?', [$b['id'], $cut]) as $x) $tr[$x['staff_ref'] ?: strtolower($x['staff_name'])] = 1;
        $row = ['branch' => $b['id'], 'name' => $b['name'], 'listed' => !!$b['listed'], 'orders' => $sales['n'], 'sales' => $sales['gross'], 'avgOrder' => $sales['n'] ? (int)round($sales['gross'] / $sales['n']) : 0, 'cancelledPct' => $pct($ord['cancelled'], $ord['n']), 'refundCount' => $ref['n'], 'refundAmount' => $ref['amt'], 'refundPct' => $pct($ref['amt'], $sales['gross']),
            'compliancePct' => $pct((int)$comp['n'], $expected), 'openCritical' => (int)$comp['o'], 'cashDays' => (int)$cash['n'], 'cashGapDays' => (int)$cash['gd'], 'cashGapTotal' => (int)$cash['gap'], 'certifiedStaff' => count($tr), 'purchases' => (int)$pur['cost'], 'purchasedKg' => $r1((float)$pur['kg']), 'wasteKg' => $r1((float)$was['kg']), 'wastePct' => $pct((float)$was['kg'], (float)$pur['kg']), 'foodCostPct' => $pct((int)$pur['cost'], $sales['gross']), 'yieldPct' => $pct((float)$yl['o'], (float)$yl['i'])];
        $fl = [];
        if ($row['compliancePct'] !== null && $row['compliancePct'] < (float)$s['compliance_target_pct']) $fl[] = 'Checklists below ' . $s['compliance_target_pct'] . '%';
        if (($row['compliancePct'] === null || $row['compliancePct'] == 0) && $b['listed']) $fl[] = 'No checklists done';
        if ($row['openCritical']) $fl[] = $row['openCritical'] . ' critical failure(s) open';
        if ($row['wastePct'] !== null && $row['wastePct'] > (float)$s['waste_target_pct']) $fl[] = 'Waste above ' . $s['waste_target_pct'] . '%';
        if ($row['foodCostPct'] !== null && $row['foodCostPct'] > 100 - (float)$s['margin_target_pct']) $fl[] = 'Food cost above ' . (100 - (float)$s['margin_target_pct']) . '% of sales';
        if ($row['cashGapDays']) $fl[] = $row['cashGapDays'] . ' day(s) with a cash gap';
        $row['flags'] = $fl; $row['status'] = !$fl ? 'green' : (($row['openCritical'] || count($fl) >= 3) ? 'red' : 'amber'); return $row;
};
// ---------- franchisee portal: own login, sees only their own branch and statements ----------
$pwOk = fn($p) => is_string($p) && strlen($p) >= 10 && preg_match('/[A-Za-z]/', $p) && preg_match('/\d/', $p);
if ($a === 'portal') {
    if ($b1 === 'login' && $M === 'POST') {
        $u = strtolower(trim((string)($body['username'] ?? ''))); $uid = $u === '' ? 'none' : $u; throttle_check('fran', $uid, 6, 900);
        $x = $one('SELECT p.*, f.name, f.stage FROM bo_portal p JOIN bo_franchisees f ON f.id = p.franchisee_id WHERE p.username = ?', [$u]);
        if (!$x || !(int)$x['active'] || $x['stage'] === 'exited' || !password_verify((string)($body['password'] ?? ''), $x['password_hash'])) { throttle_fail('fran', $uid); $audit('franchisee-login-failed', $u); json_error('Incorrect username or password', 401); }
        throttle_clear('fran', $uid); $run('UPDATE bo_portal SET last_login = ? WHERE franchisee_id = ?', [$now(), $x['franchisee_id']]); $audit('franchisee-login', $u . ' ' . $x['name']);
        json_response(['token' => jwt_sign(['role' => 'franchisee', 'fid' => (int)$x['franchisee_id']], 60 * 60 * 8), 'name' => $x['name']]);
    }
    $tok = bearer_token(); $pl = $tok ? jwt_verify($tok) : null; if (!$pl) json_error('Please sign in', 401);
    if (($pl['role'] ?? '') !== 'franchisee' || empty($pl['fid'])) json_error('Franchisee access required', 403);
    $fr = $one('SELECT f.*, p.active AS pactive FROM bo_franchisees f JOIN bo_portal p ON p.franchisee_id = f.id WHERE f.id = ?', [(int)$pl['fid']]);
    if (!$fr || !(int)$fr['pactive'] || $fr['stage'] === 'exited') json_error('This login has been switched off. Please contact Azizo.', 401);
    if ($b1 === 'password' && $M === 'POST') {
        $pr = $one('SELECT * FROM bo_portal WHERE franchisee_id = ?', [$fr['id']]);
        if (!password_verify((string)($body['password'] ?? ''), $pr['password_hash'])) json_error('Your current password is not right', 401);
        if (!$pwOk($body['newPassword'] ?? null)) json_error('New password needs 10+ characters with a letter and a number');
        $run('UPDATE bo_portal SET password_hash = ? WHERE franchisee_id = ?', [password_hash($body['newPassword'], PASSWORD_BCRYPT), $fr['id']]); $audit('franchisee-password', $fr['name']); json_response(['ok' => true]);
    }
    if ($M === 'GET' && $b1 === 'me') { $br = $branchOk($fr['branch_id']); $g = $growthSet(); json_response(['name' => $fr['name'], 'stage' => $fr['stage'], 'agreementAt' => $fr['agreement_at'], 'feePaidAt' => $fr['fee_paid_at'], 'royaltyPct' => $fr['royalty_pct'] !== null ? (float)$fr['royalty_pct'] : $g['royalty'], 'termYears' => $g['term'], 'branch' => $br ? ['name' => $br['name'], 'area' => $br['area'], 'address' => $br['address'], 'phone' => $br['phone'], 'hours' => $br['hours']] : null]); }
    if ($M === 'GET' && $b1 === 'summary') {
        $br = $branchOk($fr['branch_id']); if (!$br) json_response(['branch' => null]); $d = (int)($_GET['days'] ?? 30); $d = $d === 7 ? 6 : ($d === 90 ? 89 : 29); $to = $eatDay(); $from = $addDays($to, -$d); $s = $settings();
        $expected = ($d + 1) * count(array_filter($CAT['checklists'], fn($c) => $c['shift'] !== 'weekly')); $row = $scoreRow($br, $from, $to, $s, $expected); unset($row['listed']);
        json_response(['from' => $from, 'to' => $to, 'days' => $d + 1, 'targets' => ['margin' => (float)$s['margin_target_pct'], 'waste' => (float)$s['waste_target_pct'], 'compliance' => (float)$s['compliance_target_pct']], 'branch' => $row]);
    }
    if ($M === 'GET' && $b1 === 'royalties') {
        $rows = $all("SELECT id, period, gross, royalty_pct, royalty, marketing, total, status, issued_at, paid_at FROM bo_royalties WHERE franchisee_id = ? AND status != 'void' ORDER BY period DESC LIMIT 60", [$fr['id']]); $due = 0;
        foreach ($rows as &$x) { foreach (['id', 'gross', 'royalty', 'marketing', 'total'] as $k) $x[$k] = (int)$x[$k]; $x['royalty_pct'] = (float)$x['royalty_pct']; $x['path'] = '/statement.html?id=' . $x['id'] . '&k=' . $stSig($x['id']); if ($x['status'] === 'issued') $due += $x['total']; } unset($x);
        json_response(['rows' => $rows, 'due' => $due]);
    }
    json_error('Not found', 404);
}
if ($a === 'settings') {
    require_admin();
    if ($M === 'GET') { json_response(array_merge($settings(), ['system' => $growthSet()])); }
    if ($M === 'PUT') {
        foreach (array_keys($DEF) as $k) if (array_key_exists($k, $body)) {
            if (!is_numeric($body[$k]) || $body[$k] < 0 || $body[$k] > 100) json_error($k . ' must be between 0 and 100');
            if ($one('SELECT 1 FROM bo_settings WHERE k = ?', [$k])) $run('UPDATE bo_settings SET v = ? WHERE k = ?', [(string)($body[$k] + 0), $k]); else $run('INSERT INTO bo_settings (k, v) VALUES (?, ?)', [$k, (string)($body[$k] + 0)]);
        }
        $audit('branchops-settings', implode(',', array_keys($body))); json_response(array_merge(['ok' => true], $settings()));
    }
}
if ($a === 'scorecard' && $M === 'GET') {
    require_admin(); [$from, $to, $days] = $range($_GET); $s = $settings(); $out = [];
    $expected = $days * count(array_filter($CAT['checklists'], fn($c) => $c['shift'] !== 'weekly'));
    foreach ($all('SELECT * FROM branches ORDER BY is_main DESC, sort_order, name') as $b) $out[] = $scoreRow($b, $from, $to, $s, $expected);
    json_response(['from' => $from, 'to' => $to, 'days' => $days, 'targets' => $s, 'branches' => $out]);
}
if ($a === 'purchases' || $a === 'waste') {
    $isP = $a === 'purchases'; $tbl = $isP ? 'bo_purchases' : 'bo_waste'; require_admin();
    if ($M === 'GET' && $b1 === '') {
        [$from, $to] = $range($_GET); $br = ($_GET['branch'] ?? '') !== '' ? $branchOk($_GET['branch']) : null; if (($_GET['branch'] ?? '') !== '' && !$br) json_error('Unknown branch');
        $rows = $all("SELECT * FROM $tbl WHERE day BETWEEN ? AND ?" . ($br ? ' AND branch = ?' : '') . ' ORDER BY day DESC, id DESC LIMIT 500', array_merge([$from, $to], $br ? [$br['id']] : []));
        foreach ($rows as &$x) { $x['id'] = (int)$x['id']; $x['kg'] = (float)$x['kg']; if ($isP) $x['cost'] = (int)$x['cost']; } unset($x);
        $kg = $r1(array_sum(array_column($rows, 'kg')));
        if ($isP) json_response(['from' => $from, 'to' => $to, 'rows' => $rows, 'totals' => ['kg' => $kg, 'cost' => array_sum(array_column($rows, 'cost'))]]);
        $by = []; foreach ($rows as $x) $by[$x['reason']] = $r1(($by[$x['reason']] ?? 0) + $x['kg']);
        json_response(['from' => $from, 'to' => $to, 'rows' => $rows, 'reasons' => $REASONS, 'byReason' => (object)$by, 'totals' => ['kg' => $kg]]);
    }
    if ($M === 'POST' && $b1 === '') {
        $br = $branchOk($body['branch'] ?? ''); $kg = (float)($body['kg'] ?? 0); $day = $okDay($body['day'] ?? '') ? $body['day'] : $eatDay();
        if (!$br) json_error('Choose a branch'); if (mb_strlen($clean($body['product'] ?? '', 80)) < 2) json_error('Write the product or cut');
        if (!($kg > 0 && $kg <= ($isP ? 5000 : 2000))) json_error('Weight in kg must be between 0 and ' . ($isP ? 5000 : 2000));
        if ($day > $eatDay() || $day < $addDays($eatDay(), -60)) json_error('Date must be within the last 60 days and not in the future');
        $newId = 0;
        if ($isP) {
            $cost = (int)round((float)($body['cost'] ?? 0)); if (!($cost > 0 && $cost <= 50000000)) json_error('Cost must be an amount in KSh');
            $run('INSERT INTO bo_purchases (day, branch, supplier, product, kg, cost, ref, by_name, created_at) VALUES (?,?,?,?,?,?,?,?,?)', [$day, $br['id'], $clean($body['supplier'] ?? '', 80), $clean($body['product'], 80), $kg, $cost, $clean($body['ref'] ?? '', 40), $who(), $now()]); $newId = (int)$pdo->lastInsertId();
            $audit('purchase-add', $br['id'] . ' ' . $clean($body['product'], 40) . ' ' . $kg . 'kg KSh' . $cost);
        } else {
            $reason = in_array($body['reason'] ?? '', $REASONS, true) ? $body['reason'] : 'other';
            $run('INSERT INTO bo_waste (day, branch, product, kg, reason, note, by_name, created_at) VALUES (?,?,?,?,?,?,?,?)', [$day, $br['id'], $clean($body['product'], 80), $kg, $reason, $clean($body['note'] ?? '', 200), $who(), $now()]); $newId = (int)$pdo->lastInsertId();
            $audit('waste-add', $br['id'] . ' ' . $clean($body['product'], 40) . ' ' . $kg . 'kg ' . $reason);
        }
        json_response(['ok' => true, 'id' => $newId], 201);
    }
    if ($M === 'DELETE' && ctype_digit($b1)) {
        $r = $one("SELECT * FROM $tbl WHERE id = ?", [(int)$b1]); if (!$r) json_error('Not found', 404);
        $run("DELETE FROM $tbl WHERE id = ?", [$r['id']]); $audit($isP ? 'purchase-delete' : 'waste-delete', $r['branch'] . ' ' . $r['product'] . ' ' . $r['kg'] . 'kg'); json_response(['ok' => true]);
    }
}
if ($a === 'margins' && $M === 'GET') {
    require_admin(); $br = ($_GET['branch'] ?? '') !== '' ? $branchOk($_GET['branch']) : null; $s = $settings(); $since = $addDays($eatDay(), -60); $m = [];
    foreach ($all('SELECT lower(product) AS p, SUM(kg) AS kg, SUM(cost) AS cost FROM bo_purchases WHERE day >= ?' . ($br ? ' AND branch = ?' : '') . ' GROUP BY lower(product)', array_merge([$since], $br ? [$br['id']] : [])) as $x) $m[$x['p']] = $x;
    $rows = [];
    foreach ($all("SELECT id, name, unit, price FROM products WHERE unit = 'kg' ORDER BY name") as $p) {
        $k = mb_strtolower($p['name']); $x = $m[$k] ?? null; $cost = ($x && (float)$x['kg']) ? (int)round($x['cost'] / $x['kg']) : null; $mg = ($cost !== null && $p['price']) ? round(1000 * ($p['price'] - $cost) / $p['price']) / 10 : null; unset($m[$k]);
        $rows[] = ['id' => $p['id'], 'name' => $p['name'], 'price' => (int)$p['price'], 'costPerKg' => $cost, 'marginPct' => $mg, 'boughtKg' => $x ? $r1((float)$x['kg']) : 0, 'belowTarget' => $mg !== null && $mg < (float)$s['margin_target_pct']];
    }
    json_response(['since' => $since, 'target' => (float)$s['margin_target_pct'], 'rows' => $rows, 'unmatched' => array_values(array_map(fn($x) => ['product' => $x['p'], 'kg' => $r1((float)$x['kg']), 'cost' => (int)$x['cost']], $m))]);
}

if ($a === 'yield' || $a === 'rejects') {
    $isY = $a === 'yield'; $tbl = $isY ? 'bo_yield' : 'bo_rejects'; require_admin(); $RJ = ['temperature', 'quality', 'documents', 'weight', 'other'];
    if ($M === 'GET' && $b1 === '') {
        [$from, $to] = $range($_GET); $br = ($_GET['branch'] ?? '') !== '' ? $branchOk($_GET['branch']) : null; if (($_GET['branch'] ?? '') !== '' && !$br) json_error('Unknown branch');
        $rows = $all("SELECT * FROM $tbl WHERE day BETWEEN ? AND ?" . ($br ? ' AND branch = ?' : '') . ' ORDER BY day DESC, id DESC LIMIT 500', array_merge([$from, $to], $br ? [$br['id']] : []));
        foreach ($rows as &$x) { $x['id'] = (int)$x['id']; foreach ($isY ? ['kg_in', 'kg_out', 'trim_kg'] : ['kg'] as $k) $x[$k] = (float)$x[$k]; } unset($x);
        if (!$isY) json_response(['from' => $from, 'to' => $to, 'rows' => $rows, 'reasons' => $RJ]);
        $by = []; foreach ($rows as $x) { $k = mb_strtolower($x['product']); $by[$k] = $by[$k] ?? ['product' => $x['product'], 'runs' => 0, 'kgIn' => 0, 'kgOut' => 0, 'trimKg' => 0]; $by[$k]['runs']++; $by[$k]['kgIn'] += $x['kg_in']; $by[$k]['kgOut'] += $x['kg_out']; $by[$k]['trimKg'] += $x['trim_kg']; }
        $sum = array_values(array_map(fn($b) => ['product' => $b['product'], 'runs' => $b['runs'], 'kgIn' => $r1($b['kgIn']), 'kgOut' => $r1($b['kgOut']), 'trimKg' => $r1($b['trimKg']), 'yieldPct' => round(1000 * $b['kgOut'] / $b['kgIn']) / 10, 'lossKg' => $r1($b['kgIn'] - $b['kgOut'] - $b['trimKg'])], $by));
        json_response(['from' => $from, 'to' => $to, 'rows' => $rows, 'summary' => $sum]);
    }
    if ($M === 'POST' && $b1 === '') {
        $br = $branchOk($body['branch'] ?? ''); $day = $okDay($body['day'] ?? '') ? $body['day'] : $eatDay();
        if (!$br) json_error('Choose a branch');
        if ($day > $eatDay() || $day < $addDays($eatDay(), -60)) json_error('Date must be within the last 60 days and not in the future');
        if ($isY) {
            $kin = (float)($body['kg_in'] ?? 0); $kout = is_numeric($body['kg_out'] ?? null) ? (float)$body['kg_out'] : -1; $trim = (float)($body['trim_kg'] ?? 0);
            if (mb_strlen($clean($body['product'] ?? '', 80)) < 2) json_error('Write what you started with, for example whole beef side');
            if (!($kin > 0 && $kin <= 5000)) json_error('Weight started with must be between 0 and 5000 kg');
            if ($kout < 0 || $trim < 0) json_error('Weights cannot be negative');
            if ($kout + $trim > $kin * 1.0001) json_error('Saleable cuts plus trim add up to more than you started with');
            $run('INSERT INTO bo_yield (day, branch, product, kg_in, kg_out, trim_kg, note, by_name, created_at) VALUES (?,?,?,?,?,?,?,?,?)', [$day, $br['id'], $clean($body['product'], 80), $kin, $kout, $trim, $clean($body['note'] ?? '', 200), $who(), $now()]); $newId = (int)$pdo->lastInsertId();
            $audit('yield-add', $br['id'] . ' ' . $clean($body['product'], 40) . " in $kin out $kout"); json_response(['ok' => true, 'id' => $newId, 'yieldPct' => round(1000 * $kout / $kin) / 10], 201);
        }
        $kg = (float)($body['kg'] ?? 0); $reason = in_array($body['reason'] ?? '', $RJ, true) ? $body['reason'] : 'other';
        if (mb_strlen($clean($body['supplier'] ?? '', 80)) < 2) json_error('Write the supplier name'); if (!($kg > 0 && $kg <= 5000)) json_error('Weight in kg must be between 0 and 5000');
        $run('INSERT INTO bo_rejects (day, branch, supplier, product, kg, reason, note, by_name, created_at) VALUES (?,?,?,?,?,?,?,?,?)', [$day, $br['id'], $clean($body['supplier'], 80), $clean($body['product'] ?? '', 80), $kg, $reason, $clean($body['note'] ?? '', 200), $who(), $now()]); $newId = (int)$pdo->lastInsertId();
        $audit('reject-add', $br['id'] . ' ' . $clean($body['supplier'], 40) . " {$kg}kg $reason"); json_response(['ok' => true, 'id' => $newId], 201);
    }
    if ($M === 'DELETE' && ctype_digit($b1)) { $r = $one("SELECT * FROM $tbl WHERE id = ?", [(int)$b1]); if (!$r) json_error('Not found', 404); $run("DELETE FROM $tbl WHERE id = ?", [$r['id']]); $audit($isY ? 'yield-delete' : 'reject-delete', $r['branch']); json_response(['ok' => true]); }
}
if ($a === 'suppliers' && $M === 'GET') {
    require_admin(); [$from, $to] = $range($_GET); $br = ($_GET['branch'] ?? '') !== '' ? $branchOk($_GET['branch']) : null; if (($_GET['branch'] ?? '') !== '' && !$br) json_error('Unknown branch');
    $arg = array_merge([$from, $to], $br ? [$br['id']] : []); $bf = $br ? ' AND branch = ?' : ''; $m = [];
    $row = function ($n) use (&$m) { $k = mb_strtolower(trim($n)); if (!isset($m[$k])) $m[$k] = ['supplier' => trim($n), 'deliveries' => 0, 'kg' => 0, 'cost' => 0, 'rejectedKg' => 0, 'rejections' => 0, 'last' => '']; return $k; };
    foreach ($all("SELECT supplier, COUNT(*) AS n, SUM(kg) AS kg, SUM(cost) AS cost, MAX(day) AS last FROM bo_purchases WHERE day BETWEEN ? AND ?$bf AND supplier != '' GROUP BY lower(trim(supplier)), supplier", $arg) as $x) { $k = $row($x['supplier']); $m[$k]['deliveries'] += (int)$x['n']; $m[$k]['kg'] += (float)$x['kg']; $m[$k]['cost'] += (int)$x['cost']; if ($x['last'] > $m[$k]['last']) $m[$k]['last'] = $x['last']; }
    foreach ($all("SELECT supplier, COUNT(*) AS n, SUM(kg) AS kg FROM bo_rejects WHERE day BETWEEN ? AND ?$bf GROUP BY lower(trim(supplier)), supplier", $arg) as $x) { $k = $row($x['supplier']); $m[$k]['rejections'] += (int)$x['n']; $m[$k]['rejectedKg'] += (float)$x['kg']; }
    $rows = array_values(array_map(function ($o) use ($r1) { $tot = $o['kg'] + $o['rejectedKg']; $rp = $tot ? round(1000 * $o['rejectedKg'] / $tot) / 10 : null; $o['kg'] = $r1($o['kg']); $o['rejectedKg'] = $r1($o['rejectedKg']); $o['costPerKg'] = $o['kg'] ? (int)round($o['cost'] / $o['kg']) : null; $o['rejectPct'] = $rp; $o['flag'] = ($rp !== null && $rp > 5) ? 'Rejects above 5% of delivered weight' : ($o['rejections'] >= 3 ? 'Three or more rejections' : ''); return $o; }, $m));
    usort($rows, fn($a, $b) => $b['cost'] <=> $a['cost']);
    json_response(['from' => $from, 'to' => $to, 'rows' => $rows, 'unnamed' => (int)array_values($one("SELECT COUNT(*) FROM bo_purchases WHERE day BETWEEN ? AND ?$bf AND supplier = ''", $arg))[0]]);
}
if ($a === 'franchisees') {
    require_admin();
    if ($M === 'POST' && ctype_digit($b1) && $b2 === 'portal') {
        $f = $one('SELECT * FROM bo_franchisees WHERE id = ?', [(int)$b1]); if (!$f) json_error('Not found', 404); $cur = $one('SELECT * FROM bo_portal WHERE franchisee_id = ?', [$f['id']]);
        $u = strtolower(trim((string)(($body['username'] ?? '') !== '' ? $body['username'] : ($cur['username'] ?? '')))); if (!preg_match('/^[a-z0-9._-]{4,30}$/', $u)) json_error('Username must be 4 to 30 letters, numbers, dots, dashes or underscores');
        if (!$pwOk($body['password'] ?? null)) json_error('Password needs 10+ characters with a letter and a number');
        $cl = $one('SELECT franchisee_id FROM bo_portal WHERE username = ?', [$u]); if ($cl && (int)$cl['franchisee_id'] !== (int)$f['id']) json_error('That username is already used', 409);
        $h = password_hash($body['password'], PASSWORD_BCRYPT);
        if ($cur) $run('UPDATE bo_portal SET username = ?, password_hash = ?, active = 1 WHERE franchisee_id = ?', [$u, $h, $f['id']]); else $run('INSERT INTO bo_portal (franchisee_id, username, password_hash, active, created_at) VALUES (?,?,?,1,?)', [$f['id'], $u, $h, $now()]);
        $audit($cur ? 'franchisee-login-reset' : 'franchisee-login-create', $f['name']); json_response(['ok' => true, 'username' => $u]);
    }
    if ($M === 'DELETE' && ctype_digit($b1) && $b2 === 'portal') { $f = $one('SELECT * FROM bo_franchisees WHERE id = ?', [(int)$b1]); if (!$f) json_error('Not found', 404); $run('UPDATE bo_portal SET active = 0 WHERE franchisee_id = ?', [$f['id']]); $audit('franchisee-login-off', $f['name']); json_response(['ok' => true]); }
    if ($M === 'GET') {
        $rows = $all('SELECT f.*, (SELECT p.username FROM bo_portal p WHERE p.franchisee_id = f.id) AS portal_user, (SELECT p.active FROM bo_portal p WHERE p.franchisee_id = f.id) AS portal_active, (SELECT p.last_login FROM bo_portal p WHERE p.franchisee_id = f.id) AS portal_last, (SELECT l.status FROM pb_launches l WHERE l.branch_id = f.branch_id ORDER BY l.id DESC LIMIT 1) AS launch_status FROM bo_franchisees f ORDER BY f.id DESC');
        json_response(['stages' => $STAGES, 'system' => $growthSet(), 'franchisees' => $rows]);
    }
    if ($M === 'POST') {
        $name = $clean($body['name'] ?? '', 80); if (mb_strlen($name) < 3) json_error('Write the franchisee name'); $enq = null;
        if (!empty($body['enquiry_id'])) { $enq = $one('SELECT * FROM ops_franchise WHERE id = ?', [(int)$body['enquiry_id']]); if (!$enq) json_error('Enquiry not found'); }
        if (!empty($body['branch_id']) && !$branchOk($body['branch_id'])) json_error('Branch not found');
        $ts = $now(); $newId = 0; $run('INSERT INTO bo_franchisees (name, phone, email, branch_id, enquiry_id, stage, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [$name, $clean(($body['phone'] ?? '') ?: ($enq['phone'] ?? ''), 20), $clean(($body['email'] ?? '') ?: ($enq['email'] ?? ''), 120), $clean($body['branch_id'] ?? '', 40), $enq ? $enq['id'] : null, $enq ? 'approved' : 'enquiry', $who(), $ts, $ts]); $newId = (int)$pdo->lastInsertId();
        $audit('franchisee-add', $name); json_response(['ok' => true, 'id' => $newId], 201);
    }
    if ($M === 'PATCH' && ctype_digit($b1)) {
        $f = $one('SELECT * FROM bo_franchisees WHERE id = ?', [(int)$b1]); if (!$f) json_error('Not found', 404);
        $stage = array_key_exists('stage', $body) ? $body['stage'] : $f['stage']; if (!in_array($stage, $STAGES, true)) json_error('Unknown stage');
        $branch = array_key_exists('branch_id', $body) ? $clean($body['branch_id'], 40) : $f['branch_id']; if ($branch && !$branchOk($branch)) json_error('Branch not found');
        $rp = $f['royalty_pct'] !== null ? (float)$f['royalty_pct'] : null;
        if (array_key_exists('royalty_pct', $body)) { $v = $body['royalty_pct']; if ($v === '' || $v === null) $rp = null; else { if (!is_numeric($v) || $v < 0 || $v > 30) json_error('Royalty must be 0 to 30 percent'); $rp = (float)$v; } }
        if (in_array($stage, ['buildout', 'training', 'softlaunch', 'live'], true) && !$f['agreement_at'] && ($body['agreement_signed'] ?? null) !== true) json_error('Record the signed agreement before moving past the agreement stage', 409);
        if ($stage === 'live') { $L = $branch ? $one('SELECT status FROM pb_launches WHERE branch_id = ? ORDER BY id DESC LIMIT 1', [$branch]) : null; if (!$branch || !$L || $L['status'] !== 'live') json_error('Link a branch that has gone live in Playbook > New branch first', 409); }
        $day = $eatDay(); $ag = $f['agreement_at']; $fee = $f['fee_paid_at'];
        if (($body['agreement_signed'] ?? null) === true) $ag = $ag ?: $day; elseif (($body['agreement_signed'] ?? null) === false) $ag = null;
        if (($body['fee_paid'] ?? null) === true) $fee = $fee ?: $day; elseif (($body['fee_paid'] ?? null) === false) $fee = null;
        $run('UPDATE bo_franchisees SET stage=?, branch_id=?, royalty_pct=?, notes=?, agreement_at=?, fee_paid_at=?, updated_at=? WHERE id=?', [$stage, $branch, $rp, array_key_exists('notes', $body) ? $clean($body['notes'], 500) : $f['notes'], $ag, $fee, $now(), $f['id']]);
        $audit('franchisee-' . $stage, $f['name']); json_response(['ok' => true]);
    }
}
if ($a === 'royalties') {
    require_admin();
    if ($M === 'GET' && $b1 === 'overdue') {
        $dueDays = (int)$settings()['royalty_due_days']; $today = $eatDay(); $tot = 0; $rows = [];
        foreach ($all("SELECT r.id, r.period, r.total, r.issued_at, f.name AS franchisee, f.phone FROM bo_royalties r JOIN bo_franchisees f ON f.id = r.franchisee_id WHERE r.status = 'issued' ORDER BY r.issued_at") as $r) {
            $iss = substr((string)$r['issued_at'], 0, 10); $age = $iss ? (int)round((strtotime($today . ' UTC') - strtotime($iss . ' UTC')) / 86400) : 0; $rem = $one('SELECT COUNT(*) AS n, MAX(at) AS last FROM bo_reminders WHERE royalty_id = ?', [$r['id']]);
            $r['id'] = (int)$r['id']; $r['total'] = (int)$r['total']; $r['daysOpen'] = $age; $r['daysOverdue'] = max(0, $age - $dueDays); $r['overdue'] = $age > $dueDays; $r['reminders'] = (int)$rem['n']; $r['lastReminder'] = $rem['last']; if ($r['overdue']) $tot += $r['total']; $rows[] = $r;
        }
        json_response(['dueDays' => $dueDays, 'rows' => $rows, 'overdueTotal' => $tot]);
    }
    if ($M === 'GET' && ctype_digit($b1) && $b2 === 'link') { $s = $statementOf($b1); if (!$s) json_error('Not found', 404); $pp = '/statement.html?id=' . $s['id'] . '&k=' . $stSig($s['id']); $f = $one('SELECT phone FROM bo_franchisees WHERE id = ?', [$s['franchisee_id']]); json_response(['path' => $pp, 'text' => $waText($s, '{SITE}' . $pp), 'phone' => $f['phone'] ?? '']); }
    if ($M === 'POST' && ctype_digit($b1) && $b2 === 'remind') {
        $s = $statementOf($b1); if (!$s) json_error('Not found', 404); if ($s['status'] !== 'issued') json_error('Only an unpaid statement can be reminded', 409);
        $run('INSERT INTO bo_reminders (royalty_id, at, by_name) VALUES (?,?,?)', [$s['id'], $now(), $who()]); $audit('royalty-remind', $s['period'] . ' #' . $s['id']);
        $pp = '/statement.html?id=' . $s['id'] . '&k=' . $stSig($s['id']); $f = $one('SELECT phone FROM bo_franchisees WHERE id = ?', [$s['franchisee_id']]); json_response(['ok' => true, 'path' => $pp, 'text' => $waText($s, '{SITE}' . $pp), 'phone' => $f['phone'] ?? '']);
    }
    if ($M === 'GET' && $b1 === '') {
        $per = $monthOk($_GET['period'] ?? '') ? $_GET['period'] : null;
        $rows = $all('SELECT r.*, f.name AS franchisee, f.branch_id FROM bo_royalties r JOIN bo_franchisees f ON f.id = r.franchisee_id' . ($per ? ' WHERE r.period = ?' : '') . ' ORDER BY r.period DESC, r.id DESC LIMIT 300', $per ? [$per] : []);
        foreach ($rows as &$x) foreach (['id', 'franchisee_id', 'gross', 'refunds', 'royalty', 'marketing', 'total', 'orders'] as $k) $x[$k] = (int)$x[$k]; unset($x);
        foreach ($rows as &$x) { $x['royalty_pct'] = (float)$x['royalty_pct']; $x['marketing_pct'] = (float)$x['marketing_pct']; } unset($x);
        $sum = fn($st) => array_sum(array_map(fn($r) => $r['total'], array_filter($rows, fn($r) => $r['status'] === $st)));
        json_response(['rows' => $rows, 'totals' => ['due' => $sum('issued'), 'paid' => $sum('paid')], 'system' => $growthSet(), 'marketingPct' => (float)$settings()['marketing_pct']]);
    }
    if ($M === 'POST' && $b1 === 'generate') {
        $per = $body['period'] ?? ''; if (!$monthOk($per)) json_error('Choose a month like 2026-11');
        if ($per >= substr($eatDay(), 0, 7)) json_error('A month can be invoiced only after it has ended');
        $g = $growthSet(); $mk = (float)$settings()['marketing_pct']; [$mf, $mt] = $monthRange($per); $made = 0; $skipped = 0;
        foreach ($all("SELECT * FROM bo_franchisees WHERE stage = 'live' AND branch_id != ''") as $f) {
            if ($one('SELECT 1 FROM bo_royalties WHERE franchisee_id = ? AND period = ?', [$f['id'], $per])) { $skipped++; continue; }
            $b = $branchOk($f['branch_id']); if (!$b) continue; $s = $salesFor($b, $mf, $mt); $rf = $refundsFor($b, $mf, $mt); $net = max(0, $s['gross'] - $rf['amt']);
            $p = $f['royalty_pct'] !== null ? (float)$f['royalty_pct'] : $g['royalty']; $roy = (int)round($net * $p / 100); $mkt = (int)round($net * $mk / 100);
            $run('INSERT INTO bo_royalties (franchisee_id, period, gross, refunds, royalty_pct, royalty, marketing_pct, marketing, total, orders, status, issued_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [$f['id'], $per, $net, $rf['amt'], $p, $roy, $mk, $mkt, $roy + $mkt, $s['n'], 'issued', $now()]); $made++;
        }
        $audit('royalty-generate', "$per made $made"); json_response(['ok' => true, 'made' => $made, 'skipped' => $skipped]);
    }
    if ($M === 'PATCH' && ctype_digit($b1)) {
        $r = $one('SELECT * FROM bo_royalties WHERE id = ?', [(int)$b1]); if (!$r) json_error('Not found', 404); $st = $body['status'] ?? '';
        if (!in_array($st, ['paid', 'void', 'issued'], true)) json_error('Status must be paid, void or issued');
        $run('UPDATE bo_royalties SET status = ?, paid_at = ?, note = ? WHERE id = ?', [$st, $st === 'paid' ? $now() : null, $clean($body['note'] ?? '', 200), $r['id']]); $audit('royalty-' . $st, $r['period'] . ' #' . $r['id']); json_response(['ok' => true]);
    }
    if ($M === 'GET' && ctype_digit($b1) && $b2 === 'statement') {
        $r = $one('SELECT r.*, f.name AS franchisee, f.branch_id FROM bo_royalties r JOIN bo_franchisees f ON f.id = r.franchisee_id WHERE r.id = ?', [(int)$b1]); if (!$r) json_error('Not found', 404);
        $b = $branchOk($r['branch_id']); [$mf, $mt] = $monthRange($r['period']); $d = [];
        foreach ($all("SELECT created_at, total FROM orders WHERE (branch = ? OR branch = ?) AND status = 'completed' AND created_at >= ? AND created_at < ? ORDER BY created_at", [$b ? $b['id'] : '', $b ? $b['name'] : '', $bound($mf), $bound($addDays($mt, 1))]) as $o) { $k = gmdate('Y-m-d', strtotime($o['created_at'] . ' UTC') + $tz * 3600); $d[$k] = $d[$k] ?? ['day' => $k, 'orders' => 0, 'gross' => 0]; $d[$k]['orders']++; $d[$k]['gross'] += (int)$o['total']; }
        ksort($d); foreach (['id', 'franchisee_id', 'gross', 'refunds', 'royalty', 'marketing', 'total', 'orders'] as $k) $r[$k] = (int)$r[$k]; $r['royalty_pct'] = (float)$r['royalty_pct']; $r['marketing_pct'] = (float)$r['marketing_pct'];
        $r['ref'] = 'RS-' . str_replace('-', '', $r['period']) . '-' . str_pad((string)$r['id'], 4, '0', STR_PAD_LEFT); $r['branchName'] = $b ? $b['name'] : $r['branch_id']; $r['days'] = array_values($d);
        json_response(['statement' => $r]);
    }
}
if ($a === 'manual' && $M === 'GET') {
    require_admin(); $br = ($_GET['branch'] ?? '') !== '' ? $branchOk($_GET['branch']) : null; if (!$br) $br = $one('SELECT * FROM branches ORDER BY is_main DESC, sort_order LIMIT 1');
    $dir = realpath(__DIR__ . '/../../data/sop') ?: (__DIR__ . '/../../data/sop'); $sops = [];
    if (is_dir($dir)) { $fs = scandir($dir); sort($fs); foreach ($fs as $f) if (preg_match('/^[A-Z]\d\d-[a-z0-9-]+\.md$/', $f)) $sops[] = ['id' => substr($f, 0, -3), 'text' => file_get_contents($dir . '/' . $f)]; }
    $g = $growthSet(); $s = $settings();
    $courses = array_map(fn($c) => ['code' => $c['code'], 'title' => $c['title'], 'sop' => $c['sop'] ?? null, 'forRoles' => $c['for_roles'] ?? null, 'lessons' => $c['lessons'] ?? []], $CAT['courses']);
    json_response(['generated' => $now(), 'version' => $CAT['version'], 'branch' => $br ? ['id' => $br['id'], 'name' => $br['name'], 'area' => $br['area'], 'address' => $br['address'], 'phone' => $br['phone'], 'hours' => $br['hours']] : null,
        'system' => ['royaltyPct' => $g['royalty'], 'fee' => $g['fee'], 'termYears' => $g['term'], 'marginTarget' => (float)$s['margin_target_pct'], 'wasteTarget' => (float)$s['waste_target_pct'], 'complianceTarget' => (float)$s['compliance_target_pct']],
        'checklists' => $CAT['checklists'], 'courses' => $courses, 'passmark' => $CAT['passmark'], 'validMonths' => $CAT['valid_months'], 'manual' => $CAT['manual'], 'sops' => $sops]);
}
json_error('Not found', 404);
