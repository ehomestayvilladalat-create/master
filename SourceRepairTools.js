/**
 * EHOME BOOKING - CONG CU SUA NGUON (V1)
 *
 * 1) rebuildSourcesAfterConfigFixV1()
 *    Dung lai cac dong MASTER vua sua config bang dung duong chinh thuc
 *    (syncMasterIncrementalCoreV328_ -> buildMasterVilla INCREMENTAL, giu structure guard va R2 reconcile).
 *    KHONG ghi tay MASTER_VILLA, KHONG doi villa_id cu. Sua mang MASTER_ROWS_V1 neu can dong khac.
 *
 * 2) cleanupStaleQueueRowsDryRunV1() / cleanupStaleQueueRowsV1()
 *    Don dong rac trong SCHEDULE_SNAPSHOT_QUEUE_V1: dong SKIPPED co SOURCE KEY khong con ung voi
 *    bat ky nguon nao dang bat trong MASTER (vi du 11 dong TIMI theo tung phong, Ruby home, mỹ hiền),
 *    va dong trung (DUPLICATE_QUEUE_ROW_V1). Chi xoa dong hang doi (cache), khong dong vao MASTER hay lich.
 */

// Dong trong tab MASTER (so dong that tren sheet) can dung lai sau khi sua config 07/10:
// 43 va 279 = Nguyen Huu Tien (So 9, So 11), 160 = Chai Nho nguyen can, 185 = Suda phong le,
// 219 / 220 = Home Gold, 264 = Tong Duy.
var MASTER_ROWS_V1 = [43, 279, 160, 185, 219, 220, 264];

function rebuildSourcesAfterConfigFixV1() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var result = syncMasterIncrementalCoreV328_({
      reason: "CONFIG_FIX_20261007",
      targetRows: MASTER_ROWS_V1,
      maxSources: 10,
      consumePending: false
    });
    var summary = {
      code: "REBUILD_AFTER_CONFIG_FIX_V1",
      selectedRows: result.selectedRows,
      successfulRows: result.successfulRows,
      failedRows: result.failedRows,
      processedVillas: result.processedVillas,
      pending: result.pending,
      stoppedEarly: result.stoppedEarly
    };
    Logger.log(JSON.stringify(summary));
    return result;
  } finally {
    lock.releaseLock();
  }
}

function cleanupStaleQueueRowsDryRunV1() { return scqCleanupV1_(true); }
function cleanupStaleQueueRowsV1() { return scqCleanupV1_(false); }

function scqCleanupV1_(dryRun) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(EHOME_SCHEDULE_SNAPSHOT_V320.QUEUE_SHEET);
  if (!sh || sh.getLastRow() < 2) {
    var none = { code: "QUEUE_CLEANUP_V1", dryRun: dryRun, removed: 0, note: "Khong co hang doi" };
    Logger.log(JSON.stringify(none));
    return none;
  }

  var masterKeys = {};
  var list = opsListMasterSourcesV312_(true);
  if (!list || list.success === false) throw new Error("Khong doc duoc MASTER, dung de an toan.");
  (list.sources || []).forEach(function (s) { masterKeys[ssScheduleSourceKeyV320_(s)] = true; });
  if (!Object.keys(masterKeys).length) throw new Error("MASTER khong co nguon nao dang bat, dung de an toan.");

  var values = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getDisplayValues();
  var seen = {};
  var toDelete = [];
  values.forEach(function (row, i) {
    var key = String(row[0] || "");
    var status = String(row[4] || "").toUpperCase();
    var message = String(row[7] || "");
    var sheetRow = i + 2;
    var stale = status === "SKIPPED" && !masterKeys[key];
    var duplicate = seen[key] === true;
    if (!duplicate) seen[key] = true;
    if (stale || (duplicate && status === "SKIPPED")) {
      toDelete.push({ row: sheetRow, source: row[1], status: status, message: message, reason: stale ? "KHONG_CON_NGUON_MASTER" : "TRUNG_DONG" });
    }
  });

  toDelete.forEach(function (d) {
    Logger.log("QUEUE_STALE | dong " + d.row + " | " + d.source + " | " + d.status + " | " + d.reason);
  });

  var removed = 0;
  if (!dryRun && toDelete.length) {
    var rows = toDelete.map(function (d) { return d.row; }).sort(function (a, b) { return b - a; });
    var k = 0;
    while (k < rows.length) {
      var end = rows[k], count = 1;
      while (k + count < rows.length && rows[k + count] === end - count) count++;
      sh.deleteRows(end - count + 1, count);
      removed += count;
      k += count;
    }
  }

  var summary = { code: "QUEUE_CLEANUP_V1", dryRun: dryRun, found: toDelete.length, removed: removed };
  Logger.log(JSON.stringify(summary));
  return summary;
}
