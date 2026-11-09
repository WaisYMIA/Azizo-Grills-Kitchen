require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const app = express();
// v5.3 CORS: open for local testing; once ALLOWED_ORIGIN is set (https://yourdomain.co.ke, comma-separate several) only your own website may call the API from a browser.
const ORIGINS = String(process.env.ALLOWED_ORIGIN || '').split(',').map(x => x.trim()).filter(x => x && x !== '*');
app.use(cors(ORIGINS.length ? { origin: (o, cb) => cb(null, !o || ORIGINS.includes(o)) } : undefined));
// v5.3 security headers on every API answer
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self), payment=()', 'Cross-Origin-Opener-Policy': 'same-origin' });
  if (req.path.startsWith('/api/')) res.set({ 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'", 'Cache-Control': res.get('Cache-Control') || 'no-store' });
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
// Review photos arrive as a (small, resized) data URL, so that one route may carry a bigger body.
app.use('/api/reviews', express.json({ limit: '1.5mb' }));
app.use('/api/media', express.json({ limit: '6mb' }));
app.use('/api/kitchens', express.json({ limit: '12mb' }));
app.use('/api/market', express.json({ limit: '6mb' }));
app.use('/api/recipes/admin/import', express.json({ limit: '10mb' }));
app.use(express.json());
const secmon = require('./secmon');
app.disable('x-powered-by');
app.use(secmon.guard);   // v4.3: blocked addresses, scanner decoys and attack signatures
// Uploaded product photos are served from here — e.g. an image saved as
// /uploads/f1-171234.jpg is reachable at <this server's URL>/uploads/f1-171234.jpg.
// On cPanel, this folder lives under your app's home directory and survives restarts
// as long as it isn't inside a directory your deploy process wipes on every push.
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { maxAge: '30d', immutable: true })); // photo file names are unique, so browsers may keep them
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.use('/api/site', require('./routes/site'));
app.use('/api/products', require('./routes/products'));
app.use('/api/branches', require('./routes/branches'));
app.use('/api/areas', require('./routes/areas'));
app.use('/api/branch-stock', require('./routes/branchStock'));
app.use('/api/reviews', require('./routes/reviews'));
app.use('/api/recipes', require('./routes/recipes'));
app.use('/api/media', require('./routes/media'));
app.use('/api/kitchens', require('./routes/kitchens'));
app.use('/api/market', require('./routes/market'));
app.use('/api/playbook', require('./playbook').router);
app.use('/api/branchops', require('./branchops').router);   // v6.1: scorecard, stock and cost, franchisees, royalties, manual   // v6.0: checklists, training, new-branch wizard
app.use('/api/insight', require('./insight').router);   // v5.5: reports + Excel export, audit centre, visitors, email settings
app.use('/api/growth', require('./growth').router);   // v5.4: referrals, standing orders, refunds, digest, cash-up, messages, price band
app.use('/api/ai', require('./ai').router);   // v5.3: Claude assistant (off until ANTHROPIC_API_KEY is set)
app.use('/api/ops', require('./ops').router);   // v5.0: analytics, loyalty, tickets, SOPs, dashboards
app.use('/api/reports', require('./routes/reports'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/auth/security', secmon.router);
app.use('/api/auth', require('./routes/auth'));
app.use('/api/mpesa', require('./routes/mpesa'));
app.use((err, req, res, next) => {
  if (err && err.message && /image|Excel|xlsx|File too large/i.test(err.message)) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Azizo backend running on port ${PORT}`));
