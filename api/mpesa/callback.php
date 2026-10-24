<?php
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../db.php';
// No cors_and_preflight() here — Safaricom's servers call this directly, not a browser.

$raw = file_get_contents('php://input');
$data = json_decode($raw, true);
$stkCallback = $data['Body']['stkCallback'] ?? null;
if (!$stkCallback) json_error('Unexpected callback shape', 400);

$checkoutRequestId = $stkCallback['CheckoutRequestID'] ?? null;
$resultCode = $stkCallback['ResultCode'] ?? 1;
$success = $resultCode === 0;
$mpesaReceipt = null;
if ($success && !empty($stkCallback['CallbackMetadata']['Item'])) {
    foreach ($stkCallback['CallbackMetadata']['Item'] as $item) {
        if (($item['Name'] ?? '') === 'MpesaReceiptNumber') { $mpesaReceipt = $item['Value'] ?? null; break; }
    }
}

$pdo = get_db();
$pdo->prepare('UPDATE mpesa_transactions SET status = ?, mpesa_receipt = ?, raw_callback = ? WHERE checkout_request_id = ?')
    ->execute([$success ? 'success' : 'failed', $mpesaReceipt, $raw, $checkoutRequestId]);

if ($success) {
    $txnStmt = $pdo->prepare('SELECT order_id FROM mpesa_transactions WHERE checkout_request_id = ?');
    $txnStmt->execute([$checkoutRequestId]);
    $txn = $txnStmt->fetch();
    if ($txn && $txn['order_id']) {
        $pdo->prepare('UPDATE orders SET mpesa_receipt = ? WHERE id = ?')->execute([$mpesaReceipt, $txn['order_id']]);
    }
}

if ($success) { try { $pdo->prepare("UPDATE kk_orders SET paid = 1, mpesa_receipt = ?, updated_at = ? WHERE mpesa_checkout = ?")->execute([$mpesaReceipt ?: '', gmdate('Y-m-d H:i:s'), $checkoutRequestId]); } catch (Throwable $e) { /* kk_ tables not present */ } }

json_response(['ResultCode' => 0, 'ResultDesc' => 'Accepted']);
