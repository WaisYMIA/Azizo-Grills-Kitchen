// RFC 6238 authenticator-app codes (same behaviour as the PHP backend). Switched on by ADMIN_TOTP_SECRET (base32).
const crypto = require('crypto');
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const enabled = () => !!process.env.ADMIN_TOTP_SECRET;
function b32(s) { let bits = '', out = []; for (const c of String(s).toUpperCase().replace(/[^A-Z2-7]/g, '')) bits += A.indexOf(c).toString(2).padStart(5, '0'); for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
function at(secret, step) { const b = Buffer.alloc(8); b.writeUInt32BE(Math.floor(step / 4294967296), 0); b.writeUInt32BE(step >>> 0, 4); const h = crypto.createHmac('sha1', b32(secret)).update(b).digest(), o = h[19] & 15; return String(((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1000000).padStart(6, '0'); }
let last = 0;
/** current code and one step either side; a code works only once. Returns true when 2-step sign-in is off. */
function verify(code) {
  if (!enabled()) return true; code = String(code || '').replace(/\s+/g, ''); if (!/^\d{6}$/.test(code)) return false;
  const now = Math.floor(Date.now() / 30000);
  for (let d = -1; d <= 1; d++) { const st = now + d; if (st <= last) continue; const x = at(process.env.ADMIN_TOTP_SECRET, st); if (x.length === code.length && crypto.timingSafeEqual(Buffer.from(x), Buffer.from(code))) { last = st; return true; } }
  return false;
}
module.exports = { enabled, verify, at };
