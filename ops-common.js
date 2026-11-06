// Shared helpers for the v5.0 operations screens (admin Operations page, partner portal, kitchen portal).
(function(){
  'use strict';
  var K = window.KK, esc = K.esc, O = window.OPS = {};
  O.api = function(path, opts, token){ return K.apiAt('/api/ops', path, opts, token); };
  O.gApi = function(path, opts, token){ return K.apiAt('/api/growth', path, opts, token); };
  O.aiApi = function(path, opts, token){ return K.apiAt('/api/ai', path, opts, token); };
  // very small, safe markdown renderer for the SOP library (headings, lists, bold, quotes, paragraphs)
  O.md = function(src){
    var inl = function(t){ return esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>'); };
    var out = [], list = null, para = [];
    var flushP = function(){ if(para.length){ out.push('<p>' + inl(para.join(' ')) + '</p>'); para = []; } };
    var flushL = function(){ if(list){ out.push('</' + list + '>'); list = null; } };
    String(src || '').split('\n').forEach(function(line){
      var m;
      if((m = /^(#{1,3})\s+(.*)$/.exec(line))){ flushP(); flushL(); var n = m[1].length + 1; out.push('<h' + n + '>' + inl(m[2]) + '</h' + n + '>'); }
      else if((m = /^\d+\.\s+(.*)$/.exec(line))){ flushP(); if(list !== 'ol'){ flushL(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inl(m[1]) + '</li>'); }
      else if((m = /^[-*]\s+(.*)$/.exec(line))){ flushP(); if(list !== 'ul'){ flushL(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inl(m[1]) + '</li>'); }
      else if((m = /^>\s?(.*)$/.exec(line))){ flushP(); flushL(); out.push('<blockquote>' + inl(m[1]) + '</blockquote>'); }
      else if(/^\s*$/.test(line)){ flushP(); flushL(); }
      else if(/^(Scope|Document AZ-SOP)/.test(line)){ flushP(); flushL(); out.push('<p class="sop-meta">' + inl(line) + '</p>'); }
      else { flushL(); para.push(line.trim()); }
    });
    flushP(); flushL(); return '<div class="sop-doc">' + out.join('') + '</div>';
  };
  // SOP library panel; token is the signed-in partner/kitchen/inspector/admin token
  O.sopPanel = async function(host, token, scopeHint){
    var r = await O.api('/sops', {}, token), cur = '';
    var scopes = ['All', 'Butchery', 'Ready to Eat', 'Kitchens', 'Admin'];
    var draw = function(filter){
      var list = r.sops.filter(function(s){ return !filter || filter === 'All' || s.scope === 'All' || s.scope.indexOf(filter) > -1; });
      host.innerHTML = '<div class="panel"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center"><h3 style="margin:0">SOP handbook</h3><div class="noprint">' + scopes.map(function(s){ return '<button class="btn sm ' + ((filter || 'All') === s ? 'gold' : '') + '" data-f="' + s + '">' + s + '</button> '; }).join('') + '<button class="btn sm" id="sopPrint">Print</button></div></div><p class="kmeta" style="color:var(--mute)">Standard operating procedures for every Azizo partner. Read the ones for your business, and ask a support ticket if anything is unclear.</p>' +
        '<div class="sop-grid"><div class="sop-list noprint">' + list.map(function(s){ return '<button class="sop-item ' + (s.id === cur ? 'on' : '') + '" data-s="' + esc(s.id) + '"><b>' + esc(s.code) + '</b> ' + esc(s.title.replace(/^[^\w]*/, '')) + '<small>' + esc(s.scope) + '</small></button>'; }).join('') + '</div><div id="sopBody" class="sop-body">' + (cur ? '' : '<p style="color:var(--mute)">Choose a document on the left.</p>') + '</div></div></div>';
      host.querySelectorAll('[data-f]').forEach(function(b){ b.onclick = function(){ draw(b.dataset.f); }; });
      host.querySelectorAll('[data-s]').forEach(function(b){ b.onclick = async function(){ cur = b.dataset.s; try{ var d = await O.api('/sops/' + cur, {}, token); draw(filter); document.getElementById('sopBody').innerHTML = O.md(d.markdown); }catch(e){ document.getElementById('sopBody').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; } }; });
      var pr = document.getElementById('sopPrint'); if(pr) pr.onclick = function(){ window.print(); };
    };
    draw(scopeHint || 'All');
  };
  // support tickets panel for partners / kitchens
  O.ticketPanel = function(host, token){
    var show = async function(){
      var r = await O.api('/tickets', {}, token);
      host.innerHTML = '<div class="panel"><h3 style="margin-top:0">Support</h3><p class="kmeta" style="color:var(--mute)">Ask Azizo head office. Normal tickets are answered within 1 working day. Mark urgent only for safety, payment or customer-illness issues.</p>' +
        '<label class="f" for="tS">Subject</label><input id="tS" maxlength="120"><label class="f" for="tC">Type</label><select id="tC"><option value="general">General question</option><option value="payment">Payment or invoice</option><option value="order-problem">Problem with an order</option><option value="hygiene">Hygiene or safety</option><option value="supplies">Supplies or stock</option><option value="technical">Website or app problem</option><option value="complaint">Complaint</option></select>' +
        '<label class="f" for="tB">Message</label><textarea id="tB" rows="4" maxlength="2000"></textarea><label style="display:flex;gap:8px;align-items:center;margin:8px 0"><input type="checkbox" id="tU"> Urgent (safety, payment or customer illness)</label><div id="tE"></div><button class="btn gold" id="tGo">Send to Azizo</button></div>' +
        '<div class="panel" style="margin-top:12px"><h3 style="margin-top:0">Your tickets</h3>' + (r.tickets.length ? r.tickets.map(function(t){ return '<button class="sop-item" data-t="' + t.id + '"><b>' + esc(t.ref) + '</b> ' + esc(t.subject) + '<small>' + esc(t.status) + (t.status === 'answered' ? ' - Azizo replied' : '') + ' · ' + esc(String(t.updated_at).slice(0, 16)) + '</small></button>'; }).join('') : '<p style="color:var(--mute)">No tickets yet.</p>') + '</div><div id="tThread"></div>';
      document.getElementById('tGo').onclick = async function(){ var e = document.getElementById('tE'); e.innerHTML = ''; try{ var x = await O.api('/tickets', { method: 'POST', body: JSON.stringify({ subject: document.getElementById('tS').value, category: document.getElementById('tC').value, body: document.getElementById('tB').value, priority: document.getElementById('tU').checked ? 'urgent' : 'normal' }) }, token); K.toast && K.toast('Sent: ' + x.ref); show(); }catch(er){ e.innerHTML = '<div class="msg err">' + esc(er.message) + '</div>'; } };
      host.querySelectorAll('[data-t]').forEach(function(b){ b.onclick = function(){ thread(b.dataset.t); }; });
    };
    var thread = async function(id){
      var d = await O.api('/tickets/' + id, {}, token), el = document.getElementById('tThread');
      el.innerHTML = '<div class="panel" style="margin-top:12px"><h3 style="margin-top:0">' + esc(d.ticket.ref) + ' · ' + esc(d.ticket.subject) + ' <span class="pill">' + esc(d.ticket.status) + '</span></h3>' + d.messages.map(function(m){ return '<div class="tk-msg ' + (m.from_role === 'azizo' ? 'az' : '') + '"><small>' + esc(m.from_name) + ' · ' + esc(String(m.created_at).slice(0, 16)) + '</small><div>' + esc(m.body).replace(/\n/g, '<br>') + '</div></div>'; }).join('') +
        (d.ticket.status === 'closed' ? '<p style="color:var(--mute)">This ticket is closed. Open a new one if you need more help.</p>' : '<textarea id="tR" rows="3" maxlength="2000" placeholder="Reply"></textarea><div id="tRE"></div><button class="btn gold" id="tRG">Send reply</button>') + '</div>';
      var g = document.getElementById('tRG'); if(g) g.onclick = async function(){ try{ await O.api('/tickets/' + id + '/reply', { method: 'POST', body: JSON.stringify({ body: document.getElementById('tR').value }) }, token); thread(id); }catch(er){ document.getElementById('tRE').innerHTML = '<div class="msg err">' + esc(er.message) + '</div>'; } };
    };
    show().catch(function(e){ host.innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; });
  };
  // tiny bar chart (CSS only)
  O.bars = function(rows, label, value, fmt){
    var max = Math.max.apply(null, rows.map(function(r){ return value(r); }).concat([1]));
    return '<div class="bars">' + rows.map(function(r){ var v = value(r); return '<div class="bar-row"><span class="bar-l">' + esc(label(r)) + '</span><span class="bar-t"><i style="width:' + Math.max(2, Math.round(v * 100 / max)) + '%"></i></span><span class="bar-v">' + esc(fmt ? fmt(v) : v) + '</span></div>'; }).join('') + '</div>';
  };
})();
