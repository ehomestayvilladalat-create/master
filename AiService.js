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
  // C1: đang ngắt mạch (hết tiền/khóa API) => không gọi OpenAI, trả lỗi ngay.
  var breaker = aiBreakerStateV1_();
  if (breaker && Number(breaker.openUntil || 0) > Date.now()) {
    return {success:false,error:"AI_CIRCUIT_OPEN",httpCode:Number(breaker.httpCode || 0),
      message:"AI đang tạm ngưng (" + String(breaker.reason || "") + "), tự thử lại lúc " + aiFormatTimeV1_(breaker.openUntil) +
        ". Nạp tiền/sửa key xong chạy aiResetBreakerV1() để mở ngay."};
  }
  var started = Date.now(), resp;
  try {
    resp = UrlFetchApp.fetch("https://api.openai.com/v1/responses",{method:"post",contentType:"application/json",headers:{Authorization:"Bearer "+apiKey},payload:JSON.stringify(payload),muteHttpExceptions:true});
  } catch (err) { return {success:false,error:"OPENAI_FETCH_FAILED",message:String(err && err.message ? err.message : err)}; }
  var code = Number(resp.getResponseCode()), text = resp.getContentText(), data = {};
  try { data = JSON.parse(text || "{}"); } catch (parseErr) { return {success:false,error:"OPENAI_BAD_JSON",httpCode:code,body:text.slice(0,1000)}; }
  aiRecordUsageV312_(kind || "NORMAL",payload.model,data,code,Date.now()-started);
  if (code < 200 || code >= 300) {
    var msg = data && data.error && data.error.message ? data.error.message : text;
    var errCode = data && data.error ? String(data.error.code || data.error.type || "") : "";
    var trip = aiBreakerShouldTripV1_(code, errCode, msg);
    if (trip) {
      aiBreakerOpenV1_(code, trip, msg);
    } else if (typeof beEmitSystemEventV30_ === "function") {
      beEmitSystemEventV30_("ERROR","AI_API_ERROR",{message:String(msg||"OpenAI API error"),httpCode:code});
    }
    return {success:false,error:trip ? "AI_CIRCUIT_OPEN" : "OPENAI_API_ERROR",httpCode:code,message:String(msg || "")};
  }
  if (breaker) aiBreakerCloseV1_("OPENAI_OK_AFTER_RETRY");
  return {success:true,data:data,elapsedMs:Date.now()-started};
}

/*
 * C1 - NGẮT MẠCH AI KHI HẾT TIỀN / KHÓA API
 * - 401 (key sai/hết hạn), 402 (thanh toán), 403 (bị chặn), 429 do hết hạn mức
 *   (insufficient_quota/billing) => ngưng gọi OpenAI 1 giờ. 429 do gọi quá nhanh thì không ngắt.
 * - Hết giờ: lần gọi kế tiếp thử lại thật; vẫn lỗi => ngưng thêm 1 giờ (không báo lại).
 * - Báo Telegram admin 1 lần cho mỗi đợt; ghi SYSTEM_EVENT_LOG_V3 (AI_CIRCUIT_OPEN / AI_CIRCUIT_CLOSED).
 * - Nạp tiền xong: chạy aiResetBreakerV1(). Xem trạng thái: getAiBreakerStatusV1().
 */
var EHOME_AI_BREAKER_V1 = {PROPERTY: "EHOME_AI_BREAKER_V1", OPEN_MS: 3600000};

function aiBreakerShouldTripV1_(httpCode, errCode, message) {
  httpCode = Number(httpCode || 0);
  var text = (String(errCode || "") + " " + String(message || "")).toLowerCase();
  if (httpCode === 401) return "KEY_INVALID_OR_EXPIRED_401";
  if (httpCode === 402) return "PAYMENT_REQUIRED_402";
  if (httpCode === 403) return "FORBIDDEN_403";
  if (httpCode === 429 && /insufficient_quota|quota|billing|credit|hard limit|exceeded your current/.test(text)) return "QUOTA_EXHAUSTED_429";
  return "";
}

function aiBreakerStateV1_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(EHOME_AI_BREAKER_V1.PROPERTY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function aiBreakerOpenV1_(httpCode, reason, message) {
  var prev = aiBreakerStateV1_();
  var now = Date.now();
  var state = {
    reason: String(reason || ""), httpCode: Number(httpCode || 0),
    message: String(message || "").slice(0, 300),
    episodeStart: prev && prev.episodeStart ? prev.episodeStart : now,
    openedAt: now, openUntil: now + EHOME_AI_BREAKER_V1.OPEN_MS,
    retries: prev ? Number(prev.retries || 0) + 1 : 0,
    notified: !!(prev && prev.notified)
  };
  if (!state.notified) {
    state.notified = aiBreakerNotifyV1_("🔴 AI (OpenAI) tạm ngưng: " + state.reason + " (HTTP " + state.httpCode + ").\n" +
      String(state.message || "") + "\nHệ thống tự thử lại mỗi giờ. Nạp tiền/sửa key xong chạy aiResetBreakerV1() để mở ngay.\n" +
      "Tìm căn/lịch/giá KHÔNG bị ảnh hưởng (không dùng AI).");
  }
  try { PropertiesService.getScriptProperties().setProperty(EHOME_AI_BREAKER_V1.PROPERTY, JSON.stringify(state)); } catch (ignore) {}
  if (typeof beEmitSystemEventV30_ === "function") {
    beEmitSystemEventV30_("ERROR", "AI_CIRCUIT_OPEN", {message: "AI tạm ngưng: " + state.reason, httpCode: state.httpCode,
      retries: state.retries, openUntil: new Date(state.openUntil).toISOString()});
  }
  return state;
}

function aiBreakerCloseV1_(reason) {
  var prev = aiBreakerStateV1_();
  try { PropertiesService.getScriptProperties().deleteProperty(EHOME_AI_BREAKER_V1.PROPERTY); } catch (ignore) {}
  if (prev) {
    if (typeof beEmitSystemEventV30_ === "function") {
      beEmitSystemEventV30_("INFO", "AI_CIRCUIT_CLOSED", {message: "AI hoạt động lại (" + String(reason || "") + ")", previousReason: prev.reason});
    }
    if (prev.notified) aiBreakerNotifyV1_("🟢 AI (OpenAI) đã hoạt động lại.");
  }
  return {success: true, code: "AI_CIRCUIT_CLOSED_V1", wasOpen: !!prev, reason: String(reason || "")};
}

function aiBreakerNotifyV1_(text) {
  try {
    if (typeof sendTelegramMessageV31_ !== "function" || typeof tgPropertyV315_ !== "function") return false;
    var chat = tgPropertyV315_("TELEGRAM_ADMIN_CHAT_ID");
    if (!chat) return false;
    var r = sendTelegramMessageV31_(chat, text);
    return !!(r && r.success !== false);
  } catch (e) { return false; }
}

function aiFormatTimeV1_(ms) {
  try { return Utilities.formatDate(new Date(Number(ms)), Session.getScriptTimeZone() || "Asia/Ho_Chi_Minh", "HH:mm dd/MM"); }
  catch (e) { return new Date(Number(ms)).toISOString(); }
}

/** Mở lại AI ngay (sau khi nạp tiền / sửa key). */
function aiResetBreakerV1() {
  var r = aiBreakerCloseV1_("MANUAL_RESET");
  Logger.log(JSON.stringify(r));
  return r;
}

/** Xem trạng thái ngắt mạch AI. */
function getAiBreakerStatusV1() {
  var st = aiBreakerStateV1_();
  var r = st
    ? {success: true, open: Number(st.openUntil || 0) > Date.now(), reason: st.reason, httpCode: st.httpCode,
       retryAt: aiFormatTimeV1_(st.openUntil), retries: st.retries, notified: st.notified}
    : {success: true, open: false};
  Logger.log(JSON.stringify(r));
  return r;
}

/** Test thuần cho quy tắc ngắt mạch (không gọi OpenAI, không đổi trạng thái thật). */
function testAiBreakerRulesV1() {
  var cases = [
    [aiBreakerShouldTripV1_(401, "invalid_api_key", "Incorrect API key"), "KEY_INVALID_OR_EXPIRED_401"],
    [aiBreakerShouldTripV1_(402, "", ""), "PAYMENT_REQUIRED_402"],
    [aiBreakerShouldTripV1_(403, "", "Country not supported"), "FORBIDDEN_403"],
    [aiBreakerShouldTripV1_(429, "insufficient_quota", "You exceeded your current quota"), "QUOTA_EXHAUSTED_429"],
    [aiBreakerShouldTripV1_(429, "rate_limit_exceeded", "Rate limit reached, try again in 2s"), ""],
    [aiBreakerShouldTripV1_(500, "server_error", ""), ""]
  ];
  cases.forEach(function(c, i) { if (c[0] !== c[1]) throw new Error("AI_BREAKER_RULE_FAIL case " + (i + 1) + ": " + c[0]); });
  var r = {success: true, code: "AI_BREAKER_RULES_PASS_V1", cases: cases.length};
  Logger.log(JSON.stringify(r));
  return r;
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
