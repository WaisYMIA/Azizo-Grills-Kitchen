# Azizo Marketplace (v4.0.0): partner butcheries

Partner butcheries sell under the Azizo Butchery and Grill brand. **It is OFF by default.** While off, no link, page or order path is visible to customers.

## Turn it on
1. Host the backend (Node or PHP) and set `API_BASE_URL` (in `site/app.js` and `site/kk-config.js`). GitHub Pages alone cannot run it.
2. Open `marketplace-admin.html`, sign in with the **main admin password**, then Overview > **Switch ON**.
3. Set Fees (below) before approving anyone. Nothing is charged until you add a fee rule.

## Pages
| Page | Who | What |
|---|---|---|
| `butcheries.html` | customers | Partner directory by area or GPS, nearest first, hygiene score shown. Further butchers are marked in red. |
| `butchery.html?b=slug` | customers | Storefront: partner story, hygiene score, items (quarter-kg steps), checkout. |
| `sell-with-azizo.html` | applicants | Application: licence number, photos, delivery mode, payment details. |
| `partner-portal.html` | partners | Orders and status buttons, own prices (with recommended price beside), stock tick-boxes, invoices, profile. |
| `marketplace-admin.html` | you | Switch, rules, applications, tier, hygiene audits, fee rules, invoices, catalogue. |

## How it works
- **Master catalogue** = the products in Admin > Products. The price there is the *recommended price*. In Marketplace admin > Catalogue add a Kiswahili name and cut family, or retire an item.
- **Partners set their own price.** The portal shows the recommended price; admin sees any price more than X% away (default 25%). Nothing is blocked.
- **Partners buy their own stock** and tick items in or out of stock. Out-of-stock items show "Out of stock" on their storefront.
- **Customers pay the partner directly** (cash, or the partner's till/paybill/Pochi). Partner orders cannot use Azizo's M-Pesa prompt. The server re-prices partner orders from the partner's own list, so the browser cannot change prices.
- **Statuses:** applied > pilot (trial) > live; or suspended, delisted, rejected.
- **Hygiene score**: shown only after you record an audit (Partners > Open > Hygiene audit). Until then customers see "Hygiene audit pending". Licence "verified" is a tick you set after seeing the original at inspection. Do not collect ID or licence images online.

## Fees and invoices
Fee rules (Marketplace admin > Fees): for each item line, the **category** rule is used, else the partner's **tier** rule, else the **default** percent. **Flat default** rules add once per order. Fees are on item value, not delivery.
1. **Invoices > Generate** invoices every completed, not-yet-invoiced order per partner (weekly is suggested). No order is invoiced twice; voiding an invoice releases its orders.
2. Due date = issue date + "days to pay". A joining fee is added to a partner's first invoice; a per-invoice fee to every invoice (both from Overview > Rules).
3. **Apply suspension rule** suspends partners with an invoice more than N days overdue. You can lift it by setting the status back.
4. Mark invoices paid with the M-Pesa reference when the partner pays Azizo.

Partner orders also appear in the Staff queue (note starts with `[Partner: name]`); the partner works them from the portal.

## Not included yet
Online upload of private documents (licences), automatic payments to Azizo, multi-partner carts, partner delivery tracking, scheduled invoice runs, partner reviews. Rider dispatch for "Azizo riders" mode is a label only for now.
