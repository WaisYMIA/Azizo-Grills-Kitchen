# Azizo Operations guide (v5.0)

## Where things are
| What | Page | Who |
|---|---|---|
| Analytics, tickets, requests, go-live gate, inspector accounts, SOPs | `operations.html` | Admin |
| Partner dashboard, statements, support, SOPs | `partner-portal.html` | Partners |
| Kitchen support and SOPs | `kitchen-portal.html` | Azizo Kitchens |
| Inspection form | `inspection-form.html` | Inspectors, admin |
| Rewards | `rewards.html` | Customers |
| Refunds, privacy, allergens, data requests | `privacy.html` | Customers |

## Daily, weekly, monthly routine (head office)
- Daily: Operations > Support tickets (answer within 1 working day, urgent within 2 hours); Customer requests (privacy requests within 7 days); Security Center alerts.
- Weekly: Analytics (cancellations, busiest hours, funnel); Inspections board (overdue); download one backup off the server.
- Monthly: restore a backup into a test database; review complaint patterns; rotate shared passwords when staff leave.

## Go-live gate
A partner needs: licence and health certificate verified (Marketplace admin > Partners), inspection 70+ with no critical fail, 5+ items, and these steps ticked in Operations > Go-live gate: SOP handbook signed, training, partner agreement, premises, payment details. Override needs a written reason.

## Rewards
1 point per KES 100 on completed orders (shop, partners, Kitchens). 100 points = KES 100. Customers request a reward on `rewards.html`; approve it in Operations > Customer requests (this deducts points), then apply the credit on WhatsApp. Tiers: Silver 300 and Gold 1,000 points earned.

## Backups
- PHP: cPanel cron daily `15 2 * * *  php /home/USER/public_html/backend-php/cron/backup.php` (files in `backend-php/private/backups`, newest 14 kept).
- Node: `npm run backup` (files in `backend/backups`).
- Download a copy weekly and test a restore monthly.

## Uptime monitoring
Create a free monitor (UptimeRobot or similar) for `https://yourdomain/api/health` every 5 minutes with email or WhatsApp alerts.

## SOPs
23 documents in `docs/sop` (also served to signed-in partners). They are internal standards aligned with Kenyan food law and HACCP principles, not a government certificate. Have a food-safety professional or the county public health officer review them before launch.
