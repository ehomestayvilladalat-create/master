/**
 * 31_ScheduleSnapshot.gs - EHOME V3.2.4 SCHEDULE SNAPSHOT QUEUE CLEANUP
 *
 * CalendarReader V5.x vẫn là SOURCE OF TRUTH.
 * Snapshot chỉ được dùng khi:
 * 1) source file modifiedTime vẫn giống lúc build snapshot;
 * 2) CONFIG hash của villa/option vẫn giống;
 * 3) đủ toàn bộ ngày cần tìm;
 * 4) không có ô snapshot ERROR/MISSING.
 * Nếu bất kỳ điều kiện nào sai => SearchEngine LIVE fallback.
 */

var EHOME_SCHEDULE_SNAPSHOT_V320 = {
  VERSION: "3.4.1-coverage-health",
  SHEET: "SCHEDULE_SNAPSHOT_V1",
  QUEUE_SHEET: "SCHEDULE_SNAPSHOT_QUEUE_V1",
  HORIZON_DAYS: 120,
  PAST_DAYS_TO_KEEP: 3,
  MAINTENANCE_HANDLER: "runSnapshotMaintenanceV320",
  EVERY_MINUTES: 5,
  SOURCES_PER_RUN: 5,
  CATCHUP_SOURCES_PER_RUN: 12,
  MAX_CONSECUTIVE_DATE_MISS: 4,
  RUNNING_STALE_MINUTES: 10,
  MAX_RUNTIME_MS: 150000,
  STRUCTURE_INTERVAL_MINUTES: 60,
  LAST_MAINTENANCE_PROP: "EHOME_SCHEDULE_SNAPSHOT_LAST_MAINTENANCE_V320",
  ENABLED_PROP: "EHOME_SCHEDULE_SNAPSHOT_ENABLED_V320",
  AB_PASS_PROP: "EHOME_SCHEDULE_SNAPSHOT_AB_PASS_V320"
};

var SS_SCHEDULE_STATIC_HEADERS_V320_ = [
  "SOURCE KEY", "VILLA ID", "VILLA NAME", "SOURCE", "CITY",
  "OPTION COLUMN", "OPTION LABEL", "SOURCE MODIFIED AT", "SNAPSHOT AT",
  "FILE ID", "CONFIG HASH"
];

function ssExtractSpreadsheetIdV320_(url) {
  var text = String(url || "");
  var match = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) return match[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(text.trim())) return text.trim();
  return "";
}

function ssScheduleSourceKeyV320_(sourceOrUrl, sourceName) {
  var url = typeof sourceOrUrl === "object" ? sourceOrUrl.link : sourceOrUrl;
  var name = typeof sourceOrUrl === "object" ? sourceOrUrl.source : sourceName;
  var id = ssExtractSpreadsheetIdV320_(url || "");
  var norm = typeof opsNormV312_ === "function" ? opsNormV312_(name || "") : String(name || "").toLowerCase();
  // V3.5: cùng một Spreadsheet có thể chứa nhiều logical source/config.
  // FILE ID đơn lẻ làm queue/snapshot của source sau ghi đè source trước.
  if (id) return "FILE:" + id + (norm ? "|SOURCE:" + norm : "");
  return "SOURCE:" + norm;
}

/** Key cũ chỉ theo FILE ID, dùng duy nhất cho migration snapshot an toàn. */
function ssScheduleLegacySourceKeyV1_(sourceOrUrl) {
  var url = typeof sourceOrUrl === "object" ? sourceOrUrl.link : sourceOrUrl;
  var id = ssExtractSpreadsheetIdV320_(url || "");
  return id ? "FILE:" + id : "";
}

function ssGetSourceModifiedAtV320_(url) {
  var id = ssExtractSpreadsheetIdV320_(url);
  if (!id) return "";
  try {
    return DriveApp.getFileById(id).getLastUpdated().toISOString();
  } catch (error) {
    var msg = String(error && error.message ? error.message : error);
    var classify = saClassifyAccessErrorV1_(msg);

    Logger.log(JSON.stringify({
      code:"SCHEDULE_SNAPSHOT_MODIFIED_READ_FAIL_V320",
      fileId:id,
      errorType:classify,
      error:msg
    }));

    if (classify === "NO_ACCESS") {
      // Ghi nhận nguồn mất quyền vào tab NO_ACCESS_SOURCES
      // (tại đây chưa có source info đầy đủ, sẽ xử lý ở scanScheduleSnapshotChangesV320)
      return "NO_ACCESS";
    }

    return "";  // Lỗi tạm thời
  }
}

/** Mỗi source chỉ đọc modifiedTime một lần/request qua ctx.sourceModifiedCache.
 * Không cache xuyên request vì ACCURACY > SPEED: source vừa đổi phải làm
 * snapshot stale ngay ở request kế tiếp. */
function ssGetSourceModifiedAtSearchV1_(url) {
  return ssGetSourceModifiedAtV320_(url);
}

/**
 * V3.5 - lập plan modifiedTime theo FILE ID nhưng giữ toàn bộ logical source
 * keys. Một file chỉ cần một Drive API request; kết quả được gán cho từng
 * source key. Helper này thuần để regression test được mà không gọi Drive.
 */
function ssBuildSourceModifiedBatchPlanV2_(ctx, villas, guestCount) {
  var byFile = {};
  (villas || []).forEach(function(villa) {
    if (!ctx || !ctx.rows || !villa || !villa.id) return;
    var option = ssSelectOptionForGuestV320_(villa, guestCount);
    var row = ctx.rows[String(villa.id || "") + "|" + Number(option.column || 0)];
    if (!row) return;

    var sourceKey = String(row[0] || "");
    if (!sourceKey || Object.prototype.hasOwnProperty.call(ctx.sourceModifiedCache || {}, sourceKey)) return;
    var sourceHealth = ctx.sourceStatuses && ctx.sourceStatuses[sourceKey] || null;
    var sourceStatus = String(sourceHealth && sourceHealth.status || "").toUpperCase();
    if (["ERROR","DIRTY","RUNNING","SKIPPED"].indexOf(sourceStatus) >= 0) return;

    var fileId = String(row[9] || "") || ssExtractSpreadsheetIdV320_(villa.calendarUrl || "");
    if (!fileId) return;
    if (!byFile[fileId]) byFile[fileId] = {fileId:fileId,sourceKeys:[]};
    if (byFile[fileId].sourceKeys.indexOf(sourceKey) < 0) {
      byFile[fileId].sourceKeys.push(sourceKey);
    }
  });
  return Object.keys(byFile).sort().map(function(fileId) { return byFile[fileId]; });
}

/**
 * Batch modifiedTime trong cùng request. Nếu Drive API lỗi/thiếu dữ liệu,
 * không ghi cache rỗng: ssTryReadVillaSnapshotV320_ sẽ dùng DriveApp fallback
 * cho đúng source đó. Accuracy vì thế không phụ thuộc batch optimization.
 */
function ssPrimeSourceModifiedCacheV2_(ctx, villas, guestCount) {
  if (!ctx || ctx.enabled !== true) return {planned:0,succeeded:0,failed:0,requests:0,elapsedMs:0};
  var plan = ssBuildSourceModifiedBatchPlanV2_(ctx, villas, guestCount);
  if (!plan.length) return {planned:0,succeeded:0,failed:0,requests:0,elapsedMs:0};

  var started = new Date().getTime();
  var succeeded = 0;
  var failed = 0;
  var requestBatches = 0;
  var chunkSize = 50;
  var token = "";
  try { token = ScriptApp.getOAuthToken(); } catch (tokenError) { token = ""; }

  if (!token) {
    var tokenElapsed = new Date().getTime() - started;
    ctx.modifiedBatchFiles = Number(ctx.modifiedBatchFiles || 0) + plan.length;
    ctx.modifiedBatchFailures = Number(ctx.modifiedBatchFailures || 0) + plan.length;
    ctx.modifiedBatchMs = Number(ctx.modifiedBatchMs || 0) + tokenElapsed;
    return {planned:plan.length,succeeded:0,failed:plan.length,requests:0,elapsedMs:tokenElapsed};
  }

  for (var offset = 0; offset < plan.length; offset += chunkSize) {
    var chunk = plan.slice(offset, offset + chunkSize);
    var requests = chunk.map(function(item) {
      return {
        url:"https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(item.fileId) +
          "?fields=id%2CmodifiedTime&supportsAllDrives=true",
        method:"get",
        headers:{Authorization:"Bearer " + token},
        muteHttpExceptions:true
      };
    });
    var responses = null;
    requestBatches++;
    try {
      responses = UrlFetchApp.fetchAll(requests);
    } catch (batchError) {
      failed += chunk.length;
      Logger.log(JSON.stringify({
        level:"WARNING",code:"SCHEDULE_MODIFIED_BATCH_FAILED_V2",
        files:chunk.length,
        error:String(batchError && batchError.message ? batchError.message : batchError),
        action:"DRIVEAPP_FALLBACK_PER_SOURCE"
      }));
      continue;
    }

    chunk.forEach(function(item, index) {
      var response = responses && responses[index];
      var modifiedAt = "";
      try {
        if (response && Number(response.getResponseCode()) >= 200 && Number(response.getResponseCode()) < 300) {
          var payload = JSON.parse(response.getContentText() || "{}");
          if (payload.modifiedTime) modifiedAt = new Date(payload.modifiedTime).toISOString();
        }
      } catch (parseError) {
        modifiedAt = "";
      }

      if (!modifiedAt) {
        failed++;
        return;
      }
      item.sourceKeys.forEach(function(sourceKey) {
        ctx.sourceModifiedCache[sourceKey] = modifiedAt;
        succeeded++;
      });
    });
  }

  var elapsedMs = new Date().getTime() - started;
  ctx.modifiedChecks = Number(ctx.modifiedChecks || 0) + succeeded;
  ctx.modifiedCheckMs = Number(ctx.modifiedCheckMs || 0) + elapsedMs;
  ctx.modifiedBatchRequests = Number(ctx.modifiedBatchRequests || 0) + requestBatches;
  ctx.modifiedBatchFiles = Number(ctx.modifiedBatchFiles || 0) + plan.length;
  ctx.modifiedBatchSources = Number(ctx.modifiedBatchSources || 0) + succeeded;
  ctx.modifiedBatchFailures = Number(ctx.modifiedBatchFailures || 0) + failed;
  ctx.modifiedBatchMs = Number(ctx.modifiedBatchMs || 0) + elapsedMs;

  Logger.log(JSON.stringify({
    code:"SCHEDULE_MODIFIED_BATCH_DONE_V2",files:plan.length,
    sourceKeys:succeeded,failed:failed,requests:requestBatches,elapsedMs:elapsedMs
  }));
  return {planned:plan.length,succeeded:succeeded,failed:failed,requests:requestBatches,elapsedMs:elapsedMs};
}

/**
 * V3.4.1 - Health snapshot tách "coverage gap" khỏi lỗi cứng.
 *
 * COVERAGE_GAP = source chưa có/không nhận ra một dải ngày (thường tháng tương lai).
 * Các ô đó VẪN là E|... nên Search luôn LIVE fallback; tuyệt đối không suy đoán FREE/BUSY.
 * PARTIAL = có lỗi cứng khác DATE_CELL_NOT_FOUND/tail-gap.
 *
 * Message cũ chỉ có errors=N không đủ dữ kiện để phân loại, nên vẫn coi errors>0
 * là PARTIAL cho fail-safe tới khi source rebuild hoặc chạy repair V341.
 */
function ssParseSnapshotHealthV341_(message) {
  var text=String(message||"");
  function read_(name) {
    var match=text.match(new RegExp("(?:^|\\s)"+name+"=(\\d+)","i"));
    return match ? Number(match[1]||0) : null;
  }
  return {
    errors:read_("errors"),
    hardErrors:read_("hardErrors"),
    coverageErrors:read_("coverageErrors"),
    tailSkipped:read_("tailSkipped")
  };
}

function ssClassifySnapshotErrorV341_(errorMessage) {
  var msg=String(errorMessage||"");
  if(msg==="SNAPSHOT_TAIL_SKIPPED_AFTER_DATE_GAP")return "COVERAGE";
  if(msg.indexOf("SNAPSHOT_DATE_CELL_NOT_FOUND:")===0)return "COVERAGE";
  if(msg.indexOf("SNAPSHOT_WHITE_NO_PRICE_B6:")===0)return "COVERAGE";
  return "HARD";
}

function ssNormalizeQueueStatusV1_(status,message) {
  var normalized=String(status||"").trim().toUpperCase();
  var health=ssParseSnapshotHealthV341_(message);

  // Khi message V3.4.1 có breakdown, breakdown là nguồn health chính xác hơn raw status.
  if(health.hardErrors!==null || health.coverageErrors!==null){
    if(Number(health.hardErrors||0)>0)return "PARTIAL";
    if(Number(health.coverageErrors||0)>0){
      if(normalized==="ERROR"||normalized==="DIRTY"||normalized==="RUNNING"||normalized==="SKIPPED")return normalized;
      return "COVERAGE_GAP";
    }
    if(normalized==="PARTIAL"||normalized==="COVERAGE_GAP")return "OK";
    return normalized;
  }

  // Legacy: errors>0 nhưng chưa biết loại => giữ fail-safe PARTIAL.
  if(normalized==="OK"&&health.errors!==null&&Number(health.errors||0)>0)return "PARTIAL";
  return normalized;
}

function ssDateAddV320_(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + Number(days || 0));
}

function ssTodayV320_() {
  var now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function ssDateKeyV320_(date) {
  if (typeof ceDateKey_ === "function") return ceDateKey_(date);
  return Utilities.formatDate(date, Session.getScriptTimeZone() || "Asia/Ho_Chi_Minh", "yyyy-MM-dd");
}

function ssPruneScheduleSnapshotDateColumnsV340_(sh, today, end) {
  if (!sh || sh.getLastColumn() <= SS_SCHEDULE_STATIC_HEADERS_V320_.length) {
    return {deletedColumns:0,deletedKeys:[]};
  }
  var staticCount = SS_SCHEDULE_STATIC_HEADERS_V320_.length;
  var keepPastDays = Math.max(0, Number(EHOME_SCHEDULE_SNAPSHOT_V320.PAST_DAYS_TO_KEEP || 3));
  var minDate = ssDateAddV320_(today, -keepPastDays);
  var minKey = ssDateKeyV320_(minDate);
  var maxKey = ssDateKeyV320_(end);
  var header = sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0];
  var deleteCols = [];
  var deleteKeys = [];

  for (var c = staticCount; c < header.length; c++) {
    var key = String(header[c] || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    if (key < minKey || key > maxKey) {
      deleteCols.push(c + 1);
      deleteKeys.push(key);
    }
  }

  // Xóa từ phải sang trái để chỉ số cột không bị trượt.
  deleteCols.sort(function(a,b){ return b-a; }).forEach(function(col){
    sh.deleteColumn(col);
  });

  if (deleteCols.length) {
    Logger.log(JSON.stringify({
      code:"SCHEDULE_DATE_COLUMNS_PRUNED_V340",
      deletedColumns:deleteCols.length,
      minKeep:minKey,maxKeep:maxKey,
      deletedKeys:deleteKeys.slice(0,20)
    }));
  }
  return {deletedColumns:deleteCols.length,deletedKeys:deleteKeys};
}

function ssEnsureScheduleSnapshotSheetV320_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(EHOME_SCHEDULE_SNAPSHOT_V320.SHEET) || ss.insertSheet(EHOME_SCHEDULE_SNAPSHOT_V320.SHEET);
  var staticCount = SS_SCHEDULE_STATIC_HEADERS_V320_.length;
  var today = ssTodayV320_();
  var end = ssDateAddV320_(today, Number(EHOME_SCHEDULE_SNAPSHOT_V320.HORIZON_DAYS || 120) - 1);

  if (sh.getLastRow() < 1 || sh.getLastColumn() < staticCount) {
    sh.clearContents();
    var initHeaders = SS_SCHEDULE_STATIC_HEADERS_V320_.slice();
    for (var d = new Date(today.getTime()); d.getTime() <= end.getTime(); d = ssDateAddV320_(d,1)) {
      initHeaders.push(ssDateKeyV320_(d));
    }
    sh.getRange(1,1,1,initHeaders.length).setValues([initHeaders]);
    sh.setFrozenRows(1);
    sh.setFrozenColumns(staticCount);
    return sh;
  }

  ssPruneScheduleSnapshotDateColumnsV340_(sh, today, end);

  var header = sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0];
  var existingDateMap = {};
  for (var c = staticCount; c < header.length; c++) {
    if (header[c]) existingDateMap[String(header[c])] = c;
  }
  var missing = [];
  for (var cursor = new Date(today.getTime()); cursor.getTime() <= end.getTime(); cursor = ssDateAddV320_(cursor,1)) {
    var key = ssDateKeyV320_(cursor);
    if (!Object.prototype.hasOwnProperty.call(existingDateMap,key)) missing.push(key);
  }
  if (missing.length) {
    sh.getRange(1,sh.getLastColumn()+1,1,missing.length).setValues([missing]);
  }
  sh.getRange(1,1,1,staticCount).setValues([SS_SCHEDULE_STATIC_HEADERS_V320_]);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(staticCount);
  return sh;
}

function ssEnsureScheduleQueueSheetV320_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(EHOME_SCHEDULE_SNAPSHOT_V320.QUEUE_SHEET) || ss.insertSheet(EHOME_SCHEDULE_SNAPSHOT_V320.QUEUE_SHEET);
  var headers = ["SOURCE KEY","SOURCE","CITY","LINK","STATUS","REQUESTED AT","LAST ATTEMPT","MESSAGE"];
  if (sh.getLastRow() < 1 || sh.getLastColumn() < headers.length) {
    sh.clearContents();
    sh.getRange(1,1,1,headers.length).setValues([headers]);
  } else {
    sh.getRange(1,1,1,headers.length).setValues([headers]);
  }
  sh.setFrozenRows(1);
  return sh;
}

function ssStripGroupOptionsV320_(config) {
  return String(config || "")
    .replace(/(?:^|;)\s*GROUP_OPTIONS_B64=[^;\s]*/ig, "")
    .replace(/^;+|;+$/g, "")
    .replace(/;;+/g, ";") || "AUTO";
}

function ssVillaConfigHashV320_(villa, optionColumn) {
  var raw = [
    String(villa && villa.id || ""),
    String(villa && villa.name || ""),
    String(Number(optionColumn || 0)),
    String(villa && villa.bedrooms || ""),
    ssStripGroupOptionsV320_(villa && villa.config || "")
  ].join("|");
  if (typeof ssHashTextV320_ === "function") return ssHashTextV320_(raw);
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g,"").slice(0,22);
}

function ssOptionsForVillaV320_(villa) {
  var options = [];
  try {
    if (typeof ceParseGroupOptionsV38_ === "function") options = ceParseGroupOptionsV38_(villa && villa.config || "") || [];
  } catch (ignore) {}
  if (options.length) {
    return options.map(function(o){
      return {column:Number(o && o.column || 0),label:String(o && o.label || ""),capacity:Number(o && o.capacity || 0),bedrooms:Number(o && o.bedrooms || 0)};
    }).filter(function(o){ return o.column > 0; });
  }
  return [{column:Number(villa && villa.sourceColumn || 0),label:"",capacity:0,bedrooms:0}];
}

function ssSelectOptionForGuestV320_(villa, guestCount) {
  var options = ssOptionsForVillaV320_(villa);
  if (!options.length) return {column:Number(villa && villa.sourceColumn || 0),label:""};
  if (options.length === 1) return options[0];
  var guests = Number(guestCount || 0);
  var targetBedrooms = Number(villa && villa.bedrooms || 0);
  options.sort(function(a,b){
    var as = typeof ceGroupOptionScoreV38_ === "function" ? ceGroupOptionScoreV38_(a,guests,targetBedrooms) : 0;
    var bs = typeof ceGroupOptionScoreV38_ === "function" ? ceGroupOptionScoreV38_(b,guests,targetBedrooms) : 0;
    if (as !== bs) return bs - as;
    return Number(a.column || 0) - Number(b.column || 0);
  });
  return options[0];
}

function ssEncodePartV320_(text) {
  return encodeURIComponent(String(text == null ? "" : text));
}

function ssDecodePartV320_(text) {
  try { return decodeURIComponent(String(text || "")); } catch (ignore) { return String(text || ""); }
}


function ssDecodeNightCellV320_(text) {
  text = String(text || "");
  if (!text) return {status:"MISSING"};
  if (text === "B" || text.indexOf("B|") === 0) return {status:"BUSY"};
  // V7 NO_CALENDAR_MONTH: nguồn chưa có tab tháng này. Không phải lỗi, không phải FREE.
  if (text.indexOf("M|") === 0) return {status:"NO_CALENDAR",reason:ssDecodePartV320_(text.slice(2))};
  if (text.indexOf("E|") === 0) return {status:"ERROR",error:ssDecodePartV320_(text.slice(2))};
  var p = text.split("|");
  if (p[0] !== "F") return {status:"ERROR",error:"INVALID_SNAPSHOT_CELL"};
  return {
    status:"FREE",
    price:p[1] === "" ? null : Number(p[1]),
    sheet:ssDecodePartV320_(p[2] || ""),
    cell:ssDecodePartV320_(p[3] || ""),
    sourceLink:ssDecodePartV320_(p[4] || "")
  };
}


function queueAllScheduleSnapshotsV320() {
  var sources = opsListMasterSourcesV312_(true).sources || [];
  var sh = ssEnsureScheduleQueueSheetV320_();
  var now = new Date().toISOString();
  var rows = sources.map(function(s){
    return [
      ssScheduleSourceKeyV320_(s),
      s.source || "",
      s.city || "",
      s.link || "",
      "DIRTY",
      now,
      "",
      "FULL_REBUILD"
    ];
  });

  if (sh.getLastRow() > 1) {
    sh.getRange(2,1,sh.getLastRow()-1,8).clearContent();
  }
  if (rows.length) {
    sh.getRange(2,1,rows.length,8).setValues(rows);
  }

  Logger.log(JSON.stringify({code:"SCHEDULE_SNAPSHOT_ALL_QUEUED_V322",sources:sources.length}));
  return {success:true,queued:sources.length};
}

function ssScheduleSnapshotSourceMetaV320_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EHOME_SCHEDULE_SNAPSHOT_V320.SHEET);
  var map = {};
  if (!sh || sh.getLastRow() < 2) return map;
  var values = sh.getRange(2,1,sh.getLastRow()-1,Math.min(sh.getLastColumn(),SS_SCHEDULE_STATIC_HEADERS_V320_.length)).getDisplayValues();
  values.forEach(function(row){
    var key = String(row[0] || "");
    if (!key || map[key]) return;
    map[key] = {source:String(row[3] || ""),city:String(row[4] || ""),modifiedAt:String(row[7] || ""),snapshotAt:String(row[8] || ""),fileId:String(row[9] || "")};
  });
  return map;
}


/**
 * V3.2.4 - dọn queue cũ/stale để 1 nguồn lỗi config không giữ pending mãi.
 * - DIRTY/RUNNING/ERROR nhưng source key không còn villa trong MASTER => SKIPPED.
 * - Queue row trùng SOURCE KEY => chỉ giữ 1 row hoạt động, row còn lại SKIPPED.
 * Không xóa lịch snapshot và không chạm CalendarReader.
 */
function ssCleanupScheduleQueueV324_() {
  var sh = ssEnsureScheduleQueueSheetV320_();
  if (sh.getLastRow() < 2) return {changed:0,skippedZeroMaster:0,duplicates:0};

  var masterKeys = {};
  try {
    ceReadMasterVillas_().forEach(function(v){
      masterKeys[ssScheduleSourceKeyV320_(v.calendarUrl,v.source)] = true;
      var legacyKey = ssScheduleLegacySourceKeyV1_(v.calendarUrl);
      if (legacyKey) masterKeys[legacyKey] = true;
    });
  } catch (ignoreMasterV324) {}

  var values = sh.getRange(2,1,sh.getLastRow()-1,8).getDisplayValues();
  var seen = {};
  var changed = 0;
  var skippedZeroMaster = 0;
  var duplicates = 0;
  var now = new Date().toISOString();

  for (var i = values.length - 1; i >= 0; i--) {
    var row = values[i];
    var key = String(row[0] || '');
    var status = ssNormalizeQueueStatusV1_(row[4],row[7]);
    if (!key) continue;

    if(status!==String(row[4]||'').toUpperCase()){
      row[4]=status;
      changed++;
    }

    if (seen[key]) {
      if (status !== 'SKIPPED') {
        row[4] = 'SKIPPED';
        row[6] = now;
        row[7] = 'DUPLICATE_QUEUE_ROW_V1';
        changed++;
        duplicates++;
      }
      continue;
    }
    seen[key] = true;

    if (!masterKeys[key] && (status === 'DIRTY' || status === 'RUNNING' || status === 'ERROR')) {
      row[4] = 'SKIPPED';
      row[6] = now;
      row[7] = 'SOURCE_ZERO_MASTER_VILLAS';
      changed++;
      skippedZeroMaster++;
    }
  }

  if (changed) {
    sh.getRange(2,1,values.length,8).setValues(values);
    Logger.log(JSON.stringify({
      code:'SCHEDULE_SNAPSHOT_QUEUE_CLEANUP_V324',
      changed:changed,
      skippedZeroMaster:skippedZeroMaster,
      duplicates:duplicates
    }));
  }
  return {changed:changed,skippedZeroMaster:skippedZeroMaster,duplicates:duplicates};
}

/** One-shot migration an toàn cho queue production cũ: chỉ đổi health status
 * OK→PARTIAL khi chính MESSAGE ghi errors>0, đồng thời dùng cleanup duplicate
 * hiện hữu. Không đọc/xóa lịch nguồn hay snapshot row. */
function repairScheduleSnapshotStatusesV1() {
  var lock=LockService.getScriptLock();
  lock.waitLock(30000);
  try{
    var result=ssCleanupScheduleQueueV324_();
    var output={success:true,code:"SCHEDULE_STATUS_REPAIRED_V1",result:result};
    Logger.log(JSON.stringify(output));
    return output;
  }finally{
    lock.releaseLock();
  }
}

function scanScheduleSnapshotChangesV320(prefetchedModifiedV_FIX) {
  prefetchedModifiedV_FIX = prefetchedModifiedV_FIX || {};
  ssEnsureScheduleSnapshotSheetV320_();
  var meta = ssScheduleSnapshotSourceMetaV320_();
  var queueSh = ssEnsureScheduleQueueSheetV320_();
  var queueValues = queueSh.getLastRow() > 1
    ? queueSh.getRange(2,1,queueSh.getLastRow()-1,8).getDisplayValues()
    : [];
  var queueMap = {};
  queueValues.forEach(function(row, idx){
    var key = String(row[0] || "");
    if (!key) return;
    queueMap[key] = {
      row: idx + 2,
      status: ssNormalizeQueueStatusV1_(row[4],row[7]),
      requestedAt: String(row[5] || ""),
      lastAttempt: String(row[6] || ""),
      message: String(row[7] || "")
    };
  });

  var sources = opsListMasterSourcesV312_(true).sources || [];
  // V3.2.3: nguồn chưa sinh được căn trong MASTER không được chặn toàn bộ queue.
  // Giữ SKIPPED cho tới khi MASTER thật sự có căn; khi có căn lại sẽ tự DIRTY và build.
  var masterKeysV323 = {};
  try {
    ceReadMasterVillas_().forEach(function(v){
      masterKeysV323[ssScheduleSourceKeyV320_(v.calendarUrl,v.source)] = true;
    });
  } catch (ignoreMasterV323) {}
  var dirty = 0;
  var queued = 0;
  var appendRows = [];
  var now = new Date().toISOString();

  sources.forEach(function(source){
    var key = ssScheduleSourceKeyV320_(source);
    var currentModified = Object.prototype.hasOwnProperty.call(prefetchedModifiedV_FIX, source.link)
      ? prefetchedModifiedV_FIX[source.link]
      : ssGetSourceModifiedAtV320_(source.link);
    var saved = meta[key];
    var reason = "";

    // Handle NO_ACCESS: ghi trạng thái, KHÔNG đưa vào DIRTY, KHÔNG enqueue priority
    if (currentModified === "NO_ACCESS") {
      try {
        saSaveNoAccessSourceV1_(0, source, "NO_ACCESS");  // masterRow=0 (sẽ update sau)
      } catch (ignoreNoAccessSave) {
        Logger.log("[scanScheduleSnapshot] Error saving NO_ACCESS: " + ignoreNoAccessSave);
      }

      var existing = queueMap[key];
      var noAccessRow = [
        key, source.source || "", source.city || "", source.link || "",
        "NO_ACCESS", existing && existing.requestedAt ? existing.requestedAt : now,
        now,
        "ACCESS_DENIED"
      ];
      if (existing && existing.row) {
        queueSh.getRange(existing.row,1,1,8).setValues([noAccessRow]);
      } else {
        appendRows.push(noAccessRow);
      }
      return;  // Skip logic DIRTY/priority cho NO_ACCESS
    }

    if (currentModified) { try { saMarkRecoveredIfNeededV1_(source); } catch (ignoreRecovered) {} }

    if (!saved) reason = "SNAPSHOT_MISSING";
    else if (!currentModified) reason = "MODIFIED_TIME_UNKNOWN";
    else if (String(saved.modifiedAt || "") !== currentModified) reason = "SOURCE_MODIFIED";

    if (!reason) return;
    dirty++;

    // V3.4.0: source vừa đổi được ưu tiên soi cấu trúc, không chờ vòng
    // round-robin 148 nguồn. Hai lượt maintenance liên tiếp sẽ xác nhận an toàn.
    if ((reason === "SOURCE_MODIFIED" || reason === "SNAPSHOT_MISSING") &&
        typeof ssEnqueuePriorityStructureCheckV340_ === "function") {
      try { ssEnqueuePriorityStructureCheckV340_(source, reason); } catch (ignorePriorityQueueV340) {}
    }

    var existing = queueMap[key];

    // V3.2.4: nguồn hiện không có villa trong MASTER => SKIPPED ngay từ scan, không đưa vào pending.
    if (!masterKeysV323[key]) {
      var skippedRowV324 = [
        key, source.source || "", source.city || "", source.link || "",
        "SKIPPED", existing && existing.requestedAt ? existing.requestedAt : now,
        existing && existing.lastAttempt ? existing.lastAttempt : now,
        "SOURCE_ZERO_MASTER_VILLAS"
      ];
      if (existing && existing.row) {
        queueSh.getRange(existing.row,1,1,8).setValues([skippedRowV324]);
      } else {
        appendRows.push(skippedRowV324);
      }
      return;
    }

    if (existing && existing.status === "SKIPPED" && reason === "SNAPSHOT_MISSING" && !masterKeysV323[key]) {
      return;
    }
    if (existing && existing.status === "DIRTY") {
      return;
    }
    if (existing && existing.status === "RUNNING") {
      var runningMsV322 = existing.lastAttempt ? new Date(existing.lastAttempt).getTime() : 0;
      var runningFreshV322 = runningMsV322 &&
        (new Date().getTime() - runningMsV322) < Number(EHOME_SCHEDULE_SNAPSHOT_V320.RUNNING_STALE_MINUTES || 10) * 60000;
      if (runningFreshV322) return;
      reason = "STALE_RUNNING_RECOVERY:" + reason;
    }

    var row = [
      key,
      source.source || "",
      source.city || "",
      source.link || "",
      "DIRTY",
      existing && existing.requestedAt ? existing.requestedAt : now,
      existing && existing.lastAttempt ? existing.lastAttempt : "",
      reason
    ];

    if (existing && existing.row) {
      queueSh.getRange(existing.row,1,1,8).setValues([row]);
    } else {
      appendRows.push(row);
    }
    queued++;
  });

  if (appendRows.length) {
    queueSh.getRange(queueSh.getLastRow()+1,1,appendRows.length,8).setValues(appendRows);
  }

  Logger.log(JSON.stringify({code:"SCHEDULE_SNAPSHOT_CHANGE_SCAN_V322",sources:sources.length,dirty:dirty,queued:queued,pendingAlready:dirty-queued}));
  return {success:true,sources:sources.length,dirty:dirty,queued:queued};
}


/*
 * V7: kiểm tra nguồn có tab nào của tháng monthKey ("yyyy-MM") không.
 * Chỉ trả true (không có tab) khi CHẮC CHẮN: không tab nào parse ra đúng tháng
 * VÀ không tên tab nào chứa số tháng. Nếu lỗi khi đọc danh sách tab -> false
 * (giữ hành vi cũ, an toàn).
 */
function ssMonthHasNoCalendarTabV7_(file, monthKey, cache) {
  if (!file || !monthKey) return false;
  if (Object.prototype.hasOwnProperty.call(cache, monthKey)) return cache[monthKey];
  var parts = String(monthKey).split("-");
  var monthNum = Number(parts[1]);
  var probeDate = new Date(Number(parts[0]), monthNum - 1, 1);
  var monthToken = new RegExp("(^|[^0-9])0?" + monthNum + "([^0-9]|$)");
  var has = true;
  try {
    var sheets = file.getSheets();
    has = false;
    for (var i = 0; i < sheets.length; i++) {
      var name = String(sheets[i].getName() || "");
      if (ceCalendarSheetBucketForDateV54_(name, probeDate) === "TARGET" || monthToken.test(name)) {
        has = true;
        break;
      }
    }
  } catch (ignore) {
    has = true;
  }
  cache[monthKey] = !has;
  return cache[monthKey];
}

function ssReadSingleNightCellV320_(sourceContext, villa, date) {
  var loc = ceFindVillaNightCellV34_(sourceContext, villa, date, "", 0);
  if (!loc) throw new Error("SNAPSHOT_DATE_CELL_NOT_FOUND:" + ssDateKeyV320_(date));
  var state = ceReadCalendarCellStateV34_(loc.context, loc.row, loc.column, villa.config, villa, loc.optionLabel || "");
  if (state && state.status === "UNKNOWN" && state.unknownReason === "WHITE_NO_PRICE_B6") {
    // B6: ô trống không giá = CHƯA RÕ. Là thiếu dữ liệu của nguồn, không phải lỗi đọc.
    throw new Error("SNAPSHOT_WHITE_NO_PRICE_B6:" + ssDateKeyV320_(date));
  }
  if (!state || state.status === "UNKNOWN") {
    throw new Error("SNAPSHOT_UNKNOWN_STATE:" + ssDateKeyV320_(date));
  }
  if (state.status === "BUSY") return "B";
  var price = state.price === null || state.price === undefined ? "" : String(Number(state.price));
  var cell = ceColumnToLetterV33_(loc.column + 1) + (loc.row + 1);
  var sourceLink = ceBuildSourceLinkV34_(sourceContext.file, loc.context.sheetId, loc.column, loc.row);
  return [
    "F",
    price,
    ssEncodePartV320_(loc.context.name || ""),
    ssEncodePartV320_(cell),
    ssEncodePartV320_(sourceLink || "")
  ].join("|");
}

function ssBuildSourceSnapshotRowsV320_(source, header) {
  var startMs = new Date().getTime();
  var beforeModified = ssGetSourceModifiedAtV320_(source.link);
  if (!beforeModified) throw new Error("SOURCE_MODIFIED_TIME_UNAVAILABLE");

  var allVillas = ceReadMasterVillas_();
  var sourceKey = ssScheduleSourceKeyV320_(source);
  var villas = allVillas.filter(function(v){ return ssScheduleSourceKeyV320_(v.calendarUrl,v.source) === sourceKey; });
  if (!villas.length) throw new Error("SOURCE_ZERO_MASTER_VILLAS");

  var maxColumn = 0;
  villas.forEach(function(v){
    ssOptionsForVillaV320_(v).forEach(function(o){ maxColumn = Math.max(maxColumn, Number(o.column || 0)); });
  });

  var file = null;
  try {
    file = ceOpenSpreadsheetFastV23_(source.link);
  } catch (e) {
    var msg = String(e && e.message ? e.message : e);
    var classify = saClassifyAccessErrorV1_(msg);
    if (classify === "NO_ACCESS") {
      // Ghi tab NO_ACCESS_SOURCES, không enqueue structure
      saSaveNoAccessSourceV1_(0, {id: source.id, source: source.source, city: source.city, link: source.link}, "NO_ACCESS");
      throw new Error("SCHEDULE_SNAPSHOT_NO_ACCESS:" + source.source);
    }
    throw e;
  }

  var context = ceCreateSourceContextV30_(file,{source:source.source || "",candidates:villas.length,maxColumn:maxColumn,requiresFullScan:maxColumn <= 0});
  var noTabMonthCacheV7 = {};

  var hiddenOptionsV2 = 0;

  var staticCount = SS_SCHEDULE_STATIC_HEADERS_V320_.length;
  var dateColumns = [];
  for (var c = staticCount; c < header.length; c++) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(header[c] || ""))) dateColumns.push({index:c,key:String(header[c])});
  }
  var todayKey = ssDateKeyV320_(ssTodayV320_());
  var maxKey = ssDateKeyV320_(ssDateAddV320_(ssTodayV320_(),Number(EHOME_SCHEDULE_SNAPSHOT_V320.HORIZON_DAYS || 120)-1));
  dateColumns = dateColumns.filter(function(x){ return x.key >= todayKey && x.key <= maxKey; });

  var rows = [];
  var errors = 0;
  var hardErrors = 0;
  var coverageErrors = 0;
  var tailSkipped = 0;
  var cells = 0;
  var snapshotAt = new Date().toISOString();
  var fileId = ssExtractSpreadsheetIdV320_(source.link);

  villas.forEach(function(villa){
    ssOptionsForVillaV320_(villa).forEach(function(option){
      // Chu an cot = can khong ban: khong ghi dong snapshot (dong cu bi xoa khi thay block cua source).
      if (hcIsColumnHiddenInFileV1_(file, Number(option.column || 0))) {
        hiddenOptionsV2++;
        Logger.log("[ScheduleSnapshot] Cot an => bo qua: " + (villa.id || "") + " | " + (villa.name || "") + " | cot " + Number(option.column || 0));
        return;
      }
      var row = new Array(header.length).fill("");
      row[0] = sourceKey;
      row[1] = villa.id || "";
      row[2] = villa.name || "";
      row[3] = villa.source || source.source || "";
      row[4] = villa.city || source.city || "";
      row[5] = Number(option.column || 0);
      row[6] = option.label || "";
      row[7] = beforeModified;
      row[8] = snapshotAt;
      row[9] = fileId;
      row[10] = ssVillaConfigHashV320_(villa,option.column);

      var probeVilla = {};
      Object.keys(villa).forEach(function(k){ probeVilla[k] = villa[k]; });
      probeVilla.sourceColumn = Number(option.column || villa.sourceColumn || 0);
      probeVilla.config = ssStripGroupOptionsV320_(villa.config || "");

      var consecutiveDateMissV322 = 0;
      /*
       * V3.2.10 MONTH PROBE:
       * Khi gap MAX ngay lien tiep khong tim thay cot, KHONG bo ca duoi nua.
       * Bo cac ngay con lai cua thang do, roi thu doc ngay 1 cua thang ke tiep.
       * Ngay 1 doc duoc thi doc tiep binh thuong; khong doc duoc thi bo ca thang do.
       * Khong bao gio suy doan FREE/BUSY: o khong doc duoc luon la ERROR.
       */
      var skipMonthV3210 = "";
      var probingV3210 = false;
      for (var diV322 = 0; diV322 < dateColumns.length; diV322++) {
        var dc = dateColumns[diV322];
        var monthV3210 = dc.key.slice(0, 7);
        // V7 NO_CALENDAR_MONTH: nguồn chưa có tab nào của tháng này -> marker, không lỗi.
        if (ssMonthHasNoCalendarTabV7_(file, monthV3210, noTabMonthCacheV7)) {
          cells++;
          row[dc.index] = "M|NO_CALENDAR_MONTH";
          continue;
        }
        if (skipMonthV3210) {
          if (monthV3210 === skipMonthV3210 || dc.key.slice(8, 10) !== "01") {
            cells++;
            errors++;
            coverageErrors++;
            tailSkipped++;
            row[dc.index] = "E|" + ssEncodePartV320_("SNAPSHOT_TAIL_SKIPPED_AFTER_DATE_GAP");
            continue;
          }
          skipMonthV3210 = "";
          consecutiveDateMissV322 = 0;
          probingV3210 = true;
        }
        var wasProbeV3210 = probingV3210;
        probingV3210 = false;
        cells++;
        var parts = dc.key.split("-");
        var date = new Date(Number(parts[0]),Number(parts[1])-1,Number(parts[2]));
        try {
          row[dc.index] = ssReadSingleNightCellV320_(context,probeVilla,date);
          consecutiveDateMissV322 = 0;
        } catch (error) {
          errors++;
          var errorMessageV322 = String(error && error.message ? error.message : error);
          var errorClassV341 = ssClassifySnapshotErrorV341_(errorMessageV322);
          if(errorClassV341 === "COVERAGE") coverageErrors++;
          else hardErrors++;
          row[dc.index] = "E|" + ssEncodePartV320_(errorMessageV322);

          if (errorMessageV322.indexOf("SNAPSHOT_DATE_CELL_NOT_FOUND:") === 0) {
            consecutiveDateMissV322++;
          } else {
            consecutiveDateMissV322 = 0;
          }

          if (wasProbeV3210 && consecutiveDateMissV322 > 0) {
            // Ngay 1 cua thang nay khong co cot -> bo ca thang nay
            skipMonthV3210 = monthV3210;
            consecutiveDateMissV322 = 0;
          } else if (consecutiveDateMissV322 >= Number(EHOME_SCHEDULE_SNAPSHOT_V320.MAX_CONSECUTIVE_DATE_MISS || 4)) {
            skipMonthV3210 = monthV3210;
            consecutiveDateMissV322 = 0;
          }
        }
      }
      rows.push(row);
    });
  });

  var afterModified = ssGetSourceModifiedAtV320_(source.link);
  if (!afterModified || afterModified !== beforeModified) {
    throw new Error("SOURCE_CHANGED_DURING_SNAPSHOT_BUILD");
  }

  return {
    rows:rows,sourceKey:sourceKey,source:source.source || "",villas:villas.length,optionRows:rows.length,
    hiddenOptions:hiddenOptionsV2,cells:cells,errors:errors,hardErrors:hardErrors,coverageErrors:coverageErrors,tailSkipped:tailSkipped,
    modifiedAt:beforeModified,snapshotAt:snapshotAt,elapsedMs:new Date().getTime()-startMs
  };
}

function ssReplaceSourceSnapshotRowsV320_(sourceKey, newRows, providedSheet) {
  var sh = providedSheet || ssEnsureScheduleSnapshotSheetV320_();
  var width = sh.getLastColumn();
  var rows = (newRows || []).map(function(row){
    var out = row.slice(0,width);
    while (out.length < width) out.push("");
    return out;
  });

  var lastRow = sh.getLastRow();
  var positions = [];
  if (lastRow > 1) {
    var keys = sh.getRange(2,1,lastRow-1,1).getDisplayValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0] || "") === sourceKey) positions.push(i + 2);
    }
  }

  // Fast path: block cũ liên tục và cùng số dòng => ghi đè tại chỗ, không rewrite sheet.
  var contiguous = positions.length > 0;
  for (var p = 1; p < positions.length; p++) {
    if (positions[p] !== positions[p-1] + 1) { contiguous = false; break; }
  }
  if (contiguous && positions.length === rows.length) {
    if (rows.length) sh.getRange(positions[0],1,rows.length,width).setValues(rows);
    return {mode:"IN_PLACE",oldRows:positions.length,newRows:rows.length};
  }

  // Nếu chưa có source trong snapshot => append một batch.
  if (!positions.length) {
    if (rows.length) sh.getRange(sh.getLastRow()+1,1,rows.length,width).setValues(rows);
    return {mode:"APPEND",oldRows:0,newRows:rows.length};
  }

  // Chỉ khi số option thay đổi mới xóa block cũ rồi append lại.
  var groups = [];
  var start = positions[0], prev = positions[0];
  for (var g = 1; g < positions.length; g++) {
    if (positions[g] === prev + 1) {
      prev = positions[g];
    } else {
      groups.push({start:start,count:prev-start+1});
      start = prev = positions[g];
    }
  }
  groups.push({start:start,count:prev-start+1});
  groups.reverse().forEach(function(group){ sh.deleteRows(group.start,group.count); });
  if (rows.length) sh.getRange(sh.getLastRow()+1,1,rows.length,width).setValues(rows);
  return {mode:"REPLACE_BLOCK",oldRows:positions.length,newRows:rows.length};
}

/**
 * V4.16 - MASTER_VILLA là registry quyết định villa nào còn được phép xuất
 * hiện trên app. Sau một reconcile đã xác nhận, dọn đúng snapshot row của
 * source/villa không còn trong MASTER_VILLA để cache không giữ căn đã bị gỡ.
 *
 * Fail-safe: nếu không đọc được MASTER_VILLA thì không xóa snapshot nào.
 */
function ssPruneOrphanScheduleSnapshotRowsV416_() {
  var masterSourceKeys = {};
  var masterVillaKeys = {};
  try {
    ceReadMasterVillas_().forEach(function(villa) {
      var sourceKey = ssScheduleSourceKeyV320_(villa.calendarUrl, villa.source);
      var legacySourceKey = ssScheduleLegacySourceKeyV1_(villa.calendarUrl);
      var villaId = String(villa.id || "");
      masterSourceKeys[sourceKey] = true;
      if (villaId) masterVillaKeys[sourceKey + "\u001f" + villaId] = true;
      // Giữ snapshot FILE:<id> cũ cho tới khi đúng villa/option đã được
      // rebuild bằng logical key mới; tránh mass fallback trong migration.
      if (legacySourceKey) {
        masterSourceKeys[legacySourceKey] = true;
        if (villaId) masterVillaKeys[legacySourceKey + "\u001f" + villaId] = true;
      }
    });
  } catch (masterReadErrorV416) {
    Logger.log(JSON.stringify({
      level:"WARNING",
      code:"SCHEDULE_SNAPSHOT_PRUNE_SKIPPED_V416",
      reason:"MASTER_READ_FAILED",
      error:String(
        masterReadErrorV416 && masterReadErrorV416.message
          ? masterReadErrorV416.message
          : masterReadErrorV416
      )
    }));
    return {success:false,skipped:true,reason:"MASTER_READ_FAILED",removedRows:0};
  }

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(
    EHOME_SCHEDULE_SNAPSHOT_V320.SHEET
  );
  if (!sh || sh.getLastRow() < 2) {
    return {success:true,removedRows:0,removedSources:0};
  }

  var values = sh.getRange(2,1,sh.getLastRow()-1,6).getDisplayValues();
  var migratedVillaOptions = {};
  values.forEach(function(row) {
    var key = String(row[0] || "");
    var villaId = String(row[1] || "");
    var optionColumn = Number(row[5] || 0);
    if (key.indexOf("|SOURCE:") >= 0 && villaId) {
      migratedVillaOptions[villaId + "\u001f" + optionColumn] = true;
    }
  });
  var positions = [];
  var removedKeys = {};
  var removedSourceRows = 0;
  var removedVillaRows = 0;
  var removedLegacyRows = 0;
  values.forEach(function(row, index) {
    var key = String(row[0] || "");
    var villaId = String(row[1] || "");
    var optionColumn = Number(row[5] || 0);
    var migratedLegacy = key.indexOf("FILE:") === 0 && key.indexOf("|SOURCE:") < 0 &&
      villaId && migratedVillaOptions[villaId + "\u001f" + optionColumn] === true;
    var sourceMissing = key && !masterSourceKeys[key];
    // ID trống là dữ liệu snapshot cũ/không chắc chắn: giữ lại để Search
    // live-fallback thay vì xóa dựa trên bằng chứng không đầy đủ.
    var villaMissing = key && villaId && !masterVillaKeys[key + "\u001f" + villaId];
    if (migratedLegacy || sourceMissing || villaMissing) {
      positions.push(index + 2);
      removedKeys[key] = true;
      if (migratedLegacy) removedLegacyRows++;
      else if (sourceMissing) removedSourceRows++;
      else removedVillaRows++;
    }
  });

  if (!positions.length) {
    return {success:true,removedRows:0,removedSources:0};
  }

  var groups = [];
  var start = positions[0];
  var previous = positions[0];
  for (var i = 1; i < positions.length; i++) {
    if (positions[i] === previous + 1) {
      previous = positions[i];
    } else {
      groups.push({start:start,count:previous-start+1});
      start = previous = positions[i];
    }
  }
  groups.push({start:start,count:previous-start+1});
  groups.reverse().forEach(function(group) {
    sh.deleteRows(group.start, group.count);
  });

  // Queue orphan không được rebuild; cleanup chỉ chuyển đúng các hàng đó SKIPPED.
  try { ssCleanupScheduleQueueV324_(); } catch (ignoreQueueCleanupV416) {}

  var result = {
    success:true,
    removedRows:positions.length,
    removedSources:Object.keys(removedKeys).length,
    removedSourceRows:removedSourceRows,
    removedVillaRows:removedVillaRows,
    removedLegacyRows:removedLegacyRows
  };
  Logger.log(JSON.stringify({
    code:"SCHEDULE_SNAPSHOT_ORPHAN_PRUNED_V416",
    result:result
  }));
  return result;
}

/** One-shot/public migration sau khi queue V2 đã rebuild xong. Chỉ legacy
 * row có đúng villa + option tương ứng ở logical-key mới mới bị loại. */
function migrateScheduleSnapshotLogicalKeysV2() {
  var lock=LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var result=ssPruneOrphanScheduleSnapshotRowsV416_();
    var output={success:result&&result.success===true,code:"SCHEDULE_LOGICAL_KEYS_MIGRATED_V2",result:result};
    Logger.log(JSON.stringify(output));
    return output;
  } finally {
    lock.releaseLock();
  }
}

/**
 * V3.4.1 one-shot: phân loại lại queue hiện hữu chỉ từ snapshot đã lưu.
 * Không mở source, không thay FREE/BUSY, không sửa snapshot cell.
 * Mục tiêu: bỏ PARTIAL giả do future coverage gap và ghi health breakdown mới.
 */
function repairScheduleSnapshotCoverageStatusesV341() {
  var lock=LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var snapshotSh=ss.getSheetByName(EHOME_SCHEDULE_SNAPSHOT_V320.SHEET);
    var queueSh=ss.getSheetByName(EHOME_SCHEDULE_SNAPSHOT_V320.QUEUE_SHEET);
    if(!snapshotSh||snapshotSh.getLastRow()<2)return {success:false,error:"SNAPSHOT_EMPTY"};
    if(!queueSh||queueSh.getLastRow()<2)return {success:false,error:"QUEUE_EMPTY"};

    var snapshotValues=snapshotSh.getDataRange().getDisplayValues();
    var staticCount=SS_SCHEDULE_STATIC_HEADERS_V320_.length;
    var stats={};
    for(var r=1;r<snapshotValues.length;r++){
      var row=snapshotValues[r]||[];
      var key=String(row[0]||"");
      if(!key)continue;
      if(!stats[key])stats[key]={rows:0,errors:0,hardErrors:0,coverageErrors:0,tailSkipped:0};
      var item=stats[key];
      item.rows++;
      for(var c=staticCount;c<row.length;c++){
        var text=String(row[c]||"");
        if(text.indexOf("E|")!==0)continue;
        var decoded=ssDecodeNightCellV320_(text);
        var errorMessage=String(decoded&&decoded.error||"INVALID_SNAPSHOT_CELL");
        item.errors++;
        if(ssClassifySnapshotErrorV341_(errorMessage)==="COVERAGE"){
          item.coverageErrors++;
          if(errorMessage==="SNAPSHOT_TAIL_SKIPPED_AFTER_DATE_GAP")item.tailSkipped++;
        }else{
          item.hardErrors++;
        }
      }
    }

    var queueValues=queueSh.getRange(2,1,queueSh.getLastRow()-1,8).getDisplayValues();
    var changed=0;
    var totals={errors:0,hardErrors:0,coverageErrors:0,tailSkipped:0};
    var statusCounts={};
    queueValues.forEach(function(row){
      var key=String(row[0]||"");
      var rawStatus=String(row[4]||"").toUpperCase();
      var item=stats[key];
      if(!item){
        var keep=ssNormalizeQueueStatusV1_(rawStatus,row[7]);
        statusCounts[keep]=Number(statusCounts[keep]||0)+1;
        return;
      }

      totals.errors+=item.errors;
      totals.hardErrors+=item.hardErrors;
      totals.coverageErrors+=item.coverageErrors;
      totals.tailSkipped+=item.tailSkipped;

      var protectedStatus=["DIRTY","RUNNING","ERROR","SKIPPED"].indexOf(rawStatus)>=0;
      if(protectedStatus){
        statusCounts[rawStatus]=Number(statusCounts[rawStatus]||0)+1;
        return;
      }

      var desired=item.hardErrors>0 ? "PARTIAL" : (item.coverageErrors>0 ? "COVERAGE_GAP" : "OK");
      var oldMessage=String(row[7]||"");
      var rowsMatch=oldMessage.match(/(?:^|\s)rows=(\d+)/i);
      var cellsMatch=oldMessage.match(/(?:^|\s)cells=(\d+)/i);
      var rowCount=rowsMatch?Number(rowsMatch[1]||0):Number(item.rows||0);
      var cellCount=cellsMatch?Number(cellsMatch[1]||0):0;
      var newMessage=
        "rows="+rowCount+
        " cells="+cellCount+
        " errors="+item.errors+
        " hardErrors="+item.hardErrors+
        " coverageErrors="+item.coverageErrors+
        " tailSkipped="+item.tailSkipped;

      if(String(row[4]||"")!==desired||oldMessage!==newMessage){
        row[4]=desired;
        row[7]=newMessage;
        changed++;
      }
      statusCounts[desired]=Number(statusCounts[desired]||0)+1;
    });

    if(changed)queueSh.getRange(2,1,queueValues.length,8).setValues(queueValues);
    var result={
      success:true,code:"SCHEDULE_COVERAGE_HEALTH_REPAIRED_V341",changed:changed,
      statusCounts:statusCounts,totals:totals
    };
    Logger.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

/** Unit test thuần cho health split V3.4.1; không sửa dữ liệu. */
/** Log-only wrapper cho summary Snapshot V3.4.1; không sửa dữ liệu. */
function testScheduleSnapshotCoverageSummaryV341() {
  var summary = getScheduleSnapshotSummaryV320();
  var result = {
    success:true,
    code:"SCHEDULE_COVERAGE_SUMMARY_V341",
    summary:summary
  };
  Logger.log(JSON.stringify(result));
  return result;
}

function testScheduleSnapshotCoverageHealthV341() {
  function assert_(condition,message){if(!condition)throw new Error("ASSERT_FAIL: "+message);}
  assert_(ssClassifySnapshotErrorV341_("SNAPSHOT_DATE_CELL_NOT_FOUND:2026-11-01")==="COVERAGE","date miss phải là coverage");
  assert_(ssClassifySnapshotErrorV341_("SNAPSHOT_TAIL_SKIPPED_AFTER_DATE_GAP")==="COVERAGE","tail skip phải là coverage");
  assert_(ssClassifySnapshotErrorV341_("SNAPSHOT_UNKNOWN_STATE:2026-09-26")==="HARD","unknown state phải là hard error");
  assert_(ssNormalizeQueueStatusV1_("OK","rows=8 cells=960 errors=3 hardErrors=0 coverageErrors=3 tailSkipped=2")==="COVERAGE_GAP","coverage-only không được thành PARTIAL");
  assert_(ssNormalizeQueueStatusV1_("COVERAGE_GAP","rows=8 cells=960 errors=3 hardErrors=1 coverageErrors=2 tailSkipped=1")==="PARTIAL","hard error phải nâng thành PARTIAL");
  assert_(ssNormalizeQueueStatusV1_("OK","rows=8 cells=960 errors=3")==="PARTIAL","legacy errors>0 phải fail-safe PARTIAL");
  assert_(ssDecodeNightCellV320_("E|SNAPSHOT_TAIL_SKIPPED_AFTER_DATE_GAP").status==="ERROR","coverage cell vẫn phải là ERROR để live fallback");
  var result={success:true,code:"SCHEDULE_COVERAGE_HEALTH_PASS_V341",safety:"ERROR_CELL_STILL_LIVE_FALLBACK"};
  Logger.log(JSON.stringify(result));
  return result;
}

function processScheduleSnapshotQueueV320(maxSources) {
  maxSources = Math.max(1,Number(maxSources || EHOME_SCHEDULE_SNAPSHOT_V320.SOURCES_PER_RUN || 3));
  var started = new Date().getTime();
  var sh = ssEnsureScheduleQueueSheetV320_();
  ssCleanupScheduleQueueV324_();
  var snapshotSh = ssEnsureScheduleSnapshotSheetV320_();
  var header = snapshotSh.getRange(1,1,1,snapshotSh.getLastColumn()).getDisplayValues()[0];
  if (sh.getLastRow() < 2) return {success:true,processed:0,pending:0};
  var values = sh.getDataRange().getDisplayValues();
  var processed = 0;
  var results = [];

  for (var r = 1; r < values.length && processed < maxSources; r++) {
    if (new Date().getTime() - started > Number(EHOME_SCHEDULE_SNAPSHOT_V320.MAX_RUNTIME_MS || 220000)) break;
    if (String(values[r][4] || "").toUpperCase() !== "DIRTY") continue;
    var source = {source:values[r][1] || "",city:values[r][2] || "",link:values[r][3] || ""};
    var rowNumber = r + 1;
    var attempt = new Date().toISOString();
    try {
      sh.getRange(rowNumber,5,1,4).setValues([["RUNNING",values[r][5] || attempt,attempt,"BUILDING"]]);
      var built = ssBuildSourceSnapshotRowsV320_(source,header);
      var writeV322 = ssReplaceSourceSnapshotRowsV320_(built.sourceKey,built.rows,snapshotSh);
      var builtStatusV1=Number(built.hardErrors||0)>0
        ? "PARTIAL"
        : (Number(built.coverageErrors||0)>0 ? "COVERAGE_GAP" : "OK");
      var healthMessageV341 =
        "rows="+built.optionRows+
        " cells="+built.cells+
        " errors="+built.errors+
        " hardErrors="+Number(built.hardErrors||0)+
        " coverageErrors="+Number(built.coverageErrors||0)+
        " tailSkipped="+Number(built.tailSkipped||0);
      sh.getRange(rowNumber,5,1,4).setValues([[builtStatusV1,values[r][5] || attempt,attempt,healthMessageV341]]);
      results.push({
        source:source.source,status:builtStatusV1,rows:built.optionRows,cells:built.cells,errors:built.errors,
        hardErrors:Number(built.hardErrors||0),coverageErrors:Number(built.coverageErrors||0),tailSkipped:Number(built.tailSkipped||0),
        elapsedMs:built.elapsedMs,writeMode:writeV322 && writeV322.mode || ""
      });
    } catch (error) {
      var msg = String(error && error.message ? error.message : error);
      var classify = saClassifyAccessErrorV1_(msg);

      if (msg === "SOURCE_ZERO_MASTER_VILLAS") {
        sh.getRange(rowNumber,5,1,4).setValues([["SKIPPED",values[r][5] || attempt,attempt,msg]]);
        results.push({source:source.source,status:"SKIPPED",reason:msg});
        processed++;
      } else if (classify === "NO_ACCESS") {
        // NO_ACCESS: ghi status, không tính processed (không chiếm slot)
        sh.getRange(rowNumber,5,1,4).setValues([["NO_ACCESS",values[r][5] || attempt,attempt,msg]]);
        results.push({source:source.source,status:"NO_ACCESS",error:msg});

        // Lưu vào tab NO_ACCESS_SOURCES
        try {
          saSaveNoAccessSourceV1_(0, source, "NO_ACCESS");
        } catch (ignoreNoAccessSave) {
          Logger.log("[processQueue] Error saving NO_ACCESS: " + ignoreNoAccessSave);
        }

        // ← KHÔNG tính processed++, nên lần lần sau vẫn xử lý slot này
      } else {
        // Lỗi tạm thời: ghi ERROR, tính processed (nhường cho lần sau)
        sh.getRange(rowNumber,5,1,4).setValues([["ERROR",values[r][5] || attempt,attempt,msg]]);
        results.push({source:source.source,status:"ERROR",error:msg});
        processed++;
      }
    }
  }
  var pending = 0;
  if (sh.getLastRow() > 1) {
    sh.getRange(2,5,sh.getLastRow()-1,1).getDisplayValues().forEach(function(x){ if (String(x[0] || "").toUpperCase() === "DIRTY") pending++; });
  }
  Logger.log(JSON.stringify({code:"SCHEDULE_SNAPSHOT_QUEUE_PROCESSED_V320",processed:processed,pending:pending,results:results}));
  return {success:true,processed:processed,pending:pending,results:results};
}

/**
 * V3.2.2 - chạy catch-up mạnh một lần bằng tay.
 * Tự dừng theo MAX_RUNTIME_MS nên không cần bấm worker nhiều lần.
 */
function drainScheduleSnapshotQueueV322() {
  var startedV322 = new Date().getTime();
  var resultV322 = processScheduleSnapshotQueueV320(
    Number(EHOME_SCHEDULE_SNAPSHOT_V320.CATCHUP_SOURCES_PER_RUN || 12)
  );
  Logger.log(JSON.stringify({
    code:"SCHEDULE_SNAPSHOT_CATCHUP_V322",
    processed:Number(resultV322 && resultV322.processed || 0),
    pending:Number(resultV322 && resultV322.pending || 0),
    elapsedMs:new Date().getTime()-startedV322
  }));
  return resultV322;
}

function ssLoadScheduleSnapshotContextV320_(forceRead, requestedNights) {
  var loadStartedV325 = new Date().getTime();
  var props = PropertiesService.getScriptProperties();
  var featureEnabled = String(props.getProperty(EHOME_SCHEDULE_SNAPSHOT_V320.ENABLED_PROP) || "0") === "1";
  var ctx = {
    enabled:false,
    featureEnabled:featureEnabled,
    rows:{},
    dateColumns:{},
    sourceModifiedCache:{},
    sourceStatuses:{},
    hits:0,
    misses:0,
    stale:0,
    errorCells:0,
    loadMs:0,
    cellsRead:0,
    modifiedChecks:0,
    modifiedCheckMs:0,
    modifiedBatchRequests:0,
    modifiedBatchFiles:0,
    modifiedBatchSources:0,
    modifiedBatchFailures:0,
    modifiedBatchMs:0,
    modifiedFallbackChecks:0,
    rangeReadV325:false,
    trustBackgroundHealthV627:false,
    requireVerifiedModifiedV629:false
  };
  if (!featureEnabled && forceRead !== true) return ctx;

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EHOME_SCHEDULE_SNAPSHOT_V320.SHEET);
  if (!sh || sh.getLastRow() < 2 || sh.getLastColumn() <= SS_SCHEDULE_STATIC_HEADERS_V320_.length) return ctx;

  var rowCountV325 = sh.getLastRow() - 1;
  var colCountV325 = sh.getLastColumn();
  var header = sh.getRange(1,1,1,colCountV325).getDisplayValues()[0] || [];
  ctx.cellsRead += colCountV325;

  for (var c = SS_SCHEDULE_STATIC_HEADERS_V320_.length; c < header.length; c++) {
    if (header[c]) ctx.dateColumns[String(header[c])] = c;
  }

  // Queue status là health của source snapshot. PARTIAL vẫn được dùng cho
  // các cell FREE/BUSY hợp lệ; ERROR/DIRTY/RUNNING/SKIPPED phải live fallback.
  var queueShV1=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EHOME_SCHEDULE_SNAPSHOT_V320.QUEUE_SHEET);
  if(queueShV1&&queueShV1.getLastRow()>1){
    var queueValuesV1=queueShV1.getRange(2,1,queueShV1.getLastRow()-1,8).getDisplayValues();
    queueValuesV1.forEach(function(row){
      var key=String(row[0]||"");
      if(key)ctx.sourceStatuses[key]={status:ssNormalizeQueueStatusV1_(row[4],row[7]),message:String(row[7]||"")};
    });
    ctx.cellsRead+=queueValuesV1.length*8;
  }

  var useRangeReadV325 = Array.isArray(requestedNights) && requestedNights.length > 0;
  var requestedColsV325 = [];
  if (useRangeReadV325) {
    for (var niV325 = 0; niV325 < requestedNights.length; niV325++) {
      var keyV325 = ssDateKeyV320_(requestedNights[niV325]);
      var idxV325 = ctx.dateColumns[keyV325];
      if (idxV325 === undefined) {
        // Thiếu ngày trong header: vẫn load static rows để Search fallback đúng,
        // không cần đọc toàn bộ 120 ngày.
        continue;
      }
      requestedColsV325.push(Number(idxV325));
    }
  }

  if (!useRangeReadV325) {
    // Compatibility path cho test/admin cũ không truyền nights.
    var valuesV325 = sh.getDataRange().getDisplayValues();
    ctx.cellsRead += Math.max(0, valuesV325.length - 1) * colCountV325;
    for (var rFullV325 = 1; rFullV325 < valuesV325.length; rFullV325++) {
      var fullRowV325 = valuesV325[rFullV325] || [];
      var fullVillaIdV325 = String(fullRowV325[1] || "");
      var fullOptionColumnV325 = Number(fullRowV325[5] || 0);
      if (!fullVillaIdV325) continue;
      ctx.rows[fullVillaIdV325 + "|" + fullOptionColumnV325] = fullRowV325;
    }
    ctx.enabled = Object.keys(ctx.rows).length > 0;
    ctx.loadMs = new Date().getTime() - loadStartedV325;
    return ctx;
  }

  // V3.2.5 FAST QUERY READ:
  // 1) chỉ đọc 11 cột metadata cố định;
  // 2) chỉ đọc block ngày thuộc đúng query (thường 1-3 cột), không đọc 120 ngày.
  var staticWidthV325 = SS_SCHEDULE_STATIC_HEADERS_V320_.length;
  var staticValuesV325 = sh.getRange(2,1,rowCountV325,staticWidthV325).getDisplayValues();
  ctx.cellsRead += rowCountV325 * staticWidthV325;

  var dateStartV325 = -1;
  var dateEndV325 = -1;
  if (requestedColsV325.length) {
    dateStartV325 = Math.min.apply(null, requestedColsV325);
    dateEndV325 = Math.max.apply(null, requestedColsV325);
  }

  var dateValuesV325 = null;
  if (dateStartV325 >= 0 && dateEndV325 >= dateStartV325) {
    var dateWidthV325 = dateEndV325 - dateStartV325 + 1;
    dateValuesV325 = sh.getRange(2,dateStartV325 + 1,rowCountV325,dateWidthV325).getDisplayValues();
    ctx.cellsRead += rowCountV325 * dateWidthV325;
  }

  for (var rV325 = 0; rV325 < staticValuesV325.length; rV325++) {
    var staticRowV325 = staticValuesV325[rV325] || [];
    var villaIdV325 = String(staticRowV325[1] || "");
    var optionColumnV325 = Number(staticRowV325[5] || 0);
    if (!villaIdV325) continue;

    var sparseRowV325 = new Array(colCountV325).fill("");
    for (var scV325 = 0; scV325 < staticWidthV325; scV325++) {
      sparseRowV325[scV325] = staticRowV325[scV325] || "";
    }
    if (dateValuesV325) {
      for (var dcV325 = dateStartV325; dcV325 <= dateEndV325; dcV325++) {
        sparseRowV325[dcV325] = dateValuesV325[rV325][dcV325 - dateStartV325] || "";
      }
    }
    ctx.rows[villaIdV325 + "|" + optionColumnV325] = sparseRowV325;
  }

  ctx.enabled = Object.keys(ctx.rows).length > 0;
  ctx.rangeReadV325 = true;
  ctx.loadMs = new Date().getTime() - loadStartedV325;
  return ctx;
}

function ssTryReadVillaSnapshotV320_(ctx,villa,nights,guestCount) {
  if (!ctx || !ctx.enabled || !villa || !villa.id) return {usable:false,reason:"SNAPSHOT_DISABLED"};
  var option = ssSelectOptionForGuestV320_(villa,guestCount);
  var key = String(villa.id || "") + "|" + Number(option.column || 0);
  var row = ctx.rows[key];
  if (!row) { ctx.misses++; return {usable:false,reason:"ROW_MISSING"}; }

  var sourceKey = String(row[0] || "");
  var sourceHealth=ctx.sourceStatuses&&ctx.sourceStatuses[sourceKey]||null;
  var sourceStatus=String(sourceHealth&&sourceHealth.status||"").toUpperCase();
  if(sourceStatus==="ERROR"||sourceStatus==="DIRTY"||sourceStatus==="RUNNING"||sourceStatus==="SKIPPED"||sourceStatus==="NO_ACCESS"){
    ctx.stale++;
    return {usable:false,reason:"SNAPSHOT_SOURCE_"+sourceStatus,sourceStatus:sourceStatus};
  }
  var savedModified = String(row[7] || "");
  // V6.2.7 CUSTOMER SNAPSHOT-FIRST:
  // first paint trusts the background queue health instead of calling Drive
  // modifiedTime for every source. Booking/next live phase still verifies live.
  if (ctx.trustBackgroundHealthV627 === true) {
    if (!sourceHealth || !sourceStatus) {
      ctx.stale++; return {usable:false,reason:"SNAPSHOT_HEALTH_UNKNOWN"};
    }
    // V6.2.9: customer-facing FREE/BUSY may only use snapshot when the
    // source modifiedTime was verified in the bounded candidate window.
    // Do not perform unbounded per-source Drive calls here; candidates that
    // were not batch-verified are deferred to later/live phases.
    if (ctx.requireVerifiedModifiedV629 === true) {
      if (!Object.prototype.hasOwnProperty.call(ctx.sourceModifiedCache,sourceKey)) {
        ctx.stale++; return {usable:false,reason:"SOURCE_MODIFIED_UNVERIFIED_V629"};
      }
      var verifiedModifiedV629 = String(ctx.sourceModifiedCache[sourceKey] || "");
      if (!verifiedModifiedV629 || !savedModified || verifiedModifiedV629 !== savedModified) {
        ctx.stale++; return {usable:false,reason:"SOURCE_MODIFIED_V629"};
      }
    }
  } else {
    var currentModified;
    if (Object.prototype.hasOwnProperty.call(ctx.sourceModifiedCache,sourceKey)) {
      currentModified = ctx.sourceModifiedCache[sourceKey];
    } else {
      var modifiedStartedV325 = new Date().getTime();
      currentModified = ssGetSourceModifiedAtSearchV1_(villa.calendarUrl);
      ctx.modifiedChecks = Number(ctx.modifiedChecks || 0) + 1;
      ctx.modifiedFallbackChecks = Number(ctx.modifiedFallbackChecks || 0) + 1;
      ctx.modifiedCheckMs = Number(ctx.modifiedCheckMs || 0) + (new Date().getTime() - modifiedStartedV325);
      ctx.sourceModifiedCache[sourceKey] = currentModified;
    }
    if (!currentModified || !savedModified || currentModified !== savedModified) {
      ctx.stale++; return {usable:false,reason:"SOURCE_MODIFIED"};
    }
  }

  var expectedHash = ssVillaConfigHashV320_(villa,option.column);
  if (!row[10] || String(row[10]) !== expectedHash) {
    ctx.stale++; return {usable:false,reason:"CONFIG_CHANGED"};
  }

  var nightly = [];
  var total = 0;
  var complete = true;
  for (var i = 0; i < nights.length; i++) {
    var dateKey = ssDateKeyV320_(nights[i]);
    var col = ctx.dateColumns[dateKey];
    if (col === undefined) { ctx.misses++; return {usable:false,reason:"DATE_OUTSIDE_SNAPSHOT"}; }
    var state = ssDecodeNightCellV320_(row[col]);
    if (state.status === "NO_CALENDAR") {
      ctx.misses++;
      return {usable:false,reason:"SNAPSHOT_NO_CALENDAR_MONTH",sourceStatus:sourceStatus||"OK",blockedDate:dateKey};
    }
    if (state.status === "BUSY") {
      ctx.hits++;
      return {usable:true,reader:"SNAPSHOT_V320",sourceStatus:sourceStatus||"OK",readResult:{available:false,priceStatus:"UNAVAILABLE",totalPrice:null,nightlyPrices:nightly,blockedDate:dateKey,blockedReason:"SNAPSHOT_BUSY"}};
    }
    if (state.status !== "FREE") {
      if (state.status === "ERROR") ctx.errorCells++;
      ctx.misses++;
      return {usable:false,reason:"SNAPSHOT_" + state.status};
    }
    if ((state.price === null || !Number.isFinite(state.price)) && ssRowUsuallyHasPriceB6_(ctx, key, row, villa)) {
      // B6: snapshot cũ (trước bản B6) lưu ô trống-không-giá là FREE. Đọc lại như CHƯA RÕ.
      ctx.misses++;
      return {usable:false,reason:"SNAPSHOT_WHITE_NO_PRICE_B6",blockedDate:dateKey};
    }
    if (state.price === null || !Number.isFinite(state.price)) complete = false;
    else total += state.price;
    nightly.push({
      date:dateKey,
      price:state.price,
      priceText:state.price === null ? "Liên hệ" : ceFormatMoney_(state.price),
      sheet:state.sheet || "",
      cell:state.cell || "",
      sourceLink:state.sourceLink || "",
      optionLabel:option.label || "",
      optionColumn:Number(option.column || 0)
    });
  }
  ctx.hits++;
  return {usable:true,reader:"SNAPSHOT_V320",sourceStatus:sourceStatus||"OK",readResult:{available:true,priceStatus:complete?"KNOWN":"CONTACT",totalPrice:complete?total:null,totalPriceText:complete?ceFormatMoney_(total):"Liên hệ báo giá",nightlyPrices:nightly,sourceLinks:nightly.map(function(x){return x.sourceLink;}),selectedOption:option.label || ""}};
}

/** B6 - dòng snapshot thường có giá: >= 3 ô FREE có giá và >= 20% số ô FREE. */
function ssRowUsuallyHasPriceB6_(ctx, key, row, villa) {
  if (typeof ceB6GlobalModeV1_ === "function" && ceB6GlobalModeV1_() === "FREE") return false;
  if (typeof ceB6ConfigModeV1_ === "function" && ceB6ConfigModeV1_(villa && villa.config || "") === "FREE") return false;
  ctx.rowPricedCacheB6 = ctx.rowPricedCacheB6 || {};
  if (Object.prototype.hasOwnProperty.call(ctx.rowPricedCacheB6, key)) return ctx.rowPricedCacheB6[key];
  var free = 0, priced = 0;
  Object.keys(ctx.dateColumns || {}).forEach(function(dk) {
    var st = ssDecodeNightCellV320_(row[ctx.dateColumns[dk]]);
    if (st.status !== "FREE") return;
    free++;
    if (st.price !== null && Number.isFinite(st.price)) priced++;
  });
  var result = priced >= 3 && priced >= Math.ceil(free * 0.2);
  ctx.rowPricedCacheB6[key] = result;
  return result;
}

function getScheduleSnapshotSummaryV320() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EHOME_SCHEDULE_SNAPSHOT_V320.SHEET);
  var queue = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EHOME_SCHEDULE_SNAPSHOT_V320.QUEUE_SHEET);
  var meta = ssScheduleSnapshotSourceMetaV320_();
  var rows = sh && sh.getLastRow() > 1 ? sh.getLastRow()-1 : 0;
  var pending = 0, queueErrors = 0, statusCounts = {};
  var healthTotals={errors:0,hardErrors:0,coverageErrors:0,tailSkipped:0,classifiedRows:0};
  if (queue && queue.getLastRow() > 1) {
    queue.getRange(2,5,queue.getLastRow()-1,4).getDisplayValues().forEach(function(x){
      var s=ssNormalizeQueueStatusV1_(x[0],x[3]);
      statusCounts[s]=Number(statusCounts[s]||0)+1;
      if(s==="DIRTY"||s==="RUNNING")pending++;
      if(s==="ERROR")queueErrors++;
      var parsed=ssParseSnapshotHealthV341_(x[3]);
      if(parsed.hardErrors!==null||parsed.coverageErrors!==null){
        healthTotals.classifiedRows++;
        healthTotals.errors+=Number(parsed.errors||0);
        healthTotals.hardErrors+=Number(parsed.hardErrors||0);
        healthTotals.coverageErrors+=Number(parsed.coverageErrors||0);
        healthTotals.tailSkipped+=Number(parsed.tailSkipped||0);
      }
    });
  }
  return {success:true,version:EHOME_SCHEDULE_SNAPSHOT_V320.VERSION,sources:Object.keys(meta).length,rows:rows,pending:pending,queueErrors:queueErrors,statusCounts:statusCounts,healthTotals:healthTotals,lastMaintenance:PropertiesService.getScriptProperties().getProperty(EHOME_SCHEDULE_SNAPSHOT_V320.LAST_MAINTENANCE_PROP)||"",horizonDays:EHOME_SCHEDULE_SNAPSHOT_V320.HORIZON_DAYS};
}

function getScheduleSnapshotSourceStatusV320_(selector) {
  var source = typeof opsFindSourceV312_ === "function" ? opsFindSourceV312_(selector) : null;
  if (!source) return {success:false,error:"SOURCE_NOT_FOUND"};
  var key = ssScheduleSourceKeyV320_(source);
  var meta = ssScheduleSnapshotSourceMetaV320_()[key] || null;
  var currentModified = ssGetSourceModifiedAtV320_(source.link);
  var queueStatus="";
  var queue=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EHOME_SCHEDULE_SNAPSHOT_V320.QUEUE_SHEET);
  if(queue&&queue.getLastRow()>1){
    queue.getRange(2,1,queue.getLastRow()-1,8).getDisplayValues().some(function(row){
      if(String(row[0]||"")!==key)return false;
      queueStatus=ssNormalizeQueueStatusV1_(row[4],row[7]);
      return true;
    });
  }
  var status = !meta ? "MISSING" : (!currentModified || currentModified !== meta.modifiedAt ? "STALE" : (queueStatus||"OK"));
  return {success:true,source:source.source,city:source.city,status:status,snapshot:meta,currentModifiedAt:currentModified};
}

function runSnapshotMaintenanceV320() {
  /*
   * FIX-L1: đọc thời gian sửa đổi của ~257 nguồn (Drive) TRƯỚC khi lấy khóa.
   * Đây là phần chiếm nhiều thời gian nhất của bước quét; giữ khóa suốt lúc
   * đọc Drive là nguyên nhân nút đồng bộ báo "bận".
   */
  var ssPhaseT0V_T = new Date().getTime();
  var prefetchedModifiedV_FIX = {};
  try {
    (opsListMasterSourcesV312_(true).sources || []).forEach(function(source){
      if (source && source.link) prefetchedModifiedV_FIX[source.link] = ssGetSourceModifiedAtV320_(source.link);
    });
  } catch (ignorePrefetchV_FIX) {}
  Logger.log(JSON.stringify({code:"SNAPSHOT_PHASE_TIMING",phase:"PREFETCH_DRIVE",elapsedMs:new Date().getTime()-ssPhaseT0V_T,sources:Object.keys(prefetchedModifiedV_FIX).length,noAccess:Object.keys(prefetchedModifiedV_FIX).filter(function(k){return prefetchedModifiedV_FIX[k]==="NO_ACCESS";}).length}));

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return {success:true,skipped:true,reason:"LOCKED"};
  try {
    var started = new Date().getTime();
    var scan = scanScheduleSnapshotChangesV320(prefetchedModifiedV_FIX);
    Logger.log(JSON.stringify({code:"SNAPSHOT_PHASE_TIMING",phase:"SCAN",elapsedMs:new Date().getTime()-ssPhaseT0V_T}));
    var processed = processScheduleSnapshotQueueV320(EHOME_SCHEDULE_SNAPSHOT_V320.SOURCES_PER_RUN);
    Logger.log(JSON.stringify({code:"SNAPSHOT_PHASE_TIMING",phase:"QUEUE",elapsedMs:new Date().getTime()-ssPhaseT0V_T}));

    var props = PropertiesService.getScriptProperties();
    var lastStruct = String(props.getProperty(EHOME_STRUCTURE_SNAPSHOT_V320.LAST_RUN_PROP) || "");
    var lastMs = lastStruct ? new Date(lastStruct).getTime() : 0;
    var struct = null;
    if (!lastMs || new Date().getTime() - lastMs >= Number(EHOME_SCHEDULE_SNAPSHOT_V320.STRUCTURE_INTERVAL_MINUTES || 60) * 60000) {
      // Release outer lock is impossible here; buildStructureSnapshot has own lock.
      // Gọi helper không lock để tránh deadlock bằng cách chạy sau finally qua property flag.
      props.setProperty("EHOME_STRUCTURE_SNAPSHOT_DUE_V320","1");
    }
    props.setProperty(EHOME_SCHEDULE_SNAPSHOT_V320.LAST_MAINTENANCE_PROP,new Date().toISOString());
    Logger.log(JSON.stringify({code:"SNAPSHOT_MAINTENANCE_V320",scan:scan,processed:processed,elapsedMs:new Date().getTime()-started}));
    return {success:true,scan:scan,processed:processed,structureDeferred:true};
  } finally {
    lock.releaseLock();
    Logger.log(JSON.stringify({code:"SNAPSHOT_PHASE_TIMING",phase:"AFTER_RELEASE",elapsedMs:new Date().getTime()-ssPhaseT0V_T}));
    var priorityResultV340 = null;
    try {
      if (typeof processPriorityStructureChecksV340_ === "function") {
        priorityResultV340 = processPriorityStructureChecksV340_(
          Number(EHOME_STRUCTURE_SNAPSHOT_V320.PRIORITY_PER_MAINTENANCE || 2)
        );
      }
    } catch (priorityStructureErrV340) {
      Logger.log(JSON.stringify({
        code:"STRUCTURE_PRIORITY_PROCESS_FAILED_V340",
        error:String(priorityStructureErrV340 && priorityStructureErrV340.message || priorityStructureErrV340)
      }));
    }

    Logger.log(JSON.stringify({code:"SNAPSHOT_PHASE_TIMING",phase:"AFTER_PRIORITY",elapsedMs:new Date().getTime()-ssPhaseT0V_T}));
    try {
      var props2 = PropertiesService.getScriptProperties();
      if (props2.getProperty("EHOME_STRUCTURE_SNAPSHOT_DUE_V320") === "1") {
        // Priority source quan trọng hơn round-robin. Nếu vừa soi priority thì
        // giữ cờ DUE để maintenance kế tiếp tiếp tục vòng scan toàn hệ thống.
        if (!priorityResultV340 || Number(priorityResultV340.processed || 0) <= 0) {
          props2.deleteProperty("EHOME_STRUCTURE_SNAPSHOT_DUE_V320");
          buildStructureSnapshotV320();
        }
      }
    } catch (ignoreStructure) {}
    Logger.log(JSON.stringify({code:"SNAPSHOT_PHASE_TIMING",phase:"AFTER_STRUCTURE",elapsedMs:new Date().getTime()-ssPhaseT0V_T}));

    // V6.1.8: sweep tat ca source da du bang chung confirmed/new-zero-master
    // vao incremental pending. Khong doc lai source, khong bo qua V4.16 failsafe.
    try {
      if (typeof ssQueueConfirmedMasterDriftV618_ === "function") {
        ssQueueConfirmedMasterDriftV618_({force:false});
      }
    } catch (reconcileSweepErrV618) {
      Logger.log(JSON.stringify({
        level:"WARNING",
        code:"MASTER_RECONCILE_SWEEP_FAILED_V618",
        error:String(reconcileSweepErrV618 && reconcileSweepErrV618.message || reconcileSweepErrV618)
      }));
    }
    Logger.log(JSON.stringify({code:"SNAPSHOT_PHASE_TIMING",phase:"RUN_TOTAL_WITH_FINALLY",elapsedMs:new Date().getTime()-ssPhaseT0V_T}));
  }
}

function installSnapshotEngineV320() {
  ssEnsureScheduleSnapshotSheetV320_();
  ssEnsureScheduleQueueSheetV320_();
  ssEnsureStructureSnapshotSheetV320_();
  var props = PropertiesService.getScriptProperties();
  props.setProperty(EHOME_SCHEDULE_SNAPSHOT_V320.ENABLED_PROP,"0");
  props.setProperty(EHOME_SCHEDULE_SNAPSHOT_V320.AB_PASS_PROP,"0");
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(t){
    if (t.getHandlerFunction() === EHOME_SCHEDULE_SNAPSHOT_V320.MAINTENANCE_HANDLER) { ScriptApp.deleteTrigger(t); removed++; }
  });
  ScriptApp.newTrigger(EHOME_SCHEDULE_SNAPSHOT_V320.MAINTENANCE_HANDLER).timeBased().everyMinutes(EHOME_SCHEDULE_SNAPSHOT_V320.EVERY_MINUTES).create();
  var structure = buildStructureSnapshotV320();
  var queued = queueAllScheduleSnapshotsV320();
  var first = processScheduleSnapshotQueueV320(EHOME_SCHEDULE_SNAPSHOT_V320.SOURCES_PER_RUN);
  var result = {success:true,version:EHOME_SCHEDULE_SNAPSHOT_V320.VERSION,triggerEveryMinutes:EHOME_SCHEDULE_SNAPSHOT_V320.EVERY_MINUTES,removedOldTriggers:removed,structure:{total:structure.total,ok:structure.ok,warning:structure.warning,error:structure.error},queued:queued.queued,firstRun:first};
  Logger.log(JSON.stringify({code:"SNAPSHOT_ENGINE_INSTALLED_V320",result:result}));
  try { SpreadsheetApp.getActiveSpreadsheet().toast("Snapshot đã cài · Queue còn " + Number(first.pending || 0) + " nguồn","EHOME Snapshot",8); } catch(ignore) {}
  return result;
}

function rebuildAllSnapshotsV320() {
  var structure = buildStructureSnapshotV320();
  var queue = queueAllScheduleSnapshotsV320();
  var first = processScheduleSnapshotQueueV320(EHOME_SCHEDULE_SNAPSHOT_V320.SOURCES_PER_RUN);
  return {success:true,structure:structure,queue:queue,first:first};
}

function getSnapshotStatusV320() {
  var props = PropertiesService.getScriptProperties();
  var result = {success:true,structure:getStructureSnapshotSummaryV320(),schedule:getScheduleSnapshotSummaryV320(),triggerCount:ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()===EHOME_SCHEDULE_SNAPSHOT_V320.MAINTENANCE_HANDLER;}).length,scheduleEnabled:String(props.getProperty(EHOME_SCHEDULE_SNAPSHOT_V320.ENABLED_PROP)||"0")==="1",abPass:String(props.getProperty(EHOME_SCHEDULE_SNAPSHOT_V320.AB_PASS_PROP)||"0")==="1"};
  Logger.log(JSON.stringify({code:"SNAPSHOT_STATUS_V320",result:{structure:{total:result.structure.total,ok:result.structure.ok,warning:result.structure.warning,error:result.structure.error},schedule:result.schedule,triggerCount:result.triggerCount}}));
  return result;
}

function testScheduleSnapshotReadV320(villaSelector, checkIn, checkOut, guests) {
  var villas = ceReadMasterVillas_();
  var wanted = typeof opsNormV312_ === "function" ? opsNormV312_(villaSelector || "") : String(villaSelector || "").toLowerCase();
  var villa = null;
  for (var i=0;i<villas.length;i++) {
    var n = typeof opsNormV312_ === "function" ? opsNormV312_(villas[i].name) : String(villas[i].name||"").toLowerCase();
    var id = typeof opsNormV312_ === "function" ? opsNormV312_(villas[i].id) : String(villas[i].id||"").toLowerCase();
    if (n===wanted || id===wanted || n.indexOf(wanted)>=0) { villa=villas[i]; break; }
  }
  if (!villa) throw new Error("VILLA_NOT_FOUND");
  var start=ceParseInputDate_(checkIn), end=ceParseInputDate_(checkOut);
  var nights=ceListNights_(start,end);
  var ctx=ssLoadScheduleSnapshotContextV320_(true,nights);
  var result=ssTryReadVillaSnapshotV320_(ctx,villa,nights,Number(guests||1));
  Logger.log(JSON.stringify({code:"SCHEDULE_SNAPSHOT_READ_TEST_V320",villa:villa.name,result:result,stats:{hits:ctx.hits,misses:ctx.misses,stale:ctx.stale,errorCells:ctx.errorCells}}));
  return result;
}


function ssSnapshotComparableResultV320_(r) {
  r = r || {};
  return {
    available:r.available === true,
    priceStatus:String(r.priceStatus || ""),
    totalPrice:r.totalPrice === null || r.totalPrice === undefined ? null : Number(r.totalPrice),
    nights:(r.nightlyPrices || []).map(function(n){
      return {date:String(n.date || ""),price:n.price === null || n.price === undefined ? null : Number(n.price)};
    })
  };
}

function testSnapshotABV320(checkIn, checkOut, guests, limit) {
  var start = ceParseInputDate_(checkIn);
  var end = ceParseInputDate_(checkOut);
  if (!start || !end || end.getTime() <= start.getTime()) throw new Error("INVALID_DATE_RANGE");
  var nights = ceListNights_(start,end);
  var guestCount = Math.max(1,Number(guests || 1));
  var max = Math.max(1,Math.min(60,Number(limit || 20)));
  var villas = ceReadMasterVillas_();
  var snapshotCtx = ssLoadScheduleSnapshotContextV320_(true,nights);
  var liveContexts = {};
  var compared = 0, skipped = 0, mismatches = [];

  for (var i=0;i<villas.length && compared<max;i++) {
    var villa=villas[i];
    var snap=ssTryReadVillaSnapshotV320_(snapshotCtx,villa,nights,guestCount);
    if (!snap || !snap.usable) { skipped++; continue; }
    var url=String(villa.calendarUrl||"");
    if (!liveContexts[url]) {
      try {
        var opened=ceOpenSpreadsheetFastV23_(url);
        liveContexts[url]=ceCreateSourceContextV30_(opened,{source:villa.source||"",candidates:1,maxColumn:Number(villa.sourceColumn||0),requiresFullScan:Number(villa.sourceColumn||0)<=0});
      } catch (e) {
        var msg = String(e && e.message ? e.message : e);
        var classify = saClassifyAccessErrorV1_(msg);
        if (classify === "NO_ACCESS") {
          Logger.log("[SnapshotAB] Permission denied for " + villa.source + ": " + msg);
          skipped++;
          continue;  // Skip villa này, không compare
        }
        throw e;
      }
    }
    var live=ceReadVillaByReader_("COLUMN_V1",liveContexts[url],villa,nights,guestCount,false);
    var a=ssSnapshotComparableResultV320_(snap.readResult);
    var b=ssSnapshotComparableResultV320_(live);
    if (JSON.stringify(a)!==JSON.stringify(b)) {
      mismatches.push({villa:villa.name,source:villa.source,snapshot:a,live:b});
    }
    compared++;
  }

  var pass = compared > 0 && mismatches.length === 0;
  PropertiesService.getScriptProperties().setProperty(EHOME_SCHEDULE_SNAPSHOT_V320.AB_PASS_PROP,pass?"1":"0");
  var result={success:pass,pass:pass,compared:compared,skipped:skipped,mismatchCount:mismatches.length,mismatches:mismatches.slice(0,10),checkIn:ssDateKeyV320_(start),checkOut:ssDateKeyV320_(end),guests:guestCount};
  Logger.log(JSON.stringify({code:pass?"SNAPSHOT_AB_PASS_V320":"SNAPSHOT_AB_FAIL_V320",result:result}));
  return result;
}

function enableScheduleSnapshotV320() {
  var props=PropertiesService.getScriptProperties();
  if (String(props.getProperty(EHOME_SCHEDULE_SNAPSHOT_V320.AB_PASS_PROP)||"0")!=="1") {
    throw new Error("Chưa có SNAPSHOT_AB_PASS_V320. Chạy testSnapshotABV320() trước.");
  }
  props.setProperty(EHOME_SCHEDULE_SNAPSHOT_V320.ENABLED_PROP,"1");
  Logger.log(JSON.stringify({code:"SCHEDULE_SNAPSHOT_ENABLED_V320"}));
  try{SpreadsheetApp.getActiveSpreadsheet().toast("Schedule Snapshot đã bật cho Web","EHOME Snapshot",6);}catch(ignore){}
  return {success:true,enabled:true};
}

function disableScheduleSnapshotV320() {
  PropertiesService.getScriptProperties().setProperty(EHOME_SCHEDULE_SNAPSHOT_V320.ENABLED_PROP,"0");
  Logger.log(JSON.stringify({code:"SCHEDULE_SNAPSHOT_DISABLED_V320"}));
  return {success:true,enabled:false};
}

function testSnapshotABDefaultV320() {
  var start = ssDateAddV320_(ssTodayV320_(), 1);
  var end = ssDateAddV320_(start, 2);
  return testSnapshotABV320(
    ssDateKeyV320_(start),
    ssDateKeyV320_(end),
    10,
    20
  );
}
