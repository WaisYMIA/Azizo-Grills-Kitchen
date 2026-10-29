(function(){
  'use strict';
  var K = window.KK, M = window.MK, $ = K.$, esc = K.esc, app = $('app');
  M.header('sell'); M.footer();
  var gps = null, photos = [];
  (async function(){
    var st = await M.status();
    var info = '<section class="sec"><div class="wrap"><h2>How it <em>works</em></h2><div class="mk-steps"><div class="step"><i>1</i><h3>Apply</h3><p>Tell us about your butchery and licence. Takes five minutes on your phone.</p></div><div class="step"><i>2</i><h3>Inspection</h3><p>We visit, check hygiene, cold storage and documents, and give you a hygiene score.</p></div><div class="step"><i>3</i><h3>Trial period</h3><p>You go live near you, on trial. You set your prices; we show our recommended price.</p></div><div class="step"><i>4</i><h3>Sell and settle</h3><p>Customers pay you directly. Azizo invoices its fee on what you sold, and shares the rate before you sign.</p></div></div></div></section>' +
      '<section class="sec"><div class="wrap two"><div><h2>What you <em>get</em></h2><ul class="tick"><li>Customers and orders without advertising</li><li>A premium storefront under the Azizo brand</li><li>Delivery help: your own riders, Azizo riders or independent riders</li><li>Training and clear standards</li></ul></div><div><h2>What we <em>ask</em></h2><ul class="tick"><li>A valid business and meat-trade licence</li><li>A clean premises and working cold storage</li><li>Fresh stock you buy yourself, with the source declared</li><li>Honest weights and on-time orders. Repeated hygiene or price complaints lead to suspension.</li></ul></div></div></section>';
    if(!st.on){ app.innerHTML = info + '<section class="sec"><div class="wrap">' + (st.why === 'off' ? '<div class="msg info">Applications are not open yet. Leave us a message on WhatsApp and we will tell you when they open.</div><p><a class="btn gold" href="https://wa.me/254724888057?text=I%20want%20to%20sell%20with%20Azizo">WhatsApp Azizo</a></p>' : M.closed(st)) + '</div></section>'; return; }
    var areas = []; try{ areas = ((await M.root('/api/areas')).areas || []); }catch(e){} if(!areas.length) areas = await K.staticAreas();
    app.innerHTML = info + '<section class="sec" id="apply"><div class="wrap" style="max-width:760px"><h2>Apply to <em>join</em></h2><form id="f" class="panel" novalidate>' +
      '<div class="row"><div><label class="f" for="name">Butchery name</label><input id="name" required></div><div><label class="f" for="owner">Owner\'s full name</label><input id="owner" required></div></div>' +
      '<div class="row" style="margin-top:10px"><div><label class="f" for="phone">Phone (WhatsApp)</label><input id="phone" type="tel" required></div><div><label class="f" for="email">Email</label><input id="email" type="email" required></div></div>' +
      '<div class="row" style="margin-top:10px"><div><label class="f" for="area">Your area</label><select id="area">' + K.areaOptions(areas, '') + '</select></div><div><label class="f">&nbsp;</label><button class="btn" id="gps" type="button">Use my location</button></div></div><p class="slotnote" id="gpsOk" style="display:none">Location saved.</p>' +
      '<label class="f" for="addr" style="margin-top:10px">Shop address or landmark</label><input id="addr">' +
      '<div class="row" style="margin-top:10px"><div><label class="f" for="lic">Business / meat-trade licence no.</label><input id="lic"></div><div><label class="f" for="licx">Licence expiry (optional)</label><input id="licx" type="date"></div></div>' +
      '<div class="row" style="margin-top:10px"><div><label class="f" for="hc">Health certificate no. (optional)</label><input id="hc"></div><div><label class="f" for="halal">Halal</label><select id="halal"><option value="">No / not sure</option><option value="1">Yes, halal</option></select></div></div>' +
      '<div class="row" style="margin-top:10px"><div><label class="f" for="dm">Who delivers?</label><select id="dm"><option value="own">My own riders</option><option value="azizo">Azizo riders</option><option value="independent">Independent riders</option></select></div><div><label class="f" for="pm">You receive payment by</label><select id="pm"><option value="till">M-Pesa Till</option><option value="paybill">Paybill</option><option value="pochi">Pochi la Biashara</option></select></div></div>' +
      '<label class="f" for="pa" style="margin-top:10px">Till / paybill / phone number for payments</label><input id="pa">' +
      '<label class="f" for="story" style="margin-top:10px">Your story: how long have you cut meat, where does your meat come from, what are you proud of?</label><textarea id="story" maxlength="800"></textarea>' +
      '<label class="f" for="ph" style="margin-top:10px">Photos of your shop and cold room (up to 3)</label><input id="ph" type="file" accept="image/*" multiple>' +
      '<p class="kmeta" style="color:var(--mute);font-size:.84rem">Bring your original licence and health certificate to the inspection visit. Do not send ID documents here.</p>' +
      '<label class="f" for="pw" style="margin-top:10px">Choose a password for the partner portal</label><input id="pw" type="password" autocomplete="new-password">' +
      '<input class="hp" id="hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<label style="display:flex;gap:8px;margin-top:12px;align-items:flex-start"><input type="checkbox" id="agree"> <span>I accept the Azizo hygiene, pricing and conduct standards, and that Azizo may suspend a butchery that breaks them.</span></label><div id="err"></div><button class="btn gold" id="go" style="width:100%;margin-top:10px" type="submit">Send application</button></form></div></section>';
    $('gps').onclick = async function(){ try{ gps = await K.gps(); $('gpsOk').style.display = ''; $('area').value = ''; }catch(e){ K.toast(e.message); } };
    $('ph').onchange = async function(){ photos = []; try{ var fs = Array.prototype.slice.call(this.files, 0, 3); for(var i = 0; i < fs.length; i++) photos.push(await K.readImage(fs[i], 1400, 900)); }catch(e){ $('err').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; } };
    $('f').onsubmit = async function(ev){
      ev.preventDefault(); $('err').innerHTML = ''; $('go').disabled = true;
      var b = { name: $('name').value, owner: $('owner').value, phone: $('phone').value, email: $('email').value, password: $('pw').value, address: $('addr').value, licenceNo: $('lic').value, licenceExpiry: $('licx').value, healthCertNo: $('hc').value, halal: !!$('halal').value,
        deliveryMode: $('dm').value, payMethod: $('pm').value, payAccount: $('pa').value, story: $('story').value, photos: photos, agree: $('agree').checked, website: $('hp').value };
      if($('area').value) b.areaId = $('area').value; else if(gps){ b.lat = gps.lat; b.lng = gps.lng; }
      try{ var r = await M.api('/apply', { method: 'POST', body: M.json(b) }); $('f').innerHTML = '<div class="msg ok"><b>Application received.</b> ' + esc(r.message || '') + '</div><p><a class="btn gold" href="partner-portal.html">Go to partner login</a></p>'; }
      catch(e){ $('err').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; $('go').disabled = false; }
    };
  })();
})();
