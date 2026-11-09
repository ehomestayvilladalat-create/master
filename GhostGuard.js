/**
 * GhostGuard.js - V1 (B1) CHỐNG CĂN ẢO TRONG NGUỒN ĐANG BẬT
 *
 * Vấn đề cũ:
 *   Khi một căn biến mất khỏi nguồn đang Enable=TRUE, beAssessSourceReconcileV416_
 *   chỉ cho gỡ căn khi Structure Snapshot xác nhận. Hai đường xác nhận đều hay tắc:
 *   - V416 bắt parser AUTO phải ra đúng tập tên như CONFIG (FIXED_ROW lệch là tắc);
 *   - V340 xóa cờ _structureConfirmed ngay khi baseline đã nhận danh sách mới.
 *   => source bị khóa "giữ MASTER cũ" mãi, căn ảo tồn tại mãi.
 *
 * Quy tắc mới (chỉ là đường xác nhận BỔ SUNG, không bỏ guard cũ):
 *   1. Parser đọc ra >0 căn, không lỗi (zero/lỗi đã có guard riêng, giữ căn cũ).
 *   2. Cùng một danh sách căn (fingerprint) đọc được 2 lần build liên tiếp.
 *   3. Số căn giảm > 30% trong 1 lần => KHÔNG ẩn gì, báo admin Telegram.
 *   4. Giới hạn số căn bị ẩn trong một lần chạy (MAX_RETIRE_PER_RUN).
 *   5. Mọi quyết định ghi vào tab GHOST_PREVIEW.
 *   Căn bị gỡ khỏi MASTER_VILLA được RETIRE trong VILLA_IDENTITY_V1 (không xóa mã).
 *   Khi căn quay lại, VillaIdentity khôi phục đúng mã cũ (xem REVIVED_RETIRED_V1).
 */

var BE_GHOST_V1 = {
  ENABLED_PROPERTY: "BE_GHOST_GUARD_V1_DISABLED", // đặt "TRUE" để tắt khẩn cấp
  REQUIRED_READS: 2,
  MAX_DROP_RATIO: 0.3,
  MAX_RETIRE_PER_RUN: 40,
  PREVIEW_SHEET: "GHOST_PREVIEW",
  PREVIEW_MAX_ROWS: 1500,
  READ_KEY_PREFIX: "BE_GHOST_READ_V1_",
  ALERT_KEY_PREFIX: "BE_GHOST_ALERT_V1_",
  HEADERS: ["THỜI GIAN", "SOURCE ID", "NGUỒN", "SỐ CĂN CŨ", "SỐ CĂN MỚI",
            "CĂN SẼ ẨN", "SỐ LẦN ĐỌC GIỐNG", "QUYẾT ĐỊNH", "LÝ DO"]
};

// Biến toàn cục reset mỗi lần execution => ngân sách ẩn căn cho một lần chạy.
var BE_GHOST_RUN_BUDGET_V1 = {used: 0};

function beGhostGuardDisabledV1_() {
  try {
    return PropertiesService.getScriptProperties()
      .getProperty(BE_GHOST_V1.ENABLED_PROPERTY) === "TRUE";
  } catch (e) { return false; }
}

function beGhostFingerprintV1_(currentSet, currentCount) {
  var names = Object.keys(currentSet || {}).sort();
  var raw = String(currentCount) + "::" + names.join("|");
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw, Utilities.Charset.UTF_8);
  return bytes.map(function(b){ return ((b + 256) % 256).toString(16); }).join("");
}

function beGhostSourceKeyV1_(options) {
  var id = String(options.sourceId || "").trim();
  if (id) return "ID_" + id;
  return "SRC_" + normalizeMasterText(options.source || "").replace(/\s+/g, "_").slice(0, 60);
}

/**
 * Pure decision (không I/O) - để test được.
 * state: {fp, reads} của lần trước. Trả về quyết định và state mới.
 */
function beGhostDecideV1_(input) {
  var prevCount = Number(input.previousCount || 0);
  var curCount = Number(input.currentCount || 0);
  var missing = input.missingNames || [];
  var state = input.state || {};
  var budgetLeft = Number(input.budgetLeft == null ? BE_GHOST_V1.MAX_RETIRE_PER_RUN : input.budgetLeft);

  if (curCount <= 0) return {allow: false, reason: "ZERO_OR_ERROR_KEEP_OLD", reads: 0, newState: null};

  var drop = prevCount > 0 ? (prevCount - curCount) / prevCount : 0;
  if (drop > BE_GHOST_V1.MAX_DROP_RATIO) {
    return {allow: false, reason: "DROP_OVER_30_PERCENT", reads: 0, alert: true, drop: drop,
            newState: {fp: "", reads: 0}};
  }

  var reads = state.fp === input.fingerprint ? Number(state.reads || 0) + 1 : 1;
  var newState = {fp: input.fingerprint, reads: reads};
  if (reads < BE_GHOST_V1.REQUIRED_READS) {
    return {allow: false, reason: "WAIT_SECOND_READ", reads: reads, newState: newState};
  }
  if (missing.length > budgetLeft) {
    return {allow: false, reason: "RUN_BUDGET_EXCEEDED", reads: reads, newState: newState};
  }
  return {allow: true, reason: "GHOST_STABLE_READS", reads: reads, newState: null};
}

/**
 * Gọi từ beAssessSourceReconcileV416_ khi guard cũ chặn. Trả null nếu không cho phép.
 */
function beGhostStableReadConfirmV1_(options, currentSet, previousCount, currentCount, missingNames) {
  if (beGhostGuardDisabledV1_()) return null;
  var props = PropertiesService.getScriptProperties();
  var key = BE_GHOST_V1.READ_KEY_PREFIX + beGhostSourceKeyV1_(options);
  var state = {};
  try { state = JSON.parse(props.getProperty(key) || "{}") || {}; } catch (e) { state = {}; }

  var fp = beGhostFingerprintV1_(currentSet, currentCount);
  var d = beGhostDecideV1_({
    previousCount: previousCount, currentCount: currentCount, missingNames: missingNames,
    fingerprint: fp, state: state,
    budgetLeft: BE_GHOST_V1.MAX_RETIRE_PER_RUN - BE_GHOST_RUN_BUDGET_V1.used
  });

  try {
    if (d.newState) props.setProperty(key, JSON.stringify(d.newState));
    else props.deleteProperty(key);
  } catch (ignoreProp) {}

  if (d.allow) BE_GHOST_RUN_BUDGET_V1.used += (missingNames || []).length;
  if (d.alert) beGhostAlertV1_(options, previousCount, currentCount, fp);

  beGhostPreviewLogV1_(options, previousCount, currentCount, missingNames, d);
  Logger.log(JSON.stringify({
    code: "GHOST_GUARD_V1", sourceId: String(options.sourceId || ""), source: String(options.source || ""),
    previousCount: previousCount, currentCount: currentCount, missing: missingNames,
    reads: d.reads, allow: d.allow, reason: d.reason
  }));
  return d.allow ? {reads: d.reads} : null;
}

function beGhostPreviewLogV1_(options, previousCount, currentCount, missingNames, d) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(BE_GHOST_V1.PREVIEW_SHEET);
    if (!sh) {
      sh = ss.insertSheet(BE_GHOST_V1.PREVIEW_SHEET);
      sh.getRange(1, 1, 1, BE_GHOST_V1.HEADERS.length).setValues([BE_GHOST_V1.HEADERS]);
      sh.setFrozenRows(1);
    }
    var label = d.allow ? "ẨN (RETIRED)" : (d.alert ? "CHẶN + BÁO ADMIN" : "CHỜ");
    sh.appendRow([new Date(), String(options.sourceId || ""), String(options.source || ""),
      previousCount, currentCount, (missingNames || []).join(" | "), d.reads, label, d.reason]);
    var extra = sh.getLastRow() - 1 - BE_GHOST_V1.PREVIEW_MAX_ROWS;
    if (extra > 0) sh.deleteRows(2, extra);
  } catch (e) {
    Logger.log(JSON.stringify({level: "WARNING", code: "GHOST_PREVIEW_WRITE_FAILED_V1", error: String(e && e.message || e)}));
  }
}

function beGhostAlertV1_(options, previousCount, currentCount, fp) {
  try {
    var props = PropertiesService.getScriptProperties();
    var akey = BE_GHOST_V1.ALERT_KEY_PREFIX + beGhostSourceKeyV1_(options);
    if (props.getProperty(akey) === fp) return; // đã báo cho đúng tình trạng này
    props.setProperty(akey, fp);
    if (typeof sendTelegramMessageV31_ !== "function" || typeof tgPropertyV315_ !== "function") return;
    var chat = tgPropertyV315_("TELEGRAM_ADMIN_CHAT_ID");
    if (!chat) return;
    sendTelegramMessageV31_(chat,
      "⚠️ Nguồn \"" + (options.source || "") + "\" (ID " + (options.sourceId || "?") + ") giảm số căn bất thường: " +
      previousCount + " → " + currentCount + ".\nHệ thống KHÔNG ẩn căn nào, giữ MASTER cũ. Vui lòng kiểm tra file nguồn/cấu hình.");
  } catch (e) {
    Logger.log(JSON.stringify({level: "WARNING", code: "GHOST_ALERT_FAILED_V1", error: String(e && e.message || e)}));
  }
}

/** Test thuần (không đụng sheet). Chạy trong Apps Script: testGhostGuardV1() */
function testGhostGuardV1() {
  var cases = [
    ["lần đọc đầu phải chờ", beGhostDecideV1_({previousCount: 5, currentCount: 4, missingNames: ["a"], fingerprint: "X", state: {}}).reason, "WAIT_SECOND_READ"],
    ["lần 2 giống nhau => ẩn", beGhostDecideV1_({previousCount: 5, currentCount: 4, missingNames: ["a"], fingerprint: "X", state: {fp: "X", reads: 1}}).allow, true],
    ["lần 2 khác => đếm lại", beGhostDecideV1_({previousCount: 5, currentCount: 4, missingNames: ["a"], fingerprint: "Y", state: {fp: "X", reads: 1}}).reads, 1],
    ["giảm >30% => chặn", beGhostDecideV1_({previousCount: 10, currentCount: 6, missingNames: ["a","b","c","d"], fingerprint: "X", state: {fp: "X", reads: 5}}).reason, "DROP_OVER_30_PERCENT"],
    ["giảm đúng 30% => cho", beGhostDecideV1_({previousCount: 10, currentCount: 7, missingNames: ["a","b","c"], fingerprint: "X", state: {fp: "X", reads: 1}}).allow, true],
    ["0 căn => giữ cũ", beGhostDecideV1_({previousCount: 5, currentCount: 0, missingNames: [], fingerprint: "X", state: {fp: "X", reads: 3}}).allow, false],
    ["hết ngân sách", beGhostDecideV1_({previousCount: 5, currentCount: 4, missingNames: ["a","b"], fingerprint: "X", state: {fp: "X", reads: 1}, budgetLeft: 1}).reason, "RUN_BUDGET_EXCEEDED"]
  ];
  cases.forEach(function(c){ if (c[1] !== c[2]) throw new Error("GHOST_GUARD_TEST_FAIL: " + c[0] + " got=" + c[1]); });
  var result = {success: true, code: "GHOST_GUARD_TEST_PASS_V1", cases: cases.length};
  Logger.log(JSON.stringify(result));
  return result;
}
