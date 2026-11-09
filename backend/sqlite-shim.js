// Loads better-sqlite3 when it is installed. If it cannot be built (for example, new Node versions on
// Windows without Visual Studio), falls back to Node's built-in SQLite (Node 22.13 or newer) with the
// same small API, so `npm install` problems with the native module do not stop the site from running.
function load() {
  if (!process.env.FORCE_NODE_SQLITE) {
    try { return require('better-sqlite3'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND' && !/better_sqlite3|bindings|Could not locate|NODE_MODULE_VERSION|invalid ELF|not a valid Win32/i.test(String(e.message))) throw e; }
  }
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); }
  catch (e) { throw new Error('SQLite is not available. Install Node 22 LTS (https://nodejs.org) or run "npm install" so that better-sqlite3 is installed.'); }
  console.log('[db] better-sqlite3 not available, using the built-in node:sqlite');
  const num = (v) => (typeof v === 'bigint' ? Number(v) : v);
  const fix = (a) => a.map((x) => (typeof x === 'boolean' ? (x ? 1 : 0) : x === undefined ? null : x));
  const args = (a) => (a.length === 1 && a[0] && typeof a[0] === 'object' && !Array.isArray(a[0]) && !Buffer.isBuffer(a[0]) ? [a[0]] : Array.isArray(a[0]) ? fix(a[0]) : fix(a));
  return class Database {
    constructor(file) { this._d = new DatabaseSync(file); this._depth = 0; this.open = true; }
    exec(sql) { this._d.exec(sql); return this; }
    pragma(s) { const r = this._d.prepare('PRAGMA ' + s).all(); return r; }
    prepare(sql) {
      const st = this._d.prepare(sql);
      return {
        get: (...a) => st.get(...args(a)),
        all: (...a) => st.all(...args(a)),
        iterate: (...a) => st.all(...args(a))[Symbol.iterator](),
        run: (...a) => { const r = st.run(...args(a)); return { changes: num(r.changes), lastInsertRowid: num(r.lastInsertRowid) }; },
      };
    }
    transaction(fn) {
      const self = this;
      const wrap = function (...a) {
        const sp = 'sp' + self._depth; const top = self._depth === 0;
        self._d.exec(top ? 'BEGIN' : 'SAVEPOINT ' + sp); self._depth++;
        try { const r = fn.apply(this, a); self._depth--; self._d.exec(top ? 'COMMIT' : 'RELEASE ' + sp); return r; }
        catch (e) { self._depth--; try { self._d.exec(top ? 'ROLLBACK' : 'ROLLBACK TO ' + sp + '; RELEASE ' + sp); } catch (_) {} throw e; }
      };
      wrap.immediate = wrap.deferred = wrap.exclusive = wrap;
      return wrap;
    }
    async backup(dest) { this._d.exec("VACUUM INTO '" + String(dest).replace(/'/g, "''") + "'"); }
    close() { this._d.close(); this.open = false; }
  };
}
module.exports = load();
