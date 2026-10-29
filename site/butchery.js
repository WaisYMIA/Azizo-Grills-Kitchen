(function(){
  'use strict';
  var K = window.KK, M = window.MK, $ = K.$, esc = K.esc, money = K.money, app = $('app'), slug = new URLSearchParams(location.search).get('b') || '';
  M.header('list'); M.footer();
  var P = null, items = [], cart = {}, areas = [], filter = '';
  var step = function(i){ return i.unit === 'kg' ? 0.25 : 1; };
  var snap = function(q, i){ var s = step(i); return Math.round(q / s) * s; };
  var line = function(i, q){ return Math.round(i.price * q); };
  var find = function(id){ return items.filter(function(i){ return i.id === id; })[0]; };
  var sub = function(){ return Object.keys(cart).reduce(function(s, id){ return s + line(find(id), cart[id]); }, 0); };
  function setQty(id, q){ var i = find(id); q = snap(Math.max(0, q), i); if(q <= 0) delete cart[id]; else cart[id] = q; draw(); }
  function dish(i){
    var q = cart[i.id] || 0, kg = i.unit === 'kg';
    return '<div class="dish"><div class="dimg">' + (i.img ? '<img src="' + esc(i.img) + '" alt="' + esc(i.name) + '" loading="lazy">' : '🥩') + '</div><div class="dbody"><h4>' + esc(i.name) + '</h4><p>' + esc(i.cat) + (i.swName ? ' · ' + esc(i.swName) : '') + '</p>' +
      (i.inStock ? '' : '<p style="color:#ff8a9c;font-weight:600">Out of stock</p>') +
      '<div class="dfoot"><span class="price">' + money(i.price) + '<small style="font:400 .75rem Inter;color:var(--mute)"> / ' + esc(i.unit) + '</small></span>' +
      (i.inStock ? (q ? '<span class="qty"><button data-m="' + esc(i.id) + '" aria-label="Less">−</button><b>' + M.fmtQty(q, i.unit) + (kg ? ' kg' : '') + '</b><button data-p="' + esc(i.id) + '" aria-label="More">+</button></span>' : '<button class="btn sm gold" data-a="' + esc(i.id) + '">Add' + (kg ? ' 1 kg' : '') + '</button>') : '<button class="btn sm" disabled>Out of stock</button>') + '</div>' +
      (q && kg ? '<div class="chips" style="margin:6px 0 0">' + [0.25, 0.5, 0.75, 1, 2].map(function(v){ return '<button class="chip tg' + (q === v ? ' on' : '') + '" data-q="' + esc(i.id) + '|' + v + '">' + M.fmtQty(v, 'kg') + '</button>'; }).join('') + '</div>' : '') + '</div></div>';
  }
  function draw(){
    var groups = {}, shown = items.filter(function(i){ return !filter || (i.name + ' ' + i.cat + ' ' + i.swName).toLowerCase().indexOf(filter) >= 0; });
    shown.forEach(function(i){ (groups[i.cat] = groups[i.cat] || []).push(i); });
    var gh = Object.keys(groups).map(function(c){ return '<h3 style="margin:18px 0 8px">' + esc(c) + '</h3><div class="dgrid">' + groups[c].map(dish).join('') + '</div>'; }).join('') || '<div class="empty">Nothing matches that search.</div>';
    $('menu').innerHTML = gh;
    var n = Object.keys(cart).length, b = $('bar'); if(n){ $('barTxt').textContent = n + (n === 1 ? ' item' : ' items') + ' · ' + money(sub()); b.classList.add('show'); } else b.classList.remove('show');
    $('menu').querySelectorAll('[data-a]').forEach(function(b){ b.onclick = function(){ setQty(b.dataset.a, 1); }; });
    $('menu').querySelectorAll('[data-m]').forEach(function(b){ b.onclick = function(){ setQty(b.dataset.m, cart[b.dataset.m] - step(find(b.dataset.m))); }; });
    $('menu').querySelectorAll('[data-p]').forEach(function(b){ b.onclick = function(){ setQty(b.dataset.p, cart[b.dataset.p] + step(find(b.dataset.p))); }; });
    $('menu').querySelectorAll('[data-q]').forEach(function(b){ b.onclick = function(){ var a = b.dataset.q.split('|'); setQty(a[0], Number(a[1])); }; });
  }
  function checkout(){
    var fee = P.deliveryFee, s = sub(); if(s < P.minOrder){ K.toast('Minimum order is ' + money(P.minOrder)); return; }
    var m = $('co'); m.innerHTML = '<div class="sheet"><button class="x" aria-label="Close" onclick="KK.closeModal(\'co\')">&times;</button><h3>Your order from ' + esc(P.name) + '</h3>' +
      Object.keys(cart).map(function(id){ var i = find(id); return '<div class="line" style="display:flex;justify-content:space-between;padding:4px 0"><span>' + M.fmtQty(cart[id], i.unit) + (i.unit === 'kg' ? ' kg' : ' ×') + ' ' + esc(i.name) + '</span><span>' + money(line(i, cart[id])) + '</span></div>'; }).join('') +
      '<div class="row" style="margin-top:10px"><div><label class="f" for="cn">Your name</label><input id="cn"></div><div><label class="f" for="cp">Phone</label><input id="cp" type="tel" autocomplete="tel"></div></div>' +
      '<div class="chips"><button class="chip on" id="fd" type="button">Delivery ' + money(fee) + '</button><button class="chip" id="fp" type="button">Pick up</button></div>' +
      '<div id="addr"><label class="f" for="ca" style="margin-top:10px">Delivery address</label><input id="ca" placeholder="Estate, building, house, landmark"></div>' +
      '<label class="f" for="cm" style="margin-top:10px">Notes (cut, bones, etc.)</label><textarea id="cm"></textarea>' +
      '<label class="f" for="pm" style="margin-top:10px">How will you pay?</label><select id="pm"><option value="cash">Cash on delivery or pickup</option><option value="partner_pay">Pay to the butchery\'s ' + esc(P.payMethod || 'till') + ' (details sent on confirmation)</option></select>' +
      '<p class="tot" id="ctot" style="font-size:1.2rem;margin:12px 0 4px"></p><p class="kmeta" style="color:var(--mute);font-size:.82rem">You pay the butchery directly. Final price follows the weighed amount.</p><div id="cerr"></div><button class="btn gold" id="go" style="width:100%">Place order</button></div>';
    var del = true, tot = function(){ $('ctot').textContent = 'Total ' + money(s + (del ? fee : 0)); $('addr').style.display = del ? '' : 'none'; $('fd').className = 'chip' + (del ? ' on' : ''); $('fp').className = 'chip' + (del ? '' : ' on'); };
    $('fd').onclick = function(){ del = true; tot(); }; $('fp').onclick = function(){ del = false; tot(); }; tot(); K.openModal('co');
    $('cn').value = K.get('mkName'); $('cp').value = K.get('mkPhone');
    $('go').onclick = async function(){
      var name = $('cn').value.trim(), ph = $('cp').value.trim(), ad = $('ca').value.trim(); $('cerr').innerHTML = '';
      if(name.length < 2 || ph.replace(/\D/g, '').length < 9) { $('cerr').innerHTML = '<div class="msg err">Enter your name and phone number</div>'; return; }
      if(del && ad.length < 4){ $('cerr').innerHTML = '<div class="msg err">Enter your delivery address</div>'; return; }
      K.set('mkName', name); K.set('mkPhone', ph); $('go').disabled = true;
      try{
        var r = await M.root('/api/orders', { method: 'POST', body: M.json({ partnerId: P.id, customer_name: name, customer_phone: ph, fulfilment: del ? 'delivery' : 'pickup', delivery_address: del ? ad : null, notes: $('cm').value.slice(0, 250), payment_method: $('pm').value, total: s + (del ? fee : 0), items_subtotal: s, delivery_fee: del ? fee : 0,
          items: Object.keys(cart).map(function(id){ return { id: id, qty: cart[id], name: find(id).name, price: find(id).price, unit: find(id).unit }; }) }) });
        cart = {}; m.innerHTML = '<div class="sheet"><h3>Order received</h3><p>Your order number is <b>#' + r.orderId + '</b>. ' + esc(P.name) + ' will confirm it with you shortly.</p><p><a class="btn gold" href="butcheries.html">Back to butcheries</a></p></div>'; draw();
      }catch(e){ $('cerr').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; $('go').disabled = false; }
    };
  }
  (async function(){
    var st = await M.status(); if(!st.on){ app.innerHTML = M.closed(st); return; }
    try{ var r = await M.api('/partners/' + encodeURIComponent(slug)); P = r.partner; items = r.items; }catch(e){ app.innerHTML = '<div class="empty"><h2>This butchery is not available right now</h2><p>' + esc(e.message) + '</p><p><a class="btn gold" href="butcheries.html">See other butcheries</a></p></div>'; return; }
    document.title = P.name + ' | Azizo Butchery and Grill';
    var ps = P.stats;
    app.innerHTML = '<div class="eyebrow">' + esc(M.TIER[P.tier] || '') + ' · Azizo Butchery and Grill network</div><h1 style="margin:4px 0">' + esc(P.name) + '</h1><p class="kmeta" style="color:var(--mute)">' + esc(P.address || P.region) + ' · Delivery ' + money(P.deliveryFee) + ' · Minimum order ' + money(P.minOrder) + '</p>' +
      '<p>' + M.score(P) + (P.halal ? ' <span class="kbadge">Halal</span>' : '') + (P.licenceVerified ? ' <span class="kbadge">Licence verified</span>' : '') + (P.lastInspection ? ' <span class="kbadge">Last inspection ' + esc(P.lastInspection) + '</span>' : '') + '</p>' +
      (P.story ? '<div class="panel"><h3 style="margin-top:0">Meet your butcher</h3><p>' + esc(P.story) + '</p></div>' : '') +
      (ps.orders ? '<p class="kmeta" style="color:var(--mute)">' + ps.orders + ' orders delivered' + (ps.completionPct != null ? ' · ' + ps.completionPct + '% completed' : '') + '</p>' : '') +
      '<input id="q" type="search" placeholder="Search this butchery" style="margin:10px 0" aria-label="Search this butchery"><div id="menu"></div><div style="height:90px"></div><div class="bar" id="bar"><b id="barTxt"></b><button class="btn" id="barBtn">View order</button></div><div class="modal" id="co"></div>';
    $('q').oninput = function(){ filter = this.value.trim().toLowerCase(); draw(); }; $('barBtn').onclick = checkout; draw();
  })();
})();
