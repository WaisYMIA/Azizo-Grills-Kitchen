<?php
// Azizo partner inspection (v4.4): the standard, the scoring and the tamper seal. The score is ALWAYS worked out here, never trusted from the browser.
require_once __DIR__ . '/security.php';
function insp_std(): array { static $s = null; if ($s === null) $s = json_decode((string)file_get_contents(__DIR__ . '/../data/inspection-standard.json'), true); return $s; }
function insp_band(float $score): array { foreach (insp_std()['bands'] as $b) if ($score >= $b['min']) return $b; $bs = insp_std()['bands']; return end($bs); }
/** Returns ['error' => msg] or the full result. $answers: [itemId => ['v' => pass|partial|fail|na, 'n' => finding]] */
function insp_score($answers): array {
    if (!is_array($answers)) return ['error' => 'Answer every checklist item'];
    $val = ['pass' => 1.0, 'partial' => 0.5, 'fail' => 0.0]; $clean = []; $crit = []; $total = 0.0; $wsum = 0; $applicable = 0; $items = 0; $cats = [];
    foreach (insp_std()['categories'] as $c) {
        $w = 0; $s = 0.0;
        foreach ($c['items'] as $i) {
            $items++; $a = is_array($answers[$i['id']] ?? null) ? $answers[$i['id']] : []; $v = (string)($a['v'] ?? '');
            $n = mb_substr(trim(preg_replace('/[\x00-\x08\x0b\x0c\x0e-\x1f]/', ' ', (string)($a['n'] ?? ''))), 0, 300);
            if (!isset($val[$v]) && $v !== 'na') return ['error' => 'Please answer item ' . $i['id']];
            if ($v === 'na' && !empty($i['critical'])) return ['error' => 'Item ' . $i['id'] . ' is critical and cannot be "Not applicable"'];
            if ($v === 'fail' && mb_strlen($n) < 5) return ['error' => 'Write a short finding for the failed item ' . $i['id']];
            $clean[$i['id']] = ['v' => $v, 'n' => $n];
            if ($v === 'na') continue;
            $applicable++; $w += $i['w']; $s += $i['w'] * $val[$v];
            if ($v === 'fail' && !empty($i['critical'])) $crit[] = $i['id'];
        }
        $pct = $w ? $s / $w : null; $cats[] = ['id' => $c['id'], 'name' => $c['name'], 'weight' => $c['weight'], 'pct' => $pct === null ? null : round($pct * 100, 1)];
        if ($pct !== null) { $total += $c['weight'] * $pct; $wsum += $c['weight']; }
    }
    if ($applicable < (int)ceil($items * 0.6)) return ['error' => 'Too many items marked Not applicable (at least 60% must be assessed)'];
    $sc = $wsum ? $total / $wsum * 100 : 0.0; $capped = false;
    if ($crit && $sc > 59) { $sc = 59.0; $capped = true; }
    $sc = round($sc, 1); $b = insp_band($sc); $result = ($crit || $sc < 60) ? 'Fail' : ($sc < 70 ? 'Conditional' : 'Pass');
    return ['answers' => $clean, 'score' => $sc, 'grade' => $b['grade'], 'stars' => $b['stars'], 'label' => $b['label'], 'action' => $b['action'], 'reinspectDays' => $b['reinspectDays'], 'result' => $result, 'criticalFails' => $crit, 'capped' => $capped, 'catScores' => $cats];
}
function insp_seal(array $r): string { return hash_hmac('sha256', implode('|', ['insp', $r['id'], $r['ref'], $r['partner_id'], rtrim(rtrim(number_format((float)$r['score'], 1, '.', ''), '0'), '.'), $r['grade'], $r['inspected_at'], $r['inspector_name'], $r['answers']]), order_sig_key()); }
function insp_seal_ok(array $r): bool { return !empty($r['seal']) && hash_equals((string)$r['seal'], insp_seal($r)); }
