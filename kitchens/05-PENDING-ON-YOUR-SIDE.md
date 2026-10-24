# What is pending on your side (v3.1)

Everything that can be built in code is built. These items need something only you can supply or decide. Tick them off in order; the first three block going live.

## 1. Before real customers (blockers)
- [ ] **Change every default password** in the backend `.env` (or `config.php` on PHP): `ADMIN_PASSWORD`, `STAFF_PASSWORD`, `KITCHENS_ADMIN_PASSWORD`, and optionally `KITCHENS_DISPATCH_PASSWORD` and `KITCHENS_ACCOUNTS_PASSWORD`. The `majani90` passcode in the site is only a light deterrent. Real protection is a strong server password.
- [ ] **Set a random `JWT_SECRET`**: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- [ ] **Set `SITE_URL`** to your live address (used in customer messages and the menu export).
- [ ] **Put the site and backend on real hosting**, then run one full test order (Kitchens and shop). The PHP/MySQL version has never run on a real MySQL server; test it before relying on it.
- [ ] **Lawyer review** of the partner agreement (`04-...TERM-SHEET.md`) and the courier/delivery licence position, **insurance**, and written terms for riders.

## 2. Switch on later (the code is ready; each needs your account or keys)
- [ ] **M-Pesa "Pay now"**: get Daraja keys from Safaricom (`MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_ENV=production`) and a public https `MPESA_CALLBACK_URL`. "Pay now" appears for customers automatically once configured.
- [ ] **WhatsApp Business API** (`WA_TOKEN`, `WA_PHONE_ID`): automatic customer messages. Until then use the Messages tab and tap Send on WhatsApp.
- [ ] **Uptime monitor**: sign up (UptimeRobot or similar) and point it at `https://<your-backend>/api/kitchens/health`.
- [ ] **Daily backup**: schedule `scripts/backup.sh` in cPanel cron and copy the output off the server weekly.

## 3. Content and growth
- [ ] **Dish photos**: upload one per dish in Kitchens Admin → Dishes (the page works without them; photos sell).
- [ ] **Product photos and prices** for the main shop, which also feed the Event Budget Planner. Keep prices current in Admin → Products.
- [ ] **Google Business Profile** for each branch (Syokimau, Umoja, Buruburu, Utawala) with the area page links.
- [ ] **Apply to delivery apps** (Glovo, Bolt Food, Uber Eats). Use Exports → Menu CSV as the starting point.
- [ ] **Recruit cooks**: 2 to 4 per pilot estate; run the tasting and kitchen visit, then set them live.
- [ ] **Recruit riders**: add them in Kitchens Admin → Riders.
- [ ] Decide the **Event Budget Planner** wording: set the note, buffer % and on/off in Admin → Site.

## 4. Not built (and why)
- **Real push notifications** (needs VAPID keys and a push service). Customers get updates by 20-second refresh plus a browser notification while the page is open.
- **One-click database restore** (risky to expose). Manual restore is documented in DOCUMENTATION.md.
- **Full Kiswahili** coverage: the main customer screens switch; the cook and admin screens stay English. A native speaker should review the wording.
- **Fixed event costs inside the Event Budget Planner** (grill hire, fuel, chef): by design these are quoted on a call.

## 5. How to restore a backup
1. Stop the app. 2. Copy the backup `.db` file over the live database file (`backend/azizo.db`, or the path in `DB_PATH`). 3. Untar the uploads archive into `backend/`. 4. Start the app and open `/api/kitchens/health`.
