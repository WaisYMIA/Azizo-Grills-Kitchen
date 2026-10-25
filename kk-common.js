// Azizo Kitchens shared helpers (plain global script)
(function(){
  'use strict';
  var K = window.KK = window.KK || {};
  K.esc = function(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
  K.money = function(n){ return 'KSh ' + Number(n || 0).toLocaleString('en-KE'); };
  K.$ = function(id){ return document.getElementById(id); };
  // Explicit address: kk-config.js, or one typed on an admin/portal sign-in screen. May be empty (same address as this page).
  K.explicitBase = function(){ var b = ''; try{ b = (window.KK_CONFIG && window.KK_CONFIG.API_BASE_URL) || localStorage.getItem('azizoAdminBackendUrl') || ''; }catch(e){} return String(b).replace(/\/+$/, ''); };
  // Fallback: the backend address the main shop already uses (app.js), remembered after the first successful discovery.
  K.base = function(){ var b = K.explicitBase(); if(!b){ try{ b = localStorage.getItem('kkBaseGuess') || ''; }catch(e){} } return String(b).replace(/\/+$/, ''); };
  K.discover = async function(){
    try{ var r = await fetch('app.js', { cache: 'no-store' }); if(!r.ok) return ''; var m = (await r.text()).match(/API_BASE_URL:\s*"([^"]*)"/), v = m ? m[1].replace(/\/+$/, '') : '';
      if(v){ try{ localStorage.setItem('kkBaseGuess', v); }catch(e){} } return v; }catch(e){ return ''; }
  };
  K.get = function(k){ try{ return localStorage.getItem(k) || ''; }catch(e){ return ''; } };
  K.set = function(k, v){ try{ localStorage.setItem(k, v); }catch(e){} };
  K.tokenKey = null;
  K.api = async function(path, opts, token){
    opts = opts || {};
    var h = Object.assign({}, opts.body ? {'Content-Type':'application/json'} : {}, token ? {'Authorization':'Bearer ' + token} : {});
    var once = async function(base){
      var res; try{ res = await fetch(base + '/api/kitchens' + path, Object.assign({}, opts, {headers:h, cache:'no-store'})); }catch(e){ return { net: true }; }
      var data = {}; try{ data = await res.json(); }catch(e){} return { res: res, data: data };
    };
    var base = K.base(), r = await once(base);
    // Wrong address (page host has no backend, or the shop uses a separate backend address): try the one the shop uses.
    if(!K.explicitBase() && (r.net || (r.res && (r.res.status === 404 || r.res.status === 405) && !r.data.error))){
      var g = await K.discover(); if(g && g !== base){ var r2 = await once(g); if(!r2.net && r2.res && (r2.res.ok || r2.data.error)){ r = r2; base = g; } }
    }
    if(r.net) throw new Error('Cannot reach the server. Check your internet connection and try again.');
    if(!r.res.ok){
      var msg = r.data.error;
      if(!msg && (r.res.status === 404 || r.res.status === 405)){ msg = 'The ordering service could not be found.'; try{ console.error('Azizo Kitchens: ' + base + '/api/kitchens' + path + ' returned ' + r.res.status + '. Set API_BASE_URL in kk-config.js to your backend address, and make sure the backend is updated to the latest version.'); }catch(e){} }
      var er = new Error(msg || ('Something went wrong (' + r.res.status + ')')); er.status = r.res.status; throw er;
    }
    return r.data;
  };
  K.toast = function(msg){ var t = K.$('kkToast'); if(!t){ t = document.createElement('div'); t.id = 'kkToast'; t.className = 'toast'; document.body.appendChild(t); } t.textContent = msg; t.classList.add('show'); clearTimeout(K._t); K._t = setTimeout(function(){ t.classList.remove('show'); }, 2800); };
  K.today = function(){ var d = new Date(Date.now() + 3 * 3600000); return d.toISOString().slice(0, 10); };
  // shrink a chosen photo to a JPEG data URL under maxKB
  K.readImage = function(file, maxEdge, maxKB){
    return new Promise(function(resolve, reject){
      if(!file) return resolve('');
      if(!/^image\//.test(file.type)) return reject(new Error('Please choose a photo (JPG or PNG)'));
      var fr = new FileReader();
      fr.onerror = function(){ reject(new Error('Could not read that file')); };
      fr.onload = function(){
        var img = new Image();
        img.onerror = function(){ reject(new Error('That file is not a usable image')); };
        img.onload = function(){
          var edge = maxEdge || 1400, q = 0.85, s = Math.min(1, edge / Math.max(img.width, img.height)), c = document.createElement('canvas');
          c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          var out = c.toDataURL('image/jpeg', q);
          while(out.length * 0.75 > (maxKB || 1200) * 1024 && q > 0.3){ q -= 0.1; out = c.toDataURL('image/jpeg', q); }
          resolve(out);
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  };
  K.areaOptions = function(areas, selected){
    var g = {}; areas.forEach(function(a){ (g[a.region] = g[a.region] || []).push(a); });
    return '<option value="">Choose your area…</option>' + Object.keys(g).sort().map(function(r){
      return '<optgroup label="' + K.esc(r) + '">' + g[r].map(function(a){ return '<option value="' + K.esc(a.id) + '"' + (a.id === selected ? ' selected' : '') + '>' + K.esc(a.name) + '</option>'; }).join('') + '</optgroup>';
    }).join('');
  };
  K.gps = function(){ return new Promise(function(res, rej){ if(!navigator.geolocation) return rej(new Error('Location is not available on this device')); navigator.geolocation.getCurrentPosition(function(p){ res({lat:p.coords.latitude, lng:p.coords.longitude}); }, function(){ rej(new Error(window.isSecureContext === false ? 'Location only works on a secure (https) page. Please choose your area instead.' : 'We could not get your location. Please allow location access, or choose your area instead.')); }, {enableHighAccuracy:true, timeout:12000}); }); };
  K.header = function(active){
    var L = [['kitchens.html','Order food','order'],['kitchen-partners.html','Cook with Azizo','partners'],['kitchen-portal.html','Kitchen login','portal'],['index.html','Azizo Butchery','shop']];
    var el = K.$('kkHeader'); if(!el) return;
    el.innerHTML = '<a class="skip" href="#main">' + K.t('Skip to content') + '</a><header class="kk-nav"><div class="kk-nav-in"><a class="kk-brand" href="kitchens.html"><img src="logo.png" alt="Azizo logo"><b>Azizo <span>Kitchens</span></b></a>' +
      '<button class="kk-menu" aria-label="Menu" onclick="document.getElementById(\'kkLinks\').classList.toggle(\'open\')">&#9776;</button><nav class="kk-links" id="kkLinks">' +
      L.map(function(l){ return '<a href="' + l[0] + '" class="' + (l[2] === active ? 'on' : '') + (l[2] === 'partners' ? ' cta' : '') + '" data-t>' + l[1] + '</a>'; }).join('') + '<button class="kk-lang" id="kkLang" type="button"></button></nav></div></header>';
    var lb = K.$('kkLang'); if(lb) lb.onclick = function(){ K.setLang(K.lang === 'sw' ? 'en' : 'sw'); }; if(K.applyLang) K.applyLang();
  };
  K.footer = function(){
    var el = K.$('kkFooter'); if(!el) return;
    el.innerHTML = '<footer class="kk-foot"><div class="wrap"><b style="color:var(--gold2);font-family:Oswald;letter-spacing:.06em">AZIZO KITCHENS</b><p>Homemade Kenyan lunch and dinner from trusted home kitchens near you, marketed and quality-checked by Azizo Butchery &amp; Grill. Each kitchen is an independent partner business.</p>' +
      '<p class="kmeta">Delivering in: <a href="kitchens-syokimau.html">Syokimau</a> · <a href="kitchens-umoja.html">Umoja</a> · <a href="kitchens-buruburu.html">Buruburu</a> · <a href="kitchens-utawala.html">Utawala</a></p><p><a href="kitchens.html">Order</a> · <a href="kitchen-partners.html">Cook with us</a> · <a href="kitchen-portal.html">Kitchen login</a> · <a href="index.html">Azizo Butchery &amp; Grill</a> · <a href="https://wa.me/254724888057" target="_blank" rel="noopener">WhatsApp 0724 888 057</a></p></div></footer>';
  };

  // ---- v3.1: language (English / Kiswahili), accessible dialogs ----
  var SW = { 'Order food':'Agiza chakula','Cook with Azizo':'Pika na Azizo','Kitchen login':'Ingia jikoni','Azizo Butchery':'Azizo Butchery',
    'Real Kenyan food, ':'Chakula halisi cha Kenya, ','cooked near you':'kilichopikwa karibu nawe','Your area':'Eneo lako','Use my location':'Tumia eneo langu','Search a dish':'Tafuta chakula',
    'Today':'Leo','Tomorrow':'Kesho','Lunch':'Chakula cha mchana','Dinner':'Chakula cha jioni','Add':'Ongeza','View basket':'Angalia kikapu','Your basket':'Kikapu chako','Food':'Chakula','Delivery':'Usafiri','Total':'Jumla',
    'Your name':'Jina lako','Phone':'Simu','Delivery address (building, house, landmark)':'Anwani ya kupeleka (jengo, nyumba, alama)','Notes for the kitchen (optional)':'Maelezo kwa jiko (si lazima)',
    'Place order':'Weka oda','Track my order':'Fuatilia oda yangu','Track order':'Fuatilia oda','Order number':'Namba ya oda','Check':'Angalia','Cash':'Pesa taslimu','Pay on delivery':'Lipa unapopokea',
    'Order received':'Oda imepokelewa','All cuisines':'Vyakula vyote','Promo code':'Msimbo wa punguzo','Apply':'Tumia','Company code':'Msimbo wa kampuni','Order again':'Agiza tena','Add a side?':'Ongeza kando?',
    'Waiting for the kitchen to confirm':'Tunasubiri jiko lithibitishe','Confirmed. The cook has your order':'Imethibitishwa. Mpishi ana oda yako','Being cooked':'Inapikwa','Ready. Waiting for the rider':'Tayari. Inasubiri msafirishaji','On its way to you':'Inakuja kwako','Delivered. Enjoy!':'Imefika. Karibu mlo!',
    'Cancelled':'Imefutwa','Your delivery code':'Msimbo wako wa kupokea','Give this code to the rider when your food arrives.':'Mpe msafirishaji msimbo huu chakula chako kikifika.','Already ordered? Check your order or leave a rating.':'Umeagiza tayari? Angalia oda yako au toa maoni.',
    'Skip to content':'Ruka hadi maudhui','Vegetarian':'Mboga','Spicy':'Kali','Fish':'Samaki' };
  K.lang = K.get('kkLang') === 'sw' ? 'sw' : 'en';
  K.t = function(en){ return K.lang === 'sw' && SW[en] ? SW[en] : en; };
  K.applyLang = function(){
    document.documentElement.lang = K.lang === 'sw' ? 'sw' : 'en';
    Array.prototype.forEach.call(document.querySelectorAll('[data-t]'), function(e){ if(!e.dataset.en) e.dataset.en = e.textContent; e.textContent = K.t(e.dataset.en); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-tp]'), function(e){ if(!e.dataset.en) e.dataset.en = e.getAttribute('placeholder') || ''; e.setAttribute('placeholder', K.t(e.dataset.en)); });
    var b = K.$('kkLang'); if(b){ b.textContent = K.lang === 'sw' ? 'SW | en' : 'EN | sw'; b.setAttribute('aria-label', K.lang === 'sw' ? 'Switch to English' : 'Badilisha kuwa Kiswahili'); }
  };
  K.setLang = function(l){ K.lang = l === 'sw' ? 'sw' : 'en'; K.set('kkLang', K.lang); K.applyLang(); if(window.azizoTranslate) window.azizoTranslate(K.lang); if(typeof K.onLang === 'function') K.onLang(); };
  var opener = null;
  K.openModal = function(id){
    var m = K.$(id); if(!m) return; opener = document.activeElement; m.classList.add('show'); var sh = m.querySelector('.sheet');
    m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); if(sh){ sh.setAttribute('tabindex', '-1'); var f = sh.querySelector('input:not([type=hidden]):not(.hp),select,textarea,button:not(.x)') || sh; setTimeout(function(){ try{ f.focus({preventScroll:true}); }catch(e){} }, 30); }
  };
  K.closeModal = function(id){ var m = K.$(id); if(!m) return; m.classList.remove('show'); if(opener && document.body.contains(opener)){ try{ opener.focus(); }catch(e){} } };
  document.addEventListener('keydown', function(e){
    var open = document.querySelector('.modal.show'); if(!open) return;
    if(e.key === 'Escape'){ open.classList.remove('show'); if(opener){ try{ opener.focus(); }catch(x){} } return; }
    if(e.key === 'Tab'){ var f = open.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not(.hp),select,textarea,[tabindex="0"]'); if(!f.length) return; var a = f[0], z = f[f.length - 1];
      if(!open.contains(document.activeElement)){ a.focus(); e.preventDefault(); } else if(e.shiftKey && document.activeElement === a){ z.focus(); e.preventDefault(); } else if(!e.shiftKey && document.activeElement === z){ a.focus(); e.preventDefault(); } }
  });
  K.lazyImg = function(src, alt){ return '<img src="' + K.esc(src) + '" alt="' + K.esc(alt || '') + '" loading="lazy" decoding="async">'; };
})();
