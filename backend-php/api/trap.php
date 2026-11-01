<?php
// Decoy for automated scanners. Real visitors never open these addresses (wp-login.php, .env, phpmyadmin ...); anyone who does is logged and, if persistent, blocked.
require_once __DIR__ . '/../lib/response.php';
require_once __DIR__ . '/../db.php';
$p = substr((string)parse_url((string)($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH), 0, 120);
sec_event('scanner', 'high', 'Probe of a decoy address: ' . $p);
usleep(random_int(300000, 900000));   // waste the scanner's time
http_response_code(404); header('Content-Type: text/plain'); echo 'Not found';
