/** 28_SafeRepair.gs - two-step approved operational repairs. No arbitrary code/config write. */

function opsPendingActionSheetV312_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(EHOME_OPS_V312.PENDING_ACTION_SHEET) || ss.insertSheet(EHOME_OPS_V312.PENDING_ACTION_SHEET);
  if (sh.getLastRow() === 0) {
    sh.appendRow(["ID","TIME","ACTION","TARGET","STATUS","RESULT","APPLIED_AT"]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function requestOpsRepairV312(action,target) {
  action = String(action || "").trim().toUpperCase();
  var allowed = ["CLEAR_CACHE","BUILD_MASTER","RUN_IMAGE_AUDIT","RUN_IMAGE_WORKER","REINSTALL_AUTOSYNC","REBUILD_CALENDAR_METADATA","HEALTH_CHECK"];
  if (allowed.indexOf(action) < 0) return {success:false,error:"ACTION_NOT_ALLOWED",allowed:allowed};
  var tz = Session.getScriptTimeZone() || "Asia/Ho_Chi_Minh";
  var id = "OPS-" + Utilities.formatDate(new Date(),tz,"yyyyMMdd-HHmmss") + "-" + Utilities.getUuid().slice(0,4).toUpperCase();
  opsPendingActionSheetV312_().appendRow([id,new Date(),action,String(target || ""),"PENDING","",""]);
  return {success:true,pending:true,id:id,action:action,target:String(target || ""),instruction:"Xác nhận bằng /apply " + id};
}

function opsGetPendingActionV312_(id) {
  var sh = opsPendingActionSheetV312_();
  if (sh.getLastRow() < 2) return null;
  var vals = sh.getRange(2,1,sh.getLastRow()-1,7).getDisplayValues();
  for (var i=0;i<vals.length;i++) {
    if (String(vals[i][0]).trim() === String(id || "").trim()) return {row:i+2,id:vals[i][0],action:vals[i][2],target:vals[i][3],status:vals[i][4]};
  }
  return null;
}

function applyOpsRepairV312(id) {
  var sh = opsPendingActionSheetV312_();
  var item = opsGetPendingActionV312_(id);
  if (!item) return {success:false,error:"ACTION_NOT_FOUND",id:id};
  if (String(item.status).toUpperCase() !== "PENDING") return {success:false,error:"ACTION_NOT_PENDING",status:item.status};
  var result;
  try {
    switch (String(item.action || "").toUpperCase()) {
      case "CLEAR_CACHE": result = typeof clearBookingEngineCache === "function" ? clearBookingEngineCache() : {success:false,error:"FUNCTION_UNAVAILABLE"}; break;
      case "BUILD_MASTER": result = typeof buildMasterVilla === "function" ? buildMasterVilla() : {success:false,error:"FUNCTION_UNAVAILABLE"}; break;
      case "RUN_IMAGE_AUDIT": result = typeof runImageAuditV30 === "function" ? runImageAuditV30() : {success:false,error:"FUNCTION_UNAVAILABLE"}; break;
      case "RUN_IMAGE_WORKER": result = typeof runImageCacheWorkerV21 === "function" ? runImageCacheWorkerV21() : {success:false,error:"FUNCTION_UNAVAILABLE"}; break;
      case "REINSTALL_AUTOSYNC": result = typeof installEhomeAutoSyncTrigger === "function" ? installEhomeAutoSyncTrigger() : {success:false,error:"FUNCTION_UNAVAILABLE"}; break;
      case "REBUILD_CALENDAR_METADATA": result = typeof rebuildCalendarMetadata === "function" ? rebuildCalendarMetadata() : {success:false,error:"FUNCTION_UNAVAILABLE"}; break;
      case "HEALTH_CHECK": result = typeof getSystemHealthV30 === "function" ? getSystemHealthV30() : {success:false,error:"FUNCTION_UNAVAILABLE"}; break;
      default: result = {success:false,error:"ACTION_NOT_ALLOWED"};
    }
  } catch (err) { result = {success:false,error:String(err && err.message ? err.message : err)}; }
  var status = result && result.success === false ? "FAILED" : "APPLIED";
  sh.getRange(item.row,5,1,3).setValues([[status,JSON.stringify(result).slice(0,45000),new Date()]]);
  if (typeof beEmitSystemEventV30_ === "function") beEmitSystemEventV30_(status === "APPLIED" ? "INFO" : "ERROR","OPS_REPAIR_V312",{message:item.action,action:item.action,target:item.target,status:status});
  Logger.log(JSON.stringify({code:"OPS_REPAIR_APPLIED_V312",id:id,action:item.action,result:result}));
  return result;
}
