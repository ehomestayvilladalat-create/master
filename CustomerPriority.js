/**
 * CustomerPriority.js - V6.1.7
 *
 * Học ưu tiên từ hành vi mở lịch ở APP NỘI BỘ.
 * - Mỗi lần bấm "Mở Sheet lịch": +1 điểm.
 * - Điểm cũ giảm theo thời gian, half-life 14 ngày.
 * - Click website khách không được tính.
 * - Priority chỉ phá hòa sau mức phù hợp sức chứa.
 * - Lưu ở sheet ẩn CUSTOMER_PRIORITY_V1.
 */

var EHOME_CUSTOMER_PRIORITY_V617 = {
  SHEET_NAME: "CUSTOMER_PRIORITY_V1",
  CACHE_KEY: "EHOME_CUSTOMER_PRIORITY_MAP_V617",
  CACHE_SECONDS: 120,
  HALF_LIFE_DAYS: 14,
  MIN_ACTIVE_SCORE: 0.05,
  FEATURED_LIMIT: 12
};

function ceCustomerPriorityDecayScoreV617_(score, updatedAt, nowMs) {
  score = Number(score || 0);
  if (!isFinite(score) || score <= 0) return 0;

  nowMs = Number(nowMs || new Date().getTime());
  var updatedMs = updatedAt instanceof Date
    ? updatedAt.getTime()
    : new Date(updatedAt || 0).getTime();

  if (!isFinite(updatedMs) || updatedMs <= 0 || nowMs <= updatedMs) {
    return score;
  }

  var ageDays = (nowMs - updatedMs) / 86400000;
  var halfLife = Math.max(1, Number(EHOME_CUSTOMER_PRIORITY_V617.HALF_LIFE_DAYS || 14));
  return score * Math.pow(0.5, ageDays / halfLife);
}

function ceCustomerPrioritySheetV617_(createIfMissing) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("CUSTOMER_PRIORITY_NO_ACTIVE_SPREADSHEET_V617");

  var sh = ss.getSheetByName(EHOME_CUSTOMER_PRIORITY_V617.SHEET_NAME);
  if (!sh && createIfMissing === true) {
    sh = ss.insertSheet(EHOME_CUSTOMER_PRIORITY_V617.SHEET_NAME);
    sh.getRange(1, 1, 1, 5).setValues([[
      "VILLA_ID", "SCORE", "OPEN_COUNT", "LAST_OPEN_AT", "UPDATED_AT"
    ]]);
    sh.setFrozenRows(1);
    try { sh.hideSheet(); } catch (ignoreHideV617) {}
  }
  return sh;
}

function recordInternalVillaOpenV617(villaId) {
  villaId = String(villaId || "").trim();
  if (!villaId) {
    return {success:false, code:"CUSTOMER_PRIORITY_SKIPPED_V617", reason:"EMPTY_VILLA_ID"};
  }

  if (typeof ceCustomerFindInternalVillaV61_ === "function" &&
      !ceCustomerFindInternalVillaV61_(villaId)) {
    return {success:false, code:"CUSTOMER_PRIORITY_SKIPPED_V617", reason:"VILLA_NOT_FOUND"};
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    return {success:false, code:"CUSTOMER_PRIORITY_SKIPPED_V617", reason:"LOCK_BUSY"};
  }

  try {
    var sh = ceCustomerPrioritySheetV617_(true);
    var now = new Date();
    var row = 0;
    var lastRow = sh.getLastRow();

    if (lastRow >= 2) {
      var finder = sh.getRange(2, 1, lastRow - 1, 1)
        .createTextFinder(villaId)
        .matchEntireCell(true)
        .findNext();
      if (finder) row = finder.getRow();
    }

    var score = 1;
    var openCount = 1;

    if (row > 0) {
      var old = sh.getRange(row, 2, 1, 4).getValues()[0];
      var oldScore = Number(old[0] || 0);
      var oldCount = Number(old[1] || 0);
      var updatedAt = old[3] || old[2] || now;
      score = ceCustomerPriorityDecayScoreV617_(oldScore, updatedAt, now.getTime()) + 1;
      openCount = oldCount + 1;
      sh.getRange(row, 2, 1, 4).setValues([[score, openCount, now, now]]);
    } else {
      sh.appendRow([villaId, score, openCount, now, now]);
    }

    try {
      CacheService.getScriptCache().remove(EHOME_CUSTOMER_PRIORITY_V617.CACHE_KEY);
    } catch (ignoreCacheV617) {}

    return {
      success:true,
      code:"CUSTOMER_PRIORITY_RECORDED_V617",
      villaId:villaId,
      score:Number(score.toFixed(4)),
      openCount:openCount
    };
  } finally {
    try { lock.releaseLock(); } catch (ignoreUnlockV617) {}
  }
}

function ceCustomerPriorityScoreMapV617_() {
  var cache;
  try {
    cache = CacheService.getScriptCache();
    var cached = cache.get(EHOME_CUSTOMER_PRIORITY_V617.CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch (ignoreReadCacheV617) {}

  var sh = ceCustomerPrioritySheetV617_(false);
  if (!sh || sh.getLastRow() < 2) return {};

  var values = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
  var nowMs = new Date().getTime();
  var out = {};

  values.forEach(function(row) {
    var id = String(row[0] || "").trim();
    if (!id) return;

    var score = ceCustomerPriorityDecayScoreV617_(
      Number(row[1] || 0),
      row[4] || row[3],
      nowMs
    );

    if (score >= Number(EHOME_CUSTOMER_PRIORITY_V617.MIN_ACTIVE_SCORE || 0.05)) {
      out[id] = Number(score.toFixed(6));
    }
  });

  try {
    var json = JSON.stringify(out);
    if (json.length < 90000) {
      cache = cache || CacheService.getScriptCache();
      cache.put(
        EHOME_CUSTOMER_PRIORITY_V617.CACHE_KEY,
        json,
        Number(EHOME_CUSTOMER_PRIORITY_V617.CACHE_SECONDS || 120)
      );
    }
  } catch (ignoreWriteCacheV617) {}

  return out;
}

function ceCustomerPriorityFeaturedMapV617_(allowedIds, scoreMap, limit) {
  var allowed = {};
  (allowedIds || []).forEach(function(id) {
    id = String(id || "").trim();
    if (id) allowed[id] = true;
  });

  var rows = Object.keys(scoreMap || {})
    .filter(function(id) { return !!allowed[id] && Number(scoreMap[id] || 0) > 0; })
    .sort(function(a, b) {
      var d = Number(scoreMap[b] || 0) - Number(scoreMap[a] || 0);
      return d !== 0 ? d : a.localeCompare(b);
    });

  limit = Math.max(1, Number(limit || EHOME_CUSTOMER_PRIORITY_V617.FEATURED_LIMIT || 12));
  var out = {};
  rows.slice(0, limit).forEach(function(id) { out[id] = true; });
  return out;
}

function testCustomerPriorityLogicV617() {
  var now = new Date(2026, 8, 26, 12, 0, 0, 0).getTime();
  var fourteenDaysAgo = new Date(now - 14 * 86400000);
  var decayed = ceCustomerPriorityDecayScoreV617_(8, fourteenDaysAgo, now);

  if (Math.abs(decayed - 4) > 0.05) {
    throw new Error("CUSTOMER_PRIORITY_DECAY_FAIL_V617:" + decayed);
  }

  var scoreMap = {"VL-A":1, "VL-B":5, "VL-C":2};
  var featured = ceCustomerPriorityFeaturedMapV617_(["VL-A","VL-B","VL-C"], scoreMap, 2);
  if (!featured["VL-B"] || !featured["VL-C"] || featured["VL-A"]) {
    throw new Error("CUSTOMER_PRIORITY_FEATURED_FAIL_V617");
  }

  var rows = [
    {id:"VL-A", name:"A", source:"S", standard:10},
    {id:"VL-B", name:"B", source:"S", standard:10}
  ];
  rows.sort(function(a,b){
    return ceCompareVillasBestCapacityV332_(a,b,10,"",scoreMap);
  });
  if (rows[0].id !== "VL-B") {
    throw new Error("CUSTOMER_PRIORITY_SORT_FAIL_V617:" + rows[0].id);
  }

  var result = {
    success:true,
    code:"CUSTOMER_PRIORITY_PASS_V617",
    halfLifeDays:EHOME_CUSTOMER_PRIORITY_V617.HALF_LIFE_DAYS,
    capacityStillFirst:true,
    recentFrequentTieBreak:true
  };
  Logger.log(JSON.stringify(result));
  return result;
}
