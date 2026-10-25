// Azizo Kitchens customer messages. Every message is saved to the outbox (kk_outbox) so staff can tap to send it on WhatsApp.
// If WA_TOKEN and WA_PHONE_ID (WhatsApp Cloud API) are set, a best-effort automatic send is attempted too.
const db = require('../db');
const SITE = () => (process.env.SITE_URL || 'https://www.azizobutchery.co.ke').replace(/\/+$/, '');
const money = n => 'KSh ' + Number(n || 0).toLocaleString('en-KE');
function text(kind, o, extra) {
  extra = extra || {}; const link = `${SITE()}/kitchens.html?track=${o.id}`, head = `Azizo Kitchens order #${o.id}`;
  const m = {
    placed: `${head} received 🙏 ${extra.kitchen || 'Your kitchen'} will confirm shortly. Total ${money(o.total)}. Your delivery code is ${o.delivery_code}: give it to the rider only when you have your food. Track: ${link}`,
    accepted: `${head} is confirmed. The cook has started on it. Track: ${link}`,
    ready: `${head} is cooked and packed, waiting for the rider. Track: ${link}`,
    out_for_delivery: `${head} is on its way 🛵${extra.rider ? ' Rider: ' + extra.rider + '.' : ''} Please have ${o.paid ? 'your code' : money(o.total) + ' and your code'} ready (code ${o.delivery_code}).`,
    delivered: `${head} delivered. Enjoy your meal! Please rate it: ${link}`,
    rejected: `Sorry, ${head} could not be taken by the kitchen${o.reason ? ' (' + o.reason + ')' : ''}. Please order again or chat with us on WhatsApp.`,
    cancelled: `${head} was cancelled${o.reason ? ' (' + o.reason + ')' : ''}. Questions? WhatsApp 0724 888 057.`,
    reassigned: `${head}: we moved your order to ${extra.kitchen || 'another kitchen'} so it still reaches you on time. Same price. Track: ${link}`,
  }; return m[kind] || '';
}
async function trySend(id, phone, message) {
  const { WA_TOKEN, WA_PHONE_ID } = process.env; if (!WA_TOKEN || !WA_PHONE_ID) return;
  let to = String(phone || '').replace(/\D/g, ''); if (to.length === 10 && to[0] === '0') to = '254' + to.slice(1); else if (to.length === 9) to = '254' + to; if (!/^254\d{9}$/.test(to)) return;
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_ID}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: message } }) });
    if (r.ok) db.prepare("UPDATE kk_outbox SET status = 'sent', sent_at = datetime('now') WHERE id = ?").run(id);
  } catch (e) { /* stays pending in the outbox */ }
}
function queue(kind, order, extra) {
  try {
    const msg = text(kind, order, extra); if (!msg || !order.phone) return;
    const r = db.prepare('INSERT INTO kk_outbox (phone, kind, message, order_id) VALUES (?, ?, ?, ?)').run(order.phone, kind, msg, order.id);
    trySend(r.lastInsertRowid, order.phone, msg);
  } catch (e) { console.error('outbox error', e.message); }
}
module.exports = { queue, text, configured: () => !!(process.env.WA_TOKEN && process.env.WA_PHONE_ID) };
