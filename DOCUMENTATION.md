# Azizo Butchery & Grill — Documentation (v1.8)

Everything the site, the staff screens and the admin tool do, how to set each one up, and what the
backend exposes. Version history is in `CHANGELOG.md`; setup commands are in `README.md` and
`backend/README.md`.

---

## 1. What is in the package

| Folder | What it is |
|---|---|
| `site/` | The website and the working screens: static HTML/CSS/JS, deploy as-is to any web host |
| `backend/` | Node.js + Express + SQLite API (recommended) |
| `backend-php/` | The same API for PHP/MySQL hosts (cPanel without Node). Use **one** backend, not both |

The three delivered zips share one version number: `azizo-github-ready-vX.Y` (source for GitHub),
`azizo-complete-project-vX.Y` (cPanel deployment, both backends) and `azizo-phone-test-vX.Y` (runs on
one machine at `http://localhost:3000` with a single Node process, for trying things out).

Without any backend the website still works fully: products come from `site/products.json`, branches from
`site/branches.json`, delivery zones from `site/areas.json`, and orders go out over WhatsApp. The backend adds the
live catalog, order log, staff and rider screens, reviews, reports and the admin tool.

---

## 2. What customers get

| Feature | Where | Notes |
|---|---|---|
| Fresh market, ready to eat, groceries, curated boxes | `fresh-market.html`, `ready-to-eat.html`, `groceries.html`, home | Sold-out items are shown as "Sold out" and cannot be added |
| Cart and checkout over WhatsApp | cart drawer, every page | Sends a WhatsApp message plus a PDF order sheet; also saved in the order log when the backend is on |
| **Preferred time** | checkout | As soon as possible, today / tomorrow morning, afternoon, evening, or another day to confirm on WhatsApp. Works for pickup and delivery |
| **Instructions for the butcher** | checkout | Free text (cut, mince, leave the fat on). Appears in the WhatsApp message, the PDF, the staff card and printed ticket |
| **Your area and nearest branch** | checkout | Pick an estate or tap "Use my location". The nearest live branch is chosen for pickup and for delivery dispatch, and a suggestion appears if a farther branch is picked |
| **Delivery fee by zone** | checkout, `areas.html` | See section 6. Free above `CONFIG.FREE_DELIVERY_THRESHOLD` (KSh 3,000 by default) |
| **Areas We Serve** | `areas.html` | Search or pick an area, see the serving branch, distance and fee; fee table; ask-on-WhatsApp link for unlisted areas |
| Meal plans and **recurring orders** | `meal-planner.html` | Tick "recurring order" (weekly, every 2 weeks, monthly). Staff confirm each cycle on WhatsApp; nothing is charged automatically |
| **Meat Budget Planner** | `budget.html` | Weekly, monthly, annual meat budget with per-meat days and portions, an automatic calculator, nutrition benefits, tips and a PDF download |
| **Your usual** | home, Fresh Market, cart | The things a customer orders most, one tap to add. Remembered **on that device only** |
| **Saved details** | checkout | Name, phone, area, address and delivery/pickup choice are filled in for returning customers (this device only) |
| Order tracking | Account ▸ Track an order, or any page with `?track=123` | Status from the order number alone; once an order is **completed** the same panel offers a review |
| **Reviews with photo** | tracking panel, `reviews.html` | Order number + phone, completed orders only, one per order; shown after admin approval. See section 5.5 |
| Floating **Call** and **WhatsApp** buttons | every page | Bottom-left; the Buy Now button is unchanged |
| Customer accounts (optional) | Account button | Order history and reorder; never required to order |

Customer data kept in the browser (not on any server): `azizoCustomer` (saved details), `azizoHabits` (your-usual counts),
`azizoLastOrder`, `azizoActiveCart`, `azizoArea`, `azizoBudgetPlan`, tracked order numbers. Clearing site data removes them.

---

## 3. Staff and rider screens

Set `STAFF_PASSWORD` in `backend/.env` (different from `ADMIN_PASSWORD`). Staff open `staff.html`; riders open
`rider.html` (staff sign-in works on both). They cannot change prices, products, branches, areas or settings.

### 3.1 `staff.html`

- **Orders**: live queue (refreshes by itself, optional sound), full ticket, one-tap status steps
  (received → preparing → ready / out for delivery → completed), call, map, print ticket, cancel.
  **Tell customer** opens WhatsApp with a ready message for the order's current status (received, being prepared,
  ready for pickup, on its way, completed with a link to leave a review, cancelled). The message is pre-written; staff tap Send.
- **Today**: orders, sales, average order, open now, by fulfilment / payment / branch, most ordered.
- **Stock**: the switch marks an item sold out. Choose **All branches** for sold out everywhere, or **Only at <branch>**
  to mark it out at one branch only. A branch-level switch never overrides "sold out everywhere".
- **Standing**: customers with a recurring order. **Due** appears when the cycle is up. **Ask to confirm** opens WhatsApp
  with their usual order; **Create this order** copies their last order into the queue at today's prices (same address, no promo).
- **Promo codes**: generate 5–20% codes. **Branches**: directory with call and map buttons.

### 3.2 `rider.html`

Today's deliveries that are not finished, grouped by branch and road/corridor (the corridor comes from the customer's area
in Admin ▸ Areas), so a rider can batch stops that lie along one road. Each stop shows the address, preferred time, items,
**COLLECT KSh X cash** (or "paid, M-Pesa"), butcher notes, and Call / WhatsApp / Map buttons. **Out for delivery** and
**Delivered** update the order; **Send N out** starts a whole group. The branch filter is remembered. Orders still being
packed are shown dimmed.

---

## 4. Admin (`admin.html`)

Sign in with `ADMIN_PASSWORD`. Tabs:

| Tab | Use |
|---|---|
| **Products** | Add/edit products, photos, **cost price** (private), Excel import/export |
| **Orders** | Every order, filter, change status |
| **Branches** | **+ Add Branch**; **Show on website** ticks a branch live or hides it (e.g. while closed); edit address, map pin, hours, phone |
| **Areas** | Delivery zones and delivery pricing (section 6) |
| **Reviews** | Approve, hide, reply to or delete customer reviews; the tab shows how many are waiting |
| **Reports** | Sales, products, branches, customers, payments, profit & loss, expenses, accountant Excel pack |

**A branch that is closed or not yet open:** untick *Show on website*. It disappears from the site, from checkout,
and from every distance, fee and nearest-branch calculation (zones are priced from the next nearest live branch).
At least one branch (the main one) must stay live.

---

## 5. How each feature works

### 5.1 Areas and zones (`areas.html`, Admin ▸ Areas)

Every region of Nairobi is split into zones, e.g. Umoja → Umoja 1, Umoja 2, Umoja Innercore, Umoja 3 / Tena; Buruburu → Phases 1–5;
Kilimani, Kileleshwa, Lavington, Westlands, Karen, Kasarani, Roysambu, Embakasi, Syokimau and more (138 zones in 15 regions at install).
Each zone has a corridor (the road riders use, e.g. "Mombasa Road") and a map pin.

- Tick a **zone** or a whole **region** to serve it; untick to stop. Changes show on the site immediately.
- **Quick select by distance**: "Serve all within X km" or "Stop serving beyond X km" of a live branch.
- **+ Add zone / Edit / Delete**. **Map ↗** opens the pin in Google Maps so you can check it.
- At install, zones within about 12 km road distance of the four live branches are ticked; the rest are off.
- **The pins are approximate area centres, not surveyed points.** Check the ones you actually deliver to.

### 5.2 Nearest branch

Reference point = the customer's chosen area, their delivery pin, or "Use my location" (only on tap). The nearest **live** branch that
has **every item in the cart** in stock is selected automatically, until the customer picks a branch themselves. If they pick one that is
`nearerBranchKm` (default 2.5 km) or more farther than the nearest, a suggestion offers a one-tap switch. Location is used in the browser only.

### 5.3 Stock by branch

Per-branch stock stores only what is **out** at a branch (`branch_stock_out`). In checkout, if the chosen branch has run out of something
in the cart, a warning offers the nearest branch that has everything; placing the order is blocked until it is fixed. The global switch
(Products / Stock ▸ All branches) still applies everywhere.

### 5.4 Standing (recurring) orders

Stored on each order (`recurring` = Weekly, Bi-weekly or Monthly). The Standing tab lists each customer's latest recurring order and how long since
they last ordered. There is no automatic billing or automatic sending: staff message the customer, then create the order.

### 5.5 Reviews

- A customer can review **a completed order** by giving the order number (the tracking link already has it) and the phone used on the order; one review per order.
- Optional photo: resized in the browser (max about 1000 px) and checked on the server (JPG/PNG/WebP only, 900 KB max). Review submissions are limited to 5 per hour per visitor.
- New reviews are **Pending** and invisible until approved in Admin ▸ Reviews. Approved reviews appear on `reviews.html` with the average rating (also published as `aggregateRating` for search engines).
- The customer's name is shortened to first name + initial. The admin can add a short public reply.

### 5.6 Customer messages (WhatsApp)

Staff and riders send status messages with one tap from pre-written text. **Fully automatic messages** (sent with no one tapping Send) need the
WhatsApp Business Cloud API (a Meta business account, an approved message template, a paid per-conversation fee). They are **not** included.
The existing message texts in `staff.html` (`statusMessage`) are the starting point if you add that later.

### 5.7 Reports

Admin only. Date presets, branch filter, comparison with the previous period, CSV, print/PDF and an Excel accountant pack. Profit is shown as an
estimate until most sales have a **cost price**; use Reports ▸ Accounts ▸ "Fill in costs on older orders" to apply current cost prices to old lines.
Tax figures are optional estimates; confirm with your accountant.

---

## 6. Delivery pricing

Road distance is taken from the nearest live branch (an estimate from straight-line distance × the road factor for zones; real road distance from OSRM when the
customer gives an exact address). It is **rounded up to a band**, so zones at a similar distance share one price:

```
fee = min( maxFee , baseFee + ratePerKm × band )        band = distance rounded up to the next bandKm
```

Defaults (Admin ▸ Areas ▸ Delivery pricing): base KSh 100, KSh 25 per km, 2 km bands, cap KSh 450, WhatsApp-confirm beyond 30 km, road factor 1.3.

| Road distance | Fee |
|---|---|
| 0–2 km | KSh 150 |
| 2–4 km | KSh 200 |
| 4–6 km | KSh 250 |
| 6–8 km | KSh 300 |
| 8–10 km | KSh 350 |
| 10–12 km | KSh 400 |
| 12 km and over | KSh 450 (cap) |

Orders at or above the free-delivery threshold pay no fee. All seven numbers are editable, with a live preview, and take effect immediately.

---

## 7. Configuration

**`backend/.env`**

| Variable | Meaning |
|---|---|
| `PORT` | Port the API listens on |
| `JWT_SECRET` | Random secret for login tokens (generate a long random string) |
| `ADMIN_PASSWORD` | Admin tool login (use a strong one) |
| `STAFF_PASSWORD` | Staff and rider login; leave blank to switch staff login off |
| `DB_PATH` | SQLite file location (needs persistent disk) |
| `TZ_OFFSET_HOURS` | Hours ahead of UTC for "today" (Nairobi = 3) |
| `MPESA_*` | Safaricom Daraja credentials (optional) |

**`site/app.js` → `CONFIG`**: `API_BASE_URL` (where the backend lives), `WA_NUMBER`, `FREE_DELIVERY_THRESHOLD`, `LOYALTY_REORDER_DISCOUNT_PCT`,
social links, optional `GOOGLE_MAPS_API_KEY` / `GOOGLE_PLACE_ID`, and tracking IDs. The passcodes in the site source are only a light deterrent: real
protection is a strong `ADMIN_PASSWORD` and a random `JWT_SECRET` on the backend.

---

## 8. API reference (Node and PHP behave the same)

Auth: **none** = public; **staff** = staff or admin token; **admin** = admin token; **customer** = logged-in customer.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | none | Server check |
| POST | `/api/auth/register`, `/login` | none | Customer account |
| POST | `/api/auth/admin-login`, `/staff-login` | none | Admin / staff sign-in |
| GET | `/api/products` | none | Public menu (never includes cost price) |
| GET | `/api/products/admin/list` | admin | Menu with cost prices |
| POST / DELETE | `/api/products`, `/api/products/:id` | admin | Create/update, delete |
| PATCH | `/api/products/:id/stock` | staff | Sold out everywhere |
| GET / POST | `/api/products/export.xlsx`, `/import.xlsx` | admin | Excel catalog |
| GET | `/api/branches` | none | Live branches |
| GET | `/api/branches/all` | staff | All branches |
| POST / PATCH / DELETE | `/api/branches`, `/:id/listed`, `/:id` | admin | Manage branches |
| GET | `/api/areas` | none | Served zones + pricing settings |
| GET | `/api/areas/all` | staff | Every zone |
| POST | `/api/areas`, `/bulk`, `/config` | admin | Zone, bulk tick, pricing |
| DELETE | `/api/areas/:id` | admin | Delete a zone |
| GET | `/api/branch-stock` | none | `{out: {branchId: [productId…]}}` |
| POST | `/api/branch-stock` | staff | `{branchId, productId, inStock}` |
| POST | `/api/orders` | none / customer | Create an order (`notes`, `area`, `recurring`, `pickup_time` accepted) |
| GET | `/api/orders` | staff | Queue (`status`, `branch`, `date=today`, `q`) |
| GET | `/api/orders/summary` | staff | Today's totals |
| GET | `/api/orders/standing` | staff | Latest recurring order per customer |
| POST | `/api/orders/:id/repeat` | staff | Copy an order as a new one |
| GET | `/api/orders/track?id=` | none | Status only (rate-limited), includes `reviewed` |
| GET | `/api/orders/me/history` | customer | Own orders |
| GET | `/api/orders/:id` | staff | One order with items |
| PATCH | `/api/orders/:id/status` | staff | received, preparing, ready, out_for_delivery, completed, cancelled |
| GET | `/api/reviews` | none | Approved reviews + average |
| POST | `/api/reviews` | none | `{orderId, phone, rating, comment?, photo?, name?}` (rate-limited) |
| GET | `/api/reviews/all` | admin | All reviews |
| PATCH / DELETE | `/api/reviews/:id` | admin | `{status, reply}`, delete |
| GET/POST/PUT/DELETE | `/api/reports/*` | admin | Reports, expenses, cost backfill, Excel pack |
| POST / GET | `/api/mpesa/stkpush`, `/callback`, `/status/:id` | none | M-Pesa STK Push |

Database changes are applied automatically on start-up (new tables and columns are added; nothing is dropped).

---

## 9. Before you go live

1. Set a strong `ADMIN_PASSWORD`, a different `STAFF_PASSWORD`, and a random `JWT_SECRET`. The shipped defaults (`majani90`, `staff1234`) are for testing only.
2. Enter **cost prices** for your products; record expenses; add real photos.
3. Check the **map pins** of your branches and of the zones you serve (Admin ▸ Branches and ▸ Areas ▸ Map ↗). Untick zones you do not yet serve.
4. Decide your **delivery pricing** in Admin ▸ Areas and view the fee table on `areas.html`.
5. Add M-Pesa Daraja credentials if you want STK Push (needs an HTTPS callback URL).
6. Put the database on persistent disk and back it up regularly (the SQLite file and `backend/uploads/`).
7. Place a few real test orders and check the Orders, Rider, Standing and Reports screens, then approve a test review.

## 10. Known limits

- The PHP backend has been syntax-checked and its report maths compared with the Node version, but it has **not** been run against a live MySQL server here. Test it on your host first.
- Zone coordinates are approximate; delivery fees for zones are estimates until the customer gives an exact address.
- Customer memory (your usual, saved details) is per device and browser; it is not an account feature.
- Automatic WhatsApp status messages, card payments and Google Reviews import are not included.
- The Node backend is the complete one; the PHP products API has no groceries group.

## Installing the app and automatic updates (v1.9)

- **Install:** visitors see an install bar on first visit (Android/Chrome/Edge/PC). On iPhone it shows the Add to Home Screen steps. It requires HTTPS, so it works on your live domain and on `localhost`, not on a plain `http://192.168...` address.
- **Updates:** installed apps check for a new version on open, on return and every 30 minutes, then offer "Update now".
- **Releasing an update:** change the site files, then edit two things: `CACHE_NAME` in `site/sw.js` (e.g. `azizo-v20`) and `APP_VERSION` in `site/pwa.js`. Upload. Visitors get the prompt automatically. Without the `CACHE_NAME` bump, apps will not know anything changed.
- On cPanel, make sure `sw.js` is not cached by the server for long (default settings are fine).

## Cooking Hub (v2.0)

**Public pages:** `recipes.html` (search, filters, tabs, share-your-recipe form) and `recipe.html?r=<slug>` (single recipe or blog post with sharing and comments).

**Admin > Recipes** has seven sections:
1. **Library:** every recipe and blog post. Search, filter by type / category / status, tick several and publish, make draft, feature, move category or delete in one go. Edit, View, Copy (duplicate as draft) and Delete per row.
2. **New / Edit:** type (Recipe or Blog post), title, web address, summary, times, servings, difficulty, style, cuisine, ingredients (one per line; `## Heading` makes a group), method (one step per line), butcher's tip, extra notes, tags, badge label, featured, Published or Draft, and the photo.
3. **Categories:** the filter chips on the public page. Renaming updates every recipe; a category must be empty before it is deleted.
4. **Comments:** Pending, Approved, Hidden, All. Approve, hide, delete, or reply as "Azizo team". "Approve all shown" for quick clearing.
5. **Reader submissions:** recipes, questions and feedback sent from the public form. "Create draft from this" opens the editor pre-filled; reply on WhatsApp or by email.
6. **Images:** upload once, reuse anywhere. Photos are resized and compressed in the browser.
7. **Settings & backup:** auto-publish comments, download or restore `recipes.json`, sitemap lines for new recipes.

**Adding photos:** Admin > Recipes > edit a recipe > Photo > Upload photo (or Choose from library). Images are stored in `backend/uploads/media` (Node) or `uploads/media` (PHP); keep that folder when you redeploy.

**Writing blog posts:** choose Type = Blog post. In the text, a blank line starts a paragraph, `## Heading` makes a heading, `- item` makes a bullet and `**word**` makes bold.

**Comments and spam:** new comments wait for approval by default. Links are limited, a hidden field catches simple bots, and each visitor can post 8 times per hour.

**Search engines:** each recipe page sets its own title, description and recipe markup. Add new recipes to `sitemap.xml` with the button in Settings & backup. Google reads these pages after running the page script, which it does, though static pages index slightly faster.

**Without the backend (static hosting):** the public pages read `recipes.json`. Download a fresh copy from Settings & backup and replace the file in the site folder after editing. Comments, ratings and the submit form need the backend.

**API (v2.0)**

| Method and path | Who | What |
|---|---|---|
| `GET /api/recipes` | public | published recipes, blog posts, categories |
| `GET /api/recipes/:id/comments` | public | approved comments |
| `POST /api/recipes/:id/comments` | public | comment, rating, or reply (`parentId`) |
| `POST /api/recipes/submit` | public | reader recipe, question or feedback |
| `GET /api/recipes/admin/all` | admin | everything incl. drafts and pending counts |
| `POST /api/recipes/admin`, `PUT` / `DELETE /api/recipes/admin/:id` | admin | create, update, delete |
| `POST /api/recipes/admin/bulk` | admin | publish, draft, feature, unfeature, category, delete |
| `GET /api/recipes/admin/export`, `POST .../import` | admin | backup and restore |
| `POST .../settings`, `.../categories`, `.../comments`, `.../submissions` | admin | settings, categories, moderation, inbox |
| `GET`, `POST /api/media`, `DELETE /api/media/:file` | admin | image library |



## Azizo Kitchens (v3.0)

**What it is.** A marketplace for homemade lunch and dinner. Vetted home kitchens cook a standard menu of Kenyan dishes; customers pre-order for today, tomorrow or the day after; Azizo arranges delivery and keeps a commission (default 20%).

**Pages.** `kitchens.html` customer ordering (landing page), `kitchen-partners.html` story and application, `kitchen-portal.html` cook login and dashboard, `kitchens-admin.html` the separate admin. Shared files: `kk.css`, `kk-common.js`, `kk-config.js`.

**Setup.** 1) Node: add `KITCHENS_ADMIN_PASSWORD=...` to `backend/.env` (PHP: `KITCHENS_ADMIN_PASSWORD` in `config.php`). Without it the Kitchens Admin login is off (the main admin password also works). 2) Static hosting: set `API_BASE_URL` in `site/kk-config.js`. 3) Open `kitchens-admin.html`, review Dishes and Zones and settings, then invite cooks.

**Kitchen life cycle.** applied (or queued if the zone is full) > vetting > pilot > live > paused / delisted / rejected. Going live needs: all seven vetting scores with an average of at least 4.0 (hygiene and documents not 1), at least one approved dish, and a free place in the zone (override with a note). Cooks see only dishes you approve for them.

**Coverage.** A kitchen serves a customer only if straight-line distance x road factor (1.3) is within its radius (default 4 km). Customers pick an area (area pins are approximate) or share GPS. Delivery fee = KSh 100 + KSh 25 per 2 km band, capped at KSh 400 (all editable).

**Orders.** new > accepted > preparing > ready (by the cook) > out for delivery > delivered (by you). The server checks the kitchen is live and covers the customer, the dish is approved and switched on, prices (including option prices) come from the database, the slot date and cut-off use Nairobi time, capacity and minimum order. The commission is stored on each order when it is placed.

**Money.** Customers pay the rider cash or M-Pesa on delivery. The cook's earnings are food sold minus commission (delivery fees stay with Azizo). Record weekly payments in Payouts; the cook's portal shows the balance. M-Pesa STK push for Kitchens orders is not automated in v3.0.

**Documents.** Partner documents are stored privately (`backend/private/kitchen-docs`, `backend-php/private/kitchen-docs`; PHP folder is blocked by its own `.htaccess`) and are served only to the Kitchens Admin. Dish photos go to `uploads/kitchens` and are public.

**API.** All under `/api/kitchens`. Public: `GET /config /areas /dishes /search?area=|lat=&lng=&date=`, `POST /orders /apply`, `GET /orders/track`, `POST /orders/:id/rate`. Partner (token from `POST /partner/login`): `/partner/me /orders /statement /documents /password`, `POST /partner/dishes/:id/available`, `PATCH /partner/orders/:id/status`. Admin (`POST /admin-login`): `/admin/overview /kitchens /dishes /orders /payouts /settings /upload /images`.

**Limits.** The partner agreement and the delivery/courier licence position must be reviewed by a Kenyan lawyer before real cooks sign up (see docs/kitchens/01 and 04). Prices and dishes are pilot placeholders. Platform listing (Glovo, Bolt Food, Uber Eats) is a manual step for now. The PHP backend has been syntax-checked but not run against a live MySQL database.


## Event Budget Planner (v3.1)
**What it is.** `event-budget.html` helps a host estimate the meat for an event. Mode 1 (cost from quantities): choose products, set kilograms (or birds, packs), see line costs and the total. Mode 2 (quantities from budget): enter a budget, give each product a percentage share, and the planner turns each share into a quantity at today's price (rounded down to 0.5 kg or whole units, so the total never exceeds the budget). The buffer % (default 10, set by the admin) is added to cost estimates, and in budget mode the buffer is taken out of the budget first.

**Live prices.** The planner reads `/api/products` (fresh items only), falls back to `products.json` on static hosting, and refreshes every 60 seconds and when the browser tab regains focus. Any price, name, stock change, new product or deleted product shows up in open estimates; changed rows flash and the visitor sees a short notice.

**Switch.** Admin → **Site** tab: tick or untick "Show the Event Budget Planner on the website", set the optional note and the buffer %, press Save. Customers see the change within a minute. When off, all elements marked `data-eb-link` are hidden by `eb-flag.js` (it remembers the last known state to avoid flicker), the page shows a "talk to us" message and adds `noindex`. API: `GET /api/site/settings` (public), `PUT /api/site/settings` (admin). On static hosting without a backend, edit `site-settings.json`.

**Where the links are.** Banner and per-package links on `outdoor-events.html`, mobile menu and Shop footer column on every public page, teaser on `budget.html`. To place a link elsewhere, add `data-eb-link` to the element.

**Not included in estimates.** Cooking facilities (grills), fuel, chef or grill master, serving staff and ware, delivery. The page says so and the WhatsApp button opens a pre-filled message asking for a call about them.

## Azizo Kitchens v3.1 additions
**Logins.** `KITCHENS_ADMIN_PASSWORD` (everything), `KITCHENS_DISPATCH_PASSWORD` (dispatch board, orders, riders, messages, supply, dashboard), `KITCHENS_ACCOUNTS_PASSWORD` (payouts, economics, exports, invoices, dashboard). Every change is written to the audit log. Riders get a phone and PIN from the Riders tab and use `kitchens-rider.html`.

**Order lifecycle.** new → accepted → preparing → ready → out for delivery → delivered (or cancelled/rejected). Each customer order has a 4-digit delivery code that the rider must enter. Pay-now orders stay hidden from the cook until the M-Pesa payment arrives and are cancelled after 20 minutes unpaid. Orders unaccepted for 15 minutes or ready for 30 minutes with no rider are flagged on the dispatch board. With "automatic reassign" on, a rejected order moves to the next best kitchen (in range, has the dishes, has capacity).

**Money.** Total = food + delivery − discount. Commission is calculated on food only. Promo and company discounts and the loyalty free delivery are shown to the customer before ordering. Cooks can request meat from Azizo Butchery; supplied requests are deducted from their balance. Payout CSV and an M-Pesa bulk CSV are in Exports.

**Messages.** Each event (placed, accepted, ready, on the way, delivered, rejected, cancelled, moved) creates a message in the Messages tab; tap Send on WhatsApp to send it from your phone. With `WA_TOKEN` and `WA_PHONE_ID` set it also tries to send automatically.

**Monitoring and backups.** `GET /api/kitchens/health`; `scripts/healthcheck.sh <url>` for cron or an uptime monitor; `scripts/backup.sh` for dated database and upload copies; Exports → Backups for downloads. Restore: stop the app, replace the database file with the backup copy, start the app.

**Area pages.** `python3 gen/areapages.py site` regenerates `kitchens-<area>.html` and the sitemap entries from `kitchens.html` (rerun it after editing `kitchens.html`). Edit the AREAS list in the script to add estates.

**Event enquiries (v3.2).** The planner's "Request a call back" posts to `POST /api/site/leads` with the visitor's contact details and the current list. Admin → Site → Event enquiries lists them newest first; set the status as you work them (new, contacted, quoted, won, lost) and keep a private note. CSV download is in the same panel. The visitor gets a plain thank-you; no automatic message is sent until WhatsApp API keys are set up, so check the inbox daily (the Site tab shows the number of new enquiries). "Copy link to this plan" encodes the list in the link; quantities come from the link and prices are always today's.
