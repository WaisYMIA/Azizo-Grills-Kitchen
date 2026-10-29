# Testing locally on WAMP

1. Copy the `backend-php` folder to `C:\wamp64\www\azizo-api\` and the `site` folder to `C:\wamp64\www\azizo\`.
2. phpMyAdmin → create a database `azizo` (utf8mb4). Tables are created automatically on first request.
3. In `backend-php`, copy `config.local.sample.php` to `config.local.php`, set `DB_HOST` localhost, `DB_NAME` azizo, `DB_USER` root, `DB_PASS` empty. Secrets can stay as the sample for local testing.
4. Enable `mod_rewrite` and `mod_headers` (WAMP menu → Apache → Apache modules) and make sure the folder allows `AllowOverride All`.
5. Open `http://localhost/azizo/` and set the backend URL in `app.js` (`API_BASE_URL`) to `http://localhost/azizo-api`.
6. On localhost the strict "must set strong passwords" guard is off, so `majani90` works for Staff and Admin. **On cPanel it is on** — follow `docs/SECURITY.md`.
7. M-Pesa can't call back to localhost; test payments on the live server (or use a tunnel).
