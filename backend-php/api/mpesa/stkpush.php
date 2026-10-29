<?php
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('POST required', 405);

function mpesa_configured(): bool {
    return MPESA_CONSUMER_KEY && MPESA_CONSUMER_SECRET && MPESA_SHORTCODE && MPESA_PASSKEY && MPESA_CALLBACK_URL;
}

if (!mpesa_configured()) {
    json_error('M-Pesa is not configured on this server yet. Add MPESA_* values to config.php.', 503);
}

$body = read_json_body();
$phone = preg_replace('/\D/', '', (string)($body['phone'] ?? ''));
$orderId = (int)($body['orderId'] ?? 0);
if ($orderId <= 0 || !$phone) json_error('orderId and phone are required');
if (strlen($phone) === 10 && $phone[0] === '0') $phone = '254' . substr($phone, 1); elseif (strlen($phone) === 9) $phone = '254' . $phone;
if (!preg_match('/^254[17]\d{8}$/', $phone)) json_error('Enter a valid Safaricom number');
// Anti-harassment and anti-fraud: few prompts per visitor and per phone; the amount always comes from the saved order, never from the browser.
rate_limit('stk-ip', 10, 3600); rate_limit('stk-phone', 3, 1800, $phone);
$oq = get_db()->prepare('SELECT id, total, customer_phone, status, partner_id FROM orders WHERE id = ?'); $oq->execute([$orderId]); $ord = $oq->fetch();
if (!$ord || substr(preg_replace('/\D/', '', (string)$ord['customer_phone']), -9) !== substr($phone, -9)) json_error('That order does not match this phone number', 403);
if (!empty($ord['partner_id'])) json_error('This order is paid directly to the butchery', 400);
if (in_array($ord['status'], ['cancelled', 'completed'], true)) json_error('This order is closed', 400);
$amount = (int)$ord['total'];

$baseUrl = MPESA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';

function http_request(string $method, string $url, array $headers = [], $body = null) {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $response = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($response === false) throw new RuntimeException("Request to $url failed: $err");
    return ['status' => $status, 'body' => json_decode($response, true)];
}

try {
    $auth = base64_encode(MPESA_CONSUMER_KEY . ':' . MPESA_CONSUMER_SECRET);
    $tokenRes = http_request('GET', "$baseUrl/oauth/v1/generate?grant_type=client_credentials", ["Authorization: Basic $auth"]);
    if ($tokenRes['status'] !== 200) throw new RuntimeException('Daraja auth failed: ' . $tokenRes['status']);
    $accessToken = $tokenRes['body']['access_token'];

    $timestamp = date('YmdHis');
    $password = base64_encode(MPESA_SHORTCODE . MPESA_PASSKEY . $timestamp);

    $stkRes = http_request('POST', "$baseUrl/mpesa/stkpush/v1/processrequest",
        ["Authorization: Bearer $accessToken", 'Content-Type: application/json'],
        json_encode([
            'BusinessShortCode' => MPESA_SHORTCODE, 'Password' => $password, 'Timestamp' => $timestamp,
            'TransactionType' => 'CustomerPayBillOnline', 'Amount' => round($amount), 'PartyA' => $phone,
            'PartyB' => MPESA_SHORTCODE, 'PhoneNumber' => $phone, 'CallBackURL' => mpesa_callback_url(),
            'AccountReference' => 'Azizo-' . ($orderId ?: 'Order'), 'TransactionDesc' => 'Azizo Butchery & Grill order',
        ])
    );

    if ($stkRes['status'] < 200 || $stkRes['status'] >= 300) {
        error_log('[azizo] daraja rejected: ' . json_encode($stkRes['body'])); json_error('The payment request was rejected. Please try again.', 502);
    }

    $checkoutRequestId = $stkRes['body']['CheckoutRequestID'] ?? null;
    $pdo = get_db();
    $pdo->prepare("INSERT INTO mpesa_transactions (order_id, checkout_request_id, phone, amount, status) VALUES (?, ?, ?, ?, 'pending')")
        ->execute([$orderId ?: null, $checkoutRequestId, $phone, round($amount)]);

    json_response(['ok' => true, 'checkoutRequestId' => $checkoutRequestId, 'message' => 'STK push sent — customer should check their phone.']);
} catch (Exception $e) {
    error_log('[azizo] stkpush: ' . $e->getMessage()); json_error('Something went wrong sending the STK push', 500);
}
