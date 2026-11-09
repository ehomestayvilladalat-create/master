/** AiConfigValidator.js - EHOME AI CONFIG + VILLA FACTS V1.2 - READ ONLY */
function aiCfgValidateOneBlockV1_(block,text){var issues=[];text=String(text||"").trim();try{if(block==="MASTER"){if(!text)issues.push({level:"WARNING",code:"MASTER_EMPTY"});else if(typeof parseMasterColumnConfig==="function")parseMasterColumnConfig(text);}else if(block==="CALENDAR"){if(!text)issues.push({level:"WARNING",code:"CALENDAR_EMPTY"});else if(typeof parseBookingSourceConfig==="function")parseBookingSourceConfig(text);}else if(block==="IMAGE"){if(!text)issues.push({level:"WARNING",code:"IMAGE_EMPTY"});else if(String(text).toUpperCase()!=="AUTO"&&typeof parseImageConfig==="function")parseImageConfig(text);}else if(block==="INFO"){if(!text)issues.push({level:"WARNING",code:"INFO_EMPTY"});else if(typeof parseInfoConfig==="function")parseInfoConfig(text);}}catch(err){issues.push({level:"ERROR",code:block+"_PARSE_FAILED",message:String(err&&err.message?err.message:err)});}return issues;}
function aiCfgNormalizeProposalV1_(proposal){proposal=proposal||{};return {sourceId:String(proposal.sourceId||"").trim(),source:String(proposal.source||"").trim(),confidence:Math.max(0,Math.min(1,Number(proposal.confidence||0))),configMaster:String(proposal.configMaster||"").trim(),configCalendar:String(proposal.configCalendar||"").trim(),configImage:String(proposal.configImage||"").trim(),configInfo:String(proposal.configInfo||"").trim(),productType:String(proposal.productType||"").trim().toUpperCase(),expectedVillas:Math.max(0,Number(proposal.expectedVillas||0)),reason:String(proposal.reason||"").trim(),warnings:Array.isArray(proposal.warnings)?proposal.warnings.map(String).slice(0,12):[],villaCorrections:Array.isArray(proposal.villaCorrections)?proposal.villaCorrections.slice(0,120):[]};}
function aiCfgNumOrNullV1_(v){if(v===null||v===undefined||v==="")return null;var n=Number(v);return isFinite(n)?n:null;}
function aiCfgValidateVillaCorrectionsV1_(p,inspection){
 var errors=[],warnings=[],valid=[],master=(inspection&&inspection.currentMasterVillas)||aiCfgCurrentMasterRowsV1_(p.source); var bySku={},byColName={}; master.forEach(function(v){if(v.sku)bySku[String(v.sku)]=v;byColName[String(Number(v.sourceColumn||0))+"|"+aiCfgNormV1_(v.name)]=v;});
 (p.villaCorrections||[]).forEach(function(c,idx){var hasOldBedrooms=Object.prototype.hasOwnProperty.call(c,"oldBedrooms"),hasOldCapacity=Object.prototype.hasOwnProperty.call(c,"oldCapacity");var corr={sku:String(c.sku||"").trim(),name:String(c.name||"").trim(),sourceColumn:Number(c.sourceColumn||0),bedrooms:aiCfgNumOrNullV1_(c.bedrooms),capacityStandard:aiCfgNumOrNullV1_(c.capacityStandard),capacityMax:aiCfgNumOrNullV1_(c.capacityMax),confidence:Math.max(0,Math.min(1,Number(c.confidence||0))),evidence:String(c.evidence||"").trim(),reason:String(c.reason||"").trim(),oldBedrooms:hasOldBedrooms?String(c.oldBedrooms==null?"":c.oldBedrooms):undefined,oldCapacity:hasOldCapacity?String(c.oldCapacity==null?"":c.oldCapacity):undefined}; var current=(corr.sku&&bySku[corr.sku])||byColName[String(corr.sourceColumn)+"|"+aiCfgNormV1_(corr.name)]; if(!current){errors.push({code:"VILLA_CORRECTION_TARGET_NOT_FOUND",index:idx,sku:corr.sku,name:corr.name});return;} if(corr.bedrooms!==null&&(corr.bedrooms<1||corr.bedrooms>30)){errors.push({code:"BEDROOMS_OUT_OF_RANGE",sku:current.sku,value:corr.bedrooms});return;} if(corr.capacityStandard!==null&&(corr.capacityStandard<1||corr.capacityStandard>100)){errors.push({code:"CAPACITY_STANDARD_OUT_OF_RANGE",sku:current.sku,value:corr.capacityStandard});return;} if(corr.capacityMax!==null&&(corr.capacityMax<1||corr.capacityMax>100)){errors.push({code:"CAPACITY_MAX_OUT_OF_RANGE",sku:current.sku,value:corr.capacityMax});return;} if(corr.capacityStandard!==null&&corr.capacityMax!==null&&corr.capacityMax<corr.capacityStandard){errors.push({code:"CAPACITY_MAX_LT_STANDARD",sku:current.sku});return;} if(corr.bedrooms===null&&corr.capacityStandard===null&&corr.capacityMax===null){warnings.push({code:"EMPTY_VILLA_CORRECTION",sku:current.sku});return;} if(corr.confidence<Number(EHOME_AI_CONFIG_V1.MIN_VILLA_APPLY_CONFIDENCE||0.90))warnings.push({code:"LOW_VILLA_CONFIDENCE",sku:current.sku,confidence:corr.confidence}); if(!corr.evidence)warnings.push({code:"VILLA_EVIDENCE_EMPTY",sku:current.sku}); corr.sku=current.sku;corr.name=current.name;corr.sourceColumn=Number(current.sourceColumn||0);if(!hasOldBedrooms)corr.oldBedrooms=String(current.bedrooms==null?"":current.bedrooms);if(!hasOldCapacity)corr.oldCapacity=String(current.capacity==null?"":current.capacity);if(hasOldBedrooms&&corr.oldBedrooms!==String(current.bedrooms==null?"":current.bedrooms))warnings.push({code:"BEDROOMS_CHANGED_SINCE_PROPOSAL",sku:current.sku,old:corr.oldBedrooms,current:String(current.bedrooms==null?"":current.bedrooms)});if(hasOldCapacity&&corr.oldCapacity!==String(current.capacity==null?"":current.capacity))warnings.push({code:"CAPACITY_CHANGED_SINCE_PROPOSAL",sku:current.sku,old:corr.oldCapacity,current:String(current.capacity==null?"":current.capacity)}); valid.push(corr);});
 return {valid:valid,errors:errors,warnings:warnings};
}
function validateAiConfigProposalV1(proposal,options){
 options=options||{};
 var p=aiCfgNormalizeProposalV1_(proposal);
 var source=typeof opsFindSourceV312_==="function"?opsFindSourceV312_(p.sourceId||p.source):null;
 if(!source)return {success:false,status:"VALIDATION_FAILED",errors:[{code:"SOURCE_NOT_FOUND"}],proposal:p,villaCorrections:[]};
 var errors=[],warnings=[];
 [["MASTER",p.configMaster],["CALENDAR",p.configCalendar],["IMAGE",p.configImage],["INFO",p.configInfo]].forEach(function(x){
   aiCfgValidateOneBlockV1_(x[0],x[1]).forEach(function(issue){if(issue.level==="ERROR")errors.push(issue);else warnings.push(issue);});
 });
 if(p.productType&&["PHONG_RIENG","NGUYEN_CAN"].indexOf(p.productType)<0)errors.push({code:"PRODUCT_TYPE_UNSUPPORTED",value:p.productType});

 var inspectionCount=options.inspection&&Array.isArray(options.inspection.currentMasterVillas)?Number(options.inspection.currentMasterVillas.length):null;
 var oldCount=inspectionCount!==null?inspectionCount:(typeof opsMasterVillaCountBySourceV312_==="function"?Number((opsMasterVillaCountBySourceV312_()||{})[(typeof opsNormV312_==="function"?opsNormV312_(source.source):String(source.source||"").toLowerCase())]||0):0);
 if(oldCount<=0)warnings.push({code:"CURRENT_MASTER_ZERO_HIGH_RISK",message:"Nguồn hiện có 0 căn trong MASTER_VILLA; apply CONFIG phải qua xác minh cấu trúc sâu V4222."});

 var simulated=null;
 if(!errors.length&&options.skipRemote!==true){
   try{
     var candidate={};Object.keys(source).forEach(function(k){candidate[k]=source[k];});
     candidate.configMaster=p.configMaster;candidate.configCalendar=p.configCalendar;candidate.configImage=p.configImage;candidate.configInfo=p.configInfo;candidate.type=p.productType||source.type;
     if(typeof ssInspectSourceStructureV320_!=="function")throw new Error("STRUCTURE_INSPECTOR_NOT_AVAILABLE");
     simulated=ssInspectSourceStructureV320_(candidate,{aiProposal:true,skipEvidence:true});
     var count=Number(simulated.effectiveVillaCount||simulated.autoVillaCount||simulated.villaCount||0);
     if(count<=0)errors.push({code:"SIMULATION_ZERO_VILLAS"});
     if(p.expectedVillas>0&&count!==p.expectedVillas)warnings.push({code:"EXPECTED_VILLA_COUNT_MISMATCH",expected:p.expectedVillas,actual:count});
     if(oldCount>0&&count<oldCount*0.4)errors.push({code:"DANGEROUS_VILLA_DROP",oldCount:oldCount,newCount:count});
   }catch(err){errors.push({code:"SIMULATION_FAILED",message:String(err&&err.message?err.message:err)});}
 }

 var changed={configMaster:p.configMaster!==String(source.configMaster||"").trim(),configCalendar:p.configCalendar!==String(source.configCalendar||"").trim(),configImage:p.configImage!==String(source.configImage||"").trim(),configInfo:p.configInfo!==String(source.configInfo||"").trim(),productType:!!p.productType&&p.productType!==String(source.type||"").trim().toUpperCase()};
 if(!Object.keys(changed).some(function(k){return changed[k];}))warnings.push({code:"NO_CONFIG_CHANGE"});
 var villa=aiCfgValidateVillaCorrectionsV1_(p,options.inspection||null);
 var fatal=errors.length||villa.errors.length;
 var status=fatal?"VALIDATION_FAILED":(p.confidence>=Number(EHOME_AI_CONFIG_V1.MIN_APPROVAL_CONFIDENCE||0.80)?"READY_FOR_APPROVAL":"REVIEW_REQUIRED");
 var result={success:!fatal,status:status,source:{id:source.id,source:source.source,row:source.row},confidence:p.confidence,changed:changed,proposal:p,simulation:simulated,errors:errors,warnings:warnings,villaCorrections:villa.valid,villaErrors:villa.errors,villaWarnings:villa.warnings,risk:{currentMasterCount:oldCount,zeroCurrentMaster:oldCount<=0,requiresDeepApplyConfirmation:oldCount<=0}};
 Logger.log(JSON.stringify({code:"AI_CONFIG_VALIDATE_V4222",source:source.source,status:status,confidence:p.confidence,oldCount:oldCount,errors:errors,warnings:warnings,villaCorrections:villa.valid.length,villaErrors:villa.errors,villaWarnings:villa.warnings}));
 return result;
}

function testAiConfigValidatorV1NoWrite(){var s=opsFindSourceV312_("chồn villa");if(!s)throw new Error("CHON_SOURCE_NOT_FOUND");var proposal={sourceId:s.id,source:s.source,confidence:0.99,configMaster:s.configMaster,configCalendar:s.configCalendar,configImage:s.configImage,configInfo:s.configInfo,productType:s.type||"PHONG_RIENG",expectedVillas:0,reason:"self-test",warnings:[],villaCorrections:[]};var result=validateAiConfigProposalV1(proposal,{skipRemote:true});if(!result||result.status==="VALIDATION_FAILED")throw new Error("AI_CONFIG_VALIDATOR_SELF_TEST_FAILED");Logger.log(JSON.stringify({code:"AI_CONFIG_VALIDATOR_PASS_V11",result:{status:result.status,source:result.source.source}}));return result;}
function testAiVillaFactsBungalowRuleV11(){var fake={source:"test",villaCorrections:[{sku:"X",name:"Nhà của Gạo (3PN 1Bung)",sourceColumn:4,bedrooms:4,capacityStandard:10,capacityMax:12,confidence:0.99,evidence:"3PN + 1 bungalow; tiêu chuẩn 10; max 12",reason:"bungalow được tính 1 PN"}]};var inspection={currentMasterVillas:[{sku:"X",name:"Nhà của Gạo (3PN 1Bung)",sourceColumn:4,bedrooms:"3",capacity:"10",info:"3PN + 1 bungalow"}]};var r=aiCfgValidateVillaCorrectionsV1_(fake,inspection);if(r.errors.length||r.valid.length!==1||r.valid[0].bedrooms!==4)throw new Error("AI_VILLA_BUNGALOW_RULE_FAILED");Logger.log(JSON.stringify({code:"AI_VILLA_BUNGALOW_RULE_PASS_V11",result:r.valid[0]}));return r;}

function testAiVillaFactsOptimisticLockV12(){
  var fake={source:"test",villaCorrections:[{sku:"X",name:"Villa X",sourceColumn:4,bedrooms:4,capacityStandard:10,capacityMax:null,confidence:0.99,evidence:"4PN; 10 khách",reason:"test",oldBedrooms:"3",oldCapacity:"8"}]};
  var inspection={currentMasterVillas:[{sku:"X",name:"Villa X",sourceColumn:4,bedrooms:"5",capacity:"9",info:""}]};
  var r=aiCfgValidateVillaCorrectionsV1_(fake,inspection);
  if(r.errors.length||r.valid.length!==1)throw new Error("AI_OPTIMISTIC_LOCK_VALIDATION_FAILED");
  if(r.valid[0].oldBedrooms!=="3"||r.valid[0].oldCapacity!=="8")throw new Error("AI_OPTIMISTIC_LOCK_OLD_VALUES_OVERWRITTEN");
  var codes=r.warnings.map(function(x){return x.code;});
  if(codes.indexOf("BEDROOMS_CHANGED_SINCE_PROPOSAL")<0||codes.indexOf("CAPACITY_CHANGED_SINCE_PROPOSAL")<0)throw new Error("AI_OPTIMISTIC_LOCK_WARNING_MISSING");
  var result={success:true,oldBedrooms:r.valid[0].oldBedrooms,oldCapacity:r.valid[0].oldCapacity,warnings:codes};
  Logger.log(JSON.stringify({code:"AI_VILLA_OPTIMISTIC_LOCK_PASS_V12",result:result}));
  return result;
}
