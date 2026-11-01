(function(){
  'use strict';
  var K = window.KK, M = window.MK, O = window.OPS, $ = K.$, esc = K.esc, app = $('app');
  M.header(''); M.footer();
  app.innerHTML = '<div style="padding:18px 0 0"><div class="eyebrow">Azizo Rewards</div><h2 style="margin:0">Earn points on every order</h2></div>' +
    '<div class="panel" style="margin-top:12px"><p>You earn <b>1 point for every KES 100</b> spent on completed orders (shop, partner butcheries and Azizo Kitchens). <b>100 points = KES 100</b> off a future order. Tiers: Bronze, Silver (300 points earned) and Gold (1,000 points earned).</p>' +
    '<label class="f" for="rp">Your phone number</label><input id="rp" type="tel" inputmode="numeric" placeholder="07XX XXX XXX" autocomplete="tel"><label class="f" for="ro">Any one of your order numbers</label><input id="ro" type="number" inputmode="numeric" placeholder="e.g. 1042"><div id="re"></div><button class="btn gold" id="rg" style="margin-top:10px">Check my points</button></div><div id="rb"></div>';
  var show = async function(){
    $('re').innerHTML = ''; $('rb').innerHTML = '';
    try{ var r = await O.api('/loyalty?phone=' + encodeURIComponent($('rp').value) + '&orderNo=' + encodeURIComponent($('ro').value)); }catch(e){ $('re').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; return; }
    $('rb').innerHTML = '<div class="panel" style="margin-top:12px"><div class="cards"><div class="stat"><b>' + r.points + '</b>Points</div><div class="stat"><b>' + esc(r.tier) + '</b>Your tier</div><div class="stat"><b>KES ' + r.worthKes + '</b>You can redeem</div></div>' + (r.next ? '<p class="kmeta" style="color:var(--mute)">' + r.toNext + ' more points to reach ' + esc(r.next) + '.</p>' : '<p class="kmeta" style="color:var(--mute)">You are at our top tier. Thank you!</p>') +
      (r.points >= 100 ? '<label class="f" for="rr">Points to redeem (multiples of 100)</label><input id="rr" type="number" step="100" min="100" max="' + Math.floor(r.points / 100) * 100 + '" value="' + Math.floor(r.points / 100) * 100 + '"><div id="rx"></div><button class="btn gold" id="rd" style="margin-top:10px">Request my reward</button><p class="kmeta" style="color:var(--mute)">Azizo confirms on WhatsApp and applies the credit to your next order.</p>' : '<p>Keep ordering: you can redeem from 100 points.</p>') + '</div>';
    var d = $('rd'); if(d) d.onclick = async function(){ try{ var x = await O.api('/loyalty/redeem', { method: 'POST', body: JSON.stringify({ phone: $('rp').value, orderNo: $('ro').value, points: $('rr').value }) }); $('rx').innerHTML = '<div class="msg ok">' + esc(x.message) + '</div>'; }catch(e){ $('rx').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; } };
  };
  $('rg').onclick = show;
})();
