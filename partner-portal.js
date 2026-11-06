(function(){
  'use strict';
  var K = window.KK, M = window.MK, $ = K.$, esc = K.esc, money = K.money, TK = 'mkPartnerToken', app = $('app'), me = null, tab = 'dash', timer = null;
  M.header('portal'); M.footer();
  var tok = function(){ return sessionStorage.getItem(TK) || ''; };
  async function api(path, opts){ try{ return await M.api(path, opts, tok()); }catch(e){ if(e.status === 401){ logout(); throw new Error('Please log in again'); } throw e; } }
  function logout(){ sessionStorage.removeItem(TK); clearInterval(timer); me = null; gate(); }
  function gate(msg){
    app.innerHTML = '<div class="gate panel"><h2>Partner login</h2><p style="color:var(--mute)">For Azizo partner butcheries.</p>' + (K.base() ? '' : '<label class="f" for="gUrl">Server address</label><input id="gUrl" placeholder="https://api.yourdomain.co.ke">') +
      '<label class="f" for="gId" style="margin-top:10px">Email or phone</label><input id="gId" autocomplete="username" value="' + esc(K.get('mkLogin')) + '"><label class="f" for="gPw" style="margin-top:10px">Password</label><input id="gPw" type="password" autocomplete="current-password">' +
      '<div id="gErr">' + (msg ? '<div class="msg err">' + esc(msg) + '</div>' : '') + '</div><button class="btn gold" id="gGo" style="width:100%;margin-top:10px">Log in</button><p style="margin-top:14px;font-size:.9rem">New here? <a href="sell-with-azizo.html">Apply to sell with Azizo</a></p></div>';
    var go = async function(){
      if($('gUrl')) K.set('azizoAdminBackendUrl', $('gUrl').value.trim().replace(/\/+$/, ''));
      $('gErr').innerHTML = ''; try{ var r = await M.api('/partner/login', { method: 'POST', body: M.json({ login: $('gId').value, password: $('gPw').value }) }); K.set('mkLogin', $('gId').value); sessionStorage.setItem(TK, r.token); start(); }catch(e){ $('gErr').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; }
    };
    $('gGo').onclick = go; $('gPw').onkeydown = function(e){ if(e.key === 'Enter') go(); };
  }
  var NOTE = { applied: 'Application received. Azizo will contact you to arrange a premises visit and hygiene check. You can already list your items.', pilot: 'You are live on a trial period. Keep your prices and stock up to date.', live: 'You are live.', suspended: 'Your butchery is suspended. Contact Azizo (often because an invoice is unpaid).', delisted: 'Delisted.', rejected: 'Not accepted.' };
  async function start(){ try{ me = await api('/partner/me'); }catch(e){ return gate(e.message); } draw(); clearInterval(timer); timer = setInterval(function(){ if(tab === 'orders') ordersTab(true); }, 30000); }
  function draw(){
    var p = me.partner;
    app.innerHTML = '<div style="padding:18px 0 0"><div class="eyebrow">Partner portal</div><h2 style="margin:0">' + esc(p.name) + ' <span class="pill ' + p.status + '">' + esc(p.status) + '</span></h2></div><div class="msg info">' + esc(NOTE[p.status] || '') + (me.enabled ? '' : ' The marketplace is switched off at the moment, so customers cannot see you yet.') + '</div>' +
      (me.invoices.some(function(i){ return i.overdue; }) ? '<div class="msg err" role="alert">You have an overdue invoice. Please pay it to avoid suspension.</div>' : '') + '<div class="dash"><div class="side" id="side"></div><div id="pane"></div></div>';
    var T = [['dash', 'Dashboard'], ['orders', 'Orders'], ['items', 'My items'], ['stmt', 'Statements'], ['inv', 'Invoices'], ['gl', 'Go-live progress'], ['sup', 'Support'], ['sop', 'SOP handbook'], ['profile', 'Profile']];
    $('side').innerHTML = T.map(function(t){ return '<button data-t="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '<button id="lo">Log out</button>';
    $('side').querySelectorAll('[data-t]').forEach(function(b){ b.onclick = function(){ tab = b.dataset.t; draw(); }; }); $('lo').onclick = logout;
    ({ dash: dashTab, orders: ordersTab, items: itemsTab, stmt: stmtTab, inv: invTab, gl: glTab, sup: supTab, sop: sopTab, profile: profileTab })[tab]();
  }
  var NEXT = { received: ['preparing', 'Start preparing'], preparing: ['ready', 'Mark ready'], ready: ['out_for_delivery', 'Out for delivery'], out_for_delivery: ['completed', 'Mark delivered'] };
  async function ordersTab(quiet){
    var pane = $('pane'); if(!quiet) pane.innerHTML = '<p class="kmeta">Loading…</p>';
    try{ var r = await api('/partner/orders'); }catch(e){ if(!quiet) pane.innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; return; }
    if(tab !== 'orders') return;
    pane.innerHTML = r.orders.length ? r.orders.map(function(o){
      var nx = NEXT[o.status], closed = o.status === 'completed' || o.status === 'cancelled';
      return '<div class="panel ord" style="margin-bottom:10px"><h4>#' + o.id + ' · ' + esc(o.customer || '') + ' <span class="pill ' + (closed ? '' : 'new') + '">' + esc(o.status.replace(/_/g, ' ')) + '</span></h4><div class="kmeta" style="color:var(--mute)">' + esc(o.phone) + ' · ' + esc(o.fulfilment) + (o.address ? ' · ' + esc(o.address) : '') + '</div><ul style="margin:8px 0;padding-left:18px">' +
        o.items.map(function(i){ return '<li>' + M.fmtQty(i.qty, i.unit) + (i.unit === 'kg' ? ' kg' : ' ×') + ' ' + esc(i.name) + ' <span style="color:var(--mute)">' + money(i.line_total) + '</span></li>'; }).join('') + '</ul><b>Total ' + money(o.total) + '</b> <span class="kmeta" style="color:var(--mute)">(items ' + money(o.subtotal) + ' + delivery ' + money(o.deliveryFee) + ') · ' + esc(o.payment) + '</span>' +
        (o.notes ? '<p class="kmeta" style="color:var(--mute)">' + esc(o.notes) + '</p>' : '') + (closed ? '' : '<div style="margin-top:8px">' + (nx ? '<button class="btn sm gold" data-s="' + o.id + '|' + nx[0] + '"' + (o.needsCode && nx[0] === 'completed' ? ' data-code="1"' : '') + '>' + nx[1] + '</button> ' : '') + '<button class="btn sm ghost" data-s="' + o.id + '|cancelled">Cancel</button></div>') + '</div>'; }).join('') : '<div class="empty">No orders yet.</div>';
    pane.querySelectorAll('[data-s]').forEach(function(b){ b.onclick = async function(){ var a = b.dataset.s.split('|'); if(a[1] === 'cancelled' && !confirm('Cancel this order?')) return; var body = { status: a[1] };
      if(a[1] === 'completed' && b.dataset.code === '1'){   // v5.1 delivery handover code
        var c = window.prompt('Ask the customer for the 4-digit delivery code (on their order tracking page) and type it here.\nLeave empty only if they cannot give it.');
        if(c === null) return; c = c.trim();
        if(c){ body.code = c; } else { if(!window.confirm('Complete this delivery WITHOUT a code? Azizo will see this in its audit log.')) return; var why = window.prompt('Why could the code not be used? (e.g. customer phone off)'); if(!why || why.trim().length < 5) return K.toast('A reason is needed'); body.noCode = true; body.reason = why.trim(); }
      }
      try{ await api('/partner/orders/' + a[0] + '/status', { method: 'PATCH', body: M.json(body) }); ordersTab(); }catch(e){ K.toast(e.message); } }; });
  }
  async function itemsTab(){
    var pane = $('pane'), listed = {}; me.items.forEach(function(i){ listed[i.id] = 1; });
    var rest = me.catalogue.filter(function(c){ return !listed[c.id]; });
    pane.innerHTML = '<p class="kmeta" style="color:var(--mute)">Set your own price (Azizo shows its recommended price) and tick items in stock. Customers see only what you list.</p><div class="scroll"><table class="t"><thead><tr><th>Item</th><th>Recommended</th><th>Your price</th><th>In stock</th><th></th></tr></thead><tbody>' +
      (me.items.map(function(i){ return '<tr><td>' + esc(i.name) + '<br><small style="color:var(--mute)">' + esc(i.cat) + ' / ' + esc(i.unit) + '</small></td><td>' + money(i.recommended) + '</td><td><input type="number" min="1" style="width:100px" data-price="' + esc(i.id) + '" value="' + i.price + '">' + (i.farFromRecommended ? '<div style="color:#ff8a9c;font-size:.78rem">' + (i.gapPct > 0 ? '+' : '') + i.gapPct + '% vs recommended</div>' : '') + '</td><td><input type="checkbox" data-stock="' + esc(i.id) + '"' + (i.inStock ? ' checked' : '') + '></td><td><button class="btn sm ghost" data-del="' + esc(i.id) + '">Remove</button></td></tr>'; }).join('') || '<tr><td colspan="5">You have not listed anything yet.</td></tr>') + '</tbody></table></div>' +
      '<h3 style="margin-top:20px">Add items</h3><input id="cq" type="search" placeholder="Search the Azizo catalogue" aria-label="Search catalogue"><div id="cl" style="max-height:320px;overflow:auto;margin-top:8px"></div><button class="btn gold" id="addSel" style="margin-top:8px">List selected items at recommended price</button>';
    var showCat = function(){ var q = $('cq').value.toLowerCase(); $('cl').innerHTML = rest.filter(function(c){ return !q || (c.name + ' ' + c.cat).toLowerCase().indexOf(q) >= 0; }).slice(0, 80).map(function(c){ return '<label style="display:flex;gap:8px;padding:5px 0"><input type="checkbox" value="' + esc(c.id) + '"> <span>' + esc(c.name) + ' <small style="color:var(--mute)">' + esc(c.cat) + ' · ' + money(c.price) + ' / ' + esc(c.unit) + '</small></span></label>'; }).join(''); };
    $('cq').oninput = showCat; showCat();
    $('addSel').onclick = async function(){ var ids = Array.prototype.map.call($('cl').querySelectorAll('input:checked'), function(x){ return x.value; }); if(!ids.length) return K.toast('Tick the items to add'); try{ await api('/partner/items/bulk', { method: 'POST', body: M.json({ ids: ids }) }); await start(); }catch(e){ K.toast(e.message); } };
    pane.querySelectorAll('[data-price]').forEach(function(x){ x.onchange = async function(){ try{ await api('/partner/items/' + encodeURIComponent(x.dataset.price), { method: 'PUT', body: M.json({ price: x.value }) }); K.toast('Price saved'); await start(); }catch(e){ K.toast(e.message); } }; });
    pane.querySelectorAll('[data-stock]').forEach(function(x){ x.onchange = async function(){ try{ await api('/partner/items/' + encodeURIComponent(x.dataset.stock), { method: 'PUT', body: M.json({ inStock: x.checked }) }); K.toast(x.checked ? 'In stock' : 'Marked out of stock'); }catch(e){ K.toast(e.message); } }; });
    pane.querySelectorAll('[data-del]').forEach(function(x){ x.onclick = async function(){ try{ await api('/partner/items/' + encodeURIComponent(x.dataset.del), { method: 'DELETE' }); await start(); }catch(e){ K.toast(e.message); } }; });
  }
  async function invTab(){
    try{ me.invoices = (await api('/partner/invoices')).invoices; }catch(e){}
    $('pane').innerHTML = '<p class="kmeta" style="color:var(--mute)">Azizo invoices its fee on completed orders. Pay the invoice by the due date; unpaid invoices lead to suspension.</p><div class="scroll"><table class="t"><thead><tr><th>#</th><th>Period</th><th>Orders</th><th>Sales</th><th>Fee</th><th>Total due</th><th>Due</th><th>Status</th></tr></thead><tbody>' +
      (me.invoices.map(function(i){ return '<tr><td>' + i.id + '</td><td>' + esc(i.periodStart) + ' to ' + esc(i.periodEnd) + '</td><td>' + i.orders + '</td><td>' + money(i.gross) + '</td><td>' + money(i.fee) + (i.extra ? ' + ' + money(i.extra) : '') + '</td><td><b>' + money(i.total) + '</b></td><td>' + esc(i.dueDate) + '</td><td><span class="pill ' + (i.status === 'paid' ? 'live' : (i.overdue ? 'new' : '')) + '">' + (i.overdue ? 'overdue' : i.status) + '</span></td></tr>'; }).join('') || '<tr><td colspan="8">No invoices yet.</td></tr>') + '</tbody></table></div>';
  }
  function profileTab(){
    var p = me.partner;
    $('pane').innerHTML = '<div class="panel"><label class="f" for="st">Your story (shown to customers)</label><textarea id="st" maxlength="800">' + esc(p.story) + '</textarea><div class="row" style="margin-top:10px"><div><label class="f" for="ph">Phone</label><input id="ph" value="' + esc(p.phone) + '"></div><div><label class="f" for="df">Delivery fee (KSh)</label><input id="df" type="number" value="' + p.deliveryFee + '"></div></div>' +
      '<div class="row" style="margin-top:10px"><div><label class="f" for="mo">Minimum order (KSh)</label><input id="mo" type="number" value="' + p.minOrder + '"></div><div><label class="f" for="dm">Who delivers</label><select id="dm">' + [['own', 'My own riders'], ['azizo', 'Azizo riders'], ['independent', 'Independent riders']].map(function(o){ return '<option value="' + o[0] + '"' + (p.deliveryMode === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="row" style="margin-top:10px"><div><label class="f" for="pm">Payment method</label><select id="pm">' + [['till', 'M-Pesa Till'], ['paybill', 'Paybill'], ['pochi', 'Pochi la Biashara']].map(function(o){ return '<option value="' + o[0] + '"' + (p.payMethod === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div><div><label class="f" for="pa">Till / paybill / number</label><input id="pa" value="' + esc(p.payAccount) + '"></div></div>' +
      '<label style="display:flex;gap:8px;margin-top:12px"><input type="checkbox" id="pz"' + (p.paused ? ' checked' : '') + '> Pause orders (shop closed)</label><button class="btn gold" id="sv" style="margin-top:10px">Save</button></div>' +
      '<div class="panel" style="margin-top:12px"><h3 style="margin-top:0">Change password</h3><div class="row"><div><label class="f" for="pc">Current</label><input id="pc" type="password"></div><div><label class="f" for="pn">New (6+ characters)</label><input id="pn" type="password"></div></div><button class="btn" id="pp" style="margin-top:10px">Change password</button></div>';
    $('sv').onclick = async function(){ try{ await api('/partner/me', { method: 'PATCH', body: M.json({ story: $('st').value, phone: $('ph').value, deliveryFee: $('df').value, minOrder: $('mo').value, deliveryMode: $('dm').value, payMethod: $('pm').value, payAccount: $('pa').value, paused: $('pz').checked }) }); K.toast('Saved'); await start(); }catch(e){ K.toast(e.message); } };
    $('pp').onclick = async function(){ try{ var pr = await api('/partner/password', { method: 'POST', body: M.json({ current: $('pc').value, next: $('pn').value }) }); if(pr && pr.token) sessionStorage.setItem(TK, pr.token); K.toast('Password changed'); $('pc').value = $('pn').value = ''; }catch(e){ K.toast(e.message); } };
  }

  // ---- v5.0: dashboard, statements, go-live progress, support, SOPs ----
  var money = K.money;
  async function dashTab(){
    var pane = $('pane'); pane.innerHTML = '<p class="kmeta">Loading…</p>';
    try{ var d = await OPS.api('/partner/dashboard', {}, tok()); }catch(e){ pane.innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; return; }
    var c = function(n, l, bad){ return '<div class="stat"><b' + (bad ? ' style="color:#ff8a9c"' : '') + '>' + (n == null ? '-' : n) + '</b>' + l + '</div>'; };
    pane.innerHTML = '<div class="cards">' + c(money(d.today.s), 'Sales today (' + d.today.n + ')') + c(money(d.week.s), 'Last 7 days (' + d.week.n + ')') + c(money(d.month.s), 'Last 30 days (' + d.month.n + ')') + c(d.openOrders, 'Orders to handle now', d.openOrders > 0) + c(d.rating.avg == null ? '-' : d.rating.avg + ' ★', 'Customer rating (' + d.rating.count + ')') + c(d.completionPct30 == null ? '-' : d.completionPct30 + '%', 'Orders completed (30 days)') + c(d.itemsSoldOut + ' of ' + d.itemsListed, 'Items marked sold out') + '</div>' +
      (d.staleItems ? '<div class="msg info" role="status"><b>' + d.staleItems + ' of your items have not been checked for 3+ days.</b> Customers may order what you no longer have. <button class="btn sm gold" id="cfStock">Everything is in stock as listed</button> <button class="btn sm" id="cfItems">Review my items</button></div>' : '') +
      (d.answeredTickets ? '<div class="msg info">Azizo replied to ' + d.answeredTickets + ' of your support tickets. <a href="#" id="goSup">Open Support</a></div>' : '') +
      '<div class="panel" style="margin-top:12px"><h3 style="margin-top:0">Last 7 days</h3>' + (d.daily.length ? OPS.bars(d.daily, function(x){ return x.d.slice(5); }, function(x){ return x.s; }, function(v){ return money(v); }) : '<p style="color:var(--mute)">No orders yet this week.</p>') + '</div>' +
      '<div class="panel" style="margin-top:12px"><h3 style="margin-top:0">Your best sellers (30 days)</h3>' + (d.top.length ? OPS.bars(d.top, function(x){ return x.name; }, function(x){ return x.s; }, function(v){ return money(v); }) : '<p style="color:var(--mute)">No sales yet.</p>') + '</div>';
    var cs = $('cfStock'); if(cs) cs.onclick = async function(){ try{ await OPS.api('/partner/confirm-stock', { method: 'POST' }, tok()); K.toast('Thanks, stock confirmed'); dashTab(); }catch(e){ K.toast(e.message); } };
    var ci = $('cfItems'); if(ci) ci.onclick = function(){ tab = 'items'; draw(); };
    var g = $('goSup'); if(g) g.onclick = function(e){ e.preventDefault(); tab = 'sup'; draw(); };
  }
  async function stmtTab(){
    var pane = $('pane'), today = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    pane.innerHTML = '<div class="panel"><h3 style="margin-top:0">Statement</h3><div class="row"><div><label class="f" for="sf">From</label><input id="sf" type="date" value="' + from + '"></div><div><label class="f" for="st">To</label><input id="st" type="date" value="' + today + '"></div></div><button class="btn gold" id="sg">Show</button> <button class="btn" id="sc">Download CSV</button> <button class="btn" id="sp">Print</button></div><div id="sb"></div>';
    var show = async function(){
      try{ var r = await OPS.api('/partner/statement?from=' + $('sf').value + '&to=' + $('st').value, {}, tok()), t = r.totals; }catch(e){ $('sb').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; return; }
      $('sb').innerHTML = '<div class="panel" style="margin-top:12px"><h3 style="margin-top:0">' + esc(r.partner.name || '') + ' · ' + esc(r.from) + ' to ' + esc(r.to) + '</h3><div class="cards"><div class="stat"><b>' + t.orders + '</b>Orders</div><div class="stat"><b>' + money(t.gross) + '</b>Sales</div><div class="stat"><b>' + money(t.fee) + '</b>Azizo fee</div><div class="stat"><b>' + money(t.net) + '</b>Net to you</div></div><p class="kmeta" style="color:var(--mute)">' + esc(r.note) + (t.cancelled ? ' Cancelled orders (' + t.cancelled + ') are not counted.' : '') + '</p><div class="scroll"><table class="t"><thead><tr><th>Order</th><th>Date</th><th>Status</th><th>Total</th><th>Azizo fee</th><th>Net</th></tr></thead><tbody>' + (r.rows.map(function(o){ var x = o.status === 'cancelled'; return '<tr' + (x ? ' style="opacity:.5"' : '') + '><td>#' + o.id + '</td><td>' + esc(o.d) + '</td><td>' + esc(o.status) + '</td><td>' + money(o.total) + '</td><td>' + (x ? '-' : money(o.fee)) + '</td><td>' + (x ? '-' : money(o.total - o.fee)) + '</td></tr>'; }).join('') || '<tr><td colspan="6">No orders in this period.</td></tr>') + '</tbody></table></div></div>';
    };
    $('sg').onclick = show; $('sp').onclick = function(){ window.print(); };
    $('sc').onclick = async function(){ try{ var res = await fetch(K.base() + '/api/ops/partner/statement?format=csv&from=' + $('sf').value + '&to=' + $('st').value, { headers: { Authorization: 'Bearer ' + tok() } }); if(!res.ok) throw new Error('Could not download'); var b = await res.blob(), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'azizo-statement.csv'; document.body.appendChild(a); a.click(); a.remove(); }catch(e){ $('sb').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; } };
    show();
  }
  async function glTab(){
    var pane = $('pane'); try{ var g = await OPS.api('/partner/onboarding', {}, tok()); }catch(e){ pane.innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; return; }
    var done = g.checks.filter(function(c){ return c.ok; }).length;
    pane.innerHTML = '<div class="panel"><h3 style="margin-top:0">Go-live progress: ' + done + ' of ' + g.checks.length + ' steps</h3><p class="kmeta" style="color:var(--mute)">Azizo switches you on once every step below is done. Steps marked automatic update by themselves. For the others, speak to your Azizo onboarding officer.</p>' + g.checks.map(function(c){ return '<div class="chk"><span class="' + (c.ok ? 'ok' : 'no') + '" aria-hidden="true">' + (c.ok ? '✔' : '○') + '</span><label>' + esc(c.label) + '</label></div>'; }).join('') + '</div>';
  }
  function supTab(){ OPS.ticketPanel($('pane'), tok()); }
  // v5.3: ask the SOP handbook in plain words (appears only when the server has AI on)
  async function aiSop(){
    try{ var st = await K.apiAt('/api/ai', '/status', {}, ''); if(!st.enabled) return; }catch(e){ return; }
    $('aiSop').innerHTML = '<div class="panel" style="margin-bottom:12px"><h3 style="margin:0">Ask the handbook</h3><p class="kmeta" style="color:var(--mute)">Type a question, for example: how cold must the chiller be? The answer comes only from the SOP documents. AI can be wrong, so check the document.</p><input id="aiQ" maxlength="300" placeholder="Your question"><div id="aiA"></div><button class="btn gold" id="aiGo" style="margin-top:8px">Ask</button></div>';
    $('aiGo').onclick = async function(){ var a = $('aiA'); a.innerHTML = '<p>Thinking...</p>'; try{ var r = await OPS.aiApi('/partner/sop-help', { method: 'POST', body: JSON.stringify({ question: $('aiQ').value }) }, tok()); a.innerHTML = '<div class="msg" style="white-space:pre-wrap">' + esc(r.answer) + '</div>' + (r.sources && r.sources.length ? '<small>From: ' + r.sources.map(esc).join(', ') + '</small>' : ''); }catch(e){ a.innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; } };
  }
  function sopTab(){ $('pane').innerHTML = '<div id="aiSop"></div><div id="sopH"></div>'; aiSop(); OPS.sopPanel($('sopH'), tok(), 'Butchery').catch(function(e){ $('pane').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; }); }
  if(tok()) start(); else gate();
})();
