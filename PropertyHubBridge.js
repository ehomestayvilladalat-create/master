/**
 * PropertyHubBridge.js - V1.0.0
 *
 * Public, read-only bridge from EHOME Customer API to the separate Property Hub.
 *
 * Safety contract
 * - Disabled by default. When disabled or the Hub is unavailable, Customer Web
 *   receives exactly the legacy Booking DTO/MASTER_VILLA image.
 * - This file never writes to MASTER_VILLA, image queues, Drive, calendars,
 *   prices, source readers, triggers or maintenance jobs.
 * - Only MÃ_CĂN / villa_id is used as the join key. Names/folders are never used.
 * - One batch fetch at most per Customer request, after Booking search ends.
 * - Original source image remains the default cover. Hub may replace cover only
 *   when an APPROVED record explicitly sets useAsCover=true.
 *
 * Script Properties (all optional)
 * EHOME_PROPERTY_HUB_ENABLED          TRUE to enable live Hub reads (default FALSE)
 * EHOME_PROPERTY_HUB_URL              deployed Property Hub public endpoint
 * EHOME_PROPERTY_HUB_TOKEN            optional shared bearer token
 * EHOME_PROPERTY_HUB_CACHE_SECONDS    60..900, default 300
 */

var CE_PROPERTY_HUB_VERSION_V1_ = "1.0.0";
var CE_PROPERTY_HUB_ACTION_V1_ = "EHOME_PROPERTY_HUB_PUBLIC_V1";
var CE_PROPERTY_HUB_DEFAULT_CACHE_SECONDS_V1_ = 300;
var CE_PROPERTY_HUB_MAX_IDS_PER_REQUEST_V1_ = 48;

/**
 * Applies an approved, public-only Property Hub overlay to Customer DTOs.
 * This is intentionally called only after apiCustomerSearchV61 has produced
 * its safe results; internal Booking records never receive Hub data.
 */
function cePropertyHubEnrichCustomerResultsV1_(results){
  var original=Array.isArray(results)?results:[];
  if(!original.length)return original;

  try{
    var ids=[];
    original.forEach(function(item){
      var id=String(item&&item.villaId||"").trim();
      if(id&&ids.indexOf(id)<0)ids.push(id);
    });
    if(!ids.length)return original;

    var hubMap=cePropertyHubReadApprovedPublicMapV1_(ids);
    if(!hubMap||!Object.keys(hubMap).length)return original;

    return original.map(function(item){
      var id=String(item&&item.villaId||"").trim();
      var overlay=hubMap[id];
      return overlay?cePropertyHubApplyPublicOverlayV1_(item,overlay):item;
    });
  }catch(err){
    // Fail open: Customer search must never fail because the optional Hub fails.
    cePropertyHubLogV1_("PROPERTY_HUB_CUSTOMER_FALLBACK_V1",{reason:cePropertyHubSafeErrorV1_(err)});
    return original;
  }
}

/**
 * Returns a normalized map keyed by villa_id. No network call occurs unless
 * the bridge is explicitly enabled and a valid Hub URL is configured.
 */
function cePropertyHubReadApprovedPublicMapV1_(villaIds){
  var ids=cePropertyHubNormalizeIdsV1_(villaIds);
  if(!ids.length||!cePropertyHubIsEnabledV1_())return {};

  var url=cePropertyHubGetUrlV1_();
  if(!url){
    cePropertyHubLogV1_("PROPERTY_HUB_NOT_CONFIGURED_V1",{});
    return {};
  }

  var cacheKey=cePropertyHubCacheKeyV1_(ids);
  var cached=cePropertyHubCacheGetV1_(cacheKey);
  if(cached)return cached;

  var payload={
    action:CE_PROPERTY_HUB_ACTION_V1_,
    contractVersion:1,
    consumer:"EHOME_CUSTOMER_WEB",
    villaIds:ids
  };
  var headers={Accept:"application/json"};
  var token=cePropertyHubGetPropertyV1_("EHOME_PROPERTY_HUB_TOKEN");
  if(token)headers.Authorization="Bearer "+token;

  var response=UrlFetchApp.fetch(url,{
    method:"post",
    contentType:"application/json",
    payload:JSON.stringify(payload),
    headers:headers,
    muteHttpExceptions:true,
    followRedirects:true
  });
  var status=Number(response&&response.getResponseCode&&response.getResponseCode());
  if(status<200||status>=300){
    cePropertyHubLogV1_("PROPERTY_HUB_HTTP_FALLBACK_V1",{status:status||0});
    return {};
  }

  var body=String(response&&response.getContentText&&response.getContentText()||"");
  var parsed;
  try{parsed=JSON.parse(body);}catch(parseErr){
    cePropertyHubLogV1_("PROPERTY_HUB_INVALID_JSON_V1",{});
    return {};
  }
  if(parsed&&parsed.success===false){
    cePropertyHubLogV1_("PROPERTY_HUB_REJECTED_V1",{code:String(parsed.code||"").slice(0,80)});
    return {};
  }

  var map=cePropertyHubNormalizePublicMapV1_(parsed,ids);
  if(Object.keys(map).length)cePropertyHubCachePutV1_(cacheKey,map,cePropertyHubCacheSecondsV1_());
  cePropertyHubLogV1_("PROPERTY_HUB_BATCH_READ_V1",{ids:ids.length,approved:Object.keys(map).length,cache:false});
  return map;
}

function cePropertyHubNormalizePublicMapV1_(payload,requestedIds){
  var allowed={};(requestedIds||[]).forEach(function(id){allowed[String(id)]=true;});
  var raw={};
  if(payload&&payload.properties!==undefined)raw=payload.properties;
  else if(payload&&payload.data!==undefined)raw=payload.data;
  else if(payload&&payload.result!==undefined)raw=payload.result;
  else raw=payload||{};

  var pairs=[];
  if(Array.isArray(raw)){
    raw.forEach(function(record){pairs.push([String(record&&((record.villaId!==undefined?record.villaId:record.villa_id)||"")||"").trim(),record]);});
  }else if(raw&&typeof raw==="object"){
    Object.keys(raw).forEach(function(id){
      var value=raw[id];
      if(value&&typeof value==="object"&&value.villaId===undefined&&value.villa_id===undefined)value.villaId=id;
      pairs.push([String(id||"").trim(),value]);
    });
  }

  var out={};
  pairs.forEach(function(pair){
    var id=String(pair[0]||"").trim(),record=pair[1]||{};
    var recordId=String(record.villaId!==undefined?record.villaId:(record.villa_id!==undefined?record.villa_id:id)||"").trim();
    if(!recordId||recordId!==id||!allowed[id])return;
    if(String(record.status||"").trim().toUpperCase()!=="APPROVED")return;
    var normalized=cePropertyHubNormalizePublicRecordV1_(record,id);
    if(normalized)out[id]=normalized;
  });
  return out;
}

function cePropertyHubNormalizePublicRecordV1_(record,id){
  record=record||{};
  var cover=cePropertyHubReadImageUrlV1_(record,["coverImageUrl","cover_image_url","coverImage","cover_image"]);
  var images=[];
  if(cover)images.push(cover);
  var media=record.images!==undefined?record.images:(record.gallery!==undefined?record.gallery:record.media);
  if(Array.isArray(media)){
    media.forEach(function(item){
      var url=typeof item==="string"?item:cePropertyHubReadImageUrlV1_(item||{},["publicUrl","public_url","url","imageUrl","image_url"]);
      if(url&&images.indexOf(url)<0)images.push(url);
    });
  }
  if(!images.length&&!cePropertyHubTruthyV1_(record.usePublicProfile||record.use_public_profile))return null;

  var useProfile=cePropertyHubTruthyV1_(record.usePublicProfile||record.use_public_profile);
  return {
    villaId:id,
    useAsCover:cePropertyHubTruthyV1_(record.useAsCover||record.use_as_cover),
    usePublicProfile:useProfile,
    coverImageUrl:cover,
    images:images,
    displayName:useProfile?cePropertyHubSafeTextV1_(record.displayName||record.display_name,160):"",
    shortDescription:useProfile?cePropertyHubSafeTextV1_(record.shortDescription||record.short_description||record.publicDescription||record.public_description,1200):""
  };
}

function cePropertyHubApplyPublicOverlayV1_(customerVilla,overlay){
  var source=customerVilla||{},hub=overlay||{};
  var result={};
  Object.keys(source).forEach(function(key){result[key]=source[key];});

  var originalImage=String(source.image||"").trim();
  var hubImages=Array.isArray(hub.images)?hub.images:[];
  var cover=String(hub.coverImageUrl||hubImages[0]||"").trim();
  var images=[];
  // Original source image is first unless a human explicitly approved a cover override.
  if(hub.useAsCover&&cover)images.push(cover);
  if(originalImage&&images.indexOf(originalImage)<0)images.push(originalImage);
  hubImages.forEach(function(url){if(url&&images.indexOf(url)<0)images.push(url);});

  if(hub.useAsCover&&cover)result.image=cover;
  // Extra field is public-only and backwards compatible: old frontend ignores it;
  // the new Customer UI can render up to four source/approved gallery images.
  result.images=images;

  if(hub.usePublicProfile){
    if(hub.displayName)result.name=hub.displayName;
    if(hub.shortDescription)result.info=cePropertyHubCustomerSafeInfoV1_(hub.shortDescription);
  }
  return result;
}

function cePropertyHubReadImageUrlV1_(record,keys){
  record=record||{};
  for(var i=0;i<(keys||[]).length;i++){
    var value=String(record[keys[i]]||"").trim();
    if(/^https:\/\//i.test(value))return value;
  }
  return "";
}
function cePropertyHubCustomerSafeInfoV1_(text){
  if(typeof ceCustomerSanitizeInfoV61_==="function")return ceCustomerSanitizeInfoV61_(text);
  return cePropertyHubSafeTextV1_(text,1200);
}
function cePropertyHubSafeTextV1_(value,maxLength){return String(value||"").replace(/[\r\n\t]+/g," ").replace(/\s+/g," ").trim().slice(0,Number(maxLength||1200));}
function cePropertyHubTruthyV1_(value){return value===true||value===1||String(value||"").trim().toUpperCase()==="TRUE"||String(value||"").trim()==="1";}
function cePropertyHubNormalizeIdsV1_(ids){var seen={},out=[];(ids||[]).forEach(function(value){var id=String(value||"").trim();if(id&&!seen[id]&&out.length<CE_PROPERTY_HUB_MAX_IDS_PER_REQUEST_V1_){seen[id]=true;out.push(id);}});return out.sort();}
function cePropertyHubIsEnabledV1_(){return String(cePropertyHubGetPropertyV1_("EHOME_PROPERTY_HUB_ENABLED")||"").trim().toUpperCase()==="TRUE";}
function cePropertyHubGetUrlV1_(){var value=String(cePropertyHubGetPropertyV1_("EHOME_PROPERTY_HUB_URL")||"").trim();return /^https:\/\//i.test(value)?value:"";}
function cePropertyHubGetPropertyV1_(key){try{return PropertiesService.getScriptProperties().getProperty(key)||"";}catch(ignore){return "";}}
function cePropertyHubCacheSecondsV1_(){var value=Number(cePropertyHubGetPropertyV1_("EHOME_PROPERTY_HUB_CACHE_SECONDS")||CE_PROPERTY_HUB_DEFAULT_CACHE_SECONDS_V1_);return Math.max(60,Math.min(900,isFinite(value)?value:CE_PROPERTY_HUB_DEFAULT_CACHE_SECONDS_V1_));}
function cePropertyHubCacheKeyV1_(ids){var raw=String((ids||[]).join("|"));try{var bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,raw,Utilities.Charset.UTF_8);return "EHOME_PROPERTY_HUB_PUBLIC_V1_"+bytes.map(function(b){return ("0"+((b+256)%256).toString(16)).slice(-2);}).join("").slice(0,32);}catch(ignore){return "EHOME_PROPERTY_HUB_PUBLIC_V1_"+raw.replace(/[^A-Za-z0-9]/g,"_").slice(0,120);}}
function cePropertyHubCacheGetV1_(key){try{var raw=CacheService.getScriptCache().get(key);if(!raw)return null;var parsed=JSON.parse(raw);return parsed&&typeof parsed==="object"?parsed:null;}catch(ignore){return null;}}
function cePropertyHubCachePutV1_(key,value,seconds){try{CacheService.getScriptCache().put(key,JSON.stringify(value),seconds);}catch(ignore){}}
function cePropertyHubSafeErrorV1_(err){return String(err&&err.message?err.message:err||"ERROR").replace(/https?:\/\/\S+/gi,"URL").slice(0,120);}
function cePropertyHubLogV1_(code,data){try{Logger.log(JSON.stringify({code:code,version:CE_PROPERTY_HUB_VERSION_V1_,data:data||{}}));}catch(ignore){}}

/** Run manually in Apps Script. Pure regression test: no network, no sheet write. */
function testEhomePropertyHubBridgeV1(){
  var base={villaId:"VL-01",name:"Tên nguồn",image:"https://source.example/original.jpg",info:"Thông tin nguồn",available:true};
  var map=cePropertyHubNormalizePublicMapV1_({success:true,properties:{
    "VL-01":{villaId:"VL-01",status:"APPROVED",coverImageUrl:"https://hub.example/cover.jpg",images:["https://hub.example/cover.jpg","https://hub.example/gallery-2.jpg"],useAsCover:false},
    "VL-02":{villaId:"VL-02",status:"DRAFT",coverImageUrl:"https://hub.example/draft.jpg",useAsCover:true},
    "VL-03":{villaId:"WRONG",status:"APPROVED",coverImageUrl:"https://hub.example/wrong.jpg"}
  }},["VL-01","VL-02","VL-03"]);
  if(!map["VL-01"]||map["VL-02"]||map["VL-03"])throw new Error("PROPERTY_HUB_APPROVAL_GATE_FAIL_V1");
  var normal=cePropertyHubApplyPublicOverlayV1_(base,map["VL-01"]);
  if(normal.image!==base.image||normal.images[0]!==base.image||normal.images.indexOf("https://hub.example/gallery-2.jpg")<0)throw new Error("PROPERTY_HUB_SOURCE_IMAGE_DEFAULT_FAIL_V1");
  var cover=cePropertyHubApplyPublicOverlayV1_(base,{useAsCover:true,coverImageUrl:"https://hub.example/approved-cover.jpg",images:["https://hub.example/approved-cover.jpg"]});
  if(cover.image!=="https://hub.example/approved-cover.jpg"||cover.images[1]!==base.image)throw new Error("PROPERTY_HUB_EXPLICIT_COVER_FAIL_V1");
  var fallback=cePropertyHubApplyPublicOverlayV1_(base,{});
  if(fallback.image!==base.image)throw new Error("PROPERTY_HUB_FALLBACK_FAIL_V1");
  var result={success:true,code:"EHOME_PROPERTY_HUB_BRIDGE_PASS_V1",sourceImageDefault:true,approvedCoverOnly:true,draftBlocked:true,legacyFallback:true};
  Logger.log(JSON.stringify(result));
  return result;
}

function getEhomePropertyHubStatusV1(){
  var enabled=cePropertyHubIsEnabledV1_(),configured=!!cePropertyHubGetUrlV1_();
  var result={success:true,code:"EHOME_PROPERTY_HUB_STATUS_V1",version:CE_PROPERTY_HUB_VERSION_V1_,enabled:enabled,configured:configured,mode:enabled&&configured?"LIVE_READ_ONLY":"LEGACY_FALLBACK",sourceImageDefault:true,explicitCoverOverrideOnly:true};
  Logger.log(JSON.stringify(result));
  return result;
}
