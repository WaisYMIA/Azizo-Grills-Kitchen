// Azizo Operations (admin): analytics, support, requests, go-live gate, inspector accounts, SOPs. Uses the main admin password.
(function(){
  'use strict';
  var K = window.KK, M = window.MK, O = window.OPS, $ = K.$, esc = K.esc, money = K.money, TK = 'mkAdminToken', app = $('app'), tab = 'ana', days = 30;
  M.header(''); M.footer();
  var tok = function(){ return sessionStorage.getItem(TK) || ''; };
  async function api(path, opts){ try{ return await O.api(path, opts, tok()); }catch(e){ if(e.status === 401 || e.status === 403){ sessionStorage.removeItem(TK); gate('Please sign in again'); throw new Error('Please sign in again'); } throw e; } }
  async function mk(path, opts){ return M.api(path, opts, tok()); }
  var J = M.json;
  function gate(msg){
    app.innerHTML = '<div class="gate panel"><h2>Operations</h2><p style="color:var(--mute)">Use the main admin password.</p>' + (K.base() ? '' : '<label class="f" for="gUrl">Server address</label><input id="gUrl" placeholder="https://api.yourdomain.co.ke">') +
      '<label class="f" for="gPw" style="margin-top:10px">Admin password</label><input id="gPw" type="password" autocomplete="current-password"><div id="gErr">' + (msg ? '<div class="msg err">' + esc(msg) + '</div>' : '') + '</div><button class="btn gold" id="gGo" style="width:100%;margin-top:10px">Sign in</button></div>';
    var go = async function(){ if($('gUrl')) K.set('azizoAdminBackendUrl', $('gUrl').value.trim().replace(/\/+$/, '')); $('gErr').innerHTML = '';
      try{ var pw = $('gPw').value, r; try{ r = await M.root('/api/auth/admin-login', { method: 'POST', body: J({ password: pw }) }); }catch(e1){ if(!/6-digit|authenticator/i.test(e1.message)) throw e1; var cd = (window.prompt('Enter the 6-digit code from your authenticator app') || '').trim(); r = await M.root('/api/auth/admin-login', { method: 'POST', body: J({ password: pw, code: cd }) }); } sessionStorage.setItem(TK, r.token); draw(); }catch(e){ $('gErr').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; } };
    $('gGo').onclick = go; $('gPw').onkeydown = function(e){ if(e.key === 'Enter') go(); };
  }
  var T = [['ana', 'Analytics'], ['tk', 'Support tickets'], ['rq', 'Customer requests'], ['gl', 'Go-live gate'], ['ac', 'Inspector accounts'], ['sop', 'SOP handbook']];
  function draw(){
    app.innerHTML = '<div style="padding:18px 0 0"><div class="eyebrow">Admin</div><h2 style="margin:0">Operations</h2></div><div class="dash"><div class="side" id="side"></div><div id="pane"></div></div>';
    $('side').innerHTML = T.map(function(t){ return '<button data-t="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '<a class="btn sm" href="marketplace-admin.html" style="margin-top:8px">Marketplace admin</a><button id="lo">Sign out</button>';
    $('side').querySelectorAll('[data-t]').forEach(function(b){ b.onclick = function(){ tab = b.dataset.t; draw(); }; }); $('lo').onclick = function(){ sessionStorage.removeItem(TK); gate(); };
    ({ ana: anaTab, tk: tkTab, rq: rqTab, gl: glTab, ac: acTab, sop: sopTab })[tab]().catch(function(e){ $('pane').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; });
  }
  var stat = function(n, l, bad){ return '<div class="stat"><b' + (bad ? ' style="color:#ff8a9c"' : '') + '>' + (n == null ? '-' : n) + '</b>' + l + '</div>'; };
  async function anaTab(){
    var r = await api('/admin/analytics?days=' + days), f = r.funnel, pct = function(v){ return v == null ? '-' : v + '%'; };
    $('pane').innerHTML = '<div class="panel"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center"><div><h3 style="margin:0">Analytics</h3><small style="color:var(--mute)">From ' + esc(r.from) + ' · Nairobi time</small></div><div>' + [7, 30, 90].map(function(d){ return '<button class="btn sm ' + (d === days ? 'gold' : '') + '" data-d="' + d + '">' + d + ' days</button> '; }).join('') + '</div></div></div>' +
      '<div class="cards" style="margin-top:12px">' + stat(r.orders, 'Orders') + stat(money(r.revenue), 'Revenue') + stat(money(r.aov), 'Average order') + stat(pct(r.repeatPct), 'Repeat customers') + stat(pct(r.cancelPct), 'Cancelled', r.cancelPct > 8) + stat(r.rating.avg == null ? '-' : r.rating.avg + ' ★', 'Rating (' + r.rating.count + ')') + stat(r.kitchens.orders, 'Kitchens orders') + stat(money(r.kitchens.revenue), 'Kitchens revenue') + '</div>' +
      '<div class="panel" style="margin-top:12px"><h3 style="margin-top:0">Where customers drop off</h3><p class="kmeta" style="color:var(--mute)">Anonymous counts from the shop. A low number between two steps shows where to improve.</p>' + O.bars([['Visits', f.visits], ['Added to cart', f.cartAdds], ['Opened checkout', f.checkouts], ['Placed an order', f.placed]], function(x){ return x[0]; }, function(x){ return x[1]; }) +
      '<p style="font-size:.85rem;color:var(--mute)">Visit → cart ' + pct(f.visitToCartPct) + ' · cart → checkout ' + pct(f.cartToCheckoutPct) + ' · checkout → order ' + pct(f.checkoutToOrderPct) + '</p></div>' +
      '<div class="panel" style="margin-top:12px"><h3 style="margin-top:0">Daily sales</h3>' + (r.daily.length ? O.bars(r.daily.slice(-14), function(x){ return x.d.slice(5); }, function(x){ return x.s; }, function(v){ return money(v); }) : '<p style="color:var(--mute)">No orders in this period.</p>') + '</div>' +
      '<div class="panel" style="margin-top:12px"><h3 style="margin-top:0">Busiest hours</h3><div class="hours">' + (function(){ var m = Math.max.apply(null, r.hoursEAT.concat([1])); return r.hoursEAT.map(function(v, h){ return '<i title="' + h + ':00 - ' + v + ' orders" style="height:' + Math.round(v * 100 / m) + '%"></i>'; }).join(''); })() + '</div><div class="hours-l">' + r.hoursEAT.map(function(v, h){ return '<span>' + (h % 3 ? '' : h) + '</span>'; }).join('') + '</div></div>' +
      '<div class="row" style="margin-top:12px"><div class="panel"><h3 style="margin-top:0">Top items</h3>' + (r.top.length ? O.bars(r.top, function(x){ return x.name; }, function(x){ return x.s; }, function(v){ return money(v); }) : '<p style="color:var(--mute)">No data yet.</p>') + '</div><div class="panel"><h3 style="margin-top:0">By branch</h3>' + (r.byBranch.length ? O.bars(r.byBranch, function(x){ return x.b; }, function(x){ return x.s; }, function(v){ return money(v); }) : '<p style="color:var(--mute)">No data yet.</p>') + '</div></div>';
    $('pane').querySelectorAll('[data-d]').forEach(function(b){ b.onclick = function(){ days = Number(b.dataset.d); anaTab(); }; });
  }
  async function tkTab(){
    var r = await api('/admin/tickets');
    $('pane').innerHTML = '<div class="panel"><h3 style="margin:0">Support tickets <span class="pill">' + r.open + ' waiting</span></h3></div><div class="scroll" style="margin-top:12px"><table class="t"><thead><tr><th>Ref</th><th>From</th><th>Subject</th><th>Type</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>' +
      (r.tickets.map(function(t){ return '<tr><td>' + esc(t.ref) + '</td><td>' + esc(t.owner_name) + '<br><small>' + esc(t.scope) + '</small></td><td>' + (t.priority === 'urgent' ? '<b style="color:#ff8a9c">URGENT</b> ' : '') + esc(t.subject) + '</td><td>' + esc(t.category) + '</td><td><span class="pill">' + esc(t.status) + '</span></td><td>' + esc(String(t.updated_at).slice(0, 16)) + '</td><td><button class="btn sm" data-t="' + t.id + '">Open</button></td></tr>'; }).join('') || '<tr><td colspan="7">No tickets yet.</td></tr>') + '</tbody></table></div><div id="thr"></div>';
    $('pane').querySelectorAll('[data-t]').forEach(function(b){ b.onclick = async function(){
      var d = await api('/admin/tickets/' + b.dataset.t), t = d.ticket;
      $('thr').innerHTML = '<div class="panel" style="margin-top:12px"><h3 style="margin-top:0">' + esc(t.ref) + ' · ' + esc(t.subject) + '</h3>' + d.messages.map(function(m){ return '<div class="tk-msg ' + (m.from_role === 'azizo' ? 'az' : '') + '"><small>' + esc(m.from_name) + ' · ' + esc(String(m.created_at).slice(0, 16)) + '</small><div>' + esc(m.body).replace(/\n/g, '<br>') + '</div></div>'; }).join('') +
        '<textarea id="rb" rows="3" placeholder="Reply" maxlength="2000"></textarea><div id="re"></div><button class="btn gold" id="rs">Send reply</button> <button class="btn" id="rc">Close ticket</button></div>';
      var send = async function(close){ try{ await api('/admin/tickets/' + t.id + '/reply', { method: 'POST', body: J({ body: $('rb').value, close: close }) }); tkTab(); }catch(e){ $('re').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; } };
      $('rs').onclick = function(){ send(false); }; $('rc').onclick = function(){ send(true); };
    }; });
  }
  async function rqTab(){
    var r = await api('/admin/requests'), L = { delete: 'Delete my data', export: 'Copy of my data', 'stop-marketing': 'Stop marketing', reward: 'Reward request' };
    $('pane').innerHTML = '<div class="panel"><h3 style="margin:0">Customer requests</h3><p class="kmeta" style="color:var(--mute)">Data-protection requests must be answered within 7 days. Reward requests: approving one deducts the points; then send the voucher or credit on WhatsApp.</p></div><div class="scroll" style="margin-top:12px"><table class="t"><thead><tr><th>When</th><th>Type</th><th>Customer</th><th>Details</th><th>Status</th><th></th></tr></thead><tbody>' +
      (r.requests.map(function(q){ return '<tr><td>' + esc(String(q.created_at).slice(0, 16)) + '</td><td>' + esc(L[q.kind] || q.kind) + (q.points ? '<br><small>' + q.points + ' points = KES ' + q.points + '</small>' : '') + '</td><td>' + esc(q.name) + '<br><small>' + esc(q.phone) + '</small></td><td>' + esc(q.note) + '</td><td><span class="pill">' + esc(q.status) + '</span></td><td>' + (q.status === 'open' ? '<button class="btn sm gold" data-a="done" data-i="' + q.id + '">Done</button> <button class="btn sm" data-a="declined" data-i="' + q.id + '">Decline</button>' : esc(q.resolution)) + '</td></tr>'; }).join('') || '<tr><td colspan="6">Nothing yet.</td></tr>') + '</tbody></table></div>';
    $('pane').querySelectorAll('[data-a]').forEach(function(b){ b.onclick = async function(){ var note = window.prompt(b.dataset.a === 'done' ? 'What was done? (e.g. data deleted / KES 200 sent)' : 'Reason for declining') || ''; try{ await api('/admin/requests/' + b.dataset.i, { method: 'PATCH', body: J({ status: b.dataset.a, resolution: note }) }); rqTab(); }catch(e){ window.alert(e.message); } }; });
  }
  async function glTab(){
    var list = (await mk('/admin/partners')).partners;
    $('pane').innerHTML = '<div class="panel"><h3 style="margin:0">Go-live gate</h3><p class="kmeta" style="color:var(--mute)">A partner goes to trial or live only when every check is ticked. The inspection and licence checks come from the Marketplace admin. You can override with a written reason, which is recorded.</p><label class="f" for="gp">Partner</label><select id="gp"><option value="">Choose a butchery</option>' + list.map(function(p){ return '<option value="' + p.id + '">' + esc(p.name) + ' (' + esc(p.status) + ')</option>'; }).join('') + '</select></div><div id="gb"></div>';
    var show = async function(id){
      var g = await api('/admin/gate/' + id), p = list.filter(function(x){ return String(x.id) === String(id); })[0];
      $('gb').innerHTML = '<div class="panel" style="margin-top:12px"><h3 style="margin-top:0">' + esc(p.name) + ' · ' + (g.ok ? '<span style="color:#7be0ae">Ready to go live</span>' : '<span style="color:#ff8a9c">Not ready</span>') + '</h3>' + g.checks.map(function(c){ return '<div class="chk"><span class="' + (c.ok ? 'ok' : 'no') + '" aria-hidden="true">' + (c.ok ? '✔' : '✖') + '</span><label>' + esc(c.label) + (c.manual ? '' : ' <small style="color:var(--mute)">(automatic)</small>') + '</label>' + (c.manual ? '<button class="btn sm" data-k="' + c.key + '" data-v="' + (c.ok ? 0 : 1) + '">' + (c.ok ? 'Untick' : 'Tick') + '</button>' : '') + '</div>'; }).join('') +
        '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn gold" data-s="pilot">Set to trial (pilot)</button><button class="btn gold" data-s="live">Set live</button></div><div id="ge"></div></div>';
      $('gb').querySelectorAll('[data-k]').forEach(function(b){ b.onclick = async function(){ await api('/admin/onboarding/' + id, { method: 'PUT', body: J({ key: b.dataset.k, done: b.dataset.v === '1' }) }); show(id); }; });
      $('gb').querySelectorAll('[data-s]').forEach(function(b){ b.onclick = async function(){
        var body = { status: b.dataset.s }; $('ge').innerHTML = '';
        for(;;){ try{ await mk('/admin/partners/' + id, { method: 'PATCH', body: J(body) }); p.status = body.status; $('ge').innerHTML = '<div class="msg ok">Status set to ' + esc(body.status) + '.</div>'; return; }
          catch(e){ if(e.status === 409){ var why = window.prompt('The checklist is not complete. To go ahead anyway, type the reason (10+ characters). It is recorded.'); if(!why){ $('ge').innerHTML = '<div class="msg err">Not changed: ' + esc(e.message) + '</div>'; return; } body.overrideReason = why; continue; } $('ge').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; return; } }
      }; });
    };
    $('gp').onchange = function(){ if($('gp').value) show($('gp').value); else $('gb').innerHTML = ''; };
  }
  async function acTab(){
    var r = await api('/admin/accounts');
    $('pane').innerHTML = '<div class="panel"><h3 style="margin:0">Inspector accounts</h3><p class="kmeta" style="color:var(--mute)">Give each inspector their own username and password, so every inspection is traced to a named person. Turn an account off when someone leaves.</p>' +
      '<div class="row"><div><label class="f" for="au">Username</label><input id="au" maxlength="30" placeholder="jane.k"></div><div><label class="f" for="an">Full name</label><input id="an" maxlength="60"></div></div><div class="row"><div><label class="f" for="at">Official title</label><input id="at" maxlength="60" placeholder="Food Safety Inspector"></div><div><label class="f" for="ap">Password (8+ characters)</label><input id="ap" type="password" autocomplete="new-password"></div></div><div id="ae"></div><button class="btn gold" id="ag" style="margin-top:8px">Create account</button></div>' +
      '<div class="scroll" style="margin-top:12px"><table class="t"><thead><tr><th>Username</th><th>Name</th><th>Title</th><th>Last sign-in</th><th>Status</th><th></th></tr></thead><tbody>' + (r.accounts.map(function(a){ return '<tr><td>' + esc(a.username) + '</td><td>' + esc(a.name) + '</td><td>' + esc(a.title) + '</td><td>' + esc(a.last_login || 'never') + '</td><td><span class="pill">' + (a.active ? 'active' : 'off') + '</span></td><td><button class="btn sm" data-t="' + a.id + '" data-v="' + (a.active ? 0 : 1) + '">' + (a.active ? 'Turn off' : 'Turn on') + '</button> <button class="btn sm" data-p="' + a.id + '">Reset password</button></td></tr>'; }).join('') || '<tr><td colspan="6">No named accounts yet. Inspectors can still use the shared inspector password.</td></tr>') + '</tbody></table></div>';
    $('ag').onclick = async function(){ try{ await api('/admin/accounts', { method: 'POST', body: J({ username: $('au').value, name: $('an').value, title: $('at').value, password: $('ap').value }) }); acTab(); }catch(e){ $('ae').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; } };
    $('pane').querySelectorAll('[data-t]').forEach(function(b){ b.onclick = async function(){ await api('/admin/accounts/' + b.dataset.t, { method: 'PATCH', body: J({ active: b.dataset.v === '1' }) }); acTab(); }; });
    $('pane').querySelectorAll('[data-p]').forEach(function(b){ b.onclick = async function(){ var pw = window.prompt('New password (8+ characters)'); if(!pw) return; try{ await api('/admin/accounts/' + b.dataset.p, { method: 'PATCH', body: J({ password: pw }) }); K.toast('Password changed'); }catch(e){ window.alert(e.message); } }; });
  }
  async function sopTab(){ $('pane').innerHTML = '<div id="sopH"></div>'; await O.sopPanel($('sopH'), tok()); }
  if(tok()) draw(); else gate();
})();
