# Azizo security guide (v4.1.0)

Built for cPanel (PHP + MySQL) with many users and 5 pilot butcheries; nothing is capped at 5 — partners, staff and orders scale with the database.

## Before going live (required)
1. In cPanel File Manager open `backend-php/`, copy `config.local.sample.php` to `config.local.php` and fill it in. Set permissions to 640. **Never upload it to GitHub.**
2. Generate secrets: `php -r "echo bin2hex(random_bytes(32));"` for `JWT_SECRET`.
3. `ADMIN_PASSWORD` 10+ characters, `STAFF_PASSWORD` 8+, both different from `majani90`. Until set, admin and staff sign-in **refuse to work on a real server** (by design). Localhost / WAMP is exempt.
4. Turn on HTTPS (cPanel: SSL/TLS Status → AutoSSL). Set `ALLOWED_ORIGIN` and `SITE_URL` to your real https address.
5. M-Pesa: set `MPESA_CALLBACK_SECRET` (16+ random characters). The callback URL Safaricom calls then includes it; fake callbacks are ignored.
6. Admin → `GET /api/auth/security` shows a checklist of anything still weak and the recent audit log.

## What is protected
- **Lockout:** 6–8 wrong tries per 15 minutes locks that account and that visitor address.
- **Sessions:** "sign out everyone" (`POST /api/auth/security {"action":"revoke-all"}`) invalidates every token. Partner tokens also die on password change or delisting.
- **2-step admin sign-in:** set `ADMIN_TOTP_SECRET` (base32 from your authenticator app). The admin pages ask for the 6-digit code.
- **Orders:** prices, totals and discounts are recomputed on the server.
- **Partners** only ever see their own orders and items. Licence and ID images are never uploaded online.
- **Files:** `lib/`, `private/`, `data/`, config and SQL files are blocked; `uploads/` cannot execute code.
- **Audit log:** sign-ins, failed attempts, admin and partner changes.

## Honest limits
- Site-source passcodes (Staff/Admin pages) are only a light deterrent; the real protection is the server password + secrets above.
- Delivery fee and distance in a customer order are not independently verified yet.
- Keep PHP and cPanel updated, and back up the MySQL database weekly (cPanel → Backup).
- If you ever suspect a leak: change `JWT_SECRET` (signs everyone out) and the passwords.
