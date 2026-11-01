# Pending on your side until the website is hosted (updated 2026-11-01, v5.0.0)

## A. Before the pilot (cPanel)
1. Create `backend-php/config.local.php` from the sample: strong `JWT_SECRET`, `ADMIN_PASSWORD` (10+), `STAFF_PASSWORD` (8+), `INSPECTOR_PASSWORD` (8+). Change `majani90` when the system is complete.
2. Security Center: `SEC_ALERT_EMAIL`, `ORDER_SIG_KEY` (set once, never change), `SEC_ALLOW_IPS`, hourly cron `backend-php/cron/security-watch.php`, fix red Health-check items.
3. HTTPS via AutoSSL; set `ALLOWED_ORIGIN` and `SITE_URL`.
4. Run once on WAMP with MySQL (PHP is only tested on a SQLite stand-in, including the new Operations module and Kitchens seals).
5. M-Pesa Daraja keys and `MPESA_CALLBACK_SECRET`; optional `ADMIN_TOTP_SECRET`.
6. Cloudflare free, ModSecurity, cPanel 2-step login, weekly cPanel backups.
7. NEW: daily backup cron `15 2 * * *  php .../backend-php/cron/backup.php`; download a copy weekly; restore test monthly.
8. NEW: uptime monitor on `/api/health` (UptimeRobot or similar).

## B. Business and data
9. Confirm prices of the 39 new products (`docs/NEW-ITEMS-PRICE-CHECK.md`).
10. Marketplace fee, invoice and suspension rules for the 5 pilot butcheries; then switch the marketplace on.
11. WhatsApp Cloud API keys (also needed for automatic order-stage messages).
12. Confirm Kitchens `API_BASE_URL` points to the cPanel domain.
13. Edit the Fish Lover's Basket description once in admin on the PHP backend (1/2 kg to 500 g).
14. Real partner inspections: set `INSPECTOR_PASSWORD`, then create named accounts in Operations > Inspector accounts.

## C. New in v5.0 (need you)
15. SOPs: have a food-safety professional or the county public health officer review the 23 SOPs (`docs/sop`); print the handbook; train staff; get owners to sign.
16. Partner agreement: have a lawyer draft it (needed for the "contract" onboarding step).
17. Data protection: check whether Azizo must register with the Office of the Data Protection Commissioner; have the privacy page wording reviewed.
18. Rewards: confirm the rule (1 point per KES 100, 100 points = KES 100) and who approves requests.
19. Brand pack for partners (logo files, colours, signage); agree what partners may post.
20. Franchise offer: investment range, fees, term and territory (needed before a franchise application funnel is built).
21. Onboard the 5 pilot partners through the go-live gate and tick the manual steps.

## D. Not built yet (decisions needed)
- Franchise application funnel with investment figures (needs item 20).
- Structured cut-to-order options per item (today: free-text butcher instructions).
- Automatic WhatsApp or SMS stage messages (needs item 11).
- Automatic reward redemption at checkout (today: staff-approved).
- Central price control with local override ranges (current decision: recommended prices only).
- Personal accounts for admin and staff (today: shared passwords; inspectors have personal accounts).
