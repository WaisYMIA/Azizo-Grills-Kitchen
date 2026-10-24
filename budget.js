/* Azizo Meat Budget Planner — builds a personal weekly / monthly / annual meat budget and a PDF.
   Uses the shared helpers from app.js (CONFIG, apiAvailable, apiBase, resolve of cart helpers). Nothing here touches checkout. */
(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const DAYS_LONG = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const PERIODS = { week:{label:'Weekly', weeks:1, noun:'week'}, month:{label:'Monthly', weeks:52/12, noun:'month'}, year:{label:'Annual', weeks:52, noun:'year'} };
  const BIRD_KG = 1.3; // edible weight we assume for a whole bird
  const KEY = 'azizoBudgetPlan';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ksh = n => 'KSh ' + Math.round(n || 0).toLocaleString('en-KE');

  // Short, plain-language benefits per item (general nutrition information, not medical advice).
  const BENEFITS = {
    f1:'Lean beef: iron, zinc and vitamin B12 for energy and immunity.',
    f2:'Rich, well-marbled beef: iron, zinc, B12 and protein. Enjoy as a treat cut.',
    f3:'Versatile and budget-friendly beef: iron, zinc and B12.',
    f10:'Tender beef: protein, iron and B12.', f11:'Premium beef: protein, iron, zinc and B12.', f12:'Lean beef: protein, iron and B12.',
    f13:'Beef with bone: iron, zinc and B12; richer in fat.', f14:'Collagen-rich oxtail: iron, zinc and protein; great slow-cooked.',
    f15:'Liver is very rich in vitamin A, iron, folate and B12. A small portion goes a long way.',
    f16:'Bones for soup: collagen and minerals such as calcium. Comforting and low cost.',
    f4:'Pork: thiamine (B1), selenium and protein for energy.', f5:'Pork ribs: protein, thiamine and zinc; richer in fat.',
    f6:'Chicken: lean protein with niacin and vitamin B6.', f7:'Very lean protein, low in fat, with niacin and B6.',
    f17:'Chicken thighs: protein with more iron and zinc than breast.', f18:'Chicken: protein, B vitamins and zinc.', f19:'Chicken wings: protein and B vitamins; richer in fat.',
    f20:'Chicken liver: rich in vitamin A, folate and iron.', f21:'Gizzard: lean protein with iron and zinc.',
    f28:'Free-range chicken: lean protein, B vitamins and zinc.',
    f8:'Tilapia: lean protein, selenium and B12; light on the stomach.', f9:'Nile perch: lean white fish with protein, iodine and selenium.',
    f22:'Prawns: high protein, iodine and selenium; low in fat.', f23:'Salmon: omega-3 fats, vitamin D and B12 for heart and brain health.',
    f24:'Omena eaten whole: calcium, iron, zinc and omega-3. Excellent value for bones.', f30:'Fresh omena: calcium, iron, zinc and omega-3. Excellent value.',
    f29:'Smoked tilapia: protein, selenium and B12; smoking adds salt.',
    f25:'Goat: leaner than beef, with iron, zinc and B12.', f26:'Goat meat: lean protein, iron, zinc and B12.', f27:'Mutton/lamb: protein, iron, zinc and B12.',
    f31:'Convenient protein; higher in salt and fat, so best in moderation.', f32:'Convenient protein; higher in salt and fat, so best in moderation.'
  };
  const CAT_BENEFITS = { Beef:'Beef: iron, zinc and vitamin B12.', Pork:'Pork: thiamine, selenium and protein.', Chicken:'Chicken: lean protein and B vitamins.',
    Fish:'Fish: lean protein, iodine and selenium; some omega-3.', Goat:'Goat: lean protein, iron and zinc.', Sausages:'Convenient protein; enjoy in moderation.' };
  const benefit = m => BENEFITS[m.id] || CAT_BENEFITS[m.cat] || 'A good source of protein.';
  function defaultGrams(m){ if(/liver|gizzard|omena|dagaa/i.test(m.name)) return 100; return ({Chicken:250, Goat:250, Sausages:100}[m.cat]) || 200; }

  const TEMPLATES = {
    family: { name:'Family week', rows:[['f3',[0,3]],['f7',[1,4]],['f8',[2,5]],['f26',[6]]] },
    lean:   { name:'Lean & light', rows:[['f7',[0,2,4]],['f9',[1,3]],['f8',[5]],['f3',[6]]] },
    grill:  { name:'Weekend grill', rows:[['f17',[4]],['f2',[5]],['f5',[6]],['f8',[2]]] }
  };

  let meats = []; // [{id,name,cat,kind,unit,price,pricePerKg,inStock}]
  let state = { name:'', people:4, period:'month', budget:'', rows:[] };
  let toastTimer;

  // ---------- catalog ----------
  function toMeat(i){
    const bird = i.unit === 'bird';
    return { id:i.id, name:i.name, cat:i.cat, kind:i.kind || '', unit:i.unit, price:i.price, pricePerKg: bird ? i.price / BIRD_KG : i.price, inStock: i.inStock !== false, raw:i };
  }
  async function loadCatalog(){
    let data = null;
    try{
      if(typeof apiAvailable === 'function' && apiAvailable()){
        const r = await fetch(apiBase() + '/api/products', {cache:'no-store'}); if(r.ok) data = await r.json();
      }
    }catch(e){}
    if(!data || !Array.isArray(data.freshItems)){
      try{ const r = await fetch('./products.json', {cache:'no-store'}); data = await r.json(); }catch(e){ data = null; }
    }
    let list = data && Array.isArray(data.freshItems) ? data.freshItems : (typeof freshItems !== 'undefined' ? freshItems : []);
    meats = list.filter(i => i.unit === 'kg' || i.unit === 'bird').map(toMeat);
  }
  const meatById = id => meats.find(m => m.id === id);

  // ---------- state ----------
  function save(){ try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(e){} }
  function restore(){
    try{ const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if(s && typeof s === 'object'){
      state.name = String(s.name || '').slice(0,60); state.people = Math.min(30, Math.max(1, parseInt(s.people) || 4));
      state.period = PERIODS[s.period] ? s.period : 'month'; state.budget = s.budget ? String(s.budget) : '';
      state.rows = Array.isArray(s.rows) ? s.rows.filter(r => r && meatById(r.id)).map(r => ({ id:r.id, days:(r.days||[]).filter(d => d>=0 && d<7), grams:Math.min(600, Math.max(50, parseInt(r.grams) || defaultGrams(meatById(r.id)))) })) : []; } }catch(e){}
  }
  function applyTemplate(key){
    const t = TEMPLATES[key]; if(!t) return;
    state.rows = t.rows.filter(([id]) => meatById(id)).map(([id,days]) => ({ id, days:days.slice(), grams:defaultGrams(meatById(id)) }));
    renderAll(); save();
  }

  // ---------- maths ----------
  function calc(){
    const weeks = PERIODS[state.period].weeks;
    const rows = state.rows.map(r => { const m = meatById(r.id); const n = r.days.length;
      const kgWeek = n * state.people * r.grams / 1000; const costWeek = kgWeek * m.pricePerKg;
      return { r, m, days:n, kgWeek, costWeek, costPeriod: costWeek * weeks, kgPeriod: kgWeek * weeks }; });
    const week = rows.reduce((a,x) => a + x.costWeek, 0);
    const perDay = DAYS.map((d,i) => { const items = state.rows.filter(r => r.days.includes(i)).map(r => ({ m:meatById(r.id), cost: state.people * r.grams / 1000 * meatById(r.id).pricePerKg }));
      return { day:d, long:DAYS_LONG[i], items, cost: items.reduce((a,x) => a + x.cost, 0) }; });
    const totals = { week, month: week * 52/12, year: week * 52, period: week * weeks };
    const budget = parseFloat(state.budget) > 0 ? parseFloat(state.budget) : 0;
    const mealDays = perDay.filter(d => d.items.length).length;
    return { rows, perDay, totals, budget, weeks, perPersonDay: mealDays && state.people ? week / (mealDays * state.people) : 0, mealDays };
  }
  function tips(c){
    const out = []; const used = new Set(state.rows.map(r => r.id));
    c.rows.slice().sort((a,b) => b.costWeek - a.costWeek).forEach(x => {
      if(out.length >= 3 || !x.days) return;
      const pool = meats.filter(m => m.cat === x.m.cat && !used.has(m.id) && m.inStock && m.pricePerKg <= x.m.pricePerKg * 0.8 &&
        !(/bone|liver|gizzard|omena|dagaa|sausage/i.test(m.name) && !/bone|liver|gizzard|omena|dagaa|sausage/i.test(x.m.name)));
      if(!pool.length) return; const alt = pool.sort((a,b) => b.pricePerKg - a.pricePerKg)[0]; // the closest cheaper option, not the rock-bottom one
      const save = (x.m.pricePerKg - alt.pricePerKg) * x.kgPeriod;
      if(save >= 100) out.push(`Swap ${x.m.name} for ${alt.name} and save about ${ksh(save)} per ${PERIODS[state.period].noun}. ${benefit(alt)}`);
    });
    const servings = g => state.rows.filter(g).reduce((a,r) => a + r.days.length, 0);
    const red = servings(r => meatById(r.id).kind === 'red'), fish = servings(r => meatById(r.id).cat === 'Fish');
    if(state.rows.length && !fish) out.push('Variety tip: add a fish day each week for omega-3 fats. Tilapia and omena are affordable.');
    if(red > 4) out.push(`Variety tip: ${red} red-meat servings a week is a lot. Swapping one for chicken or fish adds variety and often saves money.`);
    return out;
  }

  // ---------- render ----------
  function dayText(days){ return days.length ? days.slice().sort().map(d => DAYS[d]).join(', ') : 'No days picked'; }
  function renderRows(){
    const c = calc(); const body = $('bpRows'); const noun = PERIODS[state.period].noun;
    $('bpPeriodHead').textContent = 'Cost per ' + noun;
    if(!state.rows.length){ body.innerHTML = '<tr class="bp-empty"><td colspan="7">Start by adding a meat below, or pick a ready-made starter plan.</td></tr>'; return; }
    body.innerHTML = c.rows.map((x, idx) => {
      const opts = meats.filter(m => m.id === x.m.id || !state.rows.some(r => r.id === m.id));
      const cats = [...new Set(opts.map(m => m.cat))];
      const sel = cats.map(cat => `<optgroup label="${esc(cat)}">${opts.filter(m => m.cat === cat).map(m => `<option value="${esc(m.id)}" ${m.id === x.m.id ? 'selected' : ''}>${esc(m.name)}${m.inStock ? '' : ' (sold out)'}</option>`).join('')}</optgroup>`).join('');
      return `<tr data-i="${idx}">
        <td data-label="Meat"><select class="bp-sel" data-act="meat" aria-label="Meat">${sel}</select><div class="bp-priceline">${ksh(x.m.price)} per ${x.m.unit}${x.m.inStock ? '' : ' - sold out'} <button class="bp-del" data-act="del" title="Remove" aria-label="Remove ${esc(x.m.name)}">Remove</button></div></td>
        <td data-label="Days"><div class="bp-days" role="group" aria-label="Days for ${esc(x.m.name)}">${DAYS.map((d,i) => `<button type="button" class="bp-day ${x.r.days.includes(i) ? 'on' : ''}" data-act="day" data-d="${i}" aria-pressed="${x.r.days.includes(i)}" title="${DAYS_LONG[i]}">${d.charAt(0)}<span>${d.slice(1)}</span></button>`).join('')}</div><div class="bp-dayline">${x.days} day${x.days === 1 ? '' : 's'} a week</div></td>
        <td data-label="Portion per person"><select class="bp-sel sm" data-act="grams" aria-label="Portion per person">${[100,150,200,250,300,400].map(g => `<option value="${g}" ${g === x.r.grams ? 'selected' : ''}>${g} g</option>`).join('')}</select></td>
        <td data-label="Meat needed / week" class="num">${(Math.round(x.kgWeek * 10) / 10).toFixed(1)} kg${x.m.unit === 'bird' ? `<small>about ${Math.ceil(x.kgWeek / BIRD_KG - 1e-9)} bird${Math.ceil(x.kgWeek / BIRD_KG - 1e-9) === 1 ? '' : 's'}</small>` : ''}</td>
        <td data-label="Cost / week" class="num">${ksh(x.costWeek)}</td>
        <td data-label="Cost / ${noun}" class="num strong">${ksh(x.costPeriod)}</td>
        <td data-label="Nutritional benefits" class="bp-nut">${esc(benefit(x.m))}</td></tr>`; }).join('');
  }
  function renderSummary(){
    const c = calc(), T = c.totals, noun = PERIODS[state.period].noun;
    $('bpTotWeek').textContent = ksh(T.week); $('bpTotMonth').textContent = ksh(T.month); $('bpTotYear').textContent = ksh(T.year);
    document.querySelectorAll('.bp-tot').forEach(el => el.classList.toggle('active', el.dataset.p === state.period));
    $('bpPerPerson').textContent = c.mealDays ? `${ksh(c.perPersonDay)} per person on a meat day` : 'Add a meat and pick its days';
    const st = $('bpBudgetStatus'), bar = $('bpBar'), fill = $('bpBarFill');
    if(c.budget){ const diff = c.budget - T.period; const pct = Math.min(100, T.period / c.budget * 100); bar.style.display = '';
      fill.style.width = pct + '%'; fill.className = diff >= 0 ? 'ok' : 'over';
      st.innerHTML = diff >= 0 ? `<strong>${ksh(diff)}</strong> to spare on your ${ksh(c.budget)} ${noun}ly budget.` : `<strong>${ksh(-diff)} over</strong> your ${ksh(c.budget)} ${noun}ly budget. See the swaps below.`;
      st.className = 'bp-status ' + (diff >= 0 ? 'ok' : 'over'); }
    else { bar.style.display = 'none'; st.className = 'bp-status'; st.textContent = `Enter a ${noun}ly budget above to see how your plan compares.`; }
    $('bpTimetable').innerHTML = c.perDay.map(d => `<div class="bp-tt ${d.items.length ? '' : 'rest'}"><div class="bp-tt-day">${d.day}</div><div class="bp-tt-meat">${d.items.length ? d.items.map(i => esc(i.m.name)).join(', ') : 'No meat planned'}</div><div class="bp-tt-cost">${d.items.length ? ksh(d.cost) : ''}</div></div>`).join('');
    const t = tips(c); $('bpTips').innerHTML = t.length ? '<h4>Ideas to save and eat well</h4><ul>' + t.map(x => `<li>${esc(x)}</li>`).join('') + '</ul>' : '';
    const hasRows = c.rows.some(x => x.days);
    ['bpPdf','bpShare','bpCart'].forEach(id => { $(id).disabled = !hasRows; });
    $('bpBarMini').textContent = ksh(T.period) + ' / ' + noun;
  }
  function renderAll(){
    $('bpName').value = state.name; $('bpPeople').value = state.people; $('bpBudget').value = state.budget;
    document.querySelectorAll('#bpPeriod button').forEach(b => { const on = b.dataset.p === state.period; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
    $('bpBudgetLabel').textContent = PERIODS[state.period].label + ' budget (KSh, optional)';
    renderRows(); renderSummary(); const add = $('bpAdd'); add.disabled = state.rows.length >= meats.length;
  }

  // ---------- events ----------
  function wire(){
    $('bpName').addEventListener('input', e => { state.name = e.target.value.slice(0,60); save(); });
    $('bpPeople').addEventListener('input', e => { state.people = Math.min(30, Math.max(1, parseInt(e.target.value) || 1)); renderRows(); renderSummary(); save(); });
    $('bpPeopleMinus').onclick = () => { state.people = Math.max(1, state.people - 1); $('bpPeople').value = state.people; renderRows(); renderSummary(); save(); };
    $('bpPeoplePlus').onclick = () => { state.people = Math.min(30, state.people + 1); $('bpPeople').value = state.people; renderRows(); renderSummary(); save(); };
    $('bpBudget').addEventListener('input', e => { state.budget = e.target.value; renderSummary(); save(); });
    $('bpPeriod').addEventListener('click', e => { const b = e.target.closest('button'); if(!b) return; state.period = b.dataset.p; renderAll(); save(); });
    $('bpAdd').onclick = () => { const m = meats.find(x => !state.rows.some(r => r.id === x.id) && x.inStock) || meats.find(x => !state.rows.some(r => r.id === x.id)); if(!m) return;
      state.rows.push({ id:m.id, days:[], grams:defaultGrams(m) }); renderAll(); save(); };
    $('bpTemplates').addEventListener('click', e => { const b = e.target.closest('button[data-t]'); if(b) applyTemplate(b.dataset.t); });
    $('bpClear').onclick = () => { if(state.rows.length && !confirm('Clear all meats from this plan?')) return; state.rows = []; renderAll(); save(); };
    $('bpRows').addEventListener('click', e => { const b = e.target.closest('[data-act]'); if(!b) return; const tr = b.closest('tr'); const row = state.rows[+tr.dataset.i]; if(!row) return;
      if(b.dataset.act === 'day'){ const d = +b.dataset.d; row.days = row.days.includes(d) ? row.days.filter(x => x !== d) : row.days.concat(d); renderRows(); renderSummary(); save(); }
      else if(b.dataset.act === 'del'){ state.rows.splice(+tr.dataset.i, 1); renderAll(); save(); } });
    $('bpRows').addEventListener('change', e => { const b = e.target.closest('[data-act]'); if(!b) return; const row = state.rows[+b.closest('tr').dataset.i]; if(!row) return;
      if(b.dataset.act === 'meat'){ row.id = b.value; row.grams = defaultGrams(meatById(row.id)); renderAll(); save(); }
      else if(b.dataset.act === 'grams'){ row.grams = +b.value; renderRows(); renderSummary(); save(); } });
    $('bpPdf').onclick = downloadPdf; $('bpShare').onclick = shareWhatsApp; $('bpCart').onclick = addWeekToCart;
  }

  // ---------- share / cart ----------
  function planText(){
    const c = calc(), T = c.totals; const lines = [`*Meat budget${state.name ? ' for ' + state.name : ''}* (${state.people} ${state.people === 1 ? 'person' : 'people'})`, ''];
    c.rows.filter(x => x.days).forEach(x => lines.push(`- ${x.m.name}: ${dayText(x.r.days)}, ${x.r.grams} g each = ${ksh(x.costWeek)}/week`));
    lines.push('', `Per week: ${ksh(T.week)}`, `Per month: ${ksh(T.month)}`, `Per year: ${ksh(T.year)}`);
    if(c.budget) lines.push(`Budget (${PERIODS[state.period].noun}): ${ksh(c.budget)}`);
    lines.push('', 'Planned with Azizo Butchery & Grill: ' + location.origin + location.pathname.replace(/[^/]*$/, '') + 'budget.html');
    return lines.join('\n');
  }
  function shareWhatsApp(){ window.open('https://wa.me/?text=' + encodeURIComponent(planText()), '_blank', 'noopener'); }
  function toast(msg){ const t = $('toast'), m = $('toastMsg'); if(!t || !m){ alert(msg); return; } m.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200); }
  function addWeekToCart(){
    const c = calc(); let added = 0, skipped = 0;
    c.rows.filter(x => x.days).forEach(x => {
      if(!x.m.inStock){ skipped++; return; }
      const qty = x.m.unit === 'bird' ? Math.ceil(x.kgWeek / BIRD_KG - 1e-9) : Math.ceil(x.kgWeek - 1e-9);
      try{ const prev = (cart[x.m.id] && cart[x.m.id].qty) || 0; cart[x.m.id] = { item: x.m.raw, qty: prev + qty, source:'budget' }; added++; }catch(e){ skipped++; }
    });
    if(added){ try{ updateCartUI(); }catch(e){} toast(`${added} meat${added === 1 ? '' : 's'} for one week added to your cart` + (skipped ? ` (${skipped} skipped)` : '')); try{ openCart(); }catch(e){} }
    else toast('Nothing could be added to the cart.');
  }

  // ---------- PDF ----------
  async function logoData(){ try{ const r = await fetch('logo.png'); const b = await r.blob(); return await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }); }catch(e){ return null; } }
  const pdfText = s => String(s).replace(/[^\x20-\x7E -ÿ]/g, '');
  async function downloadPdf(){
    if(!(window.jspdf && window.jspdf.jsPDF)){ return printFallback(); }
    const c = calc(), T = c.totals, P = PERIODS[state.period], noun = P.noun;
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ orientation:'landscape', unit:'pt', format:'a4' });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 36;
    const logo = await logoData(); if(logo){ try{ doc.addImage(logo, 'PNG', M, 28, 46, 46); }catch(e){} }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(22,18,16); doc.text('Meat Budget Plan', M + 58, 46);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(90,78,72);
    doc.text(pdfText(`Prepared for ${state.name || 'you'}  |  ${state.people} ${state.people === 1 ? 'person' : 'people'}  |  ${P.label} plan  |  ${new Date().toLocaleDateString('en-GB', {day:'numeric', month:'long', year:'numeric'})}`), M + 58, 64);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(140,100,20); doc.text('Azizo Butchery & Grill', W - M, 46, { align:'right' });
    doc.setFont('helvetica', 'normal'); doc.setTextColor(90,78,72); doc.text('Nairobi  |  Open 24 hours', W - M, 60, { align:'right' });

    const body = c.rows.filter(x => x.days).map(x => [pdfText(x.m.name), pdfText(dayText(x.r.days)), x.r.grams + ' g', (Math.round(x.kgWeek * 10) / 10).toFixed(1) + ' kg', ksh(x.costWeek), ksh(x.costPeriod), pdfText(benefit(x.m))]);
    body.push([{ content:'Total', styles:{ fontStyle:'bold' } }, '', '', { content:(Math.round(c.rows.reduce((a,x) => a + x.kgWeek, 0) * 10) / 10).toFixed(1) + ' kg', styles:{ fontStyle:'bold' } }, { content:ksh(T.week), styles:{ fontStyle:'bold' } }, { content:ksh(T.period), styles:{ fontStyle:'bold' } }, '']);
    doc.autoTable({ startY: 88, margin:{ left:M, right:M, bottom:46 }, head:[['Meat','Days','Portion','Meat per week', 'Cost per week', `Cost per ${noun}`, 'Nutritional benefits']], body,
      styles:{ font:'helvetica', fontSize:9, cellPadding:5, textColor:[34,26,23], valign:'middle' }, headStyles:{ fillColor:[22,18,16], textColor:[243,236,224], fontStyle:'bold' },
      alternateRowStyles:{ fillColor:[251,248,242] }, columnStyles:{ 0:{ cellWidth:105, fontStyle:'bold' }, 1:{ cellWidth:92 }, 2:{ cellWidth:46 }, 3:{ cellWidth:58 }, 4:{ cellWidth:66 }, 5:{ cellWidth:72 }, 6:{ cellWidth:'auto' } }, didParseCell: d => { if(d.row.index === body.length - 1 && d.section === 'body') d.cell.styles.fillColor = [228,200,138]; } });

    let y = doc.lastAutoTable.finalY + 18; if(y > H - 190){ doc.addPage(); y = 50; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(22,18,16); doc.text('Your totals', M, y);
    const boxes = [['Per week', T.week], ['Per month', T.month], ['Per year', T.year]]; const bw = 120;
    boxes.forEach((b, i) => { const x = M + i * (bw + 10); const on = (i === 0 && state.period === 'week') || (i === 1 && state.period === 'month') || (i === 2 && state.period === 'year');
      doc.setDrawColor(200,155,60); doc.setFillColor(on ? 228 : 251, on ? 200 : 248, on ? 138 : 242); doc.roundedRect(x, y + 8, bw, 44, 3, 3, 'FD');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90,78,72); doc.text(b[0].toUpperCase(), x + 8, y + 22);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(22,18,16); doc.text(ksh(b[1]), x + 8, y + 42); });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(60,50,45);
    let ty = y + 70; if(c.mealDays) { doc.text(`About ${ksh(c.perPersonDay)} per person on a meat day.`, M, ty); ty += 15; }
    if(c.budget){ const diff = c.budget - T.period; doc.setFont('helvetica', 'bold'); doc.setTextColor(diff >= 0 ? 46 : 178, diff >= 0 ? 125 : 58, diff >= 0 ? 70 : 58);
      doc.text(diff >= 0 ? `Within budget: ${ksh(diff)} to spare on your ${ksh(c.budget)} ${noun}ly budget.` : `Over budget by ${ksh(-diff)} on your ${ksh(c.budget)} ${noun}ly budget.`, M, ty); ty += 15; doc.setFont('helvetica', 'normal'); doc.setTextColor(60,50,45); }
    const tp = tips(c); if(tp.length){ doc.setFont('helvetica', 'bold'); doc.text('Ideas to save and eat well', M, ty + 4); doc.setFont('helvetica', 'normal'); ty += 18;
      tp.forEach(t => { const lines = doc.splitTextToSize('- ' + pdfText(t), W - 2 * M - 300); doc.text(lines, M, ty); ty += lines.length * 12; }); }

    // timetable on the right of the totals when there is room, else new page
    const ttX = M + 3 * (bw + 10) + 14; const body2 = c.perDay.map(d => [d.long, d.items.length ? pdfText(d.items.map(i => i.m.name).join(', ')) : '-', d.items.length ? ksh(d.cost) : '']);
    doc.autoTable({ startY: y - 4, margin:{ left: ttX, right: M }, tableWidth: W - ttX - M, head:[['Day','Meat','Cost']], body: body2, styles:{ fontSize:8.5, cellPadding:3.5, textColor:[34,26,23] },
      headStyles:{ fillColor:[200,155,60], textColor:[22,18,16], fontStyle:'bold' }, columnStyles:{ 0:{ cellWidth:58 }, 2:{ cellWidth:58, halign:'right' } } });

    const n = doc.internal.getNumberOfPages();
    for(let i = 1; i <= n; i++){ doc.setPage(i); doc.setDrawColor(221,208,188); doc.line(M, H - 38, W - M, H - 38); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110,100,95);
      doc.text(pdfText(`Estimate based on current Azizo prices (${new Date().toLocaleDateString('en-GB')}); prices and availability may change. Nutrition notes are general information, not medical advice.`), M, H - 26);
      doc.text(pdfText(`Order: WhatsApp +${(typeof CONFIG !== 'undefined' && CONFIG.WA_NUMBER) || '254724888057'}   |   Page ${i} of ${n}`), W - M, H - 26, { align:'right' }); }
    const safe = (state.name || 'My').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'My';
    doc.save(`Azizo-Meat-Budget-${safe}-${P.label}.pdf`);
    toast('Your budget PDF is downloading');
  }
  function printFallback(){
    const c = calc(), T = c.totals, noun = PERIODS[state.period].noun; const sheet = $('bpPrintSheet');
    sheet.innerHTML = `<h1>Meat Budget Plan</h1><p>Prepared for ${esc(state.name || 'you')} - ${state.people} people - ${PERIODS[state.period].label} plan</p>
      <table><thead><tr><th>Meat</th><th>Days</th><th>Portion</th><th>Per week</th><th>Cost/week</th><th>Cost/${noun}</th><th>Nutritional benefits</th></tr></thead><tbody>
      ${c.rows.filter(x => x.days).map(x => `<tr><td>${esc(x.m.name)}</td><td>${esc(dayText(x.r.days))}</td><td>${x.r.grams} g</td><td>${x.kgWeek.toFixed(1)} kg</td><td>${ksh(x.costWeek)}</td><td>${ksh(x.costPeriod)}</td><td>${esc(benefit(x.m))}</td></tr>`).join('')}</tbody></table>
      <p><strong>Per week ${ksh(T.week)} | Per month ${ksh(T.month)} | Per year ${ksh(T.year)}</strong></p><p>Estimate based on current Azizo prices; nutrition notes are general information, not medical advice.</p>`;
    document.body.classList.add('printing-budget'); window.print(); setTimeout(() => document.body.classList.remove('printing-budget'), 500);
  }

  // ---------- start ----------
  window.addEventListener('DOMContentLoaded', async () => {
    if(!$('bpRows')) return;
    $('bpRows').innerHTML = '<tr class="bp-empty"><td colspan="7">Loading today\'s prices...</td></tr>';
    await loadCatalog();
    if(!meats.length){ $('bpRows').innerHTML = '<tr class="bp-empty"><td colspan="7">We could not load the menu right now. Please refresh the page.</td></tr>'; return; }
    restore(); if(!state.rows.length && !localStorage.getItem(KEY)) { /* first visit: start empty so the customer chooses */ }
    wire(); renderAll();
  });
  window.AzizoBudget = { _state: () => state, _calc: calc };
})();
