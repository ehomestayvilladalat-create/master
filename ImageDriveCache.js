/**
 * EHOME Booking - Drive Image Cache V1.7 XLSX EXPORT FALLBACK + FAIL CACHE
 * Chuyển URL tạm của ảnh trong Google Sheets thành file Drive ổn định.
 */

var BE_OVERGRID_XLSX_CACHE_V14_ = {
  spreadsheetId: "",
  spreadsheetName: "",
  files: null,
  workbookSheets: null,
  sheetRecords: {},
  exportAttempted: false,
  exportError: "",
  exportMethod: ""
};

/** ================= V4.22.4 DRIVE FOLDER IMAGE REFRESH ================= */
function beDriveFolderIdFromUrlV4224_(url) {
  var text = String(url || "").trim();
  var match = text.match(/drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders|folders)\/([a-zA-Z0-9_-]+)/i);
  return match && match[1] ? match[1] : "";
}

function beResolveDriveFolderImageV4224_(url) {
  var folderId = beDriveFolderIdFromUrlV4224_(url);
  if (!folderId) return null;

  var folder = DriveApp.getFolderById(folderId);
  var files = folder.getFiles();
  var best = null;
  var bestUpdated = -1;

  while (files.hasNext()) {
    var file = files.next();
    var mime = String(file.getMimeType ? file.getMimeType() : "");
    if (!/^image\//i.test(mime)) continue;

    var updated = 0;
    try { updated = file.getLastUpdated().getTime(); } catch (ignoreUpdatedV4224) {}
    if (!best || updated > bestUpdated) {
      best = file;
      bestUpdated = updated;
    }
  }

  if (!best) {
    throw new Error("Drive folder không có file ảnh hợp lệ: " + folderId);
  }

  var blob = best.getBlob();
  if (!blob || !blob.getBytes || !blob.getBytes().length || !beDetectImageMime_(blob)) {
    throw new Error("File mới nhất trong Drive folder không đọc được như ảnh: " + best.getName());
  }

  return {
    blob: blob,
    folderId: folderId,
    fileId: best.getId(),
    fileName: best.getName(),
    updatedMs: bestUpdated,
    fingerprint: [folderId, best.getId(), bestUpdated].join("|")
  };
}

function beReadImageCacheFingerprintV4224_(file) {
  if (!file) return "";
  try {
    var description = String(file.getDescription() || "").trim();
    if (!description) return "";
    var parsed = JSON.parse(description);
    return String(parsed && parsed.sourceFingerprint || "").trim();
  } catch (ignoreDescriptionV4224) {
    return "";
  }
}

function beCacheVillaImageToDrive_(sourceId, villaName, imageSource) {
  villaName = String(villaName || "").trim();
  if (!imageSource || !villaName) return "";

  var temporaryUrl = beResolveVillaImageUrl_(imageSource);
  var folderImageV4224 = null;
  var sourceFingerprintV4224 = "";

  // V4.22.4: link Drive folder là nguồn ảnh; lấy ảnh mới nhất trong folder.
  if (beDriveFolderIdFromUrlV4224_(temporaryUrl)) {
    folderImageV4224 = beResolveDriveFolderImageV4224_(temporaryUrl);
    sourceFingerprintV4224 = folderImageV4224
      ? String(folderImageV4224.fingerprint || "")
      : "";
  }

  // URL Drive ổn định đã có sẵn thì giữ nguyên. Folder URL không phải file ảnh.
  if (temporaryUrl && !folderImageV4224 && beIsStableDriveImageUrl_(temporaryUrl)) {
    return temporaryUrl;
  }

  /*
   * V1.2 - FIX RIÊNG ẢNH OVERGRID
   *
   * Bản V1.1 return quá sớm khi OverGridImage không có content URL:
   *   if (!temporaryUrl) return "";
   *
   * Trong khi chính beResolveVillaImageBlobV41_ phía dưới đã hỗ trợ
   * imageSource.getBlob(). Vì vậy V1.2 không bắt buộc phải có URL trước.
   *
   * Với URL ngoài Googleusercontent thì vẫn giữ nguyên hành vi cũ:
   * không tải/copy sang Drive.
   */
  if (
    temporaryUrl &&
    !/(?:googleusercontent\.com|ggpht\.com|lh\d*\.googleusercontent\.com|docs\.google\.com|drive\.google\.com)/i.test(temporaryUrl)
  ) {
    /*
     * URL ngoài Google vẫn giữ nguyên như cũ, TRỪ khi object ảnh có Blob thật.
     * Nếu có Blob thì ưu tiên cache Drive để URL bền hơn.
     */
    var hasDirectBlobV13 =
      imageSource &&
      typeof imageSource === "object" &&
      typeof imageSource.getBlob === "function";

    if (!hasDirectBlobV13) return temporaryUrl;
  }

  var folder = beGetImageCacheFolder_();
  var imageKey = beVillaImageCacheKey_(sourceId, villaName);
  var existingFile = beFindCachedVillaImage_(folder, imageKey);
  var staleExistingFileV4224 = null;

  // V2.1: file cache đã tồn tại thì trả URL ngay.
  // Không setSharing lặp lại ở mỗi cache hit vì đây là một Drive API write khá chậm.
  // File mới vẫn được bật sharing ngay sau createFile() như logic cũ.
  if (existingFile) {
    var existingFingerprintV4224 = beReadImageCacheFingerprintV4224_(existingFile);
    var sourceChangedV4224 = !!sourceFingerprintV4224 &&
      existingFingerprintV4224 !== sourceFingerprintV4224;

    if (!sourceChangedV4224) {
      if (BE_CONFIG.IMAGE_RECHECK_SHARING_ON_HIT === true) {
        beEnsureImageFileSharing_(existingFile);
      }
      return beDriveImageUrl_(
        existingFile.getId(),
        beGetDriveResourceKey_(existingFile)
      );
    }

    Logger.log(JSON.stringify({
      code:"IMAGE_FOLDER_SOURCE_CHANGED_V4224",
      villa:villaName,
      sourceId:String(sourceId || ""),
      oldFingerprint:existingFingerprintV4224,
      newFingerprint:sourceFingerprintV4224
    }));
    // Fail-safe: giữ file cũ sống cho tới khi file mới tạo + share thành công.
    staleExistingFileV4224 = existingFile;
  }

  // Quan trọng: thử Blob trực tiếp từ OverGridImage trước khi đòi URL.
  var blob = folderImageV4224 && folderImageV4224.blob
    ? folderImageV4224.blob
    : beResolveVillaImageBlobV41_(
        imageSource,
        temporaryUrl,
        villaName
      );

  var contentType = beDetectImageMime_(blob);
  if (!contentType) {
    throw new Error(
      "Dữ liệu tải về không phải định dạng ảnh được hỗ trợ. Căn: " +
      villaName
    );
  }

  var extension = beImageExtensionFromMime_(contentType);
  blob.setContentType(contentType);
  blob.setName(imageKey + extension);

  var file = folder.createFile(blob);
  file.setDescription(JSON.stringify({
    type: "EHOME_VILLA_IMAGE",
    sourceId: String(sourceId || ""),
    villaName: villaName,
    cacheKey: imageKey,
    sourceFingerprint: sourceFingerprintV4224 || "",
    sourceFolderId: folderImageV4224 ? folderImageV4224.folderId : "",
    sourceFileId: folderImageV4224 ? folderImageV4224.fileId : "",
    createdAt: new Date().toISOString()
  }));

  beEnsureImageFileSharing_(file);

  // Chỉ sau khi ảnh mới đã cache thành công mới dọn cache cũ.
  if (staleExistingFileV4224) {
    try { staleExistingFileV4224.setTrashed(true); } catch (ignoreTrashOldImageV4224) {}
  }

  Logger.log(JSON.stringify({
    code: "IMAGE_DRIVE_CACHE_CREATED_V14",
    villa: villaName,
    sourceId: String(sourceId || ""),
    inputType: folderImageV4224 ? "DRIVE_FOLDER" : (temporaryUrl ? "URL_OR_CELL_IMAGE" : "DIRECT_BLOB"),
    sourceMethods: imageSource && typeof imageSource === "object"
      ? {
          getBlob: typeof imageSource.getBlob === "function",
          getContentUrl: typeof imageSource.getContentUrl === "function",
          getUrl: typeof imageSource.getUrl === "function",
          getAnchorCell: typeof imageSource.getAnchorCell === "function"
        }
      : {}
  }));

  return beDriveImageUrl_(
    file.getId(),
    beGetDriveResourceKey_(file)
  );
}

function beResolveVillaImageUrl_(imageSource) {
  if (!imageSource) return "";
  if (typeof imageSource === "string") return imageSource.trim();

  if (typeof imageSource.getContentUrl === "function") {
    try {
      var contentUrl = String(imageSource.getContentUrl() || "").trim();
      if (contentUrl) return contentUrl;
    } catch (ignore) {}
  }

  /*
   * V1.3 - OverGridImage thường expose getUrl() thay vì getContentUrl().
   * Đây chính là loại ảnh Master V4.12 giữ lại bằng getAnchorCell().
   */
  if (typeof imageSource.getUrl === "function") {
    try {
      var overGridUrl = String(imageSource.getUrl() || "").trim();
      if (overGridUrl) return overGridUrl;
    } catch (getUrlError) {
      Logger.log(JSON.stringify({
        level: "WARNING",
        code: "OVERGRID_IMAGE_URL_FAILED_V13",
        error: String(getUrlError && getUrlError.message ? getUrlError.message : getUrlError)
      }));
    }
  }

  var nestedKeys = ["image","source","imageSource","overGridImage","object"];
  for (var i=0;i<nestedKeys.length;i++) {
    var nested=imageSource[nestedKeys[i]];
    if (nested && nested!==imageSource) {
      var nestedUrl=beResolveVillaImageUrl_(nested);
      if (nestedUrl) return nestedUrl;
    }
  }

  var urlKeys=["url","contentUrl","imageUrl","src"];
  for (var j=0;j<urlKeys.length;j++) {
    var value=imageSource[urlKeys[j]];
    if (typeof value==="string" && value.trim()) return value.trim();
  }
  return "";
}

function beResolveVillaImageBlobV41_(imageSource, temporaryUrl, villaName) {
  function tryBlob_(value) {
    if (!value) return null;

    if (typeof value.getBlob === "function") {
      try {
        var direct = value.getBlob();
        if (direct && direct.getBytes && direct.getBytes().length) return direct;
      } catch (blobError) {
        Logger.log(JSON.stringify({
          level: "WARNING",
          code: "OVERGRID_IMAGE_BLOB_FAILED_V41",
          villa: villaName,
          error: String(blobError && blobError.message ? blobError.message : blobError)
        }));
      }
    }

    var keys = ["image","source","imageSource","overGridImage","object","blob"];
    for (var i = 0; i < keys.length; i++) {
      var nested = value[keys[i]];
      if (nested && nested !== value) {
        var found = tryBlob_(nested);
        if (found) return found;
      }
    }
    return null;
  }

  var directBlob = tryBlob_(imageSource);
  if (directBlob) return directBlob;

  /*
   * V1.4 - OverGridImage hiện đại thường KHÔNG trả URL nguồn nữa.
   * Google đã deprecate getUrl(); đa số ảnh mới chèn trả chuỗi rỗng.
   *
   * Vì vậy khi object là OverGridImage thật (có getAnchorCell/getSheet),
   * export chính Spreadsheet sang XLSX, đọc file ảnh trong xl/media và map
   * lại bằng sheet + anchor row/column + x/y offset.
   *
   * Fallback này CHỈ chạy khi Blob/URL thông thường thất bại.
   */
  if (!temporaryUrl) {
    var xlsxBlobNoUrl = beResolveOverGridImageBlobFromXlsxV14_(
      imageSource,
      villaName
    );
    if (xlsxBlobNoUrl) return xlsxBlobNoUrl;

    throw new Error(
      "Không lấy được URL/Blob/XLSX của ảnh. Căn: " + villaName
    );
  }

  if (!/(?:googleusercontent\.com|ggpht\.com|lh\d*\.googleusercontent\.com|docs\.google\.com|drive\.google\.com)/i.test(temporaryUrl)) {
    var xlsxBlobExternal = beResolveOverGridImageBlobFromXlsxV14_(
      imageSource,
      villaName
    );
    if (xlsxBlobExternal) return xlsxBlobExternal;

    throw new Error(
      "Ảnh không có Blob và URL không thuộc host Google hỗ trợ. Căn: " +
      villaName
    );
  }

  var response = UrlFetchApp.fetch(temporaryUrl, {
    method: "get",
    followRedirects: true,
    muteHttpExceptions: true,
    headers: {Authorization: "Bearer " + ScriptApp.getOAuthToken()}
  });

  var code = response.getResponseCode();
  if (code >= 200 && code < 300) {
    var fetchedBlob = response.getBlob();
    if (
      fetchedBlob &&
      fetchedBlob.getBytes &&
      fetchedBlob.getBytes().length &&
      beDetectImageMime_(fetchedBlob)
    ) {
      return fetchedBlob;
    }
  }

  // URL có nhưng tải thất bại / trả về HTML => thử XLSX trước khi báo lỗi.
  var xlsxBlobAfterFetch = beResolveOverGridImageBlobFromXlsxV14_(
    imageSource,
    villaName
  );
  if (xlsxBlobAfterFetch) return xlsxBlobAfterFetch;

  throw new Error(
    "Không tải được ảnh Google Sheets (HTTP " + code +
    ") và XLSX fallback không lấy được ảnh. Căn: " + villaName
  );
}


/* ================= V1.4 OVERGRID XLSX EXPORT FALLBACK ================= */

/**
 * Tìm object OverGridImage thực sự trong imageSource/nested wrapper.
 */
function beFindOverGridImageObjectV14_(value, seen) {
  if (!value || typeof value !== "object") return null;

  seen = seen || [];
  if (seen.indexOf(value) >= 0) return null;
  seen.push(value);

  if (
    typeof value.getAnchorCell === "function" &&
    typeof value.getSheet === "function"
  ) {
    return value;
  }

  var keys = ["image","source","imageSource","overGridImage","object"];
  for (var i = 0; i < keys.length; i++) {
    var nested = value[keys[i]];
    if (!nested || nested === value) continue;
    var found = beFindOverGridImageObjectV14_(nested, seen);
    if (found) return found;
  }

  return null;
}


/**
 * Lấy blob của OverGridImage từ bản export XLSX.
 *
 * Không sửa sheet nguồn. Không replace/remove ảnh.
 * Export chỉ chạy lúc buildMasterVilla và chỉ khi direct Blob/URL thất bại.
 */
function beResolveOverGridImageBlobFromXlsxV14_(imageSource, villaName) {
  var image = beFindOverGridImageObjectV14_(imageSource);
  if (!image) return null;

  try {
    var sheet = image.getSheet();
    var anchor = image.getAnchorCell();

    if (!sheet || !anchor) return null;

    var spreadsheet = sheet.getParent();
    if (!spreadsheet || typeof spreadsheet.getId !== "function") return null;

    var spreadsheetId = String(spreadsheet.getId() || "").trim();
    if (!spreadsheetId) return null;

    var target = {
      sheetName: String(sheet.getName() || ""),
      row: Number(anchor.getRow() || 0),
      column: Number(anchor.getColumn() || 0),
      xOffset: beSafeOverGridNumberV14_(image, "getAnchorCellXOffset"),
      yOffset: beSafeOverGridNumberV14_(image, "getAnchorCellYOffset"),
      width: beSafeOverGridNumberV14_(image, "getWidth"),
      height: beSafeOverGridNumberV14_(image, "getHeight")
    };

    var records = beGetXlsxImageRecordsForSheetV14_(
      spreadsheet,
      target.sheetName
    );

    if (!records || !records.length) {
      Logger.log(JSON.stringify({
        level: "WARNING",
        code: "OVERGRID_XLSX_NO_IMAGE_RECORDS_V14",
        villa: String(villaName || ""),
        sheet: target.sheetName,
        anchorCell: anchor.getA1Notation()
      }));
      return null;
    }

    var best = beChooseXlsxImageRecordV14_(records, target);
    if (!best || !best.blob) {
      Logger.log(JSON.stringify({
        level: "WARNING",
        code: "OVERGRID_XLSX_NO_MATCH_V14",
        villa: String(villaName || ""),
        sheet: target.sheetName,
        anchorCell: anchor.getA1Notation(),
        xOffset: target.xOffset,
        yOffset: target.yOffset,
        candidates: records.length
      }));
      return null;
    }

    var blob = best.blob.copyBlob
      ? best.blob.copyBlob()
      : best.blob;

    Logger.log(JSON.stringify({
      code: "OVERGRID_XLSX_IMAGE_MATCH_V14",
      villa: String(villaName || ""),
      sheet: target.sheetName,
      anchorCell: anchor.getA1Notation(),
      xOffset: target.xOffset,
      yOffset: target.yOffset,
      matchedAnchorRow: best.row,
      matchedAnchorColumn: best.column,
      matchedXOffset: best.xOffset,
      matchedYOffset: best.yOffset,
      mediaPath: best.mediaPath,
      mime: beDetectImageMime_(blob)
    }));

    return blob;
  } catch (error) {
    Logger.log(JSON.stringify({
      level: "WARNING",
      code: "OVERGRID_XLSX_FALLBACK_FAILED_V14",
      villa: String(villaName || ""),
      error: String(error && error.message ? error.message : error)
    }));
    return null;
  }
}


function beSafeOverGridNumberV14_(image, methodName) {
  try {
    if (image && typeof image[methodName] === "function") {
      return Number(image[methodName]() || 0);
    }
  } catch (ignore) {}
  return 0;
}


/**
 * Export workbook sang XLSX một lần / source trong cùng execution.
 * Sau đó parse drawing của đúng sheet để lấy blob ảnh + anchor.
 */
function beGetXlsxImageRecordsForSheetV14_(spreadsheet, sheetName) {
  var spreadsheetId = String(spreadsheet.getId() || "");
  var cache = BE_OVERGRID_XLSX_CACHE_V14_;

  if (cache.spreadsheetId !== spreadsheetId) {
    BE_OVERGRID_XLSX_CACHE_V14_ = {
      spreadsheetId: spreadsheetId,
      spreadsheetName: String(spreadsheet.getName() || ""),
      files: null,
      workbookSheets: null,
      sheetRecords: {},
      exportAttempted: false,
      exportError: "",
      exportMethod: ""
    };
    cache = BE_OVERGRID_XLSX_CACHE_V14_;
  }

  if (cache.sheetRecords.hasOwnProperty(sheetName)) {
    return cache.sheetRecords[sheetName] || [];
  }

  // V1.7: một source bị 403 chỉ thử export đúng một lần trong execution.
  if (!cache.files) {
    if (cache.exportAttempted) {
      cache.sheetRecords[sheetName] = [];
      return [];
    }

    cache.exportAttempted = true;
    try {
      var exported = beExportSpreadsheetXlsxFilesV17_(spreadsheetId);
      cache.files = exported.files || null;
      cache.exportMethod = exported.method || "";
    } catch (exportError) {
      cache.exportError = String(
        exportError && exportError.message ? exportError.message : exportError
      );
      Logger.log(JSON.stringify({
        level: "WARNING",
        code: "OVERGRID_XLSX_EXPORT_BLOCKED_V17",
        spreadsheet: cache.spreadsheetName,
        spreadsheetId: spreadsheetId,
        error: cache.exportError,
        action: "SKIP_REPEAT_EXPORT_THIS_EXECUTION"
      }));
      cache.sheetRecords[sheetName] = [];
      return [];
    }
  }

  if (!cache.workbookSheets) {
    cache.workbookSheets = beBuildWorkbookSheetPathMapV14_(cache.files);
  }

  var sheetPath = cache.workbookSheets[sheetName] || "";
  if (!sheetPath) {
    Logger.log(JSON.stringify({
      level: "WARNING",
      code: "OVERGRID_XLSX_SHEET_NOT_FOUND_V14",
      spreadsheet: cache.spreadsheetName,
      sheet: sheetName
    }));
    cache.sheetRecords[sheetName] = [];
    return [];
  }

  var records = beParseSheetDrawingImagesV14_(
    cache.files,
    sheetPath
  );

  cache.sheetRecords[sheetName] = records;

  Logger.log(JSON.stringify({
    code: "OVERGRID_XLSX_SHEET_PARSED_V17",
    spreadsheet: cache.spreadsheetName,
    sheet: sheetName,
    sheetPath: sheetPath,
    exportMethod: cache.exportMethod,
    images: records.length
  }));

  return records;
}

function beFetchSpreadsheetXlsxBlobV17_(spreadsheetId) {
  var token = ScriptApp.getOAuthToken();
  var mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  var attempts = [];

  function fetchOne_(method, url) {
    var response = UrlFetchApp.fetch(url, {
      method: "get",
      followRedirects: true,
      muteHttpExceptions: true,
      headers: {Authorization: "Bearer " + token}
    });
    var code = Number(response.getResponseCode() || 0);
    attempts.push(method + "_HTTP_" + code);
    if (code >= 200 && code < 300) {
      return {blob:response.getBlob(),method:method,httpCode:code};
    }
    return null;
  }

  // Cách 1: endpoint export của Google Sheets như V1.6.
  var docsUrl =
    "https://docs.google.com/spreadsheets/d/" +
    encodeURIComponent(spreadsheetId) +
    "/export?format=xlsx";
  var result = fetchOne_("DOCS_EXPORT", docsUrl);
  if (result) return result;

  // Cách 2: Drive API export. Không cần bật Advanced Service vì dùng UrlFetch + OAuth token.
  var driveUrl =
    "https://www.googleapis.com/drive/v3/files/" +
    encodeURIComponent(spreadsheetId) +
    "/export?mimeType=" + encodeURIComponent(mime);
  result = fetchOne_("DRIVE_API_EXPORT", driveUrl);
  if (result) return result;

  throw new Error("XLSX export failed: " + attempts.join(";"));
}

/**
 * V1.7: export XLSX với 2 đường lấy file.
 * Trả cả files + method để chẩn đoán nguồn nào cần fallback Drive API.
 */
function beExportSpreadsheetXlsxFilesV17_(spreadsheetId) {
  var fetched = beFetchSpreadsheetXlsxBlobV17_(spreadsheetId);
  var exportBlob = fetched.blob;

  var zipBlob = exportBlob.copyBlob
    ? exportBlob.copyBlob()
    : exportBlob;
  zipBlob.setContentType("application/zip");

  var entries = Utilities.unzip(zipBlob);
  var files = {};

  (entries || []).forEach(function(entry) {
    var name = String(entry.getName() || "")
      .replace(/^\/+/, "");
    if (name) files[name] = entry;
  });

  if (!files["xl/workbook.xml"]) {
    throw new Error("XLSX export thiếu xl/workbook.xml");
  }

  Logger.log(JSON.stringify({
    code: "OVERGRID_XLSX_EXPORT_LOADED_V17",
    spreadsheetId: spreadsheetId,
    method: fetched.method,
    httpCode: fetched.httpCode,
    originalContentType: String(exportBlob.getContentType() || ""),
    unzipContentType: "application/zip",
    entries: Object.keys(files).length
  }));

  return {files:files,method:fetched.method};
}


/** Public self-test, không gọi mạng. */
function testImageDriveCacheV17() {
  var old = BE_OVERGRID_XLSX_CACHE_V14_;
  BE_OVERGRID_XLSX_CACHE_V14_ = {
    spreadsheetId:"TEST",
    spreadsheetName:"TEST",
    files:null,
    workbookSheets:null,
    sheetRecords:{},
    exportAttempted:true,
    exportError:"DOCS_EXPORT_HTTP_403;DRIVE_API_EXPORT_HTTP_403",
    exportMethod:""
  };

  var pass = BE_OVERGRID_XLSX_CACHE_V14_.exportAttempted === true &&
    !!BE_OVERGRID_XLSX_CACHE_V14_.exportError;
  BE_OVERGRID_XLSX_CACHE_V14_ = old;

  if (!pass) throw new Error("V17 FAIL export failure cache.");
  var result={success:true,version:"1.7-xlsx-export-fallback-fail-cache",failureCachePass:true,driveApiFallbackReady:true};
  Logger.log(JSON.stringify({code:"IMAGE_DRIVE_CACHE_PASS_V17",result:result}));
  return result;
}

function beBuildWorkbookSheetPathMapV14_(files) {
  var workbookBlob = files["xl/workbook.xml"];
  var relsBlob = files["xl/_rels/workbook.xml.rels"];
  if (!workbookBlob || !relsBlob) return {};

  var workbookXml = workbookBlob.getDataAsString();
  var rels = beXlsxRelationshipMapV14_(
    relsBlob.getDataAsString(),
    "xl"
  );

  var result = {};
  var tagRegex = /<sheet\b[^>]*\/?>/gi;
  var match;

  while ((match = tagRegex.exec(workbookXml))) {
    var tag = match[0];
    var name = beXlsxXmlDecodeV14_(
      beXlsxXmlAttrV14_(tag, "name")
    );
    var relId = beXlsxXmlAttrV14_(tag, "r:id");

    if (!name || !relId || !rels[relId]) continue;
    result[name] = rels[relId];
  }

  Logger.log(JSON.stringify({
    code: "OVERGRID_XLSX_WORKBOOK_MAP_V16",
    sheetCount: Object.keys(result).length,
    sheetNames: Object.keys(result).slice(0, 50)
  }));

  return result;
}


/**
 * sheet xml -> drawing xml -> media blobs.
 */
function beParseSheetDrawingImagesV14_(files, sheetPath) {
  var sheetBlob = files[sheetPath];
  if (!sheetBlob) return [];

  var sheetXml = sheetBlob.getDataAsString();
  var drawingTag = sheetXml.match(/<drawing\b[^>]*\/?>/i);
  if (!drawingTag) return [];

  var drawingRelId = beXlsxXmlAttrV14_(drawingTag[0], "r:id");
  if (!drawingRelId) return [];

  var sheetRelsPath = beXlsxRelsPathV14_(sheetPath);
  var sheetRelsBlob = files[sheetRelsPath];
  if (!sheetRelsBlob) return [];

  var sheetDir = beXlsxDirnameV14_(sheetPath);
  var sheetRels = beXlsxRelationshipMapV14_(
    sheetRelsBlob.getDataAsString(),
    sheetDir
  );

  var drawingPath = sheetRels[drawingRelId] || "";
  if (!drawingPath || !files[drawingPath]) return [];

  var drawingXml = files[drawingPath].getDataAsString();
  var drawingRelsPath = beXlsxRelsPathV14_(drawingPath);
  var drawingRelsBlob = files[drawingRelsPath];
  if (!drawingRelsBlob) return [];

  var drawingDir = beXlsxDirnameV14_(drawingPath);
  var drawingRels = beXlsxRelationshipMapV14_(
    drawingRelsBlob.getDataAsString(),
    drawingDir
  );

  var records = [];
  var anchorRegex = /<xdr:(oneCellAnchor|twoCellAnchor)\b[\s\S]*?<\/xdr:\1>/gi;
  var anchorMatch;
  var order = 0;

  while ((anchorMatch = anchorRegex.exec(drawingXml))) {
    var block = anchorMatch[0];
    var fromMatch = block.match(/<xdr:from>([\s\S]*?)<\/xdr:from>/i);
    if (!fromMatch) continue;

    var from = fromMatch[1];
    var col0 = beXlsxTagIntV14_(from, "xdr:col");
    var row0 = beXlsxTagIntV14_(from, "xdr:row");
    var colOff = beXlsxTagIntV14_(from, "xdr:colOff");
    var rowOff = beXlsxTagIntV14_(from, "xdr:rowOff");

    var blipMatch = block.match(/<a:blip\b[^>]*r:embed="([^"]+)"/i);
    if (!blipMatch) continue;

    var mediaPath = drawingRels[blipMatch[1]] || "";
    var mediaBlob = mediaPath ? files[mediaPath] : null;
    if (!mediaBlob) continue;

    // 1 px ~= 9525 EMU trong OOXML.
    var xPx = Math.round(Number(colOff || 0) / 9525);
    var yPx = Math.round(Number(rowOff || 0) / 9525);

    records.push({
      row: Number(row0 || 0) + 1,
      column: Number(col0 || 0) + 1,
      xOffset: xPx,
      yOffset: yPx,
      order: order++,
      mediaPath: mediaPath,
      blob: mediaBlob
    });
  }

  return records;
}


/**
 * Chọn ảnh đúng object bằng anchor + offset.
 * Không đoán theo tên căn.
 */
function beChooseXlsxImageRecordV14_(records, target) {
  if (!records || !records.length) return null;

  var exactAnchor = records.filter(function(record) {
    return (
      Number(record.row || 0) === Number(target.row || 0) &&
      Number(record.column || 0) === Number(target.column || 0)
    );
  });

  var pool = exactAnchor.length ? exactAnchor : records.filter(function(record) {
    return (
      Math.abs(Number(record.row || 0) - Number(target.row || 0)) <= 1 &&
      Math.abs(Number(record.column || 0) - Number(target.column || 0)) <= 1
    );
  });

  if (!pool.length) return null;

  var best = null;
  var bestScore = 1e15;

  pool.forEach(function(record) {
    var score =
      Math.abs(Number(record.row || 0) - Number(target.row || 0)) * 100000 +
      Math.abs(Number(record.column || 0) - Number(target.column || 0)) * 100000 +
      Math.abs(Number(record.xOffset || 0) - Number(target.xOffset || 0)) * 100 +
      Math.abs(Number(record.yOffset || 0) - Number(target.yOffset || 0)) * 100 +
      Number(record.order || 0);

    if (score < bestScore) {
      bestScore = score;
      best = record;
    }
  });

  return best;
}


function beXlsxRelationshipMapV14_(xml, baseDir) {
  var map = {};
  var regex = /<Relationship\b[^>]*\/?>/gi;
  var match;

  while ((match = regex.exec(String(xml || "")))) {
    var tag = match[0];
    var id = beXlsxXmlAttrV14_(tag, "Id");
    var target = beXlsxXmlAttrV14_(tag, "Target");

    if (!id || !target) continue;
    map[id] = beXlsxResolvePathV14_(baseDir, target);
  }

  return map;
}


function beXlsxXmlAttrV14_(tag, attrName) {
  var escaped = String(attrName || "")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  var regex = new RegExp(
    "(?:^|\\s)" + escaped + "=[\"']([^\"']*)[\"']",
    "i"
  );
  var match = String(tag || "").match(regex);
  return match ? match[1] : "";
}


function beXlsxTagIntV14_(xml, tagName) {
  var escaped = String(tagName || "")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  var regex = new RegExp(
    "<" + escaped + ">(-?\\d+)<\\/" + escaped + ">",
    "i"
  );
  var match = String(xml || "").match(regex);
  return match ? Number(match[1]) : 0;
}


function beXlsxXmlDecodeV14_(text) {
  return String(text || "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, function(_, number) {
      return String.fromCharCode(Number(number || 0));
    })
    .replace(/&#x([0-9a-f]+);/gi, function(_, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    });
}


function beXlsxRelsPathV14_(partPath) {
  var dir = beXlsxDirnameV14_(partPath);
  var base = String(partPath || "").split("/").pop();
  return (dir ? dir + "/" : "") + "_rels/" + base + ".rels";
}


function beXlsxDirnameV14_(path) {
  var parts = String(path || "").split("/");
  parts.pop();
  return parts.join("/");
}


function beXlsxResolvePathV14_(baseDir, target) {
  target = String(target || "").replace(/\\/g, "/");
  if (!target) return "";

  if (target.charAt(0) === "/") {
    return target.replace(/^\/+/, "");
  }

  var stack = String(baseDir || "")
    .split("/")
    .filter(String);

  target.split("/").forEach(function(part) {
    if (!part || part === ".") return;
    if (part === "..") {
      if (stack.length) stack.pop();
      return;
    }
    stack.push(part);
  });

  return stack.join("/");
}

function beGetImageCacheFolder_() {
  var configuredId = String(
    BE_CONFIG.IMAGE_DRIVE_FOLDER_ID || ""
  ).trim();

  var isolated = BE_CONFIG.IMAGE_DRIVE_ISOLATED === true;
  var propertyKey = String(
    BE_CONFIG.IMAGE_DRIVE_PROPERTY_KEY ||
    (isolated ? "BE_IMAGE_DRIVE_FOLDER_ID_DEV_V2" : "BE_IMAGE_DRIVE_FOLDER_ID")
  ).trim();

  var properties = PropertiesService.getScriptProperties();
  var savedId = String(
    properties.getProperty(propertyKey) || ""
  ).trim();

  // DEV isolated tuyệt đối không đọc property Production cũ.
  // Chỉ dùng ID cấu hình riêng hoặc ID đã lưu dưới propertyKey DEV.
  var folderId = configuredId || savedId;

  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (folderError) {
      if (configuredId) {
        throw new Error(
          "IMAGE_DRIVE_FOLDER_ID không hợp lệ hoặc tài khoản không có quyền."
        );
      }
      properties.deleteProperty(propertyKey);
    }
  }

  var folderName = String(
    BE_CONFIG.IMAGE_DRIVE_FOLDER_NAME ||
    (isolated ? "EHOME_BOOKING_IMAGE_CACHE_DEV_V2" : "EHOME_BOOKING_IMAGE_CACHE")
  ).trim();

  // Với DEV isolated, tìm/tạo đúng folder DEV; không fallback về folder Production.
  var folders = DriveApp.getFoldersByName(folderName);
  var folder = folders.hasNext()
    ? folders.next()
    : DriveApp.createFolder(folderName);

  properties.setProperty(propertyKey, folder.getId());

  Logger.log(JSON.stringify({
    code: "IMAGE_DRIVE_FOLDER_RESOLVED_V211",
    isolated: isolated,
    folderName: folderName,
    folderId: folder.getId(),
    propertyKey: propertyKey
  }));

  return folder;
}

function beEnsureImageFileSharing_(file) {
  if (BE_CONFIG.IMAGE_PUBLIC_ACCESS === false) return;

  try {
    file.setSharing(
      DriveApp.Access.ANYONE_WITH_LINK,
      DriveApp.Permission.VIEW
    );
  } catch (sharingError) {
    throw new Error(
      "Không thể bật quyền 'Bất kỳ ai có liên kết' cho ảnh Drive: " +
      (sharingError && sharingError.message
        ? sharingError.message
        : sharingError)
    );
  }

}

function beGetDriveResourceKey_(file) {
  try {
    return typeof file.getResourceKey === "function"
      ? String(file.getResourceKey() || "").trim()
      : "";
  } catch (resourceKeyError) {
    Logger.log("IMAGE_RESOURCE_KEY_READ_SKIPPED: " + resourceKeyError);
    return "";
  }
}

function beVillaImageCacheKey_(sourceId, villaName) {
  var raw = String(sourceId || "") + "__" + String(villaName || "");
  var safe = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .substring(0, 120);

  return "EHOME_" + (safe || "VILLA_IMAGE");
}

function beFindCachedVillaImage_(folder, imageKey) {
  var extensions = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

  for (var i = 0; i < extensions.length; i++) {
    var files = folder.getFilesByName(imageKey + extensions[i]);
    if (files.hasNext()) return files.next();
  }

  return null;
}

function beDetectImageMime_(blob) {
  var mimeType = String(blob.getContentType() || "").toLowerCase();
  if (/^image\/(jpeg|png|gif|webp)$/.test(mimeType)) return mimeType;

  var bytes = blob.getBytes();
  function u(index) {
    return index < bytes.length ? (bytes[index] + 256) % 256 : -1;
  }

  if (u(0) === 0xFF && u(1) === 0xD8 && u(2) === 0xFF) return "image/jpeg";
  if (
    u(0) === 0x89 && u(1) === 0x50 && u(2) === 0x4E && u(3) === 0x47
  ) return "image/png";
  if (u(0) === 0x47 && u(1) === 0x49 && u(2) === 0x46) return "image/gif";
  if (
    u(0) === 0x52 && u(1) === 0x49 && u(2) === 0x46 && u(3) === 0x46 &&
    u(8) === 0x57 && u(9) === 0x45 && u(10) === 0x42 && u(11) === 0x50
  ) return "image/webp";

  return "";
}

function beImageExtensionFromMime_(mimeType) {
  mimeType = String(mimeType || "").toLowerCase();
  if (mimeType.indexOf("png") >= 0) return ".png";
  if (mimeType.indexOf("webp") >= 0) return ".webp";
  if (mimeType.indexOf("gif") >= 0) return ".gif";
  return ".jpg";
}

function beIsStableDriveImageUrl_(url) {
  return /drive\.google\.com\/(?:uc\?|thumbnail\?|file\/d\/)/i.test(
    String(url || "")
  );
}

function beDriveImageUrl_(fileId, resourceKey) {
  // Bản preview 1200px tải nhanh hơn ảnh gốc qua uc?export=view,
  // đủ nét cho thẻ villa trên điện thoại và desktop.
  var url = "https://drive.google.com/thumbnail?id=" +
    encodeURIComponent(fileId) + "&sz=w1200";

  if (resourceKey) {
    url += "&resourcekey=" + encodeURIComponent(resourceKey);
  }

  return url;
}


/** V4.22.4 - parser test cho Drive folder URL. */
function testDriveFolderParserV4224(){
  var url="https://drive.google.com/drive/folders/12qjWKExdn0ctK_pfG__8_65qHfsWOztj";
  var id=beDriveFolderIdFromUrlV4224_(url);
  if(id!=="12qjWKExdn0ctK_pfG__8_65qHfsWOztj")throw new Error("DRIVE_FOLDER_PARSE_FAIL_V4224: "+id);
  var result={success:true,version:"4.22.4",folderId:id};
  Logger.log(JSON.stringify({code:"DRIVE_FOLDER_PARSER_PASS_V4224",result:result}));
  return result;
}
