/** 10_Tests.gs */
/** CALENDAR ENGINE V2 - TESTS */

function testCE_Search() {
  var result = searchAvailableVillas(
    "2026-07-26",
    "2026-07-28",
    10
  );

  Logger.log(JSON.stringify(result, null, 2));
}

function testCE_PriceParser() {
  var samples = [
    "3500000",
    "3.500.000",
    "3tr",
    "3tr5",
    "3,5tr",
    "4 triệu",
    "4.000.000đ",
    "1800k"
  ];

  samples.forEach(function(value) {
    Logger.log(value + " => " + ceParsePrice_(value));
  });
}

function testCE_AutoReader() {
  var villas = ceReadMasterVillas_();

  if (!villas.length) {
    throw new Error("MASTER_VILLA chưa có dữ liệu.");
  }

  var villa = villas[0];
  var file = SpreadsheetApp.openByUrl(villa.calendarUrl);
  var reader = ceResolveReader_(villa.config, file, new Date());

  Logger.log({
    villa: villa.name,
    config: villa.config,
    reader: reader
  });
}

function testCE_DateColumnDetection() {
  var sampleDate = new Date(2026, 6, 1);

  var cases = [
    { name: "DATE_A", expected: 0, values: [["Ngày", "Villa A"], [1, ""], [2, ""], [3, ""]] },
    { name: "DATE_B", expected: 1, values: [["Thứ", "Ngày", "Villa A"], ["T2", 1, ""], ["T3", 2, ""], ["T4", 3, ""]] },
    { name: "DATE_C", expected: 2, values: [["STT", "Thứ", "Ngày", "Villa A"], [1, "T2", 1, ""], [2, "T3", 2, ""], [3, "T4", 3, ""]] }
  ];

  cases.forEach(function(testCase) {
    var raw = testCase.values.map(function(row) { return row.slice(); });
    var display = testCase.values.map(function(row) {
      return row.map(function(cell) { return String(cell); });
    });

    var actual = ceDetectDateColumnV1_(
      raw,
      display,
      "Tháng 7 2026",
      sampleDate
    );

    if (actual !== testCase.expected) {
      throw new Error(
        testCase.name + ": expected " +
        testCase.expected + ", actual " + actual
      );
    }

    Logger.log(testCase.name + " => PASS");
  });
}

function testCE_SearchOneVilla() {
  var result = testSearchAvailableVillasLimited(
    "2026-07-29",
    "2026-07-31",
    10,
    1
  );
  Logger.log(JSON.stringify(result, null, 2));
}

function testCE_SearchFiveVillas() {
  var result = testSearchAvailableVillasLimited(
    "2026-07-29",
    "2026-07-31",
    10,
    5
  );
  Logger.log(JSON.stringify(result, null, 2));
}

function testBookingEngineSmoke() {
  var villas = ceReadMasterVillas_();
  var result = {
    success: villas.length > 0,
    totalVillas: villas.length,
    first: villas.length ? villas[0] : null
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function testBookingSearch() {
  var today = new Date();
  var out = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  return testSearchAvailableVillasLimited(
    ceDateKey_(today),
    ceDateKey_(out),
    2,
    5
  );
}

/** Hàm cũ vẫn dùng được nhưng chỉ kiểm tra, không thay đổi MASTER. */
function testMigrationV31() {
  var result = migrateMasterSchema();
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Test parser thuần, không mở Spreadsheet nguồn.
 */
function testMasterMetadataConfigV32() {
  var imageConfig = parseImageConfig(
    "SHEET=Thông tin;LAYOUT=COLUMN;START_COL=3;" +
    "NAME_ROW=2;IMAGE_ROW=6"
  );

  var infoConfig = parseInfoConfig(
    "SHEET=Thông tin;LAYOUT=COLUMN;START_COL=3;" +
    "NAME_ROW=2;INFO_ROW=8;MAPS_ROW=9;STANDARD_ROW=10;BEDROOMS_ROW=11"
  );

  if (
    imageConfig.sheetName !== "Thông tin" ||
    imageConfig.layout !== "COLUMN" ||
    imageConfig.nameRow !== 2 ||
    imageConfig.imageRow !== 6
  ) {
    throw new Error("Parser CONFIG ẢNH không đúng.");
  }

  if (
    infoConfig.sheetName !== "Thông tin" ||
    infoConfig.infoRow !== 8 ||
    infoConfig.mapsRow !== 9 ||
    infoConfig.standardRow !== 10 ||
    infoConfig.bedroomsRow !== 11
  ) {
    throw new Error("Parser CONFIG THÔNG TIN không đúng.");
  }

  var merged = beMergeSeparatedMetadataV32_(
    [{name:"Villa A", image:"https://example.com/a.jpg"}],
    [{name:"Villa A", info:"3PN", maps:"https://maps.example/a"}]
  );

  if (
    merged.length !== 1 ||
    !merged[0].image ||
    merged[0].info !== "3PN" ||
    !merged[0].maps
  ) {
    throw new Error("Ghép CONFIG ẢNH và CONFIG THÔNG TIN không đúng.");
  }

  var result = {
    success: true,
    image: imageConfig,
    info: infoConfig,
    merged: merged
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

// Giữ alias tên test cũ để menu/script cũ không lỗi.
function testMasterMetadataConfigV31() {
  return testMasterMetadataConfigV32();
}

/**
 * Đọc thử nguồn Enable đầu tiên bằng chính CONFIG MASTER.
 * Kiểm tra log: sheet, count, withImage, withInfo, withMaps, sample.
 */
function testMetadataReaderV32() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var master = ss.getSheetByName(BE_CONFIG.MASTER_SHEET);

  if (!master) throw new Error('Không tìm thấy sheet "' + BE_CONFIG.MASTER_SHEET + '"');

  var values = master.getDataRange().getValues();
  if (!values.length) throw new Error("MASTER chưa có dữ liệu.");

  var headers = beHeaderMap_(values[0]);

  for (var row = 1; row < values.length; row++) {
    if (!beBoolCell_(beGetByHeader_(values[row], headers.enable))) continue;

    var link = beGetByHeader_(values[row], headers.link);
    var imageConfig = beGetByHeader_(values[row], headers.configImage);
    var infoConfig = beGetByHeader_(values[row], headers.configInfo);
    var file = SpreadsheetApp.openByUrl(link);

    var imageSheet = imageConfig
      ? beFindMetadataSheetV32_(file, imageConfig, "IMAGE")
      : null;
    var infoSheet = infoConfig
      ? beFindMetadataSheetV32_(file, infoConfig, "INFO")
      : null;

    var imageVillas = imageSheet
      ? beReadInfoSheetV31_(imageSheet, imageConfig)
      : [];
    var infoVillas = infoSheet
      ? beReadInfoSheetV31_(infoSheet, infoConfig)
      : [];
    var villas = beMergeSeparatedMetadataV32_(imageVillas, infoVillas);

    var summary = {
      source: beGetByHeader_(values[row], headers.source),
      configImage: imageConfig,
      configInfo: infoConfig,
      imageSheet: imageSheet ? imageSheet.getName() : "",
      infoSheet: infoSheet ? infoSheet.getName() : "",
      count: villas.length,
      withImage: villas.filter(function(villa) { return !!villa.image; }).length,
      withInfo: villas.filter(function(villa) { return !!villa.info; }).length,
      withMaps: villas.filter(function(villa) { return !!villa.maps; }).length,
      sample: villas.slice(0, 3)
    };

    Logger.log(JSON.stringify(summary, null, 2));
    return summary;
  }

  throw new Error("Không có nguồn Enable để test.");
}

function testMetadataReaderV31() {
  return testMetadataReaderV32();
}

function testBuildMasterV31() {
  var result = buildMasterVilla();
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * V3.2.2 - test thuần dữ liệu cho bộ lọc cột căn ảo.
 * Không mở file nguồn, chạy nhanh trong Apps Script.
 */
function testGhostVillaFilterV322() {
  var input = [
    {name: "C44", sourceColumn: 3, hasRealCellImage: true, hasInfoEvidence: true, infoValueCount: 8},
    {name: "B1", sourceColumn: 4, hasRealCellImage: false, hasInfoEvidence: false, infoValueCount: 0},
    {name: "R14", sourceColumn: 5, hasRealCellImage: false, hasInfoEvidence: false, infoValueCount: 0},
    {name: "A8", sourceColumn: 12, hasRealCellImage: false, hasInfoEvidence: false, infoValueCount: 0},
    {name: "A30", sourceColumn: 39, hasRealCellImage: false, hasInfoEvidence: true, infoValueCount: 7}
  ];

  var imageConfig = "VÙNG_HÀNG_ẢNH=3;REQUIRE_IMAGE=TRUE";
  var infoConfig = "HÀNG_THÔNG_TIN=40-59";

  // V4.19.2: FIXED_ROW + FALLBACK=FALSE => calendar là nguồn sự thật.
  // Thiếu ảnh/thông tin không được làm mất căn.
  var strictOutput = beFilterFixedRowGhostVillasV324_(
    input,
    "FIXED_ROW=4;START_COL=3;END_COL=-1;FALLBACK=FALSE",
    imageConfig,
    infoConfig
  );

  if (strictOutput.length !== input.length) {
    throw new Error(
      "GHOST_FILTER_STRICT_CALENDAR_TRUTH_FAILED_V4192: " +
      JSON.stringify(strictOutput)
    );
  }

  // Regression guard: nguồn còn fallback vẫn giữ bộ lọc ghost cũ.
  var fallbackOutput = beFilterFixedRowGhostVillasV324_(
    input,
    "FIXED_ROW=4;START_COL=3;END_COL=-1;FALLBACK=TRUE",
    imageConfig,
    infoConfig
  );

  if (
    fallbackOutput.length !== 1 ||
    fallbackOutput[0].name !== "C44"
  ) {
    throw new Error(
      "GHOST_FILTER_FALLBACK_GUARD_FAILED_V4192: " +
      JSON.stringify(fallbackOutput)
    );
  }

  Logger.log(JSON.stringify({
    success: true,
    code: "GHOST_FILTER_TEST_PASS_V4192",
    strictKept: strictOutput.map(function(villa) { return villa.name; }),
    fallbackKept: fallbackOutput.map(function(villa) { return villa.name; })
  }));
  return {
    success: true,
    code: "GHOST_FILTER_TEST_PASS_V4192",
    strictOutput: strictOutput,
    fallbackOutput: fallbackOutput
  };
}

function testSearchNgay_8_10_8() {
  var result = testSearchAvailableVillasLimited(
    "2026-08-8",
    "2026-08-10",
    2,
    30
  );

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}
function test_08_10_Aug() {
  var result = testSearchAvailableVillasLimited(
    "2026-08-08",
    "2026-08-10",
    6,
    200,
    "Đà Lạt"
  );

  Logger.log(JSON.stringify({
    code: "TEST_08_10_AUG_RESULT",
    success: result && result.success,
    count: result && result.results ? result.results.length : 0,
    results: result && result.results
      ? result.results.map(function(v) {
          return {
            name: v.name,
            source: v.source,
            price: v.totalPriceText
          };
        })
      : []
  }));

  return result;
}



/** V2.1 - Test nhóm khu vực Web. */
function testAreaGroupV21(){
  var cases=[
    {city:"Đà Lạt",filter:"Đà Lạt",expected:true},
    {city:"Vũng Tàu",filter:"Vũng Tàu",expected:true},
    {city:"Nha Trang",filter:"Khu vực khác",expected:true},
    {city:"Phan Thiết",filter:"Khu vực khác",expected:true},
    {city:"Khu vực khác",filter:"Khu vực khác",expected:true},
    {city:"Đà Lạt",filter:"Khu vực khác",expected:false},
    {city:"Vũng Tàu",filter:"Khu vực khác",expected:false}
  ];

  cases.forEach(function(testCase){
    var actual=ceCityMatchesFilterV23_(
      testCase.city,
      ceNormalizeCityFilter_(testCase.filter)
    );

    if(actual!==testCase.expected){
      throw new Error(
        "AREA FAIL: "+JSON.stringify(testCase)+" actual="+actual
      );
    }
  });

  Logger.log("testAreaGroupV21 => PASS "+cases.length+" cases");
  return true;
}

/** V2.1 - Test config tối ưu không cache ảnh inline. */
function testFastMasterConfigV21(){
  if(BE_CONFIG.IMAGE_CACHE_ENABLED!==true){
    throw new Error("IMAGE_CACHE_ENABLED phải = true để worker hoạt động.");
  }
  if(BE_CONFIG.IMAGE_CACHE_INLINE===true){
    throw new Error("IMAGE_CACHE_INLINE phải = false ở Fast Master.");
  }
  if(typeof ehomeImageCacheWorkerV21_!=="function"){
    throw new Error("Thiếu 14_ImageWorker.gs.");
  }

  Logger.log(JSON.stringify({
    code:"FAST_MASTER_CONFIG_TEST_PASS_V21",
    version:BE_CONFIG.VERSION,
    imageCacheEnabled:BE_CONFIG.IMAGE_CACHE_ENABLED,
    imageCacheInline:BE_CONFIG.IMAGE_CACHE_INLINE,
    imageWorkerSourcesPerRun:BE_CONFIG.IMAGE_WORKER_SOURCES_PER_RUN
  }));
  return true;
}


/** V2.3 - test cấu hình Fast Search, không mở nguồn. */
function testFastSearchConfigV23(){
  var required=[
    "FAST_SEARCH_ENABLED",
    "FAST_SEARCH_MIN_COLUMNS",
    "FAST_SEARCH_COLUMN_MARGIN",
    "FAST_SEARCH_SKIP_NOTES",
    "FAST_SEARCH_FULL_SCAN_ON_NAME_MISMATCH",
    "FAST_SEARCH_TIMING_LOG"
  ];

  required.forEach(function(key){
    if(!(key in CE_CONFIG)){
      throw new Error("Thiếu CE_CONFIG."+key);
    }
  });

  if(CE_CONFIG.FAST_SEARCH_ENABLED!==true){
    throw new Error("FAST_SEARCH_ENABLED phải = true.");
  }

  if(typeof ceBuildFastSourcePlansV23_!=="function"){
    throw new Error("Thiếu SearchEngine V2.3.");
  }

  if(typeof ceMaybeExpandCalendarForVillaV23_!=="function"){
    throw new Error("Thiếu CalendarReader Fast Range Loader V2.3.");
  }

  Logger.log(JSON.stringify({
    code:"FAST_SEARCH_CONFIG_TEST_PASS_V23",
    version:BE_CONFIG.VERSION,
    minColumns:CE_CONFIG.FAST_SEARCH_MIN_COLUMNS,
    margin:CE_CONFIG.FAST_SEARCH_COLUMN_MARGIN,
    skipNotes:CE_CONFIG.FAST_SEARCH_SKIP_NOTES,
    fullFallback:CE_CONFIG.FAST_SEARCH_FULL_SCAN_ON_NAME_MISMATCH
  }));
  return true;
}

/**
 * V2.3 benchmark mẫu. Đổi ngày/khách ở đây nếu cần so đúng truy vấn web.
 * Xem log FAST_SEARCH_TIMING_V23 để biết source nào chậm.
 */
function testFastSearchBenchmarkV23(){
  clearBookingEngineCache();

  var result=searchAvailableVillas(
    "2026-08-11",
    "2026-08-13",
    10,
    "Đà Lạt",
    0,
    12
  );

  Logger.log(JSON.stringify({
    code:"FAST_SEARCH_BENCHMARK_V23",
    elapsedMs:result.elapsedMs,
    checkedVillas:result.checkedVillas,
    returned:result.count,
    timingV23:result.timingV23
  }));
  return result;
}

/** V3.0 - kiểm tra các module core đã được cài đủ. */
function testV30CoreConfig(){
  var requiredFunctions={
    ceCreateSourceContextV30_: typeof ceCreateSourceContextV30_,
    cePriceMatchesV30_: typeof cePriceMatchesV30_,
    ceSortSearchResultsV30_: typeof ceSortSearchResultsV30_,
    runImageAuditV30: typeof runImageAuditV30,
    getSystemHealthV30: typeof getSystemHealthV30
  };

  Object.keys(requiredFunctions).forEach(function(name){
    if(requiredFunctions[name]!=="function"){
      throw new Error("Thiếu module V3.0: "+name);
    }
  });

  if(BE_CONFIG.VERSION!=="5.0.0-v30-accuracy-first-dev"){
    throw new Error("Sai VERSION V3.0: "+BE_CONFIG.VERSION);
  }
  if(CE_CONFIG.V30_ACCURACY_FIRST!==true){
    throw new Error("V30_ACCURACY_FIRST phải = true");
  }

  Logger.log(JSON.stringify({
    code:"V30_CORE_CONFIG_PASS",
    version:BE_CONFIG.VERSION,
    contextCache:CE_CONFIG.V30_CONTEXT_CACHE_ENABLED,
    accuracyFirst:CE_CONFIG.V30_ACCURACY_FIRST
  }));
  return true;
}

/** V3.0 - unit test Price Engine, không mở nguồn. */
function testPriceEngineV30(){
  var known={available:true,totalPrice:4500000,priceStatus:"KNOWN"};
  var unknown={available:true,totalPrice:null,priceStatus:"CONTACT"};

  if(!cePriceMatchesV30_(known,4000000,5000000)) throw new Error("PRICE FILTER known fail");
  if(cePriceMatchesV30_(known,4600000,5000000)) throw new Error("PRICE FILTER min fail");
  if(cePriceMatchesV30_(unknown,1000000,9000000)) throw new Error("UNKNOWN price không được qua filter");
  if(!cePriceMatchesV30_(unknown,0,0)) throw new Error("UNKNOWN price phải được phép khi không filter");

  var items=[
    {name:"B",capacityKnown:true,capacityDifference:0,capacityFitGroup:1,totalPrice:null},
    {name:"A",capacityKnown:true,capacityDifference:1,capacityFitGroup:1,totalPrice:5000000},
    {name:"C",capacityKnown:true,capacityDifference:-1,capacityFitGroup:2,totalPrice:3000000}
  ];
  ceSortSearchResultsV30_(items,"BEST");
  if(items[0].name!=="A") throw new Error("Giá xác định + đủ sức chứa phải ưu tiên trước");

  Logger.log(JSON.stringify({code:"PRICE_ENGINE_PASS_V30"}));
  return true;
}

/**
 * V3.0 Accuracy A/B.
 * So cùng truy vấn với request-local context cache ON/OFF.
 * Hai mode dùng CÙNG quy tắc CalendarReader; khác duy nhất cơ chế tránh API/read lặp.
 */
function testCalendarAccuracyABV30(){
  var previous=CE_CONFIG.V30_CONTEXT_CACHE_ENABLED;
  try{
    clearBookingEngineCache();
    CE_CALENDAR_CONFIG_CACHE_V30_={};
    CE_GROUP_OPTIONS_CACHE_V30_={};
    CE_CONFIG.V30_CONTEXT_CACHE_ENABLED=false;
    var safe=searchAvailableVillas(
      "2026-08-20","2026-08-22",10,"Đà Lạt",0,12,0,0,"BEST"
    );

    clearBookingEngineCache();
    CE_CALENDAR_CONFIG_CACHE_V30_={};
    CE_GROUP_OPTIONS_CACHE_V30_={};
    CE_CONFIG.V30_CONTEXT_CACHE_ENABLED=true;
    var fast=searchAvailableVillas(
      "2026-08-20","2026-08-22",10,"Đà Lạt",0,12,0,0,"BEST"
    );

    var safeMap={};
    (safe.results||[]).forEach(function(v){safeMap[v.villaId||v.name]=v;});
    var fastMap={};
    (fast.results||[]).forEach(function(v){fastMap[v.villaId||v.name]=v;});

    var keys={};
    Object.keys(safeMap).forEach(function(k){keys[k]=true;});
    Object.keys(fastMap).forEach(function(k){keys[k]=true;});
    var mismatches=[];

    Object.keys(keys).forEach(function(k){
      var a=safeMap[k];
      var b=fastMap[k];
      if(!a||!b){
        mismatches.push({villa:k,reason:"RESULT_SET_DIFF",safe:!!a,fast:!!b});
        return;
      }
      if(Number(a.totalPrice||0)!==Number(b.totalPrice||0)){
        mismatches.push({villa:k,reason:"TOTAL_PRICE_DIFF",safe:a.totalPrice,fast:b.totalPrice});
        return;
      }
      var an=(a.nightlyPrices||[]).map(function(n){return [n.date,n.cell,n.price].join("|");}).join(";");
      var bn=(b.nightlyPrices||[]).map(function(n){return [n.date,n.cell,n.price].join("|");}).join(";");
      if(an!==bn){
        mismatches.push({villa:k,reason:"NIGHT_CELL_PRICE_DIFF",safe:an,fast:bn});
      }
    });

    if(mismatches.length){
      Logger.log(JSON.stringify({code:"CALENDAR_ACCURACY_AB_FAIL_V30",mismatches:mismatches.slice(0,20)}));
      throw new Error("Calendar A/B mismatch: "+mismatches.length);
    }

    Logger.log(JSON.stringify({
      code:"CALENDAR_ACCURACY_AB_PASS_V30",
      safeMs:safe.elapsedMs,
      fastMs:fast.elapsedMs,
      safeChecked:safe.checkedVillas,
      fastChecked:fast.checkedVillas,
      results:fast.count
    }));
    return {success:true,safeMs:safe.elapsedMs,fastMs:fast.elapsedMs,count:fast.count};
  } finally {
    CE_CONFIG.V30_CONTEXT_CACHE_ENABLED=previous;
  }
}

/** Benchmark đúng baseline anh đã dùng: 20-22/08, 10 khách, Đà Lạt. */
function testFastSearchBenchmarkV30(){
  clearBookingEngineCache();
  var result=searchAvailableVillas(
    "2026-08-20","2026-08-22",10,"Đà Lạt",0,12,0,0,"BEST"
  );
  Logger.log(JSON.stringify({
    code:"FAST_SEARCH_BENCHMARK_V30",
    elapsedMs:result.elapsedMs,
    checkedVillas:result.checkedVillas,
    returned:result.count,
    timingV30:result.timingV30
  }));
  return result;
}

/** Test filter tổng giá thật 4-6 triệu cho cùng baseline. */
function testPriceFilterSearchV30(){
  clearBookingEngineCache();
  var result=searchAvailableVillas(
    "2026-08-20","2026-08-22",10,"Đà Lạt",0,12,4000000,6000000,"BEST"
  );
  (result.results||[]).forEach(function(v){
    if(v.totalPrice===null || v.totalPrice<4000000 || v.totalPrice>6000000){
      throw new Error("Price filter trả sai: "+v.name+" = "+v.totalPrice);
    }
  });
  Logger.log(JSON.stringify({code:"PRICE_FILTER_SEARCH_PASS_V30",count:result.count,elapsedMs:result.elapsedMs}));
  return result;
}

/**
 * V4.16 - Test thuần logic, KHÔNG đọc/ghi Sheet production.
 * Chứng minh source thiếu/zero chưa được confirm sẽ giữ MASTER cũ; source
 * bình thường hoặc danh sách mất căn đã được Structure Snapshot xác nhận
 * hai lượt mới được phép replace block source.
 */
function testSourceReconcileFailSafeV416(){
  function row(name, source, link, sourceColumn){
    return ["SKU-"+name,"",name,"Đà Lạt",source,link,"","","","",Number(sourceColumn||0),"",""];
  }
  function villa(name, sourceColumn){ return {name:name,sourceColumn:Number(sourceColumn||0)}; }
  function makeConfirmed(names, options){
    options=options||{};
    var nameSet={};
    (names||[]).forEach(function(name){nameSet[normalizeMasterText(name)]=true;});
    return {
      confirmed:true,
      autoRebuildAllowed:options.autoRebuildAllowed!==false,
      renameOnly:options.renameOnly===true,
      effectiveVillaCount:(names||[]).length,
      stableReads:2,
      record:{
        current:{
          effectiveNameSet:nameSet,
          effectiveVillaCount:(names||[]).length,
          _validationReads:2,
          error:""
        }
      }
    };
  }
  function assertV416(condition, message){
    if(!condition)throw new Error("SOURCE_RECONCILE_FAILSAFE_TEST_FAIL_V416: "+message);
  }

  var source="TEST RECONCILE V416";
  var link="https://example.invalid/source-reconcile-v416";
  var previous=[row("A",source,link),row("B",source,link),row("C",source,link),row("D",source,link)];
  var normal=[villa("A"),villa("B"),villa("C"),villa("D")];
  var removed=[villa("A"),villa("B"),villa("D")];
  var queued=0;

  var normalDecision=beAssessSourceReconcileV416_({
    previousRows:previous,
    villas:normal,
    source:source,
    link:link,
    enqueue:function(){queued++;}
  });
  assertV416(normalDecision.allow===true&&normalDecision.mode==="NO_REMOVAL","normal source bị block");
  assertV416(queued===0,"normal source bị đưa vào priority queue");

  var unconfirmedDecision=beAssessSourceReconcileV416_({
    previousRows:previous,
    villas:removed,
    source:source,
    link:link,
    confirmedStructure:null,
    enqueue:function(){queued++;}
  });
  assertV416(unconfirmedDecision.allow===false,"partial read chưa confirm vẫn được purge");
  assertV416(unconfirmedDecision.reason==="STRUCTURE_NOT_CONFIRMED","partial read sai reason");
  assertV416(queued===1,"partial read không được priority check");

  var zeroDecision=beAssessSourceReconcileV416_({
    previousRows:previous,
    villas:[],
    source:source,
    link:link,
    confirmedStructure:null,
    enqueue:function(){queued++;}
  });
  assertV416(zeroDecision.allow===false,"zero villa bất thường vẫn được purge");
  assertV416(queued===2,"zero villa không được priority check");

  var mismatchDecision=beAssessSourceReconcileV416_({
    previousRows:previous,
    villas:removed,
    source:source,
    link:link,
    confirmedStructure:makeConfirmed(["A","B","C","D"])
  });
  assertV416(mismatchDecision.allow===false,"parser/snapshot mismatch vẫn được purge");
  assertV416(mismatchDecision.reason==="STRUCTURE_PARSER_MISMATCH","mismatch sai reason");

  var confirmedDecision=beAssessSourceReconcileV416_({
    previousRows:previous,
    villas:removed,
    source:source,
    link:link,
    confirmedStructure:makeConfirmed(["A","B","D"])
  });
  assertV416(confirmedDecision.allow===true,"removal đã confirm vẫn bị block");
  assertV416(confirmedDecision.mode==="CONFIRMED_REMOVAL","confirmed removal sai mode");
  assertV416(confirmedDecision.missingNames.length===1&&confirmedDecision.missingNames[0]===normalizeMasterText("C"),"không nhận ra villa C stale");

  var renamePrevious=[row("THE MIST VILLA",source,link,10)];
  var renameCurrent=[villa("THE MIST BẢO LỘC",10)];
  var renamePending=beAssessSourceReconcileV416_({
    previousRows:renamePrevious,
    villas:renameCurrent,
    source:source,
    link:link,
    confirmedStructure:null
  });
  assertV416(renamePending.allow===false&&renamePending.reason==="STRUCTURE_NOT_CONFIRMED","thay đổi tên lần đầu không được giữ an toàn");

  var renameConfirmed=beAssessSourceReconcileV416_({
    previousRows:renamePrevious,
    villas:renameCurrent,
    source:source,
    link:link,
    confirmedStructure:makeConfirmed(["THE MIST BẢO LỘC"])
  });
  assertV416(renameConfirmed.allow===true,"tập source mới đã đọc sâu vẫn bị block");
  assertV416(renameConfirmed.mode==="CONFIRMED_REMOVAL","tập source mới sai mode");
  assertV416(renameConfirmed.missingNames.length===1&&renameConfirmed.missingNames[0]===normalizeMasterText("THE MIST VILLA"),"tên cũ không được đánh dấu stale");

  var preservedFullFailure=beMergeMasterVillaRowsWithFailedSourcesV416_(
    [row("OLD SOURCE A",source,link),row("OLD OTHER","OTHER","https://example.invalid/other")],
    [row("NEW OTHER","OTHER","https://example.invalid/other")],
    [{links:[link],sources:[normalizeMasterText(source)]}],
    13
  );
  var preservedNames=preservedFullFailure.map(function(item){return item[2];}).sort().join("|");
  assertV416(preservedNames==="NEW OTHER|OLD SOURCE A","full build không giữ đúng block source bị lỗi");

  var result={
    success:true,
    code:"SOURCE_RECONCILE_FAILSAFE_TEST_PASS_V416",
    normal:normalDecision.mode,
    unconfirmed:unconfirmedDecision.reason,
    zero:zeroDecision.reason,
    mismatch:mismatchDecision.reason,
    confirmed:confirmedDecision.mode,
    renamePending:renamePending.reason,
    renameConfirmed:renameConfirmed.mode,
    fullFailurePreserved:preservedNames
  };
  Logger.log(JSON.stringify(result));
  return result;
}

/**
 * R3 - unit test thuần: không mở/ghi bất kỳ Google Sheet nguồn nào.
 * Kiểm tra parser static không nhầm tiền, giờ, diện tích, xe hoặc policy
 * thành TIÊU CHUẨN/PN.
 */
function testStaticInfoIntegrityV417(){
  function assertV417(actual, expected, label){
    if (String(actual) !== String(expected)) {
      throw new Error(
        "STATIC_INFO_INTEGRITY_TEST_FAIL_V417 " + label +
        " expected=[" + expected + "] actual=[" + actual + "]"
      );
    }
  }

  var cases = [
    {
      id:"A_MONEY_WITH_STANDARD",
      text:"Tiêu chuẩn 4-6 khách. Kê max 700k",
      capacity:"4", bedrooms:""
    },
    {
      id:"B_MONEY_ONLY",
      text:"Sale nâng không quá 500k",
      capacity:"", bedrooms:""
    },
    {
      id:"C_POLICY_CHECKIN",
      text:"check-in 13h, quản gia chuẩn bị trước 1 phòng ngủ",
      capacity:"", bedrooms:""
    },
    {
      id:"D_HXH_STYLE",
      text:"127/26 Hồ Xuân Hương, 3 phòng ngủ, tiêu chuẩn 6-8pax",
      capacity:"6", bedrooms:"3"
    },
    {
      id:"E_STANDARD_AND_MAX",
      text:"2PN 2WC. Tiêu chuẩn/Tối đa: 4-6 khách. Nâng max 500k",
      capacity:"4", bedrooms:"2"
    },
    {
      id:"F_EXPLICIT_FIELDS",
      text:"Số Phòng Ngủ: 5PN; Sức chứa tối đa: 25",
      capacity:"25", bedrooms:"5"
    },
    {
      id:"G_AREA_AND_VEHICLE",
      text:"Hồ bơi 100m2. Xe 50 chỗ.",
      capacity:"", bedrooms:""
    },
    {
      id:"H_BUNGALOW_BED_SIZE",
      text:"Bun 1: bungalow gỗ 1 giường m6x2m",
      capacity:"", bedrooms:""
    }
  ];

  cases.forEach(function(item){
    assertV417(extractMasterStandard(item.text), item.capacity, item.id + " capacity");
    assertV417(extractMasterBedrooms(item.text), item.bedrooms, item.id + " bedrooms");
  });

  var range = beExtractMasterStandardDetailV417_(
    "Tiêu chuẩn 4-6 khách. Tối đa 8 khách"
  );
  assertV417(range.value, "4", "standard must win over max");
  assertV417(range.confidence, "EXPLICIT_LABEL", "standard provenance");

  var ysvilla = beExtractMasterStandardDetailV417_(
    "Giá 3.000.000/đêm/10 khách. Đoàn 18-20 khách"
  );
  assertV417(ysvilla.value, "", "multi package must not choose price number");
  assertV417(ysvilla.reason, "CAPACITY_AMBIGUOUS_MULTI_PACKAGE", "multi package reason");

  var outOfRange = beExtractStructuredMasterStandardV417_("700");
  assertV417(outOfRange, "", "700 must be rejected, never clamped");

  var result = {
    success:true,
    code:"STATIC_INFO_INTEGRITY_TEST_PASS_V417",
    cases:cases.map(function(item){ return item.id; }),
    multiPackage:ysvilla.reason,
    outOfRange:"REJECTED"
  };
  Logger.log(JSON.stringify(result));
  return result;
}

/** V4.18 - preview bảo thủ, hoàn toàn không ghi MASTER_VILLA. */
function previewStaticInfoIntegrityV418(){
  var plan=beBuildStaticInfoPlanV418_();
  PropertiesService.getScriptProperties().setProperty(
    EHOME_STATIC_PREVIEW_PROP_V418_,
    JSON.stringify({
      fingerprint:plan.fingerprint,proposedChanges:plan.autoChanges.length,
      previewedAt:new Date().toISOString()
    })
  );
  var result={
    success:true,code:"STATIC_INFO_PREVIEW_DONE_V418",scanned:plan.scanned,
    proposedChanges:plan.autoChanges.length,invalidCapacity:plan.invalidCapacity,
    blankBedrooms:plan.blankBedrooms,reviewRequired:plan.review.length,
    fingerprint:plan.fingerprint,preview:plan.autoChanges.slice(0,100),
    reviewPreview:plan.review.slice(0,50),
    truncated:plan.autoChanges.length>100||plan.review.length>50
  };
  Logger.log(JSON.stringify(result));
  return result;
}

/** Alias cũ chuyển sang preview V418 để không ai chạy nhầm rule R3 rộng. */
function previewStaticInfoIntegrityV417(){
  return previewStaticInfoIntegrityV418();
}

function testStaticInfoPreservationV418(){
  function assertPreserved_(actual,expected,label){
    if(String(actual)!==String(expected)){
      throw new Error("STATIC_INFO_PRESERVATION_TEST_FAIL_V418 "+label+
        " expected=["+expected+"] actual=["+actual+"]");
    }
  }
  var oldRow=["VL-OLD","","Villa","","Nguồn","","8","3","","",0,"","","",0];
  var emptyNew=["VL-OLD","","Villa","","Nguồn","","","","","",0,"","","",0];
  var preserved=bePreserveTrustedStaticMasterRowV418_(oldRow,emptyNew,15);
  assertPreserved_(preserved[6],"8","preserve valid capacity when parser has no evidence");
  assertPreserved_(preserved[7],"3","preserve valid PN when parser has no evidence");
  var badOld=["VL-BAD","","Villa","","Nguồn","","700","1","","",0,"","","",0];
  var rejected=bePreserveTrustedStaticMasterRowV418_(badOld,emptyNew,15);
  assertPreserved_(rejected[6],"","never preserve capacity 700");
  var result={success:true,code:"STATIC_INFO_PRESERVATION_TEST_PASS_V418"};
  Logger.log(JSON.stringify(result));
  return result;
}

/* ================= SEARCH RELEASE TESTS V1 ================= */

var EHOME_SEARCH_BENCHMARK_PROP_V1_="EHOME_SEARCH_BENCHMARK_V1";

function searchAssertV1_(condition,message){
  if(!condition)throw new Error("SEARCH_TEST_FAIL_V1: "+message);
}

function testSearchCompletenessInvariantV1(){
  var complete={eligibleCount:300,scheduleChecked:300,failedCount:0,uncheckedCount:0};
  var cutoff={eligibleCount:300,scheduleChecked:80,failedCount:0,uncheckedCount:220};
  var failed={eligibleCount:300,scheduleChecked:299,failedCount:1,uncheckedCount:0};
  searchAssertV1_(ceIsSearchCompleteV1_(complete,false)===true,"300/300 phải complete");
  searchAssertV1_(ceIsSearchCompleteV1_(cutoff,false)===false,"80/300 không được complete");
  searchAssertV1_(ceIsSearchCompleteV1_(failed,false)===false,"read failure không được complete");
  searchAssertV1_(ceIsSearchCompleteV1_(complete,true)===false,"timeout không được complete");
  var result={
    success:true,code:"SEARCH_COMPLETENESS_INVARIANT_PASS_V1",
    full:"300/300 COMPLETE",cutoff:"80/300 PARTIAL",failure:"299+1 FAILED PARTIAL"
  };
  Logger.log(JSON.stringify(result));
  return result;
}

function testSearchStaticFiltersV1(){
  searchAssertV1_(ceParseMasterCapacityV1_("100")===100,"capacity 100 phải hợp lệ");
  searchAssertV1_(ceParseMasterCapacityV1_("101")===null,"capacity >100 phải INVALID, không clamp");
  searchAssertV1_(ceParseMasterCapacityV1_("700k")===null,"tiền không được thành capacity");
  searchAssertV1_(ceParseMasterBedroomsV1_("5PN")===5,"5PN phải parse thành 5");
  searchAssertV1_(ceParseMasterBedroomsV1_("Số phòng ngủ: 6")===6,"nhãn PN phải parse");
  searchAssertV1_(ceParseMasterBedroomsV1_("check-in 13h")===null,"giờ không được thành PN");
  searchAssertV1_(ceNormalizeMinBedroomsV1_(4)===4,"minBedrooms 4");
  searchAssertV1_(ceProductTypeMatchesV1_("PHONG_RIENG","PHONG_RIENG")===true,"phòng riêng include");
  searchAssertV1_(ceProductTypeMatchesV1_("PHONG_RIENG","NGUYEN_CAN")===false,"nguyên căn exclude phòng riêng");
  searchAssertV1_(ceProductTypeMatchesV1_("","NGUYEN_CAN")===true,"blank giữ behavior nguyên căn");
  var mapped=ceMasterVillasFromRowsV1_(
    ["MÃ CĂN","ẢNH","TÊN CĂN","THÀNH PHỐ","NGUỒN","LINK LỊCH","TIÊU CHUẨN","PN","THÔNG TIN","MAPS","CỘT NGUỒN","CONFIG LỊCH","CẬP NHẬT","LOAI_SP","UU_TIEN"],
    [["VL-TEST","","Test","Đà Lạt","S","https://docs.google.com/spreadsheets/d/test","10","4","","",3,"AUTO","","PHONG_RIENG",3]]
  );
  searchAssertV1_(mapped.length===1&&mapped[0].productType==="PHONG_RIENG"&&mapped[0].priority===3,
    "header LOAI_SP/UU_TIEN phải map đúng vào Search model");
  var result={success:true,code:"SEARCH_STATIC_FILTERS_PASS_V1",capacityMax:100,bedrooms:"1PN+..6PN+",productType:true};
  Logger.log(JSON.stringify(result));
  return result;
}


function testSearchMinBedroomsContractV625(){
  searchAssertV1_(ceBedroomsMatchesMinimumV625_({bedrooms:"4"},4)===true,"4PN phải match 4PN+");
  searchAssertV1_(ceBedroomsMatchesMinimumV625_({bedrooms:"5PN"},4)===true,"5PN phải match 4PN+");
  searchAssertV1_(ceBedroomsMatchesMinimumV625_({bedrooms:"3"},4)===false,"3PN không được match 4PN+");
  searchAssertV1_(ceBedroomsMatchesMinimumV625_({bedrooms:""},4)===false,"PN blank không được match 4PN+");
  searchAssertV1_(ceBedroomsMatchesMinimumV625_({bedroomsNumber:6,bedrooms:""},4)===true,"bedroomsNumber phải được ưu tiên");
  var result={success:true,code:"SEARCH_MIN_BEDROOMS_CONTRACT_PASS_V625",cases:5,strictUnknownBlocked:true};
  Logger.log(JSON.stringify(result));
  return result;
}

function testSearchRankingPaginationV1(){
  function item_(id,capacity,priority,price){
    var fit=ceCapacityFit_(capacity,10);
    return {
      villaId:id,id:id,name:id,source:"TEST",priority:priority||0,
      capacityKnown:fit.known,capacityDifference:fit.difference,
      capacityFitGroup:fit.group,totalPrice:price
    };
  }
  var best=[
    item_("CAP30",30,3,100),item_("CAP12_LOW",12,0,300),
    item_("CAP10",10,0,500),item_("CAP12_HIGH",12,3,400),item_("UNKNOWN","",3,null)
  ];
  ceSortBestCapacityFirstV1_(best,"",0);
  searchAssertV1_(best.map(function(x){return x.villaId;}).join(",")==="CAP10,CAP12_HIGH,CAP12_LOW,CAP30,UNKNOWN",
    "BEST phải capacity-fit trước, UU_TIEN chỉ phá hòa");

  var asc=[item_("P3",10,3,300),item_("P1",30,0,100),item_("P2",12,0,200)];
  ceSortSearchResultsV30_(asc,"PRICE_ASC");
  searchAssertV1_(asc.map(function(x){return x.villaId;}).join(",")==="P1,P2,P3","PRICE_ASC phải tuyệt đối theo giá");
  ceSortSearchResultsV30_(asc,"PRICE_DESC");
  searchAssertV1_(asc.map(function(x){return x.villaId;}).join(",")==="P3,P2,P1","PRICE_DESC phải tuyệt đối theo giá");

  var rotationWinners={};
  for(var seedIndex=0;seedIndex<40;seedIndex++){
    var rotated=[item_("ROTATE_PRIORITY_3",10,3,300),item_("ROTATE_PRIORITY_2",10,2,300),item_("ROTATE_PRIORITY_0",10,0,300)];
    ceSortBestCapacityFirstV1_(rotated,"rotation_seed_"+seedIndex,0);
    rotationWinners[rotated[0].villaId]=Number(rotationWinners[rotated[0].villaId]||0)+1;
  }
  searchAssertV1_(Object.keys(rotationWinners).length>=2,"UU_TIEN=3 không được khóa cứng vị trí đầu mọi request");

  var rows=[];
  for(var i=0;i<31;i++)rows.push({villaId:"V"+i,name:"V"+i});
  var payload={complete:true,partial:false,results:rows,counters:{eligibleCount:31,scheduleChecked:31,availableCount:31,rankedCount:31},speed:{}};
  var page1=ceBuildSearchPageResponseV1_(payload,0,12,false);
  var page2=ceBuildSearchPageResponseV1_(payload,12,12,false);
  var ids1=page1.results.map(function(x){return x.villaId;});
  var ids2=page2.results.map(function(x){return x.villaId;});
  searchAssertV1_(page1.nextCursor===12&&page2.nextCursor===24,"cursor phải đi 0→12→24");
  searchAssertV1_(ids1.filter(function(id){return ids2.indexOf(id)>=0;}).length===0,"page 1/2 không duplicate");
  var result={success:true,code:"SEARCH_RANKING_PAGINATION_PASS_V1",best:best.map(function(x){return x.villaId;}),priceAsc:["P1","P2","P3"],rotationWinners:rotationWinners,pagination:"NO_DUPLICATE"};
  Logger.log(JSON.stringify(result));
  return result;
}

function testScheduleSnapshotStatusV1(){
  searchAssertV1_(ssNormalizeQueueStatusV1_("OK","rows=8 cells=960 errors=0")==="OK","errors=0 mới được OK");
  searchAssertV1_(ssNormalizeQueueStatusV1_("OK","rows=8 cells=960 errors=3")==="PARTIAL","errors>0 phải PARTIAL");
  searchAssertV1_(ssDecodeNightCellV320_("E|BROKEN").status==="ERROR","snapshot error không được thành FREE");

  var sh=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EHOME_SCHEDULE_SNAPSHOT_V320.QUEUE_SHEET);
  var rawMisclassified=0;
  var counts={};
  if(sh&&sh.getLastRow()>1){
    sh.getRange(2,5,sh.getLastRow()-1,4).getDisplayValues().forEach(function(row){
      var raw=String(row[0]||"").toUpperCase();
      var normalized=ssNormalizeQueueStatusV1_(raw,row[3]);
      counts[normalized]=Number(counts[normalized]||0)+1;
      if(raw==="OK"&&normalized==="PARTIAL")rawMisclassified++;
    });
  }
  searchAssertV1_(rawMisclassified===0,
    "còn "+rawMisclassified+" queue row OK nhưng errors>0; chạy repairScheduleSnapshotStatusesV1 trước");
  var result={success:true,code:"SNAPSHOT_STATUS_PASS_V1",rawMisclassified:rawMisclassified,statusCounts:counts};
  Logger.log(JSON.stringify(result));
  return result;
}

function testStaticDataReleaseGateV418(){
  var sh=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BE_CONFIG.MASTER_VILLA_SHEET||"MASTER_VILLA");
  if(!sh||sh.getLastRow()<2)throw new Error("MASTER_VILLA_EMPTY");
  var values=sh.getDataRange().getDisplayValues();
  var headers=values[0].map(function(x){return normalizeMasterText(x);});
  var capCol=headers.indexOf(normalizeMasterText("TIÊU CHUẨN"));
  var pnCol=headers.indexOf(normalizeMasterText("PN"));
  var invalidCapacity=0,blankBedrooms=0,validBedrooms=0;
  values.slice(1).forEach(function(row){
    var cap=String(row[capCol]||"").trim();
    if(/^\d+$/.test(cap)&&Number(cap)>100)invalidCapacity++;
    var pn=String(row[pnCol]||"").trim();
    if(!pn)blankBedrooms++;
    else if(ceParseMasterBedroomsV1_(pn)!==null)validBedrooms++;
  });
  searchAssertV1_(invalidCapacity===0,"capacity >100 còn "+invalidCapacity+" dòng");
  var parser=testStaticInfoIntegrityV417();
  var result={success:true,code:"STATIC_DATA_RELEASE_GATE_PASS_V418",totalVillas:values.length-1,invalidCapacity:invalidCapacity,blankBedrooms:blankBedrooms,validBedrooms:validBedrooms,parser:parser.code};
  Logger.log(JSON.stringify(result));
  return result;
}

function testSearchManualFieldsV1(){
  var sh=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BE_CONFIG.MASTER_VILLA_SHEET||"MASTER_VILLA");
  if(!sh)throw new Error("MASTER_VILLA_MISSING");
  var values=sh.getDataRange().getDisplayValues();
  var headers=values[0].map(function(x){return normalizeMasterText(x);});
  var typeCol=headers.indexOf(normalizeMasterText("LOAI_SP"));
  var priorityCol=headers.indexOf(normalizeMasterText("UU_TIEN"));
  searchAssertV1_(typeCol>=0&&priorityCol>=0,"thiếu LOAI_SP hoặc UU_TIEN");
  var invalidType=0,invalidPriority=0,privateRooms=0;
  values.slice(1).forEach(function(row){
    var type=String(row[typeCol]||"").trim().toUpperCase();
    var priority=String(row[priorityCol]||"").trim();
    if(type&&["PHONG_RIENG","NGUYEN_CAN","COMBO"].indexOf(type)<0)invalidType++;
    if(type==="PHONG_RIENG")privateRooms++;
    if(priority&&["0","1","2","3"].indexOf(priority)<0)invalidPriority++;
  });
  searchAssertV1_(invalidType===0&&invalidPriority===0,"manual field có value sai");
  var result={success:true,code:"SEARCH_MANUAL_FIELDS_PASS_V1",privateRooms:privateRooms,invalidType:invalidType,invalidPriority:invalidPriority};
  Logger.log(JSON.stringify(result));
  return result;
}

function testR2SearchRegressionV1(){
  var villas=ceReadMasterVillas_();
  function source_(name){var key=normalizeMasterText(name);return villas.filter(function(v){return normalizeMasterText(v.source)===key;});}
  function has_(rows,name){var key=normalizeMasterText(name);return rows.some(function(v){return normalizeMasterText(v.name)===key;});}
  var minh=source_("MINH TRUNG");
  var hieu=source_("hiếu the chill");
  searchAssertV1_(has_(minh,"HXH Villa"),"MINH TRUNG thiếu HXH Villa");
  searchAssertV1_(!has_(minh,"THE MIST Villa"),"THE MIST Villa cũ quay lại");
  searchAssertV1_(has_(minh,"THE MIST BẢO LỘC"),"thiếu THE MIST BẢO LỘC");
  searchAssertV1_(hieu.length===5,"hiếu the chill phải có 5 căn, hiện "+hieu.length);
  searchAssertV1_(has_(hieu,"Bên Hiên Gió Về"),"thiếu Bên Hiên Gió Về");
  var failSafe=typeof testSourceReconcileFailSafeV416==="function"?testSourceReconcileFailSafeV416():null;
  searchAssertV1_(failSafe&&failSafe.success===true,"R2 fail-safe unit test không PASS");
  var result={success:true,code:"R2_SEARCH_REGRESSION_PASS_V1",minhTrung:minh.map(function(v){return v.name;}),hieuCount:hieu.length,failSafe:failSafe.code};
  Logger.log(JSON.stringify(result));
  return result;
}

function searchBenchmarkDatesV1_(){
  var today=new Date();
  var checkIn=new Date(today.getFullYear(),today.getMonth(),today.getDate()+1);
  var checkOut=new Date(today.getFullYear(),today.getMonth(),today.getDate()+2);
  return {checkIn:ceDateKey_(checkIn),checkOut:ceDateKey_(checkOut)};
}

function startSearchBenchmarkV1(){
  var dates=searchBenchmarkDatesV1_();
  var state={
    version:1,startedAt:new Date().toISOString(),checkIn:dates.checkIn,checkOut:dates.checkOut,index:0,
    cases:[
      {id:"GUESTS_2",guests:2,productType:"ALL",minBedrooms:0},
      {id:"GUESTS_6",guests:6,productType:"ALL",minBedrooms:0},
      {id:"GUESTS_10",guests:10,productType:"ALL",minBedrooms:0},
      {id:"GUESTS_15",guests:15,productType:"ALL",minBedrooms:0},
      {id:"GUESTS_20",guests:20,productType:"ALL",minBedrooms:0},
      {id:"PRIVATE_2",guests:2,productType:"PHONG_RIENG",minBedrooms:0},
      {id:"GUESTS_10_4PN",guests:10,productType:"ALL",minBedrooms:4}
    ],samples:[]
  };
  PropertiesService.getScriptProperties().setProperty(EHOME_SEARCH_BENCHMARK_PROP_V1_,JSON.stringify(state));
  var result={success:true,code:"SEARCH_BENCHMARK_STARTED_V1",checkIn:state.checkIn,checkOut:state.checkOut,cases:state.cases.map(function(x){return x.id;}),next:"runNextSearchBenchmarkV1"};
  Logger.log(JSON.stringify(result));
  return result;
}

function searchBenchmarkSummaryV1_(response,query){
  query=query||{};
  var pageResults=response&&response.results||[];
  var minBedrooms=Number(query.minBedrooms||0);
  var productType=String(query.productType||"ALL").toUpperCase();
  var bedroomViolations=minBedrooms>0?pageResults.filter(function(item){
    return !(Number(item&&item.bedroomsNumber)>=minBedrooms);
  }).length:0;
  var productTypeViolations=productType==="PHONG_RIENG"?pageResults.filter(function(item){
    return String(item&&item.productType||"").toUpperCase()!=="PHONG_RIENG";
  }).length:0;
  var snapshot=response&&response.snapshotV320||{};
  var timing=response&&response.timingV23||{};
  return {
    complete:response&&response.complete===true,partial:response&&response.partial===true,
    eligible:Number(response&&response.eligibleCount||0),checked:Number(response&&response.checkedCount||0),
    available:Number(response&&response.availableCount||0),returned:Number(response&&response.returnedCount||0),
    failed:Number(response&&response.failedCount||0),unchecked:Number(response&&response.uncheckedCount||0),
    fallback:Number(response&&response.fallbackCount||0),totalMs:Number(response&&response.speed&&response.speed.totalMs||response&&response.elapsedMs||0),
    modifiedChecks:Number(snapshot.modifiedChecks||0),modifiedCheckMs:Number(snapshot.modifiedCheckMs||0),
    modifiedBatchRequests:Number(snapshot.modifiedBatchRequests||0),modifiedBatchFiles:Number(snapshot.modifiedBatchFiles||0),
    modifiedBatchFailures:Number(snapshot.modifiedBatchFailures||0),modifiedFallbackChecks:Number(snapshot.modifiedFallbackChecks||0),
    sourcesOpened:Number(timing.sourcesOpened||0),sheetLoads:Number(timing.sheetLoads||0),
    filterSemanticsVerified:true,bedroomViolations:bedroomViolations,
    productTypeViolations:productTypeViolations
  };
}

function runNextSearchBenchmarkV1(){
  var props=PropertiesService.getScriptProperties();
  var raw=String(props.getProperty(EHOME_SEARCH_BENCHMARK_PROP_V1_)||"");
  if(!raw)throw new Error("Chạy startSearchBenchmarkV1 trước.");
  var state=JSON.parse(raw);
  if(state.index>=state.cases.length)return getSearchBenchmarkReportV1();
  var item=state.cases[state.index];
  var seed="bench_v1_"+String(state.startedAt).replace(/\D/g,"").slice(0,14)+"_"+state.index;
  function run_(legacy){
    try{
      return {response:ceSearchAvailableVillasInternal_(state.checkIn,state.checkOut,item.guests,{
        city:"Đà Lạt",cursor:0,pageSize:12,minPrice:0,maxPrice:0,sortMode:"BEST",
        shuffleSeed:seed,minBedrooms:item.minBedrooms,productType:item.productType,
        maxVillas:0,debug:false,maxRuntimeMs:250000,legacyEarlyStop:legacy===true
      })};
    }catch(error){return {error:String(error&&error.message?error.message:error)};}
  }
  var beforeRun=run_(true);
  var afterRun=run_(false);
  var sample={
    id:item.id,query:item,
    before:beforeRun.response?searchBenchmarkSummaryV1_(beforeRun.response,item):{error:beforeRun.error},
    after:afterRun.response?searchBenchmarkSummaryV1_(afterRun.response,item):{error:afterRun.error}
  };
  state.samples.push(sample);
  state.index++;
  props.setProperty(EHOME_SEARCH_BENCHMARK_PROP_V1_,JSON.stringify(state));
  var result={success:!sample.after.error,code:"SEARCH_BENCHMARK_CASE_DONE_V1",case:sample,nextIndex:state.index,remaining:state.cases.length-state.index,next:state.index<state.cases.length?"runNextSearchBenchmarkV1":"getSearchBenchmarkReportV1"};
  Logger.log(JSON.stringify(result));
  return result;
}

function searchPercentileV1_(values,percentile){
  values=(values||[]).filter(function(x){return Number.isFinite(Number(x));}).map(Number).sort(function(a,b){return a-b;});
  if(!values.length)return null;
  var index=Math.max(0,Math.ceil(percentile*values.length)-1);
  return values[Math.min(values.length-1,index)];
}

function getSearchBenchmarkReportV1(){
  var raw=String(PropertiesService.getScriptProperties().getProperty(EHOME_SEARCH_BENCHMARK_PROP_V1_)||"");
  if(!raw)throw new Error("Chưa có benchmark V1.");
  var state=JSON.parse(raw);
  var beforeTimes=state.samples.map(function(x){return x.before&&x.before.totalMs;});
  var afterTimes=state.samples.map(function(x){return x.after&&x.after.totalMs;});
  var completenessPass=state.samples.length===state.cases.length&&state.samples.every(function(x){
    return x.after&&!x.after.error&&x.after.complete===true&&x.after.checked===x.after.eligible;
  });
  var accountingPass=state.samples.length===state.cases.length&&state.samples.every(function(x){
    return x.after&&!x.after.error&&Number(x.after.unchecked||0)===0&&
      Number(x.after.checked||0)+Number(x.after.failed||0)===Number(x.after.eligible||0);
  });
  var privateSample=state.samples.filter(function(x){return x.id==="PRIVATE_2";})[0];
  var bedroomSample=state.samples.filter(function(x){return x.id==="GUESTS_10_4PN";})[0];
  var privateFilterPass=Boolean(privateSample&&privateSample.after&&privateSample.after.filterSemanticsVerified===true&&privateSample.after.eligible>0&&Number(privateSample.after.productTypeViolations||0)===0);
  var bedroomFilterPass=Boolean(bedroomSample&&bedroomSample.after&&bedroomSample.after.filterSemanticsVerified===true&&bedroomSample.after.eligible>0&&Number(bedroomSample.after.bedroomViolations||0)===0);
  function stats_(side,times){
    var summaries=state.samples.map(function(x){return x[side]||{};});
    return {
      p50:searchPercentileV1_(times,.50),p95:searchPercentileV1_(times,.95),max:searchPercentileV1_(times,1),
      eligible:summaries.reduce(function(sum,x){return sum+Number(x.eligible||0);},0),
      checked:summaries.reduce(function(sum,x){return sum+Number(x.checked||0);},0),
      available:summaries.reduce(function(sum,x){return sum+Number(x.available||0);},0),
      returned:summaries.reduce(function(sum,x){return sum+Number(x.returned||0);},0),
      failed:summaries.reduce(function(sum,x){return sum+Number(x.failed||0);},0),
      unchecked:summaries.reduce(function(sum,x){return sum+Number(x.unchecked||0);},0),
      fallback:summaries.reduce(function(sum,x){return sum+Number(x.fallback||0);},0),
      modifiedChecks:summaries.reduce(function(sum,x){return sum+Number(x.modifiedChecks||0);},0),
      modifiedCheckMs:summaries.reduce(function(sum,x){return sum+Number(x.modifiedCheckMs||0);},0),
      modifiedBatchRequests:summaries.reduce(function(sum,x){return sum+Number(x.modifiedBatchRequests||0);},0),
      modifiedBatchFiles:summaries.reduce(function(sum,x){return sum+Number(x.modifiedBatchFiles||0);},0),
      modifiedBatchFailures:summaries.reduce(function(sum,x){return sum+Number(x.modifiedBatchFailures||0);},0),
      modifiedFallbackChecks:summaries.reduce(function(sum,x){return sum+Number(x.modifiedFallbackChecks||0);},0),
      sourcesOpened:summaries.reduce(function(sum,x){return sum+Number(x.sourcesOpened||0);},0),
      sheetLoads:summaries.reduce(function(sum,x){return sum+Number(x.sheetLoads||0);},0),
      completeCases:summaries.filter(function(x){return x.complete===true;}).length
    };
  }
  var result={
    success:true,code:"SEARCH_BENCHMARK_REPORT_V1",finished:state.samples.length===state.cases.length,
    completenessPass:completenessPass,accountingPass:accountingPass,privateFilterPass:privateFilterPass,
    bedroomFilterPass:bedroomFilterPass,checkIn:state.checkIn,checkOut:state.checkOut,
    sampleCount:state.samples.length,before:stats_("before",beforeTimes),after:stats_("after",afterTimes),samples:state.samples
  };
  Logger.log(JSON.stringify(result));
  return result;
}

function testSearchCompletenessLiveV1(){
  var dates=searchBenchmarkDatesV1_();
  var response=ceSearchAvailableVillasInternal_(dates.checkIn,dates.checkOut,10,{
    city:"Đà Lạt",cursor:0,pageSize:12,minPrice:0,maxPrice:0,sortMode:"BEST",
    shuffleSeed:"release_complete_v1_"+new Date().getTime(),minBedrooms:0,productType:"ALL",
    maxVillas:0,debug:false,exhaustiveAudit:true,maxRuntimeMs:250000
  });
  searchAssertV1_(response.complete===true,"live Search trả partial");
  searchAssertV1_(response.checkedCount===response.eligibleCount,
    "complete nhưng checked="+response.checkedCount+" eligible="+response.eligibleCount);
  var result={success:true,code:"SEARCH_COMPLETENESS_LIVE_PASS_V1",eligible:response.eligibleCount,checked:response.checkedCount,available:response.availableCount,returned:response.returnedCount,fallback:response.fallbackCount,totalMs:response.speed&&response.speed.totalMs};
  Logger.log(JSON.stringify(result));
  return result;
}


function testSearchSafetyV629(){
  searchAssertV1_(ceResolveSearchExecutionModeV626_("BEST",{},false)==="FAST_PAGE","internal BEST production phải FAST_PAGE");
  searchAssertV1_(ceResolveSearchExecutionModeV626_("BEST",{snapshotOnlyV627:true},false)==="SNAPSHOT_FIRST","customer first paint phải SNAPSHOT_FIRST");
  searchAssertV1_(ceResolveSearchExecutionModeV626_("BEST",{forceLiveV627:true},false)==="LIVE_FALLBACK","customer deferred phase phải LIVE_FALLBACK");
  searchAssertV1_(ceResolveSearchExecutionModeV626_("BEST",{exhaustiveAudit:true},false)==="EXHAUSTIVE","audit phải EXHAUSTIVE");
  searchAssertV1_(Number(CE_MASTER_CACHE_MAX_CHUNKS_V626_||0)>=40,"MASTER cache phải chứa được production payload");
  searchAssertV1_(typeof ceBeginMasterPublishV1_==="function"&&typeof ceEndMasterPublishV1_==="function","MASTER publish barrier V629 phải tồn tại");

  var sample=ceBuildFastCandidatePageResponseV626_({
    complete:false,partial:true,query:{searchMode:"FAST_PAGE"},
    results:new Array(6).fill(0).map(function(_,i){return {villaId:"V"+i};}),
    counters:{masterTotal:1383,staticEligible:842,eligibleCount:842,scheduleChecked:8,availableCount:6,rankedCount:6,failedCount:67,uncheckedCount:767,fallbackCount:0},
    speed:{},errors:[],dropReasonCounts:{},dropReasonSamples:{},diagnostics:[],elapsedMs:60000,stoppedEarly:true,timingV23:{},timingV30:{},snapshotV320:{}
  },0,75,842,12);
  searchAssertV1_(sample.nextCursor===75&&sample.hasMore===true,"timeout còn candidate phải hasMore=true");

  searchAssertV1_(Number(CE_CUSTOMER_PROGRESSIVE_V627_.FIRST_PAINT_SIZE||0)===6,"customer first paint phải 6 căn");
  searchAssertV1_(Number(CE_CUSTOMER_PROGRESSIVE_V627_.SNAPSHOT_BUFFER_TARGET||0)>=12,"customer snapshot buffer phải >=12");

  searchAssertV1_(ceParseMasterSourceColumnV4193_(new Date(Date.UTC(1900,0,4)),"1/4/1900","GMT")===5,"Date serial sourceColumn phải recover thành 5");
  searchAssertV1_(ceParseMasterSourceColumnV4193_("","1/4/1900","GMT")===0,"display date mơ hồ không được đoán thành sourceColumn");

  var activity=testNoCalendarActivityGuardV4194();
  searchAssertV1_(activity&&activity.success===true,"calendar activity guard phải PASS");

  var inactive=testMasterInactiveWindowReconcileV4210();
  searchAssertV1_(inactive&&inactive.success===true&&inactive.mode==="PRESERVE_PENDING_STRUCTURE","inactive month không được tự xóa căn");

  searchAssertV1_(ceParseInputDate_("2026-02-31")===null,"ngày không tồn tại phải bị chặn");

  var neg=ceCustomerDetectAmenitiesV61_("Không có hồ bơi. Không karaoke, không đậu ô tô.");
  searchAssertV1_(neg.indexOf("Hồ bơi")<0&&neg.indexOf("Karaoke")<0&&neg.indexOf("Đậu ô tô")<0,"amenity phủ định không được nhận là có");

  var firstPending=ceCustomerBuildProgressivePageV627_("TEST",{query:{},snapshotResults:[],deferredIds:["V1"],snapshotScanDone:true,snapshotCandidateCursor:1,featuredIds:[]},0,6,{},true);
  searchAssertV1_(firstPending.phase==="LIVE_PENDING"&&firstPending.count===0&&firstPending.hasMore===true,"first response không được tự mở live fallback");

  var result={success:true,code:"SEARCH_SAFETY_PASS_V629",internalMode:"FAST_PAGE",customerFirst:"FIRST_6_SNAPSHOT_VERIFIED",customerPrefetch:"PINNED_CURSOR",customerLater:"LIVE_FALLBACK_RETRY_SAFE",timeoutHasMore:true,masterCacheChunks:CE_MASTER_CACHE_MAX_CHUNKS_V626_,inactiveRemoval:"FAIL_CLOSED",sourceColumn:"RAW_SAFE",invalidDate:"BLOCKED",negatedAmenities:"BLOCKED"};
  Logger.log(JSON.stringify(result));
  return result;
}

/** One customer-facing live benchmark: first 6 + immediate buffered next page, normal + year-boundary. Read-only. */
function testCustomerSearchLiveV629(){
  var cases=[
    {name:"NOV",checkIn:"2026-11-20",checkOut:"2026-11-22",guests:35},
    {name:"YEAR_END",checkIn:"2026-12-31",checkOut:"2027-01-03",guests:35}
  ];
  var results=cases.map(function(c){
    var started=new Date().getTime();
    var base={checkIn:c.checkIn,checkOut:c.checkOut,guests:c.guests,city:"Đà Lạt",pageSize:12,sortMode:"BEST",productType:"NGUYEN_CAN",shuffleSeed:"customer_v629_"+c.name};
    var r=apiCustomerSearchV61(base);
    var firstWall=new Date().getTime()-started;
    searchAssertV1_(r&&r.success===true,c.name+" customer search fail");
    searchAssertV1_(r.phase==="SNAPSHOT",c.name+" first paint phải SNAPSHOT");
    searchAssertV1_(Number(r.count||0)<=6,c.name+" first paint không được quá 6 căn");
    searchAssertV1_(typeof r.searchToken==="string"&&r.searchToken.length>0,c.name+" thiếu searchToken");
    var secondStarted=new Date().getTime();
    var r2=apiCustomerSearchV61({checkIn:base.checkIn,checkOut:base.checkOut,guests:base.guests,city:base.city,pageSize:12,sortMode:base.sortMode,productType:base.productType,shuffleSeed:base.shuffleSeed,searchToken:r.searchToken,cursor:r.nextCursor});
    searchAssertV1_(r2&&r2.success===true,c.name+" prefetch search fail");
    return {case:c.name,firstCount:Number(r.count||0),firstPhase:r.phase,firstHasMore:Boolean(r.hasMore),firstNextCursor:Number(r.nextCursor||0),firstPhaseMs:Number(r.firstPhaseMs||0),firstWallMs:firstWall,secondCount:Number(r2.count||0),secondPhase:r2.phase,secondWallMs:new Date().getTime()-secondStarted,snapshotCount:Number(r2.snapshotCount||r.snapshotCount||0),deferredCount:Number(r2.deferredCount||r.deferredCount||0),candidateCursor:Number(r2.candidateCursor||r.candidateCursor||0)};
  });
  var out={success:true,code:"CUSTOMER_FIRST6_PROGRESSIVE_PASS_V629",cases:results};
  Logger.log(JSON.stringify(out));
  return out;
}

/* ================= SEARCH PATCH V2 TESTS ================= */

function testConfiguredDateColumnSafetyV2(){
  var raw=[["weekday","date","wrong date"]];
  var display=[["weekday","date","wrong date"]];
  for(var day=1;day<=10;day++){
    raw.push(["weekday",day+"/9/2026",day+"/12/2026"]);
    display.push(["weekday",day+"/9/2026",day+"/12/2026"]);
  }
  var recovered=ceDetectDateColumnV1_(raw,display,"T92026",new Date(2026,8,1),{
    dateColumn:2,dateRows:[],dateOrder:"DM"
  });
  searchAssertV1_(recovered===1,"configured C sai phải recover về B, actual="+(recovered+1));

  var valid=ceDetectDateColumnV1_(raw,display,"T92026",new Date(2026,8,1),{
    dateColumn:1,dateRows:[],dateOrder:"DM"
  });
  searchAssertV1_(valid===1,"configured B hợp lệ phải được giữ");

  var ambiguousRaw=[["wrong","date 1","date 2"]];
  var ambiguousDisplay=[["wrong","date 1","date 2"]];
  for(var d=1;d<=10;d++){
    ambiguousRaw.push(["x",d+"/9/2026",d+"/9/2026"]);
    ambiguousDisplay.push(["x",d+"/9/2026",d+"/9/2026"]);
  }
  var blocked=ceDetectDateColumnV1_(ambiguousRaw,ambiguousDisplay,"T92026",new Date(2026,8,1),{
    dateColumn:0,dateRows:[],dateOrder:"DM"
  });
  searchAssertV1_(blocked===-1,"hai candidate ngày ngang nhau phải fail-safe, không đoán");
  var result={success:true,code:"DATE_COLUMN_CONFIG_SAFETY_PASS_V2",recoveredColumn:recovered+1,validColumn:valid+1,ambiguous:"BLOCKED"};
  Logger.log(JSON.stringify(result));
  return result;
}

function testLogicalSourceIdentityV2(){
  var link="https://docs.google.com/spreadsheets/d/FILE_SAME_12345678901234567890/edit";
  var identity=beBuildIncrementalIdentityV328_(10,"SOURCE A",link,null);
  var rowA=["VL-A","","A","","SOURCE A",link];
  var rowB=["VL-B","","B","","SOURCE B",link];
  searchAssertV1_(beRowMatchesIncrementalIdentityV328_(rowA,[identity])===true,"source A phải match");
  searchAssertV1_(beRowMatchesIncrementalIdentityV328_(rowB,[identity])===false,"source B cùng link không được match nhầm");
  var merged=beMergeMasterVillaRowsV328_([rowA,rowB],[["VL-A2","","A2","","SOURCE A",link]],[identity],16);
  searchAssertV1_(merged.some(function(row){return row[0]==="VL-B";}),"incremental source A phải giữ source B");
  searchAssertV1_(!merged.some(function(row){return row[0]==="VL-A";}),"block cũ source A phải được replace");

  var keyA=ssScheduleSourceKeyV320_(link,"SOURCE A");
  var keyB=ssScheduleSourceKeyV320_(link,"SOURCE B");
  searchAssertV1_(keyA!==keyB,"snapshot key không được chỉ dựa FILE ID");
  var fileId=ssExtractSpreadsheetIdV320_(link);
  var ctx={
    rows:{},sourceModifiedCache:{},sourceStatuses:{}
  };
  ctx.rows["VL-A|3"]=[keyA,"VL-A","A","SOURCE A","",3,"","","",fileId,""];
  ctx.rows["VL-B|4"]=[keyB,"VL-B","B","SOURCE B","",4,"","","",fileId,""];
  var plan=ssBuildSourceModifiedBatchPlanV2_(ctx,[
    {id:"VL-A",sourceColumn:3,calendarUrl:link,config:""},
    {id:"VL-B",sourceColumn:4,calendarUrl:link,config:""}
  ],2);
  searchAssertV1_(plan.length===1&&plan[0].sourceKeys.length===2,"modifiedTime phải fetch 1 file nhưng cấp cho 2 logical source");
  var result={success:true,code:"LOGICAL_SOURCE_IDENTITY_PASS_V2",keyA:keyA,keyB:keyB,batchFiles:plan.length,logicalSources:plan[0].sourceKeys.length};
  Logger.log(JSON.stringify(result));
  return result;
}

function testSourceProductTypeInheritanceV2(){
  searchAssertV1_(beNormalizeProductTypeV2_("Phòng riêng")==="PHONG_RIENG","normalize phòng riêng");
  searchAssertV1_(beNormalizeProductTypeV2_("NGUYÊN CĂN")==="NGUYEN_CAN","normalize nguyên căn");
  searchAssertV1_(beSourceProductTypeConfigV2_("","AUTO;LOAI_SP=PHONG_RIENG")==="PHONG_RIENG","CONFIG MASTER phải nhận LOAI_SP");
  searchAssertV1_(beSourceProductTypeConfigV2_("NGUYEN_CAN","AUTO;LOAI_SP=PHONG_RIENG")==="NGUYEN_CAN","cột LOẠI phải ưu tiên hơn config string");
  searchAssertV1_(beResolveProductTypeV2_("","","PHONG_RIENG")==="PHONG_RIENG","blank phải nhận source default");
  searchAssertV1_(beResolveProductTypeV2_("COMBO","","PHONG_RIENG")==="COMBO","legacy manual phải thắng source default");
  searchAssertV1_(beResolveProductTypeV2_("PHONG_RIENG","PHONG_RIENG","NGUYEN_CAN")==="NGUYEN_CAN","generated value phải theo source config mới");
  searchAssertV1_(beResolveProductTypeV2_("COMBO","PHONG_RIENG","NGUYEN_CAN")==="COMBO","manual override phải được giữ");
  var result={success:true,code:"SOURCE_PRODUCT_TYPE_INHERITANCE_PASS_V2",precedence:"MANUAL > SOURCE > BLANK"};
  Logger.log(JSON.stringify(result));
  return result;
}

function testSearchJourneyResolverV2(){
  var villas=[
    {id:"VL-ONE",name:"Villa Trùng",source:"Nguồn A"},
    {id:"VL-TWO",name:"Villa Trùng",source:"Nguồn B"},
    {id:"VL-POOL",name:"VILLA HỒ BƠI TRUNG TÂM",source:"phương Bùi"}
  ];
  var byId=ceResolveSearchVillaSelectorV2_("VL-POOL","",villas);
  var ambiguous=ceResolveSearchVillaSelectorV2_("Villa Trùng","",villas);
  var exact=ceResolveSearchVillaSelectorV2_("VILLA HỒ BƠI TRUNG TÂM","phương Bùi",villas);
  var missing=ceResolveSearchVillaSelectorV2_("Không tồn tại","",villas);
  searchAssertV1_(byId.found&&byId.resolvedBy==="VILLA_ID","resolve MÃ_CĂN");
  searchAssertV1_(!ambiguous.found&&ambiguous.dropReason==="AMBIGUOUS_VILLA_NAME"&&ambiguous.candidates.length===2,"tên trùng phải disambiguate");
  searchAssertV1_(exact.found&&exact.villa.id==="VL-POOL","exact name + source phải resolve record MASTER");
  searchAssertV1_(!missing.found&&missing.dropReason==="MASTER_NOT_FOUND","missing phải có dropReason");
  var result={success:true,code:"SEARCH_JOURNEY_RESOLVER_PASS_V2",id:true,exactNameSource:true,ambiguous:"BLOCKED",missingReason:"MASTER_NOT_FOUND"};
  Logger.log(JSON.stringify(result));
  return result;
}

function testSearchPatchV2UnitSuite(){
  var results=[
    testSearchCompletenessInvariantV1(),
    testSearchStaticFiltersV1(),
    testSearchRankingPaginationV1(),
    testStaticInfoIntegrityV417(),
    testStaticInfoPreservationV418(),
    testSourceReconcileFailSafeV416(),
    testConfiguredDateColumnSafetyV2(),
    testLogicalSourceIdentityV2(),
    testSourceProductTypeInheritanceV2(),
    testSearchJourneyResolverV2()
  ];
  var result={success:true,code:"SEARCH_PATCH_V2_UNIT_SUITE_PASS",tests:results.map(function(item){return item&&item.code||"PASS";})};
  Logger.log(JSON.stringify(result));
  return result;
}

function testKnownSourceDateRecoveryLiveV2(){
  var targetParts=searchBenchmarkDatesV1_().checkIn.split("-");
  var targetDate=new Date(Number(targetParts[0]),Number(targetParts[1])-1,Number(targetParts[2]));
  var targetKey=ceDateKey_(targetDate);
  var targetMonthPrefix=targetKey.slice(0,7)+"-";
  var selectors=["anh thư 5pn","diệp lan anh"];
  var results=selectors.map(function(selector){
    var source=opsFindSourceV312_(selector);
    if(!source)throw new Error("KNOWN_SOURCE_NOT_FOUND: "+selector);

    var file=null;
    try {
      file=ceOpenSpreadsheetFastV23_(source.link);
    } catch (e) {
      var msg = String(e && e.message ? e.message : e);
      var classify = saClassifyAccessErrorV1_(msg);
      if (classify === "NO_ACCESS") {
        return {
          selector:selector,
          source:source.source,
          error:"NO_ACCESS",
          errorMessage:"Permission denied for source: " + msg
        };
      }
      throw e;
    }

    var allSheetNames=file.getSheets().map(function(sh){return sh.getName();});
    var sheets=ceCalendarCandidateSheetsV34_(file,targetDate,source.configCalendar||"AUTO");
    var context=ceCreateSourceContextV30_(file,{source:source.source,candidates:1,maxColumn:12,requiresFullScan:false});
    var matched=null;
    var attempts=[];
    var publishedKeys={};
    for(var i=0;i<sheets.length;i++){
      var sheet=sheets[i];
      var loaded=ceLoadCalendarSheetV34_(context,sheet,targetDate,source.configCalendar||"AUTO",3);
      var index=ceBuildCalendarDateIndexV50_(loaded);
      Object.keys(index||{}).forEach(function(key){publishedKeys[key]=true;});
      var row=ceFindCalendarDateRowV34_(loaded,targetDate);
      attempts.push({
        sheet:sheet.getName(),
        dateColumn:Number(loaded.dateColumn||-1)+1,
        row:row>=0?row+1:-1,
        firstDates:Object.keys(index||{}).sort().slice(0,3),
        lastDates:Object.keys(index||{}).sort().slice(-3)
      });
      if(row>=0){matched={sheet:sheet.getName(),dateColumn:loaded.dateColumn+1,row:row+1};break;}
    }

    var keys=Object.keys(publishedKeys).sort();
    var targetMonthPublished=keys.some(function(key){return key.indexOf(targetMonthPrefix)===0;});
    var status=matched?"TARGET_DATE_RECOVERED":(targetMonthPublished?"TARGET_DATE_GAP":"TARGET_MONTH_NOT_PUBLISHED");

    /*
     * V6.0: live source freshness không được giả thành parser regression.
     * Nếu chủ nguồn chưa publish tháng mục tiêu thì trả diagnostic chính xác,
     * không fail code release. Chỉ fail khi tháng mục tiêu đã có dữ liệu nhưng
     * riêng target date vẫn không resolve được. Parser correctness được khóa
     * bởi testPriorityCalendarLayoutsV4193 trong core regression suite.
     */
    searchAssertV1_(
      status!=="TARGET_DATE_GAP",
      selector+" có dữ liệu tháng mục tiêu nhưng vẫn DATE_NOT_FOUND cho "+targetKey
    );

    return {
      source:source.source,
      status:status,
      allSheetNames:allSheetNames,
      matched:matched,
      targetMonthPublished:targetMonthPublished,
      publishedDateCount:keys.length,
      firstDates:keys.slice(0,3),
      lastDates:keys.slice(-3),
      attempts:attempts
    };
  });
  var result={success:true,code:"KNOWN_SOURCE_DATE_RECOVERY_PASS_V2",date:targetKey,sources:results};
  Logger.log(JSON.stringify(result));
  return result;
}

function testSourceProductTypeLiveV2(){
  var sources=(opsListMasterSourcesV312_(true).sources||[]).filter(function(source){
    return !!beSourceProductTypeConfigV2_(source.type,source.configMaster);
  });
  searchAssertV1_(sources.length>0,"MASTER chưa có source nào cấu hình LOẠI chuẩn");
  var sh=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BE_CONFIG.MASTER_VILLA_SHEET||"MASTER_VILLA");
  if(!sh||sh.getLastRow()<2)throw new Error("MASTER_VILLA_EMPTY");
  var values=sh.getDataRange().getDisplayValues();
  var header=values[0].map(normalizeMasterText);
  var sourceCol=header.indexOf(normalizeMasterText("NGUỒN"));
  var linkCol=header.indexOf(normalizeMasterText("LINK LỊCH"));
  var typeCol=header.indexOf(normalizeMasterText("LOAI_SP"));
  var generatedCol=header.indexOf(normalizeMasterText("LOAI_SP_NGUON"));
  searchAssertV1_(sourceCol>=0&&linkCol>=0&&typeCol>=0&&generatedCol>=0,"thiếu cột product type V2");
  var checks=sources.map(function(source){
    var expected=beSourceProductTypeConfigV2_(source.type,source.configMaster);
    var rows=values.slice(1).filter(function(row){
      return normalizeMasterText(row[sourceCol])===normalizeMasterText(source.source)&&
        cleanMasterText(row[linkCol])===cleanMasterText(source.link);
    });
    searchAssertV1_(rows.length>0,"source "+source.source+" chưa có villa sau sync");
    var badGenerated=rows.filter(function(row){return beNormalizeProductTypeV2_(row[generatedCol])!==expected;});
    var blankEffective=rows.filter(function(row){return !beNormalizeProductTypeV2_(row[typeCol]);});
    searchAssertV1_(badGenerated.length===0,"source "+source.source+" sinh LOAI_SP_NGUON sai");
    searchAssertV1_(blankEffective.length===0,"source "+source.source+" còn LOAI_SP blank");
    return {source:source.source,link:source.link,type:expected,villas:rows.length};
  });
  var result={success:true,code:"SOURCE_PRODUCT_TYPE_LIVE_PASS_V2",configuredSources:sources.length,checks:checks};
  Logger.log(JSON.stringify(result));
  return result;
}

function testSearchBedroomLiveV2(){
  var dates=searchBenchmarkDatesV1_();
  var response=ceSearchAvailableVillasInternal_(dates.checkIn,dates.checkOut,10,{
    city:"Đà Lạt",cursor:0,pageSize:50,minPrice:0,maxPrice:0,sortMode:"BEST",
    shuffleSeed:"bedroom_live_v2_"+new Date().getTime(),minBedrooms:4,productType:"ALL",
    maxVillas:0,debug:false,exhaustiveAudit:true,maxRuntimeMs:250000
  });
  var violations=(response.results||[]).filter(function(item){return !(Number(item&&item.bedroomsNumber)>=4);});
  if(violations.length){
    Logger.log(JSON.stringify({
      code:"SEARCH_BEDROOM_VIOLATIONS_V625",
      count:violations.length,
      samples:violations.slice(0,20).map(function(item){return {
        villaId:String(item&&item.villaId||""),name:String(item&&item.name||""),
        source:String(item&&item.source||""),bedrooms:String(item&&item.bedrooms||""),
        bedroomsNumber:item&&item.bedroomsNumber
      };})
    }));
  }
  searchAssertV1_(violations.length===0,"4PN+ lọt căn PN blank hoặc <4");
  searchAssertV1_(Number(response.uncheckedCount||0)===0,"4PN+ còn unchecked");
  searchAssertV1_(Number(response.checkedCount||0)+Number(response.failedCount||0)===Number(response.eligibleCount||0),"4PN+ accounting sai");
  var result={success:true,code:"SEARCH_BEDROOM_LIVE_PASS_V2",eligible:response.eligibleCount,checked:response.checkedCount,failed:response.failedCount,unchecked:response.uncheckedCount,returned:response.returnedCount,partial:response.partial};
  Logger.log(JSON.stringify(result));
  return result;
}

function testSearchCompletenessAccountingLiveV2(){
  var dates=searchBenchmarkDatesV1_();
  var response=ceSearchAvailableVillasInternal_(dates.checkIn,dates.checkOut,10,{
    city:"Đà Lạt",cursor:0,pageSize:12,minPrice:0,maxPrice:0,sortMode:"BEST",
    shuffleSeed:"accounting_live_v2_"+new Date().getTime(),minBedrooms:0,productType:"ALL",
    maxVillas:0,debug:false,exhaustiveAudit:true,maxRuntimeMs:250000
  });
  searchAssertV1_(Number(response.uncheckedCount||0)===0,"Search còn unchecked");
  searchAssertV1_(Number(response.checkedCount||0)+Number(response.failedCount||0)===Number(response.eligibleCount||0),"eligible != checked + failed");
  if(Number(response.failedCount||0)===0){
    searchAssertV1_(response.complete===true&&response.partial===false,"failed=0 phải complete");
  }else{
    searchAssertV1_(response.complete===false&&response.partial===true,"failed>0 phải partial trung thực");
  }
  var result={success:true,code:"SEARCH_COMPLETENESS_ACCOUNTING_PASS_V2",eligible:response.eligibleCount,checked:response.checkedCount,failed:response.failedCount,unchecked:response.uncheckedCount,complete:response.complete,partial:response.partial,totalMs:response.speed&&response.speed.totalMs};
  Logger.log(JSON.stringify(result));
  return result;
}

var EHOME_SEARCH_BENCHMARK_PROP_V2_="EHOME_SEARCH_BENCHMARK_V2";

function startSearchBenchmarkV2(){
  var props=PropertiesService.getScriptProperties();
  var baselineRaw=String(props.getProperty(EHOME_SEARCH_BENCHMARK_PROP_V1_)||"");
  if(!baselineRaw)throw new Error("Thiếu benchmark PATCH V1; chạy/get SEARCH_BENCHMARK_REPORT_V1 trước.");
  var baseline=JSON.parse(baselineRaw);
  if(!baseline.samples||baseline.samples.length!==baseline.cases.length)throw new Error("Benchmark PATCH V1 chưa đủ 7 case.");
  var state={
    version:2,startedAt:new Date().toISOString(),checkIn:baseline.checkIn,checkOut:baseline.checkOut,index:0,
    cases:baseline.cases,samples:[],baselineV1:baseline.samples
  };
  props.setProperty(EHOME_SEARCH_BENCHMARK_PROP_V2_,JSON.stringify(state));
  var result={success:true,code:"SEARCH_BENCHMARK_STARTED_V2",checkIn:state.checkIn,checkOut:state.checkOut,cases:state.cases.map(function(item){return item.id;}),next:"runNextSearchBenchmarkV2"};
  Logger.log(JSON.stringify(result));
  return result;
}

function runNextSearchBenchmarkV2(){
  var props=PropertiesService.getScriptProperties();
  var raw=String(props.getProperty(EHOME_SEARCH_BENCHMARK_PROP_V2_)||"");
  if(!raw)throw new Error("Chạy startSearchBenchmarkV2 trước.");
  var state=JSON.parse(raw);
  if(state.index>=state.cases.length)return getSearchBenchmarkReportV2();
  var item=state.cases[state.index];
  var response=null,error="";
  try{
    response=ceSearchAvailableVillasInternal_(state.checkIn,state.checkOut,item.guests,{
      city:"Đà Lạt",cursor:0,pageSize:12,minPrice:0,maxPrice:0,sortMode:"BEST",
      shuffleSeed:"bench_v2_"+String(state.startedAt).replace(/\D/g,"").slice(0,14)+"_"+state.index,
      minBedrooms:item.minBedrooms,productType:item.productType,
      maxVillas:0,debug:false,maxRuntimeMs:250000
    });
  }catch(runError){error=String(runError&&runError.message?runError.message:runError);}
  var sample={id:item.id,query:item,patchV2:response?searchBenchmarkSummaryV1_(response,item):{error:error}};
  state.samples.push(sample);state.index++;
  props.setProperty(EHOME_SEARCH_BENCHMARK_PROP_V2_,JSON.stringify(state));
  var result={success:!error,code:"SEARCH_BENCHMARK_CASE_DONE_V2",case:sample,nextIndex:state.index,remaining:state.cases.length-state.index,next:state.index<state.cases.length?"runNextSearchBenchmarkV2":"getSearchBenchmarkReportV2"};
  Logger.log(JSON.stringify(result));
  return result;
}

function getSearchBenchmarkReportV2(){
  var raw=String(PropertiesService.getScriptProperties().getProperty(EHOME_SEARCH_BENCHMARK_PROP_V2_)||"");
  if(!raw)throw new Error("Chưa có benchmark V2.");
  var state=JSON.parse(raw);
  function aggregate_(samples,field){
    var rows=(samples||[]).map(function(sample){return sample&&sample[field]||{};});
    var times=rows.map(function(row){return row.totalMs;});
    var sums=["eligible","checked","failed","unchecked","available","returned","fallback","modifiedChecks","modifiedCheckMs","modifiedBatchRequests","modifiedBatchFiles","modifiedBatchFailures","modifiedFallbackChecks","sourcesOpened","sheetLoads"];
    var out={p50:searchPercentileV1_(times,.50),p95:searchPercentileV1_(times,.95),max:searchPercentileV1_(times,1)};
    sums.forEach(function(key){out[key]=rows.reduce(function(sum,row){return sum+Number(row[key]||0);},0);});
    out.completeCases=rows.filter(function(row){return row.complete===true;}).length;
    return out;
  }
  var patchV2Samples=state.samples||[];
  var accountingPass=patchV2Samples.length===state.cases.length&&patchV2Samples.every(function(sample){
    var row=sample.patchV2||{};
    return !row.error&&Number(row.unchecked||0)===0&&Number(row.checked||0)+Number(row.failed||0)===Number(row.eligible||0);
  });
  var bedroom=patchV2Samples.filter(function(sample){return sample.id==="GUESTS_10_4PN";})[0];
  var privateRoom=patchV2Samples.filter(function(sample){return sample.id==="PRIVATE_2";})[0];
  var bedroomFilterPass=Boolean(bedroom&&bedroom.patchV2&&bedroom.patchV2.filterSemanticsVerified===true&&bedroom.patchV2.eligible>0&&Number(bedroom.patchV2.bedroomViolations||0)===0);
  var privateFilterPass=Boolean(privateRoom&&privateRoom.patchV2&&privateRoom.patchV2.filterSemanticsVerified===true&&privateRoom.patchV2.eligible>0&&Number(privateRoom.patchV2.productTypeViolations||0)===0);
  var result={
    success:true,code:"SEARCH_BENCHMARK_REPORT_V2",finished:patchV2Samples.length===state.cases.length,
    accountingPass:accountingPass,bedroomFilterPass:bedroomFilterPass,privateFilterPass:privateFilterPass,
    checkIn:state.checkIn,checkOut:state.checkOut,sampleCount:patchV2Samples.length,
    before:aggregate_(state.baselineV1,"before"),patchV1:aggregate_(state.baselineV1,"after"),patchV2:aggregate_(patchV2Samples,"patchV2"),
    samples:patchV2Samples
  };
  Logger.log(JSON.stringify(result));
  return result;
}
function debugStructureLookupSource12V2() {
  var sourceId = "12";
  var source = "phòng lẻ MH";
  var link = "https://docs.google.com/spreadsheets/d/17EwMUUFOfS7XdNuntkvqZAfE1xpYQwKOPI2OX8BEwPc/edit";

  var result = {
    success: true,
    sourceId: sourceId,
    source: source,
    stableFunctionExists:
      typeof ssGetStableStructureForSourceV416_ === "function",
    confirmedFunctionExists:
      typeof ssGetConfirmedStructureForSourceV340_ === "function"
  };

  try {
    result.stable = typeof ssGetStableStructureForSourceV416_ === "function"
      ? ssGetStableStructureForSourceV416_(sourceId, source, link)
      : "FUNCTION_NOT_FOUND";
  } catch (e) {
    result.stableError = String(e && e.stack ? e.stack : e);
  }

  try {
    result.confirmed = typeof ssGetConfirmedStructureForSourceV340_ === "function"
      ? ssGetConfirmedStructureForSourceV340_(sourceId, source, link)
      : "FUNCTION_NOT_FOUND";
  } catch (e2) {
    result.confirmedError = String(e2 && e2.stack ? e2.stack : e2);
  }

  Logger.log(JSON.stringify({
    code: "STRUCTURE_LOOKUP_DEBUG_V2",
    result: result
  }));

  return result;
}

/**
 * V4.19.3 - regression thuần cho hai layout production gây Search partial:
 * - Diệp Lan Anh: 31.12 đứng trước chuỗi 1.9..30.9 trong tab Tháng 9.26.
 * - Nhà Chạng Vạng: nhiều block THÁNG 9/10 nằm chung tab CHẠNG VẠNG.
 */
function testPriorityCalendarLayoutsV4193() {
  var target = new Date(2026, 8, 19);

  var diepDisplay = [
    ["","",""],["","",""],["","",""],["","",""],
    ["","","31.12"]
  ];
  for (var day = 1; day <= 30; day++) {
    diepDisplay.push(["","",[day, 9].join(".")]);
  }
  diepDisplay.push(["","",""]);
  diepDisplay.push(["","",""]);
  var diepRaw = diepDisplay.map(function(row) { return row.slice(); });
  var diepRows = [];
  for (var diepRow = 5; diepRow <= 37; diepRow++) diepRows.push(diepRow);
  var diepConfig = {dateColumn:2,dateRows:diepRows,dateOrder:"AUTO"};
  var diepColumn = ceDetectDateColumnV1_(
    diepRaw,
    diepDisplay,
    "Tháng 9.26",
    target,
    diepConfig
  );
  searchAssertV1_(diepColumn === 2, "Diệp Lan Anh chưa giữ đúng cột ngày C");
  var diepContext = {
    name:"Tháng 9.26",raw:diepRaw,display:diepDisplay,
    dateColumn:diepColumn,dateConfigV50:diepConfig,dateReferenceYearV4223:2026
  };
  var diepIndex = ceBuildCalendarDateIndexV50_(diepContext);
  searchAssertV1_(
    Number(diepIndex["2026-09-19"]) === 23,
    "Diệp Lan Anh parse sai 19/09 sau hàng 31.12: " + JSON.stringify(diepIndex)
  );
  searchAssertV1_(
    !("2026-12-31" in diepIndex),
    "Diệp Lan Anh không được index dòng 31.12 ngoài kỳ trong tab Tháng 9.26"
  );

  // V6.0: tab tháng cũ có thể chứa vài ngày đầu tháng kế tiếp dạng số trần.
  var spillDisplay=[["30"],["1"],["2"],["3"]];
  var spillRaw=spillDisplay.map(function(row){return row.slice();});
  var spillConfig={dateColumn:0,dateRows:[],dateOrder:"AUTO"};
  var spillIndex=ceBuildCalendarDateIndexV50_({
    name:"Tháng 9.26",raw:spillRaw,display:spillDisplay,
    dateColumn:0,dateConfigV50:spillConfig,dateReferenceYearV4223:2026
  });
  searchAssertV1_("2026-09-30" in spillIndex,"Anchored spillover thiếu 30/09");
  searchAssertV1_("2026-10-01" in spillIndex,"Anchored spillover thiếu 01/10");
  searchAssertV1_("2026-10-03" in spillIndex,"Anchored spillover thiếu 03/10");

  var changDisplay = [["LỊCH CHẠNG VẠNG"],[""],[""],[""],[""],["tháng 9"]];
  for (var sepDay = 1; sepDay <= 30; sepDay++) changDisplay.push([String(sepDay)]);
  changDisplay.push(["THÁNG 10"]);
  for (var octDay = 1; octDay <= 5; octDay++) changDisplay.push([String(octDay)]);
  var changRaw = changDisplay.map(function(row) { return row.slice(); });
  var changConfig = {dateColumn:-1,dateRows:[],dateOrder:"AUTO"};
  var changColumn = ceDetectDateColumnV1_(
    changRaw,
    changDisplay,
    "CHẠNG VẠNG",
    target,
    changConfig
  );
  searchAssertV1_(changColumn === 0, "Chạng Vạng chưa detect được cột ngày inline month");
  var changIndex = ceBuildCalendarDateIndexV50_({
    name:"CHẠNG VẠNG",raw:changRaw,display:changDisplay,
    dateColumn:changColumn,dateConfigV50:changConfig,dateReferenceYearV4223:2026
  });
  searchAssertV1_("2026-09-19" in changIndex, "Chạng Vạng thiếu 19/09");
  searchAssertV1_("2026-10-03" in changIndex, "Chạng Vạng thiếu 03/10");
  searchAssertV1_(
    ceInlineMonthMarkerV4223_("T2","T2",2026,null) === null,
    "Không được hiểu T2 (thứ Hai) thành tháng 2"
  );

  var result = {
    success:true,
    code:"PRIORITY_CALENDAR_LAYOUTS_PASS_V4193",
    diepLanAnh:{dateColumn:diepColumn + 1,dateRow19:diepIndex["2026-09-19"] + 1,farDateRejected:true},
    anchoredSpillover:{sep30:spillIndex["2026-09-30"] + 1,oct01:spillIndex["2026-10-01"] + 1,oct03:spillIndex["2026-10-03"] + 1},
    nhaChangVang:{dateColumn:changColumn + 1,sep19:changIndex["2026-09-19"] + 1,oct03:changIndex["2026-10-03"] + 1}
  };
  Logger.log(JSON.stringify(result));
  return result;
}

function testMasterSourceColumnIntegrityV4193() {
  var recovered = ceParseMasterSourceColumnV4193_(
    new Date(Date.UTC(1900, 0, 4)),
    "1/4/1900",
    "GMT"
  );
  searchAssertV1_(recovered === 5, "Date serial 1/4/1900 phải recover thành cột 5");
  searchAssertV1_(
    ceParseMasterSourceColumnV4193_(15,"15","GMT") === 15,
    "Cột số nguyên phải giữ nguyên"
  );
  searchAssertV1_(
    ceParseMasterSourceColumnV4193_("","1/4/1900","GMT") === 0,
    "Không có raw Date thì không được đoán 1/4/1900 thành cột 1"
  );
  var result={
    success:true,
    code:"MASTER_SOURCE_COLUMN_INTEGRITY_PASS_V4193",
    dateFormattedColumn:recovered,
    ambiguousDisplay:"BLOCKED"
  };
  Logger.log(JSON.stringify(result));
  return result;
}


/** V4.19.4 - pure regression: all-white/all-empty calendar column must fail closed. */
function testNoCalendarActivityGuardV4194(){
  function ctx_(rawCol, displayCol, bgCol){
    var raw=[["Ngày","Villa"],[1,rawCol[0]],[2,rawCol[1]],[3,rawCol[2]]];
    var display=[["Ngày","Villa"],["1",displayCol[0]],["2",displayCol[1]],["3",displayCol[2]]];
    var backgrounds=[["#ffffff","#ffffff"],["#ffffff",bgCol[0]],["#ffffff",bgCol[1]],["#ffffff",bgCol[2]]];
    return {
      name:"TEST_ACTIVITY_V4194",raw:raw,display:display,backgrounds:backgrounds,notes:null,
      mergedCellsV52:{},dateColumn:0,dateIndexV50:{"2026-09-01":1,"2026-09-02":2,"2026-09-03":3}
    };
  }

  var blank=ceCalendarColumnActivityV4194_(
    ctx_(["","",""],["","",""],["#ffffff","#ffffff","#ffffff"]),1
  );
  if(blank.hasActivity!==false||blank.reason!=="NO_CALENDAR_ACTIVITY"){
    throw new Error("NO_CALENDAR_ACTIVITY_GUARD_FAIL_V4194: "+JSON.stringify(blank));
  }

  var price=ceCalendarColumnActivityV4194_(
    ctx_(["",3.5,""],["","3.5",""],["#ffffff","#ffffff","#ffffff"]),1
  );
  if(price.hasActivity!==true||price.reason!=="VALUE"){
    throw new Error("CALENDAR_ACTIVITY_PRICE_FAIL_V4194: "+JSON.stringify(price));
  }

  var colored=ceCalendarColumnActivityV4194_(
    ctx_(["","",""],["","",""],["#ffffff","#ff0000","#ffffff"]),1
  );
  if(colored.hasActivity!==true||colored.reason!=="BACKGROUND"){
    throw new Error("CALENDAR_ACTIVITY_COLOR_FAIL_V4194: "+JSON.stringify(colored));
  }

  var dateColumn=ceCalendarColumnActivityV4194_(
    ctx_(["","",""],["","",""],["#ffffff","#ffffff","#ffffff"]),0
  );
  if(dateColumn.hasActivity!==false||dateColumn.reason!=="SOURCE_COLUMN_IS_DATE_COLUMN"){
    throw new Error("DATE_COLUMN_GUARD_FAIL_V4194: "+JSON.stringify(dateColumn));
  }

  var result={success:true,blankFailClosed:true,priceActivity:true,colorActivity:true,dateColumnRejected:true};
  Logger.log(JSON.stringify({code:"NO_CALENDAR_ACTIVITY_GUARD_PASS_V4194",result:result}));
  return result;
}

/** V4.19.4 - pure regression: only confirmed 1:1 same-column rename may keep SKU. */
function testConfirmedRenameSkuPreservationV4194(){
  function oldRow(name,col,sku){return [sku||("SKU-"+name),"",name,"Đà Lạt","SRC","LINK","","","","",Number(col||0),"",""];}
  function villa(name,col){return {name:name,sourceColumn:Number(col||0)};}

  var previous=[oldRow("VILLA HỒ BƠI TRUNG TÂM",3,"VL-OLD"),oldRow("AN HOME",5,"VL-AN")];
  var current=[villa("VILLA HỒ BƠI NƯỚC NÓNG",3),villa("AN HOME",5)];
  var confirmed={
    allow:true,mode:"CONFIRMED_REMOVAL",missingNames:[normalizeMasterText("VILLA HỒ BƠI TRUNG TÂM")],
    renamePairs:[{sourceColumn:3,oldName:normalizeMasterText("VILLA HỒ BƠI TRUNG TÂM"),newName:normalizeMasterText("VILLA HỒ BƠI NƯỚC NÓNG"),oldSku:"VL-OLD"}]
  };
  var map=beConfirmedRenameSkuMapV4194_(previous,current,confirmed);
  if(map[3]!=="VL-OLD")throw new Error("CONFIRMED_RENAME_SKU_PRESERVE_FAIL_V4194: "+JSON.stringify(map));

  var pending=beConfirmedRenameSkuMapV4194_(previous,current,{allow:false,mode:"PRESERVE_PENDING_STRUCTURE",missingNames:confirmed.missingNames,renamePairs:confirmed.renamePairs});
  if(Object.keys(pending).length)throw new Error("PENDING_RENAME_MUST_NOT_REMAP_V4194: "+JSON.stringify(pending));

  var shifted=beConfirmedRenameSkuMapV4194_(previous,[villa("OTHER",3),villa("VILLA HỒ BƠI NƯỚC NÓNG",4)],confirmed);
  if(Object.keys(shifted).length)throw new Error("SHIFTED_COLUMN_MUST_NOT_REMAP_V4194: "+JSON.stringify(shifted));

  var result={success:true,confirmedPreserved:true,pendingBlocked:true,shiftedBlocked:true};
  Logger.log(JSON.stringify({code:"CONFIRMED_RENAME_SKU_PASS_V4194",result:result}));
  return result;
}

/**
 * V4.19.5 - pure regression cho source vừa REORDER cột vừa rename/remove/add.
 * Exact-name chuyển cột phải được xem là REORDER, không tạo rename giả.
 * Rename thật cùng cột chỉ được giữ SKU sau Structure confirmation.
 */
function testSourceColumnReorderReconcileV4195(){
  function oldRow(name,col,sku){
    return [sku||("SKU-"+name),"",name,"Đà Lạt","SRC","LINK","","","","",Number(col||0),"",""];
  }
  function villa(name,col){return {name:name,sourceColumn:Number(col||0)};}
  function confirmed_(villas){
    var nameSet={};
    (villas||[]).forEach(function(v){
      var key=normalizeMasterText(v&&v.name);
      if(key)nameSet[key]=true;
    });
    return {
      confirmed:true,autoRebuildAllowed:true,effectiveVillaCount:Object.keys(nameSet).length,stableReads:2,
      record:{current:{effectiveNameSet:nameSet,effectiveVillaCount:Object.keys(nameSet).length,_validationReads:2,error:""}}
    };
  }
  function assert_(condition,message){
    if(!condition)throw new Error("SOURCE_COLUMN_REORDER_FAIL_V4195: "+message);
  }

  var previous=[
    oldRow("VILLA HỒ BƠI TRUNG TÂM",3,"VL-POOL"),
    oldRow("ĐÔNG VILLA",4,"VL-DONG"),
    oldRow("KESA HOME",5,"VL-KESA"),
    oldRow("VIBE HOME MÁY LẠNH",6,"VL-VIBE"),
    oldRow("AN HOME",7,"VL-AN"),
    oldRow("CHILL HOME",8,"VL-CHILL"),
    oldRow("MAY HOME",9,"VL-MAY"),
    oldRow("PHÒNG LẺ",10,"VL-PHONGLE")
  ];
  var current=[
    villa("VILLA HỒ BƠI NƯỚC NÓNG",3),
    villa("VIBE HOME MÁY LẠNH",4),
    villa("AN HOME",5),
    villa("KESA HOME",6),
    villa("CHILL HOME",7),
    villa("MAY HOME",8),
    villa("PHÒNG LẺ",9),
    villa("Phòng đi lên cầu thang",13)
  ];

  var pairs=beFindSourceColumnRenamePairsV416_(previous,current);
  assert_(pairs.length===1,"reorder sinh rename giả: "+JSON.stringify(pairs));
  assert_(pairs[0].sourceColumn===3,"rename thật phải ở cột 3");
  assert_(pairs[0].oldName===normalizeMasterText("VILLA HỒ BƠI TRUNG TÂM"),"old rename sai");
  assert_(pairs[0].newName===normalizeMasterText("VILLA HỒ BƠI NƯỚC NÓNG"),"new rename sai");

  var pending=beAssessSourceReconcileV416_({
    previousRows:previous,villas:current,source:"phương Bùi",link:"LINK",confirmedStructure:null
  });
  assert_(pending.allow===false&&pending.reason==="STRUCTURE_NOT_CONFIRMED","structural change chưa confirm phải block");
  assert_(pending.renamePairs.length===1,"pending còn rename giả");
  assert_(pending.missingNames.indexOf(normalizeMasterText("ĐÔNG VILLA"))>=0,"ĐÔNG VILLA phải là missing thật");

  var confirmed=beAssessSourceReconcileV416_({
    previousRows:previous,villas:current,source:"phương Bùi",link:"LINK",confirmedStructure:confirmed_(current)
  });
  assert_(confirmed.allow===true&&confirmed.mode==="CONFIRMED_REMOVAL","confirmed structure phải cho replace");
  assert_(confirmed.renamePairs.length===1,"confirmed còn rename giả");

  var skuMap=beConfirmedRenameSkuMapV4194_(previous,current,confirmed);
  assert_(skuMap[3]==="VL-POOL","rename hồ bơi phải giữ SKU cũ sau confirm");

  var reorderPrev=[oldRow("A",3,"VL-A"),oldRow("B",4,"VL-B"),oldRow("C",5,"VL-C")];
  var reorderNow=[villa("B",3),villa("C",4),villa("A",5)];
  var reorderOnly=beAssessSourceReconcileV416_({previousRows:reorderPrev,villas:reorderNow,source:"SRC",link:"LINK",confirmedStructure:null});
  assert_(reorderOnly.allow===true&&reorderOnly.mode==="NO_REMOVAL","pure reorder phải update ngay không block");
  assert_((reorderOnly.renamePairs||[]).length===0,"pure reorder không được có renamePairs");

  var result={
    success:true,code:"SOURCE_COLUMN_REORDER_PASS_V4195",renamePairs:pairs,
    pending:pending.reason,confirmed:confirmed.mode,preservedSku:skuMap[3],pureReorder:reorderOnly.mode
  };
  Logger.log(JSON.stringify(result));
  return result;
}

/* ================= V4.19.6 PRODUCT TYPE / ORPHAN REGRESSION ================= */
function testProductTypeSchemaRepairV4196(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var sh=ss.getSheetByName(BE_CONFIG.MASTER_VILLA_SHEET||"MASTER_VILLA");
  if(!sh||sh.getLastRow()<2)throw new Error("MASTER_VILLA_EMPTY");

  var values=sh.getDataRange().getDisplayValues();
  var header=values[0].map(normalizeMasterText);
  var sourceCol=header.indexOf(normalizeMasterText("NGUỒN"));
  var linkCol=header.indexOf(normalizeMasterText("LINK LỊCH"));
  var typeCol=header.indexOf(normalizeMasterText("LOAI_SP"));
  var priorityCol=header.indexOf(normalizeMasterText("UU_TIEN"));
  var generatedCol=header.indexOf(normalizeMasterText("LOAI_SP_NGUON"));
  searchAssertV1_(sourceCol>=0&&linkCol>=0&&typeCol>=0&&priorityCol>=0&&generatedCol>=0,
    "MASTER_VILLA thiếu schema product type V4196");

  var sourceConfig=(opsListMasterSourcesV312_(true).sources||[]).filter(function(source){
    return !!beSourceProductTypeConfigV2_(source.type,source.configMaster);
  });
  var skip={"chon villa":true};
  var checked=[];
  var missingSources=[];
  var sheetPrivate=0;

  values.slice(1).forEach(function(row){
    if(beNormalizeProductTypeV2_(row[typeCol])==="PHONG_RIENG")sheetPrivate++;
  });

  sourceConfig.forEach(function(source){
    var sourceKey=normalizeMasterText(source.source);
    if(skip[sourceKey])return;
    var expected=beSourceProductTypeConfigV2_(source.type,source.configMaster);
    var rows=values.slice(1).filter(function(row){
      return normalizeMasterText(row[sourceCol])===sourceKey&&
        cleanMasterText(row[linkCol])===cleanMasterText(source.link);
    });
    if(!rows.length){
      missingSources.push(source.source);
      return;
    }
    var bad=rows.filter(function(row){
      return beNormalizeProductTypeV2_(row[typeCol])!==expected||
        beNormalizeProductTypeV2_(row[generatedCol])!==expected;
    });
    searchAssertV1_(bad.length===0,"source "+source.source+" còn LOAI_SP sai/blank");
    checked.push({source:source.source,type:expected,villas:rows.length});
  });

  if(typeof clearBookingEngineCache==="function")clearBookingEngineCache();
  var repo=ceReadMasterVillas_();
  var repoPrivate=repo.filter(function(v){return beNormalizeProductTypeV2_(v.productType)==="PHONG_RIENG";}).length;
  searchAssertV1_(repo.length===values.length-1,"Repository và MASTER_VILLA lệch số căn");
  searchAssertV1_(repoPrivate===sheetPrivate,"Repository đọc PHONG_RIENG lệch sheet");

  var result={success:true,code:"PRODUCT_TYPE_SCHEMA_REPAIR_PASS_V4196",villas:values.length-1,
    privateRooms:sheetPrivate,repositoryPrivateRooms:repoPrivate,checked:checked,missingSources:missingSources,skipped:["chồn villa"]};
  Logger.log(JSON.stringify(result));
  return result;
}

function testDeletedSourceOrphanPreviewV4196(){
  var preview=previewDeletedSourceOrphansV4196();
  searchAssertV1_(preview&&preview.success===true,"orphan preview failed");
  var result={success:true,code:"MASTER_ORPHAN_PREVIEW_PASS_V4196",count:Number(preview.count||0),
    sources:(preview.rows||[]).map(function(x){return x.source;})};
  Logger.log(JSON.stringify(result));
  return result;
}



/* ================= V4.20.0 NUMERIC ROOM NAME REGRESSION ================= */
/**
 * File: test.js
 * Run trong Apps Script: testMasterNumericRoomNamesV4200
 * Mục tiêu: nhận mã phòng số theo context My House nhưng vẫn chặn số rác/giá/sức chứa.
 */
function testMasterNumericRoomNamesV4200(){
  var values=[
    ["","","My House","","","","",""],
    ["","","Thông tin phòng","","","","",""],
    ["","","101","102","201","202","301","302"],
    ["","","2 pax","2 pax","2 pax","2 pax","2 pax","2 pax"],
    ["","","350.000 đ","400.000 đ","350.000 đ","380.000 đ","320.000 đ","380.000 đ"]
  ];
  var config={
    nameMode:"AUTO_ROW",
    startColumnIndex:2,
    endColumnIndex:7,
    excludedColumnIndexes:[],
    topRows:10,
    minimumNamesInRow:2,
    minimumNameScore:18,
    fallbackEnabled:true
  };

  var detection=evaluateMasterVillaNameRow(values,2,config);
  var names=detection.villaColumns.map(function(columnIndex){
    return sanitizeMasterVillaNameFromKnownRow(
      values[2][columnIndex],config,values,2,columnIndex
    );
  }).filter(String);

  var expected=["101","102","201","202","301","302"];
  searchAssertV1_(JSON.stringify(names)===JSON.stringify(expected),
    "My House numeric room names bị đọc sai: "+JSON.stringify(names));

  searchAssertV1_(isMasterDefiniteJunkCell("2 pax")===true,"2 pax phải vẫn là junk");
  searchAssertV1_(isMasterDefiniteJunkCell("350.000 đ")===true,"giá phải vẫn là junk");
  searchAssertV1_(isMasterDefiniteJunkCell("13h")===true || scoreCalendarVillaName("13h")<18,
    "13h không được thành tên phòng");
  searchAssertV1_(beIsNumericRoomNameByContextV4200_([["101"],["2 pax"]],0,0,{startColumnIndex:0,endColumnIndex:0,excludedColumnIndexes:[]})===false,
    "một số đơn lẻ không đủ context để thành tên phòng");

  var result={
    success:true,
    code:"MASTER_NUMERIC_ROOM_NAME_PASS_V4200",
    names:names,
    junkStillBlocked:["2 pax","350.000 đ","13h"]
  };
  Logger.log(JSON.stringify(result));
  return result;
}

/**
 * File: test.js
 * Run trong Apps Script: testStructureNumericRoomNamesV4200
 * Mục tiêu: StructureSnapshot phải giữ cùng tập tên số để reconcile không làm rơi My House.
 */
function testStructureNumericRoomNamesV4200(){
  var values=[
    ["","","My House","","","","",""],
    ["","","Thông tin phòng","","","","",""],
    ["","","101","102","201","202","301","302"],
    ["","","2 pax","2 pax","2 pax","2 pax","2 pax","2 pax"]
  ];
  var config={
    nameMode:"AUTO_ROW",
    startColumnIndex:2,
    endColumnIndex:7,
    excludedColumnIndexes:[],
    topRows:10,
    minimumNamesInRow:2,
    minimumNameScore:18,
    fallbackEnabled:true
  };
  var detection=evaluateMasterVillaNameRow(values,2,config);
  var villas=ssStructureDetectedRowVillasV340_(values,detection,config);
  var names=villas.map(function(v){return v.name;});
  var expected=["101","102","201","202","301","302"];
  searchAssertV1_(JSON.stringify(names)===JSON.stringify(expected),
    "StructureSnapshot numeric rooms lệch: "+JSON.stringify(names));
  var result={success:true,code:"STRUCTURE_NUMERIC_ROOM_NAME_PASS_V4200",names:names};
  Logger.log(JSON.stringify(result));
  return result;
}


/* ================= V5.9 PRICE PARSER REGRESSION ================= */
/**
 * File: test.js
 * Run: testPriceParserV59
 */
function testPriceParserV59(){
  var simple=[
    ["7tr",7000000],
    ["7tr5",7500000],
    ["6tr5",6500000],
    ["7.5tr",7500000],
    ["7,5tr",7500000],
    ["1.7",1700000],
    ["2.5",2500000],
    ["7000",7000000],
    ["7.000.000",7000000]
  ];
  simple.forEach(function(c){
    var got=ceParsePriceForVillaV59_(c[0],{bedrooms:0},"");
    searchAssertV1_(got===c[1],c[0]+" expected "+c[1]+" got "+got);
  });

  var p6=ceParsePriceForVillaV59_("7tr/ 6pn 8tr/ 8pn",{bedrooms:6},"");
  var p8=ceParsePriceForVillaV59_("7tr/ 6pn 8tr/ 8pn",{bedrooms:8},"");
  var p7=ceParsePriceForVillaV59_("7tr/ 6pn 8tr/ 8pn",{bedrooms:7},"");
  searchAssertV1_(p6===7000000,"tier 6PN phải là 7tr, got "+p6);
  searchAssertV1_(p8===8000000,"tier 8PN phải là 8tr, got "+p8);
  searchAssertV1_(p7===null,"7PN không có tier rõ, phải UNKNOWN");

  var pRange6=ceParsePriceForVillaV59_("3tr5/ 4pn 4tr/ 5pn 5tr/ 6-8pn",{bedrooms:6},"");
  var pRange7=ceParsePriceForVillaV59_("3tr5/ 4pn 4tr/ 5pn 5tr/ 6-8pn",{bedrooms:7},"");
  var pRange8=ceParsePriceForVillaV59_("3tr5/ 4pn 4tr/ 5pn 5tr/ 6-8pn",{bedrooms:8},"");
  searchAssertV1_(pRange6===5000000 && pRange7===5000000 && pRange8===5000000,
    "range 6-8PN phải là 5tr");

  var noPn=ceParsePriceForVillaV59_("7tr/ 6pn 8tr/ 8pn",{bedrooms:0},"");
  searchAssertV1_(noPn===null,"multi-tier thiếu PN phải UNKNOWN");

  var totalStay=ceParsePriceForVillaV59_("17tr/3đêm",{bedrooms:5},"");
  searchAssertV1_(totalStay===null,"17tr/3đêm không được coi là 17tr/đêm");

  var optionPn=ceParsePriceForVillaV59_("6tr/ 6pn 7tr/ 8pn",{bedrooms:0},"8PN 15 khách");
  searchAssertV1_(optionPn===7000000,"option label 8PN phải chọn 7tr");

  var result={
    success:true,
    code:"PRICE_PARSER_PASS_V59",
    simpleCases:simple.length,
    tier6:p6,
    tier8:p8,
    range6to8:pRange7,
    multiTierUnknown:noPn,
    multiNightUnknown:totalStay,
    optionPn:optionPn
  };
  Logger.log(JSON.stringify(result));
  return result;
}

/**
 * File: test.js
 * Run: testPriceParserTrieuShorthandV59
 * Regression riêng cho dữ liệu Vũng Tàu/Trần Duy.
 */
function testPriceParserTrieuShorthandV59(){
  var cases={
    "7tr":7000000,
    "7tr5":7500000,
    "6tr5":6500000,
    "8tr5":8500000,
    "11tr":11000000,
    "14tr":14000000
  };
  Object.keys(cases).forEach(function(raw){
    var got=ceParsePriceForVillaV59_(raw,{bedrooms:0},"");
    searchAssertV1_(got===cases[raw],raw+" parse sai: "+got);
  });
  var result={success:true,code:"PRICE_TR_SHORTHAND_PASS_V59",cases:Object.keys(cases).length};
  Logger.log(JSON.stringify(result));
  return result;
}


/** V3.2.9 - regression: đổi SOURCE_COLUMN phải invalidate ảnh/cache cũ. */
function testImageSourceColumnInvalidationV329(){
  if(typeof beShouldInvalidatePreviousImageV329_ !== "function")
    throw new Error("Missing beShouldInvalidatePreviousImageV329_");
  if(typeof beImageCacheSourceKeyV329_ !== "function")
    throw new Error("Missing beImageCacheSourceKeyV329_");

  var cases=[
    {prev:11,cur:11,expected:false},
    {prev:11,cur:12,expected:true},
    {prev:0,cur:12,expected:false},
    {prev:12,cur:0,expected:false}
  ];
  cases.forEach(function(c){
    var actual=beShouldInvalidatePreviousImageV329_(c.prev,c.cur);
    if(actual!==c.expected)
      throw new Error("IMAGE_SOURCE_COLUMN_INVALIDATION prev="+c.prev+" cur="+c.cur+" expected="+c.expected+" actual="+actual);
  });

  var key11=beImageCacheSourceKeyV329_("","SKU_X","135",11);
  var key12=beImageCacheSourceKeyV329_("","SKU_X","135",12);
  var manual=beImageCacheSourceKeyV329_("https://manual.example/img.jpg","SKU_X","135",12);
  if(key11!=="135_COL_11") throw new Error("Bad key11: "+key11);
  if(key12!=="135_COL_12") throw new Error("Bad key12: "+key12);
  if(key11===key12) throw new Error("Column-specific cache keys collided");
  if(manual!=="MANUAL_SKU_X") throw new Error("Manual cache key changed: "+manual);

  var result={
    success:true,
    code:"IMAGE_SOURCE_COLUMN_INVALIDATION_PASS_V329",
    key11:key11,
    key12:key12,
    manual:manual,
    cases:cases.length
  };
  Logger.log(JSON.stringify(result));
  return result;
}
