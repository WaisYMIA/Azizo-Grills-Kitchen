<?php
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/jwt.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('POST required', 405);

$body = read_json_body();
$phone = trim($body['phone'] ?? '');
$password = (string)($body['password'] ?? '');
if ($phone === '' || $password === '') json_error('phone and password are required');

$pdo = get_db();
$stmt = $pdo->prepare('SELECT * FROM customers WHERE phone = ?');
$stmt->execute([$phone]);
$customer = $stmt->fetch();

if (!$customer || !password_verify($password, $customer['password_hash'])) {
    json_error('Incorrect phone number or password', 401);
}

$token = jwt_sign(['id' => $customer['id'], 'phone' => $customer['phone'], 'role' => 'customer'], 60 * 60 * 24 * 30);
json_response([
    'token' => $token,
    'customer' => ['id' => $customer['id'], 'name' => $customer['name'], 'phone' => $customer['phone']],
]);
