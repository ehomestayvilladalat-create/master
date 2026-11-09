/**
 * EHOME BOOKING - AUDIT NGUỒN BỊ ACCESS DENIED (V1)
 *
 * CHỈ ĐỌC. Không ghi sheet, không đổi quyền Drive/Sheet, không gửi Telegram,
 * không sửa Booking Engine. Mỗi file nguồn chỉ thử đúng 1 lần (không retry).
 *
 * Cách chạy: Apps Script -> chọn hàm auditNoAccessSourcesV1 -> Run
 * Kết quả: xem Execution log (mỗi nguồn lỗi 1 dòng) và object trả về.
 *
 * "row" = số dòng của nguồn trong tab MASTER (lấy từ opsListMasterSourcesV312_).
 */

var EHOME_AUDIT_ACCESS_V1 = {
  MAX_RUNTIME_MS: 270000
};

/** Nhận diện lỗi quyền (EN + VI). Không phân loại được => OTHER (không coi là mất quyền). */
function auditClassifyAccessErrorV1_(message) {
  var msg = String(message || "");
  if (/permission|access denied|do not have access|you do not have|forbidden|\b403\b|no item with the given id|could not be found|không có quyền|quyền truy cập|không tìm thấy mục/i.test(msg)) {
    return "NO_ACCESS";
  }
  return "OTHER";
}

function auditExtractFileIdV1_(link) {
  var m = String(link || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m && m[1] ? m[1] : "";
}

/** Thử 1 lần. Trả {ok, status, error}. */
function auditProbeFileV1_(fileId) {
  try {
    DriveApp.getFileById(fileId).getLastUpdated();
    return { ok: true, status: "OK", error: "" };
  } catch (e1) {
    var m1 = String(e1 && e1.message ? e1.message : e1);
    var c1 = auditClassifyAccessErrorV1_(m1);
    if (c1 === "NO_ACCESS") {
      // Thử thêm mở trực tiếp bằng SpreadsheetApp để chắc chắn (1 lần, không retry).
      try {
        SpreadsheetApp.openById(fileId).getSheets();
        return { ok: true, status: "OK", error: "" };
      } catch (e2) {
        var m2 = String(e2 && e2.message ? e2.message : e2);
        return { ok: false, status: auditClassifyAccessErrorV1_(m2), error: m2 };
      }
    }
    return { ok: false, status: c1, error: m1 };
  }
}

/**
 * Hàm chính. Trả về:
 * { scannedSources, scannedFiles, noAccess:[...], other:[...], badLink:[...], partial }
 * Mỗi phần tử: {row, id, source, city, link, fileId, error}
 */
function auditNoAccessSourcesV1() {
  var started = new Date().getTime();
  var list = opsListMasterSourcesV312_(true);
  var sources = (list && list.sources) || [];

  var byFile = {};
  var order = [];
  var badLink = [];

  sources.forEach(function (s) {
    var fileId = auditExtractFileIdV1_(s.link);
    var item = { row: s.row, id: s.id, source: s.source, city: s.city, link: s.link, fileId: fileId, error: "" };
    if (!fileId) {
      item.error = "LINK_KHONG_CO_FILE_ID";
      badLink.push(item);
      return;
    }
    if (!byFile[fileId]) { byFile[fileId] = []; order.push(fileId); }
    byFile[fileId].push(item);
  });

  var noAccess = [];
  var other = [];
  var scannedFiles = 0;
  var partial = false;

  for (var i = 0; i < order.length; i++) {
    if (new Date().getTime() - started > EHOME_AUDIT_ACCESS_V1.MAX_RUNTIME_MS) { partial = true; break; }
    var fileId = order[i];
    var probe = auditProbeFileV1_(fileId); // đúng 1 lần / file
    scannedFiles++;
    if (probe.ok) continue;
    byFile[fileId].forEach(function (item) {
      var copy = { row: item.row, id: item.id, source: item.source, city: item.city, link: item.link, fileId: item.fileId, error: probe.error };
      if (probe.status === "NO_ACCESS") noAccess.push(copy);
      else other.push(copy);
    });
  }

  var byRow = function (a, b) { return Number(a.row) - Number(b.row); };
  noAccess.sort(byRow); other.sort(byRow); badLink.sort(byRow);

  noAccess.forEach(function (x) {
    Logger.log("NO_ACCESS | MASTER dòng " + x.row + " | ID " + x.id + " | " + x.city + " | " + x.source + " | " + x.link);
  });
  other.forEach(function (x) {
    Logger.log("LỖI KHÁC (có thể tạm thời) | MASTER dòng " + x.row + " | ID " + x.id + " | " + x.source + " | " + x.error);
  });
  badLink.forEach(function (x) {
    Logger.log("LINK HỎNG | MASTER dòng " + x.row + " | ID " + x.id + " | " + x.source);
  });

  var result = {
    scannedSources: sources.length,
    scannedFiles: scannedFiles,
    noAccessCount: noAccess.length,
    noAccess: noAccess,
    other: other,
    badLink: badLink,
    partial: partial
  };
  Logger.log(JSON.stringify({
    code: "AUDIT_NO_ACCESS_DONE_V1",
    scannedSources: result.scannedSources,
    scannedFiles: result.scannedFiles,
    noAccess: noAccess.length,
    other: other.length,
    badLink: badLink.length,
    partial: partial
  }));
  return result;
}
