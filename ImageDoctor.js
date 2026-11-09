/** 25_ImageDoctor.gs - detailed image diagnostics + targeted retry for EHOME V3.1.2 */

function opsReadImageAuditRowsV312_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName((typeof EHOME_IMAGE_AUDIT_V30 !== "undefined" && EHOME_IMAGE_AUDIT_V30.SHEET) || "IMAGE_AUDIT_V3");
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getDataRange().getDisplayValues();
  var h = vals[0];
  var c = {
    sku:opsHeaderIndexV312_(h,["MÃ CĂN","SKU"]),
    name:opsHeaderIndexV312_(h,["TÊN CĂN","VILLA"]),
    source:opsHeaderIndexV312_(h,["NGUỒN","SOURCE"]),
    city:opsHeaderIndexV312_(h,["THÀNH PHỐ","CITY"]),
    status:opsHeaderIndexV312_(h,["STATUS","TRẠNG THÁI"]),
    reason:opsHeaderIndexV312_(h,["LÝ DO","REASON"]),
    url:opsHeaderIndexV312_(h,["IMAGE URL","ẢNH","IMAGE"]),
    attempts:opsHeaderIndexV312_(h,["ATTEMPTS"]),
    error:opsHeaderIndexV312_(h,["ERROR","LỖI"])
  };
  return vals.slice(1).map(function(row,idx){
    return {
      row:idx + 2,
      sku:c.sku >= 0 ? String(row[c.sku] || "").trim() : "",
      name:c.name >= 0 ? String(row[c.name] || "").trim() : "",
      source:c.source >= 0 ? String(row[c.source] || "").trim() : "",
      city:c.city >= 0 ? String(row[c.city] || "").trim() : "",
      status:String(c.status >= 0 ? row[c.status] : "MISSING").trim().toUpperCase(),
      reason:c.reason >= 0 ? String(row[c.reason] || "").trim() : "",
      url:c.url >= 0 ? String(row[c.url] || "").trim() : "",
      attempts:Number(c.attempts >= 0 ? row[c.attempts] : 0) || 0,
      error:c.error >= 0 ? String(row[c.error] || "").trim() : ""
    };
  }).filter(function(x){ return x.sku || x.name; });
}

function opsImageSuggestionV312_(issue) {
  var reason = opsNormV312_((issue && (issue.error || issue.reason)) || "");
  if (reason.indexOf("drive") >= 0 || reason.indexOf("upload") >= 0 || reason.indexOf("cache") >= 0) {
    return "Retry worker; nếu lặp lại, kiểm tra Drive cache/quyền upload.";
  }
  if (reason.indexOf("http") >= 0 || reason.indexOf("url") >= 0 || (issue && issue.status === "BROKEN")) {
    return "Kiểm URL/cache ảnh; nếu link nguồn đổi, chạy audit rồi resolve/cache lại.";
  }
  if (reason.indexOf("sheet") >= 0) return "Kiểm CONFIG ẢNH: tên tab ảnh có tồn tại và đúng nguồn không.";
  if (reason.indexOf("anchor") >= 0 || reason.indexOf("overgrid") >= 0) return "Kiểm ảnh nổi có anchor đúng cột căn và đúng hàng/vùng ảnh.";
  if (reason.indexOf("cell") >= 0 || reason.indexOf("image") >= 0) return "Kiểm CELL_IMAGE/=IMAGE()/ảnh tại đúng cột nguồn và vùng CONFIG ẢNH.";
  if (issue && issue.status === "MISSING") return "Kiểm ảnh thật ở sourceColumn + CONFIG ẢNH; nếu ảnh nằm tab/hàng khác thì sửa CONFIG ẢNH.";
  if (issue && issue.status === "ERROR") return "Retry riêng căn/nguồn; nếu vẫn lỗi xem ERROR + CONFIG ẢNH.";
  return "Chạy /imagecheck <mã căn> và /configsource <nguồn> để khoanh vùng.";
}

function opsImageIssueDetailsV312_(issue) {
  issue = issue || {};
  var villa = opsFindVillaV312_(issue.sku || issue.name) || {};
  var source = opsFindSourceV312_(issue.source || villa.source) || {};
  var rawReason = String(issue.error || issue.reason || "").trim();
  var reasonCode = rawReason || (issue.status === "MISSING" ? "MASTER_VILLA_IMAGE_EMPTY" : "UNKNOWN_IMAGE_ISSUE");
  return {
    sku:issue.sku || villa.sku || "",
    name:issue.name || villa.name || "",
    source:issue.source || villa.source || source.source || "",
    city:issue.city || villa.city || source.city || "",
    status:issue.status || "UNKNOWN",
    reason:reasonCode,
    attempts:Number(issue.attempts || 0),
    imageUrl:issue.url || villa.image || "",
    sourceColumn:Number(villa.sourceColumn || 0),
    link:villa.link || source.link || "",
    configMaster:source.configMaster || "",
    configImage:source.configImage || "",
    suggestion:opsImageSuggestionV312_(issue)
  };
}

function getImageIssuesV312(status, selector, limit) {
  status = String(status || "").trim().toUpperCase();
  selector = opsNormV312_(selector || "");
  limit = Math.max(1,Math.min(100,Number(limit || 30)));
  var rows = opsReadImageAuditRowsV312_();
  var out = [];
  rows.forEach(function(x){
    if (status && x.status !== status) return;
    if (selector && opsNormV312_(x.source).indexOf(selector) < 0 && opsNormV312_(x.sku) !== selector && opsNormV312_(x.name).indexOf(selector) < 0) return;
    if (out.length < limit) out.push(opsImageIssueDetailsV312_(x));
  });
  return {success:true,status:status || "ALL",selector:String(selector || ""),count:out.length,issues:out};
}

function getImageCheckV312(selector) {
  var wanted = opsNormV312_(selector);
  var audit = opsReadImageAuditRowsV312_();
  var found = null;
  for (var i = 0; i < audit.length; i++) {
    if (opsNormV312_(audit[i].sku) === wanted || opsNormV312_(audit[i].name) === wanted) { found = audit[i]; break; }
  }
  if (!found) {
    var v = opsFindVillaV312_(selector);
    if (!v) return {success:false,error:"VILLA_NOT_FOUND",selector:String(selector || "")};
    found = {sku:v.sku,name:v.name,source:v.source,city:v.city,status:v.image ? "PRESENT_NOT_AUDITED" : "MISSING",reason:v.image ? "AUDIT_NOT_REFRESHED" : "MASTER_VILLA_IMAGE_EMPTY",url:v.image,attempts:0,error:""};
  }
  return {success:true,detail:opsImageIssueDetailsV312_(found)};
}

function getImageSourceReportV312(selector, limit) {
  var source = opsFindSourceV312_(selector);
  if (!source) return {success:false,error:"SOURCE_NOT_FOUND",selector:String(selector || "")};
  var key = opsNormV312_(source.source);
  var rows = opsReadImageAuditRowsV312_();
  var counts = {total:0,ok:0,present:0,missing:0,error:0,broken:0,pending:0};
  var issues = [];
  rows.forEach(function(x){
    if (opsNormV312_(x.source) !== key) return;
    counts.total++;
    var s = String(x.status || "MISSING").toLowerCase();
    if (counts[s] !== undefined) counts[s]++;
    if (["MISSING","ERROR","BROKEN","PENDING"].indexOf(x.status) >= 0 && issues.length < Math.max(1,Math.min(50,Number(limit || 20)))) issues.push(opsImageIssueDetailsV312_(x));
  });
  return {success:true,source:source,counts:counts,issues:issues};
}

function opsQueueHeadersMapV312_(sheet) {
  if (!sheet || sheet.getLastRow() < 1) return null;
  var h = sheet.getRange(1,1,1,sheet.getLastColumn()).getDisplayValues()[0];
  return {
    status:opsHeaderIndexV312_(h,["STATUS"]), attempts:opsHeaderIndexV312_(h,["ATTEMPTS"]), sku:opsHeaderIndexV312_(h,["MÃ CĂN","SKU"]),
    sourceId:opsHeaderIndexV312_(h,["SOURCE ID"]), source:opsHeaderIndexV312_(h,["NGUỒN","SOURCE"]), link:opsHeaderIndexV312_(h,["LINK","URL"]),
    name:opsHeaderIndexV312_(h,["TÊN CĂN","VILLA"]), sourceColumn:opsHeaderIndexV312_(h,["CỘT NGUỒN","SOURCE COLUMN"]),
    masterConfig:opsHeaderIndexV312_(h,["CONFIG MASTER"]), imageConfig:opsHeaderIndexV312_(h,["CONFIG ẢNH","CONFIG IMAGE"]),
    imageUrl:opsHeaderIndexV312_(h,["IMAGE URL","ẢNH"]), error:opsHeaderIndexV312_(h,["ERROR"]), updated:opsHeaderIndexV312_(h,["CẬP NHẬT","UPDATED"])
  };
}

function retryImageIssuesV312(selector) {
  selector = String(selector || "all").trim();
  var norm = opsNormV312_(selector);
  var auditRows = opsReadImageAuditRowsV312_().filter(function(x){
    if (["MISSING","ERROR","BROKEN"].indexOf(x.status) < 0) return false;
    if (!norm || norm === "all" || norm === "tat ca") return true;
    return opsNormV312_(x.sku) === norm || opsNormV312_(x.name).indexOf(norm) >= 0 || opsNormV312_(x.source).indexOf(norm) >= 0;
  });
  if (!auditRows.length) return {success:false,error:"NO_MATCHING_IMAGE_ISSUES",selector:selector};

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var qName = typeof beImageQueueSheetNameV21_ === "function" ? beImageQueueSheetNameV21_() : "IMAGE_CACHE_QUEUE_V2";
  var sh = ss.getSheetByName(qName);
  if (!sh) {
    sh = ss.insertSheet(qName);
    var headers = typeof beImageQueueHeadersV21_ === "function" ? beImageQueueHeadersV21_() : ["STATUS","ATTEMPTS","CACHE SOURCE KEY","MÃ CĂN","SOURCE ID","NGUỒN","LINK","TÊN CĂN","CỘT NGUỒN","CONFIG MASTER","CONFIG ẢNH","IMAGE URL","ERROR","CẬP NHẬT"];
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  var c = opsQueueHeadersMapV312_(sh);
  var qVals = sh.getDataRange().getDisplayValues();
  var existing = {};
  for (var r = 1; r < qVals.length; r++) {
    var sku = c.sku >= 0 ? String(qVals[r][c.sku] || "").trim() : "";
    if (sku) existing[sku] = r + 1;
  }

  var reset = 0, added = 0, skipped = 0;
  auditRows.forEach(function(issue){
    var detail = opsImageIssueDetailsV312_(issue);
    var rowNo = existing[detail.sku];
    if (rowNo) {
      if (c.status >= 0) sh.getRange(rowNo,c.status+1).setValue("PENDING");
      if (c.error >= 0) sh.getRange(rowNo,c.error+1).setValue("");
      if (c.updated >= 0) sh.getRange(rowNo,c.updated+1).setValue(new Date());
      reset++;
      return;
    }
    var source = opsFindSourceV312_(detail.source);
    if (!source || !source.link || !detail.sku || !detail.name) { skipped++; return; }
    var headers = typeof beImageQueueHeadersV21_ === "function" ? beImageQueueHeadersV21_() : ["STATUS","ATTEMPTS","CACHE SOURCE KEY","MÃ CĂN","SOURCE ID","NGUỒN","LINK","TÊN CĂN","CỘT NGUỒN","CONFIG MASTER","CONFIG ẢNH","IMAGE URL","ERROR","CẬP NHẬT"];
    var row = new Array(headers.length).fill("");
    function set(key,val){ if (c[key] >= 0) row[c[key]] = val; }
    set("status","PENDING"); set("attempts",0); set("sku",detail.sku); set("sourceId",source.id); set("source",source.source); set("link",source.link);
    set("name",detail.name); set("sourceColumn",detail.sourceColumn); set("masterConfig",source.configMaster); set("imageConfig",source.configImage); set("imageUrl",""); set("error",""); set("updated",new Date());
    sh.appendRow(row);
    existing[detail.sku] = sh.getLastRow();
    added++;
  });

  var schedule = typeof beScheduleImageWorkerV21_ === "function" ? beScheduleImageWorkerV21_() : {success:false,reason:"SCHEDULER_UNAVAILABLE"};
  var result = {success:true,selector:selector,matched:auditRows.length,reset:reset,added:added,skipped:skipped,schedule:schedule};
  if (typeof beEmitSystemEventV30_ === "function") beEmitSystemEventV30_("INFO","IMAGE_RETRY_V312",result);
  Logger.log(JSON.stringify({code:"IMAGE_RETRY_V312",result:result}));
  return result;
}
