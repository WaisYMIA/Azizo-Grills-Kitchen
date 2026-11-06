<?php
// Azizo Operations API (mirrors backend/ops.js), routed by .htaccess to ?p=<path after /api/ops>
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../lib/ops_helpers.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();
$pdo = get_db();
header('Cache-Control: no-store');
$M = $_SERVER['REQUEST_METHOD'];
$P = array_values(array_filter(explode('/', trim((string)($_GET['p'] ?? ''), '/')), fn($x) => $x !== ''));
$body = in_array($M, ['POST', 'PUT', 'PATCH', 'DELETE'], true) ? read_json_body() : [];
$a = $P[0] ?? ''; $b1 = $P[1] ?? ''; $b2 = $P[2] ?? ''; $b3 = $P[3] ?? '';

$clean = fn($v, $max) => mb_substr(trim(preg_replace('/[\x00-\x08\x0b\x0c\x0e-\x1f]/', ' ', (string)($v ?? ''))), 0, $max);
$last9 = fn($s) => substr(preg_replace('/\D/', '', (string)$s), -9);
$one = function ($sql, $p = []) use ($pdo) { $q = $pdo->prepare($sql); $q->execute($p); return $q->fetch(); };
$all = function ($sql, $p = []) use ($pdo) { $q = $pdo->prepare($sql); $q->execute($p); return $q->fetchAll(); };
$run = function ($sql, $p = []) use ($pdo) { $q = $pdo->prepare($sql); $q->execute($p); return $q; };
$val = fn($sql, $p = []) => ($r = $one($sql, $p)) ? (int)array_values($r)[0] : 0;
$now = fn() => gmdate('Y-m-d H:i:s');
$ymd = fn($ts) => gmdate('Y-m-d', $ts);
$int = fn($rows, $keys) => array_map(function ($r) use ($keys) { foreach ($keys as $k) if (isset($r[$k])) $r[$k] = (int)$r[$k]; return $r; }, $rows);
$ids = fn($r) => $r ? array_map(fn($v) => is_numeric($v) ? $v + 0 : $v, $r) : $r;

// ---------------- anonymous funnel events ----------------
if ($M === 'POST' && $a === 'event') {
    rate_limit('opsev', 300, 3600);
    $n = (string)($body['name'] ?? ''); if (!in_array($n, ['visit', 'cart_add', 'checkout_open', 'order_placed', 'slot_chosen', 'reorder'], true)) json_error('Unknown event');
    $ts = $now(); $run('INSERT INTO ops_events (ts, day, name, branch) VALUES (?,?,?,?)', [$ts, substr($ts, 0, 10), $n, $clean($body['branch'] ?? '', 40)]); json_response(['ok' => true]);
}

// ---------------- loyalty ----------------
$TIERS = [['Bronze', 0], ['Silver', 300], ['Gold', 1000]];
$tierOf = function ($p) use ($TIERS) { $t = $TIERS[0]; foreach ($TIERS as $x) if ($p >= $x[1]) $t = $x; $n = null; foreach ($TIERS as $x) if ($x[1] > $p) { $n = $x; break; } return ['tier' => $t[0], 'next' => $n ? $n[0] : '', 'toNext' => $n ? $n[1] - $p : 0]; };
if ($M === 'GET' && $a === 'loyalty' && $b1 === '') {
    rate_limit('opsloy', 40, 3600); $ph = $last9($_GET['phone'] ?? ''); $no = (int)($_GET['orderNo'] ?? 0);
    if (strlen($ph) < 9 || !$no) json_error('Enter your phone number and one of your order numbers');
    $o = $one('SELECT customer_phone FROM orders WHERE id = ?', [$no]);
    if (!$o || $last9($o['customer_phone']) !== $ph) json_error('We could not match that phone number and order number', 404);
    $p = ops_points($pdo, $ph); $bal = max(0, $p['earned'] + $p['adj']);
    json_response($tierOf($p['earned']) + ['points' => $bal, 'earned' => $p['earned'], 'redeemed' => -min(0, $p['adj']), 'worthKes' => intdiv($bal, 100) * 100, 'rule' => '1 point per KES 100 on completed orders; 100 points = KES 100 reward']);
}
if ($M === 'POST' && $a === 'loyalty' && $b1 === 'redeem') {
    rate_limit('opsred', 10, 3600); $ph = $last9($body['phone'] ?? ''); $no = (int)($body['orderNo'] ?? 0); $pts = (int)floor((float)($body['points'] ?? 0));
    $o = $no ? $one('SELECT customer_phone, customer_name FROM orders WHERE id = ?', [$no]) : null;
    if (!$o || $last9($o['customer_phone']) !== $ph) json_error('We could not match that phone number and order number', 404);
    $p = ops_points($pdo, $ph); $bal = $p['earned'] + $p['adj'];
    if ($pts < 100 || $pts % 100 || $pts > $bal) json_error('Choose a multiple of 100 points, up to your balance of ' . $bal);
    if ($one("SELECT 1 FROM ops_requests WHERE kind = 'reward' AND status = 'open' AND phone = ?", [$ph])) json_error('You already have a reward request waiting. We will contact you on WhatsApp.');
    $run("INSERT INTO ops_requests (kind, name, phone, note, points, created_at) VALUES ('reward', ?, ?, 'Reward request', ?, ?)", [$clean($o['customer_name'], 60), $ph, $pts, $now()]);
    json_response(['ok' => true, 'message' => 'Request received. Azizo will confirm your KES ' . $pts . ' reward on WhatsApp.']);
}

// ---------------- privacy requests ----------------
if ($M === 'POST' && $a === 'privacy-request') {
    rate_limit('opspriv', 6, 3600); $k = in_array($body['kind'] ?? '', ['delete', 'export', 'stop-marketing'], true) ? $body['kind'] : ''; $ph = $last9($body['phone'] ?? '');
    if (!$k || strlen($ph) < 9) json_error('Choose a request type and enter your phone number');
    $run('INSERT INTO ops_requests (kind, name, phone, note, created_at) VALUES (?,?,?,?,?)', [$k, $clean($body['name'] ?? '', 60), $ph, $clean($body['note'] ?? '', 400), $now()]);
    json_response(['ok' => true, 'message' => 'Request received. We will confirm within 7 days.']);
}
if ($a === 'admin' && $b1 === 'requests') {
    require_admin();
    if ($M === 'GET' && $b2 === '') json_response(['requests' => $int($all("SELECT * FROM ops_requests ORDER BY (status = 'open') DESC, id DESC LIMIT 300"), ['id', 'points'])]);
    if ($M === 'PATCH' && ctype_digit($b2)) {
        $r = $one('SELECT * FROM ops_requests WHERE id = ?', [(int)$b2]); if (!$r) json_error('Not found', 404);
        $st = in_array($body['status'] ?? '', ['done', 'declined'], true) ? $body['status'] : ''; if (!$st) json_error('Choose done or declined');
        if ($st === 'done' && $r['kind'] === 'reward') { $p = ops_points($pdo, $r['phone']); if ($p['earned'] + $p['adj'] < (int)$r['points']) json_error('Customer balance is now only ' . ($p['earned'] + $p['adj'])); $run('INSERT INTO ops_loyalty_adj (phone9, points, note, created_at) VALUES (?,?,?,?)', [$r['phone'], -(int)$r['points'], 'Reward #' . $r['id'], $now()]); }
        $run('UPDATE ops_requests SET status = ?, resolution = ?, resolved_at = ? WHERE id = ?', [$st, $clean($body['resolution'] ?? '', 300), $now(), $r['id']]); audit_log('request-' . $st, $r['kind'] . ' #' . $r['id']); json_response(['ok' => true]);
    }
}

// ---------------- tickets (partners + kitchens) ----------------
$CATS = ['general', 'payment', 'order-problem', 'hygiene', 'supplies', 'technical', 'complaint'];
$owner = function () {
    $u = require_auth();
    if (($u['role'] ?? '') === 'partner' && !empty($u['partnerId'])) return ['partner', (int)$u['partnerId']];
    if (($u['role'] ?? '') === 'kitchen' && !empty($u['kitchenId'])) return ['kitchen', (int)$u['kitchenId']];
    json_error('Partner or kitchen access required', 403);
};
$ownerName = function ($w) use ($one) { try { $r = $w[0] === 'partner' ? $one('SELECT name FROM mk_partners WHERE id = ?', [$w[1]]) : $one('SELECT name FROM kk_kitchens WHERE id = ?', [$w[1]]); return $r['name'] ?? ''; } catch (Throwable $e) { return ''; } };
$tickFmt = fn($t) => $t ? ['id' => (int)$t['id']] + $t : $t;
if ($a === 'tickets') {
    $w = $owner();
    if ($M === 'GET' && $b1 === '') json_response(['tickets' => $int($all('SELECT * FROM ops_tickets WHERE scope = ? AND owner_id = ? ORDER BY id DESC LIMIT 100', $w), ['id', 'owner_id'])]);
    if ($M === 'POST' && $b1 === '') {
        rate_limit('opstk', 30, 3600); $subject = $clean($body['subject'] ?? '', 120); $msg = $clean($body['body'] ?? '', 2000);
        if (mb_strlen($subject) < 4 || mb_strlen($msg) < 5) json_error('Add a subject and a message');
        $ts = $now(); $name = $ownerName($w);
        $run('INSERT INTO ops_tickets (scope, owner_id, owner_name, subject, category, priority, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)', [$w[0], $w[1], $name, $subject, in_array($body['category'] ?? '', $CATS, true) ? $body['category'] : 'general', ($body['priority'] ?? '') === 'urgent' ? 'urgent' : 'normal', $ts, $ts]);
        $id = (int)$pdo->lastInsertId(); $ref = 'SUP-' . str_pad((string)$id, 5, '0', STR_PAD_LEFT); $run('UPDATE ops_tickets SET ref = ? WHERE id = ?', [$ref, $id]);
        $run('INSERT INTO ops_ticket_msgs (ticket_id, from_role, from_name, body, created_at) VALUES (?,?,?,?,?)', [$id, $w[0], $name, $msg, $ts]); json_response(['ok' => true, 'ref' => $ref, 'id' => $id]);
    }
    if (ctype_digit($b1)) {
        $t = $one('SELECT * FROM ops_tickets WHERE id = ? AND scope = ? AND owner_id = ?', [(int)$b1, $w[0], $w[1]]); if (!$t) json_error('Not found', 404);
        if ($M === 'GET' && $b2 === '') json_response(['ticket' => $t, 'messages' => $all('SELECT from_role, from_name, body, created_at FROM ops_ticket_msgs WHERE ticket_id = ? ORDER BY id', [$t['id']])]);
        if ($M === 'POST' && $b2 === 'reply') { rate_limit('opstr', 60, 3600); $m = $clean($body['body'] ?? '', 2000); if (mb_strlen($m) < 2) json_error('Write a message'); $ts = $now(); $run('INSERT INTO ops_ticket_msgs (ticket_id, from_role, from_name, body, created_at) VALUES (?,?,?,?,?)', [$t['id'], $t['scope'], $t['owner_name'], $m, $ts]); $run("UPDATE ops_tickets SET status = 'open', updated_at = ? WHERE id = ?", [$ts, $t['id']]); json_response(['ok' => true]); }
    }
}
if ($a === 'admin' && $b1 === 'tickets') {
    require_admin();
    if ($M === 'GET' && $b2 === '') json_response(['tickets' => $int($all("SELECT * FROM ops_tickets ORDER BY (status = 'closed'), (priority = 'urgent') DESC, updated_at DESC LIMIT 300"), ['id', 'owner_id']), 'open' => $val("SELECT COUNT(*) FROM ops_tickets WHERE status = 'open'")]);
    if (ctype_digit($b2)) {
        $t = $one('SELECT * FROM ops_tickets WHERE id = ?', [(int)$b2]); if (!$t) json_error('Not found', 404);
        if ($M === 'GET' && $b3 === '') json_response(['ticket' => $t, 'messages' => $all('SELECT from_role, from_name, body, created_at FROM ops_ticket_msgs WHERE ticket_id = ? ORDER BY id', [$t['id']])]);
        if ($M === 'POST' && $b3 === 'reply') {
            $m = $clean($body['body'] ?? '', 2000); $ts = $now();
            if (mb_strlen($m) >= 2) $run('INSERT INTO ops_ticket_msgs (ticket_id, from_role, from_name, body, created_at) VALUES (?,?,?,?,?)', [$t['id'], 'azizo', 'Azizo head office', $m, $ts]);
            $st = !empty($body['close']) ? 'closed' : (mb_strlen($m) >= 2 ? 'answered' : $t['status']); $run('UPDATE ops_tickets SET status = ?, updated_at = ? WHERE id = ?', [$st, $ts, $t['id']]); audit_log('ticket-' . $st, $t['ref']); json_response(['ok' => true]);
        }
    }
}

// ---------------- SOP library ----------------
$sopDir = realpath(__DIR__ . '/../../data/sop') ?: (__DIR__ . '/../../data/sop');
if ($a === 'sops') {
    $u = require_auth(); if (!in_array($u['role'] ?? '', ['partner', 'kitchen', 'inspector', 'admin', 'kitchens'], true)) json_error('Sign in to a partner, kitchen or Azizo account to read the SOPs', 403);
    if ($M === 'GET' && $b1 === '') {
        $out = []; $files = glob($sopDir . '/*.md') ?: []; sort($files);
        foreach ($files as $f) { $n = basename($f, '.md'); if (!preg_match('/^[A-Z]\d\d-[a-z0-9-]+$/', $n)) continue; $t = (string)file_get_contents($f); preg_match('/^#\s+(.+)$/m', $t, $m1); preg_match('/^Scope:\s*(.+)$/m', $t, $m2); $out[] = ['id' => $n, 'code' => substr($n, 0, 3), 'title' => $m1[1] ?? $n, 'scope' => isset($m2[1]) ? trim($m2[1]) : 'all']; }
        json_response(['sops' => $out]);
    }
    if ($M === 'GET') {
        if (!preg_match('/^[A-Z]\d\d-[a-z0-9-]+$/', $b1)) json_error('Bad id'); $f = $sopDir . '/' . $b1 . '.md'; if (!is_file($f)) json_error('Not found', 404);
        json_response(['id' => $b1, 'markdown' => (string)file_get_contents($f)]);
    }
}

// ---------------- partner dashboard + statements ----------------
if ($a === 'partner' && $b1 === 'confirm-stock' && $M === 'POST') { $u = require_partner(); $run('UPDATE mk_partner_items SET updated_at = ? WHERE partner_id = ?', [$now(), (int)$u['partnerId']]); json_response(['ok' => true]); }
if ($a === 'partner' && $M === 'GET') {
    $u = require_partner(); $pid = (int)$u['partnerId'];
    if ($b1 === 'dashboard') {
        $t0 = $ymd(time()); $d7 = $ymd(time() - 6 * 86400); $d30 = $ymd(time() - 29 * 86400);
        $sum = function ($from) use ($one, $pid) { $r = $one("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS s FROM orders WHERE partner_id = ? AND status != 'cancelled' AND SUBSTR(created_at,1,10) >= ?", [$pid, $from]); return ['n' => (int)$r['n'], 's' => (int)$r['s']]; };
        $rate = $one("SELECT COUNT(*) AS n, AVG(r.rating) AS a FROM reviews r JOIN orders o ON o.id = r.order_id WHERE o.partner_id = ? AND r.status != 'rejected'", [$pid]);
        $done = $val("SELECT COUNT(*) FROM orders WHERE partner_id = ? AND status = 'completed' AND SUBSTR(created_at,1,10) >= ?", [$pid, $d30]); $canc = $val("SELECT COUNT(*) FROM orders WHERE partner_id = ? AND status = 'cancelled' AND SUBSTR(created_at,1,10) >= ?", [$pid, $d30]);
        $p = $one('SELECT status, last_inspection FROM mk_partners WHERE id = ?', [$pid]) ?: [];
        json_response(['today' => $sum($t0), 'week' => $sum($d7), 'month' => $sum($d30), 'openOrders' => $val("SELECT COUNT(*) FROM orders WHERE partner_id = ? AND status IN ('received','preparing','ready','out_for_delivery')", [$pid]),
            'daily' => $int($all("SELECT SUBSTR(created_at,1,10) AS d, COUNT(*) AS n, COALESCE(SUM(total),0) AS s FROM orders WHERE partner_id = ? AND status != 'cancelled' AND SUBSTR(created_at,1,10) >= ? GROUP BY SUBSTR(created_at,1,10) ORDER BY d", [$pid, $d7]), ['n', 's']),
            'top' => $int($all("SELECT oi.name AS name, SUM(oi.qty) AS q, SUM(oi.line_total) AS s FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.partner_id = ? AND o.status != 'cancelled' AND SUBSTR(o.created_at,1,10) >= ? GROUP BY oi.name ORDER BY s DESC LIMIT 5", [$pid, $d30]), ['q', 's']),
            'rating' => ['count' => (int)$rate['n'], 'avg' => $rate['a'] ? round((float)$rate['a'], 1) : null], 'completionPct30' => $done + $canc ? (int)round($done * 100 / ($done + $canc)) : null,
            'itemsListed' => $val('SELECT COUNT(*) FROM mk_partner_items WHERE partner_id = ?', [$pid]), 'itemsSoldOut' => $val('SELECT COUNT(*) FROM mk_partner_items WHERE partner_id = ? AND in_stock = 0', [$pid]),
            'staleItems' => $val('SELECT COUNT(*) FROM mk_partner_items WHERE partner_id = ? AND in_stock = 1 AND updated_at < ?', [$pid, gmdate('Y-m-d H:i:s', time() - 3 * 86400)]),
            'answeredTickets' => $val("SELECT COUNT(*) FROM ops_tickets WHERE scope = 'partner' AND owner_id = ? AND status = 'answered'", [$pid]), 'status' => $p['status'] ?? '', 'nextInspection' => $p['last_inspection'] ?? '']);
    }
    if ($b1 === 'statement') {
        $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($_GET['from'] ?? '')) ? $_GET['from'] : $ymd(time() - 29 * 86400); $to = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($_GET['to'] ?? '')) ? $_GET['to'] : $ymd(time());
        $rows = $int($all("SELECT o.id AS id, SUBSTR(o.created_at,1,10) AS d, o.status AS status, o.items_subtotal, o.delivery_fee, o.total, COALESCE(f.fee,0) AS fee FROM orders o LEFT JOIN mk_order_fees f ON f.order_id = o.id WHERE o.partner_id = ? AND SUBSTR(o.created_at,1,10) BETWEEN ? AND ? ORDER BY o.id", [$pid, $from, $to]), ['id', 'items_subtotal', 'delivery_fee', 'total', 'fee']);
        $g = 0; $f = 0; $n = 0; foreach ($rows as $r) if ($r['status'] !== 'cancelled') { $g += $r['total']; $f += $r['fee']; $n++; }
        if (($_GET['format'] ?? '') === 'csv') { header('Content-Type: text/csv; charset=utf-8'); header('Content-Disposition: attachment; filename="azizo-statement-' . $from . '-to-' . $to . '.csv"'); $o = fopen('php://output', 'w'); fputcsv($o, ['Order', 'Date', 'Status', 'Items', 'Delivery', 'Total', 'Azizo fee', 'Net to you']); foreach ($rows as $r) fputcsv($o, [$r['id'], $r['d'], $r['status'], $r['items_subtotal'], $r['delivery_fee'], $r['total'], $r['fee'], $r['status'] === 'cancelled' ? 0 : $r['total'] - $r['fee']]); exit; }
        json_response(['partner' => $one('SELECT name, owner, phone FROM mk_partners WHERE id = ?', [$pid]) ?: new stdClass(), 'from' => $from, 'to' => $to, 'rows' => $rows, 'totals' => ['gross' => $g, 'fee' => $f, 'net' => $g - $f, 'orders' => $n, 'cancelled' => count($rows) - $n], 'note' => 'Customers pay you directly. "Azizo fee" is what Azizo invoices you for these orders.']);
    }
    if ($b1 === 'onboarding') json_response(ops_gate_for($pdo, $pid));
}

// ---------------- onboarding + gate (admin) ----------------
if ($a === 'admin' && $b1 === 'gate' && $M === 'GET' && ctype_digit($b2)) { require_admin(); json_response(ops_gate_for($pdo, (int)$b2)); }
if ($a === 'admin' && $b1 === 'onboarding' && $M === 'PUT' && ctype_digit($b2)) {
    require_admin(); $k = (string)($body['key'] ?? ''); $okKey = false; foreach (OPS_ONB as $o) if ($o[0] === $k) $okKey = true; if (!$okKey) json_error('Unknown step');
    $d = !empty($body['done']) ? 1 : 0; $pid = (int)$b2;
    if ($one('SELECT 1 FROM ops_onboarding WHERE partner_id = ? AND `key` = ?', [$pid, $k])) $run('UPDATE ops_onboarding SET done = ?, by_name = ?, at = ? WHERE partner_id = ? AND `key` = ?', [$d, 'admin', $now(), $pid, $k]);
    else $run('INSERT INTO ops_onboarding (partner_id, `key`, done, by_name, at) VALUES (?,?,?,?,?)', [$pid, $k, $d, 'admin', $now()]);
    audit_log('onboarding', 'partner ' . $pid . ' ' . $k . '=' . $d); json_response(['ok' => true]);
}

// ---------------- named inspector accounts ----------------
if ($a === 'admin' && $b1 === 'accounts') {
    require_admin();
    if ($M === 'GET' && $b2 === '') json_response(['accounts' => $int($all('SELECT id, username, name, title, active, created_at, last_login FROM ops_accounts ORDER BY id'), ['id', 'active'])]);
    if ($M === 'POST' && $b2 === '') {
        $u = strtolower($clean($body['username'] ?? '', 30)); $n = $clean($body['name'] ?? '', 60); $pw = (string)($body['password'] ?? '');
        if (!preg_match('/^[a-z0-9._-]{3,30}$/', $u) || mb_strlen($n) < 3 || strlen($pw) < 8) json_error('Username (3+ letters/numbers), full name and a password of 8+ characters are needed');
        if ($one('SELECT 1 FROM ops_accounts WHERE username = ?', [$u])) json_error('That username is taken');
        $run('INSERT INTO ops_accounts (username, name, title, password_hash, created_at) VALUES (?,?,?,?,?)', [$u, $n, $clean($body['title'] ?? '', 60), password_hash($pw, PASSWORD_BCRYPT), $now()]); audit_log('account-create', $u); json_response(['ok' => true]);
    }
    if ($M === 'PATCH' && ctype_digit($b2)) {
        $ac = $one('SELECT * FROM ops_accounts WHERE id = ?', [(int)$b2]); if (!$ac) json_error('Not found', 404);
        if (array_key_exists('password', $body) && strlen((string)$body['password']) < 8) json_error('Password must be 8+ characters');
        $run('UPDATE ops_accounts SET active = ?, password_hash = ? WHERE id = ?', [array_key_exists('active', $body) ? (!empty($body['active']) ? 1 : 0) : $ac['active'], !empty($body['password']) ? password_hash((string)$body['password'], PASSWORD_BCRYPT) : $ac['password_hash'], $ac['id']]); audit_log('account-update', $ac['username']); json_response(['ok' => true]);
    }
}

// ---------------- v5.2 team accounts (Owner only; the shared admin password counts as Owner) ----------------
if ($a === 'admin' && $b1 === 'team') {
    require_admin();
    $roles = ['owner', 'manager', 'finance', 'counter']; $actor = jwt_payload_quiet(); $strong = fn($pw) => strlen((string)$pw) >= 10 && preg_match('/[A-Za-z]/', (string)$pw) && preg_match('/\d/', (string)$pw);
    $owners = fn() => $val("SELECT COUNT(*) FROM team_accounts WHERE role = 'owner' AND active = 1");
    if ($M === 'GET' && $b2 === '') json_response(['team' => $int($all('SELECT id, username, name, role, active, created_at, last_login, created_by FROM team_accounts ORDER BY id'), ['id', 'active']), 'roles' => $roles, 'sharedPasswordsOff' => getenv('TEAM_ONLY') === '1' && $owners() > 0]);
    if ($M === 'POST' && $b2 === '') {
        $u = strtolower($clean($body['username'] ?? '', 30)); $n = $clean($body['name'] ?? '', 60); $role = (string)($body['role'] ?? '');
        if (!preg_match('/^[a-z0-9._-]{3,30}$/', $u) || mb_strlen($n) < 3 || !in_array($role, $roles, true)) json_error('Username (3+ letters/numbers), full name and a role are needed');
        if (!$strong($body['password'] ?? '')) json_error('Password needs 10+ characters with a letter and a number');
        if ($one('SELECT 1 FROM team_accounts WHERE username = ?', [$u])) json_error('That username is taken');
        $run('INSERT INTO team_accounts (username, name, role, password_hash, created_at, created_by) VALUES (?,?,?,?,?,?)', [$u, $n, $role, password_hash((string)$body['password'], PASSWORD_BCRYPT), $now(), $actor['name'] ?? 'shared admin']); audit_log('team-create', $u . ' as ' . $role); json_response(['ok' => true]);
    }
    if ($M === 'PATCH' && ctype_digit($b2)) {
        $ac = $one('SELECT * FROM team_accounts WHERE id = ?', [(int)$b2]); if (!$ac) json_error('Not found', 404);
        $role = array_key_exists('role', $body) ? (string)$body['role'] : $ac['role']; $act = array_key_exists('active', $body) ? (!empty($body['active']) ? 1 : 0) : (int)$ac['active'];
        if (!in_array($role, $roles, true)) json_error('Unknown role');
        if (!empty($body['password']) && !$strong($body['password'])) json_error('Password needs 10+ characters with a letter and a number');
        if ($ac['role'] === 'owner' && (int)$ac['active'] && ($role !== 'owner' || !$act) && $owners() <= 1) json_error('You cannot switch off or demote the last Owner');
        $run('UPDATE team_accounts SET role = ?, active = ?, password_hash = ? WHERE id = ?', [$role, $act, !empty($body['password']) ? password_hash((string)$body['password'], PASSWORD_BCRYPT) : $ac['password_hash'], (int)$ac['id']]);
        audit_log('team-update', $ac['username'] . ($role !== $ac['role'] ? ' role ' . $ac['role'] . '>' . $role : '') . ($act !== (int)$ac['active'] ? ($act ? ' on' : ' off') : '') . (!empty($body['password']) ? ' password reset' : '')); json_response(['ok' => true]);
    }
}

// ---------------- analytics (admin) ----------------
if ($a === 'admin' && $b1 === 'analytics' && $M === 'GET') {
    require_admin(); $days = max(1, min(365, (int)($_GET['days'] ?? 30) ?: 30)); $from = $ymd(time() - ($days - 1) * 86400);
    $base = "FROM orders WHERE status != 'cancelled' AND SUBSTR(created_at,1,10) >= ?";
    $t = $one('SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS s ' . $base, [$from]); $canc = $val("SELECT COUNT(*) FROM orders WHERE status = 'cancelled' AND SUBSTR(created_at,1,10) >= ?", [$from]);
    $hrs = array_fill(0, 24, 0); foreach ($all('SELECT SUBSTR(created_at,12,2) AS h, COUNT(*) AS n ' . $base . ' GROUP BY SUBSTR(created_at,12,2)', [$from]) as $r) $hrs[((int)$r['h'] + 3) % 24] += (int)$r['n'];
    $ph = $all('SELECT customer_phone AS p, COUNT(*) AS n ' . $base . ' GROUP BY customer_phone', [$from]); $repeat = count(array_filter($ph, fn($x) => (int)$x['n'] > 1));
    $kk = ['orders' => 0, 'revenue' => 0, 'cancelled' => 0]; try { $k = $one("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS s FROM kk_orders WHERE status NOT IN ('cancelled','rejected') AND SUBSTR(created_at,1,10) >= ?", [$from]); $kk = ['orders' => (int)$k['n'], 'revenue' => (int)$k['s'], 'cancelled' => $val("SELECT COUNT(*) FROM kk_orders WHERE status IN ('cancelled','rejected') AND SUBSTR(created_at,1,10) >= ?", [$from])]; } catch (Throwable $e) {}
    $ev = []; foreach ($all('SELECT name, COUNT(*) AS n FROM ops_events WHERE day >= ? GROUP BY name', [$from]) as $r) $ev[$r['name']] = (int)$r['n'];
    $e = fn($k) => $ev[$k] ?? 0; $conv = fn($x, $y) => $x ? round($y * 1000 / $x) / 10 : null;
    $rv = $one("SELECT COUNT(*) AS n, AVG(rating) AS a FROM reviews WHERE status != 'rejected' AND SUBSTR(created_at,1,10) >= ?", [$from]); $n = (int)$t['n'];
    json_response(['days' => $days, 'from' => $from, 'orders' => $n, 'revenue' => (int)$t['s'], 'aov' => $n ? (int)round($t['s'] / $n) : 0, 'cancelled' => $canc, 'cancelPct' => $n + $canc ? round($canc * 1000 / ($n + $canc)) / 10 : 0, 'customers' => count($ph), 'repeatCustomers' => $repeat, 'repeatPct' => count($ph) ? round($repeat * 1000 / count($ph)) / 10 : 0,
        'daily' => $int($all('SELECT SUBSTR(created_at,1,10) AS d, COUNT(*) AS n, COALESCE(SUM(total),0) AS s ' . $base . ' GROUP BY SUBSTR(created_at,1,10) ORDER BY d', [$from]), ['n', 's']), 'hoursEAT' => $hrs,
        'top' => $int($all("SELECT oi.name AS name, SUM(oi.qty) AS q, SUM(oi.line_total) AS s FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status != 'cancelled' AND SUBSTR(o.created_at,1,10) >= ? GROUP BY oi.name ORDER BY s DESC LIMIT 10", [$from]), ['q', 's']),
        'byBranch' => $int($all("SELECT COALESCE(NULLIF(branch,''),'(delivery/other)') AS b, COUNT(*) AS n, COALESCE(SUM(total),0) AS s " . $base . " GROUP BY COALESCE(NULLIF(branch,''),'(delivery/other)') ORDER BY s DESC", [$from]), ['n', 's']),
        'fulfilment' => $int($all('SELECT fulfilment AS f, COUNT(*) AS n ' . $base . ' GROUP BY fulfilment', [$from]), ['n']), 'kitchens' => $kk,
        'funnel' => ['visits' => $e('visit'), 'cartAdds' => $e('cart_add'), 'checkouts' => $e('checkout_open'), 'placed' => $e('order_placed'), 'visitToCartPct' => $conv($e('visit'), $e('cart_add')), 'cartToCheckoutPct' => $conv($e('cart_add'), $e('checkout_open')), 'checkoutToOrderPct' => $conv($e('checkout_open'), $e('order_placed'))],
        'rating' => ['count' => (int)$rv['n'], 'avg' => $rv['a'] ? round((float)$rv['a'], 1) : null], 'openTickets' => $val("SELECT COUNT(*) FROM ops_tickets WHERE status = 'open'"), 'openRequests' => $val("SELECT COUNT(*) FROM ops_requests WHERE status = 'open'")]);
}
json_error('Not found', 404);
