(function(){
  'use strict';
  var K = window.KK, $ = K.$, esc = K.esc, money = K.money, t = K.t;
  var CFG = null, AREAS = [], state = { area: K.get('azizoArea'), lat: null, lng: null, date: '', meal: '', trad: '', q: '', tags: {} }, DATA = null, cart = { kitchen: null, items: [] }, openK = null, pending = null;
  var chk = { promo: null, corp: null, free: false }; // checked promo {code,discount}, company {code,name,pct}, loyalty-free-delivery flag
  var EMOJI = { 'Combo':'🍛','Plate':'🍽️','Family Pack':'🥘','Side':'🥬' };
  var TAGNAME = { vegetarian:'Vegetarian', spicy:'Spicy', fish:'Fish', vegan:'Vegan', 'gluten-free':'Gluten-free', halal:'Halal', 'no-pork':'No pork' };
  var params = new URLSearchParams(location.search);
  K.header('order'); K.footer();
  var openM = function(id){ K.openModal(id); }, closeM = function(id){ K.closeModal(id); };
  document.addEventListener('click', function(e){ if(e.target.matches('[data-close]') || e.target.classList.contains('modal')){ var m = e.target.closest('.modal') || e.target; if(m.id) closeM(m.id); } });
  function say(msg, kind){ var s = $('status'); if(!msg){ s.style.display = 'none'; return; } s.className = 'msg ' + (kind || 'info'); s.textContent = msg; s.style.display = ''; }
  function mealOfDay(){ var n = CFG.now.min; return n < 630 ? 'lunch' : (n < 990 ? 'dinner' : 'lunch'); }
  function addDays(d, n){ var x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  function dayName(d, i){ return i === 0 ? t('Today') : i === 1 ? t('Tomorrow') : new Date(d + 'T00:00:00Z').toLocaleDateString(K.lang === 'sw' ? 'sw-KE' : 'en-KE', {weekday:'short', day:'numeric', month:'short', timeZone:'UTC'}); }
  function jget(k, d){ try{ return JSON.parse(K.get(k) || 'null') || d; }catch(e){ return d; } }

  async function init(){
    K.onLang = function(){ if(!CFG) return; drawChips(); drawKitchens(); };
    if(!K.base() && location.protocol === 'file:'){ say('Ordering needs the Azizo server. Ask us on WhatsApp, or open this page from the live site.', 'err'); return; }
    try{
      var r = await Promise.all([K.api('/config'), K.api('/areas')]); CFG = r[0]; AREAS = r[1].areas;
    }catch(e){
      say(e.message + ' You can still order on WhatsApp: 0724 888 057.', 'err');
      var sa = await K.staticAreas(); if(sa.length){ AREAS = sa; $('area').innerHTML = K.areaOptions(sa, ''); $('area').disabled = false; }
      return;
    }
    var wantArea = params.get('area') || window.KK_AREA; if(wantArea && AREAS.some(function(a){ return a.id === wantArea; })) state.area = wantArea;
    $('area').innerHTML = K.areaOptions(AREAS, state.area); if(!AREAS.some(function(a){ return a.id === state.area; })) state.area = '';
    state.date = CFG.now.date; state.meal = mealOfDay();
    var cutoff = CFG[state.meal].cutoff.split(':'); if(state.date === CFG.now.date && CFG.now.min >= (+cutoff[0]) * 60 + (+cutoff[1])){ state.date = addDays(CFG.now.date, 1); state.meal = 'lunch'; }
    drawChips(); $('area').onchange = function(){ state.area = this.value; state.lat = state.lng = null; K.set('azizoArea', state.area); search(); };
    $('gpsBtn').onclick = async function(){ try{ var p = await K.gps(); state.lat = p.lat; state.lng = p.lng; state.area = ''; $('area').value = ''; K.toast('Location found'); search(); }catch(e){ K.toast(e.message); } };
    $('search').oninput = function(){ state.q = this.value.trim().toLowerCase(); drawKitchens(); };
    $('trackBtn').onclick = function(){ openTrack(); }; $('barBtn').onclick = openCart;
    K.applyLang();
    await search();
    if(params.get('track')) openTrack(params.get('track'), params.get('phone') || '');
  }
  function drawChips(){
    $('dates').innerHTML = [0, 1, 2].map(function(i){ var d = addDays(CFG.now.date, i); return '<button class="chip' + (state.date === d ? ' on' : '') + '" data-d="' + d + '" aria-pressed="' + (state.date === d) + '">' + dayName(d, i) + '</button>'; }).join('');
    $('meals').innerHTML = ['lunch', 'dinner'].map(function(m){ return '<button class="chip' + (state.meal === m ? ' on' : '') + '" data-m="' + m + '" aria-pressed="' + (state.meal === m) + '">' + (m === 'lunch' ? '☀️ ' : '🌙 ') + t(m === 'lunch' ? 'Lunch' : 'Dinner') + '<small>' + CFG[m].from + '–' + CFG[m].to + '</small></button>'; }).join('');
    $('dates').querySelectorAll('button').forEach(function(b){ b.onclick = function(){ state.date = b.dataset.d; drawChips(); search(); }; });
    $('meals').querySelectorAll('button').forEach(function(b){ b.onclick = function(){ state.meal = b.dataset.m; drawChips(); drawKitchens(); }; });
    $('slotNote').textContent = CFG[state.meal].label + ' is delivered ' + CFG[state.meal].from + ' to ' + CFG[state.meal].to + '. Order before ' + CFG[state.meal].cutoff + ' on the day.';
  }
  async function search(){
    drawChips(); DATA = null; $('again').innerHTML = '';
    if(!state.area && state.lat == null){ $('kitchens').innerHTML = '<div class="empty">Choose your area (or tap “Use my location”) to see kitchens that deliver to you.</div>'; $('trads').innerHTML = ''; $('tagchips').innerHTML = ''; say(''); return; }
    $('kitchens').innerHTML = '<div class="empty">Finding kitchens near you…</div>';
    try{
      var q = '/search?date=' + state.date + (state.area ? '&area=' + encodeURIComponent(state.area) : '&lat=' + state.lat + '&lng=' + state.lng);
      DATA = await K.api(q);
    }catch(e){ $('kitchens').innerHTML = ''; say(e.message, 'err'); return; }
    say(''); if(cart.kitchen && !DATA.kitchens.some(function(k){ return k.id === cart.kitchen; })){ cart = { kitchen: null, items: [] }; updateBar(); }
    var want = params.get('k'); if(want){ var hit = DATA.kitchens.filter(function(k){ return k.slug === want || String(k.id) === want; })[0]; if(hit){ openK = hit.id; params.delete('k'); } }
    drawKitchens(); drawAgain();
    if(openK){ var el = document.querySelector('.kcard[data-k="' + openK + '"]'); if(el && el.scrollIntoView) el.scrollIntoView({block:'start'}); }
  }
  function dishMatches(d){
    if(d.meal !== 'both' && d.meal !== state.meal) return false;
    if(state.trad && d.tradition !== state.trad) return false;
    for(var g in state.tags){ if(state.tags[g] && (d.tags || []).indexOf(g) < 0) return false; }
    if(state.q && (d.name + ' ' + d.description + ' ' + d.tradition).toLowerCase().indexOf(state.q) < 0) return false;
    return true;
  }
  function drawKitchens(){
    if(!DATA) return; var el = $('kitchens');
    var trads = {}, tg = {}; DATA.kitchens.forEach(function(k){ k.menu.forEach(function(d){ if(d.meal === 'both' || d.meal === state.meal){ if(d.tradition) trads[d.tradition] = 1; (d.tags || []).forEach(function(x){ tg[x] = 1; }); } }); });
    $('trads').innerHTML = Object.keys(trads).length ? '<button class="chip' + (!state.trad ? ' on' : '') + '" data-t="">' + t('All cuisines') + '</button>' + Object.keys(trads).sort().map(function(x){ return '<button class="chip' + (state.trad === x ? ' on' : '') + '" data-t="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') : '';
    $('trads').querySelectorAll('button').forEach(function(b){ b.onclick = function(){ state.trad = b.dataset.t; drawKitchens(); }; });
    $('tagchips').innerHTML = Object.keys(tg).sort().map(function(x){ return '<button class="chip tg' + (state.tags[x] ? ' on' : '') + '" data-g="' + esc(x) + '" aria-pressed="' + !!state.tags[x] + '">' + esc(t(TAGNAME[x] || x)) + '</button>'; }).join('');
    $('tagchips').querySelectorAll('button').forEach(function(b){ b.onclick = function(){ state.tags[b.dataset.g] = !state.tags[b.dataset.g]; drawKitchens(); }; });
    if(!DATA.kitchens.length){
      el.innerHTML = '<div class="panel empty"><h3>No kitchens in your area yet</h3><p>We are opening new estates one by one. Know a great home cook? <a href="kitchen-partners.html">Invite them to join</a>, or order fresh meat from <a href="fresh-market.html">Azizo Butchery</a> meanwhile.</p></div>';
      return;
    }
    var list = DATA.kitchens.map(function(k){ return { k: k, menu: k.menu.filter(dishMatches) }; }).filter(function(x){ return x.menu.length; });
    if(!list.length){ el.innerHTML = '<div class="empty">Nothing matches that for ' + esc(CFG[state.meal].label.toLowerCase()) + '. Try another meal, cuisine, diet filter or search.</div>'; ld([]); return; }
    el.innerHTML = list.map(function(x){
      var k = x.k, sl = k.slots[state.meal], ok = sl.open && sl.left > 0, isOpen = openK === k.id || list.length === 1;
      var badge = !sl.open ? '<span class="kbadge warn">' + esc(sl.why) + '</span>' : sl.left <= 0 ? '<span class="kbadge warn">Fully booked</span>' : '<span class="kbadge">' + sl.left + ' orders left</span>';
      return '<article class="kcard' + (isOpen ? ' open' : '') + '" data-k="' + k.id + '"><div class="khead" role="button" tabindex="0" aria-expanded="' + isOpen + '"><div class="kava">' + esc((k.name || '?').charAt(0)) + '</div><div><h3>' + esc(k.name) + '</h3>' +
        '<div class="kmeta">Cooked by <b>' + esc(k.cook) + '</b> · ' + (k.distanceKm < 1 ? 'under 1 km' : k.distanceKm + ' km') + ' away · delivery <b>' + money(k.fee) + '</b>' + (k.ratingCount ? ' · <span class="star">★</span> ' + k.rating + ' (' + k.ratingCount + ')' : ' · New kitchen') + '</div>' +
        (k.specialities ? '<div class="kmeta">' + esc(k.specialities) + '</div>' : '') + '</div><div>' + badge + '</div></div>' +
        '<div class="kmenu">' + (k.bio ? '<p class="kmeta" style="margin-top:0">' + esc(k.bio) + '</p>' : '') + '<div class="dgrid">' + x.menu.map(function(d){ return dishCard(k, d, ok); }).join('') + '</div></div></article>';
    }).join('');
    el.querySelectorAll('.khead').forEach(function(h){ var go = function(){ var id = +h.parentNode.dataset.k; openK = openK === id ? null : id; drawKitchens(); var again = document.querySelector('.kcard[data-k="' + id + '"] .khead'); if(again) again.focus(); }; h.onclick = go; h.onkeydown = function(e){ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); go(); } }; });
    el.querySelectorAll('[data-add]').forEach(function(b){ b.onclick = function(){ var p = b.dataset.add.split(':'); var k = DATA.kitchens.filter(function(z){ return z.id === +p[0]; })[0]; var d = k.menu.filter(function(z){ return z.id === +p[1]; })[0]; startAdd(k, d); }; });
    ld(list);
  }
  // structured data for search engines, built from what is on screen
  function ld(list){
    var s = $('kkLd'); if(!s){ s = document.createElement('script'); s.type = 'application/ld+json'; s.id = 'kkLd'; document.head.appendChild(s); }
    s.textContent = JSON.stringify({ '@context':'https://schema.org', '@graph': list.map(function(x){ var k = x.k;
      return { '@type':'Restaurant', name:k.name, description:k.bio || k.specialities || 'Homemade Kenyan food', servesCuisine:'Kenyan', areaServed:(DATA.area && DATA.area.name) || 'Nairobi', url:location.origin + location.pathname + '?k=' + encodeURIComponent(k.slug || k.id),
        aggregateRating: k.ratingCount ? { '@type':'AggregateRating', ratingValue:k.rating, reviewCount:k.ratingCount } : undefined,
        hasMenu:{ '@type':'Menu', hasMenuItem: x.menu.map(function(d){ return { '@type':'MenuItem', name:d.name, description:d.description, offers:{ '@type':'Offer', price:d.price, priceCurrency:'KES' } }; }) } }; }) }).replace(/</g, '\\u003c');
  }
  function dishCard(k, d, ok){
    var src = d.image ? (d.image.charAt(0) === '/' ? K.base() + d.image : d.image) : '';
    var tags = (d.tags || []).map(function(x){ return '<span class="tag ' + (x === 'spicy' ? 'hot' : 'diet') + '">' + esc(t(TAGNAME[x] || x)) + '</span>'; }).join('');
    return '<div class="dish"><div class="dimg">' + (src ? K.lazyImg(src, d.name) : '<span aria-hidden="true">' + (EMOJI[d.category] || '🍲') + '</span>') + '</div><div class="dbody"><div class="tags"><span class="tag">' + esc(d.tradition || d.category) + '</span>' + (d.serves > 1 ? '<span class="tag">Serves ' + d.serves + '</span>' : '') + tags + '</div><h4>' + esc(d.name) + '</h4><p>' + esc(d.description) + '</p>' +
      '<div class="dfoot"><span class="price">' + money(d.price) + '</span><button class="btn sm gold" data-add="' + k.id + ':' + d.id + '"' + (ok ? '' : ' disabled') + ' aria-label="' + esc(t('Add') + ' ' + d.name) + '">' + t('Add') + '</button></div></div></div>';
  }
  // ----- order again -----
  function drawAgain(){
    var last = jget('kkLastItems', null), el = $('again'); if(!last || !DATA) return;
    var k = DATA.kitchens.filter(function(z){ return z.id === last.kitchenId; })[0]; if(!k) return;
    var ok = last.items.every(function(i){ return k.menu.some(function(d){ return d.id === i.dishId && (d.meal === 'both' || d.meal === state.meal); }); }); if(!ok){ return; }
    el.innerHTML = '<div class="panel again" style="display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap"><span>🔁 Last time you ordered from <b>' + esc(k.name) + '</b> (' + last.items.length + (last.items.length === 1 ? ' dish' : ' dishes') + ').</span><button class="btn gold" id="againBtn" type="button">' + t('Order again') + '</button></div>';
    $('againBtn').onclick = function(){
      cart = { kitchen: k.id, items: [] }; last.items.forEach(function(i){ var d = k.menu.filter(function(z){ return z.id === i.dishId; })[0]; if(d) commit(k, d, i.options || {}, i.qty, true); }); updateBar(); openCart();
    };
  }
  // ----- basket -----
  function startAdd(k, d){
    if(cart.kitchen && cart.kitchen !== k.id && cart.items.length){ if(!confirm('Your basket has food from another kitchen. Start a new basket with ' + k.name + '?')) return; cart = { kitchen: null, items: [] }; }
    if(!d.options || !d.options.length){ commit(k, d, {}, 1); return; }
    pending = { k: k, d: d }; var h = '<h3>' + esc(d.name) + '</h3><p class="kmeta">' + esc(d.description) + '</p>';
    d.options.forEach(function(g, gi){ h += '<fieldset style="border:0;padding:0;margin:0"><legend style="margin-top:12px;font-weight:700">' + esc(g.name) + (g.required ? ' <small style="color:var(--red2)">required</small>' : ' <small style="color:var(--mute)">optional</small>') + '</legend>';
      g.choices.forEach(function(c, ci){ h += '<label class="opt"><input type="radio" name="g' + gi + '" value="' + esc(c.name) + '"' + (g.required && ci === 0 ? ' checked' : '') + '><span>' + esc(c.name) + '</span>' + (c.price ? '<em>+' + money(c.price) + '</em>' : '') + '</label>'; }); h += '</fieldset>'; });
    h += '<div id="optErr" role="alert"></div><button class="btn gold" id="optAdd" style="width:100%;margin-top:12px">Add to basket</button>'; $('optBody').innerHTML = h; openM('mOpt');
    $('optAdd').onclick = function(){
      var sel = {}; var miss = '';
      d.options.forEach(function(g, gi){ var c = document.querySelector('input[name=g' + gi + ']:checked'); if(c) sel[g.name] = c.value; else if(g.required) miss = g.name; });
      if(miss){ $('optErr').innerHTML = '<div class="msg err">Please choose ' + esc(miss.toLowerCase()) + '.</div>'; return; }
      commit(k, d, sel, 1); closeM('mOpt');
    };
  }
  function unitPrice(d, sel){ var p = d.price; (d.options || []).forEach(function(g){ var c = g.choices.filter(function(x){ return x.name === sel[g.name]; })[0]; if(c) p += c.price || 0; }); return p; }
  function commit(k, d, sel, qty, quiet){
    cart.kitchen = k.id; var key = d.id + JSON.stringify(sel), ex = cart.items.filter(function(i){ return i.key === key; })[0];
    if(ex) ex.qty += qty; else cart.items.push({ key: key, d: d, sel: sel, qty: qty, unit: unitPrice(d, sel) }); if(!quiet) K.toast(d.name + ' added'); updateBar();
  }
  function sub(){ return cart.items.reduce(function(s, i){ return s + i.unit * i.qty; }, 0); }
  function curK(){ return DATA && DATA.kitchens.filter(function(k){ return k.id === cart.kitchen; })[0]; }
  function updateBar(){
    var n = cart.items.reduce(function(s, i){ return s + i.qty; }, 0), b = $('bar'); if(!n){ b.classList.remove('show'); return; }
    var k = curK(); $('barTxt').textContent = n + (n === 1 ? ' item' : ' items') + ' · ' + money(sub()); $('barSub').textContent = k ? 'from ' + k.name : ''; b.classList.add('show');
  }
  function discountNow(k){
    var s = sub(), fee = k.fee, d = chk.corp ? Math.round(s * chk.corp.pct / 100) : 0, label = [];
    if(chk.corp && d) label.push(chk.corp.name + ' (' + chk.corp.pct + '%)');
    if(chk.promo){ d += chk.promo.discount; label.push('Code ' + chk.promo.code); }
    else if(chk.free){ d += fee; label.push('Loyalty reward: free delivery'); }
    return { amount: Math.min(d, s + fee), label: label.join(' + ') };
  }
  function drawTotals(){
    var k = curK(); if(!k || !$('tots')) return; var s = sub(), fee = k.fee, dc = discountNow(k), total = s + fee - dc.amount, sl = k.slots[state.meal];
    $('tots').innerHTML = '<div class="line"><span>' + t('Food') + '</span><span>' + money(s) + '</span></div><div class="line"><span>' + t('Delivery') + ' (' + k.distanceKm + ' km)</span><span>' + money(fee) + '</span></div>' +
      (dc.amount ? '<div class="line" style="color:var(--ok)"><span>' + esc(dc.label) + '</span><span>−' + money(dc.amount) + '</span></div>' : '') + '<div class="tot"><span>' + t('Total') + '</span><span id="grand">' + money(total) + '</span></div>';
    var go = $('cGo'); if(go){ go.textContent = t('Place order') + ' · ' + money(total); go.disabled = (s < k.minOrder || !sl.open || sl.left <= 0); }
    var inv = $('payInv'); if(inv) inv.style.display = chk.corp ? '' : 'none';
  }
  function upsells(k){
    var inCart = {}; cart.items.forEach(function(i){ inCart[i.d.id] = 1; });
    return k.menu.filter(function(d){ return d.category === 'Side' && !inCart[d.id] && (d.meal === 'both' || d.meal === state.meal) && !(d.options || []).some(function(g){ return g.required; }); }).slice(0, 3);
  }
  function openCart(){
    var k = curK(); if(!k || !cart.items.length) return; var sl = k.slots[state.meal];
    var h = '<h3>' + t('Your basket') + '</h3><p class="kmeta">' + esc(k.name) + ' · ' + esc(CFG[state.meal].label) + ' ' + esc(dayName(state.date, [0, 1, 2].filter(function(i){ return addDays(CFG.now.date, i) === state.date; })[0] || 0)) + ' · ' + CFG[state.meal].from + '–' + CFG[state.meal].to + '</p>';
    cart.items.forEach(function(i, ix){ h += '<div class="line"><div>' + esc(i.d.name) + '<small>' + esc(Object.keys(i.sel).map(function(g){ return i.sel[g]; }).join(', ')) + '</small></div><div style="text-align:right"><span class="qty"><button data-q="' + ix + ':-1" aria-label="Less ' + esc(i.d.name) + '">−</button>' + i.qty + '<button data-q="' + ix + ':1" aria-label="More ' + esc(i.d.name) + '">+</button></span><div>' + money(i.unit * i.qty) + '</div></div></div>'; });
    var up = upsells(k); if(up.length) h += '<div class="ups"><h4>' + t('Add a side?') + '</h4>' + up.map(function(d){ return '<button class="btn sm" data-up="' + d.id + '" type="button">+ ' + esc(d.name) + ' ' + money(d.price) + '</button>'; }).join('') + '</div>';
    h += '<div id="tots"></div>';
    if(sub() < k.minOrder) h += '<div class="msg err">Minimum order is ' + money(k.minOrder) + ' of food. Add ' + money(k.minOrder - sub()) + ' more.</div>';
    var addrs = jget('kkAddrs', []);
    h += '<div class="row"><div><label class="f" for="cName">' + t('Your name') + '</label><input id="cName" autocomplete="name" value="' + esc(K.get('kkName')) + '"></div><div><label class="f" for="cPhone">' + t('Phone') + '</label><input id="cPhone" type="tel" autocomplete="tel" placeholder="07XX XXX XXX" value="' + esc(K.get('kkPhone')) + '"></div></div><div id="loy" class="loy" aria-live="polite"></div>' +
      '<label class="f" for="cAddr" style="margin-top:10px">' + t('Delivery address (building, house, landmark)') + '</label><input id="cAddr" autocomplete="street-address" value="' + esc(addrs[0] || '') + '">' +
      (addrs.length > 1 ? '<div class="chips" style="margin-top:6px">' + addrs.map(function(a, ai){ return '<button type="button" class="chip tg" data-addr="' + ai + '">' + esc(a.length > 28 ? a.slice(0, 28) + '…' : a) + '</button>'; }).join('') + '</div>' : '') +
      '<label class="f" for="cNote" style="margin-top:10px">' + t('Notes for the kitchen (optional)') + '</label><textarea id="cNote" placeholder="e.g. less pepper, call when you arrive"></textarea>' +
      '<div class="mini" style="margin-top:10px"><div style="flex:1"><label class="f" for="cPromo">' + t('Promo code') + '</label><div class="mini"><input id="cPromo" autocapitalize="characters" value="' + esc(chk.promo ? chk.promo.code : '') + '"><button class="btn sm" id="promoGo" type="button">' + t('Apply') + '</button></div></div>' +
      '<div style="flex:1"><label class="f" for="cCorp">' + t('Company code') + '</label><div class="mini"><input id="cCorp" autocapitalize="characters" value="' + esc(chk.corp ? chk.corp.code : '') + '"><button class="btn sm" id="corpGo" type="button">' + t('Apply') + '</button></div></div></div><div id="codeMsg" aria-live="polite"></div>' +
      '<fieldset style="border:0;padding:0;margin:10px 0 0"><legend class="f" style="margin-top:10px">' + t('Pay on delivery') + '</legend>' +
      (CFG.mpesaStk ? '<label class="opt"><input type="radio" name="pay" value="mpesa_now"><span>📲 Pay now with M-Pesa (we send a prompt to your phone)</span></label>' : '') +
      '<label class="opt"><input type="radio" name="pay" value="cash" checked><span>' + t('Cash') + '</span></label><label class="opt"><input type="radio" name="pay" value="mpesa"><span>M-Pesa (pay the rider)</span></label>' +
      '<label class="opt" id="payInv" style="display:none"><input type="radio" name="pay" value="invoice"><span>🧾 Invoice my company</span></label></fieldset>' +
      '<input class="hp" id="cHp" tabindex="-1" autocomplete="off" aria-hidden="true"><div id="cErr" role="alert"></div><button class="btn red" id="cGo" style="width:100%;margin-top:10px"></button>' +
      '<p class="kmeta" style="margin-top:10px">🥩 Cooking at home too? <a href="fresh-market.html">Fresh meat from Azizo Butchery</a>, or find a recipe in the <a href="recipes.html">Cooking Hub</a>.</p>';
    $('cartBody').innerHTML = h; openM('mCart'); drawTotals();
    $('cartBody').querySelectorAll('[data-q]').forEach(function(b){ b.onclick = function(){ var p = b.dataset.q.split(':'), it = cart.items[+p[0]]; it.qty += +p[1]; if(it.qty <= 0) cart.items.splice(+p[0], 1); updateBar(); if(cart.items.length){ chk.promo = null; openCart(); } else closeM('mCart'); }; });
    $('cartBody').querySelectorAll('[data-up]').forEach(function(b){ b.onclick = function(){ var d = k.menu.filter(function(z){ return z.id === +b.dataset.up; })[0]; commit(k, d, {}, 1); chk.promo = null; openCart(); }; });
    $('cartBody').querySelectorAll('[data-addr]').forEach(function(b){ b.onclick = function(){ $('cAddr').value = addrs[+b.dataset.addr]; }; });
    $('promoGo').onclick = checkPromo; $('corpGo').onclick = checkCorp; $('cPhone').onblur = loyalty; $('cGo').onclick = place; loyalty();
    if(chk.promo && $('cPromo').value) checkPromo(true);
  }
  function codeMsg(m, bad){ $('codeMsg').innerHTML = m ? '<div class="msg ' + (bad ? 'err' : 'ok') + '">' + esc(m) + '</div>' : ''; }
  async function checkPromo(silent){
    var code = $('cPromo').value.trim().toUpperCase(); if(!code){ chk.promo = null; drawTotals(); return; } var k = curK();
    try{
      var body = { code: code, kitchenId: k.id, subtotal: sub() }; if(state.area) body.areaId = state.area; else { body.lat = state.lat; body.lng = state.lng; }
      var r = await K.api('/promo/check', { method:'POST', body: JSON.stringify(body) }); chk.promo = { code: r.code, discount: r.discount }; if(silent !== true) codeMsg('Code ' + r.code + ' applied: you save ' + money(r.discount) + '.');
    }catch(e){ chk.promo = null; codeMsg(e.message, true); } drawTotals();
  }
  async function checkCorp(){
    var code = $('cCorp').value.trim().toUpperCase(); if(!code){ chk.corp = null; drawTotals(); return; }
    try{ var r = await K.api('/corporate/check?code=' + encodeURIComponent(code)); chk.corp = { code: code, name: r.name, pct: r.discountPct }; codeMsg(r.name + ' account applied' + (r.discountPct ? ': ' + r.discountPct + '% off food.' : '. You can choose Invoice my company.')); }
    catch(e){ chk.corp = null; codeMsg(e.message, true); } drawTotals();
  }
  async function loyalty(){
    var p = $('cPhone') && $('cPhone').value.trim(); if(!p || p.replace(/\D/g, '').length < 9 || !CFG.loyaltyEvery){ chk.free = false; drawTotals(); return; }
    try{ var r = await K.api('/loyalty?phone=' + encodeURIComponent(p)); chk.free = r.every > 0 && r.untilFree === 0;
      $('loy').textContent = !r.every ? '' : chk.free ? '🎁 This order earns free delivery (unless you use a promo code).' : r.delivered ? '⭐ ' + r.untilFree + ' more ' + (r.untilFree === 1 ? 'order' : 'orders') + ' until your free delivery.' : '';
    }catch(e){ chk.free = false; } drawTotals();
  }
  async function place(){
    var k = curK(), name = $('cName').value.trim(), phone = $('cPhone').value.trim(), addr = $('cAddr').value.trim(), err = $('cErr'); err.innerHTML = '';
    if(name.length < 2 || phone.replace(/\D/g, '').length < 9 || addr.length < 4){ err.innerHTML = '<div class="msg err">Please fill in your name, phone and delivery address.</div>'; return; }
    var payment = document.querySelector('input[name=pay]:checked').value;
    var body = { kitchenId: k.id, name: name, phone: phone, address: addr, notes: $('cNote').value, date: state.date, meal: state.meal, payment: payment, website: $('cHp').value,
      promo: chk.promo ? chk.promo.code : '', corpCode: chk.corp ? chk.corp.code : '', items: cart.items.map(function(i){ return { dishId: i.d.id, qty: i.qty, options: i.sel }; }) };
    if(state.area) body.areaId = state.area; else { body.lat = state.lat; body.lng = state.lng; }
    $('cGo').disabled = true; $('cGo').textContent = 'Placing order…';
    try{
      var r = await K.api('/orders', { method: 'POST', body: JSON.stringify(body) });
      K.set('kkName', name); K.set('kkPhone', phone); K.set('kkLast', JSON.stringify({ id: r.id, phone: phone }));
      var addrs = jget('kkAddrs', []).filter(function(a){ return a !== addr; }); addrs.unshift(addr); K.set('kkAddrs', JSON.stringify(addrs.slice(0, 3)));
      K.set('kkLastItems', JSON.stringify({ kitchenId: k.id, items: cart.items.map(function(i){ return { dishId: i.d.id, qty: i.qty, options: i.sel }; }) }));
      cart = { kitchen: null, items: [] }; chk = { promo: null, corp: null, free: false }; updateBar(); closeM('mCart'); done(r, phone); search();
    }catch(e){ err.innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; $('cGo').disabled = false; drawTotals(); }
  }
  function done(r, phone){
    var h = '<h3>' + t('Order received') + ' 🎉</h3><div class="msg ok">Order <b>#' + r.id + '</b> with <b>' + esc(r.kitchen) + '</b>. Total <b>' + money(r.total) + '</b> (delivery ' + money(r.fee) + (r.discount ? ', you saved ' + money(r.discount) : '') + '), delivered ' + esc(r.window) + '.</div>';
    if(r.deliveryCode) h += '<div class="kmeta"><b>' + t('Your delivery code') + '</b></div><div class="codebox" aria-label="Delivery code">' + esc(r.deliveryCode) + '</div><p class="kmeta">' + t('Give this code to the rider when your food arrives.') + '</p>';
    if(r.payment === 'mpesa_now'){ h += '<div id="payBox" class="msg info" aria-live="polite">' + (r.stk && r.stk.started ? '📲 Check your phone and enter your M-Pesa PIN. The kitchen sees your order once payment is received.' : 'We could not send the M-Pesa prompt' + (r.stk && r.stk.error ? ' (' + esc(r.stk.error) + ')' : '') + '.') + '</div><div class="mini" style="margin-bottom:10px"><button class="btn sm" id="payAgain" type="button">Send prompt again</button><button class="btn sm" id="payRider" type="button">Pay the rider instead</button></div>'; }
    else h += '<p class="kmeta">The kitchen will confirm shortly. Keep your phone nearby.</p>';
    h += '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn gold" id="dTrack">' + t('Track order') + '</button><a class="btn" target="_blank" rel="noopener" href="https://wa.me/254724888057?text=' + encodeURIComponent('Hi Azizo Kitchens, my order number is #' + r.id) + '">WhatsApp us</a></div>' +
      '<p class="kmeta" style="margin-top:12px">While you wait: <a href="recipes.html">cooking ideas</a> · <a href="fresh-market.html">fresh meat for tomorrow</a></p>';
    $('doneBody').innerHTML = h; openM('mDone'); $('dTrack').onclick = function(){ closeM('mDone'); openTrack(r.id, phone); };
    if(r.payment === 'mpesa_now'){
      var tries = 0, iv = setInterval(async function(){ tries++; if(tries > 45 || !$('mDone').classList.contains('show')){ clearInterval(iv); return; }
        try{ var o = await K.api('/orders/track?id=' + r.id + '&phone=' + encodeURIComponent(phone)); if(o.paid){ clearInterval(iv); $('payBox').className = 'msg ok'; $('payBox').textContent = '✅ Payment received. Thank you!'; } else if(o.status === 'cancelled'){ clearInterval(iv); $('payBox').className = 'msg err'; $('payBox').textContent = 'Payment was not completed and the order was cancelled. You can place it again.'; } }catch(e){} }, 4000);
      $('payAgain').onclick = async function(){ try{ await K.api('/orders/' + r.id + '/pay', { method:'POST', body: JSON.stringify({ phone: phone }) }); K.toast('Prompt sent again'); }catch(e){ K.toast(e.message); } };
      $('payRider').onclick = async function(){ try{ await K.api('/orders/' + r.id + '/pay-rider', { method:'POST', body: JSON.stringify({ phone: phone }) }); $('payBox').className = 'msg ok'; $('payBox').textContent = 'Done. You will pay the rider by M-Pesa on delivery.'; clearInterval(iv); }catch(e){ K.toast(e.message); } };
    }
  }
  // ----- tracking -----
  var LABEL = { new: 'Waiting for the kitchen to confirm', accepted: 'Confirmed. The cook has your order', preparing: 'Being cooked', ready: 'Ready. Waiting for the rider', out_for_delivery: 'On its way to you', delivered: 'Delivered. Enjoy!', cancelled: 'Cancelled', rejected: 'The kitchen could not take this order' };
  var STEPS = [['new', 'Placed'], ['accepted', 'Confirmed'], ['preparing', 'Cooking'], ['ready', 'Ready'], ['out_for_delivery', 'On the way'], ['delivered', 'Delivered']];
  var trackTimer = null, lastStatus = null;
  function openTrack(id, phone){
    var last = jget('kkLast', {});
    if(typeof id !== 'string' && typeof id !== 'number') id = last.id || ''; phone = phone || last.phone || K.get('kkPhone');
    $('trackBody').innerHTML = '<h3>' + t('Track order') + '</h3><div class="row"><div><label class="f" for="tId">' + t('Order number') + '</label><input id="tId" inputmode="numeric" value="' + esc(id) + '"></div><div><label class="f" for="tPh">Phone used to order</label><input id="tPh" type="tel" value="' + esc(phone) + '"></div></div><button class="btn gold" id="tGo" style="margin:12px 0">' + t('Check') + '</button><div id="tOut" aria-live="polite"></div>';
    openM('mTrack'); $('tGo').onclick = function(){ lastStatus = null; check(); }; lastStatus = null; clearInterval(trackTimer);
    trackTimer = setInterval(function(){ if(!$('mTrack').classList.contains('show')){ clearInterval(trackTimer); return; } if($('tId') && $('tId').value && $('tPh').value && !document.hidden) check(true); }, 20000);
    if(id && phone) check();
  }
  async function check(poll){
    var out = $('tOut'); if(!out) return; if(!poll) out.innerHTML = '';
    try{
      var o = await K.api('/orders/track?id=' + encodeURIComponent($('tId').value.trim()) + '&phone=' + encodeURIComponent($('tPh').value.trim()));
      if(lastStatus && lastStatus !== o.status){ notify(o); } lastStatus = o.status;
      var bad = o.status === 'cancelled' || o.status === 'rejected', idx = STEPS.map(function(s){ return s[0]; }).indexOf(o.status);
      var h = '<div class="msg ' + (o.status === 'delivered' ? 'ok' : bad ? 'err' : 'info') + '"><b>' + esc(t(LABEL[o.status] || o.status)) + '</b>' + (o.reason ? '<br>Reason: ' + esc(o.reason) : '') + '</div>';
      if(!bad) h += '<ol class="steps" aria-label="Order progress">' + STEPS.map(function(s, i){ return '<li class="' + (i < idx || o.status === 'delivered' ? 'done' : i === idx ? 'now' : '') + '"' + (i === idx ? ' aria-current="step"' : '') + '>' + s[1] + '</li>'; }).join('') + '</ol>';
      h += '<p class="kmeta">' + esc(o.kitchen) + ' · ' + esc(o.date) + ' ' + esc(o.meal) + ' ' + esc(o.window) + ' · ' + (o.payment === 'mpesa_now' ? (o.paid ? 'M-Pesa (paid)' : 'M-Pesa (awaiting payment)') : o.payment === 'mpesa' ? 'M-Pesa to rider' : o.payment === 'invoice' ? 'Company invoice' : 'Cash on delivery') + (o.rider ? ' · Rider: ' + esc(o.rider) : '') + '</p>';
      if(o.code && !bad) h += '<div class="kmeta"><b>' + t('Your delivery code') + '</b></div><div class="codebox">' + esc(o.code) + '</div>';
      o.items.forEach(function(i){ h += '<div class="line"><div>' + i.qty + ' × ' + esc(i.name) + '<small>' + esc(i.options) + '</small></div><span>' + money(i.total) + '</span></div>'; });
      if(o.discount) h += '<div class="line" style="color:var(--ok)"><span>Discount' + (o.promo ? ' (' + esc(o.promo) + ')' : '') + '</span><span>−' + money(o.discount) + '</span></div>';
      h += '<div class="tot"><span>' + t('Total') + '</span><span>' + money(o.total) + '</span></div>';
      if(!bad && o.status !== 'delivered' && 'Notification' in window && Notification.permission === 'default') h += '<button class="btn sm" id="notifyBtn" type="button" style="margin-top:10px">🔔 Notify me when it changes</button>';
      if(o.status === 'delivered' && !o.rating) h += '<h4>How was it?</h4><div class="stars" id="stars">' + [1, 2, 3, 4, 5].map(function(n){ return '<button data-s="' + n + '" aria-label="' + n + ' stars">★</button>'; }).join('') + '</div><textarea id="rv" placeholder="Tell others about the food (optional)"></textarea><button class="btn gold" id="rGo" style="margin-top:8px" disabled>Send rating</button>';
      if(o.rating) h += '<p class="kmeta">Your rating: ' + '★'.repeat(o.rating) + '. Thank you!</p>';
      var keep = $('rv') ? $('rv').value : ''; out.innerHTML = h; if(keep && $('rv')) $('rv').value = keep;
      var sc = 0; out.querySelectorAll('[data-s]').forEach(function(b){ b.onclick = function(){ sc = +b.dataset.s; out.querySelectorAll('[data-s]').forEach(function(x){ x.classList.toggle('on', +x.dataset.s <= sc); }); $('rGo').disabled = false; }; });
      if($('notifyBtn')) $('notifyBtn').onclick = function(){ Notification.requestPermission().then(function(){ check(true); }); };
      if($('rGo')) $('rGo').onclick = async function(){ try{ await K.api('/orders/' + o.id + '/rate', { method: 'POST', body: JSON.stringify({ phone: $('tPh').value, rating: sc, comment: $('rv').value }) }); K.toast('Thank you for rating!'); check(); }catch(e){ K.toast(e.message); } };
    }catch(e){ if(!poll) out.innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; }
  }
  function notify(o){ try{ if('Notification' in window && Notification.permission === 'granted') new Notification('Azizo Kitchens · order #' + o.id, { body: t(LABEL[o.status] || o.status), icon: 'icon-192.png' }); }catch(e){} K.toast(t(LABEL[o.status] || o.status)); }
  init();
})();
