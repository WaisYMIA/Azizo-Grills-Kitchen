<?php
// One file, routed by .htaccess:
//   GET    /api/areas          public - zones admin has ticked as served, plus the fee settings
//   GET    /api/areas/all      staff  - every zone
//   POST   /api/areas          admin  - create/update one zone (partial updates fine)
//   POST   /api/areas/bulk     admin  - {active, ids[] | region | all}
//   POST   /api/areas/config   admin  - delivery fee settings
//   DELETE /api/areas/:id      admin
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../lib/area_helpers.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();

$pdo = get_db();
ensure_area_seed($pdo);
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$id = strtolower($_GET['id'] ?? '');
header('Cache-Control: no-store');

if ($method === 'GET' && $action === 'all') {
    require_staff();
    $rows = $pdo->query('SELECT * FROM areas ORDER BY sort_order, name')->fetchAll();
    json_response(['config' => area_config($pdo), 'areas' => array_map('area_out', $rows)]);
}
if ($method === 'GET') {
    $rows = $pdo->query('SELECT * FROM areas WHERE active = 1 ORDER BY sort_order, name')->fetchAll();
    json_response(['config' => area_config($pdo), 'areas' => array_map('area_out', $rows)]);
}

require_admin();
$body = $method === 'DELETE' ? [] : read_json_body();
$clean = fn($v, $max) => mb_substr(trim((string)($v ?? '')), 0, $max);

if ($method === 'DELETE' && $id !== '') {
    $st = $pdo->prepare('DELETE FROM areas WHERE id = ?'); $st->execute([$id]);
    if (!$st->rowCount()) json_error('Zone not found', 404);
    json_response(['ok' => true]);
}

if ($method === 'POST' && $action === 'config') {
    $cfg = area_config($pdo); $next = [];
    foreach (AREA_LIMITS as $k => [$lo, $hi]) {
        $v = array_key_exists($k, $body) ? $body[$k] : $cfg[$k];
        if (!is_numeric($v) || $v < $lo || $v > $hi) json_error("$k must be a number between $lo and $hi");
        $next[$k] = $v + 0;
    }
    $pdo->prepare("INSERT INTO area_settings (skey, svalue) VALUES ('delivery_config', ?) ON DUPLICATE KEY UPDATE svalue = VALUES(svalue)")->execute([json_encode($next)]);
    json_response(['ok' => true, 'config' => $next]);
}

if ($method === 'POST' && $action === 'bulk') {
    $active = !empty($body['active']) ? 1 : 0; $changed = 0;
    if (!empty($body['ids']) && is_array($body['ids'])) {
        $st = $pdo->prepare('UPDATE areas SET active = ? WHERE id = ?');
        foreach ($body['ids'] as $i) { $st->execute([$active, (string)$i]); $changed += $st->rowCount(); }
    } elseif (!empty($body['region'])) {
        $st = $pdo->prepare('UPDATE areas SET active = ? WHERE region = ?'); $st->execute([$active, (string)$body['region']]); $changed = $st->rowCount();
    } elseif (!empty($body['all'])) {
        $st = $pdo->prepare('UPDATE areas SET active = ?'); $st->execute([$active]); $changed = $st->rowCount();
    } else json_error('Say which zones: ids, region or all');
    json_response(['ok' => true, 'changed' => $changed]);
}

if ($method === 'POST') {
    $has = fn($k) => array_key_exists($k, $body);
    $aid = strtolower($clean($body['id'] ?? '', 50));
    $get = function (string $i) use ($pdo) { $q = $pdo->prepare('SELECT * FROM areas WHERE id = ?'); $q->execute([$i]); return $q->fetch(); };
    $existing = $aid !== '' ? $get($aid) : false;
    $name = $clean($body['name'] ?? '', 80);
    if (!$existing && ($name === '' || $clean($body['region'] ?? '', 80) === '')) json_error('A zone needs a region and a name');
    $slug = fn($s) => substr(trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($s)), '-'), 0, 50);
    if ($aid === '') { $base = $slug($name); $aid = $base; $n = 2; while ($get($aid)) $aid = $base . '-' . $n++; }
    $b = $existing ?: ['id' => $aid, 'region' => '', 'name' => '', 'corridor' => '', 'lat' => null, 'lng' => null, 'active' => 0,
        'sort_order' => (int)$pdo->query('SELECT COALESCE(MAX(sort_order),0)+1 FROM areas')->fetchColumn()];
    $m = [
        'id' => $aid, 'region' => $has('region') ? $clean($body['region'], 80) : $b['region'], 'name' => $has('name') ? $name : $b['name'],
        'corridor' => $has('corridor') ? $clean($body['corridor'], 60) : $b['corridor'],
        'lat' => $has('lat') ? $body['lat'] : $b['lat'], 'lng' => $has('lng') ? $body['lng'] : $b['lng'],
        'active' => $has('active') ? (!empty($body['active']) ? 1 : 0) : (int)$b['active'],
        'sort_order' => $has('sortOrder') && is_numeric($body['sortOrder']) ? (int)$body['sortOrder'] : (int)$b['sort_order'],
    ];
    if ($m['name'] === '' || $m['region'] === '') json_error('A zone needs a region and a name');
    if (!is_numeric($m['lat']) || !is_numeric($m['lng'])) json_error('Latitude and longitude are required - they decide distance and delivery fee');
    if ($m['lat'] < -4.9 || $m['lat'] > 5.1 || $m['lng'] < 33.9 || $m['lng'] > 41.9) json_error('Those coordinates are outside Kenya - latitude first, e.g. -1.2921, 36.8219');
    $pdo->prepare('INSERT INTO areas (id, region, name, corridor, lat, lng, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE region = VALUES(region), name = VALUES(name), corridor = VALUES(corridor), lat = VALUES(lat), lng = VALUES(lng), active = VALUES(active), sort_order = VALUES(sort_order)')
        ->execute([$m['id'], $m['region'], $m['name'], $m['corridor'], (float)$m['lat'], (float)$m['lng'], $m['active'], $m['sort_order']]);
    json_response(['ok' => true, 'area' => area_out($get($aid))], $existing ? 200 : 201);
}
json_error('Not found', 404);
