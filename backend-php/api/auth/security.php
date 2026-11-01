<?php
// Security Center API — admin only.
//  GET                      overview: health checks, summary numbers, blocked addresses, recent audit trail
//  GET ?events=1&sev=&type=&ip=&q=&days=&limit=&offset=   the attack / failure log (filters optional)
//  GET ?csv=1&...           same log as a CSV download
//  POST {action: revoke-all | block | unblock | verify-orders}
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight(); header('Cache-Control: no-store');
require_admin();
$pdo = get_db();
$ipRx = fn($v) => filter_var((string)$v, FILTER_VALIDATE_IP) ? (string)$v : null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $b = read_json_body(); $a = (string)($b['action'] ?? '');
    if ($a === 'revoke-all') { sec_bump_epoch(); audit_log('revoke-all', 'all sessions ended'); json_response(['ok' => true, 'token' => jwt_sign(['role' => 'admin'], 60 * 60 * 8)]); }
    if ($a === 'block') {
        $ip = $ipRx($b['ip'] ?? ''); if (!$ip) json_error('Enter a valid IP address');
        if ($ip === client_ip() && empty($b['force'])) json_error('That is your own address — blocking it would lock you out.');
        $h = max(1, min(24 * 365, (int)($b['hours'] ?? 24))); sec_block($ip, $h * 3600, 'Blocked by admin: ' . substr(trim((string)($b['reason'] ?? 'manual')), 0, 120), false); audit_log('block-ip', $ip . ' for ' . $h . 'h'); json_response(['ok' => true]);
    }
    if ($a === 'unblock') { $ip = $ipRx($b['ip'] ?? ''); if (!$ip) json_error('Enter a valid IP address'); $pdo->prepare('DELETE FROM sec_blocks WHERE ip = ?')->execute([$ip]); sec_event('unblock', 'info', 'Unblocked by admin: ' . $ip, 'admin'); audit_log('unblock-ip', $ip); json_response(['ok' => true]); }
    if ($a === 'verify-orders') { $dd = max(1, min(365, (int)($b['days'] ?? 30))); $r = order_verify_recent($pdo, $dd); $kr = kk_verify_recent($pdo, $dd); $r['kitchens'] = $kr; audit_log('verify-orders', 'checked ' . ($r['checked'] + $kr['checked']) . ', tampered ' . (count($r['tampered']) + count($kr['tampered']))); json_response($r); }
    json_error('Unknown action');
}

// ---- filters for the log ----
$sevRank = ['info' => 0, 'low' => 1, 'med' => 2, 'high' => 3, 'crit' => 4];
$where = ['ts >= ?']; $par = [gmdate('Y-m-d H:i:s', time() - max(1, min(180, (int)($_GET['days'] ?? 7))) * 86400)];
if (!empty($_GET['sev']) && isset($sevRank[$_GET['sev']])) { $ok = array_keys(array_filter($sevRank, fn($r) => $r >= $sevRank[$_GET['sev']])); $where[] = 'sev IN (' . implode(',', array_fill(0, count($ok), '?')) . ')'; array_push($par, ...$ok); }
if (!empty($_GET['type'])) { $where[] = 'type = ?'; $par[] = substr((string)$_GET['type'], 0, 32); }
if (!empty($_GET['ip'])) { $where[] = 'ip = ?'; $par[] = substr((string)$_GET['ip'], 0, 45); }
if (!empty($_GET['q'])) { $like = '%' . str_replace(['%', '_'], ['', ''], substr((string)$_GET['q'], 0, 60)) . '%'; $where[] = '(detail LIKE ? OR path LIKE ? OR ua LIKE ?)'; array_push($par, $like, $like, $like); }
$W = implode(' AND ', $where);

if (!empty($_GET['csv'])) {
    $q = $pdo->prepare("SELECT ts, sev, type, ip, path, actor, detail, ua FROM sec_events WHERE $W ORDER BY id DESC LIMIT 5000"); $q->execute($par);
    header('Content-Type: text/csv; charset=utf-8'); header('Content-Disposition: attachment; filename="azizo-security-log.csv"');
    $o = fopen('php://output', 'w'); fputcsv($o, ['Time (UTC)', 'Severity', 'Type', 'IP address', 'Path', 'Who', 'Detail', 'Browser']);
    foreach ($q->fetchAll() as $r) fputcsv($o, array_map(fn($v) => preg_match('/^[=+\-@]/', (string)$v) ? "'" . $v : $v, array_values($r))); exit;
}
if (!empty($_GET['events'])) {
    $lim = max(1, min(200, (int)($_GET['limit'] ?? 50))); $off = max(0, (int)($_GET['offset'] ?? 0));
    $c = $pdo->prepare("SELECT COUNT(*) FROM sec_events WHERE $W"); $c->execute($par);
    $q = $pdo->prepare("SELECT id, ts, sev, type, ip, ua, path, actor, detail FROM sec_events WHERE $W ORDER BY id DESC LIMIT $lim OFFSET $off"); $q->execute($par);
    json_response(['total' => (int)$c->fetchColumn(), 'events' => $q->fetchAll()]);
}

// ---- overview ----
$since = gmdate('Y-m-d H:i:s', time() - 7 * 86400);
$q = $pdo->prepare('SELECT ts, sev, type, ip FROM sec_events WHERE ts >= ? ORDER BY id DESC LIMIT 6000'); $q->execute([$since]); $rows = $q->fetchAll();
$d24 = time() - 86400; $sum = ['events24' => 0, 'events7d' => count($rows), 'high24' => 0, 'loginFails24' => 0, 'lockouts24' => 0, 'probes24' => 0, 'tamper24' => 0, 'forged24' => 0];
$byType = []; $ips = []; $hours = array_fill(0, 24, 0);
$w = sec_weights();
foreach ($rows as $r) {
    $t = strtotime($r['ts'] . ' UTC'); $byType[$r['type']] = ($byType[$r['type']] ?? 0) + 1;
    if ($t < $d24) continue;
    $sum['events24']++; if (in_array($r['sev'], ['high', 'crit'], true)) $sum['high24']++;
    if ($r['type'] === 'login-fail') $sum['loginFails24']++; if ($r['type'] === 'lockout') $sum['lockouts24']++;
    if (in_array($r['type'], ['probe', 'scanner', 'scanner-ua'], true)) $sum['probes24']++;
    if (in_array($r['type'], ['order-tamper', 'fee-tamper', 'order-tampered'], true)) $sum['tamper24']++;
    if (in_array($r['type'], ['token-forged', 'mpesa-forged', 'mpesa-amount'], true)) $sum['forged24']++;
    $hours[(int)min(23, floor((time() - $t) / 3600))]++;
    if (!in_array($r['type'], ['auto-block', 'manual-block', 'unblock'], true)) { $ips[$r['ip']] = $ips[$r['ip']] ?? ['ip' => $r['ip'], 'n' => 0, 'points' => 0, 'last' => $r['type']]; $ips[$r['ip']]['n']++; $ips[$r['ip']]['points'] += ($w[$r['type']] ?? 0); }
}
usort($ips, fn($a, $b) => $b['points'] <=> $a['points'] ?: $b['n'] <=> $a['n']); $top = array_slice(array_values($ips), 0, 10);
arsort($byType);
$blocks = $pdo->prepare('SELECT ip, until_ts, reason, auto_block, strikes, created_ts FROM sec_blocks WHERE until_ts > ? ORDER BY until_ts DESC LIMIT 200'); $blocks->execute([time()]);
$audit = $pdo->query('SELECT ts, actor, ip, action, detail FROM sec_audit ORDER BY id DESC LIMIT 100')->fetchAll();
json_response(['checks' => sec_check_report(), 'summary' => $sum, 'hours' => array_reverse($hours), 'byType' => $byType, 'topIps' => $top, 'blocks' => $blocks->fetchAll(), 'audit' => $audit, 'myIp' => client_ip(), 'now' => time()]);
