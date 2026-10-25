<?php
require_once __DIR__ . '/../config.php';

/** DB row -> the exact shape app.js expects (same field names as products.json). */
/** $withCost = true only for admin endpoints: cost price is private and never goes on the public menu. */
function serialize_product(array $row, bool $withCost = false): array {
    $out = [
        'id' => $row['id'],
        'cat' => $row['cat'],
        'name' => $row['name'],
        'desc' => $row['description'] ?? '',
        'price' => (int)$row['price'],
        'unit' => $row['unit'],
        'img' => $row['img'] ?? '',
        'badges' => $row['badges'] ? array_values(array_filter(array_map('trim', explode(',', $row['badges'])))) : [],
        'origin' => $row['origin'] ?? '',
    ];
    if (!empty($row['kind'])) $out['kind'] = $row['kind'];
    if (isset($row['in_stock'])) $out['inStock'] = (bool)$row['in_stock'];
    if ($withCost) $out['costPrice'] = (int)($row['cost_price'] ?? 0);
    return $out;
}

/** Accepts either an array or a comma-separated string for badges; always returns a comma string for storage. */
function badges_to_storage($badges): string {
    if (is_array($badges)) return implode(',', array_map('trim', array_filter($badges, fn($b) => trim((string)$b) !== '')));
    return trim((string)$badges);
}

/**
 * Handles an uploaded product photo (from $_FILES['image']) and returns the
 * web-relative path to store in the product's `img` column (e.g.
 * "/uploads/products/f1-1700000000.jpg"), or null if no file was uploaded.
 * Throws RuntimeException on a real upload problem (too big, wrong type).
 */
function handle_product_image_upload(string $productId): ?string {
    if (empty($_FILES['image']) || $_FILES['image']['error'] === UPLOAD_ERR_NO_FILE) return null;

    $file = $_FILES['image'];
    if ($file['error'] !== UPLOAD_ERR_OK) {
        throw new RuntimeException('Photo upload failed (error code ' . $file['error'] . ').');
    }
    if ($file['size'] > MAX_UPLOAD_BYTES) {
        throw new RuntimeException('Photo is too large — max ' . (MAX_UPLOAD_BYTES / 1024 / 1024) . 'MB.');
    }

    $allowed = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime = $finfo->file($file['tmp_name']);
    if (!isset($allowed[$mime])) {
        throw new RuntimeException('Photo must be a JPEG, PNG, or WebP image.');
    }

    if (!is_dir(UPLOAD_DIR)) mkdir(UPLOAD_DIR, 0755, true);
    $safeId = preg_replace('/[^a-zA-Z0-9_-]/', '', $productId) ?: 'item';
    $filename = $safeId . '-' . time() . '.' . $allowed[$mime];
    $destination = UPLOAD_DIR . $filename;

    if (!move_uploaded_file($file['tmp_name'], $destination)) {
        throw new RuntimeException('Could not save the uploaded photo to disk — check that the uploads folder is writable.');
    }

    return UPLOAD_URL_PATH . $filename;
}
