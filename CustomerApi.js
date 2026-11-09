/**
 * CustomerApi.js - V6.2.9 SAFETY-GUARDED PROGRESSIVE CUSTOMER API FOR ehomebooking.com
 *
 * Customer UX:
 * - First paint: return up to 6 confirmed snapshot villas as fast as possible.
 * - Keep a small 12-result snapshot buffer so the next 6 can append immediately.
 * - Continue snapshot scanning from a candidate cursor; never rescan from candidate 0.
 * - Only after snapshot candidates are exhausted do MISS/STALE villas enter small LIVE batches.
 *
 * Internal/admin search is NOT changed here.
 */

var CE_CUSTOMER_PROGRESSIVE_V627_ = {
  CACHE_PREFIX:"BE_CUST_SEARCH_V629_",
  TTL_SECONDS:300,
  FIRST_PAINT_SIZE:6,
  SNAPSHOT_BUFFER_TARGET:12,
  SNAPSHOT_SCAN_LIMIT:24,
  SNAPSHOT_RUNTIME_MS:6500,
  LIVE_BATCH_MAX_IDS:6,
  LIVE_BATCH_MAX_SOURCES:2,
  LIVE_BATCH_RUNTIME_MS:12000
};

/** Public customer search entrypoint. */
function apiCustomerSearchV61(request){
  request=request||{};
  var sortMode=String(request.sortMode||"BEST").toUpperCase();
  if(["BEST","PRICE_ASC","PRICE_DESC"].indexOf(sortMode)<0)sortMode="BEST";
  if(sortMode!=="BEST")return ceCustomerSearchLegacyV626_(request);
  return ceCustomerSearchProgressiveV627_(request);
}

function ceCustomerSearchProgressiveV627_(request){
  request=request||{};
  var requestedPageSize=Math.max(1,Math.min(24,Number(request.pageSize||12)));
  var cursor=Math.max(0,Number(request.cursor||0));
  var fingerprint=ceCustomerSearchFingerprintV627_(request);
  var token=String(request.searchToken||"").trim();
  var session=token?ceCustomerGetProgressiveSessionV627_(token):null;

  if(token&&(!session||session.fingerprint!==fingerprint)){
    return {success:false,code:"CUSTOMER_SEARCH_SESSION_EXPIRED_V629",restart:true,error:"Phiên tìm kiếm đã hết hạn. Vui lòng tìm lại."};
  }
  if(session&&session.masterRevisionV629){
    var currentRevisionV629=ceCustomerMasterRevisionV629_();
    if(currentRevisionV629!==session.masterRevisionV629){
      return {success:false,code:"CUSTOMER_SEARCH_MASTER_CHANGED_V629",restart:true,error:"Dữ liệu căn vừa thay đổi. Vui lòng tìm lại để lấy kết quả mới nhất."};
    }
  }

  var isFirstRequest=!session;
  if(!session){
    var started=new Date().getTime();
    var productType=ceCustomerNormalizeFilterProductTypeV61_(request.productType||"NGUYEN_CAN");
    var bedrooms=Math.max(0,Number(request.bedrooms||0));
    var minNight=Math.max(0,Number(request.minPrice||0));
    var maxNight=Math.max(0,Number(request.maxPrice||0));
    if(minNight>0&&maxNight>0&&maxNight<minNight){var swap=minNight;minNight=maxNight;maxNight=swap;}
    var area=String(request.area||"").trim();
    var amenities=Array.isArray(request.amenities)?request.amenities.map(String):[];
    var meta=ceCustomerMetaMapV61_();
    var allowedIds=ceCustomerAllowedVillaIdsV61_(meta,productType,bedrooms,area,amenities);
    var priorityScores=(typeof ceCustomerPriorityScoreMapV617_==="function")?ceCustomerPriorityScoreMapV617_():{};
    var featuredMap=(typeof ceCustomerPriorityFeaturedMapV617_==="function")?ceCustomerPriorityFeaturedMapV617_(allowedIds,priorityScores,12):{};
    var bufferTarget=Math.max(Number(CE_CUSTOMER_PROGRESSIVE_V627_.FIRST_PAINT_SIZE||6),Number(CE_CUSTOMER_PROGRESSIVE_V627_.SNAPSHOT_BUFFER_TARGET||12));

    var snap=ceSearchAvailableVillasInternal_(request.checkIn,request.checkOut,Number(request.guests||0),{
      city:request.city||"",cursor:0,pageSize:bufferTarget,minPrice:0,maxPrice:0,sortMode:"BEST",
      shuffleSeed:String(request.shuffleSeed||""),productType:"ALL",bedrooms:0,
      allowedVillaIds:allowedIds,priorityScores:priorityScores,maxVillas:0,debug:false,
      snapshotOnlyV627:true,snapshotTrustBackgroundV627:true,snapshotVerifyModifiedV629:true,
      snapshotResultLimitV628:bufferTarget,
      snapshotCandidateScanLimitV628:Number(CE_CUSTOMER_PROGRESSIVE_V627_.SNAPSHOT_SCAN_LIMIT||80),
      maxRuntimeMs:Number(CE_CUSTOMER_PROGRESSIVE_V627_.SNAPSHOT_RUNTIME_MS||6500)
    });

    var safeSnapshot=ceCustomerSanitizeBatchV627_(snap&&snap.results||[],meta,featuredMap,minNight,maxNight);
    token=Utilities.getUuid().replace(/-/g,"").slice(0,24);
    var candidateNext=Math.max(0,Number(snap&&snap.candidateNext||0));
    var pinnedCandidateIdsV629=Array.isArray(snap&&snap.candidateIdsV629)?snap.candidateIdsV629.filter(Boolean):[];
    var totalCandidates=pinnedCandidateIdsV629.length||Math.max(candidateNext,Number(snap&&snap.totalCandidates||0));
    session={
      version:"V629",fingerprint:fingerprint,masterRevisionV629:ceCustomerMasterRevisionV629_(),createdAt:new Date().toISOString(),
      query:{checkIn:String(request.checkIn||""),checkOut:String(request.checkOut||""),guests:Number(request.guests||0),
        nights:Number(snap&&snap.query&&snap.query.nights||0),city:String(request.city||""),productType:productType,
        bedrooms:bedrooms,area:area,amenities:amenities,minPrice:minNight,maxPrice:maxNight,sortMode:"BEST",shuffleSeed:String(request.shuffleSeed||"")},
      snapshotResults:safeSnapshot,
      deferredIds:Array.isArray(snap&&snap.deferredVillaIdsV627)?snap.deferredVillaIdsV627.filter(Boolean):[],
      candidateIds:pinnedCandidateIdsV629,
      liveDeliveredIds:[],
      snapshotCandidateCursor:candidateNext,
      snapshotTotalCandidates:totalCandidates,
      snapshotScanDone:candidateNext>=totalCandidates,
      featuredIds:Object.keys(featuredMap||{}),
      firstPhaseMs:new Date().getTime()-started,
      snapshotStats:snap&&snap.snapshotV320||{}
    };
    ceCustomerPutProgressiveSessionV627_(token,session);
    cursor=0;
  }

  var firstPaintSize=Math.max(1,Math.min(requestedPageSize,Number(CE_CUSTOMER_PROGRESSIVE_V627_.FIRST_PAINT_SIZE||6)));
  return ceCustomerBuildProgressivePageV627_(token,session,cursor,isFirstRequest?firstPaintSize:requestedPageSize,request,isFirstRequest);
}

/**
 * Continue the snapshot phase from the saved candidate cursor.
 * This function never opens source Sheets. It only extends the confirmed snapshot buffer.
 */
function ceCustomerExtendSnapshotBufferV628_(token,session,targetCount){
  if(!session||session.snapshotScanDone===true)return session;
  var meta=ceCustomerMetaMapV61_();
  var q=session.query||{};
  var allowedIds=ceCustomerAllowedVillaIdsV61_(meta,q.productType||"NGUYEN_CAN",Number(q.bedrooms||0),String(q.area||""),Array.isArray(q.amenities)?q.amenities:[]);
  var priorityScores=(typeof ceCustomerPriorityScoreMapV617_==="function")?ceCustomerPriorityScoreMapV617_():{};
  var featuredMap={};
  (session.featuredIds||[]).forEach(function(id){featuredMap[String(id||"")]=true;});
  var candidateCursor=Math.max(0,Number(session.snapshotCandidateCursor||0));
  var pinnedIdsV629=Array.isArray(session.candidateIds)?session.candidateIds:[];
  var scanLimitV629=Math.max(1,Number(CE_CUSTOMER_PROGRESSIVE_V627_.SNAPSHOT_SCAN_LIMIT||80));
  var windowAllowedV629={};
  Object.keys(allowedIds||{}).forEach(function(id){windowAllowedV629[id]=true;});
  // FIX16: bỏ qua các cửa sổ không có căn nào khớp bộ lọc (tránh đứng vị trí mãi)
  var skipGuardV1=0;
  while(pinnedIdsV629.length&&candidateCursor<pinnedIdsV629.length&&skipGuardV1<50){
    var skipWindowV1=pinnedIdsV629.slice(candidateCursor,candidateCursor+scanLimitV629);
    if(skipWindowV1.some(function(id){return windowAllowedV629[String(id||"")];}))break;
    candidateCursor+=skipWindowV1.length;skipGuardV1++;
  }
  if(pinnedIdsV629.length&&candidateCursor>=pinnedIdsV629.length){
    session.snapshotCandidateCursor=pinnedIdsV629.length;
    session.snapshotTotalCandidates=pinnedIdsV629.length;
    session.snapshotScanDone=true;
    ceCustomerPutProgressiveSessionV627_(token,session);
    return session;
  }
  var windowIdsV629=pinnedIdsV629.length?pinnedIdsV629.slice(candidateCursor,candidateCursor+scanLimitV629):[];
  var effectiveAllowedV629=windowIdsV629.length?windowIdsV629.filter(function(id){return windowAllowedV629[String(id||"")];}):Object.keys(windowAllowedV629);

  var snap=ceSearchAvailableVillasInternal_(q.checkIn,q.checkOut,Number(q.guests||0),{
    city:q.city||"",cursor:0,pageSize:targetCount,minPrice:0,maxPrice:0,sortMode:"BEST",
    shuffleSeed:String(q.shuffleSeed||""),productType:"ALL",bedrooms:0,
    allowedVillaIds:effectiveAllowedV629,priorityScores:priorityScores,maxVillas:0,debug:false,
    candidateIdOrderV629:windowIdsV629,
    snapshotOnlyV627:true,snapshotTrustBackgroundV627:true,snapshotVerifyModifiedV629:true,
    snapshotResultLimitV628:Math.max(1,Math.min(24,Number(targetCount||12))),
    snapshotCandidateScanLimitV628:windowIdsV629.length||scanLimitV629,
    maxRuntimeMs:Number(CE_CUSTOMER_PROGRESSIVE_V627_.SNAPSHOT_RUNTIME_MS||6500)
  });

  var safe=ceCustomerSanitizeBatchV627_(snap&&snap.results||[],meta,featuredMap,Number(q.minPrice||0),Number(q.maxPrice||0));
  var existing={};
  (session.snapshotResults||[]).forEach(function(v){if(v&&v.villaId)existing[String(v.villaId)]=true;});
  safe.forEach(function(v){var id=String(v&&v.villaId||"");if(id&&!existing[id]){session.snapshotResults.push(v);existing[id]=true;}});

  var deferredSeen={};
  (session.deferredIds||[]).forEach(function(id){deferredSeen[String(id||"")]=true;});
  (snap&&snap.deferredVillaIdsV627||[]).forEach(function(id){id=String(id||"");if(id&&!deferredSeen[id]){session.deferredIds.push(id);deferredSeen[id]=true;}});

  var relativeNextV629=Math.max(0,Number(snap&&snap.candidateNext||0));
  var next=Math.max(candidateCursor,candidateCursor+relativeNextV629);
  var total=pinnedIdsV629.length||Math.max(next,Number(session.snapshotTotalCandidates||0));
  session.snapshotCandidateCursor=Math.min(next,total);
  session.snapshotTotalCandidates=total;
  session.snapshotScanDone=next>=total;
  session.snapshotStats=snap&&snap.snapshotV320||session.snapshotStats||{};
  ceCustomerPutProgressiveSessionV627_(token,session);
  return session;
}

function ceCustomerBuildProgressivePageV627_(token,session,cursor,pageSize,request,isFirstRequest){
  session.snapshotResults=Array.isArray(session.snapshotResults)?session.snapshotResults:[];
  session.deferredIds=Array.isArray(session.deferredIds)?session.deferredIds:[];

  // Serve already-buffered snapshot results first (first request returns max 6).
  if(cursor<session.snapshotResults.length){
    var bufferedRawV629=session.snapshotResults.slice(cursor,Math.min(session.snapshotResults.length,cursor+pageSize));
    var bufferedNext=cursor+bufferedRawV629.length;
    var bufferedPage=ceCustomerFilterStillActiveV629_(bufferedRawV629);
    if(typeof cePropertyHubEnrichCustomerResultsV1_==="function")bufferedPage=cePropertyHubEnrichCustomerResultsV1_(bufferedPage);
    var bufferedHasMore=bufferedNext<session.snapshotResults.length||session.snapshotScanDone!==true||session.deferredIds.length>0;
    return {
      success:true,query:session.query||{},count:bufferedPage.length,nextCursor:bufferedNext,
      hasMore:bufferedHasMore,complete:!bufferedHasMore,partial:bufferedHasMore,
      partialReason:bufferedHasMore?"MORE_RESULTS_PENDING":"",phase:"SNAPSHOT",
      searchToken:token,snapshotCount:session.snapshotResults.length,deferredCount:session.deferredIds.length,
      snapshotScanDone:session.snapshotScanDone===true,candidateCursor:Number(session.snapshotCandidateCursor||0),
      firstPhaseMs:Number(session.firstPhaseMs||0),prefetchRecommended:bufferedHasMore,
      firstPaintTarget:Number(CE_CUSTOMER_PROGRESSIVE_V627_.FIRST_PAINT_SIZE||6),results:bufferedPage
    };
  }

  // First HTTP response never performs a second snapshot pass. Return immediately
  // after the bounded initial scan so UI can paint without extra hidden work.
  if(isFirstRequest===true){
    var firstPendingPhaseV629=session.snapshotScanDone===true?"LIVE_PENDING":"SNAPSHOT_SCAN";
    var firstPendingReasonV629=session.snapshotScanDone===true?"LIVE_FALLBACK_PENDING":"SNAPSHOT_PREFETCH_PENDING";
    var firstHasMoreV629=session.snapshotScanDone!==true||session.deferredIds.length>0;
    return {success:true,query:session.query||{},count:0,nextCursor:cursor,hasMore:firstHasMoreV629,complete:!firstHasMoreV629,partial:firstHasMoreV629,
      partialReason:firstHasMoreV629?firstPendingReasonV629:"",phase:firstHasMoreV629?firstPendingPhaseV629:"DONE",searchToken:token,
      snapshotCount:session.snapshotResults.length,deferredCount:session.deferredIds.length,
      snapshotScanDone:session.snapshotScanDone===true,candidateCursor:Number(session.snapshotCandidateCursor||0),prefetchRecommended:firstHasMoreV629,results:[]};
  }

  // Buffer consumed: continue snapshot scan from the saved candidate cursor before any live fallback.
  if(session.snapshotScanDone!==true){
    var oldCount=session.snapshotResults.length;
    session=ceCustomerExtendSnapshotBufferV628_(token,session,Math.max(pageSize,Number(CE_CUSTOMER_PROGRESSIVE_V627_.SNAPSHOT_BUFFER_TARGET||12)));
    if(session.snapshotResults.length>oldCount){
      var newRawV629=session.snapshotResults.slice(cursor,Math.min(session.snapshotResults.length,cursor+pageSize));
      var newNext=cursor+newRawV629.length;
      var newPage=ceCustomerFilterStillActiveV629_(newRawV629);
      if(typeof cePropertyHubEnrichCustomerResultsV1_==="function")newPage=cePropertyHubEnrichCustomerResultsV1_(newPage);
      return {
        success:true,query:session.query||{},count:newPage.length,nextCursor:newNext,
        hasMore:true,complete:false,partial:true,partialReason:"MORE_RESULTS_PENDING",phase:"SNAPSHOT",
        searchToken:token,snapshotCount:session.snapshotResults.length,deferredCount:session.deferredIds.length,
        snapshotScanDone:session.snapshotScanDone===true,candidateCursor:Number(session.snapshotCandidateCursor||0),
        prefetchRecommended:true,results:newPage
      };
    }
    // No confirmed snapshot in this bounded scan, but the candidate cursor advanced.
    if(session.snapshotScanDone!==true){
      return {success:true,query:session.query||{},count:0,nextCursor:cursor,hasMore:true,complete:false,partial:true,
        partialReason:"SNAPSHOT_SCAN_PENDING",phase:"SNAPSHOT_SCAN",searchToken:token,
        snapshotCount:session.snapshotResults.length,deferredCount:session.deferredIds.length,
        snapshotScanDone:false,candidateCursor:Number(session.snapshotCandidateCursor||0),prefetchRecommended:true,results:[]};
    }
  }

  // Snapshot scan is exhausted. Only now verify MISS/STALE candidates live in small batches.
  var snapshotCount=session.snapshotResults.length;
  var deferredIds=session.deferredIds;
  var deferredCount=deferredIds.length;
  var liveOffset=Math.max(0,cursor-snapshotCount);
  if(liveOffset>=deferredCount){
    return {success:true,query:session.query||{},count:0,nextCursor:snapshotCount+deferredCount,hasMore:false,complete:true,partial:false,partialReason:"",phase:"DONE",searchToken:token,snapshotCount:snapshotCount,deferredCount:deferredCount,results:[]};
  }

  var all=ceReadMasterVillas_();
  var byId={};
  (all||[]).forEach(function(v){var id=String(v.id||"").trim();if(id)byId[id]=v;});
  var chosen=[];
  var chosenSources={};
  var span=0;
  var maxIds=Math.max(1,Math.min(Number(CE_CUSTOMER_PROGRESSIVE_V627_.LIVE_BATCH_MAX_IDS||6),pageSize));
  var maxSources=Math.max(1,Number(CE_CUSTOMER_PROGRESSIVE_V627_.LIVE_BATCH_MAX_SOURCES||2));
  for(var i=liveOffset;i<deferredIds.length;i++){
    var id=String(deferredIds[i]||"").trim();
    var villa=byId[id]||null;
    if(!villa){span++;continue;}
    var sourceKey=String(villa.calendarUrl||villa.source||id);
    if(!chosenSources[sourceKey]&&Object.keys(chosenSources).length>=maxSources)break;
    chosenSources[sourceKey]=true;
    chosen.push(id);span++;
    if(chosen.length>=maxIds)break;
  }
  if(span<=0)span=1;

  if(!chosen.length){
    var emptyNext=Math.min(snapshotCount+deferredCount,cursor+span);
    return {success:true,query:session.query||{},count:0,nextCursor:emptyNext,hasMore:emptyNext<snapshotCount+deferredCount,complete:emptyNext>=snapshotCount+deferredCount,partial:emptyNext<snapshotCount+deferredCount,partialReason:emptyNext<snapshotCount+deferredCount?"LIVE_FALLBACK_PENDING":"",phase:"LIVE",searchToken:token,snapshotCount:snapshotCount,deferredCount:deferredCount,results:[]};
  }

  var meta=ceCustomerMetaMapV61_();
  var priorityScores=(typeof ceCustomerPriorityScoreMapV617_==="function")?ceCustomerPriorityScoreMapV617_():{};
  var featuredMap={};
  (session.featuredIds||[]).forEach(function(id){featuredMap[String(id||"")]=true;});
  var liveStarted=new Date().getTime();
  var batch=ceSearchAvailableVillasInternal_(session.query.checkIn,session.query.checkOut,Number(session.query.guests||0),{
    city:session.query.city||"",cursor:0,pageSize:chosen.length,minPrice:0,maxPrice:0,sortMode:"BEST",
    shuffleSeed:String(session.query.shuffleSeed||""),productType:"ALL",bedrooms:0,
    allowedVillaIds:chosen,priorityScores:priorityScores,maxVillas:0,debug:false,
    forceLiveV627:true,maxRuntimeMs:Number(CE_CUSTOMER_PROGRESSIVE_V627_.LIVE_BATCH_RUNTIME_MS||12000)
  });

  var safe=ceCustomerSanitizeBatchV627_(batch&&batch.results||[],meta,featuredMap,Number(session.query.minPrice||0),Number(session.query.maxPrice||0));
  session.liveDeliveredIds=Array.isArray(session.liveDeliveredIds)?session.liveDeliveredIds:[];
  var deliveredMapV629={};
  session.liveDeliveredIds.forEach(function(id){deliveredMapV629[String(id||"")]=true;});
  safe=safe.filter(function(v){var id=String(v&&v.villaId||"");if(!id||deliveredMapV629[id])return false;deliveredMapV629[id]=true;session.liveDeliveredIds.push(id);return true;});
  if(typeof cePropertyHubEnrichCustomerResultsV1_==="function")safe=cePropertyHubEnrichCustomerResultsV1_(safe);

  var failedCountV629=Number(batch&&batch.failedCount||0);
  var retryV629=Boolean(batch&&batch.stoppedEarly===true)||failedCountV629>0;
  if(retryV629){
    ceCustomerPutProgressiveSessionV627_(token,session);
    return {success:true,query:session.query||{},count:safe.length,nextCursor:cursor,hasMore:true,complete:false,partial:true,
      partialReason:(batch&&batch.stoppedEarly===true)?"LIVE_BATCH_RETRY":"LIVE_BATCH_FAILED_RETRY",phase:"LIVE_RETRY",
      searchToken:token,snapshotCount:snapshotCount,deferredCount:deferredCount,failedCount:failedCountV629,
      liveMs:new Date().getTime()-liveStarted,results:safe};
  }

  var nextCursor=Math.min(snapshotCount+deferredCount,cursor+span);
  ceCustomerPutProgressiveSessionV627_(token,session);
  return {
    success:true,query:session.query||{},count:safe.length,nextCursor:nextCursor,
    hasMore:nextCursor<snapshotCount+deferredCount,complete:nextCursor>=snapshotCount+deferredCount,partial:nextCursor<snapshotCount+deferredCount,
    partialReason:nextCursor<snapshotCount+deferredCount?"LIVE_FALLBACK_PENDING":"",phase:"LIVE",
    searchToken:token,snapshotCount:snapshotCount,deferredCount:deferredCount,failedCount:0,
    liveMs:new Date().getTime()-liveStarted,results:safe
  };
}

function ceCustomerMasterRevisionV629_(){
  var villas=ceReadMasterVillas_()||[];
  var text=villas.map(function(v){
    return [String(v&&v.id||""),String(v&&v.sourceColumn||""),String(v&&v.productType||""),String(v&&v.bedrooms||""),String(v&&v.capacityMin||""),String(v&&v.capacityMax||""),String(v&&v.config||"")].join("|");
  }).join("\n");
  var digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g,"").slice(0,24);
}

function ceCustomerFilterStillActiveV629_(rows){
  var active={};
  try{
    (ceReadMasterVillas_()||[]).forEach(function(v){var id=String(v&&v.id||"").trim();if(id)active[id]=true;});
  }catch(error){
    // Fail closed for public delivery if MASTER cannot be read safely.
    Logger.log(JSON.stringify({level:"WARNING",code:"CUSTOMER_ACTIVE_REVALIDATE_FAIL_V629",error:String(error&&error.message?error.message:error)}));
    return [];
  }
  return (rows||[]).filter(function(v){return active[String(v&&v.villaId||"").trim()]===true;});
}

function ceCustomerSanitizeBatchV627_(rows,meta,featuredMap,minNight,maxNight){
  var out=[],seen={};
  (rows||[]).forEach(function(v){
    var id=String(v&&v.villaId||"");if(!id||seen[id])return;
    var m=meta[id]||{};var type=ceCustomerResolveProductTypeV61_(m.productType);if(type==="UNKNOWN")return;
    var pricing=ceCustomerBuildPricingV61_(v.nightlyPrices||[],type);var avg=pricing.averageNightPrice;
    if((minNight>0||maxNight>0)&&avg===null)return;
    if(minNight>0&&avg<minNight)return;if(maxNight>0&&avg>maxNight)return;
    var safe=ceCustomerSanitizeVillaV61_(v,m,type,pricing,m.amenities||[]);
    if(featuredMap&&featuredMap[id])safe.featured=true;
    out.push(safe);seen[id]=true;
  });
  return out;
}

function ceCustomerSearchFingerprintV627_(request){
  request=request||{};
  var raw=JSON.stringify({checkIn:String(request.checkIn||""),checkOut:String(request.checkOut||""),guests:Number(request.guests||0),city:String(request.city||""),productType:String(request.productType||"NGUYEN_CAN"),bedrooms:Number(request.bedrooms||0),area:String(request.area||""),amenities:Array.isArray(request.amenities)?request.amenities.map(String).sort():[],minPrice:Number(request.minPrice||0),maxPrice:Number(request.maxPrice||0),sortMode:String(request.sortMode||"BEST").toUpperCase(),shuffleSeed:String(request.shuffleSeed||"")});
  var digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,raw,Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g,"").slice(0,32);
}

function ceCustomerPutProgressiveSessionV627_(token,session){
  return ceCachePutJsonChunksV23_(CE_CUSTOMER_PROGRESSIVE_V627_.CACHE_PREFIX+String(token||""),session,CE_CUSTOMER_PROGRESSIVE_V627_.TTL_SECONDS);
}

function ceCustomerGetProgressiveSessionV627_(token){
  return ceCacheGetJsonChunksV23_(CE_CUSTOMER_PROGRESSIVE_V627_.CACHE_PREFIX+String(token||""));
}

function ceCustomerSearchLegacyV626_(request){
  request=request||{};
  var started=new Date().getTime();
  var totalBudgetMs=230000;
  var pageSize=Math.max(1,Math.min(24,Number(request.pageSize||12)));
  var cursor=Math.max(0,Number(request.cursor||0));
  var productType=ceCustomerNormalizeFilterProductTypeV61_(request.productType||"NGUYEN_CAN");
  var bedrooms=Math.max(0,Number(request.bedrooms||0));
  var minNight=Math.max(0,Number(request.minPrice||0));
  var maxNight=Math.max(0,Number(request.maxPrice||0));
  var area=String(request.area||"").trim();
  var amenities=Array.isArray(request.amenities)?request.amenities.map(String):[];
  var sortMode=String(request.sortMode||"BEST").toUpperCase();
  if(["BEST","PRICE_ASC","PRICE_DESC"].indexOf(sortMode)<0)sortMode="BEST";
  var priorityScoresV617=(sortMode==="BEST"&&typeof ceCustomerPriorityScoreMapV617_==="function")
    ?ceCustomerPriorityScoreMapV617_():{};
  var seenIdsV616={};
  if(minNight>0&&maxNight>0&&maxNight<minNight){var swap=minNight;minNight=maxNight;maxNight=swap;}

  var meta=ceCustomerMetaMapV61_();
  var allowedIds=ceCustomerAllowedVillaIdsV61_(meta,productType,bedrooms,area,amenities);
  var featuredMapV617=(sortMode==="BEST"&&typeof ceCustomerPriorityFeaturedMapV617_==="function")
    ?ceCustomerPriorityFeaturedMapV617_(allowedIds,priorityScoresV617,12):{};
  var priceOverflowKeyV629="";
  var collected=[];
  if(sortMode!=="BEST"){
    priceOverflowKeyV629="BE_CUST_PRICE_OVF_V629_"+ceCustomerSearchFingerprintV627_(request)+"_"+String(cursor);
    var priorOverflowV629=ceCacheGetJsonChunksV23_(priceOverflowKeyV629);
    if(Array.isArray(priorOverflowV629))collected=priorOverflowV629.slice();
    collected.forEach(function(v){var id=String(v&&v.villaId||"");if(id)seenIdsV616[id]=true;});
  }
  var nextCursor=cursor;
  var hasMore=true;
  var complete=true;
  var partialReason="";
  var loops=0;
  var maxLoops=6;
  var lastEngineCursor=-1;
  var nights=0;

  // V6.1.7: priority đi vào candidate ordering; capacity fit vẫn đứng trước.

  while(collected.length<pageSize&&hasMore&&loops<maxLoops){
    var elapsed=new Date().getTime()-started;
    if(elapsed>=totalBudgetMs){complete=false;partialReason="CUSTOMER_RUNTIME_BUDGET";break;}
    var remaining=Math.max(15000,totalBudgetMs-elapsed);
    var batch=ceSearchAvailableVillasInternal_(
      request.checkIn,request.checkOut,Number(request.guests||0),
      {
        city:request.city||"",
        cursor:nextCursor,
        pageSize:pageSize,
        minPrice:0,
        maxPrice:0,
        sortMode:"BEST",
        shuffleSeed:String(request.shuffleSeed||""),
        productType:"ALL",
        bedrooms:0,
        allowedVillaIds:allowedIds,
        priorityScores:(sortMode==="BEST"?priorityScoresV617:null),
        maxVillas:0,
        debug:false,
        exhaustiveAudit:false,
        maxRuntimeMs:Math.min(60000,remaining)
      }
    );
    loops++;
    if(batch&&batch.query)nights=Number(batch.query.nights||nights||0);
    if(batch&&batch.stoppedEarly===true){complete=false;partialReason="ENGINE_RUNTIME_BUDGET";}
    var previousEngineCursorV629=nextCursor;
    var engineNext=Number(batch&&batch.nextCursor||nextCursor);
    hasMore=Boolean(batch&&batch.hasMore);

    (batch&&batch.results||[]).forEach(function(v){
      if(collected.length>=pageSize&&sortMode==="BEST")return;
      var idV616=String(v.villaId||"");
      if(idV616&&seenIdsV616[idV616])return;
      var m=meta[idV616]||{};
      var type=ceCustomerResolveProductTypeV61_(m.productType);
      if(type==="UNKNOWN")return;
      var pricing=ceCustomerBuildPricingV61_(v.nightlyPrices||[],type);
      var avg=pricing.averageNightPrice;
      // Có filter giá thì giá chưa xác định không được giả vờ nằm trong khoảng.
      if((minNight>0||maxNight>0)&&avg===null)return;
      if(minNight>0&&avg<minNight)return;
      if(maxNight>0&&avg>maxNight)return;
      var safeV616=ceCustomerSanitizeVillaV61_(v,m,type,pricing,m.amenities||[]);
      if(featuredMapV617[idV616])safeV616.featured=true;
      collected.push(safeV616);if(idV616)seenIdsV616[idV616]=true;
    });

    nextCursor=engineNext;
    if(!hasMore)break;
    if(engineNext===lastEngineCursor||engineNext===previousEngineCursorV629){complete=false;partialReason=partialReason||"CURSOR_NOT_ADVANCING";break;}
    lastEngineCursor=previousEngineCursorV629;
    if(batch&&batch.stoppedEarly===true)break;
  }

  if(hasMore&&loops>=maxLoops){complete=false;partialReason=partialReason||"CUSTOMER_SCAN_LIMIT";}

  // PRICE sort ở customer là sort theo GIÁ KHÁCH, không theo base price.
  // Chỉ khẳng định thứ tự hoàn chỉnh khi đã quét hết candidate phù hợp.
  if(sortMode==="PRICE_ASC")collected.sort(function(a,b){return ceCustomerPriceSortV61_(a,b,1);});
  else if(sortMode==="PRICE_DESC")collected.sort(function(a,b){return ceCustomerPriceSortV61_(a,b,-1);});

  var overflowV629=[];
  if(collected.length>pageSize){
    overflowV629=collected.slice(pageSize);
    collected=collected.slice(0,pageSize);
  }
  if(sortMode!=="BEST"&&overflowV629.length){
    ceCachePutJsonChunksV23_("BE_CUST_PRICE_OVF_V629_"+ceCustomerSearchFingerprintV627_(request)+"_"+String(nextCursor),overflowV629,300);
  }
  var responseHasMoreV629=hasMore||overflowV629.length>0;
  var responseCompleteV629=complete&&!responseHasMoreV629;

  // V6.2.2: optional public Property Hub overlay. It runs only after the
  // Booking search has completed and fails open to the original DTO/images.
  if(typeof cePropertyHubEnrichCustomerResultsV1_==="function"){
    collected=cePropertyHubEnrichCustomerResultsV1_(collected);
  }

  return {
    success:true,
    query:{
      checkIn:String(request.checkIn||""),checkOut:String(request.checkOut||""),
      guests:Number(request.guests||0),nights:nights,city:String(request.city||""),
      productType:productType,bedrooms:bedrooms,area:area,amenities:amenities,
      minPrice:minNight,maxPrice:maxNight,sortMode:sortMode
    },
    count:collected.length,
    nextCursor:nextCursor,
    hasMore:responseHasMoreV629,
    complete:responseCompleteV629,
    partial:!responseCompleteV629,
    partialReason:responseCompleteV629?"":partialReason||(overflowV629.length?"PRICE_OVERFLOW_BUFFERED_V629":"MORE_RESULTS_NOT_SCANNED"),
    priceOrderComplete:(sortMode==="BEST")?null:responseCompleteV629,
    results:collected
  };
}

function apiCustomerAvailabilityV61(request){
  request=request||{};
  var villaId=String(request.villaId||"").trim(),month=String(request.month||"").trim(),guests=Math.max(1,Number(request.guests||1));
  if(!villaId)throw new Error("Thiếu mã căn.");
  if(!/^\d{4}-\d{2}$/.test(month))throw new Error("Tháng không hợp lệ.");
  var villa=ceCustomerFindInternalVillaV61_(villaId);if(!villa)throw new Error("Không tìm thấy căn.");
  var type=ceCustomerResolveProductTypeV61_(villa.productType);
  if(type==="UNKNOWN")throw new Error("Loại sản phẩm chưa được xác nhận; chưa thể công bố giá khách.");
  var parts=month.split("-"),year=Number(parts[0]),mi=Number(parts[1])-1;if(year<2020||mi<0||mi>11)throw new Error("Tháng không hợp lệ.");
  var count=new Date(year,mi+1,0).getDate();
  var plan={source:villa.source||"",candidates:1,maxColumn:Number(villa.sourceColumn||0),requiresFullScan:Number(villa.sourceColumn||0)<=0};

  // Bắt lỗi quyền khi mở file lịch
  var opened=null;
  try{
    opened=ceOpenSpreadsheetFastV23_(villa.calendarUrl);
  }catch(e){
    var msg=String(e&&e.message?e.message:e);
    var classify=saClassifyAccessErrorV1_(msg);
    if(classify==="NO_ACCESS"){
      // Mất quyền: trả days UNKNOWN thay vì ném lỗi
      Logger.log("[CustomerApi] Permission denied for "+villa.source+": "+msg);
      var days=[];
      for(var d=1;d<=count;d++){
        var date=new Date(year,mi,d,12,0,0,0),key=ceDateKey_(date);
        days.push({date:key,status:"UNKNOWN",available:null,price:null,priceText:"Liên hệ"});
      }
      return {success:true,villa:{villaId:villaId,name:villa.name||"",city:villa.city||"",productType:type},month:month,days:days};
    }
    throw e;
  }

  var ctx=ceCreateSourceContextV30_(opened,plan);

  // Chu an cot villa = can khong ban
  if(hcIsVillaHiddenInFileV1_(opened, villa)){
    Logger.log("[CustomerApi] Column hidden for " + villa.source + ": col " + villa.sourceColumn);
    var days=[];
    for(var d=1;d<=count;d++){
      var date=new Date(year,mi,d,12,0,0,0),key=ceDateKey_(date);
      days.push({date:key,status:"UNKNOWN",available:null,price:null,priceText:"Liên hệ"});
    }
    return {success:true,villa:{villaId:villaId,name:villa.name||"",city:villa.city||"",productType:type},month:month,days:days};
  }

  var previousSheet="",days=[];
  for(var d=1;d<=count;d++){
    var date=new Date(year,mi,d,12,0,0,0),key=ceDateKey_(date);
    try{
      var loc=ceFindVillaNightCellV34_(ctx,villa,date,previousSheet,guests);
      if(!loc){days.push({date:key,status:"UNKNOWN",available:null,price:null,priceText:"Liên hệ"});continue;}
      previousSheet=loc.context.name;
      var state=ceReadCalendarCellStateV34_(loc.context,loc.row,loc.column,villa.config,villa,loc.optionLabel||"");
      if(!state||state.status==="UNKNOWN"){days.push({date:key,status:"UNKNOWN",available:null,price:null,priceText:"Liên hệ"});continue;}
      if(state.status==="BUSY"){days.push({date:key,status:"BUSY",available:false,price:null,priceText:"Đã kín"});continue;}
      var price=ceCustomerNightPriceV61_(state.price,type);
      days.push({date:key,status:"FREE",available:true,price:price,priceText:price===null?"Liên hệ":ceFormatMoney_(price)});
    }catch(ignore){days.push({date:key,status:"UNKNOWN",available:null,price:null,priceText:"Liên hệ"});}
  }
  return {success:true,villa:{villaId:villaId,name:villa.name||"",city:villa.city||"",productType:type},month:month,days:days};
}

function ceCustomerMetaMapV61_(){
  var map={},villas=ceReadMasterVillas_();
  (villas||[]).forEach(function(v){
    var id=String(v.id||"").trim();if(!id)return;
    var type=ceCustomerResolveProductTypeV61_(v.productType);
    var info=String(v.info||"");
    map[id]={
      productType:type,
      roomGroupId:type==="PHONG_RIENG"?ceCustomerRoomGroupIdV616_(v):"",
      bedrooms:String(v.bedrooms||""),
      areaText:[v.name,v.city,v.maps,info].join(" "),
      amenities:ceCustomerDetectAmenitiesV61_(info),
      info:info
    };
  });
  return map;
}

function ceCustomerAllowedVillaIdsV61_(meta,productType,bedrooms,area,amenities){
  var out=[];
  Object.keys(meta||{}).forEach(function(id){
    var m=meta[id]||{},type=ceCustomerResolveProductTypeV61_(m.productType);
    if(type==="UNKNOWN")return;
    if(productType!=="ALL"&&type!==productType)return;
    var pn=ceCustomerBedroomNumberV61_(m.bedrooms);
    if(bedrooms>=10){if(pn<10)return;}else if(bedrooms>0&&pn!==bedrooms)return;
    if(area&&!ceCustomerContainsV61_(m.areaText||"",area))return;
    var detected=Array.isArray(m.amenities)?m.amenities:[];
    if(amenities.length&&!ceCustomerAmenitiesMatchV613_(detected,amenities))return;
    out.push(id);
  });
  return out;
}

function ceCustomerFindInternalVillaV61_(id){var villas=ceReadMasterVillas_();for(var i=0;i<villas.length;i++)if(String(villas[i].id||"").trim()===id)return villas[i];return null;}
function ceCustomerNormalizeFilterProductTypeV61_(v){var n=ceNormalize_(v).replace(/[_-]+/g," ").trim();if(n==="all"||n==="tat ca")return "ALL";if(n.indexOf("phong")>=0||n.indexOf("room")>=0)return "PHONG_RIENG";return "NGUYEN_CAN";}
function ceCustomerResolveProductTypeV61_(v){var n=ceNormalize_(v).replace(/[_-]+/g," ").trim();/* V6.1.9: production legacy truoc khi co LOAI_SP da mac dinh la nguyen can. Chi gia tri PHONG_RIENG ro rang moi tach room flow. */if(!n)return "NGUYEN_CAN";if(n==="phong rieng"||n==="phong don"||n==="private room"||n==="room")return "PHONG_RIENG";if(n==="nguyen can"||n==="villa"||n==="combo")return "NGUYEN_CAN";return "UNKNOWN";}
function ceCustomerBedroomNumberV61_(v){var m=String(v||"").match(/\d+/);return m?Number(m[0]):0;}
function ceCustomerContainsV61_(haystack,needle){return ceNormalize_(haystack).indexOf(ceNormalize_(needle))>=0;}


/** V6.1.13 - canonical amenity keys for customer filter controls. */
function ceCustomerAmenityKeyV613_(value){
  var n=ceNormalize_(value||"").replace(/[_-]+/g," ").replace(/\s+/g," ").trim();
  if(!n)return "";
  if(/\bbbq\b|nuong/.test(n))return "BBQ";
  if(/karaoke|hat/.test(n))return "KARAOKE";
  if(/bida|bi da/.test(n))return "BIDA";
  if(/may chieu|projector/.test(n))return "MAY_CHIEU";
  if(/bon tam|bathtub/.test(n))return "BON_TAM";
  if(/thang may|elevator|lift/.test(n))return "THANG_MAY";
  if(/ho boi|pool/.test(n))return "HO_BOI";
  if(/may lanh|dieu hoa|aircon/.test(n))return "MAY_LANH";
  if(/san vuon|garden/.test(n))return "SAN_VUON";
  if(/\bbep\b|kitchen/.test(n))return "BEP";
  if(/oto|o to|dau xe|parking/.test(n))return "DAU_OTO";
  if(/lua trai|campfire/.test(n))return "LUA_TRAI";
  if(/view|thung lung|rung thong|san may/.test(n))return "VIEW";
  return n.toUpperCase().replace(/[^A-Z0-9]+/g,"_").replace(/^_+|_+$/g,"");
}
function ceCustomerAmenitiesMatchV613_(detected,requested){
  var set={};
  (detected||[]).forEach(function(v){var k=ceCustomerAmenityKeyV613_(v);if(k)set[k]=true;});
  return (requested||[]).every(function(v){var k=ceCustomerAmenityKeyV613_(v);return !!(k&&set[k]);});
}

/**
 * Apps Script: CustomerApi.js -> testCustomerFilterContractV613
 * Verifies the UI/customer-only filters that are not exposed in the old internal UI.
 */
function testCustomerFilterContractV613(){
  var meta={
    A:{productType:"NGUYEN_CAN",bedrooms:"4",areaText:"Hùng Vương P11 Đà Lạt",amenities:["BBQ","Karaoke","Máy chiếu"]},
    B:{productType:"NGUYEN_CAN",bedrooms:"2",areaText:"An Sơn P4 Đà Lạt",amenities:["Bida","Bồn tắm","Thang máy"]},
    C:{productType:"PHONG_RIENG",bedrooms:"1",areaText:"Trung tâm Đà Lạt",amenities:["BBQ"]}
  };
  function ids(type,pn,area,amenities){return ceCustomerAllowedVillaIdsV61_(meta,type,pn,area,amenities).sort();}
  var cases=[
    [ids("NGUYEN_CAN",4,"",[]),["A"]],
    [ids("NGUYEN_CAN",0,"hung vuong",[]),["A"]],
    [ids("NGUYEN_CAN",0,"",["KARAOKE"]),["A"]],
    [ids("NGUYEN_CAN",0,"",["MAY_CHIEU"]),["A"]],
    [ids("NGUYEN_CAN",0,"",["BIDA","BON_TAM","THANG_MAY"]),["B"]],
    [ids("PHONG_RIENG",0,"",["BBQ"]),["C"]]
  ];
  cases.forEach(function(c,i){if(JSON.stringify(c[0])!==JSON.stringify(c[1]))throw new Error("CUSTOMER_FILTER_CONTRACT_FAIL_V613 case="+i+" got="+JSON.stringify(c[0]));});
  var r={success:true,code:"CUSTOMER_FILTER_CONTRACT_PASS_V613",cases:cases.length,amenityCanonical:true,area:true,bedrooms:true,productType:true};
  Logger.log(JSON.stringify(r));
  return r;
}

function ceCustomerMarkupRateV61_(baseNightPrice,productType){var p=Number(baseNightPrice);if(!isFinite(p)||p<0)return null;var t=ceCustomerResolveProductTypeV61_(productType);if(t==="UNKNOWN")return null;if(t==="PHONG_RIENG")return 0;if(p<3000000)return .15;if(p<5000000)return .12;if(p<7000000)return .09;if(p<=10000000)return .07;return .09;}
function ceCustomerNightPriceV61_(baseNightPrice,productType){if(baseNightPrice===null||baseNightPrice===undefined||baseNightPrice==="")return null;var p=Number(baseNightPrice),rate=ceCustomerMarkupRateV61_(p,productType);if(!isFinite(p)||p<0||rate===null)return null;return Math.round(p*(1+rate));}
function ceCustomerBuildPricingV61_(nights,type){nights=Array.isArray(nights)?nights:[];var complete=nights.length>0,total=0;var out=nights.map(function(n){var p=ceCustomerNightPriceV61_(n&&n.price,type);if(p===null)complete=false;else total+=p;return {date:n&&n.date||"",price:p,priceText:p===null?"Liên hệ":ceFormatMoney_(p)};});return {totalPrice:complete?total:null,totalPriceText:complete?ceFormatMoney_(total):"Liên hệ báo giá",averageNightPrice:complete&&out.length?Math.round(total/out.length):null,averageNightPriceText:complete&&out.length?ceFormatMoney_(Math.round(total/out.length)):"Liên hệ",nightlyPrices:out};}

function ceCustomerDetectAmenitiesV61_(info){
  var n=ceNormalize_(info),defs=[["BBQ",/bbq|nuong/],["Karaoke",/karaoke|hat/],["Bida",/bida|bi da/],["Hồ bơi",/ho boi|pool/],["Bồn tắm",/bon tam/],["Máy chiếu",/may chieu/],["Máy lạnh",/may lanh|dieu hoa/],["View đẹp",/view|thung lung|rung thong|san may/],["Sân vườn",/san vuon/],["Bếp",/\bbep\b/],["Thang máy",/thang may/],["Đậu ô tô",/oto|o to|dau xe/],["Lửa trại",/lua trai/]];
  var out=[];
  defs.forEach(function(d){
    var match=n.match(d[1]);if(!match)return;
    var idx=Number(match.index||0);var before=n.slice(Math.max(0,idx-28),idx);
    if(/(?:^|\b)(?:khong|ko|cam|khong co|khong duoc)\b[^,.;]{0,24}$/.test(before))return;
    out.push(d[0]);
  });
  return out;
}
function ceCustomerRoomGroupIdV616_(v){var key=String(v&&v.calendarUrl||"")+"|"+String(v&&v.source||"");if(!key.replace(/\|/g,""))key=String(v&&v.id||"");try{var bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,key,Utilities.Charset.UTF_8);var hex=bytes.map(function(b){var n=(b+256)%256;return ("0"+n.toString(16)).slice(-2);}).join("");return "RG-"+hex.slice(0,12);}catch(ignore){return "RG-"+String(v&&v.id||"").replace(/[^A-Za-z0-9_-]/g,"").slice(0,12);}}
function ceCustomerSanitizeInfoV61_(info){var text=String(info||"").replace(/https?:\/\/\S+/gi,"").replace(/(?:\+?84|0)\d[\d .-]{7,12}/g,"");text=text.replace(/\b(?:driver|host|chu\s*nha|chủ\s*nhà|nguon|nguồn|zalo|sdt|sđt|phone)\s*:\s*[^;|•✦*\n]+[;|•✦*]?/gi,"");var blocked=/\bgia\b|gia goc|gia nhan|thu ve|net\b|chiet khau|hoa hong|commission|host|chu nha|driver|nguon|google sheet|admin|\bsale\b|sale noi bo|noi bo|zalo|sdt|phone/i;return text.replace(/[•✦▪♦*]+/g,"\n").split(/\r?\n|\s+\|\s+/).map(function(x){return x.trim().replace(/^[;,:\-–—\s]+|[;,:\-–—\s]+$/g,"");}).filter(function(x){return x&&!blocked.test(ceNormalize_(x));}).slice(0,12).join("\n").slice(0,1200);}
function ceCustomerSanitizeVillaV61_(v,m,type,pricing,amenities){var min=Number(v.capacityMin||0),max=Number(v.capacityMax||0);return {villaId:String(v.villaId||""),name:String(v.name||""),city:String(v.city||""),image:String(v.image||""),productType:type,roomGroupId:type==="PHONG_RIENG"?String(m.roomGroupId||""):"",featured:false,standard:String(v.standard||""),capacityMin:min,capacityMax:max,capacityLabel:String(v.capacityLabel||v.standard||"Liên hệ"),bedrooms:String(v.bedrooms||m.bedrooms||""),info:ceCustomerSanitizeInfoV61_(v.info||""),amenities:amenities||[],available:v.available===true,priceStatus:pricing.totalPrice===null?"CONTACT":"KNOWN",totalPrice:pricing.totalPrice,totalPriceText:pricing.totalPriceText,averageNightPrice:pricing.averageNightPrice,averageNightPriceText:pricing.averageNightPriceText,nights:Number(v.nights||pricing.nightlyPrices.length||0),nightlyPrices:pricing.nightlyPrices};}
function ceCustomerPriceSortV61_(a,b,dir){var ak=a.averageNightPrice!==null&&a.averageNightPrice!==undefined,bk=b.averageNightPrice!==null&&b.averageNightPrice!==undefined;if(ak!==bk)return ak?-1:1;if(!ak)return String(a.name||"").localeCompare(String(b.name||""),"vi");return dir*(Number(a.averageNightPrice)-Number(b.averageNightPrice));}

function testCustomerRoomGroupingV616(){var a=ceCustomerRoomGroupIdV616_({calendarUrl:"https://docs.google.com/spreadsheets/d/ABC",source:"X",id:"1"});var b=ceCustomerRoomGroupIdV616_({calendarUrl:"https://docs.google.com/spreadsheets/d/ABC",source:"X",id:"2"});var c=ceCustomerRoomGroupIdV616_({calendarUrl:"https://docs.google.com/spreadsheets/d/XYZ",source:"Y",id:"3"});if(!a||a!==b||a===c)throw new Error("CUSTOMER_ROOM_GROUP_FAIL_V616");var r={success:true,code:"CUSTOMER_ROOM_GROUP_PASS_V616",sameSourceGrouped:true,differentSourceSeparated:true};Logger.log(JSON.stringify(r));return r;}
function testCustomerSanitizeDriverV616(){var raw="Driver: Bình Minh 202; Phòng đẹp view phố * Cơ Cấu - Home ngay trung tâm * Zalo: 0905123456 * Máy chiếu";var safe=ceCustomerSanitizeInfoV61_(raw);var n=ceNormalize_(safe);if(/driver|zalo|0905|binh minh 202/.test(n))throw new Error("CUSTOMER_DRIVER_SANITIZE_FAIL_V616:"+safe);var r={success:true,code:"CUSTOMER_DRIVER_SANITIZE_PASS_V616",safe:safe};Logger.log(JSON.stringify(r));return r;}

function testCustomerPricingV61(){var cases=[[2000000,"NGUYEN_CAN",2300000],[3000000,"NGUYEN_CAN",3360000],[5000000,"NGUYEN_CAN",5450000],[7000000,"NGUYEN_CAN",7490000],[10000000,"NGUYEN_CAN",10700000],[10000001,"NGUYEN_CAN",Math.round(10000001*1.09)],[2000000,"PHONG_RIENG",2000000],[2000000,"",2300000]];cases.forEach(function(c){if(ceCustomerNightPriceV61_(c[0],c[1])!==c[2])throw new Error("CUSTOMER_PRICE_TEST_FAILED "+JSON.stringify(c));});var r={success:true,code:"CUSTOMER_PRICING_PASS_V611",cases:cases.length,legacyBlankWholeVilla:true};Logger.log(JSON.stringify(r));return r;}
function testCustomerSanitizeV61(){var raw="Giá gốc 3tr\nHost 0905123456\nSân vườn BBQ view rừng thông\nhttps://docs.google.com/test";var safe=ceCustomerSanitizeInfoV61_(raw);if(/0905|gia goc|host|google/i.test(ceNormalize_(safe)))throw new Error("CUSTOMER_SANITIZE_LEAK_V61");var r={success:true,code:"CUSTOMER_SANITIZE_PASS_V611",safe:safe};Logger.log(JSON.stringify(r));return r;}
function testCustomerProductTypeV61(){var cases=[["PHONG_RIENG","PHONG_RIENG"],["NGUYEN_CAN","NGUYEN_CAN"],["COMBO","NGUYEN_CAN"],["","NGUYEN_CAN"],["khong ro","UNKNOWN"]];cases.forEach(function(c){if(ceCustomerResolveProductTypeV61_(c[0])!==c[1])throw new Error("CUSTOMER_PRODUCT_TYPE_FAIL_V611 "+JSON.stringify(c));});var r={success:true,code:"CUSTOMER_PRODUCT_TYPE_PASS_V611",cases:cases.length};Logger.log(JSON.stringify(r));return r;}

function testCustomerLegacyWholeVillaV619(){
  var whole=ceCustomerResolveProductTypeV61_("");
  var room=ceCustomerResolveProductTypeV61_("PHONG_RIENG");
  var unknown=ceCustomerResolveProductTypeV61_("khong ro");
  if(whole!=="NGUYEN_CAN"||room!=="PHONG_RIENG"||unknown!=="UNKNOWN")throw new Error("CUSTOMER_LEGACY_WHOLE_VILLA_FAIL_V619");
  var result={success:true,code:"CUSTOMER_LEGACY_WHOLE_VILLA_PASS_V619",legacyBlank:whole,privateRoom:room,unknown:unknown};
  Logger.log(JSON.stringify(result));
  return result;
}
function testCustomerSecurityV61(){var v={villaId:"VL-X",name:"Test",city:"Đà Lạt",image:"",standard:"8-10",capacityMin:8,capacityMax:10,capacityLabel:"8-10",bedrooms:"4",info:"Host 0905123456\nSân vườn BBQ",source:"SECRET",sourceLink:"https://docs.google.com/x",reader:"AUTO",basePrice:2000000,elapsedMs:12,available:true,nights:1};var safe=ceCustomerSanitizeVillaV61_(v,{bedrooms:"4"},"NGUYEN_CAN",ceCustomerBuildPricingV61_([{date:"2026-10-01",price:2000000}],"NGUYEN_CAN"),["BBQ"]);var json=JSON.stringify(safe);["SECRET","docs.google.com","sourceLink","reader","basePrice","elapsedMs","0905123456"].forEach(function(x){if(json.indexOf(x)>=0)throw new Error("CUSTOMER_SECURITY_LEAK_V611:"+x);});if(safe.capacityMin!==8||safe.capacityMax!==10)throw new Error("CUSTOMER_CAPACITY_RANGE_FAIL_V611");var r={success:true,code:"CUSTOMER_SECURITY_PASS_V611",allowlist:true,capacityRange:true};Logger.log(JSON.stringify(r));return r;}


/** Apps Script: CustomerApi.js -> testEhomeCustomerFilterSuiteV613 */
function testEhomeCustomerFilterSuiteV613(){
  var mixed=typeof testMixedSourceProductTypeV612==="function"?testMixedSourceProductTypeV612():null;
  var filters=testCustomerFilterContractV613();
  if(!mixed||mixed.success!==true||!filters||filters.success!==true)throw new Error("EHOME_CUSTOMER_FILTER_SUITE_FAIL_V613");
  var r={success:true,code:"EHOME_CUSTOMER_FILTER_SUITE_PASS_V613",mixedSource:true,filterContract:true};
  Logger.log(JSON.stringify(r));
  return r;
}
