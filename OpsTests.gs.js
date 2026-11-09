/** 29_OpsTests.gs - smoke tests for V3.1.2 FULL OPS. */
function testFullOpsV312() {
  var result = {
    version:EHOME_OPS_V312.VERSION,
    health:getSystemHealthV30(),
    imageSummary:getImageAuditSummaryV30(),
    config:getConfigHealthV312(),
    sources:getSourceHealthV312(),
    events:getRecentSystemEventsV30(5)
  };
  Logger.log(JSON.stringify({code:"FULL_OPS_TEST_PASS_V312",result:{version:result.version,config:{total:result.config.total,ok:result.config.ok,warning:result.config.warning,error:result.config.error},sources:{total:result.sources.total,ok:result.sources.ok,warning:result.sources.warning,error:result.sources.error}}}));
  return result;
}

function testTelegramOpsV312() {
  var chatId = aiGetPropertyV31_("TELEGRAM_ADMIN_CHAT_ID");
  if (!chatId) throw new Error("Chưa có TELEGRAM_ADMIN_CHAT_ID.");
  var text = tgHandleCommandV31_("/help");
  var result = sendTelegramMessageV31_(chatId,text);
  Logger.log(JSON.stringify({code:"TELEGRAM_OPS_TEST_V312",result:result}));
  return result;
}


function testSourceHealthV313(){
  var src=opsListMasterSourcesV312_(true).sources||[];
  var h=getSourceHealthV312();
  var unresolved=(h.sources||[]).filter(function(x){return (x.warnings||[]).indexOf("SOURCE_LINK_UNRESOLVED")>=0;});
  var zero=(h.sources||[]).filter(function(x){return (x.warnings||[]).indexOf("SOURCE_ZERO_VILLAS")>=0;});
  var result={
    version:EHOME_OPS_V312.VERSION,
    masterSources:src.length,
    sourceLinksResolved:src.filter(function(x){return !!x.link;}).length,
    sourceLinksUnresolved:src.filter(function(x){return !x.link;}).length,
    health:{total:h.total,ok:h.ok,warning:h.warning,error:h.error},
    unresolvedSamples:unresolved.slice(0,5).map(function(x){return {source:x.source,villas:x.villas,warnings:x.warnings};}),
    zeroVillaSamples:zero.slice(0,5).map(function(x){return {source:x.source,warnings:x.warnings};})
  };
  Logger.log(JSON.stringify({code:"SOURCE_HEALTH_TEST_V313",result:result}));
  return result;
}

function testHealthWatchAntiSpamV314(){
  var a=opsHealthBuildSignalV314_(),b=opsHealthBuildSignalV314_();
  var status=getAiHealthWatchStatusV31();
  var result={version:EHOME_HEALTH_WATCH_V314.VERSION,sameFingerprint:a.fingerprint===b.fingerprint,severity:a.severity,issueCount:a.issues.length,triggerCount:status.triggerCount,legacyTriggerCount:status.legacyTriggerCount};
  if(!result.sameFingerprint)throw new Error("ANTI_SPAM_FINGERPRINT_UNSTABLE");
  Logger.log(JSON.stringify({code:"HEALTH_WATCH_ANTI_SPAM_TEST_PASS_V314",result:result}));
  return result;
}
