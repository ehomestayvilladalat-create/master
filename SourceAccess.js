/**
 * EHOME BOOKING - SOURCE ACCESS HANDLER (V1)
 *
 * Phân loại lỗi quyền (NO_ACCESS) vs lỗi tạm thời
 * Quản lý tab NO_ACCESS_SOURCES trong MASTER sheet
 *
 * Quy tắc:
 * - Hệ thống tự thêm dòng khi phát hiện NO_ACCESS thật
 * - Mỗi vòng chỉ update cột G (lastChecked) + H (status)
 * - KHÔNG bao giờ ghi đè cột I (user notes)
 * - Khi có quyền lại: đổi H → "ĐÃ CÓ QUYỀN LẠI", không xoá
 */

var EHOME_SOURCE_ACCESS_V1 = {
  TAB_NAME: "NO_ACCESS_SOURCES",
  MASTER_TAB_NAME: "NÂNG CẤP MASTER",
  STATUS_NO_ACCESS: "NO_ACCESS",
  STATUS_RECOVERED: "ĐÃ CÓ QUYỀN LẠI",
  HEADER_ROW: 1,
  COL_MASTER_ROW: 1,      // A
  COL_ID: 2,              // B
  COL_CITY: 3,            // C
  COL_NAME: 4,            // D
  COL_LINK: 5,            // E
  COL_DETECTED: 6,        // F
  COL_LAST_CHECKED: 7,    // G
  COL_STATUS: 8,          // H
  COL_NOTES: 9            // I
};

/**
 * Phân loại error message → NO_ACCESS | OTHER
 * Nhận diện EN + VI
 */
function saClassifyAccessErrorV1_(message) {
  var msg = String(message || "").toUpperCase();
  // Patterns: permission, access denied, forbidden, 403, no item, không có quyền, quyền truy cập
  if (/PERMISSION|ACCESS DENIED|DO NOT HAVE|FORBIDDEN|403|NO ITEM WITH|COULD NOT BE FOUND|KHÔNG CÓ QUYỀN|QUYỀN TRUY CẬP|KHÔNG TÌM THẤY MỤC/.test(msg)) {
    return EHOME_SOURCE_ACCESS_V1.STATUS_NO_ACCESS;
  }
  return "OTHER";
}


/**
 * Lấy hoặc tạo tab NO_ACCESS_SOURCES
 */
function saGetNoAccessTabV1_() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tab = ss.getSheetByName(EHOME_SOURCE_ACCESS_V1.TAB_NAME);

    if (!tab) {
      // Tạo tab mới
      tab = ss.insertSheet(EHOME_SOURCE_ACCESS_V1.TAB_NAME, ss.getSheets().length);

      // Tạo header
      var headers = [
        "Dòng MASTER",
        "ID (MÃ_CĂN)",
        "Thành phố",
        "Tên nguồn",
        "Link nguồn",
        "Ngày phát hiện",
        "Lần kiểm tra",
        "Trạng thái",
        "Ghi chú"
      ];
      tab.getRange(1, 1, 1, headers.length).setValues([headers]);

      // Format header
      var headerRange = tab.getRange(1, 1, 1, headers.length);
      headerRange.setBackground("#4472C4")
                 .setFontColor("#FFFFFF")
                 .setFontWeight("bold");

      Logger.log("[SourceAccess] Created NO_ACCESS_SOURCES tab");
    }

    saNormalizeNoAccessTabV1_(tab);
    return tab;
  } catch (e) {
    Logger.log("[SourceAccess] Error getting NO_ACCESS tab: " + e.message);
    return null;
  }
}

var saNormalizedThisRunV1_ = false;
var saNoAccessIdsCacheV1_ = null;

function saNoAccessHeadersV1_() {
  return ["Dòng MASTER","ID (MÃ_CĂN)","Thành phố","Tên nguồn","Link nguồn","Ngày phát hiện","Lần kiểm tra","Trạng thái","Ghi chú"];
}

function saTimeOfV1_(v) {
  if (v instanceof Date) return v.getTime();
  var t = Date.parse(String(v || ""));
  return isNaN(t) ? 0 : t;
}

/**
 * Tab cu (khong co dong tieu de, trung dong, cot A = 0) -> chuan hoa 1 lan:
 * - them dong tieu de
 * - gop 1 dong / nguon (theo cot B), giu NGAY PHAT HIEN som nhat, GHI CHU (cot I) cua nguoi dung
 * - dien lai cot A bang dong that trong MASTER
 * Khong xoa du lieu nguoi dung: dong khong co ID van duoc giu nguyen o cuoi.
 */
function saNormalizeNoAccessTabV1_(tab) {
  if (saNormalizedThisRunV1_) return false;
  saNormalizedThisRunV1_ = true;
  try {
    var heads = saNoAccessHeadersV1_();
    var lastRow = tab.getLastRow();
    var firstCell = lastRow >= 1 ? String(tab.getRange(1, 1).getValue() || "").trim() : "";
    if (firstCell === heads[0]) return false; // da dung chuan

    var data = lastRow >= 1 ? tab.getRange(1, 1, lastRow, heads.length).getValues() : [];
    var masterRowById = {};
    try {
      (opsListMasterSourcesV312_(false).sources || []).forEach(function (m) {
        if (m.id) masterRowById[String(m.id)] = m.row;
      });
    } catch (ignoreMaster) {}

    var map = {}, order = [], extras = [];
    data.forEach(function (row) {
      var id = String(row[1] == null ? "" : row[1]).trim();
      if (!id) {
        if (row.join("").trim()) extras.push(row);
        return;
      }
      if (!map[id]) {
        map[id] = row.slice();
        order.push(id);
        return;
      }
      var m = map[id];
      if (saTimeOfV1_(row[5]) && (!saTimeOfV1_(m[5]) || saTimeOfV1_(row[5]) < saTimeOfV1_(m[5]))) m[5] = row[5];
      if (row[6] !== "" && row[6] != null) m[6] = row[6];
      if (row[7]) m[7] = row[7];
      if (!String(m[8] || "").trim() && String(row[8] || "").trim()) m[8] = row[8];
      ["2", "3", "4"].forEach(function (k) { if (!m[Number(k)] && row[Number(k)]) m[Number(k)] = row[Number(k)]; });
    });

    var out = [heads];
    order.forEach(function (id) {
      var r = map[id];
      if (masterRowById[id]) r[0] = masterRowById[id];
      out.push(r);
    });
    extras.forEach(function (r) { out.push(r); });

    tab.clearContents();
    tab.getRange(1, 1, out.length, heads.length).setValues(out);
    tab.getRange(1, 1, 1, heads.length).setBackground("#4472C4").setFontColor("#FFFFFF").setFontWeight("bold");
    Logger.log("[SourceAccess] Chuan hoa tab NO_ACCESS_SOURCES: " + data.length + " dong cu -> " + order.length + " nguon");
    return true;
  } catch (e) {
    Logger.log("[SourceAccess] Loi chuan hoa tab: " + (e && e.message ? e.message : e));
    return false;
  }
}

/**
 * Thêm hoặc cập nhật NO_ACCESS source
 * @param {number} masterRow - Dòng MASTER (1-based)
 * @param {object} source - {id, city, source, link, fileId}
 * @param {string} statusValue - "NO_ACCESS" | "ĐÃ CÓ QUYỀN LẠI"
 */
function saSaveNoAccessSourceV1_(masterRow, source, statusValue) {
  if (!source || !source.id) return false;

  try {
    var tab = saGetNoAccessTabV1_();
    if (!tab) return false;

    var statusToUse = statusValue || EHOME_SOURCE_ACCESS_V1.STATUS_NO_ACCESS;
    var data = tab.getDataRange().getValues();
    var foundRow = -1;

    // Tìm dòng có ID trùng (B: ID), bỏ qua dòng header (i=1)
    // data[0] = header, data[1...] = rows (sheet row 2...)
    for (var i = 1; i < data.length; i++) {
      var rowId = data[i][EHOME_SOURCE_ACCESS_V1.COL_ID - 1];
      if (String(rowId) === String(source.id)) {
        foundRow = i + 1;  // i=1 → sheet row 2, so sheet row = i+1
        break;
      }
    }

    var nowDate = new Date();
    var dateStr = Utilities.formatDate(nowDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
    var timeStr = Utilities.formatDate(nowDate, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss");

    if (foundRow > 0) {
      // Update: cột G (lastChecked) + H (status), KHÔNG I
      if (!Number(data[foundRow - 1][EHOME_SOURCE_ACCESS_V1.COL_MASTER_ROW - 1] || 0) && (masterRow || source.row)) {
        tab.getRange(foundRow, EHOME_SOURCE_ACCESS_V1.COL_MASTER_ROW).setValue(masterRow || Number(source.row));
      }
      tab.getRange(foundRow, EHOME_SOURCE_ACCESS_V1.COL_LAST_CHECKED).setValue(timeStr);
      tab.getRange(foundRow, EHOME_SOURCE_ACCESS_V1.COL_STATUS).setValue(statusToUse);
      Logger.log("[SourceAccess] Updated row " + foundRow + ": " + source.source + " → " + statusToUse);
    } else {
      // Thêm dòng mới (chỉ khi status là NO_ACCESS)
      if (statusToUse === EHOME_SOURCE_ACCESS_V1.STATUS_NO_ACCESS) {
        // Nếu masterRow = 0, lấy từ MASTER sheet
        var actualMasterRow = masterRow || Number(source.row || 0);
        if (!actualMasterRow || actualMasterRow === 0) {
          var master = saGetSourceFromMasterV1_(source.id);
          if (master) {
            actualMasterRow = master.row;
          }
        }

        var newRow = [
          actualMasterRow || 0,  // A: Master row (0 nếu không tìm được)
          source.id,             // B: ID
          source.city || "",     // C: city
          source.source || "",   // D: name
          source.link || "",     // E: link
          dateStr,               // F: detected
          timeStr,               // G: lastChecked
          statusToUse,           // H: status
          ""                     // I: notes (trống)
        ];
        tab.appendRow(newRow);
        Logger.log("[SourceAccess] Added new row: " + source.source + " (masterRow=" + actualMasterRow + ")");
      }
    }

    return true;
  } catch (e) {
    Logger.log("[SourceAccess] Error saving NO_ACCESS source: " + e.message);
    return false;
  }
}

/**
 * Lấy danh sách NO_ACCESS source IDs (để filter search)
 * @return {array} Array of source IDs có status = "NO_ACCESS"
 */
function saGetNoAccessSourceIdsV1_() {
  try {
    var tab = saGetNoAccessTabV1_();
    if (!tab) return [];

    var data = tab.getDataRange().getValues();
    var noAccessIds = [];

    for (var i = 1; i < data.length; i++) {
      var status = String(data[i][EHOME_SOURCE_ACCESS_V1.COL_STATUS - 1] || "");
      if (status === EHOME_SOURCE_ACCESS_V1.STATUS_NO_ACCESS) {
        var id = data[i][EHOME_SOURCE_ACCESS_V1.COL_ID - 1];
        if (id) noAccessIds.push(id);
      }
    }

    return noAccessIds;
  } catch (e) {
    Logger.log("[SourceAccess] Error getting NO_ACCESS IDs: " + e.message);
    return [];
  }
}


/**
 * Đọc source từ MASTER sheet bằng source.id
 * @return {object} {row, id, source, city, link, fileId}
 */
function saGetSourceFromMasterV1_(sourceId) {
  try {
    var list = opsListMasterSourcesV312_(false).sources || [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(sourceId)) {
        return {row: list[i].row, id: list[i].id, source: list[i].source, city: list[i].city, link: list[i].link};
      }
    }
    return null;
  } catch (e) {
    Logger.log("[SourceAccess] Error reading source from MASTER: " + (e && e.message ? e.message : e));
    return null;
  }
}

/**
 * Nguon doc duoc binh thuong. Neu dang nam trong tab o trang thai NO_ACCESS -> doi thanh "DA CO QUYEN LAI".
 * Chi doc tab 1 lan moi lan chay (cache), nen goi cho moi nguon van re.
 */
function saMarkRecoveredIfNeededV1_(source) {
  try {
    if (!source || !source.id) return false;
    if (saNoAccessIdsCacheV1_ === null) {
      saNoAccessIdsCacheV1_ = {};
      saGetNoAccessSourceIdsV1_().forEach(function (id) { saNoAccessIdsCacheV1_[String(id)] = true; });
    }
    if (!saNoAccessIdsCacheV1_[String(source.id)]) return false;
    var ok = saSaveNoAccessSourceV1_(0, source, EHOME_SOURCE_ACCESS_V1.STATUS_RECOVERED);
    if (ok) delete saNoAccessIdsCacheV1_[String(source.id)];
    return ok;
  } catch (e) {
    return false;
  }
}

