// v5.5 anonymous visit counter. Sends the page path, the referring site and screen width only; the server keeps a daily-changing
// anonymous code (no IP address, no cookie). Does nothing on staff pages, when the browser says Do Not Track, or when the API is not reachable.
(function(){
  'use strict';
  try{
    if(navigator.doNotTrack === '1' || window.doNotTrack === '1') return;
    var p = location.pathname || '/'; if(/(admin|staff|operations|marketplace-admin|security-center|inspector|partner-portal|kitchens-admin)/i.test(p)) return;
    var ok = typeof apiAvailable === 'function' ? apiAvailable() : true; if(!ok) return;
    var base = typeof apiBase === 'function' ? apiBase() : '', utm = (/[?&]utm_source=([^&]+)/.exec(location.search) || [])[1] || '';
    fetch(base + '/api/insight/hit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true, body: JSON.stringify({ p: p, r: document.referrer || '', u: decodeURIComponent(utm), w: window.innerWidth || 0 }) }).catch(function(){});
  }catch(e){}
})();
