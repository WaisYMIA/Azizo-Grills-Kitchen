<?php
// Azizo Kitchens v3.1 helpers: customer messages (outbox + optional WhatsApp Cloud API) and M-Pesa STK push for Kitchens orders.
require_once __DIR__ . '/../config.php';

function kk_money($n): string { return 'KSh ' . number_format((int)$n); }

function kk_msg_text(string $kind, array $o, array $x = []): string {
    $link = SITE_URL . '/kitchens.html?track=' . $o['id']; $head = 'Azizo Kitchens order #' . $o['id'];
    $m = [
        'placed' => "$head received 🙏 " . ($x['kitchen'] ?? 'Your kitchen') . ' will confirm shortly. Total ' . kk_money($o['total']) . ". Your delivery code is {$o['delivery_code']}: give it to the rider only when you have your food. Track: $link",
        'accepted' => "$head is confirmed. The cook has started on it. Track: $link",
        'ready' => "$head is cooked and packed, waiting for the rider. Track: $link",
        'out_for_delivery' => "$head is on its way 🛵" . (!empty($x['rider']) ? ' Rider: ' . $x['rider'] . '.' : '') . ' Please have ' . ($o['paid'] ? 'your code' : kk_money($o['total']) . ' and your code') . " ready (code {$o['delivery_code']}).",
        'delivered' => "$head delivered. Enjoy your meal! Please rate it: $link",
        'rejected' => "Sorry, $head could not be taken by the kitchen" . ($o['reason'] ? ' (' . $o['reason'] . ')' : '') . '. Please order again or chat with us on WhatsApp.',
        'cancelled' => "$head was cancelled" . ($o['reason'] ? ' (' . $o['reason'] . ')' : '') . '. Questions? WhatsApp 0724 888 057.',
        'reassigned' => "$head: we moved your order to " . ($x['kitchen'] ?? 'another kitchen') . " so it still reaches you on time. Same price. Track: $link",
    ];
    return $m[$kind] ?? '';
}

function kk_http(string $method, string $url, array $headers = [], $body = null): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $headers, CURLOPT_TIMEOUT => 20]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $r = curl_exec($ch); $s = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    return ['status' => $s, 'body' => $r === false ? null : json_decode($r, true)];
}

function kk_queue(PDO $pdo, string $kind, array $o, array $x = []): void {
    try {
        $msg = kk_msg_text($kind, $o, $x); if ($msg === '' || empty($o['phone'])) return;
        $pdo->prepare('INSERT INTO kk_outbox (phone, kind, message, order_id) VALUES (?,?,?,?)')->execute([$o['phone'], $kind, $msg, $o['id']]);
        $id = (int)$pdo->lastInsertId();
        if (WA_TOKEN && WA_PHONE_ID) {
            $to = preg_replace('/\D/', '', (string)$o['phone']); if (strlen($to) === 10 && $to[0] === '0') $to = '254' . substr($to, 1); elseif (strlen($to) === 9) $to = '254' . $to;
            if (preg_match('/^254\d{9}$/', $to)) {
                $r = kk_http('POST', 'https://graph.facebook.com/v20.0/' . WA_PHONE_ID . '/messages', ['Authorization: Bearer ' . WA_TOKEN, 'Content-Type: application/json'], json_encode(['messaging_product' => 'whatsapp', 'to' => $to, 'type' => 'text', 'text' => ['body' => $msg]]));
                if ($r['status'] >= 200 && $r['status'] < 300) $pdo->prepare("UPDATE kk_outbox SET status = 'sent', sent_at = ? WHERE id = ?")->execute([gmdate('Y-m-d H:i:s'), $id]);
            }
        }
    } catch (Throwable $e) { /* never break an order over a message */ }
}

function kk_mpesa_configured(): bool { return MPESA_CONSUMER_KEY && MPESA_CONSUMER_SECRET && MPESA_SHORTCODE && MPESA_PASSKEY && MPESA_CALLBACK_URL; }

/** Sends an STK push for a Kitchens order and records it. Returns the CheckoutRequestID or throws RuntimeException. */
function kk_stk(PDO $pdo, string $phone, int $amount, string $ref): string {
    if (!kk_mpesa_configured()) throw new RuntimeException('M-Pesa is not set up on this server yet');
    $p = preg_replace('/\D/', '', $phone); if (strlen($p) === 10 && $p[0] === '0') $p = '254' . substr($p, 1); elseif (strlen($p) === 9) $p = '254' . $p;
    if (!preg_match('/^254\d{9}$/', $p)) throw new RuntimeException('Enter a valid Safaricom number');
    $base = MPESA_BASE_URL ?: (MPESA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke');
    $t = kk_http('GET', "$base/oauth/v1/generate?grant_type=client_credentials", ['Authorization: Basic ' . base64_encode(MPESA_CONSUMER_KEY . ':' . MPESA_CONSUMER_SECRET)]);
    if ($t['status'] !== 200 || empty($t['body']['access_token'])) throw new RuntimeException('M-Pesa could not start the payment. Try again or pay the rider.');
    $ts = date('YmdHis');
    $r = kk_http('POST', "$base/mpesa/stkpush/v1/processrequest", ['Authorization: Bearer ' . $t['body']['access_token'], 'Content-Type: application/json'], json_encode([
        'BusinessShortCode' => MPESA_SHORTCODE, 'Password' => base64_encode(MPESA_SHORTCODE . MPESA_PASSKEY . $ts), 'Timestamp' => $ts, 'TransactionType' => 'CustomerPayBillOnline', 'Amount' => $amount, 'PartyA' => $p, 'PartyB' => MPESA_SHORTCODE,
        'PhoneNumber' => $p, 'CallBackURL' => mpesa_callback_url(), 'AccountReference' => $ref, 'TransactionDesc' => 'Azizo Kitchens order']));
    $id = $r['body']['CheckoutRequestID'] ?? null; if ($r['status'] < 200 || $r['status'] >= 300 || !$id) throw new RuntimeException('M-Pesa could not start the payment. Try again or pay the rider.');
    $pdo->prepare("INSERT INTO mpesa_transactions (order_id, checkout_request_id, phone, amount, status) VALUES (NULL, ?, ?, ?, 'pending')")->execute([$id, $p, $amount]);
    return $id;
}
