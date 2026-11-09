/**
 * SourceXlsxOpenV_FIX.js — FIX (24/10, đợt bổ sung)
 *
 * Mục đích: cho phép app đọc nguồn là file Excel .xlsx đang nằm trên Drive.
 * SpreadsheetApp.openByUrl chỉ mở được Google Sheet gốc, nên trước đây nguồn .xlsx
 * (ví dụ Pontus) lỗi khi đọc.
 *
 * Cách làm:
 *  1. Vẫn thử SpreadsheetApp.openByUrl trước. Google Sheet không đổi hành vi.
 *  2. Chỉ khi mở lỗi VÀ file thật sự là .xlsx: convert tạm sang Google Sheet
 *     (Drive advanced service v2, insert + convert:true), rồi mở bản tạm.
 *  3. Mỗi nguồn chỉ giữ 1 bản tạm. Lần convert sau sẽ xóa bản tạm cũ.
 *     ID bản tạm lưu trong Script Properties theo key XLSX_TMP_V_FIX_<fileId>.
 *  4. Bản tạm tên "EHOME_TMP_<fileId>" nằm trong Drive của tài khoản chạy script.
 *
 * Yêu cầu: appsscript.json có enabledAdvancedServices Drive v2 (đã thêm trong bản này).
 * Rủi ro: lần convert đầu tiên chưa chạy thật trên Apps Script, cần chạy
 * testXlsxSourceOpenV_FIX() sau khi push để xác nhận.
 */

var XLSX_SRC_MIME_V_FIX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
var XLSX_SRC_PROP_PREFIX_V_FIX = "XLSX_TMP_V_FIX_";

function beExtractDriveFileIdV_FIX(url) {
  var text = String(url || "");
  var m = text.match(/\/(?:spreadsheets\/d|file\/d|document\/d)\/([a-zA-Z0-9_-]+)/);
  if (m && m[1]) return m[1];
  var m2 = text.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m2 ? m2[1] : "";
}

/**
 * Mở nguồn theo link. Giống SpreadsheetApp.openByUrl, nhưng nếu file là .xlsx thì convert tạm.
 * Ném lại lỗi gốc nếu không phải .xlsx hoặc không đọc được file.
 */
function beOpenSourceSpreadsheetV_FIX(url) {
  try {
    return SpreadsheetApp.openByUrl(url);
  } catch (openError) {
    var fileId = beExtractDriveFileIdV_FIX(url);
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

  var oldTmpId = props.getProperty(key);
  if (oldTmpId) {
    try { DriveApp.getFileById(oldTmpId).setTrashed(true); } catch (e) { /* bản cũ đã mất thì bỏ qua */ }
  }

  var blob = DriveApp.getFileById(fileId).getBlob();
  var resource = { title: "EHOME_TMP_" + fileId, mimeType: MimeType.GOOGLE_SHEETS };
  var tmp = Drive.Files.insert(resource, blob, { convert: true });

  props.setProperty(key, tmp.id);
  Logger.log(JSON.stringify({ code: "XLSX_SOURCE_CONVERTED_V_FIX", sourceFileId: fileId, tmpId: tmp.id }));
  return SpreadsheetApp.openById(tmp.id);
}

/** Test thủ công: chạy trong Apps Script editor sau khi push. Đọc nguồn "pontus" trong MASTER. */
function testXlsxSourceOpenV_FIX() {
  if (typeof opsFindSourceV312_ !== "function") throw new Error("OPS_SOURCE_HELPER_NOT_AVAILABLE");
  var source = opsFindSourceV312_("pontus");
  if (!source || !source.link) throw new Error("PONTUS_SOURCE_NOT_FOUND");
  var file = beOpenSourceSpreadsheetV_FIX(source.link);
  var names = file.getSheets().map(function (s) { return s.getName(); });
  var result = { success: true, name: file.getName(), openedId: file.getId(), sheets: names };
  Logger.log(JSON.stringify({ code: "XLSX_SOURCE_OPEN_PASS_V_FIX", result: result }));
  return result;
}
