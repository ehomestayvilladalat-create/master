/** 18_SystemEventBus.gs - V3.1.5 event reader fix */

var EHOME_EVENT_V30 = {
  SHEET: "SYSTEM_EVENT_LOG_V3",
  MAX_ROWS: 2500,
  RETENTION_DAYS: 7
};

function beEmitSystemEventV30_(level, type, payload) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(EHOME_EVENT_V30.SHEET) || ss.insertSheet(EHOME_EVENT_V30.SHEET);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1,1,1,6).setValues([["TIME","LEVEL","TYPE","MESSAGE","PAYLOAD","VERSION"]]);
      sheet.setFrozenRows(1);
    }

    payload = payload || {};
    var message = String(payload.message || payload.reason || "");
    sheet.appendRow([
      new Date(),
      String(level || "INFO"),
      String(type || "EVENT"),
      message,
      JSON.stringify(payload),
      String(BE_CONFIG.VERSION || "")
    ]);

    // C2/B7: bản cũ khi log đầy (2.500 dòng) thì MỖI sự kiện đều xóa 1 dòng và chạy
    // cleanup (đọc lại 2.500 ô thời gian) vì getLastRow() luôn = 2500 (chia hết 100).
    // Giờ chỉ dọn theo lô khi vượt MAX_ROWS + 100 dòng: ít lệnh hơn ~100 lần.
    var lastRow = sheet.getLastRow();
    var extra = lastRow - 1 - EHOME_EVENT_V30.MAX_ROWS;
    if (extra >= 100) {
      sheet.deleteRows(2, extra);
      cleanupSystemEventsV340_();
    } else if (extra < 0 && lastRow % 100 === 0) {
      // Chưa đầy: cứ 100 sự kiện dọn dòng cũ hơn 7 ngày một lần (như cũ).
      cleanupSystemEventsV340_();
    }
  } catch (error) {
    Logger.log(JSON.stringify({
      code:"SYSTEM_EVENT_WRITE_FAIL_V30",
      error:String(error && error.message ? error.message : error)
    }));
  }
}

function cleanupSystemEventsV340_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(EHOME_EVENT_V30.SHEET);
  if (!sheet || sheet.getLastRow() < 2) return {success:true,deleted:0,kept:0};

  var retentionDays = Math.max(1, Number(EHOME_EVENT_V30.RETENTION_DAYS || 7));
  var cutoff = new Date(new Date().getTime() - retentionDays * 86400000);
  var count = sheet.getLastRow() - 1;
  var times = sheet.getRange(2,1,count,1).getValues();
  var deleteCount = 0;

  // Event log append theo thời gian; chỉ xóa block cũ liên tục ở đầu bảng.
  for (var i=0; i<times.length; i++) {
    var value = times[i][0];
    var d = value instanceof Date ? value : new Date(value);
    if (!d || isNaN(d.getTime()) || d.getTime() >= cutoff.getTime()) break;
    deleteCount++;
  }
  if (deleteCount > 0) sheet.deleteRows(2, deleteCount);
  Logger.log(JSON.stringify({
    code:"SYSTEM_EVENT_RETENTION_CLEANUP_V340",
    retentionDays:retentionDays,deleted:deleteCount,kept:Math.max(0,sheet.getLastRow()-1)
  }));
  return {success:true,retentionDays:retentionDays,deleted:deleteCount,kept:Math.max(0,sheet.getLastRow()-1)};
}

function getRecentSystemEventsV30(limit) {
  limit = Math.max(1, Math.min(100, Number(limit || 30)));
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(EHOME_EVENT_V30.SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var last = sheet.getLastRow();
  var start = Math.max(2, last - limit + 1);
  var values = sheet.getRange(start,1,last-start+1,6).getDisplayValues();

  // V3.1.5 FIX: mỗi field phải lấy đúng cột, không gán cả mảng row.
  return values.reverse().map(function(r){
    return {
      time: r[0] || "",
      level: r[1] || "",
      type: r[2] || "",
      message: r[3] || "",
      payload: r[4] || "",
      version: r[5] || ""
    };
  });
}

function testSystemEventsV315() {
  var events = getRecentSystemEventsV30(3);
  var valid = events.every(function(e){
    return !Array.isArray(e.time) && !Array.isArray(e.level) && !Array.isArray(e.type);
  });
  if (!valid) throw new Error("SYSTEM_EVENT_MAPPING_V315_FAILED");
  Logger.log(JSON.stringify({code:"SYSTEM_EVENT_MAPPING_PASS_V315",count:events.length}));
  return {success:true,count:events.length,events:events};
}
