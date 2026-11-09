/** 26_ConfigDoctor.gs - V4.0 READ-ONLY DEEP AUDIT. Includes legacy V3.2.x APIs. */

function opsConfigAllowedKeysV312_(block){
  var common=["SHEET","LAYOUT","START_COL","END_COL","START_ROW","END_ROW","NAME_ROW","NAME_COL","NAME_SCAN_ROWS","SCAN_ROWS","SCAN_COLS","FALLBACK","FIXED_ROW","AUTO_ROW","TOP_ROWS","MIN_NAMES","MIN_NAMES_IN_ROW","START_COLUMN","END_COLUMN","COLUMN_START","COLUMN_END","ALLOW_FALLBACK","AUTO_FALLBACK","EXCLUDE_COLS","SKIP_COLS","FIXED_ROW_STRICT_COLUMN_FILTER","INFO_END_COL","DATA_END_COL","INFO_END_ROW","DATA_END_ROW"];
  if(block==="CALENDAR")return common.concat(["DATE_COL","DATE_COLUMN","DATE_ROW","DATE_ROWS","DATE_START_ROW","DATE_END_ROW","DATE_ORDER","CALENDAR_SHEET","GROUP_OPTIONS_B64","FREE_COLORS","MAU_TRONG","AVAILABLE_COLORS","FREE_COLOR_GROUPS","NHOM_MAU_TRONG","AVAILABLE_COLOR_GROUPS"]);
  if(block==="IMAGE")return common.concat(["IMAGE_ROW","IMAGE_COL","IMAGE_SCAN_ROWS","IMAGE_ROWS","REQUIRE_IMAGE","IMAGE_ASSIGN_MODE","INFO_LAYOUT","METADATA_LAYOUT","INFO_START_ROW","INFO_START_COL","INFO_NAME_ROW","INFO_NAME_COL"]);
  if(block==="INFO")return common.concat(["INFO_ROW","INFO_ROWS","INFO_COL","INFO_FROM_NAME_CELL","INFO_LAYOUT","METADATA_LAYOUT","INFO_SHEET","METADATA_SHEET","SHEET_INFO","INFO_HEADER_ROW","INFO_START_ROW","INFO_START_COL","INFO_NAME_ROW","INFO_NAME_COL","MAPS_ROW","MAPS_COL","MAP_ROW","MAP_COL","STANDARD_ROW","STANDARD_COL","BEDROOMS_ROW","BEDROOMS_COL","DESCRIPTION_ROW","DESCRIPTION_COL","DATA_START_ROW","DATA_START_COL"]);

  // V3.2.7: đồng bộ grammar Doctor với parseMasterColumnConfig/applyMasterColumnConfigPair.
  // Các key dưới đây là key MASTER hợp lệ đã được MasterEngine hỗ trợ lâu nay.
  return common.concat([
    "REQUIRE_IMAGE",
    "NAME","NAME_MODE","READER","ROW",
    "MIN_SCORE","NAME_SCORE",
    "FIXED_NAME","STATIC_NAME","VILLA_NAME",
    "BO_COT","COT_BO_QUA",
    "PHONG_RIENG_COLS","PRIVATE_ROOM_COLS","ROOM_COLS",
    "NGUYEN_CAN_COLS","WHOLE_VILLA_COLS","WHOLE_PROPERTY_COLS"
  ]);
}
function opsPushConfigIssueV312_(issues,level,block,code,message,suggestion){issues.push({level:level,block:block,code:code,message:message,suggestion:suggestion||""});}
function opsUnknownConfigKeysV312_(raw,block){
  if(!raw||opsNormV312_(raw)==="auto")return [];
  var cfg=typeof parseBookingSourceConfig==="function"?parseBookingSourceConfig(raw):{},allowed=opsConfigAllowedKeysV312_(block);
  // V4.21.1: AUTO là shorthand hợp lệ kể cả khi đứng cùng key khác,
  // ví dụ AUTO;CỘT_NGÀY=1;VÙNG_HÀNG_NGÀY=8-40.
  allowed=allowed.concat(["AUTO"]);
  return Object.keys(cfg).filter(function(k){return allowed.indexOf(String(k).toUpperCase())<0;});
}
function opsValidateConfigBlockV312_(raw,block,context){
  var issues=[],text=String(raw||"").trim(),cfg=typeof parseBookingSourceConfig==="function"?parseBookingSourceConfig(text):{};
  var unknown=opsUnknownConfigKeysV312_(text,block);
  if(unknown.length)opsPushConfigIssueV312_(issues,"WARNING",block,"UNKNOWN_CONFIG_KEY","Có key chưa nằm trong grammar chuẩn: "+unknown.join(", "),"Kiểm tra chính tả/key trước khi giữ config này.");
  function num(key){var v=Number(cfg[key]);return isFinite(v)?v:0;}
  var startCol=num("START_COL")||num("START_COLUMN")||num("COLUMN_START"),endCol=num("END_COL")||num("END_COLUMN")||num("COLUMN_END"),nameRow=num("NAME_ROW")||num("FIXED_ROW");

  // V3.2.7: END_COL=-1 là sentinel hợp lệ của MasterEngine = quét tới cột cuối.
  // Vì vậy chỉ START_COL / NAME_ROW âm mới là vị trí sai. END_COL <= 0 không phải lỗi.
  if(startCol<0||nameRow<0)opsPushConfigIssueV312_(issues,"ERROR",block,"NEGATIVE_CONFIG_POSITION","Có hàng/cột âm hoặc không hợp lệ.","Đổi START_COL/NAME_ROW về số nguyên dương hoặc AUTO.");

  // Chỉ so START/END khi END_COL là một cột hữu hạn (>0).
  // END_COL=-1/0 được runtime hiểu là LAST COLUMN.
  if(startCol>0&&endCol>0&&endCol<startCol)opsPushConfigIssueV312_(issues,"ERROR",block,"START_END_COL_INVALID","END_COL nhỏ hơn START_COL.","Sửa END_COL >= START_COL, hoặc dùng END_COL=-1 để quét tới cột cuối.");
  if(block==="MASTER"){
    if(!text)opsPushConfigIssueV312_(issues,"INFO",block,"MASTER_CONFIG_EMPTY","CONFIG MASTER đang trống.","Nếu AUTO đọc ổn có thể giữ; nếu thiếu căn nên khóa hàng/cột.");
    var fixedName=String(cfg.FIXED_NAME||cfg.STATIC_NAME||cfg.VILLA_NAME||"").trim();
    if(fixedName&&startCol>0&&endCol>0&&endCol!==startCol){
      opsPushConfigIssueV312_(issues,"ERROR",block,"FIXED_NAME_MULTI_COLUMN","FIXED_NAME chỉ an toàn cho một cột lịch, nhưng START_COL/END_COL đang bao nhiều cột.","Đặt START_COL = END_COL đúng cột lịch của căn cố định.");
    }
    var expected=startCol&&endCol&&endCol>=startCol?endCol-startCol+1:0,count=Number(context&&context.masterVillaCount||0);
    var structureCount=Number(context&&context.structureVillaCount||0);
    if(context&&context.enabled&&count===0){
      if(structureCount>0){
        opsPushConfigIssueV312_(issues,"WARNING",block,"MASTER_PENDING_SYNC","MASTER_VILLA đang 0 căn nhưng Structure Snapshot đọc được "+structureCount+" căn.","Chờ/ chạy incremental rebuild; không kết luận source hỏng.");
      }else if(context.structurePresent===false){
        // V4.21.1: nguồn vừa bật/chưa từng được Structure Snapshot quét.
        // Không được nâng thành ERROR trước khi có ít nhất một lần đọc nguồn thật.
        opsPushConfigIssueV312_(issues,"INFO",block,"NEW_SOURCE_PENDING_SCAN","Nguồn mới đang chờ lần quét Structure đầu tiên.","Chạy đồng bộ/Structure scan; chỉ báo SOURCE_ZERO_VILLAS nếu đã scan thật mà vẫn ra 0 căn.");
      }else{
        opsPushConfigIssueV312_(issues,"ERROR",block,"SOURCE_ZERO_VILLAS","Nguồn đã có Structure Snapshot nhưng MASTER_VILLA và Structure Snapshot đều không có căn.","Chạy /configcheck <nguồn> để kiểm hàng tên/cột nguồn.");
      }
    }
    if(expected>=3&&count>0&&count<Math.max(1,Math.floor(expected*0.5)))opsPushConfigIssueV312_(issues,"WARNING",block,"SOURCE_VILLA_DROP_SUSPECT","Range config dự kiến "+expected+" cột nhưng MASTER_VILLA chỉ có "+count+" căn.","Kiểm FIXED_ROW/START_COL/END_COL, blacklist và tên toàn số/hyperlink.");
  }
  if(block==="IMAGE"){
    if(context&&Number(context.imageProblems||0)>0&&(!text||opsNormV312_(text)==="auto"))opsPushConfigIssueV312_(issues,"WARNING",block,"IMAGE_CONFIG_AUTO_WITH_ISSUES","Nguồn có "+context.imageProblems+" lỗi/thiếu ảnh nhưng CONFIG ẢNH chưa khóa rõ.","Dùng /imagesource và /configcheck để xác định tab/hàng ảnh.");
    if(text&&typeof parseImageConfig==="function")try{var im=parseImageConfig(text);if((im.imageRows||[]).some(function(r){return Number(r)<=0;}))opsPushConfigIssueV312_(issues,"ERROR",block,"IMAGE_ROW_RANGE_INVALID","Vùng hàng ảnh không hợp lệ.","Ví dụ VÙNG_HÀNG_ẢNH=3 hoặc 3-5.");}catch(err){opsPushConfigIssueV312_(issues,"ERROR",block,"IMAGE_CONFIG_PARSE_FAILED",String(err&&err.message?err.message:err),"Sửa CONFIG ẢNH theo grammar hiện tại.");}
  }
  if(block==="INFO"&&text&&typeof parseInfoConfig==="function")try{var info=parseInfoConfig(text);if((info.infoRows||[]).some(function(r){return Number(r)<=0;}))opsPushConfigIssueV312_(issues,"ERROR",block,"INFO_ROW_RANGE_INVALID","Vùng hàng thông tin không hợp lệ.","Ví dụ VÙNG_HÀNG_THÔNG_TIN=40-59.");}catch(err2){opsPushConfigIssueV312_(issues,"ERROR",block,"INFO_CONFIG_PARSE_FAILED",String(err2&&err2.message?err2.message:err2),"Sửa CONFIG THÔNG TIN theo grammar hiện tại.");}
  return {raw:text,parsed:cfg,issues:issues};
}

function opsImageProblemMapV312_(){
  var map={};
  opsReadImageAuditRowsV312_().forEach(function(x){var k=opsNormV312_(x.source);if(!k)return;if(!map[k])map[k]={total:0,ok:0,missing:0,error:0,broken:0,pending:0,present:0};map[k].total++;var s=String(x.status||"MISSING").toLowerCase();if(map[k][s]!==undefined)map[k][s]++;});
  return map;
}

function opsBuildConfigSourceHealthV312_(source,context,inspectRemote){
  context=context||{};
  var blocks={MASTER:opsValidateConfigBlockV312_(source.configMaster,"MASTER",context),CALENDAR:opsValidateConfigBlockV312_(source.configCalendar,"CALENDAR",context),IMAGE:opsValidateConfigBlockV312_(source.configImage,"IMAGE",context),INFO:opsValidateConfigBlockV312_(source.configInfo,"INFO",context)};
  var issues=[];Object.keys(blocks).forEach(function(k){issues=issues.concat(blocks[k].issues||[]);});
  var remote=null;
  if(inspectRemote){
    if(!source.link)opsPushConfigIssueV312_(issues,"ERROR","SOURCE","SOURCE_LINK_MISSING","Nguồn không có LINK.","Bổ sung LINK nguồn trong MASTER.");
    else try{
      var file=SpreadsheetApp.openByUrl(source.link),sheets=file.getSheets().map(function(s){return{name:s.getName(),lastRow:s.getLastRow(),lastColumn:s.getLastColumn()};});remote={spreadsheetName:file.getName(),sheets:sheets};
      [{block:"MASTER",raw:source.configMaster},{block:"IMAGE",raw:source.configImage},{block:"INFO",raw:source.configInfo}].forEach(function(item){var cfg=typeof parseBookingSourceConfig==="function"?parseBookingSourceConfig(item.raw):{},explicit=String(cfg.SHEET||"").trim();if(explicit&&["AUTO","LATEST_CALENDAR"].indexOf(explicit.toUpperCase())<0){var exists=sheets.some(function(s){return opsNormV312_(s.name)===opsNormV312_(explicit);});if(!exists)opsPushConfigIssueV312_(issues,"ERROR",item.block,item.block+"_SHEET_NOT_FOUND","Config chỉ tới tab '"+explicit+"' nhưng source không có tab này.","Sửa TRANG_TÍNH/SHEET hoặc dùng AUTO nếu phù hợp.");}});
    }catch(err){remote={error:String(err&&err.message?err.message:err)};opsPushConfigIssueV312_(issues,"ERROR","SOURCE","SOURCE_OPEN_FAILED",remote.error,"Kiểm quyền truy cập/link nguồn.");}
  }
  var errors=issues.filter(function(x){return x.level==="ERROR";}).length,warnings=issues.filter(function(x){return x.level==="WARNING";}).length,status=errors?"ERROR":(warnings?"WARNING":"OK");
  return {success:true,status:status,source:source,masterVillaCount:Number(context.masterVillaCount||0),imageCounts:context.imageCounts||{},blocks:blocks,issues:issues,remote:remote};
}

function getConfigSourceHealthV312(selector,inspectRemote){
  var source=opsFindSourceV312_(selector);if(!source)return {success:false,error:"SOURCE_NOT_FOUND",selector:String(selector||"")};
  var counts=opsMasterVillaCountBySourceV312_(),images=opsImageProblemMapV312_(),key=opsNormV312_(source.source),img=images[key]||{},problems=Number(img.missing||0)+Number(img.error||0)+Number(img.broken||0);
  var structureCount=0,structure=null;
  try{
    var structureMap=typeof getStructureSnapshotMapV320_==="function"?getStructureSnapshotMapV320_():{};
    structure=structureMap[key]||null;
    if(structure&&structure.current)structureCount=Number(structure.current.effectiveVillaCount!=null?structure.current.effectiveVillaCount:structure.current.villaCount||0);
  }catch(ignoreStructure){}
  return opsBuildConfigSourceHealthV312_(source,{enabled:source.enabled,masterVillaCount:Number(counts[key]||0),structureVillaCount:structureCount,structurePresent:!!structure,imageProblems:problems,imageCounts:img},Boolean(inspectRemote));
}

function getConfigHealthV312(){
  var sources=opsListMasterSourcesV312_(true).sources||[],counts=opsMasterVillaCountBySourceV312_(),images=opsImageProblemMapV312_(),structureMap={},result={success:true,total:sources.length,ok:0,warning:0,error:0,sources:[]};
  try{if(typeof getStructureSnapshotMapV320_==="function")structureMap=getStructureSnapshotMapV320_()||{};}catch(ignoreStructure){}
  sources.forEach(function(source){
    var key=opsNormV312_(source.source),img=images[key]||{},problems=Number(img.missing||0)+Number(img.error||0)+Number(img.broken||0),structure=structureMap[key]||null,structureCount=0;
    if(structure&&structure.current)structureCount=Number(structure.current.effectiveVillaCount!=null?structure.current.effectiveVillaCount:structure.current.villaCount||0);
    var h=opsBuildConfigSourceHealthV312_(source,{enabled:true,masterVillaCount:Number(counts[key]||0),structureVillaCount:structureCount,structurePresent:!!structure,imageProblems:problems,imageCounts:img},false);
    if(h.status==="ERROR")result.error++;else if(h.status==="WARNING")result.warning++;else result.ok++;
    result.sources.push({source:source.source,id:source.id,status:h.status,masterVillaCount:h.masterVillaCount,structureVillaCount:structureCount,issueCount:h.issues.length,issues:h.issues});
  });
  return result;
}
function getConfigIssuesV312(level,limit){level=String(level||"").toUpperCase();limit=Math.max(1,Math.min(100,Number(limit||30)));var h=getConfigHealthV312(),out=[];(h.sources||[]).forEach(function(s){(s.issues||[]).forEach(function(i){if(level&&String(i.level||"").toUpperCase()!==level)return;if(out.length<limit)out.push({source:s.source,status:s.status,level:i.level,block:i.block,code:i.code,message:i.message,suggestion:i.suggestion});});});return {success:true,level:level||"ALL",count:out.length,issues:out};}


/** V3.2.7 - self test cho grammar MASTER legacy/sentinel. Không mở source Sheet. */
function testConfigDoctorGrammarV327(){
  var goodA=opsValidateConfigBlockV312_("AUTO_ROW;START_COL=2;END_COL=-1;MIN_SCORE=18","MASTER",{enabled:false,masterVillaCount:16});
  var badA=(goodA.issues||[]).filter(function(x){return x.level==="ERROR"||x.code==="UNKNOWN_CONFIG_KEY";});
  if(badA.length)throw new Error("V327 FAIL legacy END_COL/MIN_SCORE: "+JSON.stringify(badA));

  var goodB=opsValidateConfigBlockV312_("FIXED_ROW=3;START_COL=2;END_COL=10;NAME_SCORE=0;BO_COT=4,7","MASTER",{enabled:false,masterVillaCount:8});
  var badB=(goodB.issues||[]).filter(function(x){return x.level==="ERROR"||x.code==="UNKNOWN_CONFIG_KEY";});
  if(badB.length)throw new Error("V327 FAIL MASTER aliases: "+JSON.stringify(badB));

  var invalid=opsValidateConfigBlockV312_("START_COL=8;END_COL=3","MASTER",{enabled:false,masterVillaCount:0});
  var hasRangeError=(invalid.issues||[]).some(function(x){return x.code==="START_END_COL_INVALID"&&x.level==="ERROR";});
  if(!hasRangeError)throw new Error("V327 FAIL: range invalid phải bị bắt.");

  var fixedGood=opsValidateConfigBlockV312_("FIXED_NAME=B37 VILLA;START_COL=3;END_COL=3","MASTER",{enabled:false,masterVillaCount:1});
  var fixedBad=(fixedGood.issues||[]).filter(function(x){return x.level==="ERROR"||x.code==="UNKNOWN_CONFIG_KEY";});
  if(fixedBad.length)throw new Error("V329 FAIL FIXED_NAME grammar: "+JSON.stringify(fixedBad));

  var fixedMulti=opsValidateConfigBlockV312_("FIXED_NAME=B37 VILLA;START_COL=3;END_COL=4","MASTER",{enabled:false,masterVillaCount:1});
  var hasFixedMulti=(fixedMulti.issues||[]).some(function(x){return x.code==="FIXED_NAME_MULTI_COLUMN"&&x.level==="ERROR";});
  if(!hasFixedMulti)throw new Error("V329 FAIL FIXED_NAME multi-column phải bị chặn.");

  var result={success:true,version:"3.2.9-config-doctor-safe-grammar",legacySentinelPass:true,minScorePass:true,aliasPass:true,invalidRangeStillCaught:true,fixedNamePass:true,infoRowRangePass:true,infoRowMalformedPass:true};
  Logger.log(JSON.stringify({code:"CONFIG_DOCTOR_GRAMMAR_PASS_V327",result:result}));
  return result;
}
/** V4.21.1 - regression test: nguồn mới chưa scan không được báo ERROR giả. */
function testConfigDoctorNewSourcePendingV4211(){
  var pending=opsValidateConfigBlockV312_(
    "FIXED_ROW=3;START_COL=3;END_COL=8;FALLBACK=FALSE",
    "MASTER",
    {enabled:true,masterVillaCount:0,structureVillaCount:0,structurePresent:false}
  );
  var pendingIssue=(pending.issues||[]).filter(function(x){return x.code==="NEW_SOURCE_PENDING_SCAN";});
  var falseZero=(pending.issues||[]).filter(function(x){return x.code==="SOURCE_ZERO_VILLAS";});
  if(pendingIssue.length!==1 || pendingIssue[0].level!=="INFO" || falseZero.length){
    throw new Error("V4211 FAIL new-source pending: "+JSON.stringify(pending.issues||[]));
  }

  var scannedZero=opsValidateConfigBlockV312_(
    "FIXED_ROW=3;START_COL=3;END_COL=8;FALLBACK=FALSE",
    "MASTER",
    {enabled:true,masterVillaCount:0,structureVillaCount:0,structurePresent:true}
  );
  if(!(scannedZero.issues||[]).some(function(x){return x.code==="SOURCE_ZERO_VILLAS"&&x.level==="ERROR";})){
    throw new Error("V4211 FAIL scanned-zero must stay ERROR: "+JSON.stringify(scannedZero.issues||[]));
  }

  var mixedAuto=opsValidateConfigBlockV312_(
    "AUTO;CỘT_NGÀY=1;VÙNG_HÀNG_NGÀY=8-40",
    "CALENDAR",
    {enabled:true}
  );
  if((mixedAuto.issues||[]).some(function(x){return x.code==="UNKNOWN_CONFIG_KEY";})){
    throw new Error("V4211 FAIL AUTO mixed config false warning: "+JSON.stringify(mixedAuto.issues||[]));
  }

  var result={success:true,version:"4.21.1-health-new-source-pending",newSourcePendingPass:true,scannedZeroStillError:true,mixedAutoGrammarPass:true};
  Logger.log(JSON.stringify({code:"CONFIG_DOCTOR_NEW_SOURCE_PENDING_PASS_V4211",result:result}));
  return result;
}

/* ============================================================================
 * CONFIG DOCTOR V4.0 - READ ONLY DEEP AUDIT
 * ----------------------------------------------------------------------------
 * Mục tiêu:
 *  - Giữ nguyên toàn bộ API V3.2.x để không phá Telegram/Ops cũ.
 *  - Bắt lỗi grammar mà V3 bỏ lọt: range "8--38", KEY= rỗng, số hàng/cột sai.
 *  - Không báo giả token AUTO đứng một mình.
 *  - Đối chiếu SOURCE THẬT -> Structure Snapshot -> MASTER_VILLA.
 *  - Deep audit chạy theo batch để tránh timeout khi ~150 nguồn.
 *  - TUYỆT ĐỐI không sửa CONFIG MASTER / MASTER_VILLA / source Sheet.
 *
 * Public:
 *   getConfigHealthV4()
 *   getConfigIssuesV4(level, limit)
 *   getConfigSourceDeepV4(selector)
 *   runConfigDoctorDeepV4(batchSize, startIndex)
 *   testConfigDoctorV4Grammar()
 *   testConfigDoctorDeepV4()
 * ========================================================================== */

var EHOME_CONFIG_DOCTOR_V4 = {
  VERSION: "4.0.0-read-only",
  DEFAULT_BATCH_SIZE: 10,
  MAX_BATCH_SIZE: 20,
  SOURCE_PREVIEW_ROWS: 12,
  MAX_NAME_SCAN_ROWS: 12
};

function opsV4Text_(v){ return String(v == null ? "" : v).trim(); }
function opsV4Norm_(v){
  if (typeof opsNormV312_ === "function") return opsNormV312_(v);
  return opsV4Text_(v).toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"").replace(/đ/g,"d").replace(/\s+/g," ").trim();
}
function opsV4Push_(issues,level,block,code,message,suggestion,evidence){
  issues.push({
    level:level, block:block, code:code, message:message,
    suggestion:suggestion || "", evidence:evidence || null
  });
}
function opsV4Cfg_(raw){
  try { return typeof parseBookingSourceConfig === "function" ? (parseBookingSourceConfig(raw)||{}) : {}; }
  catch(e){ return {}; }
}
function opsV4IsAutoOnly_(raw){
  return /^(?:AUTO|TỰ_?ĐỘNG|TU_?DONG)$/i.test(opsV4Text_(raw));
}
function opsV4ExplicitSheet_(raw, block){
  var cfg=opsV4Cfg_(raw), v="";
  if(block==="CALENDAR") v=cfg.CALENDAR_SHEET || cfg.SHEET || "";
  else v=cfg.SHEET || "";
  v=opsV4Text_(v);
  return /^(AUTO|LATEST_CALENDAR)$/i.test(v) ? "" : v;
}
function opsV4NumericKeys_(){
  return {
    START_COL:1,END_COL:1,START_ROW:1,END_ROW:1,NAME_ROW:1,NAME_COL:1,
    FIXED_ROW:1,TOP_ROWS:1,MIN_NAMES:1,MIN_NAMES_IN_ROW:1,SCAN_ROWS:1,SCAN_COLS:1,
    INFO_END_COL:1,DATA_END_COL:1,INFO_END_ROW:1,DATA_END_ROW:1,
    DATE_COL:1,DATE_COLUMN:1,DATE_ROW:1,DATE_START_ROW:1,DATE_END_ROW:1,
    IMAGE_ROW:1,IMAGE_COL:1,INFO_ROW:1,INFO_COL:1,INFO_HEADER_ROW:1,
    INFO_START_ROW:1,INFO_START_COL:1,INFO_NAME_ROW:1,INFO_NAME_COL:1,
    MAPS_ROW:1,MAPS_COL:1,MAP_ROW:1,MAP_COL:1,STANDARD_ROW:1,STANDARD_COL:1,
    BEDROOMS_ROW:1,BEDROOMS_COL:1,DESCRIPTION_ROW:1,DESCRIPTION_COL:1,
    DATA_START_ROW:1,DATA_START_COL:1
  };
}
function opsV4RangeKeys_(){
  return {
    DATE_ROWS:1,DATE_ROW:1,IMAGE_SCAN_ROWS:1,IMAGE_ROWS:1,INFO_ROWS:1,
    NAME_SCAN_ROWS:1,SCAN_ROWS:1
  };
}
function opsV4RawPairs_(raw){
  var out=[];
  opsV4Text_(raw).split(/[;\n]+/).forEach(function(part){
    part=opsV4Text_(part); if(!part)return;
    var p=part.indexOf("=");
    out.push({raw:part,key:p<0?part:opsV4Text_(part.slice(0,p)),value:p<0?null:opsV4Text_(part.slice(p+1)),hasEq:p>=0});
  });
  return out;
}
function opsV4CanonicalKey_(key){
  try { return typeof beCanonicalConfigKey_==="function" ? beCanonicalConfigKey_(key) : opsV4Text_(key).toUpperCase(); }
  catch(e){ return opsV4Text_(key).toUpperCase(); }
}
function opsV4ValidRangeText_(text){
  text=opsV4Text_(text);
  if(!text)return false;
  return text.split(/[,|]+/).every(function(part){
    part=opsV4Text_(part);
    return /^\d+$/.test(part) || /^\d+\s*-\s*\d+$/.test(part);
  });
}
function opsValidateConfigSyntaxV4_(raw,block){
  var issues=[], text=opsV4Text_(raw);
  if(!text)return issues;
  if(opsV4IsAutoOnly_(text))return issues;

  var numeric=opsV4NumericKeys_(), ranges=opsV4RangeKeys_();
  opsV4RawPairs_(text).forEach(function(pair){
    var key=opsV4CanonicalKey_(pair.key);
    if(!pair.hasEq){
      // AUTO_ROW/FALLBACK-style flag được parser hỗ trợ. AUTO cũng hợp lệ.
      if(key==="AUTO") return;
      return;
    }

    if(pair.value===""){
      var positional = numeric[key] || ranges[key] || /(?:ROW|COL|ROWS|COLS)$/.test(key);
      opsV4Push_(issues,positional?"ERROR":"WARNING",block,"EMPTY_CONFIG_VALUE",
        key+" đang có dấu '=' nhưng không có giá trị.",
        "Điền giá trị hợp lệ hoặc xóa hẳn key nếu muốn runtime dùng AUTO/default.",
        {token:pair.raw,key:key});
      return;
    }

    if(ranges[key] && /[-,|]/.test(pair.value) && !opsV4ValidRangeText_(pair.value)){
      opsV4Push_(issues,"ERROR",block,"MALFORMED_RANGE",
        key+" có vùng hàng sai cú pháp: "+pair.value,
        "Dùng dạng 8-38 hoặc 8,10,12. Không dùng dấu '-' lặp.",
        {token:pair.raw,key:key,value:pair.value});
      return;
    }

    if(numeric[key] && !ranges[key]){
      // Một số deployment production dùng *_ROW ở dạng vùng (vd INFO_ROW=40-59).
      // Với INFO_ROW/IMAGE_ROW/DATE_ROW, range hợp lệ phải được chấp nhận thay vì báo NON_INTEGER_POSITION giả.
      var rowRangeAllowed = (key==="INFO_ROW" || key==="IMAGE_ROW" || key==="DATE_ROW");
      var validRowRange = rowRangeAllowed && /^\d+\s*-\s*\d+$/.test(pair.value);
      if(!/^-?\d+$/.test(pair.value) && !validRowRange){
        // FIXED_ROW có deployment cũ từng dùng range; vẫn chỉ REVIEW vì cần xác nhận runtime.
        var lvl=(key==="FIXED_ROW" && /^\d+\s*-\s*\d+$/.test(pair.value))?"WARNING":"ERROR";
        opsV4Push_(issues,lvl,block,"NON_INTEGER_POSITION",
          key+" cần là số nguyên"+(rowRangeAllowed?" hoặc vùng hàng hợp lệ":"")+" nhưng đang là: "+pair.value,
          key==="FIXED_ROW"?"Xác nhận MasterEngine live có hỗ trợ FIXED_ROW dạng vùng; nếu không hãy khóa đúng một hàng.":(rowRangeAllowed?"Dùng số nguyên hoặc vùng dạng 3-5.":"Đổi về số nguyên hợp lệ."),
          {token:pair.raw,key:key,value:pair.value});
      }
    }
  });

  return issues;
}

function opsUnknownConfigKeysV4_(raw,block){
  if(!raw || opsV4IsAutoOnly_(raw))return [];
  var cfg=opsV4Cfg_(raw), allowed=typeof opsConfigAllowedKeysV312_==="function"?opsConfigAllowedKeysV312_(block):[];
  // AUTO là shorthand hợp lệ của production, không phải unknown key.
  allowed=allowed.concat(["AUTO"]);
  return Object.keys(cfg).filter(function(k){return allowed.indexOf(String(k).toUpperCase())<0;});
}

function opsValidateConfigBlockV4_(raw,block,context){
  context=context||{};
  var legacy=typeof opsValidateConfigBlockV312_==="function"
    ? opsValidateConfigBlockV312_(raw,block,context)
    : {raw:opsV4Text_(raw),parsed:opsV4Cfg_(raw),issues:[]};
  var issues=(legacy.issues||[]).filter(function(i){
    // V3 từng có thể báo AUTO là UNKNOWN_CONFIG_KEY.
    return !(i.code==="UNKNOWN_CONFIG_KEY" && /\bAUTO\b/i.test(i.message||"") && opsV4IsAutoOnly_(raw));
  });

  // Thay unknown-key check bằng V4 để AUTO shorthand không báo giả.
  issues=issues.filter(function(i){return i.code!=="UNKNOWN_CONFIG_KEY";});
  var unknown=opsUnknownConfigKeysV4_(raw,block);
  if(unknown.length)opsV4Push_(issues,"WARNING",block,"UNKNOWN_CONFIG_KEY",
    "Có key chưa nằm trong grammar chuẩn: "+unknown.join(", "),
    "Kiểm tra chính tả/key trước khi giữ config này.",{keys:unknown});

  issues=issues.concat(opsValidateConfigSyntaxV4_(raw,block));
  return {raw:opsV4Text_(raw),parsed:opsV4Cfg_(raw),issues:issues};
}

function opsV4Status_(issues){
  if((issues||[]).some(function(x){return x.level==="ERROR";}))return "ERROR";
  if((issues||[]).some(function(x){return x.level==="WARNING";}))return "REVIEW";
  return "PASS";
}
function opsV4StructureCount_(key,map){
  try{
    var s=(map||{})[key]||null;
    if(s&&s.current)return Number(s.current.effectiveVillaCount!=null?s.current.effectiveVillaCount:s.current.villaCount||0);
  }catch(e){}
  return 0;
}
function opsBuildConfigSourceHealthV4_(source,context){
  context=context||{};
  var blocks={
    MASTER:opsValidateConfigBlockV4_(source.configMaster,"MASTER",context),
    CALENDAR:opsValidateConfigBlockV4_(source.configCalendar,"CALENDAR",context),
    IMAGE:opsValidateConfigBlockV4_(source.configImage,"IMAGE",context),
    INFO:opsValidateConfigBlockV4_(source.configInfo,"INFO",context)
  };
  var issues=[];
  Object.keys(blocks).forEach(function(k){issues=issues.concat(blocks[k].issues||[]);});
  return {
    success:true,version:EHOME_CONFIG_DOCTOR_V4.VERSION,
    source:source,status:opsV4Status_(issues),
    masterVillaCount:Number(context.masterVillaCount||0),
    structureVillaCount:Number(context.structureVillaCount||0),
    blocks:blocks,issues:issues
  };
}

function getConfigHealthV4(){
  var sources=opsListMasterSourcesV312_(true).sources||[];
  var counts=opsMasterVillaCountBySourceV312_(), structureMap={};
  try{if(typeof getStructureSnapshotMapV320_==="function")structureMap=getStructureSnapshotMapV320_()||{};}catch(e){}
  var result={success:true,version:EHOME_CONFIG_DOCTOR_V4.VERSION,total:sources.length,pass:0,review:0,error:0,sources:[]};
  sources.forEach(function(source){
    var key=opsV4Norm_(source.source),structure=structureMap[key]||null;
    var h=opsBuildConfigSourceHealthV4_(source,{
      enabled:true,
      masterVillaCount:Number(counts[key]||0),
      structureVillaCount:opsV4StructureCount_(key,structureMap),
      structurePresent:!!structure
    });
    if(h.status==="ERROR")result.error++; else if(h.status==="REVIEW")result.review++; else result.pass++;
    result.sources.push({
      source:source.source,id:source.id,status:h.status,
      masterVillaCount:h.masterVillaCount,structureVillaCount:h.structureVillaCount,
      issueCount:h.issues.length,issues:h.issues
    });
  });
  return result;
}

function getConfigIssuesV4(level,limit){
  level=String(level||"").toUpperCase();
  limit=Math.max(1,Math.min(300,Number(limit||100)));
  var h=getConfigHealthV4(), out=[];
  (h.sources||[]).forEach(function(s){
    (s.issues||[]).forEach(function(i){
      if(level && String(i.level||"").toUpperCase()!==level)return;
      if(out.length<limit)out.push({
        source:s.source,status:s.status,level:i.level,block:i.block,code:i.code,
        message:i.message,suggestion:i.suggestion,evidence:i.evidence||null
      });
    });
  });
  return {success:true,version:EHOME_CONFIG_DOCTOR_V4.VERSION,level:level||"ALL",count:out.length,issues:out};
}

function opsV4SheetByExplicitOrGid_(file,source){
  var explicit=
    opsV4ExplicitSheet_(source.configCalendar,"CALENDAR") ||
    opsV4ExplicitSheet_(source.configMaster,"MASTER");
  if(explicit){
    var exact=file.getSheets().filter(function(s){return opsV4Norm_(s.getName())===opsV4Norm_(explicit);})[0];
    if(exact)return {sheet:exact,reason:"EXPLICIT_CONFIG"};
  }

  var m=String(source.link||"").match(/[?&#]gid=(\d+)/i);
  if(m){
    var gid=Number(m[1]);
    var byId=file.getSheets().filter(function(s){return Number(s.getSheetId())===gid;})[0];
    if(byId && !byId.isSheetHidden())return {sheet:byId,reason:"SOURCE_GID"};
  }

  // Ưu tiên tab visible có dấu tháng/năm gần hiện tại.
  var now=new Date(), month=now.getMonth()+1, year=now.getFullYear(), candidates=[];
  file.getSheets().forEach(function(s){
    if(s.isSheetHidden())return;
    var n=opsV4Norm_(s.getName());
    var score=0;
    if(new RegExp("(^|\\D)"+month+"(\\D|$)").test(n))score+=5;
    if(n.indexOf(String(year))>=0)score+=4;
    if(/thang|month|lich|calendar/.test(n))score+=2;
    candidates.push({sheet:s,score:score});
  });
  candidates.sort(function(a,b){return b.score-a.score;});
  if(candidates.length)return {sheet:candidates[0].sheet,reason:candidates[0].score>0?"CURRENT_MONTH_HEURISTIC":"FIRST_VISIBLE"};
  return {sheet:null,reason:"NO_VISIBLE_SHEET"};
}

function opsV4CellLooksName_(value){
  var t=opsV4Text_(value);
  if(!t || t.length<2 || t.length>180)return false;
  var n=opsV4Norm_(t);
  if(/^https?:/.test(n))return false;
  if(/^\d+(?:[.,]\d+)?(?:\s*(?:tr|trieu|k|d|đ))?$/.test(n))return false;
  if(/^(thu|ngay|date|gia|price|ghi chu|note|hinh|anh|image|google map|maps?)\b/.test(n))return false;
  return /[a-zA-ZÀ-ỹ]/.test(t);
}
function opsV4ColumnLetter_(n){
  var s=""; n=Number(n||0);
  while(n>0){var r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26);}
  return s;
}
function opsV4ConfigInt_(cfg,keys){
  for(var i=0;i<keys.length;i++){
    var v=cfg[keys[i]];
    if(v!==undefined && v!==null && opsV4Text_(v)!==""){
      var n=Number(v); if(isFinite(n))return n;
    }
  }
  return 0;
}
function opsV4SkippedCols_(cfg){
  var raw=opsV4Text_(cfg.SKIP_COLS||cfg.EXCLUDE_COLS||cfg.BO_COT||cfg.COT_BO_QUA||"");
  var map={};
  raw.split(/[,|]+/).forEach(function(p){
    p=opsV4Text_(p).toUpperCase(); if(!p)return;
    var rg=p.match(/^([A-Z]+)\s*-\s*([A-Z]+)$/);
    function colNum(s){var n=0;for(var i=0;i<s.length;i++)n=n*26+(s.charCodeAt(i)-64);return n;}
    if(rg){var a=colNum(rg[1]),b=colNum(rg[2]);if(a>b){var t=a;a=b;b=t;}for(var c=a;c<=b;c++)map[c]=true;return;}
    if(/^[A-Z]+$/.test(p)){map[colNum(p)]=true;return;}
    if(/^\d+$/.test(p))map[Number(p)]=true;
  });
  return map;
}

function opsV4DeepEvidence_(source,masterCount,structureCount){
  var issues=[], remote={};
  if(!source.link){
    opsV4Push_(issues,"ERROR","SOURCE","SOURCE_LINK_MISSING","Nguồn không có LINK.","Bổ sung link nguồn.",null);
    return {issues:issues,remote:remote};
  }

  try{
    var file=SpreadsheetApp.openByUrl(source.link);
    remote.spreadsheetName=file.getName();
    var pick=opsV4SheetByExplicitOrGid_(file,source);
    if(!pick.sheet){
      opsV4Push_(issues,"ERROR","SOURCE","SOURCE_NO_VISIBLE_SHEET","Không tìm được tab visible để audit.","Mở nguồn và kiểm tra tab lịch.",{reason:pick.reason});
      return {issues:issues,remote:remote};
    }

    var sh=pick.sheet, lastRow=sh.getLastRow(), lastCol=sh.getLastColumn();
    remote.sheet=sh.getName(); remote.sheetId=sh.getSheetId();
    remote.sheetPickReason=pick.reason; remote.lastRow=lastRow; remote.lastColumn=lastCol;

    var mcfg=opsV4Cfg_(source.configMaster);
    var ccfg=opsV4Cfg_(source.configCalendar);
    var startCol=opsV4ConfigInt_(mcfg,["START_COL","START_COLUMN","COLUMN_START"]);
    var endCol=opsV4ConfigInt_(mcfg,["END_COL","END_COLUMN","COLUMN_END"]);
    var nameRow=opsV4ConfigInt_(mcfg,["NAME_ROW","FIXED_ROW","ROW"]);
    var skipped=opsV4SkippedCols_(mcfg);

    // Explicit sheet config phải tồn tại.
    [["MASTER",source.configMaster],["CALENDAR",source.configCalendar],["IMAGE",source.configImage],["INFO",source.configInfo]].forEach(function(x){
      var ex=opsV4ExplicitSheet_(x[1],x[0]);
      if(!ex)return;
      var exists=file.getSheets().some(function(s){return opsV4Norm_(s.getName())===opsV4Norm_(ex);});
      if(!exists)opsV4Push_(issues,"ERROR",x[0],x[0]+"_SHEET_NOT_FOUND",
        "Config chỉ tới tab '"+ex+"' nhưng source không có tab này.",
        "Sửa tên tab hoặc dùng AUTO nếu phù hợp.",{sheet:ex});
    });

    // Config trỏ ra ngoài kích thước sheet.
    if(startCol>lastCol)opsV4Push_(issues,"ERROR","MASTER","START_COL_OUT_OF_BOUNDS",
      "START_COL="+startCol+" vượt lastColumn="+lastCol+".","Sửa START_COL.",{sheet:sh.getName()});
    if(endCol>0 && endCol!==-1 && endCol>lastCol)opsV4Push_(issues,"WARNING","MASTER","END_COL_OUT_OF_BOUNDS",
      "END_COL="+endCol+" vượt lastColumn="+lastCol+".","Xác nhận layout nguồn; có thể config cũ.",{sheet:sh.getName()});
    if(nameRow>lastRow)opsV4Push_(issues,"ERROR","MASTER","NAME_ROW_OUT_OF_BOUNDS",
      "Hàng tên="+nameRow+" vượt lastRow="+lastRow+".","Sửa FIXED_ROW/NAME_ROW.",{sheet:sh.getName()});

    // Nếu có NAME_ROW/FIXED_ROW rõ ràng, kiểm dấu hiệu villa ngoài END_COL.
    if(nameRow>0 && nameRow<=lastRow && endCol>0 && endCol<lastCol){
      var vals=sh.getRange(nameRow,1,1,lastCol).getDisplayValues()[0];
      var beyond=[];
      for(var c=endCol+1;c<=lastCol;c++){
        if(skipped[c])continue;
        if(opsV4CellLooksName_(vals[c-1]))beyond.push({col:c,letter:opsV4ColumnLetter_(c),value:opsV4Text_(vals[c-1]).slice(0,80)});
      }
      if(beyond.length>=2){
        opsV4Push_(issues,"WARNING","MASTER","CONFIG_RANGE_TRUNCATED_SUSPECT",
          "Có "+beyond.length+" ô giống tên căn nằm sau END_COL="+endCol+".",
          "Mở source xác nhận trước khi tăng END_COL; Doctor không tự sửa.",
          {sheet:sh.getName(),nameRow:nameRow,endCol:endCol,beyond:beyond.slice(0,12)});
      }
    }

    // Calendar row range: parser phải thực sự tạo được hàng.
    var rawDateRows=opsV4Text_(ccfg.DATE_ROWS||ccfg.DATE_ROW||"");
    if(rawDateRows){
      var parsedRows=[];
      try{
        parsedRows=typeof beParseRowRangeConfig_==="function"?beParseRowRangeConfig_(rawDateRows):[];
      }catch(e){}
      if(!parsedRows.length){
        opsV4Push_(issues,"ERROR","CALENDAR","CALENDAR_DATE_ROWS_UNREADABLE",
          "CONFIG có DATE_ROWS/DATE_ROW nhưng parser không đọc được hàng nào: "+rawDateRows,
          "Sửa vùng hàng ngày, ví dụ 8-38.",{raw:rawDateRows,sheet:sh.getName()});
      }
    }

    // Cross-layer mismatch: dùng bằng chứng snapshot/master, không suy từ độ rộng range.
    if(structureCount>0 && masterCount===0){
      opsV4Push_(issues,"WARNING","CROSS_LAYER","STRUCTURE_MASTER_MISMATCH",
        "Structure Snapshot thấy "+structureCount+" căn nhưng MASTER_VILLA đang 0.",
        "Kiểm incremental/reconcile trước khi sửa config.",{structureVillaCount:structureCount,masterVillaCount:masterCount});
    } else if(structureCount>=3 && masterCount>0 && masterCount<Math.floor(structureCount*0.6)){
      opsV4Push_(issues,"WARNING","CROSS_LAYER","MASTER_UNDER_STRUCTURE",
        "MASTER_VILLA chỉ có "+masterCount+" căn trong khi Structure Snapshot thấy "+structureCount+".",
        "Kiểm reconcile/sync và config nguồn.",{structureVillaCount:structureCount,masterVillaCount:masterCount});
    }

    // FIXED_NAME + multi-column: nâng thành ERROR khi source thật cũng xác nhận range > 1.
    var fixedName=opsV4Text_(mcfg.FIXED_NAME||mcfg.STATIC_NAME||mcfg.VILLA_NAME||"");
    if(fixedName && startCol>0 && endCol>0 && endCol!==startCol){
      opsV4Push_(issues,"ERROR","MASTER","FIXED_NAME_MULTI_COLUMN_CONFIRMED",
        "FIXED_NAME='"+fixedName+"' nhưng range "+opsV4ColumnLetter_(startCol)+":"+opsV4ColumnLetter_(endCol)+" bao nhiều cột.",
        "Khóa START_COL = END_COL đúng cột lịch của căn.",{sheet:sh.getName(),startCol:startCol,endCol:endCol});
    }

  }catch(err){
    remote.error=String(err&&err.message?err.message:err);
    opsV4Push_(issues,"ERROR","SOURCE","SOURCE_OPEN_FAILED",remote.error,
      "Kiểm quyền truy cập/link hoặc loại file nguồn.",null);
  }
  return {issues:issues,remote:remote};
}

function getConfigSourceDeepV4(selector){
  var source=opsFindSourceV312_(selector);
  if(!source)return {success:false,version:EHOME_CONFIG_DOCTOR_V4.VERSION,error:"SOURCE_NOT_FOUND",selector:String(selector||"")};

  var counts=opsMasterVillaCountBySourceV312_(), structureMap={};
  try{if(typeof getStructureSnapshotMapV320_==="function")structureMap=getStructureSnapshotMapV320_()||{};}catch(e){}
  var key=opsV4Norm_(source.source), masterCount=Number(counts[key]||0), structureCount=opsV4StructureCount_(key,structureMap), structure=structureMap[key]||null;
  var base=opsBuildConfigSourceHealthV4_(source,{enabled:source.enabled,masterVillaCount:masterCount,structureVillaCount:structureCount,structurePresent:!!structure});
  var deep=opsV4DeepEvidence_(source,masterCount,structureCount);
  var issues=(base.issues||[]).concat(deep.issues||[]);
  // de-duplicate cùng code/block/message
  var seen={};
  issues=issues.filter(function(i){var k=[i.level,i.block,i.code,i.message].join("|");if(seen[k])return false;seen[k]=1;return true;});
  return {
    success:true,version:EHOME_CONFIG_DOCTOR_V4.VERSION,
    source:source.source,id:source.id,status:opsV4Status_(issues),
    masterVillaCount:masterCount,structureVillaCount:structureCount,
    remote:deep.remote,issues:issues
  };
}

function runConfigDoctorDeepV4(batchSize,startIndex){
  batchSize=Math.max(1,Math.min(EHOME_CONFIG_DOCTOR_V4.MAX_BATCH_SIZE,Number(batchSize||EHOME_CONFIG_DOCTOR_V4.DEFAULT_BATCH_SIZE)));
  startIndex=Math.max(0,Number(startIndex||0));
  var sources=opsListMasterSourcesV312_(true).sources||[];
  var end=Math.min(sources.length,startIndex+batchSize), results=[],summary={pass:0,review:0,error:0,unreadable:0};

  for(var i=startIndex;i<end;i++){
    var r=getConfigSourceDeepV4(sources[i].id || sources[i].source);
    results.push(r);
    if(!r.success){summary.unreadable++;continue;}
    if(r.status==="ERROR")summary.error++; else if(r.status==="REVIEW")summary.review++; else summary.pass++;
    Logger.log(JSON.stringify({
      code:"CONFIG_DOCTOR_DEEP_SOURCE_V4",index:i,total:sources.length,
      source:r.source,status:r.status,masterVillaCount:r.masterVillaCount,
      structureVillaCount:r.structureVillaCount,
      sheet:r.remote&&r.remote.sheet||"",
      issues:(r.issues||[]).map(function(x){return {level:x.level,block:x.block,code:x.code,message:x.message};})
    }));
  }

  var result={
    success:true,version:EHOME_CONFIG_DOCTOR_V4.VERSION,
    startIndex:startIndex,endIndex:end-1,processed:results.length,total:sources.length,
    nextIndex:end<sources.length?end:null,done:end>=sources.length,
    summary:summary,results:results
  };
  Logger.log(JSON.stringify({code:"CONFIG_DOCTOR_DEEP_BATCH_V4",result:{
    startIndex:result.startIndex,endIndex:result.endIndex,processed:result.processed,total:result.total,
    nextIndex:result.nextIndex,done:result.done,summary:result.summary
  }}));
  return result;
}

/**
 * Test nhanh toàn bộ grammar V4, không mở source.
 */
function testConfigDoctorV4Grammar(){
  var malformed=opsValidateConfigBlockV4_("CỘT_NGÀY=1;VÙNG_HÀNG_NGÀY=8--38","CALENDAR",{enabled:false});
  if(!(malformed.issues||[]).some(function(x){return x.code==="MALFORMED_RANGE"&&x.level==="ERROR";}))
    throw new Error("V4 FAIL: phải bắt 8--38.");

  var empty=opsValidateConfigBlockV4_("FIXED_ROW=2;START_COL=3;END_COL=","MASTER",{enabled:false});
  if(!(empty.issues||[]).some(function(x){return x.code==="EMPTY_CONFIG_VALUE"&&x.level==="ERROR";}))
    throw new Error("V4 FAIL: phải bắt END_COL= rỗng.");

  var auto=opsValidateConfigBlockV4_("AUTO","CALENDAR",{enabled:false});
  if((auto.issues||[]).some(function(x){return x.code==="UNKNOWN_CONFIG_KEY";}))
    throw new Error("V4 FAIL: AUTO không được báo unknown.");

  var infoRange=opsValidateConfigBlockV4_("INFO_ROW=40-59","INFO",{enabled:false});
  if((infoRange.issues||[]).some(function(x){return x.code==="NON_INTEGER_POSITION"||x.code==="MALFORMED_RANGE";}))
    throw new Error("V4 FAIL: INFO_ROW=40-59 là range production hợp lệ, không được báo lỗi.");

  var infoMalformed=opsValidateConfigBlockV4_("INFO_ROW=40--59","INFO",{enabled:false});
  if(!(infoMalformed.issues||[]).some(function(x){return x.code==="NON_INTEGER_POSITION"||x.code==="MALFORMED_RANGE";}))
    throw new Error("V4 FAIL: INFO_ROW=40--59 phải bị bắt.");

  var fixed=opsValidateConfigBlockV4_("FIXED_NAME=FATI VILLA;START_COL=2;END_COL=3","MASTER",{enabled:false,masterVillaCount:1});
  if(!(fixed.issues||[]).some(function(x){return x.code==="FIXED_NAME_MULTI_COLUMN";}))
    throw new Error("V4 FAIL: FIXED_NAME multi-column phải bị bắt.");

  var result={success:true,version:EHOME_CONFIG_DOCTOR_V4.VERSION,malformedRangePass:true,emptyValuePass:true,autoPass:true,fixedNamePass:true,infoRowRangePass:true,infoRowMalformedPass:true};
  Logger.log(JSON.stringify({code:"CONFIG_DOCTOR_GRAMMAR_PASS_V4",result:result}));
  return result;
}

/**
 * Entry point dễ chạy trong Apps Script.
 * Mỗi lần chạy 10 nguồn để tránh timeout.
 * Lấy nextIndex trong log rồi chạy:
 *   runConfigDoctorDeepV4(10, nextIndex)
 */
function testConfigDoctorDeepV4(){
  return runConfigDoctorDeepV4(EHOME_CONFIG_DOCTOR_V4.DEFAULT_BATCH_SIZE,0);
}


/**
 * V4.0.2 - One-click deep-audit batches for Apps Script dropdown.
 * Read-only wrappers only; no data/code mutation.
 */
function testConfigDoctorDeepV4_10_19(){
  return runConfigDoctorDeepV4(10,10);
}

function testConfigDoctorDeepV4_20_29(){
  return runConfigDoctorDeepV4(10,20);
}

function testConfigDoctorDeepV4_30_39(){
  return runConfigDoctorDeepV4(10,30);
}

function testConfigDoctorDeepV4_40_49(){
  return runConfigDoctorDeepV4(10,40);
}

function testConfigDoctorDeepV4_50_59(){
  return runConfigDoctorDeepV4(10,50);
}

function testConfigDoctorDeepV4_60_69(){
  return runConfigDoctorDeepV4(10,60);
}

function testConfigDoctorDeepV4_70_79(){
  return runConfigDoctorDeepV4(10,70);
}

function testConfigDoctorDeepV4_80_89(){
  return runConfigDoctorDeepV4(10,80);
}

function testConfigDoctorDeepV4_90_99(){
  return runConfigDoctorDeepV4(10,90);
}

function testConfigDoctorDeepV4_100_109(){
  return runConfigDoctorDeepV4(10,100);
}

function testConfigDoctorDeepV4_110_119(){
  return runConfigDoctorDeepV4(10,110);
}

function testConfigDoctorDeepV4_120_129(){
  return runConfigDoctorDeepV4(10,120);
}

function testConfigDoctorDeepV4_130_139(){
  return runConfigDoctorDeepV4(10,130);
}

function testConfigDoctorDeepV4_140_149(){
  return runConfigDoctorDeepV4(10,140);
}

function testConfigDoctorDeepV4_150_150(){
  return runConfigDoctorDeepV4(10,150);
}

