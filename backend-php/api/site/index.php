<?php
// GET  /api/site/settings  public  - site switches (Event Budget Planner on/off, note, contingency %)
// PUT  /api/site/settings  admin
// POST /api/site/leads (public), GET /api/site/leads, GET /api/site/leads.csv, PATCH /api/site/leads/:id (admin)
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
    return ['eventBudget' => $eb, 'marketplace' => ['enabled' => !empty($saved['marketplace']['enabled'])]];
}
$method = $_SERVER['REQUEST_METHOD'];
$leads = isset($_GET['leads']); $leadId = (int)($_GET['id'] ?? 0); $csv = isset($_GET['csv']);
$STATUSES = ['new', 'contacted', 'quoted', 'won', 'lost'];
$clean = fn($v, $n) => mb_substr(trim(preg_replace('/[\x00-\x08\x0b\x0c\x0e-\x1f]/', ' ', (string)$v)), 0, $n);
$leadOut = fn($r) => ['id' => (int)$r['id'], 'created' => $r['created_at'], 'name' => $r['name'], 'phone' => $r['phone'], 'eventDate' => $r['event_date'], 'guests' => (int)$r['guests'], 'venue' => $r['venue'], 'note' => $r['note'], 'estimate' => (int)$r['estimate'], 'mode' => $r['mode'], 'items' => json_decode($r['items'] ?: '[]', true) ?: [], 'status' => $r['status'], 'adminNote' => $r['admin_note']];
if ($leads) {
    if ($method === 'POST' && !$leadId) {
        $b = read_json_body(); if (!empty($b['website'])) json_response(['ok' => true], 201);
        if (!site_read($pdo)['eventBudget']['enabled']) json_error('The planner is not taking requests right now. Please call or WhatsApp us.', 403);
        // simple per-visitor throttle: 5 per hour, kept in a temp file
        $ip = preg_replace('/[^a-f0-9:.]/i', '', $_SERVER['REMOTE_ADDR'] ?? 'x'); $tf = sys_get_temp_dir() . '/azizo_leads_' . md5($ip); $t = is_file($tf) ? array_filter(array_map('intval', explode(',', (string)file_get_contents($tf))), fn($x) => $x > time() - 3600) : [];
        if (count($t) >= 5) json_error('Too many requests. Please call or WhatsApp us instead.', 429); $t[] = time(); @file_put_contents($tf, implode(',', $t));
        $name = $clean($b['name'] ?? '', 60); $phone = $clean($b['phone'] ?? '', 20); if (mb_strlen($name) < 2) json_error('Enter your name'); if (strlen(preg_replace('/\D/', '', $phone)) < 9) json_error('Enter a valid phone number');
        $date = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($b['eventDate'] ?? '')) ? $b['eventDate'] : '';
        $items = []; foreach (array_slice(is_array($b['items'] ?? null) ? $b['items'] : [], 0, 40) as $i) { $n = $clean($i['name'] ?? '', 80); if ($n === '') continue; $items[] = ['name' => $n, 'qty' => max(0, min(99999, (float)($i['qty'] ?? 0))), 'unit' => $clean($i['unit'] ?? '', 12), 'cost' => max(0, (int)round((float)($i['cost'] ?? 0)))]; }
        $pdo->prepare('INSERT INTO site_leads (name, phone, event_date, guests, venue, note, estimate, mode, items) VALUES (?,?,?,?,?,?,?,?,?)')->execute([$name, $phone, $date, max(0, min(5000, (int)($b['guests'] ?? 0))), $clean($b['venue'] ?? '', 120), $clean($b['note'] ?? '', 400), max(0, (int)round((float)($b['estimate'] ?? 0))), ($b['mode'] ?? '') === 'qty' ? 'qty' : 'cost', json_encode($items)]);
        json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId()], 201);
    }
    require_admin();
    if ($method === 'GET' && $csv) {
        $rows = $pdo->query('SELECT * FROM site_leads ORDER BY id DESC')->fetchAll(); header('Content-Type: text/csv; charset=utf-8'); header('Content-Disposition: attachment; filename="azizo-event-enquiries.csv"'); $o = fopen('php://output', 'w'); fwrite($o, "\xEF\xBB\xBF");
        fputcsv($o, ['Id', 'Received', 'Name', 'Phone', 'Event date', 'Guests', 'Venue', 'Estimate KES', 'Status', 'Note', 'Admin note']); foreach ($rows as $r) fputcsv($o, [$r['id'], $r['created_at'], $r['name'], $r['phone'], $r['event_date'], $r['guests'], $r['venue'], $r['estimate'], $r['status'], $r['note'], $r['admin_note']]); exit;
    }
    if ($method === 'GET') {
        $st = in_array($_GET['status'] ?? '', $STATUSES, true) ? $_GET['status'] : null; $q = $pdo->prepare('SELECT * FROM site_leads ' . ($st ? 'WHERE status = ? ' : '') . 'ORDER BY id DESC LIMIT 500'); $q->execute($st ? [$st] : []);
        json_response(['leads' => array_map($leadOut, $q->fetchAll()), 'counts' => $pdo->query('SELECT status, COUNT(*) AS n FROM site_leads GROUP BY status')->fetchAll()]);
    }
    if (($method === 'PATCH' || $method === 'POST' || $method === 'PUT') && $leadId) {
        $q = $pdo->prepare('SELECT * FROM site_leads WHERE id = ?'); $q->execute([$leadId]); $r = $q->fetch(); if (!$r) json_error('Not found', 404); $b = read_json_body();
        $status = array_key_exists('status', $b) ? $b['status'] : $r['status']; if (!in_array($status, $STATUSES, true)) json_error('Unknown status');
        $pdo->prepare('UPDATE site_leads SET status = ?, admin_note = ?, updated_at = NOW() WHERE id = ?')->execute([$status, array_key_exists('adminNote', $b) ? $clean($b['adminNote'], 400) : $r['admin_note'], $leadId]); json_response(['ok' => true]);
    }
    json_error('Method not allowed', 405);
}
if ($method === 'GET') json_response(site_read($pdo));
if ($method === 'PUT' || $method === 'POST') {
    require_admin();
    $b = read_json_body()['eventBudget'] ?? []; $cur = site_read($pdo)['eventBudget'];
    $next = [
        'enabled' => array_key_exists('enabled', $b) ? (bool)$b['enabled'] : $cur['enabled'],
        'note' => array_key_exists('note', $b) ? mb_substr(trim(preg_replace('/[\x00-\x1f]/', ' ', (string)$b['note'])), 0, 300) : $cur['note'],
        'contingencyPct' => array_key_exists('contingencyPct', $b) ? max(0, min(50, (float)$b['contingencyPct'])) : $cur['contingencyPct'],
    ];
    $pdo->prepare("INSERT INTO kk_meta (skey, svalue) VALUES ('site_settings', ?) ON DUPLICATE KEY UPDATE svalue = VALUES(svalue)")->execute([json_encode(['eventBudget' => $next, 'marketplace' => site_read($pdo)['marketplace']])]);
    json_response(site_read($pdo));
}
json_error('Method not allowed', 405);
