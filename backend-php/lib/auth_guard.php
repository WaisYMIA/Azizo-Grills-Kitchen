<?php
require_once __DIR__ . '/jwt.php';
require_once __DIR__ . '/response.php';

/** Returns the verified token payload, or sends a 401 and exits. */
function require_auth(): array {
    $token = bearer_token();
    if (!$token) json_error('Missing or invalid Authorization header', 401);
    $payload = jwt_verify($token);
    if (!$payload) json_error('Invalid or expired token', 401);
    if (!empty($payload['uid'])) {   // v5.2 personal team account: switched-off or re-roled people take effect at once
        require_once __DIR__ . '/../db.php';
        $q = get_db()->prepare('SELECT active, role FROM team_accounts WHERE id = ?'); $q->execute([(int)$payload['uid']]); $a = $q->fetch();
        if (!$a || !(int)$a['active']) json_error('This account has been switched off. Ask the Owner.', 401);
        $payload['tr'] = $a['role'];
    }
    return $payload;
}

/** Current team role of the signed-in person (read live from the database), or null for the shared-password admin. */
function team_role_now(): ?string {
    $p = jwt_payload_quiet(); if (!$p || empty($p['uid'])) return null;
    require_once __DIR__ . '/../db.php'; $q = get_db()->prepare('SELECT role FROM team_accounts WHERE id = ? AND active = 1'); $q->execute([(int)$p['uid']]); $r = $q->fetchColumn(); return $r ?: 'none';
}

/** v5.2 team roles: owner = all; manager = all but owner-only; finance = money screens + read-only; counter = staff screens + reward requests. Returns a refusal text or null. */
function team_deny(array $p): ?string {
    $tr = $p['tr'] ?? null; if (!$tr || $tr === 'owner') return null;
    $path = (string)parse_url((string)($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH); $get = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET';
    $ownerOnly = ['#/api/ops/admin/(team|accounts)#', '#/api/auth/security#', '#/api/market/admin/(fees|settings)#', '#/api/site/settings#', '#/api/products/import#', '#/api/ai/admin/settings#', '#/api/growth/admin/settings#', '#/api/insight/admin/(activity|mail)#'];
    if ($tr === 'manager') { foreach ($ownerOnly as $r) if (preg_match($r, $path)) return 'Only an Owner can do this'; return null; }
    if ($tr === 'finance') {
        if (preg_match('#/api/market/admin/invoices#', $path)) return null;
        if ($get) foreach (['#/api/market/admin/(overview|fees|invoices|partners)#', '#/api/ops/admin/analytics#', '#/api/growth/admin/(recon|refunds|digest)#', '#/api/insight/admin/(reports|pack)#', '#/api/reports#', '#/api/orders#', '#/api/kitchens#'] as $r) if (preg_match($r, $path)) return null;
        if (preg_match('#/api/growth/admin/refunds#', $path)) return null;
        return 'Your Finance login can view money screens but not change this';
    }
    if ($tr === 'counter') return preg_match('#/api/(ops/admin/requests|growth/cashup)#', $path) ? null : 'Your Counter login does not cover this';
    return 'Not allowed';
}

/** Same as require_auth(), but additionally requires role === 'admin'. */
function require_admin(): array {
    $payload = require_auth();
    $counterOk = ($payload['role'] ?? null) === 'staff' && ($payload['tr'] ?? null) === 'counter' && preg_match('#/api/ops/admin/requests#', (string)($_SERVER['REQUEST_URI'] ?? ''));
    if (($payload['role'] ?? null) === 'admin' || $counterOk) { $why = team_deny($payload); if ($why) json_error($why, 403); return $payload; }
    if (($payload['role'] ?? null) !== 'admin') { sec_event_once('forbidden', 'med', 'Role ' . ($payload['role'] ?? '?') . ' tried an admin-only endpoint', 600); json_error('Admin access required', 403); }
    return $payload;
}

/** Staff or admin: the order queue, status updates and the branch directory. */
function require_staff(): array {
    $payload = require_auth();
    if (($payload['tr'] ?? null) === 'finance' && ($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') json_error('Your Finance login is read-only on orders and stock', 403);
    if (!in_array($payload['role'] ?? null, ['staff', 'admin'], true)) { sec_event_once('forbidden', 'med', 'Role ' . ($payload['role'] ?? '?') . ' tried a staff-only endpoint', 600); json_error('Staff access required', 403); }
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

/** A signed-in marketplace partner butchery; the payload carries partnerId. */
function require_partner(): array {
    $payload = require_auth();
    if (($payload['role'] ?? null) !== 'partner' || empty($payload['partnerId'])) json_error('Partner access required', 403);
    return $payload;
}

/** Azizo inspection officials (INSPECTOR_PASSWORD) and the admin may fill in inspection forms. */
function require_inspector(): array {
    $payload = require_auth();
    if (!in_array($payload['role'] ?? null, ['inspector', 'admin'], true)) json_error('Inspector access required', 403);
    return $payload;
}

