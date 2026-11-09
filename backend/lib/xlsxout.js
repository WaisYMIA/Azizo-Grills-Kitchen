// Minimal styled multi-sheet .xlsx writer (no dependencies): bold frozen header, filters, typed cells, number formats, column widths.
// sheets: [{ name, columns:[{label, type:'text|int|money|pct|date|datetime|num', width}], rows:[[...]], freeze:true, filter:true, kv:true }]
const zlib = require('zlib');
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = b => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function zip(files) { // files: [[name, Buffer]]
  const parts = [], cen = []; let off = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name), comp = zlib.deflateRawSync(data), crc = crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8); h.writeUInt16LE(0, 10); h.writeUInt16LE(0x21, 12);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    parts.push(h, n, comp);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10); c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    cen.push(c, n); off += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(cen), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
const col = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - m) / 26); } return s; };
// style ids: 0 default, 1 header, 2 int #,##0, 3 money #,##0, 4 pct 0.0"%", 5 date yyyy-mm-dd, 6 datetime, 7 num #,##0.00, 8 title (bold large), 9 wrap text, 10 bold
const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="3"><numFmt numFmtId="164" formatCode="0.0&quot;%&quot;"/><numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="166" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/></numFmts>' +
  '<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF7A1F2B"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="11"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
  '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
const SID = { text: 0, int: 2, money: 3, pct: 4, date: 5, datetime: 6, num: 7 };
function serial(v, withTime) { // 'YYYY-MM-DD[ HH:MM[:SS]]' (already local) -> excel serial
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(v)); if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)); return ms / 86400000 + 25569;
}
function sheetXml(s) {
  const cols = s.columns || [], rows = s.rows || [], out = [];
  const width = cols.map((c, i) => c.width || Math.min(48, Math.max(10, String(c.label).length + 3, ...rows.slice(0, 200).map(r => String(r[i] == null ? '' : r[i]).length + 2))));
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
  if (s.kv) out.push('<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>');
  else if (s.freeze !== false) out.push('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>');
  out.push('<cols>' + (s.kv ? '<col min="1" max="1" width="30" customWidth="1"/><col min="2" max="2" width="90" customWidth="1"/>' : width.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')) + '</cols><sheetData>');
  const cell = (r, c, v, type) => {
    const ref = col(c) + r; if (v == null || v === '') return '';
    if (typeof v === 'number' && isFinite(v) && type !== 'text') return `<c r="${ref}" s="${SID[type] || 0}"><v>${v}</v></c>`;
    if ((type === 'date' || type === 'datetime') && typeof v === 'string') { const n = serial(v); if (n != null) return `<c r="${ref}" s="${SID[type]}"><v>${n}</v></c>`; }
    const t = String(v); const num = type !== 'text' && /^-?\d+(\.\d+)?$/.test(t) && SID[type] ? Number(t) : null;
    if (num != null) return `<c r="${ref}" s="${SID[type]}"><v>${num}</v></c>`;
    const safe = /^[=+\-@]/.test(t) && type === 'text' && !/^-?\d/.test(t) ? "'" + t : t; // spreadsheet-formula injection guard
    return `<c r="${ref}" t="inlineStr"${s.kv ? ' s="9"' : ''}><is><t xml:space="preserve">${esc(safe.slice(0, 32000))}</t></is></c>`;
  };
  let r = 1;
  if (s.kv) { for (const [k, v] of rows) { out.push(`<row r="${r}"><c r="A${r}" s="10" t="inlineStr"><is><t>${esc(k)}</t></is></c>${cell(r, 1, v, 'text')}</row>`); r++; } }
  else {
    out.push('<row r="1" ht="30" customHeight="1">' + cols.map((c, i) => `<c r="${col(i)}1" s="1" t="inlineStr"><is><t>${esc(c.label)}</t></is></c>`).join('') + '</row>');
    rows.forEach(row => { r++; out.push(`<row r="${r}">` + cols.map((c, i) => cell(r, i, row[i], c.type || 'text')).join('') + '</row>'); });
  }
  out.push('</sheetData>');
  if (!s.kv && s.filter !== false && cols.length && rows.length) out.push(`<autoFilter ref="A1:${col(cols.length - 1)}${rows.length + 1}"/>`);
  out.push('</worksheet>'); return out.join('');
}
function workbook(sheets, meta) {
  const used = new Set(), names = sheets.map(s => { let n = String(s.name).replace(/[\\\/?*\[\]:]/g, ' ').slice(0, 31) || 'Sheet', k = n, i = 2; while (used.has(k.toLowerCase())) k = n.slice(0, 28) + ' ' + i++; used.add(k.toLowerCase()); return k; });
  const files = [
    ['[Content_Types].xml', Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' + sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>')],
    ['_rels/.rels', Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>')],
    ['docProps/core.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc((meta && meta.title) || 'Azizo report')}</dc:title><dc:creator>Azizo Butchery and Grill</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`)],
    ['xl/workbook.xml', Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>')],
    ['xl/_rels/workbook.xml.rels', Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`)],
    ['xl/styles.xml', Buffer.from(STYLES)],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, Buffer.from(sheetXml(s))]),
  ];
  return zip(files);
}
module.exports = { workbook, zip, crc32 };
