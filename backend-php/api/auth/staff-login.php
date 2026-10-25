<?php
// Staff sign in with their own password (STAFF_PASSWORD) — opens staff.html only, never the admin tool.
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/jwt.php';
cors_and_preflight();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('POST required', 405);
if (STAFF_PASSWORD === '') json_error('Staff login is not set up yet — ask the admin to set STAFF_PASSWORD on the server', 503);

$body = read_json_body();
$password = (string)($body['password'] ?? '');
if ($password === '' || !hash_equals(STAFF_PASSWORD, $password)) json_error('Incorrect staff password', 401);

json_response(['token' => jwt_sign(['role' => 'staff'], 60 * 60 * 12)]);
