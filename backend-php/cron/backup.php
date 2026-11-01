<?php
// Daily database backup. cPanel > Cron Jobs > once a day, e.g.  15 2 * * *  php /home/USER/public_html/backend-php/cron/backup.php
// Writes a compressed SQL dump to backend-php/private/backups/ and keeps the newest 14. Download a copy off the server every week.
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require_once __DIR__ . '/../db.php';
$pdo = get_db();
$dir = __DIR__ . '/../private/backups'; if (!is_dir($dir)) mkdir($dir, 0750, true);
if (!is_file($dir . '/.htaccess')) file_put_contents($dir . '/.htaccess', "Require all denied\n");
$file = $dir . '/azizo-' . gmdate('Ymd-His') . '.sql.gz'; $gz = gzopen($file, 'wb9');
gzwrite($gz, "-- Azizo backup " . gmdate('c') . "\nSET FOREIGN_KEY_CHECKS=0;\n");
foreach ($pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_NUM) as $t) {
    $t = $t[0]; $c = $pdo->query('SHOW CREATE TABLE `' . $t . '`')->fetch(PDO::FETCH_NUM);
    gzwrite($gz, "\nDROP TABLE IF EXISTS `$t`;\n" . $c[1] . ";\n");
    $q = $pdo->query('SELECT * FROM `' . $t . '`', PDO::FETCH_ASSOC);
    foreach ($q as $row) gzwrite($gz, 'INSERT INTO `' . $t . '` (`' . implode('`,`', array_keys($row)) . '`) VALUES (' . implode(',', array_map(fn($v) => $v === null ? 'NULL' : $pdo->quote((string)$v), $row)) . ");\n");
}
gzwrite($gz, "\nSET FOREIGN_KEY_CHECKS=1;\n"); gzclose($gz);
$all = glob($dir . '/azizo-*.sql.gz') ?: []; rsort($all); foreach (array_slice($all, 14) as $old) @unlink($old);
echo "Backup written: " . basename($file) . " (" . round(filesize($file) / 1024) . " KB)\n";
