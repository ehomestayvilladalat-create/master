/** 08_Api.gs - V3.4.2 + V6.2.7 CUSTOMER HTTP BOUNDARY */

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};

    // Internal UI keeps the old flow. google.script.run -> apiSearchVillas().
    if (!p.checkIn && !p.checkOut && !p.guests && !p.action) {
      return HtmlService
        .createTemplateFromFile("Index")
        .evaluate()
        .addMetaTag("viewport","width=device-width, initial-scale=1, viewport-fit=cover")
        .setTitle("EHOME Booking")
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }

    // Never expose raw SearchEngine DTO through public HTTP GET.
    if (!beAllowLegacyRawHttpApiV61_()) {
      return beJsonOutput_({success:false,code:"PUBLIC_RAW_SEARCH_DISABLED_V61",error:"Endpoint này không công bố dữ liệu search nội bộ."});
    }

    return beJsonOutput_(
      searchAvailableVillas(
        p.checkIn, p.checkOut, Number(p.guests), p.city || "",
        Number(p.cursor || 0),
        Number(p.pageSize || (BE_CONFIG.V30_DEFAULT_PAGE_SIZE || 12)),
        Number(p.minPrice || 0), Number(p.maxPrice || 0),
        p.sortMode || "BEST", p.shuffleSeed || "",
        p.productType || "NGUYEN_CAN",
        Number(p.bedrooms || 0)
      )
    );
  } catch (err) {
    return beJsonOutput_({success:false,error:err && err.message ? err.message : String(err)});
  }
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");

    if (body && body.update_id !== undefined && typeof handleTelegramWebhookV31_ === "function") {
      return handleTelegramWebhookV31_(e, body);
    }

    var action = String(body && body.action || "").trim().toUpperCase();
    if (action === "CUSTOMER_SEARCH_V61") {
      return beJsonOutput_(apiCustomerSearchV61(body.request || body));
    }
    if (action === "CUSTOMER_AVAILABILITY_V61") {
      return beJsonOutput_(apiCustomerAvailabilityV61(body.request || body));
    }

    if (!beAllowLegacyRawHttpApiV61_()) {
      return beJsonOutput_({success:false,code:"PUBLIC_RAW_SEARCH_DISABLED_V61",error:"Action không được phép trên public HTTP API."});
    }

    return beJsonOutput_(
      searchAvailableVillas(
        body.checkIn, body.checkOut, Number(body.guests), body.city || "",
        Number(body.cursor || 0),
        Number(body.pageSize || (BE_CONFIG.V30_DEFAULT_PAGE_SIZE || 12)),
        Number(body.minPrice || 0), Number(body.maxPrice || 0),
        body.sortMode || "BEST", body.shuffleSeed || "",
        body.productType || "NGUYEN_CAN",
        Number(body.bedrooms || 0)
      )
    );
  } catch (err) {
    return beJsonOutput_({success:false,error:err && err.message ? err.message : String(err)});
  }
}

function beAllowLegacyRawHttpApiV61_(){
  try {
    return PropertiesService.getScriptProperties().getProperty("BE_ALLOW_LEGACY_RAW_HTTP_API") === "TRUE";
  } catch (ignore) {
    return false;
  }
}

function beJsonOutput_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// Internal Apps Script UI only. Do not route this function through public HTTP.
function apiSearchVillas(request) {
  request = request || {};
  // V6.3.0 INTERNAL ONLY: high-recall mixed availability.
  // BEST + no price filter returns confirmed FREE first, then UNKNOWN cards,
  // without opening live source Sheets merely to fill the first page.
  return ceSearchAvailableVillasInternal_(
    request.checkIn, request.checkOut, Number(request.guests), {
      city:request.city || "",
      cursor:Number(request.cursor || 0),
      pageSize:Number(request.pageSize || (BE_CONFIG.V30_DEFAULT_PAGE_SIZE || 12)),
      minPrice:Number(request.minPrice || 0),
      maxPrice:Number(request.maxPrice || 0),
      sortMode:request.sortMode || "BEST",
      shuffleSeed:request.shuffleSeed || "",
      productType:request.productType || "NGUYEN_CAN",
      bedrooms:Number(request.bedrooms || 0),
      internalMixedV630:true,
      maxRuntimeMs:15000
    }
  );
}

function apiSystemHealthV30() { return getSystemHealthV30(); }
function apiRunImageAuditV30() { return runImageAuditV30(); }

function testPublicApiBoundaryV61(){
  var allowed=beAllowLegacyRawHttpApiV61_();
  if(allowed)throw new Error("PUBLIC_API_BOUNDARY_FAIL_V61: BE_ALLOW_LEGACY_RAW_HTTP_API must not be TRUE for customer launch.");
  var result={success:true,code:"PUBLIC_API_BOUNDARY_PASS_V61",legacyRawHttpEnabled:false,customerActions:["CUSTOMER_SEARCH_V61","CUSTOMER_AVAILABILITY_V61"]};
  Logger.log(JSON.stringify(result));
  return result;
}
