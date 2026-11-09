/**
 * ImageAudit.js - V3.4.2 LIVE IMAGE HEALTH AUDIT
 *
 * Rebuild từ MASTER_VILLA + IMAGE_CACHE_QUEUE_V2 + BỔ_SUNG_ẢNH + MASTER config.
 * Không sửa source, không sửa ảnh, không sửa lịch.
 */

var EHOME_IMAGE_AUDIT_V342={SHEET:"IMAGE_AUDIT_V3"};

function runImageAuditV342(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var master=ss.getSheetByName(BE_CONFIG.MASTER_VILLA_SHEET||"MASTER_VILLA");
  if(!master)throw new Error("Không tìm thấy MASTER_VILLA.");
  var values=master.getDataRange().getDisplayValues();
  if(values.length<2)return {success:true,total:0,present:0,ok:0,broken:0,missing:0,pending:0,error:0,notQueued:0,manualPending:0,doneButMissing:0};
  var h=values[0].map(ceNormalize_);function c(names){return ceFindHeader_(h,names);}
  var m={sku:c(["ma can","sku"]),image:c(["anh","image"]),name:c(["ten can"]),source:c(["nguon"]),city:c(["thanh pho"])};
  var queue=beImageAuditQueueMapV342_(ss),manual=beImageAuditManualMapV342_(ss),sourceCfg=beImageAuditSourceConfigMapV342_(ss);
  var rows=[];var stats={success:true,total:0,present:0,ok:0,broken:0,missing:0,pending:0,error:0,notQueued:0,manualPending:0,doneButMissing:0};
  values.slice(1).forEach(function(row){
    var sku=m.sku>=0?String(row[m.sku]||"").trim():"";var name=m.name>=0?String(row[m.name]||"").trim():"";if(!sku&&!name)return;
    stats.total++;
    var image=m.image>=0?String(row[m.image]||"").trim():"";
    var source=m.source>=0?String(row[m.source]||"").trim():"";
    var q=queue[sku]||null;var man=manual[sku]||null;var cfg=sourceCfg[normalizeMasterText(source)]||"";
    var status="NOT_QUEUED",reason="MASTER_IMAGE_EMPTY_NO_QUEUE";
    if(image){status="PRESENT";reason=(typeof beIsStableDriveImageUrl_==="function"&&beIsStableDriveImageUrl_(image))?"DRIVE_STABLE_UNVERIFIED":"IMAGE_URL_UNVERIFIED";stats.present++;}
    else if(q&&q.status==="PENDING"){status="PENDING";reason="IMAGE_WORKER_QUEUE";stats.pending++;}
    else if(q&&q.status==="ERROR"){status="ERROR";reason=beImageAuditErrorReasonV342_(q.error);stats.error++;}
    else if(q&&q.status==="DONE"){status="DONE_BUT_MISSING";reason="QUEUE_DONE_MASTER_IMAGE_EMPTY";stats.doneButMissing++;}
    else if(man){status="MANUAL_PENDING";reason="BỔ_SUNG_ẢNH";stats.manualPending++;}
    else{stats.notQueued++;}
    rows.push([sku,name,source,m.city>=0?row[m.city]:"",status,reason,image,q?q.status:"",q?q.attempts:0,q?q.error:"",man?"YES":"",cfg,new Date()]);
  });

  var sheet=ss.getSheetByName(EHOME_IMAGE_AUDIT_V342.SHEET)||ss.insertSheet(EHOME_IMAGE_AUDIT_V342.SHEET);
  var headers=["MÃ CĂN","TÊN CĂN","NGUỒN","THÀNH PHỐ","STATUS","LÝ DO","IMAGE URL","QUEUE STATUS","ATTEMPTS","ERROR","BỔ SUNG ẢNH","CONFIG ẢNH","CẬP NHẬT"];
  sheet.clearContents();sheet.getRange(1,1,1,headers.length).setValues([headers]);if(rows.length)sheet.getRange(2,1,rows.length,headers.length).setValues(rows);sheet.setFrozenRows(1);try{sheet.hideSheet();}catch(ignore){}
  stats.missing=stats.notQueued+stats.manualPending+stats.doneButMissing;
  Logger.log(JSON.stringify({code:"IMAGE_AUDIT_DONE_V342",stats:stats,sheet:EHOME_IMAGE_AUDIT_V342.SHEET}));
  if(typeof beEmitSystemEventV30_==="function"){
    beEmitSystemEventV30_(stats.missing||stats.error?"WARNING":"INFO","IMAGE_AUDIT",{
      total:stats.total,present:stats.present,ok:stats.ok,broken:stats.broken,missing:stats.missing,pending:stats.pending,error:stats.error,
      notQueued:stats.notQueued,manualPending:stats.manualPending,doneButMissing:stats.doneButMissing
    });
  }
  return stats;
}

function beImageAuditQueueMapV342_(ss){
  var map={};var sheet=ss.getSheetByName(typeof beImageQueueSheetNameV21_==="function"?beImageQueueSheetNameV21_():"IMAGE_CACHE_QUEUE_V2");if(!sheet||sheet.getLastRow()<2)return map;
  var v=sheet.getDataRange().getDisplayValues(),h=v[0].map(ceNormalize_);function c(names){return ceFindHeader_(h,names);}
  var x={status:c(["status"]),sku:c(["ma can"]),attempts:c(["attempts"]),error:c(["error"]),updated:c(["cap nhat"])};
  v.slice(1).forEach(function(row){var sku=x.sku>=0?String(row[x.sku]||"").trim():"";if(!sku)return;map[sku]={status:x.status>=0?String(row[x.status]||"").trim().toUpperCase():"",attempts:x.attempts>=0?Number(row[x.attempts]||0):0,error:x.error>=0?String(row[x.error]||"").trim():"",updated:x.updated>=0?String(row[x.updated]||""):""};});return map;
}

function beImageAuditManualMapV342_(ss){
  var map={};var sheet=ss.getSheetByName("BỔ_SUNG_ẢNH");if(!sheet||sheet.getLastRow()<2)return map;
  var v=sheet.getDataRange().getDisplayValues(),h=v[0].map(ceNormalize_),cSku=ceFindHeader_(h,["ma can","sku"]),cImage=ceFindHeader_(h,["anh","image"]);
  v.slice(1).forEach(function(row){var sku=cSku>=0?String(row[cSku]||"").trim():"";if(!sku)return;map[sku]={hasManualImage:cImage>=0&&String(row[cImage]||"").trim()!==""};});return map;
}

function beImageAuditSourceConfigMapV342_(ss){
  var map={};var sheet=ss.getSheetByName(BE_CONFIG.MASTER_SHEET||"MASTER");if(!sheet||sheet.getLastRow()<2)return map;
  var v=sheet.getDataRange().getDisplayValues(),h=v[0].map(ceNormalize_),cSource=ceFindHeader_(h,["nguon"]),cImage=ceFindHeader_(h,["config anh"]);
  v.slice(1).forEach(function(row){var source=cSource>=0?String(row[cSource]||"").trim():"";if(source)map[normalizeMasterText(source)]=cImage>=0?String(row[cImage]||"").trim():"";});return map;
}

function beImageAuditErrorReasonV342_(error){
  var e=String(error||"");
  if(/không còn ảnh|khong con anh/i.test(e))return "SOURCE_IMAGE_MISSING";
  if(/url\/blob\/xlsx|URL\/Blob\/XLSX/i.test(e))return "IMAGE_ASSET_UNREADABLE";
  if(/không map|khong map/i.test(e))return "IMAGE_MAPPING_FAILED";
  if(/permission|quyền|access denied/i.test(e))return "SOURCE_PERMISSION";
  return e||"IMAGE_WORKER_ERROR";
}

function getImageAuditSummaryV342(){
  var ss=SpreadsheetApp.getActiveSpreadsheet(),sheet=ss.getSheetByName(EHOME_IMAGE_AUDIT_V342.SHEET);if(!sheet||sheet.getLastRow()<2)return {exists:false};
  var v=sheet.getDataRange().getDisplayValues(),h=v[0].map(ceNormalize_),cStatus=ceFindHeader_(h,["status"]);var r={exists:true,total:0,present:0,ok:0,broken:0,missing:0,pending:0,error:0,notQueued:0,manualPending:0,doneButMissing:0};
  v.slice(1).forEach(function(row){r.total++;var s=String(row[cStatus]||"").trim().toUpperCase();if(s==="PRESENT")r.present++;else if(s==="OK")r.ok++;else if(s==="BROKEN")r.broken++;else if(s==="PENDING")r.pending++;else if(s==="ERROR")r.error++;else if(s==="MANUAL_PENDING")r.manualPending++;else if(s==="DONE_BUT_MISSING")r.doneButMissing++;else r.notQueued++;});r.missing=r.notQueued+r.manualPending+r.doneButMissing;return r;
}

function verifyImageAuditUrlsV342(limit){
  limit=Math.max(1,Math.min(100,Number(limit||50)));var ss=SpreadsheetApp.getActiveSpreadsheet(),sheet=ss.getSheetByName(EHOME_IMAGE_AUDIT_V342.SHEET);if(!sheet||sheet.getLastRow()<2)throw new Error("Chạy runImageAuditV342 trước.");
  var v=sheet.getDataRange().getDisplayValues(),h=v[0].map(ceNormalize_),cStatus=ceFindHeader_(h,["status"]),cReason=ceFindHeader_(h,["ly do"]),cUrl=ceFindHeader_(h,["image url","anh"]);var checked=0,ok=0,broken=0;
  for(var i=1;i<v.length&&checked<limit;i++){var st=String(v[i][cStatus]||"").trim().toUpperCase(),url=String(v[i][cUrl]||"").trim();if(!url||["PRESENT","BROKEN"].indexOf(st)<0)continue;checked++;var code=0,err="";try{var res=UrlFetchApp.fetch(url,{muteHttpExceptions:true,followRedirects:true});code=Number(res.getResponseCode()||0);}catch(e){err=String(e&&e.message?e.message:e);}var ns=code>=200&&code<400?"OK":"BROKEN";sheet.getRange(i+1,cStatus+1).setValue(ns);sheet.getRange(i+1,cReason+1).setValue(ns==="OK"?"HTTP_"+code:(err||"HTTP_"+code));if(ns==="OK")ok++;else broken++;}
  var result={success:true,code:"IMAGE_URL_VERIFY_DONE_V342",checked:checked,ok:ok,broken:broken};Logger.log(JSON.stringify(result));return result;
}

// Backward-compatible names used by Admin/health code.
function runImageAuditV30(){return runImageAuditV342();}
function getImageAuditSummaryV30(){return getImageAuditSummaryV342();}
function verifyImageAuditUrlsV30(limit){return verifyImageAuditUrlsV342(limit);}

function testImageAuditV342(){
  var reasons=[beImageAuditErrorReasonV342_("Nguồn không còn ảnh tại vị trí đã map."),beImageAuditErrorReasonV342_("Không lấy được URL/Blob/XLSX của ảnh."),beImageAuditErrorReasonV342_("Không map được ảnh theo tên/cột nguồn.")];
  if(reasons[0]!=="SOURCE_IMAGE_MISSING"||reasons[1]!=="IMAGE_ASSET_UNREADABLE"||reasons[2]!=="IMAGE_MAPPING_FAILED")throw new Error("IMAGE_AUDIT_REASON_TEST_FAILED");
  var result={success:true,code:"IMAGE_AUDIT_PASS_V342",cases:3};Logger.log(JSON.stringify(result));return result;
}
