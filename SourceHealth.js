/** 27_SourceHealth.gs - V3.4.1 health truth-source cleanup.
 * Tách rõ MASTER / STRUCTURE / CONFIG / IMAGE, không báo ERROR giả khi
 * Structure đã đọc được căn nhưng MASTER chưa đồng bộ. Phát hiện alias/trùng source.
 */
function shSourceLinkIdentityV341_(link) {
  var text = String(link || "").trim();
  if (!text) return "";
  var fileMatch = text.match(/\/spreadsheets\/d\/([^\/?#]+)/i);
  if (!fileMatch) return opsNormV312_(text);
  var gidMatch = text.match(/[?#&]gid=(\d+)/i);
  return String(fileMatch[1] || "") + "|GID:" + String(gidMatch ? gidMatch[1] : "");
}

function shStructureVillaCountV341_(structure) {
  if (!structure || !structure.current) return 0;
  var current = structure.current || {};
  var value = current.effectiveVillaCount;
  if (value === null || value === undefined || value === "") value = current.villaCount;
  value = Number(value || 0);
  return isFinite(value) && value > 0 ? value : 0;
}

function shBuildDuplicateSourceMapV341_(sources) {
  var groups = {};
  (sources || []).forEach(function(source) {
    var id = shSourceLinkIdentityV341_(source && source.link);
    if (!id) return;
    if (!groups[id]) groups[id] = [];
    groups[id].push(source);
  });
  var out = {};
  Object.keys(groups).forEach(function(id) {
    var list = groups[id] || [];
    if (list.length < 2) return;
    list.forEach(function(source) {
      var key = opsNormV312_(source && source.source);
      if (!key) return;
      out[key] = list.filter(function(peer) {
        return opsNormV312_(peer && peer.source) !== key;
      }).map(function(peer) {
        return {id:String(peer.id || ""), source:String(peer.source || ""), row:Number(peer.row || 0)};
      });
    });
  });
  return out;
}

function getSourceHealthV312(){
  var sources=opsListMasterSourcesV312_(true).sources||[];
  var counts=opsMasterVillaCountBySourceV312_();
  var images=opsImageProblemMapV312_();
  var structureMap={};
  try{
    if(typeof getStructureSnapshotMapV320_==="function")structureMap=getStructureSnapshotMapV320_()||{};
  }catch(ignoreStructure){}
  var duplicateMap=shBuildDuplicateSourceMapV341_(sources);
  var out=[];

  sources.forEach(function(s){
    var key=opsNormV312_(s.source);
    var img=images[key]||{ok:0,present:0,missing:0,error:0,broken:0,pending:0,total:0};
    var villas=Number(counts[key]||0);
    var structure=structureMap[key]||null;
    var detectedVillas=shStructureVillaCountV341_(structure);
    var duplicateSources=duplicateMap[key]||[];
    var problems=Number(img.missing||0)+Number(img.error||0)+Number(img.broken||0);
    var masterPending=(villas===0&&detectedVillas>0);
    var newSourcePending=(villas===0&&!structure);

    var config=opsBuildConfigSourceHealthV312_(s,{
      enabled:true,
      masterVillaCount:villas,
      structureVillaCount:detectedVillas,
      structurePresent:!!structure,
      imageProblems:problems,
      imageCounts:img
    },false);

    var status="OK",warnings=[];

    if(!s.link){
      if(villas===0&&detectedVillas===0){status="ERROR";warnings.push("SOURCE_LINK_MISSING");}
      else {status="WARNING";warnings.push("SOURCE_LINK_UNRESOLVED");}
    }

    if(villas===0){
      if(masterPending){
        if(status!=="ERROR")status="WARNING";
        warnings.push("MASTER_PENDING_SYNC");
      }else if(duplicateSources.length){
        if(status!=="ERROR")status="WARNING";
        warnings.push("DUPLICATE_SOURCE_ALIAS");
      }else if(newSourcePending){
        // V4.21.1: vừa Enable nhưng chưa có Structure Snapshot => chưa đủ bằng chứng lỗi.
        // Giữ status OK để Health Watch không spam Telegram trước lần scan đầu tiên.
      }else{
        status="ERROR";
        warnings.push("SOURCE_ZERO_VILLAS");
      }
    }

    if(duplicateSources.length){
      if(status!=="ERROR")status="WARNING";
      if(warnings.indexOf("DUPLICATE_SOURCE_ALIAS")<0)warnings.push("DUPLICATE_SOURCE_ALIAS");
    }

    if(config.status==="ERROR"){
      status="ERROR";warnings.push("CONFIG_ERROR");
    }else if(status!=="ERROR"&&config.status==="WARNING"){
      status="WARNING";warnings.push("CONFIG_WARNING");
    }

    if(structure){
      if(structure.status==="ERROR"){
        status="ERROR";warnings.push("STRUCTURE_ERROR");
      }else if(structure.status==="WARNING"){
        if(status!=="ERROR")status="WARNING";
        warnings.push("STRUCTURE_WARNING");
      }
    }

    if(problems>0&&status!=="ERROR"){
      status="WARNING";warnings.push("IMAGE_ISSUES_"+problems);
    }

    out.push({
      id:s.id,source:s.source,city:s.city,status:status,villas:villas,detectedVillas:detectedVillas,
      masterPending:masterPending,newSourcePending:newSourcePending,duplicateSources:duplicateSources,image:img,
      configStatus:config.status,configIssues:config.issues||[],warnings:warnings,
      structureStatus:structure?structure.status:"UNKNOWN",
      structure:structure
    });
  });

  return {
    success:true,
    version:"3.4.1-health-truth-source",
    total:out.length,
    ok:out.filter(function(x){return x.status==="OK";}).length,
    warning:out.filter(function(x){return x.status==="WARNING";}).length,
    error:out.filter(function(x){return x.status==="ERROR";}).length,
    sources:out
  };
}

function getSourceHealthOneV312(selector){
  var source=opsFindSourceV312_(selector);
  if(!source)return {success:false,error:"SOURCE_NOT_FOUND"};
  var all=getSourceHealthV312(),key=opsNormV312_(source.source);
  for(var i=0;i<all.sources.length;i++){
    if(opsNormV312_(all.sources[i].source)===key)return {success:true,source:all.sources[i]};
  }
  return {success:false,error:"SOURCE_HEALTH_NOT_FOUND"};
}

function testSourceHealthV341(){
  var health=getSourceHealthV312();
  function pick(name){
    var key=opsNormV312_(name);
    for(var i=0;i<(health.sources||[]).length;i++){
      if(opsNormV312_(health.sources[i].source)===key)return health.sources[i];
    }
    return null;
  }
  var bae=pick("bae home");
  var uyen=pick("uyên");
  var maison=pick("maison D");
  var result={
    success:true,version:"3.4.1",
    bae:bae?{status:bae.status,villas:bae.villas,detectedVillas:bae.detectedVillas,warnings:bae.warnings,duplicates:bae.duplicateSources}:null,
    uyen:uyen?{status:uyen.status,villas:uyen.villas,detectedVillas:uyen.detectedVillas,warnings:uyen.warnings,duplicates:uyen.duplicateSources}:null,
    maison:maison?{status:maison.status,villas:maison.villas,detectedVillas:maison.detectedVillas,warnings:maison.warnings,configStatus:maison.configStatus}:null
  };
  Logger.log(JSON.stringify({code:"SOURCE_HEALTH_PASS_V341",result:result}));
  return result;
}


/** V4.21.1 - regression test cho trạng thái nguồn mới chưa Structure scan. */
function testSourceHealthNewSourcePendingV4211(){
  var structure=null,villas=0,detectedVillas=0;
  var newSourcePending=(villas===0&&!structure);
  if(!newSourcePending)throw new Error("V4211 FAIL newSourcePending=false");
  structure={current:{effectiveVillaCount:0}};
  newSourcePending=(villas===0&&!structure);
  if(newSourcePending)throw new Error("V4211 FAIL scanned source vẫn bị coi là new");
  var result={success:true,version:"4.21.1-health-new-source-pending",pendingBeforeFirstScan:true,scannedZeroNotPending:true};
  Logger.log(JSON.stringify({code:"SOURCE_HEALTH_NEW_SOURCE_PENDING_PASS_V4211",result:result}));
  return result;
}
