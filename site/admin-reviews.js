/* Azizo admin - Reviews moderation. Loaded by admin.html; uses its api(), authHeaders(), escapeHtml(). */
(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => escapeHtml(s);
  let list = [], filter = 'pending', loaded = false;
  const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
  async function call(path, method, body){
    const res = await fetch(api(path), {method: method || 'GET', headers: authHeaders(body ? {'Content-Type': 'application/json'} : {}), body: body ? JSON.stringify(body) : undefined, cache: 'no-store'});
    const data = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
    return data;
  }
  const status = (m, bad) => { const el = $('rvStatus'); if(el){ el.textContent = m || ''; el.style.color = bad ? '#b23a3a' : ''; } };
  function shell(){
    $('reviewsTab').innerHTML = `<div class="panel"><h3>Customer reviews</h3>
      <p class="hint">Customers can review an order only after it is <strong>completed</strong> (order number + their phone), one review per order. New reviews wait here as <strong>Pending</strong>: <strong>Approve</strong> to show one on the Reviews page (and add to the star rating), <strong>Hide</strong> to keep it private. A short public reply is optional.</p>
      <div class="toolbar" id="rvChips">${[['pending','Pending'],['approved','Approved'],['hidden','Hidden'],['all','All']].map(([k, l]) => `<button class="excel-btn ${k === 'pending' ? '' : 'secondary'}" data-f="${k}">${l}</button>`).join('')}</div>
      <div class="status-line" id="rvStatus"></div><div id="rvList"></div></div>`;
    $('rvChips').addEventListener('click', e => { const b = e.target.closest('button'); if(!b) return; filter = b.dataset.f; document.querySelectorAll('#rvChips button').forEach(x => x.classList.toggle('secondary', x !== b)); render(); });
    $('rvList').addEventListener('click', async e => {
      const t = e.target, id = t.dataset.id; if(!id) return;
      try{
        if(t.dataset.act === 'delete'){ if(!confirm('Delete this review for good?')) return; await call('/api/reviews/' + id, 'DELETE'); }
        else if(t.dataset.act === 'reply') await call('/api/reviews/' + id, 'PATCH', {reply: $('rp' + id).value});
        else await call('/api/reviews/' + id, 'PATCH', {status: t.dataset.act});
        await reload();
      }catch(err){ status(err.message, true); }
    });
  }
  function render(){
    const rows = list.filter(r => filter === 'all' || r.status === filter);
    const pend = list.filter(r => r.status === 'pending').length;
    const btn = $('tabBtnReviews'); if(btn) btn.textContent = 'Reviews' + (pend ? ' (' + pend + ')' : '');
    status(`${rows.length} shown · ${pend} waiting for approval`);
    $('rvList').innerHTML = rows.map(r => `<div class="branch-row-admin" style="align-items:flex-start;${r.status === 'hidden' ? 'opacity:.6' : ''}">
      <div style="flex:1;min-width:240px"><div><strong style="color:#c89b3c;letter-spacing:2px">${stars(r.rating)}</strong> <span style="font-size:12px;color:var(--ink-soft)">${esc(r.name)} · order #${r.orderId} · ${esc(r.phone)} · ${esc(String(r.date || '').slice(0, 10))} · <b>${esc(r.status)}</b></span></div>
        ${r.comment ? `<p style="margin:6px 0">${esc(r.comment)}</p>` : '<p style="margin:6px 0;color:var(--ink-soft)">(no comment)</p>'}
        ${r.photo ? `<a href="${esc(api(r.photo))}" target="_blank" rel="noopener"><img src="${esc(api(r.photo))}" alt="review photo" style="max-height:110px;border-radius:6px;border:1px solid var(--line)"></a>` : ''}
        <div style="display:flex;gap:6px;margin-top:8px"><input id="rp${r.id}" value="${esc(r.reply)}" maxlength="400" placeholder="Public reply (optional)" style="flex:1;padding:8px;border:1px solid var(--line);border-radius:4px"><button class="excel-btn secondary" data-act="reply" data-id="${r.id}">Save reply</button></div></div>
      <div class="item-actions" style="flex-direction:column;gap:6px">
        ${r.status !== 'approved' ? `<button class="edit-btn" style="background:#2e7d46" data-act="approved" data-id="${r.id}">Approve</button>` : ''}
        ${r.status !== 'hidden' ? `<button class="edit-btn" data-act="hidden" data-id="${r.id}">Hide</button>` : ''}
        <button class="del-btn" data-act="delete" data-id="${r.id}">Delete</button></div></div>`).join('') || '<p class="empty-note">Nothing here.</p>';
  }
  async function reload(){ list = (await call('/api/reviews/all')).reviews || []; render(); }
  window.AzizoReviews = {
    async open(){ if(!loaded){ loaded = true; shell(); } try{ status('Loading…'); await reload(); }catch(e){ status("Couldn't load reviews: " + e.message, true); } },
    async badge(){ try{ list = (await call('/api/reviews/all')).reviews || []; const p = list.filter(r => r.status === 'pending').length; const b = $('tabBtnReviews'); if(b) b.textContent = 'Reviews' + (p ? ' (' + p + ')' : ''); }catch(e){} }
  };
})();
window.addEventListener('load', () => setTimeout(() => { try{ if(typeof getAdminToken === 'function' && getAdminToken() && window.AzizoReviews) window.AzizoReviews.badge(); }catch(e){} }, 700));
