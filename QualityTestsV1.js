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
  // Cột D (index 3) không bao giờ ghi giá (nguồn không ghi giá vào ô lịch).
  var raw = [["Thứ", "Ngày", "Villa A", "Villa B"]], bgs = [["#ffffff", "#ffffff", "#ffffff", "#ffffff"]];
  var dateIndex = {};
  for (var d = 1; d <= 10; d++) {
    var priceCell = d <= 8 ? "3500" : "";
    raw.push(["T2", String(d), priceCell, ""]);
    bgs.push(["#ffffff", "#ffffff", d === 10 ? "#ff0000" : "#ffffff", "#ffffff"]);
    dateIndex["2026-11-" + (d < 10 ? "0" + d : d)] = d;
  }
  var c = {name: "Tháng 11", raw: raw, display: raw, backgrounds: bgs, notes: [], dateIndexV50: dateIndex};
  var villa = {id: "VL-A", name: "Villa A", bedrooms: ""};
  var s;
  s = ceReadCalendarCellStateV34_(c, 1, 2, "AUTO", villa, "");
  qualityAssertV1_(s.status === "FREE" && s.price === 3500000, "ô trắng có giá => TRỐNG có giá (3500 = 3.500.000đ)");
  s = ceReadCalendarCellStateV34_(c, 9, 2, "AUTO", villa, "");
  qualityAssertV1_(s.status === "UNKNOWN" && s.unknownReason === "WHITE_NO_PRICE_B6", "ô trắng KHÔNG giá ở cột thường ghi giá => CHƯA RÕ");
  s = ceReadCalendarCellStateV34_(c, 10, 2, "AUTO", villa, "");
  qualityAssertV1_(s.status === "BUSY", "ô có màu vẫn BẬN");
  s = ceReadCalendarCellStateV34_(c, 9, 3, "AUTO", {id: "VL-B", name: "Villa B"}, "");
  qualityAssertV1_(s.status === "FREE", "cột không bao giờ ghi giá: ô trắng vẫn TRỐNG như cũ");
  s = ceReadCalendarCellStateV34_(c, 9, 2, "AUTO;O_TRANG_KHONG_GIA=TRONG", villa, "");
  qualityAssertV1_(s.status === "FREE", "CONFIG LỊCH O_TRANG_KHONG_GIA=TRONG tắt B6 cho nguồn");
  qualityAssertV1_(ceSearchLiveErrorReasonV2_(new Error("WHITE_NO_PRICE_B6: Ô trống nhưng không có giá")) === "WHITE_NO_PRICE_B6", "lý do loại phải là WHITE_NO_PRICE_B6");
  qualityAssertV1_(ssClassifySnapshotErrorV341_("SNAPSHOT_WHITE_NO_PRICE_B6:2026-11-09") === "COVERAGE", "snapshot: thiếu giá là COVERAGE, không phải lỗi cứng");

  // Snapshot cũ (trước B6) có F không giá trong dòng thường có giá => đọc là chưa rõ.
  var row = ["SRC", "VL-A", "Villa A", "", "", 3, "", "m", "s", "f", "h", "F|3500||A2|", "F|3500||A3|", "F|3500||A4|", "F||||", "B"];
  var ctx = {dateColumns: {"2026-11-01": 11, "2026-11-02": 12, "2026-11-03": 13, "2026-11-04": 14, "2026-11-05": 15}};
  qualityAssertV1_(ssRowUsuallyHasPriceB6_(ctx, "VL-A|3", row, villa) === true, "dòng snapshot thường có giá");
  var row2 = ["SRC", "VL-B", "Villa B", "", "", 4, "", "m", "s", "f", "h", "F||||", "F||||", "F||||", "F||||", "B"];
  qualityAssertV1_(ssRowUsuallyHasPriceB6_(ctx, "VL-B|4", row2, {config: ""}) === false, "dòng snapshot không ghi giá => giữ TRỐNG");
  return {success: true, code: "BLANK_CELL_UNKNOWN_PASS_B6"};
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
