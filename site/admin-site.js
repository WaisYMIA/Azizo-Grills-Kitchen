/* Admin - Site tab: switches that control public features.
   Event Budget Planner: on/off (off hides the page's links everywhere), a note shown at the top of the planner,
   and the buffer % added for waste and price changes. Loaded by admin.html; uses its api(), authHeaders(), escapeHtml(). */
(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  let loaded = false;
  async function call(method, body, path){
    const res = await fetch(api(path || '/api/site/settings'), { method, headers: authHeaders(body ? {'Content-Type':'application/json'} : {}), body: body ? JSON.stringify(body) : undefined, cache:'no-store' });
    const data = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
    return data;
  }
  function say(msg, bad){ const el = $('siteStatus'); if(!el) return; el.textContent = msg || ''; el.style.color = bad ? '#b23a3a' : '#2e7d46'; }
  function paint(eb){
    $('siteEbOn').checked = !!eb.enabled; $('siteEbNote').value = eb.note || ''; $('siteEbPct').value = eb.contingencyPct;
    $('siteEbState').textContent = eb.enabled ? 'ON - the planner and its links are visible to customers' : 'OFF - the planner page shows a "talk to us" message and every link to it is hidden';
    $('siteEbState').style.color = eb.enabled ? '#1f6b3a' : '#b23a3a';
  }
  function shell(){
    $('siteTab').innerHTML = `<div style="max-width:720px;background:#fff;border:1px solid var(--line);border-radius:8px;padding:20px 22px">
      <h3 style="margin:0 0 4px">Event Budget Planner</h3>
      <p class="hint" style="margin:0 0 14px">Lets visitors build a meat list for a party or corporate event and see the cost, or turn a budget into quantities. It reads your live product prices, so any price, stock or product change appears in the planner on its own. Fixed costs (cooking facilities, fuel, chef) are always handled by you on a call.</p>
      <label style="display:flex;gap:10px;align-items:center;font-weight:700;margin-bottom:6px"><input type="checkbox" id="siteEbOn" style="width:20px;height:20px"> Show the Event Budget Planner on the website</label>
      <div id="siteEbState" style="font-size:13px;margin:0 0 16px"></div>
      <label style="display:block;font-weight:600;margin-bottom:12px">Note shown at the top of the planner (optional)
        <textarea id="siteEbNote" maxlength="300" rows="2" style="width:100%;margin-top:4px;padding:8px;border:1px solid var(--line);border-radius:6px;font:inherit" placeholder="e.g. Events need 3 days' notice. Weekend dates book fast."></textarea></label>
      <label style="display:block;font-weight:600;margin-bottom:16px">Buffer added to every estimate, % (waste, trimming, price changes)
        <input type="number" id="siteEbPct" min="0" max="50" step="1" style="width:100px;margin-top:4px;padding:8px;border:1px solid var(--line);border-radius:6px;display:block"></label>
      <button type="button" id="siteSave" style="padding:10px 20px;border:0;border-radius:6px;background:var(--maroon);color:#fff;font-weight:700;cursor:pointer">Save</button>
      <span id="siteStatus" style="margin-left:12px;font-size:13px"></span>
    </div>
    <div style="max-width:980px;margin-top:22px"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h3 style="margin:0">Event enquiries <span id="leadCount" style="font-size:13px;color:var(--ink-soft)"></span></h3><div><select id="leadFilter" aria-label="Filter by status"><option value="">All</option><option>new</option><option>contacted</option><option>quoted</option><option>won</option><option>lost</option></select> <button type="button" id="leadCsv" style="padding:7px 12px;border:1px solid var(--line);border-radius:6px;background:#fff;cursor:pointer">Download CSV</button></div></div><p class="hint">People who pressed "Request a call back" in the Event Budget Planner, with their list and estimate. Call them, then keep the status up to date.</p><div id="leadList"></div></div>`;
    $('leadFilter').onchange = loadLeads;
    $('leadCsv').onclick = async () => { try{ const r = await fetch(api('/api/site/leads.csv'), { headers: authHeaders() }); if(!r.ok) throw new Error('Download failed'); const b = await r.blob(), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'azizo-event-enquiries.csv'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }catch(e){ say(e.message, true); } };
    $('siteSave').onclick = async () => {
      say('Saving…');
      try{ const d = await call('PUT', { eventBudget:{ enabled:$('siteEbOn').checked, note:$('siteEbNote').value, contingencyPct:Number($('siteEbPct').value) || 0 } }); paint(d.eventBudget); say('Saved. Customers see the change within a minute.'); }
      catch(e){ say(e.message, true); }
    };
    $('siteEbOn').onchange = () => { const on = $('siteEbOn').checked; $('siteEbState').textContent = (on ? 'Will be ON' : 'Will be OFF') + ' after you press Save'; };
  }
  const waNum = p => { const d = String(p || '').replace(/\D/g, ''); return d.indexOf('254') === 0 ? d : d.charAt(0) === '0' ? '254' + d.slice(1) : d.length === 9 ? '254' + d : d; };
  async function loadLeads(){
    const box = $('leadList'); if(!box) return;
    try{
      const st = $('leadFilter').value, d = await call('GET', null, '/api/site/leads' + (st ? '?status=' + st : ''));
      const nNew = (d.counts.filter(c => c.status === 'new')[0] || { n: 0 }).n; $('leadCount').textContent = nNew ? '(' + nNew + ' new)' : '';
      box.innerHTML = d.leads.length ? d.leads.map(l => `<div style="background:#fff;border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin:8px 0">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>#${l.id} · ${escapeHtml(l.name)}</b><span style="font-size:12px;color:var(--ink-soft)">${escapeHtml(l.created)} UTC</span></div>
        <div style="font-size:13px;margin:4px 0"><a href="tel:${escapeHtml(l.phone)}">${escapeHtml(l.phone)}</a> · <a target="_blank" rel="noopener" href="https://wa.me/${waNum(l.phone)}?text=${encodeURIComponent('Hello ' + l.name.split(' ')[0] + ', this is Azizo Butchery & Grill about your event enquiry.')}">WhatsApp</a>
        · ${l.guests} guests${l.eventDate ? ' · ' + escapeHtml(l.eventDate) : ''}${l.venue ? ' · ' + escapeHtml(l.venue) : ''} · <b>KSh ${Number(l.estimate).toLocaleString('en-KE')}</b> (${l.mode === 'qty' ? 'from budget' : 'from quantities'})</div>
        <div style="font-size:12.5px;color:var(--ink-soft)">${l.items.map(i => escapeHtml(i.qty + ' ' + i.unit + ' ' + i.name)).join(', ') || 'No items'}</div>${l.note ? '<div style="font-size:13px;margin-top:4px">“' + escapeHtml(l.note) + '”</div>' : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center"><select data-st="${l.id}" aria-label="Status">${['new', 'contacted', 'quoted', 'won', 'lost'].map(x => '<option' + (x === l.status ? ' selected' : '') + '>' + x + '</option>').join('')}</select><input data-nt="${l.id}" value="${escapeHtml(l.adminNote)}" placeholder="Your note (price quoted, follow-up date…)" maxlength="400" style="flex:1;min-width:200px;padding:7px;border:1px solid var(--line);border-radius:6px"><button type="button" data-sv="${l.id}" style="padding:7px 14px;border:0;border-radius:6px;background:var(--maroon);color:#fff;cursor:pointer">Save</button></div></div>`).join('') : '<p class="hint">No enquiries yet.</p>';
      box.querySelectorAll('[data-sv]').forEach(b => { b.onclick = async () => { const id = b.dataset.sv; try{ await call('PATCH', { status: box.querySelector('[data-st="' + id + '"]').value, adminNote: box.querySelector('[data-nt="' + id + '"]').value }, '/api/site/leads/' + id); b.textContent = 'Saved ✓'; setTimeout(loadLeads, 700); }catch(e){ say(e.message, true); } }; });
    }catch(e){ box.innerHTML = '<p class="hint" style="color:#b23a3a">Could not load enquiries: ' + escapeHtml(e.message) + '</p>'; }
  }
  window.AzizoSiteAdmin = { async open(){
    if(!loaded){ shell(); loaded = true; }
    try{ const d = await call('GET'); paint(d.eventBudget); say(''); }catch(e){ say('Could not load: ' + e.message, true); }
    loadLeads();
  } };
})();
