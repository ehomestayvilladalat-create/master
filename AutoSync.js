/**
 * EHOME - SAFE AUTO SYNC V3.2.8
 * Chỉ đồng bộ nguồn mới / CONFIG đổi / nguồn 0 MASTER theo incremental engine.
 * KHÔNG gọi buildMasterVilla() full mỗi 6 giờ nữa.
 */

var EHOME_AUTO_SYNC_CONFIG = {
  HANDLER: "ehomeAutoSyncMaster_",
  EVERY_HOURS: 6,
  LOCK_WAIT_MS: 1000,
  LAST_SYNC_PROPERTY: "EHOME_MASTER_LAST_AUTO_SYNC",
  LEGACY_HANDLERS: ["autoSyncMasterVillaV40_"]
};

/** Chạy bởi trigger. Giữ nguyên handler cũ để KHÔNG phải cài lại trigger. */
function ehomeAutoSyncMaster_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(EHOME_AUTO_SYNC_CONFIG.LOCK_WAIT_MS)) {
    Logger.log(JSON.stringify({
      code: "EHOME_AUTO_SYNC_SKIPPED_LOCKED_V328"
    }));
    return {
      success: false,
      skipped: true,
      reason: "LOCKED"
    };
  }

  try {
    if (typeof syncMasterIncrementalCoreV328_ !== "function") {
      throw new Error("Không tìm thấy syncMasterIncrementalCoreV328_() trong 09_Admin.gs V3.2.8.");
    }

    var startedAt = new Date();
    var result = syncMasterIncrementalCoreV328_({
      reason: "AUTO_SYNC_6H",
      maxSources: 10,
      maxRuntimeMs: 220000
    });
    var finishedAt = new Date();

    PropertiesService.getScriptProperties().setProperty(
      EHOME_AUTO_SYNC_CONFIG.LAST_SYNC_PROPERTY,
      finishedAt.toISOString()
    );

    Logger.log(JSON.stringify({
      code: "EHOME_AUTO_SYNC_DONE_V328",
      mode: "INCREMENTAL",
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      elapsedMs: finishedAt.getTime() - startedAt.getTime(),
      result: result
    }));

    return {
      success: true,
      mode: "INCREMENTAL_V328",
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      elapsedMs: finishedAt.getTime() - startedAt.getTime(),
      result: result
    };
  } catch (error) {
    Logger.log(JSON.stringify({
      code: "EHOME_AUTO_SYNC_FAILED_V328",
      error: String(error && error.message ? error.message : error)
    }));
    throw error;
  } finally {
    lock.releaseLock();
  }
}

/** Cài trigger 6 giờ/lần. Chỉ cần chạy nếu status báo thiếu trigger. */
function installEhomeAutoSyncTrigger() {
  var cleanup = cleanupLegacyAutoSyncTriggers();
  removeEhomeAutoSyncTrigger();

  var hours = Number(EHOME_AUTO_SYNC_CONFIG.EVERY_HOURS || 6);
  var allowed = [1, 2, 4, 6, 8, 12];
  if (allowed.indexOf(hours) < 0) hours = 6;

  var trigger = ScriptApp.newTrigger(EHOME_AUTO_SYNC_CONFIG.HANDLER)
    .timeBased()
    .everyHours(hours)
    .create();

  Logger.log(JSON.stringify({
    code: "EHOME_AUTO_SYNC_INSTALLED_V328",
    everyHours: hours,
    triggerId: trigger.getUniqueId()
  }));

  var status = getEhomeAutoSyncStatus();
  status.legacyRemoved = cleanup.removed;
  return status;
}

/**
 * Xóa trigger auto-sync legacy còn sót từ MasterEngine V4.
 * V3.2.8 tuyệt đối chỉ để 11_AutoSync.gs sở hữu auto-sync.
 */
function cleanupLegacyAutoSyncTriggers() {
  var legacyHandlers = EHOME_AUTO_SYNC_CONFIG.LEGACY_HANDLERS || [];
  var removed = 0;
  var removedHandlers = [];

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();
    if (legacyHandlers.indexOf(handler) >= 0) {
      ScriptApp.deleteTrigger(trigger);
      removed++;
      removedHandlers.push(handler);
    }
  });

  Logger.log(JSON.stringify({
    code: "EHOME_AUTO_SYNC_LEGACY_CLEANED",
    removed: removed,
    handlers: removedHandlers
  }));

  return {
    success: true,
    removed: removed,
    handlers: removedHandlers
  };
}

/** Xóa trigger tự đồng bộ do file này tạo. */
function removeEhomeAutoSyncTrigger() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === EHOME_AUTO_SYNC_CONFIG.HANDLER) {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });

  Logger.log(JSON.stringify({
    code: "EHOME_AUTO_SYNC_REMOVED",
    removed: removed
  }));

  return removed;
}

/** Xem trạng thái trigger và lần đồng bộ gần nhất. */
function getEhomeAutoSyncStatus() {
  var allTriggers = ScriptApp.getProjectTriggers();
  var triggers = allTriggers.filter(function(trigger) {
    return trigger.getHandlerFunction() === EHOME_AUTO_SYNC_CONFIG.HANDLER;
  });
  var legacyHandlers = EHOME_AUTO_SYNC_CONFIG.LEGACY_HANDLERS || [];
  var legacyTriggers = allTriggers.filter(function(trigger) {
    return legacyHandlers.indexOf(trigger.getHandlerFunction()) >= 0;
  });

  return {
    installed: triggers.length > 0,
    triggerCount: triggers.length,
    legacyTriggerCount: legacyTriggers.length,
    everyHours: EHOME_AUTO_SYNC_CONFIG.EVERY_HOURS,
    mode: "INCREMENTAL_V328",
    lastSync: PropertiesService.getScriptProperties().getProperty(
      EHOME_AUTO_SYNC_CONFIG.LAST_SYNC_PROPERTY
    ) || ""
  };
}

/** Test một lượt incremental ngay, không cần chờ trigger. */
function testEhomeAutoSyncNow() {
  return ehomeAutoSyncMaster_();
}

function testEhomeAutoSyncStatus() {
  var result = getEhomeAutoSyncStatus();
  Logger.log(JSON.stringify(result));
  return result;
}
