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
$phone = $body['phone'] ?? '';
$amount = $body['amount'] ?? null;
$orderId = $body['orderId'] ?? null;
if (!$phone || !$amount) json_error('phone and amount are required');

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
            'PartyB' => MPESA_SHORTCODE, 'PhoneNumber' => $phone, 'CallBackURL' => MPESA_CALLBACK_URL,
            'AccountReference' => 'Azizo-' . ($orderId ?: 'Order'), 'TransactionDesc' => 'Azizo Butchery & Grill order',
        ])
    );

    if ($stkRes['status'] < 200 || $stkRes['status'] >= 300) {
        json_error('Daraja rejected the STK push request', 502, ['details' => $stkRes['body']]);
    }

    $checkoutRequestId = $stkRes['body']['CheckoutRequestID'] ?? null;
    $pdo = get_db();
    $pdo->prepare("INSERT INTO mpesa_transactions (order_id, checkout_request_id, phone, amount, status) VALUES (?, ?, ?, ?, 'pending')")
        ->execute([$orderId ?: null, $checkoutRequestId, $phone, round($amount)]);

    json_response(['ok' => true, 'checkoutRequestId' => $checkoutRequestId, 'message' => 'STK push sent — customer should check their phone.']);
} catch (Exception $e) {
    json_error('Something went wrong sending the STK push', 500, ['details' => $e->getMessage()]);
}
