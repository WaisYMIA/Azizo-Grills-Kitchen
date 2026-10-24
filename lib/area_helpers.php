<?php
// Delivery-area helpers. Mirrors backend/routes/areas.js (Node).

const AREA_DEFAULT_CFG = ['baseFee' => 100, 'perKm' => 25, 'bandKm' => 2, 'maxFee' => 450, 'maxKm' => 30, 'roadFactor' => 1.3, 'nearerBranchKm' => 2.5];
const AREA_LIMITS = ['baseFee' => [0, 5000], 'perKm' => [0, 500], 'bandKm' => [0.5, 20], 'maxFee' => [0, 20000], 'maxKm' => [1, 200], 'roadFactor' => [1, 2.5], 'nearerBranchKm' => [0, 50]];

function ensure_area_seed(PDO $pdo): void {
    if ((int)$pdo->query('SELECT COUNT(*) FROM areas')->fetchColumn() > 0) return;
    $seed = json_decode(file_get_contents(__DIR__ . '/../data/areas-seed.json'), true);
    $st = $pdo->prepare('INSERT INTO areas (id, region, name, corridor, lat, lng, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    foreach ($seed['areas'] as $a) $st->execute([$a['id'], $a['region'], $a['name'], $a['corridor'] ?? '', $a['lat'], $a['lng'], $a['active'] ? 1 : 0, $a['sort']]);
    $pdo->prepare('INSERT IGNORE INTO area_settings (skey, svalue) VALUES (?, ?)')->execute(['delivery_config', json_encode($seed['config'])]);
}

function area_config(PDO $pdo): array {
    $q = $pdo->query("SELECT svalue FROM area_settings WHERE skey = 'delivery_config'");
    $saved = $q ? json_decode((string)$q->fetchColumn(), true) : null;
    return array_merge(AREA_DEFAULT_CFG, is_array($saved) ? $saved : []);
}

function area_out(array $r): array {
    return ['id' => $r['id'], 'region' => $r['region'], 'name' => $r['name'], 'corridor' => $r['corridor'] ?? '',
        'lat' => (float)$r['lat'], 'lng' => (float)$r['lng'], 'active' => (bool)$r['active'], 'sortOrder' => (int)$r['sort_order']];
}
