<?php
// Report engine shared by api/insight (v5.5). Reads data/reports.json, the same catalogue the Node backend uses.
require_once __DIR__ . '/xlsx_multi.php';
require_once __DIR__ . '/activity.php';
function ins_tz(): int { return (int)(defined('TZ_OFFSET_HOURS') ? TZ_OFFSET_HOURS : 3); }
function ins_cat(): array { static $c = null; if ($c === null) $c = json_decode(file_get_contents(__DIR__ . '/../data/reports.json'), true) ?: []; return $c; }
function ins_def(string $k): ?array { foreach (ins_cat() as $d) if ($d['key'] === $k) return $d; return null; }
function ins_is_sqlite(PDO $p): bool { return $p->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite'; }
function ins_eat_day(?int $t = null): string { return gmdate('Y-m-d', ($t ?? time()) + ins_tz() * 3600); }
function ins_ok_day($d): bool { return is_string($d) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) && strtotime($d . ' UTC') !== false; }
function ins_add_days(string $d, int $n): string { return gmdate('Y-m-d', strtotime($d . ' 00:00:00 UTC') + $n * 86400); }
function ins_utc(string $d): string { return gmdate('Y-m-d H:i:s', strtotime($d . ' 00:00:00 UTC') - ins_tz() * 3600); }
function ins_range(array $q): array { $to = ins_ok_day($q['to'] ?? '') ? $q['to'] : ins_eat_day(); $from = ins_ok_day($q['from'] ?? '') ? $q['from'] : ins_add_days($to, -29); if ($from > $to) [$from, $to] = [$to, $from]; if (strtotime($to . ' UTC') - strtotime($from . ' UTC') > 400 * 86400) $from = ins_add_days($to, -400); return [$from, $to]; }
function ins_local(?string $s): string { if (!$s) return ''; if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/', $s, $m)) return strlen($s) === 10 ? $s . ' 00:00:00' : ''; return gmdate('Y-m-d H:i:s', gmmktime((int)$m[4], (int)$m[5], (int)$m[6], (int)$m[2], (int)$m[3], (int)$m[1]) + ins_tz() * 3600); }
function ins_ms(?string $s): ?int { if (!$s || !preg_match('/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/', $s, $m)) return null; return gmmktime((int)$m[4], (int)$m[5], (int)$m[6], (int)$m[2], (int)$m[3], (int)$m[1]) * 1000; }
function ins_num($v) { return ($v === null || $v === '' || !is_numeric($v)) ? null : $v + 0; }
function ins_expand(string $sql, PDO $pdo): string {
    $tz = ins_tz();
    if (ins_is_sqlite($pdo)) return preg_replace_callback('/\{\{DAY:([^}]+)\}\}/', fn($m) => "date({$m[1]}, '+{$tz} hours')", $sql);
    return preg_replace_callback('/\{\{DAY:([^}]+)\}\}/', fn($m) => "DATE(DATE_ADD({$m[1]}, INTERVAL {$tz} HOUR))", $sql);
}
function ins_run(array $def, array $q, int $limit = 100000): array {
    $pdo = get_db(); [$from, $to] = ins_range($q); $branch = mb_substr((string)($q['branch'] ?? ''), 0, 40);
    $vals = ['from' => ins_utc($from), 'to' => ins_utc(ins_add_days($to, 1)), 'fromd' => $from, 'tod' => $to, 'branch' => $branch]; $params = [];
    $sql = preg_replace_callback('/:(fromd|tod|from|to|branch)\b/', function ($m) use (&$params, $vals) { $params[] = $vals[$m[1]]; return '?'; }, ins_expand($def['sql'], $pdo));
    $st = $pdo->prepare($sql); $st->execute($params); $raw = $st->fetchAll(PDO::FETCH_ASSOC); $total = count($raw); $cap = max(1, min($limit, 100000)); $rows = array_slice($raw, 0, $cap);
    $colIdx = []; foreach ($def['cols'] as $i => $c) if (!isset($colIdx[$c['k']])) $colIdx[$c['k']] = $i;
    $sums = []; foreach ($def['cols'] as $c) if (($c['calc'] ?? '') === 'share') { $s = 0; foreach ($rows as $x) $s += ins_num($x[$c['of']] ?? null) ?? 0; $sums[$c['of']] = $s; }
    $now = time() * 1000; $out = [];
    foreach ($rows as $x) {
        $r = [];
        foreach ($def['cols'] as $c) {
            $calc = $c['calc'] ?? ''; $t = $c['t'];
            if ($calc === 'mins') { $a = ins_ms($x[$c['a']] ?? null); $b = ins_ms($x[$c['b']] ?? null); $r[] = ($a !== null && $b !== null && $b >= $a) ? (int)round(($b - $a) / 60000) : null; continue; }
            if ($calc === 'age') { $a = ins_ms($x[$c['a']] ?? null); $r[] = $a !== null ? max(0, (int)round(($now - $a) / 60000)) : null; continue; }
            if ($calc === 'share') { $s = $sums[$c['of']] ?? 0; $r[] = $s ? round((ins_num($x[$c['of']] ?? null) ?? 0) / $s * 1000) / 10 : null; continue; }
            if ($calc === 'ratio') { $b = ins_num($x[$c['b']] ?? null); $r[] = $b ? round((ins_num($x[$c['a']] ?? null) ?? 0) / $b * 100) / 100 : null; continue; }
            if ($calc === 'pct') { $b = ins_num($x[$c['b']] ?? null); $r[] = $b ? round((ins_num($x[$c['a']] ?? null) ?? 0) / $b * 1000) / 10 : null; continue; }
            $v = $x[$c['k']] ?? null; if ($v === null) { $r[] = null; continue; }
            if (!empty($c['eat'])) { $l = ins_local((string)$v); $v = $t === 'date' ? substr($l, 0, 10) : ($t === 'time' ? substr($l, 11, 5) : substr($l, 0, 16)); }
            elseif ($t === 'datetime' && is_string($v)) $v = substr($v, 0, 16);
            if (in_array($t, ['int', 'money', 'pct', 'num'], true)) { $n = ins_num($v); $v = $n === null ? $v : $n; }
            $r[] = $v;
        }
        $out[] = $r;
    }
    $totals = [];
    foreach (($def['totals'] ?? []) as $t) {
        $i = isset($t['c']) ? ($colIdx[$t['c']] ?? -1) : -1; $vals2 = []; if ($i >= 0) foreach ($out as $r) { $n = ins_num($r[$i]); if ($n !== null) $vals2[] = $n; }
        $v = $t['fn'] === 'count' ? $total : ($t['fn'] === 'sum' ? array_sum($vals2) : ($t['fn'] === 'max' ? ($vals2 ? max($vals2) : null) : ($vals2 ? round(array_sum($vals2) / count($vals2) * 10) / 10 : null)));
        $totals[] = ['label' => $t['l'], 'value' => $v, 'type' => $t['t'] ?? 'int'];
    }
    return ['key' => $def['key'], 'title' => $def['title'], 'desc' => $def['desc'], 'group' => $def['group'], 'columns' => array_map(fn($c) => ['label' => $c['l'], 'type' => $c['t'] === 'time' ? 'text' : $c['t']], $def['cols']), 'rows' => $out, 'rowCount' => $total, 'truncated' => $total > $cap, 'totals' => $totals, 'period' => ['from' => $from, 'to' => $to], 'branch' => $branch];
}
function ins_meta(array $r, string $who, string $role): array {
    $pii = in_array($r['group'], ['Customers', 'Audit'], true);
    return [['Report', $r['title']], ['What it shows', $r['desc']], ['Period (Nairobi dates)', $r['period']['from'] . ' to ' . $r['period']['to']], ['Branch filter', $r['branch'] ?: 'All branches'], ['Generated (Nairobi time)', substr(ins_local(gmdate('Y-m-d H:i:s')), 0, 16)], ['Generated by', "$who ($role)"], ['Rows', $r['rowCount'] . ($r['truncated'] ? ' (cut off at the export limit)' : '')],
        ['Time and money', 'All times are Nairobi time (UTC+3). Money is in whole Kenya shillings (KSh).'], ['Order definitions', 'Closed = completed. Unsuccessful = cancelled, or M-Pesa payment failed and never completed. Sales figures use completed orders only.'], ['Confidential', 'Contains business data' . ($pii ? ' and personal data (Kenya Data Protection Act). Share only with people who need it.' : '. Share only with people who need it.')]];
}
