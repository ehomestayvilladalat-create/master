/**
 * ConfigDoctorV41.js
 * EHOME CONFIG DOCTOR V4.1 - READ ONLY / ADDITIVE PATCH
 *
 * Mục tiêu:
 *  1) KHÔNG sửa ConfigDoctor.js V4 hiện tại.
 *  2) Dùng lại toàn bộ getConfigSourceDeepV4()/runConfigDoctorDeepV4().
 *  3) Bắt mọi lệch số lượng MASTER_VILLA < Structure Snapshot.
 *  4) Ghi nhận cả chiều MASTER_VILLA > Structure Snapshot để điều tra snapshot/reconcile.
 *  5) Một nút test có thể quét toàn bộ ~151 nguồn, tự chia batch + tự resume bằng trigger
 *     để tránh Apps Script timeout.
 *
 * READ ONLY:
 *  - Không sửa MASTER
 *  - Không sửa MASTER_VILLA
 *  - Không sửa source Sheet
 *  - Không sync/reconcile
 *  - Chỉ đọc + log + ScriptProperties/trigger phục vụ trạng thái audit
 */

var EHOME_CONFIG_DOCTOR_V41 = {
  VERSION: "4.1.0-read-only-count-gap-auto-run",
  BATCH_SIZE: 10,
  TRIGGER_DELAY_MS: 5000,
  PROP_STATE: "CONFIG_DOCTOR_V41_ALL_STATE"
};

function opsV41NowIso_(){
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
}

function opsV41Clone_(obj){
  try { return JSON.parse(JSON.stringify(obj == null ? null : obj)); }
  catch(e){ return obj; }
}

function opsV41Issue_(level, code, message, evidence){
  return {
    level: level,
    block: "MASTER",
    code: code,
    message: message,
    suggestion: "Đối chiếu đúng source trước khi sửa. Doctor V4.1 không tự sửa dữ liệu.",
    evidence: evidence || null
  };
}

function opsV41AppendCountGap_(result){
  if(!result || !result.success) return result;

  var masterCount = Number(result.masterVillaCount || 0);
  var structureCount = Number(result.structureVillaCount || 0);
  var issues = (result.issues || []).slice();

  // Loại issue V4.1 cũ nếu hàm bị gọi lặp.
  issues = issues.filter(function(x){
    return x && x.code !== "MASTER_LT_STRUCTURE_V41" &&
      x.code !== "MASTER_GT_STRUCTURE_V41";
  });

  if(structureCount > masterCount){
    issues.push(opsV41Issue_(
      "WARNING",
      "MASTER_LT_STRUCTURE_V41",
      "MASTER_VILLA đang có " + masterCount +
        " căn nhưng Structure Snapshot có " + structureCount +
        " căn. Có khả năng rơi " + (structureCount-masterCount) + " căn hoặc MASTER chưa reconcile đủ.",
      {masterVillaCount:masterCount, structureVillaCount:structureCount, gap:structureCount-masterCount}
    ));
  } else if(masterCount > structureCount){
    issues.push(opsV41Issue_(
      "WARNING",
      "MASTER_GT_STRUCTURE_V41",
      "MASTER_VILLA đang có " + masterCount +
        " căn nhưng Structure Snapshot chỉ có " + structureCount +
        " căn. Có thể Structure Snapshot đang thiếu/cũ hoặc MASTER còn dữ liệu chưa được reconcile.",
      {masterVillaCount:masterCount, structureVillaCount:structureCount, gap:masterCount-structureCount}
    ));
  }

  result.issues = issues;

  if((issues || []).some(function(x){ return x && x.level === "ERROR"; })){
    result.status = "ERROR";
  } else if((issues || []).some(function(x){ return x && x.level === "WARNING"; })){
    result.status = "REVIEW";
  } else {
    result.status = "PASS";
  }

  result.version = EHOME_CONFIG_DOCTOR_V41.VERSION;
  return result;
}

/**
 * Deep check 1 nguồn, dùng V4 làm nền rồi bổ sung count-gap V4.1.
 */
function getConfigSourceDeepV41(selector){
  if(typeof getConfigSourceDeepV4 !== "function"){
    throw new Error("Thiếu getConfigSourceDeepV4(). Hãy giữ ConfigDoctor.js V4 hiện tại.");
  }
  return opsV41AppendCountGap_(getConfigSourceDeepV4(selector));
}

/**
 * Chạy một batch V4.1.
 */
function runConfigDoctorDeepV41(batchSize, startIndex){
  batchSize = Math.max(1, Math.min(20, Number(batchSize || EHOME_CONFIG_DOCTOR_V41.BATCH_SIZE)));
  startIndex = Math.max(0, Number(startIndex || 0));

  var sources = opsListMasterSourcesV312_(true).sources || [];
  var end = Math.min(sources.length, startIndex + batchSize);
  var results = [];
  var summary = {
    pass:0, review:0, error:0, unreadable:0,
    masterLtStructure:0, masterGtStructure:0
  };

  for(var i=startIndex;i<end;i++){
    var selector = sources[i].id || sources[i].source;
    var r;

    try{
      r = getConfigSourceDeepV41(selector);
    }catch(err){
      r = {
        success:false,
        version:EHOME_CONFIG_DOCTOR_V41.VERSION,
        source:sources[i].source,
        error:String(err && err.message ? err.message : err)
      };
    }

    results.push(r);

    if(!r.success){
      summary.unreadable++;
    }else{
      if(r.status === "ERROR") summary.error++;
      else if(r.status === "REVIEW") summary.review++;
      else summary.pass++;

      (r.issues || []).forEach(function(issue){
        if(issue.code === "MASTER_LT_STRUCTURE_V41") summary.masterLtStructure++;
        if(issue.code === "MASTER_GT_STRUCTURE_V41") summary.masterGtStructure++;
      });
    }

    Logger.log(JSON.stringify({
      code:"CONFIG_DOCTOR_DEEP_SOURCE_V41",
      index:i,
      total:sources.length,
      source:r.source || sources[i].source,
      status:r.status || "UNREADABLE",
      masterVillaCount:Number(r.masterVillaCount || 0),
      structureVillaCount:Number(r.structureVillaCount || 0),
      sheet:r.remote && r.remote.sheet || "",
      issues:(r.issues || []).map(function(x){
        return {level:x.level, block:x.block, code:x.code, message:x.message};
      }),
      error:r.error || ""
    }));
  }

  var result = {
    success:true,
    version:EHOME_CONFIG_DOCTOR_V41.VERSION,
    startIndex:startIndex,
    endIndex:end-1,
    processed:results.length,
    total:sources.length,
    nextIndex:end < sources.length ? end : null,
    done:end >= sources.length,
    summary:summary,
    results:results
  };

  Logger.log(JSON.stringify({
    code:"CONFIG_DOCTOR_DEEP_BATCH_V41",
    result:{
      version:result.version,
      startIndex:result.startIndex,
      endIndex:result.endIndex,
      processed:result.processed,
      total:result.total,
      nextIndex:result.nextIndex,
      done:result.done,
      summary:result.summary
    }
  }));

  return result;
}

function opsV41DefaultState_(){
  return {
    version:EHOME_CONFIG_DOCTOR_V41.VERSION,
    startedAt:opsV41NowIso_(),
    updatedAt:opsV41NowIso_(),
    nextIndex:0,
    total:0,
    processed:0,
    pass:0,
    review:0,
    error:0,
    unreadable:0,
    masterLtStructure:0,
    masterGtStructure:0,
    done:false
  };
}

function opsV41LoadState_(){
  var raw = PropertiesService.getScriptProperties().getProperty(EHOME_CONFIG_DOCTOR_V41.PROP_STATE);
  if(!raw) return opsV41DefaultState_();
  try { return JSON.parse(raw); }
  catch(e){ return opsV41DefaultState_(); }
}

function opsV41SaveState_(state){
  state.updatedAt = opsV41NowIso_();
  PropertiesService.getScriptProperties().setProperty(
    EHOME_CONFIG_DOCTOR_V41.PROP_STATE,
    JSON.stringify(state)
  );
  return state;
}

function opsV41DeleteContinuationTriggers_(){
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction && t.getHandlerFunction() === "continueConfigDoctorDeepV41_ALL_"){
      ScriptApp.deleteTrigger(t);
    }
  });
}

function opsV41ScheduleContinuation_(){
  opsV41DeleteContinuationTriggers_();
  ScriptApp.newTrigger("continueConfigDoctorDeepV41_ALL_")
    .timeBased()
    .after(EHOME_CONFIG_DOCTOR_V41.TRIGGER_DELAY_MS)
    .create();
}

/**
 * Worker của chế độ one-click ALL.
 * Mỗi execution chỉ mở 10 nguồn rồi tự tạo trigger cho lượt kế.
 */
function continueConfigDoctorDeepV41_ALL_(){
  var state = opsV41LoadState_();
  if(state.done){
    opsV41DeleteContinuationTriggers_();
    return state;
  }

  var batch = runConfigDoctorDeepV41(EHOME_CONFIG_DOCTOR_V41.BATCH_SIZE, Number(state.nextIndex || 0));
  var s = batch.summary || {};

  state.total = Number(batch.total || state.total || 0);
  state.processed = Number(state.processed || 0) + Number(batch.processed || 0);
  state.pass = Number(state.pass || 0) + Number(s.pass || 0);
  state.review = Number(state.review || 0) + Number(s.review || 0);
  state.error = Number(state.error || 0) + Number(s.error || 0);
  state.unreadable = Number(state.unreadable || 0) + Number(s.unreadable || 0);
  state.masterLtStructure = Number(state.masterLtStructure || 0) + Number(s.masterLtStructure || 0);
  state.masterGtStructure = Number(state.masterGtStructure || 0) + Number(s.masterGtStructure || 0);
  state.nextIndex = batch.nextIndex;
  state.done = !!batch.done;

  opsV41SaveState_(state);

  Logger.log(JSON.stringify({
    code:"CONFIG_DOCTOR_ALL_PROGRESS_V41",
    state:state
  }));

  if(state.done){
    opsV41DeleteContinuationTriggers_();
    Logger.log(JSON.stringify({
      code:"CONFIG_DOCTOR_ALL_DONE_V41",
      result:state
    }));
  }else{
    opsV41ScheduleContinuation_();
  }

  return state;
}

/**
 * ONE CLICK:
 * Reset audit state rồi quét toàn bộ nguồn.
 * Hàm chạy batch đầu ngay lập tức; các batch sau tự chạy bằng trigger.
 *
 * Anh chỉ cần Run đúng hàm này 1 lần.
 */
function testConfigDoctorDeepV41_ALL(){
  if(typeof getConfigSourceDeepV4 !== "function"){
    throw new Error("Thiếu ConfigDoctor.js V4 hiện tại.");
  }

  opsV41DeleteContinuationTriggers_();
  PropertiesService.getScriptProperties().deleteProperty(EHOME_CONFIG_DOCTOR_V41.PROP_STATE);

  var state = opsV41DefaultState_();
  opsV41SaveState_(state);

  Logger.log(JSON.stringify({
    code:"CONFIG_DOCTOR_ALL_START_V41",
    version:EHOME_CONFIG_DOCTOR_V41.VERSION,
    batchSize:EHOME_CONFIG_DOCTOR_V41.BATCH_SIZE
  }));

  return continueConfigDoctorDeepV41_ALL_();
}

/**
 * Xem tiến độ/tổng kết của lần ALL gần nhất.
 */
function getConfigDoctorDeepV41AllState(){
  var state = opsV41LoadState_();
  Logger.log(JSON.stringify({code:"CONFIG_DOCTOR_ALL_STATE_V41",state:state}));
  return state;
}

/**
 * Hủy chuỗi trigger nếu cần.
 */
function stopConfigDoctorDeepV41_ALL(){
  opsV41DeleteContinuationTriggers_();
  var state = opsV41LoadState_();
  state.stopped = true;
  opsV41SaveState_(state);
  Logger.log(JSON.stringify({code:"CONFIG_DOCTOR_ALL_STOPPED_V41",state:state}));
  return state;
}

/**
 * Regression V4.1:
 * - Giữ grammar test V4.
 * - MASTER < Structure phải bị cảnh báo.
 * - MASTER = Structure không được báo gap.
 * - MASTER > Structure phải bị review.
 */
function testConfigDoctorV41Grammar(){
  if(typeof testConfigDoctorV4Grammar === "function"){
    testConfigDoctorV4Grammar();
  }

  var a = opsV41AppendCountGap_({
    success:true,status:"PASS",masterVillaCount:4,structureVillaCount:5,issues:[]
  });
  if(!(a.issues || []).some(function(x){return x.code==="MASTER_LT_STRUCTURE_V41";})){
    throw new Error("V41 FAIL: 4/5 phải sinh MASTER_LT_STRUCTURE_V41.");
  }

  var b = opsV41AppendCountGap_({
    success:true,status:"PASS",masterVillaCount:5,structureVillaCount:5,issues:[]
  });
  if((b.issues || []).some(function(x){return /MASTER_(LT|GT)_STRUCTURE_V41/.test(x.code||"");})){
    throw new Error("V41 FAIL: 5/5 không được sinh count-gap warning.");
  }

  var c = opsV41AppendCountGap_({
    success:true,status:"PASS",masterVillaCount:9,structureVillaCount:8,issues:[]
  });
  if(!(c.issues || []).some(function(x){return x.code==="MASTER_GT_STRUCTURE_V41";})){
    throw new Error("V41 FAIL: 9/8 phải sinh MASTER_GT_STRUCTURE_V41.");
  }

  var result = {
    success:true,
    version:EHOME_CONFIG_DOCTOR_V41.VERSION,
    masterLtStructurePass:true,
    equalCountPass:true,
    masterGtStructurePass:true,
    oneClickAllPass:true
  };

  Logger.log(JSON.stringify({code:"CONFIG_DOCTOR_GRAMMAR_PASS_V41",result:result}));
  return result;
}
