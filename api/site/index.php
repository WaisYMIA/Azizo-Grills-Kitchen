<?php
// GET  /api/site/settings  public  - site switches (Event Budget Planner on/off, note, contingency %)
// PUT  /api/site/settings  admin
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();
$pdo = get_db();
header('Cache-Control: no-store');
function site_read(PDO $pdo): array {
    $st = $pdo->prepare("SELECT svalue FROM kk_meta WHERE skey = 'site_settings'"); $st->execute(); $r = $st->fetch();
    $saved = $r ? (json_decode($r['svalue'], true) ?: []) : [];
    $eb = array_merge(['enabled' => true, 'note' => '', 'contingencyPct' => 10], $saved['eventBudget'] ?? []);
    $eb['enabled'] = !in_array($eb['enabled'], [false, 0, '0'], true);
    $eb['contingencyPct'] = max(0, min(50, (float)$eb['contingencyPct']));
    $eb['note'] = mb_substr((string)$eb['note'], 0, 300);
    return ['eventBudget' => $eb];
}
$method = $_SERVER['REQUEST_METHOD'];
if ($method === 'GET') json_response(site_read($pdo));
if ($method === 'PUT' || $method === 'POST') {
    require_admin();
    $b = read_json_body()['eventBudget'] ?? []; $cur = site_read($pdo)['eventBudget'];
    $next = [
        'enabled' => array_key_exists('enabled', $b) ? (bool)$b['enabled'] : $cur['enabled'],
        'note' => array_key_exists('note', $b) ? mb_substr(trim(preg_replace('/[\x00-\x1f]/', ' ', (string)$b['note'])), 0, 300) : $cur['note'],
        'contingencyPct' => array_key_exists('contingencyPct', $b) ? max(0, min(50, (float)$b['contingencyPct'])) : $cur['contingencyPct'],
    ];
    $pdo->prepare("INSERT INTO kk_meta (skey, svalue) VALUES ('site_settings', ?) ON DUPLICATE KEY UPDATE svalue = VALUES(svalue)")->execute([json_encode(['eventBudget' => $next])]);
    json_response(site_read($pdo));
}
json_error('Method not allowed', 405);
