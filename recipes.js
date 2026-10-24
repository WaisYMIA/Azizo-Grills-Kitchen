/* Azizo Cooking Hub (v2.0): recipe library, blog, search & filters, comments, sharing, reader submissions.
   Runs on recipes.html (hub) and recipe.html (single recipe or article). Uses globals from app.js. */
(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const WA = (typeof CONFIG !== 'undefined' && CONFIG.WA_NUMBER) || '254724888057';
  const hasApi = () => typeof apiAvailable === 'function' && apiAvailable();
  const base = () => hasApi() ? apiBase() : '';
  const LS = { get(k, d){ try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } }, set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} } };
  const stars = n => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
  const imgUrl = p => !p ? '' : (/^https?:/i.test(p) ? p : (p.charAt(0) === '/' ? base() + p : p));
  let DATA = { categories: [], recipes: [], settings: {} }, live = false;

  async function load(){
    if(hasApi()){
      try{ const r = await fetch(base() + '/api/recipes', {cache:'no-store'}); if(r.ok){ DATA = await r.json(); live = true; return; } }catch(e){}
    }
    try{ const r = await fetch('recipes.json'); DATA = await r.json(); }catch(e){}
  }
  const catIcon = n => { const c = DATA.categories.find(x => x.name === n); return c && c.icon ? c.icon : '🍽️'; };
  const mins = r => (r.prep || 0) + (r.cook || 0);
  const timeText = m => !m ? '' : (m >= 60 ? Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '') : m + ' min');
  const savedList = () => LS.get('azizoSaved', []);
  const isSaved = slug => savedList().includes(slug);
  function toggleSaved(slug){ let l = savedList(); l = l.includes(slug) ? l.filter(x => x !== slug) : l.concat(slug); LS.set('azizoSaved', l); return l.includes(slug); }
  const pageUrl = r => { const u = new URL('recipe.html', location.href); u.search = '?r=' + encodeURIComponent(r.slug); u.hash = ''; return u.toString(); };

  function media(r, cls){
    const u = imgUrl(r.image);
    return u ? `<div class="rh-media ${cls || ''}"><img loading="lazy" src="${esc(u)}" alt="${esc(r.title)}"></div>`
             : `<div class="rh-media rh-ph ${cls || ''}" aria-hidden="true"><span>${catIcon(r.category)}</span></div>`;
  }

  /* ---------------- sharing ---------------- */
  function shareText(r){ return `${r.title} - ${r.summary || 'A recipe from Azizo Butchery & Grill'}`; }
  function fullText(r){
    if(r.kind === 'article') return `*${r.title}*\n${r.summary}\n\n${pageUrl(r)}`;
    const ing = r.ingredients.map(i => i.startsWith('## ') ? `\n_${i.slice(3)}_` : '• ' + i).join('\n');
    const st = r.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
    return `*${r.title}*\n${r.summary}\n\n*Ingredients*\n${ing}\n\n*Method*\n${st}\n\nMore recipes: ${pageUrl(r)}\n(Azizo Butchery & Grill)`;
  }
  function shareLinks(r){
    const u = encodeURIComponent(pageUrl(r)), t = encodeURIComponent(shareText(r));
    return [
      ['WhatsApp', `https://wa.me/?text=${encodeURIComponent(shareText(r) + '\n' + pageUrl(r))}`, '#25D366'],
      ['Facebook', `https://www.facebook.com/sharer/sharer.php?u=${u}`, '#1877F2'],
      ['X', `https://twitter.com/intent/tweet?text=${t}&url=${u}`, '#111'],
      ['Telegram', `https://t.me/share/url?url=${u}&text=${t}`, '#229ED9'],
      ['Pinterest', `https://pinterest.com/pin/create/button/?url=${u}&description=${t}` + (r.image ? '&media=' + encodeURIComponent(new URL(imgUrl(r.image), location.href).toString()) : ''), '#E60023'],
      ['LinkedIn', `https://www.linkedin.com/sharing/share-offsite/?url=${u}`, '#0A66C2'],
      ['Email', `mailto:?subject=${encodeURIComponent(r.title)}&body=${encodeURIComponent(fullText(r))}`, '#8C2A2A']
    ];
  }
  function shareBar(r){
    return `<div class="rh-share" data-slug="${esc(r.slug)}"><span class="rh-share-l">Share</span>
      ${shareLinks(r).map(([n, h, c]) => `<a class="rh-sb" style="background:${c}" href="${esc(h)}" target="_blank" rel="noopener" aria-label="Share on ${n}">${n}</a>`).join('')}
      <button class="rh-sb rh-copy" type="button" data-act="copy">Copy link</button>
      ${navigator.share ? '<button class="rh-sb rh-native" type="button" data-act="native">More…</button>' : ''}
      ${r.kind === 'recipe' ? `<a class="rh-sb" style="background:#128C7E" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(fullText(r))}">Send full recipe on WhatsApp</a>` : ''}
    </div>`;
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if(!b) return;
    const box = b.closest('[data-slug]'); const r = box && DATA.recipes.find(x => x.slug === box.dataset.slug);
    if(b.dataset.act === 'copy' && r){ (navigator.clipboard ? navigator.clipboard.writeText(pageUrl(r)) : Promise.reject()).then(() => note('Link copied'), () => prompt('Copy this link', pageUrl(r))); }
    if(b.dataset.act === 'native' && r){ navigator.share({title: r.title, text: shareText(r), url: pageUrl(r)}).catch(() => {}); }
    if(b.dataset.act === 'save'){ const on = toggleSaved(b.dataset.slug); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.querySelector('.rh-h') && (b.querySelector('.rh-h').textContent = on ? '♥' : '♡'); note(on ? 'Saved to My Cookbook' : 'Removed from My Cookbook'); if(typeof renderHub === 'function' && FILTER.kind === 'saved') renderHub(); }
  });
  function note(msg){ { const t = document.createElement('div'); t.className = 'rh-toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2200); } }

  /* ---------------- HUB ---------------- */
  const FILTER = { q: '', kind: 'recipe', cat: '', style: '', cuisine: '', diff: '', time: 0, sort: 'featured', page: 1 };
  const PAGE = 12;
  const norm = s => String(s || '').toLowerCase();
  function matches(r){
    if(FILTER.kind === 'saved'){ if(!isSaved(r.slug)) return false; }
    else if(r.kind !== FILTER.kind) return false;
    if(FILTER.cat && r.category !== FILTER.cat) return false;
    if(FILTER.style && r.style !== FILTER.style) return false;
    if(FILTER.cuisine && r.cuisine !== FILTER.cuisine) return false;
    if(FILTER.diff && r.difficulty !== FILTER.diff) return false;
    if(FILTER.time && (!mins(r) || mins(r) > FILTER.time)) return false;
    if(FILTER.q){ const hay = norm([r.title, r.summary, r.category, r.style, r.cuisine, r.tags, r.ingredients.join(' '), r.body].join(' ')); if(!FILTER.q.split(/\s+/).every(w => hay.includes(w))) return false; }
    return true;
  }
  function sorted(list){
    const s = FILTER.sort, a = list.slice();
    if(s === 'new') a.sort((x, y) => String(y.date).localeCompare(String(x.date)));
    else if(s === 'top') a.sort((x, y) => (y.ratingAvg * Math.log(2 + y.ratingCount)) - (x.ratingAvg * Math.log(2 + x.ratingCount)) || (y.featured - x.featured));
    else if(s === 'quick') a.sort((x, y) => (mins(x) || 9999) - (mins(y) || 9999));
    else if(s === 'az') a.sort((x, y) => x.title.localeCompare(y.title));
    return a;
  }
  function card(r){
    const meta = r.kind === 'article' ? '<span>Read</span>' : [mins(r) ? `<span>⏱ ${timeText(mins(r))}</span>` : '', r.servings ? `<span>👥 ${r.servings}</span>` : '', r.difficulty ? `<span>${esc(r.difficulty)}</span>` : ''].join('');
    return `<article class="rh-card" data-slug="${esc(r.slug)}">
      <a class="rh-cl" href="recipe.html?r=${encodeURIComponent(r.slug)}">${media(r)}${r.badge ? `<span class="rh-badge">${esc(r.badge)}</span>` : ''}</a>
      <button class="rh-save${isSaved(r.slug) ? ' on' : ''}" type="button" data-act="save" data-slug="${esc(r.slug)}" aria-pressed="${isSaved(r.slug)}" aria-label="Save to My Cookbook"><span class="rh-h">${isSaved(r.slug) ? '♥' : '♡'}</span></button>
      <div class="rh-body"><div class="rh-tags"><span class="recipe-tag">${esc(r.category)}</span>${r.cuisine ? `<span class="rh-cu">${esc(r.cuisine)}</span>` : ''}</div>
      <h3><a href="recipe.html?r=${encodeURIComponent(r.slug)}">${esc(r.title)}</a></h3>
      <p class="recipe-teaser">${esc(r.summary)}</p>
      <div class="rh-meta">${meta}${r.ratingCount ? `<span class="rh-st">${stars(r.ratingAvg)} <small>${r.ratingAvg} (${r.ratingCount})</small></span>` : ''}${r.commentCount ? `<span>💬 ${r.commentCount}</span>` : ''}</div>
      <div class="rh-card-share"><a href="https://wa.me/?text=${encodeURIComponent(shareText(r) + '\n' + pageUrl(r))}" target="_blank" rel="noopener" aria-label="Share on WhatsApp">Share on WhatsApp</a></div></div></article>`;
  }
  function uniq(key){ return [...new Set(DATA.recipes.filter(r => r.kind === 'recipe' && r[key]).map(r => r[key]))].sort(); }
  function opts(list, cur, label){ return `<option value="">${label}</option>` + list.map(x => `<option${x === cur ? ' selected' : ''}>${esc(x)}</option>`).join(''); }
  function renderControls(){
    const kinds = [['recipe', 'Recipes'], ['article', 'Blog & Tips'], ['saved', '♥ My Cookbook']];
    $('rhKinds').innerHTML = kinds.map(([k, l]) => `<button type="button" class="rh-kind${FILTER.kind === k ? ' on' : ''}" data-kind="${k}">${l}</button>`).join('');
    const inKind = DATA.recipes.filter(r => FILTER.kind === 'saved' ? isSaved(r.slug) : r.kind === FILTER.kind);
    const counts = {}; inKind.forEach(r => counts[r.category] = (counts[r.category] || 0) + 1);
    const catList = DATA.categories.filter(c => counts[c.name]);
    $('rhCats').innerHTML = `<button type="button" class="rh-chip${FILTER.cat ? '' : ' on'}" data-cat="">All <small>${inKind.length}</small></button>` + catList.map(c => `<button type="button" class="rh-chip${FILTER.cat === c.name ? ' on' : ''}" data-cat="${esc(c.name)}">${esc(c.icon)} ${esc(c.name)} <small>${counts[c.name]}</small></button>`).join('');
    const rec = FILTER.kind === 'recipe' || FILTER.kind === 'saved';
    $('rhSelects').style.display = rec ? '' : 'none';
    $('rhStyle').innerHTML = opts(uniq('style'), FILTER.style, 'Any cooking style');
    $('rhCuisine').innerHTML = opts(uniq('cuisine'), FILTER.cuisine, 'Any cuisine');
    $('rhDiff').innerHTML = opts(['Easy', 'Medium', 'Hard'], FILTER.diff, 'Any difficulty');
  }
  function renderHub(){
    renderControls();
    const all = sorted(DATA.recipes.filter(matches));
    const shown = all.slice(0, FILTER.page * PAGE);
    const feat = $('rhFeatured'); const plain = !FILTER.q && !FILTER.cat && !FILTER.style && !FILTER.cuisine && !FILTER.diff && !FILTER.time && FILTER.kind === 'recipe';
    const fl = DATA.recipes.filter(r => r.featured && r.kind === 'recipe').slice(0, 4);
    feat.innerHTML = plain && fl.length ? `<h3 class="rh-h3">Crowd favourites</h3><div class="rh-grid rh-grid-feat">${fl.map(card).join('')}</div><h3 class="rh-h3">All recipes</h3>` : '';
    $('rhCount').textContent = all.length ? `${all.length} ${FILTER.kind === 'article' ? 'article' : 'recipe'}${all.length === 1 ? '' : 's'} found` : '';
    $('rhGrid').innerHTML = shown.map(card).join('') || `<div class="rh-empty"><p>${FILTER.kind === 'saved' ? 'Tap the ♡ on any recipe to keep it here.' : 'Nothing matches. Try fewer filters or a different word.'}</p><button type="button" class="rh-btn" id="rhClear2">Clear filters</button></div>`;
    $('rhMore').style.display = all.length > shown.length ? '' : 'none';
    const c2 = $('rhClear2'); if(c2) c2.onclick = clearFilters;
  }
  window.renderHub = renderHub;
  function clearFilters(){ Object.assign(FILTER, { q: '', cat: '', style: '', cuisine: '', diff: '', time: 0, sort: 'featured', page: 1 }); $('rhSearch').value = ''; $('rhTime').value = '0'; $('rhSort').value = 'featured'; renderHub(); }

  function engageForm(){
    const f = $('rhSubmit'); if(!f) return;
    if(!live){ f.innerHTML = `<p>Want to share a recipe or ask us something? Message us on <a href="https://wa.me/${WA}" target="_blank" rel="noopener">WhatsApp</a>.</p>`; return; }
    f.addEventListener('submit', async e => {
      e.preventDefault(); const st = $('rhSubStatus'); st.textContent = 'Sending…'; st.className = 'rh-status';
      const g = n => f.elements[n].value;
      try{
        const r = await fetch(base() + '/api/recipes/submit', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ kind: g('kind'), name: g('name'), contact: g('contact'), title: g('title'), message: g('message'), website: g('website') })});
        const d = await r.json().catch(() => ({})); if(!r.ok) throw new Error(d.error || 'Could not send');
        st.textContent = d.message || 'Thank you!'; st.className = 'rh-status ok'; f.reset();
      }catch(err){ st.textContent = err.message; st.className = 'rh-status bad'; }
    });
  }

  async function initHub(){
    await load(); if(!DATA.recipes.length){ $('rhGrid').innerHTML = '<p class="rh-empty">Recipes are loading. Please refresh.</p>'; return; }
    const p = new URLSearchParams(location.search);
    if(p.get('q')) FILTER.q = norm(p.get('q')); if(p.get('cat')) FILTER.cat = p.get('cat'); if(p.get('kind') === 'article' || p.get('kind') === 'saved') FILTER.kind = p.get('kind');
    $('rhSearch').value = FILTER.q;
    let tm; $('rhSearch').addEventListener('input', e => { clearTimeout(tm); tm = setTimeout(() => { FILTER.q = norm(e.target.value.trim()); FILTER.page = 1; renderHub(); }, 180); });
    $('rhKinds').addEventListener('click', e => { const b = e.target.closest('[data-kind]'); if(!b) return; Object.assign(FILTER, {kind: b.dataset.kind, cat: '', style: '', cuisine: '', diff: '', page: 1}); renderHub(); });
    $('rhCats').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if(!b) return; FILTER.cat = b.dataset.cat; FILTER.page = 1; renderHub(); });
    [['rhStyle', 'style'], ['rhCuisine', 'cuisine'], ['rhDiff', 'diff']].forEach(([id, k]) => $(id).addEventListener('change', e => { FILTER[k] = e.target.value; FILTER.page = 1; renderHub(); }));
    $('rhTime').addEventListener('change', e => { FILTER.time = parseInt(e.target.value, 10) || 0; FILTER.page = 1; renderHub(); });
    $('rhSort').addEventListener('change', e => { FILTER.sort = e.target.value; FILTER.page = 1; renderHub(); });
    $('rhClear').addEventListener('click', clearFilters);
    $('rhMore').addEventListener('click', () => { FILTER.page++; renderHub(); });
    renderHub(); engageForm();
    const ld = document.createElement('script'); ld.type = 'application/ld+json';
    ld.textContent = JSON.stringify({'@context': 'https://schema.org', '@type': 'ItemList', name: 'Azizo recipes', itemListElement: DATA.recipes.filter(r => r.kind === 'recipe').slice(0, 30).map((r, i) => ({'@type': 'ListItem', position: i + 1, url: pageUrl(r), name: r.title}))});
    document.head.appendChild(ld);
  }

  /* ---------------- SINGLE PAGE ---------------- */
  function bodyHtml(t){
    const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    let out = '', list = false;
    String(t || '').split(/\r?\n/).forEach(l => {
      l = l.trim(); if(!l){ if(list){ out += '</ul>'; list = false; } return; }
      if(l.startsWith('- ')){ if(!list){ out += '<ul>'; list = true; } out += `<li>${inline(l.slice(2))}</li>`; return; }
      if(list){ out += '</ul>'; list = false; }
      out += l.startsWith('## ') ? `<h3>${inline(l.slice(3))}</h3>` : l.startsWith('# ') ? `<h2>${inline(l.slice(2))}</h2>` : `<p>${inline(l)}</p>`;
    });
    return out + (list ? '</ul>' : '');
  }
  function setMeta(r){
    document.title = `${r.title} | Azizo Butchery & Grill`;
    const set = (sel, attr, val, mk) => { let el = document.head.querySelector(sel); if(!el){ el = document.createElement(mk[0]); mk[1].forEach(([a, v]) => el.setAttribute(a, v)); document.head.appendChild(el); } el.setAttribute(attr, val); };
    set('meta[name="description"]', 'content', r.summary, ['meta', [['name', 'description']]]);
    set('link[rel="canonical"]', 'href', pageUrl(r), ['link', [['rel', 'canonical']]]);
    set('meta[property="og:title"]', 'content', r.title, ['meta', [['property', 'og:title']]]);
    set('meta[property="og:description"]', 'content', r.summary, ['meta', [['property', 'og:description']]]);
    set('meta[property="og:url"]', 'content', pageUrl(r), ['meta', [['property', 'og:url']]]);
    if(r.image) set('meta[property="og:image"]', 'content', new URL(imgUrl(r.image), location.href).toString(), ['meta', [['property', 'og:image']]]);
    const iso = m => 'PT' + (m || 0) + 'M';
    const ld = r.kind === 'article'
      ? {'@context': 'https://schema.org', '@type': 'BlogPosting', headline: r.title, description: r.summary, datePublished: String(r.date).slice(0, 10), author: {'@type': 'Organization', name: 'Azizo Butchery & Grill'}, image: r.image ? new URL(imgUrl(r.image), location.href).toString() : undefined}
      : {'@context': 'https://schema.org', '@type': 'Recipe', name: r.title, description: r.summary, datePublished: String(r.date).slice(0, 10), author: {'@type': 'Organization', name: 'Azizo Butchery & Grill'},
         image: r.image ? new URL(imgUrl(r.image), location.href).toString() : undefined, prepTime: iso(r.prep), cookTime: iso(r.cook), totalTime: iso(mins(r)), recipeYield: r.servings ? r.servings + ' servings' : undefined,
         recipeCategory: r.category, recipeCuisine: r.cuisine || undefined, keywords: r.tags || undefined, recipeIngredient: r.ingredients.filter(i => !i.startsWith('## ')),
         recipeInstructions: r.steps.map(s => ({'@type': 'HowToStep', text: s})),
         aggregateRating: r.ratingCount ? {'@type': 'AggregateRating', ratingValue: r.ratingAvg, ratingCount: r.ratingCount, bestRating: 5} : undefined};
    const s = document.createElement('script'); s.type = 'application/ld+json'; s.textContent = JSON.stringify(ld); document.head.appendChild(s);
  }
  function viewHtml(r){
    const rec = r.kind === 'recipe';
    const facts = rec ? [['Prep', r.prep ? r.prep + ' min' : ''], ['Cook', r.cook ? timeText(r.cook) : ''], ['Serves', r.servings || ''], ['Level', r.difficulty], ['Style', r.style], ['Cuisine', r.cuisine]].filter(f => f[1]) : [];
    const ing = r.ingredients.map(i => i.startsWith('## ') ? `<li class="rv-sub">${esc(i.slice(3))}</li>` : `<li><label><input type="checkbox"> <span>${esc(i)}</span></label></li>`).join('');
    const order = `https://wa.me/${WA}?text=${encodeURIComponent('Hi Azizo, I would like to order the meat for: ' + r.title)}`;
    return `<nav class="rv-crumbs"><a href="recipes.html">Cooking Hub</a> › <a href="recipes.html?cat=${encodeURIComponent(r.category)}${r.kind === 'article' ? '&kind=article' : ''}">${esc(r.category)}</a></nav>
      <article class="rv" data-slug="${esc(r.slug)}">
        <div class="rv-head"><span class="recipe-tag">${esc(r.category)}</span>${r.badge ? `<span class="rh-badge rh-badge-inline">${esc(r.badge)}</span>` : ''}
          <h1>${esc(r.title)}</h1><p class="rv-sum">${esc(r.summary)}</p>
          <div class="rv-rate">${r.ratingCount ? `<span class="rh-st">${stars(r.ratingAvg)}</span> <b>${r.ratingAvg}</b> (${r.ratingCount} rating${r.ratingCount === 1 ? '' : 's'}) · ` : ''}<a href="#comments">${r.commentCount ? r.commentCount + ' comment' + (r.commentCount === 1 ? '' : 's') : 'Be the first to comment'}</a></div></div>
        ${media(r, 'rv-media')}
        ${facts.length ? `<div class="rv-facts">${facts.map(f => `<div><small>${f[0]}</small><b>${esc(f[1])}</b></div>`).join('')}</div>` : ''}
        <div class="rv-actions"><button type="button" class="rh-btn ${isSaved(r.slug) ? 'on' : ''}" data-act="save" data-slug="${esc(r.slug)}" aria-pressed="${isSaved(r.slug)}"><span class="rh-h">${isSaved(r.slug) ? '♥' : '♡'}</span> Save</button>
          <button type="button" class="rh-btn" onclick="window.print()">🖨 Print</button>
          ${rec ? `<a class="rh-btn rh-btn-gold" href="${esc(order)}" target="_blank" rel="noopener">Order the meat for this</a>` : '<a class="rh-btn rh-btn-gold" href="fresh-market.html">Shop fresh meat</a>'}</div>
        ${shareBar(r)}
        ${rec ? `<div class="rv-cols"><section class="rv-ing"><h2>Ingredients</h2><ul>${ing}</ul></section>
          <section class="rv-steps"><h2>Method</h2><ol>${r.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>${r.tips ? `<div class="rv-tip"><b>Butcher's tip</b><p>${esc(r.tips)}</p></div>` : ''}</section></div>` : `<div class="rv-body">${bodyHtml(r.body)}</div>`}
        ${rec && r.body ? `<div class="rv-body">${bodyHtml(r.body)}</div>` : ''}
        <section class="rv-share2"><h2>Cooked it? Share it!</h2><p>Tell friends and family about this recipe, or send us a photo and your own recipe below.</p>${shareBar(r)}</section>
      </article>`;
  }
  const rel = r => DATA.recipes.filter(x => x.slug !== r.slug && x.kind === r.kind && x.category === r.category).slice(0, 3);
  function threads(list){
    const top = list.filter(c => !c.parentId), kids = {}; list.filter(c => c.parentId).forEach(c => (kids[c.parentId] = kids[c.parentId] || []).push(c));
    const one = (c, reply) => `<div class="cm${c.staff ? ' cm-staff' : ''}${reply ? ' cm-reply' : ''}" id="cm${c.id}"><div class="cm-h"><b>${esc(c.name)}</b>${c.staff ? ' <span class="cm-badge">Azizo team</span>' : ''}${c.rating ? ` <span class="rh-st">${stars(c.rating)}</span>` : ''}<small>${esc(String(c.date).slice(0, 10))}</small></div><p>${esc(c.comment)}</p>${reply ? '' : `<button type="button" class="cm-rbtn" data-reply="${c.id}">Reply</button>`}</div>`;
    return top.map(c => one(c) + (kids[c.id] || []).map(k => one(k, true)).join('') + `<div class="cm-rform" id="rf${c.id}"></div>`).join('') || '<p class="rh-empty">No comments yet. Start the conversation!</p>';
  }
  function commentForm(parent){
    return `<form class="cm-form" data-parent="${parent || 0}"><div class="cm-row"><input name="name" placeholder="Your name" maxlength="50" required><input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true"></div>
      ${parent ? '' : '<div class="cm-stars" role="radiogroup" aria-label="Your rating">' + [5, 4, 3, 2, 1].map(n => `<input type="radio" name="rating" id="rt${n}" value="${n}"><label for="rt${n}" title="${n} star${n > 1 ? 's' : ''}">★</label>`).join('') + '<span class="cm-rt">Rate this (optional)</span></div>'}
      <textarea name="comment" rows="${parent ? 2 : 4}" maxlength="1200" placeholder="${parent ? 'Write a reply…' : 'Share your tips, changes or how it turned out…'}" required></textarea>
      <div class="cm-act"><button class="rh-btn rh-btn-gold" type="submit">${parent ? 'Post reply' : 'Post comment'}</button><span class="rh-status"></span></div></form>`;
  }
  async function loadComments(r){
    const box = $('cmList'); if(!live){ return; }
    try{ const d = await (await fetch(`${base()}/api/recipes/${r.id}/comments`, {cache: 'no-store'})).json(); box.innerHTML = threads(d.comments || []); }catch(e){ box.innerHTML = '<p class="rh-empty">Comments could not be loaded.</p>'; }
  }
  async function postComment(form, r){
    const st = form.querySelector('.rh-status'); st.textContent = 'Posting…'; st.className = 'rh-status';
    const fd = new FormData(form);
    try{
      const res = await fetch(`${base()}/api/recipes/${r.id}/comments`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ name: fd.get('name'), comment: fd.get('comment'), rating: fd.get('rating'), website: fd.get('website'), parentId: Number(form.dataset.parent) || undefined })});
      const d = await res.json().catch(() => ({})); if(!res.ok) throw new Error(d.error || 'Could not post');
      LS.set('azizoCommenter', fd.get('name'));
      st.textContent = d.message; st.className = 'rh-status ok'; form.querySelector('textarea').value = '';
      if(d.status === 'approved') loadComments(r);
    }catch(err){ st.textContent = err.message; st.className = 'rh-status bad'; }
  }
  async function initSingle(){
    await load(); const slug = new URLSearchParams(location.search).get('r');
    const r = DATA.recipes.find(x => x.slug === slug); const root = $('rvRoot');
    if(!r){ root.innerHTML = '<div class="rh-empty"><h2>We could not find that recipe</h2><p><a href="recipes.html">Back to all recipes</a></p></div>'; document.title = 'Recipe not found | Azizo'; return; }
    setMeta(r);
    root.innerHTML = viewHtml(r) + `<section class="cm-wrap" id="comments"><h2>Join the conversation</h2>${live ? `<div id="cmFormBox">${commentForm(0)}</div><div id="cmList" class="cm-list"><p class="rh-empty">Loading comments…</p></div>` : `<p class="rh-empty">Comments need our live server. Meanwhile, talk to us on <a href="https://wa.me/${WA}" target="_blank" rel="noopener">WhatsApp</a>.</p>`}</section>
      ${rel(r).length ? `<section class="rv-rel"><h2>More from ${esc(r.category)}</h2><div class="rh-grid">${rel(r).map(card).join('')}</div></section>` : ''}`;
    const nm = LS.get('azizoCommenter', ''); if(nm){ const i = document.querySelector('.cm-form input[name=name]'); if(i) i.value = nm; }
    root.addEventListener('submit', e => { if(e.target.classList.contains('cm-form')){ e.preventDefault(); postComment(e.target, r); } });
    root.addEventListener('click', e => { const b = e.target.closest('[data-reply]'); if(!b) return; const h = $('rf' + b.dataset.reply); if(h.innerHTML){ h.innerHTML = ''; return; } h.innerHTML = commentForm(b.dataset.reply); const n = LS.get('azizoCommenter', ''); if(n) h.querySelector('input[name=name]').value = n; });
    if(live) loadComments(r);
  }
  window.addEventListener('DOMContentLoaded', () => { if($('rhGrid')) initHub(); else if($('rvRoot')) initSingle(); });
})();
