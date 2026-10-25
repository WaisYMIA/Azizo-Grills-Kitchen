/* Azizo admin — Reports module. Loaded by admin.html; uses its api(), authHeaders(), escapeHtml(), doLogout(). */
(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => escapeHtml(s);
  const money = n => 'KSh ' + Math.round(Number(n)||0).toLocaleString('en-KE');
  const num = n => Math.round(Number(n)||0).toLocaleString('en-KE');
  const pctTxt = n => (n==null ? '—' : (Math.round(n*10)/10) + '%');
  const GOLD = '#C89B3C', GOLD_D = '#8F6A1F', INK = '#221A17', MUTED = '#5A4E48', GRID = '#E6DCCB', GREEN = '#2E7D46', RED = '#B23A3A';
  let R = null, current = { preset: '30d', from: '', to: '', branch: '', cogs: '' }, sub = 'overview', expenses = [], loaded = false;
  const subs = [
    ['overview','Overview'], ['products','Products & Sales'], ['branches','Branches & Delivery'],
    ['customers','Customers'], ['payments','Payments & Cash'], ['accounts','Accounts (P&L)']
  ];

  // ---------- dates ----------
  function todayLocal(){ return new Date(Date.now() + ((R && R.tzOffset!=null ? R.tzOffset : 3))*3600000).toISOString().slice(0,10); }
  function addDays(d,n){ const x = new Date(d+'T00:00:00Z'); x.setUTCDate(x.getUTCDate()+n); return x.toISOString().slice(0,10); }
  function presetRange(p){
    const t = todayLocal(), y = t.slice(0,4), m = t.slice(5,7);
    if(p==='today') return [t,t];
    if(p==='yesterday') return [addDays(t,-1),addDays(t,-1)];
    if(p==='7d') return [addDays(t,-6),t];
    if(p==='30d') return [addDays(t,-29),t];
    if(p==='90d') return [addDays(t,-89),t];
    if(p==='month') return [`${y}-${m}-01`,t];
    if(p==='lastmonth'){ const f = new Date(Date.UTC(+y,+m-2,1)), l = new Date(Date.UTC(+y,+m-1,0)); return [f.toISOString().slice(0,10), l.toISOString().slice(0,10)]; }
    if(p==='year') return [`${y}-01-01`,t];
    return [current.from || addDays(t,-29), current.to || t];
  }
  function qs(extra){
    const p = new URLSearchParams({from: current.from, to: current.to});
    if(current.branch) p.set('branch', current.branch);
    if(current.cogs) p.set('cogs', current.cogs);
    Object.keys(extra||{}).forEach(k => p.set(k, extra[k]));
    return p.toString();
  }

  // ---------- chrome ----------
  function mount(){
    const host = $('reportsTab');
    host.innerHTML = `
      <div class="rp-bar panel">
        <div class="rp-presets" id="rpPresets">
          ${[['today','Today'],['yesterday','Yesterday'],['7d','7 days'],['30d','30 days'],['90d','90 days'],['month','This month'],['lastmonth','Last month'],['year','This year'],['custom','Custom']]
            .map(([k,l])=>`<button data-p="${k}" class="${k===current.preset?'on':''}">${l}</button>`).join('')}
        </div>
        <div class="rp-controls">
          <label>From <input type="date" id="rpFrom"></label>
          <label>To <input type="date" id="rpTo"></label>
          <label>Branch <select id="rpBranch"><option value="">All branches</option></select></label>
          <button class="excel-btn" id="rpApply">Apply</button>
          <button class="excel-btn secondary" id="rpPrint">Print / Save PDF</button>
          <button class="excel-btn" id="rpPack" title="Excel workbook for your accountant: P&amp;L, daily sales, products, branches, payments, expenses and the full sales ledger">Accountant pack (.xlsx)</button>
        </div>
        <div class="status-line" id="rpStatus"></div>
      </div>
      <div class="rp-subtabs" id="rpSubtabs">${subs.map(([k,l])=>`<button data-s="${k}" class="${k===sub?'on':''}">${l}</button>`).join('')}</div>
      <div id="rpBody"></div>
      <div class="rp-tip" id="rpTip"></div>`;
    $('rpPresets').onclick = e => { const b = e.target.closest('button'); if(!b) return; current.preset = b.dataset.p;
      if(b.dataset.p!=='custom'){ [current.from,current.to] = presetRange(b.dataset.p); } load(); };
    $('rpSubtabs').onclick = e => { const b = e.target.closest('button'); if(!b) return; sub = b.dataset.s;
      document.querySelectorAll('#rpSubtabs button').forEach(x=>x.classList.toggle('on',x===b)); render(); };
    $('rpApply').onclick = () => { current.preset='custom'; current.from=$('rpFrom').value; current.to=$('rpTo').value; current.branch=$('rpBranch').value; load(); };
    $('rpBranch').onchange = () => { current.branch=$('rpBranch').value; load(); };
    $('rpPrint').onclick = () => { document.body.setAttribute('data-print-title', `Azizo Butchery & Grill — ${subs.find(s=>s[0]===sub)[1]} report, ${R.range.from} to ${R.range.to}${current.branch?' — '+current.branch:''}`); window.print(); };
    $('rpPack').onclick = downloadPack;
  }

  async function authedFetch(path, opts){
    const res = await fetch(api(path), Object.assign({headers: authHeaders(), cache:'no-store'}, opts||{}));
    if(res.status===401 || res.status===403){ doLogout(); throw new Error('Session expired — please log in again'); }
    return res;
  }
  async function load(){
    if(!$('rpStatus')) return;
    if(!current.from){ [current.from,current.to] = presetRange(current.preset); }
    $('rpStatus').textContent = 'Crunching the numbers…';
    try{
      const res = await authedFetch('/api/reports/overview?' + qs());
      const data = await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data.error || `Server returned ${res.status}`);
      R = data;
      current.from = R.range.from; current.to = R.range.to;
      $('rpFrom').value = current.from; $('rpTo').value = current.to;
      const bsel = $('rpBranch'); const keep = current.branch;
      bsel.innerHTML = '<option value="">All branches</option>' + (R.branchOptions||[]).map(b=>`<option ${b===keep?'selected':''} value="${esc(b)}">${esc(b)}</option>`).join('');
      document.querySelectorAll('#rpPresets button').forEach(b=>b.classList.toggle('on',b.dataset.p===current.preset));
      $('rpStatus').textContent = `${R.range.days} day${R.range.days>1?'s':''}: ${R.range.from} to ${R.range.to}${current.branch?' · '+current.branch:' · all branches'}. Cancelled orders are excluded from sales. Times are Nairobi time.`;
      await loadExpenses();
      render();
    }catch(e){ $('rpStatus').textContent = 'Could not load reports: ' + e.message; }
  }
  async function loadExpenses(){
    try{ const r = await authedFetch('/api/reports/expenses?' + qs({})); const d = await r.json(); expenses = d.expenses || []; }catch(e){ expenses = []; }
  }
  async function downloadPack(){
    const btn = $('rpPack'); btn.disabled = true; const t = btn.textContent; btn.textContent = 'Preparing…';
    try{
      const res = await authedFetch('/api/reports/export.xlsx?' + qs());
      if(!res.ok) throw new Error('Server returned ' + res.status);
      const blob = await res.blob(); const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `azizo-accountant-pack-${current.from}-to-${current.to}.xlsx`; a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
    }catch(e){ alert("Couldn't create the pack: " + e.message); }
    finally{ btn.disabled = false; btn.textContent = t; }
  }

  // ---------- small building blocks ----------
  function delta(cur, prev, invert){
    if(!prev) return '<span class="rp-d flat">no earlier data</span>';
    const ch = Math.round((cur-prev)/prev*1000)/10; if(!isFinite(ch)) return '';
    const good = invert ? ch<=0 : ch>=0;
    return `<span class="rp-d ${ch===0?'flat':good?'up':'down'}">${ch>0?'▲':ch<0?'▼':'■'} ${Math.abs(ch)}% vs previous</span>`;
  }
  const tile = (label, value, foot, cls) => `<div class="rp-tile ${cls||''}"><div class="rp-tl">${label}</div><div class="rp-tv">${value}</div><div class="rp-tf">${foot||''}</div></div>`;
  const section = (title, hint, inner, extra) => `<div class="panel rp-sec"><div class="rp-sechead"><h3>${title}</h3>${extra||''}</div>${hint?`<p class="hint">${hint}</p>`:''}${inner}</div>`;
  function hbars(rows, opts){ // rows: [{label, value, text, sub}]
    opts = opts||{}; const max = Math.max(1, ...rows.map(r=>r.value));
    if(!rows.length) return '<p class="empty-note">Nothing to show for this period.</p>';
    return '<div class="rp-hb">' + rows.map(r=>`<div class="rp-hrow"><div class="rp-hl" title="${esc(r.label)}">${esc(r.label)}</div>
      <div class="rp-htrack"><div class="rp-hfill" style="width:${Math.max(1.5,r.value/max*100)}%;background:${r.color||GOLD}"></div></div>
      <div class="rp-hv">${esc(r.text)}${r.sub?`<small>${esc(r.sub)}</small>`:''}</div></div>`).join('') + '</div>';
  }
  function csvOf(cols, rows){
    const q = v => { v = v==null?'':String(v); return /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; };
    return [cols.map(c=>q(c.h)).join(','), ...rows.map(r=>cols.map(c=>q(c.csv ? c.csv(r) : r[c.k])).join(','))].join('\n');
  }
  let tableSeq = 0; const tables = {};
  function table(name, cols, rows, opts){
    opts = opts||{}; const id = 'rpt' + (++tableSeq); tables[id] = {name, cols, rows, sortKey:null, dir:-1};
    if(!rows.length) return '<p class="empty-note">Nothing to show for this period.</p>';
    return `<div class="rp-tw" id="${id}">${tableHtml(id)}</div><div class="rp-tbtn"><button class="rp-link" data-csv="${id}">⬇ Download CSV</button></div>`;
  }
  function tableHtml(id){
    const t = tables[id]; let rows = t.rows.slice();
    if(t.sortKey){ const c = t.cols.find(c=>c.h===t.sortKey); const g = r => c.sort ? c.sort(r) : r[c.k];
      rows.sort((a,b)=>{ const x=g(a), y=g(b); if(x==null) return 1; if(y==null) return -1; return (typeof x==='number'&&typeof y==='number' ? x-y : String(x).localeCompare(String(y))) * t.dir; }); }
    return `<table class="rp-t"><thead><tr>${t.cols.map(c=>`<th class="${c.cls||''} ${t.sortKey===c.h?'sorted':''}" data-sort="${esc(c.h)}" data-t="${id}">${esc(c.h)}${t.sortKey===c.h?(t.dir>0?' ▲':' ▼'):''}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r=>`<tr>${t.cols.map(c=>`<td class="${c.cls||''}">${c.fmt?c.fmt(r):esc(r[c.k])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  document.addEventListener('click', e => {
    const th = e.target.closest('th[data-sort]');
    if(th && tables[th.dataset.t]){ const t = tables[th.dataset.t]; if(t.sortKey===th.dataset.sort) t.dir*=-1; else { t.sortKey=th.dataset.sort; t.dir=-1; }
      $(th.dataset.t).innerHTML = tableHtml(th.dataset.t); return; }
    const b = e.target.closest('[data-csv]');
    if(b && tables[b.dataset.csv]){ const t = tables[b.dataset.csv];
      const blob = new Blob(['﻿'+csvOf(t.cols, t.rows)], {type:'text/csv;charset=utf-8'}); const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `azizo-${t.name}-${current.from}-to-${current.to}.csv`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),4000); }
  });

  // ---------- SVG charts ----------
  function barChart(items, o){
    o = o||{}; const narrow = window.innerWidth < 600; const W = narrow ? 360 : 720, H = o.h || 220, L = 52, Rr = 8, T = 12, B = 30, iw = W-L-Rr, ih = H-T-B;
    const max = Math.max(1, ...items.map(i=>i.value)); const nice = niceMax(max); const bw = iw/items.length;
    const every = Math.max(1, Math.ceil(items.length / Math.min(o.maxLabels||12, narrow ? 6 : 99)));
    let g = ''; for(let k=0;k<=4;k++){ const y = T+ih-(ih*k/4); g += `<line x1="${L}" x2="${W-Rr}" y1="${y}" y2="${y}" stroke="${GRID}" stroke-width="1"/><text x="${L-6}" y="${y+3.5}" text-anchor="end" font-size="10" fill="${MUTED}">${short(nice*k/4)}</text>`; }
    const bars = items.map((it,i)=>{ const h = it.value/nice*ih, x = L+i*bw+Math.min(2,bw*0.12), w = Math.max(1.5,bw-Math.min(4,bw*0.24)), y = T+ih-h;
      const rr = Math.min(3, w/2, h);
      return `<path d="M${x},${T+ih} V${y+rr} Q${x},${y} ${x+rr},${y} H${x+w-rr} Q${x+w},${y} ${x+w},${y+rr} V${T+ih} Z" fill="${it.color||o.color||GOLD}" ${it.value===0?'opacity="0"':''}/>
        <rect x="${L+i*bw}" y="${T}" width="${bw}" height="${ih}" fill="transparent" data-tip="${esc(it.tip)}" class="rp-hit"/>`; }).join('');
    const labels = items.map((it,i)=> i%every===0 ? `<text x="${L+i*bw+bw/2}" y="${H-10}" text-anchor="middle" font-size="10" fill="${MUTED}">${esc(it.label)}</text>` : '').join('');
    return `<svg class="rp-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria||'Bar chart')}">${g}${bars}${labels}</svg>`;
  }
  const niceMax = m => { const p = Math.pow(10, Math.floor(Math.log10(m))); const f = m/p; return (f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p; };
  const short = n => n>=1e6 ? (n/1e6).toFixed(n%1e6?1:0)+'M' : n>=1e3 ? (n/1e3).toFixed(n%1e3?1:0)+'k' : String(Math.round(n*10)/10);
  const tipEl = () => $('rpTip');
  document.addEventListener('mousemove', e => { const t = e.target.closest && e.target.closest('.rp-hit'); const el = tipEl(); if(!el) return;
    if(!t){ el.style.display='none'; return; } el.textContent = t.getAttribute('data-tip'); el.style.display='block';
    el.style.left = Math.min(window.innerWidth-190, e.clientX+14)+'px'; el.style.top = (e.clientY+16+window.scrollY)+'px'; });
  document.addEventListener('click', e => { const t = e.target.closest && e.target.closest('.rp-hit'); const el = tipEl(); if(!el||!t) return; // touch: tap to read
    el.textContent = t.getAttribute('data-tip'); el.style.display='block'; el.style.left = Math.min(window.innerWidth-190, e.clientX+8)+'px'; el.style.top=(e.clientY+16+window.scrollY)+'px'; });

  function dailySeries(){
    const d = R.daily; if(d.length <= 62) return {unit:'day', items:d.map(x=>({label:x.date.slice(5), value:x.revenue, tip:`${x.date}: ${money(x.revenue)} · ${x.orders} order${x.orders===1?'':'s'}`}))};
    const byWeek = d.length <= 400; const m = new Map();
    d.forEach(x=>{ const k = byWeek ? weekStart(x.date) : x.date.slice(0,7); const c = m.get(k)||{revenue:0,orders:0}; c.revenue+=x.revenue; c.orders+=x.orders; m.set(k,c); });
    return {unit: byWeek?'week':'month', items:[...m.entries()].map(([k,c])=>({label:byWeek?k.slice(5):k, value:c.revenue, tip:`${byWeek?'Week of ':''}${k}: ${money(c.revenue)} · ${c.orders} orders`}))};
  }
  function weekStart(ds){ const d = new Date(ds+'T00:00:00Z'); const w = (d.getUTCDay()+6)%7; d.setUTCDate(d.getUTCDate()-w); return d.toISOString().slice(0,10); }
  const waLink = (phone, text) => { const d = String(phone||'').replace(/\D/g,'').slice(-9); return d.length===9 ? `https://wa.me/254${d}${text?'?text='+encodeURIComponent(text):''}` : ''; };

  // ---------- views ----------
  function viewOverview(){
    const k = R.kpis, p = R.previous.kpis, pn = R.pnl, pp = R.previous.pnl, o = R.operations;
    const ds = dailySeries();
    const hrs = R.hours.map(h=>({label:String(h.hour).padStart(2,'0'), value:h.revenue, tip:`${String(h.hour).padStart(2,'0')}:00 – ${money(h.revenue)} · ${h.orders} orders`}));
    const wk = R.weekday.map(d=>({label:d.day, value:d.avgRevenue, tip:`${d.day}: average ${money(d.avgRevenue)} per ${d.day} (total ${money(d.revenue)}, ${d.orders} orders)`}));
    const st = {received:'Received',preparing:'Preparing',ready:'Ready',out_for_delivery:'Out for delivery',completed:'Completed',cancelled:'Cancelled'};
    const stColors = {cancelled:RED, completed:GREEN};
    return `
      <div class="rp-tiles">
        ${tile('Revenue', money(k.revenue), delta(k.revenue,p.revenue))}
        ${tile('Orders', num(k.orders), delta(k.orders,p.orders))}
        ${tile('Average order', money(k.avgOrder), delta(k.avgOrder,p.avgOrder))}
        ${tile('Gross profit', money(pn.grossProfit), `${pctTxt(pn.grossMargin)} margin${pn.costCoverage<90?' · estimate':''}`)}
        ${tile('Net profit', money(pn.netProfit), `${pctTxt(pn.netMargin)} after expenses`, pn.netProfit<0?'neg':'')}
        ${tile('Customers', num(k.customers), `${num(k.newCustomers)} new · ${num(k.returningCustomers)} returning`)}
        ${tile('Cancelled', pctTxt(k.cancelRate), `${num(k.cancelled)} orders · ${money(k.cancelledValue)}`, k.cancelRate>=8?'neg':'')}
        ${tile('Avg time to complete', o.avgMinutesToComplete==null?'—':o.avgMinutesToComplete+' min', o.timedOrders?`from ${o.timedOrders} timed orders`:'needs staff to update statuses')}
      </div>
      ${section('What to act on','Plain-language findings from your numbers for this period.', R.insights.length ? '<ul class="rp-ins">'+R.insights.map(i=>`<li class="${i.level}">${esc(i.text)}</li>`).join('')+'</ul>' : '<p class="empty-note">Nothing flagged.</p>')}
      ${section(`Sales trend (per ${ds.unit})`, 'Revenue including delivery fees. Hover or tap a bar for the figures.', ds.items.length?barChart(ds.items,{aria:'Revenue trend',maxLabels:14}):'')}
      <div class="rp-two">
        ${section('Busiest hours','Revenue by hour of day (Nairobi time) — plan staffing and fresh stock around the peaks.', barChart(hrs,{h:200,maxLabels:12,aria:'Revenue by hour'}))}
        ${section('Best weekdays','Average revenue for each weekday in the period.', barChart(wk,{h:200,maxLabels:7,aria:'Revenue by weekday'}))}
      </div>
      <div class="rp-two">
        ${section('Order outcomes','How every order in the period ended up.', hbars(Object.keys(R.statusCounts).map(s=>({label:st[s]||s, value:R.statusCounts[s], text:num(R.statusCounts[s]), color:stColors[s]||GOLD}))))}
        ${section('Pickup vs delivery','Share of orders and revenue.', hbars(R.fulfilment.map(f=>({label:f.type, value:f.orders, text:`${num(f.orders)} · ${money(f.revenue)}`, sub:`${f.share}% of orders · avg ${money(f.avgOrder)}`}))))}
      </div>`;
  }

  function viewProducts(){
    const P = R.products;
    const cols = [
      {h:'Item', k:'name', fmt:r=>`<strong>${esc(r.name)}</strong><br><small>${esc(r.cat)}</small>`},
      {h:'Qty sold', k:'qty', cls:'n', fmt:r=>num(r.qty)+' '+esc(r.unit)},
      {h:'Revenue', k:'revenue', cls:'n', fmt:r=>money(r.revenue), csv:r=>r.revenue},
      {h:'Share', k:'share', cls:'n', fmt:r=>pctTxt(r.share), csv:r=>r.share},
      {h:'Profit', k:'profit', cls:'n', fmt:r=>r.profit==null?'<span class="rp-na">no cost</span>':money(r.profit), csv:r=>r.profit==null?'':r.profit},
      {h:'Margin', k:'margin', cls:'n', fmt:r=>r.margin==null?'—':`<span class="${r.margin<15?'rp-bad':r.margin>=30?'rp-good':''}">${pctTxt(r.margin)}</span>`, csv:r=>r.margin==null?'':r.margin},
      {h:'Class', k:'abc', fmt:r=>`<span class="rp-abc ${r.abc}">${r.abc}</span>`},
    ];
    const cats = R.categories.map(c=>({label:c.category, value:c.revenue, text:money(c.revenue), sub:`${c.share}% of sales${c.margin!=null?' · margin '+c.margin+'%':''}`}));
    const lows = R.lowMargin.map(p=>`<li><strong>${esc(p.name)}</strong> — ${pctTxt(p.margin)} margin on ${money(p.revenue)} sales</li>`).join('');
    return `
      ${section('Best sellers','Click a column heading to sort. Class A items make 80% of your sales, B the next 15%, C the last 5% — keep A items always in stock. Margin appears once a cost price is entered for the item (Products tab).', table('products', cols, P))}
      <div class="rp-two">
        ${section('Sales by category','', hbars(cats))}
        ${section('Needs attention','', `
          <h4 class="rp-h4">Low margin (under 15%)</h4>${lows?`<ul class="rp-list">${lows}</ul>`:'<p class="empty-note">None — or no cost prices entered yet.</p>'}
          <h4 class="rp-h4">Sold out right now</h4>${R.soldOut.length?`<ul class="rp-list">${R.soldOut.map(s=>`<li>${esc(s.name)}</li>`).join('')}</ul>`:'<p class="empty-note">Nothing is marked sold out.</p>'}
          <h4 class="rp-h4">No sales in this period (${R.noSalesCount})</h4>${R.noSales.length?`<ul class="rp-list">${R.noSales.map(s=>`<li>${esc(s.name)} <small>(${esc(s.cat)})</small></li>`).join('')}</ul>`:'<p class="empty-note">Every menu item sold at least once.</p>'}`)}
      </div>`;
  }

  function viewBranches(){
    const cols = [
      {h:'Branch', k:'branch', fmt:r=>`<strong>${esc(r.branch)}</strong>`},
      {h:'Orders', k:'orders', cls:'n', fmt:r=>num(r.orders)},
      {h:'Revenue', k:'revenue', cls:'n', fmt:r=>money(r.revenue), csv:r=>r.revenue},
      {h:'Share', k:'share', cls:'n', fmt:r=>pctTxt(r.share), csv:r=>r.share},
      {h:'Avg order', k:'avgOrder', cls:'n', fmt:r=>money(r.avgOrder), csv:r=>r.avgOrder},
      {h:'Deliveries', k:'deliveries', cls:'n', fmt:r=>num(r.deliveries)},
      {h:'Cancelled', k:'cancelled', cls:'n', fmt:r=>`${num(r.cancelled)} (${pctTxt(r.cancelRate)})`, csv:r=>r.cancelled},
    ];
    const d = R.delivery;
    return `
      ${section('Branch performance','Which branches earn the most, and where orders get cancelled. Branch is whatever the customer picked at checkout.', hbars(R.branches.map(b=>({label:b.branch, value:b.revenue, text:money(b.revenue), sub:`${b.share}% of revenue · ${num(b.orders)} orders`}))))}
      ${section('Branch table','', table('branches', cols, R.branches))}
      <div class="rp-tiles">
        ${tile('Deliveries', num(d.orders), `${pctTxt(R.kpis.orders?d.orders/R.kpis.orders*100:0)} of orders`)}
        ${tile('Delivery fees collected', money(d.feesCollected), `avg ${money(d.avgFee)} per delivery`)}
        ${tile('Free deliveries', num(d.freeDeliveries), 'fee waived / zero')}
      </div>`;
  }

  function viewCustomers(){
    const k = R.kpis;
    const topCols = [
      {h:'Customer', k:'name', fmt:r=>`<strong>${esc(r.name||'—')}</strong><br><small>${esc(r.phone)}</small>`},
      {h:'Orders', k:'orders', cls:'n', fmt:r=>num(r.orders)},
      {h:'Spent', k:'spend', cls:'n', fmt:r=>money(r.spend), csv:r=>r.spend},
      {h:'Avg order', k:'avgOrder', cls:'n', fmt:r=>money(r.avgOrder), csv:r=>r.avgOrder},
      {h:'Phone', k:'phone', fmt:r=>{ const w = waLink(r.phone,''); return w?`<a href="${w}" target="_blank" rel="noopener">WhatsApp</a>`:''; }, csv:r=>r.phone},
    ];
    const lapCols = [
      {h:'Customer', k:'name', fmt:r=>`<strong>${esc(r.name||'—')}</strong><br><small>${esc(r.phone)}</small>`},
      {h:'Orders (all time)', k:'orders', cls:'n', fmt:r=>num(r.orders)},
      {h:'Lifetime spend', k:'spend', cls:'n', fmt:r=>money(r.spend), csv:r=>r.spend},
      {h:'Days away', k:'daysSince', cls:'n', fmt:r=>num(r.daysSince)},
      {h:'Win back', k:'phone', fmt:r=>{ const w = waLink(r.phone, `Hi ${r.name||''}, it's Azizo Butchery & Grill. We've missed you! Order fresh cuts this week and enjoy something special on us. 🥩`); return w?`<a href="${w}" target="_blank" rel="noopener">WhatsApp nudge</a>`:''; }, csv:r=>r.phone},
    ];
    return `
      <div class="rp-tiles">
        ${tile('Customers', num(k.customers), 'who ordered in this period')}
        ${tile('New customers', num(k.newCustomers), 'first order ever in this period')}
        ${tile('Repeat customers', num(k.returningCustomers), `${pctTxt(k.repeatRate)} of customers`)}
        ${tile('Orders per customer', String(k.ordersPerCustomer), 'average in this period')}
      </div>
      ${section('How often customers buy','Customers grouped by number of orders in the period.', hbars(R.frequency.map(f=>({label:f.label, value:f.customers, text:num(f.customers)}))))}
      ${section('Top customers','Your best buyers by spend — greet them by name and look after them. Customers are matched by phone number.', table('top-customers', topCols, R.topCustomers))}
      ${section('Customers to win back','Regulars (2+ orders ever) who have not ordered for 30+ days. Tap WhatsApp nudge to message them. This list is as of today, whatever dates are selected.', table('lapsed-customers', lapCols, R.lapsed))}
      ${section('Promo codes','Codes used in this period and the discount value they gave away.', table('promos', [
        {h:'Code', k:'code', fmt:r=>`<strong>${esc(r.code)}</strong>`}, {h:'Orders', k:'orders', cls:'n', fmt:r=>num(r.orders)},
        {h:'Revenue', k:'revenue', cls:'n', fmt:r=>money(r.revenue), csv:r=>r.revenue}, {h:'Discount given', k:'discount', cls:'n', fmt:r=>money(r.discount), csv:r=>r.discount}], R.promos))}`;
  }

  function viewPayments(){
    const c = R.reconciliation;
    const cols = [
      {h:'Method', k:'method', fmt:r=>`<strong>${esc(r.method)}</strong>`}, {h:'Orders', k:'orders', cls:'n', fmt:r=>num(r.orders)},
      {h:'Revenue', k:'revenue', cls:'n', fmt:r=>money(r.revenue), csv:r=>r.revenue}, {h:'Share', k:'share', cls:'n', fmt:r=>pctTxt(r.share), csv:r=>r.share},
      {h:'Collected (completed)', k:'collected', cls:'n', fmt:r=>money(r.collected), csv:r=>r.collected},
      {h:'Still outstanding', k:'outstanding', cls:'n', fmt:r=>r.outstanding?`<span class="rp-bad">${money(r.outstanding)}</span> <small>(${r.outstandingOrders} open)</small>`:'—', csv:r=>r.outstanding},
    ];
    return `
      ${section('Payment methods','"Collected" is money for completed orders. "Outstanding" is for orders still being prepared or delivered — cash not yet in your hand.', hbars(R.payments.map(p=>({label:p.method, value:p.revenue, text:money(p.revenue), sub:`${p.share}% · ${num(p.orders)} orders`}))))}
      ${section('Payment table','', table('payments', cols, R.payments))}
      ${section('M-Pesa & cash reconciliation','Use these to tally against your M-Pesa statement and your cash banking.', `<div class="rp-tiles">
        ${tile('M-Pesa orders', num(c.mpesaOrders), money(c.mpesaValue))}
        ${tile('With receipt code', num(c.mpesaWithReceipt), money(c.mpesaReceiptValue))}
        ${tile('Completed, no receipt', num(c.completedWithoutReceipt), c.completedWithoutReceiptValue?money(c.completedWithoutReceiptValue)+' to verify':'all matched', c.completedWithoutReceipt?'neg':'')}
        ${tile('Cash orders', num(c.cashOrders), `${money(c.cashToBank)} completed, to bank`)}
        ${tile('STK push', `${num(c.stkSuccess)} ok`, `${num(c.stkPending)} pending · ${num(c.stkFailed)} failed`)}
      </div>`)}`;
  }

  function viewAccounts(){
    const p = R.pnl, tax = parseFloat(localStorage.getItem('azizoTaxRate')||'');
    const row = (l,v,cls,note) => `<tr class="${cls||''}"><td>${l}${note?`<small>${note}</small>`:''}</td><td class="n">${v}</td></tr>`;
    const opx = R.expenseByCategory.filter(e=>e.category!=='Stock purchases');
    const eCols = [
      {h:'Date', k:'expense_date'}, {h:'Category', k:'category'}, {h:'Description', k:'description'},
      {h:'Branch', k:'branch', fmt:r=>esc(r.branch||'All')}, {h:'Paid via', k:'paid_via', fmt:r=>esc(r.paid_via||'')},
      {h:'Amount', k:'amount', cls:'n', fmt:r=>money(r.amount), csv:r=>r.amount},
      {h:'', k:'id', fmt:r=>`<button class="rp-link rp-edit" data-edit="${r.id}">Edit</button> <button class="rp-link rp-del" data-del="${r.id}">Delete</button>`, csv:r=>''}];
    const methodSel = `<select id="rpCogs"><option value="" ${!current.cogs?'selected':''}>Auto</option><option value="cost_price" ${current.cogs==='cost_price'?'selected':''}>Cost prices</option><option value="purchases" ${current.cogs==='purchases'?'selected':''}>Stock purchases</option></select>`;
    return `
      ${section('Profit & loss statement','Management accounts for the selected period and branch. Revenue excludes cancelled orders.', `
        <table class="rp-pl"><tbody>
          ${row('Item sales', money(p.itemSales))}${row('Delivery fees', money(p.deliveryFees))}
          ${row('<strong>Total revenue</strong>', '<strong>'+money(p.revenue)+'</strong>','tot')}
          ${row('Cost of goods sold', '('+money(p.cogs)+')','',esc(p.cogsNote))}
          ${row('<strong>Gross profit</strong>', '<strong>'+money(p.grossProfit)+'</strong> <small>'+pctTxt(p.grossMargin)+'</small>','tot')}
          ${opx.map(e=>row(esc(e.category), '('+money(e.amount)+')')).join('')}
          ${row('Total operating expenses', '('+money(p.operatingExpenses)+')')}
          ${row('<strong>Net profit before income tax</strong>', `<strong class="${p.netProfit<0?'rp-bad':'rp-good'}">${money(p.netProfit)}</strong> <small>${pctTxt(p.netMargin)}</small>`,'tot')}
        </tbody></table>
        <div class="rp-acct-opts">
          <label>Cost of goods basis ${methodSel}</label>
          <label>Tax rate on turnover (%) <input type="number" id="rpTax" step="0.1" min="0" max="100" placeholder="e.g. your KRA rate" value="${isNaN(tax)?'':tax}" style="width:150px"></label>
          <span id="rpTaxOut">${isNaN(tax)||!tax?'':`Estimated tax on revenue: <strong>${money(p.revenue*tax/100)}</strong>`}</span>
        </div>
        <p class="hint">Estimates only — tax rules and rates depend on your KRA registration (Turnover Tax or VAT), so confirm figures with your accountant. “Auto” uses cost prices when they cover 90%+ of sales, otherwise the stock purchases you record below.</p>`)}
      ${section('<span id="x_title">Record an expense</span>','Add rent, salaries, electricity, transport, stock purchases and so on. These feed the profit figures above. Stock purchases are only used as cost of goods when cost prices are incomplete (or you pick that basis).', `
        <form class="rp-exp" id="rpExpForm">
          <label>Date <input type="date" id="x_date" required value="${todayLocal()}"></label>
          <label>Category <select id="x_cat" required>${R.expenseCategories.map(c=>`<option>${esc(c)}</option>`).join('')}</select></label>
          <label>Amount (KSh) <input type="number" id="x_amt" min="1" step="1" required></label>
          <label>Branch <select id="x_branch"><option value="">All / head office</option>${(R.branchOptions||[]).map(b=>`<option>${esc(b)}</option>`).join('')}</select></label>
          <label>Paid via <select id="x_via"><option value="">—</option><option>Cash</option><option>M-Pesa</option><option>Bank</option><option>Credit (unpaid)</option></select></label>
          <label class="wide">Description <input type="text" id="x_desc" maxlength="200" placeholder="e.g. October rent, 2 carcasses from supplier"></label>
          <button class="excel-btn" type="submit" id="x_submit">Add expense</button>
          <button class="excel-btn secondary" type="button" id="x_cancel" style="display:none">Cancel edit</button>
        </form><div class="error-msg" id="rpExpErr"></div>`)}
      ${section('Expenses in this period', `Total ${money(expenses.reduce((a,e)=>a+e.amount,0))} across ${expenses.length} entr${expenses.length===1?'y':'ies'}.`,
        hbars(R.expenseByCategory.map(e=>({label:e.category, value:e.amount, text:money(e.amount), sub:`${e.share}% · ${e.entries} entr${e.entries===1?'y':'ies'}`}))) + table('expenses', eCols, expenses))}
      ${section('Fill in costs on older orders','Orders placed before you entered cost prices show sales but no profit. This copies each product\'s <strong>current</strong> cost price onto past order lines that have no cost yet, so older sales get a margin too. Lines that already have a cost are never changed. Results are approximate if your buying prices have moved.', `
        <div class="rp-acct-opts"><label>Apply to <select id="bf_scope"><option value="range">Orders in the selected dates</option><option value="all">All past orders</option></select></label>
          <button class="excel-btn secondary" id="bf_preview" type="button">Check how many</button><button class="excel-btn" id="bf_apply" type="button" disabled>Apply</button></div>
        <div class="status-line" id="bf_msg"></div>`)}`;
  }

  function render(){
    const body = $('rpBody'); if(!R || !body) return;
    tableSeq = 0; for(const k in tables) delete tables[k];
    body.innerHTML = ({overview:viewOverview, products:viewProducts, branches:viewBranches, customers:viewCustomers, payments:viewPayments, accounts:viewAccounts}[sub])();
    if(sub==='accounts') wireAccounts();
  }
  function wireAccounts(){
    $('rpCogs').onchange = () => { current.cogs = $('rpCogs').value; load(); };
    $('rpTax').oninput = () => { const v = parseFloat($('rpTax').value); try{ localStorage.setItem('azizoTaxRate', isNaN(v)?'':String(v)); }catch(e){}
      $('rpTaxOut').innerHTML = (isNaN(v)||!v) ? '' : `Estimated tax on revenue: <strong>${money(R.pnl.revenue*v/100)}</strong>`; };
    let editId = null;
    const resetForm = () => { editId = null; $('rpExpForm').reset(); $('x_date').value = todayLocal(); $('x_title').textContent = 'Record an expense'; $('x_submit').textContent = 'Add expense'; $('x_cancel').style.display = 'none'; };
    $('x_cancel').onclick = resetForm;
    document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { const e = expenses.find(x => String(x.id) === b.dataset.edit); if(!e) return; editId = e.id;
      $('x_date').value = e.expense_date; $('x_cat').value = e.category; $('x_amt').value = e.amount; $('x_branch').value = e.branch || ''; $('x_via').value = e.paid_via || ''; $('x_desc').value = e.description || '';
      $('x_title').textContent = 'Edit expense #' + e.id; $('x_submit').textContent = 'Save changes'; $('x_cancel').style.display = ''; $('rpExpForm').scrollIntoView({behavior:'smooth', block:'center'}); });
    $('rpExpForm').onsubmit = async ev => { ev.preventDefault(); const err = $('rpExpErr'); err.textContent = '';
      const body = {expense_date:$('x_date').value, category:$('x_cat').value, amount:$('x_amt').value, branch:$('x_branch').value, paid_via:$('x_via').value, description:$('x_desc').value};
      try{ const res = await authedFetch('/api/reports/expenses' + (editId ? '/' + editId : ''), {method: editId ? 'PUT' : 'POST', headers:authHeaders({'Content-Type':'application/json'}), body:JSON.stringify(body)});
        const d = await res.json().catch(()=>({})); if(!res.ok) throw new Error(d.error||('Save failed ('+res.status+')'));
        await load(); }catch(e){ err.textContent = e.message; } };
    const bf = async preview => { const msg = $('bf_msg'); msg.textContent = preview ? 'Checking…' : 'Applying…';
      try{ const res = await authedFetch('/api/reports/backfill-costs', {method:'POST', headers:authHeaders({'Content-Type':'application/json'}),
          body:JSON.stringify({scope:$('bf_scope').value, from:current.from, to:current.to, preview})});
        const d = await res.json().catch(()=>({})); if(!res.ok) throw new Error(d.error||('Failed ('+res.status+')'));
        if(preview){ msg.textContent = d.lines ? `${num(d.lines)} order line(s) in ${num(d.orders)} order(s) can be filled in. Click Apply to do it.` : 'Nothing to fill in — every order line already has a cost, or the products involved have no cost price yet.'; $('bf_apply').disabled = !d.lines; }
        else { msg.textContent = `Done: ${num(d.lines)} order line(s) in ${num(d.orders)} order(s) updated.`; $('bf_apply').disabled = true; await load(); sub='accounts'; render(); const m2 = $('bf_msg'); if(m2) m2.textContent = `Done: ${num(d.lines)} order line(s) in ${num(d.orders)} order(s) updated. Reports refreshed.`; } }
      catch(e){ msg.textContent = e.message; } };
    $('bf_preview').onclick = () => bf(true); $('bf_apply').onclick = () => { if(confirm('Copy current cost prices onto older order lines that have no cost?')) bf(false); };
    $('bf_scope').onchange = () => { $('bf_apply').disabled = true; $('bf_msg').textContent = ''; };
    document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if(!confirm('Delete this expense?')) return;
      try{ const res = await authedFetch('/api/reports/expenses/'+b.dataset.del, {method:'DELETE'}); if(!res.ok) throw new Error('Delete failed'); await load(); }catch(e){ alert(e.message); } });
  }

  window.AzizoReports = { open(){ if(!loaded){ loaded = true; mount(); } load(); } };
})();
