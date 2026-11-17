// Prepares the on-phone server for the app (run by `npm run sync`):
//  1. downloads the Node 18 runtime for Android (nodejs-mobile) into android/app/nodejs-runtime  (first time only, ~120 MB download)
//  2. unpacks nodejs/azizo-node-src.zip, installs its dependencies (pure JavaScript) and packs it as the app's nodejs-project.zip
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const AdmZip = require('adm-zip');
const root = path.resolve(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'app.config.json'), 'utf8'));
if (cfg.mode !== 'device') { console.log('prepare-node: mode is "' + cfg.mode + '", skipping the on-phone server'); process.exit(0); }
const run = (cmd, opts) => cp.execSync(cmd, Object.assign({ stdio: 'inherit' }, opts));
const ABIS = (process.env.AZIZO_ABIS || 'arm64-v8a').split(',');
const rt = path.join(root, 'android', 'app', 'nodejs-runtime', 'libnode');

// 1. runtime
if (!ABIS.every((a) => fs.existsSync(path.join(rt, 'bin', a, 'libnode.so')))) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'azizo-node-'));
  console.log('prepare-node: downloading the Node.js runtime for Android (one time, about 120 MB)...');
  run('npm pack nodejs-mobile-react-native@18.20.4 --silent', { cwd: tmp });
  const tgz = fs.readdirSync(tmp).find((f) => f.endsWith('.tgz'));
  const parts = ['package/android/libnode/include'].concat(ABIS.map((a) => 'package/android/libnode/bin/' + a));
  run('tar -xzf "' + tgz + '" ' + parts.map((p) => '"' + p + '"').join(' '), { cwd: tmp });
  fs.rmSync(rt, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(rt), { recursive: true });
  fs.cpSync(path.join(tmp, 'package', 'android', 'libnode'), rt, { recursive: true });
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('prepare-node: runtime ready for ' + ABIS.join(', '));

// 2. server project
const srcZip = path.join(root, 'nodejs', 'azizo-node-src.zip');
if (!fs.existsSync(srcZip)) throw new Error('prepare-node: ' + srcZip + ' is missing');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'azizo-proj-'));
new AdmZip(srcZip).extractAllTo(work, true);
run('npm install --omit=dev --omit=optional --no-audit --no-fund', { cwd: work });
// trim what the app does not need (keeps the app smaller)
const rm = (p) => fs.rmSync(path.join(work, 'node_modules', p), { recursive: true, force: true });
const dist = path.join(work, 'node_modules', 'sql.js', 'dist');
for (const f of fs.readdirSync(dist)) if (!['sql-wasm.js', 'sql-wasm.wasm'].includes(f)) fs.rmSync(path.join(dist, f), { force: true });
const xd = path.join(work, 'node_modules', 'xlsx', 'dist');
if (fs.existsSync(xd)) for (const f of fs.readdirSync(xd)) if (f !== 'cpexcel.js') fs.rmSync(path.join(xd, f), { force: true });
['.bin', 'xlsx/bin', 'xlsx/types', 'xlsx/xlsx.mjs', 'xlsx/xlsxworker.js', 'xlsx/formats.png', 'xlsx/legend.png', 'sql.js/logo.svg'].forEach(rm);
const out = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'nodejs-project.zip');
fs.mkdirSync(path.dirname(out), { recursive: true });
const z = new AdmZip(); z.addLocalFolder(work); z.writeZip(out);
fs.rmSync(work, { recursive: true, force: true });
console.log('prepare-node: wrote ' + path.relative(root, out) + ' (' + Math.round(fs.statSync(out).size / 1024 / 1024 * 10) / 10 + ' MB)');
