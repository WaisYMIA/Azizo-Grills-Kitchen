<?php
// cPanel mailbox sender (v5.5): SMTP over SSL (465) or STARTTLS (587). Settings in table mail_config, password encrypted (AES-256-GCM).
function mail_db(): PDO { return get_db(); }
function mail_defaults(): array { return ['enabled' => '0', 'host' => '', 'port' => '465', 'secure' => 'ssl', 'user' => '', 'from_email' => '', 'from_name' => 'Azizo Butchery and Grill', 'reply_to' => '', 'verify_cert' => '1', 'alert_security' => '1', 'alert_to' => '']; }
function mail_key(): string { return hash('sha256', 'azizo-mail|' . (getenv('MAIL_KEY') ?: (getenv('ORDER_SIG_KEY') ?: (getenv('JWT_SECRET') ?: (defined('JWT_SECRET') ? JWT_SECRET : 'insecure-dev-only-secret-change-me')))), true); }
function mail_enc(string $t): string { $iv = random_bytes(12); $c = openssl_encrypt($t, 'aes-256-gcm', mail_key(), OPENSSL_RAW_DATA, $iv, $tag); return 'v1:' . base64_encode($iv . $tag . $c); }
function mail_dec(?string $s): string { if (!$s || strpos($s, 'v1:') !== 0) return ''; $b = base64_decode(substr($s, 3), true); if ($b === false || strlen($b) < 29) return ''; $p = openssl_decrypt(substr($b, 28), 'aes-256-gcm', mail_key(), OPENSSL_RAW_DATA, substr($b, 0, 12), substr($b, 12, 16)); return $p === false ? '' : $p; }
function mail_config(): array { $o = mail_defaults(); foreach (mail_db()->query('SELECT k, v FROM mail_config')->fetchAll() as $r) $o[$r['k']] = $r['v']; return $o; }
function mail_set(string $k, string $v): void { $pdo = mail_db(); $q = $pdo->prepare('SELECT 1 FROM mail_config WHERE k = ?'); $q->execute([$k]); if ($q->fetch()) $pdo->prepare('UPDATE mail_config SET v = ? WHERE k = ?')->execute([$v, $k]); else $pdo->prepare('INSERT INTO mail_config (k, v) VALUES (?,?)')->execute([$k, $v]); }
function mail_public(): array { $c = mail_config(); $has = mail_dec($c['pass_enc'] ?? '') !== ''; $un = !empty($c['pass_enc']) && !$has; unset($c['pass_enc'], $c['last_digest']); return $c + ['hasPassword' => $has, 'passwordUnreadable' => $un]; }
function mail_is_email(string $s): bool { return (bool)preg_match('/^[^\s@<>",;:]+@[^\s@<>",;:]+\.[^\s@<>",;:]{2,}$/', $s); }
function mail_hdr(string $s): string { return trim(preg_replace('/[\r\n]+/', ' ', $s)); }
function mail_word(string $s): string { return preg_match('/^[\x20-\x7e]*$/', $s) ? $s : '=?UTF-8?B?' . base64_encode($s) . '?='; }
function mail_save(array $b): array {
    $d = mail_defaults(); $out = []; $errs = [];
    foreach (array_keys($d) as $k) if (array_key_exists($k, $b)) $out[$k] = mail_hdr((string)$b[$k]);
    if (!empty($out['host']) && !preg_match('/^[a-z0-9.\-]{3,120}$/i', $out['host'])) $errs[] = 'Server name looks wrong (example: mail.azizobutchery.co.ke)';
    if (isset($out['port']) && !((int)$out['port'] > 0 && (int)$out['port'] < 65536)) $errs[] = 'Port must be a number (465 or 587)';
    if (isset($out['secure']) && !in_array($out['secure'], ['ssl', 'starttls', 'none'], true)) $errs[] = 'Choose SSL, STARTTLS or none';
    foreach (['from_email', 'reply_to', 'alert_to'] as $k) if (!empty($out[$k]) && !mail_is_email($out[$k])) $errs[] = str_replace('_', ' ', $k) . ' is not a valid email address';
    if (isset($out['user']) && strlen($out['user']) > 120) $errs[] = 'Username too long';
    if ($errs) return ['errors' => $errs];
    foreach (['enabled', 'verify_cert', 'alert_security'] as $k) if (isset($out[$k])) $out[$k] = ($out[$k] === '1' || $out[$k] === 'true') ? '1' : '0';
    foreach ($out as $k => $v) mail_set($k, $v);
    $pw = isset($b['password']) && is_string($b['password']) ? $b['password'] : ''; if ($pw !== '') mail_set('pass_enc', mail_enc(substr($pw, 0, 200)));
    return ['ok' => true, 'changed' => array_merge(array_keys($out), $pw !== '' ? ['password'] : [])];
}
function mail_friendly(string $m): string {
    if (preg_match('/refused|ECONNREFUSED|Connection refused/i', $m)) return 'The mail server refused the connection. Check the server name and port.';
    if (preg_match('/getaddrinfo|php_network_getaddresses|not known|ENOTFOUND/i', $m)) return 'That mail server name was not found. Check the spelling (usually mail.yourdomain.com).';
    if (preg_match('/certificate|self.signed|verify|SSL|crypto|peer|handshake/i', $m)) return 'The mail server certificate did not match. On shared cPanel hosting, switch off "Check the server certificate" or use the server name your host gives you.';
    if (preg_match('/535|authentication|credentials/i', $m)) return 'The mailbox login was refused. Check the full email address and password.';
    if (preg_match('/timed? ?out|ETIMEDOUT/i', $m)) return 'The mail server did not answer. The port may be blocked, try 587 with STARTTLS.';
    return substr($m, 0, 200);
}
function mail_smtp(array $c, string $pass, string $to, string $subject, string $text): void {
    $port = (int)$c['port'] ?: 465; $verify = ($c['verify_cert'] ?? '1') !== '0';
    $ctx = stream_context_create(['ssl' => ['verify_peer' => $verify, 'verify_peer_name' => $verify, 'allow_self_signed' => !$verify, 'peer_name' => $c['host']]]);
    $fp = @stream_socket_client(($c['secure'] === 'ssl' ? 'ssl://' : 'tcp://') . $c['host'] . ':' . $port, $en, $es, 20, STREAM_CLIENT_CONNECT, $ctx);
    if (!$fp) { $le = error_get_last(); throw new RuntimeException(trim(($es ?: '') . ' ' . ($le['message'] ?? '')) ?: 'connection failed'); } stream_set_timeout($fp, 20);
    $read = function () use ($fp) { $out = ''; while (($l = fgets($fp, 1024)) !== false) { $out .= $l; if (strlen($l) < 4 || $l[3] === ' ') break; } if ($out === '') throw new RuntimeException('The mail server did not answer in time'); return $out; };
    $cmd = function (string $line, array $ok) use ($fp, $read) { fwrite($fp, $line . "\r\n"); $r = $read(); if (!in_array(substr($r, 0, 3), $ok, true)) { $ls = preg_split('/\r?\n/', trim($r)); throw new RuntimeException(substr(end($ls), 0, 160)); } return $r; };
    $g = $read(); if (substr($g, 0, 3) !== '220') throw new RuntimeException('Unexpected greeting: ' . substr(trim($g), 0, 100));
    $ehlo = $cmd('EHLO azizo.local', ['250']);
    if ($c['secure'] === 'starttls') { $cmd('STARTTLS', ['220']); if (!@stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) throw new RuntimeException('certificate or TLS handshake failed'); $ehlo = $cmd('EHLO azizo.local', ['250']); }
    if ($c['user'] !== '') {
        if (preg_match('/AUTH[^\n]*PLAIN/i', $ehlo)) $cmd('AUTH PLAIN ' . base64_encode("\0" . $c['user'] . "\0" . $pass), ['235']);
        else { $cmd('AUTH LOGIN', ['334']); $cmd(base64_encode($c['user']), ['334']); $cmd(base64_encode($pass), ['235']); }
    }
    $cmd('MAIL FROM:<' . $c['from_email'] . '>', ['250']); $cmd('RCPT TO:<' . $to . '>', ['250', '251']); $cmd('DATA', ['354']);
    $head = implode("\r\n", array_filter(['From: ' . mail_word(mail_hdr($c['from_name'])) . ' <' . $c['from_email'] . '>', 'To: <' . $to . '>', !empty($c['reply_to']) ? 'Reply-To: <' . mail_hdr($c['reply_to']) . '>' : null, 'Subject: ' . mail_word(mail_hdr($subject)), 'Date: ' . gmdate('D, d M Y H:i:s') . ' +0000', 'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . (explode('@', $c['from_email'])[1] ?? 'azizo.local') . '>', 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', 'X-Mailer: Azizo']));
    $cmd($head . "\r\n\r\n" . chunk_split(base64_encode($text), 76, "\r\n") . '.', ['250']);
    @fwrite($fp, "QUIT\r\n"); @fclose($fp);
}
function mail_send(string $to, string $subject, string $text, string $by = '', bool $force = false): array {
    $c = mail_config(); $to = mail_hdr($to); $pdo = mail_db();
    $log = function (string $st, string $err) use ($pdo, $to, $subject, $by) { try { $pdo->prepare('INSERT INTO email_log (ts, to_addr, subject, status, error, by_name) VALUES (?,?,?,?,?,?)')->execute([gmdate('Y-m-d H:i:s'), substr($to, 0, 120), substr(mail_hdr($subject), 0, 160), $st, substr($err, 0, 300), substr($by, 0, 60)]); } catch (Throwable $e) {} };
    if ($c['enabled'] !== '1' && !$force) return ['ok' => false, 'error' => 'Email is switched off in Operations > Email'];
    if ($c['host'] === '' || !mail_is_email($c['from_email'])) return ['ok' => false, 'error' => 'Email settings are not complete'];
    if (!mail_is_email($to)) return ['ok' => false, 'error' => 'That recipient address does not look right'];
    $n = $pdo->prepare("SELECT COUNT(*) FROM email_log WHERE ts >= ? AND status IN ('sent','failed')"); $n->execute([gmdate('Y-m-d H:i:s', time() - 3600)]); if ((int)$n->fetchColumn() >= 60) { $log('blocked', 'Hourly send limit (60) reached'); return ['ok' => false, 'error' => 'Hourly send limit reached']; }
    try { mail_smtp($c, mail_dec($c['pass_enc'] ?? ''), $to, $subject, $text); $log('sent', ''); return ['ok' => true]; }
    catch (Throwable $e) { $m = mail_friendly($e->getMessage()); $log('failed', $m); return ['ok' => false, 'error' => $m]; }
}
function mail_security_alert(string $type, string $ip, string $detail): void {
    try {
        $c = mail_config(); if ($c['enabled'] !== '1' || $c['alert_security'] !== '1') return; $to = $c['alert_to'] ?: $c['from_email']; if (!mail_is_email($to)) return;
        $last = (int)($c['last_alert'] ?? 0); if (time() - $last < 900) return; mail_set('last_alert', (string)time());
        mail_send($to, 'Azizo security alert: ' . $type, "Azizo security alert\n\nType: $type\nFrom address: $ip\nDetail: " . substr($detail, 0, 300) . "\n\nOpen Operations > Audit to see everything. Further alerts are held back for 15 minutes.", 'system');
    } catch (Throwable $e) {}
}
