<?php
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/jwt.php';
cors_and_preflight();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('POST required', 405);
sec_require_strong_admin_password();

$body = read_json_body();
$password = (string)($body['password'] ?? '');
throttle_check('admin', 'admin', 6, 900);   // 6 wrong tries per 15 minutes, then locked (per account and per visitor address)

if ($password === '' || !hash_equals(ADMIN_PASSWORD, $password)) {
    throttle_fail('admin', 'admin');
    json_error('Incorrect admin password', 401);
}
// Optional 2-step code (authenticator app). The password alone is not enough once ADMIN_TOTP_SECRET is set.
if (totp_enabled() && !totp_verify((string)($body['code'] ?? ''))) {
    if (empty($body['code'])) json_error('Enter the 6-digit code from your authenticator app', 401, ['needCode' => true]);
    throttle_fail('admin', 'admin');
    json_error('That code is not right or has expired', 401, ['needCode' => true]);
}
throttle_clear('admin', 'admin');
audit_log('login-ok', 'admin', 'admin');
$token = jwt_sign(['role' => 'admin'], 60 * 60 * 8);
json_response(['token' => $token]);
