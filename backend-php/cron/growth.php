<?php
// Azizo growth cron (v5.4). cPanel > Cron Jobs:
//   0 * * * *   php /home/USER/public_html/backend-php/cron/growth.php hourly   (settles referral rewards, sends standing-order reminders)
//   0 20 * * *  php /home/USER/public_html/backend-php/cron/growth.php digest   (emails the daily digest to the address set in Operations > Growth settings)
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../lib/growth_helpers.php';
$job = $argv[1] ?? 'hourly';
if ($job === 'digest') {
    $d = growth_digest(); $to = growth_settings()['digest_email'];
    if ($to && filter_var($to, FILTER_VALIDATE_EMAIL)) { require_once __DIR__ . '/../lib/mailer.php'; $r = mail_config()['enabled'] === '1' ? mail_send($to, 'Azizo daily digest ' . ($d['day'] ?? ''), $d['text'], 'system') : (@mail($to, 'Azizo daily digest ' . ($d['day'] ?? ''), $d['text'], "Content-Type: text/plain; charset=UTF-8\r\n") ? ['ok' => true] : ['ok' => false, 'error' => 'mail() failed']); echo $r['ok'] ? "digest sent to $to\n" : 'digest failed: ' . $r['error'] . "\n"; }
    else echo "no digest email set\n";
} else { echo 'referrals settled: ' . growth_settle_referrals() . "\n"; growth_remind_subs(); echo "reminders checked\n"; }
