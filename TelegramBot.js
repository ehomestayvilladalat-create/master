/**
 * 22_TelegramBot.gs - EHOME V4.22.2 OPS CONSOLE + PROJECT BRAIN BUTTONS
 *
 * Telegram chỉ là Ops Console + Alert output.
 * Nhận lệnh/callback bằng getUpdates polling 1 phút, KHÔNG dùng webhook.
 * Health Watch không tự gọi OpenAI; AI Config chỉ chạy khi admin bấm nút.
 *
 * Lệnh chính:
 * /health
 * /sources
 * /source <nguồn>
 * /image
 * /config
 * /events
 * /repair <ACTION>
 * /apply <ID>
 */

var EHOME_TELEGRAM_V315 = {
  VERSION: "3.5.0-project-brain-v4222",
  POLL_HANDLER: "pollTelegramUpdatesV315",
  OFFSET_PROP: "EHOME_TELEGRAM_POLL_OFFSET_V315",
  MODE_PROP: "EHOME_TELEGRAM_MODE_V315",
  MODE_POLLING: "POLLING",
  POLL_MINUTES: 1,
  POLL_LIMIT: 10
};

function tgPropertyV315_(key) {
  return String(PropertiesService.getScriptProperties().getProperty(key) || "").trim();
}

/** Giữ tên hàm cũ để 23_AiHealthWatch/29_OpsTests không phải sửa. */
function aiGetPropertyV31FallbackTelegram_(key) {
  return tgPropertyV315_(key);
}

function tgApiV31_(method, payload) {
  var token = tgPropertyV315_("TELEGRAM_BOT_TOKEN");
  if (!token) return {success:false,error:"TELEGRAM_BOT_TOKEN_NOT_SET"};

  var resp;
  try {
    resp = UrlFetchApp.fetch(
      "https://api.telegram.org/bot" + token + "/" + method,
      {
        method:"post",
        contentType:"application/json",
        payload:JSON.stringify(payload || {}),
        muteHttpExceptions:true
      }
    );
  } catch (error) {
    return {
      success:false,
      error:"TELEGRAM_FETCH_FAILED",
      message:String(error && error.message ? error.message : error)
    };
  }

  var code = Number(resp.getResponseCode());
  var text = resp.getContentText();
  var data = {};
  try { data = JSON.parse(text || "{}"); } catch (ignore) {}

  if (code < 200 || code >= 300 || !data.ok) {
    return {
      success:false,
      error:"TELEGRAM_API_ERROR",
      httpCode:code,
      body:String(text || "").slice(0,1200)
    };
  }

  return {success:true,result:data.result};
}

function sendTelegramMessageV31_(chatId, text) {
  text = String(text || "");
  if (text.length > 3900) text = text.slice(0,3890) + "\n…";
  return tgApiV31_("sendMessage", {
    chat_id:String(chatId),
    text:text,
    disable_web_page_preview:true
  });
}

/** V4.22.1 - gửi Inline Keyboard để Ops thao tác một chạm. */
function sendTelegramMessageWithKeyboardV4221_(chatId, text, rows) {
  text = String(text || "");
  if (text.length > 3900) text = text.slice(0,3890) + "\n…";
  rows = Array.isArray(rows) ? rows.filter(function(row){ return Array.isArray(row) && row.length; }) : [];
  var payload = {
    chat_id:String(chatId),
    text:text,
    disable_web_page_preview:true
  };
  if (rows.length) payload.reply_markup = {inline_keyboard:rows};
  return tgApiV31_("sendMessage", payload);
}

function tgReplyV4221_(text, rows) {
  return {text:String(text || ""), inlineKeyboard:Array.isArray(rows) ? rows : []};
}

function tgMainMenuRowsV4221_() {
  return [
    [
      {text:"🏥 Sức khỏe",callback_data:"M:HEALTH"},
      {text:"🏠 Nguồn",callback_data:"M:SOURCES"}
    ],
    [
      {text:"🔴 Nguồn lỗi",callback_data:"M:SRCERR"},
      {text:"🟠 Cảnh báo",callback_data:"M:SRCWARN"}
    ],
    [
      {text:"⚙️ Cách đọc file",callback_data:"M:CONFIG"},
      {text:"🖼 Ảnh",callback_data:"M:IMAGE"}
    ],
    [
      {text:"📋 Sự kiện",callback_data:"M:EVENTS"},
      {text:"📊 AI dùng",callback_data:"M:AIUSAGE"}
    ],
    [
      {text:"🧠 Bộ nhớ AI",callback_data:"M:AIBRAIN"}
    ]
  ];
}

function tgBackMenuRowV4221_() {
  return [{text:"🏠 Menu",callback_data:"M:HOME"}];
}

function tgMainMenuReplyV4221_(text) {
  return tgReplyV4221_(String(text || "🤖 EHOME OPS"), tgMainMenuRowsV4221_());
}

function tgWithBackMenuV4221_(text, rows) {
  rows = Array.isArray(rows) ? rows.slice() : [];
  rows.push(tgBackMenuRowV4221_());
  return tgReplyV4221_(text, rows);
}

/** V3.2.9 - Chia reply dài theo dòng, không cắt mất danh sách nguồn. */
function tgSplitReplyV329_(text, maxLength) {
  text = String(text || "");
  maxLength = Math.max(500, Math.min(3800, Number(maxLength || 3600)));
  if (text.length <= maxLength) return [text];

  var parts = [];
  var current = "";
  text.split("\n").forEach(function(line) {
    line = String(line || "");
    if (line.length > maxLength) {
      if (current) { parts.push(current); current = ""; }
      for (var i = 0; i < line.length; i += maxLength) {
        parts.push(line.slice(i, i + maxLength));
      }
      return;
    }
    var next = current ? current + "\n" + line : line;
    if (next.length > maxLength) {
      if (current) parts.push(current);
      current = line;
    } else {
      current = next;
    }
  });
  if (current) parts.push(current);
  return parts.length ? parts : [text.slice(0, maxLength)];
}

function sendTelegramReplyV329_(chatId, reply) {
  var isEnvelope = reply && typeof reply === "object" && !Array.isArray(reply) && reply.text !== undefined;
  var text = isEnvelope ? String(reply.text || "") : String(reply || "");
  var keyboard = isEnvelope && Array.isArray(reply.inlineKeyboard) ? reply.inlineKeyboard : [];
  var parts = tgSplitReplyV329_(text, 3600);
  var results = [];
  for (var i = 0; i < parts.length; i++) {
    var isLast = i === parts.length - 1;
    var sent = isLast && keyboard.length
      ? sendTelegramMessageWithKeyboardV4221_(chatId, parts[i], keyboard)
      : sendTelegramMessageV31_(chatId, parts[i]);
    results.push(sent);
    if (!sent || !sent.success) {
      return {success:false,parts:parts.length,sent:i,results:results};
    }
  }
  return {success:true,parts:parts.length,sent:parts.length,results:results};
}

/**
 * V3.1.5: webhook bị vô hiệu hóa chủ động.
 * Giữ function để code cũ/08_Api không báo missing function nếu có request lạc.
 */
function setupTelegramWebhookV31() {
  var result = {
    success:false,
    disabled:true,
    error:"WEBHOOK_DISABLED_V315",
    message:"EHOME V3.1.5 dùng getUpdates polling. Chạy installTelegramPollingV315()."
  };
  Logger.log(JSON.stringify({code:"TELEGRAM_WEBHOOK_DISABLED_V315",result:result}));
  return result;
}

function removeTelegramWebhookV31() {
  var result = tgApiV31_("deleteWebhook", {drop_pending_updates:true});
  Logger.log(JSON.stringify({code:"TELEGRAM_WEBHOOK_REMOVED_V315",result:result}));
  return result;
}

function getTelegramWebhookInfoV31() {
  var result = tgApiV31_("getWebhookInfo", {});
  Logger.log(JSON.stringify({code:"TELEGRAM_WEBHOOK_INFO_V315",result:result}));
  return result;
}

/** Webhook không còn xử lý command. */
function handleTelegramWebhookV31_(e, body) {
  Logger.log(JSON.stringify({
    code:"TELEGRAM_WEBHOOK_IGNORED_V315",
    updateId:body && body.update_id !== undefined ? body.update_id : ""
  }));
  return beJsonOutput_({ok:true,mode:"POLLING",webhookDisabled:true});
}

function tgRemovePollingTriggersV315_() {
  var handlers = [
    EHOME_TELEGRAM_V315.POLL_HANDLER,
    "pollTelegramUpdatesV314",
    "pollTelegramUpdatesV31"
  ];
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(trigger){
    if (handlers.indexOf(trigger.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });
  return removed;
}

/**
 * MIGRATION CHÍNH:
 * 1) deleteWebhook(drop_pending_updates=true) -> xóa queue 302 cũ.
 * 2) reset offset local.
 * 3) tạo đúng 1 trigger getUpdates mỗi phút.
 */
function installTelegramPollingV315() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error("TELEGRAM_INSTALL_LOCK_BUSY");

  try {
    var deleteWebhook = tgApiV31_("deleteWebhook", {drop_pending_updates:true});
    if (!deleteWebhook.success) {
      throw new Error("Không xóa được Telegram webhook: " + String(deleteWebhook.error || "UNKNOWN"));
    }

    var removed = tgRemovePollingTriggersV315_();
    var props = PropertiesService.getScriptProperties();
    props.deleteProperty(EHOME_TELEGRAM_V315.OFFSET_PROP);
    props.setProperty(EHOME_TELEGRAM_V315.MODE_PROP, EHOME_TELEGRAM_V315.MODE_POLLING);

    var trigger = ScriptApp
      .newTrigger(EHOME_TELEGRAM_V315.POLL_HANDLER)
      .timeBased()
      .everyMinutes(EHOME_TELEGRAM_V315.POLL_MINUTES)
      .create();

    var result = getTelegramPollingStatusV315(false);
    result.webhookDeleted = true;
    result.pendingDropped = true;
    result.removedOldPollingTriggers = removed;
    result.triggerId = trigger.getUniqueId();

    Logger.log(JSON.stringify({code:"TELEGRAM_POLLING_INSTALLED_V315",result:result}));
    return result;
  } finally {
    lock.releaseLock();
  }
}

function removeTelegramPollingV315() {
  var removed = tgRemovePollingTriggersV315_();
  PropertiesService.getScriptProperties().deleteProperty(EHOME_TELEGRAM_V315.MODE_PROP);
  Logger.log(JSON.stringify({code:"TELEGRAM_POLLING_REMOVED_V315",removed:removed}));
  return {success:true,removed:removed};
}

function getTelegramPollingStatusV315(checkTelegram) {
  var all = ScriptApp.getProjectTriggers();
  var current = all.filter(function(t){
    return t.getHandlerFunction() === EHOME_TELEGRAM_V315.POLL_HANDLER;
  });
  var props = PropertiesService.getScriptProperties();
  var result = {
    version:EHOME_TELEGRAM_V315.VERSION,
    installed:current.length === 1,
    triggerCount:current.length,
    everyMinutes:EHOME_TELEGRAM_V315.POLL_MINUTES,
    mode:props.getProperty(EHOME_TELEGRAM_V315.MODE_PROP) || "",
    offset:props.getProperty(EHOME_TELEGRAM_V315.OFFSET_PROP) || "",
    adminChatIdSet:!!tgPropertyV315_("TELEGRAM_ADMIN_CHAT_ID")
  };

  if (checkTelegram !== false) {
    var info = tgApiV31_("getWebhookInfo", {});
    result.webhookInfo = info;
    if (info.success && info.result) {
      result.webhookUrl = String(info.result.url || "");
      result.pendingUpdateCount = Number(info.result.pending_update_count || 0);
    }
  }

  Logger.log(JSON.stringify({code:"TELEGRAM_POLLING_STATUS_V315",result:result}));
  return result;
}

function tgReadOffsetV315_() {
  var raw = tgPropertyV315_(EHOME_TELEGRAM_V315.OFFSET_PROP);
  var n = Number(raw || 0);
  return isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function tgWriteOffsetV315_(offset) {
  offset = Number(offset || 0);
  if (!(offset > 0)) return;
  PropertiesService.getScriptProperties().setProperty(
    EHOME_TELEGRAM_V315.OFFSET_PROP,
    String(Math.floor(offset))
  );
}

function tgProcessPollingUpdateV315_(update) {
  update = update || {};
  if (update.callback_query) {
    return tgProcessCallbackQueryV4221_(update.callback_query, update.update_id);
  }
  var msg = update.message || update.edited_message;
  if (!msg || !msg.chat) {
    return {consumed:true,ignored:true,reason:"NO_MESSAGE"};
  }

  var chatId = String(msg.chat.id || "");
  var adminChatId = tgPropertyV315_("TELEGRAM_ADMIN_CHAT_ID");

  if (!adminChatId) {
    return {consumed:false,error:"TELEGRAM_ADMIN_CHAT_ID_NOT_SET"};
  }

  if (chatId !== adminChatId) {
    if (typeof beEmitSystemEventV30_ === "function") {
      beEmitSystemEventV30_("WARNING","TELEGRAM_UNAUTHORIZED",{
        message:"Unauthorized Telegram chat",
        chatId:chatId
      });
    }
    return {consumed:true,unauthorized:true};
  }

  var text = String(msg.text || "").trim();
  if (!text) return {consumed:true,ignored:true,reason:"NO_TEXT"};

  var reply = "";
  try {
    reply = tgHandleCommandV31_(text);
  } catch (error) {
    var message = String(error && error.message ? error.message : error);
    Logger.log(JSON.stringify({
      code:"TELEGRAM_COMMAND_ERROR_V315",
      command:text,
      error:message
    }));
    reply = "❌ Lỗi xử lý lệnh: " + message;
  }

  var sendResult = sendTelegramReplyV329_(chatId, reply);
  var success = !!(sendResult && sendResult.success);

  Logger.log(JSON.stringify({
    code:"TELEGRAM_REPLY_V315",
    updateId:update.update_id,
    command:text,
    replyLength:String(reply || "").length,
    success:success,
    sendResult:sendResult
  }));

  return {
    consumed:success,
    command:text,
    sent:success,
    sendResult:sendResult
  };
}

/** Trigger mỗi phút. Không gọi OpenAI. */
function pollTelegramUpdatesV315() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    Logger.log(JSON.stringify({code:"TELEGRAM_POLL_SKIPPED_V315",reason:"LOCK_BUSY"}));
    return {success:true,skipped:true,reason:"LOCK_BUSY"};
  }

  try {
    var adminChatId = tgPropertyV315_("TELEGRAM_ADMIN_CHAT_ID");
    if (!adminChatId) {
      Logger.log(JSON.stringify({code:"TELEGRAM_POLL_SKIPPED_V315",reason:"ADMIN_CHAT_ID_NOT_SET"}));
      return {success:false,error:"TELEGRAM_ADMIN_CHAT_ID_NOT_SET"};
    }

    var offset = tgReadOffsetV315_();
    var payload = {
      limit:EHOME_TELEGRAM_V315.POLL_LIMIT,
      timeout:0,
      allowed_updates:["message","edited_message","callback_query"]
    };
    if (offset > 0) payload.offset = offset;

    var fetched = tgApiV31_("getUpdates", payload);
    if (!fetched.success) {
      Logger.log(JSON.stringify({code:"TELEGRAM_POLL_FETCH_FAIL_V315",result:fetched}));
      return fetched;
    }

    var updates = Array.isArray(fetched.result) ? fetched.result.slice() : [];
    updates.sort(function(a,b){
      return Number(a && a.update_id || 0) - Number(b && b.update_id || 0);
    });

    var processed = 0;
    var sent = 0;
    var ignored = 0;
    var lastOffset = offset;

    for (var i = 0; i < updates.length; i++) {
      var update = updates[i] || {};
      var updateId = Number(update.update_id || 0);
      if (!(updateId >= 0)) continue;
      if (lastOffset > 0 && updateId < lastOffset) continue;

      var outcome = tgProcessPollingUpdateV315_(update);
      if (!outcome.consumed) {
        Logger.log(JSON.stringify({
          code:"TELEGRAM_POLL_ITEM_NOT_CONSUMED_V315",
          updateId:updateId,
          outcome:outcome
        }));
        break;
      }

      processed++;
      if (outcome.sent) sent++;
      else ignored++;

      lastOffset = updateId + 1;
      tgWriteOffsetV315_(lastOffset);
    }

    var result = {
      success:true,
      fetched:updates.length,
      processed:processed,
      sent:sent,
      ignored:ignored,
      offset:lastOffset
    };

    Logger.log(JSON.stringify({code:"TELEGRAM_POLL_DONE_V315",result:result}));
    return result;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Chỉ dùng khi chưa có TELEGRAM_ADMIN_CHAT_ID.
 * Không chạy song song với polling thường xuyên.
 */
function captureTelegramAdminChatIdV31() {
  var fetched = tgApiV31_("getUpdates", {limit:20,timeout:0});
  if (!fetched.success || !Array.isArray(fetched.result) || !fetched.result.length) {
    throw new Error("Chưa thấy tin nhắn Telegram. Nhắn /start rồi chạy lại.");
  }

  var chatId = "";
  for (var i = fetched.result.length - 1; i >= 0; i--) {
    var u = fetched.result[i] || {};
    var msg = u.message || u.edited_message || u.channel_post;
    if (msg && msg.chat && msg.chat.id !== undefined) {
      chatId = String(msg.chat.id);
      break;
    }
  }

  if (!chatId) throw new Error("Không tìm thấy chat_id trong getUpdates.");
  PropertiesService.getScriptProperties().setProperty("TELEGRAM_ADMIN_CHAT_ID", chatId);
  Logger.log(JSON.stringify({code:"TELEGRAM_ADMIN_CHAT_ID_SAVED_V315",chatId:chatId}));
  return {success:true,chatId:chatId};
}

function testTelegramV31() {
  var chatId = tgPropertyV315_("TELEGRAM_ADMIN_CHAT_ID");
  if (!chatId) throw new Error("Chưa có TELEGRAM_ADMIN_CHAT_ID.");
  var result = sendTelegramMessageV31_(
    chatId,
    "✅ EHOME OPS V3.1.5 ONLINE\nMode: POLLING 1 phút\nWebhook: OFF\nAI: không dùng cho lệnh Ops"
  );
  Logger.log(JSON.stringify({code:"TELEGRAM_TEST_V315",result:result}));
  return result;
}

function testTelegramPollingV315() {
  var result = pollTelegramUpdatesV315();
  Logger.log(JSON.stringify({code:"TELEGRAM_POLL_TEST_V315",result:result}));
  return result;
}

function tgNormalizeCommandV312_(text) {
  // V3.2.0: hỗ trợ cả /nguon và /nguồn, kể cả khi Telegram gắn @BotName.
  return String(text || "").trim().replace(/^\/([^\s@]+)@[a-z0-9_]+/i,"/$1");
}

function tgCommandNameV320_(cmd) {
  var first = String(cmd || "").trim().split(/\s+/)[0] || "";
  first = first.replace(/^\//, "");
  return typeof opsNormV312_ === "function" ? opsNormV312_(first) : first.toLowerCase();
}

function tgCommandRestV320_(cmd) {
  return String(cmd || "").trim().replace(/^\/[^\s]+\s*/i, "").trim();
}

function tgCommandArgV312_(cmd, name) {
  return String(cmd || "").replace(new RegExp("^/" + name + "\\s*","i"),"").trim();
}


/** V4.22.1 - Callback buttons. Không gọi AI nếu chưa bấm nút AI. */
function tgAnswerCallbackV4221_(callbackId, text) {
  if (!callbackId) return {success:false,error:"CALLBACK_ID_EMPTY"};
  return tgApiV31_("answerCallbackQuery", {
    callback_query_id:String(callbackId),
    text:String(text || "").slice(0,180),
    show_alert:false,
    cache_time:0
  });
}

function tgShortButtonTextV4221_(text, maxLen) {
  text = String(text || "").trim();
  maxLen = Math.max(12, Number(maxLen || 34));
  return text.length > maxLen ? text.slice(0,maxLen-1) + "…" : text;
}

function tgSourceButtonsV4221_(sources, limit) {
  sources = Array.isArray(sources) ? sources : [];
  limit = Math.max(1, Math.min(10, Number(limit || 8)));
  var rows=[];
  sources.slice(0,limit).forEach(function(s){
    var id=String(s && s.id || "").trim();
    if (!id) return;
    rows.push([{text:"🔎 " + tgShortButtonTextV4221_(s.source,42), callback_data:"S:"+id}]);
  });
  return rows;
}

function tgSourceListReplyV4221_(mode) {
  var health = getSourceHealthV312();
  var list = health.sources || [];
  var filtered = list;
  var title = "🏠 EHOME · NGUỒN";
  if (mode === "ERROR") {
    filtered = list.filter(function(s){ return s.status === "ERROR"; });
    title = "🔴 NGUỒN LỖI";
  } else if (mode === "WARNING") {
    filtered = list.filter(function(s){ return s.status === "WARNING"; });
    title = "🟠 NGUỒN CẢNH BÁO";
  }
  var text = mode ? tgFormatNguonListV320_(filtered,title) : tgFormatNguonHomeV320_();
  var rows = mode ? tgSourceButtonsV4221_(filtered,8) : [
    [{text:"🔴 Xem nguồn lỗi",callback_data:"M:SRCERR"},{text:"🟠 Xem cảnh báo",callback_data:"M:SRCWARN"}]
  ];
  return tgWithBackMenuV4221_(text,rows);
}

function tgSourceDetailReplyV4221_(selector) {
  var source = typeof opsFindSourceV312_ === "function" ? opsFindSourceV312_(selector) : null;
  if (!source) return tgWithBackMenuV4221_("❌ Không tìm thấy nguồn: " + String(selector || ""),[]);
  var rows=[
    [{text:"🤖 AI SOI NGUỒN",callback_data:"AI:"+String(source.id||"")}],
    [{text:"🔄 Xem lại nguồn",callback_data:"S:"+String(source.id||"")}]
  ];
  return tgWithBackMenuV4221_(tgFormatSourceConsoleV315_(tgBuildSourceConsoleV315_(source.id||source.source)),rows);
}

function tgChangedLabelsV4221_(changed) {
  changed = changed || {};
  var labels=[];
  if (changed.configMaster) labels.push("MASTER");
  if (changed.configCalendar) labels.push("LỊCH");
  if (changed.configImage) labels.push("ẢNH");
  if (changed.configInfo) labels.push("INFO");
  if (changed.productType) labels.push("LOẠI");
  return labels;
}

function tgAiProposalTextV4221_(result) {
  if (!result || result.success === false) {
    return "❌ AI Config lỗi: " + String(result && (result.message || result.error) || "UNKNOWN_AI_CONFIG_ERROR");
  }
  var p = result.proposal || {};
  var validation = result.validation || {};
  var changed = tgChangedLabelsV4221_(result.changed || {});
  var corrections = result.villaCorrections || p.villaCorrections || [];
  try { if (typeof tgViAiProposalTextV1_ === "function") { var viAiTextV1 = tgViAiProposalTextV1_(result, p, validation, changed, corrections); if (viAiTextV1) return viAiTextV1; } } catch (eViAiV1) { Logger.log("[TelegramVietnamese] " + eViAiV1); }
  var lines=[
    "🤖 AI CONFIG + PROJECT BRAIN V4.22.2",
    "Nguồn: " + String(result.source || p.source || "") + " (" + String(result.sourceId || p.sourceId || "") + ")",
    "Proposal: " + String(result.proposalId || ""),
    "Status: " + String(result.status || "") + " · confidence: " + Number(p.confidence || 0),
    "CONFIG đổi: " + (changed.length ? changed.join(", ") : "không"),
    "Loại SP: " + String(p.productType || "—"),
    "PN/khách đề xuất: " + Number(corrections.length || 0)
  ];
  if(result.aiMode) lines.push("AI mode: " + String(result.aiMode));
  if(result.timing){
    var t=result.timing||{};
    lines.push("⏱ " + (Number(t.totalMs||0)/1000).toFixed(1) + "s · đọc " + (Number(t.inspectMs||0)/1000).toFixed(1) + "s · AI " + (Number(t.modelMs||0)/1000).toFixed(1) + "s · kiểm " + (Number(t.validateMs||0)/1000).toFixed(1) + "s");
  }
  if (p.reason) lines.push("Lý do: " + String(p.reason).slice(0,700));
  var errors=(validation.errors||[]).concat(validation.villaErrors||[]);
  var warnings=(validation.warnings||[]).concat(validation.villaWarnings||[]);
  if (errors.length) lines.push("❌ Validation: " + errors.slice(0,4).map(function(x){return String(x.code||x);}).join(", "));
  if (warnings.length) lines.push("⚠️ Cảnh báo: " + warnings.slice(0,5).map(function(x){return String(x.code||x);}).join(", "));
  lines.push("", result.status === "READY_FOR_APPROVAL" ? "Chưa ghi dữ liệu. Bấm nút bên dưới để duyệt từng phần." : "Chưa ghi dữ liệu. Proposal này chưa đủ điều kiện tự duyệt.");
  return lines.join("\n");
}

function tgStoredAiProposalTextV4221_(stored) {
  if (!stored || stored.success === false || !stored.proposal) {
    return "❌ Không đọc được proposal AI.";
  }
  var item=stored.proposal, p=item.proposal||{};
  return [
    "🤖 AI CONFIG + PROJECT BRAIN V4.22.2",
    "Nguồn: "+String(item.source||"")+" ("+String(item.sourceId||"")+")",
    "Proposal: "+String(item.id||""),
    "Status: "+String(item.status||"")+" · confidence: "+Number(item.confidence||0),
    "Loại SP: "+String(p.productType||"—"),
    "PN/khách đề xuất: "+Number((p.villaCorrections||[]).length||0),
    "",
    "Bấm nút bên dưới để xử lý."
  ].join("\n");
}

function tgAiProposalRowsV4221_(proposalId, sourceId, status, villaCount) {
  proposalId=String(proposalId||"").trim();
  sourceId=String(sourceId||"").trim();
  status=String(status||"").trim();
  villaCount=Number(villaCount||0);
  var rows=[];
  if (status === "READY_FOR_APPROVAL") {
    var approve=[];
    approve.push({text:"✅ Duyệt CONFIG",callback_data:"AC:"+proposalId});
    if (villaCount>0) approve.push({text:"✅ Duyệt PN/khách",callback_data:"AV:"+proposalId});
    rows.push(approve);
    rows.push([{text:"❌ Bỏ qua",callback_data:"AX:"+proposalId}]);
  } else if (status === "APPLIED_CONFIG_ONLY" && villaCount>0) {
    rows.push([{text:"✅ Duyệt PN/khách",callback_data:"AV:"+proposalId}]);
    rows.push([{text:"❌ Bỏ phần còn lại",callback_data:"AX:"+proposalId}]);
  } else if (status === "APPLIED_VILLA_ONLY") {
    rows.push([{text:"✅ Duyệt CONFIG",callback_data:"AC:"+proposalId}]);
  } else if (status !== "APPLIED_CONFIG_ONLY" && status !== "APPLIED_ALL" && status.indexOf("IGNORED")!==0) {
    rows.push([{text:"❌ Bỏ qua",callback_data:"AX:"+proposalId}]);
  }
  if (sourceId) rows.push([{text:"🔄 Kiểm tra lại nguồn",callback_data:"S:"+sourceId}]);
  rows.push(tgBackMenuRowV4221_());
  return rows;
}

function tgAiProposalReplyV4221_(result) {
  if (!result || result.success === false) return tgWithBackMenuV4221_(tgAiProposalTextV4221_(result),[]);
  return tgReplyV4221_(
    tgAiProposalTextV4221_(result),
    tgAiProposalRowsV4221_(result.proposalId,result.sourceId,result.status,(result.villaCorrections||[]).length)
  );
}

function tgStoredAiProposalReplyV4221_(proposalId) {
  var got = typeof getAiConfigProposalV1 === "function" ? getAiConfigProposalV1(proposalId) : {success:false,error:"AI_PROPOSAL_API_UNAVAILABLE"};
  if (!got.success) return tgWithBackMenuV4221_("❌ Proposal không tồn tại: "+String(proposalId||""),[]);
  var item=got.proposal, count=((item.proposal||{}).villaCorrections||[]).length;
  return tgReplyV4221_(
    tgStoredAiProposalTextV4221_(got),
    tgAiProposalRowsV4221_(item.id,item.sourceId,item.status,count)
  );
}

function tgApplyResultReplyV4221_(kind, result, proposalId) {
  if (!result || result.success === false) {
    var err=String(result && (result.error || result.message) || "UNKNOWN");
    var note="❌ " + kind + " lỗi: " + err;
    if(err==="ZERO_SOURCE_DEEP_CONFIRMATION_FAILED") note += "\nNguồn đang 0 căn và parser chưa xác nhận ổn định, nên V4222 đã chặn ghi.";
    return tgWithBackMenuV4221_(note,proposalId ? [[{text:"🔎 Xem proposal",callback_data:"P:"+String(proposalId)}]] : []);
  }
  var lines=[result.alreadyApplied?"✅ "+kind+" đã áp dụng trước đó":"✅ "+kind+" đã áp dụng"];
  if (result.source) lines.push("Nguồn: "+String(result.source));
  if (result.appliedCount!==undefined&&!result.alreadyApplied) lines.push("Đã ghi: "+Number(result.appliedCount||0)+" · bỏ qua an toàn: "+Number(result.skippedCount||0));
  if (result.deepConfirmed) lines.push("🛡 Nguồn 0 căn đã qua xác minh parser 2 lượt trước khi ghi.");
  if (result.elapsedMs!==undefined) lines.push("⏱ Apply: "+(Number(result.elapsedMs||0)/1000).toFixed(1)+"s");
  if (result.note) lines.push(String(result.note));
  var rows=[];
  if(kind==="CONFIG"&&Number(result.remainingVillaCorrections||0)>0&&proposalId)rows.push([{text:"✅ Duyệt PN/khách",callback_data:"AV:"+String(proposalId)}]);
  if(result.sourceId)rows.push([{text:"🔄 Kiểm tra lại nguồn",callback_data:"S:"+String(result.sourceId)}]);
  if (proposalId) rows.push([{text:"🔎 Proposal",callback_data:"P:"+String(proposalId)}]);
  var reply=tgWithBackMenuV4221_(lines.join("\n"),rows);
  reply._clearOriginKeyboard=true;
  return reply;
}

function tgRunAiSourceV4221_(selector) {
  selector=String(selector||"").trim();
  var cache=CacheService.getScriptCache();
  var key="EHOME_TG_AI_RECENT_V4221_"+selector;
  var recent="";
  try{recent=String(cache.get(key)||"");}catch(ignoreRecentGet){}
  if(recent&&typeof getAiConfigProposalV1==="function"){
    var got=getAiConfigProposalV1(recent);
    if(got&&got.success)return tgStoredAiProposalReplyV4221_(recent);
  }
  var result=proposeAiConfigV1(selector,false);
  if(result&&result.success&&result.proposalId){
    try{cache.put(key,String(result.proposalId),300);}catch(ignoreRecentPut){}
  }
  return tgAiProposalReplyV4221_(result);
}

function tgHandleCallbackV4221_(data) {
  data=String(data||"").trim();
  if (data === "M:HOME") return tgMainMenuReplyV4221_("🤖 EHOME OPS · bấm nút để thao tác");
  if (data === "M:HEALTH") return tgWithBackMenuV4221_(tgFormatHealthV31_(getSystemHealthV30()),[]);
  if (data === "M:SOURCES") return tgSourceListReplyV4221_("");
  if (data === "M:SRCERR") return tgSourceListReplyV4221_("ERROR");
  if (data === "M:SRCWARN") return tgSourceListReplyV4221_("WARNING");
  if (data === "M:CONFIG") return tgWithBackMenuV4221_(tgFormatConfigSummaryV315_(getConfigHealthV312()),[]);
  if (data === "M:IMAGE") return tgWithBackMenuV4221_(tgFormatImageV315_(getImageAuditSummaryV30()),[]);
  if (data === "M:EVENTS") return tgWithBackMenuV4221_(tgFormatEventsV31_(getRecentSystemEventsV30(10)),[]);
  if (data === "M:AIUSAGE") return tgWithBackMenuV4221_(tgFormatAiUsageV330_(),[]);
  if (data === "M:AIBRAIN") return tgWithBackMenuV4221_([
    "🧠 EHOME PROJECT BRAIN",
    "Version: " + (typeof aiProjectBrainVersionV4222_==="function"?aiProjectBrainVersionV4222_():"không có"),
    "AI hiểu quy tắc nền của dự án + đọc dữ liệu live theo source.",
    "Nguồn bình thường: FAST AI. Nguồn 0 căn/evidence lỗi: tự nâng DEEP.",
    "AI không tự ghi; code validation + nút Duyệt quyết định write."
  ].join("\n"),[]);
  if (data.indexOf("S:") === 0) return tgSourceDetailReplyV4221_(data.slice(2));
  if (data.indexOf("P:") === 0) return tgStoredAiProposalReplyV4221_(data.slice(2));
  if (data.indexOf("AI:") === 0) {
    var selector=data.slice(3);
    if (typeof proposeAiConfigV1 !== "function") return tgWithBackMenuV4221_("❌ AI Config V1.2 chưa khả dụng.",[]);
    return tgRunAiSourceV4221_(selector);
  }
  if (data.indexOf("AC:") === 0) {
    var configId=data.slice(3);
    return tgApplyResultReplyV4221_("CONFIG",applyAiConfigProposalV1(configId),configId);
  }
  if (data.indexOf("AV:") === 0) {
    var villaId=data.slice(3);
    return tgApplyResultReplyV4221_("PN/khách",applyAiVillaCorrectionsV1(villaId),villaId);
  }
  if (data.indexOf("AX:") === 0) {
    var ignoreId=data.slice(3);
    var ignored=typeof ignoreAiConfigProposalV1 === "function" ? ignoreAiConfigProposalV1(ignoreId) : {success:false,error:"IGNORE_API_UNAVAILABLE"};
    if(ignored&&ignored.success){
      var ignoredRows=[];
      if(ignored.sourceId)ignoredRows.push([{text:"🔄 Kiểm tra lại nguồn",callback_data:"S:"+String(ignored.sourceId)}]);
      var ignoredReply=tgWithBackMenuV4221_("✅ Đã bỏ qua proposal "+ignoreId+". Không ghi CONFIG/PN/khách.",ignoredRows);
      ignoredReply._clearOriginKeyboard=true;
      return ignoredReply;
    }
    return tgWithBackMenuV4221_("❌ Không bỏ qua được: "+String(ignored&&(ignored.error||ignored.message)||"UNKNOWN"),[]);
  }
  return tgMainMenuReplyV4221_("ℹ️ Nút này không còn hiệu lực hoặc phiên bản đã thay đổi.");
}

function tgClearOriginKeyboardV4222_(chatId,messageId){
  if(!chatId||!messageId)return {success:false,error:"MESSAGE_ID_EMPTY"};
  return tgApiV31_("editMessageReplyMarkup",{chat_id:String(chatId),message_id:Number(messageId),reply_markup:{inline_keyboard:[]}});
}

function tgProcessCallbackQueryV4221_(callbackQuery, updateId) {
  callbackQuery=callbackQuery||{};
  var msg=callbackQuery.message||{};
  var chatId=String(msg.chat&&msg.chat.id||"");
  var adminChatId=tgPropertyV315_("TELEGRAM_ADMIN_CHAT_ID");
  if (!adminChatId) return {consumed:false,error:"TELEGRAM_ADMIN_CHAT_ID_NOT_SET"};
  if (chatId!==adminChatId) {
    tgAnswerCallbackV4221_(callbackQuery.id,"Không có quyền.");
    return {consumed:true,unauthorized:true};
  }
  var callbackId=String(callbackQuery.id||"");
  var callbackCache=CacheService.getScriptCache();
  var callbackKey="EHOME_TG_CALLBACK_V4221_"+callbackId;
  try {
    if(callbackId&&callbackCache.get(callbackKey)){
      tgAnswerCallbackV4221_(callbackId,"Đã xử lý nút này.");
      return {consumed:true,ignored:true,reason:"DUPLICATE_CALLBACK",callback:true};
    }
    if(callbackId)callbackCache.put(callbackKey,"1",21600);
  } catch(ignoreCallbackCache) {}
  var data=String(callbackQuery.data||"").trim();
  var answerText=data.indexOf("AI:")===0 ? "Đang để AI soi nguồn…" : "Đang xử lý…";
  tgAnswerCallbackV4221_(callbackQuery.id,answerText);
  var reply;
  try {
    reply=tgHandleCallbackV4221_(data);
  } catch (error) {
    reply=tgWithBackMenuV4221_("❌ Lỗi nút Telegram: "+String(error&&error.message?error.message:error),[]);
  }
  var sendResult=sendTelegramReplyV329_(chatId,reply);
  var success=!!(sendResult&&sendResult.success);
  if(success&&reply&&reply._clearOriginKeyboard===true){
    try{tgClearOriginKeyboardV4222_(chatId,msg.message_id);}catch(ignoreClearKeyboard){}
  }
  Logger.log(JSON.stringify({code:"TELEGRAM_CALLBACK_V4222",updateId:updateId||"",data:data,success:success}));
  return {consumed:success,sent:success,callback:true,data:data,sendResult:sendResult};
}

function testTelegramButtonsV4221() {
  var rows=tgMainMenuRowsV4221_();
  var callbacks=[];
  rows.forEach(function(row){row.forEach(function(btn){callbacks.push(String(btn.callback_data||""));});});
  var proposal="AICFG-20260923-231600-ABCDEFGH";
  tgAiProposalRowsV4221_(proposal,"153","READY_FOR_APPROVAL",3).forEach(function(row){row.forEach(function(btn){callbacks.push(String(btn.callback_data||""));});});
  var tooLong=callbacks.filter(function(x){return Utilities.newBlob(x).getBytes().length>64;});
  if (tooLong.length) throw new Error("TELEGRAM_CALLBACK_TOO_LONG_V4221: "+tooLong.join(","));
  var required=["M:HEALTH","M:SRCERR","AC:"+proposal,"AV:"+proposal,"AX:"+proposal];
  required.forEach(function(x){if(callbacks.indexOf(x)<0)throw new Error("TELEGRAM_BUTTON_MISSING_V4221: "+x);});
  var result={success:true,version:"4.22.1",buttons:callbacks.length,maxCallbackBytes:Math.max.apply(null,callbacks.map(function(x){return Utilities.newBlob(x).getBytes().length;}))};
  Logger.log(JSON.stringify({code:"TELEGRAM_BUTTONS_PASS_V4221",result:result}));
  return result;
}

function tgFormatAiResultV330_(result, title) {
  title = String(title || "AI");
  if (!result || result.success === false) {
    return "❌ " + title + " lỗi: " + String(result && (result.message || result.error) || "UNKNOWN_AI_ERROR");
  }
  var lines = ["🧠 " + title];
  if (result.model) lines.push("Model: " + String(result.model));
  if (result.usedTools && result.usedTools.length) lines.push("Tools: " + result.usedTools.join(", "));
  lines.push("");
  lines.push(String(result.text || "AI không trả về nội dung."));
  return lines.join("\n");
}

function tgFormatAiUsageV330_() {
  if (typeof getAiUsageV312 !== "function") return "ℹ️ AI usage chưa khả dụng.";
  var u = getAiUsageV312() || {};
  return [
    "📊 AI USAGE " + String(u.date || ""),
    "Calls: " + Number(u.calls || 0) + " · Normal: " + Number(u.normal || 0) + " · Deep: " + Number(u.deep || 0),
    "Input: " + Number(u.inputTokens || 0) + " · Output: " + Number(u.outputTokens || 0),
    "Total tokens: " + Number(u.totalTokens || 0),
    "Model gần nhất: " + String(u.lastModel || "—")
  ].join("\n");
}

function tgHandleAiAutoV330_(rest) {
  return [
    "ℹ️ AI AUTO DIAG không dùng ở V4.22.2.",
    "Health Watch chỉ phát hiện lỗi + gửi nút 🤖 AI SOI NGUỒN.",
    "OpenAI chỉ chạy khi anh chủ động bấm nút; CONFIG/PN/khách vẫn cần nút Duyệt."
  ].join("\n");
}

function tgHandleCommandV31_(text) {
  var cmd = tgNormalizeCommandV312_(text);
  var lower = cmd.toLowerCase();
  var commandNameV320 = tgCommandNameV320_(cmd);
  var commandRestV320 = tgCommandRestV320_(cmd);

  if (lower === "/start" || lower === "/help") return tgMainMenuReplyV4221_(tgHelpV315_());
  if (lower === "/health") return tgWithBackMenuV4221_(tgFormatHealthV31_(getSystemHealthV30()),[]);
  if (lower === "/sources") return tgSourceListReplyV4221_("");

  // Alias tiếng Việt mới. /nguồn cũng được nhận như /nguon.
  if (commandNameV320 === "nguon") return tgHandleNguonV320_(commandRestV320);

  if (commandNameV320 === "source") {
    if (!commandRestV320) return tgSourceListReplyV4221_("");
    return tgSourceDetailReplyV4221_(commandRestV320);
  }

  if (lower === "/image") return tgWithBackMenuV4221_(tgFormatImageV315_(getImageAuditSummaryV30()),[]);
  if (lower === "/config") return tgWithBackMenuV4221_(tgFormatConfigSummaryV315_(getConfigHealthV312()),[]);
  if (lower === "/events") return tgWithBackMenuV4221_(tgFormatEventsV31_(getRecentSystemEventsV30(10)),[]);

  if (commandNameV320 === "analyze") {
    var aiQuestion = commandRestV320 || [
      "Phân tích lỗi EHOME hiện tại.",
      "Dùng get_structure_health trước; sau đó đọc source/config liên quan nếu cần.",
      "Ưu tiên lỗi thêm/bớt căn, cấu trúc nguồn, ảnh lệch và Auto Sync.",
      "Trả ngắn gọn: lỗi chính, nguồn bị ảnh hưởng, nguyên nhân khả năng cao, bước xử lý tiếp theo. Không tự sửa."
    ].join(" ");
    return tgFormatAiResultV330_(aiAskV31(aiQuestion),"AI ANALYZE");
  }

  if (commandNameV320 === "deepconfig") {
    if (!commandRestV320) return "ℹ️ Dùng /deepconfig <tên nguồn>";
    return tgFormatAiResultV330_(
      aiAskDeepV312(
        "Phân tích sâu nguồn: " + commandRestV320 +
        ". Dùng get_structure_source, get_source_health và get_config_source. " +
        "Tập trung CONFIG MASTER/LỊCH/ẢNH/THÔNG TIN, add/remove căn, row drift, column shift và nguy cơ lệch ảnh. " +
        "Không tự sửa. Trả nguyên nhân + CONFIG/bước kiểm tra đề xuất."
      ),
      "AI DEEP CONFIG"
    );
  }

  if (lower === "/aiusage") return tgWithBackMenuV4221_(tgFormatAiUsageV330_(),[]);
  if (commandNameV320 === "aiauto") return tgHandleAiAutoV330_(commandRestV320);

  if (/^\/repair\s+/i.test(cmd)) {
    var action = tgCommandArgV312_(cmd,"repair");
    var req = requestOpsRepairV312(action,"");
    return req.success
      ? "🛠 Action chờ xác nhận\n" + req.action + "\nID: " + req.id + "\n" + req.instruction
      : "❌ " + String(req.error || "REPAIR_NOT_ALLOWED");
  }

  if (/^\/apply\s+/i.test(cmd)) {
    var ap = applyOpsRepairV312(tgCommandArgV312_(cmd,"apply"));
    return ap && ap.success === false
      ? "❌ Apply lỗi: " + String(ap.error || ap.message || "UNKNOWN")
      : "✅ Action đã chạy\n" + opsCompactTextV312_(JSON.stringify(ap),900);
  }

  return "ℹ️ Lệnh không nằm trong Ops Console Lite. Gõ /help.";
}

function tgHelpV315_() {
  return [
    "🤖 EHOME OPS V4.22.2 · PROJECT BRAIN",
    "Bấm nút bên dưới là chính. Lệnh gõ cũ vẫn giữ để dự phòng.",
    "AI chỉ chạy khi anh bấm; mọi ghi CONFIG/PN/khách vẫn cần Duyệt."
  ].join("\n");
}

/** Giữ alias để test V3.1.2 cũ không lỗi. */
function tgHelpV312_() { return tgHelpV315_(); }

function tgImageSummaryV329_(img) {
  img = img || {};
  var present = Number(img.present || 0);
  var ok = Number(img.ok || 0);
  var missing = Number(img.missing || 0);
  var error = Number(img.error || 0);
  var broken = Number(img.broken || 0);
  var pending = Number(img.pending || 0);
  return {
    total:Number(img.total || 0),
    have:present + ok,
    verified:ok,
    unverified:present,
    missing:missing,error:error,broken:broken,pending:pending,
    issue:missing + error + broken
  };
}

function tgConfigImpactV329_(configHealth) {
  configHealth = configHealth || {};
  var impact = {okVillas:0,warningVillas:0,errorVillas:0};
  (configHealth.sources || []).forEach(function(s) {
    var villas = Number(s.masterVillaCount || 0);
    if (s.status === "ERROR") impact.errorVillas += villas;
    else if (s.status === "WARNING") impact.warningVillas += villas;
    else impact.okVillas += villas;
  });
  return impact;
}

function tgSafeConfigHealthV329_() {
  try { return getConfigHealthV312(); }
  catch (error) { return {success:false,total:0,ok:0,warning:0,error:0,sources:[],errorMessage:String(error && error.message ? error.message : error)}; }
}

function tgFormatHealthV31_(h) {
  h = h || {};
  var img = tgImageSummaryV329_(h.imageAudit || {});
  var a = h.autoSync || {};
  var snap = h.snapshot || {};
  var struct = snap.structure || {};
  var schedule = snap.schedule || {};
  var cfg = tgSafeConfigHealthV329_();
  var cfgImpact = tgConfigImpactV329_(cfg);

  var lines = [
    (h.status === "OK" ? "🟢" : "🟠") + " HỆ THỐNG EHOME · " + (typeof tgViStatusWordV1_ === "function" ? tgViStatusWordV1_(String(h.status || "UNKNOWN")) : String(h.status || "UNKNOWN")),
    "",
    "🏠 MASTER: " + Number(h.masterVillas || 0) + " căn đọc được",
    "",
    "🖼 ẢNH",
    "• Có ảnh: " + img.have + " căn" + (img.verified ? " (đã kiểm OK " + img.verified + ")" : ""),
    "• Đang xử lý: " + img.pending + " căn",
    "• Thiếu ảnh: " + img.missing + " căn",
    "• Lỗi xử lý ảnh/bộ nhớ ảnh: " + img.error + " căn",
    "• Link hỏng: " + img.broken + " căn",
    "• Cần kiểm ảnh: " + img.issue + " căn",
    "",
    "⚙️ CÁCH ĐỌC FILE (CONFIG)",
    "• " + Number(cfg.total || 0) + " nguồn bật · ✅" + Number(cfg.ok || 0) + " ⚠️" + Number(cfg.warning || 0) + " 🔴" + Number(cfg.error || 0),
    "• Căn thuộc nguồn lỗi cách đọc file: " + Number(cfgImpact.errorVillas || 0),
    "• Căn thuộc nguồn cảnh báo cách đọc file: " + Number(cfgImpact.warningVillas || 0),
    "",
    "🏗 CẤU TRÚC",
    "• ✅" + Number(struct.ok || 0) + " ⚠️" + Number(struct.warning || 0) + " 🔴" + Number(struct.error || 0),
    "",
    "🔄 HỆ THỐNG",
    "• Tự đồng bộ: " + Number(a.triggerCount || 0) + " bộ hẹn giờ / " + Number(a.everyHours || 0) + "h",
    "• Chụp lịch: " + Number(snap.triggerCount || 0) + " bộ hẹn giờ · Hàng chờ " + Number(schedule.pending || 0)
  ];

  if (h.warnings && h.warnings.length) lines.push("", "Cảnh báo: " + (typeof tgViWarnListV1_ === "function" ? tgViWarnListV1_(h.warnings) : h.warnings.join(", ")));
  lines.push("", "Xem lỗi: /nguon loi · /nguon canhbao · /image · /config");
  lines.push("Lưu ý: lỗi ảnh và lỗi CONFIG có thể trùng trên cùng một căn.");
  return lines.join("\n");
}

function tgFormatImageV315_(img) {
  var x = tgImageSummaryV329_(img || {});
  return [
    "🖼 KIỂM TRA ẢNH",
    "Tổng căn đã kiểm: " + x.total + " căn",
    "Có ảnh: " + x.have + " căn",
    "Đang xử lý: " + x.pending + " căn",
    "Thiếu ảnh: " + x.missing + " căn",
    "Lỗi xử lý ảnh/bộ nhớ ảnh: " + x.error + " căn",
    "Link hỏng: " + x.broken + " căn",
    "Cần kiểm ảnh: " + x.issue + " căn",
    "",
    "Theo nguồn: /nguon <nguồn>"
  ].join("\n");
}

/** Alias cũ cho Health/Tests. */
function tgFormatImageV31_(img) { return tgFormatImageV315_(img); }

function tgFormatConfigSummaryV315_(r) {
  r = r || {};
  var impact = tgConfigImpactV329_(r);
  return [
    "⚙️ KIỂM TRA CÁCH ĐỌC FILE (CONFIG)",
    "Nguồn bật: " + Number(r.total || 0),
    "Ổn: " + Number(r.ok || 0) + " · Cảnh báo: " + Number(r.warning || 0) + " · Lỗi: " + Number(r.error || 0),
    "Căn thuộc nguồn OK: " + Number(impact.okVillas || 0),
    "Căn thuộc nguồn cảnh báo: " + Number(impact.warningVillas || 0),
    "Căn thuộc nguồn lỗi: " + Number(impact.errorVillas || 0),
    "",
    "Chi tiết nguồn: /nguon <nguồn>"
  ].join("\n");
}

function tgFormatSourcesV312_(r) {
  r = r || {};
  var lines = [
    "🏠 SỨC KHỎE NGUỒN",
    "Tổng: " + Number(r.total || 0) + " | Ổn: " + Number(r.ok || 0) + " | Cảnh báo: " + Number(r.warning || 0) + " | Lỗi: " + Number(r.error || 0)
  ];

  (r.sources || [])
    .filter(function(x){ return x.status !== "OK"; })
    .forEach(function(x){
      lines.push("• " + x.source + " — " + (typeof tgViStatusWordV1_ === "function" ? tgViStatusWordV1_(x.status) : x.status) + " — " + x.villas + " căn — " + (x.warnings || []).join(","));
    });

  if (lines.length === 2) lines.push("Tất cả nguồn đều ổn.");
  lines.push("Chi tiết: /source <nguồn>");
  return lines.join("\n");
}

function tgBuildSourceConsoleV315_(selector) {
  var sourceHealth = getSourceHealthOneV312(selector);
  if (!sourceHealth || !sourceHealth.success) {
    return {success:false,error:"SOURCE_NOT_FOUND",selector:String(selector || "")};
  }

  var config = null;
  var image = null;
  var structure = null;
  var schedule = null;
  try { config = getConfigSourceHealthV312(selector,false); } catch (ignore) {}
  try { image = getImageSourceReportV312(selector,5); } catch (ignore2) {}
  try { if (typeof getStructureSnapshotOneV320 === "function") structure = getStructureSnapshotOneV320(selector); } catch (ignore3) {}
  try { if (typeof getScheduleSnapshotSourceStatusV320_ === "function") schedule = getScheduleSnapshotSourceStatusV320_(selector); } catch (ignore4) {}

  return {
    success:true,
    health:sourceHealth.source,
    config:config,
    image:image,
    structure:structure,
    schedule:schedule
  };
}

function tgFormatSourceConsoleV315_(r) {
  if (!r || !r.success) return "❌ SOURCE_NOT_FOUND";

  var x = r.health || {};
  var cfg = r.config || {};
  var imgReport = r.image || {};
  var img = imgReport.counts || x.image || {};
  var structureResult = r.structure || {};
  var structure = structureResult && structureResult.success ? structureResult.source || {} : (x.structure || {});
  var schedule = r.schedule || {};

  var lines = [
    tgStatusEmojiV320_(x.status) + " NGUỒN: " + String(x.source || ""),
    "Khu vực: " + String(x.city || ""),
    "MASTER: " + Number(x.villas || 0) + " căn",
    "Cách đọc file (CONFIG): " + (typeof tgViStatusWordV1_ === "function" ? tgViStatusWordV1_(String(x.configStatus || cfg.status || "UNKNOWN")) : String(x.configStatus || cfg.status || "UNKNOWN")),
    "Ảnh: Có " + (Number(img.ok || 0) + Number(img.present || 0)) + " | Đang xử lý " + Number(img.pending || 0) + " | Thiếu " + Number(img.missing || 0) + " | Lỗi " + Number(img.error || 0) + " | Hỏng " + Number(img.broken || 0),
    "Cấu trúc file: " + (typeof tgViStatusWordV1_ === "function" ? tgViStatusWordV1_(String(structure.status || x.structureStatus || "CHƯA CÓ")) : String(structure.status || x.structureStatus || "CHƯA CÓ")),
    "Chụp lịch: " + (typeof tgViStatusWordV1_ === "function" ? tgViStatusWordV1_(String(schedule.status || "CHƯA CÓ")) : String(schedule.status || "CHƯA CÓ"))
  ];

  if (x.warnings && x.warnings.length) lines.push("Cảnh báo: " + (typeof tgViWarnListV1_ === "function" ? tgViWarnListV1_(x.warnings) : x.warnings.join(", ")));
  else lines.push("Nguồn này không có cảnh báo.");

  if (structure && structure.issues && structure.issues.length) {
    lines.push("Cấu trúc file cần xem:");
    structure.issues.slice(0,5).forEach(function(issue){
      lines.push("• " + (typeof tgViWordV1_ === "function" ? tgViWordV1_(issue.code) : issue.code) + " — " + (typeof tgViWordV1_ === "function" ? tgViWordV1_(opsCompactTextV312_(issue.message,150)) : opsCompactTextV312_(issue.message,150)));
    });
    var cur = structure.current || {};
    var base = structure.baseline || {};
    if (Number(base.villaCount || 0) || Number(cur.villaCount || 0)) {
      lines.push("Trước đây/Hiện tại: " + Number(base.villaCount || 0) + " → " + Number(cur.villaCount || 0) + " căn");
    }
    if (Number(cur.configuredNameRow || 0) && Number(cur.autoNameRow || 0) && Number(cur.configuredNameRow) !== Number(cur.autoNameRow)) {
      lines.push("Hàng tên CONFIG/AUTO: " + Number(cur.configuredNameRow) + " → " + Number(cur.autoNameRow));
    }
  }

  if (cfg && cfg.success && cfg.issues && cfg.issues.length) {
    lines.push("Lỗi cách đọc file (CONFIG):");
    cfg.issues.slice(0,5).forEach(function(issue){
      lines.push("• " + issue.block + "/" + issue.code + " — " + opsCompactTextV312_(issue.message,120));
    });
  }

  if (imgReport && imgReport.success && imgReport.issues && imgReport.issues.length) {
    lines.push("Ảnh cần xem:");
    imgReport.issues.slice(0,5).forEach(function(issue){
      lines.push("• " + (issue.sku || issue.name) + " — " + (typeof tgViWordV1_ === "function" ? tgViWordV1_(issue.status) : issue.status) + " — " + (typeof tgViWordV1_ === "function" ? tgViWordV1_(opsCompactTextV312_(issue.reason,100)) : opsCompactTextV312_(issue.reason,100)));
    });
  }

  return lines.join("\n");
}

function tgStatusEmojiV320_(status) {
  status = String(status || "").toUpperCase();
  return status === "OK" ? "🟢" : status === "ERROR" ? "🔴" : "🟠";
}

function tgFormatNguonHomeV320_() {
  var health = getSourceHealthV312();
  var groups = {};
  (health.sources || []).forEach(function(s){
    var city = String(s.city || "Khu vực khác").trim() || "Khu vực khác";
    var key = typeof ceNormalizeCityFilter_ === "function" ? ceNormalizeCityFilter_(city) : opsNormV312_(city);
    if (!groups[key]) groups[key] = {label:city,sources:0,villas:0,ok:0,warning:0,error:0};
    var g=groups[key]; g.sources++; g.villas+=Number(s.villas||0);
    if(s.status==="OK")g.ok++; else if(s.status==="ERROR")g.error++; else g.warning++;
  });
  var lines=["🏠 EHOME · NGUỒN THEO KHU VỰC"];
  Object.keys(groups).sort().forEach(function(k){var g=groups[k];lines.push("• "+g.label+" — "+g.sources+" nguồn · "+g.villas+" căn · ✅"+g.ok+" ⚠️"+g.warning+" 🔴"+g.error);});
  lines.push("", "Gõ: /nguon vung tau · /nguon da lat · /nguon loi");
  return lines.join("\n");
}

function tgFormatNguonListV320_(sources,title) {
  sources = sources || [];
  var villas = sources.reduce(function(sum,s){return sum+Number(s.villas||0);},0);
  var ok=sources.filter(function(s){return s.status==="OK";}).length;
  var warning=sources.filter(function(s){return s.status==="WARNING";}).length;
  var error=sources.filter(function(s){return s.status==="ERROR";}).length;
  var lines=[title, sources.length+" nguồn · "+villas+" căn · ✅"+ok+" ⚠️"+warning+" 🔴"+error, ""];
  sources.forEach(function(s,index){
    var extra=[];
    if(s.structureStatus==="ERROR"||s.structureStatus==="WARNING")extra.push(s.structureStatus==="ERROR"?"lỗi cấu trúc file":"cấu trúc file cần xem");
    if(s.configStatus==="ERROR")extra.push("lỗi cách đọc file");
    else if(s.configStatus==="WARNING"&&s.masterPending!==true)extra.push("cảnh báo cách đọc file");
    if(s.masterPending===true)extra.push("MASTER CHỜ "+Number(s.detectedVillas||0));
    if((s.duplicateSources||[]).length)extra.push("TRÙNG "+(s.duplicateSources||[]).map(function(x){return String(x.source||"");}).slice(0,2).join(","));
    if(s.image && (Number(s.image.missing||0)+Number(s.image.error||0)+Number(s.image.broken||0)>0))extra.push("ẢNH "+(Number(s.image.missing||0)+Number(s.image.error||0)+Number(s.image.broken||0)));
    lines.push((index+1)+". "+tgStatusEmojiV320_(s.status)+" "+String(s.source||"")+" — "+Number(s.villas||0)+" căn"+(extra.length?" · "+extra.join(" · "):""));
  });
  lines.push("", "Chi tiết: /nguon <tên nguồn>");
  return lines.join("\n");
}

function tgHandleNguonV320_(arg) {
  var wanted = opsNormV312_(arg || "");
  if (!wanted) return tgFormatNguonHomeV320_();
  var health = getSourceHealthV312();
  var list = health.sources || [];

  if (wanted === "loi" || wanted === "error") {
    return tgFormatNguonListV320_(list.filter(function(s){return s.status==="ERROR";}),"🔴 NGUỒN LỖI");
  }
  if (wanted === "canhbao" || wanted === "canh bao" || wanted === "warning" || wanted === "warn") {
    return tgFormatNguonListV320_(list.filter(function(s){return s.status==="WARNING";}),"🟠 NGUỒN CẢNH BÁO");
  }

  var cityWanted = typeof ceNormalizeCityFilter_ === "function" ? ceNormalizeCityFilter_(arg) : wanted;
  if (cityWanted === "vung tau" || cityWanted === "da lat" || cityWanted === "__other__") {
    var filtered = list.filter(function(s){
      return typeof ceCityMatchesFilterV23_ === "function"
        ? ceCityMatchesFilterV23_(s.city,cityWanted)
        : opsNormV312_(s.city) === wanted;
    });
    var label = cityWanted === "vung tau" ? "🏖 VŨNG TÀU" : cityWanted === "da lat" ? "🌲 ĐÀ LẠT" : "📍 KHU VỰC KHÁC";
    return tgFormatNguonListV320_(filtered,label);
  }

  return tgFormatSourceConsoleV315_(tgBuildSourceConsoleV315_(arg));
}

function tgFormatEventsV31_(events) {
  events = Array.isArray(events) ? events : [];
  if (!events.length) return "📋 Chưa có SYSTEM_EVENT_LOG_V3.";
  return "📋 EVENT GẦN NHẤT\n" + events.slice(0,10).map(function(e){
    return "• [" + String(e.level || "") + "] " + String(e.type || "") + (e.message ? " — " + e.message : "");
  }).join("\n");
}

/** Alias cũ để các test/helper ngoài file không vỡ. */
function tgFormatOneSourceV312_(r) {
  if (!r || !r.success) return "❌ SOURCE_NOT_FOUND";
  return tgFormatSourceConsoleV315_(tgBuildSourceConsoleV315_(r.source && r.source.source || ""));
}

function testTelegramImageV311() {
  var chatId = tgPropertyV315_("TELEGRAM_ADMIN_CHAT_ID");
  if (!chatId) throw new Error("Chưa có TELEGRAM_ADMIN_CHAT_ID.");
  var result = sendTelegramMessageV31_(chatId,tgFormatImageV315_(getImageAuditSummaryV30()));
  Logger.log(JSON.stringify({code:"TELEGRAM_IMAGE_TEST_V315",result:result}));
  return result;
}

function testTelegramEventsV311() {
  var chatId = tgPropertyV315_("TELEGRAM_ADMIN_CHAT_ID");
  if (!chatId) throw new Error("Chưa có TELEGRAM_ADMIN_CHAT_ID.");
  var result = sendTelegramMessageV31_(chatId,tgFormatEventsV31_(getRecentSystemEventsV30(10)));
  Logger.log(JSON.stringify({code:"TELEGRAM_EVENTS_TEST_V315",result:result}));
  return result;
}


/** V3.2.9 formatter self-test, không gửi Telegram. */
function testTelegramReportV329_(){
  var img=tgImageSummaryV329_({total:100,present:60,ok:5,pending:10,missing:15,error:8,broken:2});
  if(img.have!==65||img.issue!==25)throw new Error("V329 FAIL image summary: "+JSON.stringify(img));
  var impact=tgConfigImpactV329_({sources:[
    {status:"OK",masterVillaCount:50},{status:"WARNING",masterVillaCount:20},{status:"ERROR",masterVillaCount:30}
  ]});
  if(impact.okVillas!==50||impact.warningVillas!==20||impact.errorVillas!==30)throw new Error("V329 FAIL config impact: "+JSON.stringify(impact));
  var chunks=tgSplitReplyV329_(Array(200).fill("nguồn test").join("\n"),500);
  if(chunks.length<2||chunks.some(function(x){return x.length>500;}))throw new Error("V329 FAIL telegram split");
  var result={success:true,version:"3.2.9-clear-report",imagePass:true,configImpactPass:true,splitPass:true};
  Logger.log(JSON.stringify({code:"TELEGRAM_REPORT_PASS_V329",result:result}));
  return result;
}
function testTelegramReportV329() {
  return testTelegramReportV329_();
}
function testTelegramUxV4222(){
  var help=tgHelpV315_();
  if(help.length>420)throw new Error("TELEGRAM_HELP_TOO_LONG_V4222");
  var rows=tgMainMenuRowsV4221_(),callbacks=[];
  rows.forEach(function(row){row.forEach(function(btn){callbacks.push(String(btn.callback_data||""));});});
  ["M:HEALTH","M:SRCERR","M:AIBRAIN","M:AIUSAGE"].forEach(function(x){if(callbacks.indexOf(x)<0)throw new Error("TELEGRAM_V4222_BUTTON_MISSING: "+x);});
  var result={success:true,version:"4.22.2",helpChars:help.length,menuButtons:callbacks.length,brain:callbacks.indexOf("M:AIBRAIN")>=0};
  Logger.log(JSON.stringify({code:"TELEGRAM_UX_PASS_V4222",result:result}));
  return result;
}

function testTelegramButtonsV4222(){
  var rows=tgMainMenuRowsV4221_(),callbacks=[];
  rows.forEach(function(row){row.forEach(function(btn){callbacks.push(String(btn.callback_data||""));});});
  var proposal="AICFG-20260924-001500-ABCDEFGH";
  tgAiProposalRowsV4221_(proposal,"153","READY_FOR_APPROVAL",3).forEach(function(row){row.forEach(function(btn){callbacks.push(String(btn.callback_data||""));});});
  var tooLong=callbacks.filter(function(x){return Utilities.newBlob(x).getBytes().length>64;});
  if(tooLong.length)throw new Error("TELEGRAM_CALLBACK_TOO_LONG_V4222: "+tooLong.join(","));
  ["M:HEALTH","M:SRCERR","M:AIBRAIN","AC:"+proposal,"AV:"+proposal,"AX:"+proposal].forEach(function(x){if(callbacks.indexOf(x)<0)throw new Error("TELEGRAM_BUTTON_MISSING_V4222: "+x);});
  var result={success:true,version:"4.22.2",buttons:callbacks.length,maxCallbackBytes:Math.max.apply(null,callbacks.map(function(x){return Utilities.newBlob(x).getBytes().length;})),helpChars:tgHelpV315_().length};
  Logger.log(JSON.stringify({code:"TELEGRAM_BUTTONS_PASS_V4222",result:result}));
  return result;
}
