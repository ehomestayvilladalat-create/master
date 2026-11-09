/**
 * 23_AiHealthWatch.gs - EHOME V3.1.5 OPS LITE ALERT
 * Không gọi OpenAI.
 * Chỉ gửi khi có issue MỚI thật sự, severity tăng, hoặc full recovery.
 * Alert không lặp lại toàn bộ IMAGE MISSING cũ ở mọi thay đổi khác.
 */

var EHOME_HEALTH_WATCH_V314 = {
  VERSION: "3.4.0-health-buttons-v4221",
  FP_PROP: "EHOME_OPS_ALERT_FINGERPRINT_V314",
  STATE_PROP: "EHOME_OPS_ALERT_STATE_V314",
  LAST_SENT_PROP: "EHOME_OPS_ALERT_LAST_SENT_V314",
  ENABLED_PROP: "EHOME_OPS_ALERTS_ENABLED_V314",
  HANDLER: "runAiHealthWatchV31"
};

function opsHealthNormalizeIssueV314_(text) {
  text = String(text || "").trim().toUpperCase();
  // IMAGE_ISSUES_9 -> IMAGE_ISSUES để biến động số lượng nhỏ không spam.
  return text.replace(/IMAGE_ISSUES_\d+/g, "IMAGE_ISSUES");
}

function opsHealthBuildSignalV314_() {
  var health = getSystemHealthV30();
  var config = {total:0,ok:0,warning:0,error:0,sources:[]};
  var sources = {total:0,ok:0,warning:0,error:0,sources:[]};

  try { config = getConfigHealthV312(); } catch (ignore) {}
  try { sources = getSourceHealthV312(); } catch (ignore2) {}

  var issues = [];

  (health.warnings || []).forEach(function(w){
    issues.push("SYSTEM:" + opsHealthNormalizeIssueV314_(w));
  });

  var autoSync = health.autoSync || {};
  if (autoSync.triggerCount !== undefined && Number(autoSync.triggerCount) !== 1) {
    issues.push("AUTOSYNC:TRIGGER_COUNT_NOT_1");
  }

  var img = health.imageAudit || {};
  if (Number(img.missing || 0) > 0) issues.push("IMAGE:MISSING");
  if (Number(img.error || 0) > 0) issues.push("IMAGE:ERROR");
  if (Number(img.broken || 0) > 0) issues.push("IMAGE:BROKEN");

  (config.sources || []).forEach(function(s){
    (s.issues || []).forEach(function(i){
      var level = String(i.level || "").toUpperCase();
      if (level !== "ERROR" && level !== "WARNING") return;
      issues.push(
        "CONFIG:" + opsHealthNormalizeIssueV314_(s.source) +
        ":" + level +
        ":" + opsHealthNormalizeIssueV314_(i.code)
      );
    });
  });

  // Gom NO_ACCESS sources thành 1 issue (không per-source)
  var noAccessCount = 0;
  (sources.sources || []).forEach(function(s){
    if (s.status === "NO_ACCESS") {
      noAccessCount++;
    } else if (s.status === "ERROR") {
      issues.push("SOURCE:" + opsHealthNormalizeIssueV314_(s.source) + ":ERROR");
    } else if (s.status === "WARNING") {
      (s.warnings || []).forEach(function(w){
        issues.push(
          "SOURCE:" + opsHealthNormalizeIssueV314_(s.source) +
          ":WARNING:" + opsHealthNormalizeIssueV314_(w)
        );
      });
    }
  });

  if (noAccessCount > 0) {
    issues.push("NO_ACCESS_SOURCES:" + noAccessCount);
  }

  var seen = {};
  issues = issues.filter(function(x){
    if (seen[x]) return false;
    seen[x] = true;
    return true;
  }).sort();

  var severity = Number(config.error || 0) > 0 || Number(sources.error || 0) > 0
    ? "ERROR"
    : (issues.length ? "WARNING" : "OK");

  var payload = {severity:severity,issues:issues};
  var fingerprint = Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      JSON.stringify(payload)
    )
  );

  return {
    health:health,
    config:config,
    sources:sources,
    severity:severity,
    issues:issues,
    fingerprint:fingerprint
  };
}

function opsHealthParseStateV314_(raw) {
  try { return raw ? JSON.parse(raw) : null; }
  catch (ignore) { return null; }
}

function opsHealthSeverityRankV314_(s) {
  return s === "ERROR" ? 2 : (s === "WARNING" ? 1 : 0);
}

function opsHealthMeaningfulChangeV314_(oldState, current) {
  if (!oldState) return {send:false,reason:"BASELINE_CREATED",added:[]};

  if (String(oldState.fingerprint || "") === current.fingerprint) {
    return {send:false,reason:"SAME_ISSUES",added:[]};
  }

  var oldIssues = oldState.issues || [];
  var newIssues = current.issues || [];
  var oldMap = {};
  oldIssues.forEach(function(x){ oldMap[x] = true; });

  var added = newIssues.filter(function(x){ return !oldMap[x]; });

  if (newIssues.length === 0 && oldIssues.length > 0) {
    return {send:true,reason:"FULL_RECOVERY",added:[]};
  }

  if (opsHealthSeverityRankV314_(current.severity) > opsHealthSeverityRankV314_(oldState.severity)) {
    return {send:true,reason:"SEVERITY_INCREASED",added:added};
  }

  if (added.length > 0) {
    return {send:true,reason:"NEW_ISSUE",added:added};
  }

  return {
    send:false,
    reason:"PARTIAL_IMPROVEMENT_OR_NON_ACTIONABLE_CHANGE",
    added:[]
  };
}

function opsHealthStateV315_(current) {
  return {
    version:EHOME_HEALTH_WATCH_V314.VERSION,
    severity:current.severity,
    issues:current.issues,
    fingerprint:current.fingerprint,
    checkedAt:new Date().toISOString()
  };
}

function opsHealthSaveStateV315_(props, current) {
  var state = opsHealthStateV315_(current);
  props.setProperty(EHOME_HEALTH_WATCH_V314.FP_PROP,current.fingerprint);
  props.setProperty(EHOME_HEALTH_WATCH_V314.STATE_PROP,JSON.stringify(state));
  return state;
}

function opsHealthAlertTextV315_(decision, current) {
  if (decision.reason === "FULL_RECOVERY") {
    return [
      "🟢 EHOME OPS đã ổn trở lại",
      "Không còn issue trong Health Watch.",
      "Dùng /health để kiểm tra tổng thể."
    ].join("\n");
  }

  // Kiểm tra NO_ACCESS_SOURCES issue
  var noAccessMatch = null;
  var noAccessCount = 0;
  (current.issues || []).forEach(function(issue) {
    var m = String(issue || "").match(/^NO_ACCESS_SOURCES:(\d+)$/);
    if (m && m[1]) {
      noAccessMatch = m;
      noAccessCount = Number(m[1]);
    }
  });

  if (noAccessMatch && noAccessCount > 0) {
    // Telegram NO_ACCESS tổng hợp
    var scannedTotal = 0;
    try {
      var sources = current.sources && current.sources.sources || [];
      scannedTotal = sources.length;
    } catch (ignore) {}

    var lines = [
      "⚠️ EHOME OPS — Đồng bộ lịch",
      "Đã quét: " + scannedTotal + " nguồn",
      "Bỏ qua do thiếu quyền: " + noAccessCount + " nguồn",
      "Xem danh sách: Tab NO_ACCESS_SOURCES trong MASTER sheet"
    ];
    return lines.join("\n");
  }

  try { if (typeof tgViAlertTextV1_ === "function") { var viTextV1 = tgViAlertTextV1_(decision, current); if (viTextV1) return viTextV1; } } catch (eViAlertV1) { Logger.log("[TelegramVietnamese] " + eViAlertV1); }
  var added = (decision.added || []).slice(0,8);
  var lines = [
    "⚠️ EHOME OPS: lỗi mới",
    "Severity: " + String(current.severity || "WARNING")
  ];

  if (added.length) {
    lines.push("Mới phát hiện:");
    added.forEach(function(issue){ lines.push("• " + issue); });
  } else {
    lines.push("Mức độ lỗi vừa tăng lên " + String(current.severity || "ERROR") + ".");
  }

  lines.push("Dùng /health hoặc /source <nguồn> để xem chi tiết.");
  return lines.join("\n");
}

/** V4.22.1 - Alert có nút AI, nhưng Health Watch KHÔNG tự gọi OpenAI. */
function opsHealthAlertKeyboardV4221_(decision,current) {
  current=current||{};
  decision=decision||{};
  var added=decision.added||[];
  var sourceHealth=current.sources&&current.sources.sources||[];
  var selected=[];
  sourceHealth.forEach(function(s){
    if(!s||!s.id||s.status==="OK")return;
    var normalized=opsHealthNormalizeIssueV314_(s.source);
    var hit=added.some(function(issue){
      issue=String(issue||"");
      return issue.indexOf("SOURCE:"+normalized+":")===0||issue.indexOf("CONFIG:"+normalized+":")===0;
    });
    if(hit)selected.push(s);
  });
  if(!selected.length&&decision.reason==="SEVERITY_INCREASED"){
    selected=sourceHealth.filter(function(s){return s&&s.id&&s.status!=="OK";}).slice(0,5);
  }
  var seen={},rows=[];
  selected.slice(0,5).forEach(function(s){
    var id=String(s.id||"").trim();
    if(!id||seen[id])return;seen[id]=true;
    var label=typeof tgShortButtonTextV4221_==="function"?tgShortButtonTextV4221_(s.source,24):String(s.source||"").slice(0,24);
    rows.push([
      {text:"🤖 AI soi "+label,callback_data:"AI:"+id},
      {text:"🔎 Nguồn",callback_data:"S:"+id}
    ]);
  });
  rows.push([
    {text:"🏥 Health",callback_data:"M:HEALTH"},
    {text:"🏠 Menu",callback_data:"M:HOME"}
  ]);
  return rows;
}

function testHealthWatchButtonsV4221(){
  var fake={sources:{sources:[{id:"153",source:"1am travel",status:"ERROR"},{id:"25",source:"MINH TRUNG",status:"OK"}]}};
  var rows=opsHealthAlertKeyboardV4221_({reason:"NEW_ISSUE",added:["SOURCE:1AM TRAVEL:ERROR"]},fake);
  var flat=[];rows.forEach(function(row){row.forEach(function(btn){flat.push(String(btn.callback_data||""));});});
  if(flat.indexOf("AI:153")<0||flat.indexOf("S:153")<0||flat.indexOf("M:HEALTH")<0)throw new Error("HEALTH_BUTTONS_FAILED_V4221");
  var result={success:true,version:"4.22.1",callbacks:flat};
  Logger.log(JSON.stringify({code:"HEALTH_BUTTONS_PASS_V4221",result:result}));
  return result;
}

function runAiHealthWatchV31() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    Logger.log(JSON.stringify({code:"OPS_HEALTH_WATCH_SKIPPED_V315",reason:"LOCK_BUSY"}));
    return {success:true,skipped:true,reason:"LOCK_BUSY"};
  }

  try {
    var props = PropertiesService.getScriptProperties();
    if (String(props.getProperty(EHOME_HEALTH_WATCH_V314.ENABLED_PROP) || "1") === "0") {
      Logger.log(JSON.stringify({code:"OPS_HEALTH_WATCH_SKIPPED_V315",reason:"PAUSED"}));
      return {success:true,skipped:true,reason:"PAUSED"};
    }

    var current = opsHealthBuildSignalV314_();
    var oldState = opsHealthParseStateV314_(
      props.getProperty(EHOME_HEALTH_WATCH_V314.STATE_PROP)
    );
    var decision = opsHealthMeaningfulChangeV314_(oldState,current);

    var sent = false;
    var sendResult = null;

    if (decision.send) {
      var chatId = typeof tgPropertyV315_ === "function"
        ? tgPropertyV315_("TELEGRAM_ADMIN_CHAT_ID")
        : String(props.getProperty("TELEGRAM_ADMIN_CHAT_ID") || "").trim();

      if (!chatId) {
        Logger.log(JSON.stringify({
          code:"OPS_HEALTH_WATCH_V315",
          decision:decision.reason,
          sent:false,
          reason:"ADMIN_CHAT_ID_NOT_SET"
        }));
        return {
          success:false,
          error:"TELEGRAM_ADMIN_CHAT_ID_NOT_SET",
          decision:decision.reason,
          sent:false
        };
      }

      var alertTextV4221 = opsHealthAlertTextV315_(decision,current);
      var alertKeyboardV4221 = opsHealthAlertKeyboardV4221_(decision,current);
      sendResult = typeof sendTelegramMessageWithKeyboardV4221_ === "function"
        ? sendTelegramMessageWithKeyboardV4221_(chatId,alertTextV4221,alertKeyboardV4221)
        : sendTelegramMessageV31_(chatId,alertTextV4221);
      sent = !!(sendResult && sendResult.success);

      // Quan trọng V3.1.5: chỉ commit state sau khi alert gửi thành công.
      // Nếu Telegram lỗi, lần sau vẫn retry đúng alert đó thay vì nuốt mất.
      if (sent) {
        opsHealthSaveStateV315_(props,current);
        props.setProperty(
          EHOME_HEALTH_WATCH_V314.LAST_SENT_PROP,
          new Date().toISOString()
        );
      }
    } else {
      // Baseline/same issue/partial improvement đều cập nhật state, không gửi.
      opsHealthSaveStateV315_(props,current);
    }

    Logger.log(JSON.stringify({
      code:"OPS_HEALTH_WATCH_V315",
      version:EHOME_HEALTH_WATCH_V314.VERSION,
      severity:current.severity,
      issueCount:current.issues.length,
      decision:decision.reason,
      sent:sent,
      addedCount:(decision.added || []).length
    }));

    return {
      success:decision.send ? sent : true,
      version:EHOME_HEALTH_WATCH_V314.VERSION,
      severity:current.severity,
      issueCount:current.issues.length,
      decision:decision.reason,
      sent:sent,
      sendResult:sendResult
    };
  } finally {
    lock.releaseLock();
  }
}

function installAiHealthWatchV31() {
  var handlers = ["runAiHealthWatchV31","runAiHealthWatchV30","runOpsHealthWatchV31"];
  var removed = 0;

  ScriptApp.getProjectTriggers().forEach(function(t){
    if (handlers.indexOf(t.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });

  ScriptApp.newTrigger(EHOME_HEALTH_WATCH_V314.HANDLER)
    .timeBased()
    .everyHours(1)
    .create();

  Logger.log(JSON.stringify({
    code:"OPS_HEALTH_WATCH_INSTALLED_V315",
    removedOldTriggers:removed,
    everyHours:1
  }));

  return getAiHealthWatchStatusV31();
}

function getAiHealthWatchStatusV31() {
  var all = ScriptApp.getProjectTriggers();
  var current = all.filter(function(t){
    return t.getHandlerFunction() === EHOME_HEALTH_WATCH_V314.HANDLER;
  }).length;
  var legacy = all.filter(function(t){
    return ["runAiHealthWatchV30","runOpsHealthWatchV31"].indexOf(t.getHandlerFunction()) >= 0;
  }).length;
  var props = PropertiesService.getScriptProperties();

  var result = {
    installed:current === 1,
    triggerCount:current,
    legacyTriggerCount:legacy,
    everyHours:1,
    paused:String(props.getProperty(EHOME_HEALTH_WATCH_V314.ENABLED_PROP) || "1") === "0",
    lastSent:props.getProperty(EHOME_HEALTH_WATCH_V314.LAST_SENT_PROP) || ""
  };

  Logger.log(JSON.stringify({code:"OPS_HEALTH_WATCH_STATUS_V315",result:result}));
  return result;
}

function removeAiHealthWatchV31() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(t){
    if (["runAiHealthWatchV31","runAiHealthWatchV30","runOpsHealthWatchV31"].indexOf(t.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  Logger.log(JSON.stringify({code:"OPS_HEALTH_WATCH_REMOVED_V315",removed:removed}));
  return {success:true,removed:removed};
}

function resetAiHealthWatchBaselineV314() {
  var props = PropertiesService.getScriptProperties();
  var current = opsHealthBuildSignalV314_();
  opsHealthSaveStateV315_(props,current);
  Logger.log(JSON.stringify({
    code:"OPS_HEALTH_BASELINE_RESET_V315",
    severity:current.severity,
    issueCount:current.issues.length
  }));
  return {success:true,severity:current.severity,issueCount:current.issues.length};
}

function resetAiHealthWatchBaselineV315() {
  return resetAiHealthWatchBaselineV314();
}

function pauseAiHealthWatchV314() {
  PropertiesService.getScriptProperties().setProperty(EHOME_HEALTH_WATCH_V314.ENABLED_PROP,"0");
  return getAiHealthWatchStatusV31();
}

function resumeAiHealthWatchV314() {
  PropertiesService.getScriptProperties().setProperty(EHOME_HEALTH_WATCH_V314.ENABLED_PROP,"1");
  resetAiHealthWatchBaselineV314();
  return getAiHealthWatchStatusV31();
}

function testHealthWatchV315() {
  var a = opsHealthBuildSignalV314_();
  var b = opsHealthBuildSignalV314_();
  if (a.fingerprint !== b.fingerprint) {
    throw new Error("HEALTH_FINGERPRINT_UNSTABLE_V315");
  }
  Logger.log(JSON.stringify({
    code:"HEALTH_WATCH_TEST_PASS_V315",
    severity:a.severity,
    issueCount:a.issues.length,
    sameFingerprint:true
  }));
  return {success:true,severity:a.severity,issueCount:a.issues.length,sameFingerprint:true};
}
