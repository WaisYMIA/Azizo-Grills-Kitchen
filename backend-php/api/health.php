<?php
require_once __DIR__ . '/../lib/response.php';
cors_and_preflight();
json_response(['ok' => true, 'time' => date('c')]);
