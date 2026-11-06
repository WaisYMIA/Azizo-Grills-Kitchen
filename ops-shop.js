// v5.0 shop add-ons (loaded after app.js): delivery windows + ETA, refund promise, anonymous funnel counts.
(function(){
  'use strict';
  var $ = function(id){ return document.getElementById(id); };
  var apiOn = function(){ try{ return typeof apiAvailable === 'function' && apiAvailable(); }catch(e){ return false; } };
  var send = function(name){ try{ if(!apiOn()) return; fetch(apiBase() + '/api/ops/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name }), keepalive: true }).catch(function(){}); }catch(e){} };
  // funnel: one visit per browser session, then cart / checkout / order
  try{ if(!sessionStorage.getItem('azVisit')){ sessionStorage.setItem('azVisit', '1'); send('visit'); } }catch(e){}
  var wrap = function(fn, ev){ var o = window[fn]; if(typeof o !== 'function') return; window[fn] = function(){ send(ev); return o.apply(this, arguments); }; };
  wrap('addToCart', 'cart_add'); wrap('openCart', 'checkout_open');
  var oc = window.trackConversion; if(typeof oc === 'function') window.trackConversion = function(n){ if(n === 'order_placed') send('order_placed'); return oc.apply(this, arguments); };
  // delivery windows
  var WIN = [[8, 10], [10, 12], [12, 14], [14, 16], [16, 18], [18, 20], [20, 22]];
  var h12 = function(h){ return (h % 12 || 12) + (h < 12 ? 'am' : 'pm'); };
  function etaMinutes(){
    var dm = ''; try{ dm = selectedDeliveryMethod; }catch(e){}
    var km = 0; try{ km = (dm === 'delivery' && deliveryFeeInfo) ? deliveryFeeInfo.km : 0; }catch(e){}
    return dm === 'delivery' ? [25 + Math.round(km * 4) + 5, 25 + Math.round(km * 4) + 20] : [20, 30];
  }
  function build(){
    var sel = $('prefTime'); if(!sel) return; var keep = sel.value, now = new Date(), hh = now.getHours() + now.getMinutes() / 60, opts = ['No preference', 'As soon as possible'];
    WIN.forEach(function(w){ if(w[0] >= hh + 0.75) opts.push('Today ' + h12(w[0]) + ' - ' + h12(w[1])); });
    ['Tomorrow'].forEach(function(d){ WIN.forEach(function(w){ opts.push(d + ' ' + h12(w[0]) + ' - ' + h12(w[1])); }); });
    opts.push('Another day - I will confirm on WhatsApp');
    sel.innerHTML = opts.map(function(o){ return '<option>' + o + '</option>'; }).join('');
    if(opts.indexOf(keep) > -1) sel.value = keep;
    if(!$('etaLine')){ var d = document.createElement('div'); d.id = 'etaLine'; d.className = 'checkout-note'; d.style.cssText = 'margin:-4px 0 10px;font-size:.85rem'; sel.parentNode.insertBefore(d, sel.nextSibling); }
    eta();
  }
  function eta(){
    var sel = $('prefTime'), d = $('etaLine'); if(!sel || !d) return; var e = etaMinutes(), v = sel.value;
    var dm = ''; try{ dm = selectedDeliveryMethod; }catch(x){}
    d.textContent = (v === 'As soon as possible' || v === 'No preference') ? (dm === 'delivery' ? 'Estimated delivery: about ' + e[0] + '-' + e[1] + ' minutes after we confirm your order.' : 'Estimated pickup: ready in about ' + e[0] + '-' + e[1] + ' minutes.') : 'We will confirm your ' + v.toLowerCase() + ' slot on WhatsApp.';
  }
  function policy(){
    if($('policyLine')) return; var n = $('checkoutNote'); if(!n) return; var p = document.createElement('div'); p.id = 'policyLine'; p.style.cssText = 'font-size:.78rem;opacity:.8;margin:6px 0';
    p.innerHTML = 'Not happy? We replace or refund within 24 hours. Items sold by weight are estimates: the final total follows the weighed amount and we confirm it first. <a href="privacy.html" style="color:inherit;text-decoration:underline">Refunds, privacy and allergens</a>';
    n.parentNode.insertBefore(p, n);
  }
  function init(){ build(); policy(); var sel = $('prefTime'); if(sel){ sel.addEventListener('change', function(){ eta(); if(sel.value !== 'No preference') send('slot_chosen'); }); } document.addEventListener('click', function(){ setTimeout(eta, 50); }, true); setInterval(build, 600000); }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  // ---- v5.3 "Ask Azizo" assistant (appears only when the server has the AI switched on) ----
  (function(){
    if(!apiOn()) return;
    fetch(apiBase() + '/api/ai/status').then(function(r){ return r.json(); }).then(function(s){ if(s && s.enabled) mount(); }).catch(function(){});
    function mount(){
      var st = document.createElement('style'); st.textContent = '#azAi{position:fixed;right:14px;bottom:14px;z-index:9998;font-family:inherit}#azAi button.fab{background:#d4a63f;color:#1a1208;border:0;border-radius:999px;padding:12px 16px;font-weight:700;box-shadow:0 4px 14px rgba(0,0,0,.35);cursor:pointer}#azAiBox{display:none;width:min(340px,calc(100vw - 28px));height:min(440px,70vh);background:#1b1612;color:#f4ece0;border:1px solid #3a2f22;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.5);flex-direction:column;overflow:hidden}#azAiBox.on{display:flex}#azAiBox header{padding:10px 12px;font-weight:700;display:flex;justify-content:space-between;background:#241c14}#azAiLog{flex:1;overflow:auto;padding:10px;font-size:.9rem}#azAiLog p{margin:0 0 8px;padding:8px 10px;border-radius:10px;background:#2a2118;white-space:pre-wrap}#azAiLog p.me{background:#d4a63f;color:#1a1208;margin-left:28px}#azAiBox form{display:flex;gap:6px;padding:8px;border-top:1px solid #3a2f22}#azAiBox input{flex:1;min-width:0;padding:9px;border-radius:8px;border:1px solid #3a2f22;background:#120e0a;color:inherit}#azAiBox form button{background:#d4a63f;border:0;border-radius:8px;padding:0 12px;font-weight:700;cursor:pointer}#azAiBox small{display:block;padding:0 10px 8px;color:#a8998a}@media(max-width:480px){#azAi{bottom:78px}}';
      document.head.appendChild(st);
      var w = document.createElement('div'); w.id = 'azAi';
      w.innerHTML = '<div id="azAiBox" role="dialog" aria-label="Ask Azizo"><header><span>Ask Azizo</span><button type="button" id="azAiX" aria-label="Close" style="background:none;border:0;color:inherit;font-size:1.2rem;cursor:pointer">x</button></header><div id="azAiLog" aria-live="polite"><p>Hi! Ask me about our meat, prices, delivery or how to order. I cannot place orders. For those, use the cart or WhatsApp.</p></div><small>AI answers can be wrong. For orders and complaints use WhatsApp +254724888057.</small><form id="azAiF"><input id="azAiQ" maxlength="400" placeholder="Type your question" autocomplete="off" aria-label="Your question"><button>Send</button></form></div><button type="button" class="fab" id="azAiB">Ask Azizo</button>';
      document.body.appendChild(w);
      var box = document.getElementById('azAiBox'), log = document.getElementById('azAiLog'), hist = [];
      var add = function(t, me){ var p = document.createElement('p'); if(me) p.className = 'me'; p.textContent = t; log.appendChild(p); log.scrollTop = log.scrollHeight; return p; };
      document.getElementById('azAiB').onclick = function(){ box.classList.toggle('on'); if(box.classList.contains('on')) document.getElementById('azAiQ').focus(); };
      document.getElementById('azAiX').onclick = function(){ box.classList.remove('on'); };
      document.getElementById('azAiF').onsubmit = function(e){
        e.preventDefault(); var q = document.getElementById('azAiQ'), t = q.value.trim(); if(!t) return; q.value = ''; add(t, true); hist.push({ role: 'user', content: t }); var wait = add('...');
        fetch(apiBase() + '/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: hist.slice(-6) }) })
          .then(function(r){ return r.json().then(function(d){ if(!r.ok) throw new Error(d.error || 'Try again'); return d; }); })
          .then(function(d){ wait.textContent = d.reply; hist.push({ role: 'assistant', content: d.reply }); })
          .catch(function(er){ wait.textContent = er.message || 'Sorry, something went wrong. Message us on WhatsApp +254724888057.'; hist.pop(); });
      };
    }
  })();
})();
