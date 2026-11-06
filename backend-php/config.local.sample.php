<?php
// Copy this file to config.local.php and fill it in. Never share config.local.php or put it in GitHub.
// On cPanel: create it with File Manager in the backend folder, then set its permissions to 640.
return [
    // --- database (cPanel: MySQL Databases; WAMP: usually root with an empty password) ---
    'DB_HOST' => 'localhost',
    'DB_NAME' => 'cpaneluser_azizo',
    'DB_USER' => 'cpaneluser_azizo',
    'DB_PASS' => 'CHANGE-ME',

    // --- secrets: generate with  php -r "echo bin2hex(random_bytes(32));" ---
    'JWT_SECRET' => 'CHANGE-ME-64-random-hex-characters',
    'ADMIN_PASSWORD' => 'CHANGE-ME-10-or-more-characters',
    'STAFF_PASSWORD' => 'CHANGE-ME-8-or-more-characters',
    // Switch the shared admin/staff passwords OFF once every person has a personal account (Operations > Team). Leave out until then.
    // 'TEAM_ONLY' => '1',
    // Claude AI assistant (website chat, reply drafts, insights). Leave out until you subscribe; the site works without it.
    // 'ANTHROPIC_API_KEY' => 'sk-ant-...',
    // 'AI_MONTHLY_TOKENS' => '1500000',   // spending guard: the AI stops when this many tokens are used in a month

    // --- your website (no trailing slash). CORS only allows these origins. Comma-separate several. ---
    'ALLOWED_ORIGIN' => 'https://www.yourdomain.co.ke',
    'SITE_URL' => 'https://www.yourdomain.co.ke',

    // --- v5.5 email password key (optional; any long random text, set once) ---
    // 'MAIL_KEY' => '',

    // --- v5.4 order messages (optional; without them messages are manual WhatsApp links) ---
    // 'WA_TOKEN' => '', 'WA_PHONE_ID' => '',                       // WhatsApp Cloud API
    // 'AT_USERNAME' => '', 'AT_API_KEY' => '', 'AT_SENDER' => '',  // Africa's Talking SMS

    // --- Security Center (recommended) ---
    'SEC_ALERT_EMAIL' => 'you@yourdomain.co.ke',      // critical alerts are emailed here
    'SEC_ALLOW_IPS' => '',                            // your own fixed IPs that must never be auto-blocked (comma separated)
    'ORDER_SIG_KEY' => 'CHANGE-ME-random-and-never-change-it-later',  // signs every order so tampering is detected

    // Password for Azizo inspection officials who fill in the partner inspection form (optional; the admin password also works)
    'INSPECTOR_PASSWORD' => 'CHANGE-ME-8-or-more-characters',

    // --- optional extras ---
    // 'ADMIN_TOTP_SECRET' => 'BASE32SECRETFROMYOURAUTHENTICATORSETUP',
    // 'MPESA_CALLBACK_SECRET' => 'CHANGE-ME-16-plus-random-characters',
];
