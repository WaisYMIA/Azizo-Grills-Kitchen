<?php
// Azizo Playbook API (mirrors backend/playbook.js): checklists, training, new-branch wizard. Routed by .htaccess to ?p=<path after /api/playbook>
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../db.php';
cors_and_preflight();
$pdo = get_db(); header('Cache-Control: no-store');
$M = $_SERVER['REQUEST_METHOD'];
$P = array_values(array_filter(explode('/', trim((string)($_GET['p'] ?? ''), '/')), fn($x) => $x !== ''));
$body = in_array($M, ['POST', 'PUT', 'PATCH'], true) ? read_json_body() : [];
$a = $P[0] ?? ''; $b1 = $P[1] ?? ''; $b2 = $P[2] ?? ''; $b3 = $P[3] ?? '';
$CAT = json_decode(file_get_contents(__DIR__ . '/../../data/playbook.json'), true);
$CL = []; foreach ($CAT['checklists'] as $c) $CL[$c['code']] = $c; $CO = []; foreach ($CAT['courses'] as $c) $CO[$c['code']] = $c;
$now = fn() => gmdate('Y-m-d H:i:s');
$tz = (int)TZ_OFFSET_HOURS;
$eatDay = fn() => gmdate('Y-m-d', time() + $tz * 3600);
$okDay = fn($d) => is_string($d) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) && strtotime($d . ' 00:00:00 UTC') !== false;
$addDays = fn($d, $n) => gmdate('Y-m-d', strtotime($d . ' 00:00:00 UTC') + $n * 86400);
$clean = fn($v, $n) => mb_substr(trim(preg_replace('/[\x00-\x08\x0b\x0c\x0e-\x1f]/', ' ', (string)($v ?? ''))), 0, $n);
$one = function ($sql, $p = []) use ($pdo) { $q = $pdo->prepare($sql); $q->execute($p); return $q->fetch(); };
$all = function ($sql, $p = []) use ($pdo) { $q = $pdo->prepare($sql); $q->execute($p); return $q->fetchAll(); };
$run = function ($sql, $p = []) use ($pdo) { $q = $pdo->prepare($sql); $q->execute($p); return $q; };
$who = function () { $p = jwt_payload_quiet(); return $p['name'] ?? (($p['role'] ?? '') === 'staff' ? 'staff' : 'admin'); };
$audit = function ($act, $det) use ($who) { try { audit_log($act, $det, $who()); } catch (Throwable $e) {} };
$branchOk = fn($id) => $one('SELECT * FROM branches WHERE id = ?', [(string)$id]);
$num = fn($v) => ($v === '' || $v === null || !is_numeric($v)) ? null : (float)$v;

$evaluate = function ($cl, $ans) use ($clean, $num) {
    $done = 0; $fails = 0; $att = 0; $miss = 0;
    foreach ($cl['items'] as $it) {
        $x = $ans[$it['id']] ?? []; $st = null; $ok = $x['ok'] ?? null;
        if ($ok === 'na') $st = 'na';
        elseif ($it['type'] === 'tick') $st = $ok === true ? 'ok' : ($ok === false ? 'fail' : null);
        elseif ($it['type'] === 'temp') { $v = $num($x['value'] ?? null); $st = $v === null ? null : (($v >= $it['min'] && $v <= $it['max']) ? 'ok' : 'fail'); }
        elseif ($it['type'] === 'num') { $v = $num($x['value'] ?? null); $st = ($v === null || $v < 0) ? null : 'ok'; }
        else $st = $clean($x['value'] ?? '', 500) !== '' ? 'ok' : null;
        if ($st) $done++;
        if ($st === 'fail') { $fails++; if (!empty($it['crit'])) $att++; if ($clean($x['note'] ?? '', 300) === '') $miss++; }
    }
    return ['done' => $done, 'total' => count($cl['items']), 'fails' => $fails, 'attention' => $att, 'missingNote' => $miss];
};
$sanitise = function ($cl, $ans) use ($clean, $num) {
    $out = [];
    foreach ($cl['items'] as $it) {
        $x = is_array($ans) ? ($ans[$it['id']] ?? []) : []; $o = [];
        if (isset($x['ok']) && ($x['ok'] === true || $x['ok'] === false || $x['ok'] === 'na')) $o['ok'] = $x['ok'];
        if (isset($x['value']) && $x['value'] !== '') { if ($it['type'] === 'text') $o['value'] = $clean($x['value'], 500); elseif (is_numeric($x['value'])) $o['value'] = $num($x['value']) + 0; }
        if (!empty($x['note'])) $o['note'] = $clean($x['note'], 300);
        if ($o) $out[$it['id']] = $o;
    }
    return $out;
};
$expiry = function ($takenAt) use ($CAT) { return gmdate('Y-m-d', strtotime('+' . (int)$CAT['valid_months'] . ' months', strtotime($takenAt . ' UTC'))); };
$certRows = function ($branch) use ($all, $expiry, $eatDay) {
    $rows = $all('SELECT * FROM pb_training WHERE branch = ? AND passed = 1 ORDER BY id', [$branch]); $map = []; $today = $eatDay();
    foreach ($rows as $r) { $k = ($r['staff_ref'] ?: strtolower($r['staff_name'])) . '|' . $r['course']; if (!isset($map[$k]) || $r['id'] > $map[$k]['id']) $map[$k] = $r; }
    return array_values(array_map(function ($r) use ($expiry, $today) { $e = $expiry($r['taken_at']); return ['id' => (int)$r['id'], 'staff' => $r['staff_name'], 'ref' => $r['staff_ref'], 'course' => $r['course'], 'score' => (int)$r['score'], 'practical' => !empty($r['practical']), 'practicalBy' => $r['practical_by'], 'expires' => $e, 'valid' => $e >= $today, 'certified' => !empty($r['practical']) && $e >= $today]; }, $map));
};
$readiness = function ($L) use ($one, $all, $CAT, $CO, $certRows, $addDays, $eatDay) {
    $b = $one('SELECT * FROM branches WHERE id = ?', [$L['branch_id']]); $checks = [];
    $checks[] = ['k' => 'details', 't' => 'Branch details complete (address, phone, map position)', 'ok' => !!($b && $b['address'] && $b['phone'] && $b['lat'] !== null && $b['lng'] !== null), 'auto' => true, 'detail' => $b ? '' : 'Branch missing'];
    $np = (int)array_values($one('SELECT COUNT(*) FROM products'))[0]; $checks[] = ['k' => 'menu', 't' => 'Menu and prices loaded (at least 10 products)', 'ok' => $np >= 10, 'auto' => true, 'detail' => $np . ' products'];
    $cert = $certRows($L['branch_id']); $need = array_merge($CAT['core'], !empty($L['grill']) ? $CAT['grill'] : []);
    foreach ($need as $c) { $set = []; foreach ($cert as $x) if ($x['course'] === $c && $x['certified']) $set[$x['ref'] ?: strtolower($x['staff'])] = 1; $n = count($set); $checks[] = ['k' => 'train_' . $c, 't' => 'Two certified staff for "' . $CO[$c]['title'] . '"', 'ok' => $n >= 2, 'auto' => true, 'detail' => $n . ' certified']; }
    $since = $addDays($eatDay(), -14);
    foreach (['open', 'close'] as $code) { $n = (int)array_values($one("SELECT COUNT(*) FROM pb_runs WHERE branch = ? AND code = ? AND status = 'complete' AND run_date >= ? AND NOT (attention > 0 AND resolved = 0)", [$L['branch_id'], $code, $since]))[0]; $checks[] = ['k' => 'dry_' . $code, 't' => 'Practice ' . ($code === 'open' ? 'opening' : 'closing') . ' checklist completed in the last 14 days', 'ok' => $n >= 1, 'auto' => true, 'detail' => $n . ' completed']; }
    $man = json_decode($L['manual'] ?: '{}', true) ?: [];
    foreach ($CAT['manual'] as $m) { $na = $m['k'] === 'agreement' && $L['type'] !== 'franchise'; $v = $man[$m['k']] ?? null; $done = !empty($v['done']); $checks[] = ['k' => 'man_' . $m['k'], 't' => $m['t'], 'ok' => $na || $done, 'auto' => false, 'na' => $na, 'by' => $done ? ($v['by'] ?? '') : '', 'at' => $done ? ($v['at'] ?? '') : '']; }
    return $checks;
};
$launchOut = function ($L) use ($readiness) { $c = $readiness($L); return ['id' => (int)$L['id'], 'name' => $L['name'], 'branch' => $L['branch_id'], 'type' => $L['type'], 'grill' => !empty($L['grill']), 'status' => $L['status'], 'createdAt' => $L['created_at'], 'liveAt' => $L['live_at'], 'passed' => count(array_filter($c, fn($x) => $x['ok'])), 'total' => count($c), 'checks' => $c]; };
$runOut = function ($r) { if (isset($r['id'])) $r['id'] = (int)$r['id']; foreach (['done', 'total', 'fails', 'attention', 'resolved'] as $k) if (isset($r[$k])) $r[$k] = (int)$r[$k]; if (isset($r['answers'])) $r['answers'] = (object)(json_decode($r['answers'] ?: '{}', true) ?: []); return $r; };

// ---------- catalogue ----------
if ($a === 'catalogue' && $M === 'GET') {
    require_staff();
    $courses = array_map(fn($c) => ['code' => $c['code'], 'title' => $c['title'], 'sop' => $c['sop'], 'forRoles' => $c['for_roles'], 'lessons' => $c['lessons'], 'quiz' => array_map(fn($q) => ['q' => $q['q'], 'o' => $q['o']], $c['quiz'])], $CAT['courses']);
    json_response(['passmark' => $CAT['passmark'], 'validMonths' => $CAT['valid_months'], 'core' => $CAT['core'], 'grill' => $CAT['grill'], 'checklists' => $CAT['checklists'], 'courses' => $courses]);
}
// ---------- checklists ----------
if ($a === 'checklists' && $b1 === 'run' && $M === 'GET') {
    require_staff(); $cl = $CL[$_GET['code'] ?? ''] ?? null; $br = $branchOk($_GET['branch'] ?? ''); if (!$cl || !$br) json_error('Unknown checklist or branch');
    $date = $okDay($_GET['date'] ?? '') ? $_GET['date'] : $eatDay();
    $r = $one('SELECT * FROM pb_runs WHERE code = ? AND branch = ? AND run_date = ?', [$cl['code'], $br['id'], $date]);
    json_response(['run' => $r ? $runOut($r) : null, 'date' => $date]);
}
if ($a === 'today' && $M === 'GET') {
    require_staff(); $br = $branchOk($_GET['branch'] ?? ''); if (!$br) json_error('Unknown branch'); $date = $eatDay(); $runs = [];
    foreach ($all('SELECT code, status, done, total, fails, attention, resolved FROM pb_runs WHERE branch = ? AND run_date = ?', [$br['id'], $date]) as $r) $runs[$r['code']] = $runOut($r);
    json_response(['date' => $date, 'branch' => $br['id'], 'runs' => (object)$runs]);
}
if ($a === 'checklists' && $b1 === 'run' && $M === 'POST') {
    require_staff(); $cl = $CL[$body['code'] ?? ''] ?? null; $br = $branchOk($body['branch'] ?? ''); if (!$cl || !$br) json_error('Unknown checklist or branch');
    $today = $eatDay(); $date = $okDay($body['date'] ?? '') ? $body['date'] : $today;
    if ($date > $today || $date < $addDays($today, -1)) json_error('You can fill in today\'s or yesterday\'s checklist only');
    $ans = $sanitise($cl, $body['answers'] ?? []); $ev = $evaluate($cl, $ans);
    $ex = $one('SELECT * FROM pb_runs WHERE code = ? AND branch = ? AND run_date = ?', [$cl['code'], $br['id'], $date]);
    if ($ex && $ex['status'] === 'complete') json_error('This checklist was already completed and signed', 409);
    $status = 'open'; $by = ''; $at = null;
    if (!empty($body['complete'])) {
        if ($ev['done'] < $ev['total']) json_error('Answer every line first (' . ($ev['total'] - $ev['done']) . ' left)');
        if ($ev['missingNote']) json_error('Write what you did about each line that failed');
        $status = 'complete'; $by = $who(); $at = $now();
    }
    $js = json_encode((object)$ans);
    if ($ex) $run('UPDATE pb_runs SET answers=?, done=?, total=?, fails=?, attention=?, status=?, completed_by=?, completed_at=?, updated_at=? WHERE id=?', [$js, $ev['done'], $ev['total'], $ev['fails'], $ev['attention'], $status, $by, $at, $now(), $ex['id']]);
    else $run('INSERT INTO pb_runs (code, branch, run_date, status, answers, done, total, fails, attention, started_by, completed_by, completed_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [$cl['code'], $br['id'], $date, $status, $js, $ev['done'], $ev['total'], $ev['fails'], $ev['attention'], $who(), $by, $at, $now()]);
    if ($status === 'complete') $audit('checklist-' . $cl['code'] . ($ev['attention'] ? '-attention' : ''), $br['id'] . ' ' . $date . ' fails ' . $ev['fails'] . ' critical ' . $ev['attention']);
    json_response(['ok' => true, 'status' => $status, 'done' => $ev['done'], 'total' => $ev['total'], 'fails' => $ev['fails'], 'attention' => $ev['attention']]);
}
// ---------- manager view ----------
if ($a === 'compliance' && $M === 'GET') {
    require_admin(); $to = $okDay($_GET['to'] ?? '') ? $_GET['to'] : $eatDay(); $from = $okDay($_GET['from'] ?? '') ? $_GET['from'] : $addDays($to, -6);
    if ($from > $to) { $t = $from; $from = $to; $to = $t; } if (strtotime($to . ' UTC') - strtotime($from . ' UTC') > 92 * 86400) $from = $addDays($to, -92);
    $days = (int)round((strtotime($to . ' UTC') - strtotime($from . ' UTC')) / 86400) + 1; $daily = count(array_filter($CAT['checklists'], fn($c) => $c['shift'] !== 'weekly'));
    $rows = []; foreach ($all("SELECT branch, COUNT(*) AS done, SUM(fails) AS fails, SUM(CASE WHEN attention>0 AND resolved=0 THEN 1 ELSE 0 END) AS open_attention FROM pb_runs WHERE status='complete' AND run_date BETWEEN ? AND ? AND code != 'weekly' GROUP BY branch", [$from, $to]) as $r) $rows[$r['branch']] = $r;
    $out = [];
    foreach ($all('SELECT id, name FROM branches ORDER BY is_main DESC, sort_order, name') as $b) { $r = $rows[$b['id']] ?? ['done' => 0, 'fails' => 0, 'open_attention' => 0]; $exp = $days * $daily; $out[] = ['branch' => $b['id'], 'name' => $b['name'], 'expected' => $exp, 'done' => (int)$r['done'], 'pct' => $exp ? (int)round(100 * $r['done'] / $exp) : 0, 'fails' => (int)$r['fails'], 'openAttention' => (int)$r['open_attention']]; }
    $att = [];
    foreach ($all("SELECT id, code, branch, run_date, fails, attention, completed_by, answers FROM pb_runs WHERE status='complete' AND attention > 0 AND resolved = 0 ORDER BY run_date DESC LIMIT 100") as $r) {
        $cl = $CL[$r['code']]; $ans = json_decode($r['answers'] ?: '{}', true) ?: []; $items = [];
        foreach ($cl['items'] as $it) if (!empty($it['crit'])) { $x = $ans[$it['id']] ?? []; $bad = $it['type'] === 'tick' ? (($x['ok'] ?? null) === false) : ($it['type'] === 'temp' ? (isset($x['value']) && ($x['value'] < $it['min'] || $x['value'] > $it['max'])) : false); if ($bad) $items[] = ['id' => $it['id'], 't' => $it['t'], 'value' => $x['value'] ?? null, 'note' => $x['note'] ?? '']; }
        $att[] = ['id' => (int)$r['id'], 'code' => $r['code'], 'title' => $cl['title'], 'branch' => $r['branch'], 'date' => $r['run_date'], 'by' => $r['completed_by'], 'items' => $items];
    }
    json_response(['from' => $from, 'to' => $to, 'days' => $days, 'branches' => $out, 'attention' => $att]);
}
if ($a === 'runs' && $b1 === '' && $M === 'GET') {
    require_admin(); $br = $branchOk($_GET['branch'] ?? ''); $date = $okDay($_GET['date'] ?? '') ? $_GET['date'] : $eatDay(); if (!$br) json_error('Unknown branch');
    json_response(['date' => $date, 'runs' => array_map($runOut, $all('SELECT id, code, status, done, total, fails, attention, resolved, resolve_note, started_by, completed_by, completed_at FROM pb_runs WHERE branch = ? AND run_date = ? ORDER BY id', [$br['id'], $date]))]);
}
if ($a === 'runs' && ctype_digit($b1) && $b2 === 'resolve' && $M === 'PATCH') {
    require_admin(); $r = $one('SELECT * FROM pb_runs WHERE id = ?', [(int)$b1]); if (!$r) json_error('Not found', 404);
    $note = $clean($body['note'] ?? '', 300); if (mb_strlen($note) < 3) json_error('Write what was done to fix it');
    $run('UPDATE pb_runs SET resolved = 1, resolve_note = ? WHERE id = ?', [$note . ' (' . $who() . ')', $r['id']]); $audit('checklist-resolved', $r['branch'] . ' ' . $r['run_date'] . ' ' . $r['code']); json_response(['ok' => true]);
}
// ---------- training ----------
if ($a === 'training' && $b1 === 'attempt' && $M === 'POST') {
    require_admin(); $co = $CO[$body['course'] ?? ''] ?? null; $br = $branchOk($body['branch'] ?? ''); $name = $clean($body['staff_name'] ?? '', 80);
    if (!$co || !$br || mb_strlen($name) < 3) json_error('Staff name, branch and course are needed');
    $ans = $body['answers'] ?? null; if (!is_array($ans) || count($ans) !== count($co['quiz'])) json_error('Answer every question');
    $right = 0; $review = [];
    foreach ($co['quiz'] as $i => $q) { $ok = (int)$ans[$i] === (int)$q['a']; if ($ok) $right++; $review[] = ['ok' => $ok, 'answer' => (int)$q['a'], 'why' => $q['why']]; }
    $score = (int)round(100 * $right / count($co['quiz'])); $passed = $score >= (int)$CAT['passmark'] ? 1 : 0;
    $run('INSERT INTO pb_training (staff_name, staff_ref, branch, course, score, passed, recorded_by, taken_at) VALUES (?,?,?,?,?,?,?,?)', [$name, substr(preg_replace('/\D/', '', $clean($body['staff_ref'] ?? '', 20)), -9), $br['id'], $co['code'], $score, $passed, $who(), $now()]);
    $id = (int)$pdo->lastInsertId(); $audit('training-attempt', $name . ' ' . $co['code'] . ' ' . $score . '%');
    json_response(['ok' => true, 'id' => $id, 'score' => $score, 'passed' => !!$passed, 'passmark' => (int)$CAT['passmark'], 'review' => $review]);
}
if ($a === 'training' && $b1 === 'matrix' && $M === 'GET') {
    require_admin(); $br = $branchOk($_GET['branch'] ?? ''); if (!$br) json_error('Unknown branch'); $staff = [];
    foreach ($certRows($br['id']) as $r) { $k = $r['ref'] ?: strtolower($r['staff']); if (!isset($staff[$k])) $staff[$k] = ['name' => $r['staff'], 'ref' => $r['ref'], 'courses' => []]; $staff[$k]['courses'][$r['course']] = $r; }
    foreach ($staff as &$s) $s['courses'] = (object)$s['courses']; unset($s);
    json_response(['branch' => $br['id'], 'courses' => array_map(fn($c) => ['code' => $c['code'], 'title' => $c['title']], $CAT['courses']), 'staff' => array_values($staff)]);
}
if ($a === 'training' && ctype_digit($b1) && $b2 === 'practical' && $M === 'PATCH') {
    require_admin(); $r = $one('SELECT * FROM pb_training WHERE id = ?', [(int)$b1]); if (!$r || !$r['passed']) json_error('Not found', 404);
    $done = (($body['done'] ?? true) === false) ? 0 : 1;
    $run('UPDATE pb_training SET practical = ?, practical_by = ?, practical_at = ? WHERE id = ?', [$done, $done ? $who() : '', $done ? $now() : null, $r['id']]); $audit('training-practical', $r['staff_name'] . ' ' . $r['course'] . ' ' . $done); json_response(['ok' => true]);
}
// ---------- new-branch wizard ----------
if ($a === 'launches') {
    require_admin();
    if ($b1 === '' && $M === 'GET') json_response(['launches' => array_map(function ($L) use ($launchOut) { $o = $launchOut($L); unset($o['checks']); return $o; }, $all('SELECT * FROM pb_launches ORDER BY id DESC'))]);
    if ($b1 === '' && $M === 'POST') {
        $name = $clean($body['name'] ?? '', 60); $address = $clean($body['address'] ?? '', 160); $phone = $clean($body['phone'] ?? '', 20); $area = $clean($body['area'] ?? '', 60);
        $lat = $num($body['lat'] ?? null); $lng = $num($body['lng'] ?? null);
        if (mb_strlen($name) < 3 || $area === '') json_error('Branch name and area are needed');
        if (($lat !== null && ($lat < -5 || $lat > 5)) || ($lng !== null && ($lng < 33 || $lng > 43))) json_error('The map position does not look like a place in Kenya');
        if ($phone !== '' && !preg_match('/^\+?[\d][\d\s\-()]{5,19}$/', $phone)) json_error('Phone number does not look right');
        $slug = function ($s) { $s = strtolower(preg_replace('/\(.*?\)/', '', (string)$s)); return substr(trim(preg_replace('/[^a-z0-9]+/', '-', $s), '-'), 0, 40); };
        $id = $slug($name) ?: 'branch'; $n = 2; while ($one('SELECT 1 FROM branches WHERE id = ?', [$id])) $id = substr($slug($name), 0, 36) . '-' . $n++;
        $type = ($body['type'] ?? '') === 'franchise' ? 'franchise' : 'own'; $so = (int)array_values($one('SELECT COALESCE(MAX(sort_order),0)+1 FROM branches'))[0];
        $pdo->beginTransaction();
        try {
            $run('INSERT INTO branches (id, name, area, address, `query`, lat, lng, phone, hours, is_main, listed, sort_order) VALUES (?,?,?,?,?,?,?,?,?,0,0,?)', [$id, $name, $area, $address, $clean($body['query'] ?? '', 160) ?: ($name . ' ' . $area), $lat, $lng, $phone, $clean($body['hours'] ?? '', 60) ?: 'Open 24 hours', $so]);
            $run('INSERT INTO pb_launches (name, branch_id, type, grill, created_by, created_at) VALUES (?,?,?,?,?,?)', [$name, $id, $type, !empty($body['grill']) ? 1 : 0, $who(), $now()]); $lid = (int)$pdo->lastInsertId(); $pdo->commit();
        } catch (Throwable $e) { $pdo->rollBack(); json_error('Could not create the branch', 500); }
        $audit('branch-launch-start', $id); json_response(['ok' => true, 'id' => $lid, 'branch' => $id], 201);
    }
    if (ctype_digit($b1)) {
        $L = $one('SELECT * FROM pb_launches WHERE id = ?', [(int)$b1]); if (!$L) json_error('Not found', 404);
        if ($b2 === '' && $M === 'GET') json_response(['launch' => $launchOut($L), 'inherits' => ['products' => (int)array_values($one('SELECT COUNT(*) FROM products'))[0], 'checklists' => count($CAT['checklists']), 'checklistItems' => array_sum(array_map(fn($c) => count($c['items']), $CAT['checklists'])), 'courses' => count($CAT['courses']), 'questions' => array_sum(array_map(fn($c) => count($c['quiz']), $CAT['courses'])), 'note' => 'The branch uses the same menu, prices, delivery rules, order messages, reward rules and checklists as every other branch. Change them once in Operations.']]);
        if ($b2 === 'manual' && $M === 'PATCH') {
            $k = (string)($body['key'] ?? ''); if (!in_array($k, array_column($CAT['manual'], 'k'), true)) json_error('Unknown item');
            $man = json_decode($L['manual'] ?: '{}', true) ?: []; $man[$k] = (($body['done'] ?? true) === false) ? ['done' => false] : ['done' => true, 'by' => $who(), 'at' => substr($now(), 0, 10)];
            $run('UPDATE pb_launches SET manual = ? WHERE id = ?', [json_encode($man), $L['id']]); $audit('branch-launch-tick', $L['branch_id'] . ' ' . $k); json_response(['ok' => true]);
        }
        if ($b2 === 'golive' && $M === 'POST') {
            $bad = array_values(array_filter($readiness($L), fn($c) => !$c['ok'])); if ($bad) json_response(['error' => 'Not ready yet: ' . count($bad) . ' item(s) still open', 'open' => array_map(fn($c) => $c['t'], $bad)], 409);
            $pdo->beginTransaction(); $run('UPDATE branches SET listed = 1 WHERE id = ?', [$L['branch_id']]); $run("UPDATE pb_launches SET status = 'live', live_at = ? WHERE id = ?", [$now(), $L['id']]); $pdo->commit();
            $audit('branch-golive', $L['branch_id']); json_response(['ok' => true]);
        }
    }
}
json_error('Not found', 404);
