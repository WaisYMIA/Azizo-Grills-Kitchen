<?php
/**
 * A minimal, dependency-free HS256 JWT implementation — deliberately small
 * so the backend needs no Composer packages (many budget cPanel plans have
 * no SSH/Composer access). Same algorithm and token shape as a standard JWT
 * library; just hand-rolled.
 */
require_once __DIR__ . '/../config.php';

function base64url_encode(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}
function base64url_decode(string $data): string {
    return base64_decode(strtr($data, '-_', '+/'));
}

function jwt_sign(array $payload, int $expiresInSeconds): string {
    $header = ['alg' => 'HS256', 'typ' => 'JWT'];
    $payload['iat'] = time();
    $payload['exp'] = time() + $expiresInSeconds;
    $segments = [
        base64url_encode(json_encode($header)),
        base64url_encode(json_encode($payload)),
    ];
    $signingInput = implode('.', $segments);
    $signature = hash_hmac('sha256', $signingInput, JWT_SECRET, true);
    $segments[] = base64url_encode($signature);
    return implode('.', $segments);
}

/** Returns the decoded payload array, or null if the token is invalid/expired. */
function jwt_verify(string $token): ?array {
    $parts = explode('.', $token);
    if (count($parts) !== 3) return null;
    [$headerB64, $payloadB64, $sigB64] = $parts;
    $expectedSig = hash_hmac('sha256', "$headerB64.$payloadB64", JWT_SECRET, true);
    if (!hash_equals($expectedSig, base64url_decode($sigB64))) return null;
    $payload = json_decode(base64url_decode($payloadB64), true);
    if (!is_array($payload)) return null;
    if (isset($payload['exp']) && time() > $payload['exp']) return null;
    return $payload;
}

function bearer_token(): ?string {
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (stripos($header, 'Bearer ') === 0) return substr($header, 7);
    return null;
}
