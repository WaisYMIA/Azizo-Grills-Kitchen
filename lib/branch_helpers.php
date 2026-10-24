<?php
// Branch helpers shared by api/branches/index.php. Mirrors backend/routes/branches.js (Node).

function ensure_branch_seed(PDO $pdo): void {
    if ((int)$pdo->query('SELECT COUNT(*) FROM branches')->fetchColumn() > 0) return;
    // [id, name, area, address, query, lat, lng, phone, hours, is_main, listed, sort_order]
    // The four original branches are listed; the Nairobi middle/high-end ones start UNLISTED
    // (approximate pins) until admin ticks "Show on website" in the Branches tab.
    $seed = [
    ["syokimau", "Syokimau", "Syokimau", "Syokimau, Nairobi", "Azizo Butchery and Grill, Syokimau, Nairobi, Kenya", -1.381, 36.927, "", "Open 24 hours", 1, 1, 1],
    ["umoja", "Umoja", "Umoja", "Umoja, Nairobi", "Azizo Butchery and Grill, Umoja, Nairobi, Kenya", -1.2833, 36.8956, "", "Open 24 hours", 0, 1, 2],
    ["buruburu", "Buruburu", "Buruburu", "Buruburu, Nairobi", "Azizo Butchery and Grill, Buruburu, Nairobi, Kenya", -1.2864, 36.879, "", "Open 24 hours", 0, 1, 3],
    ["utawala", "Utawala", "Utawala", "Utawala, Nairobi", "Azizo Butchery and Grill, Utawala, Nairobi, Kenya", -1.287, 36.96, "", "Open 24 hours", 0, 1, 4],
    ["kilimani", "Kilimani", "Kilimani", "Kilimani, Nairobi", "Azizo Butchery and Grill, Kilimani, Nairobi, Kenya", -1.2921, 36.7878, "", "Open 24 hours", 0, 0, 5],
    ["lavington", "Lavington", "Lavington", "Lavington, Nairobi", "Azizo Butchery and Grill, Lavington, Nairobi, Kenya", -1.279, 36.77, "", "Open 24 hours", 0, 0, 6],
    ["westlands", "Westlands", "Westlands", "Westlands, Nairobi", "Azizo Butchery and Grill, Westlands, Nairobi, Kenya", -1.2635, 36.803, "", "Open 24 hours", 0, 0, 7],
    ["kileleshwa", "Kileleshwa", "Kileleshwa", "Kileleshwa, Nairobi", "Azizo Butchery and Grill, Kileleshwa, Nairobi, Kenya", -1.276, 36.784, "", "Open 24 hours", 0, 0, 8],
    ["parklands", "Parklands", "Parklands", "Parklands, Nairobi", "Azizo Butchery and Grill, Parklands, Nairobi, Kenya", -1.262, 36.818, "", "Open 24 hours", 0, 0, 9],
    ["karen", "Karen", "Karen", "Karen, Nairobi", "Azizo Butchery and Grill, Karen, Nairobi, Kenya", -1.319, 36.709, "", "Open 24 hours", 0, 0, 10],
    ["runda", "Runda", "Runda", "Runda, Nairobi", "Azizo Butchery and Grill, Runda, Nairobi, Kenya", -1.218, 36.807, "", "Open 24 hours", 0, 0, 11],
    ["muthaiga", "Muthaiga", "Muthaiga", "Muthaiga, Nairobi", "Azizo Butchery and Grill, Muthaiga, Nairobi, Kenya", -1.253, 36.836, "", "Open 24 hours", 0, 0, 12],
    ["gigiri", "Gigiri", "Gigiri", "Gigiri, Nairobi", "Azizo Butchery and Grill, Gigiri, Nairobi, Kenya", -1.231, 36.804, "", "Open 24 hours", 0, 0, 13],
    ["south-c", "South C", "South C", "South C, Nairobi", "Azizo Butchery and Grill, South C, Nairobi, Kenya", -1.315, 36.826, "", "Open 24 hours", 0, 0, 14]
    ];
    $stmt = $pdo->prepare('INSERT INTO branches (id, name, area, address, query, lat, lng, phone, hours, is_main, listed, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    foreach ($seed as $r) $stmt->execute($r);
}

function branch_out(array $r): array {
    return [
        'id' => $r['id'], 'name' => $r['name'], 'area' => $r['area'] ?? '', 'address' => $r['address'] ?? '',
        'query' => $r['query'] ?? '', 'lat' => $r['lat'] === null ? null : (float)$r['lat'],
        'lng' => $r['lng'] === null ? null : (float)$r['lng'], 'phone' => $r['phone'] ?? '',
        'hours' => $r['hours'] ?? '', 'isMain' => (bool)$r['is_main'], 'listed' => (bool)$r['listed'],
        'sortOrder' => (int)$r['sort_order'],
    ];
}

function branch_slug(string $s): string {
    $s = strtolower(preg_replace('/\(.*?\)/', '', $s));
    $s = trim(preg_replace('/[^a-z0-9]+/', '-', $s), '-');
    return substr($s, 0, 40);
}

function listed_count_excluding(PDO $pdo, string $id): int {
    $q = $pdo->prepare('SELECT COUNT(*) FROM branches WHERE listed = 1 AND id != ?');
    $q->execute([$id]);
    return (int)$q->fetchColumn();
}
