# Azizo Butchery & Grill — Backend API

A real backend with a database — products, orders (the after-sales record the
business asked for), customer accounts, and M-Pesa STK Push. Built with
Node.js, Express, and SQLite. Every endpoint has been tested locally
(registration, login, order creation, admin listing, status updates, access
control, and graceful M-Pesa failure when unconfigured) — this is working
code, not a sketch.

## What's real vs. what needs your own credentials

**Works immediately, no setup:** products, orders, customer accounts — all of it,
the moment you run `npm install && npm start` with a `.env` file.

**Needs your own Safaricom developer account:** M-Pesa STK Push. The code is complete
and correct, but nothing can make real Daraja API calls without your own Consumer Key,
Consumer Secret, Shortcode, and Passkey — see `routes/mpesa.js` for the exact signup
steps. Until configured, it fails safely with a clear error instead of pretending to work.

**Needs a public HTTPS URL:** the M-Pesa callback specifically — Safaricom's servers
call it directly, so it can't be `localhost`. This only works once deployed.

## Local setup

```bash
cd backend
npm install
cp .env.example .env
# edit .env — at minimum set JWT_SECRET and ADMIN_PASSWORD
npm start
```

Generate a real JWT_SECRET with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Server runs on the port in `.env` (default 3000). Try it:
```bash
curl http://localhost:3000/api/health
```

## Database

SQLite, file-based (`azizo.db`, created automatically on first run). Genuinely simple —
no separate database server to install or manage. **One important caveat for cloud
deployment:** some hosting platforms (most serverless ones) wipe the filesystem between
deploys or restarts, which would silently erase your database. Deploy this to a host
with **persistent disk** — Render, Railway, Fly.io, or a plain VPS all work. If you
outgrow SQLite later (very high order volume, need multiple app servers), swapping to a
hosted Postgres is a contained change mostly isolated to `db.js`.

## API endpoints

| Method | Path | Auth | What it does |
|---|---|---|---|
| GET | `/api/health` | none | Confirms the server is running |
| GET | `/api/products` | none | Returns `{freshItems, readyItems, groceryItems}` — same shape as `products.json`, so the frontend can switch to this with one line changed |
| POST | `/api/products` | admin | Create or update a product |
| DELETE | `/api/products/:id` | admin | Remove a product |
| POST | `/api/auth/register` | none | Customer signs up — `{name, phone, password}` |
| POST | `/api/auth/login` | none | Customer logs in — `{phone, password}` |
| POST | `/api/auth/admin-login` | none | Admin logs in — `{password}` (from `.env`) |
| POST | `/api/orders` | optional | Create an order. Works with or without a customer's Bearer token (guest checkout still works) |
| GET | `/api/orders` | admin | List all orders — filter with `?status=` or `?phone=` |
| GET | `/api/orders/:id` | admin | One order with its line items |
| PATCH | `/api/orders/:id/status` | admin | Update status: `received`, `preparing`, `out_for_delivery`, `completed`, `cancelled` |
| GET | `/api/orders/me/history` | customer | A logged-in customer's own past orders |
| POST | `/api/mpesa/stkpush` | none | Trigger a real STK push — `{phone, amount, orderId}` |
| POST | `/api/mpesa/callback` | none (Safaricom calls this) | Receives payment confirmation |
| GET | `/api/mpesa/status/:checkoutRequestId` | none | Poll for payment result |

All admin/customer routes expect `Authorization: Bearer <token>`.

## API endpoints added in v1.8
Orders: `GET /api/orders/standing` (staff), `POST /api/orders/:id/repeat` (staff). Reviews: `POST /api/reviews`, `GET /api/reviews` (approved), admin: `GET /api/reviews/all`, `PATCH`/`DELETE /api/reviews/:id`. Branch stock: `GET /api/branch-stock`, `POST /api/branch-stock` (staff). Areas: `/api/areas`. The full table is in `DOCUMENTATION.md`.

Cooking hub (v2.0): `GET /api/recipes`, `GET`/`POST /api/recipes/:id/comments`, `POST /api/recipes/submit`, admin under `/api/recipes/admin/...` and `/api/media`. Details are in `DOCUMENTATION.md`.

## Deploying (Render.com example — free tier, persistent disk)

1. Push this `backend/` folder to a GitHub repo (separate from or alongside the site repo)
2. On render.com: New → Web Service → connect the repo
3. Build command: `npm install` — Start command: `npm start`
4. Add your `.env` values under Render's "Environment" tab (never commit `.env` itself)
5. Add a persistent disk (Render → Disks) mounted somewhere like `/data`, and set
   `DB_PATH=/data/azizo.db` as an environment variable so the database survives redeploys
6. Once deployed, your API is live at `https://your-service.onrender.com/api/...`
7. Set `MPESA_CALLBACK_URL` to `https://your-service.onrender.com/api/mpesa/callback`

Railway and Fly.io work the same way with minor UI differences — same core steps
(persistent disk, environment variables, build/start commands).

## Connecting the frontend

This is already done — `site/app.js` talks to this backend, not just `products.json`:

- `loadProducts()` fetches `{API_BASE_URL}/api/products` first and only falls back to
  the static `products.json` if that backend isn't reachable (or `API_BASE_URL` is
  blank, e.g. before you've deployed one)
- `placeOrder()` still opens the WhatsApp message (that stays the primary "order of
  record" a human on your end sees in real time), and also fire-and-forgets a
  `POST /api/orders` so the same order is saved to the database
- Customer accounts are optional and skippable — guest checkout never requires
  logging in. When `API_BASE_URL` is set, an "Account" button appears for
  login/register/order-history, backed by `/api/auth/*` and `/api/orders/me/history`
- `admin.html` has a full **Orders** tab (alongside Products) that lists every order
  saved here, lets you filter by status or phone, expand one to see its line items,
  and move it through `received → preparing → out_for_delivery → completed` (or
  `cancelled`) via `PATCH /api/orders/:id/status`

The one line that controls all of this is `CONFIG.API_BASE_URL` near the top of
`site/app.js` — set it to this backend's real deployed URL and every piece above
switches on automatically; leave it blank and the site still works standalone
(static catalog, WhatsApp-only checkout, no Account button).
