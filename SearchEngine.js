/** 07_SearchEngine.gs - V6.3.2 INTERNAL HIGH-RECALL RESTORE (V620/V621 BEHAVIOR)
 * CalendarReader V5.6 vẫn là SOURCE OF TRUTH cho FREE/BUSY/giá.
 *
 * V2.3 tối ưu:
 * - MASTER_VILLA được cache ở Repository.
 * - Lập plan theo source trước khi mở lịch.
 * - Mỗi source chỉ mở Spreadsheet một lần trong request.
 * - Truyền max sourceColumn cần thiết cho CalendarReader để đọc vùng hẹp.
 * - Nếu sourceColumn có dấu hiệu lệch, CalendarReader tự bung full scan và remap.
 * - Timing log theo source để benchmark.
 */

function searchAvailableVillas(checkIn, checkOut, guests, city, cursor, pageSize, minPrice, maxPrice, sortMode, shuffleSeed, productType, bedrooms) {
  return ceSearchAvailableVillasInternal_(checkIn, checkOut, guests, {
    city: city || "",
    cursor: Number(cursor || 0),
    pageSize: Number(pageSize || (BE_CONFIG.V30_DEFAULT_PAGE_SIZE || 12)),
    minPrice: Number(minPrice || 0),
    maxPrice: Number(maxPrice || 0),
    sortMode: String(sortMode || "BEST"),
    shuffleSeed: String(shuffleSeed || ""),
    productType: String(productType || "NGUYEN_CAN"),
    bedrooms: Number(bedrooms || 0),
    maxVillas: 0,
    debug: false,
    // V6.2.6 UI guard: production page search must fail partial rather than hang for minutes.
    maxRuntimeMs: 60000
  });
}

function testSearchAvailableVillasLimited(checkIn, checkOut, guests, maxVillas, city) {
  return ceSearchAvailableVillasInternal_(checkIn, checkOut, guests, {
    city: city || "",
    cursor: 0,
    pageSize: 20,
    minPrice: 0,
    maxPrice: 0,
    sortMode: "BEST",
    maxVillas: Number(maxVillas || 1),
    debug: true,
    maxRuntimeMs: 240000
  });
}

function ceSearchAvailableVillasInternal_(checkIn, checkOut, guests, options) {
  options = options || {};

  var startedAtMs = new Date().getTime();
  var startDate = ceParseInputDate_(checkIn);
  var endDate = ceParseInputDate_(checkOut);
  var guestCount = Number(guests || 0);
  var maxVillas = Number(options.maxVillas || 0);
  var debug = Boolean(options.debug);
  var maxRuntimeMs = Number(options.maxRuntimeMs || 280000);
  var cityFilter = ceNormalizeCityFilter_(options.city || "");
  var startCursor = Math.max(0, parseInt(options.cursor, 10) || 0);
  var pageSize = Math.max(1, Math.min(50, parseInt(options.pageSize, 10) || Number(BE_CONFIG.V30_DEFAULT_PAGE_SIZE || 12)));
  var minPrice = ceNormalizePriceFilterV30_(options.minPrice || 0);
  var maxPrice = ceNormalizePriceFilterV30_(options.maxPrice || 0);
  var sortMode = ceNormalizeSortModeV30_(options.sortMode || "BEST");
  var shuffleSeed = ceNormalizeShuffleSeedV340_(options.shuffleSeed || "");
  var productTypeFilterV342 = ceNormalizeProductTypeFilterV342_(options.productType || "NGUYEN_CAN");
  var bedroomsFilterV342 = Math.max(0, parseInt(options.bedrooms, 10) || 0);
  var minBedroomsFilterV625 = ceNormalizeMinBedroomsV1_(options.minBedrooms || 0);
  var legacyEarlyStopV1 = options.legacyEarlyStop === true;
  var debugVillaIdV1 = String(options.debugVillaId || "").trim().toUpperCase();
  // V6.2.7 customer progressive search:
  // - SNAPSHOT_FIRST: read trusted background snapshot only, never block first paint on live Sheets.
  // - LIVE_FALLBACK: explicitly verify a small deferred batch against source Sheets.
  var snapshotOnlyV627 = options.snapshotOnlyV627 === true;
  var snapshotTrustBackgroundV627 = snapshotOnlyV627 && options.snapshotTrustBackgroundV627 === true;
  var snapshotVerifyModifiedV629 = snapshotOnlyV627 && options.snapshotVerifyModifiedV629 === true;
  var forceLiveV627 = options.forceLiveV627 === true;
  // V6.3.0 minimal high-recall mode for INTERNAL BEST search only.
  // It never turns UNKNOWN into FREE: it returns UNKNOWN as a separate card state
  // instead of opening source Sheets one-by-one just to fill a 12-card page.
  var internalMixedV630 = options.internalMixedV630 === true &&
    !snapshotOnlyV627 && !forceLiveV627 && sortMode === "BEST" && minPrice <= 0 && maxPrice <= 0;
  // V6.2.8: customer snapshot scan stops after a small confirmed buffer.
  // Candidate cursor lets the next request continue from exactly where this scan stopped.
  var snapshotResultLimitV628 = snapshotOnlyV627 ? Math.max(0, Math.min(24, Number(options.snapshotResultLimitV628 || 0))) : 0;
  var snapshotCandidateScanLimitV628 = snapshotOnlyV627 ? Math.max(0, Math.min(200, Number(options.snapshotCandidateScanLimitV628 || 0))) : 0;

  var allowedVillaIdsV61 = null;
  if (Array.isArray(options.allowedVillaIds)) {
    allowedVillaIdsV61 = {};
    options.allowedVillaIds.forEach(function(id){
      id = String(id || "").trim();
      if (id) allowedVillaIdsV61[id] = true;
    });
  }

  var priorityScoresV617 = null;
  if (options.priorityScores && typeof options.priorityScores === "object") {
    priorityScoresV617 = {};
    Object.keys(options.priorityScores).forEach(function(id){
      id = String(id || "").trim();
      var score = Number(options.priorityScores[id] || 0);
      if (id && isFinite(score) && score > 0) priorityScoresV617[id] = score;
    });
  }

  if (productTypeFilterV342 === "PHONG_RIENG") {
    minPrice = 0;
    maxPrice = 0;
  }
  if (minPrice > 0 && maxPrice > 0 && maxPrice < minPrice) {
    var swapV30 = minPrice; minPrice = maxPrice; maxPrice = swapV30;
  }

  if (!startDate || !endDate) throw new Error("Ngày nhận hoặc ngày trả không hợp lệ.");
  if (endDate.getTime() <= startDate.getTime()) throw new Error("Ngày trả phải sau ngày nhận.");
  if (!Number.isFinite(guestCount) || guestCount < 1) throw new Error("Số khách phải lớn hơn 0.");

  var nights = ceListNights_(startDate, endDate);
  var exhaustivePriceSortV30 = Boolean(sortMode !== "BEST" && BE_CONFIG.V30_EXHAUSTIVE_PRICE_SORT === true);
  var searchModeV626 = ceResolveSearchExecutionModeV626_(sortMode, options, exhaustivePriceSortV30);
  var exhaustiveModeV626 = searchModeV626 === "EXHAUSTIVE";

  var queryV1 = {
    checkIn: ceDateKey_(startDate),
    checkOut: ceDateKey_(endDate),
    guests: guestCount,
    nights: nights.length,
    city: options.city || "",
    minPrice: minPrice,
    maxPrice: maxPrice,
    sortMode: sortMode,
    shuffleSeed: shuffleSeed,
    productType: productTypeFilterV342,
    bedrooms: bedroomsFilterV342,
    minBedrooms: minBedroomsFilterV625,
    exhaustivePriceSort: exhaustivePriceSortV30,
    searchMode: searchModeV626,
    snapshotOnlyV627: snapshotOnlyV627,
    forceLiveV627: forceLiveV627,
    snapshotResultLimitV628: snapshotResultLimitV628,
    snapshotCandidateScanLimitV628: snapshotCandidateScanLimitV628,
    snapshotVerifyModifiedV629: snapshotVerifyModifiedV629,
    internalMixedV630: internalMixedV630
  };

  // Only a truly exhaustive, non-customer-specific search may reuse the V624
  // full-result cache. FAST_PAGE uses candidate cursors and deliberately avoids
  // pretending that an incomplete page is a complete result set.
  var cacheAllowedV626 = exhaustiveModeV626 && !allowedVillaIdsV61 && !priorityScoresV617 && !debug && !legacyEarlyStopV1 && maxVillas <= 0;
  var cacheKeyV1 = cacheAllowedV626 ? ceSearchSessionCacheKeyV1_(queryV1) : "";
  if (cacheAllowedV626) {
    var cachedSearchResponseV1 = ceGetSearchSessionPageV1_(cacheKeyV1, startCursor, pageSize);
    if (cachedSearchResponseV1) return cachedSearchResponseV1;
  }

  var masterStarted = new Date().getTime();
  var allVillas = ceReadMasterVillas_();
  var masterReadMs = new Date().getTime() - masterStarted;

  var filterStartedV1 = new Date().getTime();
  var dropReasonCountsV1 = {};
  var dropReasonSamplesV1 = {};
  var diagnosticByIdV1 = {};
  var countersV1 = {
    masterTotal: allVillas.length,
    staticEligible: 0,
    eligibleCount: 0,
    scheduleChecked: 0,
    availableCount: 0,
    priceResolved: 0,
    rankedCount: 0,
    returnedCount: 0,
    failedCount: 0,
    uncheckedCount: 0,
    fallbackCount: 0,
    unknownCount: 0
  };

  function rememberDiagnosticV1_(villa, stage, reason, extra) {
    reason = String(reason || "");
    if (reason) {
      dropReasonCountsV1[reason] = Number(dropReasonCountsV1[reason] || 0) + 1;
      if (!dropReasonSamplesV1[reason]) dropReasonSamplesV1[reason] = [];
      if (dropReasonSamplesV1[reason].length < 5) {
        dropReasonSamplesV1[reason].push({
          villaId: String(villa && villa.id || ""),
          villaName: String(villa && villa.name || ""),
          source: String(villa && villa.source || "")
        });
      }
    }
    if (!debugVillaIdV1 || String(villa && villa.id || "").trim().toUpperCase() !== debugVillaIdV1) return;
    var item = diagnosticByIdV1[debugVillaIdV1] || {
      villaId: debugVillaIdV1,
      villaName: villa && villa.name || "",
      masterFound: Boolean(villa)
    };
    item.stage = stage || item.stage || "";
    if (reason) item.dropReason = reason;
    Object.keys(extra || {}).forEach(function(key){ item[key] = extra[key]; });
    diagnosticByIdV1[debugVillaIdV1] = item;
  }

  var villas = allVillas.filter(function(villa) {
    if (allowedVillaIdsV61 && !allowedVillaIdsV61[String(villa.id || "").trim()]) {
      rememberDiagnosticV1_(villa, "STATIC", "CUSTOMER_STATIC_FILTER", {staticEligible:false});
      return false;
    }
    if (!ceCityMatchesFilterV23_(villa.city, cityFilter)) {
      rememberDiagnosticV1_(villa, "CITY", "CITY_MISMATCH", {staticEligible:false});
      return false;
    }
    if (!ceProductTypeMatchesV342_(villa.productType, productTypeFilterV342)) {
      rememberDiagnosticV1_(villa, "PRODUCT_TYPE", "PRODUCT_TYPE_MISMATCH", {staticEligible:false});
      return false;
    }
    if (!ceBedroomsMatchesHighRecallV342_(villa.bedrooms, bedroomsFilterV342)) {
      rememberDiagnosticV1_(villa, "BEDROOM", "BEDROOM_FILTER_MISMATCH", {staticEligible:false});
      return false;
    }
    if (!ceBedroomsMatchesMinimumV625_(villa, minBedroomsFilterV625)) {
      var strictBedroomNumberV625 = ceBedroomNumberFromVillaV625_(villa);
      rememberDiagnosticV1_(villa, "BEDROOM", strictBedroomNumberV625 > 0 ? "BEDROOM_TOO_SMALL" : "BEDROOM_UNKNOWN", {
        staticEligible:false, bedroomPass:false, bedrooms:strictBedroomNumberV625 || null, minBedrooms:minBedroomsFilterV625
      });
      return false;
    }
    countersV1.staticEligible++;
    rememberDiagnosticV1_(villa, "ELIGIBLE", "", {staticEligible:true});
    return true;
  });

  // Capacity is still ranking, not a hard filter. This preserves high recall
  // for villas whose MASTER capacity is missing/stale while putting likely-fit
  // villas first so FAST_PAGE can finish quickly.
  cePrepareSearchRankingKeysV626_(villas, guestCount, shuffleSeed);
  villas.sort(function(a, b) {
    return ceCompareVillasBestCapacityV332_(a, b, guestCount, shuffleSeed, priorityScoresV617);
  });
  if (sortMode === "BEST") {
    villas = ceBalanceBestCandidatesV344_(villas, guestCount, pageSize, shuffleSeed);
  }

  // V6.2.9: progressive customer sessions pin candidate IDs on the first call.
  // Later calls reuse that exact ordering so pageSize/priority/MASTER changes
  // cannot move the candidate cursor underneath an active session.
  if (Array.isArray(options.candidateIdOrderV629) && options.candidateIdOrderV629.length) {
    var byPinnedIdV629 = {};
    villas.forEach(function(v){ var id=String(v&&v.id||"").trim(); if(id)byPinnedIdV629[id]=v; });
    var pinnedVillasV629 = [];
    options.candidateIdOrderV629.forEach(function(id){ id=String(id||"").trim(); if(id&&byPinnedIdV629[id])pinnedVillasV629.push(byPinnedIdV629[id]); });
    villas = pinnedVillasV629;
  }

  var candidateIdsV629 = villas.map(function(v){ return String(v&&v.id||"").trim(); }).filter(Boolean);
  var fullEligibleCountV1 = villas.length;
  var limitedByTestCapV1 = maxVillas > 0 && villas.length > maxVillas;
  if (limitedByTestCapV1) villas = villas.slice(0, maxVillas);
  countersV1.eligibleCount = fullEligibleCountV1;
  var filterMsV1 = new Date().getTime() - filterStartedV1;

  if (startCursor > villas.length) startCursor = villas.length;
  // V6.2.8 snapshot-first also honors a candidate cursor so progressive calls do not rescan from 0.
  var candidateStartCursorV626 = exhaustiveModeV626 ? 0 : startCursor;
  var sourcePlans = ceBuildFastSourcePlansV23_(villas, candidateStartCursorV626);

  if (debug) {
    Logger.log(JSON.stringify({
      code: "FAST_SEARCH_SOURCE_PLAN_V23",
      mode: searchModeV626,
      sources: Object.keys(sourcePlans).length,
      candidates: villas.length,
      candidateStart: candidateStartCursorV626,
      plan: Object.keys(sourcePlans).slice(0, 20).map(function(url) {
        var p = sourcePlans[url];
        return {source:p.source,candidates:p.candidates,maxColumn:p.maxColumn,requiresFullScan:p.requiresFullScan};
      })
    }));
  }

  var sourceCache = {};
  var sourceStats = {};
  var scheduleSnapshotV320 = (!forceLiveV627 && typeof ssLoadScheduleSnapshotContextV320_ === "function")
    ? ssLoadScheduleSnapshotContextV320_(false, nights)
    : {enabled:false,hits:0,misses:0,stale:0,errorCells:0};

  // V6.3.2 INTERNAL: fast/high-recall mode trusts the background snapshot health
  // and never performs unbounded Drive modifiedTime checks inside a search request.
  // DIRTY/RUNNING/ERROR/SKIPPED sources remain UNKNOWN and are shown for manual
  // verification instead of being silently dropped.
  if (scheduleSnapshotV320 && internalMixedV630) {
    scheduleSnapshotV320.trustBackgroundHealthV627 = true;
    scheduleSnapshotV320.requireVerifiedModifiedV629 = false;
  }

  if (scheduleSnapshotV320 && snapshotTrustBackgroundV627) {
    scheduleSnapshotV320.trustBackgroundHealthV627 = true;
    scheduleSnapshotV320.requireVerifiedModifiedV629 = snapshotVerifyModifiedV629 === true;
    if (snapshotVerifyModifiedV629 === true && scheduleSnapshotV320.enabled === true && typeof ssPrimeSourceModifiedCacheV2_ === "function") {
      var verifyCountV629 = Math.max(12, Math.min(24, Math.max(pageSize, snapshotResultLimitV628 || pageSize) * 2));
      var verifyVillasV629 = villas.slice(candidateStartCursorV626, Math.min(villas.length, candidateStartCursorV626 + verifyCountV629));
      ssPrimeSourceModifiedCacheV2_(scheduleSnapshotV320, verifyVillasV629, guestCount);
    }
  }

  if (scheduleSnapshotV320 && scheduleSnapshotV320.enabled === true && !snapshotTrustBackgroundV627 && !internalMixedV630 && typeof ssPrimeSourceModifiedCacheV2_ === "function") {
    // V6.2.6: exhaustive audit still verifies every candidate source up-front.
    // Production FAST_PAGE verifies only a small look-ahead window. If the scan
    // goes farther, ssTryReadVillaSnapshotV320_ safely checks that source lazily.
    var primeVillasV626 = villas;
    if (!exhaustiveModeV626) {
      var lookAheadV626 = internalMixedV630
        ? Math.max(12, Math.min(24, pageSize * 2))
        : Math.max(36, Math.min(80, pageSize * 4));
      primeVillasV626 = villas.slice(candidateStartCursorV626, Math.min(villas.length, candidateStartCursorV626 + lookAheadV626));
    }
    ssPrimeSourceModifiedCacheV2_(scheduleSnapshotV320, primeVillasV626, guestCount);
  }

  var results = [];
  var deferredVillaIdsV627 = [];
  var errors = [];
  var stoppedEarly = false;
  var pageFilledV626 = false;
  var fallbackMsV1 = 0;
  var priceMsV1 = 0;
  var nextCandidateCursorV626 = candidateStartCursorV626;
  // V6.2.9.1 HOTFIX: snapshot-only requests have mandatory prelude I/O
  // (snapshot block load + bounded modifiedTime verification). That work must
  // not consume the candidate-scan budget before candidate 0 is evaluated.
  // After the prelude, snapshot candidate evaluation is in-memory and still
  // bounded by snapshotCandidateScanLimitV628, so give it its own budget.
  var candidateBudgetStartedAtV6291 = snapshotOnlyV627 ? new Date().getTime() : startedAtMs;
  var i;

  for (i = candidateStartCursorV626; i < villas.length; i++) {
    if (new Date().getTime() - candidateBudgetStartedAtV6291 > maxRuntimeMs) {
      stoppedEarly = true;
      errors.push({villaId:"",name:"",source:"",message:"Dừng sớm vì gần chạm giới hạn thời gian chạy Apps Script."});
      break;
    }
    if (snapshotOnlyV627 && snapshotCandidateScanLimitV628 > 0 &&
        (i - candidateStartCursorV626) >= snapshotCandidateScanLimitV628) {
      pageFilledV626 = true;
      break;
    }
    var villa = villas[i];
    nextCandidateCursorV626 = i + 1;
    var urlKey = String(villa.calendarUrl || "");

    try {
      var reader = "";
      var readResult = null;
      var stat = null;
      var snapshotAttemptV320 = null;

      if (!forceLiveV627 && scheduleSnapshotV320 && scheduleSnapshotV320.enabled === true && typeof ssTryReadVillaSnapshotV320_ === "function") {
        snapshotAttemptV320 = ssTryReadVillaSnapshotV320_(scheduleSnapshotV320, villa, nights, guestCount);
      }

      // V7 NO_CALENDAR_MONTH: nguồn chưa mở lịch tháng này.
      // Hiện căn kèm "Liên hệ kiểm tra lịch", không đọc live (live cũng không có tab để đọc), không đưa vào hàng chờ.
      if (snapshotAttemptV320 && snapshotAttemptV320.usable !== true && snapshotAttemptV320.reason === "SNAPSHOT_NO_CALENDAR_MONTH") {
        var noCalFitV7 = ceCapacityFit_(villa.standard, guestCount, villa.capacityMin, villa.capacityMax);
        countersV1.unknownCount++;
        results.push({
          villaId:villa.id,name:villa.name,city:villa.city,source:villa.source,image:villa.image,
          standard:villa.standard || "",
          capacityMin:Number(villa.capacityMin || noCalFitV7.min || 0),
          capacityMax:Number(villa.capacityMax || noCalFitV7.max || 0),
          capacityLabel:villa.capacityLabel || noCalFitV7.label || (villa.standard || ""),
          bedrooms:villa.bedrooms || "",bedroomsNumber:ceBedroomNumberFromVillaV625_(villa),
          productType:villa.productType || "",priority:Number(villa.priority || 0),
          info:villa.info,maps:villa.maps,available:null,
          availabilityStatus:"CONTACT",availabilityReason:"SNAPSHOT_NO_CALENDAR_MONTH",
          capacityFitGroup:noCalFitV7.group,capacityDifference:noCalFitV7.difference,capacityKnown:noCalFitV7.known,
          calendarConfidence:"UNKNOWN",priceConfidence:"UNKNOWN",priceStatus:"UNKNOWN",
          totalPrice:null,totalPriceText:"Liên hệ kiểm tra lịch",nights:nights.length,nightlyPrices:[],
          reader:"SNAPSHOT_NO_CALENDAR_V7",sourceLink:String(villa.calendarUrl || "")
        });
        rememberDiagnosticV1_(villa, "AVAILABILITY", "NO_CALENDAR_MONTH", {
          snapshotStatus:"NO_CALENDAR_MONTH",availabilityStatus:"CONTACT",priceStatus:"UNKNOWN"
        });
        if (snapshotOnlyV627 && snapshotResultLimitV628 > 0 && results.length >= snapshotResultLimitV628) {
          pageFilledV626 = true;
          break;
        }
        continue;
      }

      if (snapshotAttemptV320 && snapshotAttemptV320.usable === true) {
        reader = snapshotAttemptV320.reader || "SNAPSHOT_V320";
        readResult = snapshotAttemptV320.readResult;
      } else if (snapshotOnlyV627) {
        deferredVillaIdsV627.push(String(villa.id || ""));
        rememberDiagnosticV1_(villa, "DEFERRED_LIVE", String(snapshotAttemptV320 && snapshotAttemptV320.reason || "SNAPSHOT_MISS"), {
          snapshotStatus:String(snapshotAttemptV320 && snapshotAttemptV320.reason || "SNAPSHOT_MISS"),
          availabilityStatus:"DEFERRED",priceStatus:"NOT_CHECKED"
        });
        continue;
      } else if (internalMixedV630) {
        // High recall for sale/internal UI: keep a statically matching villa visible
        // when calendar state is not verified. It is explicitly UNKNOWN, never FREE.
        var unknownFitV630 = ceCapacityFit_(villa.standard, guestCount, villa.capacityMin, villa.capacityMax);
        results.push({
          villaId:villa.id,name:villa.name,city:villa.city,source:villa.source,image:villa.image,
          standard:villa.standard || "",
          capacityMin:Number(villa.capacityMin || unknownFitV630.min || 0),
          capacityMax:Number(villa.capacityMax || unknownFitV630.max || 0),
          capacityLabel:villa.capacityLabel || unknownFitV630.label || (villa.standard || ""),
          bedrooms:villa.bedrooms || "",bedroomsNumber:ceBedroomNumberFromVillaV625_(villa),
          productType:villa.productType || "",priority:Number(villa.priority || 0),
          info:villa.info,maps:villa.maps,available:null,
          availabilityStatus:"UNKNOWN",
          availabilityReason:String(snapshotAttemptV320 && snapshotAttemptV320.reason || "SNAPSHOT_MISS"),
          capacityFitGroup:unknownFitV630.group,capacityDifference:unknownFitV630.difference,capacityKnown:unknownFitV630.known,
          calendarConfidence:"UNKNOWN",priceConfidence:"UNKNOWN",priceStatus:"UNKNOWN",
          totalPrice:null,totalPriceText:"Cần kiểm tra lịch / giá",nights:nights.length,nightlyPrices:[],
          reader:"SNAPSHOT_UNKNOWN_V630",sourceLink:String(villa.calendarUrl || "")
        });
        countersV1.unknownCount++;
        rememberDiagnosticV1_(villa, "UNKNOWN_VISIBLE", String(snapshotAttemptV320 && snapshotAttemptV320.reason || "SNAPSHOT_MISS"), {
          availabilityStatus:"UNKNOWN",priceStatus:"UNKNOWN"
        });
        // V6.3.2 INTERNAL: UNKNOWN counts as a visible high-recall result.
        // Stop at the exact candidate position that fills the page so the next
        // cursor resumes from the next candidate. Nothing after this point is
        // discarded; auto-load/load-more continues through the full candidate set.
        if (results.length >= pageSize) {
          pageFilledV626 = true;
          break;
        }
        continue;
      } else {
        countersV1.fallbackCount++;
        var fallbackStartedV1 = new Date().getTime();
        if (!sourceCache[urlKey]) {
          var openStarted = new Date().getTime();
          var opened = null;
          var openError = null;

          // Bắt lỗi quyền khi mở file
          try {
            opened = ceOpenSpreadsheetFastV23_(villa.calendarUrl);
          } catch (e) {
            var msg = String(e && e.message ? e.message : e);
            var classify = saClassifyAccessErrorV1_(msg);
            if (classify === "NO_ACCESS") {
              openError = "PERMISSION_DENIED";
              Logger.log("[SearchEngine] Permission denied for " + villa.source + ": " + msg);
            } else {
              throw e;  // Lỗi khác: không xử lý, ném lên
            }
          }

          var openMs = new Date().getTime() - openStarted;

          // Nếu mất quyền: skip villa, mark as PERMISSION_DENIED
          if (openError === "PERMISSION_DENIED") {
            rememberDiagnosticV1_(villa, "AVAILABILITY", "PERMISSION_DENIED", {
              snapshotStatus: "PERMISSION_DENIED",
              availabilityStatus: "PERMISSION_DENIED",
              priceStatus: "NOT_CHECKED"
            });
            countersV1.scheduleChecked++;
            continue;
          }

          var plan = sourcePlans[urlKey] || {
            source: villa.source || "",
            candidates: 1,
            maxColumn: Number(villa.sourceColumn || 0),
            requiresFullScan: Number(villa.sourceColumn || 0) <= 0
          };

          sourceCache[urlKey] = ceCreateSourceContextV30_(opened, plan);
          sourceCache[urlKey].fastTimingV23.openMs = openMs;

          sourceStats[urlKey] = {
            source: villa.source || plan.source || "",
            candidates: Number(plan.candidates || 0),
            maxColumn: Number(plan.maxColumn || 0),
            requiresFullScan: Boolean(plan.requiresFullScan),
            openMs: openMs, readerMs: 0, checked: 0, available: 0, errors: 0
          };
        }

        var sourceContext = sourceCache[urlKey];

        // Chu an cot villa trong file lich = can khong ban: bo qua, khong hien, khong bao loi.
        if (hcIsVillaHiddenInFileV1_(sourceContext.file, villa)) {
          rememberDiagnosticV1_(villa, "AVAILABILITY", "HIDDEN_COLUMN", {
            snapshotStatus: "HIDDEN_COLUMN",
            availabilityStatus: "HIDDEN_COLUMN",
            priceStatus: "NOT_CHECKED"
          });
          countersV1.scheduleChecked++;
          continue;
        }

        stat = sourceStats[urlKey];
        stat.checked++;
        reader = ceResolveReader_(villa.config, sourceContext.file, nights[0], debug);
        var readerStarted = new Date().getTime();
        readResult = ceReadVillaByReader_(reader, sourceContext, villa, nights, guestCount, debug);
        stat.readerMs += new Date().getTime() - readerStarted;
        fallbackMsV1 += new Date().getTime() - fallbackStartedV1;
      }

      countersV1.scheduleChecked++;
      if (!readResult || !readResult.available) {
        rememberDiagnosticV1_(villa, "AVAILABILITY", "BUSY", {
          snapshotStatus: snapshotAttemptV320 && snapshotAttemptV320.usable
            ? String(snapshotAttemptV320.sourceStatus || "OK")
            : String(snapshotAttemptV320 && snapshotAttemptV320.reason || "LIVE"),
          availabilityStatus: "BUSY", priceStatus: "NOT_CHECKED"
        });
        continue;
      }

      countersV1.availableCount++;
      if (readResult.priceStatus === "KNOWN" && Number.isFinite(Number(readResult.totalPrice))) countersV1.priceResolved++;
      var priceStartedV1 = new Date().getTime();
      if (!cePriceMatchesV30_(readResult, minPrice, maxPrice)) {
        priceMsV1 += new Date().getTime() - priceStartedV1;
        if (stat) stat.priceFiltered = Number(stat.priceFiltered || 0) + 1;
        rememberDiagnosticV1_(villa, "PRICE", "PRICE_OUT_OF_RANGE", {
          availabilityStatus:"AVAILABLE", priceStatus:readResult.priceStatus || "UNKNOWN"
        });
        continue;
      }
      priceMsV1 += new Date().getTime() - priceStartedV1;

      if (stat) stat.available++;
      var fit = ceCapacityFit_(villa.standard, guestCount, villa.capacityMin, villa.capacityMax);
      var calendarConfidenceV30 = ceCalendarConfidenceV30_(readResult);
      results.push({
        villaId:villa.id,name:villa.name,city:villa.city,source:villa.source,image:villa.image,
        standard:villa.standard || "",
        capacityMin:Number(villa.capacityMin || fit.min || 0),
        capacityMax:Number(villa.capacityMax || fit.max || 0),
        capacityLabel:villa.capacityLabel || fit.label || (villa.standard || ""),
        bedrooms:villa.bedrooms || "",bedroomsNumber:ceBedroomNumberFromVillaV625_(villa),
        productType:villa.productType || "",priority:Number(villa.priority || 0),
        info:villa.info,maps:villa.maps,available:true,availabilityStatus:(internalMixedV630 && String(reader || "").indexOf("SNAPSHOT") === 0 ? "SNAPSHOT_FREE" : "CONFIRMED_FREE"),sourceLink:String(villa.calendarUrl || ""),
        capacityFitGroup:fit.group,capacityDifference:fit.difference,capacityKnown:fit.known,
        calendarConfidence:calendarConfidenceV30,
        priceConfidence:readResult.priceStatus === "KNOWN" ? "EXACT" : "UNKNOWN",
        priceStatus:readResult.priceStatus,totalPrice:readResult.totalPrice,
        totalPriceText:readResult.totalPriceText || (readResult.totalPrice === null ? "Liên hệ báo giá" : ceFormatMoney_(readResult.totalPrice)),
        nights:nights.length,nightlyPrices:readResult.nightlyPrices,reader:reader
      });
      rememberDiagnosticV1_(villa, "RANKING", "", {availabilityStatus:"AVAILABLE",priceStatus:readResult.priceStatus || "UNKNOWN"});

      if (snapshotOnlyV627 && snapshotResultLimitV628 > 0 && results.length >= snapshotResultLimitV628) {
        pageFilledV626 = true;
        break;
      }
      if (!exhaustiveModeV626 && !snapshotOnlyV627 && results.length >= pageSize) {
        pageFilledV626 = true;
        break;
      }
      if (legacyEarlyStopV1 && results.length >= pageSize) {
        pageFilledV626 = true;
        break;
      }
    } catch (error) {
      if (sourceStats[urlKey]) sourceStats[urlKey].errors++;
      countersV1.failedCount++;
      var liveDropReasonV2 = ceSearchLiveErrorReasonV2_(error);
      rememberDiagnosticV1_(villa, "AVAILABILITY", liveDropReasonV2, {
        snapshotStatus:String(snapshotAttemptV320 && snapshotAttemptV320.reason || "LIVE_FAILED"),
        availabilityStatus:"ERROR",priceStatus:"NOT_CHECKED",
        error:String(error && error.message ? error.message : error)
      });
      errors.push({villaId:villa.id,name:villa.name,source:villa.source,message:error && error.message ? error.message : String(error)});
    }
  }

  // BEST preserves capacity-fit ranking. Price sorts remain exhaustive when the
  // config requires globally correct price ordering.
  var rankingStartedV1 = new Date().getTime();
  if (sortMode === "BEST") {
    results.sort(function(a,b){
      if (internalMixedV630) {
        var aVerifiedV630 = a && (a.availabilityStatus === "CONFIRMED_FREE" || a.availabilityStatus === "SNAPSHOT_FREE") ? 0 : 1;
        var bVerifiedV630 = b && (b.availabilityStatus === "CONFIRMED_FREE" || b.availabilityStatus === "SNAPSHOT_FREE") ? 0 : 1;
        if (aVerifiedV630 !== bVerifiedV630) return aVerifiedV630 - bVerifiedV630;
      }
      return ceCompareVillasBestCapacityV332_(a,b,guestCount,shuffleSeed,priorityScoresV617);
    });
  } else {
    ceSortSearchResultsV30_(results, sortMode);
  }
  var rankingMsV1 = new Date().getTime() - rankingStartedV1;
  countersV1.rankedCount = results.length;

  var fullScanAccountedV626 = candidateStartCursorV626 === 0 && nextCandidateCursorV626 >= villas.length;
  if (exhaustiveModeV626) {
    countersV1.uncheckedCount = Math.max(0, countersV1.eligibleCount - countersV1.scheduleChecked - countersV1.failedCount);
  } else {
    // FAST_PAGE is intentionally partial until the candidate cursor reaches the end.
    countersV1.uncheckedCount = Math.max(0, countersV1.eligibleCount - countersV1.scheduleChecked - countersV1.failedCount);
    if (pageFilledV626 && nextCandidateCursorV626 < villas.length) {
      dropReasonCountsV1.PAGE_REMAINDER_UNCHECKED = Math.max(0, villas.length - nextCandidateCursorV626);
    }
  }

  if (limitedByTestCapV1) {
    stoppedEarly = true;
    dropReasonCountsV1.TEST_LIMIT_UNCHECKED = countersV1.uncheckedCount;
  } else if (legacyEarlyStopV1 && nextCandidateCursorV626 < villas.length) {
    dropReasonCountsV1.LEGACY_PAGE_CUTOFF = Math.max(0, villas.length - nextCandidateCursorV626);
  } else if (stoppedEarly && countersV1.uncheckedCount > 0) {
    dropReasonCountsV1.TIMEOUT_UNCHECKED = countersV1.uncheckedCount;
  }

  var completeV1 = exhaustiveModeV626
    ? ceIsSearchCompleteV1_(countersV1, stoppedEarly)
    : (snapshotOnlyV627
      ? Boolean(nextCandidateCursorV626 >= villas.length && deferredVillaIdsV627.length === 0 && !stoppedEarly && countersV1.failedCount === 0)
      : Boolean(fullScanAccountedV626 && !stoppedEarly && countersV1.failedCount === 0 && startCursor === 0));
  var elapsedMs = new Date().getTime() - startedAtMs;
  var timing = ceBuildFastSearchTimingV23_(sourceCache, sourceStats, masterReadMs, elapsedMs);
  var payloadV1 = {
    success:true,complete:completeV1,partial:!completeV1,query:queryV1,
    results:results,errors:errors,dropReasonCounts:dropReasonCountsV1,dropReasonSamples:dropReasonSamplesV1,
    diagnostics:debugVillaIdV1 ? Object.keys(diagnosticByIdV1).map(function(key){return diagnosticByIdV1[key];}) : [],
    deferredVillaIdsV627:deferredVillaIdsV627,
    candidateIdsV629:snapshotOnlyV627?candidateIdsV629:[],
    counters:countersV1,stoppedEarly:stoppedEarly,searchSessionKey:cacheKeyV1,
    elapsedMs:elapsedMs,timingV23:timing,timingV30:timing,
    speed:{
      masterMs:masterReadMs,snapshotMs:Number(scheduleSnapshotV320 && scheduleSnapshotV320.loadMs || 0),
      filterMs:filterMsV1,fallbackMs:fallbackMsV1,priceMs:priceMsV1,rankingMs:rankingMsV1,totalMs:elapsedMs,
      masterCount:countersV1.masterTotal,eligibleCount:countersV1.eligibleCount,checkedCount:countersV1.scheduleChecked,
      availableCount:countersV1.availableCount,returnedCount:results.length,fallbackCount:countersV1.fallbackCount
    },
    snapshotV320:{
      enabled:Boolean(scheduleSnapshotV320 && scheduleSnapshotV320.enabled),
      hits:Number(scheduleSnapshotV320 && scheduleSnapshotV320.hits || 0),
      misses:Number(scheduleSnapshotV320 && scheduleSnapshotV320.misses || 0),
      stale:Number(scheduleSnapshotV320 && scheduleSnapshotV320.stale || 0),
      errorCells:Number(scheduleSnapshotV320 && scheduleSnapshotV320.errorCells || 0),
      loadMs:Number(scheduleSnapshotV320 && scheduleSnapshotV320.loadMs || 0),
      cellsRead:Number(scheduleSnapshotV320 && scheduleSnapshotV320.cellsRead || 0),
      modifiedChecks:Number(scheduleSnapshotV320 && scheduleSnapshotV320.modifiedChecks || 0),
      modifiedCheckMs:Number(scheduleSnapshotV320 && scheduleSnapshotV320.modifiedCheckMs || 0),
      modifiedBatchRequests:Number(scheduleSnapshotV320 && scheduleSnapshotV320.modifiedBatchRequests || 0),
      modifiedBatchFiles:Number(scheduleSnapshotV320 && scheduleSnapshotV320.modifiedBatchFiles || 0),
      modifiedBatchSources:Number(scheduleSnapshotV320 && scheduleSnapshotV320.modifiedBatchSources || 0),
      modifiedBatchFailures:Number(scheduleSnapshotV320 && scheduleSnapshotV320.modifiedBatchFailures || 0),
      modifiedBatchMs:Number(scheduleSnapshotV320 && scheduleSnapshotV320.modifiedBatchMs || 0),
      modifiedFallbackChecks:Number(scheduleSnapshotV320 && scheduleSnapshotV320.modifiedFallbackChecks || 0),
      rangeReadV325:Boolean(scheduleSnapshotV320 && scheduleSnapshotV320.rangeReadV325)
    }
  };

  if (completeV1 && cacheAllowedV626) cePutSearchSessionCacheV1_(cacheKeyV1, payloadV1, 300);

  var returnedForLogV626 = exhaustiveModeV626
    ? Math.min(pageSize, Math.max(0, results.length - startCursor))
    : results.length;
  if (CE_CONFIG.FAST_SEARCH_TIMING_LOG === true || debug || elapsedMs >= 5000) {
    Logger.log(JSON.stringify({
      code:"FAST_SEARCH_TIMING_V30",version:"V632_INTERNAL_HIGH_RECALL_RESTORE",mode:searchModeV626,
      city:options.city || "",checkIn:ceDateKey_(startDate),checkOut:ceDateKey_(endDate),
      guests:guestCount,pageSize:pageSize,minPrice:minPrice,maxPrice:maxPrice,sortMode:sortMode,shuffleSeed:shuffleSeed,
      exhaustivePriceSort:exhaustivePriceSortV30,complete:completeV1,partial:!completeV1,
      eligible:countersV1.eligibleCount,checked:countersV1.scheduleChecked,failed:countersV1.failedCount,
      unchecked:countersV1.uncheckedCount,available:countersV1.availableCount,
      returned:returnedForLogV626,matchedTotal:exhaustiveModeV626?results.length:null,
      candidateStart:candidateStartCursorV626,candidateNext:nextCandidateCursorV626,snapshotTarget:snapshotResultLimitV628,snapshotScanLimit:snapshotCandidateScanLimitV628,
      masterReadMs:masterReadMs,elapsedMs:elapsedMs,sourcesOpened:timing.sourcesOpened,sheetLoads:timing.sheetLoads,
      narrowLoads:timing.narrowLoads,fullLoads:timing.fullLoads,fullFallbacks:timing.fullFallbacks,
      loadedCells:timing.loadedCells,contextHits:timing.contextHits || 0,sheetMetaLoads:timing.sheetMetaLoads || 0,
      sheetMetaMs:timing.sheetMetaMs || 0,sourceTiming:debug ? timing.sources : timing.sources.slice(0,10),snapshotV320:payloadV1.snapshotV320
    }));
  }

  if (snapshotOnlyV627) {
    return ceBuildSnapshotFirstResponseV627_(payloadV1, villas.length, candidateStartCursorV626, nextCandidateCursorV626);
  }
  if (exhaustiveModeV626) {
    return ceBuildSearchPageResponseV1_(payloadV1, startCursor, pageSize, false);
  }
  return ceBuildFastCandidatePageResponseV626_(payloadV1, startCursor, nextCandidateCursorV626, villas.length, pageSize);
}

function ceResolveSearchExecutionModeV626_(sortMode, options, exhaustivePriceSort) {
  options = options || {};
  if (options.snapshotOnlyV627 === true) return "SNAPSHOT_FIRST";
  if (options.forceLiveV627 === true) return "LIVE_FALLBACK";
  if (options.exhaustiveAudit === true || options.forceComplete === true) return "EXHAUSTIVE";
  if (exhaustivePriceSort === true) return "EXHAUSTIVE";
  return "FAST_PAGE";
}

function ceBuildSnapshotFirstResponseV627_(payload, candidateCount, candidateStart, nextCandidateCursor) {
  payload = payload || {};
  var results = Array.isArray(payload.results) ? payload.results : [];
  var deferred = Array.isArray(payload.deferredVillaIdsV627) ? payload.deferredVillaIdsV627.filter(Boolean) : [];
  var counters = payload.counters || {};
  var speed = payload.speed || {};
  counters.returnedCount = results.length;
  speed.returnedCount = results.length;
  return {
    success:true,complete:payload.complete===true,partial:payload.complete!==true,
    query:payload.query||{},count:results.length,totalMatched:results.length,
    masterTotal:Number(counters.masterTotal||0),staticEligible:Number(counters.staticEligible||0),
    eligibleCount:Number(counters.eligibleCount||0),checkedCount:Number(counters.scheduleChecked||0),
    checkedVillas:Number(counters.scheduleChecked||0),availableCount:Number(counters.availableCount||0),
    returnedCount:results.length,failedCount:Number(counters.failedCount||0),uncheckedCount:Number(counters.uncheckedCount||0),
    fallbackCount:0,totalCandidates:Number(candidateCount||counters.eligibleCount||0),
    candidateStart:Math.max(0,Number(candidateStart||0)),
    candidateNext:Math.max(0,Number(nextCandidateCursor||candidateStart||0)),
    nextCursor:results.length,
    hasMore:(Math.max(0,Number(nextCandidateCursor||0)) < Number(candidateCount||counters.eligibleCount||0)) || deferred.length>0,
    stoppedEarly:payload.stoppedEarly===true,
    results:results,deferredVillaIdsV627:deferred,candidateIdsV629:Array.isArray(payload.candidateIdsV629)?payload.candidateIdsV629:[],errors:payload.errors||[],
    elapsedMs:Number(payload.elapsedMs||0),cacheHit:false,speed:speed,
    timingV23:payload.timingV23||{},timingV30:payload.timingV30||{},snapshotV320:payload.snapshotV320||{}
  };
}

function ceBuildFastCandidatePageResponseV626_(payload, startCursor, nextCandidateCursor, candidateCount, pageSize) {
  payload = payload || {};
  var results = Array.isArray(payload.results) ? payload.results.slice(0, pageSize) : [];
  var counters = payload.counters || {};
  var speed = payload.speed || {};
  counters.returnedCount = results.length;
  speed.returnedCount = results.length;
  var query = {};
  Object.keys(payload.query || {}).forEach(function(key){ query[key] = payload.query[key]; });
  query.cursor = Math.max(0, Number(startCursor || 0));
  query.pageSize = Math.max(1, Number(pageSize || 12));
  var next = Math.max(query.cursor, Number(nextCandidateCursor || query.cursor));
  var totalCandidates = Math.max(0, Number(candidateCount || counters.eligibleCount || 0));
  // V6.2.7: timeout/cutoff means MORE candidates remain, not "no more".
  var hasMore = next < totalCandidates;
  var complete = payload.complete === true && !hasMore && payload.stoppedEarly !== true;
  return {
    success:true,complete:complete,partial:!complete,
    query:query,count:results.length,totalMatched:null,
    masterTotal:Number(counters.masterTotal||0),staticEligible:Number(counters.staticEligible||0),
    eligibleCount:Number(counters.eligibleCount||0),checkedCount:Number(counters.scheduleChecked||0),
    checkedVillas:Number(counters.scheduleChecked||0),availableCount:Number(counters.availableCount||0),
    priceResolvedCount:Number(counters.priceResolved||0),rankedCount:Number(counters.rankedCount||0),
    returnedCount:results.length,failedCount:Number(counters.failedCount||0),uncheckedCount:Number(counters.uncheckedCount||0),
    fallbackCount:Number(counters.fallbackCount||0),totalCandidates:totalCandidates,
    nextCursor:next,hasMore:hasMore,stoppedEarly:payload.stoppedEarly===true,
    results:results,errors:payload.errors||[],dropReasonCounts:payload.dropReasonCounts||{},dropReasonSamples:payload.dropReasonSamples||{},
    diagnostics:payload.diagnostics||[],elapsedMs:Number(payload.elapsedMs||0),cacheHit:false,
    searchSessionKey:"",speed:speed,timingV23:payload.timingV23||{},timingV30:payload.timingV30||{},
    snapshotV320:payload.snapshotV320||{}
  };
}

function ceSearchLiveErrorReasonV2_(error){
  var message=String(error&&error.message?error.message:error||"").toUpperCase();
  var known=["WHITE_NO_PRICE_B6","VILLA_COLUMN_NOT_FOUND","DATE_NOT_FOUND","DATE_COLUMN_NOT_FOUND","DEADLINE_EXCEEDED","SOURCE_READ_FAILED","PERMISSION_DENIED","SNAPSHOT_DATE_CELL_NOT_FOUND","SNAPSHOT_UNKNOWN_STATE","NO_CALENDAR_ACTIVITY"];
  for(var i=0;i<known.length;i++) if(message.indexOf(known[i])>=0) return known[i];
  return "LIVE_READ_FAILED";
}

function ceIsSearchCompleteV1_(counters,stoppedEarly){
  counters=counters||{};
  return Boolean(
    stoppedEarly!==true &&
    Number(counters.failedCount||0)===0 &&
    Number(counters.uncheckedCount||0)===0 &&
    Number(counters.scheduleChecked||0)===Number(counters.eligibleCount||0)
  );
}

function ceSearchSessionCacheKeyV1_(query){
  query=query||{};
  var identity=query.shuffleSeed ? "SESSION="+String(query.shuffleSeed) : "MASTER=0";
  var raw=JSON.stringify(query)+"|"+identity;
  var digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,raw,Utilities.Charset.UTF_8);
  return "BE_SEARCH_V1_"+Utilities.base64EncodeWebSafe(digest).replace(/=+$/g,"").slice(0,32);
}

var CE_SEARCH_SESSION_BLOCK_SIZE_V1_=25;

function cePutSearchSessionCacheV1_(cacheKey,payload,ttlSeconds){
  payload=payload||{};
  var results=Array.isArray(payload.results)?payload.results:[];
  var blockSize=CE_SEARCH_SESSION_BLOCK_SIZE_V1_;
  var blockCount=Math.ceil(results.length/blockSize);
  for(var i=0;i<blockCount;i++){
    if(!ceCachePutJsonChunksV23_(cacheKey+":RESULTS:"+i,results.slice(i*blockSize,(i+1)*blockSize),ttlSeconds||300))return false;
  }
  var metadata={};
  Object.keys(payload).forEach(function(key){if(key!=="results")metadata[key]=payload[key];});
  metadata.results=[];
  metadata.resultCount=results.length;
  metadata.resultBlockSize=blockSize;
  metadata.resultBlockCount=blockCount;
  return ceCachePutJsonChunksV23_(cacheKey,metadata,ttlSeconds||300);
}

function ceGetSearchSessionPageV1_(cacheKey,cursor,pageSize){
  var metadata=ceCacheGetJsonChunksV23_(cacheKey);
  if(!metadata||metadata.complete!==true)return null;
  if(Array.isArray(metadata.results)&&metadata.results.length)return ceBuildSearchPageResponseV1_(metadata,cursor,pageSize,true);
  var total=Math.max(0,Number(metadata.resultCount||0));
  var blockSize=Math.max(1,Number(metadata.resultBlockSize||CE_SEARCH_SESSION_BLOCK_SIZE_V1_));
  cursor=Math.max(0,Math.min(total,Number(cursor||0)));
  pageSize=Math.max(1,Math.min(50,Number(pageSize||12)));
  var page=[];
  if(total>0&&cursor<total){
    var firstBlock=Math.floor(cursor/blockSize);
    var lastBlock=Math.floor((Math.min(total,cursor+pageSize)-1)/blockSize);
    for(var block=firstBlock;block<=lastBlock;block++){
      var blockRows=ceCacheGetJsonChunksV23_(cacheKey+":RESULTS:"+block);
      if(!Array.isArray(blockRows))return null;
      var blockStart=block*blockSize;
      var from=Math.max(0,cursor-blockStart);
      var to=Math.min(blockRows.length,cursor+pageSize-blockStart);
      page=page.concat(blockRows.slice(from,to));
    }
  }
  return ceBuildSearchPageResponseV1_(metadata,cursor,pageSize,true,page);
}

function ceBuildSearchPageResponseV1_(payload,cursor,pageSize,cacheHit,pageOverride){
  payload=payload||{};
  var all=Array.isArray(payload.results)?payload.results:[];
  var total=Array.isArray(pageOverride)?Math.max(0,Number(payload.resultCount||0)):all.length;
  cursor=Math.max(0,Math.min(total,Number(cursor||0)));
  pageSize=Math.max(1,Math.min(50,Number(pageSize||12)));
  var page=Array.isArray(pageOverride)?pageOverride.slice(0,pageSize):all.slice(cursor,cursor+pageSize);
  var next=cursor+page.length;
  var counters=payload.counters||{};
  counters.returnedCount=page.length;
  var speed=payload.speed||{};
  speed.returnedCount=page.length;
  var query={};
  Object.keys(payload.query||{}).forEach(function(key){query[key]=payload.query[key];});
  query.cursor=cursor; query.pageSize=pageSize;
  return {
    success:true,complete:payload.complete===true,partial:payload.partial===true,
    query:query,count:page.length,totalMatched:total,
    masterTotal:Number(counters.masterTotal||0),staticEligible:Number(counters.staticEligible||0),
    eligibleCount:Number(counters.eligibleCount||0),checkedCount:Number(counters.scheduleChecked||0),
    checkedVillas:Number(counters.scheduleChecked||0),availableCount:Number(counters.availableCount||0),
    priceResolvedCount:Number(counters.priceResolved||0),rankedCount:Number(counters.rankedCount||0),
    returnedCount:page.length,failedCount:Number(counters.failedCount||0),uncheckedCount:Number(counters.uncheckedCount||0),
    fallbackCount:Number(counters.fallbackCount||0),totalCandidates:Number(counters.eligibleCount||0),
    nextCursor:next,hasMore:next<total,stoppedEarly:payload.stoppedEarly===true,
    results:page,errors:payload.errors||[],dropReasonCounts:payload.dropReasonCounts||{},dropReasonSamples:payload.dropReasonSamples||{},
    diagnostics:payload.diagnostics||[],elapsedMs:cacheHit?0:Number(payload.elapsedMs||0),cacheHit:cacheHit===true,
    searchSessionKey:payload.searchSessionKey||"",speed:speed,timingV23:payload.timingV23||{},timingV30:payload.timingV30||{},
    snapshotV320:payload.snapshotV320||{}
  };
}


/* V6.2.4 restored Search V1 compatibility helpers. */
function ceNormalizeMinBedroomsV1_(value){
  var number=Math.floor(Number(value||0));
  return Number.isFinite(number)&&number>=1?Math.min(30,number):0;
}

function ceNormalizeProductFilterV1_(value){
  var normalized=String(value||"ALL").trim().toUpperCase();
  return ["ALL","NGUYEN_CAN","PHONG_RIENG"].indexOf(normalized)>=0?normalized:"ALL";
}

function ceProductTypeMatchesV1_(villaType,filter){
  filter=ceNormalizeProductFilterV1_(filter);
  villaType=String(villaType||"").trim().toUpperCase();
  if(filter==="PHONG_RIENG")return villaType==="PHONG_RIENG";
  if(filter==="NGUYEN_CAN")return villaType!=="PHONG_RIENG";
  return true;
}

function ceResolveSearchVillaSelectorV2_(selector, source, villas) {
  selector=String(selector||"").trim();
  source=String(source||"").trim();
  villas=Array.isArray(villas)?villas:[];
  if(!selector)return {found:false,dropReason:"EMPTY_SELECTOR",candidates:[]};

  var explicitParts=selector.split("|");
  if(!source&&explicitParts.length>=2){
    selector=String(explicitParts.shift()||"").trim();
    source=String(explicitParts.join("|")||"").trim();
  }
  var selectorId=selector.toUpperCase();
  var byId=villas.filter(function(villa){
    return String(villa&&villa.id||"").trim().toUpperCase()===selectorId;
  });
  if(byId.length===1)return {found:true,resolvedBy:"VILLA_ID",villa:byId[0],candidates:[]};

  var nameKey=typeof normalizeMasterText==="function"
    ?normalizeMasterText(selector)
    :String(selector||"").trim().toLowerCase();
  var sourceKey=typeof normalizeMasterText==="function"
    ?normalizeMasterText(source)
    :String(source||"").trim().toLowerCase();
  var byName=villas.filter(function(villa){
    var currentName=typeof normalizeMasterText==="function"
      ?normalizeMasterText(villa&&villa.name||"")
      :String(villa&&villa.name||"").trim().toLowerCase();
    if(currentName!==nameKey)return false;
    if(!sourceKey)return true;
    var currentSource=typeof normalizeMasterText==="function"
      ?normalizeMasterText(villa&&villa.source||"")
      :String(villa&&villa.source||"").trim().toLowerCase();
    return currentSource===sourceKey;
  });
  if(byName.length===1)return {found:true,resolvedBy:"EXACT_NAME_SOURCE",villa:byName[0],candidates:[]};
  if(byName.length>1){
    return {
      found:false,ambiguous:true,dropReason:"AMBIGUOUS_VILLA_NAME",
      candidates:byName.map(function(villa){return {
        villaId:String(villa.id||""),villaName:String(villa.name||""),source:String(villa.source||"")
      };})
    };
  }
  return {found:false,dropReason:"MASTER_NOT_FOUND",candidates:[]};
}

function ceSortBestCapacityFirstV1_(results, shuffleSeed, minBedrooms) {
  minBedrooms = ceNormalizeMinBedroomsV1_(minBedrooms || 0);
  if(shuffleSeed){
    (results||[]).forEach(function(item){
      item.__rotationScoreV1=ceStableRotationScoreV1_(shuffleSeed,item);
    });
  }
  (results || []).sort(function(a,b) {
    var rankA=ceBestCapacityRankV332_(a);
    var rankB=ceBestCapacityRankV332_(b);
    if(rankA!==rankB)return rankA-rankB;

    var diffA=Number(a&&a.capacityDifference);
    var diffB=Number(b&&b.capacityDifference);
    if(rankA===1&&diffA!==diffB)return diffA-diffB;
    if(rankA===2&&diffA!==diffB)return diffB-diffA;

    if(minBedrooms>0){
      var bedA=Number(a&&a.bedroomsNumber||0);
      var bedB=Number(b&&b.bedroomsNumber||0);
      var bedDiffA=Math.max(0,bedA-minBedrooms);
      var bedDiffB=Math.max(0,bedB-minBedrooms);
      if(bedDiffA!==bedDiffB)return bedDiffA-bedDiffB;
    }

    if(shuffleSeed){
      // UU_TIEN là boost, không phải khóa cứng. Vì vậy một căn priority=3
      // được xuất hiện nhiều hơn nhưng không đứng đầu mọi request mãi mãi.
      var scoreA=Number(a&&a.__rotationScoreV1||0)+
        Math.max(0,Math.min(3,Number(a&&a.priority||0)))*0.22;
      var scoreB=Number(b&&b.__rotationScoreV1||0)+
        Math.max(0,Math.min(3,Number(b&&b.priority||0)))*0.22;
      if(scoreA!==scoreB)return scoreB-scoreA;
    }else{
      var priorityA=Math.max(0,Math.min(3,Number(a&&a.priority||0)));
      var priorityB=Math.max(0,Math.min(3,Number(b&&b.priority||0)));
      if(priorityA!==priorityB)return priorityB-priorityA;
    }

    var sourceCompare=String(a&&a.source||"").localeCompare(String(b&&b.source||""),"vi");
    if(sourceCompare!==0)return sourceCompare;
    return String(a&&a.name||"").localeCompare(String(b&&b.name||""),"vi");
  });
  if(shuffleSeed){
    (results||[]).forEach(function(item){delete item.__rotationScoreV1;});
  }
  return results;
}

function ceStableRotationScoreV1_(seed,villa){
  var key=ceStableShuffleKeyV340_(seed,villa);
  if(!key)return 0;
  var alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  var value=0,scale=1;
  for(var i=0;i<Math.min(6,key.length);i++){
    var digit=alphabet.indexOf(key.charAt(i));
    if(digit<0)digit=0;
    value=value*64+digit;
    scale*=64;
  }
  return scale>1?value/(scale-1):0;
}

function debugSearchVillaJourneyV1(selector, searchParams) {
  selector=String(selector||"").trim();
  searchParams=searchParams||{};
  if(!selector)throw new Error("Thiếu MÃ_CĂN hoặc tên căn cần debug.");

  var masterVillas=ceReadMasterVillas_();
  var resolution=ceResolveSearchVillaSelectorV2_(selector,searchParams.source||"",masterVillas);
  if(!resolution.found){
    var unresolved={
      success:false,code:"SEARCH_VILLA_JOURNEY_V2",selector:selector,
      source:String(searchParams.source||""),villaId:"",villaName:"",
      masterFound:false,staticEligible:false,capacityPass:null,bedroomPass:null,
      snapshotStatus:"NOT_REACHED",availabilityStatus:"NOT_REACHED",
      priceStatus:"NOT_REACHED",rank:null,returned:false,
      dropReason:resolution.dropReason||"MASTER_NOT_FOUND",
      candidates:resolution.candidates||[]
    };
    Logger.log(JSON.stringify(unresolved));
    return unresolved;
  }

  var targetVilla=resolution.villa||{};
  var villaId=String(targetVilla.id||"").trim().toUpperCase();

  var today=new Date();
  var tomorrow=new Date(today.getFullYear(),today.getMonth(),today.getDate()+1);
  var dayAfter=new Date(today.getFullYear(),today.getMonth(),today.getDate()+2);
  var checkIn=searchParams.checkIn||ceDateKey_(tomorrow);
  var checkOut=searchParams.checkOut||ceDateKey_(dayAfter);
  var guests=Math.max(1,Number(searchParams.guests||2));
  var response=ceSearchAvailableVillasInternal_(checkIn,checkOut,guests,{
    city:searchParams.city||"",cursor:Number(searchParams.cursor||0),
    pageSize:Number(searchParams.pageSize||12),minPrice:Number(searchParams.minPrice||0),
    maxPrice:Number(searchParams.maxPrice||0),sortMode:searchParams.sortMode||"BEST",
    shuffleSeed:searchParams.shuffleSeed||"debug_villa_v1",
    minBedrooms:Number(searchParams.minBedrooms||0),
    productType:searchParams.productType||"ALL",debug:true,
    debugVillaId:villaId,exhaustiveAudit:true,maxRuntimeMs:Number(searchParams.maxRuntimeMs||280000)
  });
  var master=targetVilla;
  var trace=(response.diagnostics||[])[0]||{};
  var returned=(response.results||[]).some(function(item){return String(item.villaId||"").trim().toUpperCase()===villaId;});
  var dropReason=returned?"RETURNED":String(trace.dropReason||"");
  if(!dropReason&&Number(trace.rank||0)>0)dropReason="PAGINATED_AFTER_RANKING";
  if(!dropReason&&!response.complete)dropReason="SEARCH_PARTIAL_UNKNOWN";
  if(!dropReason)dropReason="UNEXPLAINED_DROP";
  var result={
    success:true,code:"SEARCH_VILLA_JOURNEY_V2",selector:selector,
    resolvedBy:resolution.resolvedBy||"",villaId:villaId,
    villaName:master&&master.name||trace.villaName||"",masterFound:Boolean(master),
    source:master&&master.source||"",
    staticEligible:trace.staticEligible===true,
    capacityPass:trace.capacityPass===undefined?null:trace.capacityPass,
    bedroomPass:trace.bedroomPass===undefined?null:trace.bedroomPass,
    snapshotStatus:trace.snapshotStatus||"NOT_REACHED",
    availabilityStatus:trace.availabilityStatus||"NOT_REACHED",
    priceStatus:trace.priceStatus||"NOT_REACHED",
    rank:trace.rank||null,returned:returned,
    dropReason:dropReason,complete:response.complete===true,
    partial:response.partial===true,query:response.query
  };
  Logger.log(JSON.stringify(result));
  return result;
}

function promptDebugSearchVillaJourneyV1(){
  var ui=SpreadsheetApp.getUi();
  var idPrompt=ui.prompt(
    "Debug Search",
    "Nhập MÃ_CĂN hoặc TÊN CĂN | NGUỒN (ví dụ VILLA HỒ BƠI TRUNG TÂM | phương Bùi)",
    ui.ButtonSet.OK_CANCEL
  );
  if(idPrompt.getSelectedButton()!==ui.Button.OK)return {success:false,cancelled:true};
  var datePrompt=ui.prompt(
    "Debug Search","Nhập check-in, check-out, số khách theo dạng YYYY-MM-DD,YYYY-MM-DD,10",
    ui.ButtonSet.OK_CANCEL
  );
  if(datePrompt.getSelectedButton()!==ui.Button.OK)return {success:false,cancelled:true};
  var parts=String(datePrompt.getResponseText()||"").split(",").map(function(x){return x.trim();});
  var result=debugSearchVillaJourneyV1(idPrompt.getResponseText(),{
    checkIn:parts[0]||"",checkOut:parts[1]||"",guests:Number(parts[2]||2)
  });
  ui.alert(
    result.masterFound
      ? (result.returned?"FOUND · rank "+result.rank:"DROP/NOT_PAGE · "+(result.dropReason||result.availabilityStatus))
      : (result.dropReason==="AMBIGUOUS_VILLA_NAME"
        ? "Tên căn bị trùng; nhập thêm | NGUỒN"
        : "Không tìm thấy căn trong MASTER_VILLA")
  );
  return result;
}

function ceBuildFastSourcePlansV23_(villas, startCursor) {
  var plans = {};

  for (var i = Math.max(0, Number(startCursor || 0)); i < villas.length; i++) {
    var villa = villas[i] || {};
    var url = String(villa.calendarUrl || "");
    if (!url) continue;

    if (!plans[url]) {
      plans[url] = {
        source: villa.source || "",
        candidates: 0,
        maxColumn: 0,
        requiresFullScan: false
      };
    }

    var plan = plans[url];
    plan.candidates++;

    var sourceColumn = Number(villa.sourceColumn || 0);
    if (sourceColumn > plan.maxColumn) plan.maxColumn = sourceColumn;
    if (sourceColumn <= 0) plan.requiresFullScan = true;

    try {
      if (typeof ceParseGroupOptionsV38_ === "function") {
        var options = ceParseGroupOptionsV38_(villa.config || "") || [];
        options.forEach(function(option) {
          var col = Number(option && option.column || 0);
          if (col > plan.maxColumn) plan.maxColumn = col;
        });
      }
    } catch (ignore) {}
  }

  return plans;
}

function ceOpenSpreadsheetFastV23_(url) {
  var text = String(url || "");
  var match = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  // Mục 10: nguồn đã biết là .xlsx => mở thẳng bản tạm, không thử openById (chắc chắn lỗi).
  if (match && match[1] && typeof beIsKnownXlsxSourceV1_ === "function" && beIsKnownXlsxSourceV1_(match[1])) {
    return beOpenSourceSpreadsheetV_FIX(text);
  }
  if (match && match[1]) {
    // B10: file vừa bị từ chối quyền trong 15 phút qua => báo ngay, không mở lại (tiết kiệm 1-3 giây/nguồn).
    if (ceNoAccessFileCachedB10_(match[1])) {
      throw new Error("PERMISSION_DENIED (cached 15 phút): You do not have permission to access the requested document. fileId=" + match[1]);
    }
    try {
      return SpreadsheetApp.openById(match[1]);
    } catch (e) {
      var msg = String(e && e.message ? e.message : e);
      var classify = saClassifyAccessErrorV1_(msg);
      if (classify === "NO_ACCESS") {
        ceRememberNoAccessFileB10_(match[1]);
        throw e;  // Báo lỗi ngay, không thử openByUrl (tránh gọi API 2 lần)
      }
      // Lỗi tạm thời: thử openByUrl
    }
  }
  return beOpenSourceSpreadsheetV_FIX(text);  // FIX: nguồn .xlsx convert tạm, Google Sheet giữ nguyên
}

/*
 * B10 - Danh sách file bị từ chối quyền gần đây: 1 khóa CacheService (15 phút),
 * đọc 1 lần mỗi lượt chạy. Khi chủ nguồn cấp lại quyền, tối đa 15 phút sau đọc lại được.
 */
var CE_NO_ACCESS_FILES_B10_ = null;
var CE_NO_ACCESS_CACHE_KEY_B10_ = "BE_NO_ACCESS_FILES_B10";
var CE_NO_ACCESS_CACHE_SECONDS_B10_ = 900;

function ceNoAccessFilesB10_() {
  if (CE_NO_ACCESS_FILES_B10_) return CE_NO_ACCESS_FILES_B10_;
  CE_NO_ACCESS_FILES_B10_ = {};
  try {
    var raw = CacheService.getScriptCache().get(CE_NO_ACCESS_CACHE_KEY_B10_);
    var data = raw ? JSON.parse(raw) : {};
    var now = new Date().getTime();
    Object.keys(data || {}).forEach(function(id) {
      if (Number(data[id]) > now) CE_NO_ACCESS_FILES_B10_[id] = Number(data[id]);
    });
  } catch (ignore) {}
  return CE_NO_ACCESS_FILES_B10_;
}

function ceNoAccessFileCachedB10_(fileId) {
  var until = ceNoAccessFilesB10_()[String(fileId || "")];
  return !!until && until > new Date().getTime();
}

function ceRememberNoAccessFileB10_(fileId) {
  try {
    var map = ceNoAccessFilesB10_();
    map[String(fileId || "")] = new Date().getTime() + CE_NO_ACCESS_CACHE_SECONDS_B10_ * 1000;
    CacheService.getScriptCache().put(CE_NO_ACCESS_CACHE_KEY_B10_, JSON.stringify(map), CE_NO_ACCESS_CACHE_SECONDS_B10_);
  } catch (ignore) {}
}

function ceBuildFastSearchTimingV23_(sourceCache, sourceStats, masterReadMs, elapsedMs) {
  var sources = [];
  var sheetLoads = 0;
  var narrowLoads = 0;
  var fullLoads = 0;
  var fullFallbacks = 0;
  var loadedCells = 0;
  var contextHits = 0;
  var sheetMetaLoads = 0;
  var sheetMetaMs = 0;

  Object.keys(sourceStats || {}).forEach(function(url) {
    var stat = sourceStats[url];
    var context = sourceCache[url] || {};
    var t = context.fastTimingV23 || {};
    var t30 = context.fastTimingV30 || {};

    contextHits += Number(t30.contextHits || 0);
    sheetMetaLoads += Number(t30.sheetMetaLoads || 0);
    sheetMetaMs += Number(t30.sheetMetaMs || 0);
    sheetLoads += Number(t.sheetLoads || 0);
    narrowLoads += Number(t.narrowLoads || 0);
    fullLoads += Number(t.fullLoads || 0);
    fullFallbacks += Number(t.fullFallbacks || 0);
    loadedCells += Number(t.loadedCells || 0);

    sources.push({
      source: stat.source || "",
      candidates: stat.candidates || 0,
      checked: stat.checked || 0,
      available: stat.available || 0,
      errors: stat.errors || 0,
      priceFiltered: stat.priceFiltered || 0,
      maxColumn: stat.maxColumn || 0,
      requiresFullScan: Boolean(stat.requiresFullScan),
      openMs: stat.openMs || 0,
      readerMs: stat.readerMs || 0,
      sheetLoads: Number(t.sheetLoads || 0),
      sheetLoadMs: Number(t.sheetLoadMs || 0),
      narrowLoads: Number(t.narrowLoads || 0),
      fullLoads: Number(t.fullLoads || 0),
      fullFallbacks: Number(t.fullFallbacks || 0),
      loadedCells: Number(t.loadedCells || 0),
      contextHits: Number(t30.contextHits || 0),
      sheetMetaLoads: Number(t30.sheetMetaLoads || 0),
      sheetMetaMs: Number(t30.sheetMetaMs || 0)
    });
  });

  sources.sort(function(a, b) {
    return (b.openMs + b.readerMs) - (a.openMs + a.readerMs);
  });

  return {
    masterReadMs: Number(masterReadMs || 0),
    elapsedMs: Number(elapsedMs || 0),
    sourcesOpened: sources.length,
    sheetLoads: sheetLoads,
    narrowLoads: narrowLoads,
    fullLoads: fullLoads,
    fullFallbacks: fullFallbacks,
    loadedCells: loadedCells,
    contextHits: contextHits,
    sheetMetaLoads: sheetMetaLoads,
    sheetMetaMs: sheetMetaMs,
    sources: sources.slice(0, 20)
  };
}

function cePrepareSearchRankingKeysV626_(villas, guestCount, shuffleSeed) {
  (villas || []).forEach(function(villa) {
    if (!villa) return;
    villa.__searchGuestCountV626 = Number(guestCount || 0);
    villa.__searchFitV626 = ceCapacityFit_(villa.standard, guestCount, villa.capacityMin, villa.capacityMax);
    if (shuffleSeed) {
      villa.__searchShuffleSeedV626 = shuffleSeed;
      villa.__searchShuffleKeyV626 = ceStableShuffleKeyV340_(shuffleSeed, villa);
    }
  });
  return villas;
}

function ceCompareVillasBestCapacityV332_(a, b, guestCount, shuffleSeed, priorityScoresV617) {
  var fitA = (a && Number(a.__searchGuestCountV626) === Number(guestCount) && a.__searchFitV626)
    ? a.__searchFitV626 : ceCapacityFit_(a && a.standard, guestCount);
  var fitB = (b && Number(b.__searchGuestCountV626) === Number(guestCount) && b.__searchFitV626)
    ? b.__searchFitV626 : ceCapacityFit_(b && b.standard, guestCount);
  var rankA = ceBestCapacityRankByFitV332_(fitA);
  var rankB = ceBestCapacityRankByFitV332_(fitB);

  if (rankA !== rankB) return rankA - rankB;

  // Căn dư khách: dư ít đứng trước (10 khách: 11, 12, 13...).
  if (rankA === 1 && fitA.difference !== fitB.difference) {
    return fitA.difference - fitB.difference;
  }

  // Căn thiếu khách: thiếu ít đứng trước (9 rồi mới 8).
  if (rankA === 3 && fitA.difference !== fitB.difference) {
    return fitB.difference - fitA.difference;
  }

  // V6.1.7: cùng mức phù hợp sức chứa thì ưu tiên căn nội bộ hay mở lịch.
  if (priorityScoresV617) {
    var priorityA = Number(priorityScoresV617[String(a && a.id || "").trim()] || 0);
    var priorityB = Number(priorityScoresV617[String(b && b.id || "").trim()] || 0);
    if (priorityA !== priorityB) return priorityB - priorityA;
  }

  // V3.4.0: trong cùng mức phù hợp sức chứa, trộn ổn định theo seed của
  // MỘT lượt search. Load-more dùng cùng seed nên không nhảy/skip kết quả.
  if (shuffleSeed) {
    var shuffleA = (a && a.__searchShuffleSeedV626 === shuffleSeed && a.__searchShuffleKeyV626)
      ? a.__searchShuffleKeyV626 : ceStableShuffleKeyV340_(shuffleSeed, a);
    var shuffleB = (b && b.__searchShuffleSeedV626 === shuffleSeed && b.__searchShuffleKeyV626)
      ? b.__searchShuffleKeyV626 : ceStableShuffleKeyV340_(shuffleSeed, b);
    if (shuffleA !== shuffleB) return shuffleA < shuffleB ? -1 : 1;
  }

  var sourceCompare = String(a && a.source || "").localeCompare(
    String(b && b.source || ""),
    "vi"
  );
  if (sourceCompare !== 0) return sourceCompare;

  return String(a && a.name || "").localeCompare(
    String(b && b.name || ""),
    "vi"
  );
}


/**
 * V3.4.3 HIGH RECALL CAPACITY RANK
 *
 * 0 = vừa đủ
 * 1 = biết chắc đủ/dư khách
 * 2 = chưa biết sức chứa -> GIỮ Ở TRÊN nhóm biết chắc thiếu khách
 * 3 = biết chắc thiếu khách
 *
 * Lý do:
 * dữ liệu TIÊU CHUẨN trống không được phép làm villa gần như "mất" khỏi Search.
 * Trước V3.4.3, UNKNOWN đứng sau cả UNDER-CAPACITY nên các căn thiếu metadata
 * có thể bị đẩy xuống tận cuối hàng trăm candidates.
 */
function ceBestCapacityRankV332_(villa) {
  if (!villa || villa.capacityKnown !== true) return 2;

  var difference = Number(villa.capacityDifference);
  if (!Number.isFinite(difference)) return 2;
  if (difference === 0) return 0;
  return difference > 0 ? 1 : 3;
}

function ceBestCapacityRankByFitV332_(fit) {
  if (!fit || fit.known !== true) return 2;

  var difference = Number(fit.difference);
  if (!Number.isFinite(difference)) return 2;
  if (difference === 0) return 0;
  return difference > 0 ? 1 : 3;
}


function ceCapacityFit_(standardValue, guestCount, minValue, maxValue) {
  var guests = Number(guestCount || 0);
  var range = null;

  if (typeof ceParseCapacityRangeV4220_ === "function") {
    range = ceParseCapacityRangeV4220_(standardValue);
  }
  if ((!range || !range.known) && Number(minValue || 0) > 0) {
    var min = Number(minValue || 0);
    var max = Number(maxValue || min);
    if (max < min) { var swap = min; min = max; max = swap; }
    range = {known:true,min:min,max:max,label:min === max ? String(min) : (min + "-" + max)};
  }

  if (!range || !range.known) {
    return {
      known: false,
      standard: 0,
      min: 0,
      max: 0,
      label: "",
      difference: 0,
      distance: 999,
      group: 4
    };
  }

  var minCap = Number(range.min || 0);
  var maxCap = Number(range.max || minCap);
  var difference;
  if (guests < minCap) difference = minCap - guests;
  else if (guests > maxCap) difference = maxCap - guests;
  else difference = 0;

  var distance = Math.abs(difference);
  var group;
  if (difference === 0) {
    group = 1;
  } else if (difference > 0 && difference <= 2) {
    group = 1;
  } else if (difference < 0 && difference >= -2) {
    group = 2;
  } else if (difference >= 3 && difference <= 6) {
    group = 3;
  } else if (difference > 6) {
    group = 5;
  } else {
    group = 6;
  }

  return {
    known: true,
    standard: maxCap,
    min: minCap,
    max: maxCap,
    label: range.label || (minCap === maxCap ? String(minCap) : (minCap + "-" + maxCap)),
    difference: difference,
    distance: distance,
    group: group
  };
}


/**
 * V3.4.4 BALANCED HIGH-RECALL candidate order.
 *
 * Mục tiêu:
 * - EXACT / KNOWN-SURPLUS vẫn là nhóm ưu tiên chính.
 * - UNKNOWN capacity được rải sớm, mặc định khoảng 25% mỗi block candidate
 *   (pageSize=12 => 3 UNKNOWN), để dữ liệu thiếu metadata không bị chôn sâu.
 * - KNOWN-UNDER chỉ đi sau khi nhóm đủ/unknown đã được bố trí.
 * - Không thay filter, không thay availability, không thay price rule.
 * - Deterministic: cùng seed + cùng dữ liệu => cùng thứ tự, nên cursor ổn định.
 */
function ceBalanceBestCandidatesV344_(villas, guestCount, pageSize, shuffleSeed) {
  villas = (villas || []).slice();
  pageSize = Math.max(1, Math.min(50, parseInt(pageSize, 10) || 12));

  var knownGood = [];
  var unknown = [];
  var under = [];

  villas.forEach(function(villa) {
    var fit = (villa && Number(villa.__searchGuestCountV626) === Number(guestCount) && villa.__searchFitV626)
      ? villa.__searchFitV626 : ceCapacityFit_(villa && villa.standard, guestCount);
    var rank = ceBestCapacityRankByFitV332_(fit);

    if (rank === 2) unknown.push(villa);
    else if (rank === 3) under.push(villa);
    else knownGood.push(villa);
  });

  // Không có UNKNOWN thì tuyệt đối giữ nguyên behavior V343.
  if (!unknown.length) return knownGood.concat(under);

  // Với page 12: reserve 3 UNKNOWN. Page nhỏ vẫn reserve tối thiểu 1.
  var unknownSlots = Math.round(pageSize * 0.25);
  unknownSlots = Math.max(1, Math.min(4, unknownSlots));
  if (unknownSlots >= pageSize) unknownSlots = Math.max(1, pageSize - 1);

  var knownSlots = Math.max(1, pageSize - unknownSlots);
  var out = [];
  var ki = 0;
  var ui = 0;

  // Interleave theo block cố định để cursor ổn định xuyên load-more.
  while (ki < knownGood.length || ui < unknown.length) {
    var k = 0;
    while (k < knownSlots && ki < knownGood.length) {
      out.push(knownGood[ki++]);
      k++;
    }

    var u = 0;
    while (u < unknownSlots && ui < unknown.length) {
      out.push(unknown[ui++]);
      u++;
    }

    // Nếu knownGood cạn, đẩy tiếp UNKNOWN; nếu UNKNOWN cạn, vòng sau sẽ
    // tiếp tục knownGood mà không tạo gap giả.
    if (ki >= knownGood.length && ui < unknown.length) {
      while (ui < unknown.length) out.push(unknown[ui++]);
    }
  }

  // Căn biết chắc thiếu khách vẫn ở sau nhóm chưa biết capacity.
  return out.concat(under);
}

/**
 * V3.4.4 regression - Balanced Recall.
 * File: SearchEngine.js
 * Run: testSearchBalancedRecallV344
 */
function testSearchBalancedRecallV344() {
  var guests = 10;
  var pageSize = 12;
  var seed = "balanced_recall_v344";
  var list = [];
  var i;

  // 30 căn biết chắc đủ/dư.
  for (i = 0; i < 30; i++) {
    list.push({id:"K" + i, name:"Known " + i, source:"KNOWN", standard:10 + (i % 3)});
  }
  // 9 căn chưa biết capacity.
  for (i = 0; i < 9; i++) {
    list.push({id:"U" + i, name:"Unknown " + i, source:"UNKNOWN", standard:0});
  }
  // 6 căn biết chắc thiếu.
  for (i = 0; i < 6; i++) {
    list.push({id:"D" + i, name:"Under " + i, source:"UNDER", standard:5});
  }

  list.sort(function(a,b){
    return ceCompareVillasBestCapacityV332_(a,b,guests,seed);
  });

  var one = ceBalanceBestCandidatesV344_(list, guests, pageSize, seed);
  var two = ceBalanceBestCandidatesV344_(list, guests, pageSize, seed);

  var firstPage = one.slice(0,pageSize);
  var unknownCount = firstPage.filter(function(v){
    return ceBestCapacityRankByFitV332_(ceCapacityFit_(v.standard,guests)) === 2;
  }).length;
  var underCount = firstPage.filter(function(v){
    return ceBestCapacityRankByFitV332_(ceCapacityFit_(v.standard,guests)) === 3;
  }).length;

  if (unknownCount < 3) {
    throw new Error("SEARCH_BALANCED_RECALL_V344_FAILED: page đầu cần >=3 UNKNOWN, actual=" + unknownCount);
  }
  if (underCount !== 0) {
    throw new Error("SEARCH_BALANCED_RECALL_V344_FAILED: page đầu không được có KNOWN_UNDER khi còn đủ known/unknown.");
  }
  if (one.map(function(v){return v.id;}).join("|") !== two.map(function(v){return v.id;}).join("|")) {
    throw new Error("SEARCH_BALANCED_RECALL_V344_FAILED: order không deterministic.");
  }

  var firstUnder = -1;
  var lastUnknown = -1;
  one.forEach(function(v,idx){
    var rank = ceBestCapacityRankByFitV332_(ceCapacityFit_(v.standard,guests));
    if (rank === 2) lastUnknown = idx;
    if (rank === 3 && firstUnder < 0) firstUnder = idx;
  });
  if (firstUnder >= 0 && lastUnknown >= 0 && firstUnder < lastUnknown) {
    throw new Error("SEARCH_BALANCED_RECALL_V344_FAILED: KNOWN_UNDER đứng trước UNKNOWN.");
  }

  Logger.log(JSON.stringify({
    code:"SEARCH_BALANCED_RECALL_PASS_V344",
    pageSize:pageSize,
    firstPage:firstPage.map(function(v){return v.id;}),
    unknownCount:unknownCount,
    underCount:underCount,
    total:one.length
  }));

  return {
    success:true,
    version:"3.4.4",
    unknownCount:unknownCount,
    underCount:underCount,
    firstPage:firstPage.map(function(v){return v.id;})
  };
}

/**
 * V3.4.3 regression - HIGH RECALL capacity ranking.
 * UNKNOWN capacity phải đứng trước căn biết chắc thiếu khách.
 *
 * File: SearchEngine.js
 * Run: testSearchCapacityHighRecallV343
 */
function testSearchCapacityHighRecallV343() {
  var guests = 10;
  var seed = "capacity_high_recall_v343";
  var list = [
    {id:"EXACT", name:"Exact", source:"T", standard:10},
    {id:"SURPLUS", name:"Surplus", source:"T", standard:12},
    {id:"UNKNOWN", name:"Unknown", source:"T", standard:0},
    {id:"UNDER", name:"Under", source:"T", standard:8}
  ];

  var ordered = list.slice().sort(function(a,b){
    return ceCompareVillasBestCapacityV332_(a,b,guests,seed);
  }).map(function(x){ return x.id; });

  var expected = ["EXACT","SURPLUS","UNKNOWN","UNDER"];
  if (ordered.join("|") !== expected.join("|")) {
    throw new Error(
      "SEARCH_CAPACITY_HIGH_RECALL_V343_FAILED expected=" +
      expected.join(",") + " actual=" + ordered.join(",")
    );
  }

  var unknownFit = ceCapacityFit_(0, guests);
  var underFit = ceCapacityFit_(8, guests);

  if (!(ceBestCapacityRankByFitV332_(unknownFit) < ceBestCapacityRankByFitV332_(underFit))) {
    throw new Error("SEARCH_CAPACITY_HIGH_RECALL_V343_FAILED: UNKNOWN phải đứng trước UNDER.");
  }

  Logger.log(JSON.stringify({
    code:"SEARCH_CAPACITY_HIGH_RECALL_PASS_V343",
    order:ordered
  }));

  return {success:true, version:"3.4.3", order:ordered};
}

/** V3.4.0 - seed ngắn, an toàn để giữ thứ tự ổn định xuyên load-more. */
function ceNormalizeShuffleSeedV340_(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_-]+/g, "")
    .slice(0, 80);
}

function ceStableShuffleKeyV340_(seed, villa) {
  seed = ceNormalizeShuffleSeedV340_(seed);
  if (!seed) return "";
  villa = villa || {};
  var raw = [
    seed,
    String(villa.id || villa.villaId || ""),
    String(villa.source || ""),
    String(villa.name || "")
  ].join("|");
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    raw,
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, "").slice(0, 18);
}


function testSearchCapacityRangeV4220() {
  var inside = ceCapacityFit_("8-10", 9);
  var below = ceCapacityFit_("8-10", 6);
  var above = ceCapacityFit_("8-10", 12);
  var single = ceCapacityFit_("10", 10);
  if (!inside.known || inside.min !== 8 || inside.max !== 10 || inside.difference !== 0) throw new Error("SEARCH_CAPACITY_RANGE_V4220_INSIDE_FAILED");
  if (below.difference !== 2 || below.group !== 1) throw new Error("SEARCH_CAPACITY_RANGE_V4220_BELOW_FAILED");
  if (above.difference !== -2 || above.group !== 2) throw new Error("SEARCH_CAPACITY_RANGE_V4220_ABOVE_FAILED");
  if (single.min !== 10 || single.max !== 10 || single.difference !== 0) throw new Error("SEARCH_CAPACITY_RANGE_V4220_SINGLE_FAILED");
  var result={success:true,version:"4.22.0",inside:inside,below:below,above:above,single:single};
  Logger.log(JSON.stringify({code:"SEARCH_CAPACITY_RANGE_PASS_V4220",result:result}));
  return result;
}

// ===== V3.4.2 PRODUCT TYPE + BEDROOM HIGH-RECALL FILTER =====
function ceNormalizeProductTypeFilterV342_(value) {
  var text = ceNormalize_(value || "");
  text = String(text || "").replace(/[_-]+/g, " ").replace(/\\s+/g, " ").trim();

  if (
    text === "phong rieng" ||
    text === "phong don" ||
    text === "private room" ||
    text === "room"
  ) return "PHONG_RIENG";

  if (text === "tat ca" || text === "all") return "ALL";
  return "NGUYEN_CAN";
}

function ceIsPrivateRoomV342_(value) {
  var text = ceNormalize_(value || "");
  text = String(text || "").replace(/[_-]+/g, " ").replace(/\\s+/g, " ").trim();
  return text === "phong rieng" || text === "phong don" || text === "private room";
}

// V6.2.5 strict MIN-bedroom filter used by release/search-agent flows.
function ceBedroomNumberFromVillaV625_(villa) {
  villa = villa || {};
  var direct = villa.bedroomsNumber;
  if (direct !== null && direct !== undefined && direct !== "") {
    var number = Number(direct);
    if (Number.isFinite(number) && number >= 1 && number <= 30) return number;
  }
  if (typeof ceParseMasterBedroomsV1_ === "function") {
    var parsed = ceParseMasterBedroomsV1_(villa.bedrooms);
    return parsed === null ? 0 : Number(parsed || 0);
  }
  return ceBedroomsNumberV342_(villa.bedrooms);
}

function ceBedroomsMatchesMinimumV625_(villa, minBedrooms) {
  minBedrooms = ceNormalizeMinBedroomsV1_(minBedrooms || 0);
  if (!minBedrooms) return true;
  var actual = ceBedroomNumberFromVillaV625_(villa);
  // Strict by design: when user asks 4PN+, unknown PN cannot be returned as if it matched.
  return actual >= minBedrooms;
}

function ceProductTypeMatchesV342_(villaType, filterType) {
  filterType = ceNormalizeProductTypeFilterV342_(filterType || "NGUYEN_CAN");
  if (filterType === "ALL") return true;
  var isPrivate = ceIsPrivateRoomV342_(villaType);
  if (filterType === "PHONG_RIENG") return isPrivate;
  // Blank / NGUYEN_CAN / unknown => normal whole-property flow.
  return !isPrivate;
}

function ceBedroomsNumberV342_(value) {
  var text = ceNormalize_(value || "");
  if (!text) return 0;
  var m = text.match(/\d+/);
  return m ? Number(m[0]) : 0;
}

function ceBedroomsMatchesHighRecallV342_(villaBedrooms, wantedBedrooms) {
  wantedBedrooms = Math.max(0, Number(wantedBedrooms || 0));
  if (!wantedBedrooms) return true;
  var actual = ceBedroomsNumberV342_(villaBedrooms);
  // HIGH RECALL: thiếu PN thì vẫn cho hiện; chỉ loại khi biết chắc PN khác.
  if (!actual) return true;
  if (wantedBedrooms >= 8) return actual >= 8;
  return actual === wantedBedrooms;
}

function testSearchAllowedVillaIdsV61(){
  var allowed={"VL-A":true,"VL-C":true};
  var ids=["VL-A","VL-B","VL-C"].filter(function(id){return !!allowed[id];});
  if(ids.join(",")!=="VL-A,VL-C")throw new Error("SEARCH_ALLOWED_IDS_V61_FAILED");
  var result={success:true,code:"SEARCH_ALLOWED_IDS_PASS_V61",cases:1};
  Logger.log(JSON.stringify(result));return result;
}

function testSearchRoomFiltersV342() {
  var cases = [
    [ceProductTypeMatchesV342_("PHONG_RIENG","PHONG_RIENG"), true],
    [ceProductTypeMatchesV342_("","NGUYEN_CAN"), true],
    [ceProductTypeMatchesV342_("NGUYEN_CAN","NGUYEN_CAN"), true],
    [ceProductTypeMatchesV342_("PHONG_RIENG","NGUYEN_CAN"), false],
    [ceBedroomsMatchesHighRecallV342_("4",4), true],
    [ceBedroomsMatchesHighRecallV342_("3",4), false],
    [ceBedroomsMatchesHighRecallV342_("",4), true],
    [ceBedroomsMatchesHighRecallV342_("9",8), true]
  ];
  for (var i=0;i<cases.length;i++) {
    if (cases[i][0] !== cases[i][1]) {
      throw new Error("SEARCH_ROOM_FILTER_V342_FAILED case=" + (i+1));
    }
  }
  Logger.log(JSON.stringify({code:"SEARCH_ROOM_FILTER_PASS_V342",cases:cases.length}));
  return {success:true,cases:cases.length};
}

function searchAvailableVilla(checkIn, checkOut, guests, city, cursor, pageSize, minPrice, maxPrice, sortMode) {
  return searchAvailableVillas(
    checkIn,
    checkOut,
    guests,
    city,
    cursor,
    pageSize,
    minPrice,
    maxPrice,
    sortMode
  );
}

function ceNormalizeCityFilter_(value) {
  var text = ceNormalize_(value || "");
  if (!text) return "";
  if (/^khu vuc khac$|^khac$|^other$|^other area$/.test(text)) return "__other__";
  if (/vung tau|ba ria/.test(text)) return "vung tau";
  if (/da lat|lam dong/.test(text)) return "da lat";
  return text;
}

function ceCityMatchesFilterV23_(villaCity, cityFilter) {
  // V3.4.1: normalize cả 2 phía.
  // Hàm này được gọi từ Search thật lẫn Doctor/test; caller truyền
  // "Đà Lạt" hay "da lat" đều phải cho cùng kết quả.
  var normalizedFilter = ceNormalizeCityFilter_(cityFilter || "");
  if (!normalizedFilter) return true;

  var normalizedVillaCity = ceNormalizeCityFilter_(villaCity || "");

  if (normalizedFilter === "__other__") {
    return (
      normalizedVillaCity !== "da lat" &&
      normalizedVillaCity !== "vung tau"
    );
  }

  return normalizedVillaCity === normalizedFilter;
}


/**
 * V3.4.1 regression - CITY filter phải nhận cả raw UI label và normalized key.
 * Chạy trực tiếp trong Apps Script: testSearchCityFilterV341
 */
function testSearchCityFilterV341() {
  var cases = [
    ["Đà Lạt", "Đà Lạt", true],
    ["Đà Lạt", "da lat", true],
    ["Lâm Đồng", "Đà Lạt", true],
    ["Vũng Tàu", "Vũng Tàu", true],
    ["Bà Rịa - Vũng Tàu", "vung tau", true],
    ["Đà Lạt", "Vũng Tàu", false],
    ["Đà Lạt", "Khu vực khác", false],
    ["Nha Trang", "Khu vực khác", true]
  ];

  cases.forEach(function(c) {
    var actual = ceCityMatchesFilterV23_(c[0], c[1]);
    if (actual !== c[2]) {
      throw new Error(
        "SEARCH_CITY_FILTER_V341_FAILED: villaCity=" + c[0] +
        " filter=" + c[1] + " expected=" + c[2] + " actual=" + actual
      );
    }
  });

  Logger.log(JSON.stringify({
    code: "SEARCH_CITY_FILTER_PASS_V341",
    cases: cases.length
  }));
  return {success:true,cases:cases.length};
}

/**
 * V3.4.1 regression - Search nội bộ HIGH RECALL:
 * giá CONTACT/null không được hard-drop; giá biết rõ vẫn phải tôn trọng range.
 * Chạy trực tiếp trong Apps Script: testSearchPriceHighRecallV341
 */
function testSearchPriceHighRecallV341() {
  var cases = [
    [{totalPrice:null}, 500000, 8000000, true, "CONTACT"],
    [{totalPrice:undefined}, 500000, 8000000, true, "UNDEFINED"],
    [{totalPrice:3000000}, 500000, 8000000, true, "IN_RANGE"],
    [{totalPrice:300000}, 500000, 8000000, false, "BELOW_MIN"],
    [{totalPrice:9000000}, 500000, 8000000, false, "ABOVE_MAX"],
    [{totalPrice:300000}, 0, 0, true, "NO_FILTER"]
  ];

  cases.forEach(function(c) {
    var actual = cePriceMatchesV30_(c[0], c[1], c[2]);
    if (actual !== c[3]) {
      throw new Error(
        "SEARCH_PRICE_HIGH_RECALL_V341_FAILED: " + c[4] +
        " expected=" + c[3] + " actual=" + actual
      );
    }
  });

  Logger.log(JSON.stringify({
    code: "SEARCH_PRICE_HIGH_RECALL_PASS_V341",
    cases: cases.length
  }));
  return {success:true,cases:cases.length};
}
