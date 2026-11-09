/**
 * EHOME MAINTENANCE V6.2.0
 * Full property refresh orchestration without running 1,000 villas in one execution.
 * Order: static/master info -> images -> audit.
 */
var EHOME_MAINTENANCE_V620 = {
  VERSION: "6.2.0",
  STATE_PROPERTY: "EHOME_MAINTENANCE_V620_STATE",
  COORDINATOR_HANDLER: "runEhomeMaintenanceCoordinatorV620_",
  COORDINATOR_MINUTES: 5,
  MASTER_BATCH_SOURCES: 4,
  MASTER_MAX_RUNTIME_MS: 150000,
  IMAGE_BATCH_SOURCES: 1,
  IMAGE_MAX_RUNTIME_MS: 140000
};

function beMaintenanceReadStateV620_(){
  var raw=PropertiesService.getScriptProperties().getProperty(EHOME_MAINTENANCE_V620.STATE_PROPERTY)||"";
  if(!raw)return null;
  try{return JSON.parse(raw);}catch(ignore){return null;}
}

function beMaintenanceWriteStateV620_(state){
  state=state||{};
  state.version=EHOME_MAINTENANCE_V620.VERSION;
  state.updatedAt=new Date().toISOString();
  PropertiesService.getScriptProperties().setProperty(EHOME_MAINTENANCE_V620.STATE_PROPERTY,JSON.stringify(state));
  return state;
}

function beMaintenanceActiveV620_(){
  var s=beMaintenanceReadStateV620_();
  return !!(s&&["INFO","IMAGES","AUDIT"].indexOf(String(s.stage||""))>=0);
}

function beMaintenanceMasterBatchSizeV620_(){return EHOME_MAINTENANCE_V620.MASTER_BATCH_SOURCES;}
function beMaintenanceMasterRuntimeV620_(){return EHOME_MAINTENANCE_V620.MASTER_MAX_RUNTIME_MS;}
function beMaintenanceImageBatchSizeV620_(){return EHOME_MAINTENANCE_V620.IMAGE_BATCH_SOURCES;}
function beMaintenanceImageRuntimeV620_(){return EHOME_MAINTENANCE_V620.IMAGE_MAX_RUNTIME_MS;}

function beRemoveMaintenanceCoordinatorTriggersV620_(){
  var removed=0;
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction()===EHOME_MAINTENANCE_V620.COORDINATOR_HANDLER){ScriptApp.deleteTrigger(t);removed++;}
  });
  return removed;
}

function beInstallMaintenanceCoordinatorV620_(){
  var handler=EHOME_MAINTENANCE_V620.COORDINATOR_HANDLER;
  var exists=ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()===handler;});
  if(exists)return {success:true,scheduled:false,reason:"ALREADY_SCHEDULED"};
  var trigger=ScriptApp.newTrigger(handler).timeBased().everyMinutes(EHOME_MAINTENANCE_V620.COORDINATOR_MINUTES).create();
  return {success:true,scheduled:true,triggerId:trigger.getUniqueId()};
}

function beEnabledMasterRowsV620_(){
  if(typeof opsListMasterSourcesV312_!=="function")throw new Error("OPS_SOURCE_READER_MISSING_V620");
  var rows=(opsListMasterSourcesV312_(true).sources||[]).map(function(s){return Number(s.row||0);}).filter(function(r){return r>=2;});
  if(typeof beAdminUniqueNumbersV328_==="function")return beAdminUniqueNumbersV328_(rows);
  var seen={};return rows.filter(function(r){if(seen[r])return false;seen[r]=true;return true;});
}

/** Refresh ALL property metadata using existing safe incremental reconcile. */
function startFullPropertyInfoRefreshV620(){
  var rows=beEnabledMasterRowsV620_();
  if(!rows.length)throw new Error("NO_ENABLED_MASTER_SOURCES_V620");
  if(typeof beAdminSetPendingRowsV328_!=="function"||typeof beAdminScheduleIncrementalWorkerV328_!=="function")throw new Error("INCREMENTAL_ENGINE_MISSING_V620");
  beAdminSetPendingRowsV328_(rows);
  var state=beMaintenanceWriteStateV620_({mode:"INFO_ONLY",stage:"INFO",startedAt:new Date().toISOString(),sourceCount:rows.length,imageQueued:false});
  beInstallMaintenanceCoordinatorV620_();
  var worker=beAdminScheduleIncrementalWorkerV328_();
  return {success:true,code:"FULL_INFO_REFRESH_STARTED_V620",sources:rows.length,worker:worker,state:state};
}

/** Build a fresh PENDING queue for every current villa, while preserving current MASTER image until replacement succeeds. */
function beQueueAllVillaImagesV620_(){
  if(typeof opsMasterVillaRowsV312_!=="function"||typeof opsListMasterSourcesV312_!=="function")throw new Error("OPS_HELPERS_MISSING_V620");
  if(typeof beReplaceImageCacheQueueV21_!=="function")throw new Error("IMAGE_QUEUE_HELPER_MISSING_V620");
  var sources=opsListMasterSourcesV312_(false).sources||[];
  var exact={},bySource={};
  sources.forEach(function(s){
    var sourceKey=normalizeMasterText(s.source||"");
    var link=String(s.link||"").trim();
    var item={id:String(s.id||""),source:String(s.source||""),link:link,configMaster:String(s.configMaster||""),configImage:String(s.configImage||"")};
    if(sourceKey&&link)exact[sourceKey+"|"+link]=item;
    if(sourceKey&&!bySource[sourceKey])bySource[sourceKey]=item;
  });
  var records=[],skipped=0,seen={};
  (opsMasterVillaRowsV312_()||[]).forEach(function(v){
    var sku=String(v.sku||"").trim();
    if(!sku||seen[sku])return;
    seen[sku]=true;
    var sourceKey=normalizeMasterText(v.source||"");
    var link=String(v.link||"").trim();
    var src=exact[sourceKey+"|"+link]||bySource[sourceKey]||null;
    if(!src||!src.link||!v.name||Number(v.sourceColumn||0)<=0){skipped++;return;}
    records.push({
      cacheSourceKey:typeof beImageCacheSourceKeyV329_==="function"?beImageCacheSourceKeyV329_("",sku,src.id,Number(v.sourceColumn||0)):(src.id+"_COL_"+Number(v.sourceColumn||0)),
      sku:sku,sourceId:src.id,source:src.source,link:src.link,villaName:String(v.name||""),sourceColumn:Number(v.sourceColumn||0),masterConfig:src.configMaster,imageConfig:src.configImage
    });
  });
  var replaced=beReplaceImageCacheQueueV21_(records);
  var scheduled=typeof beScheduleImageWorkerV21_==="function"?beScheduleImageWorkerV21_():null;
  return {success:true,code:"FULL_IMAGE_QUEUE_REBUILT_V620",queued:records.length,skipped:skipped,queue:replaced,schedule:scheduled};
}

function startFullImageRefreshV620(){
  var queued=beQueueAllVillaImagesV620_();
  var state=beMaintenanceWriteStateV620_({mode:"IMAGES_ONLY",stage:"IMAGES",startedAt:new Date().toISOString(),imageQueued:true,imageTotal:Number(queued.queued||0)});
  beInstallMaintenanceCoordinatorV620_();
  return {success:true,code:"FULL_IMAGE_REFRESH_STARTED_V620",queue:queued,state:state};
}

/** One button for owner: safe info refresh first, then all images, then audit. */
function startEhomeFullRefreshV620(){
  var rows=beEnabledMasterRowsV620_();
  if(!rows.length)throw new Error("NO_ENABLED_MASTER_SOURCES_V620");
  beAdminSetPendingRowsV328_(rows);
  var state=beMaintenanceWriteStateV620_({mode:"FULL",stage:"INFO",startedAt:new Date().toISOString(),sourceCount:rows.length,imageQueued:false});
  beInstallMaintenanceCoordinatorV620_();
  var worker=beAdminScheduleIncrementalWorkerV328_();
  return {success:true,code:"EHOME_FULL_REFRESH_STARTED_V620",sources:rows.length,masterBatch:EHOME_MAINTENANCE_V620.MASTER_BATCH_SOURCES,imageBatch:EHOME_MAINTENANCE_V620.IMAGE_BATCH_SOURCES,worker:worker,state:state};
}

function runEhomeMaintenanceCoordinatorV620_(){
  var state=beMaintenanceReadStateV620_();
  if(!state)return {success:true,active:false};
  var stage=String(state.stage||"");
  if(stage==="INFO"){
    var pending=typeof beAdminPendingRowsV328_==="function"?beAdminPendingRowsV328_():[];
    state.masterPending=pending.length;
    if(pending.length){
      if(typeof beAdminScheduleIncrementalWorkerV328_==="function")beAdminScheduleIncrementalWorkerV328_();
      beMaintenanceWriteStateV620_(state);
      return {success:true,stage:"INFO",pending:pending.length};
    }
    if(state.mode==="INFO_ONLY"){
      state.stage="DONE";state.completedAt=new Date().toISOString();beMaintenanceWriteStateV620_(state);beRemoveMaintenanceCoordinatorTriggersV620_();
      return {success:true,stage:"DONE",mode:state.mode};
    }
    var q=beQueueAllVillaImagesV620_();
    state.stage="IMAGES";state.imageQueued=true;state.imageTotal=Number(q.queued||0);state.imageSkipped=Number(q.skipped||0);beMaintenanceWriteStateV620_(state);
    return {success:true,stage:"IMAGES",queue:q};
  }
  if(stage==="IMAGES"){
    var qs=typeof getImageCacheQueueStatusV21==="function"?getImageCacheQueueStatusV21():{pending:0,error:0,done:0};
    state.imagePending=Number(qs.pending||0);state.imageDone=Number(qs.done||0);state.imageError=Number(qs.error||0);
    if(qs.pending>0){if(typeof beScheduleImageWorkerV21_==="function")beScheduleImageWorkerV21_();beMaintenanceWriteStateV620_(state);return {success:true,stage:"IMAGES",queue:qs};}
    state.stage="AUDIT";beMaintenanceWriteStateV620_(state);
  }
  if(String(state.stage||"")==="AUDIT"){
    var audit=typeof runImageAuditV342==="function"?runImageAuditV342():null;
    state.audit=audit;state.stage="DONE";state.completedAt=new Date().toISOString();beMaintenanceWriteStateV620_(state);beRemoveMaintenanceCoordinatorTriggersV620_();
    return {success:true,stage:"DONE",audit:audit};
  }
  if(stage==="DONE"||stage==="STOPPED"){beRemoveMaintenanceCoordinatorTriggersV620_();return {success:true,stage:stage,state:state};}
  return {success:false,stage:stage,error:"UNKNOWN_MAINTENANCE_STAGE_V620"};
}

function getEhomeFullRefreshStatusV620(){
  var state=beMaintenanceReadStateV620_()||{stage:"IDLE"};
  var masterPending=typeof beAdminPendingRowsV328_==="function"?beAdminPendingRowsV328_():[];
  var imageStatus=typeof getImageCacheQueueStatusV21==="function"?getImageCacheQueueStatusV21():{};
  return {success:true,state:state,masterPending:masterPending.length,imageQueue:imageStatus,active:beMaintenanceActiveV620_()};
}

function stopEhomeFullRefreshV620(){
  if(typeof beAdminSetPendingRowsV328_==="function")beAdminSetPendingRowsV328_([]);
  if(typeof beAdminRemoveIncrementalWorkerTriggersV328_==="function")beAdminRemoveIncrementalWorkerTriggersV328_();
  if(typeof beRemoveImageWorkerTriggersV21_==="function")beRemoveImageWorkerTriggersV21_();
  beRemoveMaintenanceCoordinatorTriggersV620_();
  var state=beMaintenanceReadStateV620_()||{};state.stage="STOPPED";state.stoppedAt=new Date().toISOString();beMaintenanceWriteStateV620_(state);
  return {success:true,code:"EHOME_FULL_REFRESH_STOPPED_V620"};
}

function testEhomeMaintenanceV620(){
  var cfg=EHOME_MAINTENANCE_V620;
  if(cfg.MASTER_BATCH_SOURCES<1||cfg.MASTER_BATCH_SOURCES>5)throw new Error("MASTER_BATCH_UNSAFE_V620");
  if(cfg.IMAGE_BATCH_SOURCES!==1)throw new Error("IMAGE_BATCH_UNSAFE_V620");
  if(cfg.MASTER_MAX_RUNTIME_MS>180000||cfg.IMAGE_MAX_RUNTIME_MS>180000)throw new Error("RUNTIME_BUDGET_UNSAFE_V620");
  var result={success:true,code:"EHOME_MAINTENANCE_PASS_V620",masterBatch:cfg.MASTER_BATCH_SOURCES,imageBatch:cfg.IMAGE_BATCH_SOURCES,masterRuntimeMs:cfg.MASTER_MAX_RUNTIME_MS,imageRuntimeMs:cfg.IMAGE_MAX_RUNTIME_MS};
  Logger.log(JSON.stringify(result));return result;
}

/** One-click COLLECT-ALL regression suite for the changes protected by this release. */
function testEhomeRegressionSuiteV620(){
  var tests=[
    "testEhomeMaintenanceV620",
    "testVillaIdentityResolverV1",
    "testVillaIdentityConfirmedRemoveAddV6111",
    "testVillaIdentityEqualCardinalityStillBlockedV6111",
    "testPriorityCalendarLayoutsV4193",
    "testSearchCompletenessInvariantV1",
    "testSearchStaticFiltersV1",
    "testSearchMinBedroomsContractV625",
    "testSearchSafetyV629",
    "testSearchRankingPaginationV1",
    "testMixedSourceProductTypeV612",
    "testEhomeCustomerFilterSuiteV613",
    "testSearchRoomFiltersV342",
    "testImageRoomPriorityV615",
    "testImagePipelineV342",
    "testImageAuditV342"
  ];
  if(typeof testEhomePropertyHubBridgeV1==="function")tests.push("testEhomePropertyHubBridgeV1");

  var results=[];
  var failures=[];
  tests.forEach(function(name){
    var started=new Date().getTime();
    try{
      var fn=this&&typeof this[name]==="function"?this[name]:null;
      if(!fn&&typeof globalThis!=="undefined"&&typeof globalThis[name]==="function")fn=globalThis[name];
      if(typeof fn!=="function")throw new Error("REGRESSION_TEST_MISSING_V620: "+name);
      var value=fn();
      results.push({name:name,status:"PASS",runtimeMs:new Date().getTime()-started,result:value});
    }catch(err){
      var failure={
        name:name,
        status:"FAIL",
        error:String(err&&err.message?err.message:err),
        stack:String(err&&err.stack?err.stack:""),
        runtimeMs:new Date().getTime()-started
      };
      results.push(failure);
      failures.push(failure);
    }
  },this);

  var passed=results.length-failures.length;
  var result={
    success:failures.length===0,
    code:failures.length===0?"EHOME_REGRESSION_SUITE_PASS_V620":"EHOME_REGRESSION_SUITE_FAIL_V620",
    total:results.length,
    passed:passed,
    failed:failures.length,
    failures:failures,
    results:results
  };
  Logger.log(JSON.stringify(result));
  return result;
}
