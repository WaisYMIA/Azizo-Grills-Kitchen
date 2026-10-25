/* Verified customer reviews (from the Azizo backend). Adds a block to reviews.html and star data for search engines. */
(function(){
  'use strict';
  if(typeof apiAvailable !== 'function' || !apiAvailable()) return;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
  async function init(){
    let data; try{ const r = await fetch(`${apiBase()}/api/reviews`, {cache:'no-store'}); if(!r.ok) return; data = await r.json(); }catch(e){ return; }
    if(!data.count) return;
    const anchor = document.querySelector('#reviews .wrap'); if(!anchor) return;
    const box = document.createElement('div'); box.style.marginTop = '30px';
    box.innerHTML = `<div class="sec-head"><div><div class="sec-eyebrow">Verified customers</div><h2>Reviews from real orders</h2></div></div>
      <div class="vr-summary"><div class="vr-avg">${data.average.toFixed(1)}</div><div><div class="vr-stars">${stars(Math.round(data.average))}</div><div>${data.count} review${data.count === 1 ? '' : 's'} from completed orders</div></div></div>
      <div class="vr-grid">${data.reviews.map(r => `<div class="vr-card"><div class="vr-stars">${stars(r.rating)}</div>${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
        ${r.photo ? `<img loading="lazy" alt="Photo from a customer review" src="${esc(r.photo.startsWith('/') ? apiBase() + r.photo : r.photo)}">` : ''}
        <div class="vr-meta">${esc(r.name)}${r.branch ? ' · ' + esc(r.branch) : ''} · ${esc(String(r.date || '').slice(0, 10))}</div>
        ${r.reply ? `<div class="vr-reply"><strong>Azizo:</strong> ${esc(r.reply)}</div>` : ''}</div>`).join('')}</div>`;
    anchor.appendChild(box);
    const ld = document.createElement('script'); ld.type = 'application/ld+json';
    ld.textContent = JSON.stringify({'@context':'https://schema.org','@type':'GroceryStore','name':'Azizo Butchery & Grill','url':'https://www.azizobutchery.co.ke/',
      aggregateRating:{'@type':'AggregateRating', ratingValue: data.average, reviewCount: data.count, bestRating: 5}});
    document.head.appendChild(ld);
  }
  window.addEventListener('load', () => setTimeout(init, 300));
})();
