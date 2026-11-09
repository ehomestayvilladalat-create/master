/**
 * 16_PriceEngine.gs - V3.0 REAL PRICE FILTER / RANKING
 * Giá dùng để lọc luôn là tổng giá CalendarReader vừa đọc từ nguồn thật.
 */

function ceNormalizePriceFilterV30_(value) {
  var n = Number(value || 0);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

function ceNormalizeSortModeV30_(value) {
  var mode = String(value || "BEST").trim().toUpperCase();
  if (["BEST", "PRICE_ASC", "PRICE_DESC"].indexOf(mode) < 0) mode = "BEST";
  return mode;
}

function cePriceMatchesV30_(readResult, minPrice, maxPrice) {
  minPrice = ceNormalizePriceFilterV30_(minPrice);
  maxPrice = ceNormalizePriceFilterV30_(maxPrice);
  var filtering = minPrice > 0 || maxPrice > 0;

  if (!filtering) return true;

  // V3.4.1 HIGH RECALL:
  // Căn đã xác nhận TRỐNG nhưng chưa đọc được giá vẫn phải xuất hiện để Sale
  // còn thấy và tư vấn. cePriceConfidenceRankV30_ sẽ xếp căn thiếu giá sau
  // căn có giá xác định.
  var total = readResult && readResult.totalPrice;
  if (total === null || total === undefined || total === "" || !isFinite(Number(total))) {
    return true;
  }

  total = Number(total);
  if (minPrice > 0 && total < minPrice) return false;
  if (maxPrice > 0 && total > maxPrice) return false;
  return true;
}

function ceCapacitySafetyRankV30_(item) {
  if (!item || item.capacityKnown !== true) return 1;
  return Number(item.capacityDifference || 0) >= 0 ? 0 : 2;
}

function cePriceConfidenceRankV30_(item) {
  return item && item.totalPrice !== null && item.totalPrice !== undefined ? 0 : 1;
}

function ceSortSearchResultsV30_(results, sortMode) {
  sortMode = ceNormalizeSortModeV30_(sortMode);

  results.sort(function(a, b) {
    var aSafety = ceCapacitySafetyRankV30_(a);
    var bSafety = ceCapacitySafetyRankV30_(b);
    if (aSafety !== bSafety) return aSafety - bSafety;

    var aPriceKnown = cePriceConfidenceRankV30_(a);
    var bPriceKnown = cePriceConfidenceRankV30_(b);
    if (aPriceKnown !== bPriceKnown) return aPriceKnown - bPriceKnown;

    if (sortMode === "PRICE_ASC") {
      if (a.totalPrice !== null && b.totalPrice !== null && a.totalPrice !== b.totalPrice) {
        return a.totalPrice - b.totalPrice;
      }
    } else if (sortMode === "PRICE_DESC") {
      if (a.totalPrice !== null && b.totalPrice !== null && a.totalPrice !== b.totalPrice) {
        return b.totalPrice - a.totalPrice;
      }
    } else {
      if (a.capacityFitGroup !== b.capacityFitGroup) {
        return a.capacityFitGroup - b.capacityFitGroup;
      }
      var aDistance = Math.abs(Number(a.capacityDifference || 0));
      var bDistance = Math.abs(Number(b.capacityDifference || 0));
      if (aDistance !== bDistance) return aDistance - bDistance;
      if (a.totalPrice !== null && b.totalPrice !== null && a.totalPrice !== b.totalPrice) {
        return a.totalPrice - b.totalPrice;
      }
    }

    return String(a.name || "").localeCompare(String(b.name || ""), "vi");
  });

  return results;
}

function cePriceFilterIsActiveV30_(minPrice, maxPrice) {
  return ceNormalizePriceFilterV30_(minPrice) > 0 || ceNormalizePriceFilterV30_(maxPrice) > 0;
}
