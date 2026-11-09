/**
 * 20_AiTools.gs - EHOME V3.1.2 FULL OPS AI TOOLS
 * Default is READ-ONLY diagnostics. Operational repair is only via explicit Telegram /repair + /apply.
 */

var EHOME_AI_V31 = {
  VERSION: "3.1.2-full-ops",
  DEFAULT_MODEL: "gpt-5.6-luna",
  DEEP_MODEL: "gpt-5.6-terra",
  MAX_TOOL_ROUNDS: 2,
  DEFAULT_PAGE_SIZE: 8,
  MAX_PAGE_SIZE: 12
};

function aiToolDefinitionsV31_() {
  return [
    {type:"function",name:"get_system_health",description:"Đọc tình trạng tổng thể EHOME: MASTER, Auto Sync, Image Audit và warning.",strict:true,parameters:{type:"object",properties:{},required:[],additionalProperties:false}},
    {type:"function",name:"get_image_audit_summary",description:"Đọc thống kê ảnh total/ok/broken/missing/pending/error.",strict:true,parameters:{type:"object",properties:{},required:[],additionalProperties:false}},
    {type:"function",name:"get_image_issues",description:"Đọc danh sách ảnh lỗi/thiếu có sourceColumn, CONFIG ẢNH và gợi ý sửa.",strict:true,parameters:{type:"object",properties:{status:{type:"string",enum:["MISSING","ERROR","BROKEN","PENDING","ALL"]},selector:{type:"string"},limit:{type:"integer",minimum:1,maximum:30}},required:["status","selector","limit"],additionalProperties:false}},
    {type:"function",name:"get_config_health",description:"Đọc tổng quan Config Doctor của tất cả source đang bật.",strict:true,parameters:{type:"object",properties:{},required:[],additionalProperties:false}},
    {type:"function",name:"get_config_source",description:"Đọc CONFIG MASTER/LỊCH/ẢNH/THÔNG TIN và lỗi/gợi ý của một source.",strict:true,parameters:{type:"object",properties:{source:{type:"string"},inspectRemote:{type:"boolean"}},required:["source","inspectRemote"],additionalProperties:false}},
    {type:"function",name:"get_source_health",description:"Đọc health từng source: số căn, config status, ảnh lỗi.",strict:true,parameters:{type:"object",properties:{source:{type:"string"}},required:["source"],additionalProperties:false}},
    {type:"function",name:"get_auto_sync_status",description:"Đọc tình trạng trigger Auto Sync MASTER.",strict:true,parameters:{type:"object",properties:{},required:[],additionalProperties:false}},
    {type:"function",name:"get_recent_events",description:"Đọc event gần nhất trong SYSTEM_EVENT_LOG_V3.",strict:true,parameters:{type:"object",properties:{limit:{type:"integer",minimum:1,maximum:30}},required:["limit"],additionalProperties:false}},
    {type:"function",name:"search_available_villas",description:"Dò lịch thật qua Search/Calendar V3. Giá min/max là giá trung bình mỗi đêm VND.",strict:true,parameters:{type:"object",properties:{checkIn:{type:"string"},checkOut:{type:"string"},guests:{type:"integer",minimum:1},city:{type:"string"},minNightPrice:{type:"number",minimum:0},maxNightPrice:{type:"number",minimum:0},sortMode:{type:"string",enum:["BEST","PRICE_ASC","PRICE_DESC"]},pageSize:{type:"integer",minimum:1,maximum:12}},required:["checkIn","checkOut","guests","city","minNightPrice","maxNightPrice","sortMode","pageSize"],additionalProperties:false}}
  ];
}

function aiExecuteToolV31_(name, args) {
  args = args || {};
  switch (String(name || "")) {
    case "get_system_health": return getSystemHealthV30();
    case "get_image_audit_summary": return typeof getImageAuditSummaryV30 === "function" ? getImageAuditSummaryV30() : {exists:false,error:"IMAGE_AUDIT_UNAVAILABLE"};
    case "get_image_issues": return getImageIssuesV312(String(args.status||"") === "ALL" ? "" : args.status,args.selector,args.limit);
    case "get_config_health": return getConfigHealthV312();
    case "get_config_source": return getConfigSourceHealthV312(args.source,Boolean(args.inspectRemote));
    case "get_source_health": return getSourceHealthOneV312(args.source);
    case "get_auto_sync_status": return typeof getEhomeAutoSyncStatus === "function" ? getEhomeAutoSyncStatus() : {installed:false,error:"AUTO_SYNC_STATUS_UNAVAILABLE"};
    case "get_recent_events": return getRecentSystemEventsV30(Math.max(1,Math.min(30,Number(args.limit || 10))));
    case "search_available_villas": return aiSearchAvailableVillasV31_(args);
    default: return {success:false,error:"UNKNOWN_AI_TOOL",tool:String(name || "")};
  }
}

function aiSearchAvailableVillasV31_(args) {
  var ci = String(args.checkIn || "").trim();
  var co = String(args.checkOut || "").trim();
  var nights = aiStayNightsV31_(ci, co);
  if (nights <= 0) return {success:false,error:"INVALID_DATE_RANGE",checkIn:ci,checkOut:co};
  var minNight = Math.max(0,Number(args.minNightPrice || 0));
  var maxNight = Math.max(0,Number(args.maxNightPrice || 0));
  var pageSize = Math.max(1,Math.min(EHOME_AI_V31.MAX_PAGE_SIZE,Number(args.pageSize || EHOME_AI_V31.DEFAULT_PAGE_SIZE)));
  var result = searchAvailableVillas(ci,co,Number(args.guests||1),String(args.city||"Đà Lạt"),0,pageSize,minNight>0?Math.round(minNight*nights):0,maxNight>0?Math.round(maxNight*nights):0,String(args.sortMode||"BEST"));
  return {
    success:result && result.success !== false,
    query:result && result.query ? result.query : {},
    count:result && result.count !== undefined ? result.count : 0,
    checkedVillas:result && result.checkedVillas !== undefined ? result.checkedVillas : 0,
    elapsedMs:result && result.elapsedMs !== undefined ? result.elapsedMs : 0,
    hasMore:Boolean(result && result.hasMore),
    results:(result && Array.isArray(result.results) ? result.results : []).map(function(v){return {name:v.name,city:v.city,source:v.source,standard:v.standard,bedrooms:v.bedrooms,priceConfidence:v.priceConfidence,totalPrice:v.totalPrice,totalPriceText:v.totalPriceText,nightlyPrices:v.nightlyPrices};}),
    errors:(result && Array.isArray(result.errors) ? result.errors.slice(0,5) : [])
  };
}

function aiStayNightsV31_(checkIn, checkOut) {
  var a = /^\d{4}-\d{2}-\d{2}$/.test(checkIn) ? new Date(checkIn + "T00:00:00") : null;
  var b = /^\d{4}-\d{2}-\d{2}$/.test(checkOut) ? new Date(checkOut + "T00:00:00") : null;
  if (!a || !b || !isFinite(a.getTime()) || !isFinite(b.getTime())) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function testAiToolsV31() {
  var result = {version:EHOME_AI_V31.VERSION,health:aiExecuteToolV31_("get_system_health",{}),image:aiExecuteToolV31_("get_image_audit_summary",{}),config:aiExecuteToolV31_("get_config_health",{}),autoSync:aiExecuteToolV31_("get_auto_sync_status",{}),recentEvents:aiExecuteToolV31_("get_recent_events",{limit:5})};
  Logger.log(JSON.stringify({code:"AI_TOOLS_PASS_V312",result:{version:result.version,config:{total:result.config.total,warning:result.config.warning,error:result.config.error}}}));
  return result;
}
