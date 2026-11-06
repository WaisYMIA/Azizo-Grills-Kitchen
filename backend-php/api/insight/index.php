<?php
// Azizo insight API (mirrors backend/insight.js): reports + Excel, audit centre, visitors, email settings.
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../lib/insight_helpers.php';
require_once __DIR__ . '/../../lib/mailer.php';
cors_and_preflight();
$pdo = get_db(); $M = $_SERVER['REQUEST_METHOD'];
$P = array_values(array_filter(explode('/', trim((string)($_GET['p'] ?? ''), '/')), fn($x) => $x !== ''));
$a = $P[0] ?? ''; $b1 = $P[1] ?? ''; $b2 = $P[2] ?? '';
$one = function ($sql, $p = []) use ($pdo) { $q = $pdo->prepare($sql); $q->execute($p); return $q->fetch(PDO::FETCH_ASSOC); };
$all = function ($sql, $p = []) use ($pdo) { $q = $pdo->prepare($sql); $q->execute($p); return $q->fetchAll(PDO::FETCH_ASSOC); };
$sendXlsx = function (string $data, string $name) { header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); header('Content-Disposition: attachment; filename="' . $name . '"'); header('Cache-Control: no-store'); header('Content-Length: ' . strlen($data)); echo $data; exit; };

// ---------- public visit beacon ----------
if ($a === 'hit' && $M === 'POST') {
    http_response_code(204); header('Cache-Control: no-store');
    try {
        $b = read_json_body(); $ip = client_ip(); $ua = (string)($_SERVER['HTTP_USER_AGENT'] ?? '');
        if ($ua === '' || preg_match('/(bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|headless|lighthouse|curl|wget|python|scrapy|uptime)/i', $ua)) exit;
        rate_limit('ihit', 90, 60);
        $path = substr(preg_split('/[?#]/', (string)($b['p'] ?? ''))[0], 0, 120);
        if (!preg_match('#^/[A-Za-z0-9._\-/]*$#', $path) || strpos($path, '..') !== false || strpos($path, '//') !== false) exit;
        if (preg_match('/(admin|staff|operations|marketplace-admin|security-center|inspector|partner-portal|kitchens-admin)/i', $path)) exit;
        if (substr($path, -1) === '/') $path .= 'index.html'; if ($path === '/') $path = '/index.html';
        $ref = substr((string)($b['r'] ?? ''), 0, 200); $utm = substr(preg_replace('/[^a-z0-9_\-]/', '', strtolower((string)($b['u'] ?? ''))), 0, 30); $host = strtolower(preg_replace('/^www\./', '', (string)(parse_url($ref, PHP_URL_HOST) ?: '')));
        if ($utm) $source = $utm; elseif (!$host) $source = 'direct'; elseif (preg_match('/google\./', $host)) $source = 'google'; elseif (preg_match('/bing\.|duckduckgo|yahoo/', $host)) $source = 'other search'; elseif (preg_match('/facebook|fb\./', $host)) $source = 'facebook'; elseif (strpos($host, 'instagram') !== false) $source = 'instagram'; elseif (preg_match('/(^|\.)t\.co$|twitter|x\.com/', $host)) $source = 'x/twitter'; elseif (strpos($host, 'tiktok') !== false) $source = 'tiktok'; elseif (preg_match('/whatsapp|wa\.me/', $host)) $source = 'whatsapp'; elseif (strpos($host, 'youtube') !== false) $source = 'youtube'; else $source = 'other site';
        $own = strtolower(preg_replace('/^www\./', '', explode(':', (string)($_SERVER['HTTP_HOST'] ?? ''))[0])); $w = (int)($b['w'] ?? 0); $day = ins_eat_day();
        $device = preg_match('/ipad|tablet/i', $ua) ? 'tablet' : (preg_match('/mobi|android|iphone/i', $ua) ? 'mobile' : (($w && $w < 700) ? 'mobile' : 'desktop'));
        $salt = hash('sha256', 'azizo-visit|' . (getenv('ORDER_SIG_KEY') ?: (getenv('JWT_SECRET') ?: (defined('JWT_SECRET') ? JWT_SECRET : 'dev')))); $vid = substr(hash('sha256', $salt . '|' . $ip . '|' . $ua . '|' . $day), 0, 16);
        if ($host && $host === $own) { $f = $one('SELECT source FROM site_visits WHERE vid = ? AND day = ? ORDER BY id LIMIT 1', [$vid, $day]); $source = $f ? $f['source'] : 'direct'; }
        $pdo->prepare('INSERT INTO site_visits (ts, day, path, source, device, vid) VALUES (?,?,?,?,?,?)')->execute([gmdate('Y-m-d H:i:s'), $day, $path, $source, $device, $vid]);
    } catch (Throwable $e) {}
    exit;
}

// ---------- everything below needs an admin-side login ----------
$adm = require_admin(); $role = $adm['tr'] ?? 'owner'; $who = $adm['name'] ?? ($adm['role'] ?? 'admin');
$allowed = fn($d) => in_array($role, $d['roles'], true);
if ($a !== 'admin') json_error('Not found', 404);

if ($b1 === 'reports' && $b2 === '' && $M === 'GET') {
    $list = []; foreach (ins_cat() as $d) if ($allowed($d)) $list[] = ['key' => $d['key'], 'group' => $d['group'], 'title' => $d['title'], 'desc' => $d['desc'], 'branch' => !empty($d['branch'])];
    json_response(['role' => $role, 'reports' => $list, 'today' => ins_eat_day()]);
}
if ($b1 === 'reports' && $b2 !== '' && $M === 'GET') {
    $key = $b2; $export = ($P[3] ?? '') === 'export.xlsx'; $def = ins_def($key); if (!$def) json_error('Unknown report', 404); if (!$allowed($def)) json_error($export ? 'Your login cannot export this report' : 'Your login cannot open this report', 403);
    try { $r = ins_run($def, $_GET, $export ? 100000 : min(max((int)($_GET['limit'] ?? 100), 1), 500)); } catch (Throwable $e) { error_log('[azizo] report ' . $key . ': ' . $e->getMessage()); json_error('Could not build that report', 500); }
    if (!$export) json_response($r);
    $sheets = [['name' => 'README', 'kv' => true, 'rows' => ins_meta($r, $who, $role)], ['name' => 'Summary', 'columns' => [['label' => 'Measure', 'type' => 'text'], ['label' => 'Value', 'type' => 'num']], 'rows' => array_map(fn($t) => [$t['label'], $t['value']], $r['totals'])], ['name' => 'Data', 'columns' => $r['columns'], 'rows' => $r['rows']]];
    activity_add('export', 'export-report', ['detail' => $key . ' ' . $r['period']['from'] . '..' . $r['period']['to'] . ' rows=' . $r['rowCount']]);
    $sendXlsx(xlsx_workbook($sheets, $r['title']), 'azizo-' . $key . '-' . $r['period']['from'] . '-to-' . $r['period']['to'] . '.xlsx');
}
if ($b1 === 'pack.xlsx' && $M === 'GET') {
    $results = []; foreach (ins_cat() as $d) { if (!$allowed($d) || (!empty($_GET['group']) && $d['group'] !== $_GET['group'])) continue; try { $results[] = ins_run($d, $_GET, 50000); } catch (Throwable $e) {} }
    if (!$results) json_error('Nothing to export', 404);
    $per = $results[0]['period']; $summary = []; foreach ($results as $r) foreach ($r['totals'] as $t) $summary[] = [$r['title'], $t['label'], $t['value']];
    $rows = [['Azizo full data pack', 'One workbook with every report your login may see.'], ['Period (Nairobi dates)', $per['from'] . ' to ' . $per['to']], ['Generated (Nairobi time)', substr(ins_local(gmdate('Y-m-d H:i:s')), 0, 16)], ['Generated by', "$who ($role)"], ['Time and money', 'Nairobi time (UTC+3). Whole Kenya shillings.'], ['Order definitions', 'Closed = completed. Unsuccessful = cancelled or M-Pesa payment failed. Sales use completed orders only.'], ['Confidential', 'Contains business and personal data. Share only with people who need it.']];
    foreach ($results as $i => $r) $rows[] = ['Sheet ' . ($i + 3) . ': ' . $r['title'], $r['rowCount'] . ' rows. ' . $r['desc']];
    $sheets = [['name' => 'README', 'kv' => true, 'rows' => $rows], ['name' => 'Summary', 'columns' => [['label' => 'Report', 'type' => 'text'], ['label' => 'Measure', 'type' => 'text'], ['label' => 'Value', 'type' => 'num']], 'rows' => $summary]];
    foreach ($results as $r) $sheets[] = ['name' => str_replace(['(', ')'], '', $r['title']), 'columns' => $r['columns'], 'rows' => $r['rows']];
    activity_add('export', 'export-pack', ['detail' => $per['from'] . '..' . $per['to'] . ' sheets=' . count($results)]);
    $sendXlsx(xlsx_workbook($sheets, 'Azizo data pack'), 'azizo-data-pack-' . $per['from'] . '-to-' . $per['to'] . '.xlsx');
}

// ---------- audit centre ----------
if ($b1 === 'activity' && $b2 === 'verify' && $M === 'GET') { $v = activity_verify(); activity_add('security', 'verify-audit-chain', ['detail' => $v['ok'] ? 'intact, ' . $v['checked'] . ' rows' : 'BROKEN at row ' . $v['brokenAtId'], 'outcome' => $v['ok'] ? 'ok' : 'fail']); json_response($v); }
if ($b1 === 'activity' && $b2 === '' && $M === 'GET') {
    [$from, $to] = ins_range($_GET); $lim = min(max((int)($_GET['limit'] ?? 100), 1), 500); $off = max(0, (int)($_GET['offset'] ?? 0)); $q = mb_substr(trim((string)($_GET['q'] ?? '')), 0, 60); $cat = (string)($_GET['category'] ?? ''); $who2 = mb_substr(trim((string)($_GET['actor'] ?? '')), 0, 60); $out = (string)($_GET['outcome'] ?? '');
    $ua = ins_utc($from); $ub = ins_utc(ins_add_days($to, 1)); $rows = [];
    if ($cat !== 'security-events') {
        $w = ['ts >= ?', 'ts < ?']; $p = [$ua, $ub]; if ($cat) { $w[] = 'category = ?'; $p[] = $cat; } if ($who2) { $w[] = 'actor LIKE ?'; $p[] = "%$who2%"; } if ($out) { $w[] = 'outcome = ?'; $p[] = $out; }
        if ($q) { $w[] = '(action LIKE ? OR detail LIKE ? OR target LIKE ? OR ip LIKE ?)'; array_push($p, "%$q%", "%$q%", "%$q%", "%$q%"); }
        foreach ($all('SELECT id, ts, category, action, actor, role, ip, target, detail, outcome FROM activity_log WHERE ' . implode(' AND ', $w) . ' ORDER BY id DESC LIMIT 2000', $p) as $x) $rows[] = $x + ['source' => 'activity'];
    }
    if (!$cat || $cat === 'security' || $cat === 'security-events') {
        $w = ['ts >= ?', 'ts < ?']; $p = [$ua, $ub]; if ($who2) { $w[] = 'actor LIKE ?'; $p[] = "%$who2%"; } if ($q) { $w[] = '(type LIKE ? OR detail LIKE ? OR ip LIKE ? OR path LIKE ?)'; array_push($p, "%$q%", "%$q%", "%$q%", "%$q%"); }
        if (!$out || $out === 'fail') foreach ($all('SELECT id, ts, sev, type, ip, path, actor, detail FROM sec_events WHERE ' . implode(' AND ', $w) . ' ORDER BY id DESC LIMIT 2000', $p) as $x) $rows[] = ['id' => (int)$x['id'], 'ts' => $x['ts'], 'category' => 'security', 'action' => $x['type'], 'actor' => $x['actor'] ?? '', 'role' => '', 'ip' => $x['ip'], 'target' => $x['path'] ?? '', 'detail' => $x['detail'] ?? '', 'outcome' => 'fail', 'severity' => $x['sev'], 'source' => 'security'];
    }
    usort($rows, fn($x, $y) => [$y['ts'], (int)$y['id']] <=> [$x['ts'], (int)$x['id']]); $page = array_map(fn($x) => $x + ['when' => substr(ins_local($x['ts']), 0, 16)], array_slice($rows, $off, $lim));
    $cats = $all('SELECT category, COUNT(*) n FROM activity_log WHERE ts >= ? AND ts < ? GROUP BY category ORDER BY n DESC', [$ua, $ub]); foreach ($cats as &$c) $c['n'] = (int)$c['n']; unset($c);
    $fl = (int)$one("SELECT COUNT(*) n FROM activity_log WHERE action = 'login-failed' AND ts >= ? AND ts < ?", [$ua, $ub])['n'];
    json_response(['rows' => $page, 'total' => count($rows), 'categories' => $cats, 'period' => ['from' => $from, 'to' => $to], 'failedLogins' => $fl]);
}

// ---------- visitors ----------
if ($b1 === 'visitors' && $M === 'GET') {
    [$from, $to] = ins_range($_GET); $span = (int)round((strtotime($to . ' UTC') - strtotime($from . ' UTC')) / 86400) + 1; $pf = ins_add_days($from, -$span); $pt = ins_add_days($from, -1);
    $tot = fn($f, $t) => $one('SELECT COUNT(DISTINCT vid) v, COUNT(*) p FROM site_visits WHERE day >= ? AND day <= ?', [$f, $t]); $cur = $tot($from, $to); $prev = $tot($pf, $pt);
    $orders = (int)$one("SELECT COUNT(*) n FROM orders WHERE created_at >= ? AND created_at < ? AND status <> 'cancelled'", [ins_utc($from), ins_utc(ins_add_days($to, 1))])['n']; $rep = fn($k) => ins_run(ins_def($k), ['from' => $from, 'to' => $to], 200); $v = (int)$cur['v'];
    json_response(['period' => ['from' => $from, 'to' => $to], 'visitorDays' => $v, 'views' => (int)$cur['p'], 'prevVisitorDays' => (int)$prev['v'], 'prevViews' => (int)$prev['p'], 'orders' => $orders, 'orderRatePct' => $v ? round($orders / $v * 1000) / 10 : null, 'daily' => $rep('visitors_daily'), 'pages' => $rep('visitors_pages'), 'sources' => $rep('visitors_sources'), 'devices' => $rep('visitors_devices'), 'funnel' => $rep('funnel_daily'),
        'note' => 'Visitors are counted per day from an anonymous code that changes daily. Nothing personal is stored. "Visitor-days" adds up each day\'s unique visitors, so the same person on two days counts twice.']);
}

// ---------- email settings ----------
if ($b1 === 'mail' && $b2 === '' && $M === 'GET') json_response(['settings' => mail_public(), 'presets' => ['ssl' => ['port' => 465, 'hint' => 'Recommended for cPanel: SSL/TLS on port 465'], 'starttls' => ['port' => 587, 'hint' => 'STARTTLS on port 587']]]);
if ($b1 === 'mail' && $b2 === '' && $M === 'PUT') { $r = mail_save(read_json_body()); if (isset($r['errors'])) json_error(implode('. ', $r['errors'])); activity_add('settings', 'mail-settings', ['detail' => 'changed: ' . implode(', ', $r['changed'])]); json_response(['ok' => true, 'settings' => mail_public()]); }
if ($b1 === 'mail' && $b2 === 'test' && $M === 'POST') {
    $b = read_json_body(); $to = trim((string)($b['to'] ?? '')); if (!mail_is_email($to)) json_error('Enter the email address to send the test to');
    $r = mail_send($to, 'Azizo test email', "This is a test email from your Azizo website.\n\nIf you can read this, your cPanel mailbox settings work.\nSent by $who.", $who, true);
    activity_add('settings', 'mail-test', ['target' => $to, 'outcome' => $r['ok'] ? 'ok' : 'fail', 'detail' => $r['ok'] ? 'test email sent' : $r['error']]); if ($r['ok']) json_response(['ok' => true]); json_error($r['error']);
}
if ($b1 === 'mail' && $b2 === 'log' && $M === 'GET') json_response(['log' => array_map(fn($x) => $x + ['when' => substr(ins_local($x['ts']), 0, 16)], $all('SELECT id, ts, to_addr, subject, status, error, by_name FROM email_log ORDER BY id DESC LIMIT 100'))]);
json_error('Not found', 404);
