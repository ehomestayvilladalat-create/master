/** AiConfigApply.js - EHOME AI CONFIG + VILLA FACTS V1.2 */
function aiCfgHeaderMapV1_(headers){var map={};(headers||[]).forEach(function(h,i){map[String(h||"").trim().toUpperCase()]=i;});return map;}
function aiCfgFindProposalRowV1_(proposalId){var sh=aiCfgProposalSheetV1_(),vals=sh.getDataRange().getDisplayValues();if(!vals.length)return null;var h=aiCfgHeaderMapV1_(vals[0]);for(var r=1;r<vals.length;r++)if(String(vals[r][h.PROPOSAL_ID]||"").trim()===String(proposalId||"").trim())return {sheet:sh,row:r+1,headers:vals[0],map:h,values:vals[r]};return null;}
function aiCfgProposalFromRowV1_(found){var v=found.values,m=found.map;function g(k){return m[k]===undefined?"":v[m[k]];}var vc=[];try{vc=JSON.parse(g("VILLA_CORRECTIONS_JSON")||"[]");}catch(e){}return {id:String(g("PROPOSAL_ID")||""),status:String(g("STATUS")||""),sourceId:String(g("SOURCE_ID")||""),source:String(g("SOURCE")||""),confidence:Number(g("CONFIDENCE")||0),appliedAt:String(g("APPLIED_AT")||""),villaAppliedAt:String(g("VILLA_APPLIED_AT")||""),old:{master:String(g("OLD_CONFIG_MASTER")||""),calendar:String(g("OLD_CONFIG_CALENDAR")||""),image:String(g("OLD_CONFIG_IMAGE")||""),info:String(g("OLD_CONFIG_INFO")||""),type:String(g("OLD_TYPE")||"")},proposal:{sourceId:String(g("SOURCE_ID")||""),source:String(g("SOURCE")||""),confidence:Number(g("CONFIDENCE")||0),configMaster:String(g("NEW_CONFIG_MASTER")||""),configCalendar:String(g("NEW_CONFIG_CALENDAR")||""),configImage:String(g("NEW_CONFIG_IMAGE")||""),configInfo:String(g("NEW_CONFIG_INFO")||""),productType:String(g("NEW_TYPE")||""),expectedVillas:Number(g("EXPECTED_VILLAS")||0),reason:String(g("REASON")||""),warnings:[],villaCorrections:vc}};}
function aiCfgMasterColumnMapV1_(sheet){var headers=sheet.getRange(1,1,1,sheet.getLastColumn()).getDisplayValues()[0];function idx(aliases){return typeof opsHeaderIndexV312_==="function"?opsHeaderIndexV312_(headers,aliases):aiCfgHeaderIndexV1_(headers,aliases);}return {master:idx(["CONFIG MASTER"]),calendar:idx(["CONFIG LỊCH","CONFIG CALENDAR"]),image:idx(["CONFIG ẢNH","CONFIG IMAGE"]),info:idx(["CONFIG THÔNG TIN","CONFIG INFO"]),type:idx(["LOẠI","TYPE"])};}


function aiCfgClearFastInspectionCacheV4222_(source){
  try{
    if(typeof aiCfgFastInspectionCacheKeyV4222_!=="function")return;
    CacheService.getScriptCache().remove(aiCfgFastInspectionCacheKeyV4222_(source));
  }catch(ignore){}
}

function aiCfgApplyStatusGuardV4222_(item){
  var status=String(item&&item.status||"");
  if(status==="APPLIED_CONFIG_ONLY"||status==="APPLIED_ALL")return {success:true,alreadyApplied:true,proposalId:item.id,status:status,source:item.source,sourceId:item.sourceId,note:"CONFIG đã được áp dụng trước đó; không ghi lặp."};
  if(status.indexOf("IGNORED")===0)return {success:false,error:"PROPOSAL_IGNORED",proposalId:item.id,status:status};
  if(status!=="READY_FOR_APPROVAL"&&status!=="APPLIED_VILLA_ONLY")return {success:false,error:"PROPOSAL_NOT_READY",status:status,proposalId:item.id};
  return null;
}

function aiCfgCandidateFromProposalV4222_(source,p){
  var candidate={};Object.keys(source||{}).forEach(function(k){candidate[k]=source[k];});
  p=p||{};
  candidate.configMaster=String(p.configMaster||"");
  candidate.configCalendar=String(p.configCalendar||"");
  candidate.configImage=String(p.configImage||"");
  candidate.configInfo=String(p.configInfo||"");
  candidate.type=String(p.productType||source.type||"");
  return candidate;
}

function aiCfgStructureEvidenceV4222_(candidate){
  if(typeof ssInspectSourceStructureV320_!=="function")return {success:false,error:"STRUCTURE_INSPECTOR_NOT_AVAILABLE"};
  var r=ssInspectSourceStructureV320_(candidate,{aiProposal:true,skipEvidence:true});
  var count=Number(r.villaCount||0),autoCount=Number(r.autoVillaCount||0);
  var signature=String(r.namesSignature||""),autoSignature=String(r.autoNamesSignature||"");
  var parserAgreement=!!(count>0&&autoCount===count&&signature&&autoSignature&&signature===autoSignature);
  return {success:true,count:count,autoCount:autoCount,signature:signature,autoSignature:autoSignature,parserAgreement:parserAgreement,mainSheet:String(r.mainSheet||""),configuredNameRow:Number(r.configuredNameRow||0),autoNameRow:Number(r.autoNameRow||0)};
}

function aiCfgDeepConfirmZeroSourceV4222_(source,p){
  var candidate=aiCfgCandidateFromProposalV4222_(source,p);
  var first=aiCfgStructureEvidenceV4222_(candidate);
  try{if(typeof beClearMasterSheetRuntimeCacheV21_==="function")beClearMasterSheetRuntimeCacheV21_();}catch(ignoreClear1){}
  var second=aiCfgStructureEvidenceV4222_(candidate);
  var confirmed=!!(first.success&&second.success&&first.parserAgreement&&second.parserAgreement&&first.count===second.count&&first.signature===second.signature&&first.mainSheet===second.mainSheet);
  var result={success:confirmed,confirmed:confirmed,first:first,second:second,error:confirmed?"":"ZERO_SOURCE_STRUCTURE_NOT_STABLE"};
  Logger.log(JSON.stringify({code:confirmed?"AI_ZERO_SOURCE_CONFIRM_PASS_V4222":"AI_ZERO_SOURCE_CONFIRM_BLOCKED_V4222",source:source&&source.source||"",result:result}));
  return result;
}

function testAiApplyStatusGuardV4222(){
  var applied=aiCfgApplyStatusGuardV4222_({id:"X",status:"APPLIED_CONFIG_ONLY",source:"demo",sourceId:"1"});
  var ready=aiCfgApplyStatusGuardV4222_({id:"Y",status:"READY_FOR_APPROVAL"});
  var villaFirst=aiCfgApplyStatusGuardV4222_({id:"Z",status:"APPLIED_VILLA_ONLY"});
  if(!applied||!applied.success||!applied.alreadyApplied)throw new Error("AI_APPLY_IDEMPOTENT_FAILED_V4222");
  if(ready!==null)throw new Error("AI_APPLY_READY_GUARD_FAILED_V4222");
  if(villaFirst!==null)throw new Error("AI_APPLY_VILLA_FIRST_BLOCKED_V4222");
  var result={success:true,alreadyApplied:applied.alreadyApplied,readyAllowed:true,villaFirstAllowed:true};
  Logger.log(JSON.stringify({code:"AI_APPLY_STATUS_GUARD_PASS_V4222",result:result}));
  return result;
}
function applyAiConfigProposalV1(proposalId){
  var totalStarted=Date.now();
  var found=aiCfgFindProposalRowV1_(proposalId);
  if(!found)return {success:false,error:"PROPOSAL_NOT_FOUND",proposalId:String(proposalId||"")};
  var item=aiCfgProposalFromRowV1_(found);
  var guard=aiCfgApplyStatusGuardV4222_(item);
  if(guard)return guard;

  var source=opsFindSourceV312_(item.sourceId||item.source);
  if(!source)return {success:false,error:"SOURCE_NOT_FOUND",proposalId:item.id};
  var currentCount=typeof aiCfgCurrentMasterRowsV1_==="function"?aiCfgCurrentMasterRowsV1_(source.source).length:0;
  var validation;
  var deepConfirmation=null;
  if(currentCount<=0){
    validation=validateAiConfigProposalV1(item.proposal,{skipRemote:true,inspection:{currentMasterVillas:[]}});
    if(!validation.success||validation.status!=="READY_FOR_APPROVAL")return {success:false,error:"REVALIDATION_FAILED",validation:validation,proposalId:item.id};
    deepConfirmation=aiCfgDeepConfirmZeroSourceV4222_(source,item.proposal);
    if(!deepConfirmation.success)return {success:false,error:"ZERO_SOURCE_DEEP_CONFIRMATION_FAILED",proposalId:item.id,source:source.source,sourceId:source.id,confirmation:deepConfirmation,note:"Nguồn đang 0 căn; V4222 chặn ghi CONFIG vì 2 lượt parser chưa xác nhận ổn định."};
  }else{
    validation=validateAiConfigProposalV1(item.proposal,{skipRemote:false,fastStructure:true});
    if(!validation.success||validation.status!=="READY_FOR_APPROVAL")return {success:false,error:"REVALIDATION_FAILED",validation:validation,proposalId:item.id};
  }

  var lock=LockService.getScriptLock();
  if(!lock.tryLock(10000))return {success:false,error:"LOCK_BUSY"};
  try{
    source=opsFindSourceV312_(item.sourceId||item.source);
    if(!source)return {success:false,error:"SOURCE_NOT_FOUND",proposalId:item.id};
    var stale=String(source.configMaster||"").trim()!==String(item.old.master||"").trim()||String(source.configCalendar||"").trim()!==String(item.old.calendar||"").trim()||String(source.configImage||"").trim()!==String(item.old.image||"").trim()||String(source.configInfo||"").trim()!==String(item.old.info||"").trim()||String(source.type||"").trim()!==String(item.old.type||"").trim();
    if(stale)return {success:false,error:"MASTER_CONFIG_CHANGED_SINCE_PROPOSAL",proposalId:item.id};
    var ss=SpreadsheetApp.getActiveSpreadsheet(),sh=ss.getSheetByName((typeof BE_CONFIG!=="undefined"&&BE_CONFIG.MASTER_SHEET)||"MASTER");
    if(!sh)return {success:false,error:"MASTER_NOT_FOUND"};
    var cols=aiCfgMasterColumnMapV1_(sh);
    if([cols.master,cols.calendar,cols.image,cols.info].some(function(x){return x<0;}))return {success:false,error:"MASTER_CONFIG_COLUMNS_NOT_FOUND",columns:cols};
    sh.getRange(source.row,cols.master+1).setValue(item.proposal.configMaster);
    sh.getRange(source.row,cols.calendar+1).setValue(item.proposal.configCalendar);
    sh.getRange(source.row,cols.image+1).setValue(item.proposal.configImage);
    sh.getRange(source.row,cols.info+1).setValue(item.proposal.configInfo);
    if(cols.type>=0&&item.proposal.productType)sh.getRange(source.row,cols.type+1).setValue(item.proposal.productType);
    SpreadsheetApp.flush();
    if(found.map.STATUS!==undefined)found.sheet.getRange(found.row,found.map.STATUS+1).setValue(String(item.status||"")==="APPLIED_VILLA_ONLY"?"APPLIED_ALL":"APPLIED_CONFIG_ONLY");
    if(found.map.APPLIED_AT!==undefined)found.sheet.getRange(found.row,found.map.APPLIED_AT+1).setValue(new Date());
    aiCfgClearFastInspectionCacheV4222_(source);
    var result={success:true,code:"AI_CONFIG_APPLIED_V4222",proposalId:item.id,source:source.source,sourceId:source.id,row:source.row,changed:validation.changed,deepConfirmed:!!deepConfirmation,remainingVillaCorrections:String(item.status||"")==="APPLIED_VILLA_ONLY"?0:Number((validation.villaCorrections||[]).length||0),elapsedMs:Date.now()-totalStarted,note:"Chỉ cập nhật CONFIG/LOẠI; PN/khách dùng applyAiVillaCorrectionsV1 riêng."};
    Logger.log(JSON.stringify(result));return result;
  }finally{lock.releaseLock();}
}

function aiCfgMasterVillaMapV1_(sh){var headers=sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0];return {sku:aiCfgHeaderIndexV1_(headers,["MÃ CĂN","MA CAN","SKU"]),source:aiCfgHeaderIndexV1_(headers,["NGUỒN","NGUON","SOURCE"]),capacity:aiCfgHeaderIndexV1_(headers,["TIÊU CHUẨN","TIEU CHUAN","CAPACITY"]),bedrooms:aiCfgHeaderIndexV1_(headers,["PN","PHÒNG NGỦ","PHONG NGU","BEDROOMS"]) };}
function aiCfgCapacityCellValueV13_(capacityStandard,capacityMax){
  var standard=Number(capacityStandard||0),max=Number(capacityMax||0);
  if(!standard)return "";
  if(max&&max>=standard&&max!==standard)return String(standard)+"-"+String(max);
  return standard;
}
function applyAiVillaCorrectionsV1(proposalId){
  var found=aiCfgFindProposalRowV1_(proposalId);
  if(!found)return {success:false,error:"PROPOSAL_NOT_FOUND"};
  var item=aiCfgProposalFromRowV1_(found);
  if(String(item.status||"").indexOf("IGNORED")===0)return {success:false,error:"PROPOSAL_IGNORED",proposalId:item.id,status:item.status};
  if(item.villaAppliedAt)return {success:true,alreadyApplied:true,proposalId:item.id,source:item.source,sourceId:item.sourceId,status:item.status,appliedCount:0,skippedCount:0,note:"PN/khách đã được áp dụng trước đó; không ghi lặp."};
  var inspection=typeof inspectAiSourceFastV4222==="function"?inspectAiSourceFastV4222(item.sourceId||item.source,{noCache:true}):inspectAiSourceV1(item.sourceId||item.source);
  var validation=validateAiConfigProposalV1(item.proposal,{skipRemote:true,inspection:inspection});
  if(validation.villaErrors&&validation.villaErrors.length)return {success:false,error:"VILLA_REVALIDATION_FAILED",validation:validation};
  var corrections=(validation.villaCorrections||[]).filter(function(c){return Number(c.confidence||0)>=Number(EHOME_AI_CONFIG_V1.MIN_VILLA_APPLY_CONFIDENCE||0.90);});
  if(!corrections.length)return {success:false,error:"NO_HIGH_CONFIDENCE_VILLA_CORRECTIONS"};

  var lock=LockService.getScriptLock();
  if(!lock.tryLock(10000))return {success:false,error:"LOCK_BUSY"};
  try{
    var ss=SpreadsheetApp.getActiveSpreadsheet(),sh=ss.getSheetByName((typeof BE_CONFIG!=="undefined"&&BE_CONFIG.MASTER_VILLA_SHEET)||"MASTER_VILLA");
    if(!sh)return {success:false,error:"MASTER_VILLA_NOT_FOUND"};
    var map=aiCfgMasterVillaMapV1_(sh);
    if(map.sku<0||map.capacity<0||map.bedrooms<0)return {success:false,error:"MASTER_VILLA_COLUMNS_NOT_FOUND",map:map};
    var vals=sh.getRange(2,1,Math.max(0,sh.getLastRow()-1),sh.getLastColumn()).getDisplayValues(),rowBySku={};
    for(var r=0;r<vals.length;r++)rowBySku[String(vals[r][map.sku]||"").trim()]=r+2;
    var applied=[],skipped=[];
    corrections.forEach(function(c){
      var row=rowBySku[String(c.sku||"").trim()];
      if(!row){skipped.push({sku:c.sku,reason:"SKU_NOT_FOUND"});return;}
      var oldCap=String(sh.getRange(row,map.capacity+1).getDisplayValue()||"").trim();
      var oldPn=String(sh.getRange(row,map.bedrooms+1).getDisplayValue()||"").trim();
      if(c.oldCapacity!==undefined&&String(c.oldCapacity==null?"":c.oldCapacity).trim()!==oldCap){skipped.push({sku:c.sku,reason:"CAPACITY_CHANGED_SINCE_PROPOSAL",expected:String(c.oldCapacity==null?"":c.oldCapacity),current:oldCap});return;}
      if(c.oldBedrooms!==undefined&&String(c.oldBedrooms==null?"":c.oldBedrooms).trim()!==oldPn){skipped.push({sku:c.sku,reason:"BEDROOMS_CHANGED_SINCE_PROPOSAL",expected:String(c.oldBedrooms==null?"":c.oldBedrooms),current:oldPn});return;}
      if(c.capacityStandard!==null)sh.getRange(row,map.capacity+1).setValue(aiCfgCapacityCellValueV13_(c.capacityStandard,c.capacityMax));
      if(c.bedrooms!==null)sh.getRange(row,map.bedrooms+1).setValue(Number(c.bedrooms));
      applied.push({sku:c.sku,row:row,bedrooms:c.bedrooms,capacityStandard:c.capacityStandard,capacityMax:c.capacityMax,confidence:c.confidence});
    });
    SpreadsheetApp.flush();
    if(found.map.VILLA_APPLIED_AT!==undefined)found.sheet.getRange(found.row,found.map.VILLA_APPLIED_AT+1).setValue(new Date());
    if(found.map.STATUS!==undefined){
      var nextStatus=String(item.status||"")==="APPLIED_CONFIG_ONLY"?"APPLIED_ALL":"APPLIED_VILLA_ONLY";
      found.sheet.getRange(found.row,found.map.STATUS+1).setValue(nextStatus);
    }
    var sourceForCache=typeof opsFindSourceV312_==="function"?opsFindSourceV312_(item.sourceId||item.source):null;
    if(sourceForCache)aiCfgClearFastInspectionCacheV4222_(sourceForCache);
    var result={success:true,code:"AI_VILLA_FACTS_APPLIED_V4222",proposalId:item.id,source:item.source,sourceId:item.sourceId,appliedCount:applied.length,skippedCount:skipped.length,applied:applied,skipped:skipped,note:"Chỉ ghi PN và TIÊU CHUẨN; nếu có capacityMax sẽ ghi dạng 8-10. Giá trị đổi sau lúc proposal sẽ bị skip, không ghi đè."};
    Logger.log(JSON.stringify(result));return result;
  }finally{lock.releaseLock();}
}
function testAiVillaCapacityRangeV13(){
  var cases=[[aiCfgCapacityCellValueV13_(8,10),"8-10"],[aiCfgCapacityCellValueV13_(10,10),10],[aiCfgCapacityCellValueV13_(12,null),12]];
  cases.forEach(function(item,index){if(String(item[0])!==String(item[1]))throw new Error("AI_VILLA_CAPACITY_RANGE_V13_FAILED case="+(index+1));});
  var result={success:true,version:"1.3-capacity-range",cases:cases.length};
  Logger.log(JSON.stringify({code:"AI_VILLA_CAPACITY_RANGE_PASS_V13",result:result}));
  return result;
}
function getAiConfigProposalV1(proposalId){var found=aiCfgFindProposalRowV1_(proposalId);return found?{success:true,proposal:aiCfgProposalFromRowV1_(found)}:{success:false,error:"PROPOSAL_NOT_FOUND"};}
function listAiConfigProposalsV1(limit){limit=Math.max(1,Math.min(50,Number(limit||10)));var sh=aiCfgProposalSheetV1_(),vals=sh.getDataRange().getDisplayValues();if(vals.length<2)return {success:true,count:0,items:[]};var h=aiCfgHeaderMapV1_(vals[0]),out=[];for(var r=vals.length-1;r>=1&&out.length<limit;r--)out.push({proposalId:vals[r][h.PROPOSAL_ID],createdAt:vals[r][h.CREATED_AT],sourceId:vals[r][h.SOURCE_ID],source:vals[r][h.SOURCE],status:vals[r][h.STATUS],confidence:Number(vals[r][h.CONFIDENCE]||0),reason:vals[r][h.REASON]});return {success:true,count:out.length,items:out};}
function sendAiConfigProposalTelegramV1(proposalId){var got=getAiConfigProposalV1(proposalId);if(!got.success)return got;var p=got.proposal,props=PropertiesService.getScriptProperties(),chatId=String(props.getProperty("TELEGRAM_ADMIN_CHAT_ID")||"").trim();if(!chatId)return {success:false,error:"TELEGRAM_ADMIN_CHAT_ID_NOT_SET"};if(typeof sendTelegramMessageV31_!=="function")return {success:false,error:"TELEGRAM_SEND_NOT_AVAILABLE"};var q=p.proposal;if(typeof tgStoredAiProposalReplyV4221_==="function"&&typeof sendTelegramReplyV329_==="function")return sendTelegramReplyV329_(chatId,tgStoredAiProposalReplyV4221_(p.id));var text=["🤖 AI CONFIG + VILLA FACTS","ID: "+p.id,"Nguồn: "+p.source+" ("+p.sourceId+")","Status: "+p.status+" | confidence: "+p.confidence,"MASTER: "+q.configMaster,"LỊCH: "+q.configCalendar,"ẢNH: "+q.configImage,"INFO: "+q.configInfo,"LOẠI: "+q.productType,"Villa corrections: "+(q.villaCorrections||[]).length,"Chưa tự ghi. Review trước khi apply."].join("\n");return sendTelegramMessageV31_(chatId,text);}

function ignoreAiConfigProposalV1(proposalId){
  var found=aiCfgFindProposalRowV1_(proposalId);
  if(!found)return {success:false,error:"PROPOSAL_NOT_FOUND",proposalId:String(proposalId||"")};
  var item=aiCfgProposalFromRowV1_(found),status=String(item.status||"");
  if(status.indexOf("IGNORED")===0)return {success:true,proposalId:item.id,status:status,alreadyIgnored:true};
  var nextStatus=status==="APPLIED_CONFIG_ONLY"?"IGNORED_REMAINING":"IGNORED";
  if(found.map.STATUS!==undefined)found.sheet.getRange(found.row,found.map.STATUS+1).setValue(nextStatus);
  SpreadsheetApp.flush();
  var result={success:true,code:"AI_CONFIG_IGNORED_V4221",proposalId:item.id,source:item.source,sourceId:item.sourceId,previousStatus:status,status:nextStatus};
  Logger.log(JSON.stringify(result));
  return result;
}

function testAiConfigIgnoreV4221(){
  var bad=ignoreAiConfigProposalV1("THIS-ID-MUST-NOT-EXIST");
  if(!bad||bad.error!=="PROPOSAL_NOT_FOUND")throw new Error("AI_CONFIG_IGNORE_GUARD_FAILED_V4221");
  var result={success:true,version:"4.22.1",guard:bad.error};
  Logger.log(JSON.stringify({code:"AI_CONFIG_IGNORE_GUARD_PASS_V4221",result:result}));
  return result;
}
function testAiConfigApplyGuardsV1(){var bad=applyAiConfigProposalV1("THIS-ID-MUST-NOT-EXIST");if(!bad||bad.error!=="PROPOSAL_NOT_FOUND")throw new Error("AI_CONFIG_APPLY_GUARD_FAILED");Logger.log(JSON.stringify({code:"AI_CONFIG_APPLY_GUARD_PASS_V11",result:bad}));return bad;}
function applySelectedAiConfigProposalV1(){var ss=SpreadsheetApp.getActiveSpreadsheet(),sh=ss.getActiveSheet();if(!sh||sh.getName()!==(EHOME_AI_CONFIG_V1.PROPOSAL_SHEET||"AI_CONFIG_PROPOSALS_V1"))throw new Error("Hãy chọn đúng dòng proposal trong AI_CONFIG_PROPOSALS_V1 trước.");var row=ss.getActiveRange().getRow(),headers=sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0],h=aiCfgHeaderMapV1_(headers),id=String(sh.getRange(row,h.PROPOSAL_ID+1).getDisplayValue()||"").trim();if(!id)throw new Error("Dòng này không có PROPOSAL_ID.");return applyAiConfigProposalV1(id);}
function applySelectedAiVillaCorrectionsV1(){var ss=SpreadsheetApp.getActiveSpreadsheet(),sh=ss.getActiveSheet();if(!sh||sh.getName()!==(EHOME_AI_CONFIG_V1.PROPOSAL_SHEET||"AI_CONFIG_PROPOSALS_V1"))throw new Error("Hãy chọn dòng proposal trong AI_CONFIG_PROPOSALS_V1.");var row=ss.getActiveRange().getRow(),headers=sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0],h=aiCfgHeaderMapV1_(headers),id=String(sh.getRange(row,h.PROPOSAL_ID+1).getDisplayValue()||"").trim();if(!id)throw new Error("Dòng này không có PROPOSAL_ID.");return applyAiVillaCorrectionsV1(id);}
function sendSelectedAiConfigProposalTelegramV1(){var ss=SpreadsheetApp.getActiveSpreadsheet(),sh=ss.getActiveSheet();if(!sh||sh.getName()!==(EHOME_AI_CONFIG_V1.PROPOSAL_SHEET||"AI_CONFIG_PROPOSALS_V1"))throw new Error("Hãy chọn đúng dòng proposal trong AI_CONFIG_PROPOSALS_V1 trước.");var row=ss.getActiveRange().getRow(),headers=sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0],h=aiCfgHeaderMapV1_(headers),id=String(sh.getRange(row,h.PROPOSAL_ID+1).getDisplayValue()||"").trim();if(!id)throw new Error("Dòng này không có PROPOSAL_ID.");return sendAiConfigProposalTelegramV1(id);}
