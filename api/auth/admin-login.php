<?php
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/jwt.php';
cors_and_preflight();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('POST required', 405);

$body = read_json_body();
$password = (string)($body['password'] ?? '');

if ($password === '' || !hash_equals(ADMIN_PASSWORD, $password)) {
    json_error('Incorrect admin password', 401);
}

$token = jwt_sign(['role' => 'admin'], 60 * 60 * 12);
json_response(['token' => $token]);
