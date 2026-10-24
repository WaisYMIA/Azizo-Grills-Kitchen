<?php
// Azizo Kitchens API (mirrors backend/routes/kitchens.js), routed by .htaccess to ?p=<path after /api/kitchens>
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../lib/kk_helpers.php';
cors_and_preflight();
$pdo = get_db();
header('Cache-Control: no-store');
$method = $_SERVER['REQUEST_METHOD'];
$P = array_values(array_filter(explode('/', trim((string)($_GET['p'] ?? ''), '/')), fn($x) => $x !== ''));
$body = in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true) ? read_json_body() : [];
$route = $method . ' ' . implode('/', array_map(fn($x) => ctype_digit($x) ? ':id' : $x, $P));

$clean = fn($v, $max) => mb_substr(trim(preg_replace('/[\x00-\x08\x0b\x0c\x0e-\x1f]/', ' ', (string)($v ?? ''))), 0, $max);
$slugify = function ($t) { $s = substr(trim(preg_replace('/[^a-z0-9]+/', '-', strtolower((string)$t)), '-'), 0, 60); return $s ?: 'kitchen'; };
$last9 = fn($s) => substr(preg_replace('/\D/', '', (string)$s), -9);
$lines = fn($t) => array_values(array_filter(array_map('trim', preg_split('/\r?\n/', (string)$t)), fn($x) => $x !== ''));
$jp = function ($t, $d) { $v = json_decode((string)$t, true); return $v === null ? $d : $v; };
$one = function ($sql, $a = []) use ($pdo) { $q = $pdo->prepare($sql); $q->execute($a); return $q->fetch(); };
$all = function ($sql, $a = []) use ($pdo) { $q = $pdo->prepare($sql); $q->execute($a); return $q->fetchAll(); };
$run = function ($sql, $a = []) use ($pdo) { $q = $pdo->prepare($sql); $q->execute($a); return $q; };
$val = fn($sql, $a = []) => ($r = $one($sql, $a)) ? (int)array_values($r)[0] : 0;
$now = fn() => gmdate('Y-m-d H:i:s');
$f = fn($v) => (float)$v;
$bool = fn($v) => !empty($v) && $v !== 'false' && $v !== '0';

// ---- settings / time / geo ----
$DEF = ['commissionPct' => 20, 'lunch' => ['label' => 'Lunch', 'from' => '12:00', 'to' => '14:00', 'cutoff' => '10:30'], 'dinner' => ['label' => 'Dinner', 'from' => '18:00', 'to' => '20:00', 'cutoff' => '16:30'],
    'fee' => ['base' => 100, 'perKm' => 25, 'bandKm' => 2, 'max' => 400], 'defaultRadiusKm' => 4, 'roadFactor' => 1.3, 'zoneCap' => 4, 'zoneCaps' => new stdClass(), 'minOrder' => 300, 'holdMinutes' => 120, 'deliveryCost' => 150, 'autoReassign' => false, 'loyaltyEvery' => 8];
$settings = function () use ($one, $jp, $DEF) {
    $r = $one("SELECT svalue FROM kk_meta WHERE skey = 'kk_settings'"); $s = $r ? $jp($r['svalue'], []) : [];
    $o = array_merge($DEF, $s);
    $o['lunch'] = array_merge($DEF['lunch'], $s['lunch'] ?? []); $o['dinner'] = array_merge($DEF['dinner'], $s['dinner'] ?? []); $o['fee'] = array_merge($DEF['fee'], $s['fee'] ?? []);
    $o['zoneCaps'] = (array)($s['zoneCaps'] ?? []);
    return $o;
};
$S = $settings();
$hm = function ($t) { [$h, $m] = array_map('intval', explode(':', $t . ':0')); return $h * 60 + $m; };
$nowEAT = function () { $t = time() + TZ_OFFSET_HOURS * 3600; return ['date' => gmdate('Y-m-d', $t), 'min' => (int)gmdate('G', $t) * 60 + (int)gmdate('i', $t)]; };
$addDays = fn($d, $n) => gmdate('Y-m-d', strtotime($d . ' UTC') + $n * 86400);
$slotOpen = function ($date, $meal) use ($S, $nowEAT, $addDays, $hm) {
    $n = $nowEAT(); if (!in_array($meal, ['lunch', 'dinner'], true)) return [false, 'Choose lunch or dinner'];
    if ($date < $n['date'] || $date > $addDays($n['date'], 2)) return [false, 'Choose today, tomorrow or the day after'];
    if ($date === $n['date'] && $n['min'] >= $hm($S[$meal]['cutoff'])) return [false, $S[$meal]['label'] . ' orders for today closed at ' . $S[$meal]['cutoff']];
    return [true, ''];
};
$haversine = function ($a, $b, $c, $d) { $r = M_PI / 180; $dl = ($c - $a) * $r; $dg = ($d - $b) * $r; $h = sin($dl / 2) ** 2 + cos($a * $r) * cos($c * $r) * sin($dg / 2) ** 2; return 2 * 6371 * asin(sqrt($h)); };
$roadKm = fn($k, $lat, $lng) => round($haversine((float)$k['lat'], (float)$k['lng'], $lat, $lng) * (float)$S['roadFactor'] * 10) / 10;
$feeFor = function ($km) use ($S) { $band = max($S['fee']['bandKm'], ceil($km / $S['fee']['bandKm']) * $S['fee']['bandKm']); return (int)min($S['fee']['max'], round(($S['fee']['base'] + $S['fee']['perKm'] * $band) / 10) * 10); };
$point = function ($b) use ($one) {
    if (!empty($b['areaId'])) { $a = $one('SELECT lat, lng, name, region FROM areas WHERE id = ?', [(string)$b['areaId']]); if ($a) return ['lat' => (float)$a['lat'], 'lng' => (float)$a['lng'], 'area' => $a]; }
    if (isset($b['lat'], $b['lng']) && is_numeric($b['lat']) && is_numeric($b['lng'])) { $la = (float)$b['lat']; $ln = (float)$b['lng']; if (abs($la) <= 90 && abs($ln) <= 180 && ($la || $ln)) return ['lat' => $la, 'lng' => $ln, 'area' => null]; }
    return null;
};
// ---- shapes ----
$dishPub = fn($d) => ['id' => (int)$d['id'], 'slug' => $d['slug'], 'name' => $d['name'], 'tradition' => $d['tradition'], 'category' => $d['category'], 'meal' => $d['meal'], 'price' => (int)$d['price'], 'serves' => (int)$d['serves'], 'description' => $d['description'], 'image' => $d['image'], 'tags' => array_values(array_filter(explode(',', (string)($d['tags'] ?? '')))), 'options' => $jp($d['options'], [])];
$dishFull = fn($d) => $dishPub($d) + ['tagsCsv' => (string)($d['tags'] ?? ''), 'components' => $lines($d['components']), 'method' => $lines($d['method']), 'packaging' => $d['packaging'], 'tips' => $d['tips'], 'active' => (bool)$d['active'], 'sort' => (int)$d['sort_order']];
$rating = function ($id) use ($one) { $r = $one('SELECT COUNT(*) AS n, AVG(rating) AS a FROM kk_orders WHERE kitchen_id = ? AND rating > 0', [$id]); return ['avg' => (int)$r['n'] ? round((float)$r['a'], 1) : 0, 'count' => (int)$r['n']]; };
$firstName = function ($n) use ($clean) { $p = preg_split('/\s+/', $clean($n, 60)); return $p[0] ?: 'Cook'; };
$kPub = function ($k) use ($rating, $firstName) { $r = $rating($k['id']); return ['id' => (int)$k['id'], 'slug' => $k['slug'], 'name' => $k['name'], 'cook' => $firstName($k['cook_name']), 'bio' => $k['bio'], 'specialities' => $k['specialities'], 'region' => $k['region'], 'rating' => $r['avg'], 'ratingCount' => $r['count'], 'prepMin' => (int)$k['prep_min']]; };
$queuePos = fn($k) => $k['status'] !== 'queued' ? 0 : $val("SELECT COUNT(*) FROM kk_kitchens WHERE status = 'queued' AND region = ? AND id <= ?", [$k['region'], $k['id']]);
$LIVE = "status IN ('pilot','live') AND paused = 0";
$slotUsed = fn($kid, $date, $meal) => $val("SELECT COUNT(*) FROM kk_orders WHERE kitchen_id = ? AND date = ? AND meal = ? AND status NOT IN ('cancelled','rejected')", [$kid, $date, $meal]);
$limit = function ($max, $tag) {
    $file = sys_get_temp_dir() . '/azizo_kk_' . $tag . md5($_SERVER['REMOTE_ADDR'] ?? 'x') . '.json'; $now = time();
    $hits = is_file($file) ? (json_decode((string)@file_get_contents($file), true) ?: []) : []; $hits = array_values(array_filter($hits, fn($t) => $now - $t < 3600));
    if (count($hits) >= $max) json_error('Too many attempts - please try again later', 429);
    $hits[] = $now; @file_put_contents($file, json_encode($hits));
};
// ---- images / docs ----
$readImage = function ($data, $maxBytes) {
    if (!preg_match('#^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$#', (string)$data, $m)) return ['error' => 'Upload a JPG, PNG or WebP image'];
    $buf = base64_decode($m[2], true); if ($buf === false || strlen($buf) > $maxBytes) return ['error' => 'Image is too large'];
    $ok = ($m[1] === 'jpeg' && substr($buf, 0, 2) === "\xFF\xD8") || ($m[1] === 'png' && substr($buf, 1, 3) === 'PNG') || ($m[1] === 'webp' && substr($buf, 0, 4) === 'RIFF');
    if (!$ok) return ['error' => 'That file is not a valid image'];
    return ['buf' => $buf, 'ext' => $m[1] === 'jpeg' ? 'jpg' : $m[1]];
};
$PRIVATE = __DIR__ . '/../../private/kitchen-docs';
$DOC_TYPES = ['id', 'permit', 'health', 'kra', 'premises', 'other'];
$addDocs = function ($k, $b) use ($jp, $clean, $readImage, $PRIVATE, $DOC_TYPES, $slugify) {
    $docs = $jp($k['docs'], []); $nums = is_array($b['docNumbers'] ?? null) ? $b['docNumbers'] : [];
    foreach ($DOC_TYPES as $t) if (!empty($nums[$t]) && (!empty($nums[$t]['no']) || !empty($nums[$t]['expiry']))) {
        $idx = null; foreach ($docs as $i => $d) if ($d['type'] === $t && empty($d['file'])) $idx = $i;
        if ($idx === null) { $docs[] = ['type' => $t]; $idx = count($docs) - 1; }
        $docs[$idx]['no'] = $clean($nums[$t]['no'] ?? '', 60); $docs[$idx]['expiry'] = $clean($nums[$t]['expiry'] ?? '', 12);
    }
    foreach (array_slice(is_array($b['docImages'] ?? null) ? $b['docImages'] : [], 0, 6) as $im) {
        if (!is_array($im) || !in_array($im['type'] ?? '', $DOC_TYPES, true)) continue;
        $r = $readImage($im['data'] ?? '', 1500 * 1024); if (isset($r['error'])) return ['error' => $im['type'] . ': ' . $r['error']];
        if (!is_dir($PRIVATE)) @mkdir($PRIVATE, 0755, true);
        $file = 'k' . $k['id'] . '-' . $slugify($im['type']) . '-' . bin2hex(random_bytes(5)) . '.' . $r['ext']; file_put_contents($PRIVATE . '/' . $file, $r['buf']);
        $docs[] = ['type' => $im['type'], 'file' => $file, 'uploaded' => gmdate('Y-m-d')];
    }
    return ['docs' => $docs];
};
$statement = function ($kid) use ($one, $all, $val) {
    $e = $one("SELECT COUNT(*) AS n, COALESCE(SUM(subtotal),0) AS gross, COALESCE(SUM(commission_amt),0) AS comm, COALESCE(SUM(kitchen_amt),0) AS net FROM kk_orders WHERE kitchen_id = ? AND status = 'delivered'", [$kid]);
    $paid = $val('SELECT COALESCE(SUM(amount),0) FROM kk_payouts WHERE kitchen_id = ?', [$kid]);
    $sup = $val("SELECT COALESCE(SUM(total),0) FROM kk_supply WHERE kitchen_id = ? AND status = 'supplied'", [$kid]);
    return ['delivered' => (int)$e['n'], 'gross' => (int)$e['gross'], 'commission' => (int)$e['comm'], 'earned' => (int)$e['net'], 'paid' => $paid, 'supplies' => $sup, 'balance' => (int)$e['net'] - $paid - $sup,
        'payouts' => $all('SELECT amount, reference, note, created_at FROM kk_payouts WHERE kitchen_id = ? ORDER BY id DESC LIMIT 50', [$kid])];
};
$itemsOf = fn($oid) => array_map(fn($i) => ['name' => $i['name'], 'qty' => (int)$i['qty'], 'options' => $i['options_text'], 'total' => (int)$i['line_total']], $all('SELECT name, qty, options_text, line_total FROM kk_order_items WHERE order_id = ?', [$oid]));
$int = fn($v, $d, $lo, $hi) => max($lo, min($hi, is_numeric($v) ? (int)$v : $d));
$num = fn($v, $d, $lo, $hi) => max($lo, min($hi, is_numeric($v) ? (float)$v : $d));

// ---- v3.1 shared helpers ----
const KK_TAGS = ['vegetarian', 'spicy', 'fish', 'halal', 'no-pork', 'gluten-free'];
function kk_nearest_area(float $lat, float $lng): ?array { global $all, $haversine; $best = null; $bd = 1e9; foreach ($all('SELECT id, name, region, lat, lng FROM areas') as $a) { $d = $haversine($lat, $lng, (float)$a['lat'], (float)$a['lng']); if ($d < $bd) { $bd = $d; $best = $a; } } return ($best && $bd < 8) ? $best : null; }
function kk_log_demand(array $p, $areaId): void {
    global $run, $nowEAT;
    try { $a = $p['area'] ? ['id' => (string)$areaId, 'name' => $p['area']['name'], 'region' => $p['area']['region']] : kk_nearest_area($p['lat'], $p['lng']); if (!$a) return;
        $run('INSERT INTO kk_demand (date, area_id, region, name, n) VALUES (?,?,?,?,1) ON DUPLICATE KEY UPDATE n = n + 1', [$nowEAT()['date'], $a['id'], $a['region'] ?? '', $a['name'] ?? '']); } catch (Throwable $e) { }
}
function kk_expire_unpaid(): void { global $run; $run("UPDATE kk_orders SET status = 'cancelled', reason = 'Payment not completed', updated_at = ? WHERE payment = 'mpesa_now' AND paid = 0 AND status = 'new' AND created_at < ?", [gmdate('Y-m-d H:i:s'), gmdate('Y-m-d H:i:s', time() - 1200)]); }
function kk_promo_check($codeIn, int $subtotal, int $fee): array {
    global $one, $clean, $nowEAT; $code = strtoupper($clean($codeIn, 30)); if ($code === '') return ['ok' => false, 'error' => 'Enter a promo code'];
    $p = $one('SELECT * FROM kk_promos WHERE code = ? AND active = 1', [$code]); if (!$p) return ['ok' => false, 'error' => 'That promo code is not valid'];
    if ($p['expires'] !== '' && $p['expires'] < $nowEAT()['date']) return ['ok' => false, 'error' => 'That promo code has expired'];
    if ((int)$p['max_uses'] && (int)$p['used'] >= (int)$p['max_uses']) return ['ok' => false, 'error' => 'That promo code has been fully used'];
    if ($subtotal < (int)$p['min_order']) return ['ok' => false, 'error' => 'This code needs at least KSh ' . $p['min_order'] . ' of food'];
    $disc = $p['kind'] === 'freedelivery' ? $fee : ($p['kind'] === 'flat' ? min((int)$p['value'], $subtotal) : (int)round($subtotal * min(100, (int)$p['value']) / 100));
    return ['ok' => true, 'code' => $code, 'kind' => $p['kind'], 'value' => (int)$p['value'], 'discount' => $disc, 'id' => (int)$p['id']];
}
function kk_delivered_count($phone): int { global $val, $last9; return $val("SELECT COUNT(*) FROM kk_orders WHERE status = 'delivered' AND RIGHT(REPLACE(phone, ' ', ''), 9) = ?", [$last9($phone)]); }
function kk_candidates(array $o): array {
    global $all, $one, $val, $roadKm, $slotUsed, $LIVE; $items = array_column($all('SELECT dish_id FROM kk_order_items WHERE order_id = ?', [$o['id']]), 'dish_id'); $out = [];
    foreach ($all("SELECT * FROM kk_kitchens WHERE $LIVE AND lat IS NOT NULL AND id != ?", [$o['kitchen_id']]) as $k) {
        $km = $roadKm($k, (float)$o['lat'], (float)$o['lng']); if ($km > (float)$k['radius_km']) continue; $ok = true;
        foreach ($items as $d) if (!$one('SELECT 1 FROM kk_kitchen_dishes kd JOIN kk_dishes d ON d.id = kd.dish_id WHERE kd.kitchen_id = ? AND kd.dish_id = ? AND kd.available = 1 AND d.active = 1', [$k['id'], $d])) { $ok = false; break; }
        if (!$ok) continue; $left = (int)$k['capacity'] - $slotUsed($k['id'], $o['date'], $o['meal']); if ($left <= 0) continue; $out[] = ['kitchen' => $k, 'km' => $km, 'left' => $left];
    }
    usort($out, fn($a, $b) => $a['km'] <=> $b['km']); return $out;
}
function kk_last_order(int $id): ?array { global $one; return $one('SELECT * FROM kk_orders WHERE id = ?', [$id]) ?: null; }
function kk_reassign(array $o, array $k): void {
    global $run, $S, $pdo; $pct = $k['commission_pct'] === null ? (float)$S['commissionPct'] : (float)$k['commission_pct']; $comm = (int)round($o['subtotal'] * $pct / 100);
    $run("UPDATE kk_orders SET kitchen_id = ?, status = 'new', reassigned_from = COALESCE(reassigned_from, ?), commission_pct = ?, commission_amt = ?, kitchen_amt = ?, reason = '', accepted_at = NULL, updated_at = ? WHERE id = ?", [$k['id'], $o['kitchen_id'], $pct, $comm, (int)$o['subtotal'] - $comm, gmdate('Y-m-d H:i:s'), $o['id']]);
    kk_queue($pdo, 'reassigned', kk_last_order((int)$o['id']), ['kitchen' => $k['name']]);
}
function kk_ms($t): float { return $t ? (float)strtotime($t . ' UTC') * 1000 : NAN; }
function kk_mins($a, $b): float { return (kk_ms($b) - kk_ms($a)) / 60000; }
function kk_scorecard(int $kid, int $days = 30): array {
    global $all, $S;
    $rows = $all("SELECT * FROM kk_orders WHERE kitchen_id = ? AND created_at >= ? AND NOT (reason = 'Payment not completed')", [$kid, gmdate('Y-m-d H:i:s', time() - $days * 86400)]);
    $total = count($rows); $rej = count(array_filter($rows, fn($o) => $o['status'] === 'rejected')); $acc = array_values(array_filter($rows, fn($o) => !empty($o['accepted_at']))); $accepted = count($acc);
    $delivered = count(array_filter($rows, fn($o) => $o['status'] === 'delivered'));
    $avgAccept = $accepted ? array_sum(array_map(fn($o) => kk_mins($o['created_at'], $o['accepted_at']), $acc)) / $accepted : null;
    $fast = $accepted ? count(array_filter($acc, fn($o) => kk_mins($o['created_at'], $o['accepted_at']) <= 15)) / $accepted : null;
    $rdy = array_values(array_filter($rows, fn($o) => !empty($o['ready_at']))); $onTime = null;
    if ($rdy) { $good = 0; foreach ($rdy as $o) { $t = strtotime($o['ready_at'] . ' UTC') + TZ_OFFSET_HOURS * 3600; $m = (int)gmdate('G', $t) * 60 + (int)gmdate('i', $t); $w = explode(':', $S[$o['meal']]['from'] ?? '12:00'); if ($m <= (int)$w[0] * 60 + (int)$w[1] && gmdate('Y-m-d', $t) <= $o['date']) $good++; } $onTime = $good / count($rdy); }
    $rated = array_values(array_filter($rows, fn($o) => (int)$o['rating'] > 0)); $avgRating = $rated ? array_sum(array_map(fn($o) => (int)$o['rating'], $rated)) / count($rated) : null; $low = count(array_filter($rated, fn($o) => (int)$o['rating'] <= 2));
    $accRate = ($accepted + $rej) ? $accepted / ($accepted + $rej) : null; $score = null; $note = 'Not enough orders yet (needs 3).';
    if ($total >= 3) { $score = (int)round(30 * ($accRate ?? 1) + 20 * ($fast ?? 1) + 30 * ($onTime ?? 1) + 20 * ($avgRating === null ? 0.8 : $avgRating / 5)); $note = $score >= 80 ? 'Good standing.' : ($score >= 60 ? 'Needs attention: coach the cook on speed and timing.' : 'Below standard: consider a strike and a coaching call.'); }
    $r1 = fn($x) => $x === null ? null : round($x * 10) / 10;
    return ['days' => $days, 'orders' => $total, 'delivered' => $delivered, 'rejected' => $rej, 'acceptRate' => $accRate === null ? null : (int)round($accRate * 100), 'avgAcceptMin' => $r1($avgAccept), 'fastAcceptPct' => $fast === null ? null : (int)round($fast * 100), 'onTimePct' => $onTime === null ? null : (int)round($onTime * 100), 'avgRating' => $r1($avgRating), 'lowRatings' => $low, 'score' => $score, 'note' => $note];
}
function kk_doc_alerts(?int $kid = null): array {
    global $all, $jp, $nowEAT, $addDays; $out = []; $today = $nowEAT()['date']; $soon = $addDays($today, 30);
    foreach ($all("SELECT id, name, docs FROM kk_kitchens WHERE status NOT IN ('delisted','rejected')" . ($kid ? ' AND id = ' . (int)$kid : '')) as $k) foreach ($jp($k['docs'], []) as $d) {
        $e = $d['expiry'] ?? ''; if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $e)) continue;
        if ($e < $today) $out[] = ['kitchenId' => (int)$k['id'], 'kitchen' => $k['name'], 'type' => $d['type'], 'expiry' => $e, 'level' => 'expired']; elseif ($e <= $soon) $out[] = ['kitchenId' => (int)$k['id'], 'kitchen' => $k['name'], 'type' => $d['type'], 'expiry' => $e, 'level' => 'soon'];
    }
    return $out;
}
function kk_send_csv(string $name, array $rows): void {
    header('Content-Type: text/csv; charset=utf-8'); header('Content-Disposition: attachment; filename="' . $name . '"');
    echo "\xEF\xBB\xBF"; foreach ($rows as $r) { echo implode(',', array_map(function ($v) { $x = (string)($v ?? ''); return preg_match('/[",\n]/', $x) ? '"' . str_replace('"', '""', $x) . '"' : $x; }, $r)) . "\r\n"; } exit;
}

// ================= PUBLIC =================
if ($route === 'GET health') {
    $okDb = false; $counts = []; try { $counts = ['kitchens' => $val('SELECT COUNT(*) FROM kk_kitchens'), 'liveKitchens' => $val("SELECT COUNT(*) FROM kk_kitchens WHERE $LIVE"), 'openOrders' => $val("SELECT COUNT(*) FROM kk_orders WHERE status NOT IN ('delivered','cancelled','rejected')")]; $okDb = true; } catch (Throwable $e) { }
    json_response(['ok' => $okDb, 'time' => gmdate('c'), 'counts' => $counts, 'mpesa' => (bool)kk_mpesa_configured(), 'whatsapp' => (bool)(WA_TOKEN && WA_PHONE_ID), 'adminPasswordSet' => KITCHENS_ADMIN_PASSWORD !== ''], $okDb ? 200 : 503);
}
if ($route === 'GET config') {
    $trad = array_values(array_filter(array_column($all('SELECT DISTINCT tradition FROM kk_dishes WHERE active = 1 ORDER BY tradition'), 'tradition')));
    $cat = array_column($all('SELECT category, MIN(sort_order) AS s FROM kk_dishes WHERE active = 1 GROUP BY category ORDER BY s'), 'category');
    json_response(['lunch' => $S['lunch'], 'dinner' => $S['dinner'], 'fee' => $S['fee'], 'minOrder' => $S['minOrder'], 'holdMinutes' => $S['holdMinutes'], 'now' => $nowEAT(), 'tz' => TZ_OFFSET_HOURS, 'mpesaStk' => (bool)kk_mpesa_configured(), 'loyaltyEvery' => (int)$S['loyaltyEvery'], 'tagList' => KK_TAGS, 'traditions' => $trad, 'categories' => $cat]);
}
if ($route === 'GET areas') json_response(['areas' => array_map(fn($a) => ['id' => $a['id'], 'region' => $a['region'], 'name' => $a['name'], 'lat' => (float)$a['lat'], 'lng' => (float)$a['lng']], $all('SELECT id, region, name, lat, lng FROM areas ORDER BY region, name'))]);
if ($route === 'GET dishes') json_response(['dishes' => array_map($dishPub, $all('SELECT * FROM kk_dishes WHERE active = 1 ORDER BY sort_order'))]);
if ($route === 'GET search') {
    $p = $point(['areaId' => $_GET['area'] ?? '', 'lat' => $_GET['lat'] ?? null, 'lng' => $_GET['lng'] ?? null]);
    if (!$p) json_error('Choose your area or share your location');
    $date = preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['date'] ?? '') ? $_GET['date'] : $nowEAT()['date']; $out = [];
    foreach ($all("SELECT * FROM kk_kitchens WHERE $LIVE AND lat IS NOT NULL") as $k) {
        $km = $roadKm($k, $p['lat'], $p['lng']); if ($km > (float)$k['radius_km']) continue;
        $menu = array_map($dishPub, $all('SELECT d.* FROM kk_kitchen_dishes kd JOIN kk_dishes d ON d.id = kd.dish_id WHERE kd.kitchen_id = ? AND kd.available = 1 AND d.active = 1 ORDER BY d.sort_order', [$k['id']]));
        if (!$menu) continue; $slots = [];
        foreach (['lunch', 'dinner'] as $m) { [$ok, $why] = $slotOpen($date, $m); $slots[$m] = ['open' => $ok, 'why' => $why, 'left' => max(0, (int)$k['capacity'] - $slotUsed($k['id'], $date, $m))]; }
        $out[] = $kPub($k) + ['distanceKm' => $km, 'fee' => $feeFor($km), 'minOrder' => $S['minOrder'], 'slots' => $slots, 'menu' => $menu];
    }
    usort($out, fn($a, $b) => $a['distanceKm'] <=> $b['distanceKm']);
    if (!$out) kk_log_demand($p, $_GET['area'] ?? '');
    json_response(['date' => $date, 'area' => $p['area'] ? ['name' => $p['area']['name'], 'region' => $p['area']['region']] : null, 'kitchens' => $out]);
}
if ($route === 'POST orders') {
    $limit(10, 'ord'); $b = $body; if (!empty($b['website'])) json_response(['ok' => true], 201); kk_expire_unpaid();
    $k = $one("SELECT * FROM kk_kitchens WHERE id = ? AND $LIVE", [(int)($b['kitchenId'] ?? 0)]); if (!$k) json_error('This kitchen is not taking orders right now', 404);
    $name = $clean($b['name'] ?? '', 60); $phone = $clean($b['phone'] ?? '', 20); $address = $clean($b['address'] ?? '', 200);
    if (mb_strlen($name) < 2) json_error('Enter your name'); if (strlen($last9($phone)) < 9) json_error('Enter a valid phone number'); if (mb_strlen($address) < 4) json_error('Enter your delivery address');
    $p = $point($b); if (!$p) json_error('Choose your area or share your location');
    $km = $roadKm($k, $p['lat'], $p['lng']); if ($km > (float)$k['radius_km']) json_error('Sorry, this kitchen does not deliver that far');
    $date = $clean($b['date'] ?? '', 10); $meal = $clean($b['meal'] ?? '', 8); [$ok, $why] = $slotOpen($date, $meal); if (!$ok) json_error($why);
    if ($slotUsed($k['id'], $date, $meal) >= (int)$k['capacity']) json_error('This kitchen is fully booked for that slot. Try another kitchen or time', 409);
    $items = is_array($b['items'] ?? null) ? array_slice($b['items'], 0, 30) : []; if (!$items) json_error('Your basket is empty');
    $rows = []; $sub = 0;
    foreach ($items as $it) {
        $d = $one('SELECT d.* FROM kk_kitchen_dishes kd JOIN kk_dishes d ON d.id = kd.dish_id WHERE kd.kitchen_id = ? AND kd.dish_id = ? AND kd.available = 1 AND d.active = 1', [$k['id'], (int)($it['dishId'] ?? 0)]);
        if (!$d) json_error('One of the dishes is no longer available from this kitchen');
        if ($d['meal'] !== 'both' && $d['meal'] !== $meal) json_error($d['name'] . ' is not served at ' . $meal);
        $qty = max(1, min(20, (int)($it['qty'] ?? 1))); $unit = (int)$d['price']; $picked = [];
        foreach ($jp($d['options'], []) as $g) {
            $want = $it['options'][$g['name']] ?? null; $ch = null; foreach ($g['choices'] as $c) if ($c['name'] === $want) $ch = $c;
            if (!empty($g['required']) && !$ch) json_error('Choose ' . strtolower($g['name']) . ' for ' . $d['name']);
            if ($ch) { $unit += (int)($ch['price'] ?? 0); $picked[] = $g['name'] . ': ' . $ch['name']; }
        }
        $rows[] = ['d' => $d, 'qty' => $qty, 'unit' => $unit, 'text' => implode(', ', $picked), 'total' => $unit * $qty]; $sub += $unit * $qty;
    }
    if ($sub < $S['minOrder']) json_error('Minimum order is KSh ' . $S['minOrder'] . ' of food');
    $fee = $feeFor($km); $corp = null;
    if ($clean($b['corpCode'] ?? '', 30) !== '') { $corp = $one('SELECT * FROM kk_corporate WHERE code = ? AND active = 1', [strtoupper($clean($b['corpCode'], 30))]); if (!$corp) json_error('That company code is not valid'); }
    $payment = in_array($b['payment'] ?? '', ['cash', 'mpesa', 'mpesa_now', 'invoice'], true) ? $b['payment'] : 'cash';
    if ($payment === 'invoice' && !$corp) json_error('Invoice payment needs a valid company code');
    if ($payment === 'mpesa_now' && !kk_mpesa_configured()) json_error('Paying with M-Pesa now is not available yet. Choose pay on delivery.');
    $discount = ($corp && (float)$corp['discount_pct']) ? (int)round($sub * (float)$corp['discount_pct'] / 100) : 0; $promoCode = ''; $promoId = null;
    if ($clean($b['promo'] ?? '', 30) !== '') { $pr = kk_promo_check($b['promo'], $sub, $fee); if (!$pr['ok']) json_error($pr['error']); $discount += $pr['discount']; $promoCode = $pr['code']; $promoId = $pr['id']; }
    elseif ((int)$S['loyaltyEvery'] > 0 && (kk_delivered_count($phone) + 1) % (int)$S['loyaltyEvery'] === 0) { $discount += $fee; $promoCode = 'LOYALTY'; }
    $discount = min($discount, $sub + $fee); $total = $sub + $fee - $discount; $pct = $k['commission_pct'] === null ? (float)$S['commissionPct'] : (float)$k['commission_pct']; $comm = (int)round($sub * $pct / 100);
    $code = (string)random_int(1000, 9999); $region = $p['area'] ? $p['area']['region'] : (kk_nearest_area($p['lat'], $p['lng'])['region'] ?? '');
    $pdo->beginTransaction();
    try {
        $run('INSERT INTO kk_orders (kitchen_id, name, phone, address, area_id, lat, lng, distance_km, date, meal, notes, subtotal, delivery_fee, total, payment, commission_pct, commission_amt, kitchen_amt, delivery_code, promo_code, discount, corp_id, region, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [$k['id'], $name, $phone, $address, (string)($b['areaId'] ?? ''), $p['lat'], $p['lng'], $km, $date, $meal, $clean($b['notes'] ?? '', 300), $sub, $fee, $total, $payment, $pct, $comm, $sub - $comm, $code, $promoCode, $discount, $corp ? (int)$corp['id'] : null, $region, $now(), $now()]);
        $oid = (int)$pdo->lastInsertId();
        foreach ($rows as $l) $run('INSERT INTO kk_order_items (order_id, dish_id, name, qty, unit_price, options_text, line_total) VALUES (?,?,?,?,?,?,?)', [$oid, $l['d']['id'], $l['d']['name'], $l['qty'], $l['unit'], $l['text'], $l['total']]);
        if ($promoId) $run('UPDATE kk_promos SET used = used + 1 WHERE id = ?', [$promoId]);
        $pdo->commit();
    } catch (Throwable $e) { $pdo->rollBack(); json_error('Could not save your order, please try again', 500); }
    kk_queue($pdo, 'placed', kk_last_order($oid), ['kitchen' => $k['name']]);
    $stk = null;
    if ($payment === 'mpesa_now') { try { $cid = kk_stk($pdo, $phone, $total, 'AzizoK-' . $oid); $run('UPDATE kk_orders SET mpesa_checkout = ? WHERE id = ?', [$cid, $oid]); $stk = ['started' => true]; } catch (Throwable $e) { $stk = ['started' => false, 'error' => $e->getMessage()]; } }
    json_response(['ok' => true, 'id' => $oid, 'total' => $total, 'fee' => $fee, 'discount' => $discount, 'promo' => $promoCode, 'deliveryCode' => $code, 'kitchen' => $k['name'], 'window' => $S[$meal]['from'] . '-' . $S[$meal]['to'], 'payment' => $payment, 'stk' => $stk, 'message' => 'Order received. Your kitchen will confirm shortly.'], 201);
}
if ($route === 'POST promo/check') {
    $limit(60, 'promo'); $k = $one('SELECT * FROM kk_kitchens WHERE id = ?', [(int)($body['kitchenId'] ?? 0)]); $p = $point($body); $sub = max(0, (int)($body['subtotal'] ?? 0)); $fee = ($k && $p) ? $feeFor($roadKm($k, $p['lat'], $p['lng'])) : (int)$S['fee']['base'];
    $r = kk_promo_check($body['code'] ?? '', $sub, $fee); if (!$r['ok']) json_error($r['error']); json_response(['ok' => true, 'code' => $r['code'], 'discount' => $r['discount'], 'kind' => $r['kind']]);
}
if ($route === 'GET corporate/check') { $limit(60, 'corp'); $c = $one('SELECT name, discount_pct FROM kk_corporate WHERE code = ? AND active = 1', [strtoupper($clean($_GET['code'] ?? '', 30))]); if (!$c) json_error('That company code is not valid', 404); json_response(['name' => $c['name'], 'discountPct' => (float)$c['discount_pct']]); }
if ($route === 'GET loyalty') { $limit(60, 'loy'); $n = kk_delivered_count($_GET['phone'] ?? ''); $e = (int)$S['loyaltyEvery']; json_response(['every' => $e, 'delivered' => $n, 'untilFree' => $e > 0 ? $e - ($n % $e) - 1 : null]); }
if ($route === 'POST orders/:id/pay') {
    $limit(10, 'pay'); $o = $one('SELECT * FROM kk_orders WHERE id = ?', [(int)$P[1]]); if (!$o || $last9($o['phone']) !== $last9($body['phone'] ?? '')) json_error('We could not find that order and phone number', 404);
    if ($o['payment'] !== 'mpesa_now' || (int)$o['paid'] || $o['status'] !== 'new') json_error('This order does not need a payment');
    try { $cid = kk_stk($pdo, $o['phone'], (int)$o['total'], 'AzizoK-' . $o['id']); $run('UPDATE kk_orders SET mpesa_checkout = ? WHERE id = ?', [$cid, $o['id']]); json_response(['ok' => true]); } catch (Throwable $e) { json_error($e->getMessage(), 502); }
}
if ($route === 'POST orders/:id/pay-rider') {
    $limit(10, 'payr'); $o = $one('SELECT * FROM kk_orders WHERE id = ?', [(int)$P[1]]); if (!$o || $last9($o['phone']) !== $last9($body['phone'] ?? '')) json_error('We could not find that order and phone number', 404);
    if ($o['payment'] !== 'mpesa_now' || (int)$o['paid']) json_error('Nothing to change'); $run("UPDATE kk_orders SET payment = 'mpesa' WHERE id = ?", [$o['id']]); json_response(['ok' => true]);
}
if ($route === 'GET orders/track') {
    $limit(60, 'trk'); $o = $one('SELECT * FROM kk_orders WHERE id = ?', [(int)($_GET['id'] ?? 0)]);
    if (!$o || $last9($o['phone']) !== $last9($_GET['phone'] ?? '')) json_error('We could not find that order and phone number', 404);
    $k = $one('SELECT name FROM kk_kitchens WHERE id = ?', [$o['kitchen_id']]);
    json_response(['id' => (int)$o['id'], 'status' => $o['status'], 'kitchen' => $k['name'] ?? '', 'date' => $o['date'], 'meal' => $o['meal'], 'window' => isset($S[$o['meal']]) ? $S[$o['meal']]['from'] . '-' . $S[$o['meal']]['to'] : '', 'total' => (int)$o['total'], 'fee' => (int)$o['delivery_fee'], 'payment' => $o['payment'], 'rating' => (int)$o['rating'], 'reason' => $o['reason'], 'paid' => (bool)$o['paid'], 'discount' => (int)$o['discount'], 'promo' => $o['promo_code'], 'code' => in_array($o['status'], ['delivered', 'cancelled', 'rejected'], true) ? '' : $o['delivery_code'], 'rider' => $o['rider_id'] ? (($one('SELECT name FROM kk_riders WHERE id = ?', [$o['rider_id']]))['name'] ?? '') : '', 'items' => $itemsOf($o['id'])]);
}
if ($route === 'POST orders/:id/rate') {
    $limit(20, 'rate'); $o = $one('SELECT * FROM kk_orders WHERE id = ?', [(int)$P[1]]);
    if (!$o || $last9($o['phone']) !== $last9($body['phone'] ?? '')) json_error('We could not find that order and phone number', 404);
    if ($o['status'] !== 'delivered') json_error('You can rate an order once it is delivered'); if ((int)$o['rating']) json_error('This order is already rated. Thank you!', 409);
    $r = (int)($body['rating'] ?? 0); if ($r < 1 || $r > 5) json_error('Choose 1 to 5 stars');
    $run('UPDATE kk_orders SET rating = ?, review = ?, updated_at = ? WHERE id = ?', [$r, $clean($body['comment'] ?? '', 500), $now(), $o['id']]); json_response(['ok' => true]);
}
if ($route === 'POST apply') {
    $limit(6, 'app'); $b = $body; if (!empty($b['website'])) json_response(['ok' => true], 201);
    $name = $clean($b['name'] ?? '', 80); $cook = $clean($b['cookName'] ?? '', 80); $phone = $clean($b['phone'] ?? '', 20); $email = strtolower($clean($b['email'] ?? '', 100)); $pass = (string)($b['password'] ?? '');
    if (mb_strlen($name) < 3) json_error('Give your kitchen a name (at least 3 letters)'); if (mb_strlen($cook) < 2) json_error("Enter the cook's name");
    if (strlen($last9($phone)) < 9) json_error('Enter a valid phone number'); if (!filter_var($email, FILTER_VALIDATE_EMAIL)) json_error('Enter a valid email address'); if (strlen($pass) < 6) json_error('Password must be at least 6 characters');
    if ($one("SELECT 1 FROM kk_kitchens WHERE email = ? OR RIGHT(REPLACE(phone, ' ', ''), 9) = ?", [$email, $last9($phone)])) json_error('A kitchen with this email or phone is already registered. Please log in', 409);
    $p = $point($b); if (!$p) json_error('Choose your area and drop your kitchen pin (or share your location)');
    $area = !empty($b['areaId']) ? $one('SELECT region, name FROM areas WHERE id = ?', [(string)$b['areaId']]) : null; $region = $area ? $area['region'] : $clean($b['region'] ?? '', 60);
    if ($clean($b['address'] ?? '', 200) === '') json_error('Enter the kitchen address or landmark'); if (empty($b['agree'])) json_error('Please accept the partner terms');
    $slug = $slugify($name); $n = 1; while ($one('SELECT 1 FROM kk_kitchens WHERE slug = ?', [$slug])) $slug = $slugify($name) . '-' . (++$n);
    $cap = (int)($S['zoneCaps'][$region] ?? $S['zoneCap']); $status = $val("SELECT COUNT(*) FROM kk_kitchens WHERE region = ? AND status IN ('pilot','live')", [$region]) >= $cap ? 'queued' : 'applied';
    $run('INSERT INTO kk_kitchens (slug, name, cook_name, phone, email, password_hash, bio, specialities, experience, address, area_id, region, lat, lng, radius_km, capacity, status, vetting, docs, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [$slug, $name, $cook, $phone, $email, password_hash($pass, PASSWORD_BCRYPT), $clean($b['bio'] ?? '', 600), $clean($b['specialities'] ?? '', 200), $clean($b['experience'] ?? '', 300), $clean($b['address'] ?? '', 200), (string)($b['areaId'] ?? ''), $region, $p['lat'], $p['lng'], $S['defaultRadiusKm'], $int($b['capacity'] ?? 10, 10, 1, 60), $status, '{}', '[]', $now(), $now()]);
    $k = $one('SELECT * FROM kk_kitchens WHERE id = ?', [(int)$pdo->lastInsertId()]);
    $dd = $addDocs($k, $b); if (isset($dd['error'])) { $run('DELETE FROM kk_kitchens WHERE id = ?', [$k['id']]); json_error($dd['error']); }
    $run('UPDATE kk_kitchens SET docs = ? WHERE id = ?', [json_encode($dd['docs']), $k['id']]);
    json_response(['ok' => true, 'status' => $status, 'queuePosition' => $queuePos(['status' => $status] + $k), 'token' => jwt_sign(['role' => 'kitchen', 'kitchenId' => (int)$k['id']], 14 * 86400),
        'message' => $status === 'queued' ? 'Thank you! Your area is full right now, so you are on the waiting list. We will contact you when a place opens.' : 'Thank you! Your application is in. We will contact you to arrange a tasting and kitchen visit.'], 201);
}

// ================= PARTNER =================
if ($route === 'POST partner/login') {
    $limit(30, 'plog'); $id = strtolower($clean($body['login'] ?? '', 100));
    $k = $one("SELECT * FROM kk_kitchens WHERE email = ? OR RIGHT(REPLACE(phone, ' ', ''), 9) = ?", [$id, $last9($id)]);
    if (!$k || !password_verify((string)($body['password'] ?? ''), (string)$k['password_hash'])) json_error('Incorrect email/phone or password', 401);
    if (in_array($k['status'], ['delisted', 'rejected'], true)) json_error('This kitchen account is not active. Please contact Azizo.', 403);
    json_response(['token' => jwt_sign(['role' => 'kitchen', 'kitchenId' => (int)$k['id']], 14 * 86400)]);
}
$partnerOrders = fn($kid, $where) => array_map(fn($o) => ['id' => (int)$o['id'], 'status' => $o['status'], 'customer' => $o['name'], 'phone' => $o['phone'], 'address' => $o['address'], 'date' => $o['date'], 'meal' => $o['meal'], 'notes' => $o['notes'], 'subtotal' => (int)$o['subtotal'], 'fee' => (int)$o['delivery_fee'], 'total' => (int)$o['total'], 'payment' => $o['payment'], 'earn' => (int)$o['kitchen_amt'], 'commission' => (int)$o['commission_amt'], 'rating' => (int)$o['rating'], 'review' => $o['review'], 'created' => $o['created_at'], 'reason' => $o['reason'], 'items' => $itemsOf($o['id'])],
    $all("SELECT * FROM kk_orders WHERE kitchen_id = ? AND NOT (payment = 'mpesa_now' AND paid = 0) $where ORDER BY id DESC LIMIT 200", [$kid]));
if ($P && $P[0] === 'partner') {
    $auth = require_kitchen(); $kid = (int)$auth['kitchenId'];
    if ($route === 'GET partner/me') {
        $k = $one('SELECT * FROM kk_kitchens WHERE id = ?', [$kid]); if (!$k) json_error('Kitchen not found', 404); $r = $rating($kid);
        json_response(['kitchen' => ['id' => (int)$k['id'], 'name' => $k['name'], 'cook' => $k['cook_name'], 'phone' => $k['phone'], 'email' => $k['email'], 'bio' => $k['bio'], 'specialities' => $k['specialities'], 'address' => $k['address'], 'region' => $k['region'], 'radiusKm' => (float)$k['radius_km'], 'capacity' => (int)$k['capacity'], 'prepMin' => (int)$k['prep_min'], 'status' => $k['status'], 'paused' => (bool)$k['paused'], 'strikes' => (int)$k['strikes'], 'queuePosition' => $queuePos($k), 'rating' => $r['avg'], 'ratingCount' => $r['count'], 'commissionPct' => $k['commission_pct'] === null ? (float)$S['commissionPct'] : (float)$k['commission_pct'],
            'docs' => array_map(fn($d) => ['type' => $d['type'], 'no' => $d['no'] ?? '', 'expiry' => $d['expiry'] ?? '', 'hasFile' => !empty($d['file'])], $jp($k['docs'], []))],
            'dishes' => array_map(fn($d) => $dishFull($d) + ['available' => (bool)$d['available']], $all('SELECT d.*, kd.available FROM kk_kitchen_dishes kd JOIN kk_dishes d ON d.id = kd.dish_id WHERE kd.kitchen_id = ? AND d.active = 1 ORDER BY d.sort_order', [$kid])),
            'allDishes' => $all('SELECT id, name, tradition, category, price FROM kk_dishes WHERE active = 1 ORDER BY sort_order'), 'settings' => ['lunch' => $S['lunch'], 'dinner' => $S['dinner'], 'holdMinutes' => $S['holdMinutes']], 'statement' => $statement($kid)]);
    }
    if ($route === 'PATCH partner/me') {
        $k = $one('SELECT * FROM kk_kitchens WHERE id = ?', [$kid]); $b = $body;
        $run('UPDATE kk_kitchens SET bio = ?, phone = ?, capacity = ?, prep_min = ?, paused = ?, specialities = ?, updated_at = ? WHERE id = ?', [
            array_key_exists('bio', $b) ? $clean($b['bio'], 600) : $k['bio'], array_key_exists('phone', $b) ? $clean($b['phone'], 20) : $k['phone'], array_key_exists('capacity', $b) ? $int($b['capacity'], $k['capacity'], 1, 60) : $k['capacity'],
            array_key_exists('prepMin', $b) ? $int($b['prepMin'], $k['prep_min'], 10, 180) : $k['prep_min'], array_key_exists('paused', $b) ? ($b['paused'] ? 1 : 0) : $k['paused'], array_key_exists('specialities', $b) ? $clean($b['specialities'], 200) : $k['specialities'], $now(), $kid]);
        json_response(['ok' => true]);
    }
    if ($route === 'POST partner/password') {
        $k = $one('SELECT * FROM kk_kitchens WHERE id = ?', [$kid]); if (!password_verify((string)($body['current'] ?? ''), (string)$k['password_hash'])) json_error('Current password is incorrect', 401);
        if (strlen((string)($body['next'] ?? '')) < 6) json_error('New password must be at least 6 characters');
        $run('UPDATE kk_kitchens SET password_hash = ? WHERE id = ?', [password_hash((string)$body['next'], PASSWORD_BCRYPT), $kid]); json_response(['ok' => true]);
    }
    if ($route === 'POST partner/documents') {
        $k = $one('SELECT * FROM kk_kitchens WHERE id = ?', [$kid]); $dd = $addDocs($k, $body); if (isset($dd['error'])) json_error($dd['error']);
        $run('UPDATE kk_kitchens SET docs = ?, updated_at = ? WHERE id = ?', [json_encode($dd['docs']), $now(), $kid]); json_response(['ok' => true]);
    }
    if ($route === 'POST partner/dishes/:id/available') {
        $q = $run('UPDATE kk_kitchen_dishes SET available = ? WHERE kitchen_id = ? AND dish_id = ?', [!empty($body['available']) ? 1 : 0, $kid, (int)$P[2]]);
        $has = $one('SELECT 1 FROM kk_kitchen_dishes WHERE kitchen_id = ? AND dish_id = ?', [$kid, (int)$P[2]]); if (!$has) json_error('You are not approved for this dish yet', 404); json_response(['ok' => true]);
    }
    if ($route === 'GET partner/orders') {
        kk_expire_unpaid();
        if (($_GET['scope'] ?? '') === 'history') json_response(['orders' => $partnerOrders($kid, "AND status IN ('delivered','cancelled','rejected')")]);
        json_response(['orders' => $partnerOrders($kid, "AND status NOT IN ('delivered','cancelled','rejected')"), 'today' => $nowEAT()['date']]);
    }
    if ($route === 'PATCH partner/orders/:id/status') {
        $o = $one('SELECT * FROM kk_orders WHERE id = ? AND kitchen_id = ?', [(int)$P[2], $kid]); if (!$o) json_error('Order not found', 404);
        $to = (string)($body['status'] ?? ''); $allowed = ['new' => ['accepted', 'rejected'], 'accepted' => ['preparing', 'ready', 'rejected'], 'preparing' => ['ready', 'rejected']];
        if (!in_array($to, $allowed[$o['status']] ?? [], true)) json_error('An order that is "' . $o['status'] . '" cannot be marked "' . $to . '"');
        if ($to === 'rejected' && $clean($body['reason'] ?? '', 200) === '') json_error('Please give a short reason');
        $run('UPDATE kk_orders SET status = ?, reason = ?, updated_at = ?, ready_at = ?, accepted_at = ? WHERE id = ?', [$to, $to === 'rejected' ? $clean($body['reason'], 200) : $o['reason'], $now(), $to === 'ready' ? $now() : $o['ready_at'], $to === 'accepted' ? $now() : $o['accepted_at'], $o['id']]);
        $moved = null;
        if ($to === 'rejected') { if (!empty($S['autoReassign'])) { $c = kk_candidates(kk_last_order((int)$o['id']))[0] ?? null; if ($c) { kk_reassign(kk_last_order((int)$o['id']), $c['kitchen']); $moved = $c['kitchen']['name']; } } if (!$moved) kk_queue($pdo, 'rejected', kk_last_order((int)$o['id'])); }
        elseif ($to === 'accepted' || $to === 'ready') kk_queue($pdo, $to, kk_last_order((int)$o['id']));
        json_response(['ok' => true, 'reassignedTo' => $moved]);
    }
    if ($route === 'GET partner/insights') json_response(['scorecard' => kk_scorecard($kid), 'docAlerts' => kk_doc_alerts($kid)]);
    if ($route === 'GET partner/supply') {
        json_response(['products' => $all('SELECT id, name, price, unit, cat FROM products WHERE in_stock = 1 ORDER BY cat, name LIMIT 300'),
            'requests' => array_map(fn($r) => ['id' => (int)$r['id'], 'items' => $jp($r['items'], []), 'note' => $r['note'], 'total' => (int)$r['total'], 'status' => $r['status'], 'created' => $r['created_at']], $all('SELECT * FROM kk_supply WHERE kitchen_id = ? ORDER BY id DESC LIMIT 30', [$kid]))]);
    }
    if ($route === 'POST partner/supply') {
        $items = []; $total = 0;
        foreach (array_slice(is_array($body['items'] ?? null) ? $body['items'] : [], 0, 20) as $it) { $pr = $one('SELECT id, name, price, unit FROM products WHERE id = ?', [(string)($it['productId'] ?? '')]); $q = round((float)($it['qty'] ?? 0) * 10) / 10; if (!$pr || !($q > 0 && $q <= 200)) continue; $items[] = ['name' => $pr['name'], 'qty' => $q, 'unit' => $pr['unit'], 'price' => (int)$pr['price']]; $total += (int)round($pr['price'] * $q); }
        if (!$items) json_error('Choose at least one item and a quantity');
        $run('INSERT INTO kk_supply (kitchen_id, items, note, total, created_at, updated_at) VALUES (?,?,?,?,?,?)', [$kid, json_encode($items), $clean($body['note'] ?? '', 200), $total, $now(), $now()]); json_response(['ok' => true, 'estimate' => $total], 201);
    }
    if ($route === 'GET partner/statement') json_response($statement($kid));
    json_error('Not found', 404);
}

// ================= RIDER =================
if ($route === 'POST rider/login') {
    $limit(30, 'rlog'); $r = $one("SELECT * FROM kk_riders WHERE RIGHT(REPLACE(phone, ' ', ''), 9) = ? AND active = 1", [$last9($body['phone'] ?? '')]);
    if (!$r || !password_verify((string)($body['pin'] ?? ''), (string)$r['pin_hash'])) json_error('Incorrect phone or PIN', 401);
    json_response(['token' => jwt_sign(['role' => 'krider', 'riderId' => (int)$r['id']], 14 * 86400), 'name' => $r['name']]);
}
if ($P && $P[0] === 'rider') {
    $auth = require_auth(); if (($auth['role'] ?? '') !== 'krider' || empty($auth['riderId'])) json_error('Rider access required', 403); $rid = (int)$auth['riderId'];
    $riderOrder = function ($o) use ($one, $all) { $k = $one('SELECT name, address, phone, lat, lng FROM kk_kitchens WHERE id = ?', [$o['kitchen_id']]) ?: [];
        return ['id' => (int)$o['id'], 'status' => $o['status'], 'date' => $o['date'], 'meal' => $o['meal'], 'mine' => (bool)$o['rider_id'], 'kitchen' => $k['name'] ?? '', 'kitchenAddress' => $k['address'] ?? '', 'kitchenPhone' => $k['phone'] ?? '', 'kitchenLat' => $k['lat'] ?? null, 'kitchenLng' => $k['lng'] ?? null,
            'customer' => $o['name'], 'phone' => $o['phone'], 'address' => $o['address'], 'lat' => $o['lat'], 'lng' => $o['lng'], 'notes' => $o['notes'], 'items' => array_map(fn($i) => $i['qty'] . ' x ' . $i['name'], $all('SELECT name, qty FROM kk_order_items WHERE order_id = ?', [$o['id']])),
            'total' => (int)$o['total'], 'payment' => $o['payment'], 'collect' => ((int)$o['paid'] || $o['payment'] === 'invoice') ? 0 : (int)$o['total']]; };
    if ($route === 'GET rider/orders') {
        kk_expire_unpaid(); $rows = $all("SELECT * FROM kk_orders WHERE (rider_id = ? AND status IN ('ready','out_for_delivery')) OR (status = 'ready' AND rider_id IS NULL) OR (status IN ('accepted','preparing') AND date = ?) ORDER BY date, meal, id", [$rid, $nowEAT()['date']]);
        json_response(['orders' => array_values(array_map($riderOrder, array_filter($rows, fn($o) => !($o['payment'] === 'mpesa_now' && !(int)$o['paid']))))]);
    }
    $o = isset($P[2]) ? kk_last_order((int)$P[2]) : null;
    if ($route === 'POST rider/orders/:id/pickup') {
        if (!$o || $o['status'] !== 'ready' || ($o['rider_id'] && (int)$o['rider_id'] !== $rid)) json_error('This order is not available to pick up');
        $run("UPDATE kk_orders SET rider_id = ?, status = 'out_for_delivery', picked_at = ?, updated_at = ? WHERE id = ?", [$rid, $now(), $now(), $o['id']]);
        kk_queue($pdo, 'out_for_delivery', kk_last_order((int)$o['id']), ['rider' => ($one('SELECT name FROM kk_riders WHERE id = ?', [$rid]))['name'] ?? '']); json_response(['ok' => true]);
    }
    if ($route === 'POST rider/orders/:id/deliver') {
        if (!$o || $o['status'] !== 'out_for_delivery' || (int)$o['rider_id'] !== $rid) json_error('This order is not on your delivery list');
        if (trim((string)($body['code'] ?? '')) !== (string)$o['delivery_code']) json_error('Wrong code. Ask the customer for the 4-digit code from their order message.');
        $run("UPDATE kk_orders SET status = 'delivered', delivered_at = ?, paid = CASE WHEN payment IN ('cash','mpesa','mpesa_now') THEN 1 ELSE paid END, updated_at = ? WHERE id = ?", [$now(), $now(), $o['id']]); kk_queue($pdo, 'delivered', kk_last_order((int)$o['id'])); json_response(['ok' => true]);
    }
    if ($route === 'POST rider/orders/:id/release') {
        if (!$o || $o['status'] !== 'out_for_delivery' || (int)$o['rider_id'] !== $rid) json_error('This order is not on your delivery list');
        $run("UPDATE kk_orders SET status = 'ready', rider_id = NULL, picked_at = NULL, notes = SUBSTRING(CONCAT(notes, ' | Rider released: ', ?), 1, 300), updated_at = ? WHERE id = ?", [$clean($body['reason'] ?? '', 100) ?: 'no reason given', $now(), $o['id']]); json_response(['ok' => true]);
    }
    json_error('Not found', 404);
}

// ================= ADMIN =================
if ($route === 'POST admin-login') {
    $limit(30, 'alog'); $pw = (string)($body['password'] ?? '');
    $roles = array_values(array_filter([[KITCHENS_ADMIN_PASSWORD, 'full'], [KITCHENS_DISPATCH_PASSWORD, 'dispatch'], [KITCHENS_ACCOUNTS_PASSWORD, 'accounts']], fn($r) => $r[0] !== ''));
    if (!$roles) json_error('Kitchens Admin is not set up yet: set KITCHENS_ADMIN_PASSWORD in config.php', 503);
    foreach ($roles as $r) if (hash_equals($r[0], $pw)) json_response(['token' => jwt_sign(['role' => 'kitchens', 'sub' => $r[1]], 12 * 3600), 'role' => $r[1]]);
    json_error('Incorrect Kitchens Admin password', 401);
}
if (!$P || $P[0] !== 'admin') json_error('Not found', 404);
$authA = require_kitchens_admin(); $SUB = ($authA['role'] ?? '') === 'admin' ? 'full' : ($authA['sub'] ?? 'full');
$PERM = ['dispatch' => ['#^GET (overview|orders|riders|supply|alerts|outbox|dashboard|dishes|settings)#', '#^GET kitchens(/\d+)?$#', '#^(POST|PATCH|PUT) (orders|riders|supply|outbox)#'],
    'accounts' => ['#^GET (overview|orders|payouts|economics|dashboard|supply|export|settings|dishes|alerts)#', '#^GET kitchens(/\d+)?$#', '#^POST payouts#']];
$sub2 = implode('/', array_slice($P, 1)); $permKey = $method . ' ' . preg_replace('#/(\d+)#', '/$1', $sub2);
if ($SUB !== 'full') { $okp = false; foreach ($PERM[$SUB] ?? [] as $rx) if (preg_match($rx, $permKey)) { $okp = true; break; } if (!$okp) json_error('Your login does not have access to this section', 403); }
if ($method !== 'GET') register_shutdown_function(function () use ($pdo, $SUB, $method, $sub2, $body) { if (http_response_code() < 400) { try { $b = $body; foreach (['data', 'password', 'pin', 'docImages'] as $k) unset($b[$k]); $pdo->prepare('INSERT INTO kk_audit (actor, action, target, detail) VALUES (?,?,?,?)')->execute([$SUB, $method . ' /' . $sub2, '/' . $sub2, mb_substr(json_encode($b), 0, 400)]); } catch (Throwable $e) { } } });
$kAdmin = function ($k, $hide = false) use ($rating, $statement, $S, $jp, $one, $all, $queuePos, $val) {
    $r = $rating($k['id']); $st = $statement($k['id']);
    return ['id' => (int)$k['id'], 'slug' => $k['slug'], 'name' => $k['name'], 'cook' => $k['cook_name'], 'phone' => $k['phone'], 'email' => $k['email'], 'bio' => $k['bio'], 'specialities' => $k['specialities'], 'experience' => $k['experience'], 'address' => $k['address'], 'areaId' => $k['area_id'], 'region' => $k['region'], 'lat' => $k['lat'] === null ? null : (float)$k['lat'], 'lng' => $k['lng'] === null ? null : (float)$k['lng'], 'radiusKm' => (float)$k['radius_km'],
        'capacity' => (int)$k['capacity'], 'prepMin' => (int)$k['prep_min'], 'status' => $k['status'], 'paused' => (bool)$k['paused'], 'commissionPct' => $k['commission_pct'] === null ? null : (float)$k['commission_pct'], 'effectiveCommission' => $k['commission_pct'] === null ? (float)$S['commissionPct'] : (float)$k['commission_pct'],
        'vetting' => (object)$jp($k['vetting'], []), 'notes' => $k['notes'], 'strikes' => (int)$k['strikes'], 'docs' => $hide ? [] : $jp($k['docs'], []), 'rating' => $r['avg'], 'ratingCount' => $r['count'], 'orders' => $val('SELECT COUNT(*) FROM kk_orders WHERE kitchen_id = ?', [$k['id']]),
        'balance' => $st['balance'], 'earned' => $st['earned'], 'paid' => $st['paid'], 'queuePosition' => $queuePos($k), 'approvedDishes' => array_map('intval', array_column($all('SELECT dish_id FROM kk_kitchen_dishes WHERE kitchen_id = ?', [$k['id']]), 'dish_id')), 'created' => $k['created_at'], 'approvedAt' => $k['approved_at']];
};
if ($route === 'GET admin/overview') {
    $by = []; foreach ($all('SELECT status, COUNT(*) AS n FROM kk_kitchens GROUP BY status') as $r) $by[$r['status']] = (int)$r['n'];
    $regions = $all("SELECT region, SUM(CASE WHEN status IN ('pilot','live') THEN 1 ELSE 0 END) AS live, SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued, COUNT(*) AS total FROM kk_kitchens WHERE region != '' GROUP BY region ORDER BY region");
    $n = $nowEAT(); $today = $one("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS gmv, COALESCE(SUM(commission_amt),0) AS comm FROM kk_orders WHERE date = ? AND status NOT IN ('cancelled','rejected')", [$n['date']]);
    json_response(['byStatus' => (object)$by, 'regions' => array_map(fn($r) => ['region' => $r['region'], 'live' => (int)$r['live'], 'queued' => (int)$r['queued'], 'total' => (int)$r['total'], 'cap' => (int)($S['zoneCaps'][$r['region']] ?? $S['zoneCap'])], $regions),
        'today' => ['n' => (int)$today['n'], 'gmv' => (int)$today['gmv'], 'comm' => (int)$today['comm']], 'newApplications' => $by['applied'] ?? 0, 'openOrders' => $val("SELECT COUNT(*) FROM kk_orders WHERE status NOT IN ('delivered','cancelled','rejected')"), 'date' => $n['date']]);
}
if ($route === 'GET admin/kitchens') {
    $rows = !empty($_GET['status']) ? $all('SELECT * FROM kk_kitchens WHERE status = ? ORDER BY id', [$_GET['status']]) : $all('SELECT * FROM kk_kitchens ORDER BY id DESC');
    json_response(['kitchens' => array_map(fn($k) => $kAdmin($k, $SUB !== 'full'), $rows)]);
}
if ($route === 'GET admin/kitchens/:id') { $k = $one('SELECT * FROM kk_kitchens WHERE id = ?', [(int)$P[2]]); if (!$k) json_error('Not found', 404); json_response($kAdmin($k, $SUB !== 'full')); }
if ($route === 'PATCH admin/kitchens/:id') {
    $k = $one('SELECT * FROM kk_kitchens WHERE id = ?', [(int)$P[2]]); if (!$k) json_error('Not found', 404); $b = $body;
    $v = array_key_exists('vetting', $b) ? (array)$b['vetting'] : $jp($k['vetting'], []); $status = array_key_exists('status', $b) ? (string)$b['status'] : $k['status'];
    if (!in_array($status, ['applied', 'queued', 'vetting', 'pilot', 'live', 'paused', 'delisted', 'rejected'], true)) json_error('Unknown status');
    if (in_array($status, ['pilot', 'live'], true) && !in_array($k['status'], ['pilot', 'live'], true)) {
        $keys = ['taste', 'consistency', 'hygiene', 'premises', 'documents', 'reliability', 'attitude']; $vals = array_map(fn($x) => (float)($v[$x] ?? 0), $keys);
        $complete = count(array_filter($vals, fn($x) => $x >= 1 && $x <= 5)) === 7; $avg = $complete ? array_sum($vals) / 7 : 0;
        $fails = !$complete ? 'Complete all seven vetting scores first' : ($avg < 4 ? sprintf('Vetting average is %.1f; 4.0 is required', $avg) : ((float)$v['hygiene'] <= 1 || (float)$v['documents'] <= 1 ? 'Hygiene and documents cannot score 1' : ''));
        $override = !empty($b['override']);
        if ($fails && !($override && $clean(array_key_exists('notes', $b) ? $b['notes'] : $k['notes'], 400) !== '')) json_error($fails . '. To override, tick override and add a note.', 409);
        $cap = (int)($S['zoneCaps'][$k['region']] ?? $S['zoneCap']); $liveN = $val("SELECT COUNT(*) FROM kk_kitchens WHERE region = ? AND status IN ('pilot','live') AND id != ?", [$k['region'], $k['id']]);
        if ($liveN >= $cap && !$override) json_error($k['region'] . " already has $liveN of $cap kitchens. Raise the zone cap or tick override.", 409);
        if (!$one('SELECT 1 FROM kk_kitchen_dishes WHERE kitchen_id = ?', [$k['id']]) && !is_array($b['approvedDishes'] ?? null)) json_error('Approve at least one dish (after the tasting) before going live', 409);
    }
    $pdo->beginTransaction();
    try {
        $comm = array_key_exists('commissionPct', $b) ? (($b['commissionPct'] === null || $b['commissionPct'] === '') ? null : $num($b['commissionPct'], 20, 0, 60)) : $k['commission_pct'];
        $approvedAt = (in_array($status, ['pilot', 'live'], true) && !$k['approved_at']) ? $now() : $k['approved_at'];
        $run('UPDATE kk_kitchens SET name = ?, status = ?, radius_km = ?, capacity = ?, prep_min = ?, commission_pct = ?, vetting = ?, notes = ?, strikes = ?, lat = ?, lng = ?, bio = ?, region = ?, approved_at = ?, updated_at = ? WHERE id = ?', [
            array_key_exists('name', $b) ? $clean($b['name'], 80) : $k['name'], $status, array_key_exists('radiusKm', $b) ? $num($b['radiusKm'], $k['radius_km'], 0.5, 30) : $k['radius_km'], array_key_exists('capacity', $b) ? $int($b['capacity'], $k['capacity'], 1, 60) : $k['capacity'],
            array_key_exists('prepMin', $b) ? $int($b['prepMin'], $k['prep_min'], 10, 180) : $k['prep_min'], $comm, json_encode((object)$v), array_key_exists('notes', $b) ? $clean($b['notes'], 1000) : $k['notes'], array_key_exists('strikes', $b) ? $int($b['strikes'], 0, 0, 9) : $k['strikes'],
            array_key_exists('lat', $b) ? (float)$b['lat'] : $k['lat'], array_key_exists('lng', $b) ? (float)$b['lng'] : $k['lng'], array_key_exists('bio', $b) ? $clean($b['bio'], 600) : $k['bio'], array_key_exists('region', $b) ? $clean($b['region'], 60) : $k['region'], $approvedAt, $now(), $k['id']]);
        if (is_array($b['approvedDishes'] ?? null)) {
            $ids = array_values(array_filter(array_map('intval', $b['approvedDishes'])));
            if ($ids) $run('DELETE FROM kk_kitchen_dishes WHERE kitchen_id = ? AND dish_id NOT IN (' . implode(',', array_fill(0, count($ids), '?')) . ')', array_merge([$k['id']], $ids)); else $run('DELETE FROM kk_kitchen_dishes WHERE kitchen_id = ?', [$k['id']]);
            foreach ($ids as $id) $run('INSERT IGNORE INTO kk_kitchen_dishes (kitchen_id, dish_id, available) VALUES (?, ?, 1)', [$k['id'], $id]);
        }
        $pdo->commit();
    } catch (Throwable $e) { $pdo->rollBack(); json_error('Could not save changes', 500); }
    json_response(['ok' => true]);
}
if ($route === 'DELETE admin/kitchens/:id') {
    if ($val('SELECT COUNT(*) FROM kk_orders WHERE kitchen_id = ?', [(int)$P[2]])) json_error('This kitchen has orders. Delist it instead of deleting.', 409);
    $run('DELETE FROM kk_kitchen_dishes WHERE kitchen_id = ?', [(int)$P[2]]); $run('DELETE FROM kk_kitchens WHERE id = ?', [(int)$P[2]]); json_response(['ok' => true]);
}
if ($route === 'GET admin/kitchens/:id/docs/' . ($P[4] ?? '')) {
    $f = basename((string)$P[4]); $k = $one('SELECT docs FROM kk_kitchens WHERE id = ?', [(int)$P[2]]); $found = false;
    if ($k) foreach ($jp($k['docs'], []) as $d) if (($d['file'] ?? '') === $f) $found = true;
    $path = $PRIVATE . '/' . $f; if (!$found || !is_file($path)) json_error('Not found', 404);
    $ext = pathinfo($f, PATHINFO_EXTENSION); header('Content-Type: image/' . ($ext === 'jpg' ? 'jpeg' : $ext)); readfile($path); exit;
}
if ($route === 'PATCH admin/kitchens/:id/docs') {
    $k = $one('SELECT docs FROM kk_kitchens WHERE id = ?', [(int)$P[2]]); if (!$k) json_error('Not found', 404); $docs = $jp($k['docs'], []); $i = (int)($body['index'] ?? -1);
    if (!isset($docs[$i])) json_error('Document not found', 404); $docs[$i]['verified'] = !empty($body['verified']); $docs[$i]['verifiedOn'] = !empty($body['verified']) ? $nowEAT()['date'] : '';
    if (array_key_exists('note', $body)) $docs[$i]['note'] = $clean($body['note'], 200);
    $run('UPDATE kk_kitchens SET docs = ? WHERE id = ?', [json_encode($docs), (int)$P[2]]); json_response(['ok' => true]);
}
// dishes
$dishInput = function ($b, $e = null) use ($clean, $lines, $jp, $int) {
    $e = $e ?: []; $pick = fn($k, $max, $d) => array_key_exists($k, $b) ? $clean($b[$k], $max) : ($e[$k] ?? $d);
    $arr = function ($k) use ($b, $e, $clean) { if (!array_key_exists($k, $b)) return $e[$k] ?? ''; $v = is_array($b[$k]) ? $b[$k] : preg_split('/\r?\n/', (string)$b[$k]); return implode("\n", array_values(array_filter(array_map(fn($x) => $clean($x, 300), $v), fn($x) => $x !== ''))); };
    $options = $e['options'] ?? '[]';
    if (array_key_exists('options', $b)) { $o = is_array($b['options']) ? $b['options'] : json_decode((string)$b['options'], true); if (!is_array($o)) return ['error' => 'Options must be a list'];
        $options = json_encode(array_values(array_filter(array_map(fn($g) => ['name' => $clean($g['name'] ?? '', 40), 'required' => !empty($g['required']), 'choices' => array_values(array_filter(array_map(fn($c) => ['name' => $clean($c['name'] ?? '', 40), 'price' => max(0, (int)($c['price'] ?? 0))], $g['choices'] ?? []), fn($c) => $c['name'] !== ''))], $o), fn($g) => $g['name'] !== '' && $g['choices'])));
    }
    $price = array_key_exists('price', $b) ? (int)$b['price'] : (int)($e['price'] ?? -1); if ($price < 0 || $price > 100000) return ['error' => 'Enter a price'];
    $image = $pick('image', 300, ''); if ($image !== '' && !preg_match('#^(/uploads/|https?://)#i', $image)) return ['error' => 'Image must be an uploaded file or a web address'];
    return ['v' => ['name' => $pick('name', 100, ''), 'tradition' => $pick('tradition', 30, ''), 'category' => $pick('category', 30, 'Combo'), 'meal' => in_array($b['meal'] ?? '', ['lunch', 'dinner', 'both'], true) ? $b['meal'] : ($e['meal'] ?? 'both'), 'price' => $price,
        'serves' => $int($b['serves'] ?? ($e['serves'] ?? 1), 1, 1, 50), 'description' => $pick('description', 400, ''), 'components' => $arr('components'), 'method' => $arr('method'), 'options' => $options, 'packaging' => $pick('packaging', 200, ''), 'tips' => $pick('tips', 300, ''), 'image' => $image, 'tags' => array_key_exists('tags', $b) ? implode(',', array_values(array_filter(array_map(fn($x) => strtolower($clean($x, 20)), is_array($b['tags']) ? $b['tags'] : explode(',', (string)$b['tags'])), fn($x) => in_array($x, KK_TAGS, true)))) : (string)($e['tags'] ?? ''),
        'active' => array_key_exists('active', $b) ? ($b['active'] ? 1 : 0) : (int)($e['active'] ?? 1), 'sort_order' => array_key_exists('sort', $b) ? (int)$b['sort'] : (int)($e['sort_order'] ?? 0)]];
};
if ($route === 'GET admin/dishes') json_response(['dishes' => array_map($dishFull, $all('SELECT * FROM kk_dishes ORDER BY sort_order, id'))]);
if ($route === 'POST admin/dishes') {
    $p = $dishInput($body); if (isset($p['error'])) json_error($p['error']); $v = $p['v']; if ($v['name'] === '') json_error('Give the dish a name');
    $slug = $slugify($v['name']); $n = 1; while ($one('SELECT 1 FROM kk_dishes WHERE slug = ?', [$slug])) $slug = $slugify($v['name']) . '-' . (++$n);
    $run('INSERT INTO kk_dishes (slug, name, tradition, category, meal, price, serves, description, components, method, options, packaging, tips, image, tags, active, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [$slug, $v['name'], $v['tradition'], $v['category'], $v['meal'], $v['price'], $v['serves'], $v['description'], $v['components'], $v['method'], $v['options'], $v['packaging'], $v['tips'], $v['image'], $v['tags'], $v['active'], $v['sort_order'] ?: 999]);
    json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId()], 201);
}
if ($route === 'PUT admin/dishes/:id') {
    $e = $one('SELECT * FROM kk_dishes WHERE id = ?', [(int)$P[2]]); if (!$e) json_error('Not found', 404); $p = $dishInput($body, $e); if (isset($p['error'])) json_error($p['error']); $v = $p['v'];
    $run('UPDATE kk_dishes SET name = ?, tradition = ?, category = ?, meal = ?, price = ?, serves = ?, description = ?, components = ?, method = ?, options = ?, packaging = ?, tips = ?, image = ?, tags = ?, active = ?, sort_order = ? WHERE id = ?', [$v['name'], $v['tradition'], $v['category'], $v['meal'], $v['price'], $v['serves'], $v['description'], $v['components'], $v['method'], $v['options'], $v['packaging'], $v['tips'], $v['image'], $v['tags'], $v['active'], $v['sort_order'], $e['id']]);
    json_response(['ok' => true]);
}
if ($route === 'DELETE admin/dishes/:id') {
    if ($one('SELECT 1 FROM kk_order_items WHERE dish_id = ?', [(int)$P[2]])) json_error('This dish has been ordered. Hide it (untick Active) instead of deleting.', 409);
    $run('DELETE FROM kk_kitchen_dishes WHERE dish_id = ?', [(int)$P[2]]); $run('DELETE FROM kk_dishes WHERE id = ?', [(int)$P[2]]); json_response(['ok' => true]);
}
$IMGDIR = __DIR__ . '/../../uploads/kitchens';
if ($route === 'POST admin/upload') {
    $im = $readImage($body['data'] ?? '', 3 * 1024 * 1024); if (isset($im['error'])) json_error($im['error']); if (!is_dir($IMGDIR)) @mkdir($IMGDIR, 0755, true);
    $file = substr($slugify($body['name'] ?? 'dish'), 0, 30) . '-' . bin2hex(random_bytes(4)) . '.' . $im['ext']; file_put_contents($IMGDIR . '/' . $file, $im['buf']); json_response(['ok' => true, 'url' => '/uploads/kitchens/' . $file], 201);
}
if ($route === 'GET admin/images') { $fs = is_dir($IMGDIR) ? array_values(array_filter(scandir($IMGDIR), fn($x) => preg_match('/\.(jpg|png|webp)$/i', $x))) : []; json_response(['files' => array_map(fn($x) => ['file' => $x, 'url' => '/uploads/kitchens/' . $x], $fs)]); }
// orders
if ($route === 'GET admin/orders') {
    kk_expire_unpaid();
    $w = []; $a = []; if (!empty($_GET['status'])) { $w[] = 'o.status = ?'; $a[] = $_GET['status']; } if (!empty($_GET['kitchen'])) { $w[] = 'o.kitchen_id = ?'; $a[] = (int)$_GET['kitchen']; } if (!empty($_GET['date'])) { $w[] = 'o.date = ?'; $a[] = $_GET['date']; }
    $rows = $all('SELECT o.*, k.name AS kitchen_name FROM kk_orders o LEFT JOIN kk_kitchens k ON k.id = o.kitchen_id ' . ($w ? 'WHERE ' . implode(' AND ', $w) : '') . ' ORDER BY o.id DESC LIMIT 300', $a);
    json_response(['orders' => array_map(fn($o) => ['id' => (int)$o['id'], 'kitchen' => $o['kitchen_name'], 'kitchenId' => (int)$o['kitchen_id'], 'customer' => $o['name'], 'phone' => $o['phone'], 'address' => $o['address'], 'date' => $o['date'], 'meal' => $o['meal'], 'status' => $o['status'], 'subtotal' => (int)$o['subtotal'], 'fee' => (int)$o['delivery_fee'], 'total' => (int)$o['total'], 'payment' => $o['payment'], 'commission' => (int)$o['commission_amt'], 'notes' => $o['notes'], 'reason' => $o['reason'], 'rating' => (int)$o['rating'], 'review' => $o['review'], 'km' => (float)$o['distance_km'], 'created' => $o['created_at'], 'paid' => (bool)$o['paid'], 'discount' => (int)$o['discount'], 'promo' => $o['promo_code'], 'riderId' => $o['rider_id'] ? (int)$o['rider_id'] : null, 'region' => $o['region'], 'reassigned' => (bool)$o['reassigned_from'], 'acceptedAt' => $o['accepted_at'], 'mpesaReceipt' => $o['mpesa_receipt'], 'code' => $o['delivery_code'], 'corp' => $o['corp_id'] ? (int)$o['corp_id'] : null, 'items' => $itemsOf($o['id'])], $rows)]);
}
if ($route === 'PATCH admin/orders/:id') {
    $o = $one('SELECT * FROM kk_orders WHERE id = ?', [(int)$P[2]]); if (!$o) json_error('Not found', 404); $to = (string)($body['status'] ?? '');
    if (!in_array($to, ['out_for_delivery', 'delivered', 'cancelled'], true)) json_error('Use out_for_delivery, delivered or cancelled');
    if ($to === 'out_for_delivery' && $o['status'] !== 'ready') json_error('Only a ready order can go out for delivery');
    if ($to === 'delivered' && !in_array($o['status'], ['ready', 'out_for_delivery'], true)) json_error('Only a ready or out-for-delivery order can be delivered');
    if ($to === 'cancelled' && in_array($o['status'], ['delivered', 'cancelled', 'rejected'], true)) json_error('This order is already closed');
    $run("UPDATE kk_orders SET status = ?, reason = ?, updated_at = ?, picked_at = ?, delivered_at = ?, paid = ? WHERE id = ?", [$to, $to === 'cancelled' ? $clean($body['reason'] ?? '', 200) : $o['reason'], $now(), $to === 'out_for_delivery' ? $now() : $o['picked_at'], $to === 'delivered' ? $now() : $o['delivered_at'], ($to === 'delivered' && in_array($o['payment'], ['cash', 'mpesa'], true)) ? 1 : $o['paid'], $o['id']]);
    $n = kk_last_order((int)$o['id']); $rd = $n['rider_id'] ? $one('SELECT name FROM kk_riders WHERE id = ?', [$n['rider_id']]) : null; kk_queue($pdo, $to, $n, ['rider' => $rd['name'] ?? '']); json_response(['ok' => true]);
}
if ($route === 'GET admin/payouts') json_response(['kitchens' => array_map(fn($k) => ['id' => (int)$k['id'], 'name' => $k['name'], 'phone' => $k['phone']] + $statement($k['id']), $all("SELECT * FROM kk_kitchens WHERE status != 'rejected' ORDER BY name"))]);
if ($route === 'POST admin/payouts') {
    $amt = (int)($body['amount'] ?? 0); $k = $one('SELECT id FROM kk_kitchens WHERE id = ?', [(int)($body['kitchenId'] ?? 0)]); if (!$k) json_error('Kitchen not found', 404); if ($amt <= 0) json_error('Enter the amount paid');
    $run('INSERT INTO kk_payouts (kitchen_id, amount, reference, note, created_at) VALUES (?,?,?,?,?)', [$k['id'], $amt, $clean($body['reference'] ?? '', 60), $clean($body['note'] ?? '', 200), $now()]); json_response(['ok' => true]);
}
if ($route === 'GET admin/settings') json_response($S);
if ($route === 'POST admin/settings') {
    $b = $body; $fl = fn($v, $d, $lo, $hi) => is_numeric($v) ? max($lo, min($hi, (float)$v)) : $d;
    $slot = function ($k) use ($b, $S, $clean) { $s = array_merge($S[$k], is_array($b[$k] ?? null) ? $b[$k] : []); foreach (['from', 'to', 'cutoff'] as $x) if (!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', (string)$s[$x])) return null; return ['label' => $clean($s['label'], 20) ?: $S[$k]['label'], 'from' => $s['from'], 'to' => $s['to'], 'cutoff' => $s['cutoff']]; };
    $lunch = $slot('lunch'); $dinner = $slot('dinner'); if (!$lunch || !$dinner) json_error('Times must look like 12:30');
    $caps = []; foreach ((array)($b['zoneCaps'] ?? $S['zoneCaps']) as $r => $c) if ((int)$c > 0) $caps[$clean($r, 60)] = min(50, (int)$c); $fe = is_array($b['fee'] ?? null) ? $b['fee'] : [];
    $next = ['commissionPct' => $fl($b['commissionPct'] ?? null, $S['commissionPct'], 0, 60), 'lunch' => $lunch, 'dinner' => $dinner, 'fee' => ['base' => $fl($fe['base'] ?? null, $S['fee']['base'], 0, 2000), 'perKm' => $fl($fe['perKm'] ?? null, $S['fee']['perKm'], 0, 200), 'bandKm' => $fl($fe['bandKm'] ?? null, $S['fee']['bandKm'], 0.5, 20), 'max' => $fl($fe['max'] ?? null, $S['fee']['max'], 0, 5000)],
        'defaultRadiusKm' => $fl($b['defaultRadiusKm'] ?? null, $S['defaultRadiusKm'], 0.5, 30), 'roadFactor' => $fl($b['roadFactor'] ?? null, $S['roadFactor'], 1, 2.5), 'zoneCap' => (int)round($fl($b['zoneCap'] ?? null, $S['zoneCap'], 1, 50)), 'zoneCaps' => (object)$caps, 'minOrder' => (int)round($fl($b['minOrder'] ?? null, $S['minOrder'], 0, 20000)), 'holdMinutes' => (int)round($fl($b['holdMinutes'] ?? null, $S['holdMinutes'], 30, 480)), 'deliveryCost' => (int)round($fl($b['deliveryCost'] ?? null, $S['deliveryCost'], 0, 2000)), 'autoReassign' => array_key_exists('autoReassign', $b) ? !empty($b['autoReassign']) : !empty($S['autoReassign']), 'loyaltyEvery' => (int)round($fl($b['loyaltyEvery'] ?? null, $S['loyaltyEvery'], 0, 50))];
    $run('INSERT INTO kk_meta (skey, svalue) VALUES (?, ?) ON DUPLICATE KEY UPDATE svalue = VALUES(svalue)', ['kk_settings', json_encode($next)]); json_response(['ok' => true, 'settings' => $next]);
}
// ---- v3.1 admin extensions ----
$riderOut = fn($r) => ['id' => (int)$r['id'], 'name' => $r['name'], 'phone' => $r['phone'], 'active' => (bool)$r['active'], 'openOrders' => $val("SELECT COUNT(*) FROM kk_orders WHERE rider_id = ? AND status = 'out_for_delivery'", [$r['id']]), 'delivered' => $val("SELECT COUNT(*) FROM kk_orders WHERE rider_id = ? AND status = 'delivered'", [$r['id']])];
$corpOut = fn($c) => ['id' => (int)$c['id'], 'name' => $c['name'], 'code' => $c['code'], 'contact' => $c['contact'], 'phone' => $c['phone'], 'email' => $c['email'], 'address' => $c['address'], 'discountPct' => (float)$c['discount_pct'], 'active' => (bool)$c['active'], 'notes' => $c['notes'],
    'orders' => $val("SELECT COUNT(*) FROM kk_orders WHERE corp_id = ? AND status = 'delivered'", [$c['id']]), 'unpaid' => $val("SELECT COALESCE(SUM(total),0) FROM kk_orders WHERE corp_id = ? AND status = 'delivered' AND paid = 0", [$c['id']])];
if ($route === 'GET admin/kitchens/:id/scorecard') json_response(kk_scorecard((int)$P[2]));
if ($route === 'GET admin/alerts') {
    kk_expire_unpaid();
    $stale = $all("SELECT o.id, o.date, o.meal, o.created_at, k.name AS kitchen FROM kk_orders o JOIN kk_kitchens k ON k.id = o.kitchen_id WHERE o.status = 'new' AND NOT (o.payment = 'mpesa_now' AND o.paid = 0) AND o.created_at < ?", [gmdate('Y-m-d H:i:s', time() - 900)]);
    $waiting = $all("SELECT o.id, o.date, o.meal, o.ready_at, k.name AS kitchen FROM kk_orders o JOIN kk_kitchens k ON k.id = o.kitchen_id WHERE o.status = 'ready' AND o.ready_at < ?", [gmdate('Y-m-d H:i:s', time() - 1800)]);
    $low = []; foreach ($all("SELECT id, name FROM kk_kitchens WHERE $LIVE") as $k) { $sc = kk_scorecard((int)$k['id']); if ($sc['score'] !== null && $sc['score'] < 60) $low[] = ['id' => (int)$k['id'], 'name' => $k['name'], 'score' => $sc['score']]; }
    json_response(['unaccepted' => $stale, 'readyWaiting' => $waiting, 'docs' => kk_doc_alerts(), 'lowScore' => $low, 'outbox' => $val("SELECT COUNT(*) FROM kk_outbox WHERE status = 'pending'"), 'supply' => $val("SELECT COUNT(*) FROM kk_supply WHERE status = 'requested'"), 'applications' => $val("SELECT COUNT(*) FROM kk_kitchens WHERE status = 'applied'")]);
}
if ($route === 'GET admin/orders/:id/candidates') { $o = kk_last_order((int)$P[2]); if (!$o) json_error('Not found', 404); json_response(['candidates' => array_map(fn($c) => ['id' => (int)$c['kitchen']['id'], 'name' => $c['kitchen']['name'], 'km' => $c['km'], 'left' => $c['left']], kk_candidates($o))]); }
if ($route === 'POST admin/orders/:id/reassign') {
    $o = kk_last_order((int)$P[2]); if (!$o) json_error('Not found', 404); if (!in_array($o['status'], ['new', 'accepted', 'preparing', 'rejected'], true)) json_error('Only an order the kitchen has not finished can be moved');
    $hit = null; foreach (kk_candidates($o) as $c) if ((int)$c['kitchen']['id'] === (int)($body['kitchenId'] ?? 0)) $hit = $c; if (!$hit) json_error('That kitchen cannot take this order (distance, dishes or capacity)'); kk_reassign($o, $hit['kitchen']); json_response(['ok' => true]);
}
if ($route === 'GET admin/riders') json_response(['riders' => array_map($riderOut, $all('SELECT * FROM kk_riders ORDER BY name'))]);
if ($route === 'POST admin/riders') {
    $name = $clean($body['name'] ?? '', 60); $phone = $clean($body['phone'] ?? '', 20); $pin = (string)($body['pin'] ?? '');
    if (mb_strlen($name) < 2 || strlen($last9($phone)) < 9) json_error("Enter the rider's name and phone"); if (!preg_match('/^\d{4,6}$/', $pin)) json_error('PIN must be 4 to 6 digits');
    if ($one("SELECT 1 FROM kk_riders WHERE RIGHT(REPLACE(phone, ' ', ''), 9) = ?", [$last9($phone)])) json_error('A rider with this phone already exists', 409);
    $run('INSERT INTO kk_riders (name, phone, pin_hash) VALUES (?,?,?)', [$name, $phone, password_hash($pin, PASSWORD_BCRYPT)]); json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId()], 201);
}
if ($route === 'PATCH admin/riders/:id') {
    $r = $one('SELECT * FROM kk_riders WHERE id = ?', [(int)$P[2]]); if (!$r) json_error('Not found', 404); if (array_key_exists('pin', $body) && !preg_match('/^\d{4,6}$/', (string)$body['pin'])) json_error('PIN must be 4 to 6 digits');
    $run('UPDATE kk_riders SET name = ?, phone = ?, active = ?, pin_hash = ? WHERE id = ?', [array_key_exists('name', $body) ? $clean($body['name'], 60) : $r['name'], array_key_exists('phone', $body) ? $clean($body['phone'], 20) : $r['phone'], array_key_exists('active', $body) ? ($body['active'] ? 1 : 0) : $r['active'], array_key_exists('pin', $body) ? password_hash((string)$body['pin'], PASSWORD_BCRYPT) : $r['pin_hash'], $r['id']]); json_response(['ok' => true]);
}
if ($route === 'POST admin/orders/:id/assign') {
    $o = kk_last_order((int)$P[2]); $r = $one('SELECT id FROM kk_riders WHERE id = ? AND active = 1', [(int)($body['riderId'] ?? 0)]); if (!$o) json_error('Not found', 404); if (!$r) json_error('Choose an active rider');
    if (in_array($o['status'], ['delivered', 'cancelled', 'rejected'], true)) json_error('This order is closed'); $run('UPDATE kk_orders SET rider_id = ?, updated_at = ? WHERE id = ?', [$r['id'], $now(), $o['id']]); json_response(['ok' => true]);
}
if ($route === 'GET admin/supply') {
    $rows = $all('SELECT s.*, k.name AS kitchen, k.phone FROM kk_supply s JOIN kk_kitchens k ON k.id = s.kitchen_id ' . (!empty($_GET['status']) ? 'WHERE s.status = ? ' : '') . 'ORDER BY s.id DESC LIMIT 200', !empty($_GET['status']) ? [$_GET['status']] : []);
    json_response(['requests' => array_map(fn($r) => ['id' => (int)$r['id'], 'kitchen' => $r['kitchen'], 'phone' => $r['phone'], 'items' => $jp($r['items'], []), 'note' => $r['note'], 'total' => (int)$r['total'], 'status' => $r['status'], 'created' => $r['created_at']], $rows)]);
}
if ($route === 'PATCH admin/supply/:id') {
    $r = $one('SELECT * FROM kk_supply WHERE id = ?', [(int)$P[2]]); if (!$r) json_error('Not found', 404); if (!in_array($body['status'] ?? '', ['requested', 'supplied', 'cancelled'], true)) json_error('Unknown status');
    $run('UPDATE kk_supply SET status = ?, total = ?, updated_at = ? WHERE id = ?', [$body['status'], array_key_exists('total', $body) ? $int($body['total'], 0, 0, 1000000) : $r['total'], $now(), $r['id']]); json_response(['ok' => true]);
}
// promos
$promoIn = function ($b, $e = []) use ($int, $clean) {
    $kind = in_array($b['kind'] ?? '', ['pct', 'flat', 'freedelivery'], true) ? $b['kind'] : ($e['kind'] ?? 'pct'); $value = array_key_exists('value', $b) ? $int($b['value'], 0, 0, 100000) : (int)($e['value'] ?? 0);
    if ($kind === 'pct' && $value > 100) return ['error' => 'A percentage cannot be above 100'];
    return ['v' => ['kind' => $kind, 'value' => $value, 'min_order' => array_key_exists('minOrder', $b) ? $int($b['minOrder'], 0, 0, 100000) : (int)($e['min_order'] ?? 0), 'max_uses' => array_key_exists('maxUses', $b) ? $int($b['maxUses'], 0, 0, 1000000) : (int)($e['max_uses'] ?? 0),
        'expires' => array_key_exists('expires', $b) ? (preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$b['expires']) ? $b['expires'] : '') : ($e['expires'] ?? ''), 'note' => array_key_exists('note', $b) ? $clean($b['note'], 120) : ($e['note'] ?? ''), 'active' => array_key_exists('active', $b) ? ($b['active'] ? 1 : 0) : (int)($e['active'] ?? 1)]];
};
if ($route === 'GET admin/promos') json_response(['promos' => array_map(fn($p) => ['id' => (int)$p['id'], 'code' => $p['code'], 'kind' => $p['kind'], 'value' => (int)$p['value'], 'minOrder' => (int)$p['min_order'], 'maxUses' => (int)$p['max_uses'], 'used' => (int)$p['used'], 'expires' => $p['expires'], 'active' => (bool)$p['active'], 'note' => $p['note']], $all('SELECT * FROM kk_promos ORDER BY id DESC'))]);
if ($route === 'POST admin/promos') {
    $code = preg_replace('/[^A-Z0-9_-]/', '', strtoupper($clean($body['code'] ?? '', 30))); if (strlen($code) < 3) json_error('Code must be at least 3 letters or numbers'); if ($code === 'LOYALTY') json_error('That code is reserved');
    if ($one('SELECT 1 FROM kk_promos WHERE code = ?', [$code])) json_error('That code already exists', 409); $p = $promoIn($body); if (isset($p['error'])) json_error($p['error']); $v = $p['v'];
    $run('INSERT INTO kk_promos (code, kind, value, min_order, max_uses, expires, note, active) VALUES (?,?,?,?,?,?,?,?)', [$code, $v['kind'], $v['value'], $v['min_order'], $v['max_uses'], $v['expires'], $v['note'], $v['active']]); json_response(['ok' => true], 201);
}
if ($route === 'PUT admin/promos/:id') { $e = $one('SELECT * FROM kk_promos WHERE id = ?', [(int)$P[2]]); if (!$e) json_error('Not found', 404); $p = $promoIn($body, $e); if (isset($p['error'])) json_error($p['error']); $v = $p['v'];
    $run('UPDATE kk_promos SET kind = ?, value = ?, min_order = ?, max_uses = ?, expires = ?, note = ?, active = ? WHERE id = ?', [$v['kind'], $v['value'], $v['min_order'], $v['max_uses'], $v['expires'], $v['note'], $v['active'], $e['id']]); json_response(['ok' => true]); }
if ($route === 'DELETE admin/promos/:id') { $e = $one('SELECT * FROM kk_promos WHERE id = ?', [(int)$P[2]]); if (!$e) json_error('Not found', 404); if ((int)$e['used']) { $run('UPDATE kk_promos SET active = 0 WHERE id = ?', [$e['id']]); json_response(['ok' => true, 'deactivated' => true]); } $run('DELETE FROM kk_promos WHERE id = ?', [$e['id']]); json_response(['ok' => true]); }
// corporate
if ($route === 'GET admin/corporate') json_response(['accounts' => array_map($corpOut, $all('SELECT * FROM kk_corporate ORDER BY name'))]);
if ($route === 'POST admin/corporate') {
    $name = $clean($body['name'] ?? '', 80); $code = preg_replace('/[^A-Z0-9_-]/', '', strtoupper($clean($body['code'] ?? '', 30))); if (mb_strlen($name) < 2) json_error('Enter the company name');
    if ($code === '') $code = substr(preg_replace('/[^A-Z0-9]/', '', strtoupper($name)), 0, 8) . random_int(10, 99); if ($one('SELECT 1 FROM kk_corporate WHERE code = ?', [$code])) json_error('That code already exists', 409);
    $run('INSERT INTO kk_corporate (name, code, contact, phone, email, address, discount_pct, notes) VALUES (?,?,?,?,?,?,?,?)', [$name, $code, $clean($body['contact'] ?? '', 60), $clean($body['phone'] ?? '', 20), $clean($body['email'] ?? '', 80), $clean($body['address'] ?? '', 160), max(0, min(50, (float)($body['discountPct'] ?? 0))), $clean($body['notes'] ?? '', 200)]); json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId(), 'code' => $code], 201);
}
if ($route === 'PUT admin/corporate/:id') { $e = $one('SELECT * FROM kk_corporate WHERE id = ?', [(int)$P[2]]); if (!$e) json_error('Not found', 404); $b = $body;
    $run('UPDATE kk_corporate SET name = ?, contact = ?, phone = ?, email = ?, address = ?, discount_pct = ?, active = ?, notes = ? WHERE id = ?', [array_key_exists('name', $b) ? $clean($b['name'], 80) : $e['name'], array_key_exists('contact', $b) ? $clean($b['contact'], 60) : $e['contact'], array_key_exists('phone', $b) ? $clean($b['phone'], 20) : $e['phone'], array_key_exists('email', $b) ? $clean($b['email'], 80) : $e['email'], array_key_exists('address', $b) ? $clean($b['address'], 160) : $e['address'], array_key_exists('discountPct', $b) ? max(0, min(50, (float)$b['discountPct'])) : $e['discount_pct'], array_key_exists('active', $b) ? ($b['active'] ? 1 : 0) : $e['active'], array_key_exists('notes', $b) ? $clean($b['notes'], 200) : $e['notes'], $e['id']]); json_response(['ok' => true]); }
if ($route === 'GET admin/corporate/:id/invoice') {
    $c = $one('SELECT * FROM kk_corporate WHERE id = ?', [(int)$P[2]]); if (!$c) json_error('Not found', 404); $month = preg_match('/^\d{4}-\d{2}$/', $_GET['month'] ?? '') ? $_GET['month'] : substr($nowEAT()['date'], 0, 7);
    $rows = $all("SELECT * FROM kk_orders WHERE corp_id = ? AND status = 'delivered' AND date LIKE ? ORDER BY date, id", [$c['id'], $month . '%']); $sum = fn($f, $list) => array_sum(array_map($f, $list));
    json_response(['company' => $corpOut($c), 'month' => $month, 'orders' => array_map(fn($o) => ['id' => (int)$o['id'], 'date' => $o['date'], 'meal' => $o['meal'], 'customer' => $o['name'], 'subtotal' => (int)$o['subtotal'], 'fee' => (int)$o['delivery_fee'], 'discount' => (int)$o['discount'], 'total' => (int)$o['total'], 'paid' => (bool)$o['paid']], $rows),
        'totals' => ['subtotal' => $sum(fn($o) => (int)$o['subtotal'], $rows), 'fee' => $sum(fn($o) => (int)$o['delivery_fee'], $rows), 'discount' => $sum(fn($o) => (int)$o['discount'], $rows), 'total' => $sum(fn($o) => (int)$o['total'], $rows), 'unpaid' => $sum(fn($o) => (int)$o['total'], array_filter($rows, fn($o) => !(int)$o['paid']))]]);
}
if ($route === 'POST admin/corporate/:id/invoice/paid') { $month = $clean($body['month'] ?? '', 7); if (!preg_match('/^\d{4}-\d{2}$/', $month)) json_error('Choose a month'); $run("UPDATE kk_orders SET paid = 1 WHERE corp_id = ? AND status = 'delivered' AND date LIKE ?", [(int)$P[2], $month . '%']); json_response(['ok' => true]); }
// outbox + audit
if ($route === 'GET admin/outbox') json_response(['whatsappApi' => (bool)(WA_TOKEN && WA_PHONE_ID), 'messages' => $all('SELECT * FROM kk_outbox WHERE status = ? ORDER BY id DESC LIMIT 200', [($_GET['status'] ?? '') === 'sent' ? 'sent' : 'pending'])]);
if ($route === 'POST admin/outbox/:id/sent') { $run("UPDATE kk_outbox SET status = 'sent', sent_at = ? WHERE id = ?", [$now(), (int)$P[2]]); json_response(['ok' => true]); }
if ($route === 'POST admin/outbox/:id/dismiss') { $run("UPDATE kk_outbox SET status = 'dismissed' WHERE id = ?", [(int)$P[2]]); json_response(['ok' => true]); }
if ($route === 'POST admin/outbox/clear') { $run("UPDATE kk_outbox SET status = 'dismissed' WHERE status = 'pending'"); json_response(['ok' => true]); }
if ($route === 'GET admin/audit') json_response(['entries' => $all('SELECT * FROM kk_audit ORDER BY id DESC LIMIT ' . $int($_GET['limit'] ?? 200, 200, 1, 1000))]);
// dashboard + economics
if ($route === 'GET admin/dashboard') {
    $days = $int($_GET['days'] ?? 14, 14, 1, 90); $nowD = $nowEAT()['date']; $today = $addDays($nowD, 2); $from = $addDays($nowD, -($days - 1));
    $base = "FROM kk_orders WHERE date >= ? AND date <= ? AND status NOT IN ('cancelled','rejected') AND NOT (payment = 'mpesa_now' AND paid = 0)"; $map = [];
    foreach ($all("SELECT date, COUNT(*) AS n, COALESCE(SUM(total),0) AS gmv, COALESCE(SUM(commission_amt),0) AS comm $base GROUP BY date", [$from, $today]) as $r) $map[$r['date']] = $r;
    $byDay = []; for ($i = 0; $i < $days + 2; $i++) { $d = $addDays($from, $i); $byDay[] = ['date' => $d, 'n' => (int)($map[$d]['n'] ?? 0), 'gmv' => (int)($map[$d]['gmv'] ?? 0), 'comm' => (int)($map[$d]['comm'] ?? 0)]; }
    $ph = $all("SELECT RIGHT(REPLACE(phone, ' ', ''), 9) AS p, COUNT(*) AS n FROM kk_orders WHERE status = 'delivered' GROUP BY p"); $repeat = $ph ? (int)round(100 * count(array_filter($ph, fn($x) => (int)$x['n'] >= 2)) / count($ph)) : 0;
    $top = $all("SELECT i.name, SUM(i.qty) AS qty, SUM(i.line_total) AS revenue FROM kk_order_items i JOIN kk_orders o ON o.id = i.order_id WHERE o.date >= ? AND o.date <= ? AND o.status NOT IN ('cancelled','rejected') GROUP BY i.name ORDER BY qty DESC LIMIT 8", [$from, $today]);
    $dl = $all("SELECT picked_at, ready_at, delivered_at FROM kk_orders WHERE status = 'delivered' AND date >= ? AND delivered_at IS NOT NULL", [$from]); $avg = fn($a) => $a ? (int)round(array_sum($a) / count($a)) : null;
    $door = $avg(array_map(fn($x) => kk_mins($x['picked_at'], $x['delivered_at']), array_filter($dl, fn($x) => !empty($x['picked_at'])))); $r2d = $avg(array_map(fn($x) => kk_mins($x['ready_at'], $x['delivered_at']), array_filter($dl, fn($x) => !empty($x['ready_at']))));
    $tot = $one("SELECT COUNT(*) AS n, SUM(CASE WHEN status IN ('cancelled','rejected') THEN 1 ELSE 0 END) AS bad FROM kk_orders WHERE date >= ? AND date <= ? AND NOT (reason = 'Payment not completed')", [$from, $today]);
    $weeks = []; foreach ($all('SELECT date, rating FROM kk_orders WHERE rating > 0 AND date >= ?', [$addDays($nowD, -55)]) as $o) { $t = strtotime($o['date'] . ' UTC'); $wk = gmdate('Y-m-d', $t - ((int)gmdate('N', $t) - 1) * 86400); $weeks[$wk][] = (int)$o['rating']; }
    ksort($weeks); $trend = []; foreach ($weeks as $wk => $rs) $trend[] = ['week' => $wk, 'avg' => round(10 * array_sum($rs) / count($rs)) / 10, 'n' => count($rs)];
    $dem = []; foreach ($all("SELECT region, COUNT(*) AS n $base AND region != '' GROUP BY region", [$from, $today]) as $r) $dem[$r['region']] = (int)$r['n']; $sup = [];
    foreach ($all("SELECT region, COUNT(*) AS k, SUM(capacity) AS cap FROM kk_kitchens WHERE $LIVE GROUP BY region") as $r) $sup[$r['region']] = $r;
    $regions = []; foreach (array_unique(array_merge(array_keys($dem), array_keys($sup))) as $r) $regions[] = ['region' => $r, 'orders' => $dem[$r] ?? 0, 'kitchens' => (int)($sup[$r]['k'] ?? 0), 'capacityPerMeal' => (int)($sup[$r]['cap'] ?? 0)]; usort($regions, fn($a, $b) => $b['orders'] <=> $a['orders']);
    $unmet = $all('SELECT region, name, SUM(n) AS searches FROM kk_demand WHERE date >= ? GROUP BY area_id, region, name ORDER BY searches DESC LIMIT 10', [$from]);
    json_response(['days' => $days, 'from' => $from, 'to' => $today, 'byDay' => $byDay, 'totals' => ['orders' => array_sum(array_column($byDay, 'n')), 'gmv' => array_sum(array_column($byDay, 'gmv')), 'commission' => array_sum(array_column($byDay, 'comm'))], 'repeatPct' => $repeat, 'topDishes' => $top, 'doorMin' => $door, 'readyToDoorMin' => $r2d,
        'cancelPct' => (int)$tot['n'] ? (int)round(100 * (int)$tot['bad'] / (int)$tot['n']) : 0, 'ratingTrend' => $trend, 'regions' => $regions, 'unmet' => $unmet]);
}
if ($route === 'GET admin/economics') {
    $days = $int($_GET['days'] ?? 30, 30, 1, 365); $nowD = $nowEAT()['date']; $today = $addDays($nowD, 2); $from = $addDays($nowD, -($days - 1)); $cost = (int)$S['deliveryCost'];
    $rows = $all("SELECT o.*, k.name AS kname FROM kk_orders o JOIN kk_kitchens k ON k.id = o.kitchen_id WHERE o.status = 'delivered' AND o.date >= ? AND o.date <= ?", [$from, $today]);
    $agg = function ($list) use ($cost) { $a = ['orders' => count($list), 'food' => 0, 'commission' => 0, 'fees' => 0, 'discounts' => 0]; foreach ($list as $o) { $a['food'] += (int)$o['subtotal']; $a['commission'] += (int)$o['commission_amt']; $a['fees'] += (int)$o['delivery_fee']; $a['discounts'] += (int)$o['discount']; }
        $a['deliveryCost'] = $a['orders'] * $cost; $a['margin'] = $a['commission'] + $a['fees'] - $a['discounts'] - $a['deliveryCost']; $a['marginPerOrder'] = $a['orders'] ? (int)round($a['margin'] / $a['orders']) : 0; return $a; };
    $by = []; foreach ($rows as $o) $by[$o['kname']][] = $o; ksort($by); $ks = []; foreach ($by as $n => $list) $ks[] = ['kitchen' => $n] + $agg($list);
    $dishes = $all("SELECT i.name, SUM(i.qty) AS qty, SUM(i.line_total) AS revenue, ROUND(SUM(i.line_total * o.commission_pct / 100.0)) AS commission FROM kk_order_items i JOIN kk_orders o ON o.id = i.order_id WHERE o.status = 'delivered' AND o.date >= ? AND o.date <= ? GROUP BY i.name ORDER BY revenue DESC", [$from, $today]);
    json_response(['days' => $days, 'from' => $from, 'to' => $today, 'deliveryCostPerOrder' => $cost, 'total' => $agg($rows), 'kitchens' => $ks, 'dishes' => $dishes]);
}
// exports
if ($route === 'GET admin/export/payouts.csv') {
    $ks = array_map(fn($k) => ['k' => $k] + $statement($k['id']), $all("SELECT * FROM kk_kitchens WHERE status != 'rejected' ORDER BY name"));
    if (($_GET['format'] ?? '') === 'mpesa') kk_send_csv('azizo-kitchens-mpesa-payouts.csv', array_merge([['Phone', 'Amount', 'Name']], array_map(fn($x) => [$x['k']['phone'], $x['balance'], $x['k']['name']], array_filter($ks, fn($x) => $x['balance'] > 0))));
    kk_send_csv('azizo-kitchens-payouts.csv', array_merge([['Kitchen', 'Phone', 'Delivered orders', 'Earned', 'Meat supplies', 'Paid', 'Balance']], array_map(fn($x) => [$x['k']['name'], $x['k']['phone'], $x['delivered'], $x['earned'], $x['supplies'], $x['paid'], $x['balance']], $ks)));
}
if ($route === 'GET admin/export/menu.csv') {
    kk_send_csv('azizo-kitchens-menu.csv', array_merge([['Name', 'Description', 'Category', 'Cuisine', 'Price KES', 'Serves', 'Tags', 'Image URL', 'Options']], array_map(fn($d) => [$d['name'], $d['description'], $d['category'], $d['tradition'], $d['price'], $d['serves'], $d['tags'], ($d['image'] !== '' && $d['image'][0] === '/') ? SITE_URL . $d['image'] : $d['image'],
        implode(' | ', array_map(fn($g) => $g['name'] . ': ' . implode(' / ', array_map(fn($c) => $c['name'] . (!empty($c['price']) ? ' (+' . $c['price'] . ')' : ''), $g['choices'])), $jp($d['options'], [])))], $all('SELECT * FROM kk_dishes WHERE active = 1 ORDER BY sort_order'))));
}
if ($route === 'GET admin/export/orders.csv') {
    $from = $addDays($nowEAT()['date'], -($int($_GET['days'] ?? 30, 30, 1, 365) - 1));
    kk_send_csv('azizo-kitchens-orders.csv', array_merge([['Order', 'Date', 'Meal', 'Kitchen', 'Status', 'Customer', 'Phone', 'Food', 'Delivery', 'Discount', 'Total', 'Commission', 'Payment', 'Paid', 'Rating']], array_map(fn($o) => [$o['id'], $o['date'], $o['meal'], $o['kname'], $o['status'], $o['name'], $o['phone'], $o['subtotal'], $o['delivery_fee'], $o['discount'], $o['total'], $o['commission_amt'], $o['payment'], $o['paid'] ? 'yes' : 'no', $o['rating'] ?: ''], $all('SELECT o.*, k.name AS kname FROM kk_orders o JOIN kk_kitchens k ON k.id = o.kitchen_id WHERE o.date >= ? ORDER BY o.id', [$from]))));
}
if ($route === 'GET admin/backup/kitchens.json') {
    if ($SUB !== 'full') json_error('Only the full login can download backups', 403); $dump = [];
    foreach (['kk_dishes', 'kk_kitchens', 'kk_kitchen_dishes', 'kk_orders', 'kk_order_items', 'kk_payouts', 'kk_promos', 'kk_corporate', 'kk_supply', 'kk_riders', 'kk_audit', 'kk_demand'] as $t) $dump[$t] = array_map(function ($r) { unset($r['password_hash'], $r['pin_hash']); return $r; }, $all("SELECT * FROM $t"));
    $dump['settings'] = $S; $dump['exportedAt'] = gmdate('c'); header('Content-Type: application/json'); header('Content-Disposition: attachment; filename="azizo-kitchens-backup.json"'); echo json_encode($dump, JSON_PRETTY_PRINT); exit;
}
json_error('Not found', 404);
