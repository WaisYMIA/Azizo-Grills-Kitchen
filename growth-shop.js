// v5.4 shop add-ons (loaded after app.js): one-tap reorder, standing orders, referral code, refund request.
(function(){
  'use strict';
  var $ = function(id){ return document.getElementById(id); };
  var on = function(){ try{ return typeof apiAvailable === 'function' && apiAvailable(); }catch(e){ return false; } };
  if(!on()) return;
  var esc = function(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var api = function(p, o){ return apiFetch('/growth' + p, o); };
  var cfg = null, DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var getCfg = async function(){ if(!cfg){ try{ cfg = await api('/config'); }catch(e){ cfg = { subscriptions: { on: false }, referral: { on: false }, refundHours: 24 }; } } return cfg; };

  // put an old order's items in the cart (only items still on the menu), then open the cart
  function toCart(items){
    var n = 0, miss = 0;
    (items || []).forEach(function(i){ var it = null; try{ it = findItem(String(i.id).split('::')[0]) || findItem(i.id); }catch(e){} if(!it || it.inStock === false){ miss++; return; } cart[i.id] = { item: it, qty: Number(i.qty) || 1, source: 'reorder' }; n++; });
    try{ updateCartUI(); refreshProductGrids(); }catch(e){}
    try{ showToast(n ? (n + ' item(s) added to your cart' + (miss ? ', ' + miss + ' no longer available' : '')) : 'Those items are not available right now'); }catch(e){}
    if(n){ try{ if(typeof closeAccountPanel === 'function') closeAccountPanel(); }catch(e){} try{ openCart(); }catch(e){} }
  }
  var nameOf = function(id){ try{ var it = findItem(String(id).split('::')[0]); return it ? it.name : id; }catch(e){ return id; } };

  // ---- order history: Order again / Make it a standing order ----
  async function decorateHistory(){
    var list = $('orderHistoryList'); if(!list) return; var c = await getCfg(), data;
    try{ data = await apiFetch('/orders/me/history'); }catch(e){ return; }
    var byId = {}; (data.orders || []).forEach(function(o){ byId[o.id] = o; });
    list.querySelectorAll('.order-history-item').forEach(function(card){
      var idEl = card.querySelector('.order-history-id'); if(!idEl) return; var o = byId[String(idEl.textContent).replace('#', '')]; if(!o || !o.items || !o.items.length || card.querySelector('.gr-actions')) return;
      var d = document.createElement('div'); d.className = 'gr-actions'; d.style.cssText = 'margin-top:8px;display:flex;gap:8px;flex-wrap:wrap';
      d.innerHTML = '<button type="button" class="reorder-btn" data-r="1">Order again</button>' + (c.subscriptions.on && o.status !== 'cancelled' ? '<button type="button" class="reorder-btn" data-s="1" style="background:transparent;border:1px solid #d4a63f;color:#d4a63f">Make it a standing order</button>' : '') + '<div class="gr-form" style="display:none;width:100%"></div>';
      card.appendChild(d);
      d.querySelector('[data-r]').onclick = function(){ toCart(o.items); };
      var sb = d.querySelector('[data-s]'); if(sb) sb.onclick = function(){ var f = d.querySelector('.gr-form'); if(f.style.display === 'block'){ f.style.display = 'none'; return; }
        f.style.display = 'block'; f.innerHTML = '<label style="font-size:.8rem">How often</label><select class="account-field" data-f>' + c.subscriptions.freqs.map(function(x){ return '<option value="' + x + '">' + x + '</option>'; }).join('') + '</select><label style="font-size:.8rem">Which day</label><select class="account-field" data-d>' + DAYS.map(function(x, i){ return '<option value="' + i + '"' + (i === 6 ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select><p class="account-note" style="font-size:.78rem">We remind you and you confirm each order with one tap. Nothing is charged or sent without you. Minimum about KSh ' + c.subscriptions.min + '.</p><button type="button" class="account-submit" data-go>Save standing order</button><div class="gr-msg account-note"></div>';
        f.querySelector('[data-go]').onclick = async function(){ var m = f.querySelector('.gr-msg'); try{ var r = await api('/subs', { method: 'POST', body: JSON.stringify({ items: o.items.map(function(i){ return { id: i.id, qty: i.qty }; }), freq: f.querySelector('[data-f]').value, weekday: Number(f.querySelector('[data-d]').value), fulfilment: o.fulfilment, branch: o.branch }) }); m.textContent = 'Saved. First reminder on ' + r.nextDate + '.'; renderExtras(); }catch(e){ m.textContent = e.message; } };
      };
    });
  }

  // ---- standing orders + referral card ----
  async function renderExtras(){
    var list = $('orderHistoryList'); if(!list) return; var c = await getCfg(), box = $('grExtras');
    if(!box){ box = document.createElement('div'); box.id = 'grExtras'; list.parentNode.insertBefore(box, list.nextSibling); }
    var html = '';
    if(c.subscriptions.on){ try{ var s = await api('/subs'); if(s.subs.length){ html += '<p class="account-sub" style="margin-top:14px">Your standing orders:</p>' + s.subs.map(function(x){ return '<div class="order-history-item" data-sub="' + x.id + '"><div class="order-history-top"><span class="order-history-id">' + esc(x.freq) + ' · ' + DAYS[x.weekday] + '</span><span class="order-history-status">' + (x.status === 'paused' ? 'Paused' : x.due ? 'Due now' : 'Next ' + esc(x.nextDate)) + '</span></div><div class="order-history-meta">' + x.items.map(function(i){ return esc(nameOf(i.id)) + ' x' + i.qty; }).join(', ') + '</div><div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">' + (x.status === 'active' ? '<button type="button" class="reorder-btn" data-a="order">' + (x.due ? 'Order now' : 'Order early') + '</button><button type="button" class="reorder-btn" data-a="skip">Skip once</button><button type="button" class="reorder-btn" data-a="pause">Pause</button>' : '<button type="button" class="reorder-btn" data-a="resume">Resume</button>') + '<button type="button" class="reorder-btn" data-a="cancel" style="background:transparent;border:1px solid #888;color:#aaa">Stop</button></div></div>'; }).join('');
        box.innerHTML = html + '<div id="grRef"></div>'; box.querySelectorAll('[data-sub]').forEach(function(el){ var id = el.dataset.sub, sub = s.subs.filter(function(q){ return String(q.id) === id; })[0]; el.querySelectorAll('[data-a]').forEach(function(b){ b.onclick = async function(){ var a = b.dataset.a; try{ if(a === 'order'){ await api('/subs/' + id, { method: 'PATCH', body: JSON.stringify({ action: 'advance' }) }); toCart(sub.items); } else { await api('/subs/' + id, { method: 'PATCH', body: JSON.stringify({ action: a }) }); } renderExtras(); }catch(e){ try{ showToast(e.message); }catch(x){} } }; }); });
        await renderRef(c); return; } }catch(e){} }
    box.innerHTML = '<div id="grRef"></div>'; await renderRef(c);
  }
  async function renderRef(c){
    var el = $('grRef'); if(!el || !c.referral.on) return; var r; try{ r = await api('/referral'); }catch(e){ return; }
    var msg = encodeURIComponent('Try Azizo Butchery & Grill in Nairobi. Use my code ' + r.code + ' at sign-up and we both get ' + r.friendPts + ' reward points after your first order. ' + location.origin + '/index.html');
    el.innerHTML = '<div class="order-history-item" style="margin-top:14px"><div class="order-history-top"><span class="order-history-id">Invite a friend</span><span class="order-history-status">' + esc(r.code) + '</span></div><div class="order-history-meta">You both get ' + r.friendPts + ' points after their first order of KSh ' + r.minOrder + '+. Friends invited: ' + r.friends + ', rewarded: ' + r.rewarded + '.</div><div style="margin-top:6px"><a class="reorder-btn" style="display:inline-block;text-decoration:none" target="_blank" rel="noopener" href="https://wa.me/?text=' + msg + '">Share on WhatsApp</a></div>' + (r.usedCode ? '' : '<div style="margin-top:8px"><input class="account-field" id="grCode" maxlength="12" placeholder="Got a friend\'s code?" style="text-transform:uppercase"><button type="button" class="account-submit" id="grApply">Apply code</button><div class="account-note" id="grApplyMsg"></div></div>') + '</div>';
    var ap = $('grApply'); if(ap) ap.onclick = async function(){ try{ var x = await api('/referral/apply', { method: 'POST', body: JSON.stringify({ code: $('grCode').value }) }); $('grApplyMsg').textContent = x.message; }catch(e){ $('grApplyMsg').textContent = e.message; } };
  }
  var oh = window.loadOrderHistory; if(typeof oh === 'function') window.loadOrderHistory = async function(){ var r = await oh.apply(this, arguments); try{ await decorateHistory(); await renderExtras(); }catch(e){} return r; };

  // ---- refund request on the tracking result ----
  var rt = window.renderTrackResult;
  if(typeof rt === 'function') window.renderTrackResult = function(data){
    var h = rt(data), o = data && data.order; if(!o || ['completed', 'out_for_delivery', 'ready'].indexOf(o.status) < 0) return h;
    return h + '<details class="gr-refund" style="margin-top:10px"><summary style="cursor:pointer">Something wrong with this order?</summary><div style="padding-top:8px"><input class="account-field" id="grRfPhone" type="tel" inputmode="numeric" placeholder="Phone number you ordered with"><select class="account-field" id="grRfWhy"><option value="late">It was late</option><option value="wrong_item">Wrong item</option><option value="missing_item">Item missing</option><option value="quality">Quality problem</option><option value="overcharged">Charged too much</option><option value="other">Something else</option></select><textarea class="account-field" id="grRfDet" rows="2" maxlength="500" placeholder="Tell us what happened"></textarea><button type="button" class="account-submit" onclick="grRefund(' + Number(o.id) + ')">Ask for a refund or replacement</button><div class="account-note" id="grRfMsg"></div><p class="account-note" style="font-size:.78rem">Tell us within 24 hours. We reply within one working day.</p></div></details>';
  };
  window.grRefund = async function(id){ var m = $('grRfMsg'); try{ var r = await api('/refund-request', { method: 'POST', body: JSON.stringify({ orderId: id, phone: $('grRfPhone').value, reason: $('grRfWhy').value, details: $('grRfDet').value }) }); m.textContent = r.message + ' Reference ' + r.ref + '.'; }catch(e){ m.textContent = e.message; } };
})();
