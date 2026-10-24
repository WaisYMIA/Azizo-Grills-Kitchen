/* Admin - Site tab: switches that control public features.
   Event Budget Planner: on/off (off hides the page's links everywhere), a note shown at the top of the planner,
   and the buffer % added for waste and price changes. Loaded by admin.html; uses its api(), authHeaders(), escapeHtml(). */
(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  let loaded = false;
  async function call(method, body){
    const res = await fetch(api('/api/site/settings'), { method, headers: authHeaders(body ? {'Content-Type':'application/json'} : {}), body: body ? JSON.stringify(body) : undefined, cache:'no-store' });
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
    </div>`;
    $('siteSave').onclick = async () => {
      say('Saving…');
      try{ const d = await call('PUT', { eventBudget:{ enabled:$('siteEbOn').checked, note:$('siteEbNote').value, contingencyPct:Number($('siteEbPct').value) || 0 } }); paint(d.eventBudget); say('Saved. Customers see the change within a minute.'); }
      catch(e){ say(e.message, true); }
    };
    $('siteEbOn').onchange = () => { const on = $('siteEbOn').checked; $('siteEbState').textContent = (on ? 'Will be ON' : 'Will be OFF') + ' after you press Save'; };
  }
  window.AzizoSiteAdmin = { async open(){
    if(!loaded){ shell(); loaded = true; }
    try{ const d = await call('GET'); paint(d.eventBudget); say(''); }catch(e){ say('Could not load: ' + e.message, true); }
  } };
})();
