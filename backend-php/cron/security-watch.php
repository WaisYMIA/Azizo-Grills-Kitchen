<?php
// Run from cPanel > Cron Jobs (e.g. every hour):  /usr/local/bin/php /home/USER/path/backend-php/cron/security-watch.php
// Re-checks recent orders against their tamper signatures and emails SEC_ALERT_EMAIL if anything changed outside the website.
if (php_sapi_name() !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../lib/security.php';
$pdo = sec_db(); $r = order_verify_recent($pdo, 30); $kr = kk_verify_recent($pdo, 30); $r['kitchens'] = $kr;
if ($kr['tampered']) sec_alert('Kitchens orders changed outside the website', 'Kitchens order numbers: ' . implode(', ', array_slice($kr['tampered'], 0, 50)));
if ($r['tampered']) sec_alert('Orders changed outside the website', 'Order numbers: ' . implode(', ', array_slice($r['tampered'], 0, 50)) . "\nChecked " . $r['checked'] . ' recent orders.');
echo json_encode($r) . "\n";
