<?php
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/jwt.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('POST required', 405);

$body = read_json_body();
$name = trim($body['name'] ?? '');
$phone = trim($body['phone'] ?? '');
$password = (string)($body['password'] ?? '');

if ($name === '' || $phone === '' || $password === '') {
    json_error('name, phone, and password are all required');
}
if (strlen($password) < 6) {
    json_error('Password must be at least 6 characters');
}

$pdo = get_db();
$existing = $pdo->prepare('SELECT id FROM customers WHERE phone = ?');
$existing->execute([$phone]);
if ($existing->fetch()) {
    json_error('An account with this phone number already exists', 409);
}

$hash = password_hash($password, PASSWORD_BCRYPT);
$pdo->prepare('INSERT INTO customers (name, phone, password_hash) VALUES (?, ?, ?)')
    ->execute([$name, $phone, $hash]);
$id = (int)$pdo->lastInsertId();

$customer = ['id' => $id, 'name' => $name, 'phone' => $phone];
$token = jwt_sign(['id' => $id, 'phone' => $phone, 'role' => 'customer'], 60 * 60 * 24 * 30);
json_response(['token' => $token, 'customer' => $customer], 201);
