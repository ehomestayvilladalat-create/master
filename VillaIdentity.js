/**
 * VillaIdentity.js - V1 SAFE STABLE VILLA IDENTITY REGISTRY
 *
 * Mục tiêu:
 * - Giữ nguyên MÃ_CĂN lịch sử đã có trong MASTER_VILLA.
 * - Không dùng tên/cột hiện tại làm ID canonical sau khi registry được bật.
 * - Tên đổi / chèn-xóa cột: cố gắng giữ ID bằng exact-name + sequence anchors.
 * - Case mơ hồ KHÔNG tự cướp ID của căn khác.
 *
 * SAFE ROLLOUT:
 * 1) push code: chưa ảnh hưởng production.
 * 2) run initializeVillaIdentityRegistryV1()
 * 3) run previewVillaIdentityRegistryV1()
 * 4) chỉ khi PASS mới run enableVillaIdentityV1()
 */

var EHOME_VILLA_IDENTITY_V1 = {
  SHEET: "VILLA_IDENTITY_V1",
  PROPERTY: "BE_VILLA_IDENTITY_V1_ENABLED",
  VERSION: "1.0.0",
  HEADERS: [
    "MÃ CĂN","SOURCE ID","NGUỒN","TÊN CANONICAL","TÊN NORM",
    "CỘT LẦN CUỐI","ALIASES JSON","ACTIVE","STATUS",
    "CREATED AT","UPDATED AT"
  ]
};

function beVillaIdentityEnabledV1_(){
  return PropertiesService.getScriptProperties().getProperty(EHOME_VILLA_IDENTITY_V1.PROPERTY) === "TRUE";
}

function enableVillaIdentityV1(){
  var preview = previewVillaIdentityRegistryV1();
  if (!preview.success || preview.collisions > 0 || preview.invalidRows > 0 || preview.missingMasterSkus > 0 || preview.extraRegistrySkus > 0 || preview.blankMasterSkuRows > 0 || preview.rowDelta !== 0 || preview.registryRows < 1) {
    throw new Error("IDENTITY_ENABLE_BLOCKED_V12: " + JSON.stringify(preview));
  }
  PropertiesService.getScriptProperties().setProperty(EHOME_VILLA_IDENTITY_V1.PROPERTY,"TRUE");
  var result={success:true,code:"VILLA_IDENTITY_ENABLED_V1",registryRows:preview.registryRows};
  Logger.log(JSON.stringify(result));
  return result;
}

function disableVillaIdentityV1(){
  PropertiesService.getScriptProperties().deleteProperty(EHOME_VILLA_IDENTITY_V1.PROPERTY);
  var result={success:true,code:"VILLA_IDENTITY_DISABLED_V1"};
  Logger.log(JSON.stringify(result));
  return result;
}

function initializeVillaIdentityRegistryV1(force){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var existing=ss.getSheetByName(EHOME_VILLA_IDENTITY_V1.SHEET);
  if(existing&&existing.getLastRow()>1&&force!==true){
    var kept={success:true,code:"VILLA_IDENTITY_ALREADY_INITIALIZED_V1",rows:existing.getLastRow()-1,enabled:beVillaIdentityEnabledV1_()};
    Logger.log(JSON.stringify(kept));
    return kept;
  }
  var master=ss.getSheetByName(BE_CONFIG.MASTER_VILLA_SHEET||"MASTER_VILLA");
  if(!master||master.getLastRow()<2) throw new Error("Không có MASTER_VILLA để seed identity.");

  var sourceMap=beIdentitySourceIdMapV1_(ss);
  var values=master.getDataRange().getDisplayValues();
  var headers=values[0].map(ceNormalize_);
  var c={
    sku:ceFindHeader_(headers,["ma can","sku"]),
    name:ceFindHeader_(headers,["ten can","ten villa"]),
    source:ceFindHeader_(headers,["nguon","source"]),
    link:ceFindHeader_(headers,["link lich","calendar","link"]),
    col:ceFindHeader_(headers,["cot nguon","source column"])
  };
  if(c.sku<0||c.name<0||c.source<0) throw new Error("MASTER_VILLA thiếu cột identity bắt buộc.");

  var now=new Date();
  var seenSku={};
  var rows=[];
  values.slice(1).forEach(function(row){
    var sku=cleanMasterText(row[c.sku]);
    var name=cleanMasterText(row[c.name]);
    var source=cleanMasterText(row[c.source]);
    if(!sku||!name||!source)return;
    if(seenSku[sku]) throw new Error("IDENTITY_SEED_DUPLICATE_SKU: "+sku);
    seenSku[sku]=true;
    var link=c.link>=0?cleanMasterText(row[c.link]):"";
    var key=beIdentitySourceKeyV1_(source,link);
    var sourceId=sourceMap[key]||sourceMap["SOURCE|"+normalizeMasterText(source)]||"";
    rows.push([
      sku,sourceId,source,name,normalizeMasterText(name),
      c.col>=0?Number(row[c.col]||0):0,
      JSON.stringify([name]),true,"SEEDED",now,now
    ]);
  });

  var sheet=ss.getSheetByName(EHOME_VILLA_IDENTITY_V1.SHEET)||ss.insertSheet(EHOME_VILLA_IDENTITY_V1.SHEET);
  sheet.clearContents();
  sheet.getRange(1,1,1,EHOME_VILLA_IDENTITY_V1.HEADERS.length).setValues([EHOME_VILLA_IDENTITY_V1.HEADERS]);
  if(rows.length)sheet.getRange(2,1,rows.length,EHOME_VILLA_IDENTITY_V1.HEADERS.length).setValues(rows);
  sheet.setFrozenRows(1);
  try{sheet.hideSheet();}catch(ignore){}

  var result={success:true,code:"VILLA_IDENTITY_INITIALIZED_V1",rows:rows.length,enabled:beVillaIdentityEnabledV1_()};
  Logger.log(JSON.stringify(result));
  return result;
}

function previewVillaIdentityRegistryV1(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var sheet=ss.getSheetByName(EHOME_VILLA_IDENTITY_V1.SHEET);
  if(!sheet||sheet.getLastRow()<2){
    return {success:false,code:"VILLA_IDENTITY_PREVIEW_V13",registryRows:0,collisions:0,invalidRows:0,message:"Chưa initialize registry."};
  }
  var values=sheet.getDataRange().getDisplayValues();
  var headers=values[0].map(ceNormalize_);
  var cSku=ceFindHeader_(headers,["ma can","sku"]);
  var cSourceId=ceFindHeader_(headers,["source id"]);
  var cName=ceFindHeader_(headers,["ten canonical"]);
  var seen={}; var collisions=0; var invalid=0; var registryRows=0;
  values.slice(1).forEach(function(row){
    var sku=cSku>=0?cleanMasterText(row[cSku]):"";
    var sourceId=cSourceId>=0?cleanMasterText(row[cSourceId]):"";
    var name=cName>=0?cleanMasterText(row[cName]):"";
    var nonEmpty=row.some(function(v){return cleanMasterText(v)!=="";});
    if(!nonEmpty)return;
    registryRows++;
    if(!sku||!name)invalid++;
    if(sku){if(seen[sku])collisions++;seen[sku]=true;}
    if(!sourceId){} // sourceId trống ở source legacy không chặn rollout; name+source vẫn còn.
  });

  var master=ss.getSheetByName(BE_CONFIG.MASTER_VILLA_SHEET||"MASTER_VILLA");
  var masterPhysicalRows=master&&master.getLastRow()>1?master.getLastRow()-1:0;
  var masterDataRows=0;
  var emptyPhysicalRows=0;
  var masterSkuSet={};
  var blankMasterSkuRows=0;
  if(master&&master.getLastRow()>1){
    var masterValues=master.getDataRange().getDisplayValues();
    var masterHeaders=masterValues[0].map(ceNormalize_);
    var cMasterSku=ceFindHeader_(masterHeaders,["ma can","sku"]);
    if(cMasterSku<0) throw new Error("MASTER_VILLA thiếu cột MÃ_CĂN/SKU.");
    masterValues.slice(1).forEach(function(row){
      var nonEmpty=row.some(function(v){return cleanMasterText(v)!=="";});
      if(!nonEmpty){emptyPhysicalRows++;return;}
      masterDataRows++;
      var sku=cleanMasterText(row[cMasterSku]);
      if(sku) masterSkuSet[sku]=true;
      else blankMasterSkuRows++;
    });
  }
  var registrySkuSet=seen;
  var missingMasterSkus=Object.keys(masterSkuSet).filter(function(sku){return !registrySkuSet[sku];}).length;
  var extraRegistrySkus=Object.keys(registrySkuSet).filter(function(sku){return !masterSkuSet[sku];}).length;
  var rowDelta=registryRows-masterDataRows;
  var result={
    success:collisions===0&&invalid===0&&missingMasterSkus===0&&extraRegistrySkus===0&&blankMasterSkuRows===0&&rowDelta===0,
    code:"VILLA_IDENTITY_PREVIEW_V13",
    registryRows:registryRows,
    masterRows:masterDataRows,
    masterPhysicalRows:masterPhysicalRows,
    emptyPhysicalRows:emptyPhysicalRows,
    rowDelta:rowDelta,
    blankMasterSkuRows:blankMasterSkuRows,
    collisions:collisions,
    invalidRows:invalid,
    missingMasterSkus:missingMasterSkus,
    extraRegistrySkus:extraRegistrySkus,
    enabled:beVillaIdentityEnabledV1_()
  };
  Logger.log(JSON.stringify(result));
  return result;
}

function diagnoseBlankMasterSkuV12(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var master=ss.getSheetByName(BE_CONFIG.MASTER_VILLA_SHEET||"MASTER_VILLA");
  if(!master||master.getLastRow()<2) throw new Error("Không có MASTER_VILLA để kiểm tra.");
  var values=master.getDataRange().getDisplayValues();
  var headers=values[0].map(ceNormalize_);
  var cSku=ceFindHeader_(headers,["ma can","sku"]);
  var cName=ceFindHeader_(headers,["ten can","ten villa"]);
  var cSource=ceFindHeader_(headers,["nguon","source"]);
  if(cSku<0) throw new Error("MASTER_VILLA thiếu cột MÃ_CĂN/SKU.");
  var rows=[];
  values.slice(1).forEach(function(row,i){
    if(cleanMasterText(row[cSku])) return;
    var nonEmpty=row.some(function(v){return cleanMasterText(v)!=="";});
    if(!nonEmpty) return;
    rows.push({
      sheetRow:i+2,
      name:cName>=0?cleanMasterText(row[cName]):"",
      source:cSource>=0?cleanMasterText(row[cSource]):""
    });
  });
  var result={success:rows.length===0,code:"VILLA_IDENTITY_BLANK_SKU_DIAGNOSTIC_V12",blankSkuRows:rows.length,sample:rows.slice(0,50)};
  Logger.log(JSON.stringify(result));
  return result;
}

function beIdentitySourceKeyV1_(source,link){
  source=normalizeMasterText(source);
  link=cleanMasterText(link);
  // Một Google Sheet có thể phục vụ nhiều logical source/config. Identity key
  // tuyệt đối không được chỉ dựa FILE/LINK vì sẽ trộn hai inventory khác nhau.
  if(link&&source)return "SOURCE_LINK|"+source+"|"+link;
  if(source)return "SOURCE|"+source;
  if(link)return "LINK_ONLY|"+link;
  return "";
}

function beIdentitySourceIdMapV1_(ss){
  var result={};
  var sheet=ss.getSheetByName(BE_CONFIG.MASTER_SHEET||"MASTER");
  if(!sheet||sheet.getLastRow()<2)return result;
  var values=sheet.getDataRange().getDisplayValues();
  var headers=values[0].map(ceNormalize_);
  var cId=ceFindHeader_(headers,["id","ma nguon"]);
  var cSource=ceFindHeader_(headers,["nguon","source"]);
  var cLink=ceFindHeader_(headers,["link","link lich","url"]);
  values.slice(1).forEach(function(row){
    var id=cId>=0?cleanMasterText(row[cId]):"";
    var source=cSource>=0?cleanMasterText(row[cSource]):"";
    var link=cLink>=0?cleanMasterText(row[cLink]):"";
    if(!id)return;
    result[beIdentitySourceKeyV1_(source,link)]=id;
    if(source)result["SOURCE|"+normalizeMasterText(source)]=id;
  });
  return result;
}

function beLoadVillaIdentityContextV1_(){
  if(!beVillaIdentityEnabledV1_())return null;
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var sheet=ss.getSheetByName(EHOME_VILLA_IDENTITY_V1.SHEET);
  if(!sheet||sheet.getLastRow()<2)throw new Error("IDENTITY_ENABLED_BUT_REGISTRY_MISSING_V1");
  var values=sheet.getDataRange().getValues();
  var display=sheet.getDataRange().getDisplayValues();
  var headers=display[0].map(ceNormalize_);
  function col(names){return ceFindHeader_(headers,names);}
  var c={
    sku:col(["ma can","sku"]),sourceId:col(["source id"]),source:col(["nguon","source"]),
    name:col(["ten canonical"]),nameNorm:col(["ten norm"]),column:col(["cot lan cuoi"]),
    aliases:col(["aliases json"]),active:col(["active"]),status:col(["status"]),
    created:col(["created at"]),updated:col(["updated at"])
  };
  var ctx={sheet:sheet,headers:EHOME_VILLA_IDENTITY_V1.HEADERS.slice(),records:[],bySourceId:{},dirty:false,skuSet:{}};
  for(var i=1;i<display.length;i++){
    var sku=cleanMasterText(display[i][c.sku]); if(!sku)continue;
    var aliases=[]; try{aliases=JSON.parse(String(display[i][c.aliases]||"[]"));}catch(ignore){aliases=[];}
    if(!Array.isArray(aliases))aliases=[];
    var rec={
      sku:sku, sourceId:cleanMasterText(display[i][c.sourceId]), source:cleanMasterText(display[i][c.source]),
      name:cleanMasterText(display[i][c.name]), nameNorm:cleanMasterText(display[i][c.nameNorm])||normalizeMasterText(display[i][c.name]),
      column:Number(display[i][c.column]||0), aliases:aliases,
      active:String(display[i][c.active]||"").toUpperCase()!=="FALSE", status:cleanMasterText(display[i][c.status])||"ACTIVE",
      created:values[i][c.created]||new Date(), updated:values[i][c.updated]||new Date()
    };
    ctx.records.push(rec); ctx.skuSet[sku]=true;
    var k=rec.sourceId||("SOURCE:"+normalizeMasterText(rec.source));
    ctx.bySourceId[k]=ctx.bySourceId[k]||[]; ctx.bySourceId[k].push(rec);
  }
  return ctx;
}

function beIdentityRecordsForSourceV1_(ctx,sourceId,source){
  if(!ctx)return[];
  return ctx.bySourceId[cleanMasterText(sourceId)]||ctx.bySourceId["SOURCE:"+normalizeMasterText(source)]||[];
}

function beResolveSourceVillaIdentitiesV1_(ctx,sourceId,source,villas,options){
  options=options||{};
  if(!ctx)return null;
  villas=villas||[];
  var old=beIdentityRecordsForSourceV1_(ctx,sourceId,source).filter(function(r){return r.active!==false;})
    .slice().sort(function(a,b){return Number(a.column||0)-Number(b.column||0);});
  var cur=villas.map(function(v,index){return {index:index,name:cleanMasterText(v&&v.name),norm:normalizeMasterText(v&&v.name),column:Number(v&&v.sourceColumn||0)};})
    .sort(function(a,b){return a.column-b.column;});
  var assignments=new Array(villas.length); var oldUsed={}; var curUsed={};
  function pair(c,o,mode){if(!c||!o||curUsed[c.index]||oldUsed[o.sku])return false;assignments[c.index]={sku:o.sku,record:o,mode:mode};curUsed[c.index]=true;oldUsed[o.sku]=true;return true;}

  var oldGroups={},curGroups={};
  old.forEach(function(o){oldGroups[o.nameNorm]=oldGroups[o.nameNorm]||[];oldGroups[o.nameNorm].push(o);});
  cur.forEach(function(c){curGroups[c.norm]=curGroups[c.norm]||[];curGroups[c.norm].push(c);});

  Object.keys(curGroups).forEach(function(norm){
    if(!norm||!oldGroups[norm])return;
    var cg=curGroups[norm].slice().sort(function(a,b){return a.column-b.column;});
    var og=oldGroups[norm].slice().sort(function(a,b){return a.column-b.column;});
    if(cg.length===1&&og.length===1){pair(cg[0],og[0],"EXACT_NAME");return;}
    // Duplicate names are safe only while cardinality is unchanged. Pair by
    // stable sequence, never by a coincidentally reused column after deletion.
    if(cg.length>1&&cg.length===og.length){
      for(var i=0;i<cg.length;i++)pair(cg[i],og[i],"EXACT_DUPLICATE_SEQUENCE");
    }
  });

  // Safe rename only inside a segment anchored by already matched identities.
  var progress=true;
  while(progress){
    progress=false;
    var unmatchedCur=cur.filter(function(c){return !curUsed[c.index];});
    unmatchedCur.forEach(function(c){
      if(curUsed[c.index])return;
      var ci=cur.indexOf(c),prev=null,next=null;
      for(var i=ci-1;i>=0;i--){if(curUsed[cur[i].index]){prev=cur[i];break;}}
      for(var j=ci+1;j<cur.length;j++){if(curUsed[cur[j].index]){next=cur[j];break;}}
      if(!prev||!next)return;
      var pa=assignments[prev.index],na=assignments[next.index];
      if(!pa||!na)return;
      var prevOldIndex=old.indexOf(pa.record),nextOldIndex=old.indexOf(na.record);
      if(prevOldIndex<0||nextOldIndex<0||nextOldIndex<=prevOldIndex)return;
      var oldSeg=old.slice(prevOldIndex+1,nextOldIndex).filter(function(o){return !oldUsed[o.sku];});
      var curSeg=cur.slice(cur.indexOf(prev)+1,cur.indexOf(next)).filter(function(x){return !curUsed[x.index];});
      if(oldSeg.length===1&&curSeg.length===1){
        if(pair(curSeg[0],oldSeg[0],"SAFE_ANCHORED_RENAME"))progress=true;
      }
    });
  }

  /*
   * V6.2.3 - no implicit 1:1 rename.
   * A single old villa and a single current villa with different names is still
   * ambiguous: it may be a rename, or a real remove+add event. Reusing the old
   * SKU here can steal identity. Leave both unmatched and require explicit,
   * confirmed rename evidence below.
   */
  var leftCur=cur.filter(function(c){return !curUsed[c.index];});
  var leftOld=old.filter(function(o){return !oldUsed[o.sku];});

  /*
   * V1.4 - confirmed reconcile rename hints.
   * KHONG dung "cung cot = cung can" lam identity chung. Chi chap nhan hint khi:
   * - MasterEngine da reconcile source o mode CONFIRMED_REMOVAL;
   * - hint co oldSku + oldName + newName + sourceColumn cu the;
   * - old/new record khop DUY NHAT;
   * - ten moi la ban rut gon/mo rong co y nghia cua ten cu (prefix + word boundary);
   * - co it nhat 1 token phan biet, tranh generic ten nhu "phong don".
   */
  function safeConfirmedRenameNameV14_(oldName,newName){
    var a=normalizeMasterText(oldName);
    var b=normalizeMasterText(newName);
    if(!a||!b||a===b)return false;
    var shortName=a.length<=b.length?a:b;
    var longName=a.length>b.length?a:b;
    if(longName.indexOf(shortName+" ")!==0)return false;
    var tokens=shortName.split(/\s+/).filter(Boolean);
    if(tokens.length<2)return false;
    var generic={phong:true,don:true,doi:true,room:true,villa:true,home:true,house:true,can:true,ho:true,studio:true};
    var distinctive=tokens.some(function(t){return t.length>=2&&!generic[t];});
    return distinctive;
  }

  var confirmedRenamePairsV14=options.confirmedRenamePairs||[];
  confirmedRenamePairsV14.forEach(function(hint){
    var oldSku=cleanMasterText(hint&&hint.oldSku);
    var oldNorm=normalizeMasterText(hint&&hint.oldName);
    var newNorm=normalizeMasterText(hint&&hint.newName);
    var col=Number(hint&&hint.sourceColumn||0);
    if(!oldSku||!oldNorm||!newNorm||!col)return;
    if(!safeConfirmedRenameNameV14_(oldNorm,newNorm))return;

    var oldMatches=old.filter(function(o){
      return !oldUsed[o.sku]&&o.sku===oldSku&&o.nameNorm===oldNorm;
    });
    var curMatches=cur.filter(function(c){
      return !curUsed[c.index]&&c.norm===newNorm&&c.column===col;
    });
    if(oldMatches.length!==1||curMatches.length!==1)return;
    pair(curMatches[0],oldMatches[0],"CONFIRMED_RECONCILE_NAME_REDUCTION_V14");
  });

  leftCur=cur.filter(function(c){return !curUsed[c.index];});

  /*
   * B2 - REVIVED_RETIRED_V1: căn đã bị RETIRE (active=false) quay lại nguồn.
   * Khôi phục ĐÚNG mã cũ, không cấp mã mới. Khớp theo cùng nguồn + tên (tên hiện
   * tại hoặc alias cũ); nếu nhiều record cùng tên thì bắt buộc khớp cả cột.
   * Mơ hồ (không duy nhất) => không gán, để tạo mã mới an toàn như cũ.
   */
  var retiredV1=beIdentityRecordsForSourceV1_(ctx,sourceId,source).filter(function(r){return r.active===false;});
  if(retiredV1.length&&leftCur.length){
    var revivedSkuV1={};
    leftCur.forEach(function(c){
      if(!c.norm)return;
      var byName=retiredV1.filter(function(r){
        if(revivedSkuV1[r.sku]||oldUsed[r.sku])return false;
        if(r.nameNorm===c.norm)return true;
        return (r.aliases||[]).some(function(a){return normalizeMasterText(a)===c.norm;});
      });
      var pick=null;
      if(byName.length===1)pick=byName[0];
      else if(byName.length>1){
        var byCol=byName.filter(function(r){return Number(r.column||0)===c.column;});
        if(byCol.length===1)pick=byCol[0];
      }
      if(!pick)return;
      // Tên này không được đồng thời là tên của một căn khác đang chờ ghép.
      var sameNameCur=leftCur.filter(function(x){return x.norm===c.norm;});
      if(sameNameCur.length>1&&Number(pick.column||0)!==c.column)return;
      if(pair(c,pick,"REVIVED_RETIRED_V1"))revivedSkuV1[pick.sku]=true;
    });
    if(Object.keys(revivedSkuV1).length){
      Logger.log(JSON.stringify({code:"IDENTITY_REVIVED_RETIRED_V1",sourceId:sourceId,source:source,skus:Object.keys(revivedSkuV1)}));
    }
  }

  leftCur=cur.filter(function(c){return !curUsed[c.index];});
  leftOld=old.filter(function(o){return !oldUsed[o.sku];});

  /*
   * V6.3.1 - confirmed remove+add, including equal cardinality.
   * Sau khi V4.16 da CONFIRMED_REMOVAL, cac identity con lai da di qua cac lop
   * match an toan (exact name, anchored rename, confirmed safe rename). Neu van
   * con ca old va current thi KHONG duoc suy ra 1-1 chi vi so luong bang nhau.
   *
   * Khi source da duoc xac nhan:
   * - KHONG gan current con lai vao old SKU nao (tranh danh cap MA_CAN);
   * - current con lai se duoc tao SKU moi o MasterEngine;
   * - old con lai se duoc retire boi beFinalizeSourceVillaIdentitiesV1_;
   * - ap dung cho ca equal-cardinality va cardinality mismatch.
   *
   * Khi source CHUA duoc xac nhan, van FAIL CLOSED nhu cu.
   */
  if(leftCur.length&&leftOld.length&&options.allowConfirmedRemoveAdd===true){
    Logger.log(JSON.stringify({
      code:"IDENTITY_CONFIRMED_REMOVE_ADD_V631",
      sourceId:sourceId,source:source,
      equalCardinality:leftCur.length===leftOld.length,
      removed:leftOld.map(function(o){return {sku:o.sku,name:o.name,column:o.column};}),
      added:leftCur.map(function(c){return {name:c.name,column:c.column};}),
      action:"RETIRE_UNMATCHED_OLD_AND_CREATE_NEW_SKU"
    }));
  } else if(leftCur.length&&leftOld.length){
    // If both sides remain, we cannot know whether this is rename vs remove+add.
    // Never fall back to source+name/column because that can steal/change MÃ_CĂN.
    var err=new Error("IDENTITY_AMBIGUOUS_SOURCE_V1: "+JSON.stringify({
      sourceId:sourceId,source:source,
      old:leftOld.map(function(o){return {sku:o.sku,name:o.name,column:o.column};}),
      current:leftCur.map(function(c){return {name:c.name,column:c.column};})
    }));
    err.code="IDENTITY_AMBIGUOUS_SOURCE_V1";
    throw err;
  }

  assignments._identityMeta={
    matched:assignments.filter(function(x){return !!x;}).length,
    newCount:leftCur.length,
    removedCount:leftOld.length,
    removedSkus:leftOld.map(function(o){return o.sku;})
  };
  return assignments;
}

function beFinalizeSourceVillaIdentitiesV1_(ctx,sourceId,source,assignments){
  if(!ctx||!assignments||!assignments._identityMeta)return;
  var removed={};
  (assignments._identityMeta.removedSkus||[]).forEach(function(sku){removed[sku]=true;});
  if(!Object.keys(removed).length)return;
  beIdentityRecordsForSourceV1_(ctx,sourceId,source).forEach(function(rec){
    if(!removed[rec.sku])return;
    rec.active=false;rec.status="REMOVED";rec.updated=new Date();ctx.dirty=true;
  });
}

function beRegisterResolvedVillaIdentityV1_(ctx,sourceId,source,villa,sku,assignment){
  if(!ctx||!sku||!villa)return;
  var rec=assignment&&assignment.record?assignment.record:null;
  var now=new Date(); var name=cleanMasterText(villa.name); var norm=normalizeMasterText(name); var col=Number(villa.sourceColumn||0);
  if(!rec){
    if(ctx.skuSet[sku]){
      // Không bao giờ ghi đè record khác nếu hash legacy vô tình collision.
      return;
    }
    rec={sku:sku,sourceId:cleanMasterText(sourceId),source:cleanMasterText(source),name:name,nameNorm:norm,column:col,aliases:[name],active:true,status:"NEW_SAFE",created:now,updated:now};
    ctx.records.push(rec); ctx.skuSet[sku]=true;
    var key=rec.sourceId||("SOURCE:"+normalizeMasterText(rec.source));ctx.bySourceId[key]=ctx.bySourceId[key]||[];ctx.bySourceId[key].push(rec);ctx.dirty=true;return;
  }
  if(name&&rec.name!==name){if(rec.name&&rec.aliases.indexOf(rec.name)<0)rec.aliases.push(rec.name);if(rec.aliases.indexOf(name)<0)rec.aliases.push(name);rec.name=name;rec.nameNorm=norm;rec.status=(assignment.mode||"").indexOf("RENAME")>=0?assignment.mode:"ACTIVE";ctx.dirty=true;}
  if(col&&rec.column!==col){rec.column=col;ctx.dirty=true;}
  if(rec.active===false){rec.status=(assignment&&assignment.mode)||"REVIVED_RETIRED_V1";ctx.dirty=true;}
  rec.active=true;rec.updated=now;
}

function beFlushVillaIdentityContextV1_(ctx){
  if(!ctx||!ctx.dirty)return {success:true,changed:false,rows:ctx?ctx.records.length:0};
  var rows=ctx.records.map(function(r){return [r.sku,r.sourceId,r.source,r.name,r.nameNorm,Number(r.column||0),JSON.stringify(r.aliases||[]),r.active!==false,r.status||"ACTIVE",r.created||new Date(),r.updated||new Date()];});
  ctx.sheet.clearContents();ctx.sheet.getRange(1,1,1,ctx.headers.length).setValues([ctx.headers]);if(rows.length)ctx.sheet.getRange(2,1,rows.length,ctx.headers.length).setValues(rows);ctx.sheet.setFrozenRows(1);try{ctx.sheet.hideSheet();}catch(ignore){}
  ctx.dirty=false;return {success:true,changed:true,rows:rows.length};
}


/** V6.1.9 - Resolve stable SOURCE ID by villa SKU for safe source-removal cleanup. */
function beVillaIdentitySourceIdBySkuV619_(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var sheet=ss.getSheetByName(EHOME_VILLA_IDENTITY_V1.SHEET);
  var out={};
  if(!sheet||sheet.getLastRow()<2)return out;
  var values=sheet.getDataRange().getDisplayValues();
  var headers=(values[0]||[]).map(ceNormalize_);
  var cSku=ceFindHeader_(headers,["ma can","sku"]);
  var cSourceId=ceFindHeader_(headers,["source id"]);
  if(cSku<0||cSourceId<0)return out;
  values.slice(1).forEach(function(row){
    var sku=cleanMasterText(row[cSku]);
    var sourceId=cleanMasterText(row[cSourceId]);
    if(sku&&sourceId)out[sku]=sourceId;
  });
  return out;
}

/** V6.1.9 - Retire identity records when an entire MASTER source is removed/disabled. */
function beRetireVillaIdentitySkusV619_(skus,status){
  skus=Array.isArray(skus)?skus:[];
  var wanted={};
  skus.forEach(function(sku){sku=cleanMasterText(sku);if(sku)wanted[sku]=true;});
  if(!Object.keys(wanted).length)return {success:true,changed:false,retired:0};
  var ctx=beLoadVillaIdentityContextV1_();
  if(!ctx)return {success:true,changed:false,retired:0,identityEnabled:false};
  var retired=0,now=new Date();
  (ctx.records||[]).forEach(function(rec){
    if(!wanted[cleanMasterText(rec.sku)]||rec.active===false)return;
    rec.active=false;rec.status=String(status||"SOURCE_REMOVED");rec.updated=now;ctx.dirty=true;retired++;
  });
  var flush=beFlushVillaIdentityContextV1_(ctx);
  return {success:true,changed:retired>0,retired:retired,flush:flush};
}
/** V6.1.11 - confirmed source can safely retire 2 old + create 1 new without stealing SKU. */
function testVillaIdentityConfirmedRemoveAddV6111(){
  var ctx={bySourceId:{"24":[
    {sku:"VL-OLD-HXH",sourceId:"24",source:"MINH TRUNG",name:"HXH Villa",nameNorm:normalizeMasterText("HXH Villa"),column:8,active:true},
    {sku:"VL-OLD-MIST",sourceId:"24",source:"MINH TRUNG",name:"THE MIST BẢO LỘC",nameNorm:normalizeMasterText("THE MIST BẢO LỘC"),column:10,active:true}
  ]}};
  var villas=[{name:"ELEGANT Villa",sourceColumn:6}];
  var blocked=false;
  try{beResolveSourceVillaIdentitiesV1_(ctx,"24","MINH TRUNG",villas,{});}catch(e){blocked=String(e&&e.code||e).indexOf("IDENTITY_AMBIGUOUS_SOURCE_V1")>=0;}
  if(!blocked)throw new Error("IDENTITY_CONFIRMED_REMOVE_ADD_FAIL_V6111 expected fail-closed without confirmation");
  var got=beResolveSourceVillaIdentitiesV1_(ctx,"24","MINH TRUNG",villas,{allowConfirmedRemoveAdd:true});
  if(!got||got[0])throw new Error("IDENTITY_CONFIRMED_REMOVE_ADD_FAIL_V6111 current must remain unassigned for new SKU");
  var meta=got._identityMeta||{};
  if(Number(meta.newCount)!==1||Number(meta.removedCount)!==2)throw new Error("IDENTITY_CONFIRMED_REMOVE_ADD_FAIL_V6111 bad meta "+JSON.stringify(meta));
  var result={success:true,code:"IDENTITY_CONFIRMED_REMOVE_ADD_PASS_V6111",newCount:meta.newCount,removedCount:meta.removedCount};
  Logger.log(JSON.stringify(result));
  return result;
}

/**
 * V6.3.1 - equal-cardinality remains fail-closed without confirmation, but once
 * structure is CONFIRMED it must retire unmatched old identities and leave the
 * unmatched current villas unassigned so MasterEngine creates fresh SKUs.
 * Function name is retained because the regression suite already calls it.
 */
function testVillaIdentityEqualCardinalityStillBlockedV6111(){
  function makeCtx(){return {bySourceId:{"X":[
    {sku:"VL-OLD-A",sourceId:"X",source:"SRC",name:"OLD A",nameNorm:normalizeMasterText("OLD A"),column:3,active:true}
  ]}};}

  var blockedWithoutConfirmation=false;
  try{beResolveSourceVillaIdentitiesV1_(makeCtx(),"X","SRC",[{name:"NEW B",sourceColumn:4}],{});}
  catch(e){blockedWithoutConfirmation=String(e&&e.code||e).indexOf("IDENTITY_AMBIGUOUS_SOURCE_V1")>=0;}
  if(!blockedWithoutConfirmation)throw new Error("IDENTITY_EQUAL_CARDINALITY_UNCONFIRMED_MUST_BLOCK_V631");

  var got=beResolveSourceVillaIdentitiesV1_(makeCtx(),"X","SRC",[{name:"NEW B",sourceColumn:4}],{allowConfirmedRemoveAdd:true});
  if(!got||got[0])throw new Error("IDENTITY_EQUAL_CARDINALITY_CONFIRMED_MUST_NOT_REUSE_OLD_SKU_V631");
  var meta=got._identityMeta||{};
  if(Number(meta.newCount)!==1||Number(meta.removedCount)!==1||!meta.removedSkus||meta.removedSkus[0]!=="VL-OLD-A")
    throw new Error("IDENTITY_EQUAL_CARDINALITY_CONFIRMED_BAD_META_V631 "+JSON.stringify(meta));

  var result={success:true,code:"IDENTITY_EQUAL_CARDINALITY_CONFIRMED_REMOVE_ADD_PASS_V631",unconfirmedBlocked:true,newCount:meta.newCount,removedCount:meta.removedCount};
  Logger.log(JSON.stringify(result));
  return result;
}

function testVillaIdentityLogicalSourceKeyV11(){
  var link="https://docs.google.com/spreadsheets/d/SAME_FILE/edit";
  var a=beIdentitySourceKeyV1_("SOURCE A",link);
  var b=beIdentitySourceKeyV1_("SOURCE B",link);
  if(!a||!b||a===b)throw new Error("IDENTITY_LOGICAL_SOURCE_KEY_FAIL_V11");
  var result={success:true,code:"VILLA_IDENTITY_LOGICAL_SOURCE_KEY_PASS_V11",distinct:true};
  Logger.log(JSON.stringify(result));return result;
}

function testVillaIdentityResolverV1(){
  function rec(sku,name,col){return {sku:sku,sourceId:"1",source:"S",name:name,nameNorm:normalizeMasterText(name),column:col,aliases:[name],active:true,status:"ACTIVE",created:new Date(),updated:new Date()};}
  function ctx(records){return {records:records,bySourceId:{"1":records},dirty:false,skuSet:records.reduce(function(m,r){m[r.sku]=true;return m;}, {})};}

  var r1=beResolveSourceVillaIdentitiesV1_(ctx([rec("A","Alpha",3),rec("B","Beta",4),rec("C","Gamma",5)]),"1","S",[{name:"Alpha",sourceColumn:3},{name:"Beta New",sourceColumn:4},{name:"Gamma",sourceColumn:5}]);
  if(!r1[1]||r1[1].sku!=="B")throw new Error("IDENTITY_ANCHORED_RENAME_TEST_FAILED");

  var r2=beResolveSourceVillaIdentitiesV1_(ctx([rec("A","Alpha",3),rec("B","Beta",4)]),"1","S",[{name:"Inserted",sourceColumn:3},{name:"Alpha",sourceColumn:4},{name:"Beta",sourceColumn:5}]);
  if(!r2[1]||r2[1].sku!=="A"||!r2[2]||r2[2].sku!=="B"||r2[0])throw new Error("IDENTITY_INSERT_TEST_FAILED");

  var r3=beResolveSourceVillaIdentitiesV1_(ctx([rec("A","Room",3),rec("B","Room",4)]),"1","S",[{name:"Room",sourceColumn:8},{name:"Room",sourceColumn:9}]);
  if(!r3[0]||r3[0].sku!=="A"||!r3[1]||r3[1].sku!=="B")throw new Error("IDENTITY_DUPLICATE_SHIFT_TEST_FAILED");

  var ambiguous=false;
  try{
    beResolveSourceVillaIdentitiesV1_(ctx([rec("A","Room",3),rec("B","Room",4)]),"1","S",[{name:"Room",sourceColumn:3},{name:"New Room",sourceColumn:4}]);
  }catch(e){ambiguous=String(e&&e.message||e).indexOf("IDENTITY_AMBIGUOUS_SOURCE_V1")>=0;}
  if(!ambiguous)throw new Error("IDENTITY_AMBIGUOUS_MUST_BLOCK_SOURCE");

  var r5=beResolveSourceVillaIdentitiesV1_(ctx([rec("A","Alpha",3),rec("B","Beta",4)]),"1","S",[{name:"Alpha",sourceColumn:3}]);
  if(!r5[0]||r5[0].sku!=="A"||!r5._identityMeta||r5._identityMeta.removedCount!==1)throw new Error("IDENTITY_REMOVAL_TOMBSTONE_TEST_FAILED");

  var r6=beResolveSourceVillaIdentitiesV1_(ctx([rec("A","Alpha",3)]),"1","S",[{name:"Alpha",sourceColumn:4},{name:"New",sourceColumn:5}]);
  if(!r6[0]||r6[0].sku!=="A"||r6[1]||!r6._identityMeta||r6._identityMeta.newCount!==1)throw new Error("IDENTITY_NEW_VILLA_TEST_FAILED");

  var oldKen=[
    rec("K1","KÉN HOUSE 1 41/3 Ngô Quyền Lô 2 KQH Lam Sơn ( số cũ)",3),
    rec("KH","KÉN HOME 2/9 NGÔ TẤT TỐ Hẻm lẩu dê LÂM KÝ",4),
    rec("DP","ĐÔNG PHƯƠNG 2/10 NGÔ TẤT TỐ Hẻm lẩu dê LÂM KÝ",5),
    rec("K2","KÉN HOUSE 2 42/1 Hoàng Diệu Hẻm Tạp hoá cô Hoa đi lên 30m.",6)
  ];
  var curKen=[{name:"KÉN HOUSE 1",sourceColumn:3},{name:"KÉN HOME",sourceColumn:4},{name:"ĐÔNG PHƯƠNG",sourceColumn:5},{name:"KÉN HOUSE 2",sourceColumn:6}];
  var hintsKen=[
    {sourceColumn:3,oldName:"ken house 1 41/3 ngo quyen lo 2 kqh lam son ( so cu)",newName:"ken house 1",oldSku:"K1"},
    {sourceColumn:4,oldName:"ken home 2/9 ngo tat to hem lau de lam ky",newName:"ken home",oldSku:"KH"},
    {sourceColumn:5,oldName:"dong phuong 2/10 ngo tat to hem lau de lam ky",newName:"dong phuong",oldSku:"DP"},
    {sourceColumn:6,oldName:"ken house 2 42/1 hoang dieu hem tap hoa co hoa di len 30m.",newName:"ken house 2",oldSku:"K2"}
  ];
  var r7=beResolveSourceVillaIdentitiesV1_(ctx(oldKen),"1","S",curKen,{confirmedRenamePairs:hintsKen});
  if(!r7[0]||r7[0].sku!=="K1"||!r7[1]||r7[1].sku!=="KH"||!r7[2]||r7[2].sku!=="DP"||!r7[3]||r7[3].sku!=="K2")throw new Error("IDENTITY_CONFIRMED_NAME_REDUCTION_TEST_FAILED");

  var unrelatedBlocked=false;
  try{
    beResolveSourceVillaIdentitiesV1_(ctx([rec("A","Alpha Resort",3),rec("B","Beta Villa",4)]),"1","S",[{name:"Moon House",sourceColumn:3},{name:"Sun Home",sourceColumn:4}],{confirmedRenamePairs:[{sourceColumn:3,oldName:"alpha resort",newName:"moon house",oldSku:"A"},{sourceColumn:4,oldName:"beta villa",newName:"sun home",oldSku:"B"}]});
  }catch(e){unrelatedBlocked=String(e&&e.message||e).indexOf("IDENTITY_AMBIGUOUS_SOURCE_V1")>=0;}
  if(!unrelatedBlocked)throw new Error("IDENTITY_UNRELATED_SAME_COLUMN_MUST_BLOCK_V14");

  var result={success:true,code:"VILLA_IDENTITY_RESOLVER_PASS_V14",cases:8,ambiguousBlocked:true,tombstone:true,confirmedNameReduction:true,unrelatedSameColumnBlocked:true};
  Logger.log(JSON.stringify(result));return result;
}


/** B2 - căn RETIRED quay lại phải lấy lại đúng mã cũ. Chạy: testVillaIdentityReviveRetiredV1() */
function testVillaIdentityReviveRetiredV1(){
  function rec(sku,name,col,active){return {sku:sku,sourceId:"9",source:"SRC",name:name,nameNorm:normalizeMasterText(name),column:col,aliases:[name],active:active,status:active?"ACTIVE":"REMOVED"};}
  var ctx={records:[],bySourceId:{"9":[rec("A1","Villa A",3,true),rec("B1","Villa B",4,false),rec("C1","Phong Don",5,false),rec("C2","Phong Don",6,false)]},skuSet:{A1:true,B1:true,C1:true,C2:true}};
  var a=beResolveSourceVillaIdentitiesV1_(ctx,"9","SRC",[{name:"Villa A",sourceColumn:3},{name:"Villa B",sourceColumn:4},{name:"Phong Don",sourceColumn:6}],{});
  if(!a[0]||a[0].sku!=="A1")throw new Error("REVIVE_TEST_FAIL active");
  if(!a[1]||a[1].sku!=="B1"||a[1].mode!=="REVIVED_RETIRED_V1")throw new Error("REVIVE_TEST_FAIL revive B");
  if(!a[2]||a[2].sku!=="C2")throw new Error("REVIVE_TEST_FAIL duplicate name must match column");
  var b=beResolveSourceVillaIdentitiesV1_(ctx,"9","SRC",[{name:"Villa A",sourceColumn:3},{name:"Phong Don",sourceColumn:9}],{});
  if(b[1])throw new Error("REVIVE_TEST_FAIL ambiguous must not revive");
  var result={success:true,code:"VILLA_IDENTITY_REVIVE_PASS_V1"};
  Logger.log(JSON.stringify(result));return result;
}
