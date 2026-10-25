/* Azizo admin - Areas module (delivery zones + pricing). Loaded by admin.html; uses its api(), authHeaders(), escapeHtml(). */
(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => escapeHtml(s);
  let cfg = null, areas = [], branches = [], loaded = false;
  const open = {};          // region -> expanded?
  let q = '', filter = 'all';

  const hav = (a, b, c, d) => { const R = 6371, p = Math.PI / 180, x = Math.sin((c - a) * p / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin((d - b) * p / 2) ** 2; return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); };
  const bandFee = km => { const band = Math.max(cfg.bandKm, Math.ceil(km / cfg.bandKm) * cfg.bandKm); return Math.min(cfg.maxFee, Math.round((cfg.baseFee + cfg.perKm * band) / 10) * 10); };
  function quote(a){
    let best = null;
    branches.filter(b => b.listed && Number.isFinite(b.lat)).forEach(b => { const km = hav(a.lat, a.lng, b.lat, b.lng) * cfg.roadFactor; if(!best || km < best.km) best = {b, km}; });
    return best ? {branch: best.b.name, km: best.km, fee: bandFee(best.km), far: best.km > cfg.maxKm} : null;
  }
  async function call(path, method, body){
    const res = await fetch(api(path), {method: method || 'GET', headers: authHeaders(body ? {'Content-Type': 'application/json'} : {}), body: body ? JSON.stringify(body) : undefined, cache: 'no-store'});
    const data = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
    return data;
  }
  const status = (m, bad) => { const el = $('arStatus'); if(el){ el.textContent = m || ''; el.style.color = bad ? '#b23a3a' : ''; } };

  function shell(){
    $('areasTab').innerHTML = `
      <div class="panel">
        <h3>Delivery pricing (per distance band)</h3>
        <p class="hint">Delivery is priced from the <strong>nearest branch that is showing on the website</strong>, by estimated road distance. Distance is rounded <strong>up</strong> to the next band, so zones at a similar distance share one price: <strong>fee = base + rate per km x band</strong>, never above the cap. Hide a branch (Branches tab) and every zone is re-priced from the next nearest branch automatically.</p>
        <div class="field-row" style="flex-wrap:wrap">
          <div class="field"><label>Base fee (KSh)</label><input type="number" id="cf_baseFee" min="0" step="10"></div>
          <div class="field"><label>Rate per km (KSh)</label><input type="number" id="cf_perKm" min="0" step="1"></div>
          <div class="field"><label>Band size (km)</label><input type="number" id="cf_bandKm" min="0.5" step="0.5"></div>
          <div class="field"><label>Maximum fee (KSh)</label><input type="number" id="cf_maxFee" min="0" step="10"></div>
        </div>
        <div class="field-row" style="flex-wrap:wrap">
          <div class="field"><label>Confirm by WhatsApp beyond (km)</label><input type="number" id="cf_maxKm" min="1" step="1"></div>
          <div class="field"><label>Road factor (road km / straight km)</label><input type="number" id="cf_roadFactor" min="1" max="2.5" step="0.05"></div>
          <div class="field"><label>Suggest a nearer branch when it is closer by (km)</label><input type="number" id="cf_nearerBranchKm" min="0" step="0.5"></div>
          <div class="field" style="align-self:flex-end"><button class="add-btn" style="margin:0" onclick="AzizoAreas.saveConfig()">Save pricing</button></div>
        </div>
        <div id="arPreview" class="hint"></div>
      </div>

      <div class="panel">
        <h3>Branches used for distance</h3>
        <div id="arBranches" class="hint"></div>
      </div>

      <div class="panel">
        <h3>Areas we serve</h3>
        <p class="hint">Tick a zone to serve it; untick to stop (it disappears from the website and checkout straight away). Tick a region to switch all its zones together. Coordinates are approximate area centres: use <strong>Map</strong> to check one, and <strong>Edit</strong> to correct it. Fees below are estimates for the current pricing.</p>
        <div class="toolbar">
          <input type="search" id="arSearchBox" placeholder="Search zones or regions…" style="padding:9px 11px;border:1px solid var(--line);border-radius:4px;min-width:200px;flex:1">
          <select id="arFilter" style="padding:9px 11px;border:1px solid var(--line);border-radius:4px"><option value="all">All zones</option><option value="on">Served only</option><option value="off">Not served only</option></select>
          <button class="add-btn" style="margin-top:0" onclick="AzizoAreas.edit()">+ Add zone</button>
        </div>
        <div class="toolbar">
          <span style="font-size:12.5px">Quick select by distance:</span>
          <input type="number" id="arWithin" value="10" min="1" step="1" style="width:70px;padding:8px;border:1px solid var(--line);border-radius:4px"> <span style="font-size:12.5px">km</span>
          <button class="excel-btn" onclick="AzizoAreas.within(true)">Serve all within</button>
          <button class="excel-btn secondary" onclick="AzizoAreas.within(false)">Stop serving beyond</button>
          <button class="excel-btn secondary" onclick="AzizoAreas.expandAll(true)">Expand all</button>
          <button class="excel-btn secondary" onclick="AzizoAreas.expandAll(false)">Collapse all</button>
        </div>
        <div class="status-line" id="arStatus"></div>
        <div id="arRegions"></div>
      </div>

      <div class="modal-overlay" id="arModal"><div class="modal">
        <h3 id="arModalTitle">Add zone</h3>
        <form id="arForm">
          <input type="hidden" id="az_id">
          <div class="field-row"><div class="field"><label>Region</label><input type="text" id="az_region" required maxlength="80" list="arRegionList" placeholder="e.g. Umoja"></div>
          <div class="field"><label>Zone name</label><input type="text" id="az_name" required maxlength="80" placeholder="e.g. Umoja 2"></div></div>
          <datalist id="arRegionList"></datalist>
          <div class="field"><label>Road / corridor (helps group riders)</label><input type="text" id="az_corridor" maxlength="60" placeholder="e.g. Eastern (Outer Ring Rd)"></div>
          <div class="field-row"><div class="field"><label>Latitude</label><input type="number" id="az_lat" step="any" required placeholder="-1.2833"></div>
          <div class="field"><label>Longitude</label><input type="number" id="az_lng" step="any" required placeholder="36.8956"></div></div>
          <a class="pin-link" id="az_pin" href="#" target="_blank" rel="noopener">Check this pin on Google Maps ↗</a>
          <label class="check-field"><input type="checkbox" id="az_active"> Served now</label>
          <div class="error-msg" id="az_err"></div>
          <div class="form-actions"><button type="button" class="cancel-btn" onclick="AzizoAreas.closeModal()">Cancel</button><button type="submit">Save zone</button></div>
        </form></div></div>`;
    const pin = () => { const la = $('az_lat').value, lo = $('az_lng').value; $('az_pin').href = (la && lo) ? `https://www.google.com/maps/search/?api=1&query=${la},${lo}` : '#'; };
    $('az_lat').addEventListener('input', pin); $('az_lng').addEventListener('input', pin);
    $('arSearchBox').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); renderRegions(); });
    $('arFilter').addEventListener('change', e => { filter = e.target.value; renderRegions(); });
    $('arForm').addEventListener('submit', submitZone);
  }

  function fillConfig(){ Object.keys(cfg).forEach(k => { const el = $('cf_' + k); if(el) el.value = cfg[k]; }); previewBands(); }
  function readConfig(){ const o = {}; Object.keys(cfg).forEach(k => { const el = $('cf_' + k); if(el) o[k] = Number(el.value); }); return o; }
  function previewBands(){
    const c = Object.assign({}, cfg, readConfig()); const keep = cfg; cfg = c;
    const rows = []; let lo = 0;
    for(let i = 1; i <= 60 && lo < c.maxKm; i++){ const hi = i * c.bandKm; const f = bandFee(hi - 0.0001); rows.push(`${lo}-${Math.min(hi, c.maxKm)} km: <strong>KSh ${f}</strong>`); lo = hi; if(f >= c.maxFee) { rows[rows.length - 1] = `${hi - c.bandKm}+ km (up to ${c.maxKm}): <strong>KSh ${c.maxFee}</strong>`; break; } }
    cfg = keep; $('arPreview').innerHTML = 'Preview: ' + rows.join(' &nbsp;·&nbsp; ');
  }

  function renderBranches(){
    $('arBranches').innerHTML = branches.length ? branches.map(b => b.listed ? `<span style="color:#2e7d46">● ${esc(b.name)} (live)</span>` : `<span style="opacity:.55">○ ${esc(b.name)} (hidden)</span>`).join(' &nbsp; ') +
      '<br>Only <strong>live</strong> branches are used. Show or hide a branch in the Branches tab (it can be hidden whenever a branch is closed).' : 'No branches found.';
  }

  function renderRegions(){
    const regs = {}; areas.forEach(a => (regs[a.region] = regs[a.region] || []).push(a));
    const qs = areas.map(a => ({a, q: quote(a)}));
    const qm = new Map(qs.map(x => [x.a.id, x.q]));
    const html = Object.keys(regs).map(r => {
      let zs = regs[r];
      const total = zs.length, on = zs.filter(a => a.active).length;
      const regMatch = q && r.toLowerCase().includes(q);
      zs = zs.filter(a => (!q || regMatch || (a.name + ' ' + r).toLowerCase().includes(q)) && (filter === 'all' || (filter === 'on') === a.active));
      if(!zs.length) return '';
      const expanded = open[r] || !!q || filter !== 'all';
      return `<div class="ar-reg" style="border:1px solid var(--line);border-radius:6px;margin-bottom:8px;background:#fff">
        <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;cursor:pointer" data-toggle="${esc(r)}">
          <input type="checkbox" class="ar-regcb" data-region="${esc(r)}" ${on === total ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--gold)" title="Serve / stop serving the whole region">
          <strong style="flex:1">${esc(r)}</strong><span style="font-size:12px;color:var(--ink-soft)">${on} of ${total} served ${expanded ? '▾' : '▸'}</span></div>
        ${expanded ? zs.map(a => { const z = qm.get(a.id); return `<div style="display:flex;align-items:center;gap:12px;padding:8px 14px 8px 46px;border-top:1px solid var(--line);flex-wrap:wrap;${a.active ? '' : 'opacity:.6'}">
          <input type="checkbox" class="ar-cb" data-id="${esc(a.id)}" ${a.active ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--gold)">
          <div style="flex:1;min-width:180px"><strong style="font-size:13.5px">${esc(a.name)}</strong><div style="font-size:11.5px;color:var(--ink-soft)">${z ? `${esc(z.branch)} · ~${z.km.toFixed(1)} km · <strong>KSh ${z.fee}</strong>${z.far ? ' · beyond range' : ''}` : 'no live branch'} ${a.corridor ? '· ' + esc(a.corridor) : ''}</div></div>
          <a href="https://www.google.com/maps/search/?api=1&query=${a.lat},${a.lng}" target="_blank" rel="noopener" style="font-size:12px">Map ↗</a>
          <span class="item-actions"><button class="edit-btn" data-edit="${esc(a.id)}">Edit</button><button class="del-btn" data-del="${esc(a.id)}">Delete</button></span></div>`; }).join('') : ''}
      </div>`;
    }).join('');
    $('arRegions').innerHTML = html || '<p class="empty-note">No zones match.</p>';
    document.querySelectorAll('.ar-regcb').forEach(cb => { const zs = regs[cb.dataset.region]; const on = zs.filter(a => a.active).length; cb.indeterminate = on > 0 && on < zs.length; });
    const on = areas.filter(a => a.active).length;
    status(`${on} of ${areas.length} zones are served.`);
  }

  async function reload(){
    const [a, b] = await Promise.all([call('/api/areas/all'), call('/api/branches/all')]);
    cfg = a.config; areas = a.areas; branches = b.branches || [];
    $('arRegionList').innerHTML = [...new Set(areas.map(x => x.region))].map(r => `<option value="${esc(r)}">`).join('');
    fillConfig(); renderBranches(); renderRegions();
  }

  function wireList(){
    $('arRegions').addEventListener('click', async e => {
      const t = e.target;
      if(t.classList.contains('ar-cb')){ e.stopPropagation(); return; }
      if(t.classList.contains('ar-regcb')){ e.stopPropagation(); return; }
      if(t.dataset.edit){ edit(t.dataset.edit); return; }
      if(t.dataset.del){ if(!confirm('Delete this zone? (Untick it instead if you only want to pause it.)')) return; try{ await call('/api/areas/' + encodeURIComponent(t.dataset.del), 'DELETE'); await reload(); }catch(err){ status(err.message, true); } return; }
      const hd = t.closest('[data-toggle]'); if(hd && !t.closest('input')){ const r = hd.dataset.toggle; open[r] = !open[r]; renderRegions(); }
    });
    $('arRegions').addEventListener('change', async e => {
      const t = e.target;
      try{
        if(t.classList.contains('ar-cb')) await call('/api/areas/bulk', 'POST', {active: t.checked, ids: [t.dataset.id]});
        else if(t.classList.contains('ar-regcb')) await call('/api/areas/bulk', 'POST', {active: t.checked, region: t.dataset.region});
        else return;
        await reload();
      }catch(err){ status(err.message, true); await reload(); }
    });
  }

  async function submitZone(ev){
    ev.preventDefault(); $('az_err').textContent = '';
    const body = {id: $('az_id').value || undefined, region: $('az_region').value.trim(), name: $('az_name').value.trim(), corridor: $('az_corridor').value.trim(),
      lat: Number($('az_lat').value), lng: Number($('az_lng').value), active: $('az_active').checked};
    try{ await call('/api/areas', 'POST', body); closeModal(); await reload(); }catch(err){ $('az_err').textContent = err.message; }
  }
  function edit(id){
    const a = id ? areas.find(x => x.id === id) : null;
    $('arModalTitle').textContent = a ? 'Edit zone' : 'Add zone'; $('az_err').textContent = '';
    $('az_id').value = a ? a.id : ''; $('az_region').value = a ? a.region : ''; $('az_name').value = a ? a.name : '';
    $('az_corridor').value = a ? a.corridor : ''; $('az_lat').value = a ? a.lat : ''; $('az_lng').value = a ? a.lng : ''; $('az_active').checked = a ? a.active : true;
    $('az_pin').href = a ? `https://www.google.com/maps/search/?api=1&query=${a.lat},${a.lng}` : '#';
    $('arModal').classList.add('open');
  }
  function closeModal(){ $('arModal').classList.remove('open'); }

  window.AzizoAreas = {
    async open(){
      if(!loaded){ loaded = true; shell(); wireList(); }
      try{ status('Loading…'); await reload(); }catch(e){ status("Couldn't load areas: " + e.message, true); }
    },
    async saveConfig(){
      try{ const r = await call('/api/areas/config', 'POST', readConfig()); cfg = r.config; status('Pricing saved ✓'); fillConfig(); renderRegions(); }catch(e){ status(e.message, true); }
    },
    async within(serve){
      const km = Number($('arWithin').value); if(!(km > 0)) return;
      const ids = areas.filter(a => { const z = quote(a); return z && (serve ? z.km <= km : z.km > km); }).map(a => a.id);
      if(!ids.length){ status('No zones match that distance.'); return; }
      if(!confirm(`${serve ? 'Serve' : 'Stop serving'} ${ids.length} zone(s) ${serve ? 'within' : 'beyond'} ${km} km of a live branch?`)) return;
      try{ await call('/api/areas/bulk', 'POST', {active: serve, ids}); await reload(); }catch(e){ status(e.message, true); }
    },
    expandAll(v){ areas.forEach(a => { open[a.region] = v; }); renderRegions(); },
    edit, closeModal,
  };
  document.addEventListener('input', e => { if(e.target && /^cf_/.test(e.target.id)) previewBands(); });
})();
