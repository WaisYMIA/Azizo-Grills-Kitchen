// Daily backup of the Node (SQLite) database:  npm run backup   (cron: 15 2 * * *  cd /path/backend && npm run backup)
const path = require('path'), fs = require('fs'), db = require('./db');
const dir = path.join(__dirname, 'backups'); fs.mkdirSync(dir, { recursive: true });
const f = path.join(dir, 'azizo-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '.db');
db.backup(f).then(() => { const all = fs.readdirSync(dir).filter(x => /^azizo-.*\.db$/.test(x)).sort().reverse(); all.slice(14).forEach(x => fs.unlinkSync(path.join(dir, x))); console.log('Backup written:', path.basename(f), Math.round(fs.statSync(f).size / 1024) + ' KB'); process.exit(0); }).catch(e => { console.error('Backup failed', e.message); process.exit(1); });
