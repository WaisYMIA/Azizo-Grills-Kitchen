<?php
/**
 * Azizo security layer (v4.1). Loaded by response.php, so every endpoint gets it.
 *  - security headers, safe error handling, strong-secret guard (strict only on a real server, never on localhost/WAMP)
 *  - DB-backed rate limiting and login lockout (works on shared cPanel hosting: no Redis, no temp-file races)
 *  - audit log, session epoch ("sign out everyone"), optional admin 2-step code (TOTP), password policy
 */
require_once __DIR__ . '/../config.php';

/** True on a developer machine: localhost, 127.x, ::1, *.test, *.local, or a private LAN address (WAMP, phone-on-Wi-Fi tests). */
function sec_is_local(): bool {
    $h = strtolower(preg_replace('/:\d+$/', '', (string)($_SERVER['HTTP_HOST'] ?? $_SERVER['SERVER_NAME'] ?? '')));
    $a = (string)($_SERVER['REMOTE_ADDR'] ?? '');
    if (defined('SEC_FORCE_STRICT') && SEC_FORCE_STRICT) return false;
    $localHost = $h === 'localhost' || $h === '127.0.0.1' || $h === '[::1]' || preg_match('/\.(test|local|localhost)$/', $h);
    $privateHost = (bool)preg_match('/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/', $h);
    // The visitor must also be local, so a public attacker cannot fake a "localhost" Host header to switch the checks off.
    $localAddr = $a === '127.0.0.1' || $a === '::1' || (bool)preg_match('/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/', $a);
    return ($localHost || $privateHost) && ($localAddr || php_sapi_name() === 'cli');
}
function sec_is_https(): bool { return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https' && defined('TRUSTED_PROXY') && TRUSTED_PROXY !== ''); }

/** The visitor's address. X-Forwarded-For is trusted only when TRUSTED_PROXY is set (e.g. behind Cloudflare), never by default. */
function client_ip(): string {
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
    if (defined('TRUSTED_PROXY') && TRUSTED_PROXY !== '') {
        $c = trim((string)($_SERVER['HTTP_CF_CONNECTING_IP'] ?? ''));
        if ($c === '') { $x = explode(',', (string)($_SERVER['HTTP_X_FORWARDED_FOR'] ?? '')); $c = trim($x[0] ?? ''); }
        if ($c !== '' && filter_var($c, FILTER_VALIDATE_IP)) $ip = $c;
    }
    return $ip;
}

function sec_default_secret(): bool { return JWT_SECRET === 'dev-only-secret-change-me-before-launch' || strlen(JWT_SECRET) < 32; }
function sec_default_admin(): bool { return ADMIN_PASSWORD === 'majani90' || strlen(ADMIN_PASSWORD) < 10; }

/** Called by cors_and_preflight() on every request. */
function sec_boot(): void {
    static $done = false; if ($done) return; $done = true;
    $local = sec_is_local();
    @ini_set('display_errors', $local ? '1' : '0'); @ini_set('log_errors', '1'); @ini_set('expose_php', '0');
    header('X-Content-Type-Options: nosniff'); header('X-Frame-Options: DENY'); header('Referrer-Policy: no-referrer');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'"); header('Permissions-Policy: geolocation=(), camera=(), microphone=()'); header('Cross-Origin-Resource-Policy: cross-origin');
    if (sec_is_https()) header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
    header_remove('X-Powered-By');
    // CORS: ALLOWED_ORIGIN may be "*", one origin, or a comma list. A list is matched exactly and echoed back.
    if (ALLOWED_ORIGIN !== '*' && strpos(ALLOWED_ORIGIN, ',') !== false) {
        header_remove('Access-Control-Allow-Origin'); $o = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
        if ($o !== '' && in_array($o, array_map('trim', explode(',', ALLOWED_ORIGIN)), true)) header('Access-Control-Allow-Origin: ' . $o);
        header('Vary: Origin');
    }
    // Never leak database or file details to the visitor; the real error goes to the server log.
    set_exception_handler(function ($e) use ($local) {
        error_log('[azizo] ' . get_class($e) . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
        if (!headers_sent()) { http_response_code(500); header('Content-Type: application/json'); }
        echo json_encode(['error' => $local ? ('Server error: ' . $e->getMessage()) : 'Something went wrong on the server']); exit;
    });
    // On a real server the site must not run with the shipped development secret: anyone who knows it can forge an admin token.
    if (!$local && sec_default_secret() && !(defined('SEC_ALLOW_WEAK') && SEC_ALLOW_WEAK)) {
        if (!headers_sent()) { http_response_code(503); header('Content-Type: application/json'); }
        echo json_encode(['error' => 'Server not secured yet: set a strong JWT_SECRET (32+ characters) in config.local.php. See docs/SECURITY.md.']); exit;
    }
}
/** Admin-type logins refuse to work on a real server while the shipped default or a short password is in use. */
function sec_require_strong_admin_password(): void {
    if (!sec_is_local() && sec_default_admin() && !(defined('SEC_ALLOW_WEAK') && SEC_ALLOW_WEAK)) json_error('Admin login is locked until you set a strong ADMIN_PASSWORD (10+ characters) in config.local.php. See docs/SECURITY.md.', 503);
}

// ---------- rate limiting and lockout ----------
function sec_db(): PDO { require_once __DIR__ . '/../db.php'; return get_db(); }
/** Count one hit; send 429 when over the limit. Use for public endpoints (apply, orders, register...). */
function rate_limit(string $bucket, int $max, int $windowSec, ?string $key = null): void {
    $pdo = sec_db(); $k = substr($bucket . ':' . sha1($key ?? client_ip()), 0, 80); $now = time();
    $q = $pdo->prepare('SELECT hits, win_start FROM sec_rate WHERE k = ?'); $q->execute([$k]); $r = $q->fetch();
    if (!$r || $now - (int)$r['win_start'] >= $windowSec) {
        if ($r) $pdo->prepare('UPDATE sec_rate SET hits = 1, win_start = ? WHERE k = ?')->execute([$now, $k]);
        else { try { $pdo->prepare('INSERT INTO sec_rate (k, hits, win_start) VALUES (?, 1, ?)')->execute([$k, $now]); } catch (Exception $e) {} }
        if (mt_rand(1, 60) === 1) $pdo->prepare('DELETE FROM sec_rate WHERE win_start < ?')->execute([$now - 86400]);
        return;
    }
    if ((int)$r['hits'] >= $max) { $wait = max(1, $windowSec - ($now - (int)$r['win_start'])); header('Retry-After: ' . $wait); json_error('Too many attempts. Please wait ' . ceil($wait / 60) . ' minute(s) and try again.', 429); }
    $pdo->prepare('UPDATE sec_rate SET hits = hits + 1 WHERE k = ?')->execute([$k]);
}
/** Lockout for logins: check before verifying the password, count only failures, clear on success. */
function throttle_check(string $scope, string $id, int $max = 8, int $windowSec = 900): void {
    $pdo = sec_db(); $now = time();
    foreach ([[$scope . ':a', strtolower($id)], [$scope . ':i', client_ip()]] as [$b, $key]) {
        $q = $pdo->prepare('SELECT hits, win_start FROM sec_rate WHERE k = ?'); $q->execute([substr($b . ':' . sha1($key), 0, 80)]); $r = $q->fetch();
        $lim = substr($b, -1) === 'i' ? $max * 3 : $max;
        if ($r && $now - (int)$r['win_start'] < $windowSec && (int)$r['hits'] >= $lim) { $wait = $windowSec - ($now - (int)$r['win_start']); header('Retry-After: ' . $wait); json_error('Too many failed attempts. Try again in ' . ceil($wait / 60) . ' minute(s).', 429); }
    }
}
function throttle_fail(string $scope, string $id, int $windowSec = 900): void {
    $pdo = sec_db(); $now = time(); usleep(250000);   // small delay makes guessing slower
    foreach ([[$scope . ':a', strtolower($id)], [$scope . ':i', client_ip()]] as [$b, $key]) {
        $k = substr($b . ':' . sha1($key), 0, 80); $q = $pdo->prepare('SELECT hits, win_start FROM sec_rate WHERE k = ?'); $q->execute([$k]); $r = $q->fetch();
        if (!$r) { try { $pdo->prepare('INSERT INTO sec_rate (k, hits, win_start) VALUES (?, 1, ?)')->execute([$k, $now]); } catch (Exception $e) {} }
        elseif ($now - (int)$r['win_start'] >= $windowSec) $pdo->prepare('UPDATE sec_rate SET hits = 1, win_start = ? WHERE k = ?')->execute([$now, $k]);
        else $pdo->prepare('UPDATE sec_rate SET hits = hits + 1 WHERE k = ?')->execute([$k]);
    }
    audit_log('login-fail', $scope . ' ' . substr($id, 0, 40));
}
function throttle_clear(string $scope, string $id): void { sec_db()->prepare('DELETE FROM sec_rate WHERE k = ?')->execute([substr($scope . ':a:' . sha1(strtolower($id)), 0, 80)]); }

// ---------- audit log ----------
function audit_log(string $action, string $detail = '', string $actor = ''): void {
    try {
        if ($actor === '') { $p = jwt_payload_quiet(); $actor = $p ? (($p['role'] ?? '?') . (isset($p['partnerId']) ? '#' . $p['partnerId'] : '')) : 'anonymous'; }
        sec_db()->prepare('INSERT INTO sec_audit (ts, actor, ip, action, detail) VALUES (?, ?, ?, ?, ?)')->execute([gmdate('Y-m-d H:i:s'), substr($actor, 0, 40), substr(client_ip(), 0, 45), substr($action, 0, 40), substr($detail, 0, 400)]);
    } catch (Throwable $e) { error_log('[azizo] audit failed: ' . $e->getMessage()); }
}
function jwt_payload_quiet(): ?array { try { require_once __DIR__ . '/jwt.php'; $t = bearer_token(); return $t ? jwt_verify($t) : null; } catch (Throwable $e) { return null; } }

// ---------- session epoch: bump it and every issued token stops working ----------
function sec_epoch(): int {
    static $ep = null; if ($ep !== null) return $ep;
    try { $q = sec_db()->prepare("SELECT svalue FROM kk_meta WHERE skey = 'sec_epoch'"); $q->execute(); $r = $q->fetch(); $ep = $r ? (int)$r['svalue'] : 1; } catch (Throwable $e) { $ep = 1; }
    return $ep;
}
function sec_bump_epoch(): int {
    $pdo = sec_db(); $n = sec_epoch() + 1;
    $q = $pdo->prepare("SELECT 1 FROM kk_meta WHERE skey = 'sec_epoch'"); $q->execute();
    if ($q->fetch()) $pdo->prepare("UPDATE kk_meta SET svalue = ? WHERE skey = 'sec_epoch'")->execute([(string)$n]); else $pdo->prepare("INSERT INTO kk_meta (skey, svalue) VALUES ('sec_epoch', ?)")->execute([(string)$n]);
    return $n;
}

// ---------- passwords ----------
/** Returns an error message, or null when acceptable: 8+ characters, a letter and a digit, not a common password. */
function password_problem(string $p): ?string {
    if (strlen($p) < 8) return 'Password must be at least 8 characters';
    if (!preg_match('/[A-Za-z]/', $p) || !preg_match('/\d/', $p)) return 'Password must contain at least one letter and one number';
    if (in_array(strtolower($p), ['password1', 'password123', '12345678a', 'qwerty123', 'majani90', 'azizo123', 'welcome1', 'abc12345'], true)) return 'That password is too common. Choose another.';
    return null;
}

// ---------- optional admin 2-step code (TOTP, RFC 6238; works with Google Authenticator, Authy, Microsoft Authenticator) ----------
function b32_decode(string $s): string {
    $a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; $s = strtoupper(preg_replace('/[^A-Z2-7]/', '', $s)); $bits = ''; $out = '';
    foreach (str_split($s) as $c) $bits .= str_pad(decbin(strpos($a, $c)), 5, '0', STR_PAD_LEFT);
    foreach (str_split($bits, 8) as $b) if (strlen($b) === 8) $out .= chr(bindec($b));
    return $out;
}
function totp_at(string $secret, int $step): string {
    $h = hash_hmac('sha1', pack('N*', 0) . pack('N*', $step), b32_decode($secret), true); $o = ord($h[19]) & 15;
    $n = ((ord($h[$o]) & 0x7f) << 24) | (ord($h[$o + 1]) << 16) | (ord($h[$o + 2]) << 8) | ord($h[$o + 3]);
    return str_pad((string)($n % 1000000), 6, '0', STR_PAD_LEFT);
}
function totp_enabled(): bool { return defined('ADMIN_TOTP_SECRET') && ADMIN_TOTP_SECRET !== ''; }
/** Accepts the current code and one step either side; a code can be used only once. */
function totp_verify(string $code): bool {
    if (!totp_enabled()) return true; $code = preg_replace('/\s+/', '', $code); if (!preg_match('/^\d{6}$/', $code)) return false;
    $now = (int)floor(time() / 30); $pdo = sec_db(); $q = $pdo->prepare("SELECT svalue FROM kk_meta WHERE skey = 'totp_last'"); $q->execute(); $r = $q->fetch(); $last = $r ? (int)$r['svalue'] : 0;
    for ($d = -1; $d <= 1; $d++) {
        $st = $now + $d; if ($st <= $last) continue;
        if (hash_equals(totp_at(ADMIN_TOTP_SECRET, $st), $code)) {
            if ($r) $pdo->prepare("UPDATE kk_meta SET svalue = ? WHERE skey = 'totp_last'")->execute([(string)$st]); else $pdo->prepare("INSERT INTO kk_meta (skey, svalue) VALUES ('totp_last', ?)")->execute([(string)$st]);
            return true;
        }
    }
    return false;
}

/** A list of things still to fix before going live (shown to the admin on the Security check screen). */
function sec_check_report(): array {
    $r = [];
    $add = function ($ok, $label, $fix) use (&$r) { $r[] = ['ok' => (bool)$ok, 'label' => $label, 'fix' => $ok ? '' : $fix]; };
    $add(!sec_default_secret(), 'JWT secret is strong and not the shipped default', 'Set JWT_SECRET to 32+ random characters in config.local.php.');
    $add(!sec_default_admin(), 'Admin password is not the default and is 10+ characters', 'Set ADMIN_PASSWORD in config.local.php.');
    $add(!defined('STAFF_PASSWORD') || STAFF_PASSWORD === '' || strlen(STAFF_PASSWORD) >= 8, 'Staff password (if used) is 8+ characters', 'Use a longer STAFF_PASSWORD.');
    $add(sec_is_https(), 'Site is served over HTTPS', 'Turn on AutoSSL in cPanel and force HTTPS (see docs/SECURITY.md).');
    $add(ALLOWED_ORIGIN !== '*', 'CORS is restricted to your own website', 'Set ALLOWED_ORIGIN to https://yourdomain.co.ke.');
    $add(totp_enabled(), 'Admin 2-step code (authenticator app) is on', 'Set ADMIN_TOTP_SECRET (see docs/SECURITY.md).');
    $add(!defined('MPESA_CONSUMER_KEY') || MPESA_CONSUMER_KEY === '' || (defined('MPESA_CALLBACK_SECRET') && strlen(MPESA_CALLBACK_SECRET) >= 16), 'M-Pesa callback is protected with a secret', 'Set MPESA_CALLBACK_SECRET (16+ random characters).');
    $add(!ini_get('display_errors') || ini_get('display_errors') === '0' || sec_is_local(), 'PHP errors are hidden from visitors', 'This is automatic on a real server; check your PHP settings.');
    $add(!sec_is_local(), 'Running on a real server, not localhost', 'Expected while testing on WAMP; this should be green on cPanel.');
    return $r;
}

// ---------- M-Pesa callback protection ----------
/** The callback URL given to Safaricom, carrying a secret token that only we and Safaricom know. */
function mpesa_callback_url(): string {
    if (MPESA_CALLBACK_SECRET === '') return MPESA_CALLBACK_URL;
    return MPESA_CALLBACK_URL . (strpos(MPESA_CALLBACK_URL, '?') === false ? '?' : '&') . 'k=' . substr(hash_hmac('sha256', 'mpesa-callback', MPESA_CALLBACK_SECRET), 0, 32);
}
function mpesa_callback_authorised(): bool {
    if (MPESA_CALLBACK_SECRET === '') return sec_is_local();   // no secret: only a developer machine may accept callbacks
    $k = (string)($_GET['k'] ?? ''); return $k !== '' && hash_equals(substr(hash_hmac('sha256', 'mpesa-callback', MPESA_CALLBACK_SECRET), 0, 32), $k);
}
