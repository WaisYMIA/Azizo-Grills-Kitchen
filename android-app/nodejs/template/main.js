// Starts the Azizo backend INSIDE the phone (Node 18 from nodejs-mobile) with its own database.
// The website and the API are both served on http://127.0.0.1:3000 (reachable only from this phone).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = __dirname;
const dataDir = process.env.AZIZO_DATA || path.join(root, '..', 'data-device');
fs.mkdirSync(dataDir, { recursive: true });

// --- log file the app can show on screen if something goes wrong
const logFile = path.join(dataDir, 'node.log');
try { if (fs.existsSync(logFile) && fs.statSync(logFile).size > 400000) fs.renameSync(logFile, logFile + '.old'); } catch (e) { /* ignore */ }
const stamp = () => new Date().toISOString().slice(11, 19);
for (const k of ['log', 'warn', 'error']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { try { fs.appendFileSync(logFile, stamp() + ' ' + k + ' ' + a.map((x) => (x && x.stack) || (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n'); } catch (e) { /* ignore */ } orig(...a); };
}
process.on('uncaughtException', (e) => console.error('uncaughtException', e));
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
console.log('Azizo node starting, node', process.version, 'data', dataDir);

// --- secrets and demo passcodes. Passcodes below are TEST passcodes for this phone only (not reachable from any network).
const secretsFile = path.join(dataDir, 'secrets.json');
let sec = {};
try { sec = JSON.parse(fs.readFileSync(secretsFile, 'utf8')); } catch (e) { /* first run */ }
if (!sec.JWT_SECRET) { sec.JWT_SECRET = crypto.randomBytes(32).toString('hex'); sec.ORDER_SIG_KEY = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(secretsFile, JSON.stringify(sec)); }
const pass = 'majani90';
Object.assign(process.env, {
  PORT: '3000', HOST: '127.0.0.1', DB_PATH: path.join(dataDir, 'azizo.db'), AZIZO_DEMO: '1', GROWTH_NO_TIMER: '',
  JWT_SECRET: sec.JWT_SECRET, ORDER_SIG_KEY: sec.ORDER_SIG_KEY,
  ADMIN_PASSWORD: pass, STAFF_PASSWORD: pass, KITCHENS_ADMIN_PASSWORD: pass, KITCHENS_DISPATCH_PASSWORD: pass, KITCHENS_ACCOUNTS_PASSWORD: pass, INSPECTOR_PASSWORD: pass,
  TZ_OFFSET_HOURS: '3'
});
try { process.chdir(path.join(root, 'backend')); } catch (e) { /* ignore */ }

const initSqlJs = require('sql.js');
initSqlJs().then((SQL) => {
  global.__AZIZO_SQLJS = SQL;
  require('./backend/server');
  require('./backend/demo-seed');
  console.log('Azizo backend ready');
}).catch((e) => { console.error('Azizo failed to start:', e); });
