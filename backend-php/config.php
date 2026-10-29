<?php
/**
 * Azizo Butchery & Grill — backend configuration.
 *
 * On cPanel: edit the four DB_* values to match the database you create in
 * MySQL Databases (cPanel prefixes both the DB name and username with your
 * account username automatically, e.g. "cpaneluser_azizo"). Change
 * JWT_SECRET and ADMIN_PASSWORD to your own values before going live —
 * the ones below are development placeholders, not secrets to keep.
 */

// ---- Local overrides (v4.1) ----
// Put your real secrets in config.local.php (same folder). It is never overwritten when you upload a new version, and is blocked from the web by .htaccess.
// Copy config.local.sample.php to config.local.php and fill it in. Each value becomes an environment value read below.
if (is_file(__DIR__ . '/config.local.php')) {
    $__local = require __DIR__ . '/config.local.php';
    if (is_array($__local)) foreach ($__local as $__k => $__v) putenv($__k . '=' . $__v);
    unset($__local, $__k, $__v);
}

// ---- Database ----
define('DB_HOST', getenv('DB_HOST') ?: 'localhost');
define('DB_NAME', getenv('DB_NAME') ?: 'azizo_db');
define('DB_USER', getenv('DB_USER') ?: 'azizo_user');
define('DB_PASS', getenv('DB_PASS') ?: 'azizo_pass_test');

// ---- Auth ----
// Signs customer/admin login tokens. CHANGE THIS before going live — anyone
// who knows it can forge a valid admin token. Generate a real one with:
//   php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"
define('JWT_SECRET', getenv('JWT_SECRET') ?: 'dev-only-secret-change-me-before-launch');

// Backend-level admin password (separate from the site's own Staff/Admin
// passcodes in app.js) — used by /api/auth/admin-login.php and required by
// every admin-only endpoint (product writes, order list, Excel import/export).
define('ADMIN_PASSWORD', getenv('ADMIN_PASSWORD') ?: 'majani90');
// Kitchens Admin password: opens kitchens-admin.html only. Empty = that login is switched off (the main admin password also works there).
define('KITCHENS_DISPATCH_PASSWORD', getenv('KITCHENS_DISPATCH_PASSWORD') ?: '');   // dispatcher login (orders, riders, supply)
define('KITCHENS_ACCOUNTS_PASSWORD', getenv('KITCHENS_ACCOUNTS_PASSWORD') ?: '');   // accountant login (payouts, reports)
define('SITE_URL', rtrim(getenv('SITE_URL') ?: 'https://www.azizobutchery.co.ke', '/'));
// WhatsApp Cloud API (Meta). Leave empty to use the Outbox (tap-to-send) only.
define('WA_TOKEN', getenv('WA_TOKEN') ?: '');
define('WA_PHONE_ID', getenv('WA_PHONE_ID') ?: '');
define('KITCHENS_ADMIN_PASSWORD', getenv('KITCHENS_ADMIN_PASSWORD') ?: '');
// Staff (counter/kitchen/dispatch) password for staff.html. Empty = staff login switched off.
define('STAFF_PASSWORD', getenv('STAFF_PASSWORD') ?: '');
// Hours ahead of UTC used for "today" in the staff totals (Nairobi = 3).
define('TZ_OFFSET_HOURS', (int)(getenv('TZ_OFFSET_HOURS') !== false ? getenv('TZ_OFFSET_HOURS') : 3));

// ---- Uploads ----
// Where uploaded product photos are saved on disk, and the public URL path
// the frontend uses to display them. Must be writable by the web server
// (on cPanel, File Manager → right-click → Permissions → 755 is usually
// already correct for a folder you create yourself).
define('UPLOAD_DIR', __DIR__ . '/uploads/products/');
define('UPLOAD_URL_PATH', '/uploads/products/'); // relative to this backend's own base URL
define('MAX_UPLOAD_BYTES', 5 * 1024 * 1024); // 5MB per photo

// ---- CORS ----
// "*" works everywhere but allows any site to call this API. Once you know
// your real frontend domain, change this to that exact origin for tighter
// security (e.g. "https://azizobutchery.co.ke").
define('ALLOWED_ORIGIN', getenv('ALLOWED_ORIGIN') ?: '*');

// ---- M-Pesa Daraja (optional — leave blank until you have real credentials) ----
define('MPESA_CONSUMER_KEY', getenv('MPESA_CONSUMER_KEY') ?: '');
define('MPESA_CONSUMER_SECRET', getenv('MPESA_CONSUMER_SECRET') ?: '');
define('MPESA_SHORTCODE', getenv('MPESA_SHORTCODE') ?: '');
define('MPESA_PASSKEY', getenv('MPESA_PASSKEY') ?: '');
define('MPESA_BASE_URL', getenv('MPESA_BASE_URL') ?: '');  // testing only
define('MPESA_ENV', getenv('MPESA_ENV') ?: 'sandbox'); // 'sandbox' or 'production'
define('MPESA_CALLBACK_URL', getenv('MPESA_CALLBACK_URL') ?: '');

date_default_timezone_set('Africa/Nairobi');

// ---- Security (v4.1) ----
// Admin 2-step code: set to a base32 secret (see docs/SECURITY.md) and the admin login will also ask for the 6-digit code from an authenticator app.
define('ADMIN_TOTP_SECRET', getenv('ADMIN_TOTP_SECRET') ?: '');
// Secret that Safaricom's callback URL must carry, so nobody can post a fake "payment received". 16+ random characters.
define('MPESA_CALLBACK_SECRET', getenv('MPESA_CALLBACK_SECRET') ?: '');
// Set to your proxy/CDN name (e.g. cloudflare) ONLY if the site really sits behind one; otherwise leave empty so visitors cannot fake their IP.
define('TRUSTED_PROXY', getenv('TRUSTED_PROXY') ?: '');
// Largest discount (percent of the item total) a promo may take off an order. Orders are re-priced on the server.
define('MAX_DISCOUNT_PCT', (int)(getenv('MAX_DISCOUNT_PCT') !== false && getenv('MAX_DISCOUNT_PCT') !== '' ? getenv('MAX_DISCOUNT_PCT') : 25));
// Emergency switch: 1 lets a real server run with weak/default secrets (not recommended). Leave 0.
define('SEC_ALLOW_WEAK', (int)(getenv('SEC_ALLOW_WEAK') ?: 0));
