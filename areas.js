/* Areas We Serve - uses the globals from app.js (branches, areasList, DELIVERY_CFG, rankBranches, areaQuote, ...). */
(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const AREA_KEY = 'azizoArea';
  let quotes = [];   // [{area, q}]

  function buildQuotes(){
    quotes = areasList.map(a => ({area:a, q: areaQuote(a)})).filter(x => x.q);
  }

  function renderList(filter){
    const f = (filter || '').trim().toLowerCase();
    const regions = {};
    quotes.forEach(x => {
      if(f && !(x.area.name + ' ' + x.area.region).toLowerCase().includes(f)) return;
      (regions[x.area.region] = regions[x.area.region] || []).push(x);
    });
    const names = Object.keys(regions);
    $('arList').innerHTML = names.map(r => {
      const zs = regions[r];
      const cor = zs[0].area.corridor ? `<div class="ar-cor">${esc(zs[0].area.corridor)}</div>` : '';
      return `<div class="ar-card"><h3>${esc(r)}</h3>${cor}<ul class="ar-zones">` + zs.map(x =>
        `<li><button type="button" class="ar-zone" data-id="${esc(x.area.id)}"><span class="ar-zname">${esc(x.area.name)}</span>` +
        `<span class="ar-zmeta">${esc(x.q.branch.name)} · ~${x.q.km.toFixed(0)} km</span><span class="ar-fee">KSh ${x.q.fee}</span></button></li>`).join('') + '</ul></div>';
    }).join('');
    $('arEmpty').style.display = names.length ? 'none' : 'block';
  }

  function fillSelect(){
    const regions = {};
    areasList.forEach(a => { (regions[a.region] = regions[a.region] || []).push(a); });
    $('arSelect').innerHTML = '<option value="">Choose your area…</option>' +
      Object.keys(regions).map(r => `<optgroup label="${esc(r)}">${regions[r].map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</optgroup>`).join('');
  }

  function showResult(area){
    const box = $('arResult');
    if(!area){ box.innerHTML = ''; return; }
    const q = areaQuote(area);
    if(!q){ box.innerHTML = ''; return; }
    const free = CONFIG.FREE_DELIVERY_THRESHOLD;
    box.innerHTML = `<div class="ar-ok"><strong>Yes - we deliver to ${esc(area.name)}.</strong><br>` +
      `Served from <strong>${esc(q.branch.name)}</strong> (~${q.km.toFixed(1)} km by road). Delivery from <strong>KSh ${q.fee}</strong>` +
      `${free ? `, <strong>free</strong> on orders of KSh ${free} and above` : ''}.` +
      `<br><a class="btn" href="fresh-market.html" id="arShop">Shop now for ${esc(area.name)}</a></div>`;
    try{ localStorage.setItem(AREA_KEY, area.id); }catch(e){}
  }

  function renderBands(){
    const c = DELIVERY_CFG, rows = [];
    let lo = 0;
    for(let i = 1; i <= 40; i++){
      const hi = i * c.bandKm; if(lo >= c.maxKm) break;
      const fee = Math.min(c.maxFee, Math.round((c.baseFee + c.perKm * hi) / 10) * 10);
      rows.push(`<tr><td>${lo} – ${Math.min(hi, c.maxKm)} km</td><td>KSh ${fee}</td></tr>`);
      lo = hi; if(fee >= c.maxFee && i > 1) { rows.pop(); rows.push(`<tr><td>${lo - c.bandKm} – ${c.maxKm} km</td><td>KSh ${c.maxFee}</td></tr>`); break; }
    }
    $('arBands').innerHTML = '<tr><th>Road distance from your branch</th><th>Delivery fee</th></tr>' + rows.join('');
    $('arPricingText').textContent = `Delivery is priced by road distance from the branch nearest to you, in ${c.bandKm} km steps, so areas at a similar distance share one price. Beyond ${c.maxKm} km we confirm the fee on WhatsApp.`;
  }

  function nearestZone(lat, lng){
    let best = null;
    areasList.forEach(a => { const d = haversineKm(lat, lng, a.lat, a.lng); if(!best || d < best.d) best = {a, d}; });
    return best;
  }

  async function init(){
    await Promise.all([branchesReady, areasReady]);
    buildQuotes(); fillSelect(); renderList(''); renderBands();
    $('arSelect').addEventListener('change', e => showResult(areasList.find(a => a.id === e.target.value)));
    $('arSearch').addEventListener('input', e => renderList(e.target.value));
    $('arList').addEventListener('click', e => {
      const b = e.target.closest('.ar-zone'); if(!b) return;
      $('arSelect').value = b.dataset.id; showResult(areasList.find(a => a.id === b.dataset.id));
      $('arResult').scrollIntoView({behavior:'smooth', block:'center'});
    });
    $('arGeo').addEventListener('click', () => {
      const box = $('arResult');
      if(!navigator.geolocation){ box.innerHTML = '<div class="ar-note">Location is not available on this browser - choose your area from the list.</div>'; return; }
      box.innerHTML = '<div class="ar-note">Finding you…</div>';
      navigator.geolocation.getCurrentPosition(pos => {
        const z = nearestZone(pos.coords.latitude, pos.coords.longitude);
        if(z && z.d <= 6){ $('arSelect').value = z.a.id; showResult(z.a); }
        else box.innerHTML = '<div class="ar-note">You look to be outside our current zones. WhatsApp us - we may still be able to deliver.</div>';
      }, () => { box.innerHTML = '<div class="ar-note">Could not get your location - choose your area from the list.</div>'; }, {timeout:8000, maximumAge:300000});
    });
  }
  init();
})();
