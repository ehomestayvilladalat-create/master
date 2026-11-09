/**
 * AiConfigDoctor.js - EHOME AI CONFIG + VILLA FACTS V1.2
 * READ -> AI PROPOSE CONFIG + PN/CAPACITY -> VALIDATE -> SAVE PROPOSAL.
 */
function aiCfgProposalSchemaV1_(){return {type:"object",properties:{sourceId:{type:"string"},source:{type:"string"},confidence:{type:"number",minimum:0,maximum:1},configMaster:{type:"string"},configCalendar:{type:"string"},configImage:{type:"string"},configInfo:{type:"string"},productType:{type:"string"},expectedVillas:{type:"integer",minimum:0},reason:{type:"string"},warnings:{type:"array",items:{type:"string"}},villaCorrections:{type:"array",items:{type:"object",properties:{sku:{type:"string"},name:{type:"string"},sourceColumn:{type:"integer",minimum:0},bedrooms:{type:["integer","null"],minimum:0},capacityStandard:{type:["integer","null"],minimum:0},capacityMax:{type:["integer","null"],minimum:0},confidence:{type:"number",minimum:0,maximum:1},evidence:{type:"string"},reason:{type:"string"}},required:["sku","name","sourceColumn","bedrooms","capacityStandard","capacityMax","confidence","evidence","reason"],additionalProperties:false}}},required:["sourceId","source","confidence","configMaster","configCalendar","configImage","configInfo","productType","expectedVillas","reason","warnings","villaCorrections"],additionalProperties:false};}

function aiCfgSystemPromptV1_(){
 var brain=typeof aiProjectBrainV4222_==="function"?aiProjectBrainV4222_():"";
 return [
 "Bạn là AI Config Doctor + Villa Facts Doctor cho EHOME Booking.",
 "Đọc evidence của Google Sheet nguồn và đề xuất CONFIG an toàn, đồng thời kiểm tra PN/sức chứa từng căn đang có trong currentMasterVillas.",
 "Không bịa ô/hàng/cột/số liệu. Chỉ dùng evidence được cung cấp. Không đủ bằng chứng thì để null và KHÔNG tạo correction giả.",
 "QUY TẮC PN: PN = số không gian ngủ/phòng ngủ thực. Bungalow/bung riêng được tính là 1 PN. Dorm/family/phòng ba vẫn là 1 PN nếu là một phòng. Không lấy số GIƯỜNG, WC, khách, giá, địa chỉ làm PN.",
 "Ví dụ '3PN + 1 bungalow' => bedrooms=4. '4 phòng đơn + 3 phòng đôi + 1 dorm' => bedrooms=8.",
 "QUY TẮC KHÁCH: capacityStandard là số khách tiêu chuẩn/giá cơ sở rõ ràng; capacityMax chỉ khi nguồn ghi tối đa/max rõ. Không lấy PN/giường/WC/giá tiền làm số khách.",
 "Nếu text ghi '2L1B' hiểu tổng 3 khách; '2L2B' tổng 4 khách khi ngữ cảnh rõ là số lượng khách.",
 "Mỗi villaCorrection phải trỏ đúng sku/name/sourceColumn của currentMasterVillas và evidence ngắn từ nguồn. Chỉ đề xuất correction khi giá trị hiện tại sai/trống và confidence đủ cao.",
 "Ưu tiên giữ config cũ nếu chưa đủ bằng chứng đổi. CONFIG MASTER dùng grammar FIXED_ROW/START_COL/END_COL/SKIP_COLS/FALLBACK. CONFIG LỊCH giữ AUTO nếu chưa cần khóa. CONFIG ẢNH không bịa URL. CONFIG THÔNG TIN dùng hàng/vùng thật.",
 "productType chỉ PHONG_RIENG, NGUYEN_CAN hoặc chuỗi rỗng. expectedVillas là số căn/phòng hợp lệ parser nên đọc.",
 "Không xóa MASTER_VILLA, không đổi MÃ_CĂN, không sửa giá/lịch.",
 brain?"PROJECT BRAIN:\n"+brain:""
 ].filter(String).join("\n");}

function aiCfgCompactEvidenceV1_(inspection){var clone=JSON.parse(JSON.stringify(inspection||{})); if(clone.currentMasterVillas&&clone.currentMasterVillas.length>80)clone.currentMasterVillas=clone.currentMasterVillas.slice(0,80); if(clone.doctor&&clone.doctor.results)delete clone.doctor.results; return clone;}
function aiCfgStableEvidenceV12_(inspection){
 var c=aiCfgCompactEvidenceV1_(inspection);
 delete c.elapsedMs;
 delete c.cacheHit;
 if(c.structure){delete c.structure.elapsedMs;delete c.structure._checkedAt;delete c.structure.checkedAt;}
 if(c.doctor){delete c.doctor.generatedAt;delete c.doctor.checkedAt;delete c.doctor.elapsedMs;}
 return c;
}
function aiCfgEvidenceFingerprintV12_(inspection,deep){
 var raw=JSON.stringify({deep:deep===true,evidence:aiCfgStableEvidenceV12_(inspection)});
 var digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,raw,Utilities.Charset.UTF_8);
 return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g,"").slice(0,44);
}
function aiCfgModelCacheKeyV12_(inspection,deep){
 var brainVersion=typeof aiProjectBrainVersionV4222_==="function"?aiProjectBrainVersionV4222_():"legacy";
 return "AICFG12_"+brainVersion.replace(/[^A-Za-z0-9_-]/g,"_")+"_"+aiCfgEvidenceFingerprintV12_(inspection,deep);
}

function aiCfgCallModelV1_(inspection,deep){
 var key=typeof aiGetPropertyV31_==="function"?aiGetPropertyV31_("OPENAI_API_KEY"):String(PropertiesService.getScriptProperties().getProperty("OPENAI_API_KEY")||"").trim(); if(!key)return {success:false,error:"OPENAI_API_KEY_NOT_SET"};
 var model=deep?((typeof aiGetPropertyV31_==="function"?aiGetPropertyV31_("OPENAI_MODEL_DEEP"):"")||(typeof EHOME_AI_V31!=="undefined"?EHOME_AI_V31.DEEP_MODEL:"gpt-5.6-terra")):((typeof aiGetPropertyV31_==="function"?aiGetPropertyV31_("OPENAI_MODEL"):"")||(typeof EHOME_AI_V31!=="undefined"?EHOME_AI_V31.DEFAULT_MODEL:"gpt-5.6-luna"));
 var cacheKey=aiCfgModelCacheKeyV12_(inspection,deep===true),cache=CacheService.getScriptCache(),cached=cache.get(cacheKey);
 if(cached){try{var cachedResult=JSON.parse(cached);cachedResult.cacheHit=true;Logger.log(JSON.stringify({code:"AI_CONFIG_MODEL_CACHE_HIT_V12",source:inspection&&inspection.source?inspection.source.source:"",model:cachedResult.model||model}));return cachedResult;}catch(ignoreCacheV12){}}
 var stableEvidence=aiCfgStableEvidenceV12_(inspection);
 var payload={model:model,instructions:aiCfgSystemPromptV1_()+"\nOpenAI chỉ được gọi khi người dùng chủ động bấm nút AI; không đề xuất cơ chế tự chạy nền.",input:[{role:"user",content:"Phân tích evidence sau và trả đúng JSON schema.\n"+JSON.stringify(stableEvidence)}],reasoning:{effort:deep?"medium":"low"},max_output_tokens:3000,store:false,text:{format:{type:"json_schema",name:"ehome_ai_config_villa_proposal_v12",strict:true,schema:aiCfgProposalSchemaV1_()}}};
 var response=typeof aiCallResponsesV31_==="function"?aiCallResponsesV31_(payload,key,deep?"DEEP":"NORMAL"):{success:false,error:"AI_SERVICE_NOT_AVAILABLE"}; if(!response.success)return response;
 var rawText=typeof aiExtractTextV31_==="function"?aiExtractTextV31_(response.data):String(response.data&&response.data.output_text||""); var proposal; try{proposal=JSON.parse(rawText);}catch(err){return {success:false,error:"AI_CONFIG_BAD_JSON",message:String(err&&err.message?err.message:err),raw:rawText.slice(0,1500)};} var result={success:true,model:model,proposal:proposal,responseId:String(response.data&&response.data.id||""),cacheHit:false,elapsedMs:Number(response.elapsedMs||0),mode:deep?"DEEP":"FAST"}; try{cache.put(cacheKey,JSON.stringify(result),21600);}catch(ignoreCachePutV12){} return result;
}

function aiCfgProposalSheetV1_(){
 var ss=SpreadsheetApp.getActiveSpreadsheet(),name=EHOME_AI_CONFIG_V1.PROPOSAL_SHEET||"AI_CONFIG_PROPOSALS_V1",sh=ss.getSheetByName(name); if(!sh)sh=ss.insertSheet(name);
 var headers=["PROPOSAL_ID","CREATED_AT","SOURCE_ID","SOURCE","STATUS","CONFIDENCE","MODEL","OLD_CONFIG_MASTER","OLD_CONFIG_CALENDAR","OLD_CONFIG_IMAGE","OLD_CONFIG_INFO","OLD_TYPE","NEW_CONFIG_MASTER","NEW_CONFIG_CALENDAR","NEW_CONFIG_IMAGE","NEW_CONFIG_INFO","NEW_TYPE","EXPECTED_VILLAS","VALIDATION_JSON","REASON","WARNINGS","APPLIED_AT","VILLA_CORRECTIONS_JSON","VILLA_VALIDATION_JSON","VILLA_APPLIED_AT"];
 if(sh.getLastRow()===0){sh.getRange(1,1,1,headers.length).setValues([headers]);}
 else{var current=sh.getRange(1,1,1,Math.max(sh.getLastColumn(),headers.length)).getDisplayValues()[0]; headers.forEach(function(h){if(current.indexOf(h)<0){sh.getRange(1,sh.getLastColumn()+1).setValue(h); current.push(h);}});}
 return sh;
}
function aiCfgNewProposalIdV1_(){return "AICFG-"+Utilities.formatDate(new Date(),Session.getScriptTimeZone()||"Asia/Ho_Chi_Minh","yyyyMMdd-HHmmss")+"-"+Utilities.getUuid().slice(0,8).toUpperCase();}
function aiCfgSaveProposalV1_(inspection,modelResult,validation){
 var sh=aiCfgProposalSheetV1_(), headers=sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0], h={}; headers.forEach(function(x,i){h[x]=i;}); var old=inspection.source||{}, p=validation.proposal||modelResult.proposal||{}, id=aiCfgNewProposalIdV1_(); var row=new Array(headers.length).fill("");
 function set(k,v){if(h[k]!==undefined)row[h[k]]=v;}
 set("PROPOSAL_ID",id);set("CREATED_AT",new Date());set("SOURCE_ID",old.id);set("SOURCE",old.source);set("STATUS",validation.status);set("CONFIDENCE",Number(p.confidence||0));set("MODEL",modelResult.model||"");
 set("OLD_CONFIG_MASTER",old.configMaster||"");set("OLD_CONFIG_CALENDAR",old.configCalendar||"");set("OLD_CONFIG_IMAGE",old.configImage||"");set("OLD_CONFIG_INFO",old.configInfo||"");set("OLD_TYPE",old.type||"");
 set("NEW_CONFIG_MASTER",p.configMaster||"");set("NEW_CONFIG_CALENDAR",p.configCalendar||"");set("NEW_CONFIG_IMAGE",p.configImage||"");set("NEW_CONFIG_INFO",p.configInfo||"");set("NEW_TYPE",p.productType||"");set("EXPECTED_VILLAS",Number(p.expectedVillas||0));
 set("VALIDATION_JSON",JSON.stringify({success:validation.success,errors:validation.errors,warnings:validation.warnings,changed:validation.changed})); set("REASON",p.reason||"");set("WARNINGS",JSON.stringify(p.warnings||[]));
 set("VILLA_CORRECTIONS_JSON",JSON.stringify(validation.villaCorrections||[]));set("VILLA_VALIDATION_JSON",JSON.stringify({errors:validation.villaErrors||[],warnings:validation.villaWarnings||[],count:(validation.villaCorrections||[]).length}));
 sh.appendRow(row); return id;
}

function aiCfgShouldUseDeepV4222_(inspection,requestedDeep){
 if(requestedDeep===true)return true;
 if(!inspection||inspection.success===false)return true;
 if((inspection.errors||[]).length)return true;
 if(!inspection.sourceFile||inspection.sourceFile.opened!==true)return true;
 if(Number((inspection.currentMasterVillas||[]).length||0)<=0)return true;
 return false;
}

function proposeAiConfigV1(selector,deep){
 var totalStarted=Date.now();
 var inspectStarted=Date.now();
 var inspection=typeof inspectAiSourceFastV4222==="function"?inspectAiSourceFastV4222(selector):inspectAiSourceV1(selector);
 var inspectMs=Date.now()-inspectStarted;
 if(!inspection.success)return inspection;
 var useDeep=aiCfgShouldUseDeepV4222_(inspection,deep===true);
 var modelStarted=Date.now();
 var model=aiCfgCallModelV1_(inspection,useDeep);
 var modelMs=Date.now()-modelStarted;
 if(!model.success)return model;
 model.proposal.sourceId=String(inspection.source.id||model.proposal.sourceId||"");
 model.proposal.source=String(inspection.source.source||model.proposal.source||"");
 var validateStarted=Date.now();
 var validation=validateAiConfigProposalV1(model.proposal,{skipRemote:false,inspection:inspection,fastStructure:true});
 var validateMs=Date.now()-validateStarted;
 var id=aiCfgSaveProposalV1_(inspection,model,validation);
 var result={success:true,version:"4.22.2-project-brain-fast-ai",proposalId:id,status:validation.status,model:model.model,aiMode:useDeep?"DEEP":"FAST",source:inspection.source.source,sourceId:inspection.source.id,proposal:validation.proposal,changed:validation.changed,villaCorrections:validation.villaCorrections||[],validation:{success:validation.success,errors:validation.errors,warnings:validation.warnings,villaErrors:validation.villaErrors,villaWarnings:validation.villaWarnings},timing:{inspectMs:inspectMs,modelMs:modelMs,validateMs:validateMs,totalMs:Date.now()-totalStarted,inspectionCacheHit:inspection.cacheHit===true,modelCacheHit:model.cacheHit===true},instruction:"Review proposal. CONFIG dùng applyAiConfigProposalV1; PN/khách dùng applyAiVillaCorrectionsV1."};
 Logger.log(JSON.stringify({code:"AI_CONFIG_PIPELINE_V4222",source:result.source,sourceId:result.sourceId,status:result.status,aiMode:result.aiMode,timing:result.timing}));
 return result;
}

function testAiModeSelectionV4222(){
 var normal={success:true,errors:[],sourceFile:{opened:true},currentMasterVillas:[{sku:"X"}]};
 var zero={success:true,errors:[],sourceFile:{opened:true},currentMasterVillas:[]};
 var broken={success:true,errors:[{stage:"SOURCE_OPEN"}],sourceFile:{opened:false},currentMasterVillas:[{sku:"X"}]};
 if(aiCfgShouldUseDeepV4222_(normal,false)!==false)throw new Error("AI_MODE_NORMAL_NOT_FAST_V4222");
 if(aiCfgShouldUseDeepV4222_(zero,false)!==true)throw new Error("AI_MODE_ZERO_NOT_DEEP_V4222");
 if(aiCfgShouldUseDeepV4222_(broken,false)!==true)throw new Error("AI_MODE_ERROR_NOT_DEEP_V4222");
 var result={success:true,normal:"FAST",zero:"DEEP",broken:"DEEP"};
 Logger.log(JSON.stringify({code:"AI_MODE_SELECTION_PASS_V4222",result:result}));
 return result;
}

function proposeAiConfigDeepV1(selector){return proposeAiConfigV1(selector,true);} function testAiConfigDoctorV1ChonVilla(){return proposeAiConfigV1("chồn villa",false);}
function proposeAiConfigForSelectedMasterRowV1(){var ss=SpreadsheetApp.getActiveSpreadsheet(),sh=ss.getActiveSheet(); if(!sh||sh.getName()!==((typeof BE_CONFIG!=="undefined"&&BE_CONFIG.MASTER_SHEET)||"MASTER"))throw new Error("Hãy chọn một ô trên đúng dòng nguồn trong sheet MASTER trước."); var row=ss.getActiveRange().getRow(); if(row<2)throw new Error("Không chọn hàng header."); var all=opsListMasterSourcesV312_(false).sources||[],source=all.filter(function(s){return Number(s.row)===Number(row);})[0]; if(!source)throw new Error("Không tìm thấy source tại MASTER row "+row); return proposeAiConfigV1(source.id||source.source,false);}

function runAiConfigForSelectedMasterRowV12(){
 return proposeAiConfigForSelectedMasterRowV1();
}
function testAiConfigManualOnlyV12(){
 var forbidden={proposeAiConfigV1:true,proposeAiConfigDeepV1:true,proposeAiConfigForSelectedMasterRowV1:true,runAiConfigForSelectedMasterRowV12:true};
 var bad=ScriptApp.getProjectTriggers().map(function(t){return String(t.getHandlerFunction()||"");}).filter(function(name){return forbidden[name]===true;});
 if(bad.length)throw new Error("AI_AUTO_TRIGGER_FOUND: "+bad.join(","));
 var result={success:true,triggerCount:ScriptApp.getProjectTriggers().length,aiAutoTriggers:bad,mode:"MANUAL_ONLY",cacheSeconds:21600};
 Logger.log(JSON.stringify({code:"AI_CONFIG_MANUAL_ONLY_PASS_V12",result:result}));
 return result;
}
