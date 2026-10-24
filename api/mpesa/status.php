<?php
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_error('GET required', 405);

$checkoutRequestId = $_GET['checkoutRequestId'] ?? '';
$pdo = get_db();
$stmt = $pdo->prepare('SELECT status, mpesa_receipt FROM mpesa_transactions WHERE checkout_request_id = ?');
$stmt->execute([$checkoutRequestId]);
$txn = $stmt->fetch();
if (!$txn) json_error('Transaction not found', 404);
json_response($txn);
