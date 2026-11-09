// Outgoing email through the Owner's cPanel mailbox (SMTP). Settings live in the database (Operations > Email), the password is stored
// encrypted (AES-256-GCM, key derived from MAIL_KEY or the server secret). Used for the daily digest and security alerts.
const net = require('net'), tls = require('tls'), crypto = require('crypto');
const db = require('./db');
db.exec(`CREATE TABLE IF NOT EXISTS mail_config (k TEXT PRIMARY KEY, v TEXT);
  CREATE TABLE IF NOT EXISTS email_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, to_addr TEXT, subject TEXT, status TEXT, error TEXT DEFAULT '', by_name TEXT DEFAULT '');`);
const nowTs = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const DEFAULTS = { enabled: '0', host: '', port: '465', secure: 'ssl', user: '', from_email: '', from_name: 'Azizo Butchery and Grill', reply_to: '', verify_cert: '1', alert_security: '1', alert_to: '' };
const key = () => crypto.createHash('sha256').update('azizo-mail|' + (process.env.MAIL_KEY || process.env.ORDER_SIG_KEY || process.env.JWT_SECRET || 'insecure-dev-only-secret-change-me')).digest();
const enc = t => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv), b = Buffer.concat([c.update(String(t), 'utf8'), c.final()]); return 'v1:' + Buffer.concat([iv, c.getAuthTag(), b]).toString('base64'); };
const dec = s => { try { if (!s || !s.startsWith('v1:')) return ''; const b = Buffer.from(s.slice(3), 'base64'), d = crypto.createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); } catch (e) { return ''; } };
function config() { const o = { ...DEFAULTS }; for (const r of db.prepare('SELECT k, v FROM mail_config').all()) o[r.k] = r.v; return o; }
function setCfg(k, v) { db.prepare('INSERT INTO mail_config (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v); }
function publicConfig() { const c = config(); const hasPw = !!dec(c.pass_enc); delete c.pass_enc; delete c.last_digest; return { ...c, hasPassword: hasPw, passwordUnreadable: !!c.pass_enc && !hasPw }; }
const isEmail = s => /^[^\s@<>",;:]+@[^\s@<>",;:]+\.[^\s@<>",;:]{2,}$/.test(s);
const hdr = s => String(s || '').replace(/[\r\n]+/g, ' ').trim();
const b64lines = s => Buffer.from(s, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
const encWord = s => /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=';
function smtpSend(c, pass, msg) {
  return new Promise((resolve, reject) => {
    let sock, buf = '', waiting = null, done = false; const fail = e => { if (done) return; done = true; try { sock && sock.destroy(); } catch (x) {} reject(e instanceof Error ? e : new Error(String(e))); };
    const timer = setTimeout(() => fail(new Error('The mail server did not answer in time')), 20000);
    const onData = d => { buf += d.toString('utf8'); let m; while ((m = /^(?:\d{3}-.*\r?\n)*\d{3} .*\r?\n/.exec(buf))) { const reply = m[0]; buf = buf.slice(reply.length); const w = waiting; waiting = null; if (w) w(reply); } };
    const wait = () => new Promise(r => { waiting = r; });
    const send = async (line, ok) => { sock.write(line + '\r\n'); const r = await wait(); if (!new RegExp('^(' + ok.join('|') + ')').test(r)) throw new Error(r.trim().split(/\r?\n/).pop().slice(0, 160)); return r; };
    const run = async () => {
      let r = await wait(); if (!/^220/.test(r)) throw new Error('Unexpected greeting: ' + r.trim().slice(0, 100));
      let ehlo = await send('EHLO azizo.local', ['250']);
      if (c.secure === 'starttls') {
        await send('STARTTLS', ['220']); sock.removeListener('data', onData);
        sock = tls.connect({ socket: sock, servername: c.host, rejectUnauthorized: c.verify_cert !== '0' }); sock.on('data', onData); sock.on('error', fail);
        await new Promise((res, rej) => { sock.once('secureConnect', res); sock.once('error', rej); }); ehlo = await send('EHLO azizo.local', ['250']);
      }
      if (c.user) {
        if (/AUTH[^\n]*PLAIN/i.test(ehlo)) await send('AUTH PLAIN ' + Buffer.from('\0' + c.user + '\0' + pass).toString('base64'), ['235']);
        else { await send('AUTH LOGIN', ['334']); await send(Buffer.from(c.user).toString('base64'), ['334']); await send(Buffer.from(pass).toString('base64'), ['235']); }
      }
      await send('MAIL FROM:<' + c.from_email + '>', ['250']); await send('RCPT TO:<' + msg.to + '>', ['250', '251']); await send('DATA', ['354']);
      const mid = '<' + crypto.randomBytes(12).toString('hex') + '@' + (c.from_email.split('@')[1] || 'azizo.local') + '>';
      const head = ['From: ' + encWord(hdr(c.from_name)) + ' <' + c.from_email + '>', 'To: <' + msg.to + '>', c.reply_to ? 'Reply-To: <' + hdr(c.reply_to) + '>' : null, 'Subject: ' + encWord(hdr(msg.subject)), 'Date: ' + new Date().toUTCString(), 'Message-ID: ' + mid, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', 'X-Mailer: Azizo'].filter(Boolean).join('\r\n');
      await send(head + '\r\n\r\n' + b64lines(msg.text) + '\r\n.', ['250']);
      try { sock.write('QUIT\r\n'); } catch (e) {}
    };
    const start = () => { sock.on('data', onData); sock.on('error', fail); run().then(() => { clearTimeout(timer); done = true; sock.end(); resolve(true); }, e => { clearTimeout(timer); fail(e); }); };
    const port = Number(c.port) || 465;
    if (c.secure === 'ssl') { sock = tls.connect({ host: c.host, port, servername: c.host, rejectUnauthorized: c.verify_cert !== '0' }, start); }
    else { sock = net.connect({ host: c.host, port }, start); }
    sock.on('error', fail);
  });
}
const friendly = m => /ECONNREFUSED/.test(m) ? 'The mail server refused the connection. Check the server name and port.' : /ENOTFOUND|EAI_AGAIN/.test(m) ? 'That mail server name was not found. Check the spelling (usually mail.yourdomain.com).' : /certificate|self.signed|altnames|hostname/i.test(m) ? 'The mail server certificate did not match. On shared cPanel hosting, switch off "Check the server certificate" or use the server name your host gives you.' : /535|authentication|credentials/i.test(m) ? 'The mailbox login was refused. Check the full email address and password.' : /timed? ?out|ETIMEDOUT/i.test(m) ? 'The mail server did not answer. The port may be blocked, try 587 with STARTTLS.' : String(m).slice(0, 200);
const sentThisHour = []; let lastAlert = 0;
async function sendMail(msg, by) {
  const c = config(); const to = hdr(msg.to);
  const log = (status, error) => { try { db.prepare('INSERT INTO email_log (ts, to_addr, subject, status, error, by_name) VALUES (?,?,?,?,?,?)').run(nowTs(), to.slice(0, 120), hdr(msg.subject).slice(0, 160), status, String(error || '').slice(0, 300), by || ''); } catch (e) {} };
  if (c.enabled !== '1' && !msg.force) return { ok: false, error: 'Email is switched off in Operations > Email' };
  if (!c.host || !isEmail(c.from_email)) return { ok: false, error: 'Email settings are not complete' };
  if (!isEmail(to)) return { ok: false, error: 'That recipient address does not look right' };
  const now = Date.now(); while (sentThisHour.length && now - sentThisHour[0] > 3600000) sentThisHour.shift();
  if (sentThisHour.length >= 60) { log('blocked', 'Hourly send limit (60) reached'); return { ok: false, error: 'Hourly send limit reached' }; }
  sentThisHour.push(now);
  try { await smtpSend(c, dec(c.pass_enc), { to, subject: msg.subject, text: String(msg.text || '') }); log('sent', ''); return { ok: true }; }
  catch (e) { const m = friendly(e.message || e); log('failed', m); return { ok: false, error: m }; }
}
function securityAlert(type, ip, detail) {
  const c = config(); if (c.enabled !== '1' || c.alert_security !== '1') return; const to = c.alert_to || c.from_email; if (!isEmail(to)) return;
  if (Date.now() - lastAlert < 15 * 60000) return; lastAlert = Date.now();
  sendMail({ to, subject: 'Azizo security alert: ' + type, text: 'Azizo security alert\n\nType: ' + type + '\nFrom address: ' + ip + '\nDetail: ' + String(detail || '').slice(0, 300) + '\n\nOpen Operations > Audit to see everything. Further alerts are held back for 15 minutes.' }, 'system').catch(() => {});
}
async function maybeDigest() {
  try {
    const c = config(); if (c.enabled !== '1') return; const g = require('./growth'), S = g.settings(); const to = S.digest_email; if (!isEmail(to)) return;
    const tz = Number.isFinite(Number(process.env.TZ_OFFSET_HOURS)) ? Number(process.env.TZ_OFFSET_HOURS) : 3, local = new Date(Date.now() + tz * 3600000), day = local.toISOString().slice(0, 10);
    if (local.getUTCHours() < 20 || c.last_digest === day) return; setCfg('last_digest', day);
    const d = g.digest(); await sendMail({ to, subject: 'Azizo daily digest ' + (d.day || day), text: d.text }, 'system');
  } catch (e) {}
}
function save(b) {
  const out = {}, errs = [];
  for (const k of Object.keys(DEFAULTS)) if (b[k] !== undefined) out[k] = hdr(b[k]);
  if (out.host !== undefined && out.host && !/^[a-z0-9.\-]{3,120}$/i.test(out.host)) errs.push('Server name looks wrong (example: mail.azizobutchery.co.ke)');
  if (out.port !== undefined && !(Number(out.port) > 0 && Number(out.port) < 65536)) errs.push('Port must be a number (465 or 587)');
  if (out.secure !== undefined && !['ssl', 'starttls', 'none'].includes(out.secure)) errs.push('Choose SSL, STARTTLS or none');
  for (const k of ['from_email', 'reply_to', 'alert_to']) if (out[k] && !isEmail(out[k])) errs.push(k.replace('_', ' ') + ' is not a valid email address');
  if (out.user !== undefined && out.user.length > 120) errs.push('Username too long');
  if (errs.length) return { errors: errs };
  for (const k of ['enabled', 'verify_cert', 'alert_security']) if (out[k] !== undefined) out[k] = out[k] === '1' || out[k] === 'true' ? '1' : '0';
  for (const [k, v] of Object.entries(out)) setCfg(k, v);
  if (typeof b.password === 'string' && b.password) setCfg('pass_enc', enc(b.password.slice(0, 200)));
  return { ok: true, changed: Object.keys(out).concat(b.password ? ['password'] : []) };
}
module.exports = { config, publicConfig, save, sendMail, securityAlert, maybeDigest, isEmail };
