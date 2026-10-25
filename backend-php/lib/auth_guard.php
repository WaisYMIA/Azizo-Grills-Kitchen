<?php
require_once __DIR__ . '/jwt.php';
require_once __DIR__ . '/response.php';

/** Returns the verified token payload, or sends a 401 and exits. */
function require_auth(): array {
    $token = bearer_token();
    if (!$token) json_error('Missing or invalid Authorization header', 401);
    $payload = jwt_verify($token);
    if (!$payload) json_error('Invalid or expired token', 401);
    return $payload;
}

/** Same as require_auth(), but additionally requires role === 'admin'. */
function require_admin(): array {
    $payload = require_auth();
    if (($payload['role'] ?? null) !== 'admin') json_error('Admin access required', 403);
    return $payload;
}

/** Staff or admin: the order queue, status updates and the branch directory. */
function require_staff(): array {
    $payload = require_auth();
    if (!in_array($payload['role'] ?? null, ['staff', 'admin'], true)) json_error('Staff access required', 403);
    return $payload;
}

/** Kitchens Admin (kitchens-admin.html): role 'kitchens', or the main admin. */
function require_kitchens_admin(): array {
    $payload = require_auth();
    if (!in_array($payload['role'] ?? null, ['kitchens', 'admin'], true)) json_error('Kitchens admin access required', 403);
    return $payload;
}

/** A signed-in Kitchen Partner; the payload carries kitchenId. */
function require_kitchen(): array {
    $payload = require_auth();
    if (($payload['role'] ?? null) !== 'kitchen' || empty($payload['kitchenId'])) json_error('Kitchen partner access required', 403);
    return $payload;
}
