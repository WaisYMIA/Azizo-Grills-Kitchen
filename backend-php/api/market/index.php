<?php
// Azizo Marketplace API (mirrors backend/routes/market.js), routed by .htaccess to ?p=<path after /api/market>
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();
$pdo = get_db();
header('Cache-Control: no-store');
$method = $_SERVER['REQUEST_METHOD'];
$P = array_values(array_filter(explode('/', trim((string)($_GET['p'] ?? ''), '/')), fn($x) => $x !== ''));
$body = in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true) ? read_json_body() : [];
$seg = fn($i) => $P[$i] ?? '';

$clean = fn($v, $max) => mb_substr(trim(preg_replace('/[\x00-\x08\x0b\x0c\x0e-\x1f]/', ' ', (string)($v ?? ''))), 0, $max);
$slugify = function ($t) { $s = substr(trim(preg_replace('/[^a-z0-9]+/', '-', strtolower((string)$t)), '-'), 0, 60); return $s ?: 'butchery'; };
$last9 = fn($s) => substr(preg_replace('/\D/', '', (string)$s), -9);
$jp = function ($t, $d) { $v = json_decode((string)$t, true); return $v === null ? $d : $v; };
$one = function ($sql, $a = []) use ($pdo) { $q = $pdo->prepare($sql); $q->execute($a); return $q->fetch(); };
$all = function ($sql, $a = []) use ($pdo) { $q = $pdo->prepare($sql); $q->execute($a); return $q->fetchAll(); };
$run = function ($sql, $a = []) use ($pdo) { $q = $pdo->prepare($sql); $q->execute($a); return $q; };
$val = fn($sql, $a = []) => ($r = $one($sql, $a)) ? (int)array_values($r)[0] : 0;
$today = fn() => gmdate('Y-m-d');
$addDays = fn($d, $n) => gmdate('Y-m-d', strtotime($d . ' UTC') + $n * 86400);
$now = fn() => gmdate('Y-m-d H:i:s');

// ---- settings (the on/off flag lives in site_settings, read publicly by /api/site/settings) ----
$DEF = ['joiningFee' => 0, 'perInvoiceFee' => 0, 'graceDays' => 7, 'suspendAfterDays' => 21, 'defaultDeliveryFee' => 150, 'minOrder' => 500, 'priceGapPct' => 25];
$metaGet = function ($k) use ($one) { $r = $one('SELECT svalue FROM kk_meta WHERE skey = ?', [$k]); return $r ? $r['svalue'] : null; };
$metaSet = function ($k, $v) use ($one, $run) { if ($one('SELECT 1 FROM kk_meta WHERE skey = ?', [$k])) $run('UPDATE kk_meta SET svalue = ? WHERE skey = ?', [$v, $k]); else $run('INSERT INTO kk_meta (skey, svalue) VALUES (?, ?)', [$k, $v]); };
$siteSettings = fn() => $jp($metaGet('site_settings'), []);
$isOn = fn() => !empty($siteSettings()['marketplace']['enabled']);
$setOn = function ($v) use ($siteSettings, $metaSet) { $s = $siteSettings(); $s['marketplace'] = ['enabled' => (bool)$v]; $metaSet('site_settings', json_encode($s)); };
$settings = function () use ($DEF, $metaGet, $jp) { return array_merge($DEF, $jp($metaGet('mk_settings'), [])); };
$gate = function () use ($isOn) { if (!$isOn()) json_error('The marketplace is not open yet', 404, ['enabled' => false]); };

// ---- geo ----
$haversine = function ($a, $b, $c, $d) { $r = M_PI / 180; $dl = ($c - $a) * $r; $dg = ($d - $b) * $r; $h = sin($dl / 2) ** 2 + cos($a * $r) * cos($c * $r) * sin($dg / 2) ** 2; return 2 * 6371 * asin(sqrt($h)); };
$point = function ($b) use ($one) {
    if (!empty($b['areaId'])) { $a = $one('SELECT id, name, region, lat, lng FROM areas WHERE id = ?', [(string)$b['areaId']]); if ($a) return ['lat' => (float)$a['lat'], 'lng' => (float)$a['lng'], 'area' => $a]; }
    if (isset($b['lat'], $b['lng']) && is_numeric($b['lat']) && is_numeric($b['lng'])) { $la = (float)$b['lat']; $ln = (float)$b['lng']; if (abs($la) <= 90 && abs($ln) <= 180 && ($la || $ln)) return ['lat' => $la, 'lng' => $ln]; }
    return null;
};

// ---- shapes ----
$LIVE = "status IN ('pilot','live') AND paused = 0";
$stats = function ($id) use ($one) {
    $r = $one("SELECT COALESCE(SUM(status = 'completed'),0) AS done, COALESCE(SUM(status = 'cancelled'),0) AS cx FROM orders WHERE partner_id = ?", [$id]); $d = (int)$r['done']; $c = (int)$r['cx'];
    return ['orders' => $d, 'completionPct' => ($d + $c) ? (int)round($d * 100 / ($d + $c)) : null];
};
$pub = fn($p) => ['id' => (int)$p['id'], 'slug' => $p['slug'], 'name' => $p['name'], 'area' => $p['area_id'], 'region' => $p['region'], 'address' => $p['address'], 'story' => $p['story'], 'halal' => (bool)$p['halal'], 'tier' => $p['tier'],
    'hygieneScore' => $p['hygiene_score'] === null ? null : (int)$p['hygiene_score'], 'lastInspection' => $p['last_inspection'] ?? '', 'licenceVerified' => (bool)$p['licence_verified'], 'deliveryMode' => $p['delivery_mode'], 'deliveryFee' => (int)$p['delivery_fee'],
    'minOrder' => (int)$p['min_order'], 'photos' => $jp($p['photos'], []), 'lat' => $p['lat'] === null ? null : (float)$p['lat'], 'lng' => $p['lng'] === null ? null : (float)$p['lng'], 'stats' => $stats($p['id'])];
$itemsOf = function ($p, $onlyListed) use ($all, $settings, $jp) {
    $rows = $all('SELECT pi.product_id, pi.price AS pprice, pi.in_stock AS pstock, pr.name, pr.cat, pr.kind, pr.category_group, pr.unit, pr.img, pr.price, pr.badges, pr.in_stock AS gstock, c.sw_name, c.cut_family, COALESCE(c.retired, 0) AS retired
        FROM mk_partner_items pi JOIN products pr ON pr.id = pi.product_id LEFT JOIN mk_catalog c ON c.product_id = pr.id WHERE pi.partner_id = ? ORDER BY pr.category_group, pr.cat, pr.name', [$p['id']]);
    $gap = $settings()['priceGapPct']; $out = [];
    foreach ($rows as $r) {
        if ($onlyListed && $r['retired']) continue;
        $price = (int)($r['pprice'] ?: $r['price']); $rec = (int)$r['price'];
        $out[] = ['id' => $r['product_id'], 'name' => $r['name'], 'swName' => $r['sw_name'] ?? '', 'cat' => $r['cat'], 'group' => $r['category_group'], 'unit' => $r['unit'], 'img' => $r['img'] ?? '', 'badges' => $jp($r['badges'], []), 'price' => $price, 'recommended' => $rec,
            'gapPct' => $rec ? (int)round(($price - $rec) * 100 / $rec) : 0, 'farFromRecommended' => $rec ? abs($price - $rec) * 100 / $rec > $gap : false, 'inStock' => (bool)$r['pstock'] && (int)$r['gstock'] !== 0 && !$r['retired']];
    }
    return $out;
};
$invoiceOut = fn($i) => ['id' => (int)$i['id'], 'periodStart' => $i['period_start'], 'periodEnd' => $i['period_end'], 'orders' => (int)$i['orders_count'], 'gross' => (int)$i['gross'], 'fee' => (int)$i['fee'], 'extra' => (int)$i['extra'], 'total' => (int)$i['total'], 'status' => $i['status'], 'dueDate' => $i['due_date'], 'paidAt' => $i['paid_at'], 'reference' => $i['reference'], 'overdue' => $i['status'] === 'unpaid' && $i['due_date'] < $today()];
$adminP = fn($p) => $pub($p) + ['owner' => $p['owner'], 'phone' => $p['phone'], 'email' => $p['email'], 'status' => $p['status'], 'paused' => (bool)$p['paused'], 'licenceNo' => $p['licence_no'], 'licenceExpiry' => $p['licence_expiry'], 'healthCertNo' => $p['health_cert_no'], 'payMethod' => $p['pay_method'], 'payAccount' => $p['pay_account'], 'adminNote' => $p['admin_note'], 'createdAt' => $p['created_at']];
$myPartner = function () use ($one) {
    $t = require_partner(); $p = $one('SELECT * FROM mk_partners WHERE id = ?', [(int)$t['partnerId']]);
    // A token stops working when the password changes, the admin resets it, or the partner is delisted/rejected.
    if (!$p || (int)($t['v'] ?? 0) !== (int)($p['token_ver'] ?? 0) || in_array($p['status'], ['delisted', 'rejected'], true)) json_error('Please log in again', 401);
    return $p;
};

// ---- fee engine ----
$feeFor = function ($partner, $orderId) use ($all) {
    $rules = $all('SELECT * FROM mk_fee_rules WHERE active = 1');
    $pct = function ($scope, $key) use ($rules) { foreach ($rules as $r) if ($r['scope'] === $scope && $r['kind'] === 'percent' && (string)$r['key'] === (string)$key) return (float)$r['value']; return null; };
    $def = $pct('default', ''); $tier = $pct('tier', $partner['tier']);
    $lines = $all('SELECT oi.line_total AS t, pr.cat AS cat FROM order_items oi LEFT JOIN products pr ON pr.id = oi.product_id WHERE oi.order_id = ?', [$orderId]);
    $fee = 0.0; $base = 0;
    foreach ($lines as $l) { $base += (int)$l['t']; $c = $pct('category', $l['cat']); $p = $c !== null ? $c : ($tier !== null ? $tier : ($def !== null ? $def : 0)); $fee += $l['t'] * $p / 100; }
    foreach ($rules as $r) if ($r['scope'] === 'default' && $r['kind'] === 'flat') $fee += (float)$r['value'];
    return ['base' => $base, 'fee' => (int)round($fee)];
};
$generate = function ($partnerId) use ($pdo, $all, $one, $run, $settings, $today, $addDays, $feeFor) {
    $S = $settings(); $made = [];
    foreach ($all('SELECT * FROM mk_partners' . ($partnerId ? ' WHERE id = ?' : ''), $partnerId ? [$partnerId] : []) as $p) {
        $orders = $all("SELECT id, DATE(created_at) AS d FROM orders WHERE partner_id = ? AND status = 'completed' AND id NOT IN (SELECT order_id FROM mk_order_fees) ORDER BY id", [$p['id']]);
        if (!$orders) continue;
        $first = !$one('SELECT 1 FROM mk_invoices WHERE partner_id = ?', [$p['id']]); $extra = (int)$S['perInvoiceFee'] + ($first ? (int)$S['joiningFee'] : 0);
        $pdo->beginTransaction();
        try {
            $gross = 0; $fee = 0; $calc = [];
            foreach ($orders as $o) { $c = $feeFor($p, $o['id']); $c['id'] = $o['id']; $calc[] = $c; $gross += $c['base']; $fee += $c['fee']; }
            $run('INSERT INTO mk_invoices (partner_id, period_start, period_end, orders_count, gross, fee, extra, total, due_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [$p['id'], $orders[0]['d'], $today(), count($orders), $gross, $fee, $extra, $fee + $extra, $addDays($today(), (int)$S['graceDays'])]);
            $iid = (int)$pdo->lastInsertId();
            foreach ($calc as $c) $run('INSERT INTO mk_order_fees (order_id, partner_id, base, fee, invoice_id) VALUES (?, ?, ?, ?, ?)', [$c['id'], $p['id'], $c['base'], $c['fee'], $iid]);
            $pdo->commit(); $made[] = $iid;
        } catch (Exception $e) { $pdo->rollBack(); throw $e; }
    }
    return $made;
};
$enforce = function () use ($all, $run, $settings, $today, $addDays) {
    $S = $settings(); $cut = $addDays($today(), -(int)$S['suspendAfterDays']); $out = [];
    foreach ($all("SELECT DISTINCT p.id FROM mk_invoices i JOIN mk_partners p ON p.id = i.partner_id WHERE i.status = 'unpaid' AND i.due_date < ? AND p.status IN ('pilot','live')", [$cut]) as $r) {
        $run("UPDATE mk_partners SET status = 'suspended', admin_note = ? WHERE id = ?", ['Auto-suspended: invoice unpaid ' . (int)$S['suspendAfterDays'] . ' days past due.', $r['id']]); $out[] = (int)$r['id'];
    }
    return $out;
};

$DMODES = ['own', 'azizo', 'independent']; $PAYM = ['till', 'paybill', 'pochi']; $FLOW = ['received', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled'];
$M = $method; $a = $seg(0); $b1 = $seg(1); $b2 = $seg(2); $b3 = $seg(3);

// ================= PUBLIC =================
if ($M === 'GET' && $a === 'status') json_response(['enabled' => $isOn()]);
if ($M === 'GET' && $a === 'partners' && $b1 === '') {
    $gate(); $pt = $point($_GET); $out = [];
    foreach ($all("SELECT * FROM mk_partners WHERE $LIVE") as $p) {
        $o = $pub($p); $o['distanceKm'] = ($pt && $p['lat'] !== null) ? round($haversine($pt['lat'], $pt['lng'], (float)$p['lat'], (float)$p['lng']) * 1.3 * 10) / 10 : null;
        $o['itemCount'] = $val('SELECT COUNT(*) FROM mk_partner_items WHERE partner_id = ? AND in_stock = 1', [$p['id']]); $out[] = $o;
    }
    usort($out, function ($x, $y) { if (($x['distanceKm'] === null) !== ($y['distanceKm'] === null)) return $x['distanceKm'] === null ? 1 : -1; $d = ($x['distanceKm'] ?? 0) <=> ($y['distanceKm'] ?? 0); return $d ?: strcmp($x['name'], $y['name']); });
    json_response(['partners' => $out]);
}
if ($M === 'GET' && $a === 'partners' && $b1 !== '') {
    $gate(); $p = $one("SELECT * FROM mk_partners WHERE slug = ? AND $LIVE", [$b1]); if (!$p) json_error('That butchery is not taking orders right now', 404);
    json_response(['partner' => $pub($p), 'items' => $itemsOf($p, true)]);
}
if ($M === 'POST' && $a === 'apply') {
    rate_limit('mk-apply', 6, 3600); $gate(); $b = $body; if (!empty($b['website'])) json_response(['ok' => true], 201);
    $name = $clean($b['name'] ?? '', 80); $owner = $clean($b['owner'] ?? '', 60); $phone = $clean($b['phone'] ?? '', 20); $email = strtolower($clean($b['email'] ?? '', 100)); $pass = (string)($b['password'] ?? '');
    if (mb_strlen($name) < 3) json_error('Enter the name of your butchery'); if (mb_strlen($owner) < 2) json_error('Enter the owner name'); if (strlen($last9($phone)) < 9) json_error('Enter a valid phone number');
    if (!preg_match('/^\S+@\S+\.\S+$/', $email)) json_error('Enter a valid email address'); if (($pp = password_problem($pass)) !== null) json_error($pp);
    if (mb_strlen($clean($b['licenceNo'] ?? '', 60)) < 3) json_error('Enter your business or meat-trade licence number'); if (empty($b['agree'])) json_error('Please tick the box to accept the Azizo standards');
    if ($one("SELECT 1 FROM mk_partners WHERE email = ? OR RIGHT(REPLACE(phone, ' ', ''), 9) = ?", [$email, $last9($phone)])) json_error('An application with this email or phone already exists. Sign in to the partner portal instead.', 409);
    $pt = $point($b); if (!$pt) json_error('Choose your area');
    $slug = $slugify($name); for ($i = 2; $one('SELECT 1 FROM mk_partners WHERE slug = ?', [$slug]); $i++) $slug = $slugify($name) . '-' . $i;
    $S = $settings();
    $run('INSERT INTO mk_partners (slug, name, owner, phone, email, password_hash, area_id, region, address, lat, lng, story, licence_no, licence_expiry, health_cert_no, halal, delivery_mode, pay_method, pay_account, min_order, delivery_fee, photos)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [$slug, $name, $owner, $phone, $email, password_hash($pass, PASSWORD_BCRYPT), isset($pt['area']) ? $pt['area']['id'] : '', isset($pt['area']) ? $pt['area']['region'] : '', $clean($b['address'] ?? '', 200), $pt['lat'], $pt['lng'],
        $clean($b['story'] ?? '', 800), $clean($b['licenceNo'], 60), $clean($b['licenceExpiry'] ?? '', 12), $clean($b['healthCertNo'] ?? '', 60), !empty($b['halal']) ? 1 : 0, in_array($b['deliveryMode'] ?? '', $DMODES, true) ? $b['deliveryMode'] : 'own', in_array($b['payMethod'] ?? '', $PAYM, true) ? $b['payMethod'] : 'till',
        $clean($b['payAccount'] ?? '', 40), (int)$S['minOrder'], (int)$S['defaultDeliveryFee'], '[]']);
    $id = (int)$pdo->lastInsertId(); $photos = [];
    foreach (array_slice(is_array($b['photos'] ?? null) ? $b['photos'] : [], 0, 3) as $d) {
        if (!preg_match('#^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$#', (string)$d, $m) || ($buf = base64_decode($m[2], true)) === false || strlen($buf) > 1500 * 1024) { $run('DELETE FROM mk_partners WHERE id = ?', [$id]); json_error('Upload JPG, PNG or WebP photos under 1.5 MB'); }
        $okImg = ($m[1] === 'jpeg' && substr($buf, 0, 2) === "\xFF\xD8") || ($m[1] === 'png' && substr($buf, 1, 3) === 'PNG') || ($m[1] === 'webp' && substr($buf, 0, 4) === 'RIFF');
        if ($okImg && @getimagesizefromstring($buf) === false) $okImg = false;
        if (!$okImg) { $run('DELETE FROM mk_partners WHERE id = ?', [$id]); json_error('That file is not a valid image'); }
        $dir = __DIR__ . '/../../uploads/partners'; if (!is_dir($dir)) @mkdir($dir, 0775, true); $f = 'p' . $id . '-' . bin2hex(random_bytes(5)) . '.' . ($m[1] === 'jpeg' ? 'jpg' : $m[1]); file_put_contents($dir . '/' . $f, $buf); $photos[] = '/uploads/partners/' . $f;
    }
    if ($photos) $run('UPDATE mk_partners SET photos = ? WHERE id = ?', [json_encode($photos), $id]);
    json_response(['ok' => true, 'message' => 'Thank you! Your application is in. Azizo will contact you to arrange a premises visit and hygiene check.'], 201);
}

// ================= PARTNER =================
if ($M === 'POST' && $a === 'partner' && $b1 === 'login') {
    $id = strtolower($clean($body['login'] ?? '', 100)); throttle_check('mkp', $id, 8, 900);
    $p = $one("SELECT * FROM mk_partners WHERE email = ? OR RIGHT(REPLACE(phone, ' ', ''), 9) = ?", [$id, $last9($id)]);
    if (!$p || !password_verify((string)($body['password'] ?? ''), (string)$p['password_hash'])) { throttle_fail('mkp', $id); json_error('Incorrect email/phone or password', 401); }
    throttle_clear('mkp', $id);
    if (in_array($p['status'], ['delisted', 'rejected'], true)) json_error('This account is not active. Please contact Azizo.', 403);
    audit_log('partner-login', $p['name'], 'partner#' . $p['id']);
    json_response(['token' => jwt_sign(['role' => 'partner', 'partnerId' => (int)$p['id'], 'v' => (int)($p['token_ver'] ?? 0)], 7 * 86400)]);
}
if ($a === 'partner' && $b1 === 'me') {
    $p = $myPartner();
    if ($M === 'GET') {
        json_response(['partner' => $pub($p) + ['owner' => $p['owner'], 'phone' => $p['phone'], 'email' => $p['email'], 'status' => $p['status'], 'paused' => (bool)$p['paused'], 'payMethod' => $p['pay_method'], 'payAccount' => $p['pay_account'], 'adminNote' => ''],
            'items' => $itemsOf($p, false), 'enabled' => $isOn(),
            'catalogue' => array_map(fn($r) => ['id' => $r['id'], 'name' => $r['name'], 'cat' => $r['cat'], 'grp' => $r['grp'], 'unit' => $r['unit'], 'price' => (int)$r['price']], $all('SELECT pr.id, pr.name, pr.cat, pr.category_group AS grp, pr.unit, pr.price FROM products pr LEFT JOIN mk_catalog c ON c.product_id = pr.id WHERE COALESCE(c.retired, 0) = 0 ORDER BY pr.category_group, pr.cat, pr.name')),
            'invoices' => array_map($invoiceOut, $all('SELECT * FROM mk_invoices WHERE partner_id = ? ORDER BY id DESC LIMIT 100', [$p['id']])), 'gapPct' => $settings()['priceGapPct']]);
    }
    if ($M === 'PATCH') {
        $b = $body; $has = fn($k) => array_key_exists($k, $b);
        $run('UPDATE mk_partners SET story = ?, phone = ?, delivery_fee = ?, min_order = ?, paused = ?, delivery_mode = ?, pay_method = ?, pay_account = ?, updated_at = ? WHERE id = ?', [
            $has('story') ? $clean($b['story'], 800) : $p['story'], $has('phone') ? $clean($b['phone'], 20) : $p['phone'], $has('deliveryFee') ? max(0, min(1500, (int)round((float)$b['deliveryFee']))) : $p['delivery_fee'], $has('minOrder') ? max(0, min(50000, (int)round((float)$b['minOrder']))) : $p['min_order'],
            $has('paused') ? (!empty($b['paused']) ? 1 : 0) : $p['paused'], in_array($b['deliveryMode'] ?? '', $DMODES, true) ? $b['deliveryMode'] : $p['delivery_mode'], in_array($b['payMethod'] ?? '', $PAYM, true) ? $b['payMethod'] : $p['pay_method'], $has('payAccount') ? $clean($b['payAccount'], 40) : $p['pay_account'], $now(), $p['id']]);
        json_response(['ok' => true]);
    }
}
if ($M === 'POST' && $a === 'partner' && $b1 === 'password') {
    $p = $myPartner(); if (!password_verify((string)($body['current'] ?? ''), (string)$p['password_hash'])) json_error('Current password is incorrect', 401);
    if (($pp = password_problem((string)($body['next'] ?? ''))) !== null) json_error($pp);
    $run('UPDATE mk_partners SET password_hash = ?, token_ver = token_ver + 1 WHERE id = ?', [password_hash((string)$body['next'], PASSWORD_BCRYPT), $p['id']]); audit_log('partner-password', $p['name'], 'partner#' . $p['id']);
    json_response(['ok' => true, 'token' => jwt_sign(['role' => 'partner', 'partnerId' => (int)$p['id'], 'v' => (int)$p['token_ver'] + 1], 7 * 86400)]);
}
if ($a === 'partner' && $b1 === 'items') {
    $p = $myPartner();
    if ($M === 'POST' && $b2 === 'bulk') {
        $added = 0; foreach (array_slice(is_array($body['ids'] ?? null) ? $body['ids'] : [], 0, 200) as $id) {
            $id = (string)$id; if (!$one('SELECT 1 FROM products WHERE id = ?', [$id]) || $one('SELECT 1 FROM mk_catalog WHERE product_id = ? AND retired = 1', [$id]) || $one('SELECT 1 FROM mk_partner_items WHERE partner_id = ? AND product_id = ?', [$p['id'], $id])) continue;
            $run('INSERT INTO mk_partner_items (partner_id, product_id, price, in_stock) VALUES (?, ?, NULL, 1)', [$p['id'], $id]); $added++;
        }
        json_response(['ok' => true, 'added' => $added]);
    }
    if ($M === 'PUT' && $b2 !== '') {
        $pid = urldecode($b2); $pr = $one('SELECT price FROM products WHERE id = ?', [$pid]); if (!$pr) json_error('Product not found', 404);
        $cur = $one('SELECT * FROM mk_partner_items WHERE partner_id = ? AND product_id = ?', [$p['id'], $pid]);
        $price = !array_key_exists('price', $body) ? ($cur ? $cur['price'] : null) : (($body['price'] === null || $body['price'] === '') ? null : max(1, min(1000000, (int)round((float)$body['price']))));
        $stock = !array_key_exists('inStock', $body) ? ($cur ? (int)$cur['in_stock'] : 1) : (!empty($body['inStock']) ? 1 : 0);
        if ($cur) $run('UPDATE mk_partner_items SET price = ?, in_stock = ?, updated_at = ? WHERE partner_id = ? AND product_id = ?', [$price, $stock, $now(), $p['id'], $pid]);
        else $run('INSERT INTO mk_partner_items (partner_id, product_id, price, in_stock) VALUES (?, ?, ?, ?)', [$p['id'], $pid, $price, $stock]);
        json_response(['ok' => true]);
    }
    if ($M === 'DELETE' && $b2 !== '') { $run('DELETE FROM mk_partner_items WHERE partner_id = ? AND product_id = ?', [$p['id'], urldecode($b2)]); json_response(['ok' => true]); }
}
if ($M === 'GET' && $a === 'partner' && $b1 === 'orders') {
    $p = $myPartner(); $out = [];
    foreach ($all('SELECT * FROM orders WHERE partner_id = ? ORDER BY id DESC LIMIT ' . max(1, min(200, (int)($_GET['limit'] ?? 100))) . ' OFFSET ' . max(0, (int)($_GET['offset'] ?? 0)), [$p['id']]) as $o)
        $out[] = ['id' => (int)$o['id'], 'status' => $o['status'], 'createdAt' => $o['created_at'], 'customer' => $o['customer_name'], 'phone' => $o['customer_phone'], 'fulfilment' => $o['fulfilment'], 'address' => $o['delivery_address'], 'area' => $o['area'], 'notes' => $o['notes'], 'subtotal' => (int)$o['items_subtotal'], 'deliveryFee' => (int)$o['delivery_fee'], 'total' => (int)$o['total'], 'payment' => $o['payment_method'],
            'items' => array_map(fn($i) => ['name' => $i['name'], 'qty' => (float)$i['qty'], 'unit' => $i['unit'], 'unit_price' => (int)$i['unit_price'], 'line_total' => (int)$i['line_total']], $all('SELECT name, qty, unit, unit_price, line_total FROM order_items WHERE order_id = ?', [$o['id']]))];
    json_response(['orders' => $out]);
}
if ($M === 'PATCH' && $a === 'partner' && $b1 === 'orders' && ctype_digit($b2) && $b3 === 'status') {
    $p = $myPartner(); $o = $one('SELECT * FROM orders WHERE id = ? AND partner_id = ?', [(int)$b2, $p['id']]); if (!$o) json_error('Order not found', 404);
    $st = (string)($body['status'] ?? ''); if (!in_array($st, $FLOW, true)) json_error('Unknown status'); if (in_array($o['status'], ['completed', 'cancelled'], true)) json_error('This order is already closed');
    $run('UPDATE orders SET status = ? WHERE id = ?', [$st, $o['id']]); $run('INSERT INTO order_status_log (order_id, status) VALUES (?, ?)', [$o['id'], $st]); json_response(['ok' => true]);
}
if ($M === 'GET' && $a === 'partner' && $b1 === 'invoices') { $p = $myPartner(); json_response(['invoices' => array_map($invoiceOut, $all('SELECT * FROM mk_invoices WHERE partner_id = ? ORDER BY id DESC', [$p['id']]))]); }

// ================= ADMIN =================
if ($a === 'admin') {
    require_admin();
    $STATUS = ['applied', 'pilot', 'live', 'suspended', 'delisted', 'rejected']; $TIERS = ['associate', 'partner', 'premium'];
    if ($M === 'GET' && $b1 === 'overview') {
        $inv = $one("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS s FROM mk_invoices WHERE status = 'unpaid'");
        json_response(['enabled' => $isOn(), 'partners' => array_map(fn($r) => ['status' => $r['status'], 'n' => (int)$r['n']], $all('SELECT status, COUNT(*) AS n FROM mk_partners GROUP BY status')), 'unpaid' => ['n' => (int)$inv['n'], 's' => (int)$inv['s']], 'overdue' => $val("SELECT COUNT(*) FROM mk_invoices WHERE status = 'unpaid' AND due_date < ?", [$today()])]);
    }
    if ($b1 === 'settings') {
        if ($M === 'GET') json_response(['enabled' => $isOn(), 'settings' => $settings()]);
        if ($M === 'PUT') {
            $cur = $settings(); $nx = []; foreach ($DEF as $k => $_) $nx[$k] = isset($body['settings'][$k]) ? max(0, (float)$body['settings'][$k]) : $cur[$k];
            $metaSet('mk_settings', json_encode($nx)); if (array_key_exists('enabled', $body)) $setOn($body['enabled']); audit_log('mk-settings', 'enabled=' . ($isOn() ? 'on' : 'off')); json_response(['enabled' => $isOn(), 'settings' => $settings()]);
        }
    }
    if ($b1 === 'partners' && $b2 === '' && $M === 'GET') {
        $st = $clean($_GET['status'] ?? '', 20); $rows = $all('SELECT * FROM mk_partners ' . ($st ? 'WHERE status = ? ' : '') . 'ORDER BY id DESC LIMIT ' . max(1, min(500, (int)($_GET['limit'] ?? 200))) . ' OFFSET ' . max(0, (int)($_GET['offset'] ?? 0)), $st ? [$st] : []);
        json_response(['partners' => array_map(fn($p) => $adminP($p) + ['items' => $val('SELECT COUNT(*) FROM mk_partner_items WHERE partner_id = ?', [$p['id']]), 'unpaid' => $val("SELECT COALESCE(SUM(total),0) FROM mk_invoices WHERE partner_id = ? AND status = 'unpaid'", [$p['id']])], $rows)]);
    }
    if ($b1 === 'partners' && ctype_digit($b2)) {
        $p = $one('SELECT * FROM mk_partners WHERE id = ?', [(int)$b2]); if (!$p) json_error('Not found', 404);
        if ($M === 'GET' && $b3 === '') { $items = $itemsOf($p, false); json_response(['partner' => $adminP($p), 'items' => $items, 'farItems' => array_values(array_filter($items, fn($i) => $i['farFromRecommended'])), 'audits' => $all('SELECT * FROM mk_audits WHERE partner_id = ? ORDER BY id DESC', [$p['id']]), 'invoices' => array_map($invoiceOut, $all('SELECT * FROM mk_invoices WHERE partner_id = ? ORDER BY id DESC', [$p['id']]))]); }
        if ($M === 'PATCH' && $b3 === '') {
            $b = $body; $has = fn($k) => array_key_exists($k, $b);
            if ($has('status') && !in_array($b['status'], $STATUS, true)) json_error('Unknown status'); if ($has('tier') && !in_array($b['tier'], $TIERS, true)) json_error('Unknown tier');
            if (!empty($b['newPassword']) && ($pp = password_problem((string)$b['newPassword'])) !== null) json_error($pp);
            $run('UPDATE mk_partners SET status = ?, tier = ?, paused = ?, licence_verified = ?, delivery_mode = ?, admin_note = ?, password_hash = ?, token_ver = token_ver + ? WHERE id = ?', [$has('status') ? $b['status'] : $p['status'], $has('tier') ? $b['tier'] : $p['tier'], $has('paused') ? (!empty($b['paused']) ? 1 : 0) : $p['paused'],
                $has('licenceVerified') ? (!empty($b['licenceVerified']) ? 1 : 0) : $p['licence_verified'], in_array($b['deliveryMode'] ?? '', $DMODES, true) ? $b['deliveryMode'] : $p['delivery_mode'], $has('adminNote') ? $clean($b['adminNote'], 500) : $p['admin_note'], !empty($b['newPassword']) ? password_hash((string)$b['newPassword'], PASSWORD_BCRYPT) : $p['password_hash'], (!empty($b['newPassword']) || ($has('status') && in_array($b['status'], ['delisted', 'rejected', 'suspended'], true))) ? 1 : 0, $p['id']]);
            audit_log('partner-update', '#' . $p['id'] . ' ' . $p['name'] . ' status=' . ($has('status') ? $b['status'] : $p['status']) . ' tier=' . ($has('tier') ? $b['tier'] : $p['tier']) . (!empty($b['newPassword']) ? ' password-reset' : ''));
            json_response(['ok' => true]);
        }
        if ($M === 'POST' && $b3 === 'audit') {
            $score = (int)round((float)($body['score'] ?? -1)); if (!is_numeric($body['score'] ?? null) || $score < 0 || $score > 100) json_error('Score must be 0 to 100');
            $d = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($body['date'] ?? '')) ? $body['date'] : $today();
            $run('INSERT INTO mk_audits (partner_id, score, notes, audit_date) VALUES (?, ?, ?, ?)', [$p['id'], $score, $clean($body['notes'] ?? '', 500), $d]); $run('UPDATE mk_partners SET hygiene_score = ?, last_inspection = ? WHERE id = ?', [$score, $d, $p['id']]); audit_log('mk-audit', '#' . $p['id'] . ' score ' . $score); json_response(['ok' => true]);
        }
    }
    if ($M === 'GET' && $b1 === 'audit-log') json_response(['log' => $all('SELECT ts, actor, ip, action, detail FROM sec_audit ORDER BY id DESC LIMIT 300')]);
    if ($b1 === 'fees') {
        if ($M === 'GET') json_response(['rules' => array_map(fn($r) => ['id' => (int)$r['id'], 'scope' => $r['scope'], 'key' => $r['key'], 'kind' => $r['kind'], 'value' => (float)$r['value'], 'active' => (bool)$r['active']], $all('SELECT * FROM mk_fee_rules ORDER BY id')), 'settings' => $settings()]);
        if ($M === 'PUT') {
            $rules = $body['rules'] ?? null; if (!is_array($rules)) json_error('rules array required'); $rules = array_slice($rules, 0, 100);
            foreach ($rules as $r) if (!in_array($r['scope'] ?? '', ['default', 'category', 'tier'], true) || !in_array($r['kind'] ?? '', ['percent', 'flat'], true) || !is_numeric($r['value'] ?? null) || (float)$r['value'] < 0 || (($r['kind'] === 'percent') && (float)$r['value'] > 100)) json_error('Each rule needs a scope, a kind and a value (percent 0 to 100)');
            $pdo->beginTransaction(); $run('DELETE FROM mk_fee_rules');
            foreach ($rules as $r) $run('INSERT INTO mk_fee_rules (scope, `key`, kind, value, active) VALUES (?, ?, ?, ?, ?)', [$r['scope'], $clean($r['key'] ?? '', 60), $r['kind'], (float)$r['value'], (isset($r['active']) && !$r['active']) ? 0 : 1]);
            $pdo->commit(); audit_log('mk-fees', count($rules) . ' rules saved'); json_response(['ok' => true]);
        }
    }
    if ($b1 === 'invoices') {
        if ($M === 'GET' && $b2 === '') {
            $st = $clean($_GET['status'] ?? '', 10);
            json_response(['invoices' => array_map(fn($i) => $invoiceOut($i) + ['partner' => $i['partner_name'], 'partnerId' => (int)$i['partner_id']], $all('SELECT i.*, p.name AS partner_name FROM mk_invoices i JOIN mk_partners p ON p.id = i.partner_id ' . ($st ? 'WHERE i.status = ? ' : '') . 'ORDER BY i.id DESC LIMIT 500', $st ? [$st] : []))]);
        }
        if ($M === 'POST' && $b2 === 'generate') { $made = $generate((int)($body['partnerId'] ?? 0) ?: null); audit_log('mk-invoices', count($made) . ' generated'); json_response(['ok' => true, 'created' => $made]); }
        if ($M === 'PATCH' && ctype_digit($b2)) {
            $i = $one('SELECT * FROM mk_invoices WHERE id = ?', [(int)$b2]); if (!$i) json_error('Not found', 404); $st = (string)($body['status'] ?? '');
            if (!in_array($st, ['unpaid', 'paid', 'void'], true)) json_error('Unknown status');
            $run('UPDATE mk_invoices SET status = ?, reference = ?, paid_at = ? WHERE id = ?', [$st, array_key_exists('reference', $body) ? $clean($body['reference'], 60) : $i['reference'], $st === 'paid' ? $today() : null, $i['id']]);
            if ($st === 'void') $run('DELETE FROM mk_order_fees WHERE invoice_id = ?', [$i['id']]); audit_log('mk-invoice', '#' . $i['id'] . ' -> ' . $st); json_response(['ok' => true]);
        }
    }
    if ($M === 'POST' && $b1 === 'enforce') { $sp = $enforce(); audit_log('mk-enforce', count($sp) . ' suspended'); json_response(['ok' => true, 'suspended' => $sp]); }
    if ($b1 === 'catalog') {
        if ($M === 'GET') json_response(['items' => array_map(fn($r) => ['id' => $r['id'], 'name' => $r['name'], 'cat' => $r['cat'], 'grp' => $r['grp'], 'unit' => $r['unit'], 'price' => (int)$r['price'], 'swName' => $r['swName'], 'cutFamily' => $r['cutFamily'], 'retired' => (int)$r['retired'], 'sellers' => (int)$r['sellers']],
            $all("SELECT pr.id, pr.name, pr.cat, pr.category_group AS grp, pr.unit, pr.price, COALESCE(c.sw_name, '') AS swName, COALESCE(c.cut_family, '') AS cutFamily, COALESCE(c.retired, 0) AS retired, (SELECT COUNT(*) FROM mk_partner_items x WHERE x.product_id = pr.id) AS sellers FROM products pr LEFT JOIN mk_catalog c ON c.product_id = pr.id ORDER BY pr.category_group, pr.cat, pr.name"))]);
        if ($M === 'PUT' && $b2 !== '') {
            $id = urldecode($b2); if (!$one('SELECT 1 FROM products WHERE id = ?', [$id])) json_error('Product not found', 404);
            $c = $one('SELECT * FROM mk_catalog WHERE product_id = ?', [$id]) ?: ['sw_name' => '', 'cut_family' => '', 'retired' => 0];
            $vals = [array_key_exists('swName', $body) ? $clean($body['swName'], 80) : $c['sw_name'], array_key_exists('cutFamily', $body) ? $clean($body['cutFamily'], 60) : $c['cut_family'], array_key_exists('retired', $body) ? (!empty($body['retired']) ? 1 : 0) : (int)$c['retired']];
            if ($one('SELECT 1 FROM mk_catalog WHERE product_id = ?', [$id])) $run('UPDATE mk_catalog SET sw_name = ?, cut_family = ?, retired = ? WHERE product_id = ?', array_merge($vals, [$id])); else $run('INSERT INTO mk_catalog (sw_name, cut_family, retired, product_id) VALUES (?, ?, ?, ?)', array_merge($vals, [$id]));
            json_response(['ok' => true]);
        }
    }
}
json_error('Not found', 404);
