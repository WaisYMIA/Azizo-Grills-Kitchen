(function(){
  'use strict';
  var K = window.KK, M = window.MK, $ = K.$, esc = K.esc, TK = 'secAdminToken', app = $('app'), tab = 'over';
  var F = { sev: '', type: '', ip: '', q: '', days: 7, off: 0 }, LIM = 50;
  M.header(''); M.footer();
  var tok = function(){ return sessionStorage.getItem(TK) || ''; };
  var J = M.json;
  async function api(path, opts){ try{ return await M.root('/api/auth/security' + (path || ''), opts, tok()); }catch(e){ if(e.status === 401 || e.status === 403){ sessionStorage.removeItem(TK); gate('Please sign in again'); throw new Error('Please sign in again'); } throw e; } }
  var when = function(ts){ var d = new Date(String(ts).replace(' ', 'T') + 'Z'); return isNaN(d) ? esc(ts) : d.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };
  var sevB = function(s){ var c = { info: '#7aa2ff', low: '#9aa0a6', med: '#e0b341', high: '#ff7a45', crit: '#ff3b4e' }[s] || '#9aa0a6'; return '<span style="display:inline-block;min-width:44px;text-align:center;padding:2px 8px;border-radius:999px;font-size:.74rem;font-weight:700;color:#111;background:' + c + '">' + esc(String(s).toUpperCase()) + '</span>'; };
  var NAMES = { 'login-fail': 'Wrong password', lockout: 'Account locked', 'rate-limit': 'Too many requests', probe: 'Attack pattern (injection)', scanner: 'Scanner probe', 'scanner-ua': 'Hacking tool', 'token-forged': 'Forged login token', 'mpesa-forged': 'Fake M-Pesa payment', 'mpesa-amount': 'M-Pesa wrong amount', 'order-tamper': 'Order price tampering', 'fee-tamper': 'Delivery fee tampering', 'order-tampered': 'Order changed in database', 'bot-order': 'Bot order', forbidden: 'Wrong role / no access', 'bad-method': 'Odd request method', oversize: 'Oversized request', 'cors-denied': 'Unknown website origin', 'auto-block': 'Address blocked (auto)', 'manual-block': 'Address blocked (you)', unblock: 'Address unblocked' };
  var nm = function(t){ return NAMES[t] || t; };

  function gate(msg){
    app.innerHTML = '<div class="gate panel"><h2>🔒 Security Center</h2><p style="color:var(--mute)">Admin only. Use the main admin password.</p>' + (K.base() ? '' : '<label class="f" for="gUrl">Server address</label><input id="gUrl" placeholder="https://api.yourdomain.co.ke">') +
      '<label class="f" for="gPw" style="margin-top:10px">Admin password</label><input id="gPw" type="password" autocomplete="current-password"><div id="gErr">' + (msg ? '<div class="msg err">' + esc(msg) + '</div>' : '') + '</div><button class="btn gold" id="gGo" style="margin-top:12px">Sign in</button></div>';
    var go = async function(){ if($('gUrl')) K.set('azizoAdminBackendUrl', $('gUrl').value.trim().replace(/\/+$/, '')); $('gErr').innerHTML = '';
      try{ var pw = $('gPw').value, r; try{ r = await M.root('/api/auth/admin-login', { method: 'POST', body: J({ password: pw }) }); }catch(e1){ if(!/6-digit|authenticator/i.test(e1.message)) throw e1; var cd = (window.prompt('Enter the 6-digit code from your authenticator app') || '').trim(); r = await M.root('/api/auth/admin-login', { method: 'POST', body: J({ password: pw, code: cd }) }); }
        sessionStorage.setItem(TK, r.token); draw(); }catch(e){ $('gErr').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; } };
    $('gGo').onclick = go; $('gPw').onkeydown = function(e){ if(e.key === 'Enter') go(); };
  }
  function draw(){
    app.innerHTML = '<div style="padding:18px 0 0"><div class="eyebrow">Admin</div><h2 style="margin:0">🔒 Security Center</h2></div><div class="dash"><div class="side" id="side"></div><div id="pane"></div></div>';
    var T = [['over', 'Overview'], ['log', 'Attack log'], ['blk', 'Blocked addresses'], ['ord', 'Order integrity'], ['aud', 'Audit trail'], ['hlt', 'Health check'], ['ses', 'Sessions']];
    $('side').innerHTML = T.map(function(t){ return '<button data-t="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '<button id="lo">Sign out</button>';
    $('side').querySelectorAll('[data-t]').forEach(function(b){ b.onclick = function(){ tab = b.dataset.t; draw(); }; }); $('lo').onclick = function(){ sessionStorage.removeItem(TK); gate(); };
    ({ over: overTab, log: logTab, blk: blkTab, ord: ordTab, aud: audTab, hlt: hltTab, ses: sesTab })[tab]().catch(function(e){ $('pane').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; });
  }
  var ipBtn = function(ip, label){ return '<button class="btn sm" data-block="' + esc(ip) + '">' + (label || 'Block') + '</button>'; };
  function wireBlock(){ document.querySelectorAll('[data-block]').forEach(function(b){ b.onclick = async function(){ var ip = b.dataset.block, h = window.prompt('Block ' + ip + ' for how many hours?', '24'); if(!h) return; try{ await api('', { method: 'POST', body: J({ action: 'block', ip: ip, hours: Number(h) || 24, reason: 'from Security Center' }) }); K.toast('Blocked ' + ip); draw(); }catch(e){ K.toast(e.message); } }; }); }

  async function overTab(){
    var d = await api(''), s = d.summary, red = s.high24 > 0;
    var max = Math.max.apply(null, d.hours.concat([1]));
    var bars = d.hours.map(function(n, i){ return '<div title="' + n + ' event(s), ' + (23 - i) + 'h ago" style="flex:1;background:' + (n ? 'var(--gold)' : 'rgba(255,255,255,.08)') + ';height:' + Math.max(4, Math.round(n / max * 80)) + 'px;border-radius:3px 3px 0 0"></div>'; }).join('');
    var types = Object.keys(d.byType).slice(0, 8).map(function(t){ return '<tr><td>' + esc(nm(t)) + '</td><td style="text-align:right"><b>' + d.byType[t] + '</b></td></tr>'; }).join('');
    var ips = d.topIps.map(function(r){ var blocked = d.blocks.some(function(b){ return b.ip === r.ip; }); return '<tr><td><code>' + esc(r.ip) + '</code></td><td>' + r.n + '</td><td>' + esc(nm(r.last)) + '</td><td>' + (blocked ? '<span class="kbadge warn">blocked</span>' : ipBtn(r.ip)) + '</td></tr>'; }).join('');
    $('pane').innerHTML = '<div class="panel" style="border-color:' + (red ? 'var(--red)' : 'rgba(63,168,116,.5)') + '"><h3 style="margin:0">' + (red ? '⚠️ ' + s.high24 + ' serious event(s) in the last 24 hours' : '✅ No serious attacks in the last 24 hours') + '</h3><p style="margin:6px 0 0;color:var(--mute)">Every wrong password, forged payment, tampered price and scanner probe is recorded here. Serious repeat offenders are blocked automatically.</p></div>' +
      '<div class="cards" style="margin-top:12px">' + [[s.events24, 'Events (24h)'], [s.loginFails24, 'Wrong passwords'], [s.lockouts24, 'Lockouts'], [s.probes24, 'Attack probes'], [s.tamper24, 'Order tampering'], [s.forged24, 'Forged tokens / payments'], [d.blocks.length, 'Blocked addresses']].map(function(c){ return '<div class="stat"><b>' + c[0] + '</b>' + c[1] + '</div>'; }).join('') + '</div>' +
      '<div class="panel"><h3 style="margin-top:0">Last 24 hours (oldest → now)</h3><div style="display:flex;gap:3px;align-items:flex-end;height:84px">' + bars + '</div></div>' +
      '<div class="row" style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))"><div class="panel"><h3 style="margin-top:0">Most active addresses (24h)</h3>' + (ips ? '<div style="overflow:auto"><table class="t"><tr><th>Address</th><th>Hits</th><th>Last</th><th></th></tr>' + ips + '</table></div>' : '<p style="color:var(--mute)">Nothing yet.</p>') + '</div>' +
      '<div class="panel"><h3 style="margin-top:0">What is happening (7 days)</h3>' + (types ? '<table class="t">' + types + '</table>' : '<p style="color:var(--mute)">Nothing yet.</p>') + '</div></div><p style="color:var(--mute);font-size:.84rem">Your address right now: <code>' + esc(d.myIp) + '</code> (internal and allow-listed addresses are never auto-blocked).</p>';
    wireBlock();
  }
  async function logTab(){
    var qs = 'events=1&days=' + F.days + '&limit=' + LIM + '&offset=' + F.off + (F.sev ? '&sev=' + F.sev : '') + (F.type ? '&type=' + encodeURIComponent(F.type) : '') + (F.ip ? '&ip=' + encodeURIComponent(F.ip) : '') + (F.q ? '&q=' + encodeURIComponent(F.q) : '');
    var d = await api('?' + qs);
    var opt = function(v, l, cur){ return '<option value="' + v + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + l + '</option>'; };
    var rows = d.events.map(function(e){ return '<tr><td style="white-space:nowrap">' + when(e.ts) + '</td><td>' + sevB(e.sev) + '</td><td>' + esc(nm(e.type)) + '</td><td><code>' + esc(e.ip) + '</code></td><td style="max-width:420px;word-break:break-word">' + esc(e.detail) + (e.path ? '<br><small style="color:var(--mute)">' + esc(e.path) + '</small>' : '') + '</td><td>' + (e.ip ? ipBtn(e.ip) : '') + '</td></tr>'; }).join('');
    $('pane').innerHTML = '<div class="panel"><div class="row" style="display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">' +
      '<div><label class="f">Severity</label><select id="fs">' + opt('', 'All', F.sev) + opt('low', 'Low and up', F.sev) + opt('med', 'Medium and up', F.sev) + opt('high', 'High and up', F.sev) + opt('crit', 'Critical only', F.sev) + '</select></div>' +
      '<div><label class="f">Period</label><select id="fd">' + opt(1, 'Last 24 hours', F.days) + opt(7, 'Last 7 days', F.days) + opt(30, 'Last 30 days', F.days) + opt(180, 'Last 6 months', F.days) + '</select></div>' +
      '<div><label class="f">Address</label><input id="fi" value="' + esc(F.ip) + '" placeholder="e.g. 203.0.113.9"></div><div><label class="f">Search</label><input id="fq" value="' + esc(F.q) + '" placeholder="words in detail"></div></div>' +
      '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn gold sm" id="fgo">Apply</button><button class="btn sm" id="fcsv">⬇ Download CSV</button><span style="color:var(--mute);align-self:center">' + d.total + ' event(s)</span></div></div>' +
      '<div class="panel" style="overflow:auto"><table class="t"><tr><th>Time (Nairobi)</th><th>Level</th><th>What</th><th>Address</th><th>Detail</th><th></th></tr>' + (rows || '<tr><td colspan="6" style="color:var(--mute)">No events match.</td></tr>') + '</table></div>' +
      '<div style="display:flex;gap:8px;margin-top:8px"><button class="btn sm" id="fp"' + (F.off ? '' : ' disabled') + '>← Newer</button><button class="btn sm" id="fn"' + (F.off + LIM < d.total ? '' : ' disabled') + '>Older →</button></div>';
    $('fgo').onclick = function(){ F.sev = $('fs').value; F.days = Number($('fd').value); F.ip = $('fi').value.trim(); F.q = $('fq').value.trim(); F.off = 0; logTab(); };
    $('fp').onclick = function(){ F.off = Math.max(0, F.off - LIM); logTab(); }; $('fn').onclick = function(){ F.off += LIM; logTab(); };
    $('fcsv').onclick = async function(){ try{
      var url = (K.base() || '') + '/api/auth/security?csv=1&days=' + F.days + (F.sev ? '&sev=' + F.sev : '') + (F.ip ? '&ip=' + encodeURIComponent(F.ip) : '') + (F.q ? '&q=' + encodeURIComponent(F.q) : '');
      var r = await fetch(url, { headers: { Authorization: 'Bearer ' + tok() } }); if(!r.ok) throw new Error('Download failed'); var b = await r.blob(); var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'azizo-security-log.csv'; a.click(); }catch(e){ K.toast(e.message); } };
    wireBlock();
  }
  async function blkTab(){
    var d = await api('');
    var rows = d.blocks.map(function(b){ var left = Math.max(0, b.until_ts - d.now), h = Math.ceil(left / 3600); return '<tr><td><code>' + esc(b.ip) + '</code></td><td>' + (Number(b.auto_block) ? 'Automatic' : 'By you') + '</td><td>' + esc(b.reason) + '</td><td>' + (h > 48 ? Math.ceil(h / 24) + ' days' : h + ' h') + '</td><td><button class="btn sm" data-un="' + esc(b.ip) + '">Unblock</button></td></tr>'; }).join('');
    $('pane').innerHTML = '<div class="panel"><h3 style="margin-top:0">Blocked addresses</h3><p style="color:var(--mute)">Blocked visitors get "access blocked" on every page and the API. Automatic blocks last 1 hour, then 24 hours, then 7 days for repeat offenders.</p>' + (rows ? '<div style="overflow:auto"><table class="t"><tr><th>Address</th><th>How</th><th>Reason</th><th>Remaining</th><th></th></tr>' + rows + '</table></div>' : '<p>No addresses are blocked right now.</p>') + '</div>' +
      '<div class="panel"><h3 style="margin-top:0">Block an address yourself</h3><div class="row" style="display:grid;gap:8px;grid-template-columns:2fr 1fr 2fr auto"><input id="bi" placeholder="IP address"><input id="bh" type="number" min="1" value="24" aria-label="hours"><input id="br" placeholder="Reason (optional)"><button class="btn gold" id="bg">Block</button></div><small style="color:var(--mute)">Hours. Unblocking never deletes the attack history.</small></div>';
    document.querySelectorAll('[data-un]').forEach(function(b){ b.onclick = async function(){ await api('', { method: 'POST', body: J({ action: 'unblock', ip: b.dataset.un }) }); K.toast('Unblocked'); blkTab(); }; });
    $('bg').onclick = async function(){ try{ await api('', { method: 'POST', body: J({ action: 'block', ip: $('bi').value.trim(), hours: Number($('bh').value) || 24, reason: $('br').value }) }); K.toast('Blocked'); blkTab(); }catch(e){ K.toast(e.message); } };
  }
  async function ordTab(){
    $('pane').innerHTML = '<div class="panel"><h3 style="margin-top:0">Order integrity</h3><p>Every order is sealed with a secret signature when it is placed (items, prices, delivery fee, total, phone, payment method). If anyone changes an order directly in the database, the seal no longer matches and it is reported here and emailed to you.</p><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><select id="od"><option value="7">Last 7 days</option><option value="30" selected>Last 30 days</option><option value="90">Last 90 days</option></select><button class="btn gold" id="ov">Check orders now</button></div><div id="or" style="margin-top:12px"></div><p style="color:var(--mute);font-size:.86rem">Tip: add the cron job from docs/SECURITY.md so this check also runs by itself every hour.</p></div>';
    $('ov').onclick = async function(){ $('or').innerHTML = 'Checking…'; try{ var r = await api('', { method: 'POST', body: J({ action: 'verify-orders', days: Number($('od').value) }) }), kr = r.kitchens || { checked: 0, ok: 0, unsigned: 0, tampered: [] }; r = { checked: r.checked + kr.checked, ok: r.ok + kr.ok, unsigned: r.unsigned + kr.unsigned, tampered: r.tampered.map(function(x){ return x; }).concat(kr.tampered.map(function(x){ return 'K' + x; })) };
      $('or').innerHTML = '<div class="cards"><div class="stat"><b>' + r.checked + '</b>Checked</div><div class="stat"><b>' + r.ok + '</b>Seal intact</div><div class="stat"><b>' + r.unsigned + '</b>No seal (old orders)</div><div class="stat"><b style="color:' + (r.tampered.length ? 'var(--red)' : 'inherit') + '">' + r.tampered.length + '</b>Changed / tampered</div></div>' + (r.tampered.length ? '<div class="msg err"><b>These orders no longer match their seal:</b> #' + r.tampered.join(', #') + '. Open them in the admin orders list, compare with the customer\'s WhatsApp/M-Pesa message, and change your cPanel and database passwords.</div>' : '<div class="msg" style="background:rgba(63,168,116,.16)">All checked orders are exactly as they were placed.</div>'); }catch(e){ $('or').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; } };
  }
  async function audTab(){
    var d = await api('');
    var rows = d.audit.map(function(a){ return '<tr><td style="white-space:nowrap">' + when(a.ts) + '</td><td>' + esc(a.actor) + '</td><td>' + esc(a.action) + '</td><td>' + esc(a.detail) + '</td><td><code>' + esc(a.ip) + '</code></td></tr>'; }).join('');
    $('pane').innerHTML = '<div class="panel" style="overflow:auto"><h3 style="margin-top:0">Audit trail (latest 100)</h3><p style="color:var(--mute)">Sign-ins, password changes and admin actions: who did what, and from where.</p><table class="t"><tr><th>Time</th><th>Who</th><th>Action</th><th>Detail</th><th>Address</th></tr>' + (rows || '<tr><td colspan="5">Nothing yet.</td></tr>') + '</table></div>';
  }
  async function hltTab(){
    var d = await api(''), bad = d.checks.filter(function(c){ return !c.ok; }).length;
    $('pane').innerHTML = '<div class="panel"><h3 style="margin-top:0">' + (bad ? '⚠️ ' + bad + ' thing(s) to fix' : '✅ Everything checked is in place') + '</h3>' + d.checks.map(function(c){ return '<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)"><span style="font-size:1.1rem">' + (c.ok ? '✅' : '❌') + '</span><div><b>' + esc(c.label) + '</b>' + (c.ok ? '' : '<br><small style="color:var(--mute)">' + esc(c.fix) + '</small>') + '</div></div>'; }).join('') + '</div>';
  }
  async function sesTab(){
    $('pane').innerHTML = '<div class="panel"><h3 style="margin-top:0">Sign everyone out</h3><p>If you think a password, phone or computer was compromised: this immediately ends every staff, admin, partner and rider session. Everyone has to sign in again. You stay signed in.</p><button class="btn red" id="ra">Sign everyone out now</button><div id="rr"></div><p style="color:var(--mute);font-size:.86rem;margin-top:14px">After a real incident also: change ADMIN_PASSWORD and STAFF_PASSWORD, change the cPanel and database passwords, and download the attack log (CSV) for your records.</p></div>';
    $('ra').onclick = async function(){ if(!window.confirm('Sign out everyone, including all staff and partners?')) return; try{ var r = await api('', { method: 'POST', body: J({ action: 'revoke-all' }) }); sessionStorage.setItem(TK, r.token); $('rr').innerHTML = '<div class="msg" style="background:rgba(63,168,116,.16)">Done. All other sessions have ended.</div>'; }catch(e){ $('rr').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; } };
  }
  if(tok()) draw(); else gate();
})();
