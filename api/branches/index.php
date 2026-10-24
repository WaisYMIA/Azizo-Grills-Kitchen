<?php
// One file, routed by .htaccess:
//   GET    /api/branches              public — listed branches only
//   GET    /api/branches/all          admin  — every branch
//   POST   /api/branches              admin  — create/update (partial updates fine)
//   PATCH  /api/branches/:id/listed   admin  — the "Show on website" checkbox
//   DELETE /api/branches/:id          admin
// The shared WhatsApp number is NOT a branch field; a branch phone is for calling only.
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../lib/branch_helpers.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();

$pdo = get_db();
ensure_branch_seed($pdo);
$method = $_SERVER['REQUEST_METHOD'];
$id = strtolower($_GET['id'] ?? '');
$action = $_GET['action'] ?? '';
header('Cache-Control: no-store');

if ($method === 'GET' && $action === 'all') {
    require_staff();
    $rows = $pdo->query('SELECT * FROM branches ORDER BY is_main DESC, sort_order, name')->fetchAll();
    json_response(['branches' => array_map('branch_out', $rows)]);
}
if ($method === 'GET') {
    $rows = $pdo->query('SELECT * FROM branches WHERE listed = 1 ORDER BY is_main DESC, sort_order, name')->fetchAll();
    json_response(['branches' => array_map('branch_out', $rows)]);
}

require_admin();
$get = function (string $i) use ($pdo) { $q = $pdo->prepare('SELECT * FROM branches WHERE id = ?'); $q->execute([$i]); return $q->fetch(); };

if ($method === 'PATCH' && $id !== '' && $action === 'listed') {
    $row = $get($id);
    if (!$row) json_error('Branch not found', 404);
    $body = read_json_body();
    $listed = !empty($body['listed']) ? 1 : 0;
    if (!$listed && $row['is_main']) json_error('The main branch always stays listed — make another branch the main one first');
    if (!$listed && listed_count_excluding($pdo, $id) === 0) json_error('At least one branch must stay listed on the website');
    $pdo->prepare('UPDATE branches SET listed = ? WHERE id = ?')->execute([$listed, $id]);
    json_response(['ok' => true, 'branch' => branch_out($get($id))]);
}

if ($method === 'DELETE' && $id !== '') {
    $row = $get($id);
    if (!$row) json_error('Branch not found', 404);
    if ($row['is_main']) json_error("Can't delete the main branch — make another branch the main one first");
    if ($row['listed'] && listed_count_excluding($pdo, $id) === 0) json_error('At least one branch must stay listed on the website');
    $pdo->prepare('DELETE FROM branches WHERE id = ?')->execute([$id]);
    json_response(['ok' => true]);
}

if ($method === 'POST') {
    $body = read_json_body();
    $has = fn($k) => array_key_exists($k, $body);
    $clean = fn($v, $max) => mb_substr(trim((string)($v ?? '')), 0, $max);
    $name = $clean($body['name'] ?? '', 80);
    $bid = strtolower($clean($body['id'] ?? '', 40));
    $existing = $bid !== '' ? $get($bid) : null;
    if (!$existing && $name === '') json_error('A branch needs a name');
    if ($bid === '') $bid = branch_slug($name);
    if (!preg_match('/^[a-z0-9-]{2,40}$/', $bid)) json_error('Branch id must be 2–40 letters, numbers or dashes');
    $next = (int)$pdo->query('SELECT COALESCE(MAX(sort_order),0)+1 FROM branches')->fetchColumn();
    $base = $existing ?: ['name' => '', 'area' => '', 'address' => '', 'query' => '', 'lat' => null, 'lng' => null,
        'phone' => '', 'hours' => 'Open 24 hours', 'is_main' => 0, 'listed' => 0, 'sort_order' => $next];
    $m = [
        'id' => $bid,
        'name' => $has('name') ? $name : $base['name'],
        'area' => $has('area') ? $clean($body['area'], 60) : $base['area'],
        'address' => $has('address') ? $clean($body['address'], 160) : $base['address'],
        'query' => $has('query') ? $clean($body['query'], 200) : $base['query'],
        'lat' => $has('lat') ? (is_numeric($body['lat']) ? (float)$body['lat'] : null) : $base['lat'],
        'lng' => $has('lng') ? (is_numeric($body['lng']) ? (float)$body['lng'] : null) : $base['lng'],
        'phone' => $has('phone') ? $clean($body['phone'], 24) : $base['phone'],
        'hours' => $has('hours') ? $clean($body['hours'], 60) : $base['hours'],
        'is_main' => $has('isMain') ? (!empty($body['isMain']) ? 1 : 0) : (int)$base['is_main'],
        'listed' => $has('listed') ? (!empty($body['listed']) ? 1 : 0) : (int)$base['listed'],
        'sort_order' => ($has('sortOrder') && is_numeric($body['sortOrder'])) ? (int)round($body['sortOrder']) : (int)$base['sort_order'],
    ];
    if ($m['name'] === '') json_error('A branch needs a name');
    if ($m['lat'] === null || $m['lng'] === null) json_error('Latitude and longitude are required — delivery fees are measured from this pin');
    if ($m['lat'] < -4.9 || $m['lat'] > 5.1 || $m['lng'] < 33.9 || $m['lng'] > 41.9) {
        json_error('Those coordinates are outside Kenya — check latitude/longitude (latitude first, e.g. -1.2921, 36.8219)');
    }
    if ($m['phone'] !== '' && !preg_match('/^\+?\d[\d\s\-()]{5,19}$/', $m['phone'])) {
        json_error('Phone number looks invalid — use digits, e.g. 0712 345 678 or +254712345678');
    }
    if ($m['address'] === '') $m['address'] = ($m['area'] ?: $m['name']) . ', Nairobi';
    if ($m['is_main']) $m['listed'] = 1;
    if (!$m['listed'] && listed_count_excluding($pdo, $bid) === 0) json_error('At least one branch must stay listed on the website');

    $pdo->beginTransaction();
    try {
        if ($m['is_main']) $pdo->prepare('UPDATE branches SET is_main = 0 WHERE id != ?')->execute([$bid]);
        $pdo->prepare('INSERT INTO branches (id, name, area, address, query, lat, lng, phone, hours, is_main, listed, sort_order)
            VALUES (:id, :name, :area, :address, :query, :lat, :lng, :phone, :hours, :is_main, :listed, :sort_order)
            ON DUPLICATE KEY UPDATE name=VALUES(name), area=VALUES(area), address=VALUES(address), query=VALUES(query),
              lat=VALUES(lat), lng=VALUES(lng), phone=VALUES(phone), hours=VALUES(hours), is_main=VALUES(is_main),
              listed=VALUES(listed), sort_order=VALUES(sort_order)')->execute($m);
        $pdo->commit();
    } catch (Exception $e) { $pdo->rollBack(); json_error('Could not save the branch: ' . $e->getMessage(), 500); }
    json_response(['ok' => true, 'branch' => branch_out($get($bid))], $existing ? 200 : 201);
}

json_error('Method not allowed', 405);
