<?php
// Image library for recipes and blog posts (admin only). Images arrive as base64 data URLs.
//   GET /api/media            list
//   POST /api/media           {name, data}
//   DELETE /api/media/:file
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth_guard.php';
cors_and_preflight();
require_admin();
header('Cache-Control: no-store');
$dir = __DIR__ . '/../../uploads/media';
$method = $_SERVER['REQUEST_METHOD'];
if ($method === 'GET') {
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $files = [];
    foreach (glob($dir . '/*.{jpg,png,webp}', GLOB_BRACE) ?: [] as $f) $files[] = ['file' => basename($f), 'url' => '/uploads/media/' . basename($f), 'size' => filesize($f), 'modified' => gmdate('c', filemtime($f))];
    usort($files, fn($a, $b) => strcmp($b['modified'], $a['modified']));
    json_response(['files' => $files]);
}
if ($method === 'POST') {
    $b = read_json_body();
    if (!preg_match('#^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$#', (string)($b['data'] ?? ''), $m)) json_error('Upload a JPG, PNG or WebP image');
    $bin = base64_decode($m[2], true);
    if ($bin === false || strlen($bin) > 3 * 1024 * 1024) json_error('Image is too large (max 3 MB)');
    $ok = ($m[1] === 'jpeg' && substr($bin, 0, 2) === "\xFF\xD8") || ($m[1] === 'png' && substr($bin, 1, 3) === 'PNG') || ($m[1] === 'webp' && substr($bin, 0, 4) === 'RIFF');
    if (!$ok) json_error('That file is not a valid image');
    $base = trim(preg_replace('/[^a-z0-9]+/', '-', strtolower(preg_replace('/\.[^.]*$/', '', (string)($b['name'] ?? 'image')))), '-');
    $base = substr($base, 0, 40) ?: 'image';
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $file = $base . '-' . base_convert((string)(int)(microtime(true) * 1000), 10, 36) . '.' . ($m[1] === 'jpeg' ? 'jpg' : $m[1]);
    file_put_contents($dir . '/' . $file, $bin);
    json_response(['ok' => true, 'file' => $file, 'url' => '/uploads/media/' . $file], 201);
}
if ($method === 'DELETE') {
    $f = basename((string)($_GET['file'] ?? ''));
    if (!preg_match('/^[a-z0-9-]+\.(jpg|png|webp)$/i', $f)) json_error('Bad file name');
    if (!is_file($dir . '/' . $f)) json_error('File not found', 404);
    unlink($dir . '/' . $f); json_response(['ok' => true]);
}
json_error('Not found', 404);
