/* Azizo admin - Cooking Hub manager (recipes, blog posts, categories, comments, reader submissions, image library, backup).
   Loaded by admin.html; uses its api(), authHeaders(), escapeHtml(). */
(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => escapeHtml(s);
  let S = { recipes: [], categories: [], settings: {}, pending: { comments: 0, submissions: 0 } };
  let view = 'library', loaded = false, editing = null, sel = new Set();
  let F = { q: '', kind: '', cat: '', status: '' }, cmFilter = 'pending', comments = [], subs = [], media = [];
  const STYLES = ['Grill', 'Roast', 'Stew', 'Curry', 'Pan-fry', 'Fry', 'Stir-fry', 'Soup', 'Slow-cook', 'Bake', 'Rice dish', 'Pasta', 'Wrap', 'Street food', 'Side', 'Simmer'];
  const CUISINES = ['Kenyan', 'Swahili', 'East African', 'African', 'Indian', 'Middle Eastern', 'Moroccan', 'Mediterranean', 'Italian', 'French', 'European', 'British', 'American', 'Mexican', 'Caribbean', 'Chinese', 'Korean', 'Indonesian', 'Filipino', 'Turkish'];

  async function call(path, method, body){
    const res = await fetch(api(path), {method: method || 'GET', headers: authHeaders(body ? {'Content-Type': 'application/json'} : {}), body: body ? JSON.stringify(body) : undefined, cache: 'no-store'});
    const data = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
    return data;
  }
  const status = (m, bad) => { const el = $('arStatus'); if(el){ el.textContent = m || ''; el.style.color = bad ? '#b23a3a' : '#2e7d46'; if(m && !bad) setTimeout(() => { if(el.textContent === m) el.textContent = ''; }, 4000); } };
  const imgSrc = p => !p ? '' : (/^https?:/i.test(p) ? p : (p.charAt(0) === '/' ? api(p) : p));
  const pubUrl = slug => new URL('recipe.html?r=' + encodeURIComponent(slug), location.href).toString();
  const slugify = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  const fmtDate = d => String(d || '').slice(0, 10);

  function css(){
    if($('arCss')) return; const st = document.createElement('style'); st.id = 'arCss';
    st.textContent = `.ar-sub{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;border-bottom:2px solid var(--line);padding-bottom:10px}
    .ar-sub button{background:#fff;border:1px solid var(--line);padding:9px 14px;border-radius:4px;font-weight:700;font-size:12.5px;cursor:pointer;color:var(--ink)}
    .ar-sub button.on{background:var(--maroon);color:#fff;border-color:var(--maroon)}
    .ar-t{width:100%;border-collapse:collapse;font-size:13px;background:#fff}
    .ar-t th{background:var(--cream);text-align:left;padding:8px 10px;font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-soft);position:sticky;top:0}
    .ar-t td{padding:8px 10px;border-top:1px solid var(--line);vertical-align:middle}
    .ar-t tr:hover td{background:#fbf8f2}
    .ar-th{width:54px;height:40px;object-fit:cover;border-radius:4px;background:#2a211d;display:block}
    .ar-ph{width:54px;height:40px;border-radius:4px;background:#2a211d;display:flex;align-items:center;justify-content:center;font-size:20px}
    .ar-pill{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700}
    .ar-pub{background:#dff3e5;color:#1f6b3a}.ar-dra{background:#eee;color:#666}.ar-art{background:#e7ecff;color:#2b4aa8}
    .ar-wrap{overflow:auto;max-height:68vh;border:1px solid var(--line);border-radius:6px}
    .ar-bulk{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0;padding:10px;background:var(--cream);border-radius:6px}
    .ar-bulk button,.ar-btn{padding:7px 12px;border:0;border-radius:4px;background:var(--ink-soft);color:#fff;font-weight:700;font-size:12px;cursor:pointer}
    .ar-btn.pri{background:var(--maroon)}.ar-btn.gold{background:var(--gold);color:var(--maroon-deep)}.ar-btn.red{background:var(--red)}.ar-btn.green{background:var(--green)}
    .ar-in{padding:8px 10px;border:1px solid var(--line);border-radius:4px;font-size:13px;font-family:inherit;max-width:100%}
    .ar-form{display:grid;grid-template-columns:2fr 1fr;gap:18px}
    .ar-form .box{background:#fff;border:1px solid var(--line);border-radius:6px;padding:14px;margin-bottom:14px}
    .ar-form label{display:block;font-size:12px;font-weight:700;color:var(--ink-soft);margin:10px 0 4px}
    .ar-form input,.ar-form select,.ar-form textarea{width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:4px;font-size:13.5px;font-family:inherit;box-sizing:border-box}
    .ar-g3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.ar-g2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .ar-prev{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:6px;background:#2a211d;display:block;margin-bottom:8px}
    .ar-media{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
    .ar-m{border:1px solid var(--line);border-radius:6px;overflow:hidden;background:#fff;font-size:11.5px}
    .ar-m img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;cursor:pointer}
    .ar-m div{padding:6px 8px;display:flex;gap:6px;justify-content:space-between;align-items:center}
    .ar-cm{background:#fff;border:1px solid var(--line);border-radius:6px;padding:12px;margin-bottom:10px}
    .ar-cm.staff{border-color:var(--gold);background:#fffaf0}
    .ar-count{font-size:12px;color:var(--ink-soft);margin-left:auto}
    @media (max-width:860px){.ar-form{grid-template-columns:1fr}.ar-g3{grid-template-columns:1fr 1fr}}`;
    document.head.appendChild(st);
  }

  function shell(){
    css();
    $('recipesTab').innerHTML = `<div class="panel"><h3>Cooking Hub</h3>
      <p class="hint">Everything on the public Recipes page lives here: recipes, blog posts and tips, categories, reader comments, reader submissions and photos. Drafts stay hidden until you publish. <span id="arStatus" class="status-line" style="margin-left:8px"></span></p>
      <div class="ar-sub" id="arNav"></div><div id="arBody"></div></div>`;
    $('arNav').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if(!b) return; go(b.dataset.v); });
  }
  function nav(){
    const items = [['library', 'Library'], ['edit', editing ? (editing.id ? 'Edit' : '+ New') : '+ New'], ['cats', 'Categories'], ['comments', 'Comments' + (S.pending.comments ? ` (${S.pending.comments})` : '')], ['subs', 'Reader submissions' + (S.pending.submissions ? ` (${S.pending.submissions})` : '')], ['media', 'Images'], ['tools', 'Settings & backup']];
    $('arNav').innerHTML = items.map(([k, l]) => `<button data-v="${k}" class="${view === k ? 'on' : ''}">${l}</button>`).join('');
    const b = $('tabBtnRecipes'); if(b){ const n = S.pending.comments + S.pending.submissions; b.textContent = 'Recipes' + (n ? ' (' + n + ')' : ''); }
  }
  async function go(v){
    if(view === 'edit' && v !== 'edit' && editing && editing.dirty && !confirm('You have unsaved changes. Leave without saving?')) return;
    view = v; nav();
    try{
      if(v === 'library') renderLibrary();
      else if(v === 'edit') renderEditor();
      else if(v === 'cats') renderCats();
      else if(v === 'comments'){ $('arBody').innerHTML = '<p class="hint">Loading…</p>'; comments = (await call('/api/recipes/admin/comments')).comments || []; renderComments(); }
      else if(v === 'subs'){ $('arBody').innerHTML = '<p class="hint">Loading…</p>'; subs = (await call('/api/recipes/admin/submissions')).submissions || []; renderSubs(); }
      else if(v === 'media'){ $('arBody').innerHTML = '<p class="hint">Loading…</p>'; media = (await call('/api/media')).files || []; renderMedia(); }
      else renderTools();
    }catch(err){ status(err.message, true); }
  }
  async function reload(){ S = await call('/api/recipes/admin/all'); nav(); }

  /* ---------- Library ---------- */
  function filtered(){
    const q = F.q.toLowerCase();
    return S.recipes.filter(r => (!F.kind || r.kind === F.kind) && (!F.cat || r.category === F.cat) && (!F.status || r.status === F.status) && (!q || (r.title + ' ' + r.tags + ' ' + r.category).toLowerCase().includes(q)));
  }
  function renderLibrary(){
    const rows = filtered(); const pub = S.recipes.filter(r => r.status === 'published').length;
    $('arBody').innerHTML = `<div class="toolbar"><button class="excel-btn" id="arNew">+ Add new</button>
      <input class="ar-in" id="arQ" placeholder="Search title, tag, category…" value="${esc(F.q)}" style="min-width:220px">
      <select class="ar-in" id="arK"><option value="">All types</option><option value="recipe"${F.kind === 'recipe' ? ' selected' : ''}>Recipes</option><option value="article"${F.kind === 'article' ? ' selected' : ''}>Blog posts</option></select>
      <select class="ar-in" id="arC"><option value="">All categories</option>${S.categories.map(c => `<option${F.cat === c.name ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <select class="ar-in" id="arS"><option value="">Any status</option><option value="published"${F.status === 'published' ? ' selected' : ''}>Published</option><option value="draft"${F.status === 'draft' ? ' selected' : ''}>Draft</option></select>
      <span class="ar-count">${rows.length} shown · ${S.recipes.length} total · ${pub} published</span></div>
      <div class="ar-bulk" id="arBulk" style="display:${sel.size ? 'flex' : 'none'}"><b>${sel.size} selected</b>
        <button data-b="publish" class="green">Publish</button><button data-b="draft">Make draft</button><button data-b="feature">Feature</button><button data-b="unfeature">Unfeature</button>
        <select class="ar-in" id="arBCat"><option value="">Move to category…</option>${S.categories.map(c => `<option>${esc(c.name)}</option>`).join('')}</select><button data-b="delete" class="red">Delete</button></div>
      <div class="ar-wrap"><table class="ar-t"><thead><tr><th><input type="checkbox" id="arAll"></th><th></th><th>Title</th><th>Category</th><th>Status</th><th>Readers</th><th>Updated</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr><td><input type="checkbox" class="arCk" data-id="${r.id}" ${sel.has(r.id) ? 'checked' : ''}></td>
        <td>${r.image ? `<img class="ar-th" src="${esc(imgSrc(r.image))}" alt="">` : '<div class="ar-ph">' + (r.kind === 'article' ? '📝' : '🍽️') + '</div>'}</td>
        <td><a href="#" data-edit="${r.id}" style="font-weight:700;color:var(--ink);text-decoration:none">${esc(r.title)}</a>${r.featured ? ' <span title="Featured" style="color:var(--gold)">★</span>' : ''}<div style="font-size:11px;color:var(--ink-soft)">/${esc(r.slug)} · <span class="ar-pill ${r.kind === 'article' ? 'ar-art' : ''}">${r.kind === 'article' ? 'Blog' : 'Recipe'}</span></div></td>
        <td>${esc(r.category)}</td><td><span class="ar-pill ${r.status === 'published' ? 'ar-pub' : 'ar-dra'}">${r.status}</span></td>
        <td>${r.ratingCount ? '★ ' + r.ratingAvg + ' (' + r.ratingCount + ') ' : ''}${r.commentCount ? '💬 ' + r.commentCount : ''}${r.pendingComments ? ` <b style="color:#b23a3a">${r.pendingComments} new</b>` : ''}</td>
        <td>${fmtDate(r.updated)}</td>
        <td style="white-space:nowrap"><button class="ar-btn pri" data-edit="${r.id}">Edit</button> <a class="ar-btn gold" style="text-decoration:none;display:inline-block" href="${esc(pubUrl(r.slug))}" target="_blank" rel="noopener">View</a> <button class="ar-btn" data-dup="${r.id}">Copy</button> <button class="ar-btn red" data-del="${r.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--ink-soft);padding:24px">Nothing matches.</td></tr>'}
      </tbody></table></div>`;
    $('arNew').onclick = () => { editing = blank(); go('edit'); };
    const bind = (id, k) => $(id).addEventListener('change', e => { F[k] = e.target.value; renderLibrary(); });
    bind('arK', 'kind'); bind('arC', 'cat'); bind('arS', 'status');
    let tm; $('arQ').addEventListener('input', e => { clearTimeout(tm); tm = setTimeout(() => { F.q = e.target.value; renderLibrary(); const q = $('arQ'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 250); });
    $('arAll').onchange = e => { filtered().forEach(r => e.target.checked ? sel.add(r.id) : sel.delete(r.id)); renderLibrary(); };
    document.querySelectorAll('.arCk').forEach(c => c.onchange = () => { const id = Number(c.dataset.id); c.checked ? sel.add(id) : sel.delete(id); $('arBulk').style.display = sel.size ? 'flex' : 'none'; $('arBulk').firstChild.textContent = sel.size + ' selected'; });
    $('arBulk').addEventListener('click', async e => {
      const b = e.target.closest('button[data-b]'); if(!b) return; const act = b.dataset.b;
      if(act === 'delete' && !confirm(`Delete ${sel.size} item(s) and their comments for good?`)) return;
      try{ await call('/api/recipes/admin/bulk', 'POST', {ids: [...sel], action: act}); sel.clear(); await reload(); renderLibrary(); status('Done'); }catch(err){ status(err.message, true); }
    });
    $('arBCat').onchange = async e => { if(!e.target.value) return; try{ await call('/api/recipes/admin/bulk', 'POST', {ids: [...sel], action: 'category', category: e.target.value}); sel.clear(); await reload(); renderLibrary(); status('Moved'); }catch(err){ status(err.message, true); } };
    $('arBody').querySelector('tbody').addEventListener('click', async e => {
      const t = e.target.closest('[data-edit],[data-del],[data-dup]'); if(!t) return; e.preventDefault();
      if(t.dataset.edit){ const r = S.recipes.find(x => x.id === Number(t.dataset.edit)); editing = Object.assign({}, r); go('edit'); }
      else if(t.dataset.dup){ const r = S.recipes.find(x => x.id === Number(t.dataset.dup)); editing = Object.assign({}, r, {id: 0, slug: '', title: r.title + ' (copy)', status: 'draft', featured: false, dirty: true}); go('edit'); }
      else if(t.dataset.del){ const r = S.recipes.find(x => x.id === Number(t.dataset.del)); if(!confirm(`Delete "${r.title}" and its comments for good?`)) return; try{ await call('/api/recipes/admin/' + r.id, 'DELETE'); await reload(); renderLibrary(); status('Deleted'); }catch(err){ status(err.message, true); } }
    });
  }

  /* ---------- Editor ---------- */
  const blank = () => ({id: 0, kind: 'recipe', title: '', slug: '', category: (S.categories[0] || {}).name || '', style: '', cuisine: '', difficulty: 'Easy', prep: 10, cook: 20, servings: 4, summary: '', ingredients: [], steps: [], tips: '', body: '', tags: '', badge: '', image: '', featured: false, status: 'draft'});
  function renderEditor(){
    if(!editing) editing = blank(); const r = editing, art = r.kind === 'article';
    $('arBody').innerHTML = `<form id="arForm" class="ar-form" autocomplete="off"><div>
      <div class="box"><div class="ar-g2"><div><label>Type</label><select name="kind"><option value="recipe"${!art ? ' selected' : ''}>Recipe</option><option value="article"${art ? ' selected' : ''}>Blog post / tips</option></select></div>
        <div><label>Category</label><select name="category">${S.categories.map(c => `<option${r.category === c.name ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}${S.categories.some(c => c.name === r.category) || !r.category ? '' : `<option selected>${esc(r.category)}</option>`}</select></div></div>
        <label>Title</label><input name="title" maxlength="140" value="${esc(r.title)}" required>
        <label>Web address (slug)</label><input name="slug" maxlength="80" value="${esc(r.slug)}" placeholder="auto from title">
        <label>Short summary <small id="arSumN"></small></label><textarea name="summary" rows="2" maxlength="400">${esc(r.summary)}</textarea></div>
      <div class="box" id="arRecipeBox" style="${art ? 'display:none' : ''}"><div class="ar-g3"><div><label>Prep (min)</label><input name="prep" type="number" min="0" value="${r.prep || 0}"></div><div><label>Cook (min)</label><input name="cook" type="number" min="0" value="${r.cook || 0}"></div><div><label>Serves</label><input name="servings" type="number" min="0" value="${r.servings || 0}"></div></div>
        <div class="ar-g3"><div><label>Difficulty</label><select name="difficulty">${['Easy', 'Medium', 'Hard'].map(d => `<option${r.difficulty === d ? ' selected' : ''}>${d}</option>`).join('')}</select></div>
          <div><label>Cooking style</label><input name="style" list="arStyles" value="${esc(r.style)}"></div><div><label>Cuisine</label><input name="cuisine" list="arCuis" value="${esc(r.cuisine)}"></div></div>
        <datalist id="arStyles">${STYLES.map(x => `<option>${x}</option>`).join('')}</datalist><datalist id="arCuis">${CUISINES.map(x => `<option>${x}</option>`).join('')}</datalist>
        <label>Ingredients <small>(one per line; start a line with ## for a group heading, e.g. ## Marinade)</small></label><textarea name="ingredients" rows="9">${esc((r.ingredients || []).join('\n'))}</textarea>
        <label>Method <small>(one step per line)</small></label><textarea name="steps" rows="9">${esc((r.steps || []).join('\n'))}</textarea>
        <label>Butcher's tip (optional)</label><textarea name="tips" rows="2" maxlength="1000">${esc(r.tips)}</textarea></div>
      <div class="box"><label id="arBodyL">${art ? 'Article text' : 'Extra notes / story (optional)'} <small>(blank line = new paragraph · ## Heading · - bullet · **bold**)</small></label><textarea name="body" rows="${art ? 16 : 5}">${esc(r.body)}</textarea></div></div>
      <div><div class="box"><label style="margin-top:0">Publish</label><select name="status"><option value="published"${r.status === 'published' ? ' selected' : ''}>Published (visible)</option><option value="draft"${r.status !== 'published' ? ' selected' : ''}>Draft (hidden)</option></select>
        <label style="display:flex;gap:8px;align-items:center;font-weight:600"><input type="checkbox" name="featured" style="width:auto"${r.featured ? ' checked' : ''}> Feature on the front of the hub</label>
        <label>Badge label (optional)</label><input name="badge" maxlength="40" value="${esc(r.badge)}" placeholder="e.g. Crowd favourite">
        <label>Tags <small>(comma separated, used by search)</small></label><input name="tags" maxlength="200" value="${esc(r.tags)}">
        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="excel-btn" type="submit">Save</button><button class="excel-btn secondary" type="button" id="arCancel">Close</button>${r.id ? `<a class="excel-btn secondary" style="text-decoration:none" href="${esc(pubUrl(r.slug))}" target="_blank" rel="noopener">View page</a>` : ''}</div></div>
      <div class="box"><label style="margin-top:0">Photo</label><img class="ar-prev" id="arPrev" alt="" src="${esc(imgSrc(r.image))}" style="${r.image ? '' : 'display:none'}">
        <input type="hidden" name="image" value="${esc(r.image)}">
        <div style="display:flex;gap:6px;flex-wrap:wrap"><label class="ar-btn gold" style="margin:0;cursor:pointer">Upload photo<input type="file" id="arFile" accept="image/jpeg,image/png,image/webp" style="display:none"></label><button type="button" class="ar-btn pri" id="arPick">Choose from library</button><button type="button" class="ar-btn red" id="arNoImg">Remove</button></div>
        <p class="hint" style="margin-top:8px">Photos are resized to 1600 px automatically. Without a photo the card shows the category icon.</p><div id="arPicker"></div></div></div></form>`;
    const f = $('arForm'); const sumN = () => $('arSumN').textContent = f.summary.value.length + '/400'; sumN();
    f.addEventListener('input', e => { editing.dirty = true; if(e.target.name === 'summary') sumN(); });
    f.kind.addEventListener('change', () => { const a = f.kind.value === 'article'; $('arRecipeBox').style.display = a ? 'none' : ''; $('arBodyL').firstChild.textContent = a ? 'Article text ' : 'Extra notes / story (optional) '; });
    $('arCancel').onclick = () => go('library');
    $('arNoImg').onclick = () => { f.image.value = ''; $('arPrev').style.display = 'none'; editing.dirty = true; };
    $('arFile').onchange = async e => { const file = e.target.files[0]; if(!file) return; try{ status('Uploading…'); const url = await uploadFile(file); setImage(url); status('Photo added'); }catch(err){ status(err.message, true); } e.target.value = ''; };
    $('arPick').onclick = async () => { try{ media = (await call('/api/media')).files || []; }catch(err){ return status(err.message, true); } $('arPicker').innerHTML = media.length ? `<div class="ar-media" style="margin-top:10px;grid-template-columns:repeat(auto-fill,minmax(90px,1fr))">${media.map(m => `<div class="ar-m"><img data-url="${esc(m.url)}" src="${esc(api(m.url))}" alt=""></div>`).join('')}</div>` : '<p class="hint">No photos yet. Upload one first.</p>'; };
    $('arPicker').addEventListener('click', e => { const i = e.target.closest('img[data-url]'); if(i){ setImage(i.dataset.url); $('arPicker').innerHTML = ''; } });
    f.addEventListener('submit', async e => { e.preventDefault(); await save(); });
  }
  function setImage(url){ const f = $('arForm'); f.image.value = url; const p = $('arPrev'); p.src = imgSrc(url); p.style.display = ''; editing.dirty = true; }
  async function save(){
    const f = $('arForm'); const fd = k => f.elements[k].value;
    const body = { kind: fd('kind'), title: fd('title'), slug: fd('slug') || slugify(fd('title')), category: fd('category'), summary: fd('summary'), status: fd('status'), featured: f.featured.checked, badge: fd('badge'), tags: fd('tags'), image: fd('image'), body: fd('body'),
      prep: fd('prep'), cook: fd('cook'), servings: fd('servings'), difficulty: fd('difficulty'), style: fd('style'), cuisine: fd('cuisine'), ingredients: fd('ingredients'), steps: fd('steps'), tips: fd('tips') };
    if(body.kind === 'article'){ body.ingredients = ''; body.steps = ''; }
    try{
      status('Saving…');
      if(editing.id){ const r = await call('/api/recipes/admin/' + editing.id, 'PUT', body); editing.slug = r.slug; }
      else { const r = await call('/api/recipes/admin', 'POST', body); editing.id = r.id; }
      await reload(); editing = Object.assign({}, S.recipes.find(x => x.id === editing.id)); view = 'edit'; renderEditor(); nav(); status('Saved');
    }catch(err){ status(err.message, true); }
  }
  function resize(file){
    return new Promise((resolve, reject) => {
      const img = new Image(), u = URL.createObjectURL(file);
      img.onload = () => { const m = 1600, s = Math.min(1, m / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); resolve(c.toDataURL('image/jpeg', 0.85)); };
      img.onerror = () => reject(new Error('That file could not be read as an image')); img.src = u;
    });
  }
  async function uploadFile(file){
    if(file.size > 25 * 1024 * 1024) throw new Error('Photo is too big (max 25 MB)');
    const data = await resize(file); const r = await call('/api/media', 'POST', {name: file.name, data}); return r.url;
  }

  /* ---------- Categories ---------- */
  function renderCats(){
    const count = n => S.recipes.filter(r => r.category === n).length;
    $('arBody').innerHTML = `<p class="hint">Categories appear as the filter chips on the public page. Renaming a category updates every recipe in it. A category can only be deleted when it is empty. Order = the number (small first).</p>
      <table class="ar-t"><thead><tr><th>Icon</th><th>Name</th><th>Order</th><th>Items</th><th></th></tr></thead><tbody>
      ${S.categories.map(c => `<tr data-id="${c.id}"><td><input class="ar-in" data-f="icon" value="${esc(c.icon)}" maxlength="4" style="width:56px"></td><td><input class="ar-in" data-f="name" value="${esc(c.name)}" maxlength="60"></td><td><input class="ar-in" data-f="sort" type="number" value="${c.sort}" style="width:70px"></td><td>${count(c.name)}</td><td><button class="ar-btn pri" data-save>Save</button> <button class="ar-btn red" data-del>Delete</button></td></tr>`).join('')}
      <tr><td><input class="ar-in" id="arNcI" placeholder="🍖" maxlength="4" style="width:56px"></td><td><input class="ar-in" id="arNcN" placeholder="New category name" maxlength="60"></td><td></td><td></td><td><button class="ar-btn green" id="arNcAdd">Add category</button></td></tr></tbody></table>`;
    $('arNcAdd').onclick = async () => { try{ await call('/api/recipes/admin/categories', 'POST', {name: $('arNcN').value, icon: $('arNcI').value}); await reload(); renderCats(); status('Category added'); }catch(err){ status(err.message, true); } };
    $('arBody').querySelector('tbody').addEventListener('click', async e => {
      const tr = e.target.closest('tr[data-id]'); if(!tr) return; const id = tr.dataset.id; const g = k => tr.querySelector(`[data-f=${k}]`).value;
      try{
        if(e.target.hasAttribute('data-save')){ await call('/api/recipes/admin/categories/' + id, 'PATCH', {name: g('name'), icon: g('icon'), sort: g('sort')}); await reload(); renderCats(); status('Saved'); }
        if(e.target.hasAttribute('data-del')){ if(!confirm('Delete this category?')) return; await call('/api/recipes/admin/categories/' + id, 'DELETE'); await reload(); renderCats(); status('Deleted'); }
      }catch(err){ status(err.message, true); }
    });
  }

  /* ---------- Comments ---------- */
  function renderComments(){
    const rows = comments.filter(c => cmFilter === 'all' || c.status === cmFilter);
    $('arBody').innerHTML = `<div class="toolbar">${[['pending', 'Pending'], ['approved', 'Approved'], ['hidden', 'Hidden'], ['all', 'All']].map(([k, l]) => `<button class="excel-btn ${k === cmFilter ? '' : 'secondary'}" data-f="${k}">${l}</button>`).join('')}
      ${cmFilter === 'pending' && rows.length ? '<button class="excel-btn" id="arApproveAll" style="background:#2e7d46;color:#fff">Approve all shown</button>' : ''}<span class="ar-count">${rows.length} shown</span></div>
      <div id="arCmList">${rows.map(c => `<div class="ar-cm ${c.staff ? 'staff' : ''}"><div><b>${esc(c.name)}</b>${c.staff ? ' <span class="ar-pill ar-art">Azizo team</span>' : ''} ${c.rating ? `<span style="color:#c89b3c">${'★'.repeat(c.rating)}</span>` : ''} <small style="color:var(--ink-soft)">on <a href="${esc(pubUrl(S.recipes.find(r => r.id === c.recipeId) ? S.recipes.find(r => r.id === c.recipeId).slug : ''))}" target="_blank" rel="noopener">${esc(c.recipeTitle)}</a> · ${esc(fmtDate(c.date))}${c.parentId ? ' · reply' : ''} · <b>${c.status}</b></small></div>
        <p style="margin:6px 0">${esc(c.comment)}</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${c.status !== 'approved' ? `<button class="ar-btn green" data-a="approved" data-id="${c.id}">Approve</button>` : ''}${c.status !== 'hidden' ? `<button class="ar-btn" data-a="hidden" data-id="${c.id}">Hide</button>` : ''}<button class="ar-btn red" data-a="delete" data-id="${c.id}">Delete</button>
          ${c.staff ? '' : `<input class="ar-in" id="arRp${c.id}" placeholder="Reply as Azizo…" style="flex:1;min-width:180px"><button class="ar-btn pri" data-a="reply" data-id="${c.id}">Reply</button>`}</div></div>`).join('') || '<p class="hint">Nothing here.</p>'}</div>`;
    $('arBody').querySelector('.toolbar').addEventListener('click', async e => {
      const b = e.target.closest('button'); if(!b) return;
      if(b.dataset.f){ cmFilter = b.dataset.f; renderComments(); }
      if(b.id === 'arApproveAll'){ try{ await call('/api/recipes/admin/comments/bulk', 'POST', {ids: rows.map(c => c.id), action: 'approved'}); await after(); }catch(err){ status(err.message, true); } }
    });
    $('arCmList').addEventListener('click', async e => {
      const b = e.target.closest('button[data-a]'); if(!b) return; const id = b.dataset.id, a = b.dataset.a;
      try{
        if(a === 'delete'){ if(!confirm('Delete this comment (and its replies)?')) return; await call('/api/recipes/admin/comments/' + id, 'DELETE'); }
        else if(a === 'reply'){ const t = $('arRp' + id).value.trim(); if(!t) return; await call('/api/recipes/admin/comments/' + id + '/reply', 'POST', {comment: t}); }
        else await call('/api/recipes/admin/comments/' + id, 'PATCH', {status: a});
        await after();
      }catch(err){ status(err.message, true); }
    });
    async function after(){ comments = (await call('/api/recipes/admin/comments')).comments || []; await reload(); renderComments(); }
  }

  /* ---------- Reader submissions ---------- */
  function renderSubs(){
    const label = {recipe: 'Recipe', question: 'Question', feedback: 'Feedback'};
    $('arBody').innerHTML = subs.map(s => { const ph = /^[+\d\s-]{9,}$/.test(s.contact || '') ? String(s.contact).replace(/\D/g, '') : '';
      return `<div class="ar-cm" style="${s.status === 'new' ? 'border-left:4px solid var(--accent)' : ''}"><div><b>${esc(s.name)}</b> <span class="ar-pill ar-art">${label[s.kind] || s.kind}</span> <small style="color:var(--ink-soft)">${esc(fmtDate(s.created_at))} · ${esc(s.contact || 'no contact given')} · <b>${s.status}</b></small></div>
      ${s.title ? `<div style="font-weight:700;margin-top:4px">${esc(s.title)}</div>` : ''}<p style="white-space:pre-wrap;margin:6px 0">${esc(s.message)}</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${s.kind === 'recipe' ? `<button class="ar-btn gold" data-a="convert" data-id="${s.id}">Create draft from this</button>` : ''}${s.status === 'new' ? `<button class="ar-btn" data-a="read" data-id="${s.id}">Mark read</button>` : ''}
        ${ph ? `<a class="ar-btn green" style="text-decoration:none" target="_blank" rel="noopener" href="https://wa.me/${ph.replace(/^0/, '254')}">Reply on WhatsApp</a>` : ''}${/@/.test(s.contact || '') ? `<a class="ar-btn pri" style="text-decoration:none" href="mailto:${esc(s.contact)}">Reply by email</a>` : ''}<button class="ar-btn red" data-a="delete" data-id="${s.id}">Delete</button></div></div>`; }).join('') || '<p class="hint">No submissions yet. They arrive from the form at the bottom of the public Recipes page.</p>';
    $('arBody').onclick = async e => {
      const b = e.target.closest('button[data-a]'); if(!b) return; const id = Number(b.dataset.id), s = subs.find(x => x.id === id);
      try{
        if(b.dataset.a === 'convert'){ await call('/api/recipes/admin/submissions/' + id, 'PATCH', {status: 'converted'}); editing = Object.assign(blank(), {title: s.title || ('Recipe from ' + s.name), summary: 'Shared by ' + s.name + '.', body: s.message, dirty: true}); await reload(); return go('edit'); }
        if(b.dataset.a === 'read') await call('/api/recipes/admin/submissions/' + id, 'PATCH', {status: 'read'});
        if(b.dataset.a === 'delete'){ if(!confirm('Delete this submission?')) return; await call('/api/recipes/admin/submissions/' + id, 'DELETE'); }
        subs = (await call('/api/recipes/admin/submissions')).submissions || []; await reload(); renderSubs();
      }catch(err){ status(err.message, true); }
    };
  }

  /* ---------- Images ---------- */
  function renderMedia(){
    const sz = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
    $('arBody').innerHTML = `<div class="toolbar"><label class="excel-btn" style="cursor:pointer">Upload photos<input type="file" id="arMF" accept="image/jpeg,image/png,image/webp" multiple style="display:none"></label><span class="ar-count">${media.length} photo(s)</span></div>
      <p class="hint">Upload photos here once, then pick them in any recipe (Edit, Photo, Choose from library). Photos are resized to 1600 px and compressed automatically. Click a photo to copy its address.</p>
      <div class="ar-media">${media.map(m => `<div class="ar-m"><img src="${esc(api(m.url))}" data-url="${esc(m.url)}" alt="" title="Click to copy address"><div><span>${sz(m.size)}</span><button class="ar-btn red" data-f="${esc(m.file)}">Delete</button></div></div>`).join('') || '<p class="hint">No photos yet.</p>'}</div>`;
    $('arMF').onchange = async e => { for(const f of e.target.files){ try{ status('Uploading ' + f.name + '…'); await uploadFile(f); }catch(err){ status(err.message, true); } } media = (await call('/api/media')).files || []; renderMedia(); status('Uploaded'); };
    $('arBody').onclick = async e => {
      const d = e.target.closest('button[data-f]'); const i = e.target.closest('img[data-url]');
      if(d){ const used = S.recipes.filter(r => r.image === '/uploads/media/' + d.dataset.f).length; if(!confirm(used ? `This photo is used by ${used} item(s). Delete anyway?` : 'Delete this photo?')) return; try{ await call('/api/media/' + d.dataset.f, 'DELETE'); media = (await call('/api/media')).files || []; renderMedia(); }catch(err){ status(err.message, true); } }
      else if(i){ const u = api(i.dataset.url); (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(() => status('Address copied'), () => prompt('Photo address', u)); }
    };
  }

  /* ---------- Settings & backup ---------- */
  function download(name, text, type){ const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type})); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  function renderTools(){
    $('arBody').innerHTML = `<div class="box" style="background:#fff;border:1px solid var(--line);border-radius:6px;padding:14px;margin-bottom:14px"><h3 style="margin-top:0">Comments</h3>
        <label style="display:flex;gap:8px;align-items:center;font-weight:600"><input type="checkbox" id="arAuto" ${S.settings.autoApprove ? 'checked' : ''}> Publish new comments immediately (no approval)</label>
        <p class="hint">Off (recommended): every comment waits in Comments until you approve it. On: comments appear at once and you can still hide or delete them afterwards.</p></div>
      <div class="box" style="background:#fff;border:1px solid var(--line);border-radius:6px;padding:14px;margin-bottom:14px"><h3 style="margin-top:0">Backup and restore</h3>
        <p class="hint">Download all recipes and blog posts as one file. Restore it (or move content between sites) with the upload box. Matching web addresses are updated, new ones are added, nothing is deleted. Comments and photos are not part of this file.</p>
        <button class="excel-btn" id="arExp">Download backup (recipes.json)</button>
        <label class="excel-btn secondary" style="cursor:pointer;margin-left:8px">Restore from file<input type="file" id="arImp" accept="application/json,.json" style="display:none"></label>
        <p class="hint" style="margin-top:10px">Hosting the site on GitHub Pages without the backend? Put the downloaded file in the site folder as <code>recipes.json</code> and the public pages will read recipes from it (comments will be off).</p></div>
      <div class="box" style="background:#fff;border:1px solid var(--line);border-radius:6px;padding:14px"><h3 style="margin-top:0">Search engines (sitemap)</h3>
        <p class="hint">New recipes are found by Google faster when they are in <code>sitemap.xml</code>. Enter your website address, download the lines, and paste them before the closing <code>&lt;/urlset&gt;</code> in your sitemap.xml file.</p>
        <input class="ar-in" id="arSite" value="https://www.azizobutchery.co.ke" style="min-width:280px"> <button class="excel-btn" id="arMap">Download sitemap lines</button></div>`;
    $('arAuto').onchange = async e => { try{ await call('/api/recipes/admin/settings', 'POST', {autoApprove: e.target.checked}); S.settings.autoApprove = e.target.checked; status('Saved'); }catch(err){ status(err.message, true); } };
    $('arExp').onclick = async () => { try{ download('recipes.json', JSON.stringify(await call('/api/recipes/admin/export'), null, 1), 'application/json'); }catch(err){ status(err.message, true); } };
    $('arImp').onchange = async e => { const f = e.target.files[0]; if(!f) return; try{ const d = JSON.parse(await f.text()); if(!confirm(`Restore ${(d.recipes || []).length} item(s) from this file?`)) return; const r = await call('/api/recipes/admin/import', 'POST', d); await reload(); status(`Restored: ${r.added} added, ${r.updated} updated`); }catch(err){ status(err.message || 'That file could not be read', true); } e.target.value = ''; };
    $('arMap').onclick = () => { const site = $('arSite').value.replace(/\/+$/, ''); download('sitemap-recipes.xml', S.recipes.filter(r => r.status === 'published').map(r => `  <url><loc>${site}/recipe.html?r=${r.slug}</loc><lastmod>${fmtDate(r.updated)}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>`).join('\n') + '\n', 'application/xml'); };
  }

  window.AzizoRecipes = {
    async open(){ if(!loaded){ loaded = true; shell(); } try{ status('Loading…'); await reload(); if(view === 'library') renderLibrary(); else await go(view); status(''); }catch(e){ status("Couldn't load: " + e.message, true); } },
    async badge(){ try{ S = await call('/api/recipes/admin/all'); const b = $('tabBtnRecipes'); const n = S.pending.comments + S.pending.submissions; if(b) b.textContent = 'Recipes' + (n ? ' (' + n + ')' : ''); }catch(e){} }
  };
})();
window.addEventListener('load', () => setTimeout(() => { try{ if(typeof getAdminToken === 'function' && getAdminToken() && window.AzizoRecipes) window.AzizoRecipes.badge(); }catch(e){} }, 900));
