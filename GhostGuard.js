/**
 * GhostGuard.js - V1 (B1) CHỐNG CĂN ẢO TRONG NGUỒN ĐANG BẬT
 *
 * Vấn đề cũ:
 *   Khi một căn biến mất khỏi nguồn đang Enable=TRUE, beAssessSourceReconcileV416_
 *   chỉ cho gỡ căn khi Structure Snapshot xác nhận. Hai đường xác nhận đều hay tắc:
 *   - V416 bắt parser AUTO phải ra đúng tập tên như CONFIG (FIXED_ROW lệch là tắc);
 *   - V340 xóa cờ _structureConfirmed ngay khi baseline đã nhận danh sách mới.
 *   => source bị khóa "giữ MASTER cũ" mãi, căn ảo tồn tại mãi, và cả source
 *      cũng không nhận được căn mới.
 *
 * Quy tắc mới (đường xác nhận BỔ SUNG, guard cũ vẫn chạy trước):
 *   1. Parser đọc ra >0 căn, không lỗi. Nguồn đọc 0 căn/lỗi đã có guard riêng
 *      trong buildMasterVilla: giữ căn cũ.
 *   2. Cùng một danh sách căn (fingerprint) đọc được ở 2 lần build LIÊN TIẾP
 *      (cách nhau tối đa STALE_HOURS) mới được gỡ.
 *   3. Số căn giảm > 30% trong 1 lần đọc: KHÔNG gỡ gì, báo admin Telegram 1 lần.
 *      Admin kiểm tra xong có thể duyệt bằng ghostApproveSourceV1("<ID nguồn>").
 *   4. Giới hạn tổng số căn bị gỡ trong một lần build (MAX_RETIRE_PER_RUN).
 *   5. Mọi quyết định ghi vào tab GHOST_PREVIEW (ghi theo lô cuối build).
 *   Căn bị gỡ khỏi MASTER_VILLA được RETIRE trong VILLA_IDENTITY_V1 (không xóa mã).
 *   Căn quay lại được khôi phục đúng mã cũ (VillaIdentity: REVIVED_RETIRED_V1).
 *
 * Hiệu năng: chỉ 1 lần getProperties() mỗi build; ghi Properties/Sheet/Telegram
 * gom lại ở beGhostFlushV1_() sau khi MASTER_VILLA publish thành công.
 */

var BE_GHOST_V1 = {
  DISABLE_PROPERTY: "BE_GHOST_GUARD_V1_DISABLED", // đặt "TRUE" để tắt khẩn cấp
  REQUIRED_READS: 2,
  MAX_DROP_RATIO: 0.3,
  // Quy tắc 30% chỉ áp dụng khi mất >= 2 căn trong 1 lần đọc. Nguồn nhỏ (2-3 căn)
  // bỏ 1 căn là chuyện bình thường, vẫn phải qua 2 lần đọc giống nhau.
  MIN_LOST_FOR_DROP_RULE: 2,
  MAX_RETIRE_PER_RUN: 40,
  STALE_HOURS: 72,
  PREVIEW_SHEET: "GHOST_PREVIEW",
  PREVIEW_MAX_ROWS: 1500,
  READ_KEY_PREFIX: "BE_GHOST_READ_V1_",
  ALERT_KEY_PREFIX: "BE_GHOST_ALERT_V1_",
  APPROVE_KEY_PREFIX: "BE_GHOST_APPROVE_V1_",
  HEADERS: ["THỜI GIAN", "SOURCE ID", "NGUỒN", "SỐ CĂN TRƯỚC", "SỐ CĂN ĐỌC ĐƯỢC",
            "CĂN SẼ ẨN / ĐÃ ẨN", "SỐ LẦN ĐỌC GIỐNG", "QUYẾT ĐỊNH", "LÝ DO"]
};

// Trạng thái của một lần build. Biến toàn cục reset mỗi execution;
// buildMasterVilla gọi beGhostBeginRunV1_() để reset khi build nhiều lần trong 1 execution.
var BE_GHOST_RUN_V1 = null;

function beGhostBeginRunV1_() {
  BE_GHOST_RUN_V1 = {loaded: false, props: {}, set: {}, del: {}, preview: [], alerts: [], used: 0};
  return BE_GHOST_RUN_V1;
}

function beGhostRunV1_() {
  if (!BE_GHOST_RUN_V1) beGhostBeginRunV1_();
  var run = BE_GHOST_RUN_V1;
  if (!run.loaded) {
    run.loaded = true;
    try {
      var all = PropertiesService.getScriptProperties().getProperties() || {};
      Object.keys(all).forEach(function(k) {
        if (k.indexOf("BE_GHOST_") === 0) run.props[k] = all[k];
      });
    } catch (e) {
      run.props = {};
    }
  }
  return run;
}

function beGhostGetV1_(run, key) {
  if (run.del[key]) return null;
  if (Object.prototype.hasOwnProperty.call(run.set, key)) return run.set[key];
  return Object.prototype.hasOwnProperty.call(run.props, key) ? run.props[key] : null;
}

function beGhostPutV1_(run, key, value) {
  delete run.del[key];
  run.set[key] = String(value);
}

function beGhostDeleteV1_(run, key) {
  if (beGhostGetV1_(run, key) === null) return;
  delete run.set[key];
  run.del[key] = true;
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
  return bytes.map(function(b) { var v = b < 0 ? b + 256 : b; return ("0" + v.toString(16)).slice(-2); }).join("");
}

function beGhostSourceKeyV1_(sourceId, source) {
  var id = String(sourceId || "").trim();
  if (id) return "ID_" + id.replace(/[^A-Za-z0-9_-]/g, "_");
  return "SRC_" + normalizeMasterText(source || "").replace(/[^a-z0-9]+/g, "_").slice(0, 60);
}

/**
 * Quyết định thuần (không I/O) để test được.
 * input: previousCount, currentCount, missingNames, fingerprint, state {fp,reads,at},
 *        nowMs, budgetLeft, approved.
 */
function beGhostDecideV1_(input) {
  var prevCount = Number(input.previousCount || 0);
  var curCount = Number(input.currentCount || 0);
  var missing = input.missingNames || [];
  var state = input.state || {};
  var nowMs = Number(input.nowMs || new Date().getTime());
  var budgetLeft = Number(input.budgetLeft == null ? BE_GHOST_V1.MAX_RETIRE_PER_RUN : input.budgetLeft);

  if (curCount <= 0) {
    return {allow: false, reason: "ZERO_OR_ERROR_KEEP_OLD", reads: 0, newState: null};
  }

  var fresh = Number(state.at || 0) > 0 && (nowMs - Number(state.at)) <= BE_GHOST_V1.STALE_HOURS * 3600000;
  var reads = (state.fp === input.fingerprint && fresh) ? Number(state.reads || 0) + 1 : 1;
  var newState = {fp: input.fingerprint, reads: reads, at: nowMs};
  var lost = prevCount - curCount;
  var drop = prevCount > 0 ? lost / prevCount : 0;

  if (lost >= BE_GHOST_V1.MIN_LOST_FOR_DROP_RULE && drop > BE_GHOST_V1.MAX_DROP_RATIO + 1e-9 && input.approved !== true) {
    return {allow: false, reason: "DROP_OVER_30_PERCENT", reads: reads, alert: true, drop: drop, newState: newState};
  }
  if (reads < BE_GHOST_V1.REQUIRED_READS) {
    return {allow: false, reason: "WAIT_SECOND_READ", reads: reads, newState: newState};
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
  var readKey = BE_GHOST_V1.READ_KEY_PREFIX + skey;
  var approveKey = BE_GHOST_V1.APPROVE_KEY_PREFIX + skey;

  var state = {};
  try { state = JSON.parse(beGhostGetV1_(run, readKey) || "{}") || {}; } catch (e) { state = {}; }
  var fp = beGhostFingerprintV1_(currentSet, currentCount);
  var approved = beGhostGetV1_(run, approveKey) === "TRUE";

  var d = beGhostDecideV1_({
    previousCount: previousCount, currentCount: currentCount, missingNames: missingNames,
    fingerprint: fp, state: state, nowMs: new Date().getTime(),
    budgetLeft: BE_GHOST_V1.MAX_RETIRE_PER_RUN - run.used, approved: approved
  });

  if (d.newState) beGhostPutV1_(run, readKey, JSON.stringify(d.newState));
  else beGhostDeleteV1_(run, readKey);
  if (d.allow) run.used += (missingNames || []).length;
  if (d.consumeApproval) beGhostDeleteV1_(run, approveKey);
  if (d.alert) {
    var alertKey = BE_GHOST_V1.ALERT_KEY_PREFIX + skey;
    if (beGhostGetV1_(run, alertKey) !== fp) {
      beGhostPutV1_(run, alertKey, fp);
      run.alerts.push({sourceId: String(options.sourceId || ""), source: String(options.source || ""),
        previousCount: previousCount, currentCount: currentCount, missing: (missingNames || []).slice(0, 15)});
    }
  }

  var label = d.allow ? "ẨN (RETIRED)" : (d.alert ? "CHẶN - CHỜ ADMIN DUYỆT" : "CHỜ LẦN ĐỌC SAU");
  run.preview.push([new Date(), String(options.sourceId || ""), String(options.source || ""),
    previousCount, currentCount, (missingNames || []).join(" | ").slice(0, 45000), d.reads, label, d.reason]);

  Logger.log(JSON.stringify({
    code: "GHOST_GUARD_V1", sourceId: String(options.sourceId || ""), source: String(options.source || ""),
    previousCount: previousCount, currentCount: currentCount, missing: missingNames,
    reads: d.reads, allow: d.allow, reason: d.reason
  }));
  return d.allow ? {reads: d.reads} : null;
}

/** Gọi 1 lần cuối buildMasterVilla, sau khi MASTER_VILLA đã publish thành công. */
function beGhostFlushV1_() {
  var run = BE_GHOST_RUN_V1;
  if (!run) return {success: true, changed: false};
  var out = {success: true, setKeys: Object.keys(run.set).length, delKeys: Object.keys(run.del).length,
             preview: run.preview.length, alerts: run.alerts.length};
  try {
    var props = PropertiesService.getScriptProperties();
    if (out.setKeys) props.setProperties(run.set, false);
    Object.keys(run.del).forEach(function(k) { try { props.deleteProperty(k); } catch (ignore) {} });
  } catch (e) {
    out.success = false;
    out.propsError = String(e && e.message || e);
  }
  if (run.preview.length) {
    try { beGhostWritePreviewV1_(run.preview); }
    catch (e2) { out.previewError = String(e2 && e2.message || e2); }
  }
  run.alerts.forEach(function(a) { beGhostSendAlertV1_(a); });
  Logger.log(JSON.stringify({code: "GHOST_GUARD_FLUSH_V1", result: out}));
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
      "Nếu đúng là nguồn đã bỏ các căn này: chạy ghostApproveSourceV1(\"" + a.sourceId + "\") trong Apps Script, " +
      "hai lần build sau sẽ ẩn chúng (mã căn vẫn được giữ).");
  } catch (e) {
    Logger.log(JSON.stringify({level: "WARNING", code: "GHOST_ALERT_FAILED_V1", error: String(e && e.message || e)}));
  }
}

/** Admin duyệt cho một nguồn giảm >30% số căn được ẩn căn (một lần). */
function ghostApproveSourceV1(sourceId) {
  var id = String(sourceId || "").trim();
  if (!id) throw new Error("Cần truyền ID nguồn trong MASTER, ví dụ ghostApproveSourceV1(\"117\")");
  var key = BE_GHOST_V1.APPROVE_KEY_PREFIX + beGhostSourceKeyV1_(id, "");
  PropertiesService.getScriptProperties().setProperty(key, "TRUE");
  var result = {success: true, code: "GHOST_SOURCE_APPROVED_V1", sourceId: id,
    note: "Lần build tiếp theo đọc ổn định 2 lần sẽ ẩn căn đã biến mất của nguồn này."};
  Logger.log(JSON.stringify(result));
  return result;
}

/** Xem trạng thái chờ hiện tại của mọi nguồn (không thay đổi gì). */
function ghostStatusV1() {
  var all = PropertiesService.getScriptProperties().getProperties() || {};
  var rows = Object.keys(all).filter(function(k) { return k.indexOf("BE_GHOST_") === 0; }).sort()
    .map(function(k) { return k + " = " + all[k]; });
  var result = {success: true, code: "GHOST_STATUS_V1", count: rows.length, rows: rows};
  Logger.log(JSON.stringify(result));
  return result;
}

/** Test thuần (không đụng sheet). Chạy trong Apps Script: testGhostGuardV1() */
function testGhostGuardV1() {
  var now = 1800000000000, hour = 3600000;
  function d(o) {
    var base = {previousCount: 5, currentCount: 4, missingNames: ["a"], fingerprint: "X", state: {}, nowMs: now};
    Object.keys(o).forEach(function(k) { base[k] = o[k]; });
    return beGhostDecideV1_(base);
  }
  var cases = [
    ["lần đọc đầu phải chờ", d({}).reason, "WAIT_SECOND_READ"],
    ["lần 2 giống nhau => ẩn", d({state: {fp: "X", reads: 1, at: now - hour}}).allow, true],
    ["lần 2 khác danh sách => đếm lại từ 1", d({fingerprint: "Y", state: {fp: "X", reads: 1, at: now - hour}}).reads, 1],
    ["lần đọc trước quá cũ => đếm lại", d({state: {fp: "X", reads: 1, at: now - 80 * hour}}).reads, 1],
    ["giảm >30% => chặn", d({previousCount: 10, currentCount: 6, missingNames: ["a","b","c","d"], state: {fp: "X", reads: 5, at: now}}).reason, "DROP_OVER_30_PERCENT"],
    ["giảm >30% vẫn đếm số lần đọc", d({previousCount: 10, currentCount: 6, state: {fp: "X", reads: 1, at: now}}).reads, 2],
    ["giảm >30% đã duyệt + đọc ổn định => ẩn", d({previousCount: 10, currentCount: 6, approved: true, state: {fp: "X", reads: 1, at: now}}).allow, true],
    ["giảm >30% đã duyệt nhưng mới đọc 1 lần => chờ", d({previousCount: 10, currentCount: 6, approved: true}).reason, "WAIT_SECOND_READ"],
    ["nguồn 3 căn mất 1 (33%) => không coi là giảm bất thường", d({previousCount: 3, currentCount: 2, state: {fp: "X", reads: 1, at: now}}).allow, true],
    ["nguồn 3 căn mất 2 => chặn", d({previousCount: 3, currentCount: 1, missingNames: ["a","b"], state: {fp: "X", reads: 1, at: now}}).reason, "DROP_OVER_30_PERCENT"],
    ["giảm đúng 30% => được", d({previousCount: 10, currentCount: 7, missingNames: ["a","b","c"], state: {fp: "X", reads: 1, at: now}}).allow, true],
    ["0 căn => giữ cũ", d({currentCount: 0, missingNames: [], state: {fp: "X", reads: 3, at: now}}).allow, false],
    ["hết ngân sách => chờ", d({missingNames: ["a","b"], state: {fp: "X", reads: 1, at: now}, budgetLeft: 1}).reason, "RUN_BUDGET_EXCEEDED"]
  ];
  cases.forEach(function(c) { if (c[1] !== c[2]) throw new Error("GHOST_GUARD_TEST_FAIL: " + c[0] + " got=" + c[1]); });
  var result = {success: true, code: "GHOST_GUARD_TEST_PASS_V1", cases: cases.length};
  Logger.log(JSON.stringify(result));
  return result;
}
