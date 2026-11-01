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
})();
