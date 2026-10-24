<?php
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../lib/report_data.php';
cors_and_preflight();
require_admin();
header('Cache-Control: no-store');
$pdo = get_db(); $method = $_SERVER['REQUEST_METHOD']; $id = (int)($_GET['id'] ?? 0);

function clean_expense(array $b): array {
    $date = trim((string)($b['expense_date'] ?? '')); $cat = trim((string)($b['category'] ?? '')); $amt = (int)round((float)($b['amount'] ?? 0));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) json_error('Pick a valid date');
    if (!in_array($cat, EXPENSE_CATEGORIES, true)) json_error('Pick a category from the list');
    if ($amt <= 0 || $amt > 100000000) json_error('Enter an amount above 0');
    return [$date, $cat, substr((string)($b['description'] ?? ''), 0, 200), $amt, substr((string)($b['branch'] ?? ''), 0, 80) ?: null, substr((string)($b['paid_via'] ?? ''), 0, 40) ?: null];
}
if ($method === 'GET') {
    [$from, $to] = report_range($_GET);
    json_response(['expenses' => report_load_expenses($pdo, $from, $to, (string)($_GET['branch'] ?? '')), 'categories' => EXPENSE_CATEGORIES]);
}
if ($method === 'POST') {
    $v = clean_expense(read_json_body());
    $pdo->prepare('INSERT INTO expenses (expense_date, category, description, amount, branch, paid_via) VALUES (?, ?, ?, ?, ?, ?)')->execute($v);
    json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId()], 201);
}
if ($method === 'PUT' && $id) {
    $v = clean_expense(read_json_body()); $v[] = $id;
    $st = $pdo->prepare('UPDATE expenses SET expense_date=?, category=?, description=?, amount=?, branch=?, paid_via=? WHERE id=?'); $st->execute($v);
    json_response(['ok' => true]);
}
if ($method === 'DELETE' && $id) {
    $st = $pdo->prepare('DELETE FROM expenses WHERE id = ?'); $st->execute([$id]);
    if (!$st->rowCount()) json_error('Expense not found', 404);
    json_response(['ok' => true]);
}
json_error('Method not allowed', 405);
