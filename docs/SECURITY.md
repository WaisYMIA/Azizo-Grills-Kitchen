# Azizo security guide (v4.3.0)

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
- **Orders:** prices, totals, discounts and a minimum delivery fee are recomputed on the server.
- **Partners** only ever see their own orders and items. Licence and ID images are never uploaded online.
- **Files:** `lib/`, `private/`, `data/`, config and SQL files are blocked; `uploads/` cannot execute code.
- **Audit log:** sign-ins, failed attempts, admin and partner changes.

## Honest limits
- Site-source passcodes (Staff/Admin pages) are only a light deterrent; the real protection is the server password + secrets above.
- The server enforces a minimum delivery fee from the customer's map pin; if a customer gives no pin, the base fee applies. Fees above that come from the browser's road-distance quote, capped at your maximum.
- Keep PHP and cPanel updated, and back up the MySQL database weekly (cPanel → Backup).
- If you ever suspect a leak: change `JWT_SECRET` (signs everyone out) and the passwords.


## Security Center (v4.3)
Open **Admin → 🔒 Security Center** (or `security-center.html`). Sign in with the admin password (and 6-digit code if you turned that on).

| Tab | What it gives you |
|---|---|
| Overview | Serious events in the last 24 hours, wrong passwords, lockouts, attack probes, order tampering, forged tokens/payments, busiest addresses, hourly graph |
| Attack log | Every recorded event, newest first. Filter by level, period, address or words. **Download CSV** for your records or the police |
| Blocked addresses | Who is blocked and for how long. Block or unblock any address yourself |
| Order integrity | Re-checks the seal of recent orders. Anything changed outside the website is listed by order number |
| Audit trail | Admin sign-ins, password changes, blocks and other actions |
| Health check | A green/red checklist of every protection and what to do for each red item |
| Sessions | Sign everyone out immediately |

### What is detected and recorded
Wrong passwords and lockouts; too many requests; SQL / script / path / command injection patterns; hacking tools; decoy-address probes; forged login tokens; fake or under-paid M-Pesa callbacks; orders priced below the real price or delivery minimum (the server corrects them and logs it); orders changed in the database after they were placed; staff or partner tokens trying admin pages; unknown website origins.

### Automatic blocking
Each event type carries attack points. 10 points from one address inside 10 minutes blocks it (1 hour, then 24 hours, then 7 days for repeat offenders). Your own addresses (`SEC_ALLOW_IPS`) and local/LAN addresses are never auto-blocked.

### Set up (10 minutes)
1. In `config.local.php` set `SEC_ALERT_EMAIL`, `ORDER_SIG_KEY` (random, set once, **never change it**) and, if you have a fixed IP, `SEC_ALLOW_IPS`.
2. cPanel → **Cron Jobs** → every hour: `/usr/local/bin/php /home/YOURUSER/path/to/backend-php/cron/security-watch.php`. This re-checks order seals and emails you if anything changed.
3. Open Security Center → **Health check** and fix every red item.

### Extra layers on cPanel (strongly recommended, all free or built in)
- **Cloudflare (free plan)** in front of the website: hides your real server, absorbs floods/DDoS, blocks known bad bots. Set `TRUSTED_PROXY` to `1` in `config.local.php` so the real visitor address is logged. Turn on "Under Attack" mode if a flood ever starts.
- **cPanel → Security**: turn on *ModSecurity* (WAF), *Two-Factor Authentication* for your cPanel login, *IP Blocker*, and *Hotlink protection*.
- **Backups:** cPanel → *Backup* weekly, and download one copy to your computer. A backup is your real protection against ransomware or a wiped database.
- Keep PHP on 8.2+ (cPanel → MultiPHP Manager), and use a unique long password for cPanel, MySQL and email.
- Never email or WhatsApp `config.local.php`. If it ever leaks: change `JWT_SECRET` (signs everyone out) and every password.

### Honest limits
No website can be made "impossible to attack" — what we do is make attacks fail, make them visible, and make tampering detectable. The weakest points are always people and passwords: unique strong passwords, 2-step codes, and keeping cPanel itself secure matter as much as this code. Orders in the separate **Azizo Kitchens** tables are protected by the same login lockout, price checks and attack filter but are not yet sealed with signatures.
