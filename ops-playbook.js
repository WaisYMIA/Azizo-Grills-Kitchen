// Operations > Playbook (v6.0): daily checklists, training and certification, compliance, new-branch wizard. Loaded after ops-insight.js.
(function(){
  'use strict';
  var O = window.OPS, K = window.KK; if(!O || !K) return;
  var esc = K.esc, J = function(o){ return JSON.stringify(o); };
  var S = { sub: 'ck', branch: '', code: null, launch: null, branches: null, cat: null };
  var SHIFT = { open: 'Opening', mid: 'Mid-shift', close: 'Closing', weekly: 'Weekly' };
  var pb = function(ctx, p, o){ return K.apiAt('/api/playbook', p, o, ctx.tok()); };
  var bn = function(ctx){ return K.apiAt('/api/branches', '/all', {}, ctx.tok()); };
  O.playbook = {};
  O.playbook.pb = async function(ctx){
    var $ = ctx.$, role = ctx.role ? ctx.role() : 'owner', mgr = role === 'owner' || role === 'manager', owner = role === 'owner';
    if(!S.branches){ S.branches = (await bn(ctx)).branches; }
    if(!S.cat){ S.cat = await pb(ctx, '/catalogue'); }
    if(!S.branch || !S.branches.some(function(b){ return b.id === S.branch; })) S.branch = (S.branches[0] || {}).id || '';
    var subs = [['ck', 'Daily checklists']].concat(mgr ? [['cp', 'Compliance'], ['tr', 'Training']] : []).concat(owner ? [['nb', 'New branch']] : []);
    if(!subs.some(function(s){ return s[0] === S.sub; })) S.sub = 'ck';
    var head = '<div class="panel"><h3 style="margin:0">Playbook</h3><p class="kmeta" style="color:var(--mute);margin:4px 0 8px">The Azizo way of running a branch: the same checks, training and launch steps everywhere.</p><div style="display:flex;gap:6px;flex-wrap:wrap">' +
      subs.map(function(s){ return '<button class="btn sm ' + (S.sub === s[0] ? 'gold' : '') + '" data-ps="' + s[0] + '">' + s[1] + '</button>'; }).join('') + '</div></div><div id="pbSub" style="margin-top:12px"></div>';
    $('pane').innerHTML = head;
    $('pane').querySelectorAll('[data-ps]').forEach(function(b){ b.onclick = function(){ S.sub = b.dataset.ps; S.code = null; O.playbook.pb(ctx); }; });
    var fn = { ck: ck, cp: cp, tr: tr, nb: nb }[S.sub];
    try{ await fn(ctx, $('pbSub'), $); }catch(e){ $('pbSub').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; }
  };
  var branchSel = function(id){ return '<label style="font-size:.8rem;color:var(--mute)">Branch<br><select id="' + id + '">' + S.branches.map(function(b){ return '<option value="' + esc(b.id) + '"' + (b.id === S.branch ? ' selected' : '') + '>' + esc(b.name) + (b.listed ? '' : ' (not live)') + '</option>'; }).join('') + '</select></label>'; };
  // ---------- daily checklists ----------
  async function ck(ctx, box, $){
    if(S.code) return ckForm(ctx, box, $);
    var t = await pb(ctx, '/today?branch=' + encodeURIComponent(S.branch));
    box.innerHTML = '<div class="panel">' + branchSel('pbB') + '<p class="kmeta" style="color:var(--mute)">Today, ' + esc(t.date) + ' (Nairobi). Tap a checklist to fill it in.</p><div class="cards">' +
      S.cat.checklists.map(function(c){ var r = t.runs[c.code], st = r ? (r.status === 'complete' ? (r.attention ? 'Done, needs attention' : 'Done') : r.done + '/' + r.total + ' started') : 'Not started';
        return '<button class="stat" data-cl="' + c.code + '" style="text-align:left;cursor:pointer"><b style="font-size:1.05rem' + (r && r.attention ? ';color:#ff8a9c' : '') + '">' + esc(SHIFT[c.shift]) + '</b>' + esc(c.desc) + '<br><span class="pill ' + (r && r.status === 'complete' ? 'ok' : '') + '">' + esc(st) + '</span></button>'; }).join('') + '</div></div>';
    $('pbB').onchange = function(){ S.branch = $('pbB').value; ck(ctx, box, $); };
    box.querySelectorAll('[data-cl]').forEach(function(b){ b.onclick = function(){ S.code = b.dataset.cl; ck(ctx, box, $); }; });
  }
  async function ckForm(ctx, box, $){
    var cl = S.cat.checklists.filter(function(c){ return c.code === S.code; })[0];
    var got = await pb(ctx, '/checklists/run?code=' + S.code + '&branch=' + encodeURIComponent(S.branch)), run = got.run, ans = (run && run.answers) || {}, locked = run && run.status === 'complete';
    var row = function(it){
      var a = ans[it.id] || {}, lim = it.type === 'temp' ? ' <small style="color:var(--mute)">(allowed ' + it.min + ' to ' + it.max + it.unit + ')</small>' : '', crit = it.crit ? ' <span class="pill">critical</span>' : '', c = '';
      if(it.type === 'tick') c = ['true|Yes', 'false|No', 'na|N/A'].map(function(o){ var p = o.split('|'), v = p[0] === 'true' ? true : p[0] === 'false' ? false : 'na'; return '<label style="margin-right:10px"><input type="radio" name="r_' + it.id + '" value="' + p[0] + '"' + (a.ok === v ? ' checked' : '') + (locked ? ' disabled' : '') + '> ' + p[1] + '</label>'; }).join('');
      else if(it.type === 'text') c = '<input data-v="' + it.id + '" maxlength="500" value="' + esc(a.value || '') + '"' + (locked ? ' disabled' : '') + ' style="width:100%">';
      else c = '<input data-v="' + it.id + '" type="number" step="0.1" inputmode="decimal" value="' + (a.value == null ? '' : esc(a.value)) + '"' + (locked ? ' disabled' : '') + ' style="width:9em"> ' + esc(it.unit || '');
      return '<div class="panel" style="margin-top:8px;padding:10px" data-it="' + it.id + '"><div>' + esc(it.t) + crit + lim + ' <small style="color:var(--mute)">SOP ' + esc(it.sop) + '</small></div><div style="margin-top:6px">' + c + '</div><input data-n="' + it.id + '" maxlength="300" placeholder="If it failed: what did you do about it?" value="' + esc(a.note || '') + '"' + (locked ? ' disabled' : '') + ' style="width:100%;margin-top:6px;display:none"></div>';
    };
    box.innerHTML = '<div class="panel"><button class="btn sm" id="pbBack">Back</button> <b style="margin-left:8px">' + esc(cl.title) + '</b> <small style="color:var(--mute)">' + esc((S.branches.filter(function(b){ return b.id === S.branch; })[0] || {}).name) + ' · ' + esc(got.date) + '</small>' +
      (locked ? '<div class="msg ok" style="margin-top:8px">Signed by ' + esc(run.completed_by) + ' at ' + esc(String(run.completed_at).slice(11, 16)) + ' UTC. ' + (run.attention ? 'Critical failures were recorded for the manager.' : '') + '</div>' : '') +
      '</div>' + cl.items.map(row).join('') + '<div id="pbMsg" style="margin-top:10px"></div>' + (locked ? '' : '<div style="display:flex;gap:8px;margin-top:10px;position:sticky;bottom:0;padding:8px 0"><button class="btn" id="pbSave">Save draft</button><button class="btn gold" id="pbSign">Sign and complete</button></div>');
    $('pbBack').onclick = function(){ S.code = null; ck(ctx, box, $); };
    var collect = function(){ var o = {}; cl.items.forEach(function(it){ var a = {}, w = box.querySelector('[data-it="' + it.id + '"]');
      var r = w.querySelector('input[type=radio]:checked'); if(r) a.ok = r.value === 'true' ? true : r.value === 'false' ? false : 'na';
      var v = w.querySelector('[data-v]'); if(v && v.value !== ''){ a.value = v.value; }
      var n = w.querySelector('[data-n]'); if(n && n.value) a.note = n.value; o[it.id] = a; }); return o; };
    var flag = function(){ cl.items.forEach(function(it){ var w = box.querySelector('[data-it="' + it.id + '"]'), bad = false;
      if(it.type === 'tick'){ var r = w.querySelector('input[type=radio]:checked'); bad = r && r.value === 'false'; }
      if(it.type === 'temp'){ var v = w.querySelector('[data-v]').value; bad = v !== '' && (Number(v) < it.min || Number(v) > it.max); }
      w.querySelector('[data-n]').style.display = bad ? '' : 'none'; w.style.borderColor = bad ? '#ff8a9c' : ''; }); };
    box.querySelectorAll('input').forEach(function(i){ i.addEventListener('input', flag); i.addEventListener('change', flag); }); flag();
    var send = async function(complete){ $('pbMsg').innerHTML = ''; try{ var r = await pb(ctx, '/checklists/run', { method: 'POST', body: J({ code: S.code, branch: S.branch, answers: collect(), complete: complete }) });
      if(complete){ K.toast('Signed'); S.code = null; ck(ctx, box, $); } else { K.toast('Draft saved (' + r.done + '/' + r.total + ')'); } }catch(e){ $('pbMsg').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; } };
    if(!locked){ $('pbSave').onclick = function(){ send(false); }; $('pbSign').onclick = function(){ send(true); }; }
  }
  // ---------- compliance ----------
  async function cp(ctx, box, $){
    var r = await pb(ctx, '/compliance');
    box.innerHTML = '<div class="panel"><h3 style="margin:0">Checklist compliance</h3><p class="kmeta" style="color:var(--mute)">' + esc(r.from) + ' to ' + esc(r.to) + '. Expected = three daily checklists per branch per day.</p><div class="scroll"><table class="t"><thead><tr><th>Branch</th><th>Done</th><th>Expected</th><th>%</th><th>Failed lines</th><th>Open critical</th></tr></thead><tbody>' +
      r.branches.map(function(b){ return '<tr><td>' + esc(b.name) + '</td><td>' + b.done + '</td><td>' + b.expected + '</td><td>' + b.pct + '%</td><td>' + b.fails + '</td><td>' + (b.openAttention ? '<b style="color:#ff8a9c">' + b.openAttention + '</b>' : '0') + '</td></tr>'; }).join('') + '</tbody></table></div></div>' +
      '<div class="panel" style="margin-top:12px"><h3 style="margin:0">Critical failures waiting for you</h3>' + (r.attention.length ? r.attention.map(function(a){ return '<div class="panel" style="margin-top:8px"><b>' + esc(a.title) + '</b> · ' + esc(a.branch) + ' · ' + esc(a.date) + ' · ' + esc(a.by) + a.items.map(function(i){ return '<div style="margin-top:4px">' + esc(i.t) + (i.value != null ? ' <b>(' + esc(i.value) + ')</b>' : '') + '<br><small style="color:var(--mute)">Action recorded: ' + esc(i.note || 'none') + '</small></div>'; }).join('') +
        '<div class="row" style="margin-top:8px"><div><input data-rn="' + a.id + '" maxlength="300" placeholder="What was done to fix it?"></div><div><button class="btn gold" data-rb="' + a.id + '">Mark resolved</button></div></div></div>'; }).join('') : '<p style="color:var(--mute)">Nothing waiting. Good.</p>') + '</div>';
    box.querySelectorAll('[data-rb]').forEach(function(b){ b.onclick = async function(){ var id = b.dataset.rb; try{ await pb(ctx, '/runs/' + id + '/resolve', { method: 'PATCH', body: J({ note: box.querySelector('[data-rn="' + id + '"]').value }) }); K.toast('Resolved'); cp(ctx, box, $); }catch(e){ window.alert(e.message); } }; });
  }
  // ---------- training ----------
  async function tr(ctx, box, $){
    var m = await pb(ctx, '/training/matrix?branch=' + encodeURIComponent(S.branch)), pass = S.cat.passmark;
    var cell = function(s, c){ var x = s.courses[c.code]; if(!x) return '<td style="color:var(--mute)">-</td>'; if(!x.valid) return '<td style="color:#ff8a9c">Expired</td>'; if(x.certified) return '<td style="color:#7bd88f" title="Valid to ' + esc(x.expires) + '">Certified</td>'; return '<td><button class="btn sm" data-pr="' + x.id + '" title="Passed with ' + x.score + '%. Tick when you have watched them do the work.">Sign off</button></td>'; };
    box.innerHTML = '<div class="panel">' + branchSel('pbB') + '<p class="kmeta" style="color:var(--mute)">A person is <b>certified</b> for a station after passing the quiz (' + pass + '% or more) <b>and</b> a supervisor has watched them do the work and signed off. Valid ' + S.cat.validMonths + ' months.</p>' +
      '<div class="scroll"><table class="t"><thead><tr><th>Staff</th>' + m.courses.map(function(c){ return '<th title="' + esc(c.title) + '">' + esc(c.code) + '</th>'; }).join('') + '</tr></thead><tbody>' + (m.staff.length ? m.staff.map(function(s){ return '<tr><td>' + esc(s.name) + '</td>' + m.courses.map(function(c){ return cell(s, c); }).join('') + '</tr>'; }).join('') : '<tr><td colspan="9" style="color:var(--mute)">No one has passed a quiz at this branch yet.</td></tr>') + '</tbody></table></div>' +
      '<small style="color:var(--mute)">' + m.courses.map(function(c){ return esc(c.code) + ' ' + esc(c.title); }).join(' · ') + '</small></div>' +
      '<div class="panel" style="margin-top:12px"><h3 style="margin:0">Take a quiz</h3><div class="row"><div><label class="f">Staff full name</label><input id="tN" maxlength="80"></div><div><label class="f">Phone (so the same person is recognised)</label><input id="tP" type="tel"></div><div><label class="f">Course</label><select id="tC">' + S.cat.courses.map(function(c){ return '<option value="' + c.code + '">' + esc(c.code + ' ' + c.title) + '</option>'; }).join('') + '</select></div></div><div id="tQ" style="margin-top:10px"></div></div>';
    $('pbB').onchange = function(){ S.branch = $('pbB').value; tr(ctx, box, $); };
    box.querySelectorAll('[data-pr]').forEach(function(b){ b.onclick = async function(){ try{ await pb(ctx, '/training/' + b.dataset.pr + '/practical', { method: 'PATCH', body: J({}) }); K.toast('Signed off'); tr(ctx, box, $); }catch(e){ window.alert(e.message); } }; });
    var show = function(){ var c = S.cat.courses.filter(function(x){ return x.code === $('tC').value; })[0];
      $('tQ').innerHTML = '<details><summary><b>Read the lessons first</b> (SOP ' + esc(c.sop.join(', ')) + ')</summary>' + c.lessons.map(function(l){ return '<h4 style="margin:10px 0 4px">' + esc(l.h) + '</h4><ul>' + l.pts.map(function(p){ return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>'; }).join('') + '</details>' +
        c.quiz.map(function(q, i){ return '<div class="panel" style="margin-top:8px"><b>' + (i + 1) + '. ' + esc(q.q) + '</b>' + q.o.map(function(o, k){ return '<label style="display:block;margin-top:4px"><input type="radio" name="q' + i + '" value="' + k + '"> ' + esc(o) + '</label>'; }).join('') + '<div data-rv="' + i + '"></div></div>'; }).join('') + '<div id="tR" style="margin-top:8px"></div><button class="btn gold" id="tS" style="margin-top:8px">Submit answers</button>';
      $('tS').onclick = async function(){ var a = c.quiz.map(function(q, i){ var r = $('tQ').querySelector('input[name=q' + i + ']:checked'); return r ? Number(r.value) : -1; });
        if(a.indexOf(-1) > -1){ $('tR').innerHTML = '<div class="msg err">Answer every question first.</div>'; return; }
        try{ var r = await pb(ctx, '/training/attempt', { method: 'POST', body: J({ staff_name: $('tN').value, staff_ref: $('tP').value, branch: S.branch, course: c.code, answers: a }) });
          r.review.forEach(function(v, i){ $('tQ').querySelector('[data-rv="' + i + '"]').innerHTML = '<small style="color:' + (v.ok ? '#7bd88f' : '#ff8a9c') + '">' + (v.ok ? 'Correct. ' : 'Not quite. ') + esc(v.why) + '</small>'; });
          $('tR').innerHTML = '<div class="msg ' + (r.passed ? 'ok' : 'err') + '"><b>' + r.score + '%</b> ' + (r.passed ? 'Passed. A supervisor can now sign off the practical on the table above.' : 'Not passed (pass mark ' + r.passmark + '%). Read the lessons and try again.') + '</div>'; $('tS').disabled = true;
          if(r.passed) setTimeout(function(){ tr(ctx, box, $); }, 4000);
        }catch(e){ $('tR').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; } }; };
    $('tC').onchange = show; show();
  }
  // ---------- new branch ----------
  async function nb(ctx, box, $){
    if(S.launch) return nbOne(ctx, box, $);
    var l = (await pb(ctx, '/launches')).launches;
    box.innerHTML = '<div class="panel"><h3 style="margin:0">New branch</h3><p class="kmeta" style="color:var(--mute)">Start a branch here. It stays hidden from customers until it passes every readiness check and you press Go live.</p>' +
      (l.length ? l.map(function(x){ return '<div class="panel" style="margin-top:8px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center"><div><b>' + esc(x.name) + '</b> <span class="pill ' + (x.status === 'live' ? 'ok' : '') + '">' + esc(x.status === 'live' ? 'Live' : 'In preparation') + '</span><br><small style="color:var(--mute)">' + esc(x.type) + ' · ' + x.passed + '/' + x.total + ' checks passed</small></div><button class="btn sm" data-lo="' + x.id + '">Open</button></div>'; }).join('') : '<p style="color:var(--mute)">No new branches started yet.</p>') + '</div>' +
      '<div class="panel" style="margin-top:12px"><h3 style="margin:0">Start a new branch</h3><div class="row"><div><label class="f">Branch name</label><input id="nN" maxlength="60" placeholder="Azizo Butchery Kitengela"></div><div><label class="f">Area</label><input id="nA" maxlength="60"></div></div>' +
      '<div class="row" style="margin-top:8px"><div><label class="f">Address</label><input id="nD" maxlength="160"></div><div><label class="f">Branch phone</label><input id="nP" type="tel"></div></div>' +
      '<div class="row" style="margin-top:8px"><div><label class="f">Latitude (e.g. -1.4700)</label><input id="nLa" inputmode="decimal"></div><div><label class="f">Longitude (e.g. 36.9600)</label><input id="nLo" inputmode="decimal"></div><div><label class="f">Owned by</label><select id="nT"><option value="own">Azizo (own branch)</option><option value="franchise">Franchisee</option></select></div></div>' +
      '<label style="display:flex;gap:8px;margin-top:8px"><input type="checkbox" id="nG"> This branch has a grill / ready-to-eat kitchen</label><div id="nM"></div><button class="btn gold" id="nS" style="margin-top:10px">Create branch</button></div>';
    box.querySelectorAll('[data-lo]').forEach(function(b){ b.onclick = function(){ S.launch = b.dataset.lo; nb(ctx, box, $); }; });
    $('nS').onclick = async function(){ try{ var r = await pb(ctx, '/launches', { method: 'POST', body: J({ name: $('nN').value, area: $('nA').value, address: $('nD').value, phone: $('nP').value, lat: $('nLa').value, lng: $('nLo').value, type: $('nT').value, grill: $('nG').checked }) }); S.branches = null; S.launch = String(r.id); await O.playbook.pb(ctx); }catch(e){ $('nM').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; } };
  }
  async function nbOne(ctx, box, $){
    var d = await pb(ctx, '/launches/' + S.launch), L = d.launch, inh = d.inherits, ready = L.passed === L.total;
    box.innerHTML = '<div class="panel"><button class="btn sm" id="lBack">Back</button> <b style="margin-left:8px">' + esc(L.name) + '</b> <span class="pill ' + (L.status === 'live' ? 'ok' : '') + '">' + (L.status === 'live' ? 'Live' : 'In preparation') + '</span>' +
      '<p class="kmeta" style="color:var(--mute)">' + L.passed + ' of ' + L.total + ' readiness checks passed. Branch id: ' + esc(L.branch) + '.</p>' +
      '<div class="msg info">' + esc(inh.note) + ' Inherited now: ' + inh.products + ' products, ' + inh.checklists + ' checklists (' + inh.checklistItems + ' lines), ' + inh.courses + ' courses (' + inh.questions + ' questions).</div></div>' +
      '<div class="panel" style="margin-top:12px"><h4 style="margin:0 0 6px">Checked by the system</h4>' + L.checks.filter(function(c){ return c.auto; }).map(function(c){ return '<div style="margin:4px 0">' + (c.ok ? '<span style="color:#7bd88f">✓</span>' : '<span style="color:#ff8a9c">✗</span>') + ' ' + esc(c.t) + (c.detail ? ' <small style="color:var(--mute)">(' + esc(c.detail) + ')</small>' : '') + '</div>'; }).join('') +
      '<small style="color:var(--mute)">Train staff and sign them off in Playbook > Training; fill the practice opening and closing checklists in Playbook > Daily checklists, for this branch.</small></div>' +
      '<div class="panel" style="margin-top:12px"><h4 style="margin:0 0 6px">Confirmed by you</h4>' + L.checks.filter(function(c){ return !c.auto; }).map(function(c){ return '<label style="display:flex;gap:8px;margin:6px 0;align-items:flex-start"><input type="checkbox" data-mk="' + esc(c.k.slice(4)) + '"' + (c.ok && !c.na ? ' checked' : '') + (c.na || L.status === 'live' ? ' disabled' : '') + '> <span>' + esc(c.t) + (c.na ? ' <small style="color:var(--mute)">(not needed for own branches)</small>' : '') + (c.by ? ' <small style="color:var(--mute)">' + esc(c.by) + ', ' + esc(c.at) + '</small>' : '') + '</span></label>'; }).join('') + '</div>' +
      (L.status === 'live' ? '' : '<div id="lM" style="margin-top:10px"></div><button class="btn gold" id="lGo"' + (ready ? '' : ' disabled') + ' style="margin-top:8px">Go live: show this branch to customers</button>');
    $('lBack').onclick = function(){ S.launch = null; nb(ctx, box, $); };
    box.querySelectorAll('[data-mk]').forEach(function(c){ c.onchange = async function(){ try{ await pb(ctx, '/launches/' + S.launch + '/manual', { method: 'PATCH', body: J({ key: c.dataset.mk, done: c.checked }) }); nbOne(ctx, box, $); }catch(e){ window.alert(e.message); } }; });
    if($('lGo')) $('lGo').onclick = async function(){ if(!window.confirm('Show ' + L.name + ' to customers now?')) return; try{ await pb(ctx, '/launches/' + S.launch + '/golive', { method: 'POST', body: '{}' }); S.branches = null; K.toast('Branch is live'); await O.playbook.pb(ctx); }catch(e){ $('lM').innerHTML = '<div class="msg err">' + esc(e.message) + (e.open ? '' : '') + '</div>'; } };
  }
})();
