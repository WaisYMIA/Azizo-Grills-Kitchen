<?php
// Growth & money helpers (mirror of backend/growth.js): settings, price band, messages, referrals, reconciliation, digest.
require_once __DIR__ . '/../db.php';
const GROWTH_TZ = 3;
function growth_defaults(): array {
    return ['referral_on' => '1', 'referral_referrer_pts' => '100', 'referral_friend_pts' => '100', 'referral_min_order' => '1000', 'referral_max_month' => '20',
        'price_mode' => 'enforce', 'price_band_pct' => '15', 'refund_window_hours' => '24',
        'sub_on' => '1', 'sub_min_order' => '1500', 'sub_max_per_customer' => '3', 'sub_freqs' => 'weekly,fortnightly,monthly', 'cash_tolerance' => '50',
        'digest_wa' => '', 'digest_email' => '', 'msg_on' => '0', 'msg_provider' => 'manual',
        'tpl_received' => 'Hi {name}, we got your Azizo order #{order} (KSh {total}). We will confirm shortly.',
        'tpl_preparing' => 'Hi {name}, your Azizo order #{order} is being prepared.',
        'tpl_ready' => 'Hi {name}, your Azizo order #{order} is ready.',
        'tpl_out_for_delivery' => 'Hi {name}, your Azizo order #{order} is on its way. {codeLine}Track: {link}',
        'tpl_completed' => 'Thank you {name}! Order #{order} is complete. Anything wrong? Tell us within {refundHours} hours on WhatsApp +254724888057.',
        'tpl_sub_due' => 'Hi {name}, your regular Azizo order is due. Open {link} to order it in one tap.'];
}
function growth_settings(): array {
    $o = growth_defaults(); $pdo = get_db();
    try { foreach ($pdo->query('SELECT k, v FROM ops_settings') as $r) if (array_key_exists($r['k'], $o)) $o[$r['k']] = $r['v']; } catch (Throwable $e) {}
    return $o;
}
function growth_n(string $k): int { return (int)(growth_settings()[$k] ?? 0); }
function growth_eat_day(?int $ts = null): string { return gmdate('Y-m-d', ($ts ?? time()) + GROWTH_TZ * 3600); }
function growth_is_sqlite(): bool { return get_db()->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite'; }
function growth_day_expr(string $col = 'created_at'): string { return growth_is_sqlite() ? "date($col, '+" . GROWTH_TZ . " hours')" : "DATE(DATE_ADD($col, INTERVAL " . GROWTH_TZ . " HOUR))"; }
function growth_last9($s): string { return substr(preg_replace('/\D/', '', (string)$s), -9); }
function growth_price_band(int $base): array { $s = growth_settings(); $pct = (float)$s['price_band_pct']; return ['mode' => $s['price_mode'], 'min' => (int)ceil($base * (1 - $pct / 100)), 'max' => (int)floor($base * (1 + $pct / 100)), 'pct' => $pct]; }
function growth_price_check(int $base, ?int $price): array { $b = growth_price_band($base); if ($b['mode'] === 'off' || $price === null) return ['ok' => true] + $b; return ['ok' => $price >= $b['min'] && $price <= $b['max']] + $b; }

function growth_notify(string $event, ?int $orderId, array $extra = []): void {
    try {
        $s = growth_settings(); if (!in_array($event, ['received', 'preparing', 'ready', 'out_for_delivery', 'completed', 'sub_due'], true) || $s['msg_on'] !== '1') return;
        $pdo = get_db(); $o = null;
        if ($orderId) { $q = $pdo->prepare('SELECT * FROM orders WHERE id = ?'); $q->execute([$orderId]); $o = $q->fetch() ?: null; }
        $phone = $o ? $o['customer_phone'] : ($extra['phone'] ?? ''); if (!$phone) return;
        $site = getenv('SITE_URL') ?: 'https://www.azizobutchery.co.ke';
        $v = ['name' => explode(' ', trim($o['customer_name'] ?? ($extra['name'] ?? 'there')) ?: 'there')[0], 'order' => $o['id'] ?? '', 'total' => $o['total'] ?? '', 'link' => $site . '/index.html?track=' . ($o['id'] ?? ''), 'refundHours' => $s['refund_window_hours'], 'codeLine' => !empty($o['delivery_code']) ? 'Your delivery code is shown on the tracking page. ' : ''];
        $text = preg_replace_callback('/\{(\w+)\}/', fn($m) => array_key_exists($m[1], $v) ? (string)$v[$m[1]] : $m[0], $s['tpl_' . $event]);
        $waOk = $s['msg_provider'] === 'whatsapp' && getenv('WA_TOKEN') && getenv('WA_PHONE_ID'); $smsOk = $s['msg_provider'] === 'sms' && getenv('AT_API_KEY') && getenv('AT_USERNAME'); $live = $waOk || $smsOk;
        $pdo->prepare('INSERT INTO ops_outbox (ts, event, order_id, phone, text, provider, status) VALUES (?,?,?,?,?,?,?)')->execute([gmdate('Y-m-d H:i:s'), $event, $orderId, $phone, $text, $live ? $s['msg_provider'] : 'manual', $live ? 'queued' : 'manual']);
        $id = (int)$pdo->lastInsertId(); $pdo->prepare('DELETE FROM ops_outbox WHERE id < ?')->execute([$id - 1500]);
        if ($live) {
            $to = '254' . growth_last9($phone); $ok = false;
            if ($waOk) { $ch = curl_init('https://graph.facebook.com/v20.0/' . getenv('WA_PHONE_ID') . '/messages'); curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8, CURLOPT_HTTPHEADER => ['content-type: application/json', 'authorization: Bearer ' . getenv('WA_TOKEN')], CURLOPT_POSTFIELDS => json_encode(['messaging_product' => 'whatsapp', 'to' => $to, 'type' => 'text', 'text' => ['body' => $text]])]); curl_exec($ch); $ok = curl_getinfo($ch, CURLINFO_HTTP_CODE) < 300; curl_close($ch); }
            else { $ch = curl_init('https://api.africastalking.com/version1/messaging'); curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8, CURLOPT_HTTPHEADER => ['apiKey: ' . getenv('AT_API_KEY'), 'accept: application/json'], CURLOPT_POSTFIELDS => http_build_query(['username' => getenv('AT_USERNAME'), 'to' => '+' . $to, 'message' => $text] + (getenv('AT_SENDER') ? ['from' => getenv('AT_SENDER')] : []))]); curl_exec($ch); $ok = curl_getinfo($ch, CURLINFO_HTTP_CODE) < 300; curl_close($ch); }
            $pdo->prepare('UPDATE ops_outbox SET status = ? WHERE id = ?')->execute([$ok ? 'sent' : 'failed', $id]);
        }
    } catch (Throwable $e) { error_log('[azizo] notify: ' . $e->getMessage()); }
}

function growth_settle_referrals(): int {
    $s = growth_settings(); if ($s['referral_on'] !== '1') return 0; $pdo = get_db(); $n = 0; $now = gmdate('Y-m-d H:i:s');
    foreach ($pdo->query("SELECT * FROM ops_referrals WHERE status = 'pending'")->fetchAll() as $r) {
        $q = $pdo->prepare("SELECT COALESCE(SUM(total),0) FROM orders WHERE status = 'completed' AND customer_phone LIKE ? AND created_at >= ?"); $q->execute(['%' . $r['referred_phone9'], $r['created_at']]);
        if ((int)$q->fetchColumn() < (int)$s['referral_min_order']) continue;
        $m = $pdo->prepare("SELECT COUNT(*) FROM ops_referrals WHERE referrer_id = ? AND status = 'paid' AND substr(paid_at,1,7) = ?"); $m->execute([$r['referrer_id'], substr($now, 0, 7)]);
        if ((int)$m->fetchColumn() >= (int)$s['referral_max_month']) continue;
        $ins = $pdo->prepare('INSERT INTO ops_loyalty_adj (phone9, points, note, created_at) VALUES (?,?,?,?)');
        $ins->execute([$r['referrer_phone9'], (int)$s['referral_referrer_pts'], 'Referral reward: friend ordered', $now]); $ins->execute([$r['referred_phone9'], (int)$s['referral_friend_pts'], 'Welcome reward: referred by a friend', $now]);
        $pdo->prepare("UPDATE ops_referrals SET status = 'paid', paid_at = ? WHERE id = ?")->execute([$now, $r['id']]); $n++;
    }
    return $n;
}
function growth_remind_subs(): void {
    $pdo = get_db(); $t = growth_eat_day(); $q = $pdo->prepare("SELECT * FROM ops_subs WHERE status = 'active' AND next_date <= ? AND last_notified != ?"); $q->execute([$t, $t]);
    foreach ($q->fetchAll() as $x) { growth_notify('sub_due', null, ['phone' => $x['phone9'], 'name' => $x['name']]); $pdo->prepare('UPDATE ops_subs SET last_notified = ? WHERE id = ?')->execute([$t, $x['id']]); }
}

function growth_recon(string $day): array {
    $pdo = get_db(); $de = growth_day_expr('created_at'); $tol = growth_n('cash_tolerance');
    $q = $pdo->prepare("SELECT id, customer_name, total, payment_method, mpesa_receipt, branch, status, partner_id FROM orders WHERE status != 'cancelled' AND $de = ?"); $q->execute([$day]); $orders = $q->fetchAll();
    $mp = array_values(array_filter($orders, fn($o) => $o['payment_method'] === 'mpesa'));
    $q = $pdo->prepare("SELECT id, order_id, amount, status, mpesa_receipt FROM mpesa_transactions WHERE $de = ?"); $q->execute([$day]); $txns = $q->fetchAll();
    $okBy = []; foreach ($txns as $t) if ($t['status'] === 'success' && $t['order_id']) $okBy[$t['order_id']] = ($okBy[$t['order_id']] ?? 0) + (int)$t['amount'];
    $missing = []; $mismatch = [];
    foreach ($mp as $o) { if (!isset($okBy[$o['id']]) && !$o['mpesa_receipt']) $missing[] = ['order' => (int)$o['id'], 'total' => (int)$o['total'], 'name' => $o['customer_name']]; elseif (isset($okBy[$o['id']]) && abs($okBy[$o['id']] - (int)$o['total']) > 1) $mismatch[] = ['order' => (int)$o['id'], 'total' => (int)$o['total'], 'paid' => $okBy[$o['id']]]; }
    $orphans = []; $has = $pdo->prepare('SELECT 1 FROM orders WHERE id = ?');
    foreach ($txns as $t) if ($t['status'] === 'success') { $ex = false; if ($t['order_id']) { $has->execute([$t['order_id']]); $ex = (bool)$has->fetch(); } if (!$ex) $orphans[] = ['amount' => (int)$t['amount'], 'receipt' => $t['mpesa_receipt']]; }
    $cashBy = []; foreach ($orders as $o) if ($o['payment_method'] === 'cash' && $o['status'] === 'completed' && !$o['partner_id']) { $b = $o['branch'] ?: 'delivery/other'; $cashBy[$b] = ($cashBy[$b] ?? 0) + (int)$o['total']; }
    $q = $pdo->prepare('SELECT * FROM ops_cashups WHERE day = ?'); $q->execute([$day]); $saved = $q->fetchAll(); $names = array_unique(array_merge(array_keys($cashBy), array_column($saved, 'branch'))); $cash = [];
    foreach ($names as $b) { $s = null; foreach ($saved as $x) if ($x['branch'] === $b) $s = $x; $exp = $cashBy[$b] ?? 0; $cash[] = ['branch' => $b, 'expected' => $exp, 'counted_entered' => (bool)$s, 'counted' => $s ? (int)$s['counted'] : null, 'variance' => $s ? (int)$s['counted'] - $exp : null, 'note' => $s ? $s['note'] : '', 'by' => $s ? $s['by_name'] : '', 'flag' => $s ? abs((int)$s['counted'] - $exp) > $tol : false]; }
    return ['day' => $day, 'mpesa' => ['orders' => count($mp), 'amount' => array_sum(array_map(fn($o) => (int)$o['total'], $mp)), 'confirmed' => array_sum($okBy), 'missing' => $missing, 'mismatch' => $mismatch, 'orphans' => $orphans], 'cash' => $cash, 'tolerance' => $tol];
}
function growth_digest(?string $day = null): array {
    $pdo = get_db(); $day = $day ?: growth_eat_day(time() - 86400); $de = growth_day_expr('created_at'); $deO = growth_day_expr('o.created_at');
    $one = function ($sql, $p = []) use ($pdo) { $q = $pdo->prepare($sql); $q->execute($p); return $q->fetch(); };
    $t = $one("SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM orders WHERE status != 'cancelled' AND $de = ?", [$day]); $canc = (int)$one("SELECT COUNT(*) n FROM orders WHERE status = 'cancelled' AND $de = ?", [$day])['n'];
    $q = $pdo->prepare("SELECT oi.name, SUM(oi.qty) q FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status != 'cancelled' AND $deO = ? GROUP BY oi.name ORDER BY SUM(oi.line_total) DESC LIMIT 3"); $q->execute([$day]); $top = array_column($q->fetchAll(), 'name');
    $br = $one("SELECT COALESCE(NULLIF(branch,''),'delivery/other') b, COALESCE(SUM(total),0) s FROM orders WHERE status != 'cancelled' AND $de = ? GROUP BY 1 ORDER BY s DESC LIMIT 1", [$day]);
    $cnt = function ($sql) use ($pdo) { try { return (int)$pdo->query($sql)->fetchColumn(); } catch (Throwable $e) { return 0; } };
    $rc = growth_recon($day);
    $d = ['day' => $day, 'orders' => (int)$t['n'], 'revenue' => (int)$t['s'], 'avg' => $t['n'] ? (int)round($t['s'] / $t['n']) : 0, 'cancelled' => $canc, 'top' => $top, 'topBranch' => $br ? $br['b'] : '',
        'openTickets' => $cnt("SELECT COUNT(*) FROM ops_tickets WHERE status = 'open'"), 'refundsOpen' => $cnt("SELECT COUNT(*) FROM ops_refunds WHERE status = 'requested'"), 'refundsToPay' => $cnt("SELECT COUNT(*) FROM ops_refunds WHERE status = 'approved'"),
        'subsDue' => $cnt("SELECT COUNT(*) FROM ops_subs WHERE status = 'active' AND next_date <= '" . growth_eat_day() . "'"), 'mpesaMissing' => count($rc['mpesa']['missing']), 'cashMissing' => count(array_filter($rc['cash'], fn($c) => !$c['counted_entered'] && $c['expected'] > 0))];
    $d['text'] = "Azizo daily digest, $day\nOrders: {$d['orders']} (KSh {$d['revenue']}, average {$d['avg']}). Cancelled: {$d['cancelled']}.\n" . ($top ? 'Top sellers: ' . implode(', ', $top) . ".\n" : '') . ($d['topBranch'] ? "Busiest: {$d['topBranch']}.\n" : '') .
        "Needs you: {$d['refundsOpen']} refund request(s), {$d['refundsToPay']} refund(s) to pay, {$d['openTickets']} open ticket(s), {$d['subsDue']} standing order(s) due.\n" . ($d['mpesaMissing'] ? "Check: {$d['mpesaMissing']} M-Pesa order(s) with no confirmed payment.\n" : '') . ($d['cashMissing'] ? "Check: cash-up missing for {$d['cashMissing']} branch(es).\n" : '');
    return $d;
}
