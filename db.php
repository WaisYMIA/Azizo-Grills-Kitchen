<?php
require_once __DIR__ . '/config.php';

function get_db(): PDO {
    static $pdo = null;
    if ($pdo !== null) return $pdo;

    $dsn = "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4";
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);

    // Idempotent schema creation — safe to run on every request (CREATE TABLE
    // IF NOT EXISTS is cheap once the tables exist), so there's no separate
    // "migration" step to remember. schema.sql has the same thing for anyone
    // who'd rather import it by hand via phpMyAdmin.
    $pdo->exec(file_get_contents(__DIR__ . '/schema.sql'));

    // Databases created before v1.2 already have these tables without the new cost columns; add them once.
    foreach ([['products', 'cost_price'], ['order_items', 'cost_price'], ['products', 'in_stock'], ['orders', 'notes'], ['orders', 'area'], ['orders', 'recurring']] as [$table, $col]) {
        $has = $pdo->prepare('SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?');
        $has->execute([$table, $col]);
        if (!(int)$has->fetchColumn()) {
            $def = $col === 'in_stock' ? 'TINYINT(1) NOT NULL DEFAULT 1' : ($col === 'notes' ? 'VARCHAR(300) NULL' : (in_array($col, ['area', 'recurring'], true) ? 'VARCHAR(80) NULL' : 'INT NOT NULL DEFAULT 0'));
            $pdo->exec("ALTER TABLE `$table` ADD COLUMN `$col` $def");
        }
    }

    // v2.0: first run only - load the starter recipes and blog posts.
    if ((int)$pdo->query('SELECT COUNT(*) FROM recipes')->fetchColumn() === 0) {
        $seed = json_decode((string)@file_get_contents(__DIR__ . '/data/recipes-seed.json'), true);
        if (is_array($seed)) {
            $ic = $pdo->prepare('INSERT IGNORE INTO recipe_cats (name, icon, sort_order) VALUES (?, ?, ?)');
            foreach ($seed['categories'] as $c) $ic->execute([$c['name'], $c['icon'] ?? '', (int)$c['sort']]);
            $ir = $pdo->prepare('INSERT INTO recipes (kind, slug, title, category, style, cuisine, difficulty, prep_min, cook_min, servings, summary, ingredients, steps, tips, body, tags, badge, image, featured, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
            foreach ($seed['recipes'] as $r) {
                $ir->execute([$r['kind'], $r['slug'], $r['title'], $r['category'], $r['style'], $r['cuisine'], $r['difficulty'], (int)$r['prep_min'], (int)$r['cook_min'], (int)$r['servings'], $r['summary'],
                    implode("\n", $r['ingredients'] ?? []), implode("\n", $r['steps'] ?? []), $r['tips'] ?? '', $r['body'] ?? '', $r['tags'] ?? '', $r['badge'] ?? '', $r['image'] ?? '', !empty($r['featured']) ? 1 : 0, 'published', $r['created_at'] . ' 00:00:00', $r['created_at'] . ' 00:00:00']);
            }
        }
    }

    // v3.1: Azizo Kitchens columns added to databases created by v3.0.
    foreach ([['kk_orders', 'accepted_at', 'DATETIME NULL'], ['kk_orders', 'picked_at', 'DATETIME NULL'], ['kk_orders', 'delivered_at', 'DATETIME NULL'], ['kk_orders', 'rider_id', 'INT NULL'], ['kk_orders', 'delivery_code', "VARCHAR(6) NOT NULL DEFAULT ''"],
        ['kk_orders', 'promo_code', "VARCHAR(30) NOT NULL DEFAULT ''"], ['kk_orders', 'discount', 'INT NOT NULL DEFAULT 0'], ['kk_orders', 'paid', 'TINYINT(1) NOT NULL DEFAULT 0'], ['kk_orders', 'mpesa_checkout', "VARCHAR(128) NOT NULL DEFAULT ''"],
        ['kk_orders', 'mpesa_receipt', "VARCHAR(40) NOT NULL DEFAULT ''"], ['kk_orders', 'corp_id', 'INT NULL'], ['kk_orders', 'reassigned_from', 'INT NULL'], ['kk_orders', 'region', "VARCHAR(80) NOT NULL DEFAULT ''"], ['kk_dishes', 'tags', "VARCHAR(120) NOT NULL DEFAULT ''"]] as [$table, $col, $def]) {
        $has = $pdo->prepare('SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?');
        $has->execute([$table, $col]);
        if (!(int)$has->fetchColumn()) {
            $pdo->exec("ALTER TABLE `$table` ADD COLUMN `$col` $def");
            if ($table === 'kk_dishes' && $col === 'tags') {
                $veg = ['githeri', 'ndengu', 'sukuma', 'kachumbari', 'extra ugali', 'chapati (2', 'extra rice']; $hot = ['biryani', 'pilau', 'kuku paka']; $fish = ['tilapia', 'omena', 'fish'];
                foreach ($pdo->query('SELECT id, name FROM kk_dishes')->fetchAll() as $d) {
                    $n = strtolower($d['name']); $t = [];
                    foreach ($veg as $x) if (strpos($n, $x) !== false) { $t[] = 'vegetarian'; break; }
                    foreach ($hot as $x) if (strpos($n, $x) !== false) { $t[] = 'spicy'; break; }
                    foreach ($fish as $x) if (strpos($n, $x) !== false) { $t[] = 'fish'; break; }
                    if ($t) $pdo->prepare('UPDATE kk_dishes SET tags = ? WHERE id = ?')->execute([implode(',', $t), $d['id']]);
                }
            }
        }
    }

    // v3.0: first run only - load the Azizo Kitchens starter dishes and settings.
    if ((int)$pdo->query('SELECT COUNT(*) FROM kk_dishes')->fetchColumn() === 0) {
        $seed = json_decode((string)@file_get_contents(__DIR__ . '/data/kitchens-seed.json'), true);
        if (is_array($seed)) {
            $ik = $pdo->prepare('INSERT INTO kk_dishes (slug, name, tradition, category, meal, price, serves, description, components, method, options, packaging, tips, image, active, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)');
            foreach ($seed['dishes'] as $d) $ik->execute([$d['slug'], $d['name'], $d['tradition'], $d['category'], $d['meal'], (int)$d['price'], (int)$d['serves'], $d['description'], implode("\n", $d['components']), implode("\n", $d['method']), json_encode($d['options'] ?? []), $d['packaging'], $d['tips'] ?? '', $d['image'] ?? '', (int)$d['sort']]);
            $pdo->prepare('INSERT IGNORE INTO kk_meta (skey, svalue) VALUES (?, ?)')->execute(['kk_settings', json_encode($seed['settings'])]);
        }
    }

    return $pdo;
}
