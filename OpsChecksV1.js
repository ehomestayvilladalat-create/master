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

/**
 * Review 10/11 mục 3 - CHẨN ĐOÁN "ô có màu nhưng app báo trống" trên dữ liệu thật.
 * Chạy tay: diagnoseCellColorV1("VL-XXXXXXXXXX", "2026-11-20")  (mã căn trong MASTER_VILLA, ngày ở)
 * Chỉ đọc. Kết quả cho biết đúng ô app đang đọc, màu app thấy, màu thật của ô,
 * định dạng có điều kiện / dải màu xen kẽ (banding) đè lên ô, snapshot đang lưu gì.
 *
 * Nguyên nhân thường gặp mà bản kiểm tra này phân biệt được:
 *  A. ĐỊNH DẠNG CÓ ĐIỀU KIỆN: chủ nhà tô màu bằng quy tắc (vd ô chứa "cọc" => đỏ).
 *     Apps Script getBackgrounds() chỉ thấy màu tô tay, KHÔNG thấy màu của quy tắc.
 *  B. DẢI MÀU XEN KẼ (Alternating colors / bảng): cũng không hiện trong getBackgrounds().
 *  C. APP ĐỌC NHẦM Ô: hàng ngày hoặc cột căn bị dò lệch => ô app đọc khác ô người nhìn.
 *  D. SNAPSHOT CŨ: ô vừa tô màu nhưng snapshot chưa dựng lại.
 *  E. Màu chữ thay vì màu nền: quy tắc đã chốt chỉ xét màu NỀN.
 */
function diagnoseCellColorV1(villaId, dateText) {
  var out = {success: true, code: "CELL_COLOR_DIAGNOSE_V1", villaId: String(villaId || ""), date: String(dateText || ""), causes: []};
  var villa = null;
  (ceReadMasterVillas_() || []).forEach(function(v) { if (String(v.id || "") === out.villaId) villa = v; });
  if (!villa) { out.success = false; out.error = "Không thấy mã căn trong MASTER_VILLA"; Logger.log(JSON.stringify(out, null, 2)); return out; }
  var date = ceParseInputDate_(dateText);
  if (!date) { out.success = false; out.error = "Ngày không hợp lệ (dùng yyyy-MM-dd)"; Logger.log(JSON.stringify(out, null, 2)); return out; }
  out.villa = {name: villa.name, source: villa.source, sourceColumn: villa.sourceColumn, config: villa.config};

  var file = ceOpenSpreadsheetFastV23_(villa.calendarUrl);
  var ctx = ceCreateSourceContextV30_(file, {source: villa.source || "", candidates: 1,
    maxColumn: Number(villa.sourceColumn || 0), requiresFullScan: Number(villa.sourceColumn || 0) <= 0});
  var loc = ceFindVillaNightCellV34_(ctx, villa, date, "", 0);
  if (!loc) { out.success = false; out.error = "App không tìm thấy ô của ngày này"; Logger.log(JSON.stringify(out, null, 2)); return out; }
  var cellA1 = ceColumnToLetterV33_(loc.column + 1) + (loc.row + 1);
  var state = ceReadCalendarCellStateV34_(loc.context, loc.row, loc.column, villa.config, villa, loc.optionLabel || "");
  out.appReads = {sheet: loc.context.name, cell: cellA1, status: state.status, reason: state.reason,
    backgroundSeenByApp: state.background, display: state.display, price: state.price};
  if (Number(villa.sourceColumn || 0) && Number(villa.sourceColumn) !== loc.column + 1) {
    out.causes.push("C. Cột app đọc (" + ceColumnToLetterV33_(loc.column + 1) + ") khác CỘT NGUỒN trong MASTER_VILLA (" +
      ceColumnToLetterV33_(Number(villa.sourceColumn)) + "): kiểm tra tên căn ở hàng tên.");
  }

  var sheet = file.getSheetByName(loc.context.name);
  var cell = sheet.getRange(loc.row + 1, loc.column + 1);
  out.live = {background: cell.getBackground(), fontColor: "", displayValue: cell.getDisplayValue(), isPartOfMerge: false};
  try { out.live.fontColor = cell.getFontColorObject ? String(cell.getFontColorObject().asRgbColor().asHexString()) : cell.getFontColor(); } catch (e1) { try { out.live.fontColor = cell.getFontColor(); } catch (ignore) {} }
  try { out.live.isPartOfMerge = cell.isPartOfMerge(); } catch (ignore2) {}
  try {
    var bo = cell.getBackgroundObject();
    out.live.backgroundColorType = bo ? String(bo.getColorType()) : "";
  } catch (ignore3) {}

  // A. Định dạng có điều kiện có tô nền ô này không.
  var cf = [];
  try {
    (sheet.getConditionalFormatRules() || []).forEach(function(rule, i) {
      var hits = (rule.getRanges() || []).some(function(r) {
        return loc.row + 1 >= r.getRow() && loc.row + 1 <= r.getLastRow() && loc.column + 1 >= r.getColumn() && loc.column + 1 <= r.getLastColumn();
      });
      if (!hits) return;
      var info = {rule: i + 1, ranges: (rule.getRanges() || []).map(function(r) { return r.getA1Notation(); }).join(",")};
      var b = rule.getBooleanCondition();
      if (b) { info.type = String(b.getCriteriaType()); info.values = (b.getCriteriaValues() || []).map(String); info.background = b.getBackground ? b.getBackground() : null; }
      if (rule.getGradientCondition && rule.getGradientCondition()) info.type = "GRADIENT";
      cf.push(info);
    });
  } catch (e2) { out.conditionalFormatError = String(e2 && e2.message || e2); }
  out.conditionalFormatRulesOnCell = cf;
  if (cf.some(function(x) { return x.background || x.type === "GRADIENT"; })) {
    out.causes.push("A. Ô có ĐỊNH DẠNG CÓ ĐIỀU KIỆN tô nền. App không nhìn thấy màu này => nhờ chủ nguồn tô màu tay, hoặc báo em thêm quy tắc đọc chữ cho nguồn này.");
  }

  // B. Dải màu xen kẽ.
  try {
    var bands = cell.getBandings ? cell.getBandings() : [];
    if (bands && bands.length) {
      out.bandings = bands.map(function(b) { return b.getRange().getA1Notation(); });
      out.causes.push("B. Ô nằm trong DẢI MÀU XEN KẼ (" + out.bandings.join(",") + "): màu này app không thấy.");
    }
  } catch (ignore4) {}

  // So màu app thấy với màu thật của ô.
  var liveBg = String(out.live.background || "").toLowerCase();
  if (liveBg && liveBg !== String(state.background || "").toLowerCase() && !out.live.isPartOfMerge) {
    out.causes.push("C/D. Màu thật của ô (" + liveBg + ") khác màu app đang dùng (" + state.background + "): app đọc nhầm ô hoặc dữ liệu tải lúc trước.");
  }
  if (state.status === "FREE" && out.live.fontColor && !/^#0{6}$/.test(String(out.live.fontColor).toLowerCase()) && ceIsWhiteV34_(liveBg)) {
    out.causes.push("E. Nền trắng nhưng chữ có màu (" + out.live.fontColor + "): quy tắc chỉ xét màu nền nên ô này là TRỐNG.");
  }

  // D. Snapshot đang lưu gì cho đêm này.
  try {
    var snapCtx = ssLoadScheduleSnapshotContextV320_(true, [date]);
    var snap = ssTryReadVillaSnapshotV320_(snapCtx, villa, [date], 0);
    out.snapshot = {usable: !!(snap && snap.usable), reason: snap && snap.reason || "",
      available: snap && snap.readResult ? snap.readResult.available : null};
    if (snap && snap.usable && snap.readResult && snap.readResult.available === true && state.status !== "FREE") {
      out.causes.push("D. SNAPSHOT CŨ báo TRỐNG trong khi đọc trực tiếp là " + state.status + ": snapshot chưa dựng lại sau khi tô màu.");
    }
  } catch (e5) { out.snapshotError = String(e5 && e5.message || e5); }

  if (!out.causes.length) out.causes.push(state.status === "FREE"
    ? "Ô thật sự nền trắng theo dữ liệu Google trả về. Nếu mắt thấy có màu => kiểm tra A/B trên tab (định dạng có điều kiện, bảng)."
    : "App đọc đúng: " + state.status + ".");
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

/**
 * Mục 3 - Rà các nguồn đang bật xem tab lịch hiện hành có ĐỊNH DẠNG CÓ ĐIỀU KIỆN tô nền
 * hay không (màu app không nhìn thấy). Chỉ đọc, chạy theo lô:
 *   auditConditionalColorsV1()        // 40 nguồn đầu
 *   auditConditionalColorsV1(40, 40)  // 40 nguồn tiếp theo
 */
function auditConditionalColorsV1(startIndex, count) {
  var started = new Date().getTime();
  startIndex = Math.max(0, Number(startIndex || 0));
  count = Math.max(1, Number(count || 40));
  var sources = (opsListMasterSourcesV312_(true).sources || []).filter(function(s) {
    return /docs\.google\.com\/spreadsheets\/d\//.test(String(s.link || ""));
  });
  var out = {success: true, code: "CONDITIONAL_COLOR_AUDIT_V1", totalSources: sources.length, from: startIndex, risky: [], errors: [], checked: 0};
  for (var i = startIndex; i < Math.min(sources.length, startIndex + count); i++) {
    if (new Date().getTime() - started > 300000) { out.stoppedAt = i; break; }
    var s = sources[i];
    try {
      var file = ceOpenSpreadsheetFastV23_(s.link);
      var sel = beMasterCalendarSelectionV4210_(file, s.configCalendar || "AUTO", new Date());
      out.checked++;
      if (!sel.sheet) continue;
      var rules = (sel.sheet.getConditionalFormatRules() || []).filter(function(rule) {
        var b = rule.getBooleanCondition();
        return (b && b.getBackground && b.getBackground()) || (rule.getGradientCondition && rule.getGradientCondition());
      });
      if (rules.length) {
        out.risky.push({id: s.id, source: s.source, row: s.row, sheet: sel.sheet.getName(), rules: rules.length,
          ranges: rules.map(function(r) { return (r.getRanges() || []).map(function(x) { return x.getA1Notation(); }).join(","); }).slice(0, 5)});
      }
    } catch (e) {
      out.errors.push({id: s.id, source: s.source, error: String(e && e.message || e).slice(0, 120)});
    }
  }
  out.next = out.stoppedAt != null ? out.stoppedAt : (startIndex + count < sources.length ? startIndex + count : null);
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

/**
 * Review 10/11 mục 5 - TRƯỚC KHI xóa/đổi tên file: liệt kê trigger đang cài và
 * kiểm tra hàm xử lý của từng trigger còn tồn tại không. Chỉ đọc.
 *   checkTriggerHandlersV1()                       // trigger hiện tại
 *   checkTriggerHandlersV1(["startSearchBenchmarkV1","runNextSearchBenchmarkV1"])  // + hàm sắp gỡ
 */
function checkTriggerHandlersV1(functionsToRemove) {
  var removing = {};
  (functionsToRemove || []).forEach(function(n) { removing[String(n)] = true; });
  var g = (typeof globalThis !== "undefined") ? globalThis : this;
  var rows = ScriptApp.getProjectTriggers().map(function(t) {
    var handler = t.getHandlerFunction();
    return {handler: handler, event: String(t.getEventType()), source: String(t.getTriggerSource()),
      exists: typeof g[handler] === "function", willBeRemoved: !!removing[handler]};
  });
  var out = {success: true, code: "TRIGGER_HANDLER_CHECK_V1", triggers: rows.length,
    missingHandlers: rows.filter(function(r) { return !r.exists; }),
    blockedByRemoval: rows.filter(function(r) { return r.willBeRemoved; }),
    all: rows};
  out.verdict = out.missingHandlers.length || out.blockedByRemoval.length
    ? "CẦN XỬ LÝ: có trigger trỏ tới hàm không tồn tại hoặc hàm sắp bị gỡ"
    : "OK: mọi trigger đều có hàm xử lý và không dính hàm sắp gỡ";
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
