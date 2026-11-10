/**
 * GhostGuard.js - V2 (B1) CHỐNG CĂN ẢO TRONG NGUỒN ĐANG BẬT
 *
 * Vấn đề cũ:
 *   Khi một căn biến mất khỏi nguồn đang Enable=TRUE, beAssessSourceReconcileV416_
 *   chỉ cho gỡ căn khi Structure Snapshot xác nhận. Hai đường xác nhận đều hay tắc:
 *   - V416 bắt parser AUTO phải ra đúng tập tên như CONFIG (FIXED_ROW lệch là tắc);
 *   - V340 xóa cờ _structureConfirmed ngay khi baseline đã nhận danh sách mới.
 *   => source bị khóa "giữ MASTER cũ" mãi, căn ảo tồn tại mãi, và cả source
 *      cũng không nhận được căn mới.
 *
 * Quy tắc (đường xác nhận BỔ SUNG, guard cũ vẫn chạy trước):
 *   1. Parser đọc ra >0 căn, không lỗi. Nguồn đọc 0 căn/lỗi đã có guard riêng
 *      trong buildMasterVilla: giữ căn cũ.
 *   2. Cùng một danh sách căn (fingerprint) phải được đọc ở 2 thời điểm CÁCH NHAU
 *      ÍT NHẤT MIN_GAP_HOURS (mặc định 6 giờ, đổi bằng Script Property
 *      BE_GHOST_MIN_GAP_HOURS). Các lần build dày trong khoảng đó không được tính thêm,
 *      nên một lần đọc lỗi kéo dài vài phút không thể làm ẩn căn.
 *      Nếu không thấy lại danh sách đó trong STALE_HOURS (72 giờ) thì đếm lại từ đầu.
 *   3. Số căn giảm > 30% VÀ mất >= 2 căn trong 1 lần đọc: KHÔNG gỡ gì, báo Telegram
 *      1 lần. Admin kiểm tra xong duyệt bằng ghostApproveSourceV1("<ID nguồn>").
 *   4. Giới hạn tổng số căn bị gỡ trong một lần build (MAX_RETIRE_PER_RUN).
 *   5. Mọi quyết định ghi vào tab GHOST_PREVIEW (ghi theo lô cuối build).
 *   Căn bị gỡ khỏi MASTER_VILLA được RETIRE trong VILLA_IDENTITY_V1 (không xóa mã).
 *   Căn quay lại được khôi phục đúng mã cũ (VillaIdentity: REVIVED_RETIRED_V1).
 *
 * Lưu trạng thái (review 10/11 mục 8): TOÀN BỘ nằm trong 1 Script Property
 * BE_GHOST_STATE_V2 (JSON), tự dọn mục cũ, tối đa ~8 KB. Các khóa kiểu cũ
 * BE_GHOST_READ_V1_* / BE_GHOST_ALERT_V1_* / BE_GHOST_APPROVE_V1_* được chuyển vào
 * rồi xóa ở lần build đầu tiên. ghostStatusV1() cho biết số lượng.
 *
 * Hiệu năng: 1 lần đọc property mỗi build; ghi Properties/Sheet/Telegram gom lại ở
 * beGhostFlushV1_() sau khi MASTER_VILLA publish thành công.
 */

var BE_GHOST_V1 = {
  DISABLE_PROPERTY: "BE_GHOST_GUARD_V1_DISABLED", // đặt "TRUE" để tắt khẩn cấp
  STATE_PROPERTY: "BE_GHOST_STATE_V2",
  MIN_GAP_PROPERTY: "BE_GHOST_MIN_GAP_HOURS",
  DEFAULT_MIN_GAP_HOURS: 6,
  REQUIRED_READS: 2,
  MAX_DROP_RATIO: 0.3,
  // Quy tắc 30% chỉ áp dụng khi mất >= 2 căn trong 1 lần đọc. Nguồn nhỏ (2-3 căn)
  // bỏ 1 căn là chuyện bình thường, vẫn phải qua 2 lần đọc cách nhau đủ giờ.
  MIN_LOST_FOR_DROP_RULE: 2,
  MAX_RETIRE_PER_RUN: 40,
  STALE_HOURS: 72,
  APPROVAL_DAYS: 7,
  MAX_STATE_CHARS: 8000,
  PREVIEW_SHEET: "GHOST_PREVIEW",
  PREVIEW_MAX_ROWS: 1500,
  LEGACY_PREFIXES: ["BE_GHOST_READ_V1_", "BE_GHOST_ALERT_V1_", "BE_GHOST_APPROVE_V1_"],
  HEADERS: ["THỜI GIAN", "SOURCE ID", "NGUỒN", "SỐ CĂN TRƯỚC", "SỐ CĂN ĐỌC ĐƯỢC",
            "CĂN SẼ ẨN / ĐÃ ẨN", "SỐ LẦN ĐỌC GIỐNG", "QUYẾT ĐỊNH", "LÝ DO"]
};

// Trạng thái của một lần build. buildMasterVilla gọi beGhostBeginRunV1_() mỗi lần build.
var BE_GHOST_RUN_V1 = null;

function beGhostBeginRunV1_() {
  BE_GHOST_RUN_V1 = {loaded: false, state: {}, dirty: false, legacyKeys: [], preview: [], alerts: [], used: 0, minGapHours: null};
  return BE_GHOST_RUN_V1;
}

function beGhostMinGapHoursV1_(props) {
  var raw = "";
  try { raw = String((props || PropertiesService.getScriptProperties()).getProperty(BE_GHOST_V1.MIN_GAP_PROPERTY) || "").trim(); } catch (e) {}
  var n = Number(raw);
  return raw !== "" && isFinite(n) && n >= 0 ? n : BE_GHOST_V1.DEFAULT_MIN_GAP_HOURS;
}

/** Đọc trạng thái (1 property) + chuyển khóa kiểu cũ. Thuần với tham số props để test. */
function beGhostLoadStateV1_(props) {
  var state = {};
  try { state = JSON.parse(props.getProperty(BE_GHOST_V1.STATE_PROPERTY) || "{}") || {}; } catch (e) { state = {}; }
  if (!state || typeof state !== "object" || Array.isArray(state)) state = {};
  var legacy = [];
  try {
    (props.getKeys() || []).forEach(function(k) {
      BE_GHOST_V1.LEGACY_PREFIXES.forEach(function(prefix) {
        if (String(k).indexOf(prefix) !== 0) return;
        legacy.push(k);
        var skey = String(k).slice(prefix.length);
        var entry = state[skey] = state[skey] || {};
        var value = props.getProperty(k);
        if (prefix === "BE_GHOST_READ_V1_") {
          try { var o = JSON.parse(value || "{}"); if (o && o.fp && !entry.fp) { entry.fp = o.fp; entry.r = Number(o.reads || 1); entry.c = Number(o.at || 0); entry.a = Number(o.at || 0); } } catch (ignore) {}
        } else if (prefix === "BE_GHOST_ALERT_V1_") {
          if (value && !entry.al) entry.al = value;
        } else if (value === "TRUE" && !entry.ap) {
          entry.ap = new Date().getTime();
        }
      });
    });
  } catch (ignoreKeys) {}
  return {state: state, legacyKeys: legacy};
}

function beGhostRunV1_() {
  if (!BE_GHOST_RUN_V1) beGhostBeginRunV1_();
  var run = BE_GHOST_RUN_V1;
  if (!run.loaded) {
    run.loaded = true;
    try {
      var props = PropertiesService.getScriptProperties();
      var loaded = beGhostLoadStateV1_(props);
      run.state = loaded.state;
      run.legacyKeys = loaded.legacyKeys;
      if (run.legacyKeys.length) run.dirty = true;
      run.minGapHours = beGhostMinGapHoursV1_(props);
    } catch (e) {
      run.state = {};
      run.minGapHours = BE_GHOST_V1.DEFAULT_MIN_GAP_HOURS;
    }
  }
  return run;
}

/** Dọn mục hết hạn và giới hạn kích thước. Thuần, test được. */
function beGhostPruneStateV1_(state, nowMs) {
  var staleMs = BE_GHOST_V1.STALE_HOURS * 3600000;
  var approvalMs = BE_GHOST_V1.APPROVAL_DAYS * 86400000;
  var removed = 0;
  Object.keys(state || {}).forEach(function(k) {
    var e = state[k] || {};
    if (e.ap && nowMs - Number(e.ap) > approvalMs) { delete e.ap; }
    var seen = Math.max(Number(e.a || 0), Number(e.c || 0));
    var hasRead = !!e.fp && seen > 0 && nowMs - seen <= staleMs;
    if (!hasRead) { delete e.fp; delete e.r; delete e.c; delete e.a; }
    // Cảnh báo giữ 30 ngày để không báo lại cùng một tình trạng.
    if (e.al && e.alAt && nowMs - Number(e.alAt) > 30 * 86400000) { delete e.al; delete e.alAt; }
    if (!e.fp && !e.ap && !e.al) { delete state[k]; removed++; }
  });
  // Giới hạn kích thước: bỏ mục ít gặp gần đây nhất trước.
  var keys = Object.keys(state);
  while (JSON.stringify(state).length > BE_GHOST_V1.MAX_STATE_CHARS && keys.length) {
    keys.sort(function(a, b) { return Number(state[a].a || state[a].alAt || 0) - Number(state[b].a || state[b].alAt || 0); });
    delete state[keys.shift()];
    removed++;
  }
  return removed;
}

function beGhostGuardDisabledV1_() {
  try {
    return PropertiesService.getScriptProperties()
      .getProperty(BE_GHOST_V1.DISABLE_PROPERTY) === "TRUE";
  } catch (e) { return false; }
}

function beGhostFingerprintV1_(currentSet, currentCount) {
  var names = Object.keys(currentSet || {}).sort();
  var raw = String(currentCount) + "::" + names.join("|");
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw, Utilities.Charset.UTF_8);
  return bytes.map(function(b) { var v = b < 0 ? b + 256 : b; return ("0" + v.toString(16)).slice(-2); }).join("").slice(0, 16);
}

function beGhostSourceKeyV1_(sourceId, source) {
  var id = String(sourceId || "").trim();
  if (id) return "ID_" + id.replace(/[^A-Za-z0-9_-]/g, "_");
  return "SRC_" + normalizeMasterText(source || "").replace(/[^a-z0-9]+/g, "_").slice(0, 60);
}

/**
 * Quyết định thuần (không I/O) để test được.
 * input: previousCount, currentCount, missingNames, fingerprint,
 *        state {fp, reads, countedAt, at}, nowMs, budgetLeft, approved, minGapHours.
 */
function beGhostDecideV1_(input) {
  var prevCount = Number(input.previousCount || 0);
  var curCount = Number(input.currentCount || 0);
  var missing = input.missingNames || [];
  var state = input.state || {};
  var nowMs = Number(input.nowMs || new Date().getTime());
  var gapMs = Number(input.minGapHours == null ? BE_GHOST_V1.DEFAULT_MIN_GAP_HOURS : input.minGapHours) * 3600000;
  var budgetLeft = Number(input.budgetLeft == null ? BE_GHOST_V1.MAX_RETIRE_PER_RUN : input.budgetLeft);

  if (curCount <= 0) {
    return {allow: false, reason: "ZERO_OR_ERROR_KEEP_OLD", reads: 0, newState: null};
  }

  var lastSeen = Number(state.at || 0);
  var fresh = lastSeen > 0 && (nowMs - lastSeen) <= BE_GHOST_V1.STALE_HOURS * 3600000;
  var reads, countedAt, gapWait = false;
  if (state.fp === input.fingerprint && fresh) {
    var lastCounted = Number(state.countedAt || lastSeen);
    if (nowMs - lastCounted >= gapMs) { reads = Number(state.reads || 1) + 1; countedAt = nowMs; }
    else { reads = Number(state.reads || 1); countedAt = lastCounted; gapWait = true; }
  } else {
    reads = 1; countedAt = nowMs;
  }
  var newState = {fp: input.fingerprint, reads: reads, countedAt: countedAt, at: nowMs};
  var lost = prevCount - curCount;
  var drop = prevCount > 0 ? lost / prevCount : 0;

  if (lost >= BE_GHOST_V1.MIN_LOST_FOR_DROP_RULE && drop > BE_GHOST_V1.MAX_DROP_RATIO + 1e-9 && input.approved !== true) {
    return {allow: false, reason: "DROP_OVER_30_PERCENT", reads: reads, alert: true, drop: drop, newState: newState};
  }
  if (reads < BE_GHOST_V1.REQUIRED_READS) {
    return {allow: false, reason: gapWait ? "WAIT_MIN_GAP_HOURS" : "WAIT_SECOND_READ", reads: reads, newState: newState,
      readyAt: countedAt + gapMs};
  }
  if (missing.length > budgetLeft) {
    return {allow: false, reason: "RUN_BUDGET_EXCEEDED", reads: reads, newState: newState};
  }
  return {allow: true, reason: input.approved === true ? "ADMIN_APPROVED_STABLE_READS" : "GHOST_STABLE_READS",
          reads: reads, newState: null, consumeApproval: input.approved === true};
}

/**
 * Gọi từ beAssessSourceReconcileV416_ khi guard cũ chặn việc gỡ căn.
 * Trả {reads} nếu cho phép gỡ, null nếu chưa.
 */
function beGhostStableReadConfirmV1_(options, currentSet, previousCount, currentCount, missingNames) {
  if (beGhostGuardDisabledV1_()) return null;
  options = options || {};
  var run = beGhostRunV1_();
  var skey = beGhostSourceKeyV1_(options.sourceId, options.source);
  var entry = run.state[skey] || {};
  var nowMs = new Date().getTime();
  var fp = beGhostFingerprintV1_(currentSet, currentCount);

  var d = beGhostDecideV1_({
    previousCount: previousCount, currentCount: currentCount, missingNames: missingNames,
    fingerprint: fp, state: {fp: entry.fp, reads: entry.r, countedAt: entry.c, at: entry.a}, nowMs: nowMs,
    budgetLeft: BE_GHOST_V1.MAX_RETIRE_PER_RUN - run.used, approved: !!entry.ap,
    minGapHours: run.minGapHours
  });

  if (d.newState) { entry.fp = d.newState.fp; entry.r = d.newState.reads; entry.c = d.newState.countedAt; entry.a = d.newState.at; }
  else { delete entry.fp; delete entry.r; delete entry.c; delete entry.a; }
  if (d.allow) run.used += (missingNames || []).length;
  if (d.consumeApproval) delete entry.ap;
  if (d.alert && entry.al !== fp) {
    entry.al = fp; entry.alAt = nowMs;
    run.alerts.push({sourceId: String(options.sourceId || ""), source: String(options.source || ""),
      previousCount: previousCount, currentCount: currentCount, missing: (missingNames || []).slice(0, 15)});
  }
  run.state[skey] = entry;
  run.dirty = true;

  var label = d.allow ? "ẨN (RETIRED)" : (d.alert ? "CHẶN - CHỜ ADMIN DUYỆT" : "CHỜ LẦN ĐỌC SAU");
  var reasonText = d.reason;
  if (d.reason === "WAIT_MIN_GAP_HOURS" || d.reason === "WAIT_SECOND_READ") {
    reasonText += " (đọc lại sau " + (typeof aiFormatTimeV1_ === "function" ? aiFormatTimeV1_(d.readyAt) : new Date(d.readyAt).toISOString()) + ")";
  }
  run.preview.push([new Date(), String(options.sourceId || ""), String(options.source || ""),
    previousCount, currentCount, (missingNames || []).join(" | ").slice(0, 45000), d.reads, label, reasonText]);

  Logger.log(JSON.stringify({
    code: "GHOST_GUARD_V2", sourceId: String(options.sourceId || ""), source: String(options.source || ""),
    previousCount: previousCount, currentCount: currentCount, missing: missingNames,
    reads: d.reads, allow: d.allow, reason: d.reason, minGapHours: run.minGapHours
  }));
  return d.allow ? {reads: d.reads} : null;
}

/** Gọi 1 lần cuối buildMasterVilla, sau khi MASTER_VILLA đã publish thành công. */
function beGhostFlushV1_() {
  var run = BE_GHOST_RUN_V1;
  if (!run) return {success: true, changed: false};
  var out = {success: true, entries: 0, pruned: 0, legacyDeleted: 0, preview: run.preview.length, alerts: run.alerts.length};
  try {
    var props = PropertiesService.getScriptProperties();
    if (run.loaded && run.dirty) {
      out.pruned = beGhostPruneStateV1_(run.state, new Date().getTime());
      out.entries = Object.keys(run.state).length;
      if (out.entries) props.setProperty(BE_GHOST_V1.STATE_PROPERTY, JSON.stringify(run.state));
      else props.deleteProperty(BE_GHOST_V1.STATE_PROPERTY);
      run.legacyKeys.forEach(function(k) { try { props.deleteProperty(k); out.legacyDeleted++; } catch (ignore) {} });
    }
  } catch (e) {
    out.success = false;
    out.propsError = String(e && e.message || e);
  }
  if (run.preview.length) {
    try { beGhostWritePreviewV1_(run.preview); }
    catch (e2) { out.previewError = String(e2 && e2.message || e2); }
  }
  run.alerts.forEach(function(a) { beGhostSendAlertV1_(a); });
  Logger.log(JSON.stringify({code: "GHOST_GUARD_FLUSH_V2", result: out}));
  BE_GHOST_RUN_V1 = null;
  return out;
}

function beGhostWritePreviewV1_(rows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(BE_GHOST_V1.PREVIEW_SHEET);
  var width = BE_GHOST_V1.HEADERS.length;
  if (!sh) {
    sh = ss.insertSheet(BE_GHOST_V1.PREVIEW_SHEET);
    sh.getRange(1, 1, 1, width).setValues([BE_GHOST_V1.HEADERS]);
    sh.setFrozenRows(1);
  }
  // Mới nhất nằm trên cùng.
  sh.insertRowsBefore(2, rows.length);
  sh.getRange(2, 1, rows.length, width).setValues(rows);
  var extra = sh.getLastRow() - 1 - BE_GHOST_V1.PREVIEW_MAX_ROWS;
  if (extra > 0) sh.deleteRows(BE_GHOST_V1.PREVIEW_MAX_ROWS + 2, extra);
}

function beGhostSendAlertV1_(a) {
  try {
    if (typeof sendTelegramMessageV31_ !== "function" || typeof tgPropertyV315_ !== "function") return;
    var chat = tgPropertyV315_("TELEGRAM_ADMIN_CHAT_ID");
    if (!chat) return;
    sendTelegramMessageV31_(chat,
      "⚠️ Nguồn \"" + a.source + "\" (ID " + (a.sourceId || "?") + ") giảm số căn bất thường: " +
      a.previousCount + " → " + a.currentCount + ".\n" +
      "Căn không còn thấy: " + (a.missing.join(", ") || "-") + "\n" +
      "Hệ thống KHÔNG ẩn căn nào và giữ MASTER cũ.\n" +
      "Nếu đúng là nguồn đã bỏ các căn này: chạy ghostApproveSourceV1(\"" + a.sourceId + "\") trong Apps Script; " +
      "các căn sẽ được ẩn sau 2 lần đọc giống nhau (mã căn vẫn được giữ).");
  } catch (e) {
    Logger.log(JSON.stringify({level: "WARNING", code: "GHOST_ALERT_FAILED_V1", error: String(e && e.message || e)}));
  }
}

/** Đọc-sửa-ghi trạng thái ngoài lúc build (có khóa). */
function beGhostMutateStateV1_(fn) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try { locked = lock.tryLock(20000); } catch (ignore) {}
  try {
    var props = PropertiesService.getScriptProperties();
    var loaded = beGhostLoadStateV1_(props);
    var result = fn(loaded.state);
    beGhostPruneStateV1_(loaded.state, new Date().getTime());
    if (Object.keys(loaded.state).length) props.setProperty(BE_GHOST_V1.STATE_PROPERTY, JSON.stringify(loaded.state));
    else props.deleteProperty(BE_GHOST_V1.STATE_PROPERTY);
    loaded.legacyKeys.forEach(function(k) { try { props.deleteProperty(k); } catch (ignore2) {} });
    return result;
  } finally {
    if (locked) { try { lock.releaseLock(); } catch (ignore3) {} }
  }
}

/** Admin duyệt cho một nguồn giảm >30% số căn được ẩn căn (dùng 1 lần, hết hạn sau 7 ngày). */
function ghostApproveSourceV1(sourceId) {
  var id = String(sourceId || "").trim();
  if (!id) throw new Error("Cần truyền ID nguồn trong MASTER, ví dụ ghostApproveSourceV1(\"117\")");
  var skey = beGhostSourceKeyV1_(id, "");
  beGhostMutateStateV1_(function(state) {
    var e = state[skey] = state[skey] || {};
    e.ap = new Date().getTime();
  });
  var result = {success: true, code: "GHOST_SOURCE_APPROVED_V2", sourceId: id,
    note: "Các căn biến mất của nguồn này sẽ được ẩn sau 2 lần đọc giống nhau cách nhau đủ " +
      beGhostMinGapHoursV1_() + " giờ. Duyệt hết hạn sau " + BE_GHOST_V1.APPROVAL_DAYS + " ngày."};
  Logger.log(JSON.stringify(result));
  return result;
}

/** Xem trạng thái chờ hiện tại (không thay đổi gì) + số Script Property đang dùng. */
function ghostStatusV1() {
  var props = PropertiesService.getScriptProperties();
  var keys = props.getKeys() || [];
  var raw = props.getProperty(BE_GHOST_V1.STATE_PROPERTY) || "{}";
  var state = {};
  try { state = JSON.parse(raw) || {}; } catch (e) { state = {}; }
  var legacy = keys.filter(function(k) {
    return BE_GHOST_V1.LEGACY_PREFIXES.some(function(p) { return String(k).indexOf(p) === 0; });
  });
  var fmt = function(ms) { return ms ? (typeof aiFormatTimeV1_ === "function" ? aiFormatTimeV1_(ms) : new Date(Number(ms)).toISOString()) : ""; };
  var result = {
    success: true, code: "GHOST_STATUS_V2",
    scriptPropertiesTotal: keys.length,
    ghostStateBytes: raw.length, ghostStateMaxBytes: BE_GHOST_V1.MAX_STATE_CHARS,
    legacyGhostKeys: legacy.length,
    minGapHours: beGhostMinGapHoursV1_(props),
    sources: Object.keys(state).sort().map(function(k) {
      var e = state[k] || {};
      return {source: k, reads: Number(e.r || 0), lastCounted: fmt(e.c), lastSeen: fmt(e.a),
        approved: !!e.ap, alerted: !!e.al};
    })
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/** Test thuần (không đụng sheet). Chạy trong Apps Script: testGhostGuardV1() */
function testGhostGuardV1() {
  var now = 1800000000000, hour = 3600000;
  function d(o) {
    var base = {previousCount: 5, currentCount: 4, missingNames: ["a"], fingerprint: "X", state: {}, nowMs: now, minGapHours: 6};
    Object.keys(o).forEach(function(k) { base[k] = o[k]; });
    return beGhostDecideV1_(base);
  }
  var cases = [
    ["lần đọc đầu phải chờ", d({}).reason, "WAIT_SECOND_READ"],
    ["lần 2 cách 7 giờ, giống nhau => ẩn", d({state: {fp: "X", reads: 1, countedAt: now - 7 * hour, at: now - 7 * hour}}).allow, true],
    ["lần 2 chỉ cách 10 phút => KHÔNG ẩn", d({state: {fp: "X", reads: 1, countedAt: now - hour / 6, at: now - hour / 6}}).reason, "WAIT_MIN_GAP_HOURS"],
    ["nhiều lần build dày trong 6 giờ vẫn chỉ tính 1 lần đọc", d({state: {fp: "X", reads: 1, countedAt: now - 5 * hour, at: now - hour / 6}}).reads, 1],
    ["khoảng cách cấu hình 0 giờ => như cũ", d({minGapHours: 0, state: {fp: "X", reads: 1, countedAt: now - 60000, at: now - 60000}}).allow, true],
    ["lần 2 khác danh sách => đếm lại từ 1", d({fingerprint: "Y", state: {fp: "X", reads: 1, countedAt: now - 7 * hour, at: now - 7 * hour}}).reads, 1],
    ["không thấy lại quá 72 giờ => đếm lại", d({state: {fp: "X", reads: 1, countedAt: now - 80 * hour, at: now - 80 * hour}}).reads, 1],
    ["giảm >30% => chặn", d({previousCount: 10, currentCount: 6, missingNames: ["a", "b", "c", "d"], state: {fp: "X", reads: 5, countedAt: now - 7 * hour, at: now - hour}}).reason, "DROP_OVER_30_PERCENT"],
    ["giảm >30% đã duyệt + đọc đủ => ẩn", d({previousCount: 10, currentCount: 6, approved: true, state: {fp: "X", reads: 1, countedAt: now - 7 * hour, at: now - 7 * hour}}).allow, true],
    ["giảm >30% đã duyệt nhưng mới đọc 1 lần => chờ", d({previousCount: 10, currentCount: 6, approved: true}).reason, "WAIT_SECOND_READ"],
    ["nguồn 3 căn mất 1 (33%) => không coi là bất thường", d({previousCount: 3, currentCount: 2, state: {fp: "X", reads: 1, countedAt: now - 7 * hour, at: now - 7 * hour}}).allow, true],
    ["nguồn 3 căn mất 2 => chặn", d({previousCount: 3, currentCount: 1, missingNames: ["a", "b"], state: {fp: "X", reads: 1, countedAt: now - 7 * hour, at: now}}).reason, "DROP_OVER_30_PERCENT"],
    ["0 căn => giữ cũ", d({currentCount: 0, missingNames: [], state: {fp: "X", reads: 3, countedAt: now - 7 * hour, at: now}}).allow, false],
    ["hết ngân sách => chờ", d({missingNames: ["a", "b"], state: {fp: "X", reads: 1, countedAt: now - 7 * hour, at: now - 7 * hour}, budgetLeft: 1}).reason, "RUN_BUDGET_EXCEEDED"]
  ];
  cases.forEach(function(c) { if (c[1] !== c[2]) throw new Error("GHOST_GUARD_TEST_FAIL: " + c[0] + " got=" + c[1]); });

  // Dọn trạng thái: mục cũ hơn 72 giờ bị bỏ, duyệt hết hạn sau 7 ngày, giữ giới hạn kích thước.
  var st = {A: {fp: "X", r: 1, c: now - 80 * hour, a: now - 80 * hour}, B: {fp: "Y", r: 1, c: now - hour, a: now - hour},
    C: {ap: now - 8 * 86400000}, D: {ap: now - 86400000}};
  beGhostPruneStateV1_(st, now);
  if (st.A || !st.B || st.C || !st.D) throw new Error("GHOST_GUARD_TEST_FAIL: dọn trạng thái sai " + JSON.stringify(st));
  var big = {};
  for (var i = 0; i < 400; i++) big["ID_" + i] = {fp: "abcdef0123456789", r: 1, c: now - i * 1000, a: now - i * 1000};
  beGhostPruneStateV1_(big, now);
  if (JSON.stringify(big).length > BE_GHOST_V1.MAX_STATE_CHARS || !big.ID_0) throw new Error("GHOST_GUARD_TEST_FAIL: giới hạn kích thước sai");

  // Chuyển khóa kiểu cũ vào 1 property.
  var store = {"BE_GHOST_READ_V1_ID_9": JSON.stringify({fp: "Z", reads: 1, at: now}), "BE_GHOST_APPROVE_V1_ID_9": "TRUE", "OTHER": "x"};
  var fake = {getProperty: function(k) { return store[k] === undefined ? null : store[k]; }, getKeys: function() { return Object.keys(store); }};
  var loaded = beGhostLoadStateV1_(fake);
  if (loaded.legacyKeys.length !== 2 || loaded.state.ID_9.fp !== "Z" || !loaded.state.ID_9.ap) throw new Error("GHOST_GUARD_TEST_FAIL: chuyển khóa cũ sai");

  var result = {success: true, code: "GHOST_GUARD_TEST_PASS_V2", cases: cases.length + 3};
  Logger.log(JSON.stringify(result));
  return result;
}
