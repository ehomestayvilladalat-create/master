/**
 * EHOME BOOKING - HIDDEN COLUMN HANDLER (V2)
 *
 * Quy tac: chu an cot villa trong file lich = can KHONG BAN.
 *
 * Cach xac dinh (tu dong, khong can cau hinh):
 * - Chi xet cac tab ngay-thang dang HIEN (khong tinh tab bi an), la thang hien tai
 *   hoac tuong lai (tab thang da qua khong tinh).
 * - Mot cot duoc coi la "an" khi no bi an (isColumnHiddenByUser) trong TAT CA cac tab
 *   thang hien tai/tuong lai do. Neu khong tim duoc tab nao de xet => KHONG an.
 * - Loi khi kiem tra => KHONG an (an toan, khong bao gio lam mat can vi loi).
 *
 * Chi doc cau truc cot cua file (isColumnHiddenByUser). Khong ghi gi vao file nguon.
 * Cache theo tung file + tung cot trong mot lan chay (bien global ben duoi).
 */

var EHOME_HIDDEN_COLUMN_V2 = {
  MAX_TABS_PER_FILE: 8
};

var hcRuntimeCacheV2_ = { files: {}, columns: {} };

function hcClearRuntimeCacheV1_() {
  hcRuntimeCacheV2_ = { files: {}, columns: {} };
}

function hcMonthIndexNowV2_() {
  var now = new Date();
  return now.getFullYear() * 12 + now.getMonth();
}

/**
 * Tra ve danh sach tab thang hien tai/tuong lai dang hien cua file (da cache theo file).
 * @return {Array<{sheet: Sheet, name: string}>}
 */
function hcRelevantTabsV2_(file) {
  var fileId = "";
  try { fileId = String(file.getId() || ""); } catch (e) { return []; }
  if (!fileId) return [];
  var cached = hcRuntimeCacheV2_.files[fileId];
  if (cached) return cached;

  var tabs = [];
  try {
    var nowIndex = hcMonthIndexNowV2_();
    var nowYear = new Date().getFullYear();
    var sheets = file.getSheets();
    for (var i = 0; i < sheets.length && tabs.length < EHOME_HIDDEN_COLUMN_V2.MAX_TABS_PER_FILE; i++) {
      var sh = sheets[i];
      var hiddenSheet = false;
      try { hiddenSheet = sh.isSheetHidden(); } catch (e1) { hiddenSheet = false; }
      if (hiddenSheet) continue;
      var name = sh.getName();
      var month = typeof ceSheetMonthV50_ === "function" ? Number(ceSheetMonthV50_(name) || 0) : 0;
      if (!(month >= 1 && month <= 12)) continue;
      var year = typeof ceSheetYearV50_ === "function" ? Number(ceSheetYearV50_(name, nowYear) || nowYear) : nowYear;
      if (year * 12 + (month - 1) < nowIndex) continue;
      tabs.push({ sheet: sh, name: name });
    }
  } catch (e2) {
    Logger.log("[HiddenColumn] Khong liet ke duoc tab: " + (e2 && e2.message ? e2.message : e2));
    tabs = [];
  }
  hcRuntimeCacheV2_.files[fileId] = tabs;
  return tabs;
}

/**
 * Cot (1-based, A=1) co bi chu an trong TAT CA tab thang hien tai/tuong lai khong.
 * @param {Spreadsheet} file
 * @param {number} column 1-based
 * @return {boolean}
 */
function hcIsColumnHiddenInFileV1_(file, column) {
  column = Number(column || 0);
  if (!file || !(column >= 1)) return false;
  var fileId = "";
  try { fileId = String(file.getId() || ""); } catch (e) { return false; }
  var key = fileId + "|" + column;
  if (Object.prototype.hasOwnProperty.call(hcRuntimeCacheV2_.columns, key)) {
    return hcRuntimeCacheV2_.columns[key];
  }

  var hidden = false;
  try {
    var tabs = hcRelevantTabsV2_(file);
    if (tabs.length) {
      var allHidden = true;
      for (var i = 0; i < tabs.length; i++) {
        var sh = tabs[i].sheet;
        var isHidden = false;
        try {
          isHidden = column <= sh.getMaxColumns() && sh.isColumnHiddenByUser(column);
        } catch (e1) {
          isHidden = false; // loi doc 1 tab => coi nhu khong an (an toan)
        }
        if (!isHidden) { allHidden = false; break; }
      }
      hidden = allHidden;
    }
  } catch (e2) {
    Logger.log("[HiddenColumn] Loi kiem tra cot: " + (e2 && e2.message ? e2.message : e2));
    hidden = false;
  }
  hcRuntimeCacheV2_.columns[key] = hidden;
  return hidden;
}

/** Villa co cot nguon (1-based) bi an khong. */
function hcIsVillaHiddenInFileV1_(file, villa) {
  return hcIsColumnHiddenInFileV1_(file, Number(villa && villa.sourceColumn || 0));
}

/**
 * DON SNAPSHOT 1 LAN: xoa dong SCHEDULE_SNAPSHOT_V1 cua can dang bi an cot.
 * (Ve sau moi lan chu an cot => file doi => snapshot tu dung lai, dong cua can an tu mat.
 *  Ham nay chi dung de don nhung can da an san tu truoc, vi file do khong con thay doi.)
 *
 * - purgeHiddenColumnSnapshotDryRunV1(): chi LOG, khong xoa gi.
 * - purgeHiddenColumnSnapshotV1(): xoa that.
 * Chay lau hon ~4.5 phut thi tu dung, chay lai de tiep tuc (nho vi tri trong Script Property).
 * Chi xoa dong snapshot (cache). Khong sua MASTER, villa_id, lich, gia, file nguon.
 */
var EHOME_HC_PURGE_V1 = {
  MAX_RUNTIME_MS: 270000,
  CURSOR_KEY: "EHOME_HC_PURGE_CURSOR_V1"
};

function purgeHiddenColumnSnapshotResetV1() {
  PropertiesService.getScriptProperties().deleteProperty(EHOME_HC_PURGE_V1.CURSOR_KEY);
  PropertiesService.getScriptProperties().deleteProperty(EHOME_HC_PURGE_V1.CURSOR_KEY + "_DRY");
  Logger.log("HC_PURGE_RESET_V1");
}

function purgeHiddenColumnSnapshotDryRunV1() {
  return hcPurgeHiddenColumnSnapshotImplV1_(true);
}

function purgeHiddenColumnSnapshotV1() {
  return hcPurgeHiddenColumnSnapshotImplV1_(false);
}

function hcPurgeHiddenColumnSnapshotImplV1_(dryRun) {
  var started = new Date().getTime();
  var props = PropertiesService.getScriptProperties();
  var cursorKey = EHOME_HC_PURGE_V1.CURSOR_KEY + (dryRun ? "_DRY" : "");
  var cursor = String(props.getProperty(cursorKey) || "");
  hcClearRuntimeCacheV1_();

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EHOME_SCHEDULE_SNAPSHOT_V320.SHEET);
  if (!sh || sh.getLastRow() < 2) {
    var empty = {code: "HC_PURGE_DONE_V1", dryRun: dryRun, note: "Khong co snapshot", removedRows: 0};
    Logger.log(JSON.stringify(empty));
    return empty;
  }

  var values = sh.getRange(2, 1, sh.getLastRow() - 1, 10).getDisplayValues();
  var byFile = {};
  for (var i = 0; i < values.length; i++) {
    var fileId = String(values[i][9] || "").trim();
    var col = Number(values[i][5] || 0);
    if (!fileId || !(col >= 1)) continue;
    if (!byFile[fileId]) byFile[fileId] = [];
    byFile[fileId].push({ sheetRow: i + 2, col: col, id: values[i][1], name: values[i][2], source: values[i][3] });
  }
  var fileIds = Object.keys(byFile).sort();

  var toDelete = [];
  var scanned = 0, skippedNoAccess = 0, complete = true, lastFile = cursor;
  for (var f = 0; f < fileIds.length; f++) {
    var fid = fileIds[f];
    if (cursor && fid <= cursor) continue;
    if (new Date().getTime() - started > EHOME_HC_PURGE_V1.MAX_RUNTIME_MS) { complete = false; break; }
    lastFile = fid;
    var file = null;
    try { file = SpreadsheetApp.openById(fid); } catch (e) { skippedNoAccess++; continue; }
    scanned++;
    byFile[fid].forEach(function (r) {
      if (hcIsColumnHiddenInFileV1_(file, r.col)) {
        toDelete.push(r);
        Logger.log("HIDDEN_COL_SNAPSHOT | " + r.id + " | " + r.name + " | nguon: " + r.source + " | cot " + r.col + " | dong snapshot " + r.sheetRow);
      }
    });
  }

  var removed = 0;
  if (!dryRun && toDelete.length) {
    var rows = toDelete.map(function (r) { return r.sheetRow; }).sort(function (a, b) { return b - a; });
    var k = 0;
    while (k < rows.length) { // xoa tu duoi len, gop cac dong lien tiep
      var end = rows[k], count = 1;
      while (k + count < rows.length && rows[k + count] === end - count) count++;
      sh.deleteRows(end - count + 1, count);
      removed += count;
      k += count;
    }
  }

  if (complete) props.deleteProperty(cursorKey);
  else props.setProperty(cursorKey, lastFile);

  var summary = {
    code: "HC_PURGE_DONE_V1",
    dryRun: dryRun,
    complete: complete,
    filesScanned: scanned,
    filesNoAccess: skippedNoAccess,
    hiddenRowsFound: toDelete.length,
    removedRows: removed,
    note: complete ? "Xong" : "Chua het - chay lai ham de tiep tuc"
  };
  Logger.log(JSON.stringify(summary));
  return summary;
}
