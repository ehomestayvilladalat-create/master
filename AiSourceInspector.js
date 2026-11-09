/**
 * AiSourceInspector.js - EHOME AI CONFIG + VILLA FACTS V1.2
 * READ ONLY. Builds compact source evidence and current MASTER_VILLA facts.
 */

var EHOME_AI_CONFIG_V1 = (typeof EHOME_AI_CONFIG_V1 !== "undefined" && EHOME_AI_CONFIG_V1) || {
  VERSION: "1.2.0-manual-safe-active-sheet",
  PROPOSAL_SHEET: "AI_CONFIG_PROPOSALS_V1",
  MAX_ROWS: 20,
  MAX_COLS: 50,
  MAX_CELL_CHARS: 220,
  MIN_AUTO_APPLY_CONFIDENCE: 0.95,
  MIN_APPROVAL_CONFIDENCE: 0.80,
  MIN_VILLA_APPLY_CONFIDENCE: 0.90
};

function aiCfgTextV1_(v, maxLen) {
  var s = String(v === null || v === undefined ? "" : v).replace(/\s+/g, " ").trim();
  maxLen = Math.max(20, Number(maxLen || EHOME_AI_CONFIG_V1.MAX_CELL_CHARS));
  return s.length > maxLen ? s.slice(0, maxLen - 1) + "…" : s;
}

function aiCfgNormV1_(s) {
  return String(s || "").toLowerCase().normalize ? String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g,"d").replace(/\s+/g," ").trim() : String(s || "").toLowerCase().replace(/\s+/g," ").trim();
}

function aiCfgColumnLetterV1_(col) {
  col = Number(col || 0); var out = "";
  while (col > 0) { var m = (col - 1) % 26; out = String.fromCharCode(65 + m) + out; col = Math.floor((col - 1) / 26); }
  return out;
}

function aiCfgHeaderIndexV1_(headers, aliases) {
  var hs=(headers||[]).map(function(x){return aiCfgNormV1_(x);});
  for(var a=0;a<aliases.length;a++){var want=aiCfgNormV1_(aliases[a]); for(var i=0;i<hs.length;i++) if(hs[i]===want) return i;}
  return -1;
}

function aiCfgSheetSummaryV1_(file) {
  return file.getSheets().map(function(sh){return {name:sh.getName(),sheetId:Number(sh.getSheetId()||0),hidden:sh.isSheetHidden(),lastRow:Number(sh.getLastRow()||0),lastColumn:Number(sh.getLastColumn()||0)};});
}

function aiCfgSparseRowsV1_(sheet, maxRows, maxCols) {
  maxRows=Math.max(1,Math.min(Number(maxRows||EHOME_AI_CONFIG_V1.MAX_ROWS),EHOME_AI_CONFIG_V1.MAX_ROWS));
  maxCols=Math.max(1,Math.min(Number(maxCols||EHOME_AI_CONFIG_V1.MAX_COLS),EHOME_AI_CONFIG_V1.MAX_COLS));
  var rows=Math.min(Math.max(1,sheet.getLastRow()),maxRows), cols=Math.min(Math.max(1,sheet.getLastColumn()),maxCols);
  var range=sheet.getRange(1,1,rows,cols), display=range.getDisplayValues(), formulas=range.getFormulas(), rich=null;
  try{rich=range.getRichTextValues();}catch(ignoreRich){}
  var out=[];
  for(var r=0;r<rows;r++){
    var cells=[];
    for(var c=0;c<cols;c++){
      var text=aiCfgTextV1_(display[r][c]), formula=aiCfgTextV1_(formulas[r][c],160), link="";
      try{var rt=rich&&rich[r]?rich[r][c]:null; link=rt&&typeof rt.getLinkUrl==="function"?String(rt.getLinkUrl()||"").trim():"";}catch(ignoreLink){}
      if(!text&&!formula&&!link)continue;
      cells.push({col:c+1,a1:aiCfgColumnLetterV1_(c+1)+(r+1),text:text,formula:formula,link:aiCfgTextV1_(link,260)});
    }
    if(cells.length)out.push({row:r+1,cells:cells});
  }
  return out;
}

function aiCfgMergedRangesV1_(sheet,maxRows,maxCols){
  var out=[]; try{var range=sheet.getRange(1,1,Math.min(Math.max(1,sheet.getLastRow()),Math.max(1,Number(maxRows||20))),Math.min(Math.max(1,sheet.getLastColumn()),Math.max(1,Number(maxCols||50)))); range.getMergedRanges().slice(0,80).forEach(function(m){out.push(m.getA1Notation());});}catch(ignore){} return out;
}

function aiCfgCurrentMasterRowsV1_(sourceName) {
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var sh=ss.getSheetByName((typeof BE_CONFIG!=="undefined"&&BE_CONFIG.MASTER_VILLA_SHEET)||"MASTER_VILLA");
  if(!sh||sh.getLastRow()<2)return [];
  var vals=sh.getDataRange().getDisplayValues(), headers=vals[0];
  var cSku=aiCfgHeaderIndexV1_(headers,["MÃ CĂN","MA CAN","SKU"]), cName=aiCfgHeaderIndexV1_(headers,["TÊN CĂN","TEN CAN","TÊN","NAME"]), cSrc=aiCfgHeaderIndexV1_(headers,["NGUỒN","NGUON","SOURCE"]), cCap=aiCfgHeaderIndexV1_(headers,["TIÊU CHUẨN","TIEU CHUAN","SỨC CHỨA","CAPACITY"]), cPn=aiCfgHeaderIndexV1_(headers,["PN","PHÒNG NGỦ","PHONG NGU","BEDROOMS"]), cInfo=aiCfgHeaderIndexV1_(headers,["THÔNG TIN","THONG TIN","INFO"]), cCol=aiCfgHeaderIndexV1_(headers,["CỘT NGUỒN","COT NGUON","SOURCE COLUMN"]), cImg=aiCfgHeaderIndexV1_(headers,["ẢNH","ANH","IMAGE"]);
  var wanted=aiCfgNormV1_(sourceName), out=[];
  for(var r=1;r<vals.length;r++){
    if(cSrc<0||aiCfgNormV1_(vals[r][cSrc])!==wanted)continue;
    out.push({row:r+1,sku:cSku>=0?vals[r][cSku]:"",name:cName>=0?vals[r][cName]:"",sourceColumn:cCol>=0?Number(vals[r][cCol]||0):0,capacity:cCap>=0?vals[r][cCap]:"",bedrooms:cPn>=0?vals[r][cPn]:"",info:cInfo>=0?aiCfgTextV1_(vals[r][cInfo],700):"",hasImage:cImg>=0?!!String(vals[r][cImg]||"").trim():false});
    if(out.length>=120)break;
  }
  return out;
}

function inspectAiSourceV1(selector) {
  var source=typeof opsFindSourceV312_==="function"?opsFindSourceV312_(selector):null;
  if(!source)return {success:false,error:"SOURCE_NOT_FOUND",selector:String(selector||"")};
  var result={success:true,version:EHOME_AI_CONFIG_V1.VERSION,source:{row:source.row,id:source.id,city:source.city,source:source.source,link:source.link,enabled:source.enabled,type:source.type,configMaster:source.configMaster,configCalendar:source.configCalendar,configImage:source.configImage,configInfo:source.configInfo},currentMasterVillas:aiCfgCurrentMasterRowsV1_(source.source),sourceFile:{opened:false,title:"",id:"",sheets:[],mainSheet:"",mainSheetId:0,sparseRows:[],mergedRanges:[]},doctor:null,structure:null,errors:[]};
  try{if(typeof getConfigSourceDeepV41==="function")result.doctor=getConfigSourceDeepV41(source.id||source.source); else if(typeof getConfigSourceDeepV4==="function")result.doctor=getConfigSourceDeepV4(source.id||source.source);}catch(e){result.errors.push({stage:"CONFIG_DOCTOR",error:String(e&&e.message?e.message:e)});}
  try{if(typeof ssInspectSourceStructureV320_==="function")result.structure=ssInspectSourceStructureV320_(source,{aiInspect:true});}catch(e2){result.errors.push({stage:"STRUCTURE",error:String(e2&&e2.message?e2.message:e2)});}
  try{
    if(!source.link)throw new Error("SOURCE_LINK_MISSING");
    var file=SpreadsheetApp.openByUrl(source.link); result.sourceFile.opened=true; result.sourceFile.title=file.getName(); result.sourceFile.id=file.getId(); result.sourceFile.sheets=aiCfgSheetSummaryV1_(file);
    var selection=typeof beMasterCalendarSelectionV4210_==="function"?beMasterCalendarSelectionV4210_(file,source.configCalendar||"AUTO",new Date()):null;
    var main=selection&&selection.sheet?selection.sheet:(typeof findLatestMasterCalendarSheet==="function"?findLatestMasterCalendarSheet(file):null);
    if(!main)throw new Error(selection&&selection.inactiveWindow?"SOURCE_INACTIVE_CALENDAR_WINDOW":"MAIN_SHEET_NOT_FOUND");
    result.sourceFile.mainSheet=main.getName(); result.sourceFile.mainSheetId=Number(main.getSheetId()||0); result.sourceFile.sparseRows=aiCfgSparseRowsV1_(main,EHOME_AI_CONFIG_V1.MAX_ROWS,EHOME_AI_CONFIG_V1.MAX_COLS); result.sourceFile.mergedRanges=aiCfgMergedRangesV1_(main,EHOME_AI_CONFIG_V1.MAX_ROWS,EHOME_AI_CONFIG_V1.MAX_COLS);
  }catch(e3){result.errors.push({stage:"SOURCE_OPEN",error:String(e3&&e3.message?e3.message:e3)});}
  Logger.log(JSON.stringify({code:"AI_SOURCE_INSPECT_V12",source:source.source,sourceId:source.id,opened:result.sourceFile.opened,mainSheet:result.sourceFile.mainSheet,masterVillas:result.currentMasterVillas.length,sparseRows:result.sourceFile.sparseRows.length,errors:result.errors}));
  return result;
}

function testAiSourceInspectorV1ChonVilla(){return inspectAiSourceV1("chồn villa");}

function testAiSourceInspectorV12Kina(){
  var r=inspectAiSourceV1("Kina nguyên căn");
  if(!r||!r.success)throw new Error("AI_KINA_INSPECT_FAILED");
  if(aiCfgNormV1_(r.sourceFile.mainSheet)!==aiCfgNormV1_("NGUYÊN CĂN RIÊNG BIỆT"))throw new Error("AI_KINA_WRONG_MAIN_SHEET: "+r.sourceFile.mainSheet);
  Logger.log(JSON.stringify({code:"AI_KINA_SOURCE_INSPECT_PASS_V12",result:{source:r.source.source,mainSheet:r.sourceFile.mainSheet}}));
  return r;
}

/** ================= V4.22.2 FAST AI INSPECTION =================
 * Mục tiêu: 1 lần mở source lấy evidence cần thiết; bỏ ConfigDoctor + Structure
 * scan trước OpenAI. Candidate structure vẫn được validate sau model.
 */
function aiCfgFastInspectionCacheKeyV4222_(source){
  return "AICFG_FAST_4222_" + String(source && (source.id || source.source) || "").replace(/[^A-Za-z0-9_-]/g,"_").slice(0,80);
}

function aiCfgTrimFastInspectionV4222_(result){
  var out=JSON.parse(JSON.stringify(result||{}));
  if(Array.isArray(out.currentMasterVillas)) out.currentMasterVillas=out.currentMasterVillas.slice(0,80);
  if(out.sourceFile&&Array.isArray(out.sourceFile.sparseRows)) out.sourceFile.sparseRows=out.sourceFile.sparseRows.slice(0,20);
  return out;
}

function inspectAiSourceFastV4222(selector, options){
  options=options||{};
  var started=Date.now();
  var source=typeof opsFindSourceV312_==="function"?opsFindSourceV312_(selector):null;
  if(!source)return {success:false,error:"SOURCE_NOT_FOUND",selector:String(selector||"")};
  var cache=CacheService.getScriptCache(),cacheKey=aiCfgFastInspectionCacheKeyV4222_(source),cached="";
  if(options.noCache!==true){
    try{cached=String(cache.get(cacheKey)||"");}catch(ignoreCacheGet){}
    if(cached){
      try{
        var cachedResult=JSON.parse(cached);
        cachedResult.cacheHit=true;
        cachedResult.elapsedMs=Date.now()-started;
        Logger.log(JSON.stringify({code:"AI_SOURCE_FAST_CACHE_HIT_V4222",source:source.source,sourceId:source.id,elapsedMs:cachedResult.elapsedMs}));
        return cachedResult;
      }catch(ignoreBadCache){}
    }
  }

  var result={
    success:true,
    version:"4.22.2-fast-inspection",
    inspectionMode:"FAST_V4222",
    cacheHit:false,
    source:{row:source.row,id:source.id,city:source.city,source:source.source,link:source.link,enabled:source.enabled,type:source.type,configMaster:source.configMaster,configCalendar:source.configCalendar,configImage:source.configImage,configInfo:source.configInfo},
    currentMasterVillas:aiCfgCurrentMasterRowsV1_(source.source),
    sourceFile:{opened:false,title:"",id:"",sheets:[],mainSheet:"",mainSheetId:0,sparseRows:[],mergedRanges:[]},
    doctor:null,
    structure:null,
    errors:[],
    elapsedMs:0
  };

  try{
    if(!source.link)throw new Error("SOURCE_LINK_MISSING");
    var file=SpreadsheetApp.openByUrl(source.link);
    result.sourceFile.opened=true;
    result.sourceFile.title=file.getName();
    result.sourceFile.id=file.getId();
    result.sourceFile.sheets=aiCfgSheetSummaryV1_(file);
    var selection=typeof beMasterCalendarSelectionV4210_==="function"?beMasterCalendarSelectionV4210_(file,source.configCalendar||"AUTO",new Date()):null;
    var main=selection&&selection.sheet?selection.sheet:(typeof findLatestMasterCalendarSheet==="function"?findLatestMasterCalendarSheet(file):null);
    if(!main)throw new Error(selection&&selection.inactiveWindow?"SOURCE_INACTIVE_CALENDAR_WINDOW":"MAIN_SHEET_NOT_FOUND");
    result.sourceFile.mainSheet=main.getName();
    result.sourceFile.mainSheetId=Number(main.getSheetId()||0);
    result.sourceFile.sparseRows=aiCfgSparseRowsV1_(main,EHOME_AI_CONFIG_V1.MAX_ROWS,EHOME_AI_CONFIG_V1.MAX_COLS);
    result.sourceFile.mergedRanges=aiCfgMergedRangesV1_(main,EHOME_AI_CONFIG_V1.MAX_ROWS,EHOME_AI_CONFIG_V1.MAX_COLS);
  }catch(e){
    result.errors.push({stage:"SOURCE_OPEN",error:String(e&&e.message?e.message:e)});
  }

  result.elapsedMs=Date.now()-started;
  var compact=aiCfgTrimFastInspectionV4222_(result);
  try{
    var json=JSON.stringify(compact);
    if(json.length<90000)cache.put(cacheKey,json,120);
  }catch(ignoreCachePut){}
  Logger.log(JSON.stringify({code:"AI_SOURCE_FAST_V4222",source:source.source,sourceId:source.id,opened:result.sourceFile.opened,mainSheet:result.sourceFile.mainSheet,masterVillas:result.currentMasterVillas.length,sparseRows:result.sourceFile.sparseRows.length,errors:result.errors,elapsedMs:result.elapsedMs}));
  return result;
}

function testAiSourceFastV4222(selector){
  selector=selector||"1am travel";
  var r=inspectAiSourceFastV4222(selector,{noCache:true});
  if(!r||!r.success)throw new Error("AI_SOURCE_FAST_FAILED_V4222: "+String(r&&r.error||"UNKNOWN"));
  if(r.inspectionMode!=="FAST_V4222")throw new Error("AI_SOURCE_FAST_MODE_MISSING_V4222");
  var result={success:true,version:r.version,source:r.source.source,opened:r.sourceFile.opened,mainSheet:r.sourceFile.mainSheet,masterVillas:r.currentMasterVillas.length,elapsedMs:r.elapsedMs};
  Logger.log(JSON.stringify({code:"AI_SOURCE_FAST_PASS_V4222",result:result}));
  return result;
}
