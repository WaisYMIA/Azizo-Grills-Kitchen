/* Azizo site-wide translation (English <-> Kiswahili) using Google's free Website Translator.
   Translates every piece of text on the page, including content loaded later (products, dishes, prices labels).
   Loaded on public pages only; staff, rider, admin and cook portals are left in English. */
(function(){
  'use strict';
  var KEY = 'azizoLang', GT = 'https://translate.google.com/translate_a/element.js?cb=azizoGTInit';
  function get(){ try{ return localStorage.getItem(KEY); }catch(e){ return null; } }
  function put(v){ try{ localStorage.setItem(KEY, v); localStorage.setItem('kkLang', v); }catch(e){} }
  function cookie(on){
    var host = location.hostname, exp = on ? '' : '; expires=Thu, 01 Jan 1970 00:00:00 GMT', val = on ? '/en/sw' : '';
    document.cookie = 'googtrans=' + val + '; path=/' + exp;
    if(host.indexOf('.') > -1){ document.cookie = 'googtrans=' + val + '; path=/; domain=' + host + exp; document.cookie = 'googtrans=' + val + '; path=/; domain=.' + host + exp; }
  }
  // lang can come from a shared link (?lang=sw)
  var q = /[?&]lang=(sw|en)/.exec(location.search); if(q) put(q[1]);
  var lang = get() === 'sw' ? 'sw' : 'en', loaded = false, failTimer = null;

  var css = document.createElement('style');
  css.textContent = '.goog-te-banner-frame,.goog-te-balloon-frame,#goog-gt-tt,.goog-tooltip,.VIpgJd-ZVi9od-ORHb-OEVmcd,.VIpgJd-ZVi9od-aZ2wEe-wOHMyf{display:none!important}'
    + 'body{top:0!important;position:static!important}.goog-text-highlight{background:none!important;box-shadow:none!important}'
    + '#azizoGT{position:absolute;left:-9999px;top:0;height:0;overflow:hidden}'
    + '#azLangPill{position:fixed;left:12px;bottom:12px;z-index:40;display:flex;gap:0;border-radius:999px;overflow:hidden;box-shadow:0 4px 14px rgba(0,0,0,.28);font:700 13px/1 system-ui,sans-serif;background:#fff;border:1px solid rgba(0,0,0,.18)}'
    + '#azLangPill button{border:0;background:transparent;padding:10px 13px;min-height:40px;cursor:pointer;color:#333;font:inherit}'
    + '#azLangPill button[aria-pressed=true]{background:#b3131b;color:#fff}'
    + '#azLangMsg{position:fixed;left:12px;bottom:62px;z-index:9991;background:#222;color:#fff;border-radius:10px;padding:9px 12px;font:13px/1.35 system-ui,sans-serif;max-width:260px;box-shadow:0 4px 14px rgba(0,0,0,.3)}'
    + 'body:has(.modal.show) #azLangPill,body:has(.eb-modal:not([hidden])) #azLangPill{display:none}@media print{#azLangPill,#azLangMsg{display:none}}';
  document.head.appendChild(css);

  function msg(t){
    var m = document.getElementById('azLangMsg'); if(!m){ m = document.createElement('div'); m.id = 'azLangMsg'; m.setAttribute('role', 'status'); document.body.appendChild(m); }
    m.textContent = t; clearTimeout(m._t); m._t = setTimeout(function(){ if(m.parentNode) m.parentNode.removeChild(m); }, 5000);
  }
  function setUi(){
    document.documentElement.setAttribute('data-site-lang', lang);
    var p = document.getElementById('azLangPill');
    if(p){ var b = p.querySelectorAll('button'); b[0].setAttribute('aria-pressed', lang === 'en'); b[1].setAttribute('aria-pressed', lang === 'sw'); }
    var k = document.getElementById('kkLang'); if(k){ k.classList.add('notranslate'); k.setAttribute('translate', 'no'); }
  }
  function combo(){ return document.querySelector('#azizoGT select.goog-te-combo'); }
  function pick(){
    var c = combo(); if(!c) return false;
    c.value = 'sw'; c.dispatchEvent(new Event('change')); return true;
  }
  function load(){
    if(loaded) return; loaded = true;
    var d = document.createElement('div'); d.id = 'azizoGT'; d.className = 'notranslate'; d.setAttribute('aria-hidden', 'true'); document.body.appendChild(d);
    window.azizoGTInit = function(){
      try{ new google.translate.TranslateElement({ pageLanguage: 'en', includedLanguages: 'sw,en', autoDisplay: false }, 'azizoGT'); }catch(e){}
      clearTimeout(failTimer);
      var n = 0, iv = setInterval(function(){ n++; if(combo() || n > 40){ clearInterval(iv); if(lang === 'sw') pick(); } }, 150);
    };
    var s = document.createElement('script'); s.src = GT; s.async = true;
    s.onerror = function(){ fail(); };
    document.head.appendChild(s);
    failTimer = setTimeout(fail, 10000);
  }
  function fail(){ if(lang === 'sw' && !document.querySelector('html.translated-ltr')) msg('Translation needs an internet connection. / Tafsiri inahitaji mtandao.'); }

  function set(l){
    l = l === 'sw' ? 'sw' : 'en'; if(l === lang && document.getElementById('azLangPill')) { setUi(); return; }
    var was = lang; lang = l; put(l); setUi();
    if(l === 'sw'){ cookie(true); if(!pick()) load(); else if(was === 'sw'){} }
    else { cookie(false); if(was === 'sw'){ var u = location.href.replace(/([?&])lang=(sw|en)&?/, '$1').replace(/[?&]$/, ''); if(u === location.href) location.reload(); else location.replace(u); } }
  }
  window.azizoTranslate = set;

  function pill(){
    if(document.getElementById('azLangPill')) return;
    var p = document.createElement('div'); p.id = 'azLangPill'; p.className = 'notranslate'; p.setAttribute('translate', 'no'); p.setAttribute('role', 'group'); p.setAttribute('aria-label', 'Language / Lugha');
    p.innerHTML = '<button type="button" aria-label="English">EN</button><button type="button" aria-label="Kiswahili">SW</button>';
    var b = p.querySelectorAll('button'); b[0].onclick = function(){ set('en'); }; b[1].onclick = function(){ set('sw'); };
    document.body.appendChild(p);
  }
  function start(){ pill(); setUi(); if(lang === 'sw'){ cookie(true); load(); } else { cookie(false); } }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
