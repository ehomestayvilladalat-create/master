/**
 * SnapshotReasonDoctorV1.js - READ ONLY
 * Đếm lý do web không dùng được snapshot. Không ghi gì vào sheet.
 */
var SNAPSHOT_REASON_DOCTOR_V1 = { VERSION: "1.0.0-read-only", SAMPLE_PER_REASON: 8 };

function diagnoseSnapshotReasonsV1(checkIn, checkOut, guests) {
  var startMs = new Date().getTime();
  var ci = String(checkIn || "2026-12-17");
  var co = String(checkOut || "2026-12-20");
  var guestCount = Math.max(1, Number(guests || 8));
  var start = ceParseInputDate_(ci);
  var end = ceParseInputDate_(co);
  if (!start || !end || end.getTime() <= start.getTime()) throw new Error("Ngày không hợp lệ. Dùng YYYY-MM-DD.");
  var nights = ceListNights_(start, end);

  var villas = ceReadMasterVillas_() || [];
  var ctx = ssLoadScheduleSnapshotContextV320_(true, nights);
  if (!ctx || ctx.enabled !== true) {
    return finishSnapshotReasonReportV1_({ version: SNAPSHOT_REASON_DOCTOR_V1.VERSION, problem: "SNAPSHOT_CONTEXT_DISABLED_OR_EMPTY" });
  }

  ctx.trustBackgroundHealthV627 = true;
  ctx.requireVerifiedModifiedV629 = true;

  var primeResult = null;
  try { primeResult = ssPrimeSourceModifiedCacheV2_(ctx, villas, guestCount); }
  catch (primeError) { primeResult = { error: String(primeError && primeError.message ? primeError.message : primeError) }; }

  var reasons = {};
  var samples = {};
  var usableCount = 0;
  var totalCount = 0;
  var sourceCheck = { verifiedSame: 0, verifiedDifferent: 0, notVerified: 0, driveReadFailed: 0 };
  var differentSources = {};
  var seenSources = {};

  villas.forEach(function(villa) {
    if (!villa || !villa.id) return;
    totalCount++;
    var option = ssSelectOptionForGuestV320_(villa, guestCount);
    var key = String(villa.id || "") + "|" + Number(option.column || 0);
    var row = ctx.rows[key];
    var sourceKey = row ? String(row[0] || "") : "";

    if (sourceKey && !seenSources[sourceKey]) {
      seenSources[sourceKey] = true;
      if (!Object.prototype.hasOwnProperty.call(ctx.sourceModifiedCache, sourceKey)) {
        sourceCheck.notVerified++;
      } else {
        var verified = String(ctx.sourceModifiedCache[sourceKey] || "");
        var saved = row ? String(row[7] || "") : "";
        if (!verified) sourceCheck.driveReadFailed++;
        else if (verified === saved) sourceCheck.verifiedSame++;
        else {
          sourceCheck.verifiedDifferent++;
          differentSources[sourceKey] = { savedAt: saved, driveAt: verified };
        }
      }
    }

    var attempt = ssTryReadVillaSnapshotV320_(ctx, villa, nights, guestCount);
    var reason = attempt && attempt.usable === true ? "USABLE" : String(attempt && attempt.reason || "UNKNOWN");
    if (attempt && attempt.usable === true) usableCount++;
    reasons[reason] = (reasons[reason] || 0) + 1;
    if (!samples[reason]) samples[reason] = [];
    if (samples[reason].length < SNAPSHOT_REASON_DOCTOR_V1.SAMPLE_PER_REASON) {
      samples[reason].push(String(villa.id) + " | " + String(villa.name || ""));
    }
  });

  return finishSnapshotReasonReportV1_({
    version: SNAPSHOT_REASON_DOCTOR_V1.VERSION,
    checkIn: ci, checkOut: co, guests: guestCount, nights: nights.length,
    villasChecked: totalCount,
    usableFromSnapshot: usableCount,
    reasonCount: reasons,
    sampleVillas: samples,
    sourceVerification: sourceCheck,
    differentSourcesSample: Object.keys(differentSources).slice(0, 10).map(function(k) {
      return k + " | luu: " + differentSources[k].savedAt + " | Drive: " + differentSources[k].driveAt;
    }),
    primeResult: primeResult,
    elapsedMs: new Date().getTime() - startMs
  });
}

function finishSnapshotReasonReportV1_(report) {
  Logger.log(JSON.stringify(report, null, 2));
  try {
    SpreadsheetApp.getUi().alert("Chan doan snapshot (chi doc)",
      "Dung duoc snapshot: " + (report.usableFromSnapshot || 0) + "/" + (report.villasChecked || 0) + "\n" +
      "Ly do bi loai: " + JSON.stringify(report.reasonCount || report.problem || {}),
      SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (uiError) {}
  return report;
}
