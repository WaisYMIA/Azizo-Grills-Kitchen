<?php
// Accountant export for the PHP backend: the full sales ledger as an .xlsx (one row per order).
// (The Node backend's pack also carries P&L, products, branches, payments and expenses sheets; on PHP use the Reports tab's CSV buttons for those.)
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
require_once __DIR__ . '/../../lib/xlsx_writer.php';
require_once __DIR__ . '/../../lib/report_data.php';
cors_and_preflight();
require_admin();
$pdo = get_db(); [$from, $to] = report_range($_GET);
$orders = report_load_orders($pdo, $from, $to, (string)($_GET['branch'] ?? ''));
$headers = ['Order #', 'Date', 'Time', 'Customer', 'Phone', 'Branch', 'Fulfilment', 'Payment', 'M-Pesa receipt', 'Status', 'Items KSh', 'Delivery KSh', 'Total KSh', 'Promo'];
$rows = array_map(function ($o) { $l = r_local($o['created_at'], (int)TZ_OFFSET_HOURS);
    return [$o['id'], $l['date'], $l['time'], $o['customer_name'] ?? '', $o['customer_phone'], $o['branch'] ?? '', $o['fulfilment'], $o['payment_method'], $o['mpesa_receipt'] ?? '', $o['status'], $o['items_subtotal'], $o['delivery_fee'], $o['total'], $o['promo_code'] ?? '']; }, $orders);
$tmp = tempnam(sys_get_temp_dir(), 'azizo_pack_') . '.xlsx';
xlsx_write($headers, $rows, $tmp);
header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
header("Content-Disposition: attachment; filename=\"azizo-sales-ledger-$from-to-$to.xlsx\"");
readfile($tmp); @unlink($tmp); exit;
