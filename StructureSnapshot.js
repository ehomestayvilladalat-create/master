/**
 * 30_StructureSnapshot.gs - EHOME V3.2.0 STRUCTURE SNAPSHOT
 *
 * Mục tiêu:
 * - Ghi nhớ cấu trúc tốt gần nhất của từng nguồn.
 * - So sánh cấu trúc hiện tại với baseline để phát hiện chủ nguồn đổi hàng/cột.
 * - Không tự sửa CONFIG. Chỉ chẩn đoán + gợi ý.
 * - Không thay CalendarReader/Search/Master logic.
 */

var EHOME_STRUCTURE_SNAPSHOT_V320 = {
  VERSION: "3.4.1-health-auto-detect",
  SHEET: "STRUCTURE_SNAPSHOT_V1",
  CHECK_INTERVAL_MINUTES: 60,
  MAX_RUNTIME_MS: 180000,
  MAX_SOURCES_PER_RUN: 6,
  LAST_RUN_PROP: "EHOME_STRUCTURE_SNAPSHOT_LAST_RUN_V320",
  CURSOR_PROP: "EHOME_STRUCTURE_SNAPSHOT_CURSOR_V320",
  CONFIRM_READS: 2,
  PRIORITY_QUEUE_PROP: "EHOME_STRUCTURE_PRIORITY_QUEUE_V340",
  PRIORITY_PER_MAINTENANCE: 2,
  PRIORITY_MAX_ATTEMPTS: 6,
  PRIORITY_ITEM_ESTIMATE_MS: 20000,
  STRUCTURE_ITEM_ESTIMATE_MS: 20000
};

function ssStructNormV320_(value) {
  if (typeof opsNormV312_ === "function") return opsNormV312_(value);
  if (typeof ceNormalize_ === "function") return ceNormalize_(value);
  return String(value == null ? "" : value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function ssStructureSourceKeyV320_(source) {
  source = source || {};
  var id = String(source.id || "").trim();
  if (id) return "ID:" + id.toUpperCase();
  var fileId = typeof ssExtractSpreadsheetIdV320_ === "function"
    ? ssExtractSpreadsheetIdV320_(source.link || "")
    : "";
  if (fileId) return "FILE:" + fileId;
  return "SOURCE:" + ssStructNormV320_(source.source || "");
}

function ssEnsureStructureSnapshotSheetV320_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(EHOME_STRUCTURE_SNAPSHOT_V320.SHEET) ||
    ss.insertSheet(EHOME_STRUCTURE_SNAPSHOT_V320.SHEET);
  var headers = [
    "SOURCE KEY", "ID", "THÀNH PHỐ", "NGUỒN", "LINK",
    "STATUS", "CHECKED AT", "BASELINE AT",
    "BASELINE JSON", "CURRENT JSON", "ISSUES JSON"
  ];
  var current = sh.getLastRow() >= 1
    ? sh.getRange(1,1,1,Math.max(sh.getLastColumn(), headers.length)).getDisplayValues()[0]
    : [];
  if (!current.length || ssStructNormV320_(current[0]) !== "source key") {
    sh.clearContents();
    sh.getRange(1,1,1,headers.length).setValues([headers]);
  } else if (sh.getLastColumn() < headers.length) {
    sh.getRange(1,1,1,headers.length).setValues([headers]);
  }
  sh.setFrozenRows(1);
  return sh;
}

function ssReadStructureSnapshotRowsV320_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EHOME_STRUCTURE_SNAPSHOT_V320.SHEET);
  var result = {};
  if (!sh || sh.getLastRow() < 2) return result;
  var values = sh.getDataRange().getDisplayValues();
  for (var r = 1; r < values.length; r++) {
    var row = values[r] || [];
    var key = String(row[0] || "").trim();
    if (!key) continue;
    result[key] = {
      key:key,
      id:String(row[1] || ""),
      city:String(row[2] || ""),
      source:String(row[3] || ""),
      link:String(row[4] || ""),
      status:String(row[5] || ""),
      checkedAt:String(row[6] || ""),
      baselineAt:String(row[7] || ""),
      baselineJson:String(row[8] || ""),
      currentJson:String(row[9] || ""),
      issuesJson:String(row[10] || "")
    };
  }
  return result;
}


/**
 * V3.4.0 PRIORITY STRUCTURE CHECK
 * Nguồn vừa bị Drive đánh dấu modified được kiểm tra trước vòng round-robin 148 nguồn.
 * Queue chỉ lưu metadata nhỏ trong Script Properties; không lưu lịch/ảnh.
 */
function ssReadPriorityStructureQueueV340_() {
  var raw = PropertiesService.getScriptProperties().getProperty(
    EHOME_STRUCTURE_SNAPSHOT_V320.PRIORITY_QUEUE_PROP
  ) || "";
  try {
    var parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (ignore) {
    return [];
  }
}

function ssWritePriorityStructureQueueV340_(items) {
  items = Array.isArray(items) ? items : [];
  var props = PropertiesService.getScriptProperties();
  if (!items.length) {
    props.deleteProperty(EHOME_STRUCTURE_SNAPSHOT_V320.PRIORITY_QUEUE_PROP);
    return [];
  }
  // Script Properties có quota; queue này chỉ cần giữ một số nguồn thay đổi gần nhất.
  items = items.slice(0, 60);
  props.setProperty(EHOME_STRUCTURE_SNAPSHOT_V320.PRIORITY_QUEUE_PROP, JSON.stringify(items));
  return items;
}

function ssEnqueuePriorityStructureCheckV340_(source, reason) {
  source = source || {};
  if (!source.link) return {queued:false,reason:"MISSING_LINK"};
  var key = ssStructureSourceKeyV320_(source);
  var queue = ssReadPriorityStructureQueueV340_();
  var found = null;
  queue.forEach(function(item){ if (String(item.key || "") === key) found = item; });
  var now = new Date().toISOString();
  if (found) {
    found.id = String(source.id || found.id || "");
    found.source = String(source.source || found.source || "");
    found.city = String(source.city || found.city || "");
    found.link = String(source.link || found.link || "");
    found.reason = String(reason || found.reason || "SOURCE_MODIFIED");
    found.lastRequestedAt = now;
  } else {
    queue.push({
      key:key,
      id:String(source.id || ""),
      source:String(source.source || ""),
      city:String(source.city || ""),
      link:String(source.link || ""),
      reason:String(reason || "SOURCE_MODIFIED"),
      requestedAt:now,
      lastRequestedAt:now,
      attempts:0
    });
  }
  ssWritePriorityStructureQueueV340_(queue);
  return {queued:true,key:key,queueLength:queue.length};
}

function ssResolvePrioritySourceV340_(item) {
  item = item || {};
  if (typeof opsListMasterSourcesV312_ !== "function") return item;
  var sources = opsListMasterSourcesV312_(true).sources || [];
  var wantedId = ssStructNormV320_(item.id || "");
  var wantedFileId = typeof ssExtractSpreadsheetIdV320_ === "function"
    ? ssExtractSpreadsheetIdV320_(item.link || "") : "";
  var wantedName = ssStructNormV320_(item.source || "");
  for (var i=0; i<sources.length; i++) {
    var source = sources[i] || {};
    var id = ssStructNormV320_(source.id || "");
    var fileId = typeof ssExtractSpreadsheetIdV320_ === "function"
      ? ssExtractSpreadsheetIdV320_(source.link || "") : "";
    var name = ssStructNormV320_(source.source || "");
    if ((wantedId && id === wantedId) ||
        (wantedFileId && fileId === wantedFileId) ||
        (wantedName && name === wantedName)) {
      return source;
    }
  }
  return null;
}

function ssWriteOneStructureSnapshotRowV340_(source, status, checkedAt, baselineAt, baseline, current, issues) {
  var sh = ssEnsureStructureSnapshotSheetV320_();
  var key = ssStructureSourceKeyV320_(source);
  var targetRow = 0;
  if (sh.getLastRow() >= 2) {
    var keys = sh.getRange(2,1,sh.getLastRow()-1,1).getDisplayValues();
    for (var i=0; i<keys.length; i++) {
      if (String(keys[i][0] || "") === key) { targetRow = i + 2; break; }
    }
  }
  if (!targetRow) targetRow = sh.getLastRow() + 1;
  sh.getRange(targetRow,1,1,11).setValues([[
    key,
    String(source.id || ""),
    String(source.city || ""),
    String(source.source || ""),
    String(source.link || ""),
    String(status || "ERROR"),
    String(checkedAt || ""),
    String(baselineAt || ""),
    JSON.stringify(baseline || {}),
    JSON.stringify(current || {}),
    JSON.stringify(issues || [])
  ]]);
  EHOME_STRUCTURE_RUNTIME_INDEX_V340_ = null;
  return targetRow;
}

function ssRefreshOneStructureSourceV340_(source) {
  source = source || {};
  var key = ssStructureSourceKeyV320_(source);
  var old = ssReadStructureSnapshotRowsV320_();
  var previous = old[key] || {};
  var baseline = ssJsonParseSafeV320_(previous.baselineJson, null);
  var previousCurrent = ssJsonParseSafeV320_(previous.currentJson, {});
  var current = null;
  var compare = null;
  var nowIso = new Date().toISOString();
  var baselineAt = previous.baselineAt || "";

  try {
    current = ssInspectSourceStructureV320_(source, {skipEvidence:true});
    if (baseline) {
      current.imageDetected = Number(baseline.imageDetected || 0);
      current.infoDetected = Number(baseline.infoDetected || 0);
    }
    if (!baseline) {
      baseline = ssPromoteCurrentToBaselineV340_(current);
      baselineAt = nowIso;
      compare = {status:"BASELINE",issues:[]};
    } else {
      compare = ssCompareStructureV320_(baseline, current);
      ssApplyChangeConfirmationV340_(previousCurrent, current, compare, nowIso);
      if (compare.status === "OK") {
        baseline = ssPromoteCurrentToBaselineV340_(current);
        baselineAt = nowIso;
      }
    }
    ssApplyStableReadValidationV340_(previousCurrent, current);
  } catch (error) {
    current = {error:String(error && error.message ? error.message : error)};
    compare = {status:"ERROR",issues:[{
      level:"ERROR",code:"STRUCTURE_READ_FAILED",message:current.error,
      suggestion:"Kiểm tra quyền truy cập / link nguồn / sheet lịch."
    }]};
  }

  var status = compare.status === "BASELINE" ? "OK" : compare.status;
  ssWriteOneStructureSnapshotRowV340_(
    source,status,nowIso,baselineAt,baseline,current,compare.issues || []
  );

  return {
    success:!current.error,
    key:key,
    source:String(source.source || ""),
    status:status,
    validationReads:Number(current._validationReads || 0),
    stableReads:Number(current._stableReads || 0),
    structureConfirmed:current._structureConfirmed === true,
    effectiveVillaCount:Number(
      current.effectiveVillaCount != null ? current.effectiveVillaCount : current.villaCount || 0
    ),
    error:String(current.error || "")
  };
}

function ssQueuePriorityConfirmedRowsV340_(completedSources) {
  completedSources = Array.isArray(completedSources) ? completedSources : [];
  if (!completedSources.length || typeof getMasterIncrementalPlanV328 !== "function") {
    return {queuedRows:[]};
  }

  var wanted = {};
  completedSources.forEach(function(source){
    var id = ssStructNormV320_(source.id || "");
    var fileId = typeof ssExtractSpreadsheetIdV320_ === "function"
      ? ssExtractSpreadsheetIdV320_(source.link || "") : "";
    var name = ssStructNormV320_(source.source || "");
    if (id) wanted["ID:" + id] = true;
    if (fileId) wanted["FILE:" + fileId] = true;
    if (name) wanted["SOURCE:" + name] = true;
  });

  var plan = getMasterIncrementalPlanV328({log:false});
  var rows = [];
  (plan.rows || []).forEach(function(item){
    var id = ssStructNormV320_(item.id || "");
    var fileId = typeof ssExtractSpreadsheetIdV320_ === "function"
      ? ssExtractSpreadsheetIdV320_(item.link || "") : "";
    var name = ssStructNormV320_(item.source || "");
    var match = (id && wanted["ID:" + id]) ||
      (fileId && wanted["FILE:" + fileId]) ||
      (name && wanted["SOURCE:" + name]);
    if (match && (item.reasons || []).length) rows.push(Number(item.row));
  });

  rows = rows.filter(function(n,i,a){ return n >= 2 && a.indexOf(n) === i; });
  if (rows.length && typeof beAdminSetPendingRowsV328_ === "function") {
    var pending = typeof beAdminPendingRowsV328_ === "function" ? beAdminPendingRowsV328_() : [];
    beAdminSetPendingRowsV328_((pending || []).concat(rows));
    if (typeof beAdminScheduleIncrementalWorkerV328_ === "function") {
      beAdminScheduleIncrementalWorkerV328_();
    }
  }
  return {queuedRows:rows};
}

function processPriorityStructureChecksV340_(maxSources, options) {
  var queue = ssReadPriorityStructureQueueV340_();
  if (!queue.length) return {success:true,processed:0,pending:0,queuedRows:[]};
  maxSources = Math.max(1, Number(
    maxSources || EHOME_STRUCTURE_SNAPSHOT_V320.PRIORITY_PER_MAINTENANCE || 2
  ));
  // BƯỚC A: deadlineMs là mốc kết thúc của cả lần chạy. Mục chỉ bắt đầu khi
  // dự kiến (thời gian mục lâu nhất đã soi, tối thiểu PRIORITY_ITEM_ESTIMATE_MS) xong trước mốc.
  var deadlineMs = Number(options && options.deadlineMs || 0);
  var itemEstimateMs = 0;
  var deferredByBudget = 0;
  var maxAttempts = Math.max(2, Number(EHOME_STRUCTURE_SNAPSHOT_V320.PRIORITY_MAX_ATTEMPTS || 6));
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return {success:true,skipped:true,reason:"LOCKED",pending:queue.length};

  var processed = [];
  var completed = [];
  try {
    var next = [];
    for (var i=0; i<queue.length; i++) {
      var item = queue[i] || {};
      if (processed.length >= maxSources) { next.push(item); continue; }
      if (deadlineMs) {
        var expectedItemMs = Math.max(itemEstimateMs, Number(EHOME_STRUCTURE_SNAPSHOT_V320.PRIORITY_ITEM_ESTIMATE_MS || 20000));
        if (new Date().getTime() + expectedItemMs > deadlineMs) { next.push(item); deferredByBudget++; continue; }
      }
      var itemStartedMs = new Date().getTime();
      item.attempts = Number(item.attempts || 0) + 1;
      item.lastAttemptAt = new Date().toISOString();
      var liveSource = ssResolvePrioritySourceV340_(item);
      var result = liveSource
        ? ssRefreshOneStructureSourceV340_(liveSource)
        : {success:false,key:item.key,source:item.source,status:"ERROR",validationReads:0,stableReads:0,structureConfirmed:false,effectiveVillaCount:0,error:"SOURCE_NOT_FOUND"};
      processed.push(result);
      itemEstimateMs = Math.max(itemEstimateMs, new Date().getTime() - itemStartedMs);

      var enoughReads = result.success === true && Number(result.validationReads || 0) >=
        Math.max(2, Number(EHOME_STRUCTURE_SNAPSHOT_V320.CONFIRM_READS || 2));
      if (enoughReads) {
        completed.push(liveSource || item);
      } else if (item.attempts < maxAttempts) {
        next.push(item);
      } else {
        Logger.log(JSON.stringify({
          code:"STRUCTURE_PRIORITY_GAVE_UP_V340",source:item.source,key:item.key,
          attempts:item.attempts,lastError:result.error || "NOT_STABLE"
        }));
      }
    }
    ssWritePriorityStructureQueueV340_(next);
  } finally {
    lock.releaseLock();
  }

  var queued = ssQueuePriorityConfirmedRowsV340_(completed);
  var resultOut = {
    success:true,
    processed:processed.length,
    completed:completed.length,
    pending:ssReadPriorityStructureQueueV340_().length,
    queuedRows:queued.queuedRows || [],
    results:processed,
    deferredByBudget:deferredByBudget
  };
  Logger.log(JSON.stringify({code:"STRUCTURE_PRIORITY_PROCESSED_V340",result:resultOut}));
  return resultOut;
}

function getPriorityStructureQueueStatusV340() {
  var queue = ssReadPriorityStructureQueueV340_();
  return {success:true,pending:queue.length,items:queue};
}

function ssJsonParseSafeV320_(text, fallback) {
  try { return text ? JSON.parse(text) : fallback; }
  catch (ignore) { return fallback; }
}

function ssHashTextV320_(value) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ""),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, "").slice(0, 22);
}

function ssStructureNamesSignatureV320_(villas) {
  var parts = (villas || []).map(function(v) {
    return ssStructNormV320_(v && v.name || "") + "@" + Number(v && v.sourceColumn || 0);
  }).filter(String).sort();
  return ssHashTextV320_(parts.join("|"));
}

function ssStructureNameSetV320_(villas) {
  var map = {};
  (villas || []).forEach(function(v) {
    var k = ssStructNormV320_(v && v.name || "");
    if (k) map[k] = true;
  });
  return map;
}

function ssStructureSetDiffRatioV320_(a, b) {
  a = a || {}; b = b || {};
  var keys = {};
  Object.keys(a).forEach(function(k){ keys[k] = true; });
  Object.keys(b).forEach(function(k){ keys[k] = true; });
  var all = Object.keys(keys);
  if (!all.length) return 0;
  var diff = all.filter(function(k){ return !!a[k] !== !!b[k]; }).length;
  return diff / all.length;
}


function ssStructureDetectedRowVillasV340_(values, detection, config) {
  values = values || [];
  detection = detection || {};
  config = config || {};
  var rowIndex = Number(detection.row);
  if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= values.length) return [];

  var seen = {};
  var villas = [];
  (detection.villaColumns || []).forEach(function(columnIndex) {
    columnIndex = Number(columnIndex);
    if (!Number.isInteger(columnIndex) || columnIndex < 0) return;
    var raw = values[rowIndex] && columnIndex < values[rowIndex].length
      ? values[rowIndex][columnIndex]
      : "";
    var name = "";
    try {
      name = sanitizeMasterVillaNameFromKnownRow(raw, config, values, rowIndex, columnIndex);
    } catch (ignoreSanitize) {
      name = cleanMasterVillaName(raw);
    }
    name = String(name || "").trim();
    var key = ssStructNormV320_(name);
    if (!key || seen[key]) return;
    seen[key] = true;
    villas.push({name:name, sourceColumn:columnIndex + 1});
  });
  return villas;
}

// V421: Bỏ qua cột đang ẩn khi đếm căn trong bộ kiểm tra cấu trúc.
// Cột ẩn = chủ nguồn đã ẩn căn (thường là căn không còn bán); khách web cũng không thấy.
function ssHiddenVillaColumnMapV421_(sheet) {
  var map = {};
  try {
    var maxCols = Number(sheet.getMaxColumns() || 0);
    for (var c = 1; c <= maxCols; c++) {
      try {
        if (sheet.isColumnHiddenByUser(c) === true) map[c] = true;
      } catch (ignoreOneCol) {}
    }
  } catch (ignoreMapErr) {
    // Không đọc được trạng thái ẩn thì giữ hành vi cũ (không lọc).
  }
  return map;
}

function ssDropHiddenVillasV421_(villas, hiddenMap) {
  villas = villas || [];
  hiddenMap = hiddenMap || {};
  return villas.filter(function(v) {
    var col = Number(v && v.sourceColumn || 0);
    return !(col > 0 && hiddenMap[col] === true);
  });
}

function ssHiddenVillaNamesV421_(villas, hiddenMap) {
  villas = villas || [];
  hiddenMap = hiddenMap || {};
  return villas.filter(function(v) {
    var col = Number(v && v.sourceColumn || 0);
    return col > 0 && hiddenMap[col] === true;
  }).map(function(v) { return String(v.name || ""); });
}

function ssStructureSimilarityV340_(baselineSet, candidateSet) {
  baselineSet = baselineSet || {};
  candidateSet = candidateSet || {};
  var before = Object.keys(baselineSet);
  var after = Object.keys(candidateSet);
  if (!before.length || !after.length) {
    return {intersection:0,coverage:0,precision:0,score:0};
  }
  var hit = before.filter(function(k){ return !!candidateSet[k]; }).length;
  var coverage = hit / before.length;
  var precision = hit / after.length;
  var score = (coverage + precision) > 0
    ? (2 * coverage * precision) / (coverage + precision)
    : 0;
  return {
    intersection:hit,
    coverage:coverage,
    precision:precision,
    score:score
  };
}

function ssResolveEffectiveStructureV340_(baseline, current) {
  baseline = baseline || {};
  current = current || {};

  var effective = {
    villaCount:Number(current.villaCount || 0),
    nameSet:current.nameSet || {},
    namesSignature:String(current.namesSignature || ""),
    firstVillaColumn:Number(current.firstVillaColumn || 0),
    lastVillaColumn:Number(current.lastVillaColumn || 0),
    adaptiveNameRow:0,
    adaptive:false,
    adaptivePersisted:false,
    configuredSimilarity:ssStructureSimilarityV340_(baseline.nameSet || {}, current.nameSet || {}),
    autoSimilarity:ssStructureSimilarityV340_(baseline.nameSet || {}, current.autoNameSet || {})
  };

  if (
    String(current.nameMode || "") !== "FIXED_ROW" ||
    Number(current.autoNameRow || 0) <= 0 ||
    Number(current.autoVillaCount || 0) <= 0
  ) {
    return effective;
  }

  var configuredRow = Number(current.configuredNameRow || 0);
  var autoRow = Number(current.autoNameRow || 0);
  var persistedRow = Number(baseline.runtimeNameRow || 0);
  var autoSim = effective.autoSimilarity;
  var configuredSim = effective.configuredSimilarity;

  // Một auto-row đã được xác nhận/rebuild ở vòng trước là runtime truth.
  if (persistedRow > 0 && autoRow === persistedRow) {
    effective.adaptiveNameRow = autoRow;
    effective.adaptive = true;
    effective.adaptivePersisted = true;
  } else if (autoRow !== configuredRow && Object.keys(baseline.nameSet || {}).length) {
    // Chỉ tự đề xuất row mới khi vừa phủ được phần lớn baseline, vừa không kéo
    // theo quá nhiều ô rác. Điều này tránh các false-positive kiểu hàng tiêu đề.
    var strongAuto =
      autoSim.coverage >= 0.75 &&
      autoSim.precision >= 0.70 &&
      autoSim.score >= 0.78;

    var materiallyBetter =
      autoSim.score >= configuredSim.score + 0.12 ||
      Number(current.villaCount || 0) <= 0;

    if (strongAuto && materiallyBetter) {
      effective.adaptiveNameRow = autoRow;
      effective.adaptive = true;
    }
  }

  if (effective.adaptive) {
    effective.villaCount = Number(current.autoVillaCount || 0);
    effective.nameSet = current.autoNameSet || {};
    effective.namesSignature = String(current.autoNamesSignature || "");
    effective.firstVillaColumn = Number(current.autoFirstVillaColumn || 0);
    effective.lastVillaColumn = Number(current.autoLastVillaColumn || 0);
  }

  return effective;
}

function ssStructureChangeFingerprintV340_(current) {
  current = current || {};
  var set = current.effectiveNameSet || current.nameSet || {};
  var names = Object.keys(set).sort();
  return ssHashTextV320_([
    String(Number(current.effectiveVillaCount != null ? current.effectiveVillaCount : current.villaCount || 0)),
    names.join("|"),
    String(current.effectiveNamesSignature || current.namesSignature || ""),
    String(Number(current.adaptiveNameRow || 0))
  ].join("::"));
}

function ssHasStructuralIssueV340_(compare) {
  var structural = {
    SOURCE_ZERO_VILLAS:true,
    NAME_ROW_DRIFT:true,
    VILLA_COUNT_DROPPED:true,
    VILLA_COUNT_CHANGED:true,
    VILLA_NAME_SET_CHANGED:true,
    VILLA_COLUMNS_CHANGED:true
  };
  return (compare && compare.issues || []).some(function(issue){
    return !!structural[String(issue && issue.code || "")];
  });
}

function ssApplyStableReadValidationV340_(previousCurrent, current) {
  previousCurrent = previousCurrent || {};
  current = current || {};
  if (current.error) return {stableReads:0,valid:false};
  var fingerprint = ssStructureChangeFingerprintV340_(current);
  var previousFingerprint = String(previousCurrent._validationFingerprint || "");
  var previousReads = Number(previousCurrent._validationReads || 0);
  var reads = previousFingerprint === fingerprint ? previousReads + 1 : 1;
  current._validationFingerprint = fingerprint;
  current._validationReads = reads;
  return {stableReads:reads,valid:true,fingerprint:fingerprint};
}

function ssApplyChangeConfirmationV340_(previousCurrent, current, compare, nowIso) {
  previousCurrent = previousCurrent || {};
  current = current || {};
  if (!ssHasStructuralIssueV340_(compare)) {
    delete current._pendingFingerprint;
    delete current._stableReads;
    delete current._structureConfirmed;
    delete current._confirmedAt;
    return {confirmed:false,stableReads:0};
  }

  var fingerprint = ssStructureChangeFingerprintV340_(current);
  var previousFingerprint = String(previousCurrent._pendingFingerprint || "");
  var previousReads = Number(previousCurrent._stableReads || 0);
  var stableReads = previousFingerprint === fingerprint ? previousReads + 1 : 1;
  var required = Math.max(2, Number(EHOME_STRUCTURE_SNAPSHOT_V320.CONFIRM_READS || 2));
  var confirmed = stableReads >= required;

  current._pendingFingerprint = fingerprint;
  current._stableReads = stableReads;
  current._structureConfirmed = confirmed;
  if (confirmed) current._confirmedAt = String(nowIso || new Date().toISOString());

  (compare.issues || []).forEach(function(issue){
    if (!issue || !issue.code) return;
    issue.details = issue.details || {};
    issue.details.stableReads = stableReads;
    issue.details.requiredReads = required;
    issue.details.confirmed = confirmed;
  });

  return {confirmed:confirmed,stableReads:stableReads,fingerprint:fingerprint};
}

function ssPromoteCurrentToBaselineV340_(current) {
  var baseline = {};
  current = current || {};
  Object.keys(current).forEach(function(k){
    if (k.indexOf("_") === 0) return;
    baseline[k] = current[k];
  });

  if (Number(current.adaptiveNameRow || 0) > 0) {
    baseline.runtimeNameRow = Number(current.adaptiveNameRow || 0);
    baseline.villaCount = Number(current.effectiveVillaCount || current.autoVillaCount || current.villaCount || 0);
    baseline.nameSet = current.effectiveNameSet || current.autoNameSet || current.nameSet || {};
    baseline.namesSignature = String(current.effectiveNamesSignature || current.autoNamesSignature || current.namesSignature || "");
    baseline.firstVillaColumn = Number(current.effectiveFirstVillaColumn || current.autoFirstVillaColumn || current.firstVillaColumn || 0);
    baseline.lastVillaColumn = Number(current.effectiveLastVillaColumn || current.autoLastVillaColumn || current.lastVillaColumn || 0);
  } else {
    delete baseline.runtimeNameRow;
  }

  return baseline;
}

function ssInspectSourceStructureV320_(source, options) {
  var started = new Date().getTime();
  source = source || {};
  options = options || {};
  var out = {
    source:String(source.source || ""),
    city:String(source.city || ""),
    mainSheet:"",
    mainSheetId:0,
    nameMode:"",
    configuredNameRow:0,
    configuredValidCount:0,
    autoNameRow:0,
    autoValidCount:0,
    autoVillaCount:0,
    autoFirstVillaColumn:0,
    autoLastVillaColumn:0,
    autoNamesSignature:"",
    autoNameSet:{},
    villaCount:0,
    firstVillaColumn:0,
    lastVillaColumn:0,
    namesSignature:"",
    nameSet:{},
    imageDetected:0,
    infoDetected:0,
    elapsedMs:0
  };

  if (!source.link) throw new Error("SOURCE_LINK_MISSING");
  var file = beOpenSourceSpreadsheetV_FIX(source.link);  // FIX: hỗ trợ nguồn .xlsx
  var selectionV4210 = typeof beMasterCalendarSelectionV4210_ === "function"
    ? beMasterCalendarSelectionV4210_(file, source.configCalendar || "AUTO", new Date())
    : {sheet:findLatestMasterCalendarSheet(file),inactiveWindow:false,mode:"LEGACY"};
  var sheet = selectionV4210.sheet;
  if (!sheet) {
    if (selectionV4210.inactiveWindow === true) {
      out.inactiveCalendarWindow = true;
      out.calendarSelectionMode = selectionV4210.mode || "INACTIVE_WINDOW";
      out.elapsedMs = new Date().getTime() - started;
      Logger.log(JSON.stringify({
        code:"STRUCTURE_INACTIVE_CALENDAR_WINDOW_V4210",
        source:out.source,city:out.city,
        elapsedMs:out.elapsedMs
      }));
      return out;
    }
    throw new Error("MAIN_CALENDAR_SHEET_NOT_FOUND");
  }

  out.calendarSelectionMode = selectionV4210.mode || "";
  out.mainSheet = sheet.getName();
  out.mainSheetId = Number(sheet.getSheetId() || 0);

  var runtime = beGetMasterSheetRuntimeDataV21_(sheet);
  var values = (runtime.display || []).map(function(row){ return row.slice(); });
  var formulas = (runtime.formulas || []).map(function(row){ return row.slice(); });
  if (!values.length) throw new Error("MAIN_CALENDAR_EMPTY");

  var masterConfig = parseMasterColumnConfig(source.configMaster || "");
  out.nameMode = String(masterConfig.nameMode || "AUTO_ROW");
  out.configuredNameRow = masterConfig.fixedNameRowIndex >= 0
    ? masterConfig.fixedNameRowIndex + 1
    : 0;

  if (masterConfig.fixedNameRowIndex >= 0) {
    overwriteMasterLinkedNameRow_(sheet, values, masterConfig.fixedNameRowIndex + 1);
  }

  var expanded = expandMasterMergedCells(
    sheet,
    values,
    formulas,
    runtime.mergedRanges || []
  );
  values = expanded.values;
  formulas = expanded.formulas;

  var configured = resolveMasterVillaNameRow(values, masterConfig);
  out.configuredValidCount = Number(configured && configured.validCount || 0);
  if (!out.configuredNameRow && configured && Number.isInteger(configured.row) && configured.row >= 0) {
    out.configuredNameRow = configured.row + 1;
  }

  var autoConfig = {
    nameMode:"AUTO_ROW",
    startColumnIndex:masterConfig.startColumnIndex,
    endColumnIndex:masterConfig.endColumnIndex,
    topRows:Math.max(Number(masterConfig.topRows || 20), 60),
    fixedNameRowIndex:-1,
    fallbackEnabled:true,
    minimumNamesInRow:Math.max(1, Number(masterConfig.minimumNamesInRow || 2)),
    minimumNameScore:Number(masterConfig.minimumNameScore || 18),
    excludedColumnIndexes:(masterConfig.excludedColumnIndexes || []).slice()
  };
  var autoDetected = detectMasterAutoVillaNameRow(values, autoConfig);
  out.autoNameRow = autoDetected && Number.isInteger(autoDetected.row) && autoDetected.row >= 0
    ? autoDetected.row + 1
    : 0;
  out.autoValidCount = Number(autoDetected && autoDetected.validCount || 0);

  var autoVillasV340 = ssStructureDetectedRowVillasV340_(values, autoDetected, autoConfig);
  var hiddenColsV421 = ssHiddenVillaColumnMapV421_(sheet);
  autoVillasV340 = ssDropHiddenVillasV421_(autoVillasV340, hiddenColsV421);
  out.autoVillaCount = autoVillasV340.length;
  var autoColsV340 = autoVillasV340.map(function(v){ return Number(v && v.sourceColumn || 0); })
    .filter(function(n){ return n > 0; });
  out.autoFirstVillaColumn = autoColsV340.length ? Math.min.apply(null, autoColsV340) : 0;
  out.autoLastVillaColumn = autoColsV340.length ? Math.max.apply(null, autoColsV340) : 0;
  out.autoNamesSignature = ssStructureNamesSignatureV320_(autoVillasV340);
  out.autoNameSet = ssStructureNameSetV320_(autoVillasV340);

  var calendarVillas = readMasterFromCalendarSheet(sheet, source.configMaster || "") || [];
  try { calendarVillas = beCollapseMergedVillaGroupsV38_(sheet, calendarVillas); } catch (ignoreMerge) {}
  try { calendarVillas = beCollapseAdjacentDuplicateVillaGroupsV411_(sheet, calendarVillas); } catch (ignoreAdjacent) {}
  calendarVillas = removeDuplicateMasterVillas(calendarVillas);
  out.hiddenSkippedNames = ssHiddenVillaNamesV421_(calendarVillas, hiddenColsV421);
  calendarVillas = ssDropHiddenVillasV421_(calendarVillas, hiddenColsV421);

  out.villaCount = calendarVillas.length;
  var cols = calendarVillas.map(function(v){ return Number(v && v.sourceColumn || 0); })
    .filter(function(n){ return n > 0; });
  out.firstVillaColumn = cols.length ? Math.min.apply(null, cols) : 0;
  out.lastVillaColumn = cols.length ? Math.max.apply(null, cols) : 0;
  out.namesSignature = ssStructureNamesSignatureV320_(calendarVillas);
  out.nameSet = ssStructureNameSetV320_(calendarVillas);

  if (options.skipEvidence === true) {
    // Priority check chỉ cần cấu trúc tên/cột. Không đọc ảnh + info mỗi lần chủ nhà
    // đổi một ô lịch, tránh tốn thời gian/quota. Full round-robin vẫn audit evidence.
    out.evidenceSkipped = true;
  } else {
    try {
      var imageCfg = beBuildInheritedMetadataConfigV37_(
        source.configMaster || "", source.configImage || "", "IMAGE"
      );
      var imageVillas = beReadInfoSheetV31_(sheet, imageCfg) || [];
      out.imageDetected = imageVillas.filter(function(v){
        return !!(v && (v.hasRealCellImage === true || v.imageSource || v.image));
      }).length;
    } catch (imageError) {
      out.imageReadError = String(imageError && imageError.message ? imageError.message : imageError);
    }

    try {
      var infoCfg = beBuildInheritedMetadataConfigV37_(
        source.configMaster || "", source.configInfo || "", "INFO"
      );
      var infoVillas = beReadInfoSheetV31_(sheet, infoCfg) || [];
      out.infoDetected = infoVillas.filter(function(v){
        return !!(v && (v.hasInfoEvidence === true || v.info || v.standard || v.bedrooms || v.maps));
      }).length;
    } catch (infoError) {
      out.infoReadError = String(infoError && infoError.message ? infoError.message : infoError);
    }
  }

  out.elapsedMs = new Date().getTime() - started;
  return out;
}

function ssStructureSetDiffV330_(beforeSet, currentSet) {
  beforeSet = beforeSet || {};
  currentSet = currentSet || {};
  var added = Object.keys(currentSet).filter(function(k){ return !beforeSet[k]; }).sort();
  var removed = Object.keys(beforeSet).filter(function(k){ return !currentSet[k]; }).sort();
  return {added:added, removed:removed};
}

function ssStructureShortNamesV330_(names, limit) {
  names = Array.isArray(names) ? names : [];
  limit = Math.max(1, Number(limit || 4));
  var shown = names.slice(0, limit);
  var text = shown.join(", ");
  if (names.length > limit) text += " +" + (names.length - limit) + " căn";
  return text;
}

function ssStructureNameSimilarityV341_(left, right) {
  var a = ssStructNormV320_(left || "");
  var b = ssStructNormV320_(right || "");
  if (!a || !b) return 0;
  if (a === b) return 1;

  if ((a.indexOf(b) === 0 || b.indexOf(a) === 0) && Math.min(a.length,b.length) >= 5) {
    return 0.92;
  }

  var stop = {villa:true,home:true,homestay:true,house:true,can:true,phong:true,da:true,lat:true,dalat:true};
  function tokens(s) {
    var seen={};
    return s.split(/\s+/).filter(function(t){
      if (!t || stop[t] || /^\d+$/.test(t)) return false;
      if (seen[t]) return false;
      seen[t]=true; return true;
    });
  }
  var ta=tokens(a), tb=tokens(b);
  if (!ta.length || !tb.length) return 0;
  var setB={}; tb.forEach(function(t){setB[t]=true;});
  var inter=ta.filter(function(t){return !!setB[t];}).length;
  var union={}; ta.concat(tb).forEach(function(t){union[t]=true;});
  var jaccard=inter/Math.max(1,Object.keys(union).length);
  var coverage=inter/Math.max(1,Math.min(ta.length,tb.length));
  return Math.max(jaccard,coverage*0.9);
}

function ssStructureLikelyLabelOnlyChangeV341_(baseline, effective, added, removed) {
  added = added || []; removed = removed || [];
  if (!added.length || added.length !== removed.length) return false;
  if (Number(baseline.firstVillaColumn||0)!==Number(effective.firstVillaColumn||0)) return false;
  if (Number(baseline.lastVillaColumn||0)!==Number(effective.lastVillaColumn||0)) return false;

  var unused=removed.slice();
  for (var i=0;i<added.length;i++) {
    var best=-1,bestScore=0;
    for (var j=0;j<unused.length;j++) {
      var score=ssStructureNameSimilarityV341_(added[i],unused[j]);
      if(score>bestScore){bestScore=score;best=j;}
    }
    if(best<0||bestScore<0.72)return false;
    unused.splice(best,1);
  }
  return true;
}

function ssCompareStructureV320_(baseline, current) {
  baseline = baseline || {};
  current = current || {};
  var issues = [];

  function push(level, code, message, suggestion, details) {
    var issue = {level:level, code:code, message:message, suggestion:suggestion || ""};
    if (details) issue.details = details;
    issues.push(issue);
  }

  var effective = ssResolveEffectiveStructureV340_(baseline, current);
  current.effectiveVillaCount = Number(effective.villaCount || 0);
  current.effectiveNameSet = effective.nameSet || {};
  current.effectiveNamesSignature = String(effective.namesSignature || "");
  current.effectiveFirstVillaColumn = Number(effective.firstVillaColumn || 0);
  current.effectiveLastVillaColumn = Number(effective.lastVillaColumn || 0);
  current.adaptiveNameRow = Number(effective.adaptiveNameRow || 0);
  current.adaptivePersisted = effective.adaptivePersisted === true;
  current.adaptiveSimilarity = {
    configured:effective.configuredSimilarity,
    auto:effective.autoSimilarity
  };

  if (Number(effective.villaCount || 0) <= 0) {
    push(
      "ERROR",
      "SOURCE_ZERO_VILLAS",
      "Không đọc được căn nào từ sheet lịch hiện tại.",
      "Giữ MASTER cũ. Chỉ cho phép gỡ sau 2 lần đọc thành công liên tiếp cùng kết quả."
    );
  }

  if (
    effective.adaptive === true &&
    effective.adaptivePersisted !== true &&
    Number(current.adaptiveNameRow || 0) > 0 &&
    Number(current.configuredNameRow || 0) > 0 &&
    Number(current.adaptiveNameRow || 0) !== Number(current.configuredNameRow || 0)
  ) {
    push(
      Number(current.villaCount || 0) <= 0 ? "ERROR" : "WARNING",
      "NAME_ROW_DRIFT",
      "Hàng tên cấu hình " + Number(current.configuredNameRow || 0) +
        " đã lệch; AUTO nhận diện an toàn hàng " + Number(current.adaptiveNameRow || 0) + ".",
      "Không cần sửa CONFIG ngay. Hệ thống sẽ dùng runtime row mới sau 2 lần đọc giống nhau và rebuild thành công.",
      {
        configuredRow:Number(current.configuredNameRow || 0),
        adaptiveRow:Number(current.adaptiveNameRow || 0),
        configuredSimilarity:effective.configuredSimilarity,
        autoSimilarity:effective.autoSimilarity
      }
    );
  }

  if (baseline && Number(baseline.villaCount || 0) > 0) {
    var before = Number(baseline.villaCount || 0);
    var now = Number(effective.villaCount || 0);
    var ratio = before > 0 ? Math.abs(now - before) / before : 0;
    var setDiff = ssStructureSetDiffV330_(baseline.nameSet || {}, effective.nameSet || {});
    var added = setDiff.added;
    var removed = setDiff.removed;

    if (now !== before) {
      var level = (now <= 0 || (now < before && ratio >= 0.60)) ? "ERROR" : "WARNING";
      var code = now < before ? "VILLA_COUNT_DROPPED" : "VILLA_COUNT_CHANGED";
      var msg = "Số căn thay đổi từ " + before + " thành " + now + ".";
      if (added.length) msg += " Thêm: " + ssStructureShortNamesV330_(added, 4) + ".";
      if (removed.length) msg += " Bớt: " + ssStructureShortNamesV330_(removed, 4) + ".";
      push(
        level,
        code,
        msg,
        "Chờ 2 lần đọc thành công liên tiếp cùng cấu trúc rồi mới tự rebuild.",
        {before:before, now:now, ratio:ratio, added:added.slice(0,12), removed:removed.slice(0,12)}
      );
    }

    if (now === before && (added.length || removed.length)) {
      var renameMsg = "Danh sách tên căn thay đổi.";
      if (added.length) renameMsg += " Thêm/đổi thành: " + ssStructureShortNamesV330_(added, 4) + ".";
      if (removed.length) renameMsg += " Mất/đổi từ: " + ssStructureShortNamesV330_(removed, 4) + ".";
      var labelOnlyV341 = ssStructureLikelyLabelOnlyChangeV341_(baseline, effective, added, removed);
      if (labelOnlyV341) {
        push(
          "INFO",
          "VILLA_NAME_LABEL_CHANGED",
          renameMsg,
          "Có vẻ chỉ rút gọn/đổi cách ghi nhãn tên giữa tháng; giữ MÃ CĂN cũ và không coi source hỏng.",
          {added:added.slice(0,12), removed:removed.slice(0,12), labelOnly:true}
        );
      } else {
        push(
          "WARNING",
          "VILLA_NAME_SET_CHANGED",
          renameMsg,
          "Có thay đổi tên không khớp chắc với nhãn cũ; giữ cảnh báo để kiểm tra, không tự đổi MÃ CĂN.",
          {added:added.slice(0,12), removed:removed.slice(0,12), labelOnly:false}
        );
      }
    }

    if (
      baseline.namesSignature && effective.namesSignature &&
      baseline.namesSignature !== effective.namesSignature &&
      added.length === 0 && removed.length === 0 &&
      now === before
    ) {
      push(
        "WARNING",
        "VILLA_COLUMNS_CHANGED",
        "Tên căn giữ nguyên nhưng vị trí cột đã thay đổi.",
        "Chờ xác nhận 2 lần rồi rebuild source để remap lịch/ảnh theo cột mới."
      );
    }

    if (
      current.evidenceSkipped !== true &&
      Number(baseline.imageDetected || 0) >= 3 &&
      Number(current.imageDetected || 0) < Math.ceil(Number(baseline.imageDetected || 0) * 0.5)
    ) {
      push("WARNING", "IMAGE_EVIDENCE_DROPPED", "Số ảnh nhận diện giảm mạnh từ " + Number(baseline.imageDetected || 0) + " xuống " + Number(current.imageDetected || 0) + ".", "Kiểm tra CONFIG ẢNH / hàng ảnh.");
    }

    if (
      current.evidenceSkipped !== true &&
      Number(baseline.infoDetected || 0) >= 3 &&
      Number(current.infoDetected || 0) < Math.ceil(Number(baseline.infoDetected || 0) * 0.5)
    ) {
      push("WARNING", "INFO_EVIDENCE_DROPPED", "Số căn có thông tin giảm mạnh từ " + Number(baseline.infoDetected || 0) + " xuống " + Number(current.infoDetected || 0) + ".", "Kiểm tra CONFIG THÔNG TIN / vùng thông tin.");
    }
  }

  if (current.imageReadError) {
    push("WARNING", "IMAGE_READER_ERROR", "Bộ đọc ảnh báo: " + current.imageReadError, "Kiểm tra CONFIG ẢNH.");
  }
  if (current.infoReadError) {
    push("WARNING", "INFO_READER_ERROR", "Bộ đọc thông tin báo: " + current.infoReadError, "Kiểm tra CONFIG THÔNG TIN.");
  }

  var status = "OK";
  if (issues.some(function(i){ return i.level === "ERROR"; })) status = "ERROR";
  else if (issues.some(function(i){ return i.level === "WARNING"; })) status = "WARNING";
  return {status:status, issues:issues};
}

function buildStructureSnapshotV320(maxSources, maxRuntimeMs) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return {success:false, skipped:true, reason:"LOCKED"};
  try {
    var startedMs = new Date().getTime();
    // BƯỚC A: trần thời gian của lần build do maintenance truyền vào (nếu có), không vượt MAX_RUNTIME_MS.
    var runtimeLimitV_A = Number(EHOME_STRUCTURE_SNAPSHOT_V320.MAX_RUNTIME_MS || 180000);
    if (Number(maxRuntimeMs || 0) > 0) runtimeLimitV_A = Math.min(runtimeLimitV_A, Number(maxRuntimeMs));
    var structLastV_A = -1, structLongestV_A = 0;
    var sh = ssEnsureStructureSnapshotSheetV320_();
    var old = ssReadStructureSnapshotRowsV320_();
    var sourceList = opsListMasterSourcesV312_(true);
    var sources = sourceList.sources || [];
    var props = PropertiesService.getScriptProperties();
    var cursor = Math.max(0,Number(props.getProperty(EHOME_STRUCTURE_SNAPSHOT_V320.CURSOR_PROP) || 0));
    if (cursor >= sources.length) cursor = 0;
    var limit = Math.max(1,Number(maxSources || EHOME_STRUCTURE_SNAPSHOT_V320.MAX_SOURCES_PER_RUN || 6));
    var processed = 0;
    var nowIso = new Date().toISOString();

    while (cursor < sources.length && processed < limit) {
      var nowV_A = new Date().getTime();
      if (structLastV_A >= 0) structLongestV_A = Math.max(structLongestV_A, nowV_A - structLastV_A);
      structLastV_A = nowV_A;
      if (nowV_A - startedMs > runtimeLimitV_A) break;
      if (nowV_A - startedMs + Math.max(structLongestV_A, Number(EHOME_STRUCTURE_SNAPSHOT_V320.STRUCTURE_ITEM_ESTIMATE_MS || 20000)) > runtimeLimitV_A) break;
      var source = sources[cursor];
      var key = ssStructureSourceKeyV320_(source);
      var previous = old[key] || {};
      var baseline = ssJsonParseSafeV320_(previous.baselineJson, null);
      var previousCurrentV340 = ssJsonParseSafeV320_(previous.currentJson, {});
      var current = null;
      var compare = null;
      var baselineAt = previous.baselineAt || "";

      try {
        current = ssInspectSourceStructureV320_(source);
        if (!baseline) {
          baseline = ssPromoteCurrentToBaselineV340_(current);
          baselineAt = nowIso;
          compare = {status:"BASELINE", issues:[]};
        } else {
          compare = ssCompareStructureV320_(baseline, current);
          ssApplyChangeConfirmationV340_(previousCurrentV340, current, compare, nowIso);
          if (compare.status === "OK") {
            baseline = ssPromoteCurrentToBaselineV340_(current);
            baselineAt = nowIso;
          }
        }
        // Mọi source hợp lệ đều tích lũy số lần đọc cấu trúc giống nhau.
        // Dùng riêng để khóa nguồn hoàn toàn mới: phải đủ 2 lần mới vào MASTER.
        ssApplyStableReadValidationV340_(previousCurrentV340, current);
      } catch (error) {
        var msg = String(error && error.message ? error.message : error);
        var classify = saClassifyAccessErrorV1_(msg);
        current = {error:msg};

        if (classify === "NO_ACCESS") {
          compare = {status:"NO_ACCESS",issues:[{level:"ERROR",code:"NO_ACCESS",message:msg,suggestion:"Chủ nhà cần cấp quyền truy cập Google Sheet."}]};
          // Lưu vào tab NO_ACCESS_SOURCES
          try {
            saSaveNoAccessSourceV1_(0, source, "NO_ACCESS");
          } catch (ignoreNoAccessSave) {}
        } else {
          compare = {status:"ERROR",issues:[{level:"ERROR",code:"STRUCTURE_READ_FAILED",message:msg,suggestion:"Kiểm tra quyền truy cập / link nguồn / sheet lịch."}]};
        }
      }

      var status = compare.status === "BASELINE" ? "OK" : compare.status;
      old[key] = {
        key:key,id:String(source.id || ""),city:String(source.city || ""),source:String(source.source || ""),link:String(source.link || ""),
        status:status,checkedAt:nowIso,baselineAt:baselineAt,
        baselineJson:JSON.stringify(baseline || {}),currentJson:JSON.stringify(current || {}),issuesJson:JSON.stringify(compare.issues || [])
      };
      cursor++; processed++;
    }

    var cycleComplete = cursor >= sources.length;
    props.setProperty(EHOME_STRUCTURE_SNAPSHOT_V320.CURSOR_PROP, cycleComplete ? "0" : String(cursor));
    if (cycleComplete) props.setProperty(EHOME_STRUCTURE_SNAPSHOT_V320.LAST_RUN_PROP, nowIso);

    var enabledKeys = {};
    sources.forEach(function(source){ enabledKeys[ssStructureSourceKeyV320_(source)] = true; });
    var rows = [];
    Object.keys(old).forEach(function(key){
      if (!enabledKeys[key]) return;
      var r=old[key];
      rows.push([r.key,r.id,r.city,r.source,r.link,r.status,r.checkedAt,r.baselineAt,r.baselineJson,r.currentJson,r.issuesJson]);
    });
    rows.sort(function(a,b){ return String(a[3]||"").localeCompare(String(b[3]||""),"vi"); });

    sh.clearContents();
    sh.getRange(1,1,1,11).setValues([["SOURCE KEY","ID","THÀNH PHỐ","NGUỒN","LINK","STATUS","CHECKED AT","BASELINE AT","BASELINE JSON","CURRENT JSON","ISSUES JSON"]]);
    if (rows.length) sh.getRange(2,1,rows.length,11).setValues(rows);
    sh.setFrozenRows(1);

    var summary=getStructureSnapshotSummaryV320();
    summary.processedThisRun=processed;
    summary.nextCursor=cycleComplete?0:cursor;
    summary.cycleComplete=cycleComplete;
    summary.totalSources=sources.length;
    Logger.log(JSON.stringify({code:"STRUCTURE_SNAPSHOT_BATCH_V320",result:{processed:processed,nextCursor:summary.nextCursor,cycleComplete:cycleComplete,total:summary.total,ok:summary.ok,warning:summary.warning,error:summary.error}}));
    return summary;
  } finally {
    lock.releaseLock();
  }
}

function reclassifyStructureSnapshotV341() {
  var sh=ssEnsureStructureSnapshotSheetV320_();
  if(sh.getLastRow()<2)return {success:true,updated:0,ok:0,warning:0,error:0};
  var values=sh.getRange(2,1,sh.getLastRow()-1,11).getDisplayValues();
  var updated=0,ok=0,warning=0,error=0;
  values.forEach(function(row,idx){
    var baseline=ssJsonParseSafeV320_(row[8],{});
    var current=ssJsonParseSafeV320_(row[9],{});
    if(current&&current.error)return;
    var compare=ssCompareStructureV320_(baseline,current);
    var status=String(compare.status||"OK");
    sh.getRange(idx+2,6).setValue(status);
    sh.getRange(idx+2,11).setValue(JSON.stringify(compare.issues||[]));
    if(status==="OK")ok++;else if(status==="WARNING")warning++;else error++;
    updated++;
  });
  EHOME_STRUCTURE_RUNTIME_INDEX_V340_=null;
  var result={success:true,version:"3.4.1",updated:updated,ok:ok,warning:warning,error:error};
  Logger.log(JSON.stringify({code:"STRUCTURE_RECLASSIFY_PASS_V341",result:result}));
  return result;
}

function refreshVungHungStructureV341() {
  var source=opsFindSourceV312_("Vũ Hùng");
  if(!source)throw new Error("VU_HUNG_SOURCE_NOT_FOUND");
  var result=ssRefreshOneStructureSourceV340_(source);
  Logger.log(JSON.stringify({code:"VU_HUNG_STRUCTURE_REFRESH_V341",result:result}));
  return result;
}

function getStructureSnapshotSummaryV320() {
  var rows = ssReadStructureSnapshotRowsV320_();
  var out = {success:true,total:0,ok:0,warning:0,error:0,lastRun:PropertiesService.getScriptProperties().getProperty(EHOME_STRUCTURE_SNAPSHOT_V320.LAST_RUN_PROP) || "",sources:[]};
  Object.keys(rows).forEach(function(key) {
    var r = rows[key];
    var current = ssJsonParseSafeV320_(r.currentJson, {});
    var baseline = ssJsonParseSafeV320_(r.baselineJson, {});
    var issues = ssJsonParseSafeV320_(r.issuesJson, []);
    var status = String(r.status || "UNKNOWN");
    out.total++;
    if (status === "OK") out.ok++;
    else if (status === "WARNING") out.warning++;
    else out.error++;
    out.sources.push({key:key,id:r.id,city:r.city,source:r.source,link:r.link,status:status,checkedAt:r.checkedAt,baselineAt:r.baselineAt,current:current,baseline:baseline,issues:issues});
  });
  return out;
}

function getStructureSnapshotMapV320_() {
  var summary = getStructureSnapshotSummaryV320();
  var map = {};
  (summary.sources || []).forEach(function(s) {
    var key = ssStructNormV320_(s.source || "");
    if (key) map[key] = s;
  });
  return map;
}

function getStructureSnapshotOneV320(selector) {
  var wanted = ssStructNormV320_(selector || "");
  if (!wanted) return {success:false,error:"SOURCE_REQUIRED"};
  var list = getStructureSnapshotSummaryV320().sources || [];
  var exact = list.filter(function(s){ return ssStructNormV320_(s.source) === wanted || ssStructNormV320_(s.id) === wanted; });
  if (exact.length === 1) return {success:true,source:exact[0]};
  var fuzzy = list.filter(function(s){ return ssStructNormV320_(s.source).indexOf(wanted) >= 0; });
  return fuzzy.length === 1 ? {success:true,source:fuzzy[0]} : {success:false,error:fuzzy.length ? "SOURCE_AMBIGUOUS" : "SOURCE_NOT_FOUND"};
}


var EHOME_STRUCTURE_RUNTIME_INDEX_V340_ = null;

function ssStructureRuntimeIndexV340_() {
  if (EHOME_STRUCTURE_RUNTIME_INDEX_V340_) return EHOME_STRUCTURE_RUNTIME_INDEX_V340_;
  var rows = ssReadStructureSnapshotRowsV320_();
  var index = {byId:{},byLink:{},bySource:{}};
  Object.keys(rows).forEach(function(key){
    var row = rows[key] || {};
    var record = {
      key:key,
      row:row,
      baseline:ssJsonParseSafeV320_(row.baselineJson, {}),
      current:ssJsonParseSafeV320_(row.currentJson, {}),
      issues:ssJsonParseSafeV320_(row.issuesJson, [])
    };
    var id = ssStructNormV320_(row.id || "");
    var linkId = typeof ssExtractSpreadsheetIdV320_ === "function"
      ? ssExtractSpreadsheetIdV320_(row.link || "")
      : "";
    var source = ssStructNormV320_(row.source || "");
    if (id) index.byId[id] = record;
    if (linkId) index.byLink[linkId] = record;
    if (source && !index.bySource[source]) index.bySource[source] = record;
  });
  EHOME_STRUCTURE_RUNTIME_INDEX_V340_ = index;
  return index;
}

function ssFindStructureRuntimeRecordV340_(sourceId, source, link) {
  var index = ssStructureRuntimeIndexV340_();
  var id = ssStructNormV320_(sourceId || "");
  var linkId = typeof ssExtractSpreadsheetIdV320_ === "function"
    ? ssExtractSpreadsheetIdV320_(link || "")
    : "";
  var sourceKey = ssStructNormV320_(source || "");
  return (id && index.byId[id]) ||
    (linkId && index.byLink[linkId]) ||
    (sourceKey && index.bySource[sourceKey]) ||
    null;
}

function ssGetConfirmedStructureForSourceV340_(sourceId, source, link) {
  var record = ssFindStructureRuntimeRecordV340_(sourceId, source, link);
  if (!record) return null;
  var current = record.current || {};
  if (current._structureConfirmed !== true) return null;
  var issueCodes = (record.issues || []).map(function(issue){
    return String(issue && issue.code || "");
  }).filter(String);
  var autoCodes = {
    SOURCE_ZERO_VILLAS:true,
    NAME_ROW_DRIFT:true,
    VILLA_COUNT_DROPPED:true,
    VILLA_COUNT_CHANGED:true,
    VILLA_COLUMNS_CHANGED:true
  };
  var autoRebuildAllowed = issueCodes.some(function(code){ return !!autoCodes[code]; });
  var renameOnly = issueCodes.length > 0 &&
    issueCodes.every(function(code){ return code === "VILLA_NAME_SET_CHANGED"; });
  return {
    confirmed:true,
    stableReads:Number(current._stableReads || 0),
    confirmedAt:String(current._confirmedAt || ""),
    adaptiveNameRow:Number(current.adaptiveNameRow || 0),
    effectiveVillaCount:Number(
      current.effectiveVillaCount != null
        ? current.effectiveVillaCount
        : current.villaCount || 0
    ),
    issueCodes:issueCodes,
    renameOnly:renameOnly,
    autoRebuildAllowed:autoRebuildAllowed,
    record:record
  };
}

/**
 * V4.16 R2 - bằng chứng "đọc sâu" cho source reconciliation.
 *
 * Không phụ thuộc baseline cũ/mới: baseline có thể đã được promote trước khi
 * MASTER_VILLA kịp reconcile. Chỉ xác nhận khi:
 * - cùng cấu trúc hiện tại đã đọc ổn định ít nhất 2 lượt;
 * - không có lỗi đọc;
 * - parser AUTO độc lập nhìn thấy đúng cùng tập tên/cùng số căn.
 *
 * Nếu AUTO không có bằng chứng hoặc không khớp CONFIG, trả null để giữ MASTER
 * cũ. Accuracy được ưu tiên hơn việc tự purge nhanh.
 */
function ssGetStableStructureForSourceV416_(sourceId, source, link) {
  var record = ssFindStructureRuntimeRecordV340_(sourceId, source, link);
  if (!record) return null;

  var current = record.current || {};
  var requiredReads = Math.max(
    2,
    Number(EHOME_STRUCTURE_SNAPSHOT_V320.CONFIRM_READS || 2)
  );
  var validationReads = Number(current._validationReads || 0);
  var effectiveCount = Number(
    current.effectiveVillaCount != null
      ? current.effectiveVillaCount
      : current.villaCount || 0
  );
  var effectiveSet = current.effectiveNameSet || current.nameSet || {};
  var autoCount = Number(current.autoVillaCount || 0);
  var autoSet = current.autoNameSet || {};
  var autoKeys = Object.keys(autoSet);
  var effectiveKeys = Object.keys(effectiveSet);
  var autoAgreement = !!(
    autoCount > 0 &&
    autoKeys.length > 0 &&
    autoCount === effectiveCount &&
    autoKeys.length === effectiveKeys.length &&
    autoKeys.every(function(key) { return !!effectiveSet[key]; })
  );

  if (
    current.error ||
    effectiveCount <= 0 ||
    validationReads < requiredReads ||
    !autoAgreement
  ) {
    return null;
  }

  return {
    confirmed:true,
    autoRebuildAllowed:true,
    evidence:"STABLE_DEEP_SCAN_V416",
    stableReads:validationReads,
    effectiveVillaCount:effectiveCount,
    record:record
  };
}

function ssIsStableForMasterAddV340_(sourceId, source, link) {
  var record = ssFindStructureRuntimeRecordV340_(sourceId, source, link);
  if (!record) return false;
  var current = record.current || {};
  var count = Number(
    current.effectiveVillaCount != null
      ? current.effectiveVillaCount
      : current.villaCount || 0
  );
  return !current.error && count > 0 && Number(current._validationReads || 0) >= Math.max(2, Number(EHOME_STRUCTURE_SNAPSHOT_V320.CONFIRM_READS || 2));
}

function ssIsConfirmedZeroStructureForSourceV340_(sourceId, source, link) {
  var confirmed = ssGetConfirmedStructureForSourceV340_(sourceId, source, link);
  return !!(confirmed && Number(confirmed.effectiveVillaCount || 0) === 0);
}

function ssResolveAdaptiveMasterConfigV340_(sourceId, source, link, rawConfig) {
  var parsed = parseMasterColumnConfig(rawConfig || "");
  if (parsed.fixedName || parsed.nameMode !== "FIXED_ROW") return rawConfig;

  var record = ssFindStructureRuntimeRecordV340_(sourceId, source, link);
  if (!record) return rawConfig;

  var current = record.current || {};
  var baseline = record.baseline || {};
  var runtimeRow = 0;

  if (current._structureConfirmed === true && Number(current.adaptiveNameRow || 0) > 0) {
    runtimeRow = Number(current.adaptiveNameRow || 0);
  } else if (Number(baseline.runtimeNameRow || 0) > 0) {
    runtimeRow = Number(baseline.runtimeNameRow || 0);
  }

  if (runtimeRow <= 0 || runtimeRow === Number(parsed.fixedNameRowIndex || -1) + 1) {
    return rawConfig;
  }

  var config = {
    NAME_MODE:"FIXED_ROW",
    NAME_ROW:runtimeRow,
    START_COL:Number(parsed.startColumnIndex || 0) + 1,
    TOP_ROWS:Number(parsed.topRows || 20),
    FALLBACK:parsed.fallbackEnabled === true,
    MIN_NAMES:Number(parsed.minimumNamesInRow || 1),
    MIN_SCORE:Number(parsed.minimumNameScore || 18)
  };
  if (Number(parsed.endColumnIndex || -1) >= 0) {
    config.END_COL = Number(parsed.endColumnIndex) + 1;
  }
  if ((parsed.excludedColumnIndexes || []).length) {
    config.SKIP_COLS = parsed.excludedColumnIndexes.map(function(i){ return Number(i) + 1; }).join(",");
  }

  Logger.log(JSON.stringify({
    code:"MASTER_RUNTIME_NAME_ROW_OVERRIDE_V340",
    sourceId:String(sourceId || ""),
    source:String(source || ""),
    configuredRow:Number(parsed.fixedNameRowIndex || -1) + 1,
    runtimeRow:runtimeRow
  }));
  return config;
}

function ssAcceptConfirmedStructureByMasterRowsV340_(rowNumbers) {
  rowNumbers = (rowNumbers || []).map(Number).filter(function(n){ return n >= 2; });
  if (!rowNumbers.length || typeof beAdminReadMasterRecordsV328_ !== "function") return {accepted:0};

  var wanted = {};
  rowNumbers.forEach(function(n){ wanted[n] = true; });
  var masterData = beAdminReadMasterRecordsV328_();
  var wantedKeys = {};
  (masterData.records || []).forEach(function(record){
    if (!wanted[Number(record.row)]) return;
    wantedKeys[ssStructureSourceKeyV320_(record)] = true;
  });

  var sh = ssEnsureStructureSnapshotSheetV320_();
  if (sh.getLastRow() < 2) return {accepted:0};
  var values = sh.getRange(2,1,sh.getLastRow()-1,11).getDisplayValues();
  var accepted = 0;
  var now = new Date().toISOString();

  values.forEach(function(row, idx){
    var key = String(row[0] || "");
    if (!wantedKeys[key]) return;
    var current = ssJsonParseSafeV320_(row[9], {});
    if (current._structureConfirmed !== true) return;
    var baseline = ssPromoteCurrentToBaselineV340_(current);
    sh.getRange(idx + 2, 6, 1, 6).setValues([[
      "OK",
      now,
      now,
      JSON.stringify(baseline),
      JSON.stringify(baseline),
      "[]"
    ]]);
    accepted++;
  });

  if (accepted) EHOME_STRUCTURE_RUNTIME_INDEX_V340_ = null;
  Logger.log(JSON.stringify({code:"STRUCTURE_BASELINE_AUTO_ACCEPT_V340",accepted:accepted,rows:rowNumbers}));
  return {accepted:accepted};
}

function testStructureConfirmationV340_() {
  var baseline = {
    villaCount:3,
    nameSet:{a:true,b:true,c:true},
    namesSignature:"old"
  };
  var current = {
    villaCount:4,
    nameSet:{a:true,b:true,c:true,d:true},
    namesSignature:"new",
    effectiveVillaCount:4,
    effectiveNameSet:{a:true,b:true,c:true,d:true},
    effectiveNamesSignature:"new"
  };
  var compare = {issues:[{code:"VILLA_COUNT_CHANGED",level:"WARNING"}]};
  var one = ssApplyChangeConfirmationV340_({}, current, compare, new Date().toISOString());
  var next = JSON.parse(JSON.stringify(current));
  var compare2 = {issues:[{code:"VILLA_COUNT_CHANGED",level:"WARNING"}]};
  var two = ssApplyChangeConfirmationV340_(next, JSON.parse(JSON.stringify(current)), compare2, new Date().toISOString());
  if (one.confirmed || !two.confirmed || Number(two.stableReads) < 2) {
    throw new Error("STRUCTURE_CONFIRMATION_V340_FAILED");
  }
  var stableA = {villaCount:3,nameSet:{a:true,b:true,c:true},namesSignature:"same"};
  var v1 = ssApplyStableReadValidationV340_({}, stableA);
  var stableB = {villaCount:3,nameSet:{a:true,b:true,c:true},namesSignature:"same"};
  var v2 = ssApplyStableReadValidationV340_(stableA, stableB);
  if (Number(v1.stableReads) !== 1 || Number(v2.stableReads) !== 2) {
    throw new Error("STRUCTURE_STABLE_READS_V340_FAILED");
  }
  Logger.log(JSON.stringify({code:"STRUCTURE_CONFIRMATION_PASS_V340",first:one,second:two,newSourceReads:[v1.stableReads,v2.stableReads]}));
  return {success:true,first:one,second:two,newSourceReads:[v1.stableReads,v2.stableReads]};
}

function testStructureConfirmationV340() {
  return testStructureConfirmationV340_();
}

function testStructureLabelNoiseV341() {
  var baseline={
    villaCount:2,firstVillaColumn:2,lastVillaColumn:3,
    nameSet:{"can xay 2pn 6pax 4 pax 200k":true,"can go 2pn 8pax 4 pax 200k":true},
    namesSignature:"old",imageDetected:2,infoDetected:2
  };
  var current={
    villaCount:2,firstVillaColumn:2,lastVillaColumn:3,
    nameSet:{"can xay":true,"can go":true},namesSignature:"new",
    imageDetected:2,infoDetected:2
  };
  var label=ssCompareStructureV320_(baseline,current);
  var hasInfo=(label.issues||[]).some(function(i){return i.code==="VILLA_NAME_LABEL_CHANGED"&&i.level==="INFO";});
  if(label.status!=="OK"||!hasInfo)throw new Error("STRUCTURE_LABEL_NOISE_V341_FAILED: "+JSON.stringify(label));

  var changed={
    villaCount:2,firstVillaColumn:2,lastVillaColumn:3,
    nameSet:{"uri home":true,"totally new villa":true},namesSignature:"new2",
    imageDetected:2,infoDetected:2
  };
  var real=ssCompareStructureV320_(baseline,changed);
  var hasWarning=(real.issues||[]).some(function(i){return i.code==="VILLA_NAME_SET_CHANGED"&&i.level==="WARNING";});
  if(real.status!=="WARNING"||!hasWarning)throw new Error("STRUCTURE_REAL_RENAME_V341_FAILED: "+JSON.stringify(real));

  Logger.log(JSON.stringify({code:"STRUCTURE_LABEL_NOISE_PASS_V341",labelStatus:label.status,realStatus:real.status}));
  return {success:true,labelStatus:label.status,realStatus:real.status};
}

function testVungHungAutoV341() {
  if(typeof opsFindSourceV312_!=="function")throw new Error("OPS_SOURCE_HELPER_MISSING");
  var source=opsFindSourceV312_("Vũ Hùng");
  if(!source)throw new Error("VU_HUNG_SOURCE_NOT_FOUND");
  var result=ssInspectSourceStructureV320_(source,{skipEvidence:true});
  var pass=Number(result.villaCount||0)===5&&Number(result.autoVillaCount||0)===5&&Number(result.autoNameRow||0)===2;
  if(!pass)throw new Error("VU_HUNG_AUTO_V341_FAILED: "+JSON.stringify(result));
  Logger.log(JSON.stringify({code:"VU_HUNG_AUTO_PASS_V341",sheet:result.mainSheet,autoNameRow:result.autoNameRow,autoVillaCount:result.autoVillaCount,villaCount:result.villaCount,names:Object.keys(result.nameSet||{})}));
  return {success:true,sheet:result.mainSheet,autoNameRow:result.autoNameRow,autoVillaCount:result.autoVillaCount,villaCount:result.villaCount};
}

function acceptStructureSnapshotBaselineV320(selector) {
  var sh = ssEnsureStructureSnapshotSheetV320_();
  if (sh.getLastRow() < 2) return {success:false,error:"NO_STRUCTURE_SNAPSHOT"};
  var values = sh.getDataRange().getDisplayValues();
  var wanted = ssStructNormV320_(selector || "");
  var accepted = 0;
  var now = new Date().toISOString();
  for (var r = 1; r < values.length; r++) {
    var source = ssStructNormV320_(values[r][3] || "");
    var id = ssStructNormV320_(values[r][1] || "");
    if (wanted && source !== wanted && id !== wanted && source.indexOf(wanted) < 0) continue;
    var current = values[r][9] || "{}";
    sh.getRange(r + 1, 6, 1, 6).setValues([[
      "OK", values[r][6] || now, now, current, current, "[]"
    ]]);
    accepted++;
  }
  return {success:accepted > 0,accepted:accepted};
}
function testPriorityStructureQueueV340() {
  var result = getPriorityStructureQueueStatusV340();

  Logger.log(JSON.stringify({
    code: "PRIORITY_STRUCTURE_QUEUE_STATUS_V340",
    result: result
  }));

  return result;
}

/**
 * V6.1.8 - BRIDGE REPAIR: StructureSnapshot -> MASTER incremental.
 *
 * V3.4.0 da co priority queue khi source modified, nhung priority reader chi xu ly
 * 2 source/maintenance. Khi backlog lon, source co CURRENT da confirmed van co the
 * nam lau trong STRUCTURE_SNAPSHOT ma chua vao MASTER incremental queue.
 *
 * Sweep nay KHONG tu y xoa can. No chi queue nhung row ma getMasterIncrementalPlanV328
 * da danh dau la an toan de rebuild (confirmed structure/new source/config/disabled).
 * MasterEngine V4.16 + VillaIdentity van la failsafe cuoi cung.
 */
var EHOME_MASTER_RECONCILE_SWEEP_V618 = {
  VERSION: "6.1.8",
  LAST_SWEEP_PROP: "EHOME_MASTER_RECONCILE_SWEEP_LAST_V618",
  SWEEP_INTERVAL_MINUTES: 15,
  MAX_QUEUE_PER_SWEEP: 30
};

function ssIsSafeMasterDriftReasonV618_(reason) {
  var safe = {
    NEW_OR_ZERO_MASTER_CONFIRMED_V340: true,
    STRUCTURE_CONFIRMED_CHANGED: true,
    DISABLED_REMOVE: true,
    CONFIG_OR_SOURCE_CHANGED: true,
    SOURCE_NAME_MISMATCH: true,
    CITY_MISMATCH: true,
    CALENDAR_CONFIG_MISMATCH: true
  };
  return safe[String(reason || "")] === true;
}

function ssQueueConfirmedMasterDriftV618_(options) {
  options = options || {};
  if (typeof getMasterIncrementalPlanV328 !== "function" ||
      typeof beAdminPendingRowsV328_ !== "function" ||
      typeof beAdminSetPendingRowsV328_ !== "function") {
    return {success:false, code:"MASTER_RECONCILE_SWEEP_UNAVAILABLE_V618"};
  }

  var props = PropertiesService.getScriptProperties();
  var force = options.force === true;
  var nowMs = new Date().getTime();
  var lastIso = String(props.getProperty(EHOME_MASTER_RECONCILE_SWEEP_V618.LAST_SWEEP_PROP) || "");
  var lastMs = lastIso ? new Date(lastIso).getTime() : 0;
  var minInterval = Math.max(1, Number(EHOME_MASTER_RECONCILE_SWEEP_V618.SWEEP_INTERVAL_MINUTES || 15)) * 60000;
  if (!force && lastMs && nowMs - lastMs < minInterval) {
    var throttledPendingV6302=beAdminPendingRowsV328_();
    var recoveryV6302=null;
    if(throttledPendingV6302.length && typeof beAdminScheduleIncrementalWorkerV328_ === "function") {
      recoveryV6302=beAdminScheduleIncrementalWorkerV328_();
    }
    return {
      success:true, skipped:true, reason:"SWEEP_THROTTLED",
      pending:throttledPendingV6302.length, workerRecovery:recoveryV6302
    };
  }

  var plan = getMasterIncrementalPlanV328({log:false});
  var pending = beAdminPendingRowsV328_();
  var pendingSet = {};
  pending.forEach(function(row){ pendingSet[Number(row)] = true; });
  var maxRows = Math.max(1, Number(options.maxRows || EHOME_MASTER_RECONCILE_SWEEP_V618.MAX_QUEUE_PER_SWEEP || 30));
  var candidates = [];

  (plan.targets || []).forEach(function(item) {
    var reasons = item.reasons || [];
    var safeReasons = reasons.filter(ssIsSafeMasterDriftReasonV618_);
    if (!safeReasons.length) return;
    var row = Number(item.row || 0);
    if (row < 2 || pendingSet[row]) return;
    candidates.push({
      row:row, id:String(item.id || ""), source:String(item.source || ""),
      reasons:safeReasons, presentCount:Number(item.presentCount || 0)
    });
  });

  candidates.sort(function(a,b){
    var aRemove = a.reasons.indexOf("STRUCTURE_CONFIRMED_CHANGED") >= 0 ? 0 :
      (a.reasons.indexOf("DISABLED_REMOVE") >= 0 ? 1 : 2);
    var bRemove = b.reasons.indexOf("STRUCTURE_CONFIRMED_CHANGED") >= 0 ? 0 :
      (b.reasons.indexOf("DISABLED_REMOVE") >= 0 ? 1 : 2);
    if (aRemove !== bRemove) return aRemove - bRemove;
    return a.row - b.row;
  });

  var selected = candidates.slice(0, maxRows);
  var queuedRows = selected.map(function(x){ return x.row; });
  if (queuedRows.length) {
    beAdminSetPendingRowsV328_(pending.concat(queuedRows));
  }

  var finalPendingV6302=beAdminPendingRowsV328_();
  var workerRecoveryV6302=null;
  if (finalPendingV6302.length && typeof beAdminScheduleIncrementalWorkerV328_ === "function") {
    workerRecoveryV6302=beAdminScheduleIncrementalWorkerV328_();
  }

  props.setProperty(EHOME_MASTER_RECONCILE_SWEEP_V618.LAST_SWEEP_PROP, new Date().toISOString());
  var result = {
    success:true, code:"MASTER_RECONCILE_SWEEP_V618",
    dirtyCount:Number(plan.targetCount || 0),
    safeCandidateCount:candidates.length,
    queuedRows:queuedRows, queuedCount:queuedRows.length,
    pending:finalPendingV6302.length,
    workerRecovery:workerRecoveryV6302,
    sample:selected.slice(0,12)
  };
  Logger.log(JSON.stringify(result));
  return result;
}

/** One-shot admin repair: queue backlog confirmed va kick worker batch dau tien. */
/**
 * V6.1.10: remove stale pending rows that are no longer dirty in the current
 * incremental plan (notably disabled/blank MASTER rows with presentCount=0).
 */
function ssPruneNoopPendingRowsV6110_(){
  if(typeof getMasterIncrementalPlanV328!=="function"||
     typeof beAdminPendingRowsV328_!=="function"||
     typeof beAdminSetPendingRowsV328_!=="function"){
    return {success:false,code:"MASTER_PENDING_PRUNE_UNAVAILABLE_V6110"};
  }
  var plan=getMasterIncrementalPlanV328({log:false});
  var targetSet={};
  (plan.targets||[]).forEach(function(item){targetSet[Number(item.row||0)]=true;});
  var before=beAdminPendingRowsV328_();
  var after=before.filter(function(row){return targetSet[Number(row)]===true;});
  beAdminSetPendingRowsV328_(after);
  var removed=before.filter(function(row){return targetSet[Number(row)]!==true;});
  var result={success:true,code:"MASTER_PENDING_PRUNE_V6110",before:before.length,after:after.length,removed:removed};
  Logger.log(JSON.stringify(result));
  return result;
}

function repairMasterReconcileBacklogV618() {
  var pendingPruneV6110=ssPruneNoopPendingRowsV6110_();
  var queued = ssQueueConfirmedMasterDriftV618_({force:true, maxRows:60});
  var worker = null;
  if (typeof ehomeIncrementalMasterWorkerV328_ === "function" && beAdminPendingRowsV328_().length) {
    worker = ehomeIncrementalMasterWorkerV328_();
  }
  var result = {
    success:true, code:"MASTER_RECONCILE_BACKLOG_REPAIR_V618",
    pendingPruneV6110:pendingPruneV6110, queued:queued, worker:worker,
    pendingRows:typeof beAdminPendingRowsV328_ === "function" ? beAdminPendingRowsV328_() : []
  };
  Logger.log(JSON.stringify(result));
  return result;
}

function getMasterReconcileBacklogStatusV618() {
  var plan = typeof getMasterIncrementalPlanV328 === "function"
    ? getMasterIncrementalPlanV328({log:false}) : {targets:[],targetCount:0};
  var safe = [];
  var blocked = [];
  (plan.targets || []).forEach(function(item){
    var reasons = item.reasons || [];
    var safeReasons = reasons.filter(ssIsSafeMasterDriftReasonV618_);
    var out = {row:Number(item.row||0), id:String(item.id||""), source:String(item.source||""), presentCount:Number(item.presentCount||0), reasons:reasons};
    if (safeReasons.length) safe.push(out); else blocked.push(out);
  });
  var pending = typeof beAdminPendingRowsV328_ === "function" ? beAdminPendingRowsV328_() : [];
  var result = {
    success:true, code:"MASTER_RECONCILE_BACKLOG_STATUS_V618",
    dirtyCount:Number(plan.targetCount || 0), safeCount:safe.length, blockedCount:blocked.length,
    pending:pending.length, pendingRows:pending,
    workerTriggerCount:ScriptApp.getProjectTriggers().filter(function(t){
      return typeof EHOME_MASTER_INCREMENTAL_V328 !== "undefined" &&
        t.getHandlerFunction() === EHOME_MASTER_INCREMENTAL_V328.WORKER_HANDLER;
    }).length,
    safe:safe.slice(0,60), blocked:blocked.slice(0,30)
  };
  Logger.log(JSON.stringify(result));
  return result;
}

function testMasterReconcileSweepFilterV618() {
  var shouldPass = [
    "NEW_OR_ZERO_MASTER_CONFIRMED_V340",
    "STRUCTURE_CONFIRMED_CHANGED",
    "DISABLED_REMOVE",
    "CONFIG_OR_SOURCE_CHANGED"
  ].every(ssIsSafeMasterDriftReasonV618_);
  var shouldBlock = !ssIsSafeMasterDriftReasonV618_("MASTER_STATUS_RETRY") &&
    !ssIsSafeMasterDriftReasonV618_("MISSING_LINK");
  if (!shouldPass || !shouldBlock) throw new Error("MASTER_RECONCILE_SWEEP_FILTER_FAIL_V618");
  var result = {success:true, code:"MASTER_RECONCILE_SWEEP_FILTER_PASS_V618"};
  Logger.log(JSON.stringify(result));
  return result;
}
