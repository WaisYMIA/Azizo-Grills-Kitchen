<?php
// v5.0 operations helpers shared by api/ops and api/market (mirror of backend/ops.js)
const OPS_ONB = [['sop_read', 'SOP handbook read and signed by owner'], ['training', 'Food-safety and brand training completed'], ['contract', 'Partner agreement signed'], ['premises', 'Premises photographed and address confirmed'], ['payments', 'Till / M-Pesa details verified']];

function ops_gate_for(PDO $pdo, int $pid): array {
    $q = fn($sql, $a = []) => (function () use ($pdo, $sql, $a) { $s = $pdo->prepare($sql); $s->execute($a); return $s->fetch(); })();
    $p = $q('SELECT * FROM mk_partners WHERE id = ?', [$pid]) ?: [];
    $last = $q('SELECT score, result, critical_fails FROM mk_inspections WHERE partner_id = ? ORDER BY id DESC LIMIT 1', [$pid]);
    $done = [];
    $s = $pdo->prepare('SELECT `key` AS k, done FROM ops_onboarding WHERE partner_id = ?'); $s->execute([$pid]);
    foreach ($s->fetchAll() as $r) $done[$r['k']] = (bool)$r['done'];
    $items = (int)(($q('SELECT COUNT(*) AS n FROM mk_partner_items WHERE partner_id = ?', [$pid]) ?: ['n' => 0])['n']);
    $checks = [
        ['key' => 'licence', 'label' => 'Business licence and health certificate verified', 'ok' => !empty($p['licence_verified']) && !empty($p['health_cert_no'])],
        ['key' => 'inspection', 'label' => 'Premises inspection passed (score 70+ with no critical fail)', 'ok' => $last && (float)$last['score'] >= 70 && !(int)$last['critical_fails']],
        ['key' => 'items', 'label' => 'At least 5 items listed with prices', 'ok' => $items >= 5],
    ];
    foreach (OPS_ONB as $o) $checks[] = ['key' => $o[0], 'label' => $o[1], 'ok' => !empty($done[$o[0]]), 'manual' => true];
    $all = true; foreach ($checks as $c) if (!$c['ok']) $all = false;
    return ['ok' => $all, 'checks' => $checks, 'partnerStatus' => $p['status'] ?? ''];
}
function ops_points(PDO $pdo, string $phone9): array {
    if (strlen($phone9) < 9) return ['earned' => 0, 'adj' => 0];
    $like = '%' . $phone9;
    $s = $pdo->prepare("SELECT COALESCE(SUM(total),0) FROM orders WHERE status = 'completed' AND customer_phone LIKE ?"); $s->execute([$like]); $a = (int)$s->fetchColumn();
    $b = 0; try { $s = $pdo->prepare("SELECT COALESCE(SUM(total),0) FROM kk_orders WHERE status IN ('delivered','completed') AND phone LIKE ?"); $s->execute([$like]); $b = (int)$s->fetchColumn(); } catch (Throwable $e) {}
    $s = $pdo->prepare('SELECT COALESCE(SUM(points),0) FROM ops_loyalty_adj WHERE phone9 = ?'); $s->execute([$phone9]);
    return ['earned' => intdiv($a + $b, 100), 'adj' => (int)$s->fetchColumn()];
}
