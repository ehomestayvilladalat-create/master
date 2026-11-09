/**
 * SearchTraceDoctorV1.js
 * EHOME SEARCH TRACE DOCTOR V1.1 - READ ONLY / LIGHTWEIGHT
 *
 * - Load MASTER_VILLA raw + Repository đúng 1 lần/execution.
 * - Không dump toàn bộ raw rows.
 * - Không mở calendar trong regression mặc định.
 * - Có helper trace 1 selector và helper availability 1 villa/lần.
 * - Không ghi MASTER / MASTER_VILLA / source Sheet.
 */

var EHOME_SEARCH_TRACE_V1 = {
  VERSION: "1.3.0-read-only-pagination-v344-aware",
  DEFAULT_PAGE_SIZE: 12,
  DEFAULT_MAX_PAGES: 8,
  MAX_RUNTIME_MS: 220000
};

var ST_TRACE_CONTEXT_V11_ = null;

function stNormalizeV1_(v){
  return ceNormalize_(String(v == null ? "" : v));
}

function stBuildContextV11_(){
  if (ST_TRACE_CONTEXT_V11_) return ST_TRACE_CONTEXT_V11_;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CE_CONFIG.MASTER_VILLA_SHEET);
  if (!sh) throw new Error('Không tìm thấy sheet "' + CE_CONFIG.MASTER_VILLA_SHEET + '".');

  var values = sh.getDataRange().getDisplayValues();
  var headers = values.length ? values[0].map(ceNormalize_) : [];
  var c = {
    id: ceFindHeader_(headers,["ma can","id","villa id"]),
    name: ceFindHeader_(headers,["ten can","ten villa","villa"]),
    source: ceFindHeader_(headers,["nguon","source"]),
    url: ceFindHeader_(headers,["link lich","calendar","link"]),
    city: ceFindHeader_(headers,["thanh pho","city"]),
    standard: ceFindHeader_(headers,["tieu chuan","suc chua"]),
    bedrooms: ceFindHeader_(headers,["pn","phong ngu"]),
    productType: ceFindHeader_(headers,["loai sp","loai_sp","product type","product_type"]),
    sourceColumn: ceFindHeader_(headers,["cot nguon","source column","source col","calendar column"]),
    config: ceFindHeader_(headers,["config","reader","calendar config","kieu lich","bo doc","config lich"])
  };

  var rawRows = [];
  for (var i=1;i<values.length;i++) {
    var r = values[i];
    rawRows.push({
      rowNumber:i+1,
      id:ceCell_(r,c.id),
      name:ceCell_(r,c.name),
      source:ceCell_(r,c.source),
      city:ceCell_(r,c.city),
      calendarUrl:ceCell_(r,c.url),
      standard:ceCell_(r,c.standard),
      bedrooms:ceCell_(r,c.bedrooms),
      productType:ceCell_(r,c.productType),
      sourceColumn:ceCell_(r,c.sourceColumn),
      config:ceCell_(r,c.config)
    });
  }

  ST_TRACE_CONTEXT_V11_ = {
    rawRows:rawRows,
    repo:ceReadMasterVillas_()
  };
  return ST_TRACE_CONTEXT_V11_;
}

function stMatchesSelectorV11_(x,q){
  var id = stNormalizeV1_(x && x.id);
  var name = stNormalizeV1_(x && x.name);
  var source = stNormalizeV1_(x && x.source);
  if (!q) return false;
  return id === q || name === q || source === q;
}

function stMatchesSelectorLooseV12_(x,q){
  var id = stNormalizeV1_(x && x.id);
  var name = stNormalizeV1_(x && x.name);
  var source = stNormalizeV1_(x && x.source);
  if (!q) return false;
  return stMatchesSelectorV11_(x,q) || id.indexOf(q) >= 0 || name.indexOf(q) >= 0 || source.indexOf(q) >= 0;
}

function stStaticCandidateContextV11_(options){
  options = options || {};
  var ctx = stBuildContextV11_();
  var guests = Math.max(1,Number(options.guests || 10));
  var city = ceNormalizeCityFilter_(options.city || "");
  var productType = ceNormalizeProductTypeFilterV342_(options.productType || "NGUYEN_CAN");
  var bedrooms = Math.max(0,parseInt(options.bedrooms,10) || 0);
  var seed = ceNormalizeShuffleSeedV340_(options.shuffleSeed || "trace_v11");

  var candidates = ctx.repo.filter(function(v){
    return ceCityMatchesFilterV23_(v.city,city) &&
      ceProductTypeMatchesV342_(v.productType,productType) &&
      ceBedroomsMatchesHighRecallV342_(v.bedrooms,bedrooms);
  });

  candidates.sort(function(a,b){
    return ceCompareVillasBestCapacityV332_(a,b,guests,seed);
  });

  // V1.3: phản ánh đúng thứ tự production V344 nếu hàm balanced recall đang có.
  if (typeof ceBalanceBestCandidatesV344_ === "function") {
    candidates = ceBalanceBestCandidatesV344_(candidates, guests, 12, seed);
  }

  var positions = {};
  candidates.forEach(function(v,i){ positions[String(v.id||"")] = i+1; });

  return {
    guests:guests,
    city:city,
    productType:productType,
    bedrooms:bedrooms,
    seed:seed,
    candidates:candidates,
    positions:positions
  };
}

function traceSearchVillaV1(selector, options){
  options = options || {};
  var ctx = stBuildContextV11_();
  var q = stNormalizeV1_(selector);
  var raw = ctx.rawRows.filter(function(x){ return stMatchesSelectorV11_(x,q); });
  var repo = ctx.repo.filter(function(x){ return stMatchesSelectorV11_(x,q); });
  var staticCtx = stStaticCandidateContextV11_(options);

  var traces = repo.map(function(v){
    var fit = ceCapacityFit_(v.standard,staticCtx.guests);
    var passCity = ceCityMatchesFilterV23_(v.city,staticCtx.city);
    var passProductType = ceProductTypeMatchesV342_(v.productType,staticCtx.productType);
    var passBedrooms = ceBedroomsMatchesHighRecallV342_(v.bedrooms,staticCtx.bedrooms);
    return {
      id:v.id,
      name:v.name,
      source:v.source,
      standard:Number(v.standard || 0),
      bedrooms:v.bedrooms || "",
      productType:v.productType || "",
      passCity:passCity,
      passProductType:passProductType,
      passBedrooms:passBedrooms,
      staticPass:passCity && passProductType && passBedrooms,
      capacityKnown:fit.known,
      capacityDifference:fit.difference,
      capacityRank:ceBestCapacityRankByFitV332_(fit),
      candidatePosition:staticCtx.positions[String(v.id||"")] || null,
      totalCandidates:staticCtx.candidates.length
    };
  });

  var out = {
    success:true,
    version:EHOME_SEARCH_TRACE_V1.VERSION,
    selector:String(selector||""),
    rawCount:raw.length,
    repositoryCount:repo.length,
    classification:!raw.length ? "NOT_IN_MASTER_VILLA_RAW" :
      (!repo.length ? "RAW_EXISTS_BUT_REPOSITORY_DROPPED" : "REPOSITORY_FOUND"),
    traces:traces
  };

  Logger.log(JSON.stringify({code:"SEARCH_TRACE_V11",result:out}));
  return out;
}

/**
 * Regression nhẹ: chỉ 1 MASTER load + 1 Repository load.
 * Không mở lịch.
 *
 * File: SearchTraceDoctorV1.js
 * Run: testSearchTraceDoctorV11
 */
function testSearchTraceDoctorV11(){
  ST_TRACE_CONTEXT_V11_ = null;
  var selectors = ["Nhà Chang","Thanh Trà","Ngọc Viễn","Jasmine"];
  var ctx = stBuildContextV11_();
  var staticCtx = stStaticCandidateContextV11_({
    guests:10,
    city:"Đà Lạt",
    productType:"NGUYEN_CAN",
    bedrooms:0,
    shuffleSeed:"trace_regression_v11"
  });

  var result = selectors.map(function(selector){
    var q = stNormalizeV1_(selector);
    var raw = ctx.rawRows.filter(function(x){ return stMatchesSelectorV11_(x,q); });
    var repo = ctx.repo.filter(function(x){ return stMatchesSelectorV11_(x,q); });
    return {
      selector:selector,
      raw:raw.length,
      repo:repo.length,
      villas:repo.map(function(v){
        var fit = ceCapacityFit_(v.standard,10);
        return {
          id:v.id,
          name:v.name,
          standard:Number(v.standard || 0),
          capacityRank:ceBestCapacityRankByFitV332_(fit),
          candidatePosition:staticCtx.positions[String(v.id||"")] || null
        };
      })
    };
  });

  Logger.log(JSON.stringify({
    code:"SEARCH_TRACE_DOCTOR_PASS_V11",
    version:EHOME_SEARCH_TRACE_V1.VERSION,
    repositoryCount:ctx.repo.length,
    totalCandidates:staticCtx.candidates.length,
    result:result
  }));

  return {success:true,version:EHOME_SEARCH_TRACE_V1.VERSION,result:result};
}

/**
 * Audit Repository drop chỉ 1 lần đọc.
 *
 * File: SearchTraceDoctorV1.js
 * Run: auditSearchRepositoryDropsV11
 */
function auditSearchRepositoryDropsV11(){
  ST_TRACE_CONTEXT_V11_ = null;
  var ctx = stBuildContextV11_();
  var dropped = ctx.rawRows.filter(function(x){
    return !String(x.name||"").trim() || !String(x.calendarUrl||"").trim();
  }).map(function(x){
    return {
      rowNumber:x.rowNumber,
      id:x.id,
      name:x.name,
      source:x.source,
      missingName:!String(x.name||"").trim(),
      missingCalendarUrl:!String(x.calendarUrl||"").trim()
    };
  });

  var out = {
    success:true,
    version:EHOME_SEARCH_TRACE_V1.VERSION,
    rawRows:ctx.rawRows.length,
    repositoryCount:ctx.repo.length,
    droppedCount:dropped.length,
    dropped:dropped.slice(0,100)
  };

  Logger.log(JSON.stringify({code:"SEARCH_REPOSITORY_DROP_AUDIT_V11",result:out}));
  return out;
}

/**
 * Availability cho đúng 1 căn/lần để tránh timeout.
 *
 * File: SearchTraceDoctorV1.js
 * Run trực tiếp từ editor bằng cách tạo wrapper nếu cần.
 */
function traceSearchAvailabilityV11(selector, checkIn, checkOut, guests){
  ST_TRACE_CONTEXT_V11_ = null;
  var ctx = stBuildContextV11_();
  var q = stNormalizeV1_(selector);
  var repo = ctx.repo.filter(function(x){ return stMatchesSelectorV11_(x,q); });
  if (!repo.length) throw new Error("Không tìm thấy villa trong Repository: " + selector);

  var villa = repo[0];
  var start = ceParseInputDate_(checkIn);
  var end = ceParseInputDate_(checkOut);
  if (!start || !end || end.getTime() <= start.getTime()) {
    throw new Error("Ngày không hợp lệ.");
  }

  var nights = ceListNights_(start,end);
  var guestCount = Math.max(1,Number(guests||2));
  var snapshot = typeof ssLoadScheduleSnapshotContextV320_ === "function"
    ? ssLoadScheduleSnapshotContextV320_(false,nights)
    : null;
  var attempt = null;

  if (snapshot && snapshot.enabled === true && typeof ssTryReadVillaSnapshotV320_ === "function") {
    attempt = ssTryReadVillaSnapshotV320_(snapshot,villa,nights,guestCount);
  }

  var reader = "";
  var rr = null;
  var source = "LIVE_READER";

  if (attempt && attempt.usable === true) {
    reader = attempt.reader || "SNAPSHOT_V320";
    rr = attempt.readResult;
    source = "SNAPSHOT";
  } else {
    var opened = null;
    try {
      opened = ceOpenSpreadsheetFastV23_(villa.calendarUrl);
    } catch (e) {
      var msg = String(e && e.message ? e.message : e);
      var classify = saClassifyAccessErrorV1_(msg);
      if (classify === "NO_ACCESS") {
        return {
          success:false,
          version:EHOME_SEARCH_TRACE_V1.VERSION,
          selector:selector,
          villaId:villa.id,
          name:villa.name,
          source:villa.source,
          error:"NO_ACCESS",
          errorMessage:"Google Sheet không cấp quyền: " + msg
        };
      }
      throw e;
    }

    var plan = ceBuildFastSourcePlansV23_([villa],0)[String(villa.calendarUrl||"")] || {
      source:villa.source||"",
      candidates:1,
      maxColumn:Number(villa.sourceColumn||0),
      requiresFullScan:Number(villa.sourceColumn||0)<=0
    };
    var sourceContext = ceCreateSourceContextV30_(opened,plan);
    reader = ceResolveReader_(villa.config,sourceContext.file,nights[0],false);
    rr = ceReadVillaByReader_(reader,sourceContext,villa,nights,guestCount,false);
  }

  var out = {
    success:true,
    version:EHOME_SEARCH_TRACE_V1.VERSION,
    selector:selector,
    villaId:villa.id,
    name:villa.name,
    source:villa.source,
    availabilitySource:source,
    reader:reader,
    available:Boolean(rr && rr.available),
    priceStatus:rr && rr.priceStatus || "",
    totalPrice:rr && rr.totalPrice,
    snapshotFallbackReason:attempt && !attempt.usable ? attempt.reason || "" : ""
  };

  Logger.log(JSON.stringify({code:"SEARCH_AVAILABILITY_TRACE_V11",result:out}));
  return out;
}


function stDateKeyV12_(date){
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function stTomorrowWindowV13_(){
  var now = new Date();
  var d1 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12, 0, 0, 0);
  var d2 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 12, 0, 0, 0);
  return {
    checkInDate:d1,
    checkOutDate:d2,
    checkInKey:stDateKeyV12_(d1),
    checkOutKey:stDateKeyV12_(d2)
  };
}

/**
 * Trace pagination thật của Search BEST.
 * Đọc đúng api search internal; không sửa dữ liệu.
 */
function traceSearchPaginationV13(checkIn, checkOut, guests, targetIds, maxPages){
  guests = Math.max(1,Number(guests||10));
  targetIds = (targetIds||[]).map(String);
  maxPages = Math.max(1,Math.min(12,Number(maxPages||6)));

  var cursor = 0;
  var pages=[];
  var found={};
  var started = new Date().getTime();

  for(var page=1;page<=maxPages;page++){
    if(new Date().getTime()-started > EHOME_SEARCH_TRACE_V1.MAX_RUNTIME_MS) break;

    var r = ceSearchAvailableVillasInternal_(checkIn,checkOut,guests,{
      city:"Đà Lạt",
      cursor:cursor,
      pageSize:EHOME_SEARCH_TRACE_V1.DEFAULT_PAGE_SIZE,
      minPrice:0,
      maxPrice:0,
      sortMode:"BEST",
      shuffleSeed:"trace_pagination_v13",
      productType:"NGUYEN_CAN",
      bedrooms:0,
      debug:false,
      maxRuntimeMs:120000
    });

    var returnedIds=(r.results||[]).map(function(v){return String(v.villaId||"");});
    targetIds.forEach(function(id){
      if(returnedIds.indexOf(id)>=0 && !found[id]) found[id]={page:page,cursorStart:cursor,cursorEnd:r.nextCursor};
    });

    pages.push({
      page:page,
      cursorStart:cursor,
      cursorEnd:r.nextCursor,
      checked:r.checkedVillas,
      returned:r.count,
      totalCandidates:r.totalCandidates,
      hasMore:r.hasMore,
      stoppedEarly:r.stoppedEarly,
      returnedIds:returnedIds,
      errors:(r.errors||[]).filter(function(e){return targetIds.indexOf(String(e.villaId||""))>=0;})
    });

    if(!r.hasMore || r.nextCursor==null || Number(r.nextCursor)<=cursor) break;
    cursor=Number(r.nextCursor);
  }

  var out={
    success:true,
    version:EHOME_SEARCH_TRACE_V1.VERSION,
    checkIn:(checkIn instanceof Date ? stDateKeyV12_(checkIn) : String(checkIn||"")),
    checkOut:(checkOut instanceof Date ? stDateKeyV12_(checkOut) : String(checkOut||"")),
    guests:guests,
    pages:pages,
    found:found,
    finalCursor:cursor
  };
  Logger.log(JSON.stringify({code:"SEARCH_PAGINATION_TRACE_V12",result:out}));
  return out;
}

/**
 * One-click regression cho 5 căn đang điều tra.
 * Dùng ngày mai -> ngày kia để test live availability hiện tại.
 */
function testSearchPaginationTraceV13(){
  var w=stTomorrowWindowV13_();
  var ids=[
    "VL-894871F480", // COZY SUN
    "VL-67A575FF34", // CACAO
    "VL-AA1A5B1F90", // PINETREE
    "VL-F1361C1C8A", // VILLA NHÀ CHANG
    "VL-D787F52E96"  // 04 Jasmine
  ];

  Logger.log(JSON.stringify({
    code:"SEARCH_PAGINATION_INPUT_V13",
    checkIn:w.checkInKey,
    checkOut:w.checkOutKey,
    checkInValid:!!ceParseInputDate_(w.checkInDate),
    checkOutValid:!!ceParseInputDate_(w.checkOutDate)
  }));

  return traceSearchPaginationV13(
    w.checkInDate,
    w.checkOutDate,
    10,
    ids,
    8
  );
}

/**
 * Soi availability trực tiếp 5 căn, mỗi căn một lần đọc lịch.
 * Chỉ dùng nếu pagination cho thấy cursor đã đi qua nhưng căn không returned.
 */
function testSearchAvailabilityTargetsV13(){
  var w=stTomorrowWindowV13_();
  var targets=[
    "VL-894871F480",
    "VL-67A575FF34",
    "VL-AA1A5B1F90",
    "VL-F1361C1C8A",
    "VL-D787F52E96"
  ];
  var out=[];
  var started=new Date().getTime();
  for(var i=0;i<targets.length;i++){
    if(new Date().getTime()-started > EHOME_SEARCH_TRACE_V1.MAX_RUNTIME_MS) break;
    try{
      out.push(traceSearchAvailabilityV11(targets[i],w.checkInDate,w.checkOutDate,10));
    }catch(e){
      out.push({selector:targets[i],error:String(e&&e.message?e.message:e)});
    }
  }
  Logger.log(JSON.stringify({
    code:"SEARCH_AVAILABILITY_TARGETS_V13",
    checkIn:w.checkInKey,
    checkOut:w.checkOutKey,
    result:out
  }));
  return out;
}

/**
 * Regression selector: Nhà Chang không được match Nhà Chạng Vạng nữa.
 */
function testSearchTraceSelectorExactV12(){
  ST_TRACE_CONTEXT_V11_=null;
  var r=traceSearchVillaV1("Nhà Chang",{guests:10,city:"Đà Lạt",productType:"NGUYEN_CAN",bedrooms:0,shuffleSeed:"selector_exact_v12"});
  if(r.rawCount!==3 || r.repositoryCount!==3){
    throw new Error("SEARCH_TRACE_SELECTOR_EXACT_V12_FAILED raw="+r.rawCount+" repo="+r.repositoryCount);
  }
  Logger.log(JSON.stringify({code:"SEARCH_TRACE_SELECTOR_EXACT_PASS_V12",raw:r.rawCount,repo:r.repositoryCount}));
  return {success:true,raw:r.rawCount,repo:r.repositoryCount};
}


/**
 * V1.3 - kiểm tra vị trí candidate theo đúng Balanced Recall V344.
 * File: SearchTraceDoctorV1.js
 * Run: testSearchTraceBalancedPositionsV13
 */
function testSearchTraceBalancedPositionsV13(){
  ST_TRACE_CONTEXT_V11_=null;
  var targets=["Nhà Chang","Jasmine"];
  var result=targets.map(function(selector){
    return traceSearchVillaV1(selector,{
      guests:10,
      city:"Đà Lạt",
      productType:"NGUYEN_CAN",
      bedrooms:0,
      shuffleSeed:"trace_balanced_v13"
    });
  });

  Logger.log(JSON.stringify({
    code:"SEARCH_TRACE_BALANCED_POSITIONS_PASS_V13",
    version:EHOME_SEARCH_TRACE_V1.VERSION,
    result:result.map(function(r){
      return {
        selector:r.selector,
        rawCount:r.rawCount,
        repositoryCount:r.repositoryCount,
        villas:(r.traces||[]).map(function(v){
          return {
            id:v.id,
            name:v.name,
            capacityRank:v.capacityRank,
            candidatePosition:v.candidatePosition
          };
        })
      };
    })
  }));

  return result;
}
