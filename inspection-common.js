(function(){
  'use strict';
  var esc = function(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var VAL = { pass: 1, partial: 0.5, fail: 0 }, LBL = { pass: 'Pass', partial: 'Partial', fail: 'Fail', na: 'N/A' }, CLS = { pass: 'v-p', partial: 'v-h', fail: 'v-f', na: 'v-n' };
  var INSP = window.INSP = {};
  INSP.esc = esc;
  INSP.letterhead = function(std){
    return '<div class="lh"><img src="logo.png" alt="Azizo logo"><div><h1>AZIZO <span>BUTCHERY AND GRILL</span></h1><p>Nairobi, Kenya &middot; Syokimau (Main branch) &middot; Open 24 hours &middot; WhatsApp +254 724 888 057</p><p>Quality Assurance and Partner Standards</p></div></div>' +
      '<div class="lh-title"><h2>' + esc(std.title) + ' Form</h2><small>Form No. ' + esc(std.formNo) + ' &middot; Standard ' + esc(std.version) + '</small><span class="conf">Official record &middot; Confidential &middot; Administrator access only</span></div>';
  };
  INSP.band = function(std, s){ for(var i = 0; i < std.bands.length; i++) if(s >= std.bands[i].min) return std.bands[i]; return std.bands[std.bands.length - 1]; };
  /** Live preview only; the server recalculates the real score. Works with partly answered forms. */
  INSP.score = function(std, ans){
    var tot = 0, ws = 0, crit = [], n = 0, all = 0, cats = [];
    std.categories.forEach(function(c){ var w = 0, s = 0; c.items.forEach(function(i){ all++; var a = ans[i.id]; if(!a || !a.v) return; n++; if(a.v === 'na') return; w += i.w; s += i.w * VAL[a.v]; if(a.v === 'fail' && i.critical) crit.push(i.id); });
      var p = w ? s / w : null; cats.push({ id: c.id, name: c.name, weight: c.weight, pct: p === null ? null : Math.round(p * 1000) / 10 }); if(p !== null){ tot += c.weight * p; ws += c.weight; } });
    var sc = ws ? tot / ws * 100 : 0; if(crit.length && sc > 59) sc = 59; sc = Math.round(sc * 10) / 10; var b = INSP.band(std, sc);
    return { score: sc, grade: b.grade, stars: b.stars, label: b.label, action: b.action, answered: n, total: all, critical: crit, cats: cats, result: (crit.length || sc < 60) ? 'Fail' : (sc < 70 ? 'Conditional' : 'Pass') };
  };
  INSP.bars = function(cats){ return cats.map(function(c){ var p = c.pct; return '<div class="cbar"><span>' + esc(c.id) + '. ' + esc(c.name) + ' <small style="color:#888">(' + c.weight + '%)</small></span><i><s class="' + (p === null ? '' : p >= 80 ? '' : p >= 60 ? 'mid' : 'low') + '" style="width:' + (p || 0) + '%"></s></i><b>' + (p === null ? 'n/a' : p + '%') + '</b></div>'; }).join(''); };
  INSP.stars = function(n){ return '&#9733;&#9733;&#9733;&#9733;&#9733;'.slice(0, n * 7) + '<span style="opacity:.25">' + '&#9733;&#9733;&#9733;&#9733;&#9733;'.slice(0, (5 - n) * 7) + '</span>'; };
  /** The finished, printable record. rec = inspection (full), partner, std. */
  INSP.report = function(rec, partner, std){
    var rows = std.categories.map(function(c){
      return '<h3>' + esc(c.id) + '. ' + esc(c.name) + ' <em>weight ' + c.weight + '%</em></h3><table class="rep-t"><tbody>' + c.items.map(function(i){ var a = rec.answers[i.id] || { v: 'na', n: '' };
        return '<tr><td style="width:46px"><b>' + esc(i.id) + '</b></td><td>' + esc(i.text) + (i.critical ? ' <span class="crit">critical</span>' : '') + (a.n ? '<br><small>Finding: ' + esc(a.n) + '</small>' : '') + '</td><td style="width:64px" class="' + CLS[a.v] + '">' + LBL[a.v] + '</td></tr>'; }).join('') + '</tbody></table>'; }).join('');
    var b = INSP.band(std, rec.score);
    return '<div class="insp-paper" id="paper">' + INSP.letterhead(std) +
      '<div class="rep-sum"><div><div class="big">' + rec.score + '<small style="font-size:18px">/100</small></div><div>' + INSP.stars(rec.stars) + '</div></div><div><span class="stamp">GRADE ' + esc(rec.grade) + '</span><div style="margin-top:6px"><b>' + esc(b.label) + '</b> &middot; Result: <b>' + esc(rec.result) + '</b>' + (rec.criticalFails ? ' &middot; <span class="v-f">' + rec.criticalFails + ' critical failure(s)</span>' : '') + '</div><div style="font-size:12.5px;margin-top:3px">' + esc(b.action) + '</div></div></div>' +
      '<div class="kv"><div><label>Inspection reference</label><div class="ro"><b>' + esc(rec.ref) + '</b></div></div><div><label>Date and time</label><div class="ro">' + esc(rec.inspectedAt) + '</div></div>' +
      '<div><label>Butchery inspected</label><div class="ro"><b>' + esc(partner.name) + '</b></div></div><div><label>Premises address</label><div class="ro">' + esc(partner.address) + '</div></div>' +
      '<div><label>Owner / contact</label><div class="ro">' + esc(partner.owner) + ' &middot; ' + esc(partner.phone) + '</div></div><div><label>Licence / health certificate no.</label><div class="ro">' + esc(partner.licenceNo || '-') + ' / ' + esc(partner.healthCertNo || '-') + '</div></div>' +
      '<div><label>Inspected by</label><div class="ro">' + esc(rec.inspectorName) + '</div></div><div><label>Official title</label><div class="ro">' + esc(rec.inspectorTitle) + '</div></div>' +
      '<div><label>Visit type</label><div class="ro">' + esc(rec.visitType) + '</div></div><div><label>Partner representative present</label><div class="ro">' + esc(rec.repName) + (rec.repRole ? ' (' + esc(rec.repRole) + ')' : '') + '</div></div></div>' +
      '<h3>Weighted score by category</h3><div style="margin-top:8px">' + INSP.bars(rec.catScores) + '</div>' + rows +
      '<h3>Inspector\'s notes</h3><p style="white-space:pre-wrap">' + esc(rec.notes || 'None.') + '</p><h3>Corrective actions required' + (rec.actionDue ? ' <em>by ' + esc(rec.actionDue) + '</em>' : '') + '</h3><p style="white-space:pre-wrap">' + esc(rec.actions || 'None.') + '</p>' +
      '<p><b>Next inspection due:</b> ' + esc(rec.nextDue) + '</p>' +
      '<div class="sigs"><div>' + (rec.inspectorSig ? '<img alt="Inspector signature" src="' + esc(rec.inspectorSig) + '">' : '<div style="height:90px;border-bottom:1px solid #333"></div>') + '<div class="sig-b"><b>' + esc(rec.inspectorName) + '</b><br>' + esc(rec.inspectorTitle) + ', Azizo Butchery and Grill</div></div><div>' + (rec.repSig ? '<img alt="Partner signature" src="' + esc(rec.repSig) + '">' : '<div style="height:90px;border-bottom:1px solid #333"></div>') + '<div class="sig-b"><b>' + esc(rec.repName) + '</b><br>' + (esc(rec.repRole) || 'Partner representative') + '</div></div></div>' +
      '<div class="foot"><span>' + esc(std.formNo) + ' &middot; ' + esc(std.version) + ' &middot; Ref ' + esc(rec.ref) + '</span><span>' + (rec.sealOk ? 'Digital seal intact' : '<b style="color:#b00">SEAL BROKEN: this record was changed after it was saved</b>') + '</span><span>Confidential Azizo record. Not for the partner or public.</span></div></div>';
  };
  /** Finger / mouse signature pad. Returns {data(), clear(), empty()}. */
  INSP.pad = function(cv){
    var ctx = cv.getContext('2d'), drawing = false, used = false;
    function size(){ var r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1; cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); ctx.scale(d, d); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#111'; }
    size();
    function pt(e){ var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    cv.addEventListener('pointerdown', function(e){ drawing = true; used = true; var p = pt(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); cv.setPointerCapture(e.pointerId); e.preventDefault(); });
    cv.addEventListener('pointermove', function(e){ if(!drawing) return; var p = pt(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function(n){ cv.addEventListener(n, function(){ drawing = false; }); });
    return { data: function(){ return used ? cv.toDataURL('image/png') : ''; }, clear: function(){ ctx.clearRect(0, 0, cv.width, cv.height); used = false; }, empty: function(){ return !used; } };
  };
})();
