# Changelog

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
