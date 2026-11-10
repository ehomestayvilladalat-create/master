/**
 * SourceXlsxOpen.js (trước đây SourceXlsxOpenV_FIX.js) - đọc nguồn là file Excel .xlsx trên Drive.
 *
 * SpreadsheetApp chỉ mở được Google Sheet gốc, nên nguồn .xlsx (vd Pontus) phải chuyển
 * tạm sang Google Sheet (Drive advanced service v2, convert:true) rồi mới đọc.
 *
 * Review 10/11 mục 10 - bản cũ chuyển đổi LẠI mỗi lần mở (mỗi build, mỗi lượt tìm căn,
 * mỗi lần dựng snapshot): chậm vài giây/lần và mỗi lần thêm 1 file vào thùng rác Drive.
 * Bản này:
 *  1. Google Sheet thường: mở như cũ, không đổi hành vi.
 *  2. Nguồn đã biết là .xlsx: bỏ qua lần thử openByUrl (vốn chắc chắn lỗi).
 *  3. DÙNG LẠI bản tạm nếu file .xlsx gốc chưa đổi (so thời gian sửa trên Drive).
 *     Chỉ chuyển đổi lại khi file gốc đổi hoặc bản tạm mất; bản tạm cũ đưa vào thùng rác.
 *  4. Trong cùng 1 lượt chạy, mỗi nguồn .xlsx chỉ mở 1 lần.
 *  5. Khóa (LockService) khi chuyển đổi để 2 lượt chạy song song không tạo 2 bản tạm.
 * Bản tạm tên "EHOME_TMP_<fileId>", ID lưu ở Script Property XLSX_TMP_V_FIX_<fileId>
 * dạng JSON {tmpId, srcUpdated}. Giá trị cũ (chỉ có tmpId) vẫn đọc được.
 *
 * CHƯA CHẠY THẬT: sau khi push, chạy testXlsxSourceOpenV_FIX() 2 lần trên nguồn pontus.
 * Lần 1: XLSX_SOURCE_CONVERTED_V_FIX (hoặc REUSED). Lần 2 phải là XLSX_SOURCE_TMP_REUSED_V1.
 */

var XLSX_SRC_MIME_V_FIX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
var XLSX_SRC_PROP_PREFIX_V_FIX = "XLSX_TMP_V_FIX_";
var XLSX_OPENED_THIS_RUN_V1_ = {};
var XLSX_KNOWN_IDS_V1_ = null;

/** File ID nào đã biết là nguồn .xlsx (có bản tạm). Đọc danh sách khóa 1 lần mỗi lượt chạy. */
function beIsKnownXlsxSourceV1_(fileId) {
  if (!fileId) return false;
  if (XLSX_KNOWN_IDS_V1_ === null) {
    XLSX_KNOWN_IDS_V1_ = {};
    try {
      (PropertiesService.getScriptProperties().getKeys() || []).forEach(function(k) {
        if (String(k).indexOf(XLSX_SRC_PROP_PREFIX_V_FIX) === 0) XLSX_KNOWN_IDS_V1_[String(k).slice(XLSX_SRC_PROP_PREFIX_V_FIX.length)] = true;
      });
    } catch (ignore) {}
  }
  return !!XLSX_KNOWN_IDS_V1_[fileId];
}

function beExtractDriveFileIdV_FIX(url) {
  var text = String(url || "");
  var m = text.match(/\/(?:spreadsheets\/d|file\/d|document\/d)\/([a-zA-Z0-9_-]+)/);
  if (m && m[1]) return m[1];
  var m2 = text.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m2 ? m2[1] : "";
}

/** Đọc giá trị property: JSON mới {tmpId, srcUpdated} hoặc chuỗi tmpId cũ. */
function beParseXlsxTmpRecordV1_(raw) {
  raw = String(raw || "").trim();
  if (!raw) return null;
  if (raw.charAt(0) === "{") {
    try { var o = JSON.parse(raw); return o && o.tmpId ? {tmpId: String(o.tmpId), srcUpdated: Number(o.srcUpdated || 0)} : null; }
    catch (e) { return null; }
  }
  return {tmpId: raw, srcUpdated: 0};
}

/** Thuần, test được: REUSE khi bản tạm còn và file gốc chưa đổi kể từ lần chuyển đổi. */
function beXlsxTempDecisionV1_(record, srcUpdatedMs, tmpExists) {
  if (!record || !record.tmpId || !tmpExists) return "CONVERT";
  if (!(Number(record.srcUpdated) > 0)) return "CONVERT";
  return Number(srcUpdatedMs || 0) > Number(record.srcUpdated) ? "CONVERT" : "REUSE";
}

/**
 * Mở nguồn theo link. Google Sheet: như SpreadsheetApp.openByUrl. File .xlsx: bản tạm.
 * Ném lại lỗi gốc nếu không phải .xlsx hoặc không đọc được file.
 */
function beOpenSourceSpreadsheetV_FIX(url) {
  var fileId = beExtractDriveFileIdV_FIX(url);
  if (fileId && XLSX_OPENED_THIS_RUN_V1_[fileId]) return XLSX_OPENED_THIS_RUN_V1_[fileId];
  // Đã biết là .xlsx từ lần trước => không thử openByUrl (chắc chắn lỗi, tốn ~1 giây).
  if (beIsKnownXlsxSourceV1_(fileId)) {
    try { return beOpenXlsxAsTempSheetV_FIX_(fileId); } catch (knownXlsxError) { /* thử lại đường thường bên dưới */ }
  }
  try {
    return SpreadsheetApp.openByUrl(url);
  } catch (openError) {
    if (!fileId) throw openError;
    var mime = "";
    try {
      mime = String(DriveApp.getFileById(fileId).getMimeType() || "");
    } catch (driveError) {
      throw openError;
    }
    if (mime !== XLSX_SRC_MIME_V_FIX) throw openError;
    return beOpenXlsxAsTempSheetV_FIX_(fileId);
  }
}

function beOpenXlsxAsTempSheetV_FIX_(fileId) {
  var props = PropertiesService.getScriptProperties();
  var key = XLSX_SRC_PROP_PREFIX_V_FIX + fileId;
  var source = DriveApp.getFileById(fileId);
  if (String(source.getMimeType() || "") !== XLSX_SRC_MIME_V_FIX) throw new Error("NOT_XLSX_SOURCE:" + fileId);
  var srcUpdated = source.getLastUpdated().getTime();

  var record = beParseXlsxTmpRecordV1_(props.getProperty(key));
  var tmpExists = false;
  if (record && record.tmpId) {
    try { tmpExists = !DriveApp.getFileById(record.tmpId).isTrashed(); } catch (e) { tmpExists = false; }
  }
  if (beXlsxTempDecisionV1_(record, srcUpdated, tmpExists) === "REUSE") {
    var reused = SpreadsheetApp.openById(record.tmpId);
    XLSX_OPENED_THIS_RUN_V1_[fileId] = reused;
    Logger.log(JSON.stringify({code: "XLSX_SOURCE_TMP_REUSED_V1", sourceFileId: fileId, tmpId: record.tmpId}));
    return reused;
  }

  var lock = LockService.getScriptLock();
  var locked = false;
  try { locked = lock.tryLock(30000); } catch (ignoreLock) {}
  try {
    // Lượt chạy khác có thể vừa chuyển đổi xong trong lúc chờ khóa.
    var again = beParseXlsxTmpRecordV1_(props.getProperty(key));
    if (again && again.tmpId && (!record || again.tmpId !== record.tmpId)) {
      var fresh = false;
      try { fresh = !DriveApp.getFileById(again.tmpId).isTrashed(); } catch (e2) { fresh = false; }
      if (beXlsxTempDecisionV1_(again, srcUpdated, fresh) === "REUSE") {
        var other = SpreadsheetApp.openById(again.tmpId);
        XLSX_OPENED_THIS_RUN_V1_[fileId] = other;
        return other;
      }
    }
    var blob = source.getBlob();
    var resource = {title: "EHOME_TMP_" + fileId, mimeType: MimeType.GOOGLE_SHEETS};
    var tmp = Drive.Files.insert(resource, blob, {convert: true});
    props.setProperty(key, JSON.stringify({tmpId: tmp.id, srcUpdated: srcUpdated}));
    if (XLSX_KNOWN_IDS_V1_) XLSX_KNOWN_IDS_V1_[fileId] = true;
    if (record && record.tmpId && record.tmpId !== tmp.id) {
      try { DriveApp.getFileById(record.tmpId).setTrashed(true); } catch (e3) { /* bản cũ đã mất thì bỏ qua */ }
    }
    Logger.log(JSON.stringify({code: "XLSX_SOURCE_CONVERTED_V_FIX", sourceFileId: fileId, tmpId: tmp.id,
      reason: !record ? "FIRST_TIME" : (!tmpExists ? "TMP_MISSING" : "SOURCE_CHANGED")}));
    var opened = SpreadsheetApp.openById(tmp.id);
    XLSX_OPENED_THIS_RUN_V1_[fileId] = opened;
    return opened;
  } finally {
    if (locked) { try { lock.releaseLock(); } catch (ignoreRelease) {} }
  }
}

/** Test thủ công: chạy trong Apps Script editor sau khi push, 2 lần. Đọc nguồn "pontus" trong MASTER. */
function testXlsxSourceOpenV_FIX() {
  if (typeof opsFindSourceV312_ !== "function") throw new Error("OPS_SOURCE_HELPER_NOT_AVAILABLE");
  var source = opsFindSourceV312_("pontus");
  if (!source || !source.link) throw new Error("PONTUS_SOURCE_NOT_FOUND");
  var started = new Date().getTime();
  var file = beOpenSourceSpreadsheetV_FIX(source.link);
  var names = file.getSheets().map(function (s) { return s.getName(); });
  var result = {success: true, name: file.getName(), openedId: file.getId(), sheets: names, elapsedMs: new Date().getTime() - started};
  Logger.log(JSON.stringify({code: "XLSX_SOURCE_OPEN_PASS_V_FIX", result: result}));
  return result;
}

/** Test thuần quyết định dùng lại / chuyển đổi bản tạm. */
function testXlsxTempDecisionV1() {
  var cases = [
    [beXlsxTempDecisionV1_(null, 100, false), "CONVERT"],
    [beXlsxTempDecisionV1_({tmpId: "T", srcUpdated: 100}, 100, true), "REUSE"],
    [beXlsxTempDecisionV1_({tmpId: "T", srcUpdated: 100}, 200, true), "CONVERT"],
    [beXlsxTempDecisionV1_({tmpId: "T", srcUpdated: 100}, 100, false), "CONVERT"],
    [beXlsxTempDecisionV1_(beParseXlsxTmpRecordV1_("OLD_TMP_ID"), 100, true), "CONVERT"],
    [JSON.stringify(beParseXlsxTmpRecordV1_('{"tmpId":"A","srcUpdated":5}')), '{"tmpId":"A","srcUpdated":5}']
  ];
  cases.forEach(function(c, i) { if (c[0] !== c[1]) throw new Error("XLSX_TEMP_DECISION_FAIL case " + (i + 1) + ": " + c[0]); });
  var r = {success: true, code: "XLSX_TEMP_DECISION_PASS_V1", cases: cases.length};
  Logger.log(JSON.stringify(r));
  return r;
}
