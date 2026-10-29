<?php
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/jwt.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('POST required', 405);

$body = read_json_body();
$name = trim(preg_replace('/[\x00-\x1f<>]/', ' ', (string)($body['name'] ?? '')));
$phone = trim($body['phone'] ?? '');
$password = (string)($body['password'] ?? '');

if ($name === '' || $phone === '' || $password === '') {
    json_error('name, phone, and password are all required');
}
rate_limit('register', 8, 3600);   // 8 new accounts per hour per visitor
if (($pp = password_problem($password)) !== null) json_error($pp);
if (mb_strlen($name) > 80 || strlen(preg_replace('/\D/', '', $phone)) < 9 || strlen($phone) > 20) json_error('Enter a valid name and phone number');

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
