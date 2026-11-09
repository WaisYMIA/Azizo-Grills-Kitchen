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
    foreach ([['products', 'cost_price'], ['order_items', 'cost_price'], ['products', 'in_stock'], ['orders', 'notes'], ['orders', 'area'], ['orders', 'recurring'], ['orders', 'partner_id']] as [$table, $col]) {
        $has = $pdo->prepare('SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?');
        $has->execute([$table, $col]);
        if (!(int)$has->fetchColumn()) {
            $def = $col === 'in_stock' ? 'TINYINT(1) NOT NULL DEFAULT 1' : ($col === 'notes' ? 'VARCHAR(300) NULL' : (in_array($col, ['area', 'recurring'], true) ? 'VARCHAR(80) NULL' : ($col === 'partner_id' ? 'INT NULL' : 'INT NOT NULL DEFAULT 0')));
            $pdo->exec("ALTER TABLE `$table` ADD COLUMN `$col` $def");
        }
    }

    // v4.1: partner token version (for databases created by v4.0) and indexes that keep many partners/orders fast.
    $has = $pdo->prepare('SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?');
    $has->execute(['mk_partners', 'token_ver']); if (!(int)$has->fetchColumn()) $pdo->exec('ALTER TABLE mk_partners ADD COLUMN token_ver INT NOT NULL DEFAULT 0');
    // v4.3: every order carries a tamper-proof signature (see lib/security.php order_sign)
    $has->execute(['kk_orders', 'sig']); if (!(int)$has->fetchColumn()) $pdo->exec('ALTER TABLE kk_orders ADD COLUMN sig CHAR(64) NULL');
    $pdo->exec("CREATE TABLE IF NOT EXISTS team_accounts (id INT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(30) NOT NULL UNIQUE, name VARCHAR(60) NOT NULL, role VARCHAR(10) NOT NULL, password_hash VARCHAR(255) NOT NULL, active TINYINT NOT NULL DEFAULT 1, last_login VARCHAR(19) NOT NULL DEFAULT '', created_at VARCHAR(19) NOT NULL DEFAULT '', created_by VARCHAR(60) NOT NULL DEFAULT '') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS ai_usage (id INT AUTO_INCREMENT PRIMARY KEY, ts VARCHAR(19) NOT NULL DEFAULT '', feature VARCHAR(30) NOT NULL DEFAULT '', model VARCHAR(40) NOT NULL DEFAULT '', in_tok INT NOT NULL DEFAULT 0, out_tok INT NOT NULL DEFAULT 0, status VARCHAR(12) NOT NULL DEFAULT 'ok', INDEX idx_aiu (ts)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS ops_settings (k VARCHAR(40) PRIMARY KEY, v TEXT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS ops_ref_codes (customer_id INT PRIMARY KEY, code VARCHAR(12) NOT NULL UNIQUE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS ops_referrals (id INT AUTO_INCREMENT PRIMARY KEY, code VARCHAR(12), referrer_id INT, referrer_phone9 VARCHAR(12), referred_id INT, referred_phone9 VARCHAR(12) UNIQUE, referred_name VARCHAR(80) NOT NULL DEFAULT '', status VARCHAR(10) NOT NULL DEFAULT 'pending', created_at VARCHAR(19), paid_at VARCHAR(19)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS ops_franchise (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(80), phone VARCHAR(20), email VARCHAR(120), town VARCHAR(80), budget VARCHAR(12), premises VARCHAR(8), timeline VARCHAR(8), experience TEXT, message TEXT, status VARCHAR(12) NOT NULL DEFAULT 'new', note TEXT, handled_by VARCHAR(60), created_at DATETIME, updated_at DATETIME) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS pb_runs (id INT AUTO_INCREMENT PRIMARY KEY, code VARCHAR(12) NOT NULL, branch VARCHAR(40) NOT NULL, run_date VARCHAR(10) NOT NULL, status VARCHAR(10) NOT NULL DEFAULT 'open', answers MEDIUMTEXT, done INT DEFAULT 0, total INT DEFAULT 0, fails INT DEFAULT 0, attention INT DEFAULT 0, resolved TINYINT DEFAULT 0, resolve_note VARCHAR(400) DEFAULT '', started_by VARCHAR(80) DEFAULT '', completed_by VARCHAR(80) DEFAULT '', completed_at DATETIME NULL, updated_at DATETIME NULL, UNIQUE KEY uq_pb_run (code, branch, run_date)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS pb_training (id INT AUTO_INCREMENT PRIMARY KEY, staff_name VARCHAR(80) NOT NULL, staff_ref VARCHAR(20) DEFAULT '', branch VARCHAR(40) NOT NULL, course VARCHAR(8) NOT NULL, score INT NOT NULL, passed TINYINT NOT NULL, practical TINYINT DEFAULT 0, practical_by VARCHAR(80) DEFAULT '', practical_at DATETIME NULL, recorded_by VARCHAR(80) DEFAULT '', taken_at DATETIME NOT NULL, KEY idx_pb_tr (branch, course)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS pb_launches (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(60) NOT NULL, branch_id VARCHAR(40) NOT NULL, type VARCHAR(10) DEFAULT 'own', grill TINYINT DEFAULT 0, status VARCHAR(10) DEFAULT 'draft', manual TEXT, created_by VARCHAR(80) DEFAULT '', created_at DATETIME NULL, live_at DATETIME NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS bo_settings (k VARCHAR(30) PRIMARY KEY, v VARCHAR(20)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS bo_purchases (id INT AUTO_INCREMENT PRIMARY KEY, day VARCHAR(10) NOT NULL, branch VARCHAR(40) NOT NULL, supplier VARCHAR(80) DEFAULT '', product VARCHAR(80) NOT NULL, kg DECIMAL(10,2) NOT NULL, cost INT NOT NULL, ref VARCHAR(40) DEFAULT '', by_name VARCHAR(80) DEFAULT '', created_at DATETIME NULL, KEY idx_bo_pur (branch, day)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS bo_waste (id INT AUTO_INCREMENT PRIMARY KEY, day VARCHAR(10) NOT NULL, branch VARCHAR(40) NOT NULL, product VARCHAR(80) NOT NULL, kg DECIMAL(10,2) NOT NULL, reason VARCHAR(12) DEFAULT 'other', note VARCHAR(200) DEFAULT '', by_name VARCHAR(80) DEFAULT '', created_at DATETIME NULL, KEY idx_bo_was (branch, day)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS bo_franchisees (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(80) NOT NULL, phone VARCHAR(20) DEFAULT '', email VARCHAR(120) DEFAULT '', branch_id VARCHAR(40) DEFAULT '', enquiry_id INT NULL, stage VARCHAR(12) DEFAULT 'enquiry', agreement_at VARCHAR(10) NULL, fee_paid_at VARCHAR(10) NULL, royalty_pct DECIMAL(5,2) NULL, notes VARCHAR(500) DEFAULT '', created_by VARCHAR(80) DEFAULT '', created_at DATETIME NULL, updated_at DATETIME NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS bo_royalties (id INT AUTO_INCREMENT PRIMARY KEY, franchisee_id INT NOT NULL, period VARCHAR(7) NOT NULL, gross INT NOT NULL, refunds INT DEFAULT 0, royalty_pct DECIMAL(5,2), royalty INT, marketing_pct DECIMAL(5,2), marketing INT, total INT, orders INT DEFAULT 0, status VARCHAR(10) DEFAULT 'issued', issued_at DATETIME NULL, paid_at DATETIME NULL, note VARCHAR(200) DEFAULT '', UNIQUE KEY uq_bo_roy (franchisee_id, period)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS bo_portal (franchisee_id INT PRIMARY KEY, username VARCHAR(30) NOT NULL, password_hash VARCHAR(100) NOT NULL, active TINYINT DEFAULT 1, last_login DATETIME NULL, created_at DATETIME NULL, UNIQUE KEY uq_bo_portal (username)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS bo_reminders (id INT AUTO_INCREMENT PRIMARY KEY, royalty_id INT NOT NULL, at DATETIME NULL, by_name VARCHAR(80) DEFAULT '', KEY idx_bo_rem (royalty_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS bo_yield (id INT AUTO_INCREMENT PRIMARY KEY, day VARCHAR(10) NOT NULL, branch VARCHAR(40) NOT NULL, product VARCHAR(80) NOT NULL, kg_in DECIMAL(10,2) NOT NULL, kg_out DECIMAL(10,2) NOT NULL, trim_kg DECIMAL(10,2) DEFAULT 0, note VARCHAR(200) DEFAULT '', by_name VARCHAR(80) DEFAULT '', created_at DATETIME NULL, KEY idx_bo_yld (branch, day)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS bo_rejects (id INT AUTO_INCREMENT PRIMARY KEY, day VARCHAR(10) NOT NULL, branch VARCHAR(40) NOT NULL, supplier VARCHAR(80) NOT NULL, product VARCHAR(80) DEFAULT '', kg DECIMAL(10,2) NOT NULL, reason VARCHAR(12) DEFAULT 'other', note VARCHAR(200) DEFAULT '', by_name VARCHAR(80) DEFAULT '', created_at DATETIME NULL, KEY idx_bo_rej (branch, day)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS ops_subs (id INT AUTO_INCREMENT PRIMARY KEY, customer_id INT NOT NULL, phone9 VARCHAR(12), name VARCHAR(80) NOT NULL DEFAULT '', items_json TEXT NOT NULL, fulfilment VARCHAR(10) NOT NULL DEFAULT 'delivery', branch VARCHAR(40) NOT NULL DEFAULT '', partner_id INT NULL, freq VARCHAR(12) NOT NULL DEFAULT 'weekly', weekday INT NOT NULL DEFAULT 6, next_date VARCHAR(10), status VARCHAR(10) NOT NULL DEFAULT 'active', created_at VARCHAR(19), last_notified VARCHAR(10) NOT NULL DEFAULT '') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS ops_refunds (id INT AUTO_INCREMENT PRIMARY KEY, order_id INT NOT NULL, partner_id INT NULL, phone9 VARCHAR(12), name VARCHAR(80) NOT NULL DEFAULT '', reason VARCHAR(20), details TEXT, amount_req INT NOT NULL DEFAULT 0, amount_ok INT NOT NULL DEFAULT 0, status VARCHAR(10) NOT NULL DEFAULT 'requested', resolution VARCHAR(300) NOT NULL DEFAULT '', handled_by VARCHAR(60) NOT NULL DEFAULT '', mpesa_ref VARCHAR(30) NOT NULL DEFAULT '', created_at VARCHAR(19), decided_at VARCHAR(19), paid_at VARCHAR(19)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS ops_cashups (id INT AUTO_INCREMENT PRIMARY KEY, day VARCHAR(10) NOT NULL, branch VARCHAR(40) NOT NULL, expected INT NOT NULL DEFAULT 0, counted INT NOT NULL DEFAULT 0, variance INT NOT NULL DEFAULT 0, note VARCHAR(200) NOT NULL DEFAULT '', by_name VARCHAR(60) NOT NULL DEFAULT '', created_at VARCHAR(19), UNIQUE KEY uq_cashup (day, branch)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS ops_outbox (id INT AUTO_INCREMENT PRIMARY KEY, ts VARCHAR(19), event VARCHAR(30), order_id INT, phone VARCHAR(20), text TEXT, provider VARCHAR(12), status VARCHAR(16)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS activity_log (id INT AUTO_INCREMENT PRIMARY KEY, ts VARCHAR(19) NOT NULL, category VARCHAR(20) NOT NULL DEFAULT '', action VARCHAR(60) NOT NULL DEFAULT '', actor VARCHAR(80) NOT NULL DEFAULT '', role VARCHAR(20) NOT NULL DEFAULT '', ip VARCHAR(60) NOT NULL DEFAULT '', target VARCHAR(100) NOT NULL DEFAULT '', detail VARCHAR(500) NOT NULL DEFAULT '', outcome VARCHAR(8) NOT NULL DEFAULT 'ok', prev_hash CHAR(64) NOT NULL DEFAULT '', hash CHAR(64) NOT NULL DEFAULT '', INDEX idx_activity_ts (ts)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS site_visits (id INT AUTO_INCREMENT PRIMARY KEY, ts VARCHAR(19) NOT NULL, day VARCHAR(10) NOT NULL, path VARCHAR(120) NOT NULL, source VARCHAR(30) NOT NULL DEFAULT 'direct', device VARCHAR(10) NOT NULL DEFAULT 'desktop', vid VARCHAR(16) NOT NULL, INDEX idx_visits_day (day)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS mail_config (k VARCHAR(30) PRIMARY KEY, v TEXT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS email_log (id INT AUTO_INCREMENT PRIMARY KEY, ts VARCHAR(19) NOT NULL, to_addr VARCHAR(120), subject VARCHAR(160), status VARCHAR(10), error VARCHAR(300) NOT NULL DEFAULT '', by_name VARCHAR(60) NOT NULL DEFAULT '') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $has->execute(['orders', 'delivery_code']); if (!(int)$has->fetchColumn()) $pdo->exec('ALTER TABLE orders ADD COLUMN delivery_code VARCHAR(8) NULL');
    $has->execute(['orders', 'sig']); if (!(int)$has->fetchColumn()) $pdo->exec('ALTER TABLE orders ADD COLUMN sig CHAR(64) NULL');
    foreach ([['orders', 'idx_orders_partner', 'partner_id, status'], ['orders', 'idx_orders_created', 'created_at'], ['orders', 'idx_orders_phone', 'customer_phone'], ['mk_partner_items', 'idx_mkpi_product', 'product_id'], ['mk_order_fees', 'idx_mkof_invoice', 'invoice_id'], ['mk_invoices', 'idx_mkinv_status', 'status, due_date']] as [$t, $ix, $cols]) {
        $q = $pdo->prepare('SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?'); $q->execute([$t, $ix]);
        if (!(int)$q->fetchColumn()) { try { $pdo->exec("ALTER TABLE `$t` ADD INDEX `$ix` ($cols)"); } catch (Exception $e) {} }
    }

    // v3.4: kg items can be ordered in quarters, so order_items.qty must hold decimals. Converted once.
    $qt = $pdo->query("SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'qty'")->fetchColumn();
    if ($qt && strtolower((string)$qt) === 'int') $pdo->exec('ALTER TABLE order_items MODIFY qty DECIMAL(8,2) NOT NULL');

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
