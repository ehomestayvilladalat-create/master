/**
 * QualityTestsV1.js - test thuần (không đọc/ghi Sheet) cho các bản sửa B3, B4, B6.
 * Chạy trong Apps Script: testQualityFixesV1()
 */
function testQualityFixesV1() {
  var results = [
    testTabYearPolicyB4(),
    testNamelessPriceColumnsB3()
  ];
  if (typeof testBlankCellUnknownB6 === "function") results.push(testBlankCellUnknownB6());
  results.push(testNewYearCalendarB5());
  results.push(testBatchedRowDeleteB7());
  results.push(testNoAccessCacheB10());
  results.push(testAiBreakerRulesV1());
  results.push(testColoredCellBusyV1());
  results.push(testXlsxTempDecisionV1());
  var out = {success: true, code: "QUALITY_FIXES_PASS_V1", suites: results.map(function(r) { return r.code; })};
  Logger.log(JSON.stringify(out));
  return out;
}

function qualityAssertV1_(cond, message) {
  if (!cond) throw new Error("QUALITY_TEST_FAIL: " + message);
}

function testTabYearPolicyB4() {
  var nov = new Date(2026, 10, 9), dec = new Date(2026, 11, 20), jan = new Date(2027, 0, 5);
  var d;
  d = beCalendarSheetDescriptorV4210_("Th 01.1027", nov);
  qualityAssertV1_(!d.recognized && d.yearSource === "INVALID", "Th 01.1027 tháng 11/2026 không được đoán thành 1/2026");
  d = beCalendarSheetDescriptorV4210_("Th 01.1027", jan);
  qualityAssertV1_(d.recognized && d.year === 2027 && d.month === 1, "Th 01.1027 vào tháng 1/2027 => 1/2027");
  d = beCalendarSheetDescriptorV4210_("Tháng 1", dec);
  qualityAssertV1_(d.year === 2027, "Tháng 1 xem vào 12/2026 => 1/2027");
  d = beCalendarSheetDescriptorV4210_("Tháng 12", jan);
  qualityAssertV1_(d.year === 2026, "Tháng 12 xem vào 1/2027 => 12/2026");
  d = beCalendarSheetDescriptorV4210_("Tháng 3", nov);
  qualityAssertV1_(d.year === 2026, "Tháng 3 xem vào 11/2026 vẫn là 3/2026 (tab cũ)");
  d = beCalendarSheetDescriptorV4210_("Tháng 11.2025", nov);
  qualityAssertV1_(d.year === 2025 && d.yearSource === "NAME", "tên có năm hợp lệ giữ nguyên năm trên tên");

  // Nội dung tab tháng 11/2026: ngày 1 là Chủ nhật.
  var vals = [["Thứ", "Ngày", "Villa A"]];
  var wd = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
  for (var i = 1; i <= 30; i++) vals.push([wd[new Date(2026, 10, i).getDay()], String(i), ""]);
  var check = beWeekdayYearFromValuesB4_(vals, 11, [2025, 2026]);
  qualityAssertV1_(check.year === 2026, "thứ-ngày trong tab phải nhận ra năm 2026");
  var sheet = {
    getName: function() { return "Tháng 11.2025"; }, getLastRow: function() { return 31; },
    getLastColumn: function() { return 3; }, isSheetHidden: function() { return false; },
    getIndex: function() { return 1; },
    getRange: function() { return {getDisplayValues: function() { return vals; }}; }
  };
  var warnings = [];
  beCollectTabYearWarningsB4_(sheet, nov, warnings);
  qualityAssertV1_(warnings.length === 1 && warnings[0].code === "SHEET_NAME_YEAR_MISMATCH_B4", "phải cảnh báo tab ghi sai năm");

  // Tháng 12/2026: tab Tháng 12 đã ẩn, tab Tháng 1 (không ghi năm) đang mở => chuyển sang Tháng 1.
  function mock(name, hidden, index) {
    return {getName: function() { return name; }, isSheetHidden: function() { return hidden; },
      getIndex: function() { return index; }, getLastRow: function() { return 40; }, getLastColumn: function() { return 12; }};
  }
  var sel = beMasterCalendarSelectionV4210_({getSheets: function() { return [mock("Tháng 12", true, 1), mock("Tháng 1", false, 2)]; }}, "AUTO", new Date(2026, 11, 28));
  qualityAssertV1_(sel.sheet && sel.sheet.getName() === "Tháng 1", "cuối năm phải chuyển sang tab Tháng 1");
  var sel2 = beMasterCalendarSelectionV4210_({getSheets: function() { return [mock("Th 01.1027", false, 1)]; }}, "AUTO", nov);
  qualityAssertV1_(!sel2.sheet && sel2.warnings.length === 1, "tab năm sai ngoài cửa sổ tháng không được dùng, có cảnh báo");
  return {success: true, code: "TAB_YEAR_POLICY_PASS_B4"};
}

function testNamelessPriceColumnsB3() {
  var vals = [["", "", "", "", "", "", ""], ["", "", "", "", "", "", ""],
    ["Thứ", "Ngày", "Villa C6", "", "B3", "", "1A5"], ["", "", "zalo", "10pn", "zalo", "7pn", "zalo"]];
  for (var i = 1; i <= 10; i++) vals.push(["T" + (2 + i % 6), String(i), "3500", "6000 duy", "2.500.000", "1.5tr", "800k"]);
  var formulas = vals.map(function(r) { return r.map(function() { return ""; }); });
  var villas = readMasterFromColumnLayout(vals, formulas, "FIXED_ROW=3;START_COL=3;END_COL=7;FALLBACK=FALSE");
  qualityAssertV1_(villas.length === 3, "đọc đúng 3 căn có tên");
  var letters = BE_B3_LAST_WARNINGS_V1.map(function(w) { return w.letter; }).join(",");
  qualityAssertV1_(letters === "D,F", "phải cảnh báo cột D,F có giá mà không có tên, thực tế=" + letters);
  ["3500", "6000 duy", "2.500.000", "1.5tr", "800k"].forEach(function(c) {
    qualityAssertV1_(beLooksLikePriceCellB3_(c), "phải nhận là giá: " + c);
  });
  ["1/11", "4", "10pn", "Villa A", ""].forEach(function(c) {
    qualityAssertV1_(!beLooksLikePriceCellB3_(c), "không được nhận là giá: " + c);
  });
  return {success: true, code: "NAMELESS_PRICE_COLUMNS_PASS_B3"};
}

function testBlankCellUnknownB6() {
  // Tab 10 ngày: cột C (index 2) ghi giá ở 8 ngày, ngày 9 trắng không giá, ngày 10 tô màu.
  // Cột D (index 3) không bao giờ ghi giá.
  var raw = [["Thứ", "Ngày", "Villa A", "Villa B"]], bgs = [["#ffffff", "#ffffff", "#ffffff", "#ffffff"]];
  var dateIndex = {};
  for (var d = 1; d <= 10; d++) {
    raw.push(["T2", String(d), d <= 8 ? "3500" : "", ""]);
    bgs.push(["#ffffff", "#ffffff", d === 10 ? "#ff0000" : "#ffffff", "#ffffff"]);
    dateIndex["2026-11-" + (d < 10 ? "0" + d : d)] = d;
  }
  function ctx() { return {name: "Tháng 11", raw: raw, display: raw, backgrounds: bgs, notes: [], dateIndexV50: dateIndex}; }
  var villa = {id: "VL-A", name: "Villa A", bedrooms: ""};
  var saved = CE_B6_CACHE_.globalMode;
  try {
    CE_B6_CACHE_.globalMode = "OFF"; // mặc định
    var s = ceReadCalendarCellStateV34_(ctx(), 9, 2, "AUTO", villa, "");
    qualityAssertV1_(s.status === "FREE" && s.price === null, "MẶC ĐỊNH: ô trắng không giá = TRỐNG (giá Liên hệ)");
    s = ceReadCalendarCellStateV34_(ctx(), 1, 2, "AUTO", villa, "");
    qualityAssertV1_(s.status === "FREE" && s.price === 3500000, "ô trắng có giá => TRỐNG có giá (3500 = 3.500.000đ)");
    s = ceReadCalendarCellStateV34_(ctx(), 10, 2, "AUTO", villa, "");
    qualityAssertV1_(s.status === "BUSY", "ô có màu vẫn BẬN");
    s = ceReadCalendarCellStateV34_(ctx(), 9, 2, "AUTO;O_TRANG_KHONG_GIA=CHUA_RO", villa, "");
    qualityAssertV1_(s.status === "UNKNOWN" && s.unknownReason === "WHITE_NO_PRICE_B6", "bật theo nguồn: ô trắng không giá ở cột thường ghi giá => CHƯA RÕ");
    s = ceReadCalendarCellStateV34_(ctx(), 9, 3, "AUTO;O_TRANG_KHONG_GIA=CHUA_RO", {id: "VL-B", name: "Villa B"}, "");
    qualityAssertV1_(s.status === "FREE", "bật theo nguồn nhưng cột không ghi giá: vẫn TRỐNG");
    CE_B6_CACHE_.globalMode = "ON"; // bật toàn hệ thống
    s = ceReadCalendarCellStateV34_(ctx(), 9, 2, "AUTO", villa, "");
    qualityAssertV1_(s.status === "UNKNOWN", "bật toàn hệ thống => CHƯA RÕ");
    s = ceReadCalendarCellStateV34_(ctx(), 9, 2, "AUTO;O_TRANG_KHONG_GIA=TRONG", villa, "");
    qualityAssertV1_(s.status === "FREE", "nguồn khai TRONG thắng cấu hình toàn hệ thống");
    qualityAssertV1_(ceB6ParseModeV1_("Chưa rõ") === "ON" && ceB6ParseModeV1_("TRỐNG") === "OFF" && ceB6ParseModeV1_("") === "", "đọc giá trị có dấu");

    // Snapshot: chỉ đọc lại thành chưa rõ khi B6 bật.
    var row = ["SRC", "VL-A", "Villa A", "", "", 3, "", "m", "s", "f", "h", "F|3500||A2|", "F|3500||A3|", "F|3500||A4|", "F||||", "B"];
    var sctx = {dateColumns: {"2026-11-01": 11, "2026-11-02": 12, "2026-11-03": 13, "2026-11-04": 14, "2026-11-05": 15}};
    CE_B6_CACHE_.globalMode = "OFF";
    qualityAssertV1_(ssRowUsuallyHasPriceB6_(sctx, "VL-A|3", row, {config: "AUTO"}) === false, "snapshot: B6 tắt => không đổi kết quả");
    sctx = {dateColumns: sctx.dateColumns};
    qualityAssertV1_(ssRowUsuallyHasPriceB6_(sctx, "VL-A|3", row, {config: "AUTO;O_TRANG_KHONG_GIA=CHUA_RO"}) === true, "snapshot: B6 bật theo nguồn => dòng thường có giá");
  } finally {
    CE_B6_CACHE_.globalMode = saved;
  }
  qualityAssertV1_(ceSearchLiveErrorReasonV2_(new Error("WHITE_NO_PRICE_B6: x")) === "WHITE_NO_PRICE_B6", "lý do loại WHITE_NO_PRICE_B6");
  qualityAssertV1_(ssClassifySnapshotErrorV341_("SNAPSHOT_WHITE_NO_PRICE_B6:2026-11-09") === "COVERAGE", "snapshot thiếu giá là COVERAGE");
  return {success: true, code: "BLANK_CELL_DEFAULT_FREE_PASS_B6"};
}

/** B5 - tìm căn qua năm mới với tab không ghi năm ("Tháng 12" kéo dài sang 1-5/1). */
function testNewYearCalendarB5() {
  function mkSheet(name, data, id) {
    return {
      getName: function() { return name; }, isSheetHidden: function() { return false; },
      getSheetId: function() { return id; }, getIndex: function() { return id; },
      getLastRow: function() { return data.length; }, getLastColumn: function() { return data[0].length; },
      getMaxRows: function() { return data.length; }, getMaxColumns: function() { return data[0].length; },
      getRange: function(r, c, nr, nc) {
        var slice = function(f) {
          var out = [];
          for (var i = 0; i < nr; i++) { var row = []; for (var j = 0; j < nc; j++) row.push(f((data[r - 1 + i] || [])[c - 1 + j])); out.push(row); }
          return out;
        };
        return {
          getValues: function() { return slice(function(v) { return v === undefined ? "" : v; }); },
          getDisplayValues: function() { return slice(function(v) { return v === undefined ? "" : String(v); }); },
          getBackgrounds: function() { return slice(function() { return "#ffffff"; }); },
          getNotes: function() { return slice(function() { return ""; }); },
          getMergedRanges: function() { return []; }
        };
      }
    };
  }
  var wd = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
  var dec = [["Thứ", "Ngày", "Villa A"]];
  for (var d = 1; d <= 31; d++) dec.push([wd[new Date(2026, 11, d).getDay()], String(d), "3500"]);
  for (var j = 1; j <= 5; j++) dec.push([wd[new Date(2027, 0, j).getDay()], j + "/1", "4000"]);
  var file = {getSheets: function() { return [mkSheet("Tháng 12", dec, 1)]; }, getId: function() { return "TESTFILE"; },
    getUrl: function() { return "https://docs.google.com/spreadsheets/d/TESTFILE/edit"; }, getName: function() { return "test"; }};
  var villa = {id: "VL-TEST", name: "Villa A", sourceColumn: 3, config: "AUTO", source: "test", bedrooms: ""};
  var ctx = ceCreateSourceContextV30_(file, {source: "test", candidates: 1, maxColumn: 3, requiresFullScan: false});
  var r = ceReadColumnCalendarV34_(ctx, villa, [new Date(2027, 0, 2), new Date(2027, 0, 3)], 2, false);
  qualityAssertV1_(r.available === true && r.totalPrice === 8000000, "phải đọc được 2-3/1/2027 từ tab Tháng 12 (giá 4.000.000đ/đêm)");
  qualityAssertV1_(ceMonthFromSheetNameV1_("Th 11") === 11, "tên tab viết tắt \"Th 11\" phải là tháng 11");
  qualityAssertV1_(ceCalendarSheetBucketForDateV54_("Tháng 12", new Date(2027, 0, 2)) === "PREVIOUS", "Tháng 12 là tab TRƯỚC của ngày 2/1/2027");
  qualityAssertV1_(ceCalendarSheetBucketForDateV54_("Tháng 1", new Date(2026, 11, 30)) === "NEXT", "Tháng 1 là tab SAU của ngày 30/12/2026");
  return {success: true, code: "NEW_YEAR_CALENDAR_PASS_B5"};
}

/** B7 - xóa dòng theo khối liền nhau. */
function testBatchedRowDeleteB7() {
  var calls = [];
  var sheet = {deleteRows: function(start, count) { calls.push(start + ":" + count); }};
  var r = beDeleteSheetRowsBatchedB7_(sheet, [10, 11, 12, 13, 20, 21, 5]);
  qualityAssertV1_(calls.join(",") === "20:2,10:4,5:1", "xóa theo khối từ dưới lên, thực tế=" + calls.join(","));
  qualityAssertV1_(r.rows === 7 && r.calls === 3, "7 dòng chỉ cần 3 lệnh");
  calls = [];
  beDeleteSheetRowsBatchedB7_(sheet, [7, 7, 1]);
  qualityAssertV1_(calls.join(",") === "7:1", "bỏ dòng trùng và dòng tiêu đề");
  return {success: true, code: "BATCHED_ROW_DELETE_PASS_B7"};
}

/** B10 - file bị từ chối quyền được nhớ 15 phút, lần sau báo ngay không mở lại. */
function testNoAccessCacheB10() {
  var fileId = "TEST_NO_ACCESS_FILE_B10";
  ceRememberNoAccessFileB10_(fileId);
  qualityAssertV1_(ceNoAccessFileCachedB10_(fileId) === true, "file vừa bị chặn phải được nhớ");
  qualityAssertV1_(ceNoAccessFileCachedB10_("OTHER_FILE") === false, "file khác không bị ảnh hưởng");
  var msg = "";
  try { ceOpenSpreadsheetFastV23_("https://docs.google.com/spreadsheets/d/" + fileId + "/edit"); }
  catch (e) { msg = String(e && e.message || e); }
  qualityAssertV1_(saClassifyAccessErrorV1_(msg) === "NO_ACCESS", "lỗi từ bộ nhớ đệm vẫn được phân loại NO_ACCESS");
  // Dọn: xóa file test khỏi bộ nhớ đệm.
  delete ceNoAccessFilesB10_()[fileId];
  try { CacheService.getScriptCache().put(CE_NO_ACCESS_CACHE_KEY_B10_, JSON.stringify(ceNoAccessFilesB10_()), CE_NO_ACCESS_CACHE_SECONDS_B10_); } catch (ignore) {}
  return {success: true, code: "NO_ACCESS_CACHE_PASS_B10"};
}

/**
 * Review 10/11 mục 3 - ô có nền màu, không khai báo màu trống => phải BẬN.
 * Mục 2 - tên màu không hỗ trợ phải được báo.
 */
function testColoredCellBusyV1() {
  var colors = ["#ff0000", "#FF0000", "#ffff00", "#fff2cc", "#f3f3f3", "#fffffe", "#d9d9d9", "#00ff00", "#4a86e8", "#000000", "#8b4513"];
  var raw = [["Ngày", "Villa"]], bgs = [["#ffffff", "#ffffff"]];
  colors.forEach(function(col, i) { raw.push([String(i + 1), "3500"]); bgs.push(["#ffffff", col]); });
  raw.push([String(colors.length + 1), "3500"]); bgs.push(["#ffffff", "#ffffff"]);
  var c = {name: "Tháng 11", raw: raw, display: raw, backgrounds: bgs, notes: [], dateIndexV50: {}};
  var villa = {id: "VL-C", name: "Villa"};
  colors.forEach(function(col, i) {
    var s = ceReadCalendarCellStateV34_(c, i + 1, 1, "AUTO", villa, "");
    qualityAssertV1_(s.status === "BUSY", "nền " + col + " không khai báo màu trống phải BẬN, thực tế=" + s.status);
  });
  var white = ceReadCalendarCellStateV34_(c, colors.length + 1, 1, "AUTO", villa, "");
  qualityAssertV1_(white.status === "FREE", "nền trắng #ffffff phải TRỐNG");

  // Ô gộp: ô neo tô đỏ, các ô dưới trả về trắng => vẫn BẬN theo màu vùng gộp.
  var merged = {name: "T11", raw: [["Ngày", "V"], ["1", ""], ["2", ""]], display: [["Ngày", "V"], ["1", ""], ["2", ""]],
    backgrounds: [["#ffffff", "#ffffff"], ["#ffffff", "#ff0000"], ["#ffffff", "#ffffff"]], notes: [],
    mergedCellsV52: {"2|1": {background: "#ff0000", anchorRow: 1, anchorColumn: 1, anchorDisplay: ""}}};
  qualityAssertV1_(ceReadCalendarCellStateV34_(merged, 2, 1, "AUTO", villa, "").status === "BUSY", "ô thuộc vùng gộp tô đỏ phải BẬN");

  // Ô ngoài vùng đã tải => CHƯA RÕ, không được TRỐNG.
  var out = ceReadCalendarCellStateV34_(c, 1, 5, "AUTO", villa, "");
  qualityAssertV1_(out.status === "UNKNOWN" && out.unknownReason === "BACKGROUND_NOT_LOADED", "ô ngoài vùng đã tải phải CHƯA RÕ");

  // Khai báo màu trống: chỉ màu đó TRỐNG, màu khác vẫn BẬN; tên màu lạ không có tác dụng.
  qualityAssertV1_(ceReadCalendarCellStateV34_(c, 3, 1, "AUTO;FREE_COLOR_GROUPS=VANG", villa, "").status === "FREE", "VANG khai báo trống => ô vàng TRỐNG");
  qualityAssertV1_(ceReadCalendarCellStateV34_(c, 1, 1, "AUTO;FREE_COLOR_GROUPS=VANG", villa, "").status === "BUSY", "VANG trống nhưng ô đỏ vẫn BẬN");
  qualityAssertV1_(ceReadCalendarCellStateV34_(c, 11, 1, "AUTO;FREE_COLOR_GROUPS=NAU", villa, "").status === "BUSY", "NAU không hỗ trợ => ô nâu vẫn BẬN");

  var issues = ceFreeColorConfigIssuesV1_("AUTO;FREE_COLOR_GROUPS=VANG,NAU");
  qualityAssertV1_(issues.length === 1 && issues[0].code === "FREE_COLOR_NAME_UNKNOWN" && issues[0].value === "NAU", "phải báo tên màu NAU");
  issues = ceFreeColorConfigIssuesV1_("AUTO;MÀU_TRỐNG=#ff0");
  qualityAssertV1_(issues.length === 1 && issues[0].code === "FREE_COLOR_HEX_INVALID", "phải báo mã màu 3 ký tự");
  issues = ceFreeColorConfigIssuesV1_("AUTO;FREE_COLORS=#ffff00;MAU_TRONG=VANG");
  qualityAssertV1_(issues.length === 1 && issues[0].code === "FREE_COLOR_KEY_IGNORED", "phải báo khóa màu bị bỏ qua");
  qualityAssertV1_(ceFreeColorConfigIssuesV1_("AUTO;NHÓM_MÀU_TRỐNG=Vàng, Xanh lá, #ffff00").length === 0, "tên màu hợp lệ có dấu không bị báo");
  return {success: true, code: "COLORED_CELL_BUSY_PASS_V1"};
}
