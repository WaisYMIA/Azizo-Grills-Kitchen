// Operations > Reports, Audit, Visitors, Email (v5.5). Loaded after ops-common.js, before operations.js.
(function(){
  'use strict';
  var O = window.OPS, K = window.KK; if(!O || !K) return;
  O.iApi = function(path, opts, token){ return K.apiAt('/api/insight', path, opts, token); };
  var esc = K.esc, money = K.money;
  try{ var st = document.createElement('style'); st.textContent = '.dash > *, #pane, #pane .panel{min-width:0} #pane .scroll{max-width:100%}'; document.head.appendChild(st); }catch(e){}
  var ymd = function(d){ return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  var eatToday = function(){ var d = new Date(Date.now() + (new Date().getTimezoneOffset() + 180) * 60000); return ymd(d); };
  var shift = function(s, n){ var p = s.split('-'); var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n)); return d.toISOString().slice(0, 10); };
  var PRE = [['Today', 0, 0], ['Yesterday', 1, 1], ['7 days', 6, 0], ['30 days', 29, 0], ['90 days', 89, 0]];
  var range = { from: null, to: null };
  var initRange = function(){ if(!range.from){ range.to = eatToday(); range.from = shift(range.to, -29); } };
  var monthBtns = function(){ var t = eatToday(), a = t.slice(0, 8) + '01', pe = shift(a, -1), pa = pe.slice(0, 8) + '01'; return [['This month', a, t], ['Last month', pa, pe]]; };
  function rangeBar(){
    initRange();
    return '<div class="noprint" style="display:flex;gap:6px;flex-wrap:wrap;align-items:end;margin:8px 0"><label style="font-size:.8rem;color:var(--mute)">From<br><input type="date" id="rFrom" value="' + range.from + '"></label><label style="font-size:.8rem;color:var(--mute)">To<br><input type="date" id="rTo" value="' + range.to + '"></label>' +
      PRE.map(function(p){ return '<button class="btn sm" data-pr="' + p[1] + ',' + p[2] + '">' + p[0] + '</button>'; }).join('') + monthBtns().map(function(m){ return '<button class="btn sm" data-pd="' + m[1] + ',' + m[2] + '">' + m[0] + '</button>'; }).join('') + '</div>';
  }
  function wireRange(pane, redraw){
    var set = function(f, t){ range.from = f; range.to = t; redraw(); };
    pane.querySelectorAll('[data-pr]').forEach(function(b){ b.onclick = function(){ var p = b.dataset.pr.split(','), t = eatToday(); set(shift(t, -Number(p[0])), shift(t, -Number(p[1]))); }; });
    pane.querySelectorAll('[data-pd]').forEach(function(b){ b.onclick = function(){ var p = b.dataset.pd.split(','); set(p[0], p[1]); }; });
    var ch = function(){ var f = pane.querySelector('#rFrom').value, t = pane.querySelector('#rTo').value; if(f && t) set(f, t); };
    pane.querySelector('#rFrom').onchange = ch; pane.querySelector('#rTo').onchange = ch;
  }
  var qs = function(extra){ var q = 'from=' + range.from + '&to=' + range.to; Object.keys(extra || {}).forEach(function(k){ if(extra[k] !== '' && extra[k] != null) q += '&' + k + '=' + encodeURIComponent(extra[k]); }); return q; };
  O.download = async function(path, token, fallbackName){
    var base = K.base(), res = await fetch(base + '/api/insight' + path, { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' });
    if(!res.ok){ var e = {}; try{ e = await res.json(); }catch(x){} throw new Error(e.error || 'Download failed'); }
    var cd = res.headers.get('content-disposition') || '', m = /filename="([^"]+)"/.exec(cd), blob = await res.blob(), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = m ? m[1] : fallbackName; document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  };
  var cellFmt = function(v, t){ if(v == null || v === '') return ''; if(t === 'money') return money(v); if(t === 'pct') return v + '%'; if(t === 'int' || t === 'num') return Number(v).toLocaleString('en-KE'); return esc(String(v)); };
  var table = function(r){ return '<div class="scroll"><table class="t"><thead><tr>' + r.columns.map(function(c){ return '<th>' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
    (r.rows.length ? r.rows.map(function(row){ return '<tr>' + row.map(function(v, i){ return '<td' + (['money', 'int', 'num', 'pct'].indexOf(r.columns[i].type) > -1 ? ' style="text-align:right"' : '') + '>' + cellFmt(v, r.columns[i].type) + '</td>'; }).join('') + '</tr>'; }).join('') : '<tr><td colspan="' + r.columns.length + '" style="color:var(--mute)">Nothing in this period.</td></tr>') + '</tbody></table></div>'; };
  var stat = function(n, l){ return '<div class="stat"><b>' + (n == null ? '-' : n) + '</b>' + l + '</div>'; };
  var BR = ['Syokimau', 'Umoja', 'Buruburu', 'Utawala'];

  // ---------------- Reports ----------------
  var cur = null, branch = '';
  O.insight = {};
  O.insight.rp = async function(c){
    var $ = c.$, list = await c.api('/admin/reports'), groups = {}; list.reports.forEach(function(r){ (groups[r.group] = groups[r.group] || []).push(r); });
    if(!cur || !list.reports.some(function(r){ return r.key === cur; })) cur = list.reports[0] && list.reports[0].key;
    var pane = $('pane');
    pane.innerHTML = '<div class="panel"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center"><div><h3 style="margin:0">Reports and Excel exports</h3><small style="color:var(--mute)">Pick a report, preview it, then download it as a formatted Excel file (README, summary and data sheets). Every download is recorded in the audit log.</small></div><button class="btn gold" id="packBtn">Download full data pack (Excel)</button></div>' + rangeBar() +
      '<label style="font-size:.8rem;color:var(--mute)">Branch <select id="rBr"><option value="">All branches</option>' + BR.map(function(b){ return '<option' + (branch === b ? ' selected' : '') + '>' + b + '</option>'; }).join('') + '</select></label><div id="rMsg"></div></div>' +
      '<div class="row" style="margin-top:12px;align-items:flex-start"><div class="panel" style="flex:0 0 260px;max-width:100%"><div id="rList">' + Object.keys(groups).map(function(g){ return '<div style="font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);margin:10px 0 4px">' + esc(g) + '</div>' + groups[g].map(function(r){ return '<button class="btn sm ' + (cur === r.key ? 'gold' : '') + '" style="display:block;width:100%;text-align:left;margin-bottom:4px" data-rk="' + r.key + '">' + esc(r.title) + '</button>'; }).join(''); }).join('') + '</div></div><div class="panel" style="flex:1 1 380px;min-width:0" id="rPrev">Loading…</div></div>';
    wireRange(pane, function(){ O.insight.rp(c); });
    pane.querySelector('#rBr').onchange = function(e){ branch = e.target.value; O.insight.rp(c); };
    pane.querySelectorAll('[data-rk]').forEach(function(b){ b.onclick = function(){ cur = b.dataset.rk; O.insight.rp(c); }; });
    var busy = function(btn, p, name){ btn.disabled = true; $('rMsg').innerHTML = ''; O.download(p, c.tok(), name).catch(function(e){ $('rMsg').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; }).then(function(){ btn.disabled = false; }); };
    $('packBtn').onclick = function(){ busy($('packBtn'), '/admin/pack.xlsx?' + qs({ branch: branch }), 'azizo-data-pack.xlsx'); };
    if(!cur){ $('rPrev').innerHTML = 'No reports are available for your login.'; return; }
    try{
      var r = await c.api('/admin/reports/' + cur + '?limit=100&' + qs({ branch: branch }));
      $('rPrev').innerHTML = '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div><h3 style="margin:0">' + esc(r.title) + '</h3><small style="color:var(--mute)">' + esc(r.desc) + '</small></div><button class="btn gold" id="dl">Download Excel</button></div>' +
        '<div class="cards" style="margin-top:10px">' + stat(Number(r.rowCount).toLocaleString('en-KE'), 'Rows') + r.totals.filter(function(t){ return t.label !== 'Rows'; }).slice(0, 4).map(function(t){ return stat(cellFmt(t.value, t.type) || '-', esc(t.label)); }).join('') + '</div>' +
        '<p class="kmeta" style="color:var(--mute)">Preview of the first ' + r.rows.length + ' of ' + r.rowCount + ' rows. The Excel file has all of them.</p>' + table(r);
      $('dl').onclick = function(){ busy($('dl'), '/admin/reports/' + cur + '/export.xlsx?' + qs({ branch: branch }), 'azizo-report.xlsx'); };
    }catch(e){ $('rPrev').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; }
  };

  // ---------------- Audit ----------------
  var af = { category: '', actor: '', q: '', outcome: '', offset: 0 };
  O.insight.au = async function(c){
    var $ = c.$, pane = $('pane'); initRange();
    var r = await c.api('/admin/activity?' + qs({ category: af.category, actor: af.actor, q: af.q, outcome: af.outcome, offset: af.offset, limit: 50 }));
    var cats = ['', 'auth', 'orders', 'money', 'settings', 'team', 'export', 'marketplace', 'security', 'admin'];
    pane.innerHTML = '<div class="panel"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center"><div><h3 style="margin:0">Audit log</h3><small style="color:var(--mute)">Sign-ins, failed sign-ins, order and money changes, settings, team changes, exports and security events. Each entry is chained to the one before it, so any edit shows up in the integrity check.</small></div><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn" id="vf">Verify integrity</button><button class="btn gold" id="ex1">Excel: activity log</button><button class="btn" id="ex2">Excel: security events</button></div></div><div id="vfOut"></div>' + rangeBar() +
      '<div class="noprint" style="display:flex;gap:8px;flex-wrap:wrap;align-items:end"><label style="font-size:.8rem;color:var(--mute)">Type<br><select id="aCat">' + cats.map(function(x){ return '<option value="' + x + '"' + (af.category === x ? ' selected' : '') + '>' + (x || 'All') + '</option>'; }).join('') + '</select></label><label style="font-size:.8rem;color:var(--mute)">Outcome<br><select id="aOut"><option value="">All</option><option value="fail"' + (af.outcome === 'fail' ? ' selected' : '') + '>Failed / refused</option><option value="ok"' + (af.outcome === 'ok' ? ' selected' : '') + '>Succeeded</option></select></label><label style="font-size:.8rem;color:var(--mute)">Who<br><input id="aWho" value="' + esc(af.actor) + '" style="width:130px"></label><label style="font-size:.8rem;color:var(--mute)">Search<br><input id="aQ" value="' + esc(af.q) + '" style="width:160px"></label><button class="btn sm gold" id="aGo">Apply</button></div>' +
      '<div class="cards" style="margin-top:10px">' + stat(r.total, 'Entries found') + stat(r.failedLogins, 'Failed sign-ins') + r.categories.slice(0, 3).map(function(x){ return stat(x.n, esc(x.category)); }).join('') + '</div></div>' +
      '<div class="scroll" style="margin-top:12px"><table class="t"><thead><tr><th>When (Nairobi)</th><th>Type</th><th>Action</th><th>Who</th><th>Detail</th><th>Address</th><th></th></tr></thead><tbody>' + (r.rows.length ? r.rows.map(function(x){ return '<tr><td>' + esc(x.when) + '</td><td>' + esc(x.category) + '</td><td><b>' + esc(x.action) + '</b>' + (x.severity ? '<br><small>' + esc(x.severity) + '</small>' : '') + '</td><td>' + esc(x.actor) + (x.role ? '<br><small>' + esc(x.role) + '</small>' : '') + '</td><td>' + esc(x.target ? x.target + ' · ' : '') + esc(x.detail) + '</td><td><small>' + esc(x.ip) + '</small></td><td>' + (x.outcome === 'fail' ? '<span class="pill" style="color:#ff8a9c">failed</span>' : '') + '</td></tr>'; }).join('') : '<tr><td colspan="7" style="color:var(--mute)">No entries match.</td></tr>') + '</tbody></table></div>' +
      '<div class="noprint" style="margin-top:10px"><button class="btn sm" id="pv"' + (af.offset ? '' : ' disabled') + '>Newer</button> <button class="btn sm" id="nx"' + (af.offset + 50 < r.total ? '' : ' disabled') + '>Older</button> <small style="color:var(--mute)">Showing ' + (r.total ? af.offset + 1 : 0) + '-' + Math.min(af.offset + 50, r.total) + ' of ' + r.total + '</small></div>';
    wireRange(pane, function(){ af.offset = 0; O.insight.au(c); });
    $('aGo').onclick = function(){ af = { category: $('aCat').value, actor: $('aWho').value.trim(), q: $('aQ').value.trim(), outcome: $('aOut').value, offset: 0 }; O.insight.au(c); };
    $('pv').onclick = function(){ af.offset = Math.max(0, af.offset - 50); O.insight.au(c); }; $('nx').onclick = function(){ af.offset += 50; O.insight.au(c); };
    $('vf').onclick = async function(){ try{ var v = await c.api('/admin/activity/verify'); $('vfOut').innerHTML = v.ok ? '<div class="msg ok">Log intact: ' + v.checked + ' entries checked, none altered.</div>' : '<div class="msg err"><b>Warning:</b> the log was changed. The chain breaks at entry #' + v.brokenAtId + '. Treat this as a security incident and check who has database access.</div>'; }catch(e){ $('vfOut').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; } };
    var dl = function(b, k){ $(b).onclick = function(){ O.download('/admin/reports/' + k + '/export.xlsx?' + qs({}), c.tok(), k + '.xlsx').catch(function(e){ $('vfOut').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; }); }; }; dl('ex1', 'activity_log'); dl('ex2', 'security_events');
  };

  // ---------------- Visitors ----------------
  O.insight.vi = async function(c){
    var $ = c.$, pane = $('pane'); initRange(); var v = await c.api('/admin/visitors?' + qs({}));
    var trend = function(a, b){ if(!b) return ''; var p = Math.round((a - b) / b * 100); return '<br><small style="color:' + (p >= 0 ? '#7fd99a' : '#ff8a9c') + '">' + (p >= 0 ? '+' : '') + p + '% vs previous period</small>'; };
    var bars = function(r, i){ return r.rows.length ? O.bars(r.rows.slice(0, 8), function(x){ return String(x[0]); }, function(x){ return x[i]; }) : '<p style="color:var(--mute)">No data yet.</p>'; };
    pane.innerHTML = '<div class="panel"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center"><div><h3 style="margin:0">Visitors</h3><small style="color:var(--mute)">' + esc(v.note) + '</small></div><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn gold" id="xv">Excel: visitors per day</button> <button class="btn" id="xs">Excel: sources</button> <button class="btn" id="xp">Excel: pages</button></div></div>' + rangeBar() + '<div id="vMsg"></div>' +
      '<div class="cards">' + '<div class="stat"><b>' + v.visitorDays + '</b>Visitor-days' + trend(v.visitorDays, v.prevVisitorDays) + '</div><div class="stat"><b>' + v.views + '</b>Page views' + trend(v.views, v.prevViews) + '</div>' + stat(v.orders, 'Orders in period') + stat(v.orderRatePct == null ? '-' : v.orderRatePct + '%', 'Orders per visitor-day') + '</div></div>' +
      '<div class="panel" style="margin-top:12px"><h3 style="margin-top:0">Visitors per day</h3>' + (v.daily.rows.length ? O.bars(v.daily.rows.slice(-21), function(x){ return String(x[0]).slice(5); }, function(x){ return x[1]; }) : '<p style="color:var(--mute)">Visitor counting starts when the site is live with this version. Nothing recorded yet.</p>') + '</div>' +
      '<div class="row" style="margin-top:12px"><div class="panel"><h3 style="margin-top:0">Where they came from</h3>' + bars(v.sources, 1) + '</div><div class="panel"><h3 style="margin-top:0">Devices</h3>' + bars(v.devices, 1) + '</div></div>' +
      '<div class="panel" style="margin-top:12px"><h3 style="margin-top:0">Top pages</h3>' + table({ columns: [{ label: 'Page' }, { label: 'Views', type: 'int' }, { label: 'Visitors', type: 'int' }, { label: 'Share', type: 'pct' }], rows: v.pages.rows.slice(0, 10) }) + '</div>' +
      '<div class="panel" style="margin-top:12px"><h3 style="margin-top:0">Conversion funnel by day</h3>' + table({ columns: v.funnel.columns, rows: v.funnel.rows.slice(-14) }) + '</div>';
    wireRange(pane, function(){ O.insight.vi(c); });
    var dl = function(b, k){ $(b).onclick = function(){ O.download('/admin/reports/' + k + '/export.xlsx?' + qs({}), c.tok(), k + '.xlsx').catch(function(e){ $('vMsg').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; }); }; }; dl('xv', 'visitors_daily'); dl('xs', 'visitors_sources'); dl('xp', 'visitors_pages');
  };

  // ---------------- Email ----------------
  O.insight.em = async function(c){
    var $ = c.$, pane = $('pane'), d = await c.api('/admin/mail'), s = d.settings, lg = await c.api('/admin/mail/log');
    var f = function(id, label, val, ph, type, w){ return '<label style="font-size:.8rem;color:var(--mute)">' + label + '<br><input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(val || '') + '" placeholder="' + esc(ph || '') + '" autocomplete="off" style="width:' + (w || '240px') + ';max-width:100%"></label>'; };
    pane.innerHTML = '<div class="panel"><h3 style="margin:0">Email (cPanel mailbox)</h3><p class="kmeta" style="color:var(--mute)">Connect the mailbox you made in cPanel (Email Accounts > Connect Devices shows the server name and ports). Azizo uses it to email you the daily digest and security alerts. The password is stored encrypted and is never shown again.</p>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:8px">' + f('mDom', 'Your website domain (to auto-fill)', '', 'azizobutchery.co.ke') + '<button class="btn sm" id="mFill">Fill cPanel defaults</button></div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap">' + f('mHost', 'Mail server', s.host, 'mail.yourdomain.com') + f('mPort', 'Port', s.port, '465', 'number', '90px') +
      '<label style="font-size:.8rem;color:var(--mute)">Security<br><select id="mSec"><option value="ssl"' + (s.secure === 'ssl' ? ' selected' : '') + '>SSL/TLS (465, recommended)</option><option value="starttls"' + (s.secure === 'starttls' ? ' selected' : '') + '>STARTTLS (587)</option><option value="none"' + (s.secure === 'none' ? ' selected' : '') + '>None (not safe)</option></select></label></div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">' + f('mUser', 'Mailbox login (full address)', s.user, 'info@yourdomain.com') + f('mPw', 'Mailbox password', '', s.hasPassword ? '•••••• saved (type to replace)' : 'enter password', 'password') + '</div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">' + f('mFrom', 'Send from address', s.from_email, 'info@yourdomain.com') + f('mName', 'Sender name', s.from_name) + f('mReply', 'Reply-to (optional)', s.reply_to) + f('mAlert', 'Security alerts go to', s.alert_to, 'defaults to the sender address') + '</div>' +
      (s.passwordUnreadable ? '<div class="msg err" style="margin-top:8px">The saved password cannot be read (the server secret changed). Enter it again.</div>' : '') +
      '<div style="margin-top:10px"><label><input type="checkbox" id="mOn"' + (s.enabled === '1' ? ' checked' : '') + '> Email switched on</label><br><label><input type="checkbox" id="mAl"' + (s.alert_security === '1' ? ' checked' : '') + '> Email me high-severity security alerts (at most one every 15 minutes)</label><br><label><input type="checkbox" id="mVer"' + (s.verify_cert === '1' ? ' checked' : '') + '> Check the server certificate (switch off only if your host gives a certificate error on shared hosting)</label></div>' +
      '<div id="mMsg" style="margin-top:8px"></div><button class="btn gold" id="mSave">Save settings</button></div>' +
      '<div class="panel" style="margin-top:12px"><h3 style="margin-top:0">Send a test email</h3><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end">' + f('mTo', 'Send to', '', 'you@example.com', 'email') + '<button class="btn gold" id="mTest">Send test</button></div><div id="tMsg" style="margin-top:8px"></div><p class="kmeta" style="color:var(--mute)">The daily digest goes to the digest email set in Growth > Settings (sent after 8pm Nairobi time).</p></div>' +
      '<div class="panel" style="margin-top:12px"><h3 style="margin-top:0">Recent messages</h3><div class="scroll"><table class="t"><thead><tr><th>When</th><th>To</th><th>Subject</th><th>Result</th></tr></thead><tbody>' + (lg.log.length ? lg.log.map(function(x){ return '<tr><td>' + esc(x.when) + '</td><td>' + esc(x.to_addr) + '</td><td>' + esc(x.subject) + '</td><td>' + (x.status === 'sent' ? 'Sent' : '<span style="color:#ff8a9c">' + esc(x.status) + '</span><br><small>' + esc(x.error) + '</small>') + '</td></tr>'; }).join('') : '<tr><td colspan="4" style="color:var(--mute)">Nothing sent yet.</td></tr>') + '</tbody></table></div></div>';
    $('mFill').onclick = function(){ var dm = $('mDom').value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''); if(!dm){ $('mMsg').innerHTML = '<div class="msg err">Type your website domain first.</div>'; return; } $('mHost').value = 'mail.' + dm; $('mPort').value = '465'; $('mSec').value = 'ssl'; if(!$('mUser').value) $('mUser').value = 'info@' + dm; if(!$('mFrom').value) $('mFrom').value = 'info@' + dm; $('mMsg').innerHTML = '<div class="msg ok">Filled. Check the mailbox name, add its password, then Save.</div>'; };
    $('mSec').onchange = function(){ var m = $('mSec').value; if(m === 'ssl') $('mPort').value = '465'; if(m === 'starttls') $('mPort').value = '587'; };
    $('mSave').onclick = async function(){ var b = { host: $('mHost').value, port: $('mPort').value, secure: $('mSec').value, user: $('mUser').value, from_email: $('mFrom').value, from_name: $('mName').value, reply_to: $('mReply').value, alert_to: $('mAlert').value, enabled: $('mOn').checked ? '1' : '0', alert_security: $('mAl').checked ? '1' : '0', verify_cert: $('mVer').checked ? '1' : '0' }; if($('mPw').value) b.password = $('mPw').value;
      try{ await c.api('/admin/mail', { method: 'PUT', body: JSON.stringify(b) }); $('mMsg').innerHTML = '<div class="msg ok">Saved.</div>'; $('mPw').value = ''; }catch(e){ $('mMsg').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; } };
    $('mTest').onclick = async function(){ $('tMsg').innerHTML = 'Sending…'; $('mTest').disabled = true; try{ await c.api('/admin/mail/test', { method: 'POST', body: JSON.stringify({ to: $('mTo').value }) }); $('tMsg').innerHTML = '<div class="msg ok">Sent. Check that inbox (and spam).</div>'; }catch(e){ $('tMsg').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; } $('mTest').disabled = false; };
  };
})();
