/**
 * 04_CalendarMetadata.gs
 * Builds a lightweight source registry used for diagnostics and future block-read optimization.
 * Realtime search does not call MASTER; it reads MASTER_VILLA through repositories.
 */
function rebuildCalendarMetadata() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sourceSheet = ss.getSheetByName(BE_CONFIG.MASTER_SHEET);
  var output = ss.getSheetByName(BE_CONFIG.CALENDAR_METADATA_SHEET) || ss.insertSheet(BE_CONFIG.CALENDAR_METADATA_SHEET);
  var headers = ["SOURCE_KEY","MÃ NGUỒN","THÀNH PHỐ","NGUỒN","LINK LỊCH","ENABLE","CONFIG","CẬP NHẬT"];
  var rows=[];
  if (sourceSheet && sourceSheet.getLastRow() > 1) {
    var values=sourceSheet.getRange(2,1,sourceSheet.getLastRow()-1,Math.max(6,sourceSheet.getLastColumn())).getDisplayValues();
    values.forEach(function(r){
      var id=beSafeString_(r[0]), city=beSafeString_(r[1]), source=beSafeString_(r[2]), url=beSafeString_(r[3]);
      var enable=String(r[4]).toLowerCase()==="true" || r[4]===true;
      var config=beSafeString_(r[5]) || BE_CONFIG.DEFAULT_READER;
      if(!url) return;
      rows.push([ceNormalize_(source)+"|"+ceNormalize_(url),id,city,source,url,enable,config,new Date()]);
    });
  }
  output.clearContents();
  output.getRange(1,1,1,headers.length).setValues([headers]);
  if(rows.length) output.getRange(2,1,rows.length,headers.length).setValues(rows);
  output.setFrozenRows(1);
  return {success:true,count:rows.length,sheet:BE_CONFIG.CALENDAR_METADATA_SHEET};
}
function getCalendarMetadata(){
  var sh=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BE_CONFIG.CALENDAR_METADATA_SHEET);
  if(!sh || sh.getLastRow()<2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getDisplayValues();
}
