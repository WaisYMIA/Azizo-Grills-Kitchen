<?php
require_once __DIR__ . '/../config.php';

/** Sends the standard CORS headers and handles the OPTIONS preflight request. */
function cors_and_preflight(): void {
    sec_boot();
    header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
    header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

function json_response($data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}

function json_error(string $message, int $status = 400, array $extra = []): void {
    json_response(array_merge(['error' => $message], $extra), $status);
}

/** Reads and JSON-decodes the request body (for non-multipart requests). */
function read_json_body(): array {
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

require_once __DIR__ . '/security.php';
