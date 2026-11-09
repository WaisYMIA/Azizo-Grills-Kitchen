# Backup and business continuity (head office)
Scope: Admin

Document AZ-SOP-G06 · Version 1.0 · Owner: Azizo Quality and Operations · Review every 6 months

> Internal Azizo standard, written to align with Kenyan food-safety law (Food, Drugs and Chemical Substances Act, Meat Control Act, Public Health Act and county by-laws) and with HACCP / Codex Alimentarius principles. It is not a government certificate. Have a food-safety professional or the county public health officer review it before you rely on it.

## Backups
1. Daily database backup by the cron script (backend-php/cron/backup.php, or the Node `npm run backup`), kept for 14 days on the server and downloaded off the server weekly.
2. Weekly full cPanel backup, downloaded to a safe computer.
3. Once a month, restore a backup into a test database and open the site to prove it works. Record the date.
## If the site is down
1. Check the uptime monitor message and the host status. 2. Check the health page `/api/health`. 3. Restore the last good backup if the data is damaged. 4. Take orders by WhatsApp manually, using the shop phone, until the site is back. 5. Tell customers on social media.
## Secrets
Change the admin, staff and inspector passwords every 90 days and when any staff member leaves. Keep the ORDER_SIG_KEY unchanged.
