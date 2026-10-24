/* Azizo Event Budget Planner.
   Two live estimates over the shop's own price list:
     "cost"  - you choose meats and quantities, we show the cost
     "qty"   - you give a budget and how to split it, we show the quantities
   The catalogue is re-read from the backend every minute (and when the tab regains focus), so any price, stock or
   product change made in the admin dashboard flows into open estimates automatically.
   The admin can switch the whole module off (Site tab); eb-flag.js then hides every link to it. */
(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ksh = n => 'KSh ' + Math.round(n || 0).toLocaleString('en-KE');
  const KEY = 'azizoEventPlan', BIRD_KG = 1.3, PORTION_KG = 0.35, POLL_MS = 60000;
  const WA = (typeof CONFIG !== 'undefined' && CONFIG.WA_NUMBER) || '254724888057';
  const TEMPLATES = [
    { key:'classic', name:'Classic braai', cats:['Beef','Goat','Chicken','Sausages'] },
    { key:'bc', name:'Beef & chicken', cats:['Beef','Chicken'] },
    { key:'sea', name:'Grill & seafood', cats:['Beef','Chicken','Fish'] }
  ];
  let catalog = [], byId = {}, settings = { enabled:true, note:'', contingencyPct:10 }, toastTimer, pollTimer;
  let state = { name:'', guests:50, mode:'cost', budget:'', rows:[] };

  // ---------- catalogue (live) ----------
  function step(p){ return p && p.unit === 'kg' ? 0.5 : 1; }
  function unitLabel(p){ return p ? (p.unit === 'kg' ? 'kg' : p.unit === 'bird' ? (p.unit) : p.unit) : ''; }
  function kgOf(p, q){ return !p ? 0 : p.unit === 'kg' ? q : p.unit === 'bird' ? q * BIRD_KG : 0; }
  async function fetchCatalog(){
    let data = null;
    try{ if(typeof apiAvailable === 'function' && apiAvailable()){ const r = await fetch(apiBase() + '/api/products', { cache:'no-store' }); if(r.ok) data = await r.json(); } }catch(e){}
    if(!data || !Array.isArray(data.freshItems)){ try{ const r = await fetch('./products.json', { cache:'no-store' }); data = await r.json(); }catch(e){ data = null; } }
    return data && Array.isArray(data.freshItems) ? data.freshItems.filter(i => i && i.id && Number(i.price) > 0) : null;
  }
  // returns list of changed ids so the UI can flash them
  function applyCatalog(list){
    const old = byId, changed = [];
    catalog = list.map(i => ({ id:i.id, name:i.name, cat:i.cat, unit:i.unit || 'kg', price:Number(i.price), inStock:i.inStock !== false }));
    byId = {}; catalog.forEach(p => byId[p.id] = p);
    Object.keys(old).forEach(id => { const a = old[id], b = byId[id]; if(!b || a.price !== b.price || a.inStock !== b.inStock || a.name !== b.name) changed.push(id); });
    Object.keys(byId).forEach(id => { if(!old[id] && Object.keys(old).length) changed.push(id); });
    return changed;
  }

  // ---------- state ----------
  function save(){ try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(e){} }
  function restore(){
    try{ const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if(!s || typeof s !== 'object') return;
      state.name = String(s.name || '').slice(0, 60); state.guests = clamp(parseInt(s.guests) || 50, 1, 2000);
      state.mode = s.mode === 'qty' ? 'qty' : 'cost'; state.budget = s.budget ? String(s.budget) : '';
      state.rows = Array.isArray(s.rows) ? s.rows.filter(r => r && typeof r.id === 'string').slice(0, 40).map(r => ({ id:r.id, qty:clamp(Number(r.qty) || 0, 0, 9999), share:clamp(Number(r.share) || 0, 0, 100) })) : [];
    }catch(e){}
  }
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const roundTo = (n, s) => Math.round(n / s) * s;
  const has = id => state.rows.some(r => r.id === id);
  function balanceShares(){ const live = state.rows.filter(r => byId[r.id]); const n = live.length || 1; state.rows.forEach(r => r.share = Math.round(100 / n)); }

  // ---------- maths ----------
  function compute(){
    const c = settings.contingencyPct / 100, live = state.rows.filter(r => byId[r.id]);
    const lines = [];
    let budget = Number(state.budget) || 0;
    if(state.mode === 'qty'){
      const meatSpend = budget / (1 + c), sumShare = live.reduce((a, r) => a + r.share, 0);
      state.rows.forEach(r => {
        const p = byId[r.id]; if(!p){ lines.push({ r, p:null, qty:0, cost:0, pct:0 }); return; }
        const pct = sumShare > 0 ? r.share / sumShare : 0, s = step(p);
        const qty = Math.max(0, Math.floor((meatSpend * pct / p.price) / s + 1e-9) * s);
        lines.push({ r, p, qty, cost:Math.round(qty * p.price), pct:pct * 100 });
      });
    } else {
      state.rows.forEach(r => { const p = byId[r.id]; lines.push(p ? { r, p, qty:r.qty, cost:Math.round(r.qty * p.price), pct:0 } : { r, p:null, qty:0, cost:0, pct:0 }); });
    }
    const subtotal = lines.reduce((a, l) => a + l.cost, 0), buffer = Math.round(subtotal * c), total = subtotal + buffer;
    const kg = lines.reduce((a, l) => a + kgOf(l.p, l.qty), 0), hasOther = lines.some(l => l.p && l.p.unit !== 'kg' && l.p.unit !== 'bird' && l.qty > 0);
    const g = clamp(state.guests, 1, 2000);
    return { lines, subtotal, buffer, total, kg, hasOther, perGuest:total / g, gramsPerGuest:kg * 1000 / g, budget, leftover:budget - total, c:settings.contingencyPct, live:live.length };
  }

  // ---------- rendering ----------
  function renderPick(){
    const used = new Set(state.rows.map(r => r.id)), groups = {};
    catalog.filter(p => !used.has(p.id)).forEach(p => (groups[p.cat] = groups[p.cat] || []).push(p));
    const sel = $('ebPick'); let html = '<option value="">Choose a product to add…</option>';
    Object.keys(groups).forEach(cat => { html += `<optgroup label="${esc(cat)}">` + groups[cat].map(p => `<option value="${esc(p.id)}">${esc(p.name)} — ${ksh(p.price)}/${esc(unitLabel(p))}${p.inStock ? '' : ' (out of stock)'}</option>`).join('') + '</optgroup>'; });
    sel.innerHTML = html;
  }
  function renderRows(flash){
    const box = $('ebItems'), m = state.mode;
    if(!state.rows.length){ box.innerHTML = '<div class="eb-empty">Your list is empty. Start from a template above or add products below.</div>'; return; }
    box.innerHTML = state.rows.map((r, i) => {
      const p = byId[r.id];
      if(!p) return `<div class="eb-row gone" data-i="${i}"><div><div class="eb-name">No longer on our list</div><div class="eb-sub"><span class="warn">Left out of the estimate.</span></div></div><div></div><div></div><div class="eb-rowfoot"><button type="button" class="eb-x" data-act="rm">Remove</button></div></div>`;
      const u = unitLabel(p), ctl = m === 'cost'
        ? `<div class="eb-qty"><button type="button" data-act="dec" aria-label="Less ${esc(p.name)}">&minus;</button><input type="number" min="0" max="9999" step="${step(p)}" value="${r.qty}" data-act="qty" inputmode="decimal" aria-label="Quantity of ${esc(p.name)} in ${esc(u)}"><button type="button" data-act="inc" aria-label="More ${esc(p.name)}">+</button><small>${esc(u)}</small></div>`
        : `<div class="eb-share"><input type="number" min="0" max="100" step="5" value="${r.share}" data-act="share" inputmode="numeric" aria-label="Share of budget for ${esc(p.name)}"><small>% share</small></div>`;
      return `<div class="eb-row${flash && flash.includes(r.id) ? ' flash' : ''}" data-i="${i}"><div><div class="eb-name">${esc(p.name)}</div><div class="eb-sub">${ksh(p.price)} per ${esc(u)} · ${esc(p.cat)}${p.inStock ? '' : ' · <span class="warn">out of stock right now</span>'}</div></div>${ctl}<div class="eb-line"><strong data-f="cost"></strong><small data-f="qty"></small></div><div class="eb-rowfoot"><button type="button" class="eb-x" data-act="rm" aria-label="Remove ${esc(p.name)}">Remove</button></div></div>`;
    }).join('');
    if(flash && flash.length) setTimeout(() => box.querySelectorAll('.flash').forEach(e => e.classList.remove('flash')), 2500);
  }
  function update(){
    const c = compute();
    const rows = $('ebItems').querySelectorAll('.eb-row');
    c.lines.forEach((l, i) => { const el = rows[i]; if(!el || !l.p) return;
      el.querySelector('[data-f="cost"]').textContent = ksh(l.cost);
      el.querySelector('[data-f="qty"]').textContent = state.mode === 'qty' ? `≈ ${fmtQty(l.qty)} ${unitLabel(l.p)} · ${Math.round(l.pct)}% of budget` : `${fmtQty(l.qty)} ${unitLabel(l.p)}`; });
    const g = clamp(state.guests, 1, 2000);
    $('ebWho').textContent = (state.name ? state.name + ' · ' : '') + g + ' guest' + (g === 1 ? '' : 's');
    $('ebTotal').textContent = ksh(c.total); $('ebMiniAmt').textContent = ksh(c.total);
    $('ebTotalSub').textContent = state.mode === 'qty' ? 'what this budget buys, including the buffer' : 'estimated meat cost, including the buffer';
    let dl = `<dt>Meat</dt><dd>${ksh(c.subtotal)}</dd>`;
    if(c.c > 0) dl += `<dt>Buffer for waste &amp; price changes (${c.c}%)</dt><dd>${ksh(c.buffer)}</dd>`;
    dl += `<dt>Per guest</dt><dd>${ksh(c.perGuest)}</dd>`;
    dl += `<dt>Meat in total</dt><dd>${c.kg ? c.kg.toFixed(1) + ' kg' : '—'}${c.hasOther ? ' + packs' : ''}</dd>`;
    dl += `<dt>Per guest (raw weight)</dt><dd>${c.kg ? Math.round(c.gramsPerGuest) + ' g' : '—'}</dd>`;
    if(state.mode === 'qty' && c.budget) dl += `<dt>Left from budget</dt><dd>${ksh(Math.max(0, c.leftover))}</dd>`;
    $('ebBreak').innerHTML = dl;
    const msgs = [];
    if(state.mode === 'qty' && !c.budget) msgs.push(['', 'Enter your budget above to see the quantities.']);
    if(state.mode === 'qty' && c.budget && c.live === 0) msgs.push(['warn', 'Add at least one product to share the budget across.']);
    if(c.kg > 0){ const gp = c.gramsPerGuest;
      msgs.push([gp < 250 ? 'warn' : '', gp < 250 ? `About ${Math.round(gp)} g per guest is on the light side. Most hosts plan 300–450 g of raw meat each.` : gp <= 500 ? `About ${Math.round(gp)} g per guest, a comfortable braai portion.` : `About ${Math.round(gp)} g per guest is generous; expect leftovers.`]); }
    if(c.lines.some(l => l.p && !l.p.inStock && (state.mode === 'qty' ? l.qty > 0 : l.qty > 0))) msgs.push(['warn', 'Some items are out of stock right now. We will suggest substitutes on the call.']);
    $('ebMsgs').innerHTML = msgs.map(m => `<div class="eb-msg ${m[0]}">${esc(m[1])}</div>`).join('');
    const ok = c.total > 0; $('ebPdf').disabled = !ok;
    $('ebCall').href = waLink(c);
    $('ebBudgetHint').innerHTML = state.mode === 'qty' && c.budget ? `Your meat budget includes a ${c.c}% buffer, so about <b>${ksh(c.budget / (1 + c.c / 100))}</b> goes on meat. That is ${ksh(c.budget / g)} per guest.` : '';
  }
  const fmtQty = q => (Math.round(q * 10) / 10).toString();
  function renderAll(flash){
    $('ebName').value = state.name; $('ebGuests').value = state.guests; $('ebBudget').value = state.budget;
    $('ebModeCost').setAttribute('aria-pressed', state.mode === 'cost'); $('ebModeQty').setAttribute('aria-pressed', state.mode === 'qty');
    $('ebBudgetBox').hidden = state.mode !== 'qty'; $('ebSuggest').hidden = state.mode !== 'cost';
    $('ebListHint').textContent = state.mode === 'cost' ? 'Set how much of each meat you want. The cost updates as you type. Prices are live and follow any change to our price list.' : 'Decide how to split your budget between the meats. We turn each share into a quantity at today\'s prices.';
    renderPick(); renderRows(flash); update();
  }

  // ---------- actions ----------
  function add(id){ const p = byId[id]; if(!p || has(id)) return; state.rows.push({ id, qty:p.unit === 'kg' ? 5 : 2, share:0 }); balanceShares(); save(); renderAll(); }
  function suggest(){
    const sizable = state.rows.filter(r => byId[r.id] && (byId[r.id].unit === 'kg' || byId[r.id].unit === 'bird'));
    if(!sizable.length){ toast('Add some meats first, then we can suggest quantities.'); return; }
    const kgEach = clamp(state.guests, 1, 2000) * PORTION_KG / sizable.length;
    sizable.forEach(r => { const p = byId[r.id]; r.qty = Math.max(step(p), roundTo(p.unit === 'bird' ? kgEach / BIRD_KG : kgEach, step(p))); });
    save(); renderAll(); toast(`Suggested about ${Math.round(PORTION_KG * 1000)} g of raw meat per guest. Adjust freely.`);
  }
  function template(t){
    const rows = [];
    t.cats.forEach(cat => { const p = catalog.find(x => x.cat === cat && x.inStock && (x.unit === 'kg' || x.unit === 'bird')) || catalog.find(x => x.cat === cat && (x.unit === 'kg' || x.unit === 'bird')); if(p && !rows.some(r => r.id === p.id)) rows.push({ id:p.id, qty:0, share:0 }); });
    if(!rows.length){ toast('That template has no products on our list right now.'); return; }
    state.rows = rows; balanceShares(); save(); suggest();
  }
  function toast(msg){ const t = $('toast'), m = $('toastMsg'); if(!t || !m) return; m.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3500); }

  // ---------- hand-off ----------
  function lineText(c){ return c.lines.filter(l => l.p && l.qty > 0).map(l => `• ${l.p.name}: ${fmtQty(l.qty)} ${unitLabel(l.p)} × ${ksh(l.p.price)} = ${ksh(l.cost)}`).join('\n'); }
  function waLink(c){
    const g = clamp(state.guests, 1, 2000);
    const msg = `Hello Azizo Butchery & Grill, I used the Event Budget Planner${state.name ? ' for "' + state.name + '"' : ''}.\nGuests: ${g}\n` + (c.total > 0 ? `${lineText(c)}\nMeat estimate: ${ksh(c.total)} (incl. ${c.c}% buffer)\n` : '') +
      `\nI'd like a call to discuss the fixed costs: cooking facilities, fuel, a chef/grill master and delivery.`;
    return `https://wa.me/${WA}?text=${encodeURIComponent(msg)}`;
  }
  function pdf(){
    if(!window.jspdf){ toast('The PDF tool did not load. Check your connection and try again.'); return; }
    const c = compute(), doc = new window.jspdf.jsPDF(), g = clamp(state.guests, 1, 2000);
    doc.setFontSize(18); doc.text('Azizo Butchery & Grill — Event meat estimate', 14, 18);
    doc.setFontSize(11); doc.text([state.name ? 'Event: ' + state.name : 'Event estimate', `Guests: ${g}`, `Prepared: ${new Date().toLocaleDateString('en-KE')}`], 14, 27);
    doc.autoTable({ startY:42, head:[['Item', 'Quantity', 'Price', 'Cost']], body:c.lines.filter(l => l.p && l.qty > 0).map(l => [l.p.name, `${fmtQty(l.qty)} ${unitLabel(l.p)}`, ksh(l.p.price) + '/' + unitLabel(l.p), ksh(l.cost)]), headStyles:{ fillColor:[22, 18, 16], textColor:[228, 200, 138] }, columnStyles:{ 3:{ halign:'right' } } });
    let y = doc.lastAutoTable.finalY + 8; doc.setFontSize(11);
    [['Meat', ksh(c.subtotal)], [`Buffer (${c.c}%)`, ksh(c.buffer)], ['Estimated total', ksh(c.total)], ['Per guest', ksh(c.perGuest)]].forEach(r => { doc.text(r[0], 120, y); doc.text(r[1], 196, y, { align:'right' }); y += 6; });
    doc.setFontSize(9); doc.text(doc.splitTextToSize('Meat only, at prices on the day this was prepared. Not included: cooking facilities, fuel, chef or grill master, serving staff and ware, delivery. These are quoted on a call. Contact us on WhatsApp +254 724 888 057.', 180), 14, y + 8);
    doc.save('azizo-event-estimate.pdf');
  }

  // ---------- live refresh ----------
  async function refresh(silent){
    const list = await fetchCatalog(); if(!list || !list.length) return;
    const changed = applyCatalog(list);
    try{ const s = await window.AzizoSite.refresh(); if(s){ const wasOn = settings.enabled; settings = s; if(wasOn !== s.enabled) return gate(); } }catch(e){}
    const mine = changed.filter(id => has(id));
    if(changed.length){ renderAll(mine); if(!silent && mine.length) toast(`Prices updated for ${mine.length} item${mine.length === 1 ? '' : 's'} on your list.`); }
  }
  function gate(){
    $('ebApp').hidden = !settings.enabled; $('ebClosed').hidden = settings.enabled;
    if(!settings.enabled){ $('ebClosedWa').href = `https://wa.me/${WA}?text=${encodeURIComponent('Hello Azizo, I need a price estimate for an event.')}`;
      if(!document.querySelector('meta[name="robots"][content*="noindex"]')){ const m = document.createElement('meta'); m.name = 'robots'; m.content = 'noindex'; document.head.appendChild(m); } return; }
    const n = $('ebNote'); n.hidden = !settings.note; n.textContent = settings.note;
    renderAll();
  }

  // ---------- wire up ----------
  function wire(){
    $('ebName').addEventListener('input', e => { state.name = e.target.value.slice(0, 60); save(); update(); });
    const setG = v => { state.guests = clamp(parseInt(v) || 1, 1, 2000); $('ebGuests').value = state.guests; save(); update(); };
    $('ebGuests').addEventListener('input', e => { if(e.target.value !== '') setG(e.target.value); });
    $('ebGuests').addEventListener('change', e => setG(e.target.value));
    $('ebGuestsMinus').onclick = () => setG(state.guests - 5); $('ebGuestsPlus').onclick = () => setG(state.guests + 5);
    $('ebBudget').addEventListener('input', e => { state.budget = e.target.value; save(); update(); });
    const mode = m => { state.mode = m; if(m === 'qty') balanceShares(); save(); renderAll(); };
    $('ebModeCost').onclick = () => mode('cost'); $('ebModeQty').onclick = () => mode('qty');
    $('ebAddBtn').onclick = () => { const v = $('ebPick').value; if(v) add(v); else toast('Choose a product from the list first.'); };
    $('ebPick').addEventListener('change', e => { if(e.target.value) add(e.target.value); });
    $('ebSuggest').onclick = suggest; $('ebClear').onclick = () => { state.rows = []; save(); renderAll(); };
    $('ebPdf').onclick = pdf;
    const tpl = $('ebTemplates'); TEMPLATES.forEach(t => { const b = document.createElement('button'); b.type = 'button'; b.className = 'eb-chip'; b.textContent = t.name; b.onclick = () => template(t); tpl.appendChild(b); });
    $('ebItems').addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if(!b) return; const row = b.closest('.eb-row'), r = state.rows[+row.dataset.i]; if(!r) return; const act = b.dataset.act, p = byId[r.id];
      if(act === 'rm'){ state.rows.splice(+row.dataset.i, 1); if(state.mode === 'qty') balanceShares(); save(); renderAll(); return; }
      if(act === 'inc' || act === 'dec'){ r.qty = clamp(roundTo(r.qty + (act === 'inc' ? 1 : -1) * step(p), 0.5 > step(p) ? step(p) : 0.5), 0, 9999); row.querySelector('[data-act="qty"]').value = r.qty; save(); update(); }
    });
    $('ebItems').addEventListener('input', e => {
      const i = e.target.dataset && e.target.dataset.act; if(!i) return; const row = e.target.closest('.eb-row'), r = state.rows[+row.dataset.i]; if(!r) return;
      const v = parseFloat(e.target.value); if(i === 'qty') r.qty = clamp(isNaN(v) ? 0 : Math.round(v * 10) / 10, 0, 9999); if(i === 'share') r.share = clamp(isNaN(v) ? 0 : v, 0, 100);
      save(); update();
    });
    document.addEventListener('visibilitychange', () => { if(!document.hidden) refresh(); });
    pollTimer = setInterval(() => { if(!document.hidden) refresh(); }, POLL_MS);
  }

  async function init(){
    restore();
    const [list, s] = await Promise.all([fetchCatalog(), window.AzizoSite.ready]);
    settings = s || settings;
    if(list && list.length) applyCatalog(list);
    if(!catalog.length){ $('ebApp').hidden = false; $('ebItems').innerHTML = '<div class="eb-empty">We could not load our price list just now. Please refresh, or message us on WhatsApp.</div>'; return; }
    state.rows = state.rows.filter((r, i, a) => a.findIndex(x => x.id === r.id) === i);
    if(state.mode === 'qty' && state.rows.every(r => !r.share)) balanceShares();
    wire(); gate();
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
