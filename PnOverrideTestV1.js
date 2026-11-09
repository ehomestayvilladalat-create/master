// ===== TEST CHỈ ĐỌC - BẢN NHÁP =====
// Dán vào file mới tên PnOverrideTestV1.js trong project, rồi chạy trong Apps Script editor.

// Test 1: thuần logic, KHÔNG đọc/ghi sheet nào.
function testPnOverrideAndVillaConflictV1(){
  var checks = [
    ceRoomCountV1_("Cối xay gió 5 phòng") === 5,
    ceRoomCountV1_("Cối xay gió 6 phòng\n60C Trần Bình Trọng P8") === 6,
    ceSavedColumnContradictsNameV1_("Cối xay gió 5 phòng", {score: 35, label: "Cối xay gió 6 phòng\n60C"}) === true,
    ceSavedColumnContradictsNameV1_("47 Huỳnh Khương Ninh", {score: -20, label: "Hình Zalo"}) === true,
    ceSavedColumnContradictsNameV1_("Villa 4 phòng ngủ", {score: 0, label: "5t - 16k HD"}) === false,
    ceSavedColumnContradictsNameV1_("Villa 4 phòng ngủ", {score: 80, label: "Villa 4 phòng ngủ"}) === false
  ];
  var ok = checks.every(function(x){ return x === true; });
  Logger.log(JSON.stringify({
    code: ok ? "PN_OVERRIDE_CONFLICT_TEST_PASS_V1" : "PN_OVERRIDE_CONFLICT_TEST_FAIL_V1",
    checks: checks
  }));
  if (!ok) throw new Error("PN_OVERRIDE_CONFLICT_TEST_FAIL_V1");
  return checks;
}

// Test 2: chỉ ĐỌC sheet PN_GHI_DE, in ra số dòng hợp lệ.
function testPnOverrideSheetV1(){
  var map = beLoadPnOverridesV1_(SpreadsheetApp.getActiveSpreadsheet());
  var keys = Object.keys(map);
  Logger.log(JSON.stringify({
    code: "PN_OVERRIDE_SHEET_READ_V1",
    count: keys.length,
    sample: keys.slice(0, 10).map(function(k){ return {sku: k, pn: map[k]}; })
  }));
  return keys.length;
}
