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
        elseif ($o !== '') sec_event_once('cors-denied', 'low', 'Origin not allowed: ' . substr($o, 0, 80), 900);
        header('Vary: Origin');
    }
    // v4.3: refuse blocked addresses, then look for attack signatures in the request.
    if (!$local && sec_is_blocked(client_ip())) { http_response_code(403); header('Content-Type: application/json'); echo json_encode(['error' => 'Access from your address is temporarily blocked.']); exit; }
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'OPTIONS') sec_inspect(!$local);
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
    if ((int)$r['hits'] >= $max) { $wait = max(1, $windowSec - ($now - (int)$r['win_start'])); sec_event_once('rate-limit', 'med', 'Limit hit: ' . $bucket, 600); header('Retry-After: ' . $wait); json_error('Too many attempts. Please wait ' . ceil($wait / 60) . ' minute(s) and try again.', 429); }
    $pdo->prepare('UPDATE sec_rate SET hits = hits + 1 WHERE k = ?')->execute([$k]);
}
/** Lockout for logins: check before verifying the password, count only failures, clear on success. */
function throttle_check(string $scope, string $id, int $max = 8, int $windowSec = 900): void {
    $pdo = sec_db(); $now = time();
    foreach ([[$scope . ':a', strtolower($id)], [$scope . ':i', client_ip()]] as [$b, $key]) {
        $q = $pdo->prepare('SELECT hits, win_start FROM sec_rate WHERE k = ?'); $q->execute([substr($b . ':' . sha1($key), 0, 80)]); $r = $q->fetch();
        $lim = substr($b, -1) === 'i' ? $max * 3 : $max;
        if ($r && $now - (int)$r['win_start'] < $windowSec && (int)$r['hits'] >= $lim) { $wait = $windowSec - ($now - (int)$r['win_start']); sec_event_once('lockout', 'med', 'Locked out: ' . $scope . ' ' . substr($id, 0, 40), 900, $scope . $id . client_ip()); header('Retry-After: ' . $wait); json_error('Too many failed attempts. Try again in ' . ceil($wait / 60) . ' minute(s).', 429); }
    }
}
function throttle_fail(string $scope, string $id, int $windowSec = 900): void {
    try { require_once __DIR__ . '/activity.php'; activity_add('auth', 'login-failed', ['actor' => $scope, 'outcome' => 'fail', 'detail' => $scope . ' sign-in refused']); } catch (Throwable $e) {}
    $pdo = sec_db(); $now = time(); usleep(250000);   // small delay makes guessing slower
    foreach ([[$scope . ':a', strtolower($id)], [$scope . ':i', client_ip()]] as [$b, $key]) {
        $k = substr($b . ':' . sha1($key), 0, 80); $q = $pdo->prepare('SELECT hits, win_start FROM sec_rate WHERE k = ?'); $q->execute([$k]); $r = $q->fetch();
        if (!$r) { try { $pdo->prepare('INSERT INTO sec_rate (k, hits, win_start) VALUES (?, 1, ?)')->execute([$k, $now]); } catch (Exception $e) {} }
        elseif ($now - (int)$r['win_start'] >= $windowSec) $pdo->prepare('UPDATE sec_rate SET hits = 1, win_start = ? WHERE k = ?')->execute([$now, $k]);
        else $pdo->prepare('UPDATE sec_rate SET hits = hits + 1 WHERE k = ?')->execute([$k]);
    }
    audit_log('login-fail', $scope . ' ' . substr($id, 0, 40)); sec_event('login-fail', 'low', $scope . ' ' . substr($id, 0, 40));
}
function throttle_clear(string $scope, string $id): void { sec_db()->prepare('DELETE FROM sec_rate WHERE k = ?')->execute([substr($scope . ':a:' . sha1(strtolower($id)), 0, 80)]); }

// ---------- audit log ----------
function audit_log(string $action, string $detail = '', string $actor = ''): void {
    try {
        if ($actor === '') { $p = jwt_payload_quiet(); $actor = $p ? (!empty($p['name']) ? ($p['name'] . ' (' . ($p['tr'] ?? '?') . ')') : (($p['role'] ?? '?') . (isset($p['partnerId']) ? '#' . $p['partnerId'] : ''))) : 'anonymous'; }
        sec_db()->prepare('INSERT INTO sec_audit (ts, actor, ip, action, detail) VALUES (?, ?, ?, ?, ?)')->execute([gmdate('Y-m-d H:i:s'), substr($actor, 0, 40), substr(client_ip(), 0, 45), substr($action, 0, 40), substr($detail, 0, 400)]);
    } catch (Throwable $e) { error_log('[azizo] audit failed: ' . $e->getMessage()); }
    try { require_once __DIR__ . '/activity.php'; activity_add(act_category($action), $action, ['actor' => $actor === '' ? null : $actor, 'detail' => $detail]); } catch (Throwable $e) {}
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
    $add(defined('SEC_ALERT_EMAIL') && SEC_ALERT_EMAIL !== '', 'Security alert emails are switched on', 'Set SEC_ALERT_EMAIL in config.local.php so you hear about attacks straight away.');
    $add(defined('SEC_AUTO_BLOCK') && SEC_AUTO_BLOCK, 'Attackers are blocked automatically', 'Set SEC_AUTO_BLOCK to 1.');
    $add(defined('ORDER_SIG_KEY') && strlen(ORDER_SIG_KEY) >= 16, 'Orders are signed with their own secret key', 'Set ORDER_SIG_KEY (16+ random characters) once, and never change it.');
    $add(version_compare(PHP_VERSION, '8.1.0', '>='), 'PHP version is current (8.1 or newer)', 'In cPanel > MultiPHP Manager choose PHP 8.2 or newer.');
    $lp = __DIR__ . '/../config.local.php'; $add(!is_file($lp) || sec_is_local() || (fileperms($lp) & 0004) === 0, 'config.local.php is not readable by other accounts', 'In cPanel File Manager set config.local.php permissions to 640.');
    try { $n = (int)sec_db()->query("SELECT COUNT(*) FROM orders WHERE sig IS NULL AND created_at >= '" . gmdate('Y-m-d H:i:s', time() - 7 * 86400) . "'")->fetchColumn(); } catch (Throwable $e) { $n = 0; }
    $add($n === 0, 'Every recent order carries a tamper signature', $n . ' order(s) from the last 7 days have no signature (placed before v4.3, or created outside the website).');
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

// =====================================================================================
// v4.3 — Security Center: attack/failure log, automatic address blocking, request inspection, order signatures
// =====================================================================================
/** Points each kind of event adds towards an automatic block. 10 points inside 10 minutes = blocked. */
function sec_weights(): array {
    return ['login-fail' => 0.5, 'lockout' => 3, 'rate-limit' => 1, 'probe' => 4, 'scanner' => 2, 'scanner-ua' => 10, 'token-forged' => 3, 'mpesa-forged' => 6, 'mpesa-amount' => 6,
            'order-tamper' => 4, 'fee-tamper' => 1, 'bot-order' => 1, 'forbidden' => 1.5, 'bad-method' => 2, 'oversize' => 2, 'cors-denied' => 0.5];
}
function sec_ip_exempt(string $ip): bool {
    if (preg_match('/^(127\.|::1$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/', $ip)) return true;
    if (defined('SEC_ALLOW_IPS') && SEC_ALLOW_IPS !== '') foreach (explode(',', SEC_ALLOW_IPS) as $a) if (trim($a) === $ip) return true;
    return false;
}
/** Write one line to the Security Center log. sev: info|low|med|high|crit. Never throws. */
function sec_event(string $type, string $sev = 'low', string $detail = '', string $actor = ''): void {
    static $seen = [];
    $k = $type . '|' . $detail; if (isset($seen[$k])) return; $seen[$k] = 1;
    try {
        $pdo = sec_db(); $ip = client_ip();
        $path = (string)parse_url((string)($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH);
        $pdo->prepare('INSERT INTO sec_events (ts, sev, type, ip, ua, path, actor, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([gmdate('Y-m-d H:i:s'), $sev, substr($type, 0, 32), substr($ip, 0, 45), substr(preg_replace('/[\x00-\x1f]/', ' ', (string)($_SERVER['HTTP_USER_AGENT'] ?? '')), 0, 160), substr($path, 0, 160), substr($actor, 0, 40), substr(preg_replace('/[\x00-\x1f]/', ' ', $detail), 0, 400)]);
        if (mt_rand(1, 300) === 1) $pdo->prepare('DELETE FROM sec_events WHERE ts < ?')->execute([gmdate('Y-m-d H:i:s', time() - 180 * 86400)]);
        if ($sev === 'high' || $sev === 'crit') { try { require_once __DIR__ . '/mailer.php'; mail_security_alert($type, $ip, $detail); } catch (Throwable $e) {} }
        if ($sev === 'crit') sec_alert('CRITICAL: ' . $type, "Type: $type\nDetail: $detail\nFrom: $ip\nPath: $path\nTime (UTC): " . gmdate('Y-m-d H:i:s'));
        if (defined('SEC_AUTO_BLOCK') && SEC_AUTO_BLOCK && !sec_ip_exempt($ip)) sec_maybe_block($ip);
    } catch (Throwable $e) { error_log('[azizo] sec_event failed: ' . $e->getMessage()); }
}
/** Same as sec_event but at most once per $ttl seconds for the same address (stops one attacker flooding the log). */
function sec_event_once(string $type, string $sev, string $detail, int $ttl = 600, ?string $key = null): void {
    try {
        $pdo = sec_db(); $k = substr('ev:' . $type . ':' . sha1($key ?? client_ip()), 0, 80); $now = time();
        $q = $pdo->prepare('SELECT win_start FROM sec_rate WHERE k = ?'); $q->execute([$k]); $r = $q->fetch();
        if ($r && $now - (int)$r['win_start'] < $ttl) return;
        if ($r) $pdo->prepare('UPDATE sec_rate SET hits = hits + 1, win_start = ? WHERE k = ?')->execute([$now, $k]);
        else { try { $pdo->prepare('INSERT INTO sec_rate (k, hits, win_start) VALUES (?, 1, ?)')->execute([$k, $now]); } catch (Exception $e) { return; } }
    } catch (Throwable $e) {}
    sec_event($type, $sev, $detail);
}
function sec_maybe_block(string $ip): void {
    $pdo = sec_db(); $w = sec_weights();
    $q = $pdo->prepare('SELECT type, COUNT(*) AS n FROM sec_events WHERE ip = ? AND ts >= ? GROUP BY type'); $q->execute([$ip, gmdate('Y-m-d H:i:s', time() - 600)]);
    $score = 0.0; foreach ($q->fetchAll() as $r) $score += ($w[$r['type']] ?? 0) * (int)$r['n'];
    if ($score >= 10) sec_block($ip, 0, 'Automatic: ' . round($score) . ' attack points in 10 minutes', true);
}
/** Block an address. $seconds = 0 means automatic length that grows with repeat offences (1 hour, 24 hours, 7 days). */
function sec_block(string $ip, int $seconds, string $reason, bool $auto = false): void {
    $pdo = sec_db(); $now = time();
    $q = $pdo->prepare('SELECT strikes, until_ts FROM sec_blocks WHERE ip = ?'); $q->execute([$ip]); $r = $q->fetch();
    $strikes = $r ? (int)$r['strikes'] + ($auto && (int)$r['until_ts'] < $now ? 1 : 0) : 1;
    if ($seconds <= 0) $seconds = $strikes <= 1 ? 3600 : ($strikes == 2 ? 86400 : 7 * 86400);
    $until = $now + $seconds;
    if ($r) $pdo->prepare('UPDATE sec_blocks SET until_ts = ?, reason = ?, auto_block = ?, strikes = ? WHERE ip = ?')->execute([$until, substr($reason, 0, 200), $auto ? 1 : 0, $strikes, $ip]);
    else $pdo->prepare('INSERT INTO sec_blocks (ip, until_ts, reason, auto_block, strikes, created_ts) VALUES (?, ?, ?, ?, ?, ?)')->execute([$ip, $until, substr($reason, 0, 200), $auto ? 1 : 0, 1, $now]);
    $pdo->prepare('INSERT INTO sec_events (ts, sev, type, ip, ua, path, actor, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')->execute([gmdate('Y-m-d H:i:s'), 'high', $auto ? 'auto-block' : 'manual-block', $ip, '', '', $auto ? 'system' : 'admin', substr($reason . ' (until ' . gmdate('Y-m-d H:i', $until) . ' UTC)', 0, 400)]);
    if ($auto) sec_alert('Address blocked: ' . $ip, "$ip was blocked automatically.\nReason: $reason\nUntil (UTC): " . gmdate('Y-m-d H:i', $until));
}
function sec_is_blocked(string $ip): bool {
    try { $q = sec_db()->prepare('SELECT until_ts FROM sec_blocks WHERE ip = ?'); $q->execute([$ip]); $r = $q->fetch(); return $r && (int)$r['until_ts'] > time(); } catch (Throwable $e) { return false; }
}
function sec_alert(string $subject, string $body): void {
    if (!defined('SEC_ALERT_EMAIL') || SEC_ALERT_EMAIL === '' || !filter_var(SEC_ALERT_EMAIL, FILTER_VALIDATE_EMAIL)) return;
    try {
        $pdo = sec_db(); $k = substr('alert:' . sha1($subject), 0, 80); $now = time(); $q = $pdo->prepare('SELECT win_start FROM sec_rate WHERE k = ?'); $q->execute([$k]); $r = $q->fetch();
        if ($r && $now - (int)$r['win_start'] < 3600) return;   // one email per kind per hour
        if ($r) $pdo->prepare('UPDATE sec_rate SET win_start = ? WHERE k = ?')->execute([$now, $k]); else $pdo->prepare('INSERT INTO sec_rate (k, hits, win_start) VALUES (?, 1, ?)')->execute([$k, $now]);
        $host = parse_url(SITE_URL, PHP_URL_HOST) ?: 'azizo';
        @mail(SEC_ALERT_EMAIL, '[Azizo security] ' . $subject, $body . "\n\n-- Azizo Security Center", 'From: security@' . $host . "\r\nContent-Type: text/plain; charset=utf-8");
    } catch (Throwable $e) {}
}

/** Looks at the request itself (address, user agent, query and the start of the body) for well-known attack signatures. */
function sec_inspect(bool $enforce): void {
    $m = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    $deny = function (string $why) use ($enforce) { if (!$enforce) return; if (!headers_sent()) { http_response_code(403); header('Content-Type: application/json'); } echo json_encode(['error' => 'Request blocked for security reasons']); exit; };
    if (!in_array($m, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'], true)) { sec_event('bad-method', 'med', $m); if ($enforce) { http_response_code(405); exit; } }
    $ua = (string)($_SERVER['HTTP_USER_AGENT'] ?? '');
    if (preg_match('/(sqlmap|nikto|nmap|masscan|acunetix|wpscan|dirbuster|gobuster|havij|nessus|openvas|zgrab|w3af|burpcollaborator|metasploit|jaeles|nuclei|hydra)/i', $ua, $mm)) { sec_event('scanner-ua', 'high', 'Hacking tool: ' . $mm[1]); $deny('ua'); }
    $len = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($len > 16 * 1024 * 1024) { sec_event('oversize', 'med', "Body of $len bytes"); if ($enforce) { http_response_code(413); echo json_encode(['error' => 'Request too large']); exit; } }
    $hay = rawurldecode(urldecode((string)($_SERVER['REQUEST_URI'] ?? '')));
    $ct = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? ''));
    if ($len > 0 && strpos($ct, 'multipart') === false) $hay .= ' ' . (string)substr((string)file_get_contents('php://input', false, null, 0, 8192), 0, 8192);
    $rules = [
        'SQL injection' => '/(union\s+(all\s+)?select\b|[\'"]\s*(or|and)\s+[\'"]?\d+[\'"]?\s*=\s*[\'"]?\d+|\b(sleep|benchmark)\s*\(\s*\d|;\s*(drop|truncate|alter)\s+table|\bxp_cmdshell\b|\bload_file\s*\(|into\s+(out|dump)file|information_schema\.)/i',
        'Script injection' => '/(<\s*script\b|<\s*iframe\b|javascript\s*:|\bon(error|load|mouseover|focus)\s*=\s*["\']?\w)/i',
        'Path traversal' => '/(\.\.\/|\.\.\\\\|%2e%2e[\/\\\\%])/i',
        'Code/file inclusion' => '/(etc\/passwd|etc\/shadow|proc\/self\/|php:\/\/(input|filter)|expect:\/\/|<\?php|\$\{jndi:|\b(eval|assert|system|passthru|shell_exec|base64_decode)\s*\()/i',
        'Command injection' => '/(;|\|\||&&|\|)\s*(cat|wget|curl|bash|sh|nc|powershell)\s+[\w\/\-.]/i',
    ];
    foreach ($rules as $name => $rx) if (preg_match($rx, $hay, $mm)) { sec_event('probe', 'high', $name . ': ' . substr(trim($mm[0]), 0, 80)); $deny($name); break; }
}

// ---------- order signatures: any later change to an order's money, items or phone is detectable ----------
function order_sig_key(): string { return hash('sha256', 'azizo-order-sig|' . ((defined('ORDER_SIG_KEY') && ORDER_SIG_KEY !== '') ? ORDER_SIG_KEY : JWT_SECRET)); }
function order_sig_calc(PDO $pdo, array $o): string {
    $q = $pdo->prepare('SELECT product_id, qty, unit_price, line_total FROM order_items WHERE order_id = ? ORDER BY id'); $q->execute([(int)$o['id']]);
    $it = ''; foreach ($q->fetchAll() as $r) $it .= ($r['product_id'] ?? '') . ':' . number_format((float)$r['qty'], 2, '.', '') . ':' . (int)$r['unit_price'] . ':' . (int)$r['line_total'] . ';';
    $s = implode('|', [(int)$o['id'], (string)$o['customer_phone'], (string)$o['fulfilment'], (string)$o['payment_method'], (int)$o['total'], (int)$o['items_subtotal'], (int)$o['delivery_fee'], (int)($o['partner_id'] ?? 0), $it]);
    return hash_hmac('sha256', $s, order_sig_key());
}
function order_sign(PDO $pdo, int $id): void {
    $q = $pdo->prepare('SELECT id, customer_phone, fulfilment, payment_method, total, items_subtotal, delivery_fee, partner_id FROM orders WHERE id = ?'); $q->execute([$id]); $o = $q->fetch();
    if ($o) $pdo->prepare('UPDATE orders SET sig = ? WHERE id = ?')->execute([order_sig_calc($pdo, $o), $id]);
}
/** Re-checks recent orders against their signatures. Returns counts and the ids that no longer match. */
function order_verify_recent(PDO $pdo, int $days = 30, int $limit = 3000): array {
    $q = $pdo->prepare('SELECT id, customer_phone, fulfilment, payment_method, total, items_subtotal, delivery_fee, partner_id, sig FROM orders WHERE created_at >= ? ORDER BY id DESC LIMIT ' . (int)$limit);
    $q->execute([gmdate('Y-m-d H:i:s', time() - $days * 86400 - 86400)]);
    $res = ['checked' => 0, 'ok' => 0, 'unsigned' => 0, 'tampered' => []];
    foreach ($q->fetchAll() as $o) {
        $res['checked']++;
        if (empty($o['sig'])) { $res['unsigned']++; continue; }
        if (hash_equals((string)$o['sig'], order_sig_calc($pdo, $o))) $res['ok']++;
        else { $res['tampered'][] = (int)$o['id']; sec_event_once('order-tampered', 'crit', 'Order #' . $o['id'] . ' no longer matches its signature (changed outside the website)', 86400, 'order' . $o['id']); }
    }
    return $res;
}

// ---------- Azizo Kitchens order seals (v4.4): money, phone, date, meal and dishes are sealed; status/payment/rider may change normally ----------
function kk_sig_calc(PDO $pdo, array $o): string {
    $q = $pdo->prepare('SELECT dish_id, qty, unit_price, line_total, options_text FROM kk_order_items WHERE order_id = ? ORDER BY id'); $q->execute([(int)$o['id']]);
    $it = ''; foreach ($q->fetchAll() as $r) $it .= ($r['dish_id'] ?? '') . ':' . $r['qty'] . ':' . (int)$r['unit_price'] . ':' . (int)$r['line_total'] . ':' . ($r['options_text'] ?? '') . ';';
    return hash_hmac('sha256', implode('|', ['kk', (int)$o['id'], (string)$o['phone'], (int)$o['subtotal'], (int)$o['delivery_fee'], (int)$o['discount'], (int)$o['total'], (string)$o['date'], (string)$o['meal'], $it]), order_sig_key());
}
function kk_order_sign(PDO $pdo, int $id): void {
    $q = $pdo->prepare('SELECT id, phone, subtotal, delivery_fee, discount, total, date, meal FROM kk_orders WHERE id = ?'); $q->execute([$id]); $o = $q->fetch();
    if ($o) $pdo->prepare('UPDATE kk_orders SET sig = ? WHERE id = ?')->execute([kk_sig_calc($pdo, $o), $id]);
}
function kk_verify_recent(PDO $pdo, int $days = 30, int $limit = 3000): array {
    $res = ['checked' => 0, 'ok' => 0, 'unsigned' => 0, 'tampered' => []];
    try { $q = $pdo->prepare('SELECT id, phone, subtotal, delivery_fee, discount, total, date, meal, sig FROM kk_orders WHERE created_at >= ? ORDER BY id DESC LIMIT ' . (int)$limit); $q->execute([gmdate('Y-m-d H:i:s', time() - $days * 86400 - 86400)]); $rows = $q->fetchAll(); } catch (Throwable $e) { return $res; }
    foreach ($rows as $o) {
        $res['checked']++; if (empty($o['sig'])) { $res['unsigned']++; continue; }
        if (hash_equals((string)$o['sig'], kk_sig_calc($pdo, $o))) $res['ok']++;
        else { $res['tampered'][] = (int)$o['id']; sec_event_once('order-tampered', 'crit', 'Kitchens order #' . $o['id'] . ' no longer matches its signature (changed outside the website)', 86400, 'kk' . $o['id']); }
    }
    return $res;
}
