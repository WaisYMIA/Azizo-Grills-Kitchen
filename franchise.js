(function(){
  'use strict';
  var K = window.KK, M = window.MK, $ = K.$, esc = K.esc, app = $('app');
  M.header('sell'); M.footer();
  function kes(n){ return 'KSh ' + Number(n || 0).toLocaleString('en-KE'); }
  function api(path, opts){ return K.apiAt('/api/growth', path, opts); }
  (async function(){
    var c = null;
    try{ c = (await api('/config')).franchise; }catch(e){}
    if(!c || !c.on){
      app.innerHTML = '<section class="sec"><div class="wrap"><div class="msg info">Franchise enquiries are not open right now. Message us on WhatsApp and we will tell you when they open.</div></div></section>';
      return;
    }
    var terr = c.territory ? '<li>' + esc(c.territory) + '</li>' : '';
    var facts = '<section class="sec"><div class="wrap"><h2>The <em>numbers</em></h2>' +
      '<div class="mk-steps">' +
      '<div class="step"><i>KSh</i><h3>Investment</h3><p>About ' + kes(c.investMin) + ' to ' + kes(c.investMax) + ' to fit out and open.</p></div>' +
      '<div class="step"><i>%</i><h3>Franchise fee</h3><p>' + kes(c.fee) + ' one-off.</p></div>' +
      '<div class="step"><i>%</i><h3>Royalty</h3><p>' + esc(c.royaltyPct) + '% of sales.</p></div>' +
      '<div class="step"><i>yrs</i><h3>Term</h3><p>' + esc(c.termYears) + ' years, renewable.</p></div></div>' +
      '<p class="kmeta" style="color:var(--mute);font-size:.88rem;margin-top:12px"><b>These figures are indicative only.</b> Final terms are set out in the signed franchise agreement.</p>' +
      (terr ? '<ul class="tick" style="margin-top:10px">' + terr + '</ul>' : '') + '</div></section>';
    app.innerHTML = '<div id="top"></div>' + facts +
      '<section class="sec" id="apply"><div class="wrap" style="max-width:760px"><h2>Send an <em>enquiry</em></h2><form id="f" class="panel" novalidate>' +
      '<div class="row"><div><label class="f" for="name">Full name</label><input id="name" required></div><div><label class="f" for="phone">Phone (WhatsApp)</label><input id="phone" type="tel" required></div></div>' +
      '<div class="row" style="margin-top:10px"><div><label class="f" for="email">Email</label><input id="email" type="email" required></div><div><label class="f" for="town">Town or area you want to open in</label><input id="town" required></div></div>' +
      '<div class="row" style="margin-top:10px"><div><label class="f" for="budget">Investment budget</label><select id="budget"><option value="under_2m">Under KSh 2M</option><option value="2m_4m">KSh 2M to 4M</option><option value="4m_6m" selected>KSh 4M to 6M</option><option value="over_6m">Over KSh 6M</option></select></div>' +
      '<div><label class="f" for="premises">Premises</label><select id="premises"><option value="none">No premises yet</option><option value="lease">I can lease one</option><option value="own">I own one</option></select></div></div>' +
      '<div class="row" style="margin-top:10px"><div><label class="f" for="timeline">When do you want to start?</label><select id="timeline"><option value="0_3">Within 3 months</option><option value="3_6">3 to 6 months</option><option value="6_12">6 to 12 months</option><option value="later">Later</option></select></div><div></div></div>' +
      '<label class="f" for="exp" style="margin-top:10px">Business or food experience (optional)</label><textarea id="exp" maxlength="600"></textarea>' +
      '<label class="f" for="msg" style="margin-top:10px">Anything else (optional)</label><textarea id="msg" maxlength="600"></textarea>' +
      '<input class="hp" id="hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<label style="display:flex;gap:8px;margin-top:12px;align-items:flex-start"><input type="checkbox" id="agree"> <span>I agree that Azizo may contact me about this enquiry. This is not an offer, and no agreement exists until one is signed.</span></label>' +
      '<div id="err"></div><button class="btn" id="go" type="submit" style="margin-top:12px">Send enquiry</button></form></div></section>';
    $('f').onsubmit = async function(ev){
      ev.preventDefault(); $('err').innerHTML = ''; $('go').disabled = true;
      var b = { name: $('name').value, phone: $('phone').value, email: $('email').value, town: $('town').value, budget: $('budget').value,
        premises: $('premises').value, timeline: $('timeline').value, experience: $('exp').value, message: $('msg').value,
        consent: $('agree').checked, website: $('hp').value };
      try{
        var r = await api('/franchise-apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
        $('f').innerHTML = '<div class="msg ok"><b>Thank you.</b> Your reference is ' + esc(r.ref || '') + '. We will contact you soon.</div>';
      }catch(e){ $('err').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; $('go').disabled = false; }
    };
  })();
})();
