<?php
// Tamper-evident activity log (v5.5), same format as the Node backend: each row's SHA-256 hash covers the previous row's hash.
function act_db(): PDO { return function_exists('sec_db') ? sec_db() : get_db(); }
function act_clean($v, int $n): string { return mb_substr(trim(preg_replace('/[\x00-\x08\x0b\x0c\x0e-\x1f]/', ' ', (string)($v ?? ''))), 0, $n); }
function act_hash(string $prev, array $r): string { return hash('sha256', implode("\u{241F}", [$prev, $r['ts'], $r['category'], $r['action'], $r['actor'], $r['role'], $r['ip'], $r['target'], $r['detail'], $r['outcome']])); }
function act_category(string $a): string {
    $a = strtolower($a);
    foreach ([['/login|logout|password|passcode|2fa|totp/', 'auth'], ['/export|download/', 'export'], ['/team|account|owner/', 'team'], ['/refund|cashup|cash-up|price|payout|mpesa|payment/', 'money'], ['/setting|mail|config|ai-|key/', 'settings'], ['/inspect|golive|partner|market/', 'marketplace'], ['/order/', 'orders'], ['/block|security|lock/', 'security']] as [$rx, $c]) if (preg_match($rx, $a)) return $c;
    return 'admin';
}
function activity_add(string $category, string $action, array $o = []): void {
    try {
        $pdo = act_db(); $p = function_exists('jwt_payload_quiet') ? jwt_payload_quiet() : null; $p = $p ?: [];
        if ($action === 'login-ok') $action = 'login';
        $actor = $o['actor'] ?? (!empty($p['name']) ? $p['name'] : ($p['role'] ?? ''));
        $role = $o['role'] ?? ($p['tr'] ?? (($p['role'] ?? '') === 'admin' ? 'owner' : ($p['role'] ?? '')));
        $r = ['ts' => gmdate('Y-m-d H:i:s'), 'category' => act_clean($category ?: act_category($action), 20), 'action' => act_clean($action, 60), 'actor' => act_clean($actor, 80), 'role' => act_clean($role, 20), 'ip' => act_clean(function_exists('client_ip') ? client_ip() : '', 60), 'target' => act_clean($o['target'] ?? '', 100), 'detail' => act_clean($o['detail'] ?? '', 500), 'outcome' => ($o['outcome'] ?? 'ok') === 'fail' ? 'fail' : 'ok'];
        $pdo->beginTransaction();
        $last = $pdo->query('SELECT hash FROM activity_log ORDER BY id DESC LIMIT 1')->fetch(); $prev = $last ? (string)$last['hash'] : '';
        $pdo->prepare('INSERT INTO activity_log (ts, category, action, actor, role, ip, target, detail, outcome, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)')->execute([$r['ts'], $r['category'], $r['action'], $r['actor'], $r['role'], $r['ip'], $r['target'], $r['detail'], $r['outcome'], $prev, act_hash($prev, $r)]);
        $pdo->commit();
    } catch (Throwable $e) { try { act_db()->rollBack(); } catch (Throwable $x) {} error_log('[azizo] activity failed: ' . $e->getMessage()); }
}
function activity_verify(): array {
    $prev = ''; $n = 0; $q = act_db()->query('SELECT * FROM activity_log ORDER BY id');
    while ($r = $q->fetch()) { $n++; $row = ['ts' => $r['ts'], 'category' => $r['category'], 'action' => $r['action'], 'actor' => $r['actor'], 'role' => $r['role'], 'ip' => $r['ip'], 'target' => $r['target'], 'detail' => $r['detail'], 'outcome' => $r['outcome']];
        if ($r['prev_hash'] !== $prev || $r['hash'] !== act_hash($prev, $row)) return ['ok' => false, 'checked' => $n, 'brokenAtId' => (int)$r['id']]; $prev = $r['hash']; }
    return ['ok' => true, 'checked' => $n, 'brokenAtId' => null];
}
