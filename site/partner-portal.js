(function(){
  'use strict';
  var K = window.KK, M = window.MK, $ = K.$, esc = K.esc, money = K.money, TK = 'mkPartnerToken', app = $('app'), me = null, tab = 'orders', timer = null;
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
    var T = [['orders', 'Orders'], ['items', 'My items'], ['inv', 'Invoices'], ['profile', 'Profile']];
    $('side').innerHTML = T.map(function(t){ return '<button data-t="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '<button id="lo">Log out</button>';
    $('side').querySelectorAll('[data-t]').forEach(function(b){ b.onclick = function(){ tab = b.dataset.t; draw(); }; }); $('lo').onclick = logout;
    ({ orders: ordersTab, items: itemsTab, inv: invTab, profile: profileTab })[tab]();
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
        (o.notes ? '<p class="kmeta" style="color:var(--mute)">' + esc(o.notes) + '</p>' : '') + (closed ? '' : '<div style="margin-top:8px">' + (nx ? '<button class="btn sm gold" data-s="' + o.id + '|' + nx[0] + '">' + nx[1] + '</button> ' : '') + '<button class="btn sm ghost" data-s="' + o.id + '|cancelled">Cancel</button></div>') + '</div>'; }).join('') : '<div class="empty">No orders yet.</div>';
    pane.querySelectorAll('[data-s]').forEach(function(b){ b.onclick = async function(){ var a = b.dataset.s.split('|'); if(a[1] === 'cancelled' && !confirm('Cancel this order?')) return; try{ await api('/partner/orders/' + a[0] + '/status', { method: 'PATCH', body: M.json({ status: a[1] }) }); ordersTab(); }catch(e){ K.toast(e.message); } }; });
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
  if(tok()) start(); else gate();
})();
