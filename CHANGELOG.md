# Changelog

## v6.5.1 — 2026-11-09
Mascot cut-out refined. The edges are now cut with proper alpha matting instead of a hard mask: the spoon is smooth, the fingers and wing feathers are soft and natural, the crest keeps its individual strands, and the leftover wall and plant specks are gone. Edge colour is cleaned so there is no dark or beige fringe on light or dark backgrounds. Images re-exported sharper (`mascot-full.webp` 720 px wide, `mascot-head.webp` 360 px). No code changes.

## v6.5.0 — 2026-11-09
The Azizo Kitchens mascot (the crowned-crane chef) joins the Kitchens pages, placed so it never gets in the way.
- **Cut-out:** the mascot was extracted from the supplied artwork with a transparent background (`mascot-full.webp`, 112 KB) plus a face badge (`mascot-head.webp`, 37 KB).
- **Kitchens and Cook-with-Azizo pages:** on desktop the mascot stands at the right of the hero, partly tucked behind the area/search panel, with a speech bubble that greets by time of day ("Habari za asubuhi!", "Karibu, ni wakati wa lunch!", "Karibu, dinner iko tayari!"). On phones only a small face badge and the same bubble appear above the heading, so nothing is pushed off screen.
- **Never blocks anything:** the figure cannot be clicked, is hidden from screen readers, never overlaps a heading, paragraph or button (tested), and has a small × to hide it; the choice is remembered on that device. Motion stops for people who ask their device for reduced motion.
- **Friendly states:** the mascot's face appears on empty results, bobs while kitchens are loading, sits beside "Order received", and appears in the footer.
- Fixed: the partner page's "How it works" cards ran off the screen on phones; they now stack.
- Offline: the two mascot images are cached for the app. Test: `test/mascotui.js`.

## v6.4.0 — 2026-11-09
Franchisee portal.
- **Own login:** the Owner creates a login for each franchisee (Branches > Franchisees > Create login) and gives them the username, password and the address `/franchisee.html`. Passwords are stored hashed, need 10+ characters with a letter and a number, and the franchisee can change their own. Six wrong tries lock the sign-in for 15 minutes.
- **What a franchisee sees:** their agreement and fee status, royalty % and term, their own branch scorecard for 7, 30 or 90 days (sales, checklist completion, critical failures, waste, food cost, yield, certified staff), and their royalty statements with print links. Nothing else: no other branches, no customers, no staff screens, no targets setting.
- **Switch off:** the Owner can switch a login off (the person is signed out at once) or reset the password. A franchisee marked Exited loses access automatically.
- A franchisee token is refused by every admin and staff endpoint (tested). Every sign-in, failed sign-in and change is in the audit log.
- Node and PHP backends; new table `bo_portal`; new pages `franchisee.html` and `franchisee.js`. Tests extended.

## v6.3.0 — 2026-11-09
Royalty follow-up and the second-branch rollout path.
- **Statement links:** each royalty statement can be sent as a private, read-only link (Branches > Royalties > Send link, opens WhatsApp). The link shows only that one statement and is signed, so it cannot be guessed or used to see other statements; a voided statement stops working.
- **Overdue reminders:** statements unpaid more than N days after issue (default 14, set in Targets) appear in an Overdue box with a Remind on WhatsApp button. Every reminder is logged and counted.
- **Rollout checklist:** `docs/ROLLOUT-CHECKLIST.md` is the repeatable path for opening any new branch, starting with the pilot gate.
- Node and PHP backends; new table `bo_reminders`; new public page `statement.html`. Tests extended.

## v6.2.0 — 2026-11-08
Cutting yield and supplier control, added to Operations > Branches.
- **Yield:** record what you started with (e.g. a whole beef side), the saleable cuts and the trim. The system works out yield %, unaccounted kilograms and a per-product summary, and refuses entries where cuts plus trim exceed the starting weight. Yield % also appears on the scorecard.
- **Suppliers:** a supplier scorecard built from your purchases (deliveries, kg, cost per kg, spend, last delivery) and a rejection log (temperature, quality, documents, weight). A supplier is flagged when rejected meat is above 5% of delivered weight, or after three rejections. Spellings of the same supplier are merged.
- Two new reports (cutting yield log, supplier rejections), 38 in total.
- Finance can read yield and suppliers; Manager and Owner can record. Node and PHP backends, new tables `bo_yield` and `bo_rejects`. Tests extended in `test/branchops.js` and `test/branchesui.js`.

## v6.1.0 — 2026-11-08
The Franchise Prototype phase continues: branch scorecard, stock and cost control, franchisee pipeline with royalty statements, and the printable Operations Manual. All in the new Operations > Branches tab.
- **Scorecard:** one row per branch for 7, 30 or 90 days: sales, orders, average order, cancelled %, refunds, checklist completion %, open critical failures, cash gaps, certified staff, waste % and food cost %. Each branch is green, amber or red with the reasons listed.
- **Stock and costs:** record purchases (supplier, cut, kg, cost) and waste (kg and reason). The system works out waste %, food cost % and the margin per product against the shelf price, and calls out purchase names that do not match a product.
- **Franchisee pipeline (Owner):** enquiry, approved, agreement, build-out, training, soft launch, live. A franchisee cannot pass the agreement stage without a recorded signed agreement, and cannot go Live until the linked branch has passed the Playbook go-live gate.
- **Royalty statements (Owner; Finance can read and print):** generated per finished month from completed sales minus approved refunds, at the franchisee's royalty % (or the system default), plus an optional marketing levy. Printable statement with daily sales; mark paid or void.
- **Operations Manual:** one printable document per branch built from the live Playbook: branch details, targets, the daily checklists, training lessons and all SOPs. No quiz answers are included.
- **Targets (Owner):** margin, waste, checklist and marketing percentages that drive the scorecard colours and statements.
- Three new reports (purchases log, waste log, royalty statements), 36 in total.
- Roles: Owner everything; Manager scorecard, stock and costs, manual; Finance reads scorecard, stock and royalties; Counter none.
- Node and PHP backends (`/api/branchops`), new tables `bo_settings`, `bo_purchases`, `bo_waste`, `bo_franchisees`, `bo_royalties`. Tests `test/branchops.js` and `test/branchesui.js`.

## v6.0.0 — 2026-11-07
The Franchise Prototype phase starts: the Playbook and the new-branch wizard.
- **Playbook (Operations > Playbook):** daily checklists (opening 14 lines, mid-shift 9, closing 12, weekly 10) with temperature limits that flag failures automatically, written corrective actions, supervisor sign-off and a locked record. Managers see compliance per branch and resolve critical failures.
- **Training and certification:** 8 courses built from the SOPs with lessons and a 5-question quiz each (pass mark 80%); a person is certified for a station after the quiz **and** a supervisor's practical sign-off, valid 12 months. Staff matrix per branch.
- **New-branch wizard (Owner):** creates a hidden branch that inherits the menu, prices, rules and checklists, then runs a readiness test (details, menu, two certified staff per core course, practice opening and closing checklists, 10 owner confirmations). Go live only when every check passes; the branch then appears on the public site.
- Three new reports (daily checklist log, training records, branch launches), 33 in total.
- Node and PHP backends (`/api/playbook`), new tables `pb_runs`, `pb_training`, `pb_launches`.
- **Documents for review:** franchise agreement draft (Word and Markdown) with an issues list for your advocate; master SOP review pack with HACCP table, records register and reviewer sign-off; Syokimau pilot plan.

## v5.6.0 — 2026-11-06
Pay with points, franchise enquiries, and an easier Windows install.
- **Pay with points:** logged-in customers can tick "Use my points" at checkout (100-point steps, 1 point = KSh 1). Owner switches it on and sets the limit (default off, 20% of an order, KSh 1,000 minimum) in Operations > Growth > Settings. The server re-checks balance and limits, records the deduction, and returns the points if the order is cancelled. Not available on partner orders.
- **Franchise page** (`franchise.html`): indicative investment, fee, royalty and term (Owner-editable placeholders, clearly marked indicative) and an enquiry form with consent, spam protection and a reference number. Owner reviews enquiries in Operations > Growth > Franchise and sets status and notes. New report: Franchise applications.
- **Install fix:** `better-sqlite3` is now optional. If it cannot be built (new Node versions on Windows without Visual Studio) the backend uses Node's built-in SQLite (Node 22.13 or newer). `npm install` no longer aborts.
- Node and PHP backends; new tests in `test/growth.js` and `test/v56ui.js`.

## v5.5.0 — 2026-11-06
Data, audit and email. All new screens are in Operations (Owner sees all; Manager and Finance see the reports their role allows).
- **Reports centre:** 29 reports in six groups (Sales, Orders, Customers, Visitors, Money, Growth/Marketplace, Audit). Pick dates and branch, preview, then download a formatted Excel file (README, Summary and Data sheets, frozen header, filters, real number and date formats). Includes sales, orders, closed orders, unsuccessful orders (cancelled or M-Pesa failed), user accounts, buyers, team accounts, visitors, M-Pesa, refunds, cash-ups, expenses, reviews, partners and audit. One click downloads a full data pack.
- **Audit log:** one tamper-evident record of sign-ins, failed sign-ins, order status changes, price/refund/settings/team changes, exports and security events, with filters and Excel export. "Verify integrity" detects any edited or deleted row.
- **Visitors:** anonymous visitor analytics (daily unique visitors, page views, sources, devices, conversion funnel). No cookies, no IP stored, respects Do Not Track.
- **Email (cPanel):** the Owner enters the cPanel mailbox (server, port, SSL/STARTTLS, login) in Operations > Email; password stored encrypted; test send and send log. Used for the daily digest and security alerts (at most one every 15 minutes).
- Role limits: personal-data and audit reports and the email page are Owner only; Finance sees sales/money reports; counter staff see none. Every export is logged.
- Node and PHP backends; new tests `test/insight.js` (Node and PHP) and `test/insightui.js`.

## v5.4.0 — 2026-11-04
Growth and money tools. Every number is a typical Nairobi market value that the Owner edits in Operations > Growth > Settings.
- **Morning digest:** yesterday's orders, sales, cancellations, refunds and cash gaps in one message (Operations > Money), with a WhatsApp share link; PHP can email it daily (cron).
- **Cash-up and M-Pesa check:** counters enter counted cash per branch; the system compares it with expected cash (tolerance KSh 50) and lists M-Pesa payments that are missing, wrong or unmatched.
- **Refund workflow:** customers ask from the tracking page within 24 hours; Owner/Manager approve or reject (reason required); Finance marks paid with the M-Pesa reference. Reason and partner statistics.
- **Standing orders:** weekly, fortnightly or monthly repeat baskets (min KSh 1500, up to 3 each). Nothing is charged automatically; the customer confirms every delivery and gets a reminder.
- **Referrals:** each customer has a code; 100 points each once the friend's first order of KSh 1000+ is completed (20 rewards a month cap).
- **One-tap "Order again"** in order history.
- **Order messages:** received / preparing / ready / out for delivery / completed with editable wording. Manual WhatsApp links by default; automatic through WhatsApp Cloud API or Africa's Talking SMS once you add keys.
- **Price control:** partners may price within +/-15% of Azizo's price (enforce, warn or off); out-of-band prices are listed and can be reset.
- Node and PHP backends. New tests: `test/growth.js` (Node and PHP), `test/growthui.js`.

## v5.3.0 — 2026-11-04
Security, search and AI.
- **Search and AI-search:** one H1 and complete social/canonical tags on every public page, private pages set to noindex, breadcrumbs, Organization and WebSite data, a 16-question FAQ with FAQPage data, dated sitemap, `robots.txt` that welcomes search and AI crawlers on public pages only, `llms.txt`, lazy images, `security.txt`. Guide: `docs/SEO.md`.
- **Security:** authenticator-app sign-in on the Node backend (matches PHP), CORS limited to your website (`ALLOWED_ORIGIN`), security headers and content policy on API and site, HSTS over HTTPS, dependency fixes. Plain-words guide in `docs/SECURITY.md`.
- **Claude AI module (off until `ANTHROPIC_API_KEY`):** "Ask Azizo" customer chat (English/Swahili, answers only from our facts and live menu), ticket reply drafts, business Q&A on totals, product description and SEO writer, review check, and a partner "ask the handbook" assistant. Phone/email masking, rate limits, monthly token cap, usage log, Owner on/off switch. Guide: `docs/AI.md`.
- Node and PHP backends. New tests: `test/ai.js` (Node and PHP), `test/aiui.js`, `test/sec53.js`.

## v5.2.0 — 2026-11-03
Personal accounts for your own team.
- **Four roles:** Owner (everything, including accounts, fees, security, go-live overrides), Manager (runs the day; cannot manage accounts, fees or security), Finance (invoices, statements, payouts, reports; read-only elsewhere) and Counter (orders, stock, reward requests).
- **Team tab** in Operations (Owner only): add people, change a role, reset a password, switch a person off. A switched-off person is signed out immediately and a role change applies at once.
- **Sign in with your own username** on Admin, Marketplace admin, Security Center, Operations and Staff. Leave the username empty to keep using the old shared passwords.
- **Audit log shows the person** ("Mark Manager (manager)") instead of "admin".
- **`TEAM_ONLY=1`** switches the shared admin and staff passwords off once at least one Owner account exists. The last Owner cannot be switched off or demoted.
- Passwords for personal accounts need 10+ characters with a letter and a number; people can change their own. On the PHP backend the authenticator code (if switched on) is also asked of Owner, Manager and Finance.
- Node and PHP backends both. New tests: `test/team.js`, `test/teamonly.js`, `test/teamui.js`.

## v5.1.0 — 2026-11-02
Fresh-market release: butchers get the cut instructions, riders and customers get a safe handover.
- **Cut to order:** for kg meat in the cart, shoppers pick how it should be cut (as it comes, cubed, minced, sliced thin, and so on). The choice goes into the order notes so the butcher sees it. Order notes are capped at 300 characters on the server.
- **Delivery handover code:** when a partner order goes out for delivery, a 4-digit code is created. The customer sees it on the tracking page only after entering the phone number used to order (the order number alone never shows it). The partner must enter the code to mark the order delivered; if the customer cannot give it, the partner can complete with a written reason, which is recorded in the audit trail. Five wrong codes lock that order for 15 minutes.
- **Stock freshness nudge:** the partner dashboard lists items marked in stock but not updated for 3 days, with a one-tap "Confirm stock is current".
- **Fix:** the tracking page now sends the phone number when you press "Show my code".
- Works on both the Node and PHP backends. New tests: `test/v51.js` (API) and `test/v51ui.js` (browser).

## v5.0.0 — 2026-11-01
Operations release, for Azizo Butchery, Ready to Eat and Azizo Kitchens.
- **Admin Operations page** (`operations.html`, linked from Admin): analytics (sales, average order, repeat customers, cancellations, busiest hours, top items, branches, Kitchens, ratings, and a visit-to-order funnel), support tickets, customer privacy and reward requests, the go-live gate, named inspector accounts and the SOP handbook.
- **Partner portal:** new Dashboard (sales today / 7 / 30 days, orders to handle, rating, best sellers), printable and CSV Statements (sales, Azizo fee, net), Go-live progress, Support tickets and the SOP handbook. Azizo Kitchens portal gets Support and the SOP handbook.
- **Go-live gate:** a partner cannot go to trial or live until licence and health certificate are verified, an inspection scores 70+ with no critical fail, 5 items are listed and the 5 onboarding steps are ticked. The admin can override with a written reason, which is recorded in the audit trail.
- **Named inspector accounts:** each inspector signs in with their own username, so every inspection is traced to a person. The shared inspector password still works.
- **23 SOPs** (Butchery B01-B09, Ready to Eat R01-R04, Kitchens K01-K04, General G01-G06) in `backend/sop` and `backend-php/data/sop` (copies in `docs/sop`).
- **Shoppers:** delivery windows that only show times still ahead, an estimated delivery or pickup time, the "replace or refund within 24 hours" promise and weight-estimate note at checkout, **Azizo Rewards** page (1 point per KES 100; Bronze, Silver, Gold; staff-approved redemption), and a **Refunds, privacy and allergens** page with data requests (Kenya Data Protection Act).
- **Backups:** `backend-php/cron/backup.php` (daily SQL dump, keeps 14) and `npm run backup` for Node.
- Anonymous funnel counts (visit, cart, checkout, order). No personal data.
- Older tests updated for the new gate. PHP side tested on a SQLite stand-in only.

## v4.4.0 — 2026-10-30
- **Partner inspection module:** web checklist form (`inspection-form.html`) on Azizo letterhead with the inspector's name and official title, 44 items in 9 categories (standard `AZ-QHI-1.0`, form `AZ/QHI/001`). Pass / Partial / Fail / N/A per item, weighted 1-3; a failed critical item caps the total at 59. Grades A-E with stars, re-inspection interval and suspend rule. Inspector and partner-representative signatures, draft autosave, mobile friendly.
- **Live in the admin portal:** new Inspections tab in Marketplace admin: live board of every franchise (refreshes every 20 s), KPI cards, scoring standard, per-partner history and a printable sealed report. Each inspection is tamper-sealed and the server always recalculates the score.
- **Scores are private:** only administrators and Azizo inspectors see numbers. The public directory shows just an "Azizo-inspected" badge (score 70+). Partners cannot see scores.
- Set `INSPECTOR_PASSWORD` in `config.local.php` / `.env` for inspector logins (admin can also open the form).
- **Azizo Kitchens orders** are now sealed with tamper signatures too (Node and PHP), checked in the Security Center.
- Note: the standard is an internal Azizo standard informed by Codex Alimentarius / HACCP / ISO 22000 principles. It is not a government certificate; have a Kenyan food-safety professional or county public health officer review it.

## v4.3.0 — 2026-10-29
- **Security Center** (`security-center.html`, opened from the Admin page): overview of the last 24 hours, a searchable **attack and failure log** (wrong passwords, lockouts, injection attempts, scanner probes, forged logins and M-Pesa payments, order price tampering) with CSV download, blocked addresses (block/unblock yourself), order integrity check, audit trail, health checklist and "sign everyone out".
- **Automatic defence:** repeat attackers are blocked (1 hour, then 24 hours, then 7 days); hacking tools (sqlmap, nikto ...) are refused at once; SQL/script/path/command injection patterns are stopped; decoy addresses (wp-login.php, .env, phpmyadmin ...) trap scanners; unusual request methods and oversized requests are refused.
- **Tamper-proof orders:** every order is sealed with a secret signature. If someone edits an order, its items, price or phone number directly in the database, the Security Center shows it and (with a cron job) emails you.
- **Alerts:** set `SEC_ALERT_EMAIL` and critical events (forged payments, tampered orders, blocked attackers) are emailed to you, at most once an hour per kind.
- **Server hardening:** HSTS, more health checks (PHP version, file permissions, signatures), a cron script (`backend-php/cron/security-watch.php`), blocked `cron/` folder.
- Node backend has the same Security Center, blocking, seals and an authenticated M-Pesa callback.
- Phone-test copy now stays in step with the main `app.js` automatically.

## v4.2.0 — 2026-10-29
- **No more fraction buttons.** The ¼ ½ ¾ quick buttons and fraction symbols are gone everywhere (shop, cart, ready to eat, partner butcheries). Items sold per kg start at 1 kg; **+** adds a whole kilo and **−** steps down by itself: 1 → 0.75 → 0.5 → 0.25 kg. Totals still work out to the shilling.
- **Fresh Meat Market opens on everything.** All products are listed, grouped under Beef, Goat, Chicken, Fish, Pork, Sausages, Packs, Nyama choma and Eggs; tapping a category narrows the list. (Nyama choma and Eggs are pulled in from Ready to Eat and Groceries; they still appear in their own tabs too.)
- **Footer:** a new "Azizo Specials" panel makes Azizo Kitchens, Curated Boxes, Meal Plan, Meat Budget Planner, Outdoor Events, Event Budget Planner and Cook with Azizo easy to spot; the Shop list is shorter.
- "½kg" in the Fish Lover's Basket description now reads 500g.

## v4.1.1 — 2026-10-29
- **Delivery fee can no longer be talked down.** The server now works out the lowest allowed fee (straight-line distance to the nearest open branch, banded by your Areas settings; free over KSh 3,000) and never accepts less, and caps it at your maximum. Pickup orders always carry no fee. The Node backend now also takes prices from your product list and recomputes totals, like the PHP one.

## v4.1.0 — 2026-10-28
- **Security hardening for multi-user use on cPanel (PHP backend).** Login lockout after repeated wrong passwords (admin, staff, customer, partner, rider), kept in the database so it survives restarts; rate limits on public forms; audit log of sign-ins and admin changes; "sign out everyone" switch; optional 2-step code for the admin (authenticator app); partner sign-ins stop working when their password changes or they are delisted.
- **Orders are re-priced on the server** so nobody can change a price in the browser. **M-Pesa callback now needs a secret** so a fake "paid" message is ignored; STK push uses the order's own amount and phone.
- **On a real server, admin and staff login stay locked until you set strong secrets** in `backend-php/config.local.php` (copy `config.local.sample.php`). Localhost / WAMP is exempt, so `majani90` still works for testing.
- Web-server rules: config, libraries, private documents and data are blocked from the web; uploads can never run code; security headers added; password minimum is now 8 with a letter and a number.
- Branch strip (Syokimau / Umoja / Buruburu / Utawala) removed from the top of the home and contact pages.
- New docs: `docs/SECURITY.md`, `docs/WAMP-LOCAL.md`.

## v4.0.0 — 2026-10-28
- **Azizo Marketplace (partner butcheries), switched OFF by default.** New pages: `butcheries.html`, `butchery.html`, `sell-with-azizo.html`, `partner-portal.html`, `marketplace-admin.html`. Partners apply, are inspected and scored, list their own items and prices (recommended prices shown beside them), receive orders and pay-direct from customers, and are invoiced by Azizo. Built in both the Node and PHP backends. See `docs/MARKETPLACE.md`.
- **Fee and invoice engine:** percent per category, tier or default, flat per order, joining fee, per-invoice fee, due dates, unpaid-invoice suspension. Nothing is charged until you set rules.
- Orders gain an optional `partner_id`; existing orders and shop flows are unchanged. The Event Budget switch now keeps the marketplace flag when saved.
- The Kitchens API helper can now reach any backend prefix (shared by the new pages).
- Phone: language pill and Buy Now button move above the bottom bar so nothing overlaps.

## v3.4.0 — 2026-10-27
- **Quarter-kilo ordering.** Items priced per kg can be ordered in steps of ¼ kg (¼, ½, ¾, 1, 1¼ …) with quick buttons ¼ ½ ¾ 1 2. Adding an item starts at 1 kg. Totals are rounded to the whole shilling. Node and PHP backends now accept fractional quantities (PHP database column upgraded automatically).
- **39 new products** (fresh meat, ready to eat, groceries) added once on upgrade; nothing existing is overwritten. **Prices on these are indicative, please confirm them** (see `docs/NEW-ITEMS-PRICE-CHECK.md`).
- **Out of stock** items stay listed and are marked "Out of stock" until staff tick them back in (Staff portal, Stock tab, global or per branch) or the admin removes them.
- **Find meat near you** (home and shop pages): search the whole market, results sorted by distance, items from further branches shown in red with the higher delivery fee, and never an empty page (if nothing matches, everything is shown). Kiswahili search words (mbuzi, kuku, samaki ...) work.
- **Phone bottom bar** (Home, Shop, Search, Cart, Orders).
- **Why trust Azizo** section on the home page combining butcher stories, sourcing, reviews and a hygiene score (shows "Audit in progress" until a real audit exists; nothing is invented).
- Not yet built: loyalty/wallet/referral and OTP login.

## v3.3.2 — 2026-10-26
- **Old EN / SW button removed from the main shop's navigation bar** on every page (the Google-powered switch is now the only one site-wide). The old built-in word list is switched off so it can't clash with it.
- **No more overlap on the main shop.** The language switch now sits bottom-centre where the floating social buttons and the Buy Now button are, and checked at five screen sizes to clear them.
- **GitHub Pages and Kitchens.** GitHub Pages serves web pages only, so it cannot run the ordering server. Kitchens now says so plainly on such hosts, still shows the area list, and offers an "Order on WhatsApp" button with the chosen area. To get full online ordering, host the backend elsewhere (cPanel PHP, or a Node host) and set `API_BASE_URL` in `site/kk-config.js`.

## v3.3.1 — 2026-10-26
- **One language switch.** The old EN | SW button in the Kitchens header is removed; the Google-powered switch (bottom-left) is the only one, on every public page including Azizo Kitchens.
- **Kitchens "service could not be found".** The site now also tries the PHP router file directly (`/api/kitchens/index.php?p=...`) when the clean address is missing (hosts where the `.htaccess` rewrite is off), and the error now names the address it tried.
- **"Your area" always shows.** If the ordering service cannot be reached, the area list loads from the site's own `areas.json` (Kitchens page and Cook-with-Azizo page), so it is never empty. Ordering still needs the backend.

## v3.3.0 — 2026-10-26
- **Whole-site Kiswahili.** A new `translate.js` uses Google's free Website Translator, so every word on every public page (including products, dishes, prices labels, menus loaded later) is translated, not only the header. A small EN | SW switch sits bottom-left on every public page; the Kitchens header switch drives the same thing. The choice is remembered, and `?lang=sw` in a link opens the page in Kiswahili. Staff, rider, admin and cook pages stay in English. Needs an internet connection; machine translation, so wording may be imperfect.

## v3.2.1 — 2026-10-25
- **Fix: Azizo Kitchens showed "Something went wrong (404)" and an empty area list.** Cause: the Kitchens pages looked for the backend at the page's own address, while on a static host the backend lives elsewhere (set only in `app.js`, with `kk-config.js` left empty). Now, when `kk-config.js` is empty and the page's own address has no Kitchens service, the pages use the backend address already set in `app.js` (and remember it). If no backend can be found, customers see "The ordering service could not be found" with the WhatsApp number instead of "(404)". The reliable setting is still `API_BASE_URL` in `site/kk-config.js`.
- The phone-test build no longer hard-codes `http://localhost:3000` for Kitchens (same address is used, so it also works from a phone on your network).
- The location button explains when the page is not https (browsers block location on plain http).

## v3.2 — 2026-10-24
- **Event enquiries**: the Event Budget Planner now has **Request a call back**. The visitor leaves name, phone, date and venue; the list, quantities and estimate go with it. Admin → **Site** tab shows an **Event enquiries** inbox (new / contacted / quoted / won / lost, your private note, call and WhatsApp buttons, CSV download). Throttled to 5 per hour per visitor, honeypot against bots, and blocked when the planner is switched off. Node `POST /api/site/leads` (public), `GET/PATCH /api/site/leads`, `GET /api/site/leads.csv` (admin); PHP mirrors it (new `site_leads` table in `schema.sql`, created automatically).
- **Share a plan**: **Copy link to this plan** gives a link that reopens the same list at today's prices.
- Planner page now carries WebApplication structured data. Service worker cache `azizo-v32`, app version 3.2.
- The PHP version is syntax-checked only (no MySQL available).

## v3.1 — 2026-10-24
- **Event Budget Planner** (`event-budget.html`, new): for parties, braais and corporate days. Build a meat list from the live product list and change quantities to see the **cost** live, or enter a **budget**, split it across the meats by percentage, and see the **quantities** it buys. Reads `/api/products` (or `products.json` on static hosting) and re-reads every minute and whenever the tab regains focus, so price, stock and product changes in the admin appear in open estimates on their own (changed rows flash, removed products are flagged, new products appear in the picker). Guests, a "suggest quantities" button (about 350 g raw per guest), starter templates built from whatever categories exist, a buffer % for waste and price changes, per-guest figures, a light/generous portion hint, PDF download, and a WhatsApp hand-off with the full list. A clear box says cooking facilities, fuel, chef and delivery are not included and are quoted on a call.
- **Admin on/off switch** (admin → new **Site** tab): turns the planner off or on, sets a note shown at the top and the buffer %. When off, every link disappears (nav, footer, Outdoor Events band and package links, Meat Budget teaser) and the page shows a "talk to us" message with `noindex`. Node `GET/PUT /api/site/settings`, PHP `api/site/index.php`; static hosting falls back to `site-settings.json`. Placement: a banner at the top of **Outdoor Events** (where event planning starts), a "Estimate the meat cost first" link on each package, the mobile menu and the Shop footer column on every page.
- **Kitchens: money** — M-Pesa "Pay now" (STK) for Kitchens orders (hidden from the cook until paid; auto-cancels after 20 min; resend or switch to pay-the-rider), promo codes (percent, flat, free delivery; minimum, expiry, usage cap), loyalty free delivery every Nth delivered order, company accounts with discount and monthly invoice, upsell of sides in the basket, order-again, saved addresses.
- **Kitchens: delivery** — rider module (`kitchens-rider.html`, phone and PIN; pickup, 4-digit customer delivery code, cash/M-Pesa amount to collect, release), live **dispatch board** with stale-order flags, manual and automatic reassign to the next best kitchen, cook scorecard, cook meat-supply requests deducted from payouts.
- **Kitchens: admin** — sub-roles (full, dispatch, accounts), audit log of every change, alerts incl. document-expiry warnings, dashboard (orders and value per day, repeat rate, top dishes, delivery times, cancellations, rating trend, demand vs supply, unmet-demand searches), economics per kitchen and dish, customer message outbox with tap-to-send WhatsApp links (optional Cloud API auto-send), payout CSV and M-Pesa bulk CSV, menu CSV for delivery apps, backups, `GET /api/kitchens/health`.
- **Kitchens: customer** — status stepper with 20 s refresh and optional browser notification, dietary tags and filters, Kiswahili toggle (main screens), lazy images, deep links (`?area=`, `?k=`, `?track=`), per-area landing pages (`kitchens-syokimau/umoja/buruburu/utawala.html`, regenerate with `gen/areapages.py`), structured data for kitchens and dishes, accessibility pass (skip link, focus rings, dialog roles, Esc, focus return, reduced motion), cross-links to Butchery and Cooking Hub.
- **Speed and operations** — cache headers for uploads and static files (`site/.htaccess`), service worker updated (price list and site switches network-first, cache `azizo-v31`), `scripts/healthcheck.sh`, `scripts/backup.sh`.
- Still needed from you: see `docs/kitchens/05-PENDING-ON-YOUR-SIDE.md`. Not built: real Web Push (the page notifies while open), one-click database restore (documented manual restore), full Kiswahili coverage.
- The PHP backend mirrors all of this and passes syntax checks, but has still never run against a real MySQL server.

## v3.0 — 2026-10-23
- **Azizo Kitchens**: a new partner-kitchen marketplace. Home cooks in your pilot estates (Syokimau, Umoja, Buruburu, Utawala) cook indigenous Kenyan lunch and dinner; Azizo markets it, sets the standards and arranges delivery. Cooks stay independent businesses (a "Kitchen Partner Programme", not employment).
- **Order-first landing page** `kitchens.html`: choose your area (or use GPS), pick the day and Lunch/Dinner, see only kitchens whose delivery radius covers you (a Karen kitchen never serves Utawala), search and filter by cuisine, add dishes with options, one-kitchen basket, cash or M-Pesa on delivery, order tracking and star ratings. New black, gold and red theme from the logo (`kk.css`).
- **Cook with us** `kitchen-partners.html`: story, how it works, FAQ and the application form (documents photographed from a phone, kept private). If a zone is full the cook joins a waiting list.
- **Partner portal** `kitchen-portal.html`: login, live orders (refreshes every 30 s, optional sound), accept / cook / ready / reject with reason, switch dishes on and off, earnings and weekly statement, profile, pause, documents, change password, the Standards summary.
- **Kitchens Admin** `kitchens-admin.html` (separate login, `KITCHENS_ADMIN_PASSWORD`): overview, applications and waiting list, vetting scorecard (average of 4.0 needed, hygiene and documents cannot be 1; override with a note), document viewer and verify ticks, approve dishes per kitchen, radius / pin / commission / strikes, list and delist, dish catalogue with photo upload and options, all orders with delivery actions, payouts ledger, zone caps, slot times, fees, commission.
- **Phase 0 kit** in `docs/kitchens/`: platform review and franchise/employer structure memo, standard kitchen playbook (23 starter dish cards), pilot kit (selection scorecard, inspection checklist, WhatsApp scripts, KPIs, go/no-go) and a 16-point partner agreement term sheet for your lawyer.
- Defaults: 20% commission (editable), lunch 12:00-14:00 (orders close 10:30), dinner 18:00-20:00 (close 16:30), delivery from KSh 100 up to KSh 400, minimum order KSh 300, four kitchens per zone.
- Both backends (Node and PHP) have the API; the PHP version has not been run on a real MySQL server.

## v2.1 — 2026-10-22
- **Meal Plan page redesigned**: the "Your Plan" panel now stays beside you as you scroll (it used to scroll away and leave a large empty space). Cause: two page-wide style settings blocked sticky positioning on every page; both fixed.
- Category chips (All, Selected, Beef, Pork, Chicken, Fish, Goat, Sausages, Packs) and a search box shorten the long list; items show 3 per row on desktop.
- Items you add are highlighted; the panel list scrolls inside the panel; on phones a pill under the search shows "N items · total · View plan" and jumps to the plan.

## v2.0 — 2026-10-22
- **Cooking Hub** (`recipes.html`, "Home of Cooking"): 78 recipes and 8 butcher's guides, covering beef, goat, lamb and mutton, chicken, pork, fish, mince and sausages, offal and traditional dishes, nyama choma and grills, and ready-to-eat favourites (shawarma, smokie pasua, samosas, fried chicken, fish and chips). Recipes are classic, well-loved dishes written for Azizo; they are not copied from other sites and carry no made-up ratings.
- **Search and filters**: type a meat or ingredient, pick a category chip, cooking style, cuisine, difficulty or maximum time, sort by featured, readers' top rated, newest, quickest or A to Z. Tabs for Recipes, Blog & Tips and My Cookbook (hearts saved on the device).
- **Recipe pages** (`recipe.html?r=...`): ingredients you can tick off, method, butcher's tip, print, "Order the meat for this" on WhatsApp, and rich-result recipe markup for Google.
- **Sharing**: WhatsApp, Facebook, X, Telegram, Pinterest, LinkedIn, email, copy link, phone share sheet, and "Send full recipe on WhatsApp" (ingredients and method as a message).
- **Engagement**: star ratings and comments with one level of replies, held for approval by default (or auto-publish in settings); "Share your recipe or ask us anything" form; WhatsApp, Facebook and branch links.
- **Admin > Recipes** (like a small WordPress): Library with search, filters and bulk publish / draft / feature / move / delete; full editor with drafts, slug, badge, tags and photo; Categories (add, rename, reorder, delete); Comments moderation with replies as Azizo; Reader submissions inbox with "Create draft from this"; Images library (upload, pick, copy address, delete); Settings and backup (auto-approve comments, download or restore recipes.json, sitemap lines).
- **Photos**: none are included. Upload your own in Admin > Recipes > Images or inside any recipe; they are resized to 1600 px automatically. Without a photo a card shows its category icon.
- Both backends (Node and PHP) have the new API; existing databases add the tables and load the starter content on first run. Static hosting without the backend still shows all recipes from `recipes.json` (comments and the form turn into WhatsApp links).

## v1.9 — 2026-10-21
- **Install the app**: on first visit, phones and PCs (Chrome, Edge, Android; Safari on iPhone shows "Share → Add to Home Screen" steps) get an "Install the Azizo app" bar. "Not now" hides it for 7 days; it never shows again once installed or when already running as an app. A footer "Install app" link brings it back.
- **Automatic updates**: the app checks for a new version when opened, when you return to it, and every 30 minutes. When one is found, an "A new version is ready — Update now" bar appears; tapping it reloads into the new version. Footer shows "App v1.9 · Check for updates" for a manual check.
- Manifest gains an app id, separate maskable icons and home-screen shortcuts (Order meat, Meat Budget Planner, Areas We Serve). New `pwa.js` on all customer pages.
- Needs HTTPS (or localhost) to install; staff, rider and admin screens are unchanged.
- **For future releases**: bump `CACHE_NAME` in `sw.js` and the version in `pwa.js` whenever you change site files. That is what tells installed apps an update exists.

## v1.8 — 2026-10-21
- **Repeat-customer layer**: the site remembers name, phone, area and address on the device and pre-fills checkout; a "Your usual" shelf of one-tap chips (shop and cart); optional standing orders (Weekly / Bi-weekly / Monthly) that appear in the staff Standing tab with a DUE badge and a one-tap "Create this order".
- **Customer status messages**: staff and rider screens get a one-tap "Tell customer" WhatsApp button prefilled for the current status. (Fully automatic messages need the WhatsApp Business API, not included.)
- **Reviews with photos**: completed orders can be reviewed from the tracking panel (order number + phone, stars, comment, optional photo). Admin > Reviews to approve, hide, reply or delete; approved reviews show on `reviews.html` with aggregateRating markup.
- **Rider screen** (`rider.html`): deliveries grouped by branch and corridor, cash to collect, Out for delivery / Delivered buttons.
- **Stock by branch**: staff mark items out per branch; checkout warns and offers a one-tap switch to a branch that has everything.
- New `DOCUMENTATION.md` with the full handbook and API table; README updated. Both backends updated (PHP not run on real MySQL).

## v1.7 — 2026-10-20
- **Areas We Serve** (`areas.html`): every region of Nairobi split into zones (138 zones in 15 regions, e.g. Umoja 1/2/Innercore, Buruburu Phase 1-5, Kilimani, Kileleshwa, Lavington, Westlands, Karen, Kasarani/Roysambu...). Customers search or pick their estate and see the serving branch, distance and delivery fee. Added to the footer, mobile menu and sitemap.
- **Admin > Areas**: tick which zones are served (single zone, whole region, or "serve all within X km of a live branch"), add/edit/delete zones with a Google Maps check of each pin, and edit the delivery pricing. Zones within about 12 km of your four live branches start ticked; the rest start off.
- **Zone-banded delivery pricing**: road distance from the nearest live branch is rounded up to a band (default 2 km), fee = base + rate per km x band, capped (defaults KSh 100 + 25/km, cap 450). Replaces the old exact-per-km formula, so areas at a similar distance cost the same. Fee estimate appears as soon as an area is chosen.
- **Smart nearest branch** at checkout: pick your area or tap "Use my location" and the nearest live branch is selected for pickup and for dispatch. Choosing a branch that is 2.5 km or more farther shows a one-tap "switch to the nearer branch" suggestion.
- **Branch closed?** Hide it in Branches and every quote, suggestion and zone re-routes to the next nearest live branch.
- Both backends (Node and PHP) have the areas API; existing databases add the tables and seed themselves.

## v1.6 — 2026-10-20
- **Floating Call and WhatsApp buttons** on every page, visible from the first moment and through all scrolling (bottom-left; they hide while the mobile menu is open). The existing Buy Now button is unchanged. WhatsApp moved out of the small social rail into these larger buttons; the rail now shows only if social links are configured.

## v1.5 — 2026-10-20
- **Preferred time** at checkout for both pickup and delivery (as soon as possible, today / tomorrow morning, afternoon, evening, or another day to confirm on WhatsApp). Replaces the old pickup-only clock field.
- **Instructions for the butcher** box (e.g. "mince the beef coarse, leave the fat on the ribs"). Appears in the WhatsApp order, the PDF receipt, and highlighted on the staff order card and printed ticket.
- Orders store the note (Node and PHP backends; existing databases update themselves).

## v1.4 — 2026-10-19
- **Meat Budget Planner** (`budget.html`): customers build a weekly, monthly or annual meat budget. Enter a name, household size and optional budget; pick meats, tick the days of the week for each, adjust the portion. Live calculator, cost per week/month/year, per-person cost, budget bar, money-saving swap tips and variety tips, a nutritional-benefits column for every meat, and a day-by-day timetable.
- **Download as PDF** (with a print fallback), share on WhatsApp, or quietly add one week's meat to the cart. Plan is remembered on the device.
- Entry points kept away from the buying flow: link on Fresh Market, banner on Meal Plan, footer and mobile menu. Nothing in the cart or checkout.

## v1.3 — 2026-10-19
- **Cost backfill** (Reports → Accounts → "Fill in costs on older orders"): copies each product's current cost price onto past order lines that have no cost yet, so older sales get a margin. Preview first, then apply; for the selected dates or all past orders. Lines that already have a cost are never changed.
- **Expenses can now be edited** (Edit button beside each entry), not only deleted and re-added.

## v1.2 — 2026-10-19
- **Reports module (admin → Reports tab)** for the owner, sales, business-development and accounting hats: Overview (revenue, orders, average order, profit, customers, cancellations, time to complete, plain-language "what to act on", sales trend, busiest hours, best weekdays), Products & Sales (best sellers with margin and A/B/C class, categories, low margin, sold out, no-sales items), Branches & Delivery, Customers (new vs repeat, top customers, win-back list with WhatsApp nudge, promo codes), Payments & Cash (collected vs outstanding, M-Pesa receipt reconciliation, cash to bank) and Accounts (profit & loss, expenses, optional tax estimate).
- Date presets and custom range, branch filter, comparison with the previous equal period, sortable tables with CSV download, Print / Save as PDF.
- **Accountant pack (.xlsx)**: P&L, daily sales, products, branches, payments, expenses and the full sales ledger (PHP backend: sales ledger only).
- **Expenses**: record rent, salaries, utilities, transport, stock purchases etc. in Reports → Accounts.
- **Cost price per product** (private, admin only) in the product form and Excel import/export; each sold item keeps the cost that applied that day so margins stay accurate. Orders now keep a status history for "time to complete".
- Both backends (Node and PHP) produce identical report numbers.

## v1.1 — 2026-10-18
- **Product cards redesigned marketplace-style:** photos fill the card edge to edge (4:3), equal-height rows, two-line titles, bold price, full-width Add button, two cards per row on phones. Fixes the empty strip beside uploaded photos.
- Admin photo form now shows a tip on the best photo shape (landscape 4:3, e.g. 1200 × 900).

## v1.0 — 2026-10-17
- **Staff screen** (`staff.html`): live order queue with full tickets, one-tap status steps, call / WhatsApp / map buttons, print ticket, Today totals, sold-out switch, promo codes, branch directory. Own `STAFF_PASSWORD`.
- **Order tracking** by order number (`?track=123`), tracking link in the WhatsApp order message, "Track My Order" link in every footer.
- **Branches** managed in admin (show/hide, edit, per-branch phone); WhatsApp number stays shared. 10 new Nairobi branches added, hidden until published.
- **Free maps**: OSRM road distance, Photon + Nominatim address search (Google optional).
- **Products**: new items (sausages, stew packs, fish baskets, broth bundle), Free-Range badge fix, new short descriptions, "Read more" on cards.
