(function(){
  'use strict';
  var K = window.KK, M = window.MK, I = window.INSP, $ = K.$, esc = I.esc, app = $('app'), TKI = 'mkInspToken', TKA = 'mkAdminToken', DRAFT = 'azInspDraft';
  var tok = function(){ return sessionStorage.getItem(TKI) || sessionStorage.getItem(TKA) || ''; };
  var who = function(){ try{ return sessionStorage.getItem('mkInspName') || ''; }catch(e){ return ''; } };
  var std, partners, titles, visits, pads = {}, J = M.json;
  async function api(path, opts){ try{ return await M.api(path, opts, tok()); }catch(e){ if(e.status === 401 || e.status === 403){ sessionStorage.removeItem(TKI); sessionStorage.removeItem(TKA); gate('Please sign in again'); throw new Error('Please sign in again'); } throw e; } }
  function gate(msg){
    app.innerHTML = '<div class="gate panel" style="max-width:460px;margin:40px auto"><h2 style="margin-top:0">Azizo inspection form</h2><p style="color:var(--mute)">For Azizo officials only. Sign in to record a partner inspection.</p>' + (K.base() ? '' : '<label class="f" for="gUrl">Server address</label><input id="gUrl" placeholder="https://api.yourdomain.co.ke">') +
      '<label class="f" for="gAs" style="margin-top:8px">Sign in as</label><select id="gAs"><option value="acct">My Azizo account (username)</option><option value="insp">Shared inspector password</option><option value="adm">Administrator</option></select>' +
      '<div id="gU"><label class="f" for="gUser" style="margin-top:8px">Username</label><input id="gUser" autocomplete="username"></div><div id="gN" style="display:none"><label class="f" for="gName" style="margin-top:8px">Your full name</label><input id="gName" autocomplete="name"></div>' +
      '<label class="f" for="gPw" style="margin-top:8px">Password</label><input id="gPw" type="password" autocomplete="current-password"><div id="gErr">' + (msg ? '<div class="msg err">' + esc(msg) + '</div>' : '') + '</div><button class="btn gold" id="gGo" style="margin-top:12px">Sign in</button></div>';
    $('gAs').onchange = function(){ $('gN').style.display = $('gAs').value === 'insp' ? '' : 'none'; $('gU').style.display = $('gAs').value === 'acct' ? '' : 'none'; };
    var go = async function(){ if($('gUrl')) K.set('azizoAdminBackendUrl', $('gUrl').value.trim().replace(/\/+$/, '')); $('gErr').innerHTML = '';
      try{
        if($('gAs').value === 'acct'){ var ra = await M.api('/inspector/login', { method: 'POST', body: J({ username: $('gUser').value, password: $('gPw').value }) }); sessionStorage.setItem(TKI, ra.token); sessionStorage.setItem('mkInspName', ra.name); }
        else if($('gAs').value === 'insp'){ var r = await M.api('/inspector/login', { method: 'POST', body: J({ name: $('gName').value, password: $('gPw').value }) }); sessionStorage.setItem(TKI, r.token); sessionStorage.setItem('mkInspName', r.name); }
        else { var pw = $('gPw').value, r2; try{ r2 = await M.root('/api/auth/admin-login', { method: 'POST', body: J({ password: pw }) }); }catch(e1){ if(!/6-digit|authenticator/i.test(e1.message)) throw e1; var cd = (window.prompt('Enter the 6-digit code from your authenticator app') || '').trim(); r2 = await M.root('/api/auth/admin-login', { method: 'POST', body: J({ password: pw, code: cd }) }); } sessionStorage.setItem(TKA, r2.token); }
        start(); }catch(e){ $('gErr').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; } };
    $('gGo').onclick = go; $('gPw').onkeydown = function(e){ if(e.key === 'Enter') go(); };
  }
  async function start(){
    app.innerHTML = '<p style="color:#ddd;text-align:center;padding:40px">Loading the standard…</p>';
    try{ var s = await api('/inspection/standard'), p = await api('/inspection/partners'); std = s.standard; titles = s.titles; visits = s.visits; partners = p.partners; }catch(e){ if(tok()) app.innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; return; }
    draw();
  }
  var pad2 = function(n){ return (n < 10 ? '0' : '') + n; };
  function draw(){
    var d = new Date(), today = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()), now = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    var qs = new URLSearchParams(location.search), pre = Number(qs.get('partner')) || 0;
    var cats = std.categories.map(function(c){ return '<h3>' + esc(c.id) + '. ' + esc(c.name) + ' <em>weight ' + c.weight + '%</em></h3>' + c.items.map(function(i){
      var radio = function(v, cls, l){ return '<label><input type="radio" name="q_' + i.id + '" value="' + v + '"><span class="' + cls + '">' + l + '</span></label>'; };
      return '<div class="q" data-q="' + i.id + '"><div class="q-top"><div class="q-t"><b>' + i.id + '</b>' + esc(i.text) + (i.critical ? '<span class="crit">critical</span>' : '') + '</div><div class="seg" role="radiogroup" aria-label="' + esc(i.id) + '">' + radio('pass', 'p', 'Pass') + radio('partial', 'h', 'Partial') + radio('fail', 'f', 'Fail') + (i.critical ? '' : radio('na', 'n', 'N/A')) + '</div></div><input class="q-note" id="n_' + i.id + '" placeholder="Finding / evidence (required for Fail)" maxlength="300" style="display:none"></div>'; }).join(''); }).join('');
    app.innerHTML = '<div class="insp-tools noprint"><button class="btn sm" id="bOut">Sign out</button> <a class="btn sm" href="marketplace-admin.html">Admin portal</a> <span style="color:#ccc;align-self:center;font-size:.85rem">Signed in' + (who() ? ' as ' + esc(who()) : '') + '</span></div>' +
      '<form class="insp-paper" id="paper" onsubmit="return false">' + I.letterhead(std) +
      '<h3>1. Inspection details</h3><div class="kv"><div class="full"><label for="fp">Butchery being inspected *</label><select id="fp"><option value="">Choose…</option>' + partners.map(function(p){ return '<option value="' + p.id + '"' + (pre === p.id ? ' selected' : '') + '>' + esc(p.name) + ' (' + esc(p.status) + ')</option>'; }).join('') + '</select></div>' +
      '<div><label>Premises address</label><div class="ro" id="fAddr">-</div></div><div><label>Licence no. / health certificate no.</label><div class="ro" id="fLic">-</div></div>' +
      '<div><label for="fd">Date *</label><input id="fd" type="date" value="' + today + '" max="' + today + '"></div><div><label for="ft">Time</label><input id="ft" type="time" value="' + now + '"></div>' +
      '<div><label for="fv">Type of visit</label><select id="fv">' + visits.map(function(v){ return '<option' + (v === 'Routine inspection' ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('') + '</select></div><div></div>' +
      '<div><label for="fn">Inspector (full name) *</label><input id="fn" value="' + esc(who()) + '" autocomplete="name"></div><div><label for="fti">Official title *</label><select id="fti">' + titles.map(function(t){ return '<option>' + esc(t) + '</option>'; }).join('') + '<option value="__o">Other…</option></select><input id="ftio" placeholder="Official title" style="display:none;margin-top:6px"></div>' +
      '<div><label for="fr">Partner representative present *</label><input id="fr"></div><div><label for="frr">Their role</label><input id="frr" placeholder="Owner, manager…"></div></div>' +
      '<h3>2. Checklist <em>' + std.categories.reduce(function(n, c){ return n + c.items.length; }, 0) + ' items</em></h3><p style="font-size:12.5px;color:#555;margin:8px 0 0">' + std.rules.map(esc).join(' ') + '</p>' + cats +
      '<h3>3. Findings and actions</h3><div class="kv"><div class="full"><label for="fno">Inspector\'s notes</label><textarea id="fno" rows="3" maxlength="1500"></textarea></div><div class="full"><label for="fac">Corrective actions required</label><textarea id="fac" rows="3" maxlength="1500"></textarea></div><div><label for="fad">Actions must be done by</label><input id="fad" type="date"></div></div>' +
      '<h3>4. Declaration and signatures</h3><p style="font-size:12.5px;margin:8px 0 0">I certify that this inspection was carried out in person on the date shown, and that the findings above are true and fair. The partner representative acknowledges the findings.</p>' +
      '<div class="sigs"><div><canvas id="cvI" aria-label="Inspector signature"></canvas><div class="sig-b"><b>Inspector signature *</b> <button type="button" class="btn sm noprint" id="cI">Clear</button></div></div><div><canvas id="cvR" aria-label="Partner representative signature"></canvas><div class="sig-b"><b>Partner representative</b> <button type="button" class="btn sm noprint" id="cR">Clear</button></div></div></div>' +
      '<div id="fErr"></div><div class="live noprint" id="live"></div></form>' +
      '<div class="noprint" style="text-align:center;margin-top:14px"><button class="btn gold" id="bSub" style="min-width:240px;padding:14px 22px">Submit inspection</button></div>';
    pads.i = I.pad($('cvI')); pads.r = I.pad($('cvR')); $('cI').onclick = function(){ pads.i.clear(); }; $('cR').onclick = function(){ pads.r.clear(); };
    $('bOut').onclick = function(){ sessionStorage.removeItem(TKI); sessionStorage.removeItem(TKA); gate(); };
    $('fp').onchange = fillPartner; fillPartner();
    $('fti').onchange = function(){ $('ftio').style.display = $('fti').value === '__o' ? '' : 'none'; };
    $('paper').addEventListener('change', onChange); $('paper').addEventListener('input', function(e){ if(e.target.classList.contains('q-note') || /^f/.test(e.target.id)) saveDraft(); });
    restoreDraft(); onChange(); $('bSub').onclick = submit;
  }
  function fillPartner(){ var p = partners.filter(function(x){ return String(x.id) === $('fp').value; })[0]; $('fAddr').textContent = p ? (p.address || '-') : '-'; $('fLic').textContent = p ? ((p.licenceNo || '-') + ' / ' + (p.healthCertNo || '-')) : '-'; if(p && !$('fr').value) $('fr').value = p.owner || ''; }
  function answers(){ var a = {}; std.categories.forEach(function(c){ c.items.forEach(function(i){ var r = document.querySelector('input[name="q_' + i.id + '"]:checked'); if(r) a[i.id] = { v: r.value, n: $('n_' + i.id).value.trim() }; }); }); return a; }
  function onChange(){
    var a = answers(); std.categories.forEach(function(c){ c.items.forEach(function(i){ var n = $('n_' + i.id), v = a[i.id] && a[i.id].v; n.style.display = (v === 'fail' || v === 'partial') ? '' : 'none'; n.placeholder = v === 'fail' ? 'Finding (required)' : 'Comment (optional)'; }); });
    var r = I.score(std, a), c = r.critical.length;
    $('live').innerHTML = '<span class="gr">' + (r.answered ? r.grade : '-') + '</span><div><b>' + (r.answered ? r.score : 0) + '</b> <small>/ 100 &middot; ' + esc(r.answered ? r.label : 'not started') + '</small></div><div><small>' + r.answered + ' of ' + r.total + ' answered' + (c ? ' &middot; <b style="color:#ff8a9c">' + c + ' critical failure(s): capped at 59</b>' : '') + '</small></div>';
    saveDraft();
  }
  function saveDraft(){ try{ var d = { a: answers(), f: {} }; ['fp', 'fd', 'ft', 'fv', 'fn', 'fti', 'ftio', 'fr', 'frr', 'fno', 'fac', 'fad'].forEach(function(k){ d.f[k] = $(k).value; }); localStorage.setItem(DRAFT, JSON.stringify(d)); }catch(e){} }
  function restoreDraft(){ try{ var d = JSON.parse(localStorage.getItem(DRAFT) || 'null'); if(!d) return; var qp = new URLSearchParams(location.search).get('partner');
    Object.keys(d.f).forEach(function(k){ if(k === 'fd' || k === 'ft') return; if(k === 'fp' && qp) return; if(d.f[k] != null) $(k).value = d.f[k]; });
    Object.keys(d.a).forEach(function(id){ var r = document.querySelector('input[name="q_' + id + '"][value="' + d.a[id].v + '"]'); if(r){ r.checked = true; $('n_' + id).value = d.a[id].n || ''; } }); $('fti').onchange(); fillPartner();
    if(Object.keys(d.a).length) K.toast('Restored your unsaved draft'); }catch(e){} }
  async function submit(){
    $('fErr').innerHTML = ''; var err = function(m){ $('fErr').innerHTML = '<div class="msg err">' + esc(m) + '</div>'; $('fErr').scrollIntoView({ block: 'center' }); };
    var a = answers(), miss = []; std.categories.forEach(function(c){ c.items.forEach(function(i){ if(!a[i.id]) miss.push(i.id); else if(a[i.id].v === 'fail' && a[i.id].n.length < 5){ miss.push(i.id + ' (finding)'); } }); });
    if(!$('fp').value) return err('Choose the butchery being inspected.');
    if(miss.length){ var first = document.querySelector('[data-q="' + miss[0].split(' ')[0] + '"]'); if(first) first.scrollIntoView({ block: 'center' }); return err('Still to complete: ' + miss.slice(0, 12).join(', ') + (miss.length > 12 ? ' and ' + (miss.length - 12) + ' more' : '')); }
    var title = $('fti').value === '__o' ? $('ftio').value : $('fti').value;
    if($('fn').value.trim().length < 3 || title.trim().length < 3) return err('Enter the inspector\'s full name and official title.');
    if($('fr').value.trim().length < 3) return err('Enter the name of the partner representative who was present.');
    if(pads.i.empty()) return err('The inspector must sign in the signature box.');
    var b = $('bSub'); b.disabled = true; b.textContent = 'Submitting…';
    try{
      var r = await api('/inspection', { method: 'POST', body: J({ partnerId: Number($('fp').value), inspectorName: $('fn').value, inspectorTitle: title, visitType: $('fv').value, date: $('fd').value, time: $('ft').value, answers: a, notes: $('fno').value, actions: $('fac').value, actionDue: $('fad').value, repName: $('fr').value, repRole: $('frr').value, inspectorSig: pads.i.data(), repSig: pads.r.data() }) });
      try{ localStorage.removeItem(DRAFT); }catch(e){}
      app.innerHTML = '<div class="insp-paper" style="text-align:center">' + I.letterhead(std) + '<h3 style="justify-content:center">Inspection recorded</h3><p style="font-size:18px;margin:18px 0 4px">Reference <b>' + esc(r.ref) + '</b></p><div class="rep-sum" style="justify-content:center"><div><div class="big">' + r.score + '<small style="font-size:18px">/100</small></div><div>' + I.stars(r.stars) + '</div></div><div style="text-align:left"><span class="stamp">GRADE ' + esc(r.grade) + '</span><div style="margin-top:6px"><b>' + esc(r.label) + '</b> &middot; <b>' + esc(r.result) + '</b></div><div style="font-size:13px;max-width:360px">' + esc(r.action) + '</div></div></div><p>Next inspection due <b>' + esc(r.nextDue) + '</b>.</p><p style="font-size:12.5px;color:#666">The record is sealed and now appears in the administrator\'s portal. Scores are for Azizo officials only; do not share them with the partner or the public.</p><div class="insp-tools noprint" style="justify-content:center"><button class="btn gold" id="bNew">Inspect another butchery</button> <a class="btn" href="marketplace-admin.html">Open admin portal</a></div></div>';
      $('bNew').onclick = function(){ draw(); window.scrollTo(0, 0); };
    }catch(e){ b.disabled = false; b.textContent = 'Submit inspection'; err(e.message); }
  }
  if(tok()) start(); else gate();
})();
