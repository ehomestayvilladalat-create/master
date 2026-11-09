/** 19_HealthMonitor.gs - V3.0 basic health summary, future Telegram/AI tool */

function getSystemHealthV30() {
  var autoSync = typeof getEhomeAutoSyncStatus === "function" ? getEhomeAutoSyncStatus() : {};
  var image = typeof getImageAuditSummaryV30 === "function" ? getImageAuditSummaryV30() : {exists:false};
  var masterCount = 0;
  try { masterCount = ceReadMasterVillas_().length; } catch (ignore) {}
  var snapshot = null;
  try { if (typeof getSnapshotStatusV320 === "function") snapshot = getSnapshotStatusV320(); } catch (ignoreSnapshot) {}

  var health = {
    version:String(BE_CONFIG.VERSION || ""),
    masterVillas:masterCount,
    autoSync:autoSync,
    imageAudit:image,
    snapshot:snapshot,
    status:"OK",
    warnings:[]
  };

  if (autoSync && autoSync.triggerCount !== undefined && Number(autoSync.triggerCount) !== 1) {
    health.warnings.push("AUTO_SYNC_TRIGGER_COUNT_" + Number(autoSync.triggerCount || 0));
  }
  if (image && image.exists && (Number(image.missing||0) > 0 || Number(image.error||0) > 0 || Number(image.broken||0) > 0)) {
    health.warnings.push("IMAGE_COVERAGE_NOT_FULL");
  }
  if (snapshot) {
    if (Number(snapshot.triggerCount || 0) !== 1) health.warnings.push("SNAPSHOT_TRIGGER_COUNT_" + Number(snapshot.triggerCount || 0));
    if (snapshot.structure && Number(snapshot.structure.error || 0) > 0) health.warnings.push("STRUCTURE_SNAPSHOT_ERRORS_" + Number(snapshot.structure.error || 0));
  }
  if (health.warnings.length) health.status = "WARNING";
  return health;
}

function testSystemHealthV30() {
  var result = getSystemHealthV30();
  Logger.log(JSON.stringify({code:"SYSTEM_HEALTH_V30",result:result}));
  return result;
}
