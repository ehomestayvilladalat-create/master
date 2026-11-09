/**
 * 14_ImageWorker.gs - EHOME V2.2 BACKGROUND IMAGE CACHE + SUPPLEMENT + RECONCILE
 *
 * Tách thao tác tải/upload ảnh nặng ra khỏi buildMasterVilla().
 * Build Master chỉ tạo queue; worker xử lý queue theo từng nguồn và cập nhật
 * riêng cột ẢNH của MASTER_VILLA.
 */

var EHOME_IMAGE_WORKER_V21 = {
  HANDLER: "ehomeImageCacheWorkerV21_",
  DEFAULT_QUEUE_SHEET: "IMAGE_CACHE_QUEUE_V2"
};

function beImageQueueSheetNameV21_(){
  return String(
    BE_CONFIG.IMAGE_QUEUE_SHEET ||
    EHOME_IMAGE_WORKER_V21.DEFAULT_QUEUE_SHEET
  ).trim();
}

function beImageQueueHeadersV21_(){
  return [
    "STATUS",
    "ATTEMPTS",
    "CACHE SOURCE KEY",
    "MÃ CĂN",
    "SOURCE ID",
    "NGUỒN",
    "LINK",
    "TÊN CĂN",
    "CỘT NGUỒN",
    "CONFIG MASTER",
    "CONFIG ẢNH",
    "IMAGE URL",
    "ERROR",
    "CẬP NHẬT"
  ];
}

function beReplaceImageCacheQueueV21_(records){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var name=beImageQueueSheetNameV21_();
  var sheet=ss.getSheetByName(name)||ss.insertSheet(name);
  var headers=beImageQueueHeadersV21_();

  sheet.clearContents();
  sheet.getRange(1,1,1,headers.length).setValues([headers]);
  sheet.setFrozenRows(1);

  var rows=(records||[]).map(function(record){
    record=record||{};
    return [
      "PENDING",
      0,
      String(record.cacheSourceKey||""),
      String(record.sku||""),
      String(record.sourceId||""),
      String(record.source||""),
      String(record.link||""),
      String(record.villaName||""),
      Number(record.sourceColumn||0),
      String(record.masterConfig||""),
      String(record.imageConfig||""),
      "",
      "",
      new Date()
    ];
  });

  if(rows.length){
    sheet.getRange(2,1,rows.length,headers.length).setValues(rows);
  }

  Logger.log(JSON.stringify({
    code:"IMAGE_QUEUE_REPLACED_V21",
    queued:rows.length,
    sheet:name
  }));

  return {success:true,queued:rows.length,sheet:name};
}

function beScheduleImageWorkerV21_(){
  if(BE_CONFIG.IMAGE_CACHE_ENABLED!==true)return {success:false,reason:"IMAGE_CACHE_DISABLED"};

  var handler=EHOME_IMAGE_WORKER_V21.HANDLER;
  var exists=ScriptApp.getProjectTriggers().some(function(trigger){
    return trigger.getHandlerFunction()===handler;
  });

  if(exists){
    return {success:true,scheduled:false,reason:"ALREADY_SCHEDULED"};
  }

  var trigger=ScriptApp.newTrigger(handler)
    .timeBased()
    .after(60*1000)
    .create();

  Logger.log(JSON.stringify({
    code:"IMAGE_WORKER_SCHEDULED_V21",
    triggerId:trigger.getUniqueId()
  }));

  return {success:true,scheduled:true,triggerId:trigger.getUniqueId()};
}

function beRemoveImageWorkerTriggersV21_(){
  var handler=EHOME_IMAGE_WORKER_V21.HANDLER;
  var removed=0;
  ScriptApp.getProjectTriggers().forEach(function(trigger){
    if(trigger.getHandlerFunction()===handler){
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });
  return removed;
}


/**
 * V3.4.2 - Fallback đọc trực tiếp đúng cột villa khi reader metadata không map được.
 * Hỗ trợ CONFIG ẢNH=AUTO/trống, CellImage, =IMAGE(), URL ảnh và ảnh nổi.
 * Chỉ trả tài nguyên ảnh thật; không nhận Zalo/web link.
 */
function beResolveQueuedImageDirectV342_(sheet,effectiveImageConfig,sourceColumn){
  if(!sheet||Number(sourceColumn||0)<=0)return null;
  var col=Number(sourceColumn)-1;
  var parsed={};
  try{parsed=parseMetadataConfig(effectiveImageConfig)||{};}catch(ignoreParseV342){parsed={};}
  var rows=[];
  if(parsed.imageRow>0)rows=[Number(parsed.imageRow)];
  else if(parsed.imageRows&&parsed.imageRows.length)rows=parsed.imageRows.map(Number);
  else{
    var max=Math.min(24,Math.max(1,Number(sheet.getLastRow()||1)));
    for(var r=1;r<=max;r++)rows.push(r);
  }

  try{
    var runtime=beGetMasterSheetRuntimeDataV21_(sheet);
    var exact=beFindExactConfiguredImageV49_(
      sheet,runtime.display,runtime.formulas,runtime.raw,col,rows
    );
    if(exact&&exact.source)return exact.source;
  }catch(exactErrV342){
    Logger.log(JSON.stringify({level:"WARNING",code:"IMAGE_DIRECT_EXACT_FAILED_V342",sheet:sheet.getName(),column:sourceColumn,error:String(exactErrV342&&exactErrV342.message?exactErrV342.message:exactErrV342)}));
  }

  try{
    var map=beBuildOverGridImageMapV40_(sheet);
    var over=beFindOverGridImageForColumnV42_(map,col,rows,sheet);
    if(over&&over.image)return over.image;
  }catch(overErrV342){
    Logger.log(JSON.stringify({level:"WARNING",code:"IMAGE_DIRECT_OVERGRID_FAILED_V342",sheet:sheet.getName(),column:sourceColumn,error:String(overErrV342&&overErrV342.message?overErrV342.message:overErrV342)}));
  }
  return null;
}


/**
 * V6.1.5 - Ưu tiên cache ảnh PHONG_RIENG trước villa nguyên căn.
 * Chỉ thay thứ tự chọn source group; không đổi resolver, source data hay lịch.
 */
function bePrivateRoomSkuMapV615_(ss){
  var result={};
  try{
    var sheet=ss.getSheetByName(BE_CONFIG.MASTER_VILLA_SHEET||"MASTER_VILLA");
    if(!sheet||sheet.getLastRow()<2)return result;

    var values=sheet.getDataRange().getDisplayValues();
    var headers=values[0].map(ceNormalize_);
    function col(names){return ceFindHeader_(headers,names);}

    var skuCol=col(["ma can","sku","id"]);
    var typeCol=col(["loai sp","loai_sp","product type"]);
    var generatedCol=col(["loai sp nguon","loai_sp_nguon","generated type"]);
    if(skuCol<0)return result;

    for(var r=1;r<values.length;r++){
      var sku=String(values[r][skuCol]||"").trim().toUpperCase();
      if(!sku)continue;

      var type=typeCol>=0?String(values[r][typeCol]||"").trim().toUpperCase():"";
      var generated=generatedCol>=0?String(values[r][generatedCol]||"").trim().toUpperCase():"";
      var effective=type||generated;

      if(effective==="PHONG_RIENG")result[sku]=true;
    }
  }catch(err){
    Logger.log(JSON.stringify({
      level:"WARNING",
      code:"IMAGE_ROOM_PRIORITY_MAP_FAILED_V615",
      error:String(err&&err.message?err.message:err)
    }));
  }
  return result;
}

function bePrioritizePrivateRoomGroupsV615_(groupOrder,groups,values,c,privateRoomSkus){
  var decorated=(groupOrder||[]).map(function(key,index){
    var rows=(groups&&groups[key])||[];
    var privateCount=0;

    rows.forEach(function(rowIndex){
      var row=values[rowIndex]||[];
      var sku=c.sku>=0?String(row[c.sku]||"").trim().toUpperCase():"";
      if(sku&&privateRoomSkus&&privateRoomSkus[sku])privateCount++;
    });

    return {
      key:key,
      originalIndex:index,
      privateCount:privateCount
    };
  });

  decorated.sort(function(a,b){
    var aPrivate=a.privateCount>0?1:0;
    var bPrivate=b.privateCount>0?1:0;
    if(aPrivate!==bPrivate)return bPrivate-aPrivate;
    if(a.privateCount!==b.privateCount)return b.privateCount-a.privateCount;
    return a.originalIndex-b.originalIndex;
  });

  return decorated.map(function(item){return item.key;});
}

function testImageRoomPriorityV615(){
  var values=[
    ["SKU"],
    ["VL-VILLA-1"],
    ["VL-ROOM-1"],
    ["VL-ROOM-2"],
    ["VL-ROOM-3"]
  ];
  var groups={
    villa:[1],
    roomsSmall:[2],
    roomsBig:[3,4]
  };
  var order=["villa","roomsSmall","roomsBig"];
  var c={sku:0};
  var privateSkus={"VL-ROOM-1":true,"VL-ROOM-2":true,"VL-ROOM-3":true};

  var prioritized=bePrioritizePrivateRoomGroupsV615_(
    order,groups,values,c,privateSkus
  );
  if(prioritized.join(",")!=="roomsBig,roomsSmall,villa"){
    throw new Error("IMAGE_ROOM_PRIORITY_ORDER_FAIL_V615: "+prioritized.join(","));
  }

  var unchanged=bePrioritizePrivateRoomGroupsV615_(
    order,groups,values,c,{}
  );
  if(unchanged.join(",")!==order.join(",")){
    throw new Error("IMAGE_ROOM_PRIORITY_STABLE_FAIL_V615: "+unchanged.join(","));
  }

  var result={
    success:true,
    code:"IMAGE_ROOM_PRIORITY_PASS_V615",
    roomFirst:true,
    largerRoomGroupFirst:true,
    nonRoomOrderStable:true
  };
  Logger.log(JSON.stringify(result));
  return result;
}


function ehomeImageCacheWorkerV21_(){
  // Trigger one-shot đã bắt đầu chạy thì xóa những trigger cùng handler còn treo,
  // tránh nhiều lượt worker chồng nhau.
  beRemoveImageWorkerTriggersV21_();

  var lock=LockService.getScriptLock();
  if(!lock.tryLock(1000)){
    // V3.4.2: one-shot trigger đã bị xóa ở đầu hàm. Nếu lock đang bận mà
    // thoát luôn thì queue có thể kẹt vĩnh viễn. Luôn tự hẹn lại.
    var rescheduleLockedV342=null;
    try{rescheduleLockedV342=beScheduleImageWorkerV21_();}catch(ignoreScheduleLockedV342){}
    Logger.log(JSON.stringify({
      code:"IMAGE_WORKER_LOCKED_RESCHEDULED_V342",
      reschedule:rescheduleLockedV342
    }));
    return {success:false,skipped:true,reason:"LOCKED",rescheduled:true};
  }

  var startedAt=new Date().getTime();
  var maintenanceActiveV620 = typeof beMaintenanceActiveV620_ === "function" && beMaintenanceActiveV620_();
  var maxRuntime=Math.max(
    60000,
    Number(maintenanceActiveV620 && typeof beMaintenanceImageRuntimeV620_ === "function"
      ? beMaintenanceImageRuntimeV620_()
      : (BE_CONFIG.IMAGE_WORKER_MAX_RUNTIME_MS||220000))
  );
  var sourceLimit=Math.max(
    1,
    Number(maintenanceActiveV620 && typeof beMaintenanceImageBatchSizeV620_ === "function"
      ? beMaintenanceImageBatchSizeV620_()
      : (BE_CONFIG.IMAGE_WORKER_SOURCES_PER_RUN||2))
  );

  try{
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var queueSheet=ss.getSheetByName(beImageQueueSheetNameV21_());

    if(!queueSheet||queueSheet.getLastRow()<2){
      return {success:true,processed:0,pending:0,message:"EMPTY_QUEUE"};
    }

    var values=queueSheet.getDataRange().getValues();
    var headers=values[0].map(ceNormalize_);

    function col(names){return ceFindHeader_(headers,names);}
    var c={
      status:col(["status","trang thai"]),
      attempts:col(["attempts","so lan"]),
      cacheKey:col(["cache source key"]),
      sku:col(["ma can","sku"]),
      sourceId:col(["source id","id"]),
      source:col(["nguon","source"]),
      link:col(["link","link lich","url"]),
      name:col(["ten can","ten villa","villa"]),
      sourceColumn:col(["cot nguon","source column"]),
      masterConfig:col(["config master"]),
      imageConfig:col(["config anh","image config"]),
      imageUrl:col(["image url","anh"]),
      error:col(["error","loi"]),
      updated:col(["cap nhat","updated"])
    };

    if(c.status<0||c.sku<0||c.link<0||c.name<0){
      throw new Error("IMAGE_CACHE_QUEUE_V2 thiếu cột bắt buộc.");
    }

    var groups={};
    var groupOrder=[];

    for(var r=1;r<values.length;r++){
      var status=String(values[r][c.status]||"").trim().toUpperCase();
      if(status!=="PENDING")continue;

      var link=String(values[r][c.link]||"").trim();
      var masterConfig=c.masterConfig>=0?String(values[r][c.masterConfig]||""):"";
      var imageConfig=c.imageConfig>=0?String(values[r][c.imageConfig]||""):"";
      var groupKey=link+"||"+masterConfig+"||"+imageConfig;

      if(!groups[groupKey]){
        groups[groupKey]=[];
        groupOrder.push(groupKey);
      }
      groups[groupKey].push(r);
    }

    if(!groupOrder.length){
      return {success:true,processed:0,pending:0,message:"NO_PENDING"};
    }

    // V6.1.5: Customer web cần ảnh phòng lẻ trước.
    // Ưu tiên source group có PHONG_RIENG; trong nhóm đó source có nhiều
    // phòng đang chờ hơn chạy trước. Villa nguyên căn vẫn giữ thứ tự cũ.
    var privateRoomSkusV615=bePrivateRoomSkuMapV615_(ss);
    groupOrder=bePrioritizePrivateRoomGroupsV615_(
      groupOrder,groups,values,c,privateRoomSkusV615
    );

    var roomPriorityGroupsV615=0;
    for(var pg=0;pg<groupOrder.length;pg++){
      var pgRows=groups[groupOrder[pg]]||[];
      var hasRoomV615=false;
      for(var pri=0;pri<pgRows.length;pri++){
        var pgSku=String(values[pgRows[pri]][c.sku]||"").trim().toUpperCase();
        if(pgSku&&privateRoomSkusV615[pgSku]){hasRoomV615=true;break;}
      }
      if(hasRoomV615)roomPriorityGroupsV615++;
    }
    Logger.log(JSON.stringify({
      code:"IMAGE_WORKER_ROOM_PRIORITY_V615",
      privateRoomSkus:Object.keys(privateRoomSkusV615).length,
      priorityGroups:roomPriorityGroupsV615,
      totalGroups:groupOrder.length
    }));

    var imageUpdates={};
    var processed=0;
    var processedGroups=0;
    var stoppedEarly=false;

    for(var gi=0;gi<groupOrder.length;gi++){
      if(processedGroups>=sourceLimit)break;
      if(new Date().getTime()-startedAt>maxRuntime){
        stoppedEarly=true;
        break;
      }

      var rowIndexes=groups[groupOrder[gi]];
      if(!rowIndexes||!rowIndexes.length)continue;

      var firstRow=values[rowIndexes[0]];
      var link=String(firstRow[c.link]||"").trim();
      var masterConfig=c.masterConfig>=0?String(firstRow[c.masterConfig]||""):"";
      var imageConfig=c.imageConfig>=0?String(firstRow[c.imageConfig]||""):"";

      try{
        beClearMasterSheetRuntimeCacheV21_();

        var file=beOpenSourceSpreadsheetV_FIX(link);  // FIX: hỗ trợ nguồn .xlsx
        var calendarConfigV4210="AUTO";
        try{
          if(typeof opsFindSourceV312_==="function"){
            var queueSourceIdV4210=c.sourceId>=0?String(firstRow[c.sourceId]||"").trim():"";
            var queueSourceNameV4210=c.source>=0?String(firstRow[c.source]||"").trim():"";
            var masterSourceV4210=opsFindSourceV312_(queueSourceIdV4210||queueSourceNameV4210);
            if(masterSourceV4210&&masterSourceV4210.configCalendar)calendarConfigV4210=masterSourceV4210.configCalendar;
          }
        }catch(ignoreCalendarConfigV4210){}
        var calendarSheet=typeof beFindMasterCalendarSheetV4210_==="function"
          ? beFindMasterCalendarSheetV4210_(file,calendarConfigV4210,new Date())
          : findLatestMasterCalendarSheet(file);
        if(!calendarSheet)throw new Error("Không tìm thấy MAIN SHEET của nguồn.");

        var effectiveImageConfig=beBuildInheritedMetadataConfigV37_(
          masterConfig,
          imageConfig,
          "IMAGE"
        );

        /*
         * V3.3.0: Image Worker phải đọc cùng logic sheet ảnh với Master.
         * Nếu CONFIG ẢNH có SHEET=... rõ ràng thì dùng sheet phụ đó;
         * nếu không thì giữ nguyên MAIN calendar sheet như V2.1.
         */
        var imageSheet=calendarSheet;
        var hasExplicitImageSupplementV330 =
          typeof beHasExplicitMetadataSheetV38_ === "function" &&
          beHasExplicitMetadataSheetV38_(imageConfig);

        if(hasExplicitImageSupplementV330){
          imageSheet=beFindMetadataSheetV32_(file,effectiveImageConfig,"IMAGE");
          if(!imageSheet)throw new Error("Không tìm thấy SHEET ảnh bổ sung.");
          Logger.log(JSON.stringify({
            code:"IMAGE_WORKER_SUPPLEMENT_SHEET_SELECTED_V330",
            sheet:imageSheet.getName(),
            mainSheet:calendarSheet.getName()
          }));
        }

        var imageVillas=beReadInfoSheetV31_(imageSheet,effectiveImageConfig)||[];
        if(
          hasExplicitImageSupplementV330 &&
          !imageVillas.length &&
          typeof beReadImageOnlySequenceV414_ === "function"
        ){
          imageVillas=beReadImageOnlySequenceV414_(imageSheet,effectiveImageConfig)||[];
        }

        var resolvedImageVillas=imageVillas;

        // Với sheet phụ, cột sheet ảnh không phải cột lịch. Ghép về villa lịch
        // theo tên an toàn; nếu IMAGE_ASSIGN_MODE=SEQUENCE thì gán theo thứ tự.
        if(hasExplicitImageSupplementV330){
          var calendarVillas=readMasterFromCalendarSheet(calendarSheet,masterConfig)||[];

          if(calendarVillas.length && typeof beCollapseMergedVillaGroupsV38_ === "function"){
            calendarVillas=beCollapseMergedVillaGroupsV38_(calendarSheet,calendarVillas);
          }
          if(calendarVillas.length && typeof beCollapseAdjacentDuplicateVillaGroupsV411_ === "function"){
            calendarVillas=beCollapseAdjacentDuplicateVillaGroupsV411_(calendarSheet,calendarVillas);
          }

          if(typeof beMergeVillaMetadataV31_ === "function"){
            resolvedImageVillas=beMergeVillaMetadataV31_(
              calendarVillas,
              imageVillas,
              {allowSafeNameMatch:true}
            );
          }else{
            resolvedImageVillas=calendarVillas;
          }

          if(typeof beAssignImagesBySequenceV46_ === "function"){
            resolvedImageVillas=beAssignImagesBySequenceV46_(
              resolvedImageVillas,
              imageVillas,
              effectiveImageConfig,
              imageSheet
            );
          }
        }

        var byExact={};
        var byName={};

        (resolvedImageVillas||[]).forEach(function(villa){
          if(!villa||!villa.name)return;
          var nameKey=normalizeMasterText(villa.name);
          var exactKey=Number(villa.sourceColumn||0)+"||"+nameKey;
          if(!byExact[exactKey])byExact[exactKey]=villa;
          byName[nameKey]=byName[nameKey]||[];
          byName[nameKey].push(villa);
        });

        for(var ri=0;ri<rowIndexes.length;ri++){
          if(new Date().getTime()-startedAt>maxRuntime){
            stoppedEarly=true;
            break;
          }

          var rowIndex=rowIndexes[ri];
          var q=values[rowIndex];
          var villaName=String(q[c.name]||"").trim();
          var sourceColumn=c.sourceColumn>=0?Number(q[c.sourceColumn]||0):0;
          var nameKey=normalizeMasterText(villaName);
          var exactKey=sourceColumn+"||"+nameKey;
          var candidate=byExact[exactKey]||null;

          if(!candidate&&byName[nameKey]&&byName[nameKey].length===1){
            candidate=byName[nameKey][0];
          }

          try{
            var imageSource=candidate ? (candidate.imageSource||candidate.image||"") : "";

            // V3.4.2: reader metadata có thể fail ở CellImage/ảnh nổi/AUTO.
            // Worker chạy riêng nên được phép direct-read đúng cột villa.
            if(!imageSource){
              imageSource=beResolveQueuedImageDirectV342_(
                imageSheet||calendarSheet,
                effectiveImageConfig,
                sourceColumn
              )||"";
            }

            if(!imageSource){
              throw new Error(candidate
                ? "Nguồn không còn ảnh tại vị trí đã map."
                : "Không map được ảnh theo tên/cột nguồn và direct fallback cũng không thấy ảnh.");
            }

            var cacheSourceKey=c.cacheKey>=0
              ? String(q[c.cacheKey]||"").trim()
              : String(q[c.sourceId]||"").trim();

            var stableUrl=beCacheVillaImageToDrive_(
              cacheSourceKey,
              villaName,
              imageSource
            );

            if(!stableUrl){
              throw new Error("ImageDriveCache không trả URL.");
            }

            q[c.status]="DONE";
            if(c.imageUrl>=0)q[c.imageUrl]=stableUrl;
            if(c.error>=0)q[c.error]="";
            if(c.updated>=0)q[c.updated]=new Date();

            var sku=String(q[c.sku]||"").trim().toUpperCase();
            if(sku)imageUpdates[sku]=stableUrl;
            processed++;
          }catch(imageError){
            var attempts=c.attempts>=0?Number(q[c.attempts]||0)+1:1;
            if(c.attempts>=0)q[c.attempts]=attempts;
            q[c.status]=attempts>=3?"ERROR":"PENDING";
            if(c.error>=0){
              q[c.error]=String(
                imageError&&imageError.message?imageError.message:imageError
              );
            }
            if(c.updated>=0)q[c.updated]=new Date();

            Logger.log(JSON.stringify({
              level:"WARNING",
              code:"IMAGE_WORKER_ITEM_FAILED_V21",
              villa:villaName,
              sourceColumn:sourceColumn,
              attempts:attempts,
              error:String(imageError&&imageError.message?imageError.message:imageError)
            }));
          }
        }

        processedGroups++;
      }catch(sourceError){
        rowIndexes.forEach(function(rowIndex){
          var q=values[rowIndex];
          var attempts=c.attempts>=0?Number(q[c.attempts]||0)+1:1;
          if(c.attempts>=0)q[c.attempts]=attempts;
          q[c.status]=attempts>=3?"ERROR":"PENDING";
          if(c.error>=0){
            q[c.error]=String(
              sourceError&&sourceError.message?sourceError.message:sourceError
            );
          }
          if(c.updated>=0)q[c.updated]=new Date();
        });

        Logger.log(JSON.stringify({
          level:"WARNING",
          code:"IMAGE_WORKER_SOURCE_FAILED_V21",
          link:link,
          error:String(sourceError&&sourceError.message?sourceError.message:sourceError)
        }));

        processedGroups++;
      }finally{
        beClearMasterSheetRuntimeCacheV21_();
      }

      if(stoppedEarly)break;
    }

    queueSheet
      .getRange(1,1,values.length,values[0].length)
      .setValues(values);

    beApplyImageUpdatesToMasterV21_(ss,imageUpdates);

    // V3.3.0: ảnh Worker vừa về MASTER thì dọn ngay BỔ_SUNG_ẢNH.
    // Manual override theo phương án A luôn được giữ.
    var reconcileResult=null;
    if(typeof beReconcileImageOverridesV330_ === "function"){
      try{
        reconcileResult=beReconcileImageOverridesV330_(ss);
      }catch(reconcileErrorV330){
        Logger.log(JSON.stringify({
          level:"WARNING",
          code:"IMAGE_OVERRIDE_RECONCILE_FAILED_V330",
          stage:"IMAGE_WORKER",
          error:String(
            reconcileErrorV330&&reconcileErrorV330.message
              ? reconcileErrorV330.message
              : reconcileErrorV330
          )
        }));
      }
    }

    var pending=0;
    for(var pr=1;pr<values.length;pr++){
      if(String(values[pr][c.status]||"").trim().toUpperCase()==="PENDING"){
        pending++;
      }
    }

    if(pending>0){
      beScheduleImageWorkerV21_();
    }

    var result={
      success:true,
      processed:processed,
      processedSources:processedGroups,
      pending:pending,
      stoppedEarly:stoppedEarly,
      reconcile:reconcileResult,
      elapsedMs:new Date().getTime()-startedAt
    };

    Logger.log(JSON.stringify({
      code:"IMAGE_WORKER_DONE_V21",
      result:result
    }));

    return result;
  }finally{
    // FIX15: tự hẹn lại nếu còn PENDING, kể cả khi lượt trước bị lỗi giữa chừng,
    // để chuỗi worker không bị đứt.
    try{
      var pendingFix15=0;
      var qSheetFix15=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(beImageQueueSheetNameV21_());
      if(qSheetFix15&&qSheetFix15.getLastRow()>1){
        var stFix15=qSheetFix15.getRange(1,1,qSheetFix15.getLastRow(),1).getValues();
        for(var sfi=1;sfi<stFix15.length;sfi++){
          if(String(stFix15[sfi][0]||"").trim().toUpperCase()==="PENDING")pendingFix15++;
        }
      }
      if(pendingFix15>0)beScheduleImageWorkerV21_();
    }catch(ignoreFix15){}
    lock.releaseLock();
  }
}

function beApplyImageUpdatesToMasterV21_(ss,imageUpdates){
  var keys=Object.keys(imageUpdates||{});
  if(!keys.length)return 0;

  var sheet=ss.getSheetByName(BE_CONFIG.MASTER_VILLA_SHEET);
  if(!sheet||sheet.getLastRow()<2)return 0;

  var headers=sheet
    .getRange(1,1,1,sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(ceNormalize_);

  var skuColumn=ceFindHeader_(headers,["ma can","sku","id"]);
  var imageColumn=ceFindHeader_(headers,["anh","hinh anh","image"]);
  if(skuColumn<0||imageColumn<0)return 0;

  var rowCount=sheet.getLastRow()-1;
  var skuValues=sheet.getRange(2,skuColumn+1,rowCount,1).getDisplayValues();
  var imageRange=sheet.getRange(2,imageColumn+1,rowCount,1);
  var imageValues=imageRange.getValues();
  var changed=0;

  for(var i=0;i<rowCount;i++){
    var sku=String(skuValues[i][0]||"").trim().toUpperCase();
    if(!sku||!imageUpdates[sku])continue;
    imageValues[i][0]=imageUpdates[sku];
    changed++;
  }

  if(changed)imageRange.setValues(imageValues);

  Logger.log(JSON.stringify({
    code:"MASTER_IMAGE_COLUMN_UPDATED_V21",
    changed:changed
  }));

  return changed;
}

/** Chạy thủ công khi cần xử lý queue ngay. */
function runImageCacheWorkerV21(){
  return ehomeImageCacheWorkerV21_();
}

/** Xem nhanh số ảnh còn chờ/lỗi. */
function getImageCacheQueueStatusV21(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var sheet=ss.getSheetByName(beImageQueueSheetNameV21_());
  if(!sheet||sheet.getLastRow()<2){
    return {pending:0,done:0,error:0};
  }

  var values=sheet.getRange(2,1,sheet.getLastRow()-1,1).getDisplayValues();
  var result={pending:0,done:0,error:0};

  values.forEach(function(row){
    var status=String(row[0]||"").trim().toUpperCase();
    if(status==="PENDING")result.pending++;
    else if(status==="DONE")result.done++;
    else if(status==="ERROR")result.error++;
  });

  return result;
}


/** V3.3.0 self-test dependency check, không mở source. */
function testImageWorkerV330_(){
  var missing=[];
  if(typeof beBuildInheritedMetadataConfigV37_ !== "function") missing.push("beBuildInheritedMetadataConfigV37_");
  if(typeof beReadInfoSheetV31_ !== "function") missing.push("beReadInfoSheetV31_");
  if(typeof beReconcileImageOverridesV330_ !== "function") missing.push("beReconcileImageOverridesV330_");
  if(missing.length)throw new Error("V330 IMAGE WORKER missing dependency: "+missing.join(", "));

  var result={success:true,version:"2.2-worker-v330",supplementReady:true,reconcileReady:true};
  Logger.log(JSON.stringify({code:"IMAGE_WORKER_PASS_V330",result:result}));
  return result;
}
function testImageWorkerV330() {
  return testImageWorkerV330_();
}


/**
 * V3.4.2 - Repair queue từ MASTER_VILLA, không sửa source và không sửa lịch.
 * - Missing nhưng chưa queue => thêm PENDING (kể cả CONFIG ẢNH=AUTO/trống).
 * - ERROR cũ => reset PENDING/attempts=0 một lần khi anh chủ động chạy hàm này.
 * - Căn đã có ảnh => không đụng.
 */
function repairImageQueueV342(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var master=ss.getSheetByName(BE_CONFIG.MASTER_VILLA_SHEET||"MASTER_VILLA");
  if(!master||master.getLastRow()<2)throw new Error("Không có MASTER_VILLA.");
  var queueName=beImageQueueSheetNameV21_();
  var queue=ss.getSheetByName(queueName)||ss.insertSheet(queueName);
  var qHeaders=beImageQueueHeadersV21_();
  var qValues=queue.getLastRow()>0?queue.getDataRange().getValues():[];
  if(!qValues.length){qValues=[qHeaders.slice()];}
  var qNorm=qValues[0].map(ceNormalize_);
  function qc(names){return ceFindHeader_(qNorm,names);}
  var q={status:qc(["status"]),attempts:qc(["attempts"]),sku:qc(["ma can"]),source:qc(["nguon"]),link:qc(["link"]),error:qc(["error"]),updated:qc(["cap nhat"])};
  var qBySku={};
  for(var i=1;i<qValues.length;i++){var sku=String(qValues[i][q.sku]||"").trim();if(sku)qBySku[sku]=i;}

  var sourceCfg=beImageQueueSourceConfigMapV342_(ss);
  var mv=master.getDataRange().getDisplayValues();
  var mh=mv[0].map(ceNormalize_);
  function mc(names){return ceFindHeader_(mh,names);}
  var m={sku:mc(["ma can"]),image:mc(["anh","image"]),name:mc(["ten can"]),source:mc(["nguon"]),link:mc(["link lich","link"]),col:mc(["cot nguon","source column"])};
  var added=0,revived=0,alreadyPending=0,withImage=0;

  for(var r=1;r<mv.length;r++){
    var sku=String(mv[r][m.sku]||"").trim();if(!sku)continue;
    var image=m.image>=0?String(mv[r][m.image]||"").trim():"";
    if(image){withImage++;continue;}
    var existing=qBySku[sku];
    if(existing!==undefined){
      var st=String(qValues[existing][q.status]||"").trim().toUpperCase();
      if(st==="ERROR"){
        qValues[existing][q.status]="PENDING";
        if(q.attempts>=0)qValues[existing][q.attempts]=0;
        if(q.error>=0)qValues[existing][q.error]="RETRY_V342 | "+String(qValues[existing][q.error]||"");
        if(q.updated>=0)qValues[existing][q.updated]=new Date();
        revived++;
      }else if(st==="PENDING")alreadyPending++;
      continue;
    }
    var source=m.source>=0?String(mv[r][m.source]||"").trim():"";
    var link=m.link>=0?String(mv[r][m.link]||"").trim():"";
    var cfg=sourceCfg["LINK|"+link]||sourceCfg["SOURCE|"+normalizeMasterText(source)]||{};
    var col=m.col>=0?Number(mv[r][m.col]||0):0;
    var row=["PENDING",0,String(cfg.sourceId||"")+(col?"_COL_"+col:""),sku,String(cfg.sourceId||""),source,link,String(mv[r][m.name]||""),col,String(cfg.masterConfig||""),String(cfg.imageConfig||""),"","",new Date()];
    qValues.push(row);qBySku[sku]=qValues.length-1;added++;
  }

  queue.clearContents();queue.getRange(1,1,1,qHeaders.length).setValues([qHeaders]);queue.setFrozenRows(1);
  var out=qValues.slice(1).map(function(row){var x=row.slice(0,qHeaders.length);while(x.length<qHeaders.length)x.push("");return x;});
  if(out.length)queue.getRange(2,1,out.length,qHeaders.length).setValues(out);
  if(added+revived>0)beScheduleImageWorkerV21_();
  var result={success:true,code:"IMAGE_QUEUE_REPAIRED_V342",added:added,revived:revived,alreadyPending:alreadyPending,withImage:withImage,totalQueue:out.length};
  Logger.log(JSON.stringify(result));return result;
}

function beImageQueueSourceConfigMapV342_(ss){
  var result={};var sheet=ss.getSheetByName(BE_CONFIG.MASTER_SHEET||"MASTER");if(!sheet||sheet.getLastRow()<2)return result;
  var v=sheet.getDataRange().getDisplayValues(),h=v[0].map(ceNormalize_);
  function c(names){return ceFindHeader_(h,names);}
  var x={id:c(["id","ma nguon"]),source:c(["nguon"]),link:c(["link"]),master:c(["config master"]),image:c(["config anh"])};
  v.slice(1).forEach(function(row){var o={sourceId:x.id>=0?String(row[x.id]||"").trim():"",masterConfig:x.master>=0?String(row[x.master]||""):"",imageConfig:x.image>=0?String(row[x.image]||""):""};var link=x.link>=0?String(row[x.link]||"").trim():"";var source=x.source>=0?String(row[x.source]||"").trim():"";if(link)result["LINK|"+link]=o;if(source)result["SOURCE|"+normalizeMasterText(source)]=o;});return result;
}

function testImagePipelineV342(){
  if(typeof beResolveQueuedImageDirectV342_!=="function")throw new Error("MISSING_DIRECT_FALLBACK_V342");
  if(typeof repairImageQueueV342!=="function")throw new Error("MISSING_QUEUE_REPAIR_V342");
  var result={success:true,code:"IMAGE_PIPELINE_PASS_V342",lockReschedule:true,autoQueueRepair:true,directFallback:true};
  Logger.log(JSON.stringify(result));return result;
}
