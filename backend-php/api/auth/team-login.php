<?php
// v5.2 personal team accounts: POST {username, password} -> token. POST {username, password, newPassword} to change your own password.
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/jwt.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('POST required', 405);
$body = read_json_body(); $u = strtolower(trim((string)($body['username'] ?? ''))); $pw = (string)($body['password'] ?? '');
throttle_check('team', $u === '' ? 'none' : $u, 8, 900);
$pdo = get_db(); $q = $pdo->prepare('SELECT * FROM team_accounts WHERE username = ?'); $q->execute([$u]); $a = $q->fetch();
if (!$a || !(int)$a['active'] || !password_verify($pw, $a['password_hash'])) { throttle_fail('team', $u === '' ? 'none' : $u); json_error('Incorrect username or password', 401); }
// New password (own account): same checks, then done.
if (array_key_exists('newPassword', $body)) {
    $np = (string)$body['newPassword'];
    if (strlen($np) < 10 || !preg_match('/[A-Za-z]/', $np) || !preg_match('/\d/', $np)) json_error('New password needs 10+ characters with a letter and a number');
    $pdo->prepare('UPDATE team_accounts SET password_hash = ? WHERE id = ?')->execute([password_hash($np, PASSWORD_BCRYPT), (int)$a['id']]); throttle_clear('team', $u); audit_log('team-password', $u, $a['name'] . ' (' . $a['role'] . ')'); json_response(['ok' => true]);
}
// The 2-step authenticator code (when switched on) is also needed for Owner, Manager and Finance sign-in.
if ($a['role'] !== 'counter' && totp_enabled() && !totp_verify((string)($body['code'] ?? ''))) {
    if (empty($body['code'])) json_error('Enter the 6-digit code from your authenticator app', 401, ['needCode' => true]);
    throttle_fail('team', $u); json_error('That code is not right or has expired', 401, ['needCode' => true]);
}
throttle_clear('team', $u);
$pdo->prepare('UPDATE team_accounts SET last_login = ? WHERE id = ?')->execute([gmdate('Y-m-d H:i:s'), (int)$a['id']]);
audit_log('team-login', $u, $a['name'] . ' (' . $a['role'] . ')');
json_response(['token' => jwt_sign(['role' => $a['role'] === 'counter' ? 'staff' : 'admin', 'tr' => $a['role'], 'uid' => (int)$a['id'], 'name' => $a['name']], 60 * 60 * 8), 'name' => $a['name'], 'role' => $a['role']]);
