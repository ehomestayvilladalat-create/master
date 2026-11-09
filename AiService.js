/** 21_AiService.gs - cost-aware OpenAI Responses API for EHOME V3.1.2 */

function aiGetPropertyV31_(key) { return String(PropertiesService.getScriptProperties().getProperty(key) || "").trim(); }

function aiSystemInstructionsV31_() {
  var brain = typeof aiProjectBrainV4222_ === "function" ? aiProjectBrainV4222_() : "";
  return [
    "Bạn là AI đồng quản lý kỹ thuật EHOME Booking DEV.",
    "Trả lời tiếng Việt, ngắn gọn, thực dụng. Ưu tiên dữ liệu tool, không suy đoán.",
    "Độ chính xác lịch là số 1. FREE/BUSY và giá chỉ kết luận khi Search/Calendar tool xác nhận.",
    "Khi hỏi ảnh/config/source/health phải đọc tool tương ứng trước; nhưng không gọi nhiều tool trùng dữ liệu nếu một tool đã đủ bằng chứng.",
    "Nếu phát hiện lỗi config, nói rõ block, code lỗi, ảnh hưởng và CONFIG đề xuất; không được tự ghi CONFIG.",
    "Nếu người dùng hỏi nên thêm cột/schema mới, chỉ đề xuất khi nêu được vấn đề, dữ liệu thiếu, lợi ích, rủi ro và module sử dụng.",
    "Operational repair chỉ được thực thi qua Telegram /repair rồi /apply. AI không được nói rằng đã sửa nếu chưa có kết quả tool/action.",
    "Không tiết lộ API key, bot token, webhook key hoặc Script Properties.",
    brain ? "PROJECT BRAIN (quy tắc nền, không thay thế dữ liệu live):\n" + brain : ""
  ].filter(String).join("\n");
}

function aiAskV31(message) { return aiAskWithModelV312_(message,false); }
function aiAskDeepV312(message) { return aiAskWithModelV312_(message,true); }

function aiAskWithModelV312_(message, deep) {
  message = String(message || "").trim();
  if (!message) return {success:false,error:"EMPTY_MESSAGE"};
  var key = aiGetPropertyV31_("OPENAI_API_KEY");
  if (!key) return {success:false,error:"OPENAI_API_KEY_NOT_SET"};
  var model = deep ? (aiGetPropertyV31_("OPENAI_MODEL_DEEP") || EHOME_AI_V31.DEEP_MODEL) : (aiGetPropertyV31_("OPENAI_MODEL") || EHOME_AI_V31.DEFAULT_MODEL);
  var input = [{role:"user",content:message}];
  var tools = aiToolDefinitionsV31_();
  var usedTools = [];
  for (var round=0; round<EHOME_AI_V31.MAX_TOOL_ROUNDS; round++) {
    var payload = {model:model,instructions:aiSystemInstructionsV31_(),tools:tools,tool_choice:"auto",parallel_tool_calls:false,input:input,reasoning:{effort:deep?"medium":"low"},max_output_tokens:deep?2600:1400,store:false};
    var response = aiCallResponsesV31_(payload,key,deep?"DEEP":"NORMAL");
    if (!response.success) return response;
    var raw = response.data || {};
    var output = Array.isArray(raw.output) ? raw.output : [];
    var calls = output.filter(function(item){ return item && item.type === "function_call"; });
    if (!calls.length) return {success:true,model:model,text:aiExtractTextV31_(raw) || "AI không trả về nội dung.",usedTools:usedTools,responseId:String(raw.id || "")};
    output.forEach(function(item){ input.push(item); });
    for (var i=0;i<calls.length;i++) {
      var call = calls[i], args = {};
      try { args = JSON.parse(String(call.arguments || "{}")); } catch (err) { args = {__parseError:String(err && err.message ? err.message : err)}; }
      var toolResult;
      try { toolResult = aiExecuteToolV31_(call.name,args); } catch (toolErr) { toolResult = {success:false,error:String(toolErr && toolErr.message ? toolErr.message : toolErr)}; }
      usedTools.push(String(call.name || ""));
      input.push({type:"function_call_output",call_id:String(call.call_id || ""),output:JSON.stringify(toolResult)});
    }
  }
  return {success:false,error:"AI_TOOL_ROUND_LIMIT",usedTools:usedTools};
}

function aiCallResponsesV31_(payload, apiKey, kind) {
  var started = Date.now(), resp;
  try {
    resp = UrlFetchApp.fetch("https://api.openai.com/v1/responses",{method:"post",contentType:"application/json",headers:{Authorization:"Bearer "+apiKey},payload:JSON.stringify(payload),muteHttpExceptions:true});
  } catch (err) { return {success:false,error:"OPENAI_FETCH_FAILED",message:String(err && err.message ? err.message : err)}; }
  var code = Number(resp.getResponseCode()), text = resp.getContentText(), data = {};
  try { data = JSON.parse(text || "{}"); } catch (parseErr) { return {success:false,error:"OPENAI_BAD_JSON",httpCode:code,body:text.slice(0,1000)}; }
  aiRecordUsageV312_(kind || "NORMAL",payload.model,data,code,Date.now()-started);
  if (code < 200 || code >= 300) {
    var msg = data && data.error && data.error.message ? data.error.message : text;
    if (typeof beEmitSystemEventV30_ === "function") beEmitSystemEventV30_("ERROR","AI_API_ERROR",{message:String(msg||"OpenAI API error"),httpCode:code});
    return {success:false,error:"OPENAI_API_ERROR",httpCode:code,message:String(msg || "")};
  }
  return {success:true,data:data,elapsedMs:Date.now()-started};
}

function aiExtractTextV31_(response) {
  if (response && typeof response.output_text === "string" && response.output_text.trim()) return response.output_text.trim();
  var texts=[];
  (response && Array.isArray(response.output) ? response.output : []).forEach(function(item){
    if (!item || item.type !== "message" || !Array.isArray(item.content)) return;
    item.content.forEach(function(part){ if (part && part.type === "output_text" && part.text) texts.push(String(part.text)); });
  });
  return texts.join("\n").trim();
}

function aiRecordUsageV312_(kind,model,data,httpCode,elapsedMs) {
  try {
    var p = PropertiesService.getScriptProperties();
    var tz = Session.getScriptTimeZone() || "Asia/Ho_Chi_Minh";
    var day = Utilities.formatDate(new Date(),tz,"yyyy-MM-dd");
    var key = "EHOME_AI_USAGE_V312_" + day;
    var u = {};
    try { u = JSON.parse(p.getProperty(key) || "{}"); } catch(ignore) { u = {}; }
    u.calls = Number(u.calls || 0) + 1;
    u.normal = Number(u.normal || 0) + (kind === "DEEP" ? 0 : 1);
    u.deep = Number(u.deep || 0) + (kind === "DEEP" ? 1 : 0);
    u.lastModel = String(model || ""); u.lastHttpCode = Number(httpCode || 0); u.lastElapsedMs = Number(elapsedMs || 0);
    if (data && data.usage) { u.inputTokens = Number(u.inputTokens||0)+Number(data.usage.input_tokens||0); u.outputTokens = Number(u.outputTokens||0)+Number(data.usage.output_tokens||0); u.totalTokens = Number(u.totalTokens||0)+Number(data.usage.total_tokens||0); }
    p.setProperty(key,JSON.stringify(u));
  } catch(ignore2) {}
}

function getAiUsageV312() {
  var tz = Session.getScriptTimeZone() || "Asia/Ho_Chi_Minh";
  var day = Utilities.formatDate(new Date(),tz,"yyyy-MM-dd");
  var raw = PropertiesService.getScriptProperties().getProperty("EHOME_AI_USAGE_V312_"+day) || "{}";
  var u={}; try {u=JSON.parse(raw);} catch(ignore){}
  return {date:day,calls:Number(u.calls||0),normal:Number(u.normal||0),deep:Number(u.deep||0),inputTokens:Number(u.inputTokens||0),outputTokens:Number(u.outputTokens||0),totalTokens:Number(u.totalTokens||0),lastModel:String(u.lastModel||"")};
}

function testOpenAiV31() {
  var result = aiAskV31("Kiểm tra health EHOME. Dùng get_system_health trước, trả lời tối đa 5 dòng.");
  Logger.log(JSON.stringify({code:"OPENAI_TEST_V312",result:result}));
  return result;
}
