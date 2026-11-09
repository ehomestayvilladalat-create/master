/** 05_Repositories.gs - V2.3 FAST STATIC CACHE
 * IMPORTANT:
 * GROUP_OPTIONS_B64 là Base64 phân biệt hoa/thường.
 * Tuyệt đối không .toUpperCase() toàn bộ CONFIG LỊCH.
 *
 * V2.3:
 * - Cache MASTER_VILLA (dữ liệu tĩnh) bằng ScriptCache.
 * - Chia payload thành nhiều chunk để không vướng giới hạn ~100 KB/key.
 * - Không cache FREE/BUSY hay giá lịch ở đây.
 */

var CE_MASTER_CACHE_KEY_V23_ = "BE_MASTER_VILLAS_V629";
var CE_MASTER_PUBLISH_BARRIER_PROP_V629_ = "EHOME_MASTER_PUBLISH_BARRIER_V629";
var CE_MASTER_CACHE_CHUNK_SIZE_V23_ = 24000;
var CE_MASTER_CACHE_MAX_CHUNKS_V626_ = 60;

function ceParseCapacityRangeV4220_(value) {
  var text = String(value == null ? "" : value).trim();
  if (!text) return {known:false,min:0,max:0,label:""};
  var nums = text.match(/\d{1,3}/g) || [];
  if (!nums.length) return {known:false,min:0,max:0,label:""};
  var min = Number(nums[0] || 0);
  var max = Number(nums.length > 1 ? nums[1] : nums[0] || 0);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 1 || max < 1 || min > 100 || max > 100) {
    return {known:false,min:0,max:0,label:""};
  }
  if (max < min) { var swap = min; min = max; max = swap; }
  return {known:true,min:min,max:max,label:min === max ? String(min) : (min + "-" + max)};
}

function ceResolveProductTypeV4220_(ownType, sourceType) {
  var own = String(ownType || "").trim().toUpperCase();
  if (own) return own;
  return String(sourceType || "").trim().toUpperCase();
}


// V6.2.5: strict/static Search model helpers restored.
function ceParseMasterCapacityV1_(value) {
  var text = String(value == null ? "" : value).trim();
  if (!/^\d{1,3}$/.test(text)) return null;
  var number = Number(text);
  return Number.isFinite(number) && number >= 1 && number <= 100 ? number : null;
}

function ceParseMasterBedroomsV1_(value) {
  var raw = String(value == null ? "" : value).trim();
  if (!raw) return null;
  if (/^\d{1,2}$/.test(raw)) {
    var direct = Number(raw);
    return direct >= 1 && direct <= 30 ? direct : null;
  }
  var normalized = typeof ceNormalize_ === "function" ? ceNormalize_(raw) : raw.toLowerCase();
  var patterns = [
    /(?:so\s*phong\s*ngu|phong\s*ngu)[^0-9]*(\d{1,2})/,
    /(\d{1,2})\s*(?:pn|phong\s*ngu|bedrooms?|beds?|br)\b/,
    /(?:pn|bedrooms?)\s*[:=-]?\s*(\d{1,2})/
  ];
  for (var i = 0; i < patterns.length; i++) {
    var match = normalized.match(patterns[i]);
    if (!match) continue;
    var number = Number(match[1] || 0);
    if (Number.isFinite(number) && number >= 1 && number <= 30) return number;
  }
  return null;
}

function ceMasterPriorityV625_(value) {
  var number = Math.floor(Number(value || 0));
  return Number.isFinite(number) ? Math.max(0, Math.min(3, number)) : 0;
}


function ceParseMasterSourceColumnV4193_(rawValue, displayValue, timeZone) {
  var raw = rawValue;
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    var tz = String(timeZone || ((typeof Session !== "undefined" && Session.getScriptTimeZone) ? Session.getScriptTimeZone() : "GMT") || "GMT");
    var ymd = Utilities.formatDate(raw, tz, "yyyy-MM-dd").split("-");
    var serial = Math.round((Date.UTC(Number(ymd[0]), Number(ymd[1]) - 1, Number(ymd[2])) - Date.UTC(1899, 11, 30)) / 86400000);
    return serial >= 1 && serial <= 300 ? serial : 0;
  }
  if (typeof raw === "number" && isFinite(raw)) {
    var direct = Math.floor(raw);
    return direct >= 1 && direct <= 300 ? direct : 0;
  }
  var text = String(displayValue == null ? rawValue == null ? "" : rawValue : displayValue).trim();
  if (/^\d{1,3}$/.test(text)) {
    var parsed = Number(text);
    return parsed >= 1 && parsed <= 300 ? parsed : 0;
  }
  // A date-looking display such as 1/4/1900 is ambiguous unless rawValue is a Date.
  return 0;
}

function ceGetMasterPublishBarrierV629_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(CE_MASTER_PUBLISH_BARRIER_PROP_V629_);
    if (!raw) return null;
    var state = JSON.parse(raw);
    if (!state || state.active !== true) return null;
    return state;
  } catch (error) {
    return {active:true,status:"UNKNOWN",error:String(error && error.message ? error.message : error)};
  }
}

function ceBeginMasterPublishV1_(candidateVillas) {
  var villas = Array.isArray(candidateVillas) ? candidateVillas : null;
  if (!villas) throw new Error("MASTER_PUBLISH_BARRIER_V629: candidate villas unavailable");
  var ttl = Math.max(300, Number(((typeof BE_CONFIG !== "undefined" && BE_CONFIG) ? BE_CONFIG.FAST_SEARCH_MASTER_CACHE_SECONDS : 0) || 300));
  if (!ceCachePutJsonChunksV23_(CE_MASTER_CACHE_KEY_V23_, villas, ttl)) {
    throw new Error("MASTER_PUBLISH_BARRIER_V629: cannot cache complete candidate set");
  }
  var state = {active:true,status:"PUBLISHING",startedAt:new Date().toISOString(),candidateCount:villas.length};
  PropertiesService.getScriptProperties().setProperty(CE_MASTER_PUBLISH_BARRIER_PROP_V629_, JSON.stringify(state));
  Logger.log(JSON.stringify({code:"MASTER_PUBLISH_BARRIER_BEGIN_V629",candidateCount:villas.length}));
  return state;
}

function ceEndMasterPublishV1_(success) {
  var props = PropertiesService.getScriptProperties();
  if (success === true) {
    props.deleteProperty(CE_MASTER_PUBLISH_BARRIER_PROP_V629_);
    Logger.log(JSON.stringify({code:"MASTER_PUBLISH_BARRIER_END_V629",success:true}));
    return true;
  }
  var state = ceGetMasterPublishBarrierV629_() || {active:true};
  state.active = true;
  state.status = "FAILED";
  state.failedAt = new Date().toISOString();
  props.setProperty(CE_MASTER_PUBLISH_BARRIER_PROP_V629_, JSON.stringify(state));
  Logger.log(JSON.stringify({level:"ERROR",code:"MASTER_PUBLISH_BARRIER_END_V629",success:false}));
  return false;
}

function ceMasterVillasFromRowsV1_(headerRow, dataRows) {
  var headers = (headerRow || []).map(ceNormalize_);
  var columns = {
    id: ceFindHeader_(headers, ["ma can", "id", "villa id"]),
    image: ceFindHeader_(headers, ["anh", "hinh anh", "image"]),
    name: ceFindHeader_(headers, ["ten can", "ten villa", "villa"]),
    city: ceFindHeader_(headers, ["thanh pho", "city"]),
    source: ceFindHeader_(headers, ["nguon", "source"]),
    url: ceFindHeader_(headers, ["link lich", "calendar", "link"]),
    standard: ceFindHeader_(headers, ["tieu chuan", "suc chua"]),
    bedrooms: ceFindHeader_(headers, ["pn", "phong ngu"]),
    info: ceFindHeader_(headers, ["thong tin", "mo ta"]),
    maps: ceFindHeader_(headers, ["maps", "map", "dia chi"]),
    sourceColumn: ceFindHeader_(headers, ["cot nguon", "source column", "source col", "calendar column"]),
    config: ceFindHeader_(headers, ["config", "reader", "calendar config", "kieu lich", "bo doc", "config lich"]),
    productType: ceFindHeader_(headers, ["loai sp", "loai_sp", "product type", "product_type"]),
    priority: ceFindHeader_(headers, ["uu tien", "uu_tien", "priority"])
  };
  if (columns.name < 0 || columns.url < 0) return [];

  var sourceConfigMap = null;
  var needsSourceFallback = (dataRows || []).some(function(row) {
    return !String(ceCell_(row, columns.productType) || "").trim();
  });
  if (needsSourceFallback && typeof ceReadSourceConfigMap_ === "function") {
    try { sourceConfigMap = ceReadSourceConfigMap_(); } catch (ignore) { sourceConfigMap = null; }
  }

  return (dataRows || []).map(function(row) {
    var calendarUrl = ceCell_(row, columns.url);
    var source = ceCell_(row, columns.source);
    var ownConfig = ceCell_(row, columns.config);
    var sourceConfig = sourceConfigMap
      ? (sourceConfigMap.byUrl[ceNormalize_(calendarUrl)] || sourceConfigMap.bySource[ceNormalize_(source)] || CE_CONFIG.DEFAULT_READER)
      : CE_CONFIG.DEFAULT_READER;
    var standardRaw = String(ceCell_(row, columns.standard) || "").trim();
    var capacity = ceParseCapacityRangeV4220_(standardRaw);
    var bedroomsRaw = ceCell_(row, columns.bedrooms);
    var sourceType = sourceConfigMap
      ? (sourceConfigMap.bySourceType[ceNormalize_(source)] || sourceConfigMap.byUrlType[ceNormalize_(calendarUrl)] || "")
      : "";
    return {
      id: ceCell_(row, columns.id), image: ceCell_(row, columns.image), name: ceCell_(row, columns.name),
      city: ceCell_(row, columns.city), source: source, calendarUrl: calendarUrl,
      standard: standardRaw, capacityMin: capacity.min, capacityMax: capacity.max, capacityLabel: capacity.label,
      bedrooms: bedroomsRaw, bedroomsNumber: ceParseMasterBedroomsV1_(bedroomsRaw),
      info: ceCell_(row, columns.info), maps: ceCell_(row, columns.maps),
      sourceColumn: ceParseMasterSourceColumnV4193_(ceCell_(row, columns.sourceColumn), ceCell_(row, columns.sourceColumn), "GMT") || 0,
      config: String(ownConfig || sourceConfig || CE_CONFIG.DEFAULT_READER).trim(),
      productType: ceResolveProductTypeV4220_(ceCell_(row, columns.productType), sourceType),
      priority: ceMasterPriorityV625_(ceCell_(row, columns.priority))
    };
  }).filter(function(villa) { return villa.name && villa.calendarUrl; });
}

function ceReadMasterVillas_() {
  var publishBarrierV629 = ceGetMasterPublishBarrierV629_();
  var cached = ceCacheGetJsonChunksV23_(CE_MASTER_CACHE_KEY_V23_);
  if (cached && Array.isArray(cached)) {
    if (CE_CONFIG.FAST_SEARCH_TIMING_LOG === true) {
      Logger.log(JSON.stringify({
        code: "MASTER_STATIC_CACHE_HIT_V23",
        villas: cached.length
      }));
    }
    return cached;
  }

  if (publishBarrierV629 && publishBarrierV629.active === true) {
    throw new Error("MASTER_PUBLISH_IN_PROGRESS_V629: cache unavailable while MASTER publish barrier is active");
  }

  var started = new Date().getTime();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CE_CONFIG.MASTER_VILLA_SHEET);

  if (!sheet) {
    throw new Error(
      'Không tìm thấy sheet "' +
      CE_CONFIG.MASTER_VILLA_SHEET +
      '".'
    );
  }

  var masterRangeV629 = sheet.getDataRange();
  var rawValuesV629 = masterRangeV629.getValues();
  var values = masterRangeV629.getDisplayValues();

  if (values.length < 2) {
    return [];
  }

  var headers = values[0].map(ceNormalize_);

  var columns = {
    id: ceFindHeader_(headers, ["ma can", "id", "villa id"]),
    image: ceFindHeader_(headers, ["anh", "hinh anh", "image"]),
    name: ceFindHeader_(headers, ["ten can", "ten villa", "villa"]),
    city: ceFindHeader_(headers, ["thanh pho", "city"]),
    source: ceFindHeader_(headers, ["nguon", "source"]),
    url: ceFindHeader_(headers, ["link lich", "calendar", "link"]),
    standard: ceFindHeader_(headers, ["tieu chuan", "suc chua"]),
    bedrooms: ceFindHeader_(headers, ["pn", "phong ngu"]),
    info: ceFindHeader_(headers, ["thong tin", "mo ta"]),
    maps: ceFindHeader_(headers, ["maps", "map", "dia chi"]),
    sourceColumn: ceFindHeader_(headers, [
      "cot nguon",
      "source column",
      "source col",
      "calendar column"
    ]),
    config: ceFindHeader_(headers, [
      "config",
      "reader",
      "calendar config",
      "kieu lich",
      "bo doc", "config lich"
    ]),
    // V3.4.2: đọc theo HEADER, tuyệt đối không hard-code cột N.
    productType: ceFindHeader_(headers, [
      "loai sp",
      "loai_sp",
      "product type",
      "product_type"
    ]),
    priority: ceFindHeader_(headers, [
      "uu tien",
      "uu_tien",
      "priority"
    ])
  };

  if (columns.name < 0 || columns.url < 0) {
    throw new Error(
      'MASTER_VILLA phải có cột "TÊN CĂN" và "LINK LỊCH".'
    );
  }

  var sourceConfigMap = ceReadSourceConfigMap_();

  var villas = values.slice(1).map(function(row, rowIndexV629) {
    var rawRowV629 = rawValuesV629[rowIndexV629 + 1] || [];
    var calendarUrl = ceCell_(row, columns.url);
    var source = ceCell_(row, columns.source);
    var ownConfig = ceCell_(row, columns.config);

    var sourceConfig =
      sourceConfigMap.byUrl[ceNormalize_(calendarUrl)] ||
      sourceConfigMap.bySource[ceNormalize_(source)] ||
      CE_CONFIG.DEFAULT_READER;

    var standardRawV4220 = String(ceCell_(row, columns.standard) || "").trim();
    var capacityV4220 = ceParseCapacityRangeV4220_(standardRawV4220);
    var bedroomsRawV625 = ceCell_(row, columns.bedrooms);
    var sourceTypeV4220 =
      sourceConfigMap.bySourceType[ceNormalize_(source)] ||
      sourceConfigMap.byUrlType[ceNormalize_(calendarUrl)] ||
      "";

    return {
      id: ceCell_(row, columns.id),
      image: ceCell_(row, columns.image),
      name: ceCell_(row, columns.name),
      city: ceCell_(row, columns.city),
      source: source,
      calendarUrl: calendarUrl,
      // V4.22.0 giữ nguyên chuỗi 6-10 thay vì ép còn số 6.
      standard: standardRawV4220,
      capacityMin: capacityV4220.min,
      capacityMax: capacityV4220.max,
      capacityLabel: capacityV4220.label,
      bedrooms: bedroomsRawV625,
      bedroomsNumber: ceParseMasterBedroomsV1_(bedroomsRawV625),
      info: ceCell_(row, columns.info),
      maps: ceCell_(row, columns.maps),
      sourceColumn: ceParseMasterSourceColumnV4193_(ceCell_(rawRowV629, columns.sourceColumn), ceCell_(row, columns.sourceColumn), Session.getScriptTimeZone()) || 0,
      config: String(
        ownConfig ||
        sourceConfig ||
        CE_CONFIG.DEFAULT_READER
      ).trim(),
      // V4.22.0 fail-safe: MASTER_VILLA cũ thiếu LOAI_SP vẫn lấy LOẠI từ MASTER.
      productType: ceResolveProductTypeV4220_(
        ceCell_(row, columns.productType),
        sourceTypeV4220
      ),
      priority: ceMasterPriorityV625_(ceCell_(row, columns.priority))
    };
  }).filter(function(villa) {
    return villa.name && villa.calendarUrl;
  });

  ceCachePutJsonChunksV23_(
    CE_MASTER_CACHE_KEY_V23_,
    villas,
    Number(
      (BE_CONFIG && BE_CONFIG.FAST_SEARCH_MASTER_CACHE_SECONDS) ||
      CE_CONFIG.CACHE_SECONDS ||
      120
    )
  );

  if (CE_CONFIG.FAST_SEARCH_TIMING_LOG === true) {
    Logger.log(JSON.stringify({
      code: "MASTER_STATIC_CACHE_MISS_V23",
      villas: villas.length,
      elapsedMs: new Date().getTime() - started
    }));
  }

  return villas;
}

function ceReadSourceConfigMap_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CE_CONFIG.MASTER_SHEET);

  var result = { byUrl: {}, bySource: {}, byUrlType: {}, bySourceType: {} };
  if (!sheet) return result;

  var values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return result;

  var headers = values[0].map(ceNormalize_);
  var sourceColumn = ceFindHeader_(headers, ["nguon", "source", "nha cung cap"]);
  var urlColumn = ceFindHeader_(headers, ["link lich", "calendar", "link", "url"]);
  var configColumn = ceFindHeader_(
    headers,
    ["config lich", "calendar config", "config calendar", "kieu lich", "bo doc", "reader"]
  );
  var typeColumn = ceFindHeader_(headers, ["loai", "loai sp", "loai_sp", "type", "product type"]);

  values.slice(1).forEach(function(row) {
    var config = configColumn >= 0
      ? String(ceCell_(row, configColumn) || CE_CONFIG.DEFAULT_READER).trim()
      : String(CE_CONFIG.DEFAULT_READER || "AUTO").trim();
    var type = typeColumn >= 0 ? String(ceCell_(row, typeColumn) || "").trim().toUpperCase() : "";
    var source = ceNormalize_(ceCell_(row, sourceColumn));
    var url = ceNormalize_(ceCell_(row, urlColumn));
    if (source) {
      result.bySource[source] = config;
      ceSrcTypeTrackV1_(result, "S", source, type);
    }
    if (url) {
      result.byUrl[url] = config;
      ceSrcTypeTrackV1_(result, "U", url, type);
    }
  });

  return result;
}

function testRepositoryProductTypeFallbackV4220() {
  var cases = [
    [ceResolveProductTypeV4220_("", "PHONG_RIENG"), "PHONG_RIENG"],
    [ceResolveProductTypeV4220_("NGUYEN_CAN", "PHONG_RIENG"), "NGUYEN_CAN"],
    [ceResolveProductTypeV4220_("PHONG_RIENG", ""), "PHONG_RIENG"]
  ];
  cases.forEach(function(item, index) {
    if (item[0] !== item[1]) throw new Error("REPOSITORY_PRODUCT_TYPE_FALLBACK_V4220_FAILED case=" + (index + 1));
  });
  var range = ceParseCapacityRangeV4220_("8-10");
  if (!range.known || range.min !== 8 || range.max !== 10 || range.label !== "8-10") {
    throw new Error("REPOSITORY_CAPACITY_RANGE_V4220_FAILED");
  }
  var result = {success:true,version:"4.22.0",productTypeCases:cases.length,capacityRange:range};
  Logger.log(JSON.stringify({code:"REPOSITORY_PRODUCT_TYPE_FALLBACK_PASS_V4220",result:result}));
  return result;
}

function testRepositoryPrivateRoomLiveV4220() {
  if (typeof clearBookingEngineCache === "function") clearBookingEngineCache();
  var sourceMap = ceReadSourceConfigMap_();
  var oneAmType = String(sourceMap.bySourceType[ceNormalize_("1am travel")] || "").trim();
  if (oneAmType && oneAmType !== "PHONG_RIENG") {
    throw new Error("REPOSITORY_PRIVATE_ROOM_LIVE_V4220_MASTER_TYPE_FAILED: " + oneAmType);
  }
  var villas = ceReadMasterVillas_();
  var oneAm = villas.filter(function(v){ return ceNormalize_(v.source) === ceNormalize_("1am travel"); });
  if (oneAm.length) {
    var bad = oneAm.filter(function(v){ return String(v.productType || "").trim().toUpperCase() !== "PHONG_RIENG"; });
    if (bad.length) throw new Error("REPOSITORY_PRIVATE_ROOM_LIVE_V4220_FALLBACK_FAILED bad=" + bad.length);
  }
  var result={success:true,version:"4.22.0",oneAmRows:oneAm.length,oneAmType:oneAmType||"NOT_FOUND"};
  Logger.log(JSON.stringify({code:"REPOSITORY_PRIVATE_ROOM_LIVE_PASS_V4220",result:result}));
  return result;
}

function ceCacheGetJsonChunksV23_(baseKey) {
  try {
    var cache = CacheService.getScriptCache();
    var manifestRaw = cache.get(baseKey + ":manifest");
    if (!manifestRaw) return null;

    var manifest = JSON.parse(manifestRaw);
    var count = Number(manifest && manifest.count || 0);
    if (!count || count > CE_MASTER_CACHE_MAX_CHUNKS_V626_) return null;

    var keys = [];
    for (var i = 0; i < count; i++) keys.push(baseKey + ":" + i);

    var partsMap = cache.getAll(keys);
    var parts = [];
    for (var j = 0; j < keys.length; j++) {
      if (!Object.prototype.hasOwnProperty.call(partsMap, keys[j])) return null;
      parts.push(partsMap[keys[j]]);
    }
    return JSON.parse(parts.join(""));
  } catch (error) {
    Logger.log(JSON.stringify({
      code: "MASTER_STATIC_CACHE_READ_SKIP_V23",
      error: String(error && error.message ? error.message : error)
    }));
    return null;
  }
}

function ceCachePutJsonChunksV23_(baseKey, value, ttlSeconds) {
  try {
    var text = JSON.stringify(value || []);
    var parts = [];
    for (var i = 0; i < text.length; i += CE_MASTER_CACHE_CHUNK_SIZE_V23_) {
      parts.push(text.slice(i, i + CE_MASTER_CACHE_CHUNK_SIZE_V23_));
    }

    if (!parts.length) parts = ["[]"];
    if (parts.length > CE_MASTER_CACHE_MAX_CHUNKS_V626_) {
      Logger.log(JSON.stringify({
        code: "MASTER_STATIC_CACHE_TOO_LARGE_V23",
        chars: text.length,
        chunks: parts.length
      }));
      return false;
    }

    var cache = CacheService.getScriptCache();
    var payload = {};
    for (var p = 0; p < parts.length; p++) payload[baseKey + ":" + p] = parts[p];

    cache.putAll(payload, Math.max(30, Number(ttlSeconds || 120)));
    cache.put(
      baseKey + ":manifest",
      JSON.stringify({count: parts.length, chars: text.length}),
      Math.max(30, Number(ttlSeconds || 120))
    );
    return true;
  } catch (error) {
    Logger.log(JSON.stringify({
      code: "MASTER_STATIC_CACHE_WRITE_SKIP_V23",
      error: String(error && error.message ? error.message : error)
    }));
    return false;
  }
}

function getBookingMasterVillas(){ return ceReadMasterVillas_(); }

function clearBookingEngineCache(){
  var barrierV629 = ceGetMasterPublishBarrierV629_();
  if (barrierV629 && barrierV629.active === true) {
    throw new Error("MASTER_PUBLISH_IN_PROGRESS_V629: refusing to clear the protected MASTER cache");
  }
  var cache = CacheService.getScriptCache();
  var keys = ["BE_MASTER_VILLAS", CE_MASTER_CACHE_KEY_V23_ + ":manifest"];
  for (var i = 0; i < CE_MASTER_CACHE_MAX_CHUNKS_V626_; i++) keys.push(CE_MASTER_CACHE_KEY_V23_ + ":" + i);
  cache.removeAll(keys);
  return true;
}
