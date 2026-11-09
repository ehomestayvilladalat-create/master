/** 09_Admin.gs - EHOME V3.2.8 INCREMENTAL MASTER ADMIN */

var EHOME_MASTER_INCREMENTAL_V328 = {
  VERSION: "3.2.8",
  STATE_PREFIX: "EHOME_MASTER_SYNC_V328_",
  PENDING_PROPERTY: "EHOME_MASTER_INCREMENTAL_PENDING_V328",
  WORKER_HANDLER: "ehomeIncrementalMasterWorkerV328_",
  MAX_SOURCES_PER_RUN: 10,
  MAX_RUNTIME_MS: 220000,
  WORKER_DELAY_MS: 60000
};

function validateMasterSchema_(){
  var s=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BE_CONFIG.MASTER_SHEET);
  if(!s)throw new Error('Không tìm thấy sheet MASTER');
  return {success:true};
}

function migrateMasterSchema(){
  validateMasterSchema_();
  setupMasterAreaOptionsV21();
  return {success:true};
}

/**
 * Full sync vẫn giữ để cứu hộ / rebuild toàn bộ khi thật sự cần.
 * V3.2.8 bật fastImages để MASTER không direct-read từng ô ảnh rồi timeout.
 */
function syncBookingEngine(){
  var lock=LockService.getScriptLock();
  lock.waitLock(30000);
  try{
    var startedAt=new Date().getTime();
    var m=buildMasterVilla({fastImages:true});
    var md=rebuildCalendarMetadata();
    clearBookingEngineCache();
    var snapshotPrune=null;
    if(typeof ssPruneOrphanScheduleSnapshotRowsV416_==="function"){
      try{
        snapshotPrune=ssPruneOrphanScheduleSnapshotRowsV416_();
      }catch(snapshotPruneErrV416){
        Logger.log(JSON.stringify({
          level:"WARNING",
          code:"SCHEDULE_SNAPSHOT_PRUNE_FAILED_V416",
          stage:"FULL_SYNC",
          error:String(snapshotPruneErrV416&&snapshotPruneErrV416.message||snapshotPruneErrV416)
        }));
      }
    }

    if(m&&m.successfulRows&&m.successfulRows.length){
      beAdminUpdateSyncStateRowsV328_(m.successfulRows);
    }

    var result={
      success:true,
      mode:"FULL_FAST_IMAGES_V328",
      villas:Number(m&&m.villas||0),
      sources:Number(md&&md.count||0),
      failedRows:(m&&m.failedRows)||[],
      snapshotPrunedRows:Number(snapshotPrune&&snapshotPrune.removedRows||0),
      elapsedMs:new Date().getTime()-startedAt,
      version:BE_CONFIG.VERSION
    };

    Logger.log(JSON.stringify({code:"SYNC_BOOKING_ENGINE_DONE_V328",result:result}));
    return result;
  }finally{
    lock.releaseLock();
  }
}

/* ================= V3.2.8 INCREMENTAL MASTER ================= */

function beAdminUniqueNumbersV328_(values){
  var seen={};
  return (values||[]).map(Number).filter(function(n){
    if(!isFinite(n)||n<=1||seen[n])return false;
    seen[n]=true;
    return true;
  }).sort(function(a,b){return a-b;});
}

function beAdminHashV328_(text){
  var digest=Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(text||""),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g,"").slice(0,28);
}

function beAdminStateKeyV328_(record){
  record=record||{};
  var stable=cleanMasterText(record.id)||normalizeMasterText(record.source)||cleanMasterText(record.link)||String(record.row||"");
  return EHOME_MASTER_INCREMENTAL_V328.STATE_PREFIX+beAdminHashV328_(stable);
}

function beAdminCanonicalCalendarConfigV328_(value){
  return cleanMasterText(value||"")
    .replace(/(?:^|;)\s*GROUP_OPTIONS_B64=[^;\s]*/ig,"")
    .replace(/^;+|;+$/g,"")
    .replace(/;;+/g,";")
    .replace(/\s*;\s*/g,";")
    .trim()
    .toUpperCase()||"AUTO";
}

function beAdminFingerprintV328_(record){
  record=record||{};
  return beAdminHashV328_([
    record.enabled===true?"1":"0",
    cleanMasterText(record.id),
    cleanMasterText(record.city),
    cleanMasterText(record.source),
    cleanMasterText(record.link),
    cleanMasterText(record.configMaster),
    beAdminCanonicalCalendarConfigV328_(record.configCalendar),
    cleanMasterText(record.configImage),
    cleanMasterText(record.configInfo),
    cleanMasterText(record.type)
  ].join("\u001f"));
}

function beAdminParseStateV328_(raw){
  try{return raw?JSON.parse(raw):null;}catch(ignore){return null;}
}

/**
 * V6.1.10: disabled/blank MASTER rows that no longer own any MASTER_VILLA rows
 * are operational no-ops. Their historical fingerprint may differ forever, but
 * they must not keep re-entering the incremental reconcile backlog.
 */
function beAdminShouldTrackFingerprintDriftV6110_(record,presentCount){
  record=record||{};
  return record.enabled===true || Number(presentCount||0)>0;
}

function testMasterIncrementalDisabledEmptyNoopV6110(){
  var cases=[
    {enabled:false,present:0,expected:false},
    {enabled:false,present:5,expected:true},
    {enabled:true,present:0,expected:true},
    {enabled:true,present:7,expected:true}
  ];
  cases.forEach(function(c,i){
    var got=beAdminShouldTrackFingerprintDriftV6110_({enabled:c.enabled},c.present);
    if(got!==c.expected)throw new Error('MASTER_INCREMENTAL_DISABLED_EMPTY_NOOP_FAIL_V6110 case='+(i+1));
  });
  var result={success:true,code:'MASTER_INCREMENTAL_DISABLED_EMPTY_NOOP_PASS_V6110',cases:cases.length};
  Logger.log(JSON.stringify(result));
  return result;
}

function beAdminReadMasterRecordsV328_(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var sheet=ss.getSheetByName(BE_CONFIG.MASTER_SHEET);
  if(!sheet)throw new Error('Không tìm thấy sheet MASTER');
  var values=sheet.getDataRange().getValues();
  if(!values.length)return {sheet:sheet,headers:null,records:[]};
  var headers=beHeaderMap_(values[0]);
  var records=[];

  for(var r=1;r<values.length;r++){
    var row=values[r];
    var record={
      row:r+1,
      id:cleanMasterText(beGetByHeader_(row,headers.id)),
      city:cleanMasterText(beGetByHeader_(row,headers.city)),
      source:cleanMasterText(beGetByHeader_(row,headers.source)),
      link:cleanMasterText(beGetByHeader_(row,headers.link)),
      enabled:beBoolCell_(beGetByHeader_(row,headers.enable)),
      configMaster:cleanMasterText(beGetByHeader_(row,headers.configMaster)),
      configCalendar:cleanMasterText(beGetByHeader_(row,headers.configCalendar))||"AUTO",
      configImage:cleanMasterText(beGetByHeader_(row,headers.configImage)),
      configInfo:cleanMasterText(beGetByHeader_(row,headers.configInfo)),
      type:cleanMasterText(beGetByHeader_(row,headers.type)),
      status:headers.status>=0?cleanMasterText(beGetByHeader_(row,headers.status)):""
    };
    if(!record.id&&!record.source&&!record.link)continue;
    record.fingerprint=beAdminFingerprintV328_(record);
    record.stateKey=beAdminStateKeyV328_(record);
    records.push(record);
  }
  return {sheet:sheet,headers:headers,records:records};
}

function beAdminReadMasterVillaIndexV328_(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var sheet=ss.getSheetByName(BE_CONFIG.MASTER_VILLA_SHEET);
  var index={
    countByLink:{},countBySource:{},
    representativeByLink:{},representativeBySource:{},
    total:0
  };
  if(!sheet||sheet.getLastRow()<2)return index;

  var width=sheet.getLastColumn();
  var headers=sheet.getRange(1,1,1,width).getDisplayValues()[0].map(ceNormalize_);
  var c={
    city:ceFindHeader_(headers,["thanh pho","city"]),
    source:ceFindHeader_(headers,["nguon","source"]),
    link:ceFindHeader_(headers,["link lich","link","url"]),
    config:ceFindHeader_(headers,["config lich","calendar config","config calendar"])
  };
  var rows=sheet.getRange(2,1,sheet.getLastRow()-1,width).getDisplayValues();
  index.total=rows.length;

  rows.forEach(function(row){
    var link=c.link>=0?cleanMasterText(row[c.link]):"";
    var source=c.source>=0?cleanMasterText(row[c.source]):"";
    var sourceKey=normalizeMasterText(source);
    var rep={
      link:link,
      source:source,
      city:c.city>=0?cleanMasterText(row[c.city]):"",
      configCalendar:c.config>=0?cleanMasterText(row[c.config]):"AUTO"
    };
    if(link){
      index.countByLink[link]=(index.countByLink[link]||0)+1;
      if(!index.representativeByLink[link])index.representativeByLink[link]=rep;
    }
    if(sourceKey){
      index.countBySource[sourceKey]=(index.countBySource[sourceKey]||0)+1;
      if(!index.representativeBySource[sourceKey])index.representativeBySource[sourceKey]=rep;
    }
  });
  return index;
}

/**
 * Lập kế hoạch incremental. Lần đầu V3.2.8 sẽ bootstrap fingerprint cho
 * source đang có MASTER_VILLA và không thấy mismatch, tránh rebuild cả 500+ căn.
 */
function getMasterIncrementalPlanV328(options){
  options=options||{};
  var masterData=beAdminReadMasterRecordsV328_();
  var villaIndex=beAdminReadMasterVillaIndexV328_();
  var props=PropertiesService.getScriptProperties();
  var targets=[];
  var rows=[];
  var bootstrapProps={};

  masterData.records.forEach(function(record){
    var sourceKey=normalizeMasterText(record.source);
    var presentByLink=record.link?Number(villaIndex.countByLink[record.link]||0):0;
    var presentByName=sourceKey?Number(villaIndex.countBySource[sourceKey]||0):0;
    var presentCount=record.link?presentByLink:presentByName;
    var rep=(record.link&&villaIndex.representativeByLink[record.link])||villaIndex.representativeBySource[sourceKey]||null;
    var previous=beAdminParseStateV328_(props.getProperty(record.stateKey));
    var reasons=[];
    var waitingForStructureV340=false;
    var stableForMasterAddV340=true;

    if(record.enabled&&!record.link)reasons.push("MISSING_LINK");
    if(record.enabled&&record.link&&presentCount===0){
      if(typeof ssIsStableForMasterAddV340_==="function"){
        try{
          stableForMasterAddV340=ssIsStableForMasterAddV340_(record.id,record.source,record.link)===true;
        }catch(stableAddErrV340){
          stableForMasterAddV340=false;
        }
      }
      if(stableForMasterAddV340)reasons.push("NEW_OR_ZERO_MASTER_CONFIRMED_V340");
      else waitingForStructureV340=true;
    }
    if(!record.enabled&&presentCount>0)reasons.push("DISABLED_REMOVE");

    if(
      previous&&
      String(previous.fingerprint||"")!==record.fingerprint&&
      beAdminShouldTrackFingerprintDriftV6110_(record,presentCount)
    ){
      reasons.push("CONFIG_OR_SOURCE_CHANGED");
    }

    // V3.4.0: nguồn có thay đổi cấu trúc đã được đọc giống nhau 2 lần liên tiếp.
    // Đây là cầu nối StructureSnapshot -> incremental rebuild, không phụ thuộc CONFIG đổi.
    if(record.enabled&&record.link&&typeof ssGetConfirmedStructureForSourceV340_==="function"){
      try{
        var structureConfirmedV340=ssGetConfirmedStructureForSourceV340_(record.id,record.source,record.link);
        if(
          structureConfirmedV340&&
          structureConfirmedV340.confirmed===true&&
          structureConfirmedV340.autoRebuildAllowed!==false
        ){
          reasons.push("STRUCTURE_CONFIRMED_CHANGED");
        }
      }catch(structurePlanErrV340){
        Logger.log(JSON.stringify({
          code:"STRUCTURE_PLAN_CHECK_FAILED_V340",
          row:record.row,source:record.source,error:String(structurePlanErrV340&&structurePlanErrV340.message||structurePlanErrV340)
        }));
      }
    }

    if(rep&&record.enabled){
      if(normalizeMasterText(rep.source)!==normalizeMasterText(record.source))reasons.push("SOURCE_NAME_MISMATCH");
      if(normalizeMasterText(rep.city)!==normalizeMasterText(record.city))reasons.push("CITY_MISMATCH");
      if(
        beAdminCanonicalCalendarConfigV328_(rep.configCalendar)!==
        beAdminCanonicalCalendarConfigV328_(record.configCalendar)
      )reasons.push("CALENDAR_CONFIG_MISMATCH");
    }

    var statusNorm=normalizeMasterText(record.status);
    if(/^(?:error|loi)\b/.test(statusNorm)||/\b0\s*can\b/.test(statusNorm)){
      reasons.push("MASTER_STATUS_RETRY");
    }

    // V3.4.0: nguồn chưa có MASTER tuyệt đối không được đi đường tắt bởi
    // CONFIG change/status retry. Phải chờ StructureSnapshot đọc giống nhau 2 lần.
    if(waitingForStructureV340){
      reasons=[];
    }

    // De-duplicate reason list.
    var seenReason={};
    reasons=reasons.filter(function(reason){
      if(seenReason[reason])return false;
      seenReason[reason]=true;
      return true;
    });

    var previousLink=previous&&previous.link?cleanMasterText(previous.link):(rep?cleanMasterText(rep.link):"");
    var previousSource=previous&&previous.source?cleanMasterText(previous.source):(rep?cleanMasterText(rep.source):"");
    var item={
      row:record.row,
      id:record.id,
      city:record.city,
      source:record.source,
      link:record.link,
      enabled:record.enabled,
      presentCount:presentCount,
      reasons:reasons,
      fingerprint:record.fingerprint,
      stateKey:record.stateKey,
      previousLink:previousLink,
      previousSource:previousSource,
      waitingForStructure:waitingForStructureV340,
      stableForMasterAdd:stableForMasterAddV340
    };
    rows.push(item);

    if(reasons.length){
      targets.push(item);
    }else if(!previous){
      bootstrapProps[record.stateKey]=JSON.stringify({
        fingerprint:record.fingerprint,
        link:record.link,
        source:record.source,
        updatedAt:new Date().toISOString(),
        bootstrapped:true
      });
    }
  });

  if(Object.keys(bootstrapProps).length){
    props.setProperties(bootstrapProps,false);
  }

  var result={
    success:true,
    version:EHOME_MASTER_INCREMENTAL_V328.VERSION,
    masterRows:masterData.records.length,
    masterVillas:villaIndex.total,
    targetCount:targets.length,
    targetRows:targets.map(function(x){return x.row;}),
    targets:targets,
    rows:rows,
    bootstrapped:Object.keys(bootstrapProps).length
  };

  if(options.log!==false){
    Logger.log(JSON.stringify({
      code:"MASTER_INCREMENTAL_PLAN_V328",
      masterRows:result.masterRows,
      masterVillas:result.masterVillas,
      targetCount:result.targetCount,
      targetRows:result.targetRows,
      targets:targets.map(function(x){return {row:x.row,source:x.source,reasons:x.reasons};}),
      bootstrapped:result.bootstrapped
    }));
  }
  return result;
}

function beAdminUpdateSyncStateRowsV328_(rowNumbers){
  var wanted={};
  beAdminUniqueNumbersV328_(rowNumbers).forEach(function(row){wanted[row]=true;});
  if(!Object.keys(wanted).length)return 0;

  var data=beAdminReadMasterRecordsV328_();
  var updates={};
  data.records.forEach(function(record){
    if(!wanted[record.row])return;
    updates[record.stateKey]=JSON.stringify({
      fingerprint:record.fingerprint,
      link:record.link,
      source:record.source,
      updatedAt:new Date().toISOString()
    });
  });
  if(Object.keys(updates).length){
    PropertiesService.getScriptProperties().setProperties(updates,false);
  }
  return Object.keys(updates).length;
}

function beAdminPendingRowsV328_(){
  var raw=PropertiesService.getScriptProperties().getProperty(EHOME_MASTER_INCREMENTAL_V328.PENDING_PROPERTY)||"";
  try{return beAdminUniqueNumbersV328_(raw?JSON.parse(raw):[]);}catch(ignore){return [];}
}

function beAdminSetPendingRowsV328_(rows){
  rows=beAdminUniqueNumbersV328_(rows);
  var props=PropertiesService.getScriptProperties();
  if(rows.length){
    props.setProperty(EHOME_MASTER_INCREMENTAL_V328.PENDING_PROPERTY,JSON.stringify(rows));
  }else{
    props.deleteProperty(EHOME_MASTER_INCREMENTAL_V328.PENDING_PROPERTY);
  }
  return rows;
}

function beAdminRemoveIncrementalWorkerTriggersV328_(){
  var removed=0;
  ScriptApp.getProjectTriggers().forEach(function(trigger){
    if(trigger.getHandlerFunction()===EHOME_MASTER_INCREMENTAL_V328.WORKER_HANDLER){
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });
  return removed;
}

function beAdminScheduleIncrementalWorkerV328_(){
  var handler=EHOME_MASTER_INCREMENTAL_V328.WORKER_HANDLER;
  var exists=ScriptApp.getProjectTriggers().some(function(trigger){
    return trigger.getHandlerFunction()===handler;
  });
  if(exists)return {success:true,scheduled:false,reason:"ALREADY_SCHEDULED"};

  var trigger=ScriptApp.newTrigger(handler)
    .timeBased()
    .after(Number(EHOME_MASTER_INCREMENTAL_V328.WORKER_DELAY_MS||60000))
    .create();
  Logger.log(JSON.stringify({
    code:"MASTER_INCREMENTAL_CONTINUATION_SCHEDULED_V328",
    triggerId:trigger.getUniqueId(),
    pending:beAdminPendingRowsV328_()
  }));
  return {success:true,scheduled:true,triggerId:trigger.getUniqueId()};
}

/** Core KHÔNG tự lock để AutoSync có thể gọi dưới cùng ScriptLock hiện tại. */
function syncMasterIncrementalCoreV328_(options){
  options=options||{};
  var startedAt=new Date().getTime();
  var reason=String(options.reason||"MANUAL");
  var maxSources=Math.max(1,Number(options.maxSources||EHOME_MASTER_INCREMENTAL_V328.MAX_SOURCES_PER_RUN||10));
  // V6.1.9: source bi disable/xoa khoi MASTER khong con row de vao incremental plan.
  // Don block orphan truoc khi lap plan, voi guard SOURCE+LINK deu khong con active.
  var orphanCleanupV619={removed:0};
  if(typeof autoApplyDeletedSourceOrphansV619_==="function"){
    try{orphanCleanupV619=autoApplyDeletedSourceOrphansV619_({maxSources:10,maxRows:150})||{removed:0};}
    catch(orphanErrV619){Logger.log(JSON.stringify({level:"WARNING",code:"MASTER_ORPHAN_AUTO_FAILED_V619",error:String(orphanErrV619&&orphanErrV619.message||orphanErrV619)}));}
  }
  var plan=getMasterIncrementalPlanV328({log:false});
  var requested=beAdminUniqueNumbersV328_(options.targetRows||[]);

  // Nút nguồn mới / AutoSync ưu tiên queue còn dở rồi mới thêm target mới.
  if(!requested.length){
    requested=beAdminUniqueNumbersV328_(beAdminPendingRowsV328_().concat(plan.targetRows||[]));
  }

  if(!requested.length){
    if(options.consumePending===true)beAdminSetPendingRowsV328_([]);
    var orphanSnapshotPruneV619=null;
    if(Number(orphanCleanupV619&&orphanCleanupV619.removed||0)>0){
      rebuildCalendarMetadata();
      clearBookingEngineCache();
      if(typeof ssPruneOrphanScheduleSnapshotRowsV416_==="function")orphanSnapshotPruneV619=ssPruneOrphanScheduleSnapshotRowsV416_();
    }
    var nothing={
      success:true,mode:"INCREMENTAL",reason:reason,targetCount:0,
      selectedRows:[],processedRows:[],successfulRows:[],failedRows:[],
      processedVillas:0,villas:plan.masterVillas,pending:0,pendingRows:[],
      orphanRemoved:Number(orphanCleanupV619&&orphanCleanupV619.removed||0),
      snapshotPrunedRows:Number(orphanSnapshotPruneV619&&orphanSnapshotPruneV619.removedRows||0),
      elapsedMs:new Date().getTime()-startedAt
    };
    Logger.log(JSON.stringify({code:"SYNC_INCREMENTAL_NO_CHANGES_V328",result:nothing}));
    return nothing;
  }

  var selected=requested.slice(0,maxSources);
  var remaining=requested.slice(maxSources);
  var byRow={};
  (plan.rows||[]).forEach(function(item){byRow[Number(item.row)]=item;});
  var replaceIdentities=selected.map(function(rowNumber){
    var item=byRow[rowNumber]||{};
    return {
      row:rowNumber,
      link:item.link||"",
      source:item.source||"",
      previousLink:item.previousLink||"",
      previousSource:item.previousSource||""
    };
  });

  Logger.log(JSON.stringify({
    code:"SYNC_INCREMENTAL_START_V328",
    reason:reason,
    selectedRows:selected,
    remainingRows:remaining,
    maxSources:maxSources
  }));

  var masterResult=buildMasterVilla({
    mode:"INCREMENTAL",
    targetRows:selected,
    replaceIdentities:replaceIdentities,
    maxRuntimeMs:Number(options.maxRuntimeMs||EHOME_MASTER_INCREMENTAL_V328.MAX_RUNTIME_MS||220000),
    fastImages:true
  });

  var processedSet={};
  (masterResult.processedRows||[]).forEach(function(row){processedSet[Number(row)]=true;});
  selected.forEach(function(row){
    if(!processedSet[row])remaining.push(row);
  });
  remaining=beAdminUniqueNumbersV328_(remaining);

  var stateUpdated=beAdminUpdateSyncStateRowsV328_(masterResult.successfulRows||[]);
  var structureAcceptedV340={accepted:0};
  if((masterResult.successfulRows||[]).length&&typeof ssAcceptConfirmedStructureByMasterRowsV340_==="function"){
    try{
      structureAcceptedV340=ssAcceptConfirmedStructureByMasterRowsV340_(masterResult.successfulRows||[])||{accepted:0};
    }catch(structureAcceptErrV340){
      Logger.log(JSON.stringify({
        code:"STRUCTURE_BASELINE_AUTO_ACCEPT_FAILED_V340",
        error:String(structureAcceptErrV340&&structureAcceptErrV340.message||structureAcceptErrV340)
      }));
    }
  }
  var metadata=null;
  var snapshotPrune=null;
  if((masterResult.successfulRows||[]).length||Number(orphanCleanupV619&&orphanCleanupV619.removed||0)>0){
    metadata=rebuildCalendarMetadata();
    clearBookingEngineCache();
    if(typeof ssPruneOrphanScheduleSnapshotRowsV416_==="function"){
      try{
        snapshotPrune=ssPruneOrphanScheduleSnapshotRowsV416_();
      }catch(snapshotPruneErrV416){
        Logger.log(JSON.stringify({
          level:"WARNING",
          code:"SCHEDULE_SNAPSHOT_PRUNE_FAILED_V416",
          stage:"INCREMENTAL_SYNC",
          error:String(snapshotPruneErrV416&&snapshotPruneErrV416.message||snapshotPruneErrV416)
        }));
      }
    }
  }

  if(options.consumePending===true||!options.targetRows||!options.targetRows.length){
    beAdminSetPendingRowsV328_(remaining);
  }else if(remaining.length){
    beAdminSetPendingRowsV328_(beAdminPendingRowsV328_().concat(remaining));
  }

  var pending=beAdminPendingRowsV328_();
  if(pending.length&&options.scheduleContinuation!==false){
    beAdminScheduleIncrementalWorkerV328_();
  }

  var output={
    success:true,
    mode:"INCREMENTAL_V328",
    reason:reason,
    targetCount:requested.length,
    selectedRows:selected,
    processedRows:masterResult.processedRows||[],
    successfulRows:masterResult.successfulRows||[],
    failedRows:masterResult.failedRows||[],
    processedVillas:Number(masterResult.processedVillas||0),
    villas:Number(masterResult.villas||0),
    metadataSources:Number(metadata&&metadata.count||0),
    snapshotPrunedRows:Number(snapshotPrune&&snapshotPrune.removedRows||0),
    orphanRemoved:Number(orphanCleanupV619&&orphanCleanupV619.removed||0),
    stateUpdated:stateUpdated,
    structureAccepted:Number(structureAcceptedV340&&structureAcceptedV340.accepted||0),
    stoppedEarly:masterResult.stoppedEarly===true,
    pending:pending.length,
    pendingRows:pending,
    elapsedMs:new Date().getTime()-startedAt
  };

  Logger.log(JSON.stringify({code:"SYNC_INCREMENTAL_DONE_V328",result:output}));
  return output;
}

/** Nút chính: chỉ xử lý source mới / 0 MASTER / CONFIG-source đổi. */
function syncNewSourceV328(){
  var lock=LockService.getScriptLock();
  lock.waitLock(30000);
  try{
    var result=syncMasterIncrementalCoreV328_({reason:"NEW_OR_CHANGED_SOURCE",maxSources:EHOME_MASTER_INCREMENTAL_V328.MAX_SOURCES_PER_RUN});
    try{
      SpreadsheetApp.getActiveSpreadsheet().toast(
        "Đồng bộ: "+result.successfulRows.length+" nguồn OK · còn "+result.pending+" nguồn chờ",
        "EHOME - Incremental",
        8
      );
    }catch(ignoreToast){}
    return result;
  }finally{
    lock.releaseLock();
  }
}

/** Force rebuild đúng các hàng đang chọn trong sheet MASTER. */
function syncSelectedSourcesV328(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var sheet=ss.getActiveSheet();

  if(!sheet||sheet.getName()!==BE_CONFIG.MASTER_SHEET){
    throw new Error('Anh chọn hàng nguồn ngay trong sheet "'+BE_CONFIG.MASTER_SHEET+'" rồi chạy lại.');
  }

  var ranges=[];
  try{
    var list=SpreadsheetApp.getActiveRangeList();
    ranges=list&&list.getRanges?list.getRanges():[];
  }catch(ignoreRangeList){}

  if(!ranges.length&&sheet.getActiveRange()){
    ranges=[sheet.getActiveRange()];
  }

  var rows=[];
  ranges.forEach(function(range){
    var start=range.getRow();
    var end=range.getLastRow();

    for(var r=Math.max(2,start);r<=end;r++){
      rows.push(r);
    }
  });

  rows=beAdminUniqueNumbersV328_(rows);

  if(!rows.length){
    throw new Error("Không có hàng nguồn nào được chọn.");
  }

  var lock=LockService.getScriptLock();
  lock.waitLock(30000);

  try{
    return syncMasterIncrementalCoreV328_({
      reason:"SELECTED_SOURCE_FORCE",
      targetRows:rows,
      maxSources:EHOME_MASTER_INCREMENTAL_V328.MAX_SOURCES_PER_RUN
    });
  }finally{
    lock.releaseLock();
  }
}

/**
 * R3 - làm mới metadata tĩnh (TIÊU CHUẨN / PN / THÔNG TIN) cho toàn bộ
 * nguồn Enable theo từng batch incremental hiện hữu.
 *
 * Safety:
 * - Không ghi tay MASTER_VILLA.
 * - Không bỏ qua buildMasterVilla/R2 reconcile/Structure guard.
 * - 10 nguồn/lượt và worker V328 tiếp tục phần còn lại, tránh timeout.
 * - Không trộn với một queue incremental đang chạy dở.
 */
function startStaticInfoBackfillV417(){
  throw new Error(
    "STATIC_INFO_BACKFILL_PAUSED_V418: Preview R3 cũ đề xuất quá rộng. " +
    "Hãy chạy previewStaticInfoIntegrityV418, approveStaticInfoIntegrityV418, " +
    "rồi applyStaticInfoIntegrityV418."
  );
}

var EHOME_STATIC_APPROVAL_PROP_V418_="STATIC_INFO_APPROVAL_V418";
var EHOME_STATIC_PREVIEW_PROP_V418_="STATIC_INFO_PREVIEW_V418";

/** Ghi nhận đúng fingerprint preview; chưa thay đổi ô MASTER_VILLA nào. */
function approveStaticInfoIntegrityV418(){
  var props=PropertiesService.getScriptProperties();
  var previewRaw=String(props.getProperty(EHOME_STATIC_PREVIEW_PROP_V418_)||"");
  if(!previewRaw)throw new Error("STATIC_INFO_PREVIEW_REQUIRED_V418");
  var preview=JSON.parse(previewRaw);
  var previewedMs=new Date(preview.previewedAt||"").getTime();
  if(!previewedMs||new Date().getTime()-previewedMs>60*60*1000){
    throw new Error("STATIC_INFO_PREVIEW_EXPIRED_V418");
  }
  var plan=beBuildStaticInfoPlanV418_();
  if(plan.fingerprint!==preview.fingerprint||plan.autoChanges.length!==Number(preview.proposedChanges||0)){
    throw new Error("STATIC_INFO_CHANGED_AFTER_PREVIEW_V418");
  }
  var approval={
    fingerprint:plan.fingerprint,proposedChanges:plan.autoChanges.length,
    approvedAt:new Date().toISOString()
  };
  props.setProperty(
    EHOME_STATIC_APPROVAL_PROP_V418_,JSON.stringify(approval)
  );
  var result={success:true,code:"STATIC_INFO_PREVIEW_APPROVED_V418",approval:approval};
  Logger.log(JSON.stringify(result));
  return result;
}

/** Chỉ apply đúng AUTO-safe plan đã preview/approve cùng fingerprint. */
function applyStaticInfoIntegrityV418(){
  var lock=LockService.getScriptLock();
  lock.waitLock(30000);
  try{
    var props=PropertiesService.getScriptProperties();
    var raw=String(props.getProperty(EHOME_STATIC_APPROVAL_PROP_V418_)||"");
    if(!raw)throw new Error("STATIC_INFO_NOT_APPROVED_V418");
    var approval=JSON.parse(raw);
    var approvedMs=new Date(approval.approvedAt||"").getTime();
    if(!approvedMs||new Date().getTime()-approvedMs>30*60*1000){
      throw new Error("STATIC_INFO_APPROVAL_EXPIRED_V418");
    }

    var plan=beBuildStaticInfoPlanV418_();
    if(plan.fingerprint!==approval.fingerprint||plan.autoChanges.length!==Number(approval.proposedChanges||0)){
      throw new Error("STATIC_INFO_CHANGED_AFTER_PREVIEW_V418");
    }
    var sh=plan.sheet;
    var headers=sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0].map(function(x){return cleanMasterText(x);});
    var capacityCol=headers.indexOf("TIÊU CHUẨN")+1;
    var bedroomsCol=headers.indexOf("PN")+1;
    if(capacityCol<1||bedroomsCol<1)throw new Error("STATIC_INFO_COLUMNS_MISSING_V418");

    var capacityUpdates=[];
    var bedroomUpdates=[];
    plan.autoChanges.forEach(function(item){
      if(item.newCapacity!==item.oldCapacity)capacityUpdates.push({row:item.row,value:item.newCapacity});
      if(item.newBedrooms!==item.oldBedrooms)bedroomUpdates.push({row:item.row,value:item.newBedrooms});
    });

    function writeContiguous_(column,updates){
      updates.sort(function(a,b){return a.row-b.row;});
      var groups=[];
      updates.forEach(function(item){
        var last=groups.length?groups[groups.length-1]:null;
        if(!last||item.row!==last.start+last.values.length){
          last={start:item.row,values:[]};groups.push(last);
        }
        last.values.push([item.value]);
      });
      groups.forEach(function(group){sh.getRange(group.start,column,group.values.length,1).setValues(group.values);});
      return updates.length;
    }

    var capacityWritten=writeContiguous_(capacityCol,capacityUpdates);
    var bedroomsWritten=writeContiguous_(bedroomsCol,bedroomUpdates);
    props.deleteProperty(EHOME_STATIC_APPROVAL_PROP_V418_);
    props.deleteProperty(EHOME_STATIC_PREVIEW_PROP_V418_);
    clearBookingEngineCache();
    var result={
      success:true,code:"STATIC_INFO_APPLIED_V418",fingerprint:plan.fingerprint,
      capacityWritten:capacityWritten,bedroomsWritten:bedroomsWritten,
      totalChanges:plan.autoChanges.length
    };
    Logger.log(JSON.stringify(result));
    return result;
  }finally{
    lock.releaseLock();
  }
}

/** R3 - chỉ đọc trạng thái queue chung, không thay đổi dữ liệu. */
function getStaticInfoBackfillStatusV417(){
  var pending=beAdminPendingRowsV328_();
  var result={
    success:true,
    code:"STATIC_INFO_BACKFILL_STATUS_V417",
    pending:pending.length,
    pendingRows:pending,
    workerTriggerCount:ScriptApp.getProjectTriggers().filter(function(trigger){
      return trigger.getHandlerFunction()===EHOME_MASTER_INCREMENTAL_V328.WORKER_HANDLER;
    }).length
  };
  Logger.log(JSON.stringify(result));
  return result;
}

/**
 * V1 - tạo 2 cột manual Search, không đụng dữ liệu lịch/giá/R2.
 * LOAI_SP và UU_TIEN được MasterEngine giữ lại theo MÃ_CĂN qua mọi rebuild.
 */
function setupSearchManualFieldsV1(){
  var lock=LockService.getScriptLock();
  lock.waitLock(30000);
  try{
    var sh=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BE_CONFIG.MASTER_VILLA_SHEET||"MASTER_VILLA");
    if(!sh)throw new Error("Không tìm thấy MASTER_VILLA.");
    var width=Math.max(1,sh.getLastColumn());
    var headers=sh.getRange(1,1,1,width).getDisplayValues()[0].map(function(x){return normalizeMasterText(x);});

    function ensureColumn_(name){
      var key=normalizeMasterText(name);
      var index=headers.indexOf(key);
      if(index>=0)return index+1;
      var col=sh.getLastColumn()+1;
      sh.getRange(1,col).setValue(name);
      headers.push(key);
      return col;
    }

    var typeCol=ensureColumn_("LOAI_SP");
    var priorityCol=ensureColumn_("UU_TIEN");
    var rows=Math.max(0,sh.getLastRow()-1);
    if(rows>0){
      var typeRule=SpreadsheetApp.newDataValidation()
        .requireValueInList(["PHONG_RIENG","NGUYEN_CAN","COMBO"],true)
        .setAllowInvalid(false).build();
      var priorityRule=SpreadsheetApp.newDataValidation()
        .requireValueInList(["0","1","2","3"],true)
        .setAllowInvalid(false).build();
      sh.getRange(2,typeCol,rows,1).setDataValidation(typeRule);
      sh.getRange(2,priorityCol,rows,1).setDataValidation(priorityRule);
      var priorities=sh.getRange(2,priorityCol,rows,1).getValues();
      var changed=false;
      priorities.forEach(function(row){if(row[0]===""){row[0]=0;changed=true;}});
      if(changed)sh.getRange(2,priorityCol,rows,1).setValues(priorities);
    }
    clearBookingEngineCache();
    var result={success:true,code:"SEARCH_MANUAL_FIELDS_READY_V1",rows:rows,typeColumn:typeCol,priorityColumn:priorityCol};
    Logger.log(JSON.stringify(result));
    return result;
  }finally{
    lock.releaseLock();
  }
}

/** One-shot worker tiếp tục các hàng còn lại, không retry vô hạn hàng đã fail. */
function ehomeIncrementalMasterWorkerV328_(){
  beAdminRemoveIncrementalWorkerTriggersV328_();
  var pending=beAdminPendingRowsV328_();
  if(!pending.length)return {success:true,pending:0,message:"EMPTY_PENDING"};

  var lock=LockService.getScriptLock();
  if(!lock.tryLock(1000)){
    beAdminScheduleIncrementalWorkerV328_();
    Logger.log(JSON.stringify({code:"MASTER_INCREMENTAL_WORKER_SKIPPED_LOCKED_V328",pending:pending}));
    return {success:false,skipped:true,reason:"LOCKED",pending:pending.length};
  }

  try{
    var maintenanceActiveV620 = typeof beMaintenanceActiveV620_ === "function" && beMaintenanceActiveV620_();
    return syncMasterIncrementalCoreV328_({
      reason:maintenanceActiveV620?"MAINTENANCE_CONTINUATION_V620":"CONTINUATION_WORKER",
      targetRows:pending,
      consumePending:true,
      maxSources:maintenanceActiveV620 && typeof beMaintenanceMasterBatchSizeV620_ === "function"
        ? beMaintenanceMasterBatchSizeV620_()
        : EHOME_MASTER_INCREMENTAL_V328.MAX_SOURCES_PER_RUN,
      maxRuntimeMs:maintenanceActiveV620 && typeof beMaintenanceMasterRuntimeV620_ === "function"
        ? beMaintenanceMasterRuntimeV620_()
        : EHOME_MASTER_INCREMENTAL_V328.MAX_RUNTIME_MS
    });
  }catch(workerErrV6302){
    var pendingAfterErrorV6302=beAdminPendingRowsV328_();
    var recoveryV6302=null;
    if(pendingAfterErrorV6302.length){
      try{
        recoveryV6302=beAdminScheduleIncrementalWorkerV328_();
      }catch(scheduleErrV6302){
        recoveryV6302={success:false,error:String(scheduleErrV6302&&scheduleErrV6302.message||scheduleErrV6302)};
      }
    }
    Logger.log(JSON.stringify({
      level:"ERROR",
      code:"MASTER_INCREMENTAL_WORKER_ERROR_RESCHEDULED_V6302",
      error:String(workerErrV6302&&workerErrV6302.message||workerErrV6302),
      pendingRows:pendingAfterErrorV6302,
      recovery:recoveryV6302
    }));
    throw workerErrV6302;
  }finally{
    lock.releaseLock();
  }
}

function getMasterIncrementalStatusV328(){
  var plan=getMasterIncrementalPlanV328({log:false});
  var result={
    version:EHOME_MASTER_INCREMENTAL_V328.VERSION,
    pendingRows:beAdminPendingRowsV328_(),
    dirtyRows:plan.targetRows,
    dirtyCount:plan.targetCount,
    workerTriggerCount:ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()===EHOME_MASTER_INCREMENTAL_V328.WORKER_HANDLER;}).length,
    masterVillas:plan.masterVillas
  };
  Logger.log(JSON.stringify({code:"MASTER_INCREMENTAL_STATUS_V328",result:result}));
  return result;
}

/* ================= END V3.2.8 INCREMENTAL MASTER ================= */

function setupMasterAreaOptionsV21(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var sheet=ss.getSheetByName(BE_CONFIG.MASTER_SHEET);
  if(!sheet)throw new Error('Không tìm thấy sheet MASTER');

  var lastColumn=Math.max(sheet.getLastColumn(),1);
  var headers=sheet
    .getRange(1,1,1,lastColumn)
    .getDisplayValues()[0]
    .map(ceNormalize_);

  var cityColumn=ceFindHeader_(headers,["thanh pho","city"]);
  if(cityColumn<0){
    throw new Error('MASTER không có cột "Thành phố".');
  }

  var maxRows=Math.max(sheet.getMaxRows()-1,1);
  var rule=SpreadsheetApp.newDataValidation()
    .requireValueInList(["Đà Lạt","Vũng Tàu","Khu vực khác"],true)
    .setAllowInvalid(true)
    .setHelpText(
      'Chọn Đà Lạt / Vũng Tàu / Khu vực khác, hoặc nhập tên khu vực thật như Nha Trang.'
    )
    .build();

  sheet.getRange(2,cityColumn+1,maxRows,1).setDataValidation(rule);

  Logger.log(JSON.stringify({
    code:"MASTER_AREA_OPTIONS_INSTALLED_V21",
    column:cityColumn+1,
    options:["Đà Lạt","Vũng Tàu","Khu vực khác"],
    allowCustomCity:true
  }));

  return {
    success:true,
    column:cityColumn+1,
    options:["Đà Lạt","Vũng Tàu","Khu vực khác"],
    allowCustomCity:true
  };
}

function onOpen(){
  SpreadsheetApp.getUi()
    .createMenu('Booking Engine')
    .addItem('➕ Đồng bộ nguồn mới / CONFIG đổi','syncNewSourceV328')
    .addItem('🎯 Đồng bộ nguồn đang chọn','syncSelectedSourcesV328')
    .addItem('📋 Xem kế hoạch đồng bộ','getMasterIncrementalPlanV328')
    .addItem('🔄 Đồng bộ toàn bộ (chậm)','syncBookingEngine')
    .addItem('Build MASTER_VILLA (chẩn đoán)','buildMasterVilla')
    .addItem('Build metadata lịch','rebuildCalendarMetadata')
    .addItem('🔎 Debug hành trình MÃ_CĂN','promptDebugSearchVillaJourneyV1')
    .addItem('🤖 AI kiểm CONFIG dòng đang chọn','runAiConfigForSelectedMasterRowV12')
    .addItem('🏷️ Tạo cột LOAI_SP / UU_TIEN','setupSearchManualFieldsV1')
    .addSeparator()
    .addItem('Cài khu vực MASTER','setupMasterAreaOptionsV21')
    .addItem('Chạy Image Worker','runImageCacheWorkerV21')
    .addItem('Thay anh can (nhap MA CAN)','ehomeReplaceVillaImageV1')
    .addItem('Audit ảnh V3','runImageAuditV30')
    .addItem('Verify URL ảnh V3','verifyImageAuditUrlsV30')
    .addItem('Xem trạng thái Image Queue','getImageCacheQueueStatusV21')
    .addSeparator()
    .addItem('📸 Cài Snapshot Engine','installSnapshotEngineV320')
    .addItem('🔄 Rebuild toàn bộ Snapshot','rebuildAllSnapshotsV320')
    .addItem('▶️ Chạy Snapshot Worker ngay','runSnapshotMaintenanceV320')
    .addItem('📊 Trạng thái Snapshot','getSnapshotStatusV320')
    .addItem('🧪 Test Snapshot A/B','testSnapshotABDefaultV320')
    .addItem('✅ Bật Snapshot cho Web','enableScheduleSnapshotV320')
    .addItem('⛔ Tắt Snapshot Web','disableScheduleSnapshotV320')
    .addSeparator()
    .addItem('Health Check V3','testSystemHealthV30')
    .addItem('Test V3 Core','testV30CoreConfig')
    .addItem('Test Calendar A/B V3','testCalendarAccuracyABV30')
    .addItem('Benchmark Search V3','testFastSearchBenchmarkV30')
    .addSeparator()
    .addItem('Test nhanh','testBookingEngineSmoke')
    .addToUi();
}

function setupDevImageDriveV211() {
  var folder = beGetImageCacheFolder_();
  var result = {
    success: true,
    isolated: BE_CONFIG.IMAGE_DRIVE_ISOLATED === true,
    folderName: folder.getName(),
    folderId: folder.getId(),
    folderUrl: folder.getUrl(),
    propertyKey: String(BE_CONFIG.IMAGE_DRIVE_PROPERTY_KEY || "")
  };
  Logger.log(JSON.stringify({code:"DEV_IMAGE_DRIVE_READY_V211", result:result}));
  return result;
}
