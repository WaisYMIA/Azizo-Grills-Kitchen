// Azizo Marketplace shared helpers (partner butcheries). Needs kk-config.js and kk-common.js first.
(function(){
  'use strict';
  var K = window.KK, M = window.MK = {};
  M.api = function(path, opts, token){ return K.apiAt('/api/market', path, opts, token); };
  M.root = function(path, opts, token){ return K.apiAt('', path, opts, token); };   // /api/orders, /api/auth/...
  M.json = function(o){ return JSON.stringify(o); };
  M.TIER = { associate: 'Associate', partner: 'Partner', premium: 'Premium partner' };
  M.score = function(p){ return p.hygieneScore == null ? '<span class="kbadge warn">Hygiene audit pending</span>' : '<span class="kbadge">Hygiene score ' + p.hygieneScore + '/100</span>'; };
  M.fmtQty = function(q, unit){
    if(unit !== 'kg') return String(Math.round(q * 100) / 100);
    var w = Math.floor(q + 1e-9), f = Math.round((q - w) * 4) / 4, s = ({0:'', 0.25:'¼', 0.5:'½', 0.75:'¾'})[f] || '';
    if(f >= 1){ w += 1; s = ''; } return (w ? String(w) : '') + s || '0';
  };
  M.header = function(active){
    var L = [['butcheries.html','Partner butcheries','list'],['sell-with-azizo.html','Sell with Azizo','sell'],['partner-portal.html','Partner login','portal'],['index.html','Azizo Butchery','shop']];
    var el = K.$('kkHeader'); if(!el) return;
    el.innerHTML = '<a class="skip" href="#main">Skip to content</a><header class="kk-nav"><div class="kk-nav-in"><a class="kk-brand" href="butcheries.html"><img src="logo.png" alt="Azizo logo"><b>Azizo <span>Butchery and Grill</span></b></a>' +
      '<button class="kk-menu" aria-label="Menu" onclick="document.getElementById(\'kkLinks\').classList.toggle(\'open\')">&#9776;</button><nav class="kk-links" id="kkLinks">' +
      L.map(function(l){ return '<a href="' + l[0] + '" class="' + (l[2] === active ? 'on' : '') + (l[2] === 'sell' ? ' cta' : '') + '">' + l[1] + '</a>'; }).join('') + '</nav></div></header>';
  };
  M.footer = function(){
    var el = K.$('kkFooter'); if(!el) return;
    el.innerHTML = '<footer class="kk-foot"><div class="wrap"><b style="color:var(--gold2);font-family:Oswald;letter-spacing:.06em">AZIZO BUTCHERY AND GRILL</b><p>Partner butcheries trained, inspected and scored by Azizo. Each butchery sells and is paid directly; Azizo sets the standards.</p>' +
      '<p><a href="butcheries.html">Partner butcheries</a> · <a href="sell-with-azizo.html">Sell with Azizo</a> · <a href="index.html">Azizo shop</a> · <a href="https://wa.me/254724888057">WhatsApp 0724 888 057</a></p></div></footer>';
  };
  // Is the marketplace switched on? Resolves {on:true} or {on:false, why:'off'|'offline'}.
  M.status = async function(){
    try{ var s = await M.api('/status'); return { on: !!s.enabled, why: s.enabled ? '' : 'off' }; }catch(e){ return { on: false, why: 'offline', msg: e.message }; }
  };
  M.closed = function(st){
    return '<div class="empty"><h2>' + (st.why === 'off' ? 'Partner butcheries are coming soon' : 'We cannot reach the ordering service') + '</h2><p>' + (st.why === 'off' ? 'Azizo is preparing its first partner butcheries. Meanwhile you can order from the Azizo shop.' : K.esc(st.msg || 'Please try again in a moment.')) +
      '</p><p><a class="btn gold" href="index.html">Shop at Azizo</a> <a class="btn" href="https://wa.me/254724888057">Order on WhatsApp</a></p></div>';
  };
})();
