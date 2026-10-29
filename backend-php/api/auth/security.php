<?php
// Admin only. GET = security check list + recent audit log; POST {action:"revoke-all"} = sign everyone out (all staff, admin, partner, rider tokens stop working).
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight(); header('Cache-Control: no-store');
require_admin();
$pdo = get_db();
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $b = read_json_body();
    if (($b['action'] ?? '') === 'revoke-all') {
        sec_bump_epoch(); audit_log('revoke-all', 'all sessions ended');
        json_response(['ok' => true, 'token' => jwt_sign(['role' => 'admin'], 60 * 60 * 8)]);   // the admin who clicked stays signed in
    }
    json_error('Unknown action');
}
$rows = $pdo->query('SELECT ts, actor, ip, action, detail FROM sec_audit ORDER BY id DESC LIMIT 200')->fetchAll();
json_response(['checks' => sec_check_report(), 'audit' => $rows]);
