/**
 * 24_OpsCommon.gs - EHOME V3.1.2 FULL OPS common read helpers.
 * READ-ONLY helpers only. No Calendar/Search behavior is changed here.
 */

var EHOME_OPS_V312 = {
  VERSION: "3.1.3-source-health-hotfix",
  MAX_TELEGRAM_ITEMS: 20,
  PENDING_ACTION_SHEET: "OPS_PENDING_ACTIONS_V312"
};

function opsNormV312_(value) {
  if (typeof ceNormalize_ === "function") return ceNormalize_(value);
  return String(value === null || value === undefined ? "" : value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function opsHeaderIndexV312_(headers, aliases) {
  var normalized = (headers || []).map(opsNormV312_);
  for (var a = 0; a < aliases.length; a++) {
    var wanted = opsNormV312_(aliases[a]);
    for (var i = 0; i < normalized.length; i++) {
      if (normalized[i] === wanted) return i;
    }
  }
  return -1;
}

function opsBoolV312_(value) {
  var n = opsNormV312_(value);
  return ["true","1","yes","y","co","x","on","enable","enabled"].indexOf(n) >= 0;
}

function opsListMasterSourcesV312_(enabledOnly) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName((typeof BE_CONFIG !== "undefined" && BE_CONFIG.MASTER_SHEET) || "MASTER");
  if (!sh) return {success:false,error:"MASTER_NOT_FOUND",sources:[]};
  if (sh.getLastRow() < 2) return {success:true,total:0,sources:[]};

  var range = sh.getDataRange();
  var values = range.getDisplayValues();
  var formulas = range.getFormulas();
  var rich = null;
  try { rich = range.getRichTextValues(); } catch (ignoreRich) {}
  var h = values[0];
  var c = {
    id:opsHeaderIndexV312_(h,["ID","MÃ NGUỒN"]),
    city:opsHeaderIndexV312_(h,["THÀNH PHỐ","CITY"]),
    source:opsHeaderIndexV312_(h,["NGUỒN","SOURCE"]),
    link:opsHeaderIndexV312_(h,["LINK","LINK LỊCH","URL","LINK NGUỒN","SOURCE LINK","SPREADSHEET URL","SHEET URL","LINK SHEET"]),
    enable:opsHeaderIndexV312_(h,["ENABLE","KÍCH HOẠT"]),
    master:opsHeaderIndexV312_(h,["CONFIG MASTER"]),
    calendar:opsHeaderIndexV312_(h,["CONFIG LỊCH","CONFIG CALENDAR"]),
    image:opsHeaderIndexV312_(h,["CONFIG ẢNH","CONFIG IMAGE"]),
    info:opsHeaderIndexV312_(h,["CONFIG THÔNG TIN","CONFIG INFO"]),
    type:opsHeaderIndexV312_(h,["LOẠI","TYPE"])
  };

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var source = c.source >= 0 ? String(row[c.source] || "").trim() : "";
    var link = c.link >= 0 ? String(row[c.link] || "").trim() : "";
    // MASTER có thể lưu URL dưới dạng RichText/HYPERLINK nên display text không phải URL.
    if (c.link >= 0) {
      var rt = rich && rich[r] ? rich[r][c.link] : null;
      var richUrl = "";
      try { richUrl = rt && typeof rt.getLinkUrl === "function" ? String(rt.getLinkUrl() || "").trim() : ""; } catch (ignoreLink) {}
      if (richUrl) link = richUrl;
      if ((!link || !/^https?:\/\//i.test(link)) && formulas && formulas[r]) {
        var formula = String(formulas[r][c.link] || "");
        var m = formula.match(/HYPERLINK\(\s*["']([^"']+)["']/i);
        if (m && m[1]) link = m[1];
      }
    }
    if (!source && !link) continue;
    var enabled = c.enable < 0 ? true : opsBoolV312_(row[c.enable]);
    if (enabledOnly && !enabled) continue;
    out.push({
      row:r + 1,
      id:c.id >= 0 ? String(row[c.id] || "").trim() : "",
      city:c.city >= 0 ? String(row[c.city] || "").trim() : "",
      source:source,
      link:link,
      enabled:enabled,
      type:c.type >= 0 ? String(row[c.type] || "").trim() : "",
      configMaster:c.master >= 0 ? String(row[c.master] || "").trim() : "",
      configCalendar:c.calendar >= 0 ? String(row[c.calendar] || "").trim() : "",
      configImage:c.image >= 0 ? String(row[c.image] || "").trim() : "",
      configInfo:c.info >= 0 ? String(row[c.info] || "").trim() : ""
    });
  }
  return {success:true,total:out.length,sources:out};
}

function opsFindSourceV312_(selector) {
  var wanted = opsNormV312_(selector);
  if (!wanted) return null;
  var sources = opsListMasterSourcesV312_(false).sources || [];
  var i;
  for (i = 0; i < sources.length; i++) {
    if (opsNormV312_(sources[i].id) === wanted || opsNormV312_(sources[i].source) === wanted) return sources[i];
  }
  var matches = [];
  for (i = 0; i < sources.length; i++) {
    if (opsNormV312_(sources[i].source).indexOf(wanted) >= 0) matches.push(sources[i]);
  }
  return matches.length === 1 ? matches[0] : null;
}

function opsMasterVillaRowsV312_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName((typeof BE_CONFIG !== "undefined" && BE_CONFIG.MASTER_VILLA_SHEET) || "MASTER_VILLA");
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getDataRange().getDisplayValues();
  var h = vals[0];
  var c = {
    sku:opsHeaderIndexV312_(h,["MÃ CĂN","ID","VILLA ID"]),
    image:opsHeaderIndexV312_(h,["ẢNH","HÌNH ẢNH","IMAGE"]),
    name:opsHeaderIndexV312_(h,["TÊN CĂN","TÊN VILLA","VILLA"]),
    city:opsHeaderIndexV312_(h,["THÀNH PHỐ","CITY"]),
    source:opsHeaderIndexV312_(h,["NGUỒN","SOURCE"]),
    link:opsHeaderIndexV312_(h,["LINK LỊCH","LINK","URL"]),
    sourceColumn:opsHeaderIndexV312_(h,["CỘT NGUỒN","SOURCE COLUMN"]),
    calendarConfig:opsHeaderIndexV312_(h,["CONFIG LỊCH","CONFIG CALENDAR"])
  };
  var out = [];
  for (var r = 1; r < vals.length; r++) {
    var row = vals[r];
    var sku = c.sku >= 0 ? String(row[c.sku] || "").trim() : "";
    var name = c.name >= 0 ? String(row[c.name] || "").trim() : "";
    if (!sku && !name) continue;
    out.push({
      row:r + 1,
      sku:sku,
      image:c.image >= 0 ? String(row[c.image] || "").trim() : "",
      name:name,
      city:c.city >= 0 ? String(row[c.city] || "").trim() : "",
      source:c.source >= 0 ? String(row[c.source] || "").trim() : "",
      link:c.link >= 0 ? String(row[c.link] || "").trim() : "",
      sourceColumn:c.sourceColumn >= 0 ? Number(row[c.sourceColumn] || 0) : 0,
      calendarConfig:c.calendarConfig >= 0 ? String(row[c.calendarConfig] || "").trim() : ""
    });
  }
  return out;
}

function opsFindVillaV312_(selector) {
  var wanted = opsNormV312_(selector);
  if (!wanted) return null;
  var villas = opsMasterVillaRowsV312_();
  var i;
  for (i = 0; i < villas.length; i++) {
    if (opsNormV312_(villas[i].sku) === wanted || opsNormV312_(villas[i].name) === wanted) return villas[i];
  }
  var matches = [];
  for (i = 0; i < villas.length; i++) {
    if (opsNormV312_(villas[i].name).indexOf(wanted) >= 0) matches.push(villas[i]);
  }
  return matches.length === 1 ? matches[0] : null;
}

function opsMasterVillaCountBySourceV312_() {
  var map = {};
  opsMasterVillaRowsV312_().forEach(function(v){
    var key = opsNormV312_(v.source);
    if (!key) return;
    map[key] = (map[key] || 0) + 1;
  });
  return map;
}

function opsCompactTextV312_(value, maxLen) {
  var s = String(value === null || value === undefined ? "" : value).replace(/\s+/g," ").trim();
  maxLen = Math.max(20, Number(maxLen || 220));
  return s.length > maxLen ? s.slice(0,maxLen - 1) + "…" : s;
}
