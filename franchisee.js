// Franchisee portal (v6.4): own login; shows only this franchisee's branch, scorecard and royalty statements.
(function(){
  'use strict';
  var app = document.getElementById('app'), outBtn = document.getElementById('out'), TK = 'azFrTok', tok = '';
  try{ tok = sessionStorage.getItem(TK) || ''; }catch(e){}
  var esc = function(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var kes = function(n){ return 'KSh ' + Number(n || 0).toLocaleString('en-KE'); };
  var pc = function(v){ return v == null ? 'n/a' : v + '%'; };
  var api = async function(p, o){ o = o || {}; var r = await fetch('/api/branchops/portal' + p, { method: o.method || 'GET', cache: 'no-store', headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}), body: o.body }); var d = {}; try{ d = await r.json(); }catch(e){} if(r.status === 401 && tok && p !== '/login'){ signOut(); } if(!r.ok) throw new Error(d.error || 'Something went wrong'); return d; };
  var signOut = function(){ tok = ''; try{ sessionStorage.removeItem(TK); }catch(e){} outBtn.hidden = true; login(); };
  outBtn.onclick = signOut;
  function login(msg){
    app.innerHTML = '<div class="card" style="max-width:420px"><h2>Sign in</h2><form id="f"><label class="m">Username<input name="u" autocomplete="username" required></label><label class="m">Password<input name="p" type="password" autocomplete="current-password" required></label><button>Sign in</button><p id="m" class="err">' + esc(msg || '') + '</p></form><p class="m">Your username and password come from Azizo. Keep them private.</p></div>';
    document.getElementById('f').onsubmit = async function(e){ e.preventDefault(); var f = e.target; try{ var d = await api('/login', { method: 'POST', body: JSON.stringify({ username: f.u.value, password: f.p.value }) }); tok = d.token; try{ sessionStorage.setItem(TK, tok); }catch(x){} home(); }catch(x){ document.getElementById('m').textContent = x.message; } };
  }
  var days = 30;
  async function home(){
    outBtn.hidden = false;
    try{
      var r = await Promise.all([api('/me'), api('/summary?days=' + days), api('/royalties')]), me = r[0], sm = r[1], ry = r[2], b = sm.branch;
      var COL = { green: '#6ee7a0', amber: '#ffd27a', red: '#ff8a9c' };
      app.innerHTML = '<div class="card"><h2>' + esc(me.name) + '</h2><div class="m">' + (me.branch ? esc(me.branch.name) + (me.branch.address ? ', ' + esc(me.branch.address) : '') : 'Branch not linked yet') + ' &middot; stage: ' + esc(me.stage) + '</div><div class="grid" style="margin-top:10px"><div class="stat">Agreement<b>' + (me.agreementAt ? 'Signed' : 'Not yet') + '</b><span class="m">' + esc(me.agreementAt || '') + '</span></div><div class="stat">Franchise fee<b>' + (me.feePaidAt ? 'Paid' : 'Not paid') + '</b><span class="m">' + esc(me.feePaidAt || '') + '</span></div><div class="stat">Royalty<b>' + esc(me.royaltyPct) + '%</b><span class="m">of net sales</span></div><div class="stat">Term<b>' + esc(me.termYears) + ' years</b></div></div></div>' +
        (b ? '<div class="card"><div class="row"><h2>My branch: last ' + sm.days + ' days</h2><select id="d" style="width:auto"><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></select></div><p style="color:' + COL[b.status] + ';margin:0"><b>' + b.status.toUpperCase() + '</b> <span class="m">' + (b.flags.length ? esc(b.flags.join('; ')) : 'No flags') + '</span></p><div class="grid" style="margin-top:10px">' +
          [['Sales', kes(b.sales)], ['Orders', b.orders], ['Average order', kes(b.avgOrder)], ['Cancelled', pc(b.cancelledPct)], ['Checklists done', pc(b.compliancePct) + ' (target ' + sm.targets.compliance + '%)'], ['Open critical failures', b.openCritical], ['Waste', pc(b.wastePct) + ' (max ' + sm.targets.waste + '%)'], ['Food cost', pc(b.foodCostPct)], ['Cutting yield', pc(b.yieldPct)], ['Certified staff', b.certifiedStaff]].map(function(x){ return '<div class="stat"><span class="m">' + x[0] + '</span><b style="font-size:1.05rem">' + esc(x[1]) + '</b></div>'; }).join('') + '</div></div>' : '') +
        '<div class="card"><h2>Royalty statements</h2><p class="m">' + (ry.due ? 'Outstanding: <b class="err">' + kes(ry.due) + '</b>' : 'Nothing outstanding') + '</p><div class="scroll"><table><tr><th>Month</th><th>Net sales</th><th>Royalty</th><th>Total due</th><th>Status</th><th></th></tr>' + (ry.rows.length ? ry.rows.map(function(x){ return '<tr><td>' + esc(x.period) + '</td><td>' + kes(x.gross) + '</td><td>' + kes(x.royalty) + '</td><td>' + kes(x.total) + '</td><td>' + (x.status === 'paid' ? '<span class="ok">paid</span>' : 'due') + '</td><td><a class="b" href="' + esc(x.path) + '" target="_blank" rel="noopener">Open</a></td></tr>'; }).join('') : '<tr><td colspan="6" class="m">No statements yet.</td></tr>') + '</table></div></div>' +
        '<div class="card"><h2>Change my password</h2><form id="pw" style="max-width:360px"><input name="a" type="password" placeholder="Current password" autocomplete="current-password" required><input name="b" type="password" placeholder="New password (10+ characters, a letter and a number)" autocomplete="new-password" required><button>Change password</button> <span id="pm" class="m"></span></form></div><p class="m">Questions? WhatsApp Azizo on +254724888057.</p>';
      var sel = document.getElementById('d'); if(sel){ sel.value = String(days); sel.onchange = function(){ days = Number(sel.value); home(); }; }
      document.getElementById('pw').onsubmit = async function(e){ e.preventDefault(); var f = e.target, m = document.getElementById('pm'); try{ await api('/password', { method: 'POST', body: JSON.stringify({ password: f.a.value, newPassword: f.b.value }) }); m.className = 'ok'; m.textContent = 'Password changed.'; f.reset(); }catch(x){ m.className = 'err'; m.textContent = x.message; } };
    }catch(x){ if(tok) app.innerHTML = '<div class="card err">' + esc(x.message) + '</div>'; }
  }
  if(tok) home(); else login();
})();
