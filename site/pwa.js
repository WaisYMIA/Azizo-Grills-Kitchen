/* Azizo — app install prompt + automatic update check (v1.9). Standalone; no dependencies. */
(function(){
  var APP_VERSION='4.1.0';
  var LS={get:function(k){try{return localStorage.getItem(k)}catch(e){return null}},set:function(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
  var standalone=function(){return (window.matchMedia&&matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true;};
  var deferred=null, regRef=null;

  function el(html){var d=document.createElement('div');d.innerHTML=html.trim();return d.firstChild;}
  function toast(id,html){
    var old=document.getElementById(id); if(old) old.remove();
    var n=el('<div class="pwa-bar" id="'+id+'" role="dialog" aria-live="polite">'+html+'</div>');
    document.body.appendChild(n); return n;
  }

  /* ---------- INSTALL ---------- */
  var DISMISS_KEY='azizoInstallDismissed', DONE_KEY='azizoInstalled';
  function dismissed(){var t=parseInt(LS.get(DISMISS_KEY)||'0',10);return t&&Date.now()-t<7*864e5;}
  function isIOS(){return /iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);}
  function showInstall(){
    if(standalone()||LS.get(DONE_KEY)||dismissed()||document.getElementById('pwaInstall')) return;
    var b=toast('pwaInstall','<img src="icon-192.png" alt="" width="40" height="40"><div class="pwa-t"><b>Install the Azizo app</b><span>Order faster, works like an app, opens from your home screen.</span></div><button class="pwa-go" id="pwaGo">Install</button><button class="pwa-x" id="pwaNo" aria-label="Not now">Not now</button>');
    b.querySelector('#pwaNo').onclick=function(){LS.set(DISMISS_KEY,String(Date.now()));b.remove();};
    b.querySelector('#pwaGo').onclick=function(){doInstall(b);};
  }
  function doInstall(b){
    if(deferred){
      deferred.prompt();
      deferred.userChoice.then(function(c){
        if(c&&c.outcome==='accepted') LS.set(DONE_KEY,'1'); else LS.set(DISMISS_KEY,String(Date.now()));
        deferred=null; if(b) b.remove();
      });
    } else if(isIOS()){
      var t=b&&b.querySelector('.pwa-t'); if(t) t.innerHTML='<b>Add to Home Screen</b><span>Tap the Share button, then “Add to Home Screen”.</span>';
      var g=b&&b.querySelector('#pwaGo'); if(g) g.remove();
    } else {
      var t2=b&&b.querySelector('.pwa-t'); if(t2) t2.innerHTML='<b>Install from your browser</b><span>Use the install icon in the address bar, or the browser menu → “Install app”.</span>';
      var g2=b&&b.querySelector('#pwaGo'); if(g2) g2.remove();
    }
  }
  window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();deferred=e;setTimeout(showInstall,2500);});
  window.addEventListener('appinstalled',function(){LS.set(DONE_KEY,'1');var b=document.getElementById('pwaInstall');if(b)b.remove();});
  window.addEventListener('load',function(){
    // iOS Safari never fires beforeinstallprompt: show the how-to once.
    if(isIOS()&&!standalone()) setTimeout(showInstall,4000);
    // Footer link: lets people install again or check updates by hand.
    addFooterTools();
  });

  /* ---------- UPDATES ---------- */
  function showUpdate(worker){
    var b=toast('pwaUpdate','<div class="pwa-t"><b>A new version is ready</b><span>Refresh to get the latest menu, prices and features.</span></div><button class="pwa-go" id="pwaUp">Update now</button><button class="pwa-x" id="pwaLater">Later</button>');
    b.querySelector('#pwaLater').onclick=function(){b.remove();};
    b.querySelector('#pwaUp').onclick=function(){
      var done=false; navigator.serviceWorker.addEventListener('controllerchange',function(){if(done)return;done=true;location.reload();});
      try{worker.postMessage('SKIP_WAITING');}catch(e){location.reload();}
      setTimeout(function(){if(!done)location.reload();},2500);
    };
  }
  function watch(reg){
    regRef=reg;
    if(reg.waiting&&navigator.serviceWorker.controller) showUpdate(reg.waiting);
    reg.addEventListener('updatefound',function(){
      var w=reg.installing; if(!w) return;
      w.addEventListener('statechange',function(){
        if(w.state==='installed'&&navigator.serviceWorker.controller) showUpdate(w);
      });
    });
  }
  function check(manual){
    if(!('serviceWorker' in navigator)){ if(manual) say('Updates are checked automatically when the site is opened over HTTPS.'); return; }
    navigator.serviceWorker.getRegistration().then(function(reg){
      if(!reg){ if(manual) say('Not installed yet — updates start once the app is installed.'); return; }
      watch(reg);
      return reg.update().then(function(){
        if(manual) setTimeout(function(){ if(!document.getElementById('pwaUpdate')) say('You have the latest version (v'+APP_VERSION+').'); },1200);
      });
    }).catch(function(){ if(manual) say('Could not check right now. Check your internet and try again.'); });
  }
  function say(msg){
    var b=toast('pwaMsg','<div class="pwa-t"><span style="color:inherit">'+msg+'</span></div><button class="pwa-x" id="pwaOk">OK</button>');
    b.querySelector('#pwaOk').onclick=function(){b.remove();}; setTimeout(function(){b.remove();},5000);
  }
  function addFooterTools(){
    var f=document.querySelector('footer'); if(!f||document.getElementById('pwaTools')) return;
    var d=el('<div id="pwaTools" class="pwa-tools"><span>App v'+APP_VERSION+'</span> · <a href="#" id="pwaChk">Check for updates</a>'+(standalone()?'':' · <a href="#" id="pwaInst">Install app</a>')+'</div>');
    f.appendChild(d);
    d.querySelector('#pwaChk').onclick=function(e){e.preventDefault();check(true);};
    var i=d.querySelector('#pwaInst'); if(i) i.onclick=function(e){e.preventDefault();LS.set(DISMISS_KEY,'');LS.set(DONE_KEY,'');showInstall();var b=document.getElementById('pwaInstall');if(!b){b=toast('pwaInstall','<div class="pwa-t"><b>Install the Azizo app</b></div><button class="pwa-go" id="pwaGo">Install</button><button class="pwa-x" id="pwaNo">Not now</button>');b.querySelector('#pwaNo').onclick=function(){b.remove();};b.querySelector('#pwaGo').onclick=function(){doInstall(b);};}};
  }

  if('serviceWorker' in navigator){
    window.addEventListener('load',function(){ setTimeout(function(){check(false);},1500); });
    document.addEventListener('visibilitychange',function(){ if(!document.hidden) check(false); });
    setInterval(function(){ if(!document.hidden) check(false); }, 30*60*1000);
  }
})();
