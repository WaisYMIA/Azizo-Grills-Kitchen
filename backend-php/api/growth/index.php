<?php
// Azizo growth & money API (mirrors backend/growth.js), routed by .htaccess to ?p=<path after /api/growth>
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../lib/growth_helpers.php';
cors_and_preflight();
$pdo = get_db(); header('Cache-Control: no-store');
$M = $_SERVER['REQUEST_METHOD'];
$P = array_values(array_filter(explode('/', trim((string)($_GET['p'] ?? ''), '/')), fn($x) => $x !== ''));
$body = in_array($M, ['POST', 'PUT', 'PATCH'], true) ? read_json_body() : [];
$a = $P[0] ?? ''; $b1 = $P[1] ?? ''; $b2 = $P[2] ?? '';
$now = fn() => gmdate('Y-m-d H:i:s');
$clean = fn($v, $n) => mb_substr(trim(preg_replace('/[\x00-\x08\x0b\x0c\x0e-\x1f]/', ' ', (string)($v ?? ''))), 0, $n);
$one = function ($sql, $p = []) use ($pdo) { $q = $pdo->prepare($sql); $q->execute($p); return $q->fetch(); };
$all = function ($sql, $p = []) use ($pdo) { $q = $pdo->prepare($sql); $q->execute($p); return $q->fetchAll(); };
$run = function ($sql, $p = []) use ($pdo) { $q = $pdo->prepare($sql); $q->execute($p); return $q; };
$cnt = fn($sql, $p = []) => (int)(($one($sql, $p)) ? array_values($one($sql, $p))[0] : 0);
$who = function () { $p = jwt_payload_quiet(); return $p['name'] ?? 'admin'; };
$validDay = fn($d) => is_string($d) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $d);
$int = fn($rows, $keys) => array_map(function ($r) use ($keys) { foreach ($keys as $k) if (isset($r[$k])) $r[$k] = (int)$r[$k]; return $r; }, $rows);
$customer = function () { $u = require_auth(); if (($u['role'] ?? '') !== 'customer') json_error('Customer login required', 403); return $u; };
$GAP = ['weekly' => 7, 'fortnightly' => 14, 'monthly' => 28];
$addDays = fn($ymd, $n) => gmdate('Y-m-d', strtotime($ymd . ' 00:00:00 UTC') + $n * 86400);
$nextOn = function ($weekday, $from) use ($addDays) { $d = $addDays($from, 1); for ($i = 0; $i < 8; $i++) { if ((int)gmdate('w', strtotime($d . ' 00:00:00 UTC')) === $weekday) return $d; $d = $addDays($d, 1); } return $d; };
$subOut = fn($x) => ['id' => (int)$x['id'], 'items' => json_decode($x['items_json'], true), 'fulfilment' => $x['fulfilment'], 'branch' => $x['branch'], 'partnerId' => $x['partner_id'] ? (int)$x['partner_id'] : null, 'freq' => $x['freq'], 'weekday' => (int)$x['weekday'], 'nextDate' => $x['next_date'], 'status' => $x['status'], 'due' => $x['status'] === 'active' && $x['next_date'] <= growth_eat_day()];

if ($a === 'config' && $M === 'GET') { $s = growth_settings(); json_response(['subscriptions' => ['on' => $s['sub_on'] === '1', 'min' => (int)$s['sub_min_order'], 'freqs' => explode(',', $s['sub_freqs']), 'max' => (int)$s['sub_max_per_customer']], 'referral' => ['on' => $s['referral_on'] === '1', 'friendPts' => (int)$s['referral_friend_pts'], 'referrerPts' => (int)$s['referral_referrer_pts'], 'minOrder' => (int)$s['referral_min_order']], 'refundHours' => (int)$s['refund_window_hours'], 'redeem' => ['on' => $s['redeem_on'] === '1', 'maxPct' => (int)$s['redeem_max_pct'], 'minOrder' => (int)$s['redeem_min_order']], 'franchise' => ['on' => $s['franchise_on'] === '1', 'investMin' => (int)$s['franchise_invest_min'], 'investMax' => (int)$s['franchise_invest_max'], 'fee' => (int)$s['franchise_fee'], 'royaltyPct' => (int)$s['franchise_royalty_pct'], 'termYears' => (int)$s['franchise_term_years'], 'territory' => $s['franchise_territory']]]); }

require_once __DIR__ . '/../../lib/mailer.php';

// ---------- v5.6: points balance + franchise enquiries ----------
if ($a === 'points' && $M === 'GET') {
    $u = $customer(); $s = growth_settings(); $bl = growth_balance((int)$u['id']); if (!$bl) json_error('Account not found', 404);
    json_response(['on' => $s['redeem_on'] === '1', 'points' => $bl['balance'], 'worthKes' => intdiv($bl['balance'], 100) * 100, 'maxPct' => (int)$s['redeem_max_pct'], 'minOrder' => (int)$s['redeem_min_order']]);
}
if ($a === 'franchise-apply' && $M === 'POST') {
    rate_limit('franchise-ip', 5, 3600);
    $s = growth_settings(); if (!empty($body['website'])) json_response(['ok' => true, 'ref' => 'FR-00000']);
    if ($s['franchise_on'] !== '1') json_error('Franchise enquiries are not open right now');
    $name = $clean($body['name'] ?? '', 80); $phone = mb_substr(preg_replace('/[^\d+]/', '', (string)($body['phone'] ?? '')), 0, 16); $email = $clean($body['email'] ?? '', 120); $town = $clean($body['town'] ?? '', 80);
    if (mb_strlen($name) < 2) json_error('Please enter your name'); if (strlen(growth_last9($phone)) < 9) json_error('Please enter a phone number we can reach on WhatsApp');
    if ($email !== '' && !preg_match('/^[^\s@<>",;:]+@[^\s@<>",;:]+\.[^\s@<>",;:]{2,}$/', $email)) json_error('That email address does not look right'); if (mb_strlen($town) < 2) json_error('Tell us the town or area you have in mind');
    $pick = fn($v, $l) => in_array($v, $l, true) ? $v : '';
    $budget = $pick($body['budget'] ?? '', ['under_2m', '2m_4m', '4m_6m', 'over_6m']); $premises = $pick($body['premises'] ?? '', ['own', 'lease', 'none']); $timeline = $pick($body['timeline'] ?? '', ['0_3', '3_6', '6_12', 'later']);
    if (!$budget || !$premises || !$timeline) json_error('Please answer the budget, premises and timing questions'); if (empty($body['consent'])) json_error('Please tick the box to let us contact you about this enquiry');
    $ts = $now(); $run('INSERT INTO ops_franchise (name, phone, email, town, budget, premises, timeline, experience, message, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [$name, $phone, $email, $town, $budget, $premises, $timeline, $clean($body['experience'] ?? '', 500), $clean($body['message'] ?? '', 800), $ts, $ts]);
    $id = (int)$pdo->lastInsertId(); $ref = 'FR-' . str_pad((string)$id, 5, '0', STR_PAD_LEFT);
    try { $mc = mail_config(); $to = $mc['alert_to'] ?: $mc['from_email']; if (mail_is_email($to)) mail_send($to, 'New franchise enquiry ' . $ref, "New franchise enquiry\n\nName: $name\nPhone: $phone\nTown: $town\nBudget: $budget\n\nOpen Operations > Growth > Franchise to follow up.", 'system'); } catch (Throwable $e) {}
    json_response(['ok' => true, 'ref' => $ref, 'message' => 'Thank you. We have your enquiry and will call or WhatsApp you within three working days.'], 201);
}


// ---------- customer ----------
if ($a === 'referral' && $b1 === '' && $M === 'GET') {
    $u = $customer(); growth_settle_referrals(); $s = growth_settings();
    $r = $one('SELECT code FROM ops_ref_codes WHERE customer_id = ?', [$u['id']]); $code = $r['code'] ?? null;
    if (!$code) for ($i = 0; $i < 20 && !$code; $i++) { $c = 'AZ' . strtoupper(substr(bin2hex(random_bytes(4)), 0, 5)); $c = preg_replace('/[01OI]/', 'X', $c); try { $run('INSERT INTO ops_ref_codes (customer_id, code) VALUES (?,?)', [$u['id'], $c]); $code = $c; } catch (Throwable $e) {} }
    $rows = $all('SELECT status FROM ops_referrals WHERE referrer_id = ?', [$u['id']]); $paid = count(array_filter($rows, fn($x) => $x['status'] === 'paid')); $mine = $one('SELECT status, code FROM ops_referrals WHERE referred_id = ?', [$u['id']]);
    json_response(['on' => $s['referral_on'] === '1', 'code' => $code, 'friends' => count($rows), 'rewarded' => $paid, 'pointsEarned' => $paid * (int)$s['referral_referrer_pts'], 'friendPts' => (int)$s['referral_friend_pts'], 'referrerPts' => (int)$s['referral_referrer_pts'], 'minOrder' => (int)$s['referral_min_order'], 'usedCode' => $mine ?: null]);
}
if ($a === 'referral' && $b1 === 'apply' && $M === 'POST') {
    $u = $customer(); $s = growth_settings(); if ($s['referral_on'] !== '1') json_error('Referrals are not running right now');
    $code = strtoupper($clean($body['code'] ?? '', 12)); $me = $one('SELECT * FROM customers WHERE id = ?', [$u['id']]); $ref = $one('SELECT customer_id FROM ops_ref_codes WHERE code = ?', [$code]);
    if (!$ref) json_error('That code is not valid', 404); if ((int)$ref['customer_id'] === (int)$me['id']) json_error('You cannot use your own code');
    $rc = $one('SELECT * FROM customers WHERE id = ?', [$ref['customer_id']]); $p9 = growth_last9($me['phone']); if (growth_last9($rc['phone']) === $p9) json_error('You cannot use your own code');
    if ($one("SELECT 1 FROM orders WHERE customer_phone LIKE ? AND status = 'completed' LIMIT 1", ['%' . $p9])) json_error('Codes are for new customers who have not completed an order yet');
    if ($one('SELECT 1 FROM ops_referrals WHERE referred_phone9 = ? OR referred_id = ?', [$p9, $me['id']])) json_error('You have already used a referral code');
    $run('INSERT INTO ops_referrals (code, referrer_id, referrer_phone9, referred_id, referred_phone9, referred_name, created_at) VALUES (?,?,?,?,?,?,?)', [$code, $rc['id'], growth_last9($rc['phone']), $me['id'], $p9, $me['name'], $now()]);
    json_response(['ok' => true, 'message' => 'Code applied. After your first completed order of KSh ' . $s['referral_min_order'] . '+ you both get ' . $s['referral_friend_pts'] . ' points.']);
}
if ($a === 'subs' && $b1 === '' && $M === 'POST') {
    $u = $customer(); $s = growth_settings(); if ($s['sub_on'] !== '1') json_error('Standing orders are not available right now');
    $items = []; foreach (array_slice(is_array($body['items'] ?? null) ? $body['items'] : [], 0, 40) as $i) { $id = $clean($i['id'] ?? '', 60); if ($id !== '') $items[] = ['id' => $id, 'qty' => max(1, min(200, (int)($i['qty'] ?? 1)))]; }
    if (!$items) json_error('Add items to your cart first'); $freq = (string)($body['freq'] ?? 'weekly'); if (!in_array($freq, explode(',', $s['sub_freqs']), true)) json_error('Pick how often');
    $sum = 0; foreach ($items as $i) { $p = $one('SELECT price FROM products WHERE id = ?', [explode('::', $i['id'])[0]]); if (!$p) json_error('An item is no longer on the menu'); $sum += (int)$p['price'] * $i['qty']; }
    if ($sum < (int)$s['sub_min_order']) json_error('Standing orders start from KSh ' . $s['sub_min_order'] . ' (your items are about KSh ' . $sum . ')');
    if ($cnt("SELECT COUNT(*) FROM ops_subs WHERE customer_id = ? AND status != 'cancelled'", [$u['id']]) >= (int)$s['sub_max_per_customer']) json_error('You can have up to ' . $s['sub_max_per_customer'] . ' standing orders');
    $wd = max(0, min(6, (int)($body['weekday'] ?? 0))); $c = $one('SELECT * FROM customers WHERE id = ?', [$u['id']]); $nd = $nextOn($wd, growth_eat_day());
    $run('INSERT INTO ops_subs (customer_id, phone9, name, items_json, fulfilment, branch, partner_id, freq, weekday, next_date, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [$c['id'], growth_last9($c['phone']), $c['name'], json_encode($items), ($body['fulfilment'] ?? '') === 'pickup' ? 'pickup' : 'delivery', $clean($body['branch'] ?? '', 40), (int)($body['partnerId'] ?? 0) ?: null, $freq, $wd, $nd, $now()]);
    json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId(), 'nextDate' => $nd]);
}
if ($a === 'subs' && $b1 === '' && $M === 'GET') { $u = $customer(); json_response(['subs' => array_map($subOut, $all("SELECT * FROM ops_subs WHERE customer_id = ? AND status != 'cancelled' ORDER BY id DESC", [$u['id']]))]); }
if ($a === 'subs' && ctype_digit($b1) && $M === 'PATCH') {
    $u = $customer(); $x = $one("SELECT * FROM ops_subs WHERE id = ? AND customer_id = ? AND status != 'cancelled'", [(int)$b1, $u['id']]); if (!$x) json_error('Not found', 404); $act = (string)($body['action'] ?? '');
    if ($act === 'pause') $run("UPDATE ops_subs SET status = 'paused' WHERE id = ?", [$x['id']]);
    elseif ($act === 'resume') $run("UPDATE ops_subs SET status = 'active', next_date = ? WHERE id = ?", [$nextOn((int)$x['weekday'], growth_eat_day()), $x['id']]);
    elseif ($act === 'cancel') $run("UPDATE ops_subs SET status = 'cancelled' WHERE id = ?", [$x['id']]);
    elseif ($act === 'skip' || $act === 'advance') $run('UPDATE ops_subs SET next_date = ? WHERE id = ?', [$addDays($x['next_date'] > growth_eat_day() ? $x['next_date'] : growth_eat_day(), $GAP[$x['freq']] ?? 7), $x['id']]);
    else json_error('Unknown action');
    json_response(['ok' => true, 'sub' => $subOut($one('SELECT * FROM ops_subs WHERE id = ?', [$x['id']]))]);
}
if ($a === 'refund-request' && $M === 'POST') {
    rate_limit('grrf', 10, 3600); $id = (int)($body['orderId'] ?? 0); $o = $one('SELECT * FROM orders WHERE id = ?', [$id]); $reason = (string)($body['reason'] ?? '');
    if (!$o || growth_last9($o['customer_phone']) !== growth_last9($body['phone'] ?? '')) json_error('We could not match that order number and phone number', 404);
    if (!in_array($reason, ['late', 'wrong_item', 'missing_item', 'quality', 'overcharged', 'other'], true)) json_error('Pick what went wrong');
    if (!in_array($o['status'], ['completed', 'out_for_delivery', 'ready'], true)) json_error('You can ask for a refund once your order has been delivered or collected');
    $log = $one("SELECT MAX(changed_at) t FROM order_status_log WHERE order_id = ? AND status = 'completed'", [$id]); $closed = $log['t'] ?: $o['created_at']; $hrs = (time() - strtotime($closed . ' UTC')) / 3600;
    if ($hrs > growth_n('refund_window_hours')) json_error('The ' . growth_settings()['refund_window_hours'] . '-hour window has passed. Please message us on WhatsApp +254724888057.');
    if ($one("SELECT 1 FROM ops_refunds WHERE order_id = ? AND status IN ('requested','approved')", [$id])) json_error('We already have a request for this order');
    $run('INSERT INTO ops_refunds (order_id, partner_id, phone9, name, reason, details, amount_req, created_at) VALUES (?,?,?,?,?,?,?,?)', [$id, $o['partner_id'] ?: null, growth_last9($o['customer_phone']), $clean($o['customer_name'], 60), $reason, $clean($body['details'] ?? '', 500), max(0, min((int)$o['total'], (int)($body['amount'] ?? 0))), $now()]);
    json_response(['ok' => true, 'ref' => 'RF-' . str_pad((string)$pdo->lastInsertId(), 5, '0', STR_PAD_LEFT), 'message' => 'Thank you. We have your request and will reply within one working day.']);
}
if ($a === 'cashup' && $M === 'POST') {
    require_staff(); $day = $validDay($body['day'] ?? '') ? $body['day'] : growth_eat_day(); $branch = $clean($body['branch'] ?? '', 40); $counted = (int)round((float)($body['counted'] ?? -1));
    if ($branch === '' || !is_numeric($body['counted'] ?? null) || $counted < 0) json_error('Branch and counted cash are needed');
    $exp = 0; foreach (growth_recon($day)['cash'] as $c) if ($c['branch'] === $branch) $exp = $c['expected'];
    if ($one('SELECT 1 FROM ops_cashups WHERE day = ? AND branch = ?', [$day, $branch])) $run('UPDATE ops_cashups SET expected = ?, counted = ?, variance = ?, note = ?, by_name = ?, created_at = ? WHERE day = ? AND branch = ?', [$exp, $counted, $counted - $exp, $clean($body['note'] ?? '', 200), $who(), $now(), $day, $branch]);
    else $run('INSERT INTO ops_cashups (day, branch, expected, counted, variance, note, by_name, created_at) VALUES (?,?,?,?,?,?,?,?)', [$day, $branch, $exp, $counted, $counted - $exp, $clean($body['note'] ?? '', 200), $who(), $now()]);
    audit_log('cashup', $day . ' ' . $branch . ' var ' . ($counted - $exp)); json_response(['ok' => true, 'expected' => $exp, 'variance' => $counted - $exp, 'flag' => abs($counted - $exp) > growth_n('cash_tolerance')]);
}

// ---------- admin ----------
if ($a === 'admin') {
    $adm = require_admin(); $tr = $adm['tr'] ?? null;
    if ($b1 === 'settings' && $M === 'GET') json_response(['settings' => growth_settings(), 'defaults' => growth_defaults(), 'providers' => ['whatsapp' => (bool)(getenv('WA_TOKEN') && getenv('WA_PHONE_ID')), 'sms' => (bool)(getenv('AT_API_KEY') && getenv('AT_USERNAME'))]]);
    if ($b1 === 'settings' && $M === 'PUT') {
        $def = growth_defaults(); $ch = [];
        foreach ($body as $k => $v) {
            if (!array_key_exists($k, $def)) continue; $v = trim((string)$v);
            if (in_array($k, ['referral_on', 'sub_on', 'msg_on', 'redeem_on', 'franchise_on'], true)) $v = ($v === '1' || $v === 'true') ? '1' : '0';
            elseif ($k === 'franchise_royalty_pct') { if (!is_numeric($v) || $v < 0 || $v > 30) json_error('Royalty must be 0 to 30 percent'); $v = (string)(float)$v; }
            elseif ($k === 'redeem_max_pct') { if (!is_numeric($v) || $v < 1 || $v > 100) json_error('Points limit must be 1 to 100 percent'); $v = (string)(int)round((float)$v); }
            elseif (preg_match('/^franchise_(invest_min|invest_max|fee|term_years)$/', $k)) { if (!is_numeric($v) || $v < 0 || $v > 1000000000) json_error($k . ' must be a number'); $v = (string)(int)round((float)$v); }
            elseif (preg_match('/_pts$|_min_order$|_max_month$|refund_window_hours|sub_min_order|sub_max_per_customer|cash_tolerance$/', $k)) { if (!is_numeric($v) || $v < 0 || $v > 1000000) json_error($k . ' must be a number'); $v = (string)(int)round((float)$v); }
            elseif ($k === 'price_band_pct') { if (!is_numeric($v) || $v < 1 || $v > 100) json_error('Price band must be 1 to 100 percent'); $v = (string)(float)$v; }
            elseif ($k === 'price_mode') { if (!in_array($v, ['off', 'warn', 'enforce'], true)) json_error('Price mode must be off, warn or enforce'); }
            elseif ($k === 'msg_provider') { if (!in_array($v, ['manual', 'whatsapp', 'sms'], true)) json_error('Unknown provider'); }
            elseif ($k === 'sub_freqs') { $f = array_values(array_filter(array_map('trim', explode(',', $v)), fn($x) => in_array($x, ['weekly', 'fortnightly', 'monthly'], true))); if (!$f) json_error('Pick at least one frequency'); $v = implode(',', $f); }
            elseif ($k === 'digest_wa') $v = growth_last9($v) ? '254' . growth_last9($v) : '';
            elseif ($k === 'digest_email') { if ($v !== '' && !filter_var($v, FILTER_VALIDATE_EMAIL)) json_error('Digest email looks wrong'); $v = mb_substr($v, 0, 120); }
            else $v = mb_substr($v, 0, 500);
            if ($one('SELECT 1 FROM ops_settings WHERE k = ?', [$k])) $run('UPDATE ops_settings SET v = ? WHERE k = ?', [$v, $k]); else $run('INSERT INTO ops_settings (k, v) VALUES (?,?)', [$k, $v]); $ch[] = $k;
        }
        audit_log('growth-settings', implode(',', $ch)); json_response(['ok' => true, 'settings' => growth_settings()]);
    }
    if ($b1 === 'franchise' && $M === 'GET') json_response(['applications' => $all('SELECT * FROM ops_franchise ORDER BY id DESC LIMIT 300'), 'statuses' => ['new', 'contacted', 'meeting', 'approved', 'declined']]);
    if ($b1 === 'franchise' && ctype_digit($b2) && $M === 'PATCH') {
        $r = $one('SELECT * FROM ops_franchise WHERE id = ?', [(int)$b2]); if (!$r) json_error('Not found', 404);
        $st = in_array($body['status'] ?? '', ['new', 'contacted', 'meeting', 'approved', 'declined'], true) ? $body['status'] : $r['status'];
        $run('UPDATE ops_franchise SET status = ?, note = ?, handled_by = ?, updated_at = ? WHERE id = ?', [$st, array_key_exists('note', $body) ? $clean($body['note'], 500) : $r['note'], $who(), $now(), $r['id']]);
        audit_log('franchise-' . $st, 'FR-' . $r['id']); json_response(['ok' => true]);
    }
    if ($b1 === 'price-check' && $M === 'GET') {
        $rows = $all('SELECT pi.partner_id, p.name AS partner, pi.product_id, pr.name AS item, pr.price AS base, pi.price FROM mk_partner_items pi JOIN products pr ON pr.id = pi.product_id JOIN mk_partners p ON p.id = pi.partner_id WHERE pi.price IS NOT NULL'); $out = [];
        foreach ($rows as $r) { $b = growth_price_band((int)$r['base']); if ((int)$r['price'] < $b['min'] || (int)$r['price'] > $b['max']) $out[] = ['partner_id' => (int)$r['partner_id'], 'partner' => $r['partner'], 'product_id' => $r['product_id'], 'item' => $r['item'], 'base' => (int)$r['base'], 'price' => (int)$r['price']] + $b; }
        json_response(['mode' => growth_settings()['price_mode'], 'pct' => growth_n('price_band_pct'), 'outside' => $out]);
    }
    if ($b1 === 'price-reset' && $M === 'POST') { $q = $run('UPDATE mk_partner_items SET price = NULL WHERE partner_id = ? AND product_id = ?', [(int)($body['partnerId'] ?? 0), (string)($body['productId'] ?? '')]); audit_log('price-reset', ($body['partnerId'] ?? '') . '/' . ($body['productId'] ?? '')); json_response(['ok' => true, 'changed' => $q->rowCount()]); }
    if ($b1 === 'outbox' && $M === 'GET' && $b2 === '') { $s = growth_settings(); json_response(['messages' => $all('SELECT * FROM ops_outbox ORDER BY id DESC LIMIT 100'), 'on' => $s['msg_on'] === '1', 'provider' => $s['msg_provider']]); }
    if ($b1 === 'outbox' && ctype_digit($b2) && $M === 'POST') { $run("UPDATE ops_outbox SET status = 'sent-manually' WHERE id = ? AND status = 'manual'", [(int)$b2]); json_response(['ok' => true]); }
    if ($b1 === 'referrals' && $M === 'GET') { growth_settle_referrals(); json_response(['referrals' => $all('SELECT id, code, referrer_phone9, referred_phone9, referred_name, status, created_at, paid_at FROM ops_referrals ORDER BY id DESC LIMIT 200')]); }
    if ($b1 === 'referrals' && ctype_digit($b2) && $M === 'PATCH') { $run("UPDATE ops_referrals SET status = 'void' WHERE id = ? AND status = 'pending'", [(int)$b2]); audit_log('referral-void', $b2); json_response(['ok' => true]); }
    if ($b1 === 'subs' && $M === 'GET') json_response(['subs' => $all("SELECT id, name, phone9, freq, next_date, status, fulfilment, branch FROM ops_subs WHERE status != 'cancelled' ORDER BY next_date LIMIT 300"), 'dueToday' => $cnt("SELECT COUNT(*) FROM ops_subs WHERE status = 'active' AND next_date <= ?", [growth_eat_day()])]);
    if ($b1 === 'refunds' && $M === 'GET') {
        $rows = $all("SELECT r.*, o.total AS order_total, o.branch, o.payment_method, p.name AS partner FROM ops_refunds r JOIN orders o ON o.id = r.order_id LEFT JOIN mk_partners p ON p.id = r.partner_id ORDER BY (r.status = 'requested') DESC, r.id DESC LIMIT 200");
        json_response(['refunds' => $rows, 'byReason' => $int($all('SELECT reason, COUNT(*) n, COALESCE(SUM(amount_ok),0) paid FROM ops_refunds GROUP BY reason ORDER BY n DESC'), ['n', 'paid']), 'byPartner' => $int($all("SELECT COALESCE(p.name,'Azizo own') partner, COUNT(*) n FROM ops_refunds r LEFT JOIN mk_partners p ON p.id = r.partner_id GROUP BY COALESCE(p.name,'Azizo own') ORDER BY n DESC LIMIT 10"), ['n']), 'openCount' => $cnt("SELECT COUNT(*) FROM ops_refunds WHERE status = 'requested'"), 'reasons' => ['late', 'wrong_item', 'missing_item', 'quality', 'overcharged', 'other']]);
    }
    if ($b1 === 'refunds' && ctype_digit($b2) && $M === 'PATCH') {
        $r = $one('SELECT * FROM ops_refunds WHERE id = ?', [(int)$b2]); if (!$r) json_error('Not found', 404); $act = (string)($body['action'] ?? '');
        if ($act === 'paid') { if ($r['status'] !== 'approved') json_error('Approve it first'); $run("UPDATE ops_refunds SET status = 'paid', mpesa_ref = ?, paid_at = ? WHERE id = ?", [$clean($body['mpesaRef'] ?? '', 30), $now(), $r['id']]); }
        elseif ($tr === 'finance') json_error('Finance can mark a refund as paid, not approve it', 403);
        elseif ($act === 'approve') { if ($r['status'] !== 'requested') json_error('Already decided'); $o = $one('SELECT total FROM orders WHERE id = ?', [$r['order_id']]); $amt = max(0, min((int)$o['total'], (int)($body['amount'] ?? 0) ?: (int)$r['amount_req'])); $run("UPDATE ops_refunds SET status = 'approved', amount_ok = ?, resolution = ?, handled_by = ?, decided_at = ? WHERE id = ?", [$amt, $clean($body['resolution'] ?? '', 300), $who(), $now(), $r['id']]); }
        elseif ($act === 'reject') { if ($r['status'] !== 'requested') json_error('Already decided'); if (mb_strlen($clean($body['resolution'] ?? '', 300)) < 5) json_error('Write a short reason for the customer'); $run("UPDATE ops_refunds SET status = 'rejected', resolution = ?, handled_by = ?, decided_at = ? WHERE id = ?", [$clean($body['resolution'] ?? '', 300), $who(), $now(), $r['id']]); }
        else json_error('Unknown action');
        audit_log('refund-' . $act, 'RF-' . $r['id'] . ' order ' . $r['order_id']); json_response(['ok' => true]);
    }
    if ($b1 === 'digest' && $M === 'GET') { $d = growth_digest($validDay($_GET['day'] ?? '') ? $_GET['day'] : null); $wa = growth_settings()['digest_wa']; $d['waLink'] = $wa ? 'https://wa.me/' . $wa . '?text=' . rawurlencode($d['text']) : ''; json_response($d); }
    if ($b1 === 'recon' && $M === 'GET') json_response(growth_recon($validDay($_GET['day'] ?? '') ? $_GET['day'] : growth_eat_day()));
}
json_error('Not found', 404);
