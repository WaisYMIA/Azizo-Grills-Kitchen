/* Event Budget Planner on/off switch. Loaded in <head> on every public page.
   1) Instantly applies the last known state (so a disabled planner never flashes its links).
   2) After the page loads, asks the backend for the real state (admin controls it) and updates every [data-eb-link].
   3) Exposes window.AzizoSite.ready (Promise -> settings) for event-budget.js. Static hosting falls back to site-settings.json. */
(function(){
  'use strict';
  var KEY = 'azizoEventBudget', root = document.documentElement, DEFAULT = { enabled:true, note:'', contingencyPct:10 };
  function apply(s){ root.classList.toggle('eb-off', !s.enabled); }
  try{ var c = JSON.parse(localStorage.getItem(KEY) || 'null'); if(c && c.enabled === false) apply(c); }catch(e){}
  var settle; var ready = new Promise(function(r){ settle = r; });
  window.AzizoSite = { ready: ready, eventBudget: DEFAULT, refresh: load };
  function base(){ try{ return (CONFIG.API_BASE_URL || '').replace(/\/+$/, ''); }catch(e){ return ''; } }
  function norm(x){ x = x || {}; return { enabled: x.enabled !== false && x.enabled !== 0 && x.enabled !== '0', note: String(x.note || ''), contingencyPct: Math.min(50, Math.max(0, Number(x.contingencyPct) || 0)) }; }
  async function get(){
    var b = base();
    if(b){ try{ var r = await fetch(b + '/api/site/settings', { cache:'no-store' }); if(r.ok){ var j = await r.json(); return norm(j.eventBudget); } }catch(e){} }
    try{ var r2 = await fetch('./site-settings.json', { cache:'no-store' }); if(r2.ok){ var j2 = await r2.json(); return norm(j2.eventBudget); } }catch(e){}
    return null;
  }
  async function load(){
    var s = await get();
    if(s){ window.AzizoSite.eventBudget = s; apply(s); try{ localStorage.setItem(KEY, JSON.stringify(s)); }catch(e){} }
    settle(window.AzizoSite.eventBudget); return window.AzizoSite.eventBudget;
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load); else load();
})();
