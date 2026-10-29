/* Azizo "Find meat near you" (v3.4.0)
   - Delivery area first: pick your area (or use your location), then search the whole market.
   - Search shows EVERY match across all branches, nearest first. Anything that has to come from a further branch is
     marked in red with the higher delivery cost. If nothing matches, or nothing is nearby, the page is never blank.
   - Also adds the phone bottom bar (Home, Shop, Search, Cart, Orders).
   Uses globals from app.js: freshItems, readyItems, groceryItems, branches, branchOut, areasList, areasReady,
   branchesReady, rankBranches, bandedFee, cardHTML, findItem, CONFIG, DELIVERY_CFG, openCart, openTrackOrder. */
(function(){
  'use strict';
  var MAXSHOW = 24, shown = MAXSHOW, query = '', loc = null;   // loc = {lat,lng,label,id?}
  var KEY_AREA = 'azizoMarketArea', KEY_GEO = 'azizoMarketGeo';
  var SW = { 'nyama ya ng\'ombe':'beef', 'ng\'ombe':'beef', 'ngombe':'beef', 'mbuzi':'goat', 'kondoo':'lamb', 'kuku':'chicken', 'samaki':'fish', 'nguruwe':'pork', 'bata mzinga':'turkey', 'mayai':'eggs', 'nyama choma':'grilled', 'matumbo':'tripe', 'kamba':'prawns', 'dagaa':'omena' };
  var CHIPS = ['Beef', 'Goat', 'Chicken', 'Fish', 'Pork', 'Sausages', 'Packs', 'Nyama choma', 'Eggs'];
  var esc = function(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
  var $ = function(id){ return document.getElementById(id); };
  var jget = function(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } };
  var jset = function(k, v){ try{ if(v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); }catch(e){} };

  function allItems(){
    var out = [];
    freshItems.forEach(function(i){ out.push({item:i, source:'fresh'}); });
    readyItems.forEach(function(i){ out.push({item:i, source:'ready'}); });
    groceryItems.forEach(function(i){ out.push({item:i, source:'groceries'}); });
    return out;
  }
  function norm(s){ return String(s || '').toLowerCase().replace(/[’`]/g, "'"); }
  function terms(q){
    q = norm(q).trim();
    Object.keys(SW).forEach(function(k){ if(q.indexOf(k) > -1) q = q.replace(k, SW[k]); });
    return q.split(/\s+/).filter(Boolean);
  }
  function hay(e){
    var i = e.item;
    return norm([i.name, i.cat, i.desc, i.kind === 'red' ? 'red meat' : (i.kind === 'white' ? 'white meat' : ''), e.source === 'ready' ? 'ready to eat grilled' : '', (i.badges || []).join(' ')].join(' '));
  }
  function matches(q){
    var t = terms(q), all = allItems();
    if(!t.length) return {list: [], exact: true};
    var strict = all.filter(function(e){ var h = hay(e); return t.every(function(x){ return h.indexOf(x) > -1; }); });
    if(strict.length) return {list: strict, exact: true};
    var loose = all.filter(function(e){ var h = hay(e); return t.some(function(x){ return x.length > 2 && h.indexOf(x) > -1; }); });
    return {list: loose, exact: false};
  }

  // where could this item come from, nearest branch first, skipping branches that are out of it
  function sourcing(item){
    if(item.inStock === false) return {out: true, all: true};
    if(!loc) return {out: false};
    var ranked = rankBranches(loc);
    if(!ranked.length) return {out: false};
    var nearest = ranked[0];
    var gone = new Set((typeof branchOut === 'object' && branchOut ? (function(){ var s = []; Object.keys(branchOut).forEach(function(b){ if((branchOut[b] || []).indexOf(item.id) > -1) s.push(b); }); return s; })() : []));
    var hit = null;
    for(var k = 0; k < ranked.length; k++){ if(!gone.has(ranked[k].branch.id)){ hit = ranked[k]; break; } }
    if(!hit) return {out: true, all: false};
    var farKm = Number(DELIVERY_CFG.farKm) || 12;
    return {out: false, from: hit.branch, km: hit.km, fee: bandedFee(hit.km), nearest: nearest.branch, nearestKm: nearest.km, nearestFee: bandedFee(nearest.km),
      far: hit.branch.id !== nearest.branch.id || hit.km > farKm, longTrip: hit.km > (Number(DELIVERY_CFG.maxKm) || 30)};
  }

  function chipHTML(s){
    if(s.out) return '<div class="ms-dist ms-out"><strong>Out of stock</strong>' + (s.all === false ? ' at every branch right now' : '') + '</div>';
    if(!loc) return '<div class="ms-dist ms-hint">Choose your area above to see the nearest branch and delivery cost.</div>';
    var base = esc(s.from.name) + ' · about ' + s.km.toFixed(1) + ' km';
    if(s.far){
      var more = s.fee > s.nearestFee ? ' That is more than KSh ' + s.nearestFee + ' from ' + esc(s.nearest.name) + ', which does not have it.' : '';
      return '<div class="ms-dist ms-far"><strong>Further away:</strong> ' + base + '. Delivery from KSh ' + s.fee + '.' + more + (s.longTrip ? ' We confirm the final fee on WhatsApp.' : '') + '</div>';
    }
    return '<div class="ms-dist ms-near">From ' + base + ' · delivery from KSh ' + s.fee + '</div>';
  }

  function render(){
    var box = $('msResults'); if(!box) return;
    var m = query.trim() ? matches(query) : {list: [], exact: true}, note = '', entries;
    if(query.trim()){
      entries = m.list;
      if(!entries.length){
        note = 'No exact match for "' + esc(query) + '". Here is what we sell, nearest first. Try another word, or ask us on WhatsApp.';
        entries = allItems();
      } else if(!m.exact){
        note = 'No exact match for "' + esc(query) + '". Closest results:';
      } else {
        note = entries.length + ' result' + (entries.length === 1 ? '' : 's') + ' for "' + esc(query) + '"' + (loc ? ', nearest first' : '');
      }
    } else {
      entries = allItems().filter(function(e){ return e.source === 'fresh'; });
      note = loc ? 'Fresh meat near ' + esc(loc.label) + ', nearest first. Type above to search everything.' : 'Popular fresh meat. Choose your area to see what is nearest and what delivery costs.';
    }
    var rows = entries.map(function(e, idx){ return {e: e, s: sourcing(e.item), idx: idx}; });
    rows.sort(function(a, b){
      if(a.s.out !== b.s.out) return a.s.out ? 1 : -1;
      if(loc && !a.s.out && !b.s.out && a.s.km !== b.s.km) return a.s.km - b.s.km;
      return a.idx - b.idx;
    });
    var total = rows.length, list = rows.slice(0, query.trim() ? shown : Math.min(shown, 12));
    var farCount = rows.filter(function(r){ return r.s.far && !r.s.out; }).length;
    var html = '<p class="ms-note" role="status">' + note + '</p>';
    if(loc && farCount) html += '<p class="ms-warn" role="status"><strong>' + farCount + ' item' + (farCount === 1 ? '' : 's') + ' in these results come from a further branch</strong> and cost more to deliver. They are marked in red.</p>';
    html += '<div class="grid ms-grid">' + list.map(function(r){
      var it = r.s.out ? Object.assign({}, r.e.item, {inStock: false}) : r.e.item;
      return '<div class="ms-cell' + (r.s.far && !r.s.out ? ' ms-cell-far' : '') + '">' + cardHTML(it, r.e.source, chipHTML(r.s)) + '</div>';
    }).join('') + '</div>';
    if(total > list.length) html += '<p class="ms-more"><button type="button" class="btn-ghost" id="msMore">Show more (' + (total - list.length) + ' more)</button></p>';
    html += '<p class="ms-foot">Cannot find it? <a href="https://wa.me/' + esc(CONFIG.WA_NUMBER) + '?text=' + encodeURIComponent('Hello Azizo, do you have: ' + (query || '...')) + '" target="_blank" rel="noopener">Ask us on WhatsApp</a>.</p>';
    box.innerHTML = html;
    var more = $('msMore'); if(more) more.onclick = function(){ shown += MAXSHOW; render(); };
  }

  function setLoc(l, remember){
    loc = l;
    if(l && l.id){ areaLocation = {id: l.id, name: l.label, region: l.region || '', lat: l.lat, lng: l.lng}; var cs = $('custArea'); if(cs){ cs.value = l.id; try{ cs.dispatchEvent(new Event('change')); }catch(e){} } }
    else if(l){ userGeo = {lat: l.lat, lng: l.lng}; }
    if(remember){ if(l && l.id){ jset(KEY_AREA, l.id); jset(KEY_GEO, null); } else if(l){ jset(KEY_GEO, JSON.stringify({lat: l.lat, lng: l.lng})); jset(KEY_AREA, null); } }
    shown = MAXSHOW; render();
  }

  function build(mount){
    mount.innerHTML =
      '<section class="ms" id="msearch" aria-label="Find meat near you"><div class="ms-in">' +
      '<h2 class="ms-h">Where should we deliver?</h2>' +
      '<p class="ms-sub">Pick your area and search the whole market. We show what is nearest first, and flag anything that has to come from further away.</p>' +
      '<div class="ms-row">' +
      '<label class="ms-lab" for="msArea">Your area</label><select id="msArea" class="ms-in-ctl"><option value="">Choose your area…</option></select>' +
      '<button type="button" id="msGeo" class="ms-geo">📍 Use my location</button>' +
      '</div>' +
      '<div class="ms-row"><label class="ms-lab" for="msQ">Search</label><input id="msQ" class="ms-in-ctl" type="search" placeholder="Search beef, goat, chicken, fish… (mbuzi, kuku, samaki)" autocomplete="off"></div>' +
      '<div class="ms-chips" id="msChips">' + CHIPS.map(function(c){ return '<button type="button" data-q="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div>' +
      '<div id="msStatus" class="ms-status" role="status"></div>' +
      '<div id="msResults"></div></div></section>';
    var sel = $('msArea');
    var groups = {};
    areasList.forEach(function(a){ (groups[a.region || 'Other'] = groups[a.region || 'Other'] || []).push(a); });
    Object.keys(groups).sort().forEach(function(r){
      var og = document.createElement('optgroup'); og.label = r;
      groups[r].sort(function(a, b){ return a.name < b.name ? -1 : 1; }).forEach(function(a){ var o = document.createElement('option'); o.value = a.id; o.textContent = a.name; og.appendChild(o); });
      sel.appendChild(og);
    });
    sel.onchange = function(){ var a = areasList.filter(function(x){ return x.id === sel.value; })[0]; if(a) setLoc({id: a.id, label: a.name, region: a.region, lat: a.lat, lng: a.lng}, true); else { loc = null; jset(KEY_AREA, null); render(); } };
    $('msGeo').onclick = function(){
      var st = $('msStatus');
      if(!navigator.geolocation){ st.textContent = 'Location is not available on this device. Please choose your area.'; return; }
      if(window.isSecureContext === false){ st.textContent = 'Location needs a secure (https) page. Please choose your area instead.'; return; }
      st.textContent = 'Finding you…';
      navigator.geolocation.getCurrentPosition(function(p){
        st.textContent = '';
        var best = null; areasList.forEach(function(a){ var d = haversineKm(p.coords.latitude, p.coords.longitude, a.lat, a.lng); if(!best || d < best.d) best = {a: a, d: d}; });
        sel.value = '';
        setLoc({lat: p.coords.latitude, lng: p.coords.longitude, label: best && best.d < 8 ? 'near ' + best.a.name : 'your location'}, true);
      }, function(){ st.textContent = 'We could not get your location. Please choose your area.'; }, {timeout: 12000, maximumAge: 300000});
    };
    var q = $('msQ'), t = null;
    q.oninput = function(){ clearTimeout(t); t = setTimeout(function(){ query = q.value; shown = MAXSHOW; render(); }, 160); };
    $('msChips').onclick = function(e){ var b = e.target.closest('button[data-q]'); if(!b) return; q.value = b.dataset.q; query = q.value; shown = MAXSHOW; render(); };
    // restore the last choice
    var sa = jget(KEY_AREA), sg = jget(KEY_GEO);
    if(sa){ var a = areasList.filter(function(x){ return x.id === sa; })[0]; if(a){ sel.value = a.id; setLoc({id: a.id, label: a.name, region: a.region, lat: a.lat, lng: a.lng}, false); return; } }
    if(sg){ try{ var g = JSON.parse(sg); if(Number.isFinite(g.lat)) { setLoc({lat: g.lat, lng: g.lng, label: 'your location'}, false); return; } }catch(e){} }
    render();
  }

  // keep results in step with cart changes and stock updates
  function hook(){
    if(typeof refreshProductGrids === 'function'){ var orig = refreshProductGrids; window.refreshProductGrids = function(){ orig.apply(this, arguments); render(); }; }
    setTimeout(render, 1800); setTimeout(render, 6000);
    document.addEventListener('visibilitychange', function(){ if(!document.hidden) render(); });
  }

  // ---- phone bottom bar ----
  function bottomBar(){
    if(document.getElementById('mBar')) return;
    var p = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    var cur = p === '' || p === 'index.html' ? 'home' : (/fresh-market|ready-to-eat|groceries/.test(p) ? 'shop' : '');
    var nav = document.createElement('nav'); nav.id = 'mBar'; nav.className = 'm-bar notranslate-keep'; nav.setAttribute('aria-label', 'Quick navigation');
    var ico = {
      home: '<path d="M4 11l8-7 8 7v9a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z"/>',
      shop: '<path d="M5 8h14l-1.5 11h-11z"/><path d="M9 8a3 3 0 016 0"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
      cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M3 4h2l2.4 11h11l2-8H6.5"/>',
      orders: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'
    };
    var b = function(id, label, attrs){ return '<' + (attrs.href ? 'a href="' + attrs.href + '"' : 'button type="button"') + ' data-k="' + id + '" class="' + (cur === id ? 'on' : '') + '"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ico[id] + '</svg><span>' + label + '</span>' + (id === 'cart' ? '<i id="mBarCount" class="m-count">0</i>' : '') + '</' + (attrs.href ? 'a' : 'button') + '>'; };
    nav.innerHTML = b('home', 'Home', {href: 'index.html'}) + b('shop', 'Shop', {href: 'fresh-market.html'}) + b('search', 'Search', {}) + b('cart', 'Cart', {}) + b('orders', 'Orders', {});
    document.body.appendChild(nav); document.body.classList.add('has-mbar');
    nav.querySelector('[data-k=search]').onclick = function(){ var q = $('msQ'); if(q){ q.scrollIntoView({behavior: 'smooth', block: 'center'}); setTimeout(function(){ q.focus(); }, 350); } else { location.href = 'index.html#msearch'; } };
    nav.querySelector('[data-k=cart]').onclick = function(){ if(typeof openCart === 'function') openCart(); };
    nav.querySelector('[data-k=orders]').onclick = function(){ if(typeof openTrackOrder === 'function') openTrackOrder(); };
    var src = $('cartCount'), dst = $('mBarCount');
    var sync = function(){ if(src && dst){ var n = parseInt(src.textContent, 10) || 0; dst.textContent = n; dst.style.display = n ? '' : 'none'; } };
    if(src){ sync(); new MutationObserver(sync).observe(src, {childList: true, characterData: true, subtree: true}); }
  }

  function start(){
    bottomBar();
    var mount = $('marketSearchMount'); if(!mount) return;
    Promise.race([Promise.all([typeof areasReady !== 'undefined' ? areasReady : Promise.resolve(), typeof branchesReady !== 'undefined' ? branchesReady : Promise.resolve()]), new Promise(function(r){ setTimeout(r, 5000); })]).then(function(){ build(mount); hook(); }).catch(function(){ build(mount); hook(); });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
