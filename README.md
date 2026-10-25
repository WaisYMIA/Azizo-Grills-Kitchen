# Azizo Butchery & Grill — Website + Backend

Full source for the Azizo Butchery and Grill website: a static, responsive
multi-page frontend (home, fresh market, ready-to-eat, meal planner, meat budget planner, areas we serve, outdoor
events, recipes, about, reviews, FAQ, contact) backed by an admin-managed
product catalog and order log. The frontend adapts across mobile, tablet and
desktop breakpoints and works as an installable PWA.

## Repo structure

```
site/           Static frontend — HTML/CSS/JS, deploy as-is to any web host
backend/        Node.js + Express + SQLite API (recommended)
backend-php/    PHP + MySQL alternative API, for hosts without Node support
```

Pick **one** backend, not both — `site/app.js`'s `CONFIG.API_BASE_URL` just
needs to point at whichever one you deploy. Without any backend running, the
site still works fully off the bundled `site/products.json` snapshot and
sends orders over WhatsApp; the backend adds a live-editable catalog, an
admin orders dashboard, and optional customer accounts.

## Quick start (Node backend, local)

```bash
cd backend
npm install
cp .env.example .env    # then edit ADMIN_PASSWORD, STAFF_PASSWORD and JWT_SECRET
npm start                # or: node server.js
```

Then open `site/index.html` with `site/app.js`'s `CONFIG.API_BASE_URL` set to
`http://localhost:3000` (or serve the whole repo with any static file server
so relative paths resolve). Admin dashboard: `site/admin.html`; staff `site/staff.html`; riders `site/rider.html`.

## Quick start (PHP backend, alternative)

See `backend-php/config.php` and `backend-php/schema.sql` — point a MySQL
database at the schema, edit the config constants (or set the matching
environment variables), and point your web server's document root at
`backend-php/`.

## Documentation

- `DOCUMENTATION.md` - features, handbook, pricing, configuration, API reference, go-live checklist
- `CHANGELOG.md` - what changed in each version
- `backend/README.md` - Node backend setup and deployment

## Deploying for real

- `backend/README.md` — Node backend setup, environment variables, and how
  it connects to the frontend.
- Before go-live: set real `ADMIN_PASSWORD`/`JWT_SECRET` values, add real
  M-Pesa Daraja credentials and a Google Maps API key if you want live
  delivery-distance pricing, replace placeholder product photos via the
  admin dashboard, and verify branch GPS coordinates.

## What is new in v3.2
Event Budget Planner enquiries: "Request a call back" with an Event enquiries inbox in Admin → Site, and shareable plan links. See `CHANGELOG.md`.

## What was new in v3.1
**Event Budget Planner** (`event-budget.html`, admin on/off in the new **Site** tab) and a large Azizo Kitchens upgrade: M-Pesa pay-now, promo codes, riders with delivery codes, dispatch board, dashboard and economics, sub-role admin logins, audit log, customer messages outbox, per-area landing pages. New optional `.env` values: `KITCHENS_DISPATCH_PASSWORD`, `KITCHENS_ACCOUNTS_PASSWORD`, `SITE_URL`, `WA_TOKEN`, `WA_PHONE_ID`. Scripts in `scripts/` (health check, backup). **Read `docs/kitchens/05-PENDING-ON-YOUR-SIDE.md`** for what only you can do. Details in `CHANGELOG.md`.

## What was new in v3.0 (Azizo Kitchens)
Partner home-kitchen marketplace: `kitchens.html` (order), `kitchen-partners.html` (apply), `kitchen-portal.html` (cook login), `kitchens-admin.html` (separate admin). Set `KITCHENS_ADMIN_PASSWORD` in the backend `.env` (or `config.php`). On a static host set `API_BASE_URL` in `site/kk-config.js`. Operating documents are in `docs/kitchens/`. See DOCUMENTATION.md, "Azizo Kitchens (v3.0)".

## What was new in v2.0
The Cooking Hub: 78 recipes and 8 butcher's guides with search, filters, sharing, comments, and a full Recipes manager in the admin panel (photos are yours to upload). See `CHANGELOG.md` and the Cooking Hub section of `DOCUMENTATION.md`.

## What was new in v1.9
Install prompt for phones and PCs, plus automatic update checks. See `CHANGELOG.md` and `DOCUMENTATION.md`.

## What is in this version (v1.8)

The full feature guide, staff/admin handbook, delivery-pricing formula and API reference are in **`DOCUMENTATION.md`**.
In short:

- **Customer site:** shop, cart and WhatsApp checkout with **preferred time**, **butcher instructions**, **area + nearest-branch** suggestions and **zone-banded delivery fees**; **Areas We Serve** (`areas.html`); **Meat Budget Planner** (`budget.html`); meal plans with recurring orders; order tracking; **verified reviews** (with photo); **your usual** and saved details for returning customers; floating Call and WhatsApp buttons.
- **Staff (`staff.html`, `STAFF_PASSWORD`):** live orders with one-tap **WhatsApp status messages**, today's totals, **stock per branch**, **standing (recurring) orders** with one-tap repeat, promo codes, branch directory.
- **Riders (`rider.html`):** today's deliveries grouped by branch and road, cash to collect, call / WhatsApp / map, delivered button.
- **Admin (`admin.html`, `ADMIN_PASSWORD`):** Products (with private cost prices), Orders, **Branches** (add, show or hide, e.g. when closed), **Areas** (all Nairobi regions split into zones, tick which are served, delivery pricing), **Reviews** (moderation), **Reports** (sales, profit & loss, accountant Excel pack).
- **Free map services:** delivery distance uses OSRM road distance (estimate if unreachable); address search uses Photon with OpenStreetMap Nominatim as backup. A Google key (optional) is used first when set.
- **Catalog top-up:** on start-up an existing database gets new menu items once without touching your edits. Prices are placeholders: edit them in admin.
- **Without a backend** the site still works from `products.json`, `branches.json` and `areas.json` and sends orders over WhatsApp; staff, rider, reviews, reports and admin need the backend.
- **PHP backend:** same API as the Node one, but not yet run against a real MySQL server, and its products API has no groceries group.

## Responsive design

Every page ships with mobile/tablet/desktop breakpoints (verified at
375px, 768px and 1440px widths with zero horizontal overflow, including the
admin orders dashboard) and a mobile-first checkout flow. No further work is
needed here before launch.
