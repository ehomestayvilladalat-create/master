/**
 * 15_CalendarContext.gs - V3.0 Accuracy First
 *
 * Request-local context only. Không cache trạng thái lịch giữa các request.
 * Mục tiêu: một source/sheet chỉ lấy metadata + ma trận lịch một lần/request.
 */

function ceCreateSourceContextV30_(openedFile, plan) {
  return {
    file: openedFile,
    sheets: {},
    sheetMetaV30: {},
    calendarCandidateSheetsV50: {},
    fastSearchPlanV23: plan || {},
    fastSearchForceFullV23: {},
    fastTimingV23: {
      openMs: 0,
      sheetLoads: 0,
      sheetLoadMs: 0,
      loadedCells: 0,
      narrowLoads: 0,
      fullLoads: 0,
      fullFallbacks: 0
    },
    fastTimingV30: {
      contextHits: 0,
      sheetMetaLoads: 0,
      sheetMetaMs: 0,
      safeFallbacks: 0
    }
  };
}


function ceCalendarConfidenceV30_(readResult) {
  if (!readResult || readResult.available !== true) return "BLOCKED";
  if (readResult.priceStatus === "KNOWN") return "EXACT";
  return "CALENDAR_EXACT_PRICE_UNKNOWN";
}
