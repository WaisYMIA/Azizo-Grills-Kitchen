<?php
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('POST required', 405);
require_admin();

$body = read_json_body();
$id = trim($body['id'] ?? ($_POST['id'] ?? ''));
if ($id === '') json_error('id is required');

$pdo = get_db();
$result = $pdo->prepare('DELETE FROM products WHERE id = ?');
$result->execute([$id]);
if ($result->rowCount() === 0) json_error('No product with that id', 404);

json_response(['ok' => true]);
