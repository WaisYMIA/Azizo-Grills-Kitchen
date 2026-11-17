// Copies the Azizo website INTO the app (www/) so the app runs by itself, with no dependence on GitHub Pages
// or any web address for its pages. Run by `npm run sync` (and by the cloud build).
//   SITE_SRC  folder holding the website files (default: ../site)
// Settings come from app.config.json: { "apiUrl": "https://api.yourdomain.co.ke" }  ("" = no ordering server yet)
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'app.config.json'), 'utf8'));
const src = path.resolve(process.env.SITE_SRC || path.join(root, '..', 'site'));
const out = path.join(root, 'www');
if (cfg.mode === 'device') {
  // Device mode: the app starts its own server on the phone; www/ only holds the "starting" page.
  fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(out)) { if (f !== 'mascot-head.webp') fs.rmSync(path.join(out, f), { recursive: true, force: true }); }
  fs.copyFileSync(path.join(root, 'device', 'loading.html'), path.join(out, 'index.html'));
  console.log('bundle-site: device mode - wrote www/index.html (the site itself is served by the on-phone server)');
  process.exit(0);
}
const apiUrl = String(process.env.API_URL != null ? process.env.API_URL : (cfg.apiUrl || '')).replace(/\/+$/, '');
if (!fs.existsSync(path.join(src, 'index.html'))) throw new Error('bundle-site: no index.html in ' + src + ' (set SITE_SRC)');
const OK_EXT = new Set(['.html', '.css', '.js', '.json', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico', '.txt', '.woff', '.woff2']);
const SKIP = new Set(['server.js', 'db.js', 'sw.js', 'package.json', 'package-lock.json', 'capacitor.config.js', 'app.config.json', 'config.php', 'db.php', 'robots.txt', 'security.txt', 'llms.txt']);
const DIRS = ['images', 'img', 'fonts', 'icons'];
// keep the app's own files, clear everything else from the previous bundle
const KEEP = new Set(['offline.html', 'mascot-head.webp']);
for (const f of fs.readdirSync(out)) { if (!KEEP.has(f)) fs.rmSync(path.join(out, f), { recursive: true, force: true }); }
let n = 0;
function copy(from, to) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); n++; }
for (const f of fs.readdirSync(src)) {
  const p = path.join(src, f), st = fs.statSync(p);
  if (f.startsWith('.')) continue;
  if (st.isFile() && OK_EXT.has(path.extname(f).toLowerCase()) && !SKIP.has(f)) copy(p, path.join(out, f));
  else if (st.isDirectory() && DIRS.includes(f)) (function walk(d, o) { for (const g of fs.readdirSync(d)) { const q = path.join(d, g); fs.statSync(q).isDirectory() ? walk(q, path.join(o, g)) : copy(q, path.join(o, g)); } })(p, path.join(out, f));
}
// 1. the ordering-server address, set in both places the site looks
fs.writeFileSync(path.join(out, 'kk-config.js'), 'window.KK_CONFIG = { API_BASE_URL: ' + JSON.stringify(apiUrl) + ' };\n');
let a = fs.readFileSync(path.join(out, 'app.js'), 'utf8');
a = a.replace(/API_BASE_URL:\s*"[^"]*"/, 'API_BASE_URL: ' + JSON.stringify(apiUrl));
fs.writeFileSync(path.join(out, 'app.js'), a);
// 2. friendly wording when the app has no ordering server yet (older site copies only mention GitHub/Pages)
const kc = path.join(out, 'kk-common.js');
if (fs.existsSync(kc)) {
  let k = fs.readFileSync(kc, 'utf8');
  k = k.replace("/github\\.io$|netlify\\.app$|pages\\.dev$/.test(location.hostname)", "/github\\.io$|netlify\\.app$|pages\\.dev$|^localhost$/.test(location.hostname)");
  k = k.replace("'Online ordering is not switched on for this website yet. This address (' + location.hostname + ') only serves web pages; the ordering server must be hosted separately and its address set in kk-config.js.'",
                "(location.hostname === 'localhost' ? 'Online ordering is not switched on in this app yet. You can still order on WhatsApp: 0724 888 057.' : 'Online ordering is not switched on for this website yet. This address (' + location.hostname + ') only serves web pages; the ordering server must be hosted separately and its address set in kk-config.js.')");
  fs.writeFileSync(kc, k);
}
console.log('bundle-site: ' + n + ' files from ' + src + ' -> www/ ; ordering server: ' + (apiUrl || '(none yet - WhatsApp ordering)'));
