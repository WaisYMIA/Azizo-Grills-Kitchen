require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
// Review photos arrive as a (small, resized) data URL, so that one route may carry a bigger body.
app.use('/api/reviews', express.json({ limit: '1.5mb' }));
app.use('/api/media', express.json({ limit: '6mb' }));
app.use('/api/kitchens', express.json({ limit: '12mb' }));
app.use('/api/market', express.json({ limit: '6mb' }));
app.use('/api/recipes/admin/import', express.json({ limit: '10mb' }));
app.use(express.json());
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
app.use('/api/reports', require('./routes/reports'));
app.use('/api/orders', require('./routes/orders'));
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
