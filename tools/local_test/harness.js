// Usage: TZ=Asia/Ho_Chi_Minh node harness.js <codeDir> [testNameRegex] [--json out.json]
const fs = require('fs'), vm = require('vm'), path = require('path'), crypto = require('crypto');
const dir = process.argv[2];
const filter = process.argv[3] && !process.argv[3].startsWith('--') ? new RegExp(process.argv[3]) : null;
const outIdx = process.argv.indexOf('--json');
const outFile = outIdx > 0 ? process.argv[outIdx + 1] : null;

const files = fs.readdirSync(dir).filter(f => (f.endsWith('.js') || f.endsWith('.gs')) && !f.startsWith('.')).sort();
const sources = files.map(f => [f, fs.readFileSync(path.join(dir, f), 'utf8')]);

class LiveServiceError extends Error { constructor(n) { super('NEEDS_LIVE_SERVICE:' + n); this.code = 'NEEDS_LIVE'; } }
function liveOnly(name) {
  return new Proxy({}, { get(_, p) { if (p === Symbol.toPrimitive || p === 'toString') return () => '[' + name + ']'; throw new LiveServiceError(name + '.' + String(p)); } });
}
function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
function formatDate(d, tz, fmt) {
  d = new Date(d);
  // Node runs with TZ=Asia/Ho_Chi_Minh, the same as the script time zone.
  const map = { yyyy: d.getFullYear(), yy: pad(d.getFullYear() % 100, 2), MM: pad(d.getMonth() + 1, 2), M: d.getMonth() + 1, dd: pad(d.getDate(), 2), d: d.getDate(), HH: pad(d.getHours(), 2), H: d.getHours(), mm: pad(d.getMinutes(), 2), ss: pad(d.getSeconds(), 2), SSS: pad(d.getMilliseconds(), 3), EEE: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()], u: d.getDay() === 0 ? 7 : d.getDay(), Z: '+0700', XXX: '+07:00' };
  let out = '', i = 0; fmt = String(fmt);
  while (i < fmt.length) {
    if (fmt[i] === "'") { const j = fmt.indexOf("'", i + 1); out += fmt.slice(i + 1, j < 0 ? fmt.length : j); i = j < 0 ? fmt.length : j + 1; continue; }
    let hit = null; for (const k of ['yyyy','SSS','XXX','EEE','yy','MM','dd','HH','mm','ss','M','d','H','u','Z']) if (fmt.startsWith(k, i)) { hit = k; break; }
    if (hit) { out += map[hit]; i += hit.length; } else { out += fmt[i++]; }
  }
  return out;
}
function makeContext() {
  const props = {}, logs = [];
  const store = (o) => ({ getProperty: k => Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null, setProperty(k, v) { o[k] = String(v); return this; }, deleteProperty(k) { delete o[k]; return this; }, getProperties: () => Object.assign({}, o), setProperties(m) { Object.keys(m).forEach(k => o[k] = String(m[k])); return this; }, getKeys: () => Object.keys(o), deleteAllProperties() { Object.keys(o).forEach(k => delete o[k]); return this; } });
  const cache = (o) => ({ get: k => o[k] == null ? null : o[k], put(k, v) { o[k] = String(v); }, remove(k) { delete o[k]; }, getAll: ks => { const r = {}; ks.forEach(k => { if (o[k] != null) r[k] = o[k]; }); return r; }, putAll(m) { Object.keys(m).forEach(k => o[k] = String(m[k])); }, removeAll(ks) { ks.forEach(k => delete o[k]); } });
  const scriptProps = store(props), userProps = store({}), docProps = store({});
  const sc = cache({}), uc = cache({}), dc = cache({});
  const lock = { tryLock: () => true, waitLock: () => {}, releaseLock: () => {}, hasLock: () => true };
  const ctx = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    Logger: { log: (x) => { logs.push(typeof x === 'string' ? x : String(x)); }, getLog: () => logs.join('\n'), clear: () => { logs.length = 0; } },
    PropertiesService: { getScriptProperties: () => scriptProps, getUserProperties: () => userProps, getDocumentProperties: () => docProps },
    CacheService: { getScriptCache: () => sc, getUserCache: () => uc, getDocumentCache: () => dc },
    LockService: { getScriptLock: () => lock, getUserLock: () => lock, getDocumentLock: () => lock },
    Session: { getScriptTimeZone: () => 'Asia/Ho_Chi_Minh', getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => '' }), getTemporaryActiveUserKey: () => 'k' },
    Utilities: {
      DigestAlgorithm: { MD5: 'md5', SHA_1: 'sha1', SHA_256: 'sha256', SHA_512: 'sha512' },
      Charset: { UTF_8: 'utf8', US_ASCII: 'ascii' },
      computeDigest: (alg, s) => [...crypto.createHash(alg || 'md5').update(typeof s === 'string' ? Buffer.from(s, 'utf8') : Buffer.from(s)).digest()].map(x => x > 127 ? x - 256 : x),
      computeHmacSha256Signature: (v, k) => [...crypto.createHmac('sha256', k).update(v).digest()].map(x => x > 127 ? x - 256 : x),
      formatDate, sleep() {}, getUuid: () => crypto.randomUUID(),
      base64Encode: (s) => Buffer.from(typeof s === 'string' ? s : Buffer.from(s.map(x => (x + 256) % 256))).toString('base64'),
      base64EncodeWebSafe: (s) => Buffer.from(typeof s === 'string' ? s : Buffer.from(s.map(x => (x + 256) % 256))).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64Decode: (s) => [...Buffer.from(s, 'base64')].map(x => x > 127 ? x - 256 : x),
      newBlob: () => { throw new LiveServiceError('Utilities.newBlob'); },
      parseCsv: (s) => s.split(/\r?\n/).map(l => l.split(',')),
      jsonStringify: JSON.stringify, jsonParse: JSON.parse
    },
    SpreadsheetApp: liveOnly('SpreadsheetApp'), DriveApp: liveOnly('DriveApp'), Drive: liveOnly('Drive'),
    UrlFetchApp: liveOnly('UrlFetchApp'), ScriptApp: liveOnly('ScriptApp'), HtmlService: liveOnly('HtmlService'),
    ContentService: liveOnly('ContentService'), MailApp: liveOnly('MailApp'), GmailApp: liveOnly('GmailApp'),
    CalendarApp: liveOnly('CalendarApp'), DocumentApp: liveOnly('DocumentApp'), Browser: liveOnly('Browser'),
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const loadErrors = [];
  for (const [f, src] of sources) {
    try { vm.runInContext(src, ctx, { filename: f, timeout: 20000 }); }
    catch (e) { loadErrors.push(f + ': ' + (e && e.message)); }
  }
  return { ctx, props, logs, loadErrors };
}
// enumerate test function names (top-level)
const testNames = [];
for (const [f, src] of sources) {
  const re = /^function\s+(test[A-Za-z0-9_$]*)\s*\(/gm; let m;
  while ((m = re.exec(src))) if (!filter || filter.test(m[1])) testNames.push([f, m[1]]);
}
const results = {};
let first = makeContext();
if (first.loadErrors.length) console.log('LOAD ERRORS:', first.loadErrors);
for (const [f, name] of testNames) {
  const { ctx } = makeContext();
  let status, detail = '';
  try {
    ctx.__fn = name;
    const r = vm.runInContext(name + '()', ctx, { timeout: 20000 });
    status = 'PASS';
    try { detail = JSON.stringify(r); } catch (e) { detail = String(r); }
    if (r && r.success === false) status = 'RETURNED_FALSE';
  } catch (e) {
    const msg = String(e && e.message || e);
    if (msg.indexOf('NEEDS_LIVE_SERVICE') >= 0) { status = 'NEEDS_LIVE'; detail = msg.slice(0, 120); }
    else { status = 'FAIL'; detail = msg.slice(0, 400); }
  }
  results[name] = { file: f, status, detail: (detail || '').slice(0, 400) };
}
const counts = {};
Object.values(results).forEach(r => counts[r.status] = (counts[r.status] || 0) + 1);
console.log(JSON.stringify(counts));
if (outFile) fs.writeFileSync(outFile, JSON.stringify(results, null, 1));
else Object.entries(results).forEach(([n, r]) => console.log(r.status.padEnd(14), n, r.status === 'PASS' ? '' : r.detail.slice(0, 160)));
