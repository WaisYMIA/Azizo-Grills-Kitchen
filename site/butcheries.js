(function(){
  'use strict';
  var K = window.KK, M = window.MK, $ = K.$, esc = K.esc, app = $('app');
  M.header('list'); M.footer();
  var areas = [], loc = null;
  async function loadAreas(){
    try{ var r = await M.root('/api/areas'); areas = (r.areas || []).filter(function(a){ return a.active !== false; }); }catch(e){}
    if(!areas.length) areas = await K.staticAreas();
  }
  function card(p){
    var far = p.distanceKm != null && p.distanceKm > 12;
    return '<a class="kcard" href="butchery.html?b=' + encodeURIComponent(p.slug) + '" style="display:block;padding:16px;text-decoration:none;color:inherit"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><h3 style="margin:0">' + esc(p.name) + '</h3><div class="kmeta" style="color:var(--mute);font-size:.86rem">' + esc(p.address || p.region || '') + '</div></div><span class="tag">' + esc(M.TIER[p.tier] || p.tier) + '</span></div>' +
      '<p style="margin:10px 0 6px">' + M.score(p) + (p.halal ? ' <span class="kbadge">Halal</span>' : '') + (p.licenceVerified ? ' <span class="kbadge">Licence verified</span>' : '') + '</p>' +
      '<p style="margin:6px 0;font-size:.88rem;color:' + (far ? '#ff8a9c' : 'var(--mute)') + '">' + (p.distanceKm != null ? (far ? 'Further away: about ' : 'About ') + p.distanceKm + ' km from you. ' : '') + 'Delivery KSh ' + p.deliveryFee + ' · Minimum order KSh ' + p.minOrder + ' · ' + p.itemCount + ' items in stock' + (far ? '. Expect a higher delivery cost.' : '') + '</p></a>';
  }
  async function show(){
    var q = loc ? (loc.areaId ? '?areaId=' + encodeURIComponent(loc.areaId) : '?lat=' + loc.lat + '&lng=' + loc.lng) : '';
    var out = $('list'); out.innerHTML = '<p class="kmeta">Loading butcheries…</p>';
    try{
      var r = await M.api('/partners' + q), n = r.partners.length;
      out.innerHTML = n ? '<div class="kgrid" style="display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">' + r.partners.map(card).join('') + '</div>' + (loc ? '<p class="kmeta" style="margin-top:12px">Sorted nearest first so your delivery cost stays low.</p>' : '')
        : '<div class="empty"><h3>No partner butchery is open yet</h3><p>We are onboarding our first butchers. You can still order from the Azizo shop.</p><p><a class="btn gold" href="index.html">Shop at Azizo</a> <a class="btn" href="https://wa.me/254724888057">WhatsApp us</a></p></div>';
    }catch(e){ out.innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; }
  }
  (async function(){
    var st = await M.status(); if(!st.on){ app.innerHTML = M.closed(st); return; }
    await loadAreas();
    app.innerHTML = '<div class="panel"><div class="row"><div><label class="f" for="area">Your area</label><select id="area">' + K.areaOptions(areas, '') + '</select></div><div><label class="f">&nbsp;</label><button class="btn" id="gps" type="button">Use my location</button></div></div><div id="locNote" class="slotnote"></div></div><div id="list" style="margin-top:16px"></div>' +
      '<div class="panel" style="margin-top:18px"><b>Run a butchery?</b> <a href="sell-with-azizo.html">Apply to sell with Azizo</a>.</div>';
    $('area').onchange = function(){ loc = this.value ? { areaId: this.value } : null; show(); };
    $('gps').onclick = async function(){ try{ var g = await K.gps(); loc = { lat: g.lat, lng: g.lng }; $('area').value = ''; $('locNote').textContent = 'Using your current location.'; show(); }catch(e){ $('locNote').textContent = e.message; } };
    show();
  })();
})();
