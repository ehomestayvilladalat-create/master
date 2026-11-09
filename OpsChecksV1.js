/**
 * OpsChecksV1.js - công cụ KIỂM TRA CHỈ ĐỌC (không ghi gì), chạy tay trong Apps Script.
 */

/**
 * C3 - Ảnh live có lẫn thư mục dev không?
 * - Thư mục cache ảnh dự án này đang dùng (theo Config + Script Property).
 * - Đếm ảnh trong MASTER_VILLA: nằm trong thư mục đó / nằm ở thư mục Drive khác / không phải ảnh Drive.
 * Không tạo thư mục, không đổi quyền, không xóa file.
 */
function checkImageFolderC3() {
  var isolated = BE_CONFIG.IMAGE_DRIVE_ISOLATED === true;
  var propertyKey = String(BE_CONFIG.IMAGE_DRIVE_PROPERTY_KEY ||
    (isolated ? "BE_IMAGE_DRIVE_FOLDER_ID_DEV_V2" : "BE_IMAGE_DRIVE_FOLDER_ID")).trim();
  var configuredId = String(BE_CONFIG.IMAGE_DRIVE_FOLDER_ID || "").trim();
  var savedId = String(PropertiesService.getScriptProperties().getProperty(propertyKey) || "").trim();
  var prodSavedId = String(PropertiesService.getScriptProperties().getProperty("BE_IMAGE_DRIVE_FOLDER_ID") || "").trim();
  var folderId = configuredId || savedId;
  var out = {
    success: true, code: "IMAGE_FOLDER_CHECK_C3",
    configFolderName: String(BE_CONFIG.IMAGE_DRIVE_FOLDER_NAME || ""),
    isolated: isolated, propertyKey: propertyKey, folderId: folderId,
    otherProjectPropertyFolderId: prodSavedId || "",
    folderName: "", filesInFolder: 0, filesCapped: false,
    masterImages: {total: 0, inFolder: 0, otherDriveFolder: 0, notDrive: 0, samplesOtherFolder: []}
  };
  var inFolder = {};
  if (folderId) {
    try {
      var folder = DriveApp.getFolderById(folderId);
      out.folderName = folder.getName();
      var it = folder.getFiles(), n = 0;
      while (it.hasNext() && n < 8000) { inFolder[it.next().getId()] = true; n++; }
      out.filesInFolder = n;
      out.filesCapped = it.hasNext();
    } catch (e) {
      out.success = false;
      out.folderError = String(e && e.message || e);
    }
  } else {
    out.folderError = "Chưa có thư mục cache ảnh (chưa chạy Image Worker lần nào).";
  }
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BE_CONFIG.MASTER_VILLA_SHEET || "MASTER_VILLA");
  if (sh && sh.getLastRow() > 1) {
    var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(normalizeMasterText);
    var col = head.indexOf(normalizeMasterText("ẢNH"));
    if (col >= 0) {
      sh.getRange(2, col + 1, sh.getLastRow() - 1, 1).getDisplayValues().forEach(function(r) {
        var url = String(r[0] || "").trim();
        if (!url) return;
        out.masterImages.total++;
        var m = url.match(/\/d\/([a-zA-Z0-9_-]{20,})/) || url.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
        if (!m) { out.masterImages.notDrive++; return; }
        if (inFolder[m[1]]) out.masterImages.inFolder++;
        else {
          out.masterImages.otherDriveFolder++;
          if (out.masterImages.samplesOtherFolder.length < 10) out.masterImages.samplesOtherFolder.push(url);
        }
      });
    }
  }
  out.verdict = !folderId ? "CHƯA CÓ THƯ MỤC" :
    (out.filesCapped ? "THƯ MỤC QUÁ LỚN, CHỈ ĐẾM 8000 FILE ĐẦU" :
    (out.masterImages.otherDriveFolder === 0 ? "OK: mọi ảnh Drive của MASTER_VILLA nằm trong đúng 1 thư mục cache" :
      "CẦN XEM: có ảnh Drive nằm ngoài thư mục cache (ảnh thay tay hoặc ảnh từ dự án khác)"));
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
