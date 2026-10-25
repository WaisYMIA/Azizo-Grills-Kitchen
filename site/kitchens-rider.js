/* Azizo Kitchens - rider page: phone + PIN login, pick up ready orders, deliver with the customer's 4-digit code. */
(function(){
  'use strict';
  var K = window.KK, $ = K.$, esc = K.esc, money = K.money, TK = 'kkRiderToken', app = $('app'), timer = null, name = '';
  K.header('rider'); K.footer();
  var tok = function(){ return sessionStorage.getItem(TK) || ''; };
  async function api(path, opts){ try{ return await K.api(path, opts, tok()); }catch(e){ if(e.status === 401){ logout(); throw new Error('Please log in again'); } throw e; } }
  function logout(){ sessionStorage.removeItem(TK); clearInterval(timer); gate(); }
  function gate(msg){
    app.innerHTML = '<div class="gate panel"><h2>Rider login</h2><p style="color:var(--mute)">For Azizo Kitchens delivery riders.</p>' + (K.base() ? '' : '<label class="f" for="gUrl">Server address</label><input id="gUrl" placeholder="https://your-backend" value="' + esc(K.get('azizoAdminBackendUrl')) + '">') +
      '<label class="f" for="gPh" style="margin-top:10px">Phone</label><input id="gPh" type="tel" autocomplete="username" value="' + esc(K.get('kkRiderPhone')) + '"><label class="f" for="gPin" style="margin-top:10px">PIN</label><input id="gPin" type="password" inputmode="numeric" autocomplete="current-password">' +
      '<div id="gErr" role="alert">' + (msg ? '<div class="msg err">' + esc(msg) + '</div>' : '') + '</div><button class="btn gold" id="gGo" style="width:100%;margin-top:10px">Log in</button></div>';
    var go = async function(){
      if($('gUrl')) K.set('azizoAdminBackendUrl', $('gUrl').value.trim().replace(/\/+$/, ''));
      $('gErr').innerHTML = ''; try{ var r = await K.api('/rider/login', { method:'POST', body: JSON.stringify({ phone: $('gPh').value, pin: $('gPin').value }) }); K.set('kkRiderPhone', $('gPh').value); sessionStorage.setItem(TK, r.token); name = r.name; start(); }
      catch(e){ $('gErr').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; }
    };
    $('gGo').onclick = go; $('gPin').onkeydown = function(e){ if(e.key === 'Enter') go(); };
  }
  function start(){ load(); clearInterval(timer); timer = setInterval(function(){ if(!document.hidden) load(true); }, 30000); }
  var STATUS = { accepted:'Being prepared', preparing:'Being cooked', ready:'Ready to collect', out_for_delivery:'On your delivery' };
  function map(lat, lng, label){ return (lat && lng) ? '<a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng + '">🧭 ' + label + '</a>' : ''; }
  async function load(quiet){
    if(quiet && document.querySelector('.modal.show')) return;
    var d; try{ d = await api('/rider/orders'); }catch(e){ if(!quiet) K.toast(e.message); return; }
    var mine = d.orders.filter(function(o){ return o.status === 'out_for_delivery'; }), ready = d.orders.filter(function(o){ return o.status === 'ready'; }), soon = d.orders.filter(function(o){ return o.status === 'accepted' || o.status === 'preparing'; });
    function card(o){
      var h = '<div class="panel" style="margin:12px 0"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>#' + o.id + ' · ' + esc(o.kitchen) + '</b><span class="pill">' + esc(STATUS[o.status] || o.status) + '</span></div><p class="kmeta">' + esc(o.date) + ' · ' + esc(o.meal) + '</p>' +
        '<p class="kmeta"><b>Pick up:</b> ' + esc(o.kitchenAddress || '') + (o.kitchenPhone ? ' · <a href="tel:' + esc(o.kitchenPhone) + '">' + esc(o.kitchenPhone) + '</a>' : '') + '</p><p class="kmeta"><b>Deliver to:</b> ' + esc(o.customer) + ', ' + esc(o.address) + ' · <a href="tel:' + esc(o.phone) + '">' + esc(o.phone) + '</a></p>' +
        '<p class="kmeta">' + o.items.map(esc).join(', ') + '</p>' + (o.notes ? '<p class="kmeta">📝 ' + esc(o.notes) + '</p>' : '') +
        '<div class="msg ' + (o.collect ? 'info' : 'ok') + '"><b>' + (o.collect ? 'Collect ' + money(o.collect) + ' (' + (o.payment === 'mpesa' ? 'M-Pesa' : 'cash') + ')' : 'Nothing to collect. Already paid or invoiced.') + '</b></div><div class="mini">' + map(o.kitchenLat, o.kitchenLng, 'To kitchen') + map(o.lat, o.lng, 'To customer');
      if(o.status === 'ready') h += '<button class="btn gold" data-pick="' + o.id + '">Picked up</button>';
      if(o.status === 'out_for_delivery') h += '<button class="btn gold" data-del="' + o.id + '">Delivered</button><button class="btn" data-rel="' + o.id + '">Can\'t deliver</button>';
      return h + '</div></div>';
    }
    app.innerHTML = '<div style="padding:18px 0 0;display:flex;justify-content:space-between;align-items:center"><div><div class="eyebrow">Rider</div><h2 style="margin:0">Hi ' + esc(name || 'rider') + '</h2></div><button class="btn sm" id="lo">Log out</button></div>' +
      '<h3>On your delivery (' + mine.length + ')</h3>' + (mine.map(card).join('') || '<p class="kmeta">Nothing on your bike right now.</p>') + '<h3>Ready to collect (' + ready.length + ')</h3>' + (ready.map(card).join('') || '<p class="kmeta">No orders ready yet.</p>') +
      '<h3>Coming soon (' + soon.length + ')</h3>' + (soon.map(card).join('') || '<p class="kmeta">Nothing in the kitchens.</p>') + '<div class="modal" id="mCode"><div class="sheet"><button class="x" data-close aria-label="Close">&times;</button><div id="codeBody"></div></div></div>';
    $('lo').onclick = logout;
    app.querySelectorAll('[data-pick]').forEach(function(b){ b.onclick = async function(){ b.disabled = true; try{ await api('/rider/orders/' + b.dataset.pick + '/pickup', { method:'POST', body:'{}' }); K.toast('Marked as picked up'); }catch(e){ K.toast(e.message); } load(); }; });
    app.querySelectorAll('[data-rel]').forEach(function(b){ b.onclick = async function(){ var why = prompt('Why can you not deliver? (the order goes back to ready)'); if(why === null) return; try{ await api('/rider/orders/' + b.dataset.rel + '/release', { method:'POST', body: JSON.stringify({ reason: why }) }); K.toast('Released'); }catch(e){ K.toast(e.message); } load(); }; });
    app.querySelectorAll('[data-del]').forEach(function(b){ b.onclick = function(){
      $('codeBody').innerHTML = '<h3>Enter the customer\'s code</h3><p class="kmeta">Ask the customer for the 4-digit delivery code from their order screen or message.</p><input id="dc" inputmode="numeric" maxlength="4" style="font:700 2rem \'IBM Plex Mono\';text-align:center;letter-spacing:.3em" aria-label="Delivery code"><div id="dErr" role="alert"></div><button class="btn gold" id="dGo" style="width:100%;margin-top:10px">Confirm delivery</button>';
      K.openModal('mCode'); $('dGo').onclick = async function(){ try{ await api('/rider/orders/' + b.dataset.del + '/deliver', { method:'POST', body: JSON.stringify({ code: $('dc').value }) }); K.closeModal('mCode'); K.toast('Delivered. Well done!'); load(); }catch(e){ $('dErr').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; } }; }; });
  }
  document.addEventListener('click', function(e){ if(e.target.matches('[data-close]') || e.target.classList.contains('modal')){ var m = e.target.closest('.modal') || e.target; if(m.id) K.closeModal(m.id); } });
  if(tok()) start(); else gate();
})();
