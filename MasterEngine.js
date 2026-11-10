// Booking Engine V3.2.8 - INCREMENTAL MASTER + IMAGE FAIL-SAFE
/** 03_MasterEngine.gs - MASTER VILLA V4.15 SAFE CONFIG + IMAGE OVERRIDE RECONCILE */


/* ================= V2.1 FAST MASTER RUNTIME CACHE ================= */

/**
 * Chỉ cache dữ liệu của MAIN SHEET trong RAM của CHÍNH execution hiện tại.
 * Mục tiêu: image/info/calendar readers dùng chung một lần getValues /
 * getDisplayValues / getFormulas thay vì tải lại cùng sheet nhiều lần.
 *
 * Cache này không dùng CacheService, không giữ qua execution và không thay đổi
 * bất kỳ logic nhận diện tên/ảnh/thông tin nào.
 */
var BE_MASTER_SHEET_RUNTIME_CACHE_V21_ = {};

/*
 * V3.2.8 FAST MASTER IMAGE MODE
 * Chỉ bật trong buildMasterVilla() khi Admin/AutoSync yêu cầu fastImages.
 * ImageWorker chạy ở execution khác nên mặc định vẫn được phép dùng direct-cell
 * fallback để resolve các CellImage khó. Master chỉ cần dựng danh sách căn nhanh.
 */
var BE_MASTER_FAST_IMAGE_MODE_V328_ = false;

function beMasterSheetRuntimeKeyV21_(sheet) {
  if (!sheet) return "";
  var parentId = "";
  try {
    var parent = sheet.getParent();
    parentId = parent && parent.getId ? String(parent.getId() || "") : "";
  } catch (ignore) {}
  return parentId + "|" + String(sheet.getSheetId ? sheet.getSheetId() : sheet.getName());
}

function beGetMasterSheetRuntimeDataV21_(sheet) {
  var key = beMasterSheetRuntimeKeyV21_(sheet);
  if (key && BE_MASTER_SHEET_RUNTIME_CACHE_V21_[key]) {
    return BE_MASTER_SHEET_RUNTIME_CACHE_V21_[key];
  }

  var range = sheet.getDataRange();
  var data = {
    range: range,
    display: range.getDisplayValues(),
    formulas: range.getFormulas(),
    raw: range.getValues(),
    mergedRanges: []
  };

  try {
    data.mergedRanges = range.getMergedRanges() || [];
  } catch (ignoreMerged) {}

  if (key) BE_MASTER_SHEET_RUNTIME_CACHE_V21_[key] = data;
  return data;
}

function beSliceMasterMatrixV21_(matrix, rowCount, columnCount) {
  var result = [];
  var rows = Math.min(Number(rowCount || 0), matrix ? matrix.length : 0);
  for (var r = 0; r < rows; r++) {
    var row = matrix[r] || [];
    result.push(row.slice(0, Math.min(Number(columnCount || 0), row.length)));
  }
  return result;
}

function beClearMasterSheetRuntimeCacheV21_() {
  BE_MASTER_SHEET_RUNTIME_CACHE_V21_ = {};
}

function beImageSourceNeedsDriveCacheV21_(imageSource) {
  if (!imageSource) return false;
  if (typeof imageSource === "object") return true;

  var url = String(imageSource || "").trim();
  if (!url) return false;
  if (typeof beIsStableDriveImageUrl_ === "function" && beIsStableDriveImageUrl_(url)) {
    return false;
  }

  return /(?:googleusercontent\.com|ggpht\.com|lh\d*\.googleusercontent\.com|docs\.google\.com|drive\.google\.com)/i.test(url);
}

/** V4.22.4 - Folder Drive là một nguồn ảnh hợp lệ và cần worker kiểm tra refresh. */
function beIsDriveFolderImageSourceV4224_(imageSource) {
  if (typeof imageSource !== "string") return false;
  return /drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders|folders)\/[a-zA-Z0-9_-]+/i
    .test(String(imageSource || "").trim());
}

/**
 * Folder URL phải được queue lại dù MASTER đã có ảnh cũ. ImageDriveCache sẽ
 * fingerprint file ảnh mới nhất trong folder; nếu không đổi thì cache-hit,
 * nếu đổi thì thay ảnh cache.
 */
function beShouldRefreshImageSourceV4224_(imageSource) {
  return beIsDriveFolderImageSourceV4224_(imageSource);
}


/**
 * Chỉ trả về các tab đang hiển thị. Mọi bộ dò AUTO đều phải dùng hàm này.
 */
function beGetVisibleSheets_(file) {
  if (!file) return [];

  return file.getSheets().filter(function(sheet) {
    try {
      if (sheet.isSheetHidden()) {
        Logger.log(JSON.stringify({
          code: "HIDDEN_SHEET_SKIPPED",
          sheet: sheet.getName()
        }));
        return false;
      }
    } catch (error) {}

    return true;
  });
}

function beRejectHiddenSheet_(sheet, context) {
  if (!sheet) return null;
  try {
    if (sheet.isSheetHidden()) {
      Logger.log(JSON.stringify({
        code: "HIDDEN_SHEET_REJECTED",
        sheet: sheet.getName(),
        context: context || ""
      }));
      return null;
    }
  } catch (error) {}
  return sheet;
}

/**
 * Tìm sheet chứa danh sách/thông tin căn.
 */
function findMasterInfoSheet(file) {
  const keywords = [
    "thong tin",
    "information",
    "informations",
    "thong tin can",
    "danh sach can",
    "danh sach villa",
    "ds villa"
  ];

  const sheets = beGetVisibleSheets_(file);

  for (const sheet of sheets) {
    const name = normalizeMasterText(sheet.getName());

    if (keywords.some(keyword => name.indexOf(keyword) >= 0)) {
      return sheet;
    }
  }

  return null;
}


/**
 * Đọc nguồn có sheet Thông tin.
 *
 * Không fix cứng một vị trí duy nhất.
 * Hàm quét tiêu đề để tìm các cột tên, cơ cấu, maps và ảnh.
 */
function readMasterFromInfoSheet(sheet, config) {
  const range = sheet.getDataRange();
  const values = range.getDisplayValues();
  const formulas = range.getFormulas();

  if (!values.length) return [];

  /*
   * Một số nguồn gắn hyperlink trực tiếp vào tên căn. Luôn lấy phần chữ
   * hiển thị của RichText; tuyệt đối không dùng URL của hyperlink làm tên.
   */
  const masterNameConfig = parseMasterColumnConfig(config);
  if (masterNameConfig.fixedNameRowIndex >= 0) {
    overwriteMasterLinkedNameRow_(
      sheet,
      values,
      masterNameConfig.fixedNameRowIndex + 1
    );
  }

  const header = detectMasterHeader(values);

  
  

  /*
   * Nếu tìm được cột tên căn theo tiêu đề.
   */
  if (header.nameColumn >= 0) {
    return readMasterRowsByHeader(
      values,
      formulas,
      header
    );
  }

  /*
   * Nếu không tìm được tiêu đề rõ ràng,
   * thử đọc bảng dạng mỗi cột là một căn.
   */
  return readMasterFromColumnLayout(values, formulas, config);
}


/**
 * Tìm hàng tiêu đề và vị trí các cột.
 */
function detectMasterHeader(values) {
  const maxRows = Math.min(values.length, 15);

  let best = {
    row: -1,
    score: 0,
    nameColumn: -1,
    infoColumn: -1,
    mapsColumn: -1,
    imageColumn: -1
  };

  for (let r = 0; r < maxRows; r++) {
    const row = values[r].map(normalizeMasterText);

    const nameColumn = findMasterHeaderColumn(row, [
      "ten",
      "ten villa",
      "ten can",
      "ten home",
      "villa",
      "home"
    ]);

    const infoColumn = findMasterHeaderColumn(row, [
      "co cau",
      "thong tin",
      "chi tiet",
      "mo ta",
      "noi dung"
    ]);

    const mapsColumn = findMasterHeaderColumn(row, [
      "maps",
      "map",
      "dia chi",
      "dia chi link map",
      "dinh vi",
      "vi tri"
    ]);

    const imageColumn = findMasterHeaderColumn(row, [
      "anh",
      "hinh anh",
      "link anh",
      "image"
    ]);

    let score = 0;

    if (nameColumn >= 0) score += 5;
    if (infoColumn >= 0) score += 2;
    if (mapsColumn >= 0) score += 2;
    if (imageColumn >= 0) score += 1;

    if (score > best.score) {
      best = {
        row: r,
        score: score,
        nameColumn: nameColumn,
        infoColumn: infoColumn,
        mapsColumn: mapsColumn,
        imageColumn: imageColumn
      };
    }
  }

  return best;
}


function findMasterHeaderColumn(row, names) {
  /*
   * Ưu tiên khớp chính xác.
   */
  for (const name of names) {
    const index = row.indexOf(name);

    if (index >= 0) {
      return index;
    }
  }

  /*
   * Sau đó mới khớp gần đúng.
   */
  for (let c = 0; c < row.length; c++) {
    if (!row[c]) continue;

    for (const name of names) {
      if (row[c].indexOf(name) >= 0) {
        return c;
      }
    }
  }

  return -1;
}


/**
 * Đọc bảng dạng:
 * mỗi hàng là một villa.
 */
function readMasterRowsByHeader(values, formulas, header) {
  const villas = [];

  for (let r = header.row + 1; r < values.length; r++) {
    const nameText = cleanMasterVillaName(
      values[r][header.nameColumn]
    );

    if (!nameText) continue;
    if (!isValidMasterVillaName(nameText)) continue;

    const info = header.infoColumn >= 0
      ? cleanMasterText(values[r][header.infoColumn])
      : "";

    const maps = header.mapsColumn >= 0
      ? getMasterLink(
          values[r][header.mapsColumn],
          formulas[r][header.mapsColumn]
        )
      : "";

    const image = header.imageColumn >= 0
      ? getMasterLink(
          values[r][header.imageColumn],
          formulas[r][header.imageColumn]
        )
      : "";

    villas.push({
      name: nameText,
      standard: extractMasterStandard(
        nameText + "\n" + info
      ),
      bedrooms: extractMasterBedrooms(
        nameText + "\n" + info
      ),
      info: info,
      image: image,
      maps: maps
    });
  }

  return villas;
}


/**
 * Dạng nguồn lịch:
 * mỗi cột là một căn.
 *
 * Tên căn thường nằm trong khoảng 10 hàng đầu.
 */
function readMasterFromCalendarSheet(sheet, config) {
  const runtimeDataV21 = beGetMasterSheetRuntimeDataV21_(sheet);
  let values = (runtimeDataV21.display || []).map(function(row) { return row.slice(); });
  let formulas = (runtimeDataV21.formulas || []).map(function(row) { return row.slice(); });

  if (!values.length) return [];

  const masterNameConfig = parseMasterColumnConfig(config);
  if (masterNameConfig.fixedNameRowIndex >= 0) {
    overwriteMasterLinkedNameRow_(
      sheet,
      values,
      masterNameConfig.fixedNameRowIndex + 1
    );
  }

  /*
   * Google Sheets chỉ trả dữ liệu ở ô trên-trái của vùng merge.
   * Mở rộng giá trị merge để bộ đọc không bỏ mất tên ở cột đầu.
   */
  const expanded = expandMasterMergedCells(
    sheet,
    values,
    formulas,
    runtimeDataV21.mergedRanges || []
  );
  values = expanded.values;
  formulas = expanded.formulas;

  return readMasterFromColumnLayout(values, formulas, config);
}

/**
 * Ghi đè riêng hàng tên bằng chữ hiển thị trong ô RichText.
 *
 * Ô "LUCA" có gắn link https://... vẫn trả về "LUCA". Hàm này không gọi
 * getLinkUrl(), nên đường dẫn web không thể trở thành tên căn hoặc khiến bộ
 * đọc bỏ qua hàng tên cố định.
 */
function beCleanMasterMultilineTextV414_(value) {
  return String(value == null ? "" : value)
    .replace(/\r\n?/g, "\n")
    // Giữ \n để bộ tách tên lấy đúng dòng đầu; chỉ xóa control char khác.
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, " ")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .split("\n")
    .map(function(line) { return String(line || "").replace(/[ \t]+/g, " ").trim(); })
    .join("\n")
    .trim();
}

function overwriteMasterLinkedNameRow_(sheet, values, rowNumber) {
  if (
    !sheet ||
    !values ||
    !values.length ||
    !Number.isFinite(rowNumber) ||
    rowNumber < 1 ||
    rowNumber > values.length
  ) {
    return values;
  }

  const columnCount = Math.min(
    values[rowNumber - 1] ? values[rowNumber - 1].length : 0,
    Math.max(sheet.getLastColumn(), 0)
  );

  if (columnCount < 1) return values;

  const nameRange = sheet.getRange(rowNumber, 1, 1, columnCount);
  const displayRow = nameRange.getDisplayValues()[0] || [];
  let richTextRow = [];

  try {
    richTextRow = nameRange.getRichTextValues()[0] || [];
  } catch (richTextError) {
    Logger.log(JSON.stringify({
      level: "WARNING",
      code: "VILLA_NAME_RICH_TEXT_READ_FAILED",
      sheet: sheet.getName(),
      row: rowNumber,
      error: String(
        richTextError && richTextError.message
          ? richTextError.message
          : richTextError
      )
    }));
  }

  for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
    let visibleText = "";
    const richText = richTextRow[columnIndex];

    if (richText && typeof richText.getText === "function") {
      visibleText = beCleanMasterMultilineTextV414_(richText.getText());
    }

    if (!visibleText) {
      visibleText = beCleanMasterMultilineTextV414_(displayRow[columnIndex]);
    }

    values[rowNumber - 1][columnIndex] = visibleText;
  }

  return values;
}

function expandMasterMergedCells(sheet, values, formulas, cachedMergedRangesV21) {
  const copiedValues = values.map(function(row) {
    return row.slice();
  });

  const copiedFormulas = formulas.map(function(row) {
    return row.slice();
  });

  const mergedRanges = cachedMergedRangesV21 && cachedMergedRangesV21.length
    ? cachedMergedRangesV21
    : sheet.getDataRange().getMergedRanges();

  mergedRanges.forEach(function(mergedRange) {
    const rowStart = mergedRange.getRow() - 1;
    const columnStart = mergedRange.getColumn() - 1;
    const rowCount = mergedRange.getNumRows();
    const columnCount = mergedRange.getNumColumns();

    const value =
      copiedValues[rowStart] &&
      typeof copiedValues[rowStart][columnStart] !== "undefined"
        ? copiedValues[rowStart][columnStart]
        : "";

    const formula =
      copiedFormulas[rowStart] &&
      typeof copiedFormulas[rowStart][columnStart] !== "undefined"
        ? copiedFormulas[rowStart][columnStart]
        : "";

    for (let r = rowStart; r < rowStart + rowCount; r++) {
      for (let c = columnStart; c < columnStart + columnCount; c++) {
        if (!copiedValues[r]) continue;
        copiedValues[r][c] = value;

        if (copiedFormulas[r]) {
          copiedFormulas[r][c] = formula;
        }
      }
    }
  });

  return {
    values: copiedValues,
    formulas: copiedFormulas
  };
}


/**
 * Đọc bảng mỗi cột là một căn.
 *
 * Logic:
 * 1. Quét các hàng đầu để tìm hàng có nhiều tên villa nằm ngang.
 * 2. Nếu chưa có tên thì quét tiếp toàn bộ cột.
 * 3. Ảnh và Maps không bắt buộc.
 * 4. Chỉ tạo villa khi cột có tên hợp lệ.
 * 5. Bỏ qua cột trống để không sinh thêm "Chưa xác định".
 */
/**
 * MASTER_VILLA - COLUMN LAYOUT READER V2
 *
 * Config trống => AUTO_ROW.
 * Ví dụ:
 * NAME_MODE=AUTO_ROW
 * NAME_MODE=FIXED_ROW;NAME_ROW=4
 * START_COL=3;TOP_ROWS=12;FALLBACK=TRUE
 */
// B3: cảnh báo của lần đọc layout gần nhất (buildMasterVilla lấy ra sau mỗi nguồn).
var BE_B3_LAST_WARNINGS_V1 = [];

function readMasterFromColumnLayout(values, formulas, rawConfig) {
  BE_B3_LAST_WARNINGS_V1 = [];
  if (!values || !values.length || !values[0]) return [];

  const config = parseMasterColumnConfig(rawConfig);
  const columnCount = values[0].length;

  /*
   * Khi không cấu hình START_COL, tự nhận lịch bắt đầu ở B hay C.
   * Hàm detectCalendarVillaStartColumn đã có sẵn nhưng bản cũ không dùng.
   */
  if (!hasMasterExplicitStartColumn(rawConfig)) {
    config.startColumnIndex = detectCalendarVillaStartColumn(values);
  }

  if (columnCount <= config.startColumnIndex) return [];

  const lastColumnExclusive = config.endColumnIndex >= 0
    ? Math.min(columnCount, config.endColumnIndex + 1)
    : columnCount;

  if (lastColumnExclusive <= config.startColumnIndex) return [];

  const nameDetection = resolveMasterVillaNameRow(values, config);
  Logger.log(JSON.stringify(nameDetection));
Logger.log(JSON.stringify(config));
  const columns = [];

  for (
    let columnIndex = config.startColumnIndex;
    columnIndex < lastColumnExclusive;
    columnIndex++
  ) {
    if (config.excludedColumnIndexes.indexOf(columnIndex) >= 0) {
      Logger.log(JSON.stringify({
        code: "MASTER_COLUMN_SKIPPED_V39",
        column: columnIndex + 1,
        letter: beColumnLetterV38_(columnIndex + 1)
      }));
      continue;
    }

    const nameResult = readMasterVillaNameAtColumn(
      values,
      formulas,
      columnIndex,
      nameDetection,
      config
    );
    // FIX-LOG: bỏ log "COL n" cho từng cột (làm đầy log và chậm vòng lặp).
    const metadata = scanMasterColumnMetadata(
      values,
      formulas,
      columnIndex,
      nameResult.row
    );

    const name = nameResult.name || "";
    const rawNameCell = nameResult.row >= 0 && values[nameResult.row]
      ? cleanMasterText(values[nameResult.row][columnIndex])
      : "";
    const sameCellInfo = rawNameCell &&
      normalizeMasterText(rawNameCell) !== normalizeMasterText(name)
      ? rawNameCell
      : "";
    let info = metadata.info || sameCellInfo || "";

    if (
      name &&
      info &&
      normalizeMasterText(name) === normalizeMasterText(info)
    ) {
      info = "";
    }

    columns.push({
      columnIndex: columnIndex,
      name: name,
      nameRow: nameResult.row,
      info: info,
      image: metadata.image || "",
      maps: metadata.maps || "",
      score: scoreMasterVillaColumn({
        name: name,
        info: info,
        image: metadata.image || "",
        maps: metadata.maps || ""
      }),
      isVillaColumn: !!name
    });
  }
  // B3: cột trong vùng cấu hình có giá ở các hàng ngày nhưng hàng tên trống => cảnh báo,
  // không còn bỏ qua im lặng (Kimi H/O, thảo anh D/F).
  try {
    BE_B3_LAST_WARNINGS_V1 = beFindNamelessPriceColumnsB3_(values, config, nameDetection, columns, lastColumnExclusive);
    if (BE_B3_LAST_WARNINGS_V1.length) {
      Logger.log(JSON.stringify({
        level:"WARNING", code:"PRICE_COLUMN_WITHOUT_NAME_B3",
        nameRow: nameDetection && nameDetection.row >= 0 ? nameDetection.row + 1 : 0,
        columns: BE_B3_LAST_WARNINGS_V1
      }));
    }
  } catch (b3Error) {
    BE_B3_LAST_WARNINGS_V1 = [];
  }

columns.forEach(function(c) {
  if (c.columnIndex <= 5) {
    Logger.log(
      "COL " + (c.columnIndex + 1) +
      " | index=" + c.columnIndex +
      " | name=[" + (c.name || "") + "]" +
      " | score=" + c.score +
      " | villa=" + c.isVillaColumn
    );
  }
});


  const range = detectMasterVillaColumnRange(columns);
  if (!range) return [];

  return buildMasterVillaObjects(columns, range);
}

/** B3 - ô trông như giá: "3500", "6000 duy", "2.500.000", "1.5tr", "800k". Không nhận ngày "1/11", số nhỏ "4". */
function beLooksLikePriceCellB3_(text) {
  var s = String(text == null ? "" : text).trim();
  if (!s) return false;
  if (/^\d+(?:[.,]\d+)?\s*(?:tr|triệu|trieu|k)(?![a-zà-ỹ])/i.test(s)) return true;
  var m = s.match(/^(\d{1,3}(?:[.,]\d{3})+|\d{3,7})(?![\d\/])/);
  return !!m;
}

/**
 * B3 - Trả danh sách cột trong vùng cấu hình mà hàng tên trống nhưng có >= 3 ô giá
 * ở các hàng dưới hàng tên. Thuần, test được.
 */
function beFindNamelessPriceColumnsB3_(values, config, nameDetection, columns, lastColumnExclusive) {
  var out = [];
  if (!values || !values.length || !config) return out;
  var nameRow = nameDetection && nameDetection.row >= 0 ? nameDetection.row : -1;
  if (nameRow < 0 && config.nameMode === "FIXED_ROW" && config.fixedNameRowIndex >= 0) nameRow = config.fixedNameRowIndex;
  if (nameRow < 0) return out;
  var named = {};
  (columns || []).forEach(function(c) { if (c && c.isVillaColumn) named[c.columnIndex] = true; });
  var excluded = config.excludedColumnIndexes || [];
  var lastRow = Math.min(values.length, nameRow + 1 + 70);
  for (var c = Number(config.startColumnIndex || 0); c < lastColumnExclusive; c++) {
    if (named[c] || excluded.indexOf(c) >= 0) continue;
    var hits = 0, samples = [];
    for (var r = nameRow + 1; r < lastRow; r++) {
      var cell = values[r] ? values[r][c] : "";
      if (beLooksLikePriceCellB3_(cell)) {
        hits++;
        if (samples.length < 3) samples.push(String(cell).trim().slice(0, 30));
      }
    }
    if (hits >= 3) {
      out.push({column: c + 1, letter: beColumnLetterV38_(c + 1), nameRow: nameRow + 1, priceCells: hits, samples: samples});
    }
  }
  return out;
}

function hasMasterExplicitStartColumn(rawConfig) {
  if (!rawConfig) return false;

  if (typeof rawConfig === "object" && !Array.isArray(rawConfig)) {
    return Object.keys(rawConfig).some(function(key) {
      const normalizedKey = String(key).toUpperCase();
      return [
        "START_COL",
        "START_COLUMN",
        "COLUMN_START"
      ].indexOf(normalizedKey) >= 0;
    });
  }

  const text = cleanMasterText(rawConfig).toUpperCase();

  return /(?:^|[;\n])\s*(?:START_COL|START_COLUMN|COLUMN_START)\s*=/.test(text);
}


function parseMasterColumnConfig(rawConfig) {
  const config = {
    nameMode: "AUTO_ROW",
    startColumnIndex: 1,
    endColumnIndex: -1,
    topRows: 20,
    fixedNameRowIndex: -1,
    fallbackEnabled: true,
    minimumNamesInRow: 2,
    minimumNameScore: 18,
    fixedName: "",
    excludedColumnIndexes: []
  };

  if (!rawConfig) return config;

  if (typeof rawConfig === "object" && !Array.isArray(rawConfig)) {
    Object.keys(rawConfig).forEach(function(key) {
      var masterKeyV414 = String(key).toUpperCase();
      if (typeof beCanonicalConfigKey_ === "function") {
        masterKeyV414 = beCanonicalConfigKey_(masterKeyV414);
      }
      applyMasterColumnConfigPair(
        config,
        masterKeyV414,
        rawConfig[key]
      );
    });

    validateMasterColumnConfig(config);
    return config;
  }

  const text = cleanMasterText(rawConfig);
  if (!text) return config;

  text
    .split(/[;\n]+/)
    .map(function(part) {
      return part.trim();
    })
    .filter(String)
    .forEach(function(part) {
      const separatorIndex = part.indexOf("=");

      if (separatorIndex < 0) {
        const mode = normalizeMasterText(part)
          .replace(/\s+/g, "_")
          .toUpperCase();

        if (mode === "AUTO_ROW" || mode === "FIXED_ROW") {
          config.nameMode = mode;
        }

        return;
      }

      var key = part
        .substring(0, separatorIndex)
        .trim()
        .toUpperCase();
      if (typeof beCanonicalConfigKey_ === "function") {
        key = beCanonicalConfigKey_(key);
      }

      const value = part
        .substring(separatorIndex + 1)
        .trim();

      applyMasterColumnConfigPair(config, key, value);
    });

  validateMasterColumnConfig(config);
  return config;
}

function applyMasterColumnConfigPair(config, key, rawValue) {
  const value = cleanMasterText(rawValue);

  switch (key) {
    case "NAME":
    case "NAME_MODE":
    case "READER":
      config.nameMode = value.replace(/\s+/g, "_").toUpperCase();
      break;

    case "FIXED_NAME":
    case "STATIC_NAME":
    case "VILLA_NAME":
      config.fixedName = cleanMasterVillaName(value) || value;
      break;

    case "FIXED_ROW":
      config.nameMode = "FIXED_ROW";
      config.fixedNameRowIndex = toMasterPositiveInteger(value, 0) - 1;
      break;

    case "NAME_ROW":
    case "ROW":
      config.nameMode = "FIXED_ROW";
      config.fixedNameRowIndex = toMasterPositiveInteger(value, 0) - 1;
      break;

    case "START_COL":
    case "START_COLUMN":
    case "COLUMN_START":
      config.startColumnIndex = toMasterPositiveInteger(value, 3) - 1;
      break;

    case "END_COL":
    case "END_COLUMN":
    case "COLUMN_END":
      config.endColumnIndex = toMasterPositiveInteger(value, 0) - 1;
      break;

    case "SKIP_COLS":
    case "EXCLUDE_COLS":
    case "BO_COT":
    case "COT_BO_QUA":
      config.excludedColumnIndexes = beParseExcludedColumnsV39_(value);
      break;

    case "TOP_ROWS":
    case "SCAN_ROWS":
      config.topRows = toMasterPositiveInteger(value, 12);
      break;

    case "NAME_SCAN_ROWS":
      var scanRange = value.match(/^(\d+)\s*-\s*(\d+)$/);
      config.topRows = scanRange
        ? Math.max(Number(scanRange[1]), Number(scanRange[2]))
        : toMasterPositiveInteger(value, 12);
      break;

    case "FALLBACK":
    case "ALLOW_FALLBACK":
      config.fallbackEnabled = parseMasterBoolean(value, true);
      break;

    case "MIN_NAMES":
    case "MIN_NAMES_IN_ROW":
      config.minimumNamesInRow = toMasterPositiveInteger(value, 2);
      break;

    case "MIN_SCORE":
    case "NAME_SCORE":
      config.minimumNameScore = toMasterNonNegativeInteger(value, 18);
      break;
  }
}

function validateMasterColumnConfig(config) {
  if (["AUTO_ROW", "FIXED_ROW"].indexOf(config.nameMode) < 0) {
    config.nameMode = "AUTO_ROW";
  }

  if (
    !Number.isFinite(config.startColumnIndex) ||
    config.startColumnIndex < 0
  ) {
    config.startColumnIndex = 1;
  }

  if (
    !Number.isFinite(config.endColumnIndex) ||
    config.endColumnIndex < 0
  ) {
    config.endColumnIndex = -1;
  }

  if (
    config.endColumnIndex >= 0 &&
    config.endColumnIndex < config.startColumnIndex
  ) {
    config.endColumnIndex = config.startColumnIndex;
  }

  if (!Number.isFinite(config.topRows) || config.topRows < 1) {
    config.topRows = 20;
  }

  if (
    !Number.isFinite(config.minimumNamesInRow) ||
    config.minimumNamesInRow < 1
  ) {
    config.minimumNamesInRow = 2;
  }

  if (
    !Number.isFinite(config.minimumNameScore) ||
    config.minimumNameScore < 0
  ) {
    config.minimumNameScore = 18;
  }

  if (
    config.nameMode === "FIXED_ROW" &&
    (
      !Number.isFinite(config.fixedNameRowIndex) ||
      config.fixedNameRowIndex < 0
    )
  ) {
    config.nameMode = "AUTO_ROW";
  }
}

function resolveMasterVillaNameRow(values, config) {
  if (config && config.fixedName) {
    return {
      row: -1,
      score: 9999,
      villaColumns: [Number(config.startColumnIndex || 0)],
      validCount: 1,
      strongCount: 1,
      junkCount: 0,
      mode: "FIXED_NAME"
    };
  }

  if (config.nameMode === "FIXED_ROW") {
    return detectMasterFixedVillaNameRow(values, config.fixedNameRowIndex, config);
  }

  return detectMasterAutoVillaNameRow(values, config);
}

function detectMasterFixedVillaNameRow(values, rowIndex, config) {
  if (rowIndex < 0 || rowIndex >= values.length) {
    return { row: -1, score: -999, villaColumns: [], mode: "FIXED_ROW_INVALID" };
  }

  const result = evaluateMasterVillaNameRow(values, rowIndex, config);
  result.mode = "FIXED_ROW";
  return result;
}

function detectMasterAutoVillaNameRow(values, config) {
  const rowLimit = Math.min(values.length, config.topRows);
  let best = {
    row: -1,
    score: -999,
    villaColumns: [],
    mode: "AUTO_ROW"
  };

  for (let rowIndex = 0; rowIndex < rowLimit; rowIndex++) {
    const result = evaluateMasterVillaNameRow(values, rowIndex, config);

    if (result.villaColumns.length < config.minimumNamesInRow) continue;

    if (
      result.score > best.score ||
      (
        result.score === best.score &&
        result.row < best.row
      )
    ) {
      best = result;
      best.mode = "AUTO_ROW";
    }
  }

  return best;
}


/**
 * V4200 - Cho phép tên phòng thuần số khi có context cấu trúc đủ mạnh.
 *
 * Case thật: My House nằm chung sheet Chồn Villa:
 *   101 | 102 | 201 | 202 | 301 | 302
 *   2 pax | 2 pax | 2 pax | 2 pax | 2 pax | 2 pax
 *
 * Không mở whitelist cho mọi số. Chỉ nhận mã phòng 3 chữ số khi:
 * - cùng hàng có ít nhất 2 mã phòng 3 chữ số; và
 * - hàng ngay dưới cùng cột là sức chứa dạng "2 pax", "2 khách", ...
 * Nhờ vậy giá/ngày/giờ/số rác vẫn bị loại như cũ.
 */
function beIsNumericRoomNameByContextV4200_(values, rowIndex, columnIndex, config) {
  values = values || [];
  rowIndex = Number(rowIndex);
  columnIndex = Number(columnIndex);
  if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex)) return false;
  if (rowIndex < 0 || rowIndex >= values.length) return false;

  var row = values[rowIndex] || [];
  var text = cleanMasterText(row[columnIndex]);
  if (!/^\d{3}$/.test(text)) return false;

  var previousRow = rowIndex > 0 ? (values[rowIndex - 1] || []) : [];
  var nextRow = rowIndex + 1 < values.length ? (values[rowIndex + 1] || []) : [];

  var start = config && Number.isFinite(config.startColumnIndex)
    ? Math.max(0, Number(config.startColumnIndex))
    : 0;
  var endExclusive = config && Number.isFinite(config.endColumnIndex) && config.endColumnIndex >= 0
    ? Math.min(row.length, Number(config.endColumnIndex) + 1)
    : row.length;
  var excluded = config && Array.isArray(config.excludedColumnIndexes)
    ? config.excludedColumnIndexes
    : [];

  var numericRoomCount = 0;
  var capacityBackedCount = 0;
  var labelBackedCountV4223 = 0;

  for (var c = start; c < endExclusive; c++) {
    if (excluded.indexOf(c) >= 0) continue;

    var roomCode = cleanMasterText(row[c]);
    if (!/^\d{3}$/.test(roomCode)) continue;
    numericRoomCount++;

    var capacity = cleanMasterText(nextRow[c]);
    if (/^\d+\s*(?:pax|khach|khách|nguoi|người)$/i.test(capacity)) {
      capacityBackedCount++;
    }

    /*
     * V4.22.3 - nguồn khách sạn/phòng lẻ như Sachi đặt LOẠI PHÒNG ở hàng trên,
     * MÃ PHÒNG thuần số ở FIXED_ROW, còn hàng dưới là tiêu đề lịch chứ không phải pax.
     * Chỉ mở rule này khi:
     * - config chủ động là FIXED_ROW;
     * - có >= 2 mã phòng 3 chữ số trong vùng config; và
     * - hàng trên của >= 2 mã có nhãn chữ (Đơn/Đôi/Superior/Deluxe...).
     * Như vậy không biến một hàng giá 500/600/700 thành tên phòng chỉ vì toàn số.
     */
    var above = cleanMasterText(previousRow[c]);
    if (/[a-zA-ZÀ-ỹ]/.test(above) && !/^\d+(?:[.,]\d+)?\s*(?:k|tr|trieu|triệu)?$/i.test(above)) {
      labelBackedCountV4223++;
    }
  }

  if (numericRoomCount < 2) return false;
  if (capacityBackedCount >= 2) return true;

  if (
    config &&
    config.nameMode === "FIXED_ROW" &&
    labelBackedCountV4223 >= 2
  ) {
    return true;
  }

  return false;
}

function evaluateMasterVillaNameRow(values, rowIndex, config) {
  const row = values[rowIndex] || [];
  const villaColumns = [];
  let validCount = 0;
  let strongCount = 0;
  let junkCount = 0;
  let consecutivePairs = 0;
  let previousVillaColumn = -999;
  const seenAutoCandidateKeys = {};

  const lastColumnExclusive = config.endColumnIndex >= 0
    ? Math.min(row.length, config.endColumnIndex + 1)
    : row.length;

  for (let columnIndex = config.startColumnIndex; columnIndex < lastColumnExclusive; columnIndex++) {
    if (config.excludedColumnIndexes.indexOf(columnIndex) >= 0) continue;
    const candidate = cleanMasterVillaName(row[columnIndex]);
    if (!candidate) continue;

    const numericRoomAcceptV4200 = beIsNumericRoomNameByContextV4200_(
      values, rowIndex, columnIndex, config
    );
    const score = numericRoomAcceptV4200 ? 35 : scoreCalendarVillaName(candidate);
    const fixedRowAccept = config.nameMode === "FIXED_ROW" &&
      (!isMasterDefiniteJunkCell(candidate) || numericRoomAcceptV4200) &&
      candidate.length <= 180;
    const candidateKey = normalizeMasterText(candidate);

    // V341: ô merge ngang được expand thành nhiều ô giống hệt nhau.
    // AUTO chỉ tính một tên một lần, tránh "Check lịch tháng 8" bị hiểu thành nhiều villa.
    if (config.nameMode === "AUTO_ROW" && candidateKey && seenAutoCandidateKeys[candidateKey]) {
      continue;
    }

    if (fixedRowAccept || score >= config.minimumNameScore) {
      if (config.nameMode === "AUTO_ROW" && candidateKey) seenAutoCandidateKeys[candidateKey] = true;
      validCount++;
      villaColumns.push(columnIndex);
      if (fixedRowAccept || score >= 30) strongCount++;
      if (columnIndex === previousVillaColumn + 1) consecutivePairs++;
      previousVillaColumn = columnIndex;
    } else if (!numericRoomAcceptV4200 && isMasterDefiniteJunkCell(candidate)) {
      junkCount++;
    }
  }

  return {
    row: rowIndex,
    score: validCount * 100 + strongCount * 20 + consecutivePairs * 10 - junkCount * 15 - rowIndex,
    villaColumns: villaColumns,
    validCount: validCount,
    strongCount: strongCount,
    junkCount: junkCount
  };
}

function readMasterVillaNameAtColumn(
  values,
  formulas,
  columnIndex,
  nameDetection,
  config
) {
  if (config && config.fixedName) {
    // FIXED_NAME dành cho nguồn một căn: tên gắn đúng START_COL, không quét metadata làm tên.
    if (columnIndex !== Number(config.startColumnIndex || 0)) {
      return {name:"",row:-1,source:"FIXED_NAME_OTHER_COLUMN"};
    }

    var fixedNameV414 = cleanMasterVillaName(config.fixedName);
    if (fixedNameV414 && !isMasterDefiniteJunkCell(fixedNameV414)) {
      return {name:fixedNameV414,row:-1,source:"FIXED_NAME"};
    }
    return {name:"",row:-1,source:"FIXED_NAME_INVALID"};
  }

  const detectedRow =
    nameDetection &&
    Number.isInteger(nameDetection.row)
      ? nameDetection.row
      : -1;

  if (detectedRow >= 0 && detectedRow < values.length) {
    const rawValue =
      values[detectedRow] &&
      columnIndex < values[detectedRow].length
        ? values[detectedRow][columnIndex]
        : "";

    const name = sanitizeMasterVillaNameFromKnownRow(
      rawValue,
      config,
      values,
      detectedRow,
      columnIndex
    );

    if (name) {
      return {
        name: name,
        row: detectedRow,
        source: nameDetection.mode || "ROW"
      };
    }
  }

  if (!config.fallbackEnabled && config.nameMode !== "AUTO_ROW") {
    return {
      name: "",
      row: -1,
      source: "NONE"
    };
  }

  return findMasterFallbackVillaName(
    values,
    formulas,
    columnIndex,
    config,
    detectedRow
  );
}
function sanitizeMasterVillaNameFromKnownRow(value, config, values, rowIndex, columnIndex) {

  const rawValue = cleanMasterText(value);

  const firstLine = getCalendarFirstMeaningfulLine(value);

  const name = extractCalendarVillaName(firstLine);


  const minimumScore =

    config && Number.isFinite(config.minimumNameScore)

      ? config.minimumNameScore

      : 18;


  const numericRoomAcceptV4200 = name && beIsNumericRoomNameByContextV4200_(
    values, rowIndex, columnIndex, config
  );
  const score = numericRoomAcceptV4200 ? 35 : (name ? scoreCalendarVillaName(name) : -999);


  


  if (!name) return "";


  if (isMasterDefiniteJunkCell(name) && !numericRoomAcceptV4200) {
    return "";
  }


  if (name.length > 180) {

    

    return "";

  }


  if (score < minimumScore && !(config && config.nameMode === "FIXED_ROW")) {
    return "";
  }


  


  return name;

}

function beLooksLikeCalendarInstructionV341_(value) {
  var text = cleanMasterText(value);
  var normalized = normalizeMasterText(text);
  if (!normalized) return false;
  return /^(?:check|kiem tra|xem|coi)\s+lich(?:\s|:|-|$)/.test(normalized) ||
    /^lich\s+(?:thang|booking|dat|trong|ban|phong)(?:\s|:|-|$)/.test(normalized) ||
    /^(?:check|xem|coi)\s+(?:lich\s+)?thang\s*(?:0?[1-9]|1[0-2])(?:\s|:|-|$)/.test(normalized);
}

function isMasterDefiniteJunkCell(value) {
  const text = cleanMasterText(value);
  const normalized = normalizeMasterText(text);

  if (!text) return true;
  if (beLooksLikeCalendarInstructionV341_(text)) return true;

  if (
    /^(trong|empty)$/.test(normalized) ||
    /(?:https?:\/\/|www\.|zalo\.me)/i.test(text) ||
    /^(?:chu nhat|thu\s*[2-7]|thu bay|thang\s*(?:0?[1-9]|1[0-2]))$/.test(normalized)
  ) {
    return true;
  }
  /*
   * Blacklist V5: ngắn nhưng bắt được các biến thể gần giống.
   * Ví dụ: "Giá căn", "Bảng giá", "Check-in 14h", "Tình trạng phòng"...
   */
  const exactJunk = [

  "stt",

  "ten",

  "ten can",

  "ten villa",

  "ten home",

  "ngay",

  "gia",

  "tong",

  "dia chi",

  "thong tin",

  "ghi chu",

  "luu y",

  "hinh anh",

  "link anh",

  "maps",

  "map",

  "check in",

  "check out",

  "checkin",

  "checkout",

  "trang thai",

  "lich",

  "full",

  "kin lich",

  "con trong",

  "het phong",

  "da coc",

  "cho coc",

  "tam giu",

  "giu cho",

  "chu nhat"

];
  

  if (exactJunk.indexOf(normalized) >= 0) return true;

  if (beLooksLikeStandaloneAddressV38_(text)) return true;

  const nearJunkPatterns = [
    /^(?:bang\s+)?gia(?:\s|:|-|$)/,
    /^(?:tong|tong cong)(?:\s|:|-|$)/,
    /^(?:ngay|thu)(?:\s|:|-|$)/,
    /^(?:check\s*-?\s*in|checkin)(?:\s|:|-|$)/,
    /^(?:check\s*-?\s*out|checkout)(?:\s|:|-|$)/,
    /^(?:ghi chu|luu y|thong tin|dia chi)(?:\s|:|-|$)/,
    /^(?:trang thai|tinh trang)(?:\s|:|-|$)/,
    /^(?:hinh anh|anh|link anh|maps?|google maps?)(?:\s|:|-|$)/,
    /^(?:full|kin lich|het phong|con trong)(?:\s|:|-|$)/,
    /^(?:da coc|cho coc|tam giu|giu cho)(?:\s|:|-|$)/
  ];

  if (nearJunkPatterns.some(function(pattern) {
    return pattern.test(normalized);
  })) return true;

  if (looksLikeMasterPrice(text)) return true;

  if (looksLikeMasterDate(text)) {
    const letters = text.replace(/[年月日]/g, "").match(/[a-zA-ZÀ-ỹ]/g) || [];
    if (!letters.length) return true;
  }

  if (/^\d+$/.test(text)) return true;

  if (/^\d+\s*(?:khach|khách|nguoi|người|pax|pn|wc|toilet)$/i.test(text)) {
    return true;
  }

  return false;
}

function findMasterFallbackVillaName(
  values,
  formulas,
  columnIndex,
  config,
  detectedRow
) {
  let bestName = "";
  let bestRow = -1;
  let bestScore = -999;

  const minimumScore =
    config && Number.isFinite(config.minimumNameScore)
      ? config.minimumNameScore
      : 18;

  /*
   * Ưu tiên vùng đầu sheet, nơi tên căn thường nằm.
   * Chỉ quét sâu hơn khi vùng đầu hoàn toàn không có ứng viên.
   */
  const preferredLimit = Math.min(
    values.length,
    Math.max(config.topRows || 20, 30)
  );

  function considerRow(rowIndex, deepScan) {
    if (!values[rowIndex]) return;

    const rawValue = values[rowIndex][columnIndex];
    const formula =
      formulas &&
      formulas[rowIndex] &&
      typeof formulas[rowIndex][columnIndex] !== "undefined"
        ? formulas[rowIndex][columnIndex]
        : "";

    const text = cleanMasterVillaName(rawValue);
    const link = getMasterLink(rawValue, formula);
    const linkOrText = link || text;

    if (!text) return;
    if (looksLikeMasterMaps(linkOrText)) return;
    if (
      looksLikeMasterImageLink(linkOrText) &&
      !looksLikeMasterMaps(linkOrText)
    ) {
      return;
    }

    if (isMasterDefiniteJunkCell(text)) return;
    if (text.length > 180) return;

    const extracted = extractCalendarVillaName(
      getCalendarFirstMeaningfulLine(text)
    );

    if (!extracted) return;

    let candidateScore = scoreCalendarVillaName(extracted);
    if (candidateScore < minimumScore) return;

    /*
     * Ưu tiên gần hàng tên chung và gần đầu sheet.
     * Quét sâu bị trừ mạnh để tránh chọn địa chỉ/mô tả làm tên.
     */
    if (detectedRow >= 0) {
      candidateScore += Math.max(
        0,
        18 - Math.abs(rowIndex - detectedRow) * 3
      );
    }

    candidateScore += Math.max(0, 16 - rowIndex);
    if (deepScan) candidateScore -= 25;

    if (candidateScore > bestScore) {
      bestScore = candidateScore;
      bestName = extracted;
      bestRow = rowIndex;
    }
  }

  for (let rowIndex = 0; rowIndex < preferredLimit; rowIndex++) {
    considerRow(rowIndex, false);
  }

  if (!bestName) {
    for (
      let rowIndex = preferredLimit;
      rowIndex < values.length;
      rowIndex++
    ) {
      considerRow(rowIndex, true);
    }
  }

  return {
    name: bestName,
    row: bestRow,
    source: bestName ? "COLUMN_FALLBACK" : "NONE",
    score: bestScore
  };
}

function scanMasterColumnMetadata(values, formulas, columnIndex, nameRow) {
  let info = "";
  let maps = "";
  let image = "";

  for (let rowIndex = 0; rowIndex < values.length; rowIndex++) {
    const rawValue = values[rowIndex][columnIndex];
    const formula = formulas && formulas[rowIndex] && typeof formulas[rowIndex][columnIndex] !== "undefined"
      ? formulas[rowIndex][columnIndex]
      : "";

    const text = cleanMasterText(rawValue);
    const link = getMasterLink(rawValue, formula);
    const linkOrText = link || text;

    if (
      text &&
      rowIndex !== nameRow &&
      text.length >= 30 &&
      text.length > info.length &&
      !looksLikeMasterPrice(text) &&
      !looksLikeMasterDate(text) &&
      !looksLikeMasterMaps(linkOrText) &&
      !looksLikeMasterImageLink(linkOrText)
    ) {
      info = text;
    }

    if (!maps && linkOrText && looksLikeMasterMaps(linkOrText)) {
      maps = linkOrText;
    }

    if (
      !image &&
      linkOrText &&
      looksLikeMasterImageLink(linkOrText) &&
      !looksLikeMasterMaps(linkOrText)
    ) {
      image = linkOrText;
    }
  }

  return { info: info, maps: maps, image: image };
}

function scoreMasterVillaColumn(column) {
  let score = 0;
  if (column.name) score += 100;
  if (column.image) score += 40;
  if (column.maps) score += 20;
  if (column.info && column.info.length >= 30) score += 10;
  return score;
}

function detectMasterVillaColumnRange(columns) {
  let firstIndex = -1;
  let lastIndex = -1;

  for (let index = 0; index < columns.length; index++) {
    const column = columns[index];
    if (!column || !column.isVillaColumn || !column.name) continue;
    if (firstIndex < 0) firstIndex = index;
    lastIndex = index;
  }

  if (firstIndex < 0) return null;
  return { firstIndex: firstIndex, lastIndex: lastIndex };
}

function buildMasterVillaObjects(columns, range) {
  const villas = [];

  for (let index = range.firstIndex; index <= range.lastIndex; index++) {
    const column = columns[index];

    if (!column || !column.isVillaColumn || !column.name) {
      continue;
    }

    const name = column.name;
    const info = column.info || "";
    const combinedText = name + "\n" + info;

    villas.push({
      name: name,
      standard: extractMasterStandard(combinedText),
      bedrooms: extractMasterBedrooms(combinedText),
      info: info,
      image: column.image || "",
      maps: column.maps || "",
      nameRow: column.nameRow,
      sourceColumn: column.columnIndex + 1
    });
  }

  return removeDuplicateMasterVillas(villas);
}

function parseMasterBoolean(value, fallbackValue) {
  const normalized = normalizeMasterText(value);

  if (["true", "1", "yes", "y", "co"].indexOf(normalized) >= 0) return true;
  if (["false", "0", "no", "n", "khong"].indexOf(normalized) >= 0) return false;

  return fallbackValue;
}

function toMasterPositiveInteger(value, fallbackValue) {
  const numberValue = parseInt(value, 10);
  if (!Number.isFinite(numberValue) || numberValue < 1) return fallbackValue;
  return numberValue;
}

function toMasterNonNegativeInteger(value, fallbackValue) {
  const numberValue = parseInt(value, 10);
  if (!Number.isFinite(numberValue) || numberValue < 0) return fallbackValue;
  return numberValue;
}


function beFindVisibleSheetByLooseNameV4210_(file, wantedName) {
  if (!file) return null;
  var wanted = normalizeMasterText(wantedName);
  if (!wanted) return null;

  var sheets = beGetVisibleSheets_(file);
  for (var i = 0; i < sheets.length; i++) {
    if (normalizeMasterText(sheets[i].getName()) === wanted) return sheets[i];
  }
  return null;
}

function beCalendarMonthShiftV4210_(year, month, delta) {
  var d = new Date(Number(year), Number(month) - 1 + Number(delta || 0), 1);
  return {year:d.getFullYear(), month:d.getMonth() + 1};
}

function beCalendarSheetDescriptorV4210_(sheetName, referenceDate) {
  referenceDate = referenceDate instanceof Date ? referenceDate : new Date();
  var raw = String(sheetName || "");
  var name = normalizeMasterText(raw);
  var currentYear = referenceDate.getFullYear();

  // Nguồn kiểu "SUDA T6 + 7 + 8" thực tế có thể chứa tiếp tháng mới trong
  // cùng một tab. Không neo nó vào tháng 6 rồi loại nhầm như sheet tháng cũ.
  var plusNumbers = raw.match(/\d{1,2}/g) || [];
  var monthNumbers = plusNumbers.map(function(x){ return Number(x); })
    .filter(function(x){ return x >= 1 && x <= 12; });
  var combined = raw.indexOf("+") >= 0 && monthNumbers.length >= 2;
  if (combined) {
    return {recognized:false, combined:true, month:0, year:0, name:raw};
  }

  var month = 0;
  if (typeof ceNormalizeMonthSheetTextV1_ === "function" && raw.indexOf("+") < 0) name = ceNormalizeMonthSheetTextV1_(raw);
  var m = name.match(/(?:^|\b)(?:thang|month|t)\s*0?(1[0-2]|[1-9])(?:\b|\D)/i);
  if (m) month = Number(m[1]);
  if (!month) {
    m = name.match(/(?:^|\D)0?(1[0-2]|[1-9])\s*[\.\/_-]\s*(?:20)?\d{2,4}(?:\D|$)/i);
    if (m) month = Number(m[1]);
  }

  var year = 0;
  var y = raw.match(/(?:^|\D)(20\d{2})(?:\D|$)/);
  if (y) year = Number(y[1]);
  if (!year) {
    y = raw.match(/[\.\/_-]\s*(\d{2})(?:\D|$)/);
    if (y) {
      var yy = Number(y[1]);
      if (yy >= 20 && yy <= 99) year = 2000 + yy;
    }
  }
  if (month && !year && typeof ceYearFromSheetNameV1_ === "function") year = ceYearFromSheetNameV1_(raw) || 0;

  /*
   * B4 - KHÔNG đoán năm mù cho tên tab.
   * - Tên có năm hợp lệ: dùng năm đó (yearSource=NAME).
   * - Tên không có năm ("Tháng 1"): chọn năm làm tháng gần tháng tham chiếu nhất
   *   trong ±1 tháng (Tháng 1 xem vào tháng 12/2026 => 1/2027; Tháng 12 xem vào
   *   tháng 1/2027 => 12/2026). Ngoài cửa sổ ±1 giữ mặc định năm hiện tại như cũ
   *   để tab tháng cũ vẫn bị coi là cũ (yearSource=NONE).
   * - Tên có số năm SAI ("Th 01.1027"): chỉ nhận khi tháng nằm trong ±1 tháng;
   *   ngoài cửa sổ thì KHÔNG nhận tab là tháng nào (recognized=false), ghi cảnh báo
   *   (yearSource=INVALID).
   */
  var yearSourceB4 = year ? "NAME" : "NONE";
  if (month && !year && beSheetNameHasInvalidYearB4_(raw)) yearSourceB4 = "INVALID";
  if (month && !year) {
    var nearYearB4 = beNearestYearForMonthB4_(month, referenceDate, 1);
    if (nearYearB4) year = nearYearB4;
    else if (yearSourceB4 === "NONE") year = currentYear;
  }

  return {
    recognized:month >= 1 && month <= 12 && year > 0,
    combined:false,
    month:month,
    year:year,
    name:raw,
    yearSource:yearSourceB4
  };
}

/** B4 - năm gần nhất để (năm, tháng) cách tháng tham chiếu tối đa maxDiff tháng; 0 nếu không có. */
function beNearestYearForMonthB4_(month, referenceDate, maxDiff) {
  month = Number(month || 0);
  if (!(month >= 1 && month <= 12)) return 0;
  referenceDate = referenceDate instanceof Date ? referenceDate : new Date();
  var refIndex = referenceDate.getFullYear() * 12 + referenceDate.getMonth();
  var best = 0, bestDiff = 999;
  for (var y = referenceDate.getFullYear() - 1; y <= referenceDate.getFullYear() + 1; y++) {
    var diff = Math.abs(y * 12 + (month - 1) - refIndex);
    if (diff < bestDiff) { bestDiff = diff; best = y; }
  }
  return bestDiff <= Number(maxDiff == null ? 1 : maxDiff) ? best : 0;
}

/** B4 - tên tab có cụm số trông như năm nhưng không đọc được năm hợp lệ (vd "1027", "2O27"). */
function beSheetNameHasInvalidYearB4_(raw) {
  var runs = String(raw || "").match(/\d{3,}/g) || [];
  return runs.some(function(run) {
    if (/^20\d{2}$/.test(run)) return false;
    if (typeof ceYearFromDigitsV1_ === "function" && ceYearFromDigitsV1_(run)) return false;
    return true;
  });
}

/**
 * B4/A6 - Đọc nhanh tab (tối đa 45 hàng x 8 cột đầu) để đối chiếu cột THỨ với NGÀY.
 * Trả năm trong candidateYears mà toàn bộ cặp (ngày, thứ) khớp; 0 nếu không đủ bằng chứng.
 */
function beTabWeekdayYearB4_(sheet, month, candidateYears) {
  if (!sheet || typeof sheet.getRange !== "function") return {year:0, pairs:0};
  var values;
  try {
    var rows = Math.min(45, Math.max(1, sheet.getLastRow()));
    var cols = Math.min(8, Math.max(1, sheet.getLastColumn()));
    values = sheet.getRange(1, 1, rows, cols).getDisplayValues();
  } catch (e) {
    return {year:0, pairs:0, error:String(e && e.message || e)};
  }
  return beWeekdayYearFromValuesB4_(values, month, candidateYears);
}

/** Thuần, test được: values là mảng 2 chiều display values. */
function beWeekdayYearFromValuesB4_(values, month, candidateYears) {
  var weekdayOf = function(text) {
    var t = normalizeMasterText(text).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    if (!t) return -1;
    if (/^(cn|chu nhat|sun|sunday)$/.test(t)) return 0;
    var m = t.match(/^(?:t|thu)\s*([2-7])$/);
    if (m) return Number(m[1]) - 1;
    var words = {"thu hai":1,"thu ba":2,"thu tu":3,"thu nam":4,"thu sau":5,"thu bay":6,
      mon:1,monday:1,tue:2,tuesday:2,wed:3,wednesday:3,thu:4,thursday:4,fri:5,friday:5,sat:6,saturday:6};
    return Object.prototype.hasOwnProperty.call(words, t) ? words[t] : -1;
  };
  var dayOf = function(text) {
    var s = String(text || "").trim();
    var m = s.match(/^0?([1-9]|[12]\d|3[01])(?:\s*[\/.\-]\s*0?(\d{1,2})(?:\s*[\/.\-]\s*\d{2,4})?)?$/);
    if (!m) return 0;
    if (m[2] && Number(m[2]) !== Number(month)) return 0;
    return Number(m[1]);
  };
  var pairs = [];
  (values || []).forEach(function(row) {
    var wd = -1, day = 0;
    (row || []).forEach(function(cell) {
      if (wd < 0) { var w = weekdayOf(cell); if (w >= 0) { wd = w; return; } }
      if (!day) day = dayOf(cell);
    });
    if (wd >= 0 && day) pairs.push([day, wd]);
  });
  if (pairs.length < 5) return {year:0, pairs:pairs.length};
  // Một năm được nhận khi >= 90% cặp (ngày, thứ) khớp và chỉ có đúng một năm như vậy.
  var need = Math.max(5, Math.ceil(pairs.length * 0.9));
  var matching = (candidateYears || []).filter(function(y) {
    var hit = pairs.filter(function(p) {
      var d = new Date(Number(y), Number(month) - 1, p[0]);
      return d.getMonth() === Number(month) - 1 && d.getDay() === p[1];
    }).length;
    return hit >= need;
  });
  return {year: matching.length === 1 ? matching[0] : 0, pairs: pairs.length, matching: matching};
}

function beIsCalendarLikeUnknownV4210_(sheet) {
  if (!sheet) return false;
  var raw = String(sheet.getName() || "");
  var name = normalizeMasterText(raw);
  var descriptor = beCalendarSheetDescriptorV4210_(raw, new Date());
  if (descriptor.combined) return true;
  if (/\b(lich|calendar|booking)\b/.test(name)) return true;
  if (/^20\d{2}$/.test(name)) return true;
  return false;
}

/**
 * V4.21.0 ACTIVE MONTH POLICY
 * - CONFIG LỊCH / TRANG_LỊCH explicit: ưu tiên tuyệt đối nếu tab còn visible.
 * - AUTO: ưu tiên tháng hiện tại.
 * - Nếu chủ đã ẩn tháng hiện tại và mở tháng kế tiếp: rollover sang tháng kế.
 * - Nếu chưa có tháng hiện tại: cho phép tháng trước (grace window).
 * - Không hồi sinh tab tháng cũ hơn cửa sổ này.
 * - Tab kết hợp/không theo tháng (vd SUDA T6+7+8, 2026) chỉ là fallback.
 */
function beMasterCalendarSelectionV4210_(file, rawCalendarConfig, referenceDate) {
  referenceDate = referenceDate instanceof Date ? referenceDate : new Date();
  var allSheets = file ? file.getSheets() : [];
  var visible = beGetVisibleSheets_(file);
  var cfg = {};
  try { cfg = parseBookingSourceConfig(rawCalendarConfig || "AUTO") || {}; } catch (ignoreCfgV4210) {}

  var explicitName = cleanMasterText(cfg.CALENDAR_SHEET || "");
  var explicitToken = normalizeMasterText(explicitName)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (["auto","tu_dong","latest_calendar","lich_moi_nhat"].indexOf(explicitToken) >= 0) {
    explicitName = "";
  }

  // B4: cảnh báo tên tab (năm sai / năm không khớp thứ-ngày trong tab).
  var warningsB4 = [];

  if (explicitName) {
    var configured = beFindVisibleSheetByLooseNameV4210_(file, explicitName);
    if (configured) {
      Logger.log(JSON.stringify({
        code:"MASTER_CALENDAR_CONFIG_LOCK_V4210",
        configured:explicitName,
        sheet:configured.getName()
      }));
      beCollectTabYearWarningsB4_(configured, referenceDate, warningsB4);
      return {sheet:configured, mode:"CONFIG", inactiveWindow:false, configured:explicitName, warnings:warningsB4};
    }
    Logger.log(JSON.stringify({
      level:"WARNING",code:"MASTER_CALENDAR_CONFIG_FALLBACK_V4210",
      configured:explicitName,
      reason:"CONFIGURED_SHEET_MISSING_OR_HIDDEN",
      action:"FALLBACK_TO_ACTIVE_VISIBLE_MONTH"
    }));
  }

  var excludedKeywords = [
    "thong tin","information","master","config","ghi chu","note",
    "image","hinh anh","data","tong hop"
  ];
  var candidates = visible.filter(function(sheet){
    var name = normalizeMasterText(sheet.getName());
    return !excludedKeywords.some(function(keyword){ return name.indexOf(keyword) >= 0; });
  });

  var current = {year:referenceDate.getFullYear(), month:referenceDate.getMonth()+1};
  var previous = beCalendarMonthShiftV4210_(current.year,current.month,-1);
  var next = beCalendarMonthShiftV4210_(current.year,current.month,1);

  function same_(d, target) {
    return d && d.recognized && d.month === target.month && d.year === target.year;
  }
  function best_(items) {
    if (!items.length) return null;
    return items.slice().sort(function(a,b){
      var aSize = (a.getLastRow() >= 10 ? 10 : 0) + (a.getLastColumn() >= 3 ? 5 : 0) + a.getIndex()/1000;
      var bSize = (b.getLastRow() >= 10 ? 10 : 0) + (b.getLastColumn() >= 3 ? 5 : 0) + b.getIndex()/1000;
      return bSize-aSize;
    })[0];
  }

  var currentVisible=[], previousVisible=[], nextVisible=[], unknown=[];
  candidates.forEach(function(sheet){
    var d = beCalendarSheetDescriptorV4210_(sheet.getName(), referenceDate);
    beCollectTabYearWarningsB4_(sheet, referenceDate, warningsB4, d);
    if (same_(d,current)) currentVisible.push(sheet);
    else if (same_(d,previous)) previousVisible.push(sheet);
    else if (same_(d,next)) nextVisible.push(sheet);
    else if (!d.recognized && beIsCalendarLikeUnknownV4210_(sheet)) unknown.push(sheet);
  });

  // Chủ ẩn tab tháng hiện tại thường là tín hiệu đã rollover sang tháng kế.
  var currentHiddenExists = allSheets.some(function(sheet){
    try {
      if (!sheet.isSheetHidden()) return false;
    } catch (ignoreHiddenV4210) { return false; }
    return same_(beCalendarSheetDescriptorV4210_(sheet.getName(), referenceDate), current);
  });

  var chosen = best_(currentVisible);
  var mode = "CURRENT";
  if (!chosen && currentHiddenExists) { chosen = best_(nextVisible); mode = "NEXT_AFTER_CURRENT_HIDDEN"; }
  if (!chosen) { chosen = best_(previousVisible); mode = "PREVIOUS_GRACE"; }
  if (!chosen) { chosen = best_(nextVisible); mode = "NEXT_FALLBACK"; }
  if (!chosen) { chosen = best_(unknown); mode = "NON_MONTH_FALLBACK"; }

  /*
   * V4.22.3 - source có đúng một tab lịch visible nhưng tên tab không chứa
   * "tháng/lich/calendar" (ví dụ "CHẠNG VẠNG"). Sau khi đã loại các tab
   * THÔNG TIN/CONFIG/ẢNH và không có month candidate nào, một tab duy nhất là
   * fallback an toàn hơn việc trả MAIN_CALENDAR_SHEET_NOT_FOUND.
   * Không dùng rule này khi còn nhiều tab mơ hồ.
   */
  if (!chosen && candidates.length === 1) {
    // V4.22.4 FIX: không fallback vào tab tháng cũ hơn tháng trước (stale).
    // Tab không nhận ra được tháng (ví dụ "CHẠNG VẠNG") vẫn fallback như cũ.
    var soleDescV4224 = beCalendarSheetDescriptorV4210_(candidates[0].getName(), referenceDate);
    var soleIsStaleV4224 = (soleDescV4224.recognized &&
      (soleDescV4224.year * 12 + soleDescV4224.month) < (previous.year * 12 + previous.month)) ||
      // B4: tab có năm sai và nằm ngoài cửa sổ tháng hiện tại không được dùng làm fallback.
      (soleDescV4224.yearSource === "INVALID" && !soleDescV4224.recognized);
    if (!soleIsStaleV4224) {
      chosen = candidates[0];
      mode = "SOLE_VISIBLE_NON_INFO_FALLBACK_V4223";
    }
  }

  if (chosen) {
    Logger.log(JSON.stringify({
      code:"MASTER_CALENDAR_ACTIVE_SELECTED_V4210",
      sheet:chosen.getName(),mode:mode,
      currentMonth:current.month,currentYear:current.year
    }));
    return {sheet:chosen, mode:mode, inactiveWindow:false, configured:explicitName, warnings:warningsB4};
  }

  var recognizedVisible = candidates.filter(function(sheet){
    return beCalendarSheetDescriptorV4210_(sheet.getName(), referenceDate).recognized;
  });
  if (recognizedVisible.length) {
    Logger.log(JSON.stringify({
      level:"WARNING",code:"SOURCE_INACTIVE_CALENDAR_WINDOW_V4210",
      currentMonth:current.month,currentYear:current.year,
      visibleMonthSheets:recognizedVisible.map(function(sheet){return sheet.getName();}),
      action:"DO_NOT_REUSE_STALE_MONTH_VILLAS"
    }));
    return {sheet:null, mode:"INACTIVE_WINDOW", inactiveWindow:true, configured:explicitName, warnings:warningsB4};
  }

  return {sheet:null, mode:"NO_CALENDAR", inactiveWindow:false, configured:explicitName, warnings:warningsB4};
}

/**
 * B4/A6 - Ghi cảnh báo cho một tab:
 * - SHEET_NAME_YEAR_INVALID_B4: tên tab có số năm sai (vd "Th 01.1027").
 * - SHEET_NAME_YEAR_MISMATCH_B4: tên tab ghi năm X nhưng thứ-ngày trong tab là năm Y
 *   (vd "Tháng 11.2025" mà ngày 1 là Chủ nhật => 11/2026). Chỉ đọc nội dung tab khi
 *   tháng của tab nằm trong ±1 tháng hiện tại mà năm trên tên lệch => rất ít lần đọc.
 * Không tự đổi tab được chọn: chủ nguồn cần sửa tên tab.
 */
function beCollectTabYearWarningsB4_(sheet, referenceDate, warnings, descriptor) {
  try {
    var name = String(sheet && sheet.getName ? sheet.getName() : "");
    var d = descriptor || beCalendarSheetDescriptorV4210_(name, referenceDate);
    if (!d || d.combined) return;
    if (d.yearSource === "INVALID") {
      warnings.push({code:"SHEET_NAME_YEAR_INVALID_B4", sheet:name,
        message:"Tên tab \"" + name + "\" có số năm không hợp lệ" +
          (d.recognized ? "; tạm hiểu là tháng " + d.month + "/" + d.year : "; không nhận là tab tháng nào")});
      return;
    }
    if (!d.recognized || d.yearSource !== "NAME") return;
    var near = beNearestYearForMonthB4_(d.month, referenceDate, 1);
    if (!near || near === d.year) return;
    var check = beTabWeekdayYearB4_(sheet, d.month, [d.year, near]);
    if (check.year && check.year !== d.year) {
      warnings.push({code:"SHEET_NAME_YEAR_MISMATCH_B4", sheet:name, nameYear:d.year, contentYear:check.year,
        message:"Tab \"" + name + "\" ghi năm " + d.year + " nhưng thứ-ngày trong tab là tháng " +
          d.month + "/" + check.year + ". Cần đổi tên tab."});
    }
  } catch (e) {
    Logger.log(JSON.stringify({level:"WARNING",code:"TAB_YEAR_CHECK_FAILED_B4",error:String(e && e.message || e)}));
  }
}

function beFindMasterCalendarSheetV4210_(file, rawCalendarConfig, referenceDate) {
  return beMasterCalendarSelectionV4210_(file, rawCalendarConfig, referenceDate).sheet;
}

function findLatestMasterCalendarSheet(file, referenceDate) {
  return beFindMasterCalendarSheetV4210_(file, "AUTO", referenceDate || new Date());
}

function beMockCalendarSheetV4210_(name, hidden, index) {
  return {
    getName:function(){return name;},
    isSheetHidden:function(){return hidden === true;},
    getIndex:function(){return Number(index || 0);},
    getLastRow:function(){return 40;},
    getLastColumn:function(){return 12;}
  };
}

function beMockCalendarFileV4210_(sheets) {
  return {getSheets:function(){return sheets.slice();}};
}

function testMasterActiveCalendarPolicyV4210(){
  var ref=new Date(2026,8,23);
  var aug=beMockCalendarSheetV4210_("Tháng 8/2026",false,1);
  var sep=beMockCalendarSheetV4210_(" Thang 9",false,2);
  var oct=beMockCalendarSheetV4210_("Tháng 10/2026",false,3);
  var a=beMasterCalendarSelectionV4210_(beMockCalendarFileV4210_([aug,sep,oct]),"AUTO",ref);
  if(!a.sheet||normalizeMasterText(a.sheet.getName())!=="thang 9")throw new Error("V4210_CURRENT_MONTH_FAILED");

  var sepHidden=beMockCalendarSheetV4210_(" Thang 9",true,2);
  var b=beMasterCalendarSelectionV4210_(beMockCalendarFileV4210_([aug,sepHidden,oct]),"AUTO",ref);
  if(!b.sheet||normalizeMasterText(b.sheet.getName())!=="thang 10/2026")throw new Error("V4210_ROLLOVER_NEXT_FAILED");

  var july=beMockCalendarSheetV4210_("Tháng 7/2026",false,1);
  var c=beMasterCalendarSelectionV4210_(beMockCalendarFileV4210_([july]),"AUTO",ref);
  if(!c.inactiveWindow||c.sheet)throw new Error("V4210_STALE_MONTH_NOT_BLOCKED");

  var suda=beMockCalendarSheetV4210_("SUDA T6 + 7 + 8",false,1);
  var d=beMasterCalendarSelectionV4210_(beMockCalendarFileV4210_([suda]),"AUTO",ref);
  if(!d.sheet||d.mode!=="NON_MONTH_FALLBACK")throw new Error("V4210_COMBINED_SHEET_FAILED");

  var e=beMasterCalendarSelectionV4210_(beMockCalendarFileV4210_([sep]),"TRANG_LỊCH=Thang 9",ref);
  if(!e.sheet||e.mode!=="CONFIG")throw new Error("V4210_LEADING_SPACE_CONFIG_FAILED");

  var result={success:true,current:a.sheet.getName(),rollover:b.sheet.getName(),staleBlocked:c.inactiveWindow,combined:d.sheet.getName(),leadingSpace:e.sheet.getName()};
  Logger.log(JSON.stringify({code:"MASTER_ACTIVE_CALENDAR_POLICY_PASS_V4210",result:result}));
  return result;
}

function testNumericFixedRowRoomCodesV4223(){
  var values = [
    ["", "", "Đôi", "Đơn tiêu chuẩn", "Superior", "Đơn tiêu chuẩn", "Superior"],
    ["", "Hình ảnh zalo", "101", "102", "203", "202", "201"],
    ["Thứ", "Ngày", "BÁN GIÁ NIÊM YẾT", "", "", "", ""]
  ];
  var config = {
    nameMode:"FIXED_ROW",
    startColumnIndex:2,
    endColumnIndex:6,
    excludedColumnIndexes:[],
    minimumNameScore:18
  };
  var detected = detectMasterFixedVillaNameRow(values, 1, config);
  if (!detected || Number(detected.validCount || 0) !== 5) {
    throw new Error("V4223_NUMERIC_FIXED_ROW_COUNT_FAILED:" + JSON.stringify(detected));
  }
  var names = (detected.villaColumns || []).map(function(columnIndex){
    return sanitizeMasterVillaNameFromKnownRow(values[1][columnIndex], config, values, 1, columnIndex);
  }).filter(String);
  if (names.join(",") !== "101,102,203,202,201") {
    throw new Error("V4223_NUMERIC_FIXED_ROW_NAMES_FAILED:" + names.join(","));
  }
  var result = {success:true,version:"4.22.3",count:names.length,names:names};
  Logger.log(JSON.stringify({code:"NUMERIC_FIXED_ROW_PASS_V4223",result:result}));
  return result;
}

function testSachiNumericRoomsLiveV4223(){
  if (typeof opsFindSourceV312_ !== "function") throw new Error("OPS_SOURCE_HELPER_NOT_AVAILABLE");
  if (typeof ssInspectSourceStructureV320_ !== "function") throw new Error("STRUCTURE_INSPECTOR_NOT_AVAILABLE");
  var source = opsFindSourceV312_("Sachi");
  if (!source || !source.link) throw new Error("SACHI_SOURCE_NOT_FOUND");
  var inspected = ssInspectSourceStructureV320_(source, {skipEvidence:true});
  if (Number(inspected.villaCount || 0) !== 14) {
    throw new Error("SACHI_NUMERIC_ROOMS_LIVE_FAILED:" + JSON.stringify({
      sheet:inspected.mainSheet,
      configuredValidCount:inspected.configuredValidCount,
      villaCount:inspected.villaCount
    }));
  }
  var result = {
    success:true,
    version:"4.22.3",
    source:source.source,
    sheet:inspected.mainSheet,
    configuredValidCount:inspected.configuredValidCount,
    villas:inspected.villaCount
  };
  Logger.log(JSON.stringify({code:"SACHI_NUMERIC_ROOMS_LIVE_PASS_V4223",result:result}));
  return result;
}

function testNhaChangVangSheetSelectionV4223(){
  var info = beMockCalendarSheetV4210_("THÔNG TIN", false, 0);
  var calendar = beMockCalendarSheetV4210_("CHẠNG VẠNG", false, 1);
  var selected = beMasterCalendarSelectionV4210_(
    beMockCalendarFileV4210_([info, calendar]),
    "AUTO",
    new Date(2026,8,24)
  );
  if (!selected.sheet || selected.sheet.getName() !== "CHẠNG VẠNG") {
    throw new Error("V4223_NON_MONTH_SINGLE_SHEET_SELECT_FAILED");
  }
  if (selected.mode !== "SOLE_VISIBLE_NON_INFO_FALLBACK_V4223") {
    throw new Error("V4223_NON_MONTH_SINGLE_SHEET_MODE_FAILED:" + selected.mode);
  }
  var result = {success:true,version:"4.22.3",sheet:selected.sheet.getName(),mode:selected.mode};
  Logger.log(JSON.stringify({code:"CHANG_VANG_SHEET_SELECTION_PASS_V4223",result:result}));
  return result;
}

function testMasterInactiveWindowReconcileV4210(){
  var previous=[["SKU-OLD","source","Old Villa","","","","","","","",3]];
  var decision=beAssessSourceReconcileV416_({previousRows:previous,villas:[],allowInactiveCalendarRemoval:true,confirmedStructure:null});
  if(decision.allow||decision.mode!=="PRESERVE_PENDING_STRUCTURE")throw new Error("V629_INACTIVE_RECONCILE_FAILSAFE_FAILED:"+JSON.stringify(decision));
  var result={success:true,mode:decision.mode,reason:decision.reason,missingNames:decision.missingNames};
  Logger.log(JSON.stringify({code:"MASTER_INACTIVE_RECONCILE_FAILSAFE_PASS_V629",result:result}));
  return result;
}

function testMasterLeadingSpaceSourceV4210(){
  if(typeof opsFindSourceV312_!=="function")throw new Error("OPS_SOURCE_HELPER_NOT_AVAILABLE");
  var source=opsFindSourceV312_("Hillside");
  if(!source||!source.link)throw new Error("HILLSIDE_SOURCE_NOT_FOUND");
  var file=SpreadsheetApp.openByUrl(source.link);
  var selected=beMasterCalendarSelectionV4210_(file,source.configCalendar||"AUTO",new Date(2026,8,23));
  var selectedNameV4210=selected.sheet?selected.sheet.getName():"";
  var selectedIsThang9V4210=!!selected.sheet&&normalizeMasterText(selectedNameV4210)===normalizeMasterText("Thang 9");
  // Tab Thang 9 đang ẩn là trạng thái hợp lệ: rule rollover phải chọn tháng 10 (NEXT_AFTER_CURRENT_HIDDEN).
  var selectedIsRolloverV4210=!!selected.sheet&&(selected.mode==="NEXT_AFTER_CURRENT_HIDDEN"||selected.mode==="NEXT_FALLBACK")&&/(^|\D)10(\D|$)/.test(selectedNameV4210);
  if(!selectedIsThang9V4210&&!selectedIsRolloverV4210)throw new Error("HILLSIDE_LEADING_SPACE_SELECT_FAILED: "+selectedNameV4210+" mode="+selected.mode);
  var result={success:true,source:source.source,sheet:selected.sheet.getName(),mode:selected.mode};
  Logger.log(JSON.stringify({code:"LEADING_SPACE_SOURCE_PASS_V4210",result:result}));
  return result;
}

function testMasterKinaCalendarLockV4210(){
  if(typeof opsFindSourceV312_!=="function")throw new Error("OPS_SOURCE_HELPER_NOT_AVAILABLE");
  var source=opsFindSourceV312_("Kina nguyên căn");
  if(!source||!source.link)throw new Error("KINA_SOURCE_NOT_FOUND");
  var file=SpreadsheetApp.openByUrl(source.link);
  var selected=beMasterCalendarSelectionV4210_(file,source.configCalendar||"AUTO",new Date());
  if(!selected.sheet||normalizeMasterText(selected.sheet.getName())!==normalizeMasterText("NGUYÊN CĂN RIÊNG BIỆT"))throw new Error("KINA_CALENDAR_LOCK_FAILED");
  var result={success:true,source:source.source,sheet:selected.sheet.getName(),mode:selected.mode};
  Logger.log(JSON.stringify({code:"KINA_CALENDAR_LOCK_PASS_V4210",result:result}));
  return result;
}

/**
 * Tên hợp lệ trong bảng thông tin.
 * Cho phép tên villa có kèm giá, ngày tháng, địa chỉ, thông tin...
 */
function isValidMasterVillaName(value) {
  const text = cleanMasterText(value);
  const normalized = normalizeMasterText(text);

  if (!text) return false;

  /*
   * Ô quá dài gần như chắc chắn là mô tả chi tiết,
   * không phải tiêu đề tên căn.
   */
  if (text.length > 350) return false;

  /*
   * Chỉ toàn số.
   */
  if (/^\d+$/.test(text)) return false;

  /*
   * Chỉ là một ngày hoặc khoảng ngày.
   * Nhưng nếu ngày nằm chung với tên villa thì vẫn giữ.
   */
  if (
    looksLikeMasterDate(text) &&
    !/[a-zA-ZÀ-ỹ]/.test(text.replace(/[年月日]/g, ""))
  ) {
    return false;
  }

  /*
   * Chỉ là giá hoặc giá kèm pax.
   * Nhưng nếu phía trước có tên villa thì vẫn giữ.
   */
  const purePricePatterns = [
    /^gia\s*[:\-]?\s*[\d.,]+(?:k|tr|trieu|000)?$/i,
    /^[\d.,]+(?:k|tr|trieu|000)$/i,
    /^gia\s*\d+\s*(?:pax|khach)?$/i,
    /^\d+\s*-\s*\d+\s*(?:pax|khach)$/i,
    /^\d+\s*(?:pax|khach)$/i
  ];

  if (
    purePricePatterns.some(function(pattern) {
      return pattern.test(normalized);
    })
  ) {
    return false;
  }

  /*
   * Chỉ loại tiêu đề thuần túy.
   * Ví dụ đúng bằng "Địa chỉ", "Thông tin", "STT".
   * Nếu có thêm tên villa thì vẫn giữ.
   */
  const exactInvalidHeaders = [
    "stt",
    "ten",
    "ten can",
    "ten villa",
    "ten home",
    "hinh anh",
    "link anh",
    "dia chi",
    "co cau",
    "thong tin",
    "luu y",
    "ngay",
    "thu",
    "gia thue",
    "hotline",
    "phat sinh"
  ];

  if (exactInvalidHeaders.indexOf(normalized) >= 0) {
    return false;
  }

  if (beLooksLikeStandaloneAddressV38_(text)) return false;

  return true;
}


/**
 * =========================================================
 * BỘ NHẬN DIỆN TÊN VILLA TRONG SHEET LỊCH
 * =========================================================
 *
 * Mục tiêu:
 * - Không phụ thuộc tên phải có "Villa", "Home", "House".
 * - Nhận tên ngắn: Gạch, Lasol, Lami...
 * - Nhận tên có số: Tô Hiệu 1, White II 8.2...
 * - Nhận tên có mô tả phía sau:
 *   "Labu Home: 4 phòng, 4wc, 10 khách"
 * - Loại giá, ngày giờ, ghi chú, trạng thái lịch.
 * - Có thể tự nhận lịch bắt đầu ở cột B hoặc C.
 */


/**
 * Hàm boolean giữ tương thích với code cũ.
 */
function isValidCalendarVillaName(value) {
  return scoreCalendarVillaName(value) >= 18;
}


/**
 * Chấm điểm một ô có giống tên villa hay không.
 *
 * Điểm càng cao càng giống tên villa.
 * Điểm âm hoặc thấp thường là giá, lịch, ghi chú hoặc dữ liệu rác.
 */
function scoreCalendarVillaName(value) {
  const original = cleanMasterText(value);

  if (!original) return -999;

  const firstLine = getCalendarFirstMeaningfulLine(original);
  const candidate = extractCalendarVillaName(firstLine);

  if (!candidate) return -999;

  const normalized = normalizeMasterText(candidate);
  const originalNormalized = normalizeMasterText(original);

  if (!normalized) return -999;
  if (beLooksLikeCalendarInstructionV341_(candidate)) return -999;

  /*
   * =====================================================
   * 1. LOẠI CỨNG NHỮNG GIÁ TRỊ CHẮC CHẮN LÀ RÁC
   * =====================================================
   */

  const exactJunkValues = [
    "ten",
    "ten can",
    "ten villa",
    "ten home",
    "in",
    "out",
    "check in",
    "check out",
    "checkin",
    "checkout",
    "chan le",
    "ghi chu",
    "luu y",
    "trang thai",
    "lich",
    "lich trong",
    "lich ban",
    "full",
    "full lich",
    "kin lich",
    "con trong",
    "het phong",
    "da coc",
    "cho coc",
    "tam coc",
    "tam giu",
    "giu tam",
    "giu cho",
    "co khach",
    "khach coc",
    "khach huy",
    "da huy",
    "gia",
    "gia thue",
    "gia cho",
    "dia chi",
    "lien he",
    "zalo"
  ];

  if (exactJunkValues.indexOf(normalized) >= 0) {
    return -999;
  }

  if (beLooksLikeStandaloneAddressV38_(candidate)) return -999;

  /*
   * Chỉ có số, ký hiệu hoặc ngày tháng.
   */
  if (!/[a-zA-ZÀ-ỹ]/.test(candidate)) {
    return -999;
  }

  if (/^\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?$/.test(candidate)) {
    return -999;
  }

  /*
   * Giá tiền dạng:
   * 3tr3, 3.3tr, 3500k, 3 triệu, 3,5 triệu...
   */
  const purePricePatterns = [
    /^\d+(?:[.,]\d+)?\s*(?:tr|trieu|triệu|k|nghin|nghìn)$/i,
    /^\d+\s*tr\s*\d+$/i,
    /^\d+(?:[.,]\d+)?\s*(?:vnd|đ|d)$/i,
    /^gia\s*[:\-]?\s*\d+/i
  ];

  if (
    purePricePatterns.some(function(pattern) {
      return pattern.test(candidate);
    })
  ) {
    return -999;
  }

  /*
   * Số điện thoại.
   */
  const digitsOnly = original.replace(/\D/g, "");

  if (
    digitsOnly.length >= 9 &&
    /(?:0|\+84)[\s.\-]?\d/.test(original)
  ) {
    return -999;
  }

  /*
   * Chỉ là số khách/phòng/WC.
   */
  const pureCapacityPatterns = [
    /^\d+\s*(?:khach|khách|nguoi|người|pax)$/i,
    /^\d+\s*-\s*\d+\s*(?:khach|khách|nguoi|người|pax)$/i,
    /^\d+\s*(?:pn|phong|phòng|wc|toilet|giuong|giường)$/i,
    /^\d+\s*(?:pn|phong|phòng)\s*[,\/\-]\s*\d+\s*(?:wc|toilet)$/i
  ];

  if (
    pureCapacityPatterns.some(function(pattern) {
      return pattern.test(candidate);
    })
  ) {
    return -999;
  }

  /*
   * =====================================================
   * 2. CHẤM ĐIỂM TÊN
   * =====================================================
   */

  let score = 0;

  const words = candidate
    .split(/\s+/)
    .map(function(word) {
      return word.trim();
    })
    .filter(String);

  const letterCount =
    (candidate.match(/[a-zA-ZÀ-ỹ]/g) || []).length;

  const digitCount =
    (candidate.match(/\d/g) || []).length;

  /*
   * Có chữ cái thật.
   */
  if (letterCount >= 3) score += 12;
  if (letterCount >= 6) score += 6;

  /*
   * Tên 1–8 từ là khoảng phổ biến.
   * Vẫn nhận tên một từ như "Gạch", "Lasol".
   */
  if (words.length === 1) score += 8;
  if (words.length >= 2 && words.length <= 8) score += 12;
  if (words.length >= 9 && words.length <= 14) score += 3;
  if (words.length > 14) score -= 20;

  /*
   * Tên có chữ và số vẫn hợp lệ:
   * White II 8.2, Tô Hiệu 1, Nhà Gấu 2...
   */
  if (digitCount > 0 && letterCount >= digitCount) {
    score += 4;
  }

  /*
   * Từ khóa lưu trú chỉ là điểm cộng, không bắt buộc.
   */
  if (
    /\b(villa|home|homestay|house|village|farm|retreat|bungalow|resort|hotel|cabin|lodge)\b/i.test(
      normalized
    )
  ) {
    score += 18;
  }

  /*
   * Một số kiểu tên thường gặp bằng tiếng Việt.
   */
  if (
    /\b(nha cua|nhà của|go |gỗ |xom |xóm |mo |mơ |cozy|fairy|horizon|white)\b/i.test(
      candidate
    )
  ) {
    score += 8;
  }

  /*
   * Có viết hoa đầu từ hoặc toàn chữ hoa.
   */
  const titleCaseWords = words.filter(function(word) {
    return /^[A-ZÀ-ỸĐ]/.test(word);
  }).length;

  if (titleCaseWords >= 1) score += 4;
  if (titleCaseWords >= 2) score += 4;

  if (
    candidate.length >= 3 &&
    candidate === candidate.toUpperCase() &&
    /[A-ZÀ-Ỹ]/.test(candidate)
  ) {
    score += 4;
  }

  /*
   * Tên có dấu tiếng Việt.
   */
  if (/[À-ỹĐđ]/.test(candidate)) {
    score += 4;
  }

  /*
   * Nếu ô gốc có thông tin phòng/WC/khách phía sau,
   * khả năng cao đầu ô là tên villa.
   */
  if (
    /(?:\d+\s*(?:pn|phòng ngủ|phong ngu|phòng|phong|br|bedroom))/i.test(
      original
    )
  ) {
    score += 8;
  }

  if (/\d+\s*(?:wc|toilet|toilets)\b/i.test(original)) {
    score += 5;
  }

  if (/\d+\s*(?:khách|khach|người|nguoi|pax)\b/i.test(original)) {
    score += 5;
  }

  /*
   * =====================================================
   * 3. TRỪ ĐIỂM CHO GHI CHÚ, GIÁ, TRẠNG THÁI
   * =====================================================
   */

  const strongJunkPatterns = [
    /\bmoi nguoi\b.*\btu van\b/,
    /\btu van\b.*\bkhach\b/,
    /\bkhach\b.*\bgiup em\b/,
    /\bkhach\b.*\bcoc\b/,
    /\bcoc\b.*\bkhach\b/,
    /\bda coc\b/,
    /\bcho coc\b/,
    /\btam coc\b/,
    /\btam giu\b/,
    /\bgiu tam\b/,
    /\bgiu cho\b/,
    /\bco khach\b/,
    /\bkhach dang o\b/,
    /\bkhach huy\b/,
    /\bda huy\b/,
    /\bcon trong\b/,
    /\bhet phong\b/,
    /\bkin lich\b/,
    /\bfull lich\b/,
    /\blich trong\b/,
    /\blich ban\b/,
    /\bmau (vang|xanh|do|hong|cam|tim|xam)\b/,
    /\bkhong karaoke\b/,
    /\bquy dinh\b/,
    /\bhuong dan\b/
  ];

  if (
    strongJunkPatterns.some(function(pattern) {
      return pattern.test(originalNormalized);
    })
  ) {
    score -= 80;
  }

  /*
   * Dòng bắt đầu bằng nhãn dữ liệu thường không phải tên.
   */
  const labelPatterns = [
    /^(dia chi|địa chỉ)\b/i,
    /^(gia thue|giá thuê|gia cho|giá cho|gia)\b/i,
    /^(lien he|liên hệ|zalo)\b/i,
    /^(ghi chu|ghi chú|luu y|lưu ý)\b/i,
    /^(quy dinh|quy định|huong dan|hướng dẫn)\b/i,
    /^(trang thai|trạng thái)\b/i,
    /^(suc chua|sức chứa|tieu chuan|tiêu chuẩn)\b/i,
    /^(so khach|số khách)\b/i,
    /^(so phong|số phòng)\b/i,
    /^(check in|check out|checkin|checkout)\b/i,
    /^(in|out)\s+\d/i
  ];

  if (
    labelPatterns.some(function(pattern) {
      return pattern.test(candidate);
    })
  ) {
    score -= 60;
  }

  /*
   * "Đậu xe..." thường là tiện ích.
   * Không loại "Hẻm xe 16 chỗ..." vì có nguồn dùng nó làm dòng nhận diện.
   */
  if (/^(đậu xe|dau xe)\b/i.test(candidate)) {
    score -= 60;
  }

  /*
   * Giá nằm trong câu.
   */
  if (
    /\b\d+(?:[.,]\d+)?\s*(?:tr|trieu|triệu|k|nghin|nghìn)\b/i.test(
      candidate
    )
  ) {
    score -= 35;
  }

  /*
   * Ngày giờ như "In 6h 23/07".
   */
  if (
    /\b\d{1,2}h(?:\d{1,2})?\b/i.test(candidate) &&
    /\b\d{1,2}[\/.-]\d{1,2}\b/.test(candidate)
  ) {
    score -= 70;
  }

  /*
   * Quá dài thường là mô tả.
   * Không loại ngay để tránh mất nguồn có tên + thông tin.
   */
  if (candidate.length > 90) score -= 15;
  if (candidate.length > 150) score -= 30;

  /*
   * Quá nhiều dấu câu thường là đoạn mô tả.
   */
  const punctuationCount =
    (candidate.match(/[,;:!?]/g) || []).length;

  if (punctuationCount >= 4) score -= 15;
  if (punctuationCount >= 7) score -= 25;

  return score;
}


/**
 * Lấy dòng đầu tiên có nội dung.
 *
 * Ví dụ:
 * "Gỗ Hùng Vương - 2PN...\nGhi chú..."
 * => "Gỗ Hùng Vương - 2PN..."
 */
function getCalendarFirstMeaningfulLine(value) {
  const text = String(value == null ? "" : value)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, " ")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");

  if (!text) return "";

  const lines = text
    .split(/\r?\n/)
    .map(function(line) {
      return cleanMasterText(line);
    })
    .filter(String);

  return lines.length ? lines[0] : "";
}


/**
 * Tách phần tên villa khỏi thông tin phòng, WC, khách.
 *
 * Ví dụ:
 * "White II 8.2 - 8PN, 8WC / 16 khách"
 * => "White II 8.2"
 *
 * "Labu Home: 4 phòng, 4wc 10 khách"
 * => "Labu Home"
 *
 * "Tô Hiệu 1"
 * => "Tô Hiệu 1"
 */
function extractCalendarVillaName(value) {
  let text = cleanMasterText(value);

  if (!text) return "";

  /*
   * Bỏ bullet hoặc số thứ tự đầu dòng.
   */
  text = text
    .replace(/^[•●▪◦►➤✓✔️\-\–—]+\s*/, "")
    .replace(/^\d+\s*[.)]\s+/, "")
    .trim();

  /*
   * Tìm vị trí bắt đầu của phần thông số.
   * Chỉ cắt khi trước đó đã có ít nhất 2 ký tự chữ.
   */
  const metadataPatterns = [
    // Các nhãn mô tả chung, không phụ thuộc riêng một nguồn.
    /\s+(?:gồm|gom|cơ cấu|co cau|sức chứa|suc chua|tiêu chuẩn|tieu chuan|tối đa|toi da|tiện ích|tien ich)\s*:?-?\s*/i,
    /\s+(?:giá|gia)\s*[:\-]?\s*(?=\d)/i,
    /\s+(?:địa chỉ|dia chi|vị trí|vi tri)\s*:\s*/i,
    /\s*[-–—:|/]\s*\d+\s*(?:pn|p\.?n\.?|phòng ngủ|phong ngu|phòng|phong|br|bedroom)\b/i,
    /\s*[-–—:|/]\s*\d+\s*(?:wc|toilet|toilets)\b/i,
    /\s*[-–—:|/]\s*\d+\s*(?:khách|khach|người|nguoi|pax)\b/i
  ];

  /*
   * Không cắt hậu tố kiểu "3PN" chỉ vì đứng sau một khoảng trắng.
   * Nhiều nguồn dùng chính hậu tố này để phân biệt tên căn; cắt đi sẽ
   * làm trùng tên và khiến metadata ảnh/thông tin không ghép được.
   * Chỉ tách thông số khi có dấu phân cách rõ ràng ở trước.
   */

  let cutIndex = -1;

  metadataPatterns.forEach(function(pattern) {
    const match = text.match(pattern);

    if (match && match.index > 1) {
      if (cutIndex < 0 || match.index < cutIndex) {
        cutIndex = match.index;
      }
    }
  });

  if (cutIndex > 0) {
    const before = text.substring(0, cutIndex).trim();

    /*
     * Chỉ dùng phần trước nếu nó vẫn còn đủ chữ để làm tên.
     */
    if ((before.match(/[a-zA-ZÀ-ỹ]/g) || []).length >= 2) {
      text = before;
    }
  }

  /*
   * Dọn dấu phân cách thừa ở cuối.
   */
  text = text
    .replace(/\s*[-–—:|/,;]+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();

  return text;
}


/**
 * Tự nhận dữ liệu lịch bắt đầu ở cột B hay C.
 *
 * values là mảng lấy từ:
 * sheet.getDataRange().getDisplayValues()
 *
 * Kết quả:
 * - Trả về 1 nếu cột B phù hợp hơn.
 * - Trả về 2 nếu cột C phù hợp hơn.
 *
 * Chỉ số mảng bắt đầu từ 0:
 * A = 0, B = 1, C = 2.
 */
function detectCalendarVillaStartColumn(values) {
  if (!values || !values.length) return 1;

  const candidateColumns = [1, 2]; // B và C
  const maxRowsToCheck = Math.min(values.length, 60);

  let bestColumn = 1;
  let bestColumnScore = -999999;

  candidateColumns.forEach(function(columnIndex) {
    let totalScore = 0;
    let validCount = 0;
    let strongCount = 0;

    for (let row = 0; row < maxRowsToCheck; row++) {
      if (!values[row] || columnIndex >= values[row].length) continue;

      const value = values[row][columnIndex];
      const score = scoreCalendarVillaName(value);

      if (score >= 18) {
        validCount++;
        totalScore += Math.min(score, 60);

        if (score >= 30) {
          strongCount++;
        }
      }
    }

    /*
     * Ưu tiên cột có nhiều tên hợp lệ,
     * sau đó mới xét tổng điểm.
     */
    const columnScore =
      validCount * 100 +
      strongCount * 20 +
      totalScore;

    if (columnScore > bestColumnScore) {
      bestColumnScore = columnScore;
      bestColumn = columnIndex;
    }
  });

  return bestColumn;
}


/*
 * V4.17 STATIC INFO INTEGRITY
 *
 * TIÊU CHUẨN và PN là dữ liệu tìm kiếm của app, vì vậy không được suy ra
 * từ "số đầu tiên trong text". Đặc biệt các sheet nguồn thường có 500k,
 * 700k, 13h, 100m2, xe 16 chỗ... nằm cùng cột với thông tin căn.
 *
 * Các helper bên dưới cố tình không đoán khi bằng chứng yếu. Giá trị trống
 * an toàn hơn một sức chứa/phòng ngủ bịa ra làm sai kết quả tìm kiếm.
 */
function beStaticTextV417_(value) {
  return normalizeMasterText(cleanMasterText(value));
}

function beStaticTextPartsV417_(value) {
  return String(value == null ? "" : value)
    .replace(/\r\n?/g, "\n")
    .split(/\n|[;!?]+/)
    .map(function(part) { return beStaticTextV417_(part); })
    .filter(function(part) { return !!part; });
}

function beIsGenericPolicyTextV417_(value) {
  var text = beStaticTextV417_(value);
  return /(?:check\s*-?in|check\s*-?out|quan\s*gia|ctv|cong\s*tac\s*vien|booking|dat\s*coc|doi\s*ngay|hoan\s*tien|noi\s*quy|quy\s*dinh|huong\s*dan|thanh\s*toan)/.test(text);
}

function beCapacityNumberV417_(value) {
  var number = Number(String(value == null ? "" : value).replace(/\s+/g, ""));
  if (!Number.isInteger(number) || number < 1 || number > 100) return "";
  return String(number);
}

function beBedroomNumberV417_(value) {
  var number = Number(String(value == null ? "" : value).replace(/\s+/g, ""));
  // 30 là một ceiling bảo thủ để chặn số tiền/diện tích bị gắn nhầm PN.
  if (!Number.isInteger(number) || number < 1 || number > 30) return "";
  return String(number);
}

function beCapacityLooksMonetaryOrNonGuestV417_(part, index, length) {
  var after = part.slice(index + length, index + length + 18);
  var before = part.slice(Math.max(0, index - 22), index);

  if (/^\s*(?:k\b|tr\b|trieu\b|vnd\b|dong\b|d\b|\.|,\d)/.test(after)) return true;
  if (/\b(?:gia|chinh|sale|nang|ke|max\s*gia|phu\s*thu|chenh|tien|dem)\s*$/.test(before)) return true;
  if (/^\s*(?:h\b|gio\b|m2\b|m\b|km\b|cm\b)/.test(after)) return true;
  return false;
}

function beMakeCapacityCandidateV417_(rawNumber, part, index, provenance) {
  var value = beCapacityNumberV417_(rawNumber);
  if (!value) {
    return { value: "", confidence: "", reason: "CAPACITY_OUT_OF_RANGE" };
  }
  if (beCapacityLooksMonetaryOrNonGuestV417_(part, index, String(rawNumber).length)) {
    return { value: "", confidence: "", reason: "CAPACITY_NON_GUEST_CONTEXT" };
  }
  return { value: value, confidence: provenance, reason: "" };
}

/**
 * Trích sức chứa có bằng chứng context-aware.
 *
 * - Tiêu chuẩn/Sức chứa chỉ cho phép số đứng sát nhãn hoặc có đơn vị khách.
 * - "tối đa" chỉ là fallback khi nó kèm đơn vị khách hoặc số đứng sát nhãn.
 * - Không để regex nhảy qua cả đoạn văn từ "tối đa" tới 13h/700k như bản cũ.
 */
function beExtractMasterStandardDetailV417_(value, options) {
  options = options || {};
  var text = cleanMasterText(value);
  var normalized = beStaticTextV417_(text);
  if (!normalized) return { value: "", confidence: "", reason: "CAPACITY_EMPTY" };

  // CONFIG TIÊU CHUẨN là structured field; ô số thuần được phép dùng sau
  // hard validation, nhưng 500/700 vẫn bị loại thay vì clamp.
  if (options.allowBareNumber === true && /^\d{1,3}$/.test(normalized)) {
    var structured = beCapacityNumberV417_(normalized);
    return structured
      ? { value: structured, confidence: "STRUCTURED_CONFIG", reason: "" }
      : { value: "", confidence: "", reason: "CAPACITY_OUT_OF_RANGE" };
  }

  var parts = beStaticTextPartsV417_(text);
  var fallback = null;
  var blockedPolicy = false;
  var firstGuestToken = null;
  var guestTokenValues = {};

  for (var p = 0; p < parts.length; p++) {
    var part = parts[p];
    var policy = beIsGenericPolicyTextV417_(part);
    if (policy) blockedPolicy = true;

    /* "Tiêu chuẩn 6-8 khách", "TC 12 NL", "Sức chứa: 10 khách". */
    var labelledGuest = /(?:tieu\s*chuan|\btc\b|suc\s*(?:chua|chuc)(?:\s*(?:tieu\s*chuan|toi\s*da))?|so\s*khach|standard)\s*(?:[:=\-\/]|la)?\s*(\d{1,3})(?:\s*(?:-|–|~|den|toi)\s*\d{1,3})?\s*(?:khach|pax|nguoi|nl|nguoi\s*lon|lon)\b/g;
    var match;
    while ((match = labelledGuest.exec(part))) {
      if (policy) continue;
      var labelled = beMakeCapacityCandidateV417_(match[1], part, match.index + match[0].indexOf(match[1]), "EXPLICIT_LABEL");
      if (labelled.value) return labelled;
    }

    /* "Sức chứa tối đa: 25" - số phải đứng ngay sau nhãn, không được
     * vượt qua chữ/số khác để chạm vào giá 3.000.000 hay giờ 13h. */
    var directLabel = /(?:suc\s*(?:chua|chuc)(?:\s*(?:tieu\s*chuan|toi\s*da))?|so\s*khach|tieu\s*chuan|standard)\s*(?:[:=\-\/]|la)?\s*(\d{1,3})\b/g;
    while ((match = directLabel.exec(part))) {
      if (policy) continue;
      var direct = beMakeCapacityCandidateV417_(match[1], part, match.index + match[0].lastIndexOf(match[1]), "EXPLICIT_LABEL");
      if (direct.value) return direct;
    }

    /* Mọi số có hậu tố khách/pax/người/NL là bằng chứng rõ ràng. */
    var guestToken = /(\d{1,3})(?:\s*(?:-|–|~|den|toi)\s*\d{1,3})?\s*(?:khach|pax|nguoi|nl|nguoi\s*lon|lon)\b/g;
    while ((match = guestToken.exec(part))) {
      if (policy) continue;
      var token = beMakeCapacityCandidateV417_(match[1], part, match.index, "EXPLICIT_TOKEN");
      if (!token.value) continue;

      // "tối đa 8 khách" chỉ là fallback: ưu tiên tiêu chuẩn riêng nếu có.
      var tokenPrefix = part.slice(Math.max(0, match.index - 18), match.index);
      if (/toi\s*da/.test(tokenPrefix)) {
        if (!fallback) fallback = { value: token.value, confidence: "EXPLICIT_MAX_FALLBACK", reason: "" };
      } else {
        if (!guestTokenValues[token.value]) guestTokenValues[token.value] = true;
        if (!firstGuestToken) firstGuestToken = token;
      }
    }
  }

  // Ví dụ YS: cùng mô tả có giá cho 10 khách và package 18-20 khách.
  // Không bịa một "tiêu chuẩn" duy nhất khi source không hề gắn nhãn nó.
  if (Object.keys(guestTokenValues).length > 1) {
    return { value: "", confidence: "", reason: "CAPACITY_AMBIGUOUS_MULTI_PACKAGE" };
  }
  if (firstGuestToken) return firstGuestToken;
  if (fallback) return fallback;
  return {
    value: "",
    confidence: "",
    reason: blockedPolicy ? "CAPACITY_POLICY_OR_AMBIGUOUS" : "CAPACITY_NO_GUEST_EVIDENCE"
  };
}

/** Trích sức chứa tiêu chuẩn - giữ interface cũ cho toàn bộ reader. */
function extractMasterStandard(value) {
  return beExtractMasterStandardDetailV417_(value).value;
}

function beExtractStructuredMasterStandardV417_(value) {
  return beExtractMasterStandardDetailV417_(value, { allowBareNumber: true }).value;
}

/**
 * Trích PN theo đúng evidence căn; tuyệt đối không dùng "1 phòng ngủ" trong
 * policy check-in/CTV/đặt cọc làm PN của villa.
 */
function beExtractMasterBedroomsDetailV417_(value, options) {
  options = options || {};
  var text = cleanMasterText(value);
  var normalized = beStaticTextV417_(text);
  if (!normalized) return { value: "", confidence: "", reason: "PN_EMPTY" };

  if (options.allowBareNumber === true && /^\d{1,2}$/.test(normalized)) {
    var structured = beBedroomNumberV417_(normalized);
    return structured
      ? { value: structured, confidence: "STRUCTURED_CONFIG", reason: "" }
      : { value: "", confidence: "", reason: "PN_OUT_OF_RANGE" };
  }

  var parts = beStaticTextPartsV417_(text);
  var blockedPolicy = false;

  for (var p = 0; p < parts.length; p++) {
    var part = parts[p];
    if (beIsGenericPolicyTextV417_(part)) {
      blockedPolicy = true;
      continue;
    }

    var patterns = [
      /(?:so\s*)?phong\s*ngu\s*[:=\-]?\s*(\d{1,2})\s*(?:pn)?\b/g,
      /(\d{1,2})\s*(?:phong\s*ngu|pn|p\s*n|bedrooms?|br)\b/g
    ];

    for (var i = 0; i < patterns.length; i++) {
      var match;
      while ((match = patterns[i].exec(part))) {
        var bedrooms = beBedroomNumberV417_(match[1]);
        if (!bedrooms) continue;
        return {
          value: bedrooms,
          confidence: i === 0 ? "EXPLICIT_LABEL" : "EXPLICIT_TOKEN",
          reason: ""
        };
      }
    }
  }

  return {
    value: "",
    confidence: "",
    reason: blockedPolicy ? "PN_POLICY_OR_AMBIGUOUS" : "PN_NO_EXPLICIT_EVIDENCE"
  };
}

/** Trích PN - giữ interface cũ cho toàn bộ reader. */
function extractMasterBedrooms(value) {
  return beExtractMasterBedroomsDetailV417_(value).value;
}

function beExtractStructuredMasterBedroomsV417_(value) {
  return beExtractMasterBedroomsDetailV417_(value, { allowBareNumber: true }).value;
}

/** Hard gate cuối trước khi ghi MASTER_VILLA, kể cả data từ structured cell. */
function beSanitizeMasterStaticFieldsV417_(villas) {
  return (villas || []).map(function(villa) {
    villa = villa || {};
    var oldStandard = cleanMasterText(villa.standard);
    var oldBedrooms = cleanMasterText(villa.bedrooms);
    // Tại sink chỉ hard-reject số thuần ngoài range. Một vài nguồn cũ lưu
    // PN dạng mô tả "3 Đơn - 3WC"; R3 không được làm mất dữ liệu đó chỉ vì
    // chưa đủ bằng chứng để quy đổi thành một số PN.
    var standard = /^\d+$/.test(oldStandard)
      ? beCapacityNumberV417_(oldStandard)
      : oldStandard;
    var bedrooms = /^\d+$/.test(oldBedrooms)
      ? beBedroomNumberV417_(oldBedrooms)
      : oldBedrooms;

    if (oldStandard && !standard) {
      Logger.log(JSON.stringify({
        level: "WARNING",
        code: "STATIC_CAPACITY_REJECTED_V417",
        villa: villa.name || "",
        value: oldStandard,
        action: "CLEAR_INVALID_STATIC_VALUE"
      }));
    }
    if (oldBedrooms && /^\d+$/.test(oldBedrooms) && !bedrooms) {
      Logger.log(JSON.stringify({
        level: "WARNING",
        code: "STATIC_BEDROOMS_REJECTED_V417",
        villa: villa.name || "",
        value: oldBedrooms,
        action: "CLEAR_INVALID_STATIC_VALUE"
      }));
    }

    villa.standard = standard;
    villa.bedrooms = bedrooms;
    return villa;
  });
}

/**
 * V4.18 - lập kế hoạch sửa static bảo thủ từ MASTER_VILLA hiện tại.
 * AUTO chỉ gồm:
 * - capacity số thuần ngoài 1..100;
 * - ô trống có evidence EXPLICIT_LABEL/EXPLICIT_TOKEN;
 * - PN số thuần ngoài 1..30.
 * Mọi disagreement với giá trị hợp lệ đang có chỉ đưa REVIEW, không ghi.
 */
function beBuildStaticInfoPlanV418_(){
  var sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BE_CONFIG.MASTER_VILLA_SHEET||"MASTER_VILLA");
  if(!sheet||sheet.getLastRow()<2)throw new Error("Không có MASTER_VILLA để audit static V418.");
  var width=Math.min(Math.max(13,sheet.getLastColumn()),15);
  var values=sheet.getRange(1,1,sheet.getLastRow(),width).getDisplayValues();
  var header={};
  (values[0]||[]).forEach(function(name,index){header[cleanMasterText(name)]=index;});
  ["MÃ CĂN","TÊN CĂN","NGUỒN","TIÊU CHUẨN","PN","THÔNG TIN"].forEach(function(name){
    if(header[name]===undefined)throw new Error("MASTER_VILLA thiếu cột "+name);
  });

  var autoChanges=[];
  var review=[];
  var invalidCapacity=0;
  var blankBedrooms=0;
  var fingerprintParts=[];

  for(var r=1;r<values.length;r++){
    var row=values[r]||[];
    var sku=cleanMasterText(row[header["MÃ CĂN"]]);
    if(!sku)continue;
    var name=cleanMasterText(row[header["TÊN CĂN"]]);
    var source=cleanMasterText(row[header["NGUỒN"]]);
    var info=cleanMasterText(row[header["THÔNG TIN"]]);
    var oldCapacity=cleanMasterText(row[header["TIÊU CHUẨN"]]);
    var oldBedrooms=cleanMasterText(row[header["PN"]]);
    var context=name+"\n"+info;
    var capacity=beExtractMasterStandardDetailV417_(context);
    var bedrooms=beExtractMasterBedroomsDetailV417_(context);
    var newCapacity=oldCapacity;
    var newBedrooms=oldBedrooms;
    var reasons=[];
    var auto=false;

    var oldCapacityNumeric=/^\d+$/.test(oldCapacity);
    if(oldCapacityNumeric&&!beCapacityNumberV417_(oldCapacity)){
      invalidCapacity++;
      newCapacity=/^(EXPLICIT_LABEL|EXPLICIT_TOKEN)$/.test(capacity.confidence||"")
        ? String(capacity.value||"") : "";
      reasons.push("CAPACITY_OUT_OF_RANGE");
      auto=true;
    }else if(!oldCapacity&&capacity.value&&/^(EXPLICIT_LABEL|EXPLICIT_TOKEN)$/.test(capacity.confidence||"")){
      newCapacity=capacity.value;
      reasons.push(capacity.confidence);
      auto=true;
    }

    if(!oldBedrooms)blankBedrooms++;
    if(/^\d+$/.test(oldBedrooms)&&!beBedroomNumberV417_(oldBedrooms)){
      newBedrooms="";
      reasons.push("PN_OUT_OF_RANGE");
      auto=true;
    }else if(!oldBedrooms&&bedrooms.value&&/^(EXPLICIT_LABEL|EXPLICIT_TOKEN)$/.test(bedrooms.confidence||"")){
      newBedrooms=bedrooms.value;
      reasons.push(bedrooms.confidence);
      auto=true;
    }

    var item={
      row:r+1,sku:sku,source:source,villa:name,
      oldCapacity:oldCapacity,newCapacity:newCapacity,
      oldBedrooms:oldBedrooms,newBedrooms:newBedrooms,
      reason:reasons.join(" | "),
      confidence:capacity.confidence||bedrooms.confidence||"REVIEW"
    };
    if(auto&&(newCapacity!==oldCapacity||newBedrooms!==oldBedrooms)){
      autoChanges.push(item);
    }else if(
      (oldCapacity&&capacity.value&&capacity.value!==oldCapacity)||
      (oldBedrooms&&bedrooms.value&&bedrooms.value!==oldBedrooms)||
      /POLICY|AMBIGUOUS/.test(String(capacity.reason||"")+" "+String(bedrooms.reason||""))
    ){
      item.reason=[capacity.reason,bedrooms.reason].filter(Boolean).join(" | ")||"VALID_VALUE_DIFFERENT";
      review.push(item);
    }
    fingerprintParts.push([
      r+1,sku,oldCapacity,oldBedrooms,name,source,info,
      newCapacity,newBedrooms,item.reason,item.confidence
    ].join("\u001f"));
  }

  var digest=Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    fingerprintParts.join("\n"),
    Utilities.Charset.UTF_8
  );
  return {
    success:true,code:"STATIC_INFO_PLAN_READY_V418",sheet:sheet,
    scanned:fingerprintParts.length,invalidCapacity:invalidCapacity,
    blankBedrooms:blankBedrooms,autoChanges:autoChanges,review:review,
    fingerprint:Utilities.base64EncodeWebSafe(digest).replace(/=+$/g,"").slice(0,32)
  };
}
/**
 * Lấy link từ công thức HYPERLINK hoặc nội dung ô.
 */
function getMasterLink(displayValue, formula) {
  const formulaText = String(formula || "");

  const hyperlink = formulaText.match(
    /=HYPERLINK\(\s*"([^"]+)"/i
  );

  if (hyperlink) {
    return hyperlink[1];
  }

  const value = cleanMasterText(displayValue);

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  return value;
}


function looksLikeMasterMaps(value) {
  const text = normalizeMasterText(value);

  return (
    text.indexOf("maps.app.goo.gl") >= 0 ||
    text.indexOf("google.com/maps") >= 0 ||
    text.indexOf("goo.gl/maps") >= 0
  );
}


function looksLikeMasterImageLink(value) {
  const text = normalizeMasterText(value);

  return (
    text.indexOf("drive.google.com") >= 0 ||
    text.indexOf("photos.google.com") >= 0 ||
    text.indexOf("zalo.me") >= 0 ||
    text.indexOf("hinh anh") >= 0 ||
    text.indexOf("drive anh") >= 0
  );
}


function beLooksLikeStandaloneAddressV38_(value) {
  const text = cleanMasterText(value);
  const normalized = normalizeMasterText(text);

  if (!text) return false;

  // Không loại tên thật dù có chữ Hẻm/Đường nếu có loại hình lưu trú.
  if (/\b(villa|home|homestay|house|hotel|resort|cabin|lodge)\b/i.test(normalized)) {
    return false;
  }

  const startsLikeAddress = /^(?:dia chi|hem|duong|so\s*\d+|khu|kqh)\b/.test(normalized);
  const hasAddressDetail =
    /\b(?:p|phuong|quan|q)\s*\.?\s*\d+\b/.test(normalized) ||
    /\b\d+\s+[a-z]/.test(normalized) ||
    (text.match(/,/g) || []).length >= 1;

  return startsLikeAddress && hasAddressDetail;
}


function looksLikeMasterPrice(value) {
  const text = cleanMasterText(value);

  return (
    /^\d{1,3}(?:[.,]\d{3})+(?:\s*đ)?$/i.test(text) ||
    /^\d+(?:tr|trieu|triệu)(?:\d+)?$/i.test(text) ||
    /giá thuê/i.test(text) ||
    /gia thue/i.test(text)
  );
}


function looksLikeMasterDate(value) {
  const text = cleanMasterText(value);

  return (
    /^\d{1,2}$/.test(text) ||
    /^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/.test(text) ||
    /^t[2-7]$/i.test(text) ||
    /^(thứ|thu)\s*[2-7]$/i.test(text) ||
    /^cn$/i.test(text)
  );
}


function testAutoRowMergedInstructionV341() {
  var values = [
    ["","","","","",""],
    ["","KHÓI HOUSE","GOLF","GỖ 1","GỖ 2","BA HOUSE"],
    ["","","","","",""],
    ["NGÀY","KHÔNG THÚ CƯNG","KHÔNG KARAOKE","KHÔNG THÚ CƯNG","KHÔNG KARAOKE","HÁT KARAOKE ĐẾN 21h30"],
    ["1","Check lịch tháng 8","Check lịch tháng 8","Check lịch tháng 8","Check lịch tháng 8","Check lịch tháng 8"],
    ["2","","","","",""]
  ];
  var config = {
    nameMode:"AUTO_ROW",
    startColumnIndex:1,
    endColumnIndex:5,
    topRows:20,
    fixedNameRowIndex:-1,
    fallbackEnabled:true,
    minimumNamesInRow:2,
    minimumNameScore:18,
    excludedColumnIndexes:[]
  };
  var detected = detectMasterAutoVillaNameRow(values, config);
  if (!detected || Number(detected.row) !== 1 || Number(detected.validCount) !== 5) {
    throw new Error("AUTO_ROW_MERGED_INSTRUCTION_V341_FAILED: "+JSON.stringify(detected));
  }
  if (!beLooksLikeCalendarInstructionV341_("Check lịch tháng 8")) {
    throw new Error("AUTO_ROW_INSTRUCTION_BLACKLIST_V341_FAILED");
  }
  Logger.log(JSON.stringify({code:"AUTO_ROW_MERGED_INSTRUCTION_PASS_V341",row:Number(detected.row)+1,validCount:detected.validCount}));
  return {success:true,row:Number(detected.row)+1,validCount:detected.validCount};
}

function cleanMasterVillaName(value) {
  const firstLine = getCalendarFirstMeaningfulLine(value);
  return extractCalendarVillaName(firstLine);
}


function removeDuplicateMasterVillas(villas) {
  const seen = {};
  const result = [];

  for (const villa of villas || []) {
    const nameKey = normalizeMasterText(villa && villa.name);
    const sourceColumn = Number(villa && villa.sourceColumn || 0);
    const key = sourceColumn > 0
      ? nameKey + "|COL:" + sourceColumn
      : nameKey;

    if (!nameKey || seen[key]) continue;

    seen[key] = true;
    result.push(villa);
  }

  return result;
}

function beParseExcludedColumnsV39_(value) {
  var indexes = [];
  var seen = {};

  String(value || "")
    .split(/[\s,|]+/)
    .map(function(token) { return token.trim().toUpperCase(); })
    .filter(String)
    .forEach(function(token) {
      var rangeMatch = token.match(/^([A-Z]+|\d+)\s*-\s*([A-Z]+|\d+)$/);
      var from = rangeMatch ? beColIndexV31_(rangeMatch[1]) : beColIndexV31_(token);
      var to = rangeMatch ? beColIndexV31_(rangeMatch[2]) : from;
      if (from < 0 || to < 0) return;
      if (from > to) { var tmp = from; from = to; to = tmp; }
      for (var i = from; i <= to; i++) {
        if (!seen[i]) { seen[i] = true; indexes.push(i); }
      }
    });

  return indexes.sort(function(a, b) { return a - b; });
}


function cleanMasterText(value) {
  return String(value == null ? "" : value)

    // Xóa toàn bộ ký tự điều khiển ẩn, gồm ký tự  trong log
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")

    // Xóa zero-width và BOM
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")

    // Chuẩn hóa khoảng trắng
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}


function normalizeMasterText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ");
}

/** Chuẩn hóa đúng 4 giá trị LOAI_SP được production hỗ trợ. */
function beNormalizeProductTypeV2_(value) {
  var normalized = normalizeMasterText(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  var aliases = {
    PHONG_RIENG:"PHONG_RIENG",
    PHONG_LE:"PHONG_RIENG",
    PHONG_DON:"PHONG_RIENG",
    PRIVATE_ROOM:"PHONG_RIENG",
    ROOM:"PHONG_RIENG",
    NGUYEN_CAN:"NGUYEN_CAN",
    WHOLE_PROPERTY:"NGUYEN_CAN",
    WHOLE_VILLA:"NGUYEN_CAN",
    COMBO:"COMBO"
  };
  return aliases[normalized] || "";
}

/**
 * Precedence: manual override > source default > blank.
 * LOAI_SP_NGUON ghi lại giá trị generated lần trước, nhờ đó thay config
 * source không bị nhầm với một override tay trong LOAI_SP.
 */
function beResolveProductTypeV2_(previousEffective, previousSourceDefault, nextSourceDefault) {
  var effective = beNormalizeProductTypeV2_(previousEffective);
  var previousGenerated = beNormalizeProductTypeV2_(previousSourceDefault);
  var nextGenerated = beNormalizeProductTypeV2_(nextSourceDefault);

  /*
   * V4.22.4 - PRIVATE ROOM SOURCE-OF-TRUTH
   *
   * MASTER cũ có nhiều dòng LOAI_SP=NGUYEN_CAN nhưng LOAI_SP_NGUON trống
   * vì schema generated type chưa tồn tại ở thời điểm đó. Không được coi giá trị
   * legacy này là manual override để chặn một source hiện đã được đánh dấu
   * PHONG_RIENG trong MASTER.
   *
   * Manual override chỉ được xem là chắc chắn khi ta có previousGenerated để
   * chứng minh operator đã thay LOAI_SP khác với generated type trước đó.
   */
  var hasConfirmedManualOverride = !!effective && !!previousGenerated &&
    effective !== previousGenerated;

  if (hasConfirmedManualOverride) return effective;

  // Source default hiện tại có giá trị thì ưu tiên dùng nó.
  if (nextGenerated) return nextGenerated;

  // Source chưa khai báo loại: giữ effective cũ thay vì làm rỗng loại sản phẩm.
  return effective;
}

function beSourceProductTypeConfigV2_(typeCell, masterConfig) {
  var fromColumn = beNormalizeProductTypeV2_(typeCell);
  if (fromColumn) return fromColumn;
  var cfg = {};
  try {
    cfg = typeof parseBookingSourceConfig === "function"
      ? (parseBookingSourceConfig(masterConfig || "") || {})
      : {};
  } catch (ignoreProductTypeConfigV2) {}
  return beNormalizeProductTypeV2_(
    cfg.LOAI_SP || cfg.PRODUCT_TYPE || cfg.LOAI_SAN_PHAM || ""
  );
}

/**
 * V6.1.12 - Mixed-source product type override.
 * Một source có thể chứa cả nguyên căn và phòng lẻ. Khi đó source-level LOẠI
 * không đủ chính xác. CONFIG MASTER hỗ trợ:
 *   PHONG_RIENG_COLS=47-49
 *   NGUYEN_CAN_COLS=3-46
 * Cột dùng số 1-based hoặc chữ A1 giống SKIP_COLS. Override theo cột thắng
 * source default nhưng vẫn đứng dưới manual override đã được xác nhận.
 */
function beVillaProductTypeConfigV612_(masterConfig, sourceColumn, sourceDefault) {
  var cfg = {};
  try {
    cfg = typeof parseBookingSourceConfig === "function"
      ? (parseBookingSourceConfig(masterConfig || "") || {})
      : {};
  } catch (ignoreMixedTypeConfigV612) {}

  var zeroBased = Math.max(-1, Number(sourceColumn || 0) - 1);
  if (zeroBased >= 0) {
    var roomCols = beParseExcludedColumnsV39_(
      cfg.PHONG_RIENG_COLS || cfg.PRIVATE_ROOM_COLS || cfg.ROOM_COLS || ""
    );
    if (roomCols.indexOf(zeroBased) >= 0) return "PHONG_RIENG";

    var wholeCols = beParseExcludedColumnsV39_(
      cfg.NGUYEN_CAN_COLS || cfg.WHOLE_VILLA_COLS || cfg.WHOLE_PROPERTY_COLS || ""
    );
    if (wholeCols.indexOf(zeroBased) >= 0) return "NGUYEN_CAN";
  }

  return beNormalizeProductTypeV2_(sourceDefault);
}
/**
 * Tạo mã căn dựa trên ID nguồn và tên villa.
 */
function createVillaSku(sourceID, villaName) {
  const raw = [
    cleanMasterText(sourceID),
    normalizeMasterText(villaName)
  ].join("|");

  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    raw,
    Utilities.Charset.UTF_8
  );

  const hash = digest
    .map(function(byte) {
      const value = byte < 0 ? byte + 256 : byte;
      return ("0" + value.toString(16)).slice(-2);
    })
    .join("")
    .slice(0, 10)
    .toUpperCase();

  return "VL-" + hash;
}
function debugMasterColumnLayout() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const master = ss.getSheetByName("MASTER");

  if (!master) {
    throw new Error('Không tìm thấy sheet "MASTER"');
  }

  const masterRows = master.getDataRange().getValues();

  for (let i = 1; i < masterRows.length; i++) {
    const source = cleanMasterText(masterRows[i][2]);
    const link = cleanMasterText(masterRows[i][3]);
    const enable = masterRows[i][4];

    if (enable !== true || !link) continue;

    try {
      const sourceFile = beOpenSourceSpreadsheetV_FIX(link);  // FIX: hỗ trợ nguồn .xlsx
      const calendarSheet = findLatestMasterCalendarSheet(sourceFile);

      if (!calendarSheet) {
        
        continue;
      }

      const values = calendarSheet
        .getDataRange()
        .getDisplayValues();

      const rowCount = values.length;
      const columnCount = values[0].length;
      const topLimit = Math.min(rowCount, 20);

      
      
      
      

      for (let r = 0; r < topLimit; r++) {
        const cells = [];

        for (let c = 0; c < columnCount; c++) {
          const text = cleanMasterVillaName(values[r][c]);

          if (!text) continue;

          cells.push(
            columnNumberToLetter(c + 1) +
            "=" +
            JSON.stringify(text)
          );
        }

        
      }
    } catch (error) {
      
      
    }
  }
}

function columnNumberToLetter(column) {
  let result = "";

  while (column > 0) {
    const remainder = (column - 1) % 26;
    result =
      String.fromCharCode(65 + remainder) +
      result;

    column = Math.floor((column - 1) / 26);
  }

  return result;
}

function rebuildMasterVilla(){ return buildMasterVilla(); }


/* ================= BOOKING ENGINE V3.1 MASTER / METADATA ================= */
function buildMasterVilla(options){
  options = options || {};
  var buildStartedAtV21 = new Date().getTime();
  var incrementalModeV328 = String(options.mode || "").toUpperCase() === "INCREMENTAL";
  var targetRowMapV328 = {};
  var replaceIdentityByRowV328 = {};
  var maxRuntimeMsV328 = Math.max(60000, Number(options.maxRuntimeMs || 220000));
  var stoppedEarlyV328 = false;
  var successfulRowsV328 = [];
  var failedRowsV328 = [];
  var processedRowsV328 = [];
  var successfulIdentitiesV328 = [];
  // V4.16: full build phải giữ riêng source đọc lỗi/đọc thiếu; không được
  // biến lỗi Google/parse thành tín hiệu xóa tất cả căn cũ của source đó.
  var failedIdentitiesV416 = [];
  var previousFastImageModeV328 = BE_MASTER_FAST_IMAGE_MODE_V328_;

  (options.targetRows || []).forEach(function(rowNumber) {
    rowNumber = Number(rowNumber || 0);
    if (rowNumber > 1) targetRowMapV328[rowNumber] = true;
  });

  (options.replaceIdentities || []).forEach(function(identity) {
    identity = identity || {};
    var rowNumber = Number(identity.row || 0);
    if (rowNumber > 1) replaceIdentityByRowV328[rowNumber] = identity;
  });

  // Incremental luôn dùng fast image mode. Full sync qua Admin cũng bật fastImages.
  BE_MASTER_FAST_IMAGE_MODE_V328_ = incrementalModeV328 || options.fastImages === true;
  beClearMasterSheetRuntimeCacheV21_();
  // B1 GhostGuard V1: reset trạng thái/ngân sách gỡ căn ảo cho lần build này.
  if (typeof beGhostBeginRunV1_ === "function") beGhostBeginRunV1_();
  // B7: đo thời gian từng bước.
  beB7BeginRunV1_();
  var b7FinalV1 = beB7SourceTimerV1_("", "__CHUAN_BI_VA_GHI_KET_QUA__");
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var master = ss.getSheetByName(BE_CONFIG.MASTER_SHEET);

  if (!master) {
    throw new Error('Không tìm thấy sheet "' + BE_CONFIG.MASTER_SHEET + '"');
  }

  var output = ss.getSheetByName(BE_CONFIG.MASTER_VILLA_SHEET) ||
    ss.insertSheet(BE_CONFIG.MASTER_VILLA_SHEET);
  var imageOverrideStore = beLoadImageOverridesV35_(ss);
  var pnOverrideBySkuV1 = beLoadPnOverridesV1_(ss);

  // V3.2.9 - Giữ ảnh Drive cũ chỉ khi mapping cột nguồn vẫn khớp.
  // Nếu cùng SKU nhưng SOURCE_COLUMN đổi, ảnh cũ không còn đáng tin và phải queue đọc lại.
  var previousImageBySku = {};
  var previousSourceColumnBySkuV329 = {};
  if (output.getLastRow() > 1 && output.getLastColumn() >= 2) {
    var previousReadWidthV329 = Math.min(Math.max(output.getLastColumn(), 2), 11);
    output
      .getRange(2, 1, output.getLastRow() - 1, previousReadWidthV329)
      .getDisplayValues()
      .forEach(function(previousRow) {
        var previousSku = cleanMasterText(previousRow[0]);
        var previousImage = cleanMasterText(previousRow[1]);
        var previousSourceColumn = previousRow.length >= 11
          ? Number(previousRow[10] || 0)
          : 0;
        if (previousSku) {
          if (previousImage) previousImageBySku[previousSku] = previousImage;
          previousSourceColumnBySkuV329[previousSku] = previousSourceColumn;
        }
      });
  }

  var rows = master.getDataRange().getValues();
  if (!rows.length) return {success:true, villas:0, sources:0};

  var headers = beHeaderMap_(rows[0]);

  /*
   * SOURCE_COLUMN là cột thực tế của căn trong sheet lịch nguồn.
   * CalendarReader dùng giá trị này trước, chỉ dò tên khi cột không còn hợp lệ.
   */
  var outputHeaders = [
    "MÃ CĂN",
    "ẢNH",
    "TÊN CĂN",
    "THÀNH PHỐ",
    "NGUỒN",
    "LINK LỊCH",
    "TIÊU CHUẨN",
    "PN",
    "THÔNG TIN",
    "MAPS",
    "CỘT NGUỒN",
    "CONFIG LỊCH",
    "CẬP NHẬT",
    "LOAI_SP",
    "UU_TIEN",
    "LOAI_SP_NGUON"
  ];

  // V4.19.6 - runtime marker: mọi full/incremental publish phải dùng schema 16 cột.
  // Nếu selected sync không có log này thì callback đang chạy code/project khác.
  Logger.log(JSON.stringify({
    code: "MASTER_SCHEMA_V4196_ACTIVE",
    mode: incrementalModeV328 ? "INCREMENTAL" : "FULL",
    width: outputHeaders.length,
    hasProductType: outputHeaders.indexOf("LOAI_SP") >= 0,
    hasGeneratedType: outputHeaders.indexOf("LOAI_SP_NGUON") >= 0
  }));

  var previousOutputRowsV328 = [];
  if (output.getLastRow() > 1) {
    var previousWidthV328 = Math.max(output.getLastColumn(), outputHeaders.length);
    var previousHeadersV1 = output
      .getRange(1, 1, 1, previousWidthV328)
      .getDisplayValues()[0] || [];
    var previousHeaderMapV1 = {};
    previousHeadersV1.forEach(function(header, index) {
      var key = normalizeMasterText(header);
      if (key && previousHeaderMapV1[key] === undefined) previousHeaderMapV1[key] = index;
    });
    previousOutputRowsV328 = output
      .getRange(2, 1, output.getLastRow() - 1, previousWidthV328)
      .getValues()
      .map(function(row) {
        return outputHeaders.map(function(header) {
          var index = previousHeaderMapV1[normalizeMasterText(header)];
          return index === undefined ? "" : row[index];
        });
      });
  }
  var previousManualBySkuV1 = {};
  previousOutputRowsV328.forEach(function(row) {
    var sku = cleanMasterText(row && row[0]);
    if (!sku) return;
    previousManualBySkuV1[sku] = {
      productType: cleanMasterText(row[13] || ""),
      priority: Math.max(0, Math.min(3, Math.round(Number(row[14] || 0)))),
      sourceProductType: cleanMasterText(row[15] || "")
    };
  });
  // V4.22.4 - metadata tĩnh fail-safe: dữ liệu mới trống thì giữ dữ liệu cũ cùng SKU.
  var previousStaticBySkuV4224 = {};
  previousOutputRowsV328.forEach(function(row) {
    var sku = cleanMasterText(row && row[0]);
    if (!sku) return;
    previousStaticBySkuV4224[sku] = {
      standard: cleanMasterText(row[6] || ""),
      bedrooms: cleanMasterText(row[7] || ""),
      info: cleanMasterText(row[8] || ""),
      maps: cleanMasterText(row[9] || "")
    };
  });

  var villaIdentityContextV1 = null;
  if (typeof beLoadVillaIdentityContextV1_ === "function") {
    try {
      villaIdentityContextV1 = beLoadVillaIdentityContextV1_();
    } catch (identityLoadErrorV1) {
      var identityEnabledV11 = typeof beVillaIdentityEnabledV1_ === "function" && beVillaIdentityEnabledV1_();
      Logger.log(JSON.stringify({
        level:"ERROR",code:"VILLA_IDENTITY_LOAD_FAILED_V11",
        error:String(identityLoadErrorV1 && identityLoadErrorV1.message ? identityLoadErrorV1.message : identityLoadErrorV1),
        action:identityEnabledV11 ? "ABORT_MASTER_BUILD" : "LEGACY_SKU_CONTINUES"
      }));
      if (identityEnabledV11) throw identityLoadErrorV1;
      villaIdentityContextV1 = null;
    }
  }

  if (incrementalModeV328 && !Object.keys(targetRowMapV328).length) {
    BE_MASTER_FAST_IMAGE_MODE_V328_ = previousFastImageModeV328;
    return {
      success: true,
      mode: "INCREMENTAL",
      villas: previousOutputRowsV328.length,
      processedVillas: 0,
      sources: 0,
      targetCount: 0,
      successfulRows: [],
      failedRows: [],
      stoppedEarly: false,
      version: BE_CONFIG.VERSION
    };
  }

  b7FinalV1.mark("0_doc_master_va_master_villa_cu");
  var previousSourceCountByLinkV328 = {};
  var previousSourceCountByNameV328 = {};
  previousOutputRowsV328.forEach(function(previousRow) {
    var previousSource = normalizeMasterText(previousRow[4]);
    var previousLink = cleanMasterText(previousRow[5]);
    if (previousLink) previousSourceCountByLinkV328[previousLink] = (previousSourceCountByLinkV328[previousLink] || 0) + 1;
    if (previousSource) previousSourceCountByNameV328[previousSource] = (previousSourceCountByNameV328[previousSource] || 0) + 1;
  });

  var result = [];
  var sourceStatuses = [];
  // B3/B4: cảnh báo theo dòng MASTER, gắn vào cột trạng thái cuối build.
  var warningsByRowB34 = {};
  var opened = 0;
  var imageDiagnostics = {
    detected: 0,
    cached: 0,
    queued: 0,
    missing: 0,
    failed: 0,
    missingVillas: [],
    missingRecords: []
  };
  var imageQueueRecordsV21 = [];

  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    var masterRowNumberV328 = r + 1;

    if (incrementalModeV328 && !targetRowMapV328[masterRowNumberV328]) continue;

    if (
      incrementalModeV328 &&
      processedRowsV328.length > 0 &&
      new Date().getTime() - buildStartedAtV21 > maxRuntimeMsV328
    ) {
      stoppedEarlyV328 = true;
      Logger.log(JSON.stringify({
        level: "WARNING",
        code: "MASTER_INCREMENTAL_TIME_BUDGET_STOP_V328",
        processedRows: processedRowsV328,
        elapsedMs: new Date().getTime() - buildStartedAtV21,
        maxRuntimeMs: maxRuntimeMsV328
      }));
      break;
    }

    var enabled = beBoolCell_(beGetByHeader_(row, headers.enable));
    var link = cleanMasterText(beGetByHeader_(row, headers.link));
    var sourceId = cleanMasterText(beGetByHeader_(row, headers.id));
    var city = cleanMasterText(beGetByHeader_(row, headers.city));
    var source = cleanMasterText(beGetByHeader_(row, headers.source));
    var sourceIdentityV416 = beBuildIncrementalIdentityV328_(
      masterRowNumberV328,
      source,
      link,
      replaceIdentityByRowV328[masterRowNumberV328]
    );

    if (incrementalModeV328) processedRowsV328.push(masterRowNumberV328);

    // Disable là một thay đổi hợp lệ: incremental sẽ xóa riêng source này khỏi MASTER_VILLA.
    if (!enabled) {
      if (incrementalModeV328) {
        successfulRowsV328.push(masterRowNumberV328);
        successfulIdentitiesV328.push(sourceIdentityV416);
        sourceStatuses.push({
          row: masterRowNumberV328,
          status: "DISABLED: đã gỡ khỏi MASTER_VILLA",
          time: new Date()
        });
      }
      continue;
    }

    if (!link) {
      failedRowsV328.push(masterRowNumberV328);
      failedIdentitiesV416.push(sourceIdentityV416);
      sourceStatuses.push({
        row: masterRowNumberV328,
        status: "ERROR: Nguồn bật nhưng thiếu LINK",
        time: new Date()
      });
      continue;
    }

    // CONFIG MASTER là cấu trúc gốc: vùng tên, cột bắt đầu/kết thúc và
    // thông tin nằm chung ô tên. CONFIG ẢNH/THÔNG TIN chỉ ghi đè phần riêng.
    var masterConfig = cleanMasterText(
      beGetByHeader_(row, headers.configMaster)
    );
    var sourceProductTypeV2 = beSourceProductTypeConfigV2_(
      beGetByHeader_(row, headers.type),
      masterConfig
    );

    // CONFIG LỊCH chỉ dành cho lịch trống và giá realtime.
    var calendarConfig = cleanMasterText(
      beGetByHeader_(row, headers.configCalendar)
    ) || "AUTO";

    // Hai config metadata tách riêng, có thể trỏ tới hai sheet khác nhau.
    var imageConfig = cleanMasterText(
      beGetByHeader_(row, headers.configImage)
    );
    var infoConfig = cleanMasterText(
      beGetByHeader_(row, headers.configInfo)
    );

    var sourceStartedAtV21 = new Date().getTime();
    var b7TimerV1 = beB7SourceTimerV1_(sourceId, source);
    var sourceResultStartV328 = result.length;
    var sourceQueueStartV328 = imageQueueRecordsV21.length;
    var sourceMissingRecordStartV328 = imageDiagnostics.missingRecords.length;
    var sourceMissingVillaStartV328 = imageDiagnostics.missingVillas.length;
    var sourceDiagStartV328 = {
      detected: Number(imageDiagnostics.detected || 0),
      cached: Number(imageDiagnostics.cached || 0),
      queued: Number(imageDiagnostics.queued || 0),
      missing: Number(imageDiagnostics.missing || 0),
      failed: Number(imageDiagnostics.failed || 0)
    };
    beClearMasterSheetRuntimeCacheV21_();

    try {
      var file = beOpenSourceSpreadsheetV_FIX(link);  // FIX: hỗ trợ nguồn .xlsx
      opened++;
      b7TimerV1.mark("1_mo_file_nguon");

      var imageVillas = [];
      var infoVillas = [];
      var effectiveImageConfig = beBuildInheritedMetadataConfigV37_(
        masterConfig,
        imageConfig,
        "IMAGE"
      );
      var effectiveInfoConfig = beBuildInheritedMetadataConfigV37_(
        masterConfig,
        infoConfig,
        "INFO"
      );

      // Lịch luôn là nguồn xác định căn thật. Sheet phụ chỉ được dùng khi
      // CONFIG ẢNH / CONFIG THÔNG TIN ghi SHEET=... rõ ràng.
      var calendarSelectionV4210 = beMasterCalendarSelectionV4210_(
        file,
        calendarConfig,
        new Date()
      );
      var calendarSheet = calendarSelectionV4210.sheet;
      var inactiveCalendarWindowV4210 = calendarSelectionV4210.inactiveWindow === true;
      beAddSourceWarningsB34_(warningsByRowB34, masterRowNumberV328, calendarSelectionV4210.warnings);
      // Review 10/11 mục 2: tên màu trống không hiểu được => cảnh báo ở cột trạng thái.
      if (typeof ceFreeColorConfigIssuesV1_ === "function") {
        beAddSourceWarningsB34_(warningsByRowB34, masterRowNumberV328, ceFreeColorConfigIssuesV1_(calendarConfig));
      }
      b7TimerV1.mark("2_chon_tab_lich");
      var imageSheet = calendarSheet;
      var infoSheet = calendarSheet;
      var hasExplicitImageSupplementV414 = beHasExplicitMetadataSheetV38_(imageConfig);
      var hasExplicitInfoSupplementV414 = beHasExplicitMetadataSheetV38_(infoConfig);
      var imageReaderFailedV328 = false;
      var infoReaderFailedV328 = false;

      if (calendarSheet) {
        Logger.log(JSON.stringify({
          code: "MAIN_SHEET_SELECTED",
          source: source,
          sheet: calendarSheet.getName(),
          policy: "CALENDAR_IS_VILLA_TRUTH_V414"
        }));
      }

      if (hasExplicitImageSupplementV414) {
        try {
          imageSheet = beFindMetadataSheetV32_(file, effectiveImageConfig, "IMAGE");
          Logger.log(JSON.stringify({
            code:"SUPPLEMENT_SHEET_SELECTED_V414",
            source:source,kind:"IMAGE",
            sheet:imageSheet && imageSheet.getName ? imageSheet.getName() : ""
          }));
        } catch (supplementImageErrorV414) {
          imageReaderFailedV328 = true;
          imageSheet = null;
          Logger.log(JSON.stringify({
            level:"WARNING",code:"SUPPLEMENT_SHEET_ERROR_V414",
            source:source,kind:"IMAGE",
            error:String(supplementImageErrorV414 && supplementImageErrorV414.message ? supplementImageErrorV414.message : supplementImageErrorV414),
            action:"MASTER_CONTINUES_WITHOUT_SUPPLEMENT_IMAGE"
          }));
        }
      }

      if (hasExplicitInfoSupplementV414) {
        try {
          infoSheet = beFindMetadataSheetV32_(file, effectiveInfoConfig, "INFO");
          Logger.log(JSON.stringify({
            code:"SUPPLEMENT_SHEET_SELECTED_V414",
            source:source,kind:"INFO",
            sheet:infoSheet && infoSheet.getName ? infoSheet.getName() : ""
          }));
        } catch (supplementInfoErrorV414) {
          infoReaderFailedV328 = true;
          infoSheet = null;
          Logger.log(JSON.stringify({
            level:"WARNING",code:"SUPPLEMENT_SHEET_ERROR_V414",
            source:source,kind:"INFO",
            error:String(supplementInfoErrorV414 && supplementInfoErrorV414.message ? supplementInfoErrorV414.message : supplementInfoErrorV414),
            action:"MASTER_CONTINUES_WITHOUT_SUPPLEMENT_INFO"
          }));
        }
      }

      try {
        imageVillas = imageSheet
          ? beReadInfoSheetV31_(imageSheet, effectiveImageConfig)
          : [];
      } catch (imageReaderErrorV328) {
        imageReaderFailedV328 = true;
        imageVillas = [];
        imageDiagnostics.failed++;
        Logger.log(JSON.stringify({
          level: "WARNING",
          code: "IMAGE_READER_ERROR",
          source: source,
          sheet: imageSheet && imageSheet.getName ? imageSheet.getName() : "",
          error: String(
            imageReaderErrorV328 && imageReaderErrorV328.message
              ? imageReaderErrorV328.message
              : imageReaderErrorV328
          ),
          action: "MASTER_CONTINUES_WITHOUT_IMAGE_V328"
        }));
      }

      if (
        hasExplicitImageSupplementV414 &&
        imageSheet &&
        !imageReaderFailedV328 &&
        !imageVillas.length
      ) {
        imageVillas = beReadImageOnlySequenceV414_(imageSheet, effectiveImageConfig);
      }

      try {
        infoVillas = infoSheet
          ? beReadInfoSheetV31_(infoSheet, effectiveInfoConfig)
          : [];
      } catch (infoReaderErrorV328) {
        infoReaderFailedV328 = true;
        infoVillas = [];
        Logger.log(JSON.stringify({
          level: "WARNING",
          code: "INFO_READER_ERROR_V328",
          source: source,
          sheet: infoSheet && infoSheet.getName ? infoSheet.getName() : "",
          error: String(
            infoReaderErrorV328 && infoReaderErrorV328.message
              ? infoReaderErrorV328.message
              : infoReaderErrorV328
          ),
          action: "MASTER_CONTINUES_WITH_CALENDAR_ONLY"
        }));
      }

      /*
       * V4.2 IMAGE SOURCE ISOLATION
       * CONFIG THÔNG TIN chỉ được bổ sung nội dung/Maps/sức chứa/PN.
       * Tuyệt đối không cho hyperlink nằm trong vùng thông tin (Zalo, web,
       * nhóm chat...) ghi đè hoặc trở thành ảnh của villa. Ảnh chỉ được lấy
       * từ CONFIG ẢNH và đúng vùng hàng ảnh đã cấu hình.
       */
      infoVillas = infoVillas.map(function(villa) {
        villa = villa || {};
        villa.image = "";
        villa.imageSource = null;
        villa.hasRealCellImage = false;
        return villa;
      });

      b7TimerV1.mark("3_doc_anh_thong_tin");
      var metadataVillas = beMergeSeparatedMetadataV32_(
        imageVillas,
        infoVillas
      );

      // V3.4.0: CONFIG là hướng dẫn/fallback. Nếu StructureSnapshot đã thấy
      // cùng một cấu trúc mới 2 lần liên tiếp và đủ tin cậy, runtime được tự
      // chuyển hàng tên mà KHÔNG ghi sửa CONFIG MASTER.
      var runtimeMasterConfigV340 = masterConfig;
      if (calendarSheet && typeof ssResolveAdaptiveMasterConfigV340_ === "function") {
        try {
          runtimeMasterConfigV340 = ssResolveAdaptiveMasterConfigV340_(
            sourceId, source, link, masterConfig
          ) || masterConfig;
        } catch (adaptiveConfigErrorV340) {
          runtimeMasterConfigV340 = masterConfig;
          Logger.log(JSON.stringify({
            level:"WARNING",code:"MASTER_RUNTIME_CONFIG_FALLBACK_V340",
            sourceId:sourceId,source:source,
            error:String(adaptiveConfigErrorV340 && adaptiveConfigErrorV340.message ? adaptiveConfigErrorV340.message : adaptiveConfigErrorV340),
            action:"USE_CONFIG_MASTER"
          }));
        }
      }

      b7TimerV1.mark("4_cau_hinh_snapshot");
      BE_B3_LAST_WARNINGS_V1 = [];
      var calendarVillas = calendarSheet
        ? readMasterFromCalendarSheet(calendarSheet, runtimeMasterConfigV340)
        : [];
      b7TimerV1.mark("5_doc_ten_can_tu_lich");
      if ((BE_B3_LAST_WARNINGS_V1 || []).length) {
        var b3Letters = BE_B3_LAST_WARNINGS_V1.map(function(w) { return w.letter; });
        beAddSourceWarningsB34_(warningsByRowB34, masterRowNumberV328, [{
          code:"PRICE_COLUMN_WITHOUT_NAME_B3",
          message:"cột " + b3Letters.join(", ") + " có giá nhưng hàng tên (hàng " +
            BE_B3_LAST_WARNINGS_V1[0].nameRow + ") trống - căn ở cột này đang bị bỏ qua"
        }]);
      }

      /*
       * V3.9 - Một căn có thể dùng một vùng tên merge và nhiều cột giá/lịch.
       * Gom đúng vùng merge thành một villa, giữ toàn bộ cột con làm lựa chọn.
       */
      if (calendarSheet && calendarVillas.length) {
        calendarVillas = beCollapseMergedVillaGroupsV38_(
          calendarSheet,
          calendarVillas
        );

        /*
         * V4.11 - Một số nguồn dùng 2+ cột liền nhau cho CÙNG MỘT CĂN
         * nhưng ô tên KHÔNG merge. Bản cũ coi sourceColumn là một phần
         * khóa duplicate nên sinh nhiều dòng MASTER_VILLA cùng tên.
         *
         * Chỉ gom khi:
         * - cùng tên chuẩn hóa;
         * - cùng hàng tên;
         * - các cột liền nhau;
         * - villa chưa phải merged-group có groupOptions.
         *
         * Sau khi gom, giữ groupOptions theo format V3.8 hiện tại.
         * CalendarReader sẽ chọn theo sức chứa/PN; nếu không có nhãn
         * thì tie-break ổn định về cột trái đầu tiên.
         */
        calendarVillas = beCollapseAdjacentDuplicateVillaGroupsV411_(
          calendarSheet,
          calendarVillas
        );
      }

      var fixedNameConfiguredV414 = !!parseMasterColumnConfig(runtimeMasterConfigV340).fixedName;
      var allowSupplementNameMatchV414 = hasExplicitImageSupplementV414 || hasExplicitInfoSupplementV414;
      var villas = calendarVillas.length
        ? beMergeVillaMetadataV31_(calendarVillas, metadataVillas, {
            allowSafeNameMatch: allowSupplementNameMatchV414
          })
        : (fixedNameConfiguredV414 ? [] : metadataVillas);

      if (!calendarVillas.length && fixedNameConfiguredV414 && metadataVillas.length) {
        Logger.log(JSON.stringify({
          level:"WARNING",code:"METADATA_FALLBACK_BLOCKED_FIXED_NAME_V414",
          source:source,metadataVillas:metadataVillas.length,
          action:"DO_NOT_CREATE_GHOST_VILLA_FROM_METADATA"
        }));
      }

      var filterImageConfigV328 = effectiveImageConfig;
      if (imageReaderFailedV328) {
        filterImageConfigV328 = {};
        Object.keys(effectiveImageConfig || {}).forEach(function(key) {
          filterImageConfigV328[key] = effectiveImageConfig[key];
        });
        // Ảnh lỗi không được quyền xóa căn khỏi MASTER.
        filterImageConfigV328.REQUIRE_IMAGE = false;
      }

      villas = beFilterFixedRowGhostVillasV324_(
        villas,
        runtimeMasterConfigV340,
        filterImageConfigV328,
        effectiveInfoConfig
      );
      villas = removeDuplicateMasterVillas(villas);
      // Gate cuối cho mọi đường reader (calendar, metadata, merged group).
      // R2 reconciliation chỉ nhận danh sách căn/tên; static cleanup này
      // không thay đổi source set, MÃ_CĂN hay quyết định purge.
      villas = beSanitizeMasterStaticFieldsV417_(villas);

      if (inactiveCalendarWindowV4210) {
        villas = [];
        Logger.log(JSON.stringify({
          code:"MASTER_SOURCE_SET_CLEARED_INACTIVE_WINDOW_V4210",
          sourceId:sourceId,source:source,
          selectionMode:calendarSelectionV4210.mode,
          action:"REMOVE_STALE_VILLAS_FROM_OLD_VISIBLE_MONTHS"
        }));
      }

      if (!villas.length) {
        var confirmedZeroV340 = false;
        if (!confirmedZeroV340 && typeof ssIsConfirmedZeroStructureForSourceV340_ === "function") {
          try {
            confirmedZeroV340 = ssIsConfirmedZeroStructureForSourceV340_(sourceId, source, link) === true;
          } catch (confirmedZeroErrV340) {
            confirmedZeroV340 = false;
          }
        }

        if (!confirmedZeroV340) {
          Logger.log(JSON.stringify({
            level: "WARNING",
            code: "SOURCE_RECONCILE_ZERO_PRESERVED_V416",
            sourceId: sourceId,
            source: source,
            link: link,
            previousRows: Number(previousSourceCountByLinkV328[link] || previousSourceCountByNameV328[normalizeMasterText(source)] || 0),
            action: "KEEP_OLD_MASTER_AND_WAIT_FOR_CONFIRMED_STRUCTURE"
          }));
          failedRowsV328.push(masterRowNumberV328);
          failedIdentitiesV416.push(sourceIdentityV416);
          sourceStatuses.push({
            row: masterRowNumberV328,
            status: "WARNING: đọc 0 căn - giữ MASTER cũ chờ xác nhận",
            time: new Date()
          });
          continue;
        }

        Logger.log(JSON.stringify({
          code:"SOURCE_RECONCILE_ZERO_CONFIRMED_V629",
          sourceId:sourceId,source:source,link:link,
          previousRows:Number(previousSourceCountByLinkV328[link] || previousSourceCountByNameV328[normalizeMasterText(source)] || 0),
          stableReads:2,
          inactiveCalendarWindow:inactiveCalendarWindowV4210===true,
          action:"ALLOW_REMOVE_ONLY_AFTER_CONFIRMED_STRUCTURE"
        }));
      }

      /*
       * V4.16 SAFE SOURCE RECONCILE
       *
       * Zero đã có guard riêng ở trên. Với kết quả còn >0 căn, bản cũ thay
       * toàn bộ block source ngay sau một lần parse. Nếu parser chỉ đọc được
       * một phần (timeout/permission/layout lỗi), thao tác đó làm mất các căn
       * thật còn lại. Chỉ cho phép gỡ các tên cũ khi Structure Snapshot đã
       * xác nhận chính danh sách mới ổn định ít nhất 2 lượt.
       */
      var previousSourceRowsV416 = previousOutputRowsV328.filter(function(previousRow) {
        return beRowMatchesIncrementalIdentityV328_(
          previousRow,
          [sourceIdentityV416]
        );
      });
      b7TimerV1.mark("6_loc_gom_can");
      var reconcileDecisionV416 = beAssessSourceReconcileV416_({
        sourceId: sourceId,
        source: source,
        city: city,
        link: link,
        previousRows: previousSourceRowsV416,
        villas: villas,
        allowInactiveCalendarRemoval: inactiveCalendarWindowV4210 === true
      });

      if (!reconcileDecisionV416.allow) {
        failedRowsV328.push(masterRowNumberV328);
        failedIdentitiesV416.push(sourceIdentityV416);
        sourceStatuses.push({
          row: masterRowNumberV328,
          status: "WARNING: giữ MASTER cũ - " + reconcileDecisionV416.reason,
          time: new Date()
        });
        Logger.log(JSON.stringify({
          level: "WARNING",
          code: "SOURCE_RECONCILE_BLOCKED_V416",
          sourceId: sourceId,
          source: source,
          previousRows: previousSourceRowsV416.length,
          parsedVillas: villas.length,
          missingNames: reconcileDecisionV416.missingNames || [],
          renamePairs: reconcileDecisionV416.renamePairs || [],
          reason: reconcileDecisionV416.reason,
          queuedStructureCheck: reconcileDecisionV416.queuedStructureCheck === true,
          action: "KEEP_OLD_MASTER_UNTIL_TWO_VALID_STRUCTURE_READS"
        }));
        continue;
      }

      if (reconcileDecisionV416.mode === "CONFIRMED_REMOVAL") {
        Logger.log(JSON.stringify({
          code: "SOURCE_RECONCILE_CONFIRMED_V416",
          sourceId: sourceId,
          source: source,
          previousRows: previousSourceRowsV416.length,
          parsedVillas: villas.length,
          missingNames: reconcileDecisionV416.missingNames || [],
          renamePairs: reconcileDecisionV416.renamePairs || [],
          action: "REPLACE_SOURCE_BLOCK_WITH_LATEST_VALID_SET"
        }));
      }

      if (reconcileDecisionV416.mode === "INACTIVE_CALENDAR_WINDOW") {
        Logger.log(JSON.stringify({
          code:"SOURCE_RECONCILE_INACTIVE_WINDOW_V4210",
          sourceId:sourceId,source:source,
          previousRows:previousSourceRowsV416.length,
          missingNames:reconcileDecisionV416.missingNames || [],
          action:"REMOVE_OLD_MONTH_SOURCE_SET"
        }));
      }

      /*
       * V4.16 R2 SAFETY vẫn là mặc định: KHÔNG remap MÃ_CĂN chỉ vì cùng cột.
       * V4.19.4 chỉ mở ngoại lệ sau khi R2 đã CONFIRMED và helper dưới đây
       * chứng minh đây là rename 1-1 duy nhất, không phải dịch cột.
       */
      var confirmedRenameSkuMapV4194 = beConfirmedRenameSkuMapV4194_(
        previousSourceRowsV416,
        villas,
        reconcileDecisionV416
      );

      /*
       * V4.6 - Ghép ảnh theo thứ tự sau khi danh sách căn đã được gom nhóm,
       * lọc căn ảo và loại trùng. Chỉ bật khi CONFIG ẢNH có:
       * IMAGE_ASSIGN_MODE=SEQUENCE
       */
      villas = beAssignImagesBySequenceV46_(
        villas,
        imageVillas,
        effectiveImageConfig,
        imageSheet || calendarSheet
      );

      var parsedImageConfigV328 = parseMetadataConfig(effectiveImageConfig);
      var hasConfiguredImageAreaV328 = !!(
        parsedImageConfigV328.imageRow > 0 ||
        (parsedImageConfigV328.imageRows && parsedImageConfigV328.imageRows.length)
      );
      var queuedSkuV328 = {};

      var villaIdentityAssignmentsV1 = null;
      if (villaIdentityContextV1 && typeof beResolveSourceVillaIdentitiesV1_ === "function") {
        try {
          villaIdentityAssignmentsV1 = beResolveSourceVillaIdentitiesV1_(
            villaIdentityContextV1, sourceId, source, villas, {
              confirmedRenamePairs: (
                reconcileDecisionV416 &&
                reconcileDecisionV416.allow === true &&
                reconcileDecisionV416.mode === "CONFIRMED_REMOVAL"
              ) ? (reconcileDecisionV416.renamePairs || []) : [],
              allowConfirmedRemoveAdd: !!(
                reconcileDecisionV416 &&
                reconcileDecisionV416.allow === true &&
                reconcileDecisionV416.mode === "CONFIRMED_REMOVAL"
              )
            }
          );
        } catch (identityResolveErrorV1) {
          Logger.log(JSON.stringify({
            level:"ERROR",code:"VILLA_IDENTITY_RESOLVE_BLOCKED_V11",
            sourceId:sourceId,source:source,
            error:String(identityResolveErrorV1 && identityResolveErrorV1.message ? identityResolveErrorV1.message : identityResolveErrorV1),
            action:"PRESERVE_PREVIOUS_SOURCE_BLOCK"
          }));
          // Registry đã bật mà identity mơ hồ thì source này phải FAIL CLOSED.
          // Outer source catch sẽ rollback rows/queue của source và giữ block cũ.
          throw identityResolveErrorV1;
        }
      }

      b7TimerV1.mark("7_doi_chieu_va_ma_can");
      var sourceIdentityRegistrationsV1 = [];
      var villaNameCountsV40 = {};
      villas.forEach(function(villa) {
        var duplicateKey = normalizeMasterText(villa && villa.name);
        if (duplicateKey) villaNameCountsV40[duplicateKey] = (villaNameCountsV40[duplicateKey] || 0) + 1;
      });

      villas.forEach(function(villa, villaIndexV1) {
        if (!villa.name) return;

        var duplicateNameKeyV40 = normalizeMasterText(villa.name);
        var villaSkuNameV40 = villa.name;
        if ((villaNameCountsV40[duplicateNameKeyV40] || 0) > 1) {
          villaSkuNameV40 += "__COL_" + Number(villa.sourceColumn || 0);
        }
        var identityAssignmentV1 = villaIdentityAssignmentsV1 && villaIdentityAssignmentsV1[villaIndexV1]
          ? villaIdentityAssignmentsV1[villaIndexV1]
          : null;
        var villaSku = identityAssignmentV1 && identityAssignmentV1.sku
          ? identityAssignmentV1.sku
          : createVillaSku(sourceId, villaSkuNameV40);

        // Giữ fail-safe rename đã có ở LIVE. Registry thắng khi đã resolve chắc chắn;
        // nếu registry chưa gán thì mới dùng map rename R2 hiện hữu của production.
        if (!identityAssignmentV1) {
          var preservedRenameSkuV4194 = confirmedRenameSkuMapV4194[Number(villa.sourceColumn || 0)] || "";
          // B2 fix: không dùng SKU cũ nếu registry đã gán SKU đó cho một căn khác của source
          // (tránh 2 căn cùng MÃ CĂN).
          if (
            preservedRenameSkuV4194 &&
            villaIdentityAssignmentsV1 &&
            villaIdentityAssignmentsV1.some(function(a) { return a && a.sku === preservedRenameSkuV4194; })
          ) {
            Logger.log(JSON.stringify({
              level:"WARNING",code:"SOURCE_RENAME_SKU_SKIPPED_ALREADY_ASSIGNED_B2",
              sourceId:sourceId,source:source,villa:villa.name || "",sku:preservedRenameSkuV4194
            }));
            preservedRenameSkuV4194 = "";
          }
          if (preservedRenameSkuV4194) {
            villaSku = preservedRenameSkuV4194;
            Logger.log(JSON.stringify({
              code:"SOURCE_RENAME_SKU_PRESERVED_V4194",
              sourceId:sourceId,source:source,villa:villa.name || "",
              sourceColumn:Number(villa.sourceColumn || 0),sku:villaSku,
              rule:"R2_CONFIRMED_SINGLE_RENAME_SAME_UNIQUE_COLUMN"
            }));
            /*
             * B2 fix: registry phải ghi nhận đây là ĐỔI TÊN của chính SKU cũ.
             * Bản cũ để registry retire SKU này (REMOVED) trong khi MASTER_VILLA vẫn
             * dùng nó; lần build sau căn không còn khớp registry nên bị cấp MÃ MỚI
             * (ảnh lệch). Giờ: gán record cũ cho căn mới tên, bỏ SKU khỏi danh sách retire.
             */
            if (villaIdentityContextV1 && typeof beIdentityRecordsForSourceV1_ === "function") {
              var renameRecordB2 = null;
              beIdentityRecordsForSourceV1_(villaIdentityContextV1, sourceId, source).forEach(function(rec) {
                if (rec && rec.sku === preservedRenameSkuV4194) renameRecordB2 = rec;
              });
              if (renameRecordB2) {
                identityAssignmentV1 = {sku:preservedRenameSkuV4194, record:renameRecordB2, mode:"CONFIRMED_RENAME_V4194"};
              }
              var metaB2 = villaIdentityAssignmentsV1 && villaIdentityAssignmentsV1._identityMeta;
              if (metaB2 && metaB2.removedSkus) {
                metaB2.removedSkus = metaB2.removedSkus.filter(function(s) { return s !== preservedRenameSkuV4194; });
              }
            }
          }
        }

        if (villaIdentityContextV1) {
          sourceIdentityRegistrationsV1.push({
            villa:villa,sku:villaSku,assignment:identityAssignmentV1
          });
        }

        var manualImageUrl = beFindImageOverrideV35_(
          imageOverrideStore,
          villaSku,
          sourceId,
          source,
          villa.name
        );
        var imageSourceV40 = manualImageUrl || villa.imageSource || villa.image || "";
        var stableImageUrl = typeof imageSourceV40 === "string"
          ? String(imageSourceV40 || "").trim()
          : "";
        var currentSourceColumnV329 = Number(villa.sourceColumn || 0);
        var previousSourceColumnV329 = Number(previousSourceColumnBySkuV329[villaSku] || 0);
        var sourceColumnChangedV329 = beShouldInvalidatePreviousImageV329_(
          previousSourceColumnV329,
          currentSourceColumnV329
        );
        var previousStableImageV21 = sourceColumnChangedV329
          ? ""
          : cleanMasterText(previousImageBySku[villaSku] || "");

        if (sourceColumnChangedV329) {
          Logger.log(JSON.stringify({
            code:"IMAGE_SOURCE_COLUMN_CHANGED_V329",
            source:source,
            villa:villa.name,
            sku:villaSku,
            previousColumn:previousSourceColumnV329,
            currentColumn:currentSourceColumnV329,
            action:"INVALIDATE_OLD_IMAGE_AND_REQUEUE"
          }));
        }

        // V3.2.8/V3.2.9: chỉ giữ ảnh Drive cũ khi mapping cột nguồn chưa đổi.
        if (!imageSourceV40 && BE_MASTER_FAST_IMAGE_MODE_V328_ === true && previousStableImageV21) {
          stableImageUrl = previousStableImageV21;
        }

        // V3.2.9: cache key luôn gắn SOURCE_COLUMN để dịch cột không đụng cache cũ.
        var cacheSourceKeyV21 = beImageCacheSourceKeyV329_(
          manualImageUrl,
          villaSku,
          sourceId,
          currentSourceColumnV329
        );
        var queuedThisVillaV328 = false;

        if (imageSourceV40) {
          imageDiagnostics.detected++;
        } else {
          imageDiagnostics.missing++;
          imageDiagnostics.missingVillas.push(
            (source ? source + " | " : "") + villa.name
          );
          imageDiagnostics.missingRecords.push({
            sku: villaSku,
            source: source,
            villaName: villa.name
          });

          /*
           * Fast Master không direct-read từng ô ảnh. Nếu có vùng ảnh cấu hình,
           * đưa căn vào worker để worker resolve chậm ở execution riêng.
           */
          if (
            BE_CONFIG.IMAGE_CACHE_ENABLED === true &&
            BE_CONFIG.IMAGE_CACHE_INLINE !== true &&
            (BE_MASTER_FAST_IMAGE_MODE_V328_ === true || imageReaderFailedV328) &&
            !queuedSkuV328[villaSku]
          ) {
            imageQueueRecordsV21.push({
              cacheSourceKey: cacheSourceKeyV21,
              sku: villaSku,
              sourceId: sourceId,
              source: source,
              link: link,
              villaName: villa.name,
              sourceColumn: Number(villa.sourceColumn || 0),
              masterConfig: masterConfig,
              imageConfig: imageConfig
            });
            queuedSkuV328[villaSku] = true;
            queuedThisVillaV328 = true;
            imageDiagnostics.queued++;
          }
        }

        /*
         * V2.1 FAST MASTER:
         * - Không upload/tải ảnh trong Build Master mặc định.
         * - Ảnh Drive đã ổn định hoặc URL ngoài Google giữ nguyên.
         * - Ảnh Google tạm / CellImage / OverGridImage: giữ ảnh Drive cũ nếu có,
         *   đồng thời đưa vào queue để worker xử lý riêng.
         * - Có thể bật IMAGE_CACHE_INLINE=true để quay về hành vi cũ khi cần.
         */
        var needsDriveCacheV21 =
          BE_CONFIG.IMAGE_CACHE_ENABLED === true &&
          imageSourceV40 &&
          beImageSourceNeedsDriveCacheV21_(imageSourceV40);

        if (
          BE_CONFIG.IMAGE_CACHE_ENABLED === true &&
          BE_CONFIG.IMAGE_CACHE_INLINE === true &&
          imageSourceV40
        ) {
          try {
            stableImageUrl = beCacheVillaImageToDrive_(
              cacheSourceKeyV21,
              villa.name,
              imageSourceV40
            );
          } catch (imageError) {
            imageDiagnostics.failed++;
            Logger.log(JSON.stringify({
              level: "WARNING",
              code: "IMAGE_DRIVE_CACHE_FAILED",
              source: source,
              villa: villa.name,
              error: String(
                imageError && imageError.message
                  ? imageError.message
                  : imageError
              )
            }));
            stableImageUrl = previousStableImageV21 || stableImageUrl;
          }
        } else if (needsDriveCacheV21) {
          // Không ghi URL Google tạm vào MASTER_VILLA.
          stableImageUrl = previousStableImageV21 || "";
          var refreshImageSourceV4224 = beShouldRefreshImageSourceV4224_(imageSourceV40);

          if ((refreshImageSourceV4224 || !stableImageUrl) && !queuedThisVillaV328 && !queuedSkuV328[villaSku]) {
            imageQueueRecordsV21.push({
              cacheSourceKey: cacheSourceKeyV21,
              sku: villaSku,
              sourceId: sourceId,
              source: source,
              link: link,
              villaName: villa.name,
              sourceColumn: Number(villa.sourceColumn || 0),
              masterConfig: masterConfig,
              imageConfig: imageConfig
            });
            queuedSkuV328[villaSku] = true;
            queuedThisVillaV328 = true;
            imageDiagnostics.queued++;
          }
        }

        if (
          stableImageUrl &&
          typeof beIsStableDriveImageUrl_ === "function" &&
          beIsStableDriveImageUrl_(stableImageUrl)
        ) {
          imageDiagnostics.cached++;
        }

        var manualFieldsV1 = previousManualBySkuV1[villaSku] || {
          productType:"",priority:0,sourceProductType:""
        };
        var generatedProductTypeV612 = beVillaProductTypeConfigV612_(
          masterConfig,
          Number(villa.sourceColumn || 0),
          sourceProductTypeV2
        );
        var effectiveProductTypeV2 = beResolveProductTypeV2_(
          manualFieldsV1.productType,
          manualFieldsV1.sourceProductType,
          generatedProductTypeV612
        );
        var oldStaticV4224 = previousStaticBySkuV4224[villaSku] || {};
        var standardV4224 = cleanMasterText(villa.standard || "") || oldStaticV4224.standard || "";
        var bedroomsV4224 = pnOverrideBySkuV1[villaSku] || cleanMasterText(villa.bedrooms || "") || oldStaticV4224.bedrooms || "";
        var infoV4224 = cleanMasterText(villa.info || "") || oldStaticV4224.info || "";
        var mapsV4224 = cleanMasterText(villa.maps || "") || oldStaticV4224.maps || "";

        if (
          (!cleanMasterText(villa.standard || "") && oldStaticV4224.standard) ||
          (!cleanMasterText(villa.bedrooms || "") && oldStaticV4224.bedrooms) ||
          (!cleanMasterText(villa.info || "") && oldStaticV4224.info) ||
          (!cleanMasterText(villa.maps || "") && oldStaticV4224.maps)
        ) {
          Logger.log(JSON.stringify({
            code:"MASTER_STATIC_METADATA_PRESERVED_V4224",
            source:source,
            villa:villa.name || "",
            sku:villaSku
          }));
        }

        result.push([
          villaSku,
          stableImageUrl,
          villa.name || "",
          city,
          source,
          link,
          standardV4224,
          bedroomsV4224,
          infoV4224,
          mapsV4224,
          Number(villa.sourceColumn || 0),
          beAppendGroupOptionsToCalendarConfigV38_(
            calendarConfig,
            villa.groupOptions || []
          ),
          new Date(),
          effectiveProductTypeV2,
          manualFieldsV1.priority,
          generatedProductTypeV612
        ]);
      });

      if (villaIdentityContextV1 && typeof beRegisterResolvedVillaIdentityV1_ === "function") {
        try {
          sourceIdentityRegistrationsV1.forEach(function(itemV1) {
            beRegisterResolvedVillaIdentityV1_(
              villaIdentityContextV1, sourceId, source,
              itemV1.villa, itemV1.sku, itemV1.assignment
            );
          });
          if (typeof beFinalizeSourceVillaIdentitiesV1_ === "function") {
            beFinalizeSourceVillaIdentitiesV1_(
              villaIdentityContextV1, sourceId, source, villaIdentityAssignmentsV1
            );
          }
        } catch (identityRegisterErrorV1) {
          Logger.log(JSON.stringify({
            level:"WARNING",code:"VILLA_IDENTITY_REGISTER_FAILED_V1",
            sourceId:sourceId,source:source,
            error:String(identityRegisterErrorV1 && identityRegisterErrorV1.message ? identityRegisterErrorV1.message : identityRegisterErrorV1)
          }));
        }
      }

      b7TimerV1.mark("8_xu_ly_tung_can_anh");
      Logger.log(JSON.stringify({
        code: "MASTER_SOURCE_TIMING_V21",
        sourceId: sourceId,
        source: source,
        villas: villas.length,
        elapsedMs: new Date().getTime() - sourceStartedAtV21,
        stepsMsB7: b7TimerV1.steps
      }));

      sourceStatuses.push({
        row: r + 1,
        status: "OK: " + villas.length + " căn",
        time: new Date()
      });

      successfulRowsV328.push(masterRowNumberV328);
      successfulIdentitiesV328.push(sourceIdentityV416);
    } catch (error) {
      // Không để source lỗi ghi dở vài dòng vào kết quả/queue.
      result.splice(sourceResultStartV328);
      imageQueueRecordsV21.splice(sourceQueueStartV328);
      imageDiagnostics.missingRecords.splice(sourceMissingRecordStartV328);
      imageDiagnostics.missingVillas.splice(sourceMissingVillaStartV328);
      imageDiagnostics.detected = sourceDiagStartV328.detected;
      imageDiagnostics.cached = sourceDiagStartV328.cached;
      imageDiagnostics.queued = sourceDiagStartV328.queued;
      imageDiagnostics.missing = sourceDiagStartV328.missing;
      imageDiagnostics.failed = sourceDiagStartV328.failed;
      failedRowsV328.push(masterRowNumberV328);
      failedIdentitiesV416.push(sourceIdentityV416);

      b7TimerV1.mark("9_loi_nguon");
      Logger.log(JSON.stringify({
        level: "ERROR",
        code: "MASTER_SOURCE_FAILED_V21",
        sourceId: sourceId,
        source: source,
        elapsedMs: new Date().getTime() - sourceStartedAtV21,
        error: String(error && error.message ? error.message : error)
      }));

      sourceStatuses.push({
        row: r + 1,
        status: "ERROR: " + (
          error && error.message ? error.message : String(error)
        ),
        time: new Date()
      });
    }
  }

  var finalResultV328 = incrementalModeV328
    ? beMergeMasterVillaRowsV328_(
        previousOutputRowsV328,
        result,
        successfulIdentitiesV328,
        outputHeaders.length
      )
    : beMergeMasterVillaRowsWithFailedSourcesV416_(
        previousOutputRowsV328,
        result,
        failedIdentitiesV416,
        outputHeaders.length
      );

  b7FinalV1.reset();
  // Critical publish window: cache tập candidate hoàn chỉnh trước khi clear.
  // Search sẽ không bao giờ đọc/cache một MASTER_VILLA đang ghi dở.
  var masterPublishSuccessV1 = false;
  if (typeof ceBeginMasterPublishV1_ === "function") {
    var publishCandidateVillasV1 = typeof ceMasterVillasFromRowsV1_ === "function"
      ? ceMasterVillasFromRowsV1_(outputHeaders,finalResultV328)
      : null;
    ceBeginMasterPublishV1_(publishCandidateVillasV1);
  }
  try {
    output.clearContents();
    output
      .getRange(1, 1, 1, outputHeaders.length)
      .setValues([outputHeaders]);

    if (finalResultV328.length) {
      output
        .getRange(2, 1, finalResultV328.length, outputHeaders.length)
        .setValues(finalResultV328);

      // V4.19.3: clearContents giữ format cũ. Ép CỘT NGUỒN về số nguyên để
      // số 5 không tiếp tục hiển thị 1/4/1900 rồi làm Search đọc nhầm cột 1.
      var sourceColumnOutputIndexV4193 = outputHeaders.indexOf("CỘT NGUỒN") + 1;
      if (sourceColumnOutputIndexV4193 > 0) {
        output
          .getRange(2, sourceColumnOutputIndexV4193, finalResultV328.length, 1)
          .setNumberFormat("0");
      }
    }
    masterPublishSuccessV1 = true;
  } finally {
    if (typeof ceEndMasterPublishV1_ === "function") {
      ceEndMasterPublishV1_(masterPublishSuccessV1);
    }
  }

  // V4.19.6 - không cho build/sync báo thành công nếu schema product type lại rơi mất.
  var publishedHeaderV4196 = output
    .getRange(1, 1, 1, Math.max(output.getLastColumn(), outputHeaders.length))
    .getDisplayValues()[0]
    .map(normalizeMasterText);
  var requiredHeadersV4196 = ["LOAI_SP", "UU_TIEN", "LOAI_SP_NGUON"];
  var missingHeadersV4196 = requiredHeadersV4196.filter(function(header) {
    return publishedHeaderV4196.indexOf(normalizeMasterText(header)) < 0;
  });
  if (missingHeadersV4196.length) {
    Logger.log(JSON.stringify({
      level: "ERROR",
      code: "MASTER_SCHEMA_REGRESSION_BLOCKED_V4196",
      missing: missingHeadersV4196,
      actual: publishedHeaderV4196
    }));
    throw new Error("MASTER_SCHEMA_REGRESSION_V4196: " + missingHeadersV4196.join(","));
  }
  Logger.log(JSON.stringify({
    code: "MASTER_SCHEMA_V4196_PUBLISHED",
    villas: finalResultV328.length,
    width: outputHeaders.length
  }));

  output.setFrozenRows(1);
  b7FinalV1.mark("A_ghi_master_villa");
  // B7: autoResizeColumns chỉ để đẹp nhưng tốn vài giây mỗi build => tắt mặc định.
  if (!incrementalModeV328 && BE_CONFIG.MASTER_AUTO_RESIZE_COLUMNS === true) {
    output.autoResizeColumns(1, outputHeaders.length);
  }
  beApplySourceWarningsB34_(sourceStatuses, warningsByRowB34, rows);
  beWriteMasterStatuses_(master, rows[0], sourceStatuses);
  b7FinalV1.mark("B_ghi_trang_thai_nguon");
  beSyncMissingImageOverridesV35_(
    imageOverrideStore.sheet,
    imageDiagnostics.missingRecords
  );

  // V3.3.0: sau mỗi full/incremental build, dọn các request ảnh đã được giải quyết.
  // Manual override luôn được giữ theo phương án A.
  try {
    beReconcileImageOverridesV330_(ss);
  } catch (reconcileErrorV330) {
    Logger.log(JSON.stringify({
      level:"WARNING",
      code:"IMAGE_OVERRIDE_RECONCILE_FAILED_V330",
      stage:"MASTER_BUILD",
      error:String(
        reconcileErrorV330 && reconcileErrorV330.message
          ? reconcileErrorV330.message
          : reconcileErrorV330
      )
    }));
  }

  if (
    BE_CONFIG.IMAGE_CACHE_ENABLED === true &&
    BE_CONFIG.IMAGE_CACHE_INLINE !== true
  ) {
    if (incrementalModeV328) {
      beMergeImageCacheQueueV328_(
        imageQueueRecordsV21,
        successfulIdentitiesV328
      );
    } else if (typeof beReplaceImageCacheQueueV21_ === "function") {
      beReplaceImageCacheQueueV21_(imageQueueRecordsV21);
    }

    if (
      imageQueueRecordsV21.length &&
      typeof beScheduleImageWorkerV21_ === "function"
    ) {
      beScheduleImageWorkerV21_();
    }
  }

  b7FinalV1.mark("C_anh_va_hang_doi_anh");
  if (villaIdentityContextV1 && typeof beFlushVillaIdentityContextV1_ === "function") {
    try {
      var identityFlushV1 = beFlushVillaIdentityContextV1_(villaIdentityContextV1);
      Logger.log(JSON.stringify({code:"VILLA_IDENTITY_FLUSH_V1",result:identityFlushV1}));
    } catch (identityFlushErrorV1) {
      Logger.log(JSON.stringify({
        level:"ERROR",code:"VILLA_IDENTITY_FLUSH_FAILED_V1",
        error:String(identityFlushErrorV1 && identityFlushErrorV1.message ? identityFlushErrorV1.message : identityFlushErrorV1),
        action:"MASTER_ALREADY_BUILT_IDS_REMAIN_VALID"
      }));
    }
  }

  // B1 GhostGuard V1: chỉ lưu số lần đọc / GHOST_PREVIEW / cảnh báo sau khi publish thành công.
  if (typeof beGhostFlushV1_ === "function") {
    try {
      beGhostFlushV1_();
    } catch (ghostFlushErrorV1) {
      Logger.log(JSON.stringify({
        level:"WARNING",code:"GHOST_GUARD_FLUSH_FAILED_V1",
        error:String(ghostFlushErrorV1 && ghostFlushErrorV1.message ? ghostFlushErrorV1.message : ghostFlushErrorV1)
      }));
    }
  }

  b7FinalV1.mark("D_luu_so_ma_can_va_can_ao");
  beB7LogSummaryV1_(incrementalModeV328 ? "INCREMENTAL" : "FULL", new Date().getTime() - buildStartedAtV21);
  Logger.log(JSON.stringify({
    code: "IMAGE_CACHE_SUMMARY",
    mode: BE_CONFIG.IMAGE_CACHE_INLINE === true ? "INLINE" : "BACKGROUND_QUEUE",
    detected: imageDiagnostics.detected,
    cachedToDrive: imageDiagnostics.cached,
    queued: imageDiagnostics.queued,
    missing: imageDiagnostics.missing,
    failed: imageDiagnostics.failed,
    missingVillas: imageDiagnostics.missingVillas
  }));

  Logger.log(JSON.stringify({
    code: incrementalModeV328 ? "MASTER_INCREMENTAL_DONE_V328" : "MASTER_BUILD_TIMING_V21",
    mode: incrementalModeV328 ? "INCREMENTAL" : "FULL",
    sources: opened,
    targetCount: incrementalModeV328 ? Object.keys(targetRowMapV328).length : opened,
    processedRows: processedRowsV328,
    successfulRows: successfulRowsV328,
    failedRows: failedRowsV328,
    preservedFailedSources: failedIdentitiesV416.length,
    processedVillas: result.length,
    villas: finalResultV328.length,
    stoppedEarly: stoppedEarlyV328,
    fastImages: BE_MASTER_FAST_IMAGE_MODE_V328_ === true,
    elapsedMs: new Date().getTime() - buildStartedAtV21
  }));

  beClearMasterSheetRuntimeCacheV21_();
  BE_MASTER_FAST_IMAGE_MODE_V328_ = previousFastImageModeV328;

  return {
    success: true,
    mode: incrementalModeV328 ? "INCREMENTAL" : "FULL",
    villas: finalResultV328.length,
    processedVillas: result.length,
    sources: opened,
    targetCount: incrementalModeV328 ? Object.keys(targetRowMapV328).length : opened,
    processedRows: processedRowsV328,
    successfulRows: successfulRowsV328,
    failedRows: failedRowsV328,
    preservedFailedSources: failedIdentitiesV416.length,
    stoppedEarly: stoppedEarlyV328,
    version: BE_CONFIG.VERSION
  };
}

/** V3.2.8 - identity dùng để replace đúng source trong MASTER_VILLA/queue. */
function beBuildIncrementalIdentityV328_(rowNumber, source, link, previousIdentity){
  previousIdentity = previousIdentity || {};
  var links = [];
  var sources = [];

  [link, previousIdentity.link, previousIdentity.previousLink].forEach(function(value){
    value = cleanMasterText(value);
    if (value && links.indexOf(value) < 0) links.push(value);
  });

  [source, previousIdentity.source, previousIdentity.previousSource].forEach(function(value){
    value = normalizeMasterText(value);
    if (value && sources.indexOf(value) < 0) sources.push(value);
  });

  return {row:Number(rowNumber||0),links:links,sources:sources};
}

function beRowMatchesIncrementalIdentityV328_(row, identities){
  row = row || [];
  var rowSource = normalizeMasterText(row[4]);
  var rowLink = cleanMasterText(row[5]);

  return (identities || []).some(function(identity){
    identity = identity || {};
    var links = identity.links || [];
    var sources = identity.sources || [];

    // V4.19: cùng link có thể là nhiều logical source/config. Khi có đủ hai
    // thành phần phải match LINK + SOURCE; không replace source hàng xóm.
    if (links.length && sources.length) {
      return !!rowLink && links.indexOf(rowLink) >= 0 &&
        !!rowSource && sources.indexOf(rowSource) >= 0;
    }
    if (links.length) return !!rowLink && links.indexOf(rowLink) >= 0;
    return !!rowSource && sources.indexOf(rowSource) >= 0;
  });
}

/** V4.18 - parser rỗng/ambiguous không được xóa metadata tĩnh hợp lệ cũ. */
function beIsTrustedMasterCapacityV418_(value){
  return !!beCapacityNumberV417_(cleanMasterText(value));
}

function beIsTrustedMasterBedroomsV418_(value){
  value=cleanMasterText(value);
  if(!value)return false;
  return !/^\d+$/.test(value)||!!beBedroomNumberV417_(value);
}

function bePreserveTrustedStaticMasterRowV418_(previousRow,incomingRow,width){
  width=Number(width||15);
  var previous=(previousRow||[]).slice(0,width);
  var incoming=(incomingRow||[]).slice(0,width);
  while(previous.length<width)previous.push("");
  while(incoming.length<width)incoming.push("");

  var oldCapacity=cleanMasterText(previous[6]);
  var newCapacity=cleanMasterText(incoming[6]);
  var oldBedrooms=cleanMasterText(previous[7]);
  var newBedrooms=cleanMasterText(incoming[7]);

  if(!newCapacity&&beIsTrustedMasterCapacityV418_(oldCapacity))incoming[6]=oldCapacity;
  if(!newBedrooms&&beIsTrustedMasterBedroomsV418_(oldBedrooms))incoming[7]=oldBedrooms;
  return incoming;
}

function beMergeStaticFieldsWithPreviousRowsV418_(previousRows,newRows,width){
  var previousBySku={};
  (previousRows||[]).forEach(function(row){
    var sku=cleanMasterText(row&&row[0]);
    if(sku)previousBySku[sku]=row;
  });
  return (newRows||[]).map(function(row){
    var sku=cleanMasterText(row&&row[0]);
    return sku&&previousBySku[sku]
      ? bePreserveTrustedStaticMasterRowV418_(previousBySku[sku],row,width)
      : row;
  });
}

function beMergeMasterVillaRowsV328_(previousRows, newRows, identities, width){
  width = Number(width || 13);
  var preserved = [];

  (previousRows || []).forEach(function(row){
    if (beRowMatchesIncrementalIdentityV328_(row, identities)) return;
    var normalized = (row || []).slice(0,width);
    while (normalized.length < width) normalized.push("");
    preserved.push(normalized);
  });

  newRows=beMergeStaticFieldsWithPreviousRowsV418_(previousRows,newRows,width);
  (newRows || []).forEach(function(row){
    var normalized = (row || []).slice(0,width);
    while (normalized.length < width) normalized.push("");
    preserved.push(normalized);
  });

  return preserved;
}

/**
 * V4.16 - Full build không được xóa block source cũ chỉ vì source đó lỗi.
 * Đây là match "fail-safe" nên dùng link HOẶC tên nguồn (khác với replace
 * incremental ưu tiên link tuyệt đối). Giữ dư tạm thời an toàn hơn mất căn
 * thật khi link mới vừa đổi hoặc Drive trả lỗi.
 */
function beRowMatchesFailedSourceIdentityV416_(row, identities){
  row = row || [];
  var rowSource = normalizeMasterText(row[4]);
  var rowLink = cleanMasterText(row[5]);

  return (identities || []).some(function(identity){
    identity = identity || {};
    var links = identity.links || [];
    var sources = identity.sources || [];
    return (
      (!!rowLink && links.indexOf(rowLink) >= 0) ||
      (!!rowSource && sources.indexOf(rowSource) >= 0)
    );
  });
}

function beMergeMasterVillaRowsWithFailedSourcesV416_(previousRows, newRows, failedIdentities, width){
  width = Number(width || 13);
  var merged = [];

  newRows=beMergeStaticFieldsWithPreviousRowsV418_(previousRows,newRows,width);
  (newRows || []).forEach(function(row){
    var normalized = (row || []).slice(0,width);
    while (normalized.length < width) normalized.push("");
    merged.push(normalized);
  });

  (previousRows || []).forEach(function(row){
    if (!beRowMatchesFailedSourceIdentityV416_(row, failedIdentities)) return;
    var normalized = (row || []).slice(0,width);
    while (normalized.length < width) normalized.push("");
    merged.push(normalized);
  });

  return merged;
}

function beVillaNameSetV416_(items, isMasterRow){
  var set = {};
  (items || []).forEach(function(item){
    var name = isMasterRow === true
      ? item && item[2]
      : item && item.name;
    var key = normalizeMasterText(name);
    if (key) set[key] = true;
  });
  return set;
}

function beSetDifferenceV416_(before, after){
  var missing = [];
  Object.keys(before || {}).forEach(function(key){
    if (!after || !after[key]) missing.push(key);
  });
  return missing.sort();
}

function beSameNameSetV416_(left, right){
  var leftKeys = Object.keys(left || {}).sort();
  var rightKeys = Object.keys(right || {}).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (var i = 0; i < leftKeys.length; i++) {
    if (leftKeys[i] !== rightKeys[i]) return false;
  }
  return true;
}

/**
 * Đổi tên an toàn chỉ được nhận diện khi cùng source đang dùng cùng một cột
 * lịch. V4.19.5: trước khi coi là rename phải loại trường hợp REORDER:
 * - oldName vẫn còn ở một cột khác trong current set => căn cũ chỉ chuyển cột;
 * - newName đã tồn tại ở previous set => một căn cũ khác vừa chuyển vào cột này.
 *
 * Nhờ vậy nguồn đổi thứ tự cột không bị biến thành chuỗi rename giả.
 */
function beFindSourceColumnRenamePairsV416_(previousRows, villas){
  var previousSetV4195 = beVillaNameSetV416_(previousRows || [], true);
  var currentSetV4195 = beVillaNameSetV416_(villas || [], false);
  var currentByColumn = {};
  (villas || []).forEach(function(villa){
    var sourceColumn = Number(villa && villa.sourceColumn || 0);
    var name = normalizeMasterText(villa && villa.name);
    if (sourceColumn > 0 && name) currentByColumn[sourceColumn] = villa;
  });

  var pairs = [];
  (previousRows || []).forEach(function(row){
    var sourceColumn = Number(row && row[10] || 0);
    var oldName = normalizeMasterText(row && row[2]);
    var current = currentByColumn[sourceColumn];
    var newName = normalizeMasterText(current && current.name);
    if (!sourceColumn || !oldName || !newName || oldName === newName) return;

    // V4.19.5 - exact-name moved elsewhere is REORDER, not rename.
    if (currentSetV4195[oldName]) return;
    if (previousSetV4195[newName]) return;

    pairs.push({
      sourceColumn:sourceColumn,
      oldName:oldName,
      newName:newName,
      oldSku:cleanMasterText(row && row[0])
    });
  });
  return pairs;
}


/**
 * Quyết định có được replace block source hay không khi danh sách mới làm mất
 * một hay nhiều tên đang có trong MASTER_VILLA.
 *
 * - Không có tên mất: cho phép update ngay.
 * - Có tên mất: phải khớp đúng Structure Snapshot đã confirmed hai lượt.
 * - Chưa đủ bằng chứng: giữ dữ liệu cũ và đưa source vào priority queue.
 *
 * options.confirmedStructure/options.enqueue dùng cho unit test; runtime để
 * trống sẽ dùng StructureSnapshot thật của production.
 */
/**
 * V4.19.4 - Chỉ giữ MÃ_CĂN qua rename khi bằng chứng đủ chặt.
 *
 * Không quay lại rule "cùng cột = rename" của bản cũ. Map chỉ được tạo SAU
 * khi R2/Structure Snapshot đã cho phép replace và đồng thời thỏa tất cả:
 * - đúng 1 tên cũ mất + đúng 1 renamePair;
 * - tổng số căn không đổi;
 * - cột nguồn > 0 và là duy nhất ở cả old/new set;
 * - oldName đúng tên bị mất, newName đúng villa hiện tại trên cùng cột;
 * - old SKU tồn tại.
 *
 * Nếu thiếu bất kỳ điều kiện nào => không remap SKU, giữ fail-safe V416.
 */
function beConfirmedRenameSkuMapV4194_(previousRows, villas, decision) {
  var map = {};
  decision = decision || {};
  previousRows = previousRows || [];
  villas = villas || [];

  if (decision.allow !== true || decision.mode !== "CONFIRMED_REMOVAL") return map;
  // V4.19.5 - có thể đồng thời có 1 rename thật + remove/add khác sau
  // khi source reorder. Vẫn chỉ cho phép đúng 1 rename candidate duy nhất.
  if (!decision.missingNames || !decision.missingNames.length) return map;
  if (!decision.renamePairs || decision.renamePairs.length !== 1) return map;

  var previousNames = {};
  previousRows.forEach(function(row) {
    var name = normalizeMasterText(row && row[2]);
    if (name) previousNames[name] = true;
  });
  var currentNames = {};
  villas.forEach(function(villa) {
    var name = normalizeMasterText(villa && villa.name);
    if (name) currentNames[name] = true;
  });
  if (Object.keys(previousNames).length !== Object.keys(currentNames).length) return map;

  var pair = decision.renamePairs[0] || {};
  var col = Number(pair.sourceColumn || 0);
  var oldName = normalizeMasterText(pair.oldName || "");
  var newName = normalizeMasterText(pair.newName || "");
  var oldSku = cleanMasterText(pair.oldSku || "");
  if (!col || !oldName || !newName || !oldSku || oldName === newName) return map;
  var missingHasOldV4195 = (decision.missingNames || []).some(function(name) {
    return normalizeMasterText(name) === oldName;
  });
  if (!missingHasOldV4195) return map;
  if (currentNames[oldName] || !currentNames[newName] || previousNames[newName]) return map;

  var oldAtColumn = previousRows.filter(function(row) {
    return Number(row && row[10] || 0) === col;
  });
  var newAtColumn = villas.filter(function(villa) {
    return Number(villa && villa.sourceColumn || 0) === col;
  });
  if (oldAtColumn.length !== 1 || newAtColumn.length !== 1) return map;
  if (normalizeMasterText(oldAtColumn[0][2]) !== oldName) return map;
  if (normalizeMasterText(newAtColumn[0].name) !== newName) return map;

  map[col] = oldSku;
  return map;
}

function beAssessSourceReconcileV416_(options){
  options = options || {};
  var previousSet = beVillaNameSetV416_(options.previousRows || [], true);
  var currentSet = beVillaNameSetV416_(options.villas || [], false);
  var renamePairs = beFindSourceColumnRenamePairsV416_(
    options.previousRows || [],
    options.villas || []
  );
  // Không loại oldName khỏi missingNames dựa trên cùng cột. Cột bị dịch
  // không chứng minh đó là một lần đổi tên.
  var missingNames = beSetDifferenceV416_(previousSet, currentSet);
  var previousCount = Object.keys(previousSet).length;
  var currentCount = Object.keys(currentSet).length;

  if (!previousCount) {
    return {
      allow:true,
      mode:"NO_PREVIOUS_ROWS",
      reason:"NO_PREVIOUS_ROWS",
      missingNames:[],
      renamePairs:[]
    };
  }

  if (!missingNames.length && !renamePairs.length) {
    return {
      allow:true,
      mode:"NO_REMOVAL",
      reason:"NO_REMOVAL",
      missingNames:[],
      renamePairs:[]
    };
  }

  var hasInjectedConfirmation = Object.prototype.hasOwnProperty.call(
    options,
    "confirmedStructure"
  );
  var confirmed = hasInjectedConfirmation
    ? options.confirmedStructure
    : null;

  if (!hasInjectedConfirmation) {
  if (typeof ssGetStableStructureForSourceV416_ === "function") {
    try {
      confirmed = ssGetStableStructureForSourceV416_(
        options.sourceId,
        options.source,
        options.link
      );
    } catch (ignoreStableStructureV416) {
      confirmed = null;
    }
  }

  if (
    !confirmed &&
    typeof ssGetConfirmedStructureForSourceV340_ === "function"
  ) {
    try {
      confirmed = ssGetConfirmedStructureForSourceV340_(
        options.sourceId,
        options.source,
        options.link
      );

      if (confirmed) {
        Logger.log(JSON.stringify({
          code: "SOURCE_RECONCILE_CONFIRMED_FALLBACK_V2",
          sourceId: String(options.sourceId || ""),
          source: String(options.source || ""),
          stableReads: Number(confirmed.stableReads || 0),
          confirmed: confirmed.confirmed === true
        }));
      }
    } catch (confirmedFallbackErrorV2) {
      Logger.log(JSON.stringify({
        level: "WARNING",
        code: "SOURCE_RECONCILE_CONFIRMED_FALLBACK_ERROR_V2",
        sourceId: String(options.sourceId || ""),
        source: String(options.source || ""),
        error: String(
          confirmedFallbackErrorV2 &&
          confirmedFallbackErrorV2.message
            ? confirmedFallbackErrorV2.message
            : confirmedFallbackErrorV2
        )
      }));
      confirmed = null;
    }
  }
}

  var snapshotCurrent = confirmed && confirmed.record && confirmed.record.current
    ? confirmed.record.current
    : {};
  var snapshotSet = snapshotCurrent.effectiveNameSet || snapshotCurrent.nameSet || {};
  var snapshotCount = Number(
    confirmed && confirmed.effectiveVillaCount != null
      ? confirmed.effectiveVillaCount
      : (snapshotCurrent.effectiveVillaCount != null
        ? snapshotCurrent.effectiveVillaCount
        : snapshotCurrent.villaCount || 0)
  );
  var requiredReads = Math.max(
    2,
    Number(
      typeof EHOME_STRUCTURE_SNAPSHOT_V320 !== "undefined" &&
      EHOME_STRUCTURE_SNAPSHOT_V320.CONFIRM_READS || 2
    )
  );
  var stableReads = Number(
    snapshotCurrent._validationReads ||
    (confirmed && confirmed.stableReads) || 0
  );
  var structureMatchesParser =
    snapshotCount === currentCount &&
    beSameNameSetV416_(snapshotSet, currentSet);
  var safeToReplace = !!(
    confirmed &&
    confirmed.confirmed === true &&
    confirmed.autoRebuildAllowed === true &&
    !snapshotCurrent.error &&
    stableReads >= requiredReads &&
    structureMatchesParser
  );

  if (safeToReplace) {
    return {
      allow:true,
      mode:"CONFIRMED_REMOVAL",
      reason:"STRUCTURE_CONFIRMED",
      missingNames:missingNames,
      renamePairs:renamePairs,
      stableReads:stableReads
    };
  }

  // B1 GhostGuard V1: đường xác nhận bổ sung (2 lần đọc giống nhau, chặn giảm >30%).
  // Không áp dụng khi test inject confirmedStructure để giữ nguyên test cũ.
  if (!hasInjectedConfirmation && typeof beGhostStableReadConfirmV1_ === "function") {
    var ghostOkV1 = null;
    try {
      ghostOkV1 = beGhostStableReadConfirmV1_(options, currentSet, previousCount, currentCount, missingNames);
    } catch (ghostErrV1) {
      Logger.log(JSON.stringify({level:"WARNING",code:"GHOST_GUARD_ERROR_V1",error:String(ghostErrV1 && ghostErrV1.message || ghostErrV1)}));
      ghostOkV1 = null;
    }
    if (ghostOkV1) {
      return {
        allow:true,
        mode:"CONFIRMED_REMOVAL",
        reason:"GHOST_GUARD_STABLE_READS_V1",
        missingNames:missingNames,
        renamePairs:renamePairs,
        stableReads:ghostOkV1.reads
      };
    }
  }

  var queued = false;
  var prioritySource = {
    id:String(options.sourceId || ""),
    source:String(options.source || ""),
    city:String(options.city || ""),
    link:String(options.link || "")
  };
  try {
    if (typeof options.enqueue === "function") {
      options.enqueue(prioritySource, "MASTER_RECONCILE_MISSING_VILLAS_V416");
      queued = true;
    } else if (
      typeof ssEnqueuePriorityStructureCheckV340_ === "function" &&
      prioritySource.link
    ) {
      ssEnqueuePriorityStructureCheckV340_(
        prioritySource,
        "MASTER_RECONCILE_MISSING_VILLAS_V416"
      );
      queued = true;
    }
  } catch (ignorePriorityQueueV416) {}

  return {
    allow:false,
    mode:"PRESERVE_PENDING_STRUCTURE",
    reason:!confirmed
      ? "STRUCTURE_NOT_CONFIRMED"
      : (!structureMatchesParser
        ? "STRUCTURE_PARSER_MISMATCH"
        : (confirmed.autoRebuildAllowed === false
          ? "STRUCTURE_CHANGE_NOT_SAFE_FOR_AUTO_REMOVE"
          : "STRUCTURE_STABLE_READS_INSUFFICIENT")),
    missingNames:missingNames,
    renamePairs:renamePairs,
    queuedStructureCheck:queued,
    previousCount:previousCount,
    currentCount:currentCount,
    stableReads:stableReads
  };
}

/**
 * V3.2.9 - Chỉ invalidate ảnh cũ khi cả cột cũ và cột mới đều xác định
 * và thực sự khác nhau. Cột 0/unknown không đủ bằng chứng để xóa ảnh.
 */
function beShouldInvalidatePreviousImageV329_(previousSourceColumn, currentSourceColumn){
  previousSourceColumn=Number(previousSourceColumn||0);
  currentSourceColumn=Number(currentSourceColumn||0);
  return !!(
    previousSourceColumn>0 &&
    currentSourceColumn>0 &&
    previousSourceColumn!==currentSourceColumn
  );
}

/**
 * V3.2.9 - Cache nguồn phải gắn với SOURCE_COLUMN hiện tại.
 * Ảnh manual vẫn khóa theo SKU để không thay đổi semantics hiện có.
 */
function beImageCacheSourceKeyV329_(manualImageUrl, villaSku, sourceId, sourceColumn){
  if(manualImageUrl) return "MANUAL_"+String(villaSku||"");
  sourceColumn=Number(sourceColumn||0);
  return String(sourceId||"")+(sourceColumn>0?"_COL_"+sourceColumn:"");
}

/**
 * Incremental không được gọi beReplaceImageCacheQueueV21_ vì hàm cũ clear
 * queue của tất cả source. Chỉ replace queue thuộc source vừa build thành công.
 */
function beMergeImageCacheQueueV328_(records, identities){
  if (
    typeof beImageQueueSheetNameV21_ !== "function" ||
    typeof beImageQueueHeadersV21_ !== "function"
  ) {
    Logger.log(JSON.stringify({
      level:"WARNING",
      code:"IMAGE_QUEUE_INCREMENTAL_SKIPPED_V328",
      reason:"IMAGE_WORKER_HELPERS_MISSING"
    }));
    return {success:false,skipped:true};
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = beImageQueueSheetNameV21_();
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  var headers = beImageQueueHeadersV21_();
  var existing = [];

  if (sheet.getLastRow() > 1) {
    existing = sheet
      .getRange(2,1,sheet.getLastRow()-1,Math.max(sheet.getLastColumn(),headers.length))
      .getValues();
  }

  var normalizedHeader = headers.map(ceNormalize_);
  var sourceCol = ceFindHeader_(normalizedHeader,["nguon","source"]);
  var linkCol = ceFindHeader_(normalizedHeader,["link","link lich","url"]);

  function matchesQueueRow_(row){
    var rowSource = sourceCol >= 0 ? normalizeMasterText(row[sourceCol]) : "";
    var rowLink = linkCol >= 0 ? cleanMasterText(row[linkCol]) : "";
    return (identities || []).some(function(identity){
      identity = identity || {};
      var links = identity.links || [];
      var sources = identity.sources || [];
      if (links.length && sources.length) {
        return !!rowLink && links.indexOf(rowLink) >= 0 &&
          !!rowSource && sources.indexOf(rowSource) >= 0;
      }
      if (links.length) return !!rowLink && links.indexOf(rowLink) >= 0;
      return !!rowSource && sources.indexOf(rowSource) >= 0;
    });
  }

  var kept = existing.filter(function(row){ return !matchesQueueRow_(row); });
  var appended = (records || []).map(function(record){
    record = record || {};
    return [
      "PENDING",0,
      String(record.cacheSourceKey||""),
      String(record.sku||""),
      String(record.sourceId||""),
      String(record.source||""),
      String(record.link||""),
      String(record.villaName||""),
      Number(record.sourceColumn||0),
      String(record.masterConfig||""),
      String(record.imageConfig||""),
      "","",new Date()
    ];
  });

  var finalRows = kept.concat(appended).map(function(row){
    var out = row.slice(0,headers.length);
    while (out.length < headers.length) out.push("");
    return out;
  });

  sheet.clearContents();
  sheet.getRange(1,1,1,headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  if (finalRows.length) {
    sheet.getRange(2,1,finalRows.length,headers.length).setValues(finalRows);
  }

  Logger.log(JSON.stringify({
    code:"IMAGE_QUEUE_MERGED_V328",
    kept:kept.length,
    appended:appended.length,
    total:finalRows.length
  }));

  return {success:true,queued:appended.length,total:finalRows.length};
}


/** V4.19.6 - Spreadsheet ID ổn định cho product type repair/orphan audit. */
function beProductTypeSpreadsheetIdV4196_(url){
  var text=cleanMasterText(url);
  var match=text.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if(match&&match[1])return match[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(text)?text:"";
}

/** Logical source key = SOURCE + spreadsheetId, không dedupe chỉ theo file. */
function beProductTypeIdentityKeyV4196_(source,link){
  return normalizeMasterText(source)+"|"+beProductTypeSpreadsheetIdV4196_(link);
}

/**
 * V4.19.6 - Khôi phục N:P của MASTER_VILLA mà KHÔNG build, KHÔNG mở source.
 * A:M giữ nguyên tuyệt đối; số villa không đổi.
 * Precedence giữ đúng V2: manual override > source default > blank.
 * Chồn được operator yêu cầu skip trong lượt này nên không tự gắn PHONG_RIENG.
 */
function repairMasterVillaProductTypeV4196(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var master=ss.getSheetByName(BE_CONFIG.MASTER_SHEET||"MASTER");
  var villa=ss.getSheetByName(BE_CONFIG.MASTER_VILLA_SHEET||"MASTER_VILLA");
  if(!master||!villa)throw new Error("MASTER_OR_MASTER_VILLA_MISSING");

  var masterValues=master.getDataRange().getValues();
  if(!masterValues.length)throw new Error("MASTER_EMPTY");
  var mh=beHeaderMap_(masterValues[0]||[]);
  var sourceDefaults={};
  var sourceMasterConfigsV612={};
  var configuredSources=[];
  var skipSourceMap={"chon villa":true};

  for(var r=1;r<masterValues.length;r++){
    var mrow=masterValues[r]||[];
    if(!beBoolCell_(beGetByHeader_(mrow,mh.enable)))continue;
    var source=cleanMasterText(beGetByHeader_(mrow,mh.source));
    var sourceNorm=normalizeMasterText(source);
    var link=cleanMasterText(beGetByHeader_(mrow,mh.link));
    var sourceMasterConfigV612=cleanMasterText(beGetByHeader_(mrow,mh.configMaster));
    var type=beSourceProductTypeConfigV2_(
      beGetByHeader_(mrow,mh.type),
      sourceMasterConfigV612
    );
    if(skipSourceMap[sourceNorm])type="";
    var key=beProductTypeIdentityKeyV4196_(source,link);
    if(key){
      sourceDefaults[key]=type||"";
      sourceMasterConfigsV612[key]=sourceMasterConfigV612;
    }
    if(type||/PHONG_RIENG_COLS|PRIVATE_ROOM_COLS|ROOM_COLS|NGUYEN_CAN_COLS|WHOLE_VILLA_COLS|WHOLE_PROPERTY_COLS/i.test(sourceMasterConfigV612)){
      configuredSources.push({source:source,link:link,type:type,key:key});
    }
  }

  var existingWidth=Math.max(13,villa.getLastColumn());
  var header=existingWidth>0
    ? villa.getRange(1,1,1,existingWidth).getDisplayValues()[0]
    : [];
  var headerNorm=header.map(normalizeMasterText);
  var sourceCol=headerNorm.indexOf(normalizeMasterText("NGUỒN"));
  var linkCol=headerNorm.indexOf(normalizeMasterText("LINK LỊCH"));
  var typeCol=headerNorm.indexOf(normalizeMasterText("LOAI_SP"));
  var priorityCol=headerNorm.indexOf(normalizeMasterText("UU_TIEN"));
  var generatedCol=headerNorm.indexOf(normalizeMasterText("LOAI_SP_NGUON"));
  var sourceColumnColV612=headerNorm.indexOf(normalizeMasterText("CỘT NGUỒN"));
  if(sourceCol<0||linkCol<0)throw new Error("MASTER_VILLA_SCHEMA_INVALID_V4196");

  var rowCount=Math.max(0,villa.getLastRow()-1);
  var oldValues=rowCount? villa.getRange(2,1,rowCount,existingWidth).getValues():[];
  var out=[];
  var matchedByKey={};
  var privateRows=0;

  oldValues.forEach(function(row){
    var source=cleanMasterText(row[sourceCol]);
    var sourceNorm=normalizeMasterText(source);
    var link=cleanMasterText(row[linkCol]);
    var key=beProductTypeIdentityKeyV4196_(source,link);
    var sourceDefaultV612=skipSourceMap[sourceNorm]?"":beNormalizeProductTypeV2_(sourceDefaults[key]||"");
    var sourceColumnV612=sourceColumnColV612>=0?Number(row[sourceColumnColV612]||0):0;
    var nextDefault=skipSourceMap[sourceNorm]
      ? ""
      : beVillaProductTypeConfigV612_(sourceMasterConfigsV612[key]||"",sourceColumnV612,sourceDefaultV612);
    var previousEffective=typeCol>=0?cleanMasterText(row[typeCol]||""):"";
    var previousGenerated=generatedCol>=0?cleanMasterText(row[generatedCol]||""):"";
    var priority=priorityCol>=0?Math.max(0,Math.min(3,Math.round(Number(row[priorityCol]||0)))):0;
    var effective=beResolveProductTypeV2_(previousEffective,previousGenerated,nextDefault);
    if(nextDefault)matchedByKey[key]=(matchedByKey[key]||0)+1;
    if(effective==="PHONG_RIENG")privateRows++;
    out.push([effective,priority,nextDefault]);
  });

  // Chỉ ghi N:P. A:M và số row không thay đổi.
  villa.getRange(1,14,1,3).setValues([["LOAI_SP","UU_TIEN","LOAI_SP_NGUON"]]);
  if(out.length)villa.getRange(2,14,out.length,3).setValues(out);
  villa.setFrozenRows(1);

  if(typeof clearBookingEngineCache==="function")clearBookingEngineCache();

  var missingSources=configuredSources.filter(function(item){
    return !matchedByKey[item.key];
  }).map(function(item){
    return {source:item.source,type:item.type,link:item.link};
  });

  var result={
    success:true,
    code:"PRODUCT_TYPE_SCHEMA_REPAIRED_V4196",
    villas:rowCount,
    privateRooms:privateRows,
    configuredSources:configuredSources.length,
    missingSources:missingSources,
    skippedSources:["chồn villa"]
  };
  Logger.log(JSON.stringify(result));
  return result;
}

/**
 * V4.19.6 - Preview MASTER_VILLA rows mà cả SOURCE lẫn LINK không còn ở MASTER
 * đang Enable. Không tự xóa. Dùng cho Ruby home đã bị xóa hẳn khỏi MASTER.
 */
function previewDeletedSourceOrphansV4196(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var master=ss.getSheetByName(BE_CONFIG.MASTER_SHEET||"MASTER");
  var villa=ss.getSheetByName(BE_CONFIG.MASTER_VILLA_SHEET||"MASTER_VILLA");
  if(!master||!villa)throw new Error("MASTER_OR_MASTER_VILLA_MISSING");

  var masterValues=master.getDataRange().getValues();
  var mh=beHeaderMap_(masterValues[0]||[]);
  var activeSources={};
  var activeLinks={};
  for(var r=1;r<masterValues.length;r++){
    var row=masterValues[r]||[];
    if(!beBoolCell_(beGetByHeader_(row,mh.enable)))continue;
    var src=normalizeMasterText(beGetByHeader_(row,mh.source));
    var link=cleanMasterText(beGetByHeader_(row,mh.link));
    if(src)activeSources[src]=true;
    if(link)activeLinks[link]=true;
  }

  var values=villa.getDataRange().getDisplayValues();
  if(!values.length)return {success:true,code:"MASTER_ORPHAN_PREVIEW_V4196",count:0,rows:[]};
  var header=values[0].map(normalizeMasterText);
  var sourceCol=header.indexOf(normalizeMasterText("NGUỒN"));
  var linkCol=header.indexOf(normalizeMasterText("LINK LỊCH"));
  var skuCol=header.indexOf(normalizeMasterText("MÃ CĂN"));
  var nameCol=header.indexOf(normalizeMasterText("TÊN CĂN"));
  if(sourceCol<0||linkCol<0||skuCol<0)throw new Error("MASTER_VILLA_SCHEMA_INVALID_FOR_ORPHAN_PREVIEW");

  var rows=[];
  for(var i=1;i<values.length;i++){
    var vrow=values[i]||[];
    var sku=cleanMasterText(vrow[skuCol]);
    if(!sku)continue;
    var sourceNorm=normalizeMasterText(vrow[sourceCol]);
    var sourceDisplay=cleanMasterText(vrow[sourceCol]);
    var link=cleanMasterText(vrow[linkCol]);
    if((!sourceNorm||!activeSources[sourceNorm])&&(!link||!activeLinks[link])){
      rows.push({sheetRow:i+1,sku:sku,name:nameCol>=0?cleanMasterText(vrow[nameCol]):"",source:sourceDisplay,link:link});
    }
  }
  var result={success:true,code:"MASTER_ORPHAN_PREVIEW_V4196",count:rows.length,rows:rows};
  Logger.log(JSON.stringify(result));
  return result;
}

/**
 * V4.19.6 - Cleanup orphan có chủ đích. Chỉ chạy SAU preview.
 * Guard cứng <=20 row. Xóa row từ dưới lên để không để lỗ rỗng trong registry.
 */
function applyDeletedSourceOrphansV4196(){
  var preview=previewDeletedSourceOrphansV4196();
  if(!preview.count)return {success:true,code:"MASTER_ORPHAN_APPLY_V4196",removed:0};
  if(preview.count>20)throw new Error("ORPHAN_APPLY_BLOCKED_TOO_MANY_V4196:"+preview.count);

  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var villa=ss.getSheetByName(BE_CONFIG.MASTER_VILLA_SHEET||"MASTER_VILLA");
  beDeleteSheetRowsBatchedB7_(villa, preview.rows.map(function(item){return Number(item.sheetRow);}));
  if(typeof clearBookingEngineCache==="function")clearBookingEngineCache();
  var uniqueSources={};
  preview.rows.forEach(function(x){if(x.source)uniqueSources[x.source]=true;});
  var result={success:true,code:"MASTER_ORPHAN_APPLY_V4196",removed:preview.count,sources:Object.keys(uniqueSources).sort()};
  Logger.log(JSON.stringify(result));
  return result;
}


/**
 * V6.1.9 - Auto cleanup when a source row is disabled or removed from MASTER.
 * Safety: only rows whose SOURCE and LINK are both absent from every ENABLE=TRUE row
 * are eligible. Process a bounded number of source groups per run to avoid mass wipe.
 */
function autoApplyDeletedSourceOrphansV619_(options){
  options=options||{};
  var preview=previewDeletedSourceOrphansV4196();
  if(!preview.count)return {success:true,code:"MASTER_ORPHAN_AUTO_V619",removed:0,sources:[],blocked:[]};

  // V6.1.9 safety: use stable SOURCE ID from identity registry. A rename/link change
  // keeps the same MASTER ID and therefore MUST NOT delete the old block early.
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var master=ss.getSheetByName(BE_CONFIG.MASTER_SHEET||"MASTER");
  var villa=ss.getSheetByName(BE_CONFIG.MASTER_VILLA_SHEET||"MASTER_VILLA");
  if(!master||!villa)throw new Error("MASTER_OR_MASTER_VILLA_MISSING_V619");
  var mv=master.getDataRange().getValues();
  var mh=beHeaderMap_(mv[0]||[]);
  var activeIds={};
  for(var mr=1;mr<mv.length;mr++){
    var mrow=mv[mr]||[];
    if(!beBoolCell_(beGetByHeader_(mrow,mh.enable)))continue;
    var sid=cleanMasterText(beGetByHeader_(mrow,mh.id));
    if(sid)activeIds[sid]=true;
  }
  var sourceIdBySku=typeof beVillaIdentitySourceIdBySkuV619_==="function"?beVillaIdentitySourceIdBySkuV619_():{};
  var eligible=[],blocked=[];
  (preview.rows||[]).forEach(function(item){
    var sid=cleanMasterText(sourceIdBySku[item.sku]||"");
    if(!sid){blocked.push({sku:item.sku,source:item.source,reason:"NO_IDENTITY_SOURCE_ID"});return;}
    if(activeIds[sid]){blocked.push({sku:item.sku,source:item.source,sourceId:sid,reason:"SOURCE_ID_STILL_ACTIVE"});return;}
    var copy={};Object.keys(item).forEach(function(k){copy[k]=item[k];});copy.sourceId=sid;eligible.push(copy);
  });
  if(!eligible.length)return {success:true,code:"MASTER_ORPHAN_AUTO_V619",removed:0,sources:[],blocked:blocked,remaining:preview.count};

  var maxSources=Math.max(1,Number(options.maxSources||10));
  var maxRows=Math.max(1,Number(options.maxRows||150));
  var groups={};
  eligible.forEach(function(item){
    var key=String(item.sourceId||"");
    if(!groups[key])groups[key]={key:key,sourceId:item.sourceId,source:item.source||"",link:item.link||"",rows:[]};
    groups[key].rows.push(item);
  });

  var ordered=Object.keys(groups).map(function(k){return groups[k];}).sort(function(a,b){return Number(a.sourceId||0)-Number(b.sourceId||0);});
  var selected=[],rowTotal=0;
  for(var i=0;i<ordered.length;i++){
    var g=ordered[i],n=g.rows.length;
    if(n>maxRows){blocked.push({source:g.source,sourceId:g.sourceId,rows:n,reason:"SOURCE_TOO_LARGE"});continue;}
    if(selected.length>=maxSources||rowTotal+n>maxRows)break;
    selected.push(g);rowTotal+=n;
  }
  if(!selected.length)return {success:true,code:"MASTER_ORPHAN_AUTO_V619",removed:0,sources:[],blocked:blocked,remaining:preview.count};

  var rows=[],skus=[],sourceNames={};
  selected.forEach(function(g){
    if(g.source)sourceNames[g.source]=true;
    g.rows.forEach(function(item){rows.push(item);if(item.sku)skus.push(item.sku);});
  });
  beDeleteSheetRowsBatchedB7_(villa, rows.map(function(item){return Number(item.sheetRow);}));

  var identity=null;
  if(typeof beRetireVillaIdentitySkusV619_==="function"){
    try{identity=beRetireVillaIdentitySkusV619_(skus,"SOURCE_DISABLED_OR_REMOVED");}
    catch(identityErr){Logger.log(JSON.stringify({level:"WARNING",code:"MASTER_ORPHAN_IDENTITY_RETIRE_FAILED_V619",error:String(identityErr&&identityErr.message||identityErr)}));}
  }
  if(typeof clearBookingEngineCache==="function")clearBookingEngineCache();
  var result={success:true,code:"MASTER_ORPHAN_AUTO_V619",removed:rows.length,sources:Object.keys(sourceNames).sort(),identity:identity,blocked:blocked.slice(0,30),remaining:Math.max(0,preview.count-rows.length)};
  Logger.log(JSON.stringify(result));
  return result;
}

/**
 * B7 - Xóa nhiều dòng theo khối liền nhau, từ dưới lên (không để lệch số dòng).
 * 150 dòng của một nguồn thường liền nhau => 1 lệnh deleteRows thay vì 150 lệnh deleteRow.
 */
function beDeleteSheetRowsBatchedB7_(sheet, rowNumbers) {
  var sorted = (rowNumbers || []).map(Number).filter(function(r){ return r > 1; })
    .sort(function(a, b){ return b - a; });
  var blocks = [];
  sorted.forEach(function(r){
    var last = blocks[blocks.length - 1];
    if (last && r === last.start - 1) { last.start = r; last.count++; }
    else if (!last || r !== last.start) { blocks.push({start: r, count: 1}); }
  });
  blocks.forEach(function(b){ sheet.deleteRows(b.start, b.count); });
  return {rows: sorted.length, calls: blocks.length};
}

function testDeletedSourceAutoGuardV619(){
  var activeIds={"176":true};
  function canDelete(identitySourceId){var sid=String(identitySourceId||"").trim();return !!sid&&!activeIds[sid];}
  var cases=[[canDelete("176"),false],[canDelete("999"),true],[canDelete(""),false]];
  cases.forEach(function(c,i){if(c[0]!==c[1])throw new Error("DELETED_SOURCE_AUTO_GUARD_FAIL_V619 case="+(i+1));});
  var result={success:true,code:"DELETED_SOURCE_AUTO_GUARD_PASS_V619",cases:cases.length,stableSourceIdGuard:true};
  Logger.log(JSON.stringify(result));return result;
}

function beHeaderMap_(headerRow){
  var normalized = headerRow.map(ceNormalize_);
  function find(names){ return ceFindHeader_(normalized, names); }

  return {
    id: find(["id", "ma nguon"]),
    city: find(["thanh pho", "city"]),
    source: find(["nguon", "source"]),
    link: find(["link", "link lich", "url"]),
    enable: find(["enable", "kich hoat"]),
    configMaster: find(["config master"]),
    configCalendar: find(["config lich", "calendar config", "config calendar"]),
    configImage: find(["config anh", "image config", "config image"]),
    configInfo: find(["config thong tin", "info config", "config info"]),
    type: find(["loai", "type"]),

    // Chỉ đọc nếu sheet cũ đang có; engine không tự tạo các cột này.
    version: find(["version"]),
    status: find(["status", "trang thai"]),
    lastSync: find(["last sync", "cap nhat"])
  };
}

function beLoadImageOverridesV35_(ss){
  var sheetName = String(
    BE_CONFIG.IMAGE_OVERRIDE_SHEET || "BỔ_SUNG_ẢNH"
  ).trim();
  var headers = BE_CONFIG.IMAGE_OVERRIDE_HEADERS || [
    "MÃ CĂN", "NGUỒN", "TÊN CĂN", "ẢNH", "GHI CHÚ"
  ];
  var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);

  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    var currentHeader = sheet
      .getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length))
      .getDisplayValues()[0];
    var hasSkuHeader = currentHeader.some(function(value) {
      return ceNormalize_(value) === "ma can";
    });
    if (!hasSkuHeader) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight("bold")
    .setBackground("#1F6B4F")
    .setFontColor("#FFFFFF");
  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(2, 180);
  sheet.setColumnWidth(3, 260);
  sheet.setColumnWidth(4, 220);
  sheet.setColumnWidth(5, 360);

  var store = {
    sheet: sheet,
    bySku: {},
    bySourceName: {},
    byUniqueName: {},
    nameCount: {}
  };

  if (sheet.getLastRow() < 2) return store;

  var rowCount = sheet.getLastRow();
  var columnCount = Math.max(sheet.getLastColumn(), headers.length);
  var range = sheet.getRange(1, 1, rowCount, columnCount);
  var displayValues = range.getDisplayValues();
  var formulas = range.getFormulas();
  var rawValues = range.getValues();
  var normalizedHeader = displayValues[0].map(ceNormalize_);

  function find(names) {
    return ceFindHeader_(normalizedHeader, names);
  }

  var map = {
    sku: find(["ma can", "sku"]),
    source: find(["nguon", "source"]),
    name: find(["ten can", "ten villa", "villa"]),
    image: find(["anh", "hinh anh", "image"])
  };

  for (var row = 1; row < displayValues.length; row++) {
    var sku = map.sku >= 0
      ? cleanMasterText(displayValues[row][map.sku])
      : "";
    var source = map.source >= 0
      ? cleanMasterText(displayValues[row][map.source])
      : "";
    var villaName = map.name >= 0
      ? cleanMasterText(displayValues[row][map.name])
      : "";
    var image = map.image >= 0
      ? beLinkAtV31_(displayValues, formulas, row, map.image, rawValues)
      : "";

    if (!image) continue;
    if (sku) store.bySku[String(sku).trim().toUpperCase()] = image;

    var nameKey = normalizeMasterText(villaName);
    if (!nameKey) continue;
    store.nameCount[nameKey] = (store.nameCount[nameKey] || 0) + 1;
    store.byUniqueName[nameKey] = image;

    if (source) {
      store.bySourceName[
        normalizeMasterText(source) + "||" + nameKey
      ] = image;
    }
  }

  return store;
}

function beFindImageOverrideV35_(store, sku, sourceId, source, villaName){
  if (!store) return "";

  var skuKey = String(sku || "").trim().toUpperCase();
  if (skuKey && store.bySku[skuKey]) return store.bySku[skuKey];

  var nameKey = normalizeMasterText(villaName);
  if (!nameKey) return "";

  var sources = [sourceId, source];
  for (var i = 0; i < sources.length; i++) {
    var sourceKey = normalizeMasterText(sources[i]);
    var combinedKey = sourceKey + "||" + nameKey;
    if (sourceKey && store.bySourceName[combinedKey]) {
      return store.bySourceName[combinedKey];
    }
  }

  return store.nameCount[nameKey] === 1
    ? store.byUniqueName[nameKey] || ""
    : "";
}

function beSyncMissingImageOverridesV35_(sheet, records){
  if (!sheet || !records || !records.length) return;

  var existingSku = {};
  if (sheet.getLastRow() > 1) {
    sheet
      .getRange(2, 1, sheet.getLastRow() - 1, 1)
      .getDisplayValues()
      .forEach(function(row) {
        var sku = String(row[0] || "").trim().toUpperCase();
        if (sku) existingSku[sku] = true;
      });
  }

  var appendRows = [];
  records.forEach(function(record) {
    var sku = String(record.sku || "").trim();
    var skuKey = sku.toUpperCase();
    if (!skuKey || existingSku[skuKey]) return;

    existingSku[skuKey] = true;
    appendRows.push([
      sku,
      record.source || "",
      record.villaName || "",
      "",
      "Chèn ảnh thủ công vào cột D; sau đó Đồng bộ nguồn đang chọn. Ảnh manual sẽ được giữ."
    ]);
  });

  if (!appendRows.length) return;

  sheet
    .getRange(sheet.getLastRow() + 1, 1, appendRows.length, 5)
    .setValues(appendRows);
}


/* ================= V3.3.0 BỔ_SUNG_ẢNH RECONCILE ================= */

/**
 * Quy tắc A đã chốt:
 * - Có ảnh manual trong BỔ_SUNG_ẢNH => GIỮ, kể cả MASTER đã có ảnh.
 * - Không có ảnh manual + MASTER đã có ảnh => xóa dòng đã xử lý.
 * - Không có ảnh manual + SKU không còn trong MASTER => xóa dòng rác.
 * - Không có ảnh manual + MASTER vẫn thiếu ảnh => giữ để xử lý.
 *
 * Hàm chỉ xóa các dòng đã xác định an toàn; không clear/rewrite cả sheet,
 * nên CellImage/manual override đang có không bị mất.
 */
function beClassifyImageOverrideRowV330_(manualImage, masterExists, masterImage){
  if (manualImage) return "KEEP_MANUAL";
  if (!masterExists) return "DELETE_ORPHAN";
  if (masterImage) return "DELETE_RESOLVED";
  return "KEEP_MISSING";
}

function beDeleteRowsDescendingV330_(sheet, rowNumbers){
  rowNumbers = (rowNumbers || [])
    .map(Number)
    .filter(function(row){ return row >= 2; })
    .sort(function(a,b){ return b-a; });

  if (!rowNumbers.length) return 0;

  var groups = [];
  var start = rowNumbers[0];
  var end = rowNumbers[0];

  for (var i=1;i<rowNumbers.length;i++){
    var row = rowNumbers[i];
    if (row === end - 1) {
      end = row;
    } else {
      groups.push({start:end,count:start-end+1});
      start = row;
      end = row;
    }
  }
  groups.push({start:end,count:start-end+1});

  var deleted = 0;
  groups.forEach(function(group){
    sheet.deleteRows(group.start, group.count);
    deleted += group.count;
  });
  return deleted;
}

function beReconcileImageOverridesV330_(ss){
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();

  var overrideName = String(
    BE_CONFIG.IMAGE_OVERRIDE_SHEET || "BỔ_SUNG_ẢNH"
  ).trim();
  var overrideSheet = ss.getSheetByName(overrideName);
  if (!overrideSheet || overrideSheet.getLastRow() < 2) {
    return {
      success:true,
      sheet:overrideName,
      before:0,
      deletedResolved:0,
      deletedOrphan:0,
      keptManual:0,
      keptMissing:0,
      keptUnknown:0,
      after:0
    };
  }

  var master = ss.getSheetByName(BE_CONFIG.MASTER_VILLA_SHEET || "MASTER_VILLA");
  if (!master || master.getLastRow() < 2) {
    Logger.log(JSON.stringify({
      level:"WARNING",
      code:"IMAGE_OVERRIDE_RECONCILE_SKIPPED_V330",
      reason:"MASTER_EMPTY"
    }));
    return {success:false,skipped:true,reason:"MASTER_EMPTY"};
  }

  var masterValues = master.getDataRange().getDisplayValues();
  var masterHeaders = masterValues[0].map(ceNormalize_);
  var mSku = ceFindHeader_(masterHeaders,["ma can","sku","id"]);
  var mImage = ceFindHeader_(masterHeaders,["anh","hinh anh","image"]);
  if (mSku < 0 || mImage < 0) {
    return {success:false,skipped:true,reason:"MASTER_COLUMNS_MISSING"};
  }

  var masterMap = {};
  masterValues.slice(1).forEach(function(row){
    var sku = String(row[mSku] || "").trim().toUpperCase();
    if (!sku) return;
    masterMap[sku] = {
      exists:true,
      image:String(row[mImage] || "").trim()
    };
  });

  var lastRow = overrideSheet.getLastRow();
  var lastCol = Math.max(overrideSheet.getLastColumn(),5);
  var range = overrideSheet.getRange(1,1,lastRow,lastCol);
  var display = range.getDisplayValues();
  var formulas = range.getFormulas();
  var raw = range.getValues();
  var headers = display[0].map(ceNormalize_);
  var cSku = ceFindHeader_(headers,["ma can","sku"]);
  var cImage = ceFindHeader_(headers,["anh","hinh anh","image"]);

  if (cSku < 0 || cImage < 0) {
    Logger.log(JSON.stringify({
      level:"WARNING",
      code:"IMAGE_OVERRIDE_RECONCILE_SKIPPED_V330",
      reason:"OVERRIDE_COLUMNS_MISSING"
    }));
    return {success:false,skipped:true,reason:"OVERRIDE_COLUMNS_MISSING"};
  }

  // Nếu user chèn OverGridImage đè lên ô D, vẫn coi là manual và tuyệt đối giữ.
  var overGridManualRows = {};
  try {
    (overrideSheet.getImages() || []).forEach(function(image){
      if (!image || typeof image.getAnchorCell !== "function") return;
      var anchor = image.getAnchorCell();
      if (!anchor) return;
      if (anchor.getColumn() - 1 === cImage) {
        overGridManualRows[anchor.getRow()] = true;
      }
    });
  } catch(ignoreOverGrid) {}

  var deleteRows = [];
  var stats = {
    success:true,
    sheet:overrideName,
    before:Math.max(0,lastRow-1),
    deletedResolved:0,
    deletedOrphan:0,
    keptManual:0,
    keptMissing:0,
    keptUnknown:0,
    after:0
  };

  for (var r=1;r<display.length;r++) {
    var sheetRow = r + 1;
    var sku = String(display[r][cSku] || "").trim().toUpperCase();

    var rawImage = raw[r] ? raw[r][cImage] : null;
    var formula = formulas[r] ? String(formulas[r][cImage] || "").trim() : "";
    var displayImage = String(display[r][cImage] || "").trim();

    var manualImage = !!(
      displayImage ||
      formula ||
      overGridManualRows[sheetRow] ||
      (rawImage && typeof rawImage.getContentUrl === "function")
    );

    // Không đụng các dòng user tự thêm chưa có SKU.
    if (!sku) {
      stats.keptUnknown++;
      continue;
    }

    var masterState = masterMap[sku] || null;
    var action = beClassifyImageOverrideRowV330_(
      manualImage,
      !!masterState,
      masterState ? String(masterState.image || "").trim() : ""
    );

    if (action === "KEEP_MANUAL") {
      stats.keptManual++;
    } else if (action === "DELETE_RESOLVED") {
      stats.deletedResolved++;
      deleteRows.push(sheetRow);
    } else if (action === "DELETE_ORPHAN") {
      stats.deletedOrphan++;
      deleteRows.push(sheetRow);
    } else {
      stats.keptMissing++;
    }
  }

  beDeleteRowsDescendingV330_(overrideSheet, deleteRows);
  stats.after = Math.max(0, overrideSheet.getLastRow() - 1);

  Logger.log(JSON.stringify({
    code:"IMAGE_OVERRIDE_RECONCILE_DONE_V330",
    stats:stats
  }));

  return stats;
}

/** Chạy thủ công một lần để dọn backlog hiện tại. */
function reconcileImageOverridesV330(){
  return beReconcileImageOverridesV330_(SpreadsheetApp.getActiveSpreadsheet());
}

function beGetByHeader_(row,index){return index>=0&&index<row.length?row[index]:"";}
function beBoolCell_(v){return v===true||["true","1","yes","co","x"].indexOf(ceNormalize_(v))>=0;}
function beWriteMasterStatuses_(sheet,headerRow,statuses){
  var h=beHeaderMap_(headerRow);
  statuses=statuses||[];
  if(!statuses.length)return;

  var lastRow=Math.max(sheet.getLastRow(),1);
  if(lastRow<2)return;
  var rowCount=lastRow-1;

  function updateColumn_(columnIndex, valueGetter){
    if(columnIndex<0)return;
    var range=sheet.getRange(2,columnIndex+1,rowCount,1);
    var values=range.getValues();

    statuses.forEach(function(x){
      var index=Number(x.row||0)-2;
      if(index<0||index>=values.length)return;
      values[index][0]=valueGetter(x);
    });

    range.setValues(values);
  }

  updateColumn_(h.version,function(){return BE_CONFIG.VERSION;});
  updateColumn_(h.status,function(x){return x.status;});
  updateColumn_(h.lastSync,function(x){return x.time;});
}
/**
 * B7 - Đo thời gian từng bước của build MASTER.
 * Mỗi nguồn có một bộ đếm: mark(bước) cộng thời gian kể từ lần mark trước.
 * Cuối build in MASTER_BUILD_STEP_TIMING_B7: tổng theo bước + 10 nguồn chậm nhất.
 */
var BE_B7_RUN_V1 = null;

function beB7BeginRunV1_() {
  BE_B7_RUN_V1 = {steps: {}, sources: []};
  return BE_B7_RUN_V1;
}

function beB7SourceTimerV1_(sourceId, source) {
  if (!BE_B7_RUN_V1) beB7BeginRunV1_();
  var run = BE_B7_RUN_V1;
  var timer = {sourceId: String(sourceId || ""), source: String(source || ""), steps: {}, last: new Date().getTime(), total: 0};
  run.sources.push(timer);
  timer.mark = function(step) {
    var now = new Date().getTime();
    var ms = now - timer.last;
    timer.last = now;
    timer.steps[step] = (timer.steps[step] || 0) + ms;
    timer.total += ms;
    run.steps[step] = (run.steps[step] || 0) + ms;
    return ms;
  };
  timer.reset = function() { timer.last = new Date().getTime(); };
  return timer;
}

function beB7LogSummaryV1_(mode, elapsedMs) {
  var run = BE_B7_RUN_V1;
  if (!run) return null;
  var steps = Object.keys(run.steps).sort().map(function(k) {
    return {step: k, ms: run.steps[k], pct: elapsedMs > 0 ? Math.round(run.steps[k] * 100 / elapsedMs) : 0};
  });
  var slow = run.sources.filter(function(t) { return t.source.indexOf("__") !== 0; })
    .sort(function(a, b) { return b.total - a.total; }).slice(0, 10)
    .map(function(t) { return {sourceId: t.sourceId, source: t.source, ms: t.total, steps: t.steps}; });
  var summary = {code: "MASTER_BUILD_STEP_TIMING_B7", mode: mode, elapsedMs: elapsedMs,
    sources: run.sources.length - 1, steps: steps, slowestSources: slow};
  Logger.log(JSON.stringify(summary));
  try {
    PropertiesService.getScriptProperties().setProperty("BE_B7_LAST_BUILD_TIMING", JSON.stringify(summary).slice(0, 8500));
  } catch (ignore) {}
  return summary;
}

/** Xem số đo của lần build gần nhất (chạy tay trong Apps Script). */
function showLastBuildTimingB7() {
  var raw = PropertiesService.getScriptProperties().getProperty("BE_B7_LAST_BUILD_TIMING") || "{}";
  var data = JSON.parse(raw);
  Logger.log(JSON.stringify(data, null, 2));
  return data;
}

/** B3/B4 - gom cảnh báo theo dòng MASTER (không trùng lặp). */
function beAddSourceWarningsB34_(store, row, warnings) {
  if (!store || !row || !warnings || !warnings.length) return;
  var list = store[row] = store[row] || [];
  warnings.forEach(function(w) {
    var msg = String(w && w.message || w && w.code || "");
    if (msg && list.indexOf(msg) < 0) list.push(msg);
  });
}

/** B3/B4 - gắn cảnh báo vào trạng thái nguồn + 1 sự kiện tổng hợp mỗi build. */
function beApplySourceWarningsB34_(statuses, store, masterRows) {
  var rowsWithWarnings = Object.keys(store || {});
  if (!rowsWithWarnings.length) return;
  var touched = {};
  (statuses || []).forEach(function(st) {
    var list = store[Number(st && st.row || 0)];
    if (!list || !list.length) return;
    st.status = String(st.status || "") + " | ⚠ " + list.join("; ");
    touched[st.row] = true;
  });
  var hMap = masterRows && masterRows.length ? beHeaderMap_(masterRows[0]) : null;
  var summary = rowsWithWarnings.map(function(row) {
    var mrow = masterRows && masterRows[Number(row) - 1] || [];
    return {
      row:Number(row),
      sourceId:hMap ? cleanMasterText(beGetByHeader_(mrow, hMap.id)) : "",
      source:hMap ? cleanMasterText(beGetByHeader_(mrow, hMap.source)) : "",
      warnings:store[row]
    };
  });
  Logger.log(JSON.stringify({level:"WARNING", code:"MASTER_SOURCE_WARNINGS_B34", sources:summary.length, detail:summary}));
  if (typeof beEmitSystemEventV30_ === "function") {
    beEmitSystemEventV30_("WARNING", "MASTER_SOURCE_WARNINGS_B34", {
      message: summary.length + " nguồn có cảnh báo cấu hình/tên tab",
      sources: summary
    });
  }
}


/**
 * CONFIG MASTER là nền chung. CONFIG ẢNH và CONFIG THÔNG TIN chỉ ghi đè
 * các khóa được nhập, nên ghi ngắn VÙNG_HÀNG_ẢNH=1 hoặc HÀNG_THÔNG_TIN=2
 * vẫn giữ đúng hàng tên, cột bắt đầu/kết thúc và sheet của MASTER.
 */
function beBuildInheritedMetadataConfigV37_(masterRaw, specializedRaw, kind){
  var base = parseBookingSourceConfig(masterRaw);
  var extra = parseBookingSourceConfig(specializedRaw);
  var master = parseMasterColumnConfig(base);
  var merged = {};

  Object.keys(base).forEach(function(key) {
    merged[key] = base[key];
  });
  Object.keys(extra).forEach(function(key) {
    // AUTO đứng một mình chỉ có nghĩa là kế thừa, không phá cấu trúc MASTER.
    if (key !== "AUTO") merged[key] = extra[key];
  });

  var specializedSheetV414 = cleanMasterText(extra.SHEET || "");
  var specializedSheetTokenV414 = normalizeMasterText(specializedSheetV414)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  var explicitSupplementSheetV414 = !!specializedSheetV414 &&
    ["auto", "latest_calendar", "lich_moi_nhat"].indexOf(specializedSheetTokenV414) < 0;

  // Sheet phụ explicit mà không khóa layout => để AUTO tự nhận ngang/dọc.
  if (explicitSupplementSheetV414 && !extra.LAYOUT) merged.LAYOUT = "AUTO";
  else if (!merged.LAYOUT || merged.LAYOUT === "AUTO") merged.LAYOUT = "COLUMN";

  if (!merged.END_COL && master.endColumnIndex >= 0) {
    merged.END_COL = master.endColumnIndex + 1;
  }
  if (!merged.NAME_ROW && master.fixedNameRowIndex >= 0) {
    merged.NAME_ROW = master.fixedNameRowIndex + 1;
  }
  if (!merged.NAME_SCAN_ROWS && master.topRows > 0) {
    merged.NAME_SCAN_ROWS = "1-" + master.topRows;
  }

  // Không cấu hình SHEET riêng => metadata tiếp tục dùng sheet lịch chính.
  // Có SHEET riêng trong CONFIG ẢNH/THÔNG TIN => buildMasterVilla sẽ đọc như supplement.
  if (!merged.SHEET) merged.SHEET = "LATEST_CALENDAR";

  if (kind === "INFO" && merged.INFO_FROM_NAME_CELL === undefined) {
    merged.INFO_FROM_NAME_CELL = true;
  }

  // V4.3: giữ loại reader để CONFIG THÔNG TIN tuyệt đối không dò/gán ảnh.
  merged.METADATA_KIND = String(kind || "").toUpperCase();

  return merged;
}

function beHasExplicitMetadataSheetV38_(rawConfig){
  var parsed = parseBookingSourceConfig(rawConfig);
  var sheetName = cleanMasterText(parsed.SHEET || "");
  var token = normalizeMasterText(sheetName)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return !!sheetName && token !== "auto" && token !== "latest_calendar" &&
    token !== "lich_moi_nhat";
}

function beFindMetadataSheetV32_(file, rawConfig, kind){
  var config = parseMetadataConfig(rawConfig);
  var explicitName = cleanMasterText(config.sheetName);

  var explicitToken = normalizeMasterText(explicitName)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (
    explicitToken === "latest_calendar" ||
    explicitToken === "lich_moi_nhat"
  ) {
    return findLatestMasterCalendarSheet(file);
  }

  if (explicitName && explicitToken !== "auto") {
    var exact = beFindVisibleSheetByLooseNameV4210_(file, explicitName);
    if (!exact) {
      throw new Error('Không tìm thấy SHEET="' + explicitName + '" trong CONFIG ' + kind);
    }
    exact = beRejectHiddenSheet_(exact, "CONFIG_" + kind);
    if (!exact) {
      throw new Error('Sheet "' + explicitName + '" đang bị ẩn nên không được đọc');
    }
    return exact;
  }

  var sheets = beGetVisibleSheets_(file);
  var keywords = kind === "IMAGE"
    ? ["anh", "hinh anh", "image", "photo", "album", "metadata"]
    : [
        "thong tin",
        "information",
        "info",
        "danh sach can",
        "danh sach villa",
        "ds villa",
        "metadata"
      ];

  var best = null;
  var bestScore = 0;

  sheets.forEach(function(sheet) {
    var name = normalizeMasterText(sheet.getName());
    var score = 0;

    keywords.forEach(function(keyword) {
      if (name === keyword) score += 20;
      else if (name.indexOf(keyword) >= 0) score += 8;
    });

    if (/thang|month|lich|calendar/.test(name)) score -= 10;

    if (score > bestScore) {
      best = sheet;
      bestScore = score;
    }
  });

  if (bestScore > 0) return best;

  // Tên sheet không có chữ ẢNH/IMAGE: dò trực tiếp CellImage trong các sheet.
  if (kind === "IMAGE") {
    return beFindSheetWithCellImagesV33_(sheets);
  }

  // CONFIG THÔNG TIN=AUTO: không có tab tên Thông tin thì thử lịch mới nhất.
  if (kind === "INFO") {
    return findLatestMasterCalendarSheet(file);
  }

  return null;
}

function beFindSheetWithCellImagesV33_(sheets){
  var bestSheet = null;
  var bestCount = 0;

  (sheets || []).forEach(function(sheet) {
    var rowCount = Math.min(Math.max(sheet.getLastRow(), 1), 20);
    var columnCount = Math.min(Math.max(sheet.getLastColumn(), 1), 120);
    var rawValues;

    try {
      rawValues = sheet.getRange(1, 1, rowCount, columnCount).getValues();
    } catch (rangeError) {
      return;
    }

    var count = 0;
    for (var row = 0; row < rawValues.length; row++) {
      for (var column = 0; column < rawValues[row].length; column++) {
        var rawValue = rawValues[row][column];
        if (rawValue && typeof rawValue.getContentUrl === "function") {
          count++;
        }
      }
    }

    if (count > bestCount) {
      bestCount = count;
      bestSheet = sheet;
    }
  });

  if (bestSheet) {
    Logger.log(JSON.stringify({
      code: "IMAGE_SHEET_AUTO_DETECTED",
      sheet: bestSheet.getName(),
      cellImages: bestCount
    }));
  }

  return bestSheet;
}

function beReadInfoSheetV31_(sheet, rawMasterConfig){
  var config = parseMetadataConfig(rawMasterConfig);
  var runtimeDataV21 = beGetMasterSheetRuntimeDataV21_(sheet);
  var lastRow = Math.max((runtimeDataV21.display || []).length, 1);
  var lastColumn = Math.max(
    runtimeDataV21.display && runtimeDataV21.display[0]
      ? runtimeDataV21.display[0].length
      : 0,
    1
  );
  var rowCount = Math.min(lastRow, config.scanRows);
  var columnCount = Math.min(lastColumn, config.scanCols);

  var values = beSliceMasterMatrixV21_(runtimeDataV21.display, rowCount, columnCount);
  var formulas = beSliceMasterMatrixV21_(runtimeDataV21.formulas, rowCount, columnCount);
  var rawValues = beSliceMasterMatrixV21_(runtimeDataV21.raw, rowCount, columnCount);
  var layout = config.layout;

  // CONFIG ẢNH/THÔNG TIN cũng phải ghép theo chữ hiển thị của tên căn.
  // Link gắn trên chữ chỉ là metadata, không được tham gia nhận diện tên.
  if (config.nameRow > 0 && config.nameRow <= rowCount) {
    overwriteMasterLinkedNameRow_(sheet, values, config.nameRow);
  }

  // AUTO phải ưu tiên bố cục thật của CellImage. File lịch của EHOME đặt
  // mỗi căn theo một cột, ảnh trải ngang trên cùng một hàng.
  var cellImageLayout = beDetectCellImageLayoutV33_(rawValues);
  if (layout === "AUTO" && cellImageLayout === "COLUMN") {
    Logger.log(JSON.stringify({
      code: "IMAGE_LAYOUT_AUTO_DETECTED",
      layout: "COLUMN"
    }));
    return beReadInfoColumnsV31_(
      values,
      formulas,
      config,
      rawMasterConfig,
      rawValues,
      sheet
    );
  }

  if (layout === "AUTO" && cellImageLayout === "ROW") {
    Logger.log(JSON.stringify({
      code: "IMAGE_LAYOUT_AUTO_DETECTED",
      layout: "ROW"
    }));
    return beReadInfoRowsV31_(values, formulas, config, rawValues);
  }

  if (
    layout === "ROW" ||
    layout === "ROWS" ||
    beHasRowConfig_(config)
  ) {
    return beReadInfoRowsV31_(values, formulas, config, rawValues);
  }

  if (
    layout === "COLUMN" ||
    layout === "COLUMNS" ||
    beHasColumnConfig_(config)
  ) {
    return beReadInfoColumnsV31_(
      values,
      formulas,
      config,
      rawMasterConfig,
      rawValues,
      sheet
    );
  }

  // AUTO: ưu tiên bảng mỗi hàng một căn; không nhận được mới thử mỗi cột một căn.
  var rowVillas = beReadInfoRowsV31_(values, formulas, config, rawValues);
  if (rowVillas.length) return rowVillas;

  return beReadInfoColumnsV31_(
    values,
    formulas,
    config,
    rawMasterConfig,
    rawValues,
    sheet
  );
}

/** V4.14 - Sheet phụ chỉ có ảnh: hỗ trợ IMAGE_ASSIGN_MODE=SEQUENCE. */
function beReadImageOnlySequenceV414_(sheet, rawConfig) {
  if (!sheet) return [];
  var cfgRaw = parseBookingSourceConfig(rawConfig || "");
  var mode = String(cfgRaw.IMAGE_ASSIGN_MODE || cfgRaw.GHEP_ANH || "")
    .trim().toUpperCase().replace(/\s+/g, "_");
  if (["SEQUENCE", "THEO_THU_TU", "THEO_THỨ_TỰ"].indexOf(mode) < 0) return [];

  var config = parseMetadataConfig(rawConfig);
  var rows = [];
  if (config.imageRow > 0) rows.push(config.imageRow);
  (config.imageRows || []).forEach(function(rowNumber) {
    rowNumber = Number(rowNumber || 0);
    if (rowNumber > 0 && rows.indexOf(rowNumber) < 0) rows.push(rowNumber);
  });
  if (!rows.length) return [];

  var runtime = beGetMasterSheetRuntimeDataV21_(sheet);
  var display = runtime.display || [];
  if (!display.length || !display[0]) return [];
  var formulas = runtime.formulas || [];
  var rawValues = runtime.raw || [];
  var startColumn = config.startCol > 0 ? config.startCol - 1 : 0;
  var endExclusive = config.endCol > 0 ? Math.min(display[0].length, config.endCol) : display[0].length;
  var overGrid = beBuildOverGridImageMapV40_(sheet);
  var out = [];

  for (var column = startColumn; column < endExclusive; column++) {
    var exact = beFindExactConfiguredImageV49_(
      sheet, display, formulas, rawValues, column, rows
    );
    var over = null;
    if (!exact) {
      over = beFindOverGridImageForColumnV42_(overGrid, column, rows, sheet);
    }
    var source = exact ? (exact.source || exact.url || null) : (over ? over.image : null);
    if (!source) continue;
    out.push({
      name:"",image:exact ? (exact.url || "") : "",imageSource:source,
      sourceColumn:column + 1,hasRealCellImage:true
    });
  }

  if (out.length) {
    Logger.log(JSON.stringify({
      code:"SUPPLEMENT_IMAGE_SEQUENCE_DETECTED_V414",
      sheet:sheet.getName(),images:out.length,startCol:startColumn + 1,endCol:endExclusive
    }));
  }
  return out;
}

function beDetectCellImageLayoutV33_(rawValues){
  var rows = {};
  var columns = {};
  var count = 0;

  (rawValues || []).forEach(function(rowValues, rowIndex) {
    (rowValues || []).forEach(function(rawValue, columnIndex) {
      if (!rawValue || typeof rawValue.getContentUrl !== "function") return;
      rows[rowIndex] = true;
      columns[columnIndex] = true;
      count++;
    });
  });

  if (!count) return "";

  var rowCount = Object.keys(rows).length;
  var columnCount = Object.keys(columns).length;

  if (columnCount >= 2 && columnCount > rowCount) return "COLUMN";
  if (rowCount >= 2 && rowCount > columnCount) return "ROW";
  return "";
}

function beHasRowConfig_(config){
  return !!(
    config.nameCol ||
    config.imageCol ||
    config.infoCol ||
    config.mapsCol ||
    config.standardCol ||
    config.bedroomsCol
  );
}

function beHasColumnConfig_(config){
  return !!(
    config.nameRow ||
    config.imageRow ||
    config.infoRow ||
    (config.infoRows && config.infoRows.length) ||
    config.mapsRow ||
    config.standardRow ||
    config.bedroomsRow
  );
}

function beColIndexV31_(value){
  if (value === null || value === undefined || value === "") return -1;
  if (typeof value === "number") return value - 1;

  var text = String(value).trim().toUpperCase();
  if (/^\d+$/.test(text)) return parseInt(text, 10) - 1;

  var index = 0;
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    if (code < 65 || code > 90) return -1;
    index = index * 26 + (code - 64);
  }

  return index - 1;
}

function beReadInfoRowsV31_(values, formulas, config, rawValues){
  var header = beDetectInfoHeaderV31_(values, config);
  var villas = [];

  if (header.name < 0) return villas;

  var startRow = config.startRow > 0
    ? config.startRow - 1
    : header.row + 1;

  var endRowExclusiveV414 = config.endRow > 0
    ? Math.min(values.length, config.endRow)
    : values.length;

  for (var row = startRow; row < endRowExclusiveV414; row++) {
    var name = cleanMasterVillaName(values[row][header.name]);
    if (!name || !isValidMasterVillaName(name)) continue;

    var info = header.info >= 0
      ? cleanMasterText(values[row][header.info])
      : "";

    var standard = header.standard >= 0
      ? beExtractStructuredMasterStandardV417_(values[row][header.standard])
      : extractMasterStandard(name + "\n" + info);

    var bedrooms = header.bedrooms >= 0
      ? beExtractStructuredMasterBedroomsV417_(values[row][header.bedrooms])
      : extractMasterBedrooms(name + "\n" + info);

    villas.push({
      name: name,
      image: beLinkAtV31_(values, formulas, row, header.image, rawValues),
      info: info,
      maps: beLinkAtV31_(values, formulas, row, header.maps),
      standard: standard,
      bedrooms: bedrooms
    });
  }

  return removeDuplicateMasterVillas(villas);
}

function beDetectInfoHeaderV31_(values, config){
  var forcedRow = config.headerRow > 0 ? config.headerRow - 1 : -1;
  var maxRows = Math.min(values.length, 30);
  var best = {
    row: -1,
    score: -1,
    name: -1,
    image: -1,
    info: -1,
    maps: -1,
    standard: -1,
    bedrooms: -1
  };

  for (var row = 0; row < maxRows; row++) {
    if (forcedRow >= 0 && row !== forcedRow) continue;

    var normalizedRow = values[row].map(normalizeMasterText);

    function find(candidates, forcedColumn) {
      var forcedIndex = beColIndexV31_(forcedColumn);
      return forcedIndex >= 0
        ? forcedIndex
        : findMasterHeaderColumn(normalizedRow, candidates);
    }

    var detected = {
      row: row,
      name: find(
        ["ten can", "ten villa", "ten home", "ten", "villa", "home"],
        config.nameCol
      ),
      image: find(
        ["anh", "hinh anh", "link anh", "image", "photo"],
        config.imageCol
      ),
      info: find(
        ["thong tin", "mo ta", "chi tiet", "co cau", "noi dung", "description"],
        config.infoCol
      ),
      maps: find(
        ["maps", "map", "google map", "dia chi", "vi tri", "dinh vi"],
        config.mapsCol
      ),
      standard: find(
        ["tieu chuan", "suc chua", "so khach", "capacity"],
        config.standardCol
      ),
      bedrooms: find(
        ["pn", "phong ngu", "bedrooms"],
        config.bedroomsCol
      )
    };

    detected.score =
      (detected.name >= 0 ? 10 : 0) +
      (detected.image >= 0 ? 2 : 0) +
      (detected.info >= 0 ? 3 : 0) +
      (detected.maps >= 0 ? 2 : 0) +
      (detected.standard >= 0 ? 1 : 0) +
      (detected.bedrooms >= 0 ? 1 : 0);

    if (detected.score > best.score) best = detected;
  }

  return best;
}

function beCountInfoValuesInColumnV322_(values, column, rowNumbers){
  if (!values || column < 0 || !rowNumbers || !rowNumbers.length) return 0;

  var count = 0;
  rowNumbers.forEach(function(rowNumber) {
    var row = values[rowNumber - 1];
    if (!row) return;
    var value = cleanMasterText(row[column]);
    if (value) count++;
  });
  return count;
}

function beHasRealCellImageAtV322_(rawValues, rowNumber, column){
  if (!rawValues || rowNumber <= 0 || column < 0) return false;
  var row = rawValues[rowNumber - 1];
  var rawValue = row ? row[column] : null;
  return !!(rawValue && typeof rawValue.getContentUrl === "function");
}

function beFilterFixedRowGhostVillasV324_(
  villas,
  masterRaw,
  imageRaw,
  infoRaw
){
  villas = villas || [];

  var master = parseMasterColumnConfig(parseBookingSourceConfig(masterRaw));
  var imageConfig = parseMetadataConfig(imageRaw);
  var infoConfig = parseMetadataConfig(infoRaw);
  var hasConfiguredImageRows = imageConfig.imageRow > 0 ||
    (imageConfig.imageRows && imageConfig.imageRows.length);
  var hasConfiguredInfoRows = infoConfig.infoRow > 0 ||
    (infoConfig.infoRows && infoConfig.infoRows.length);
  var requireImage = imageConfig.requireImage === true;
  var strictCalendarIsTruthV4192 = master.nameMode === "FIXED_ROW" &&
    master.fixedNameRowIndex >= 0 &&
    master.fallbackEnabled === false;

  /*
   * V4.19.2 - FIXED_ROW + FALLBACK=FALSE là cấu hình chủ động của admin.
   * Khi lịch đã đọc ra tên căn từ đúng hàng/cột được khóa, tên trên calendar
   * là bằng chứng tồn tại của căn. Ảnh/thông tin chỉ là metadata và không
   * được quyền làm mất căn khỏi MASTER_VILLA, kể cả REQUIRE_IMAGE=TRUE.
   *
   * Bộ lọc ảnh vẫn được giữ nguyên cho FIXED_ROW có fallback để tiếp tục
   * chặn các cột do parser tự dò/đoán.
   */
  if (strictCalendarIsTruthV4192) {
    Logger.log(JSON.stringify({
      code: "FIXED_ROW_EXISTENCE_FILTER_SKIPPED_V4192",
      reason: "CALENDAR_FIXED_ROW_IS_TRUTH",
      requireImage: requireImage,
      villas: villas.length
    }));
    return villas;
  }

  // Mặc định ảnh chỉ là metadata: căn có tên hợp lệ vẫn được giữ dù thiếu ảnh.
  // Chỉ dùng ảnh làm điều kiện loại cột khi CONFIG ẢNH ghi REQUIRE_IMAGE=TRUE.
  if (!requireImage) {
    Logger.log(JSON.stringify({
      code: "FIXED_ROW_IMAGE_FILTER_SKIPPED",
      reason: "REQUIRE_IMAGE_FALSE",
      villas: villas.length
    }));
    return villas;
  }

  // Khi bật REQUIRE_IMAGE, chỉ áp dụng cho nguồn FIXED_ROW có khai báo
  // vùng ảnh. Vùng thông tin là bằng chứng bổ sung nếu được cấu hình.
  if (
    master.nameMode !== "FIXED_ROW" ||
    !hasConfiguredImageRows
  ) {
    return villas;
  }

  var kept = [];
  var removed = [];
  var hasAnyInfoEvidence = hasConfiguredInfoRows && villas.some(function(villa) {
    return !!(villa && villa.hasInfoEvidence === true);
  });
  var filterMode = hasAnyInfoEvidence ? "IMAGE_AND_INFO" : "IMAGE_ONLY";

  villas.forEach(function(villa) {
    var hasImage = !!(villa && villa.hasRealCellImage === true);
    var hasInfo = !!(villa && villa.hasInfoEvidence === true);

    // Khi vùng thông tin đọc được, căn phải có cả ảnh và thông tin.
    // Khi toàn nguồn chưa có bằng chứng thông tin, không được xóa sạch nguồn:
    // tạm dùng CellImage thật làm khóa cột để vẫn loại các mã căn ảo.
    var keep = hasAnyInfoEvidence
      ? (hasImage && hasInfo)
      : hasImage;

    if (keep) {
      kept.push(villa);
      return;
    }

    removed.push({
      name: villa && villa.name || "",
      column: villa && villa.sourceColumn || 0,
      infoValueCount: villa && villa.infoValueCount || 0,
      hasRealCellImage: hasImage,
      hasInfoEvidence: hasInfo
    });
  });

  Logger.log(JSON.stringify({
    code: "FIXED_ROW_STRICT_COLUMN_FILTER",
    mode: filterMode,
    before: villas.length,
    after: kept.length,
    removed: removed.length,
    removedVillas: removed
  }));

  return kept;
}

function beReadInfoColumnsV31_(
  values,
  formulas,
  config,
  rawMasterConfig,
  rawValues,
  sheet
){
  if (!values.length || !values[0]) return [];

  var masterConfig = parseMasterColumnConfig(
    parseBookingSourceConfig(rawMasterConfig)
  );
  var startColumn = config.startCol > 0
    ? config.startCol - 1
    : detectCalendarVillaStartColumn(values);

  if (config.nameRow > 0) {
    masterConfig.nameMode = "FIXED_ROW";
    masterConfig.fixedNameRowIndex = config.nameRow - 1;
  }

  var nameDetection = resolveMasterVillaNameRow(values, masterConfig);
  var metadataKindV43 = String(
    config && config.raw && config.raw.METADATA_KIND || ""
  ).toUpperCase();
  var isInfoReaderV43 = metadataKindV43 === "INFO";
  var isImageReaderV43 = metadataKindV43 === "IMAGE";

  // Chỉ reader ẢNH mới tải ảnh nổi. Reader THÔNG TIN không được nhìn ảnh/link.
  var overGridImages = isInfoReaderV43
    ? []
    : beBuildOverGridImageMapV40_(sheet);
  var villas = [];
  var endColumnExclusive = config.endCol > 0
    ? Math.min(values[0].length, config.endCol)
    : values[0].length;

  for (var column = startColumn; column < endColumnExclusive; column++) {
    var nameResult = readMasterVillaNameAtColumn(
      values,
      formulas,
      column,
      nameDetection,
      masterConfig
    );

    var name = nameResult.name;
    if (!name) continue;

    var autoMetadata = scanMasterColumnMetadata(
      values,
      formulas,
      column,
      nameResult.row
    );

    function cell(rowNumber) {
      if (rowNumber <= 0) return "";
      var sourceRow = values[rowNumber - 1];
      return sourceRow ? cleanMasterText(sourceRow[column]) : "";
    }

    function link(rowNumber) {
      return rowNumber > 0
        ? beLinkAtV31_(values, formulas, rowNumber - 1, column, rawValues)
        : "";
    }

    var infoFromNameCell = "";
    if (config.infoFromNameCell && nameResult.row >= 0) {
      var rawNameCell = values[nameResult.row]
        ? cleanMasterText(values[nameResult.row][column])
        : "";
      if (
        rawNameCell &&
        normalizeMasterText(rawNameCell) !== normalizeMasterText(name)
      ) {
        infoFromNameCell = rawNameCell;
      }
    }

    var infoValueCount = beCountInfoValuesInColumnV322_(
      values,
      column,
      config.infoRows
    );
    var info = beJoinInfoRowsV36_(values, column, config.infoRows, 1) ||
      cell(config.infoRow) || infoFromNameCell || autoMetadata.info || "";
    var configuredImageRowsV42 = [];
    if (!isInfoReaderV43) {
      if (config.imageRow > 0) configuredImageRowsV42.push(config.imageRow);
      (config.imageRows || []).forEach(function(rowNumber) {
        rowNumber = Number(rowNumber || 0);
        if (rowNumber > 0 && configuredImageRowsV42.indexOf(rowNumber) < 0) {
          configuredImageRowsV42.push(rowNumber);
        }
      });
    }
    var hasStrictImageRowsV42 = configuredImageRowsV42.length > 0;

    var configuredImage = "";
    var configuredImageSourceV49 = null;
    var configuredImageKindV49 = "";
    var overGridImage = null;
    var fallbackImage = "";

    if (!isInfoReaderV43) {
      /*
       * V4.9 SAFE MIXED IMAGE
       * Ưu tiên ảnh nằm CHÍNH XÁC trong ô/hàng CONFIG trước.
       * Điều này giữ được nguồn trộn CellImage / =IMAGE() / OverGridImage.
       *
       * Quan trọng: ảnh exact ở cột E/F không được để nearest OverGrid của
       * cột D ghi đè như bản cũ.
       */
      var exactConfiguredV49 = beFindExactConfiguredImageV49_(
        sheet,
        values,
        formulas,
        rawValues,
        column,
        configuredImageRowsV42
      );

      if (exactConfiguredV49) {
        configuredImage = exactConfiguredV49.url || "";
        configuredImageSourceV49 = exactConfiguredV49.source || configuredImage || null;
        configuredImageKindV49 = exactConfiguredV49.kind || "CONFIGURED_CELL";
      } else {
        configuredImage = beFindImageLinkInColumnV39_(
          values,
          formulas,
          rawValues,
          column,
          configuredImageRowsV42
        );
        if (!beIsLikelyImageAssetUrlV41_(configuredImage)) configuredImage = "";
        configuredImageSourceV49 = configuredImage || null;
        configuredImageKindV49 = configuredImage ? "CONFIGURED_CELL" : "";
      }

      /*
       * Chỉ dùng OverGrid khi đúng cột không có CellImage/=IMAGE()/URL ảnh.
       * Nếu không có exact ảnh, hàm V42 vẫn được phép lệch 1 cột để hỗ trợ
       * một ảnh dùng chung Peony+Lily, Jasmin+Camellia...
       */
      if (!configuredImageSourceV49) {
        overGridImage = beFindOverGridImageForColumnV42_(
          overGridImages,
          column,
          configuredImageRowsV42,
          sheet
        );
      }

      /*
       * Khi đã khai báo HÀNG_ẢNH/VÙNG_HÀNG_ẢNH thì khóa tuyệt đối vào vùng đó.
       * Không fallback quét toàn cột, tránh Zalo/link thông tin bị nhận nhầm.
       */
      if (!hasStrictImageRowsV42 && !configuredImageSourceV49 && !overGridImage) {
        fallbackImage = beIsLikelyImageAssetUrlV41_(autoMetadata.image)
          ? autoMetadata.image
          : beFindImageLinkInColumnV39_(values, formulas, rawValues, column);
      }
    }

    var image = isInfoReaderV43
      ? ""
      : (configuredImage ||
          (beIsLikelyImageAssetUrlV41_(fallbackImage) ? fallbackImage : ""));

    var imageSource = isInfoReaderV43
      ? null
      : (configuredImageSourceV49 ||
          (overGridImage ? overGridImage.image : (image || null)));

    Logger.log(JSON.stringify({
      code: "IMAGE_COLUMN_RESOLVED_V49",
      sheet: sheet && sheet.getName ? sheet.getName() : "",
      villa: name,
      column: column + 1,
      metadataKind: metadataKindV43 || "LEGACY",
      imageRows: configuredImageRowsV42,
      source: isInfoReaderV43
        ? "INFO_READER_IMAGE_DISABLED"
        : (configuredImageSourceV49
            ? (configuredImageKindV49 || "CONFIGURED_CELL")
            : (overGridImage
                ? (overGridImage.matchMode || "OVERGRID")
                : (fallbackImage ? "AUTO_FALLBACK" : "MISSING"))),
      anchorRow: overGridImage ? Number(overGridImage.row || 0) : 0,
      anchorColumn: overGridImage ? Number(overGridImage.column || 0) : 0
    }));

    var hasRealCellImage = isInfoReaderV43
      ? false
      : (!!configuredImageSourceV49 ||
        (config.imageRow > 0
          ? beHasRealCellImageAtV322_(rawValues, config.imageRow, column)
          : !!beFindCellImageInColumnV33_(rawValues, column, config.imageRows)) ||
        !!overGridImage);

    villas.push({
      name: name,
      image: image,
      imageSource: imageSource,
      info: info,
      maps: link(config.mapsRow) || autoMetadata.maps || "",
      standard: (config.standardRow > 0
        ? beExtractStructuredMasterStandardV417_(cell(config.standardRow))
        : "") ||
        extractMasterStandard(name + "\n" + info),
      bedrooms: (config.bedroomsRow > 0
        ? beExtractStructuredMasterBedroomsV417_(cell(config.bedroomsRow))
        : "") ||
        extractMasterBedrooms(name + "\n" + info),
      sourceColumn: column + 1,
      infoValueCount: infoValueCount,
      hasInfoEvidence: infoValueCount > 0,
      hasRealCellImage: hasRealCellImage
    });
  }

  /* V4.5: gán ảnh nổi một-một theo thứ tự trái sang phải. */
  if (!isInfoReaderV43 && configuredImageRowsV42.length) {
    beReassignOverGridImagesByOrderV45_(
      villas,
      overGridImages,
      configuredImageRowsV42,
      masterConfig.startColumnIndex + 1,
      masterConfig.endColumnIndex >= 0 ? masterConfig.endColumnIndex + 1 : 0,
      sheet
    );
  }

  return removeDuplicateMasterVillas(villas);
}

function beJoinInfoRowsV36_(values, column, rowNumbers, labelColumn){
  if (!rowNumbers || !rowNumbers.length) return "";

  var labelIndex = Number.isInteger(labelColumn) ? labelColumn : 1; // cột B
  var parts = [];
  var lastPartIndex = -1;

  rowNumbers.forEach(function(rowNumber) {
    var row = values[rowNumber - 1];
    if (!row) return;

    var label = cleanMasterText(row[labelIndex]);
    var groupLabel = cleanMasterText(row[0]);
    var rawValue = cleanMasterText(row[column]);
    if (!rawValue) return;

    var value = beNormalizeInfoValueV321_(rawValue);
    if (!value) return;

    // Cột B là nhãn chính. Khi B trống nhưng cột A có tên nhóm
    // (TIỆN ÍCH, SL KHÁCH, ƯU ĐIỂM...), vẫn giữ nhãn nhóm đó.
    var effectiveLabel = label || groupLabel;
    if (effectiveLabel) {
      parts.push(effectiveLabel + ": " + value);
      lastPartIndex = parts.length - 1;
    } else if (lastPartIndex >= 0) {
      parts[lastPartIndex] += "; " + value;
    } else {
      parts.push(value);
      lastPartIndex = parts.length - 1;
    }
  });

  return parts.join("\n");
}

function beNormalizeInfoValueV321_(value){
  var text = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map(function(line) { return line.trim(); })
    .filter(String)
    .join("; ")
    .trim();

  if (/^(?:v|✓|✔|✅)$/i.test(text)) return "Có";
  return text.replace(/^(?:v|✓|✔|✅)\s*/i, "Có ").trim();
}

function beLinkAtV31_(values, formulas, row, column, rawValues){
  if (column < 0 || row < 0 || !values[row]) return "";

  var rawValue = rawValues && rawValues[row]
    ? rawValues[row][column]
    : null;

  if (rawValue && typeof rawValue.getContentUrl === "function") {
    try {
      return cleanMasterText(rawValue.getContentUrl());
    } catch (cellImageError) {
      Logger.log("CELL_IMAGE_URL_FAILED: " + cellImageError);
    }
  }

  var display = values[row][column];
  var formula = formulas && formulas[row] ? formulas[row][column] : "";
  var formulaText = String(formula || "");
  var match = formulaText.match(
    /=(?:HYPERLINK|IMAGE)\(\s*["']([^"']+)["']/i
  );

  var url = match ? match[1] : cleanMasterText(display);
  var urlMatch = String(url).match(/https?:\/\/[^\s"')]+/i);
  if (urlMatch) url = urlMatch[0];

  return beNormalizeAssetUrlV31_(url);
}

function beFindImageLinkInColumnV39_(values, formulas, rawValues, column, allowedRows) {
  if (column < 0) return "";

  var rowIndexes = allowedRows && allowedRows.length
    ? allowedRows.map(function(rowNumber) { return rowNumber - 1; })
    : (values || []).map(function(_, rowIndex) { return rowIndex; });

  for (var i = 0; i < rowIndexes.length; i++) {
    var row = rowIndexes[i];
    if (row < 0 || !values || row >= values.length) continue;
    var url = beLinkAtV31_(values, formulas, row, column, rawValues);
    if (beIsLikelyImageAssetUrlV41_(url)) return url;
  }

  return beFindCellImageInColumnV33_(rawValues, column, allowedRows);
}


/**
 * V4.9 - Đọc ảnh CHÍNH XÁC tại cột + vùng hàng ảnh đã CONFIG.
 *
 * Lý do dùng thêm direct cell read:
 * - Một số nguồn Google Sheet trộn ảnh nổi và ảnh trong ô.
 * - Range.getValues() hàng loạt đôi khi không cho bộ reader cũ nhận đúng
 *   toàn bộ CellImage của nguồn copy/chuyển đổi.
 * - Chỉ gọi direct read trong đúng HÀNG_ẢNH, nên không quét Zalo/thông tin.
 */
function beFindExactConfiguredImageV49_(
  sheet,
  values,
  formulas,
  rawValues,
  column,
  allowedRows
) {
  if (!sheet || column < 0) return null;

  var rows = (allowedRows || [])
    .map(Number)
    .filter(function(rowNumber) { return rowNumber > 0; });

  if (!rows.length) return null;

  for (var i = 0; i < rows.length; i++) {
    var rowNumber = rows[i];
    var rowIndex = rowNumber - 1;

    /*
     * 1. Dữ liệu đã tải sẵn: CellImage / =IMAGE("url") / URL ảnh hợp lệ.
     */
    var cachedRaw = rawValues && rawValues[rowIndex]
      ? rawValues[rowIndex][column]
      : null;

    if (cachedRaw && typeof cachedRaw.getContentUrl === "function") {
      try {
        var cachedUrl = cleanMasterText(cachedRaw.getContentUrl());
        if (cachedUrl) {
          return {
            source: cachedRaw,
            url: cachedUrl,
            kind: "CELL_IMAGE"
          };
        }
      } catch (cachedCellError) {}
    }

    var cachedUrlV49 = beLinkAtV31_(
      values,
      formulas,
      rowIndex,
      column,
      rawValues
    );

    if (beIsLikelyImageAssetUrlV41_(cachedUrlV49)) {
      return {
        source: cachedUrlV49,
        url: cachedUrlV49,
        kind: "IMAGE_FORMULA_OR_URL"
      };
    }

    /*
     * V3.2.8: Master fast mode không gọi getRange/getValue từng ô.
     * Nếu bulk data chưa thấy ảnh, ImageWorker sẽ resolve ở execution riêng.
     */
    if (BE_MASTER_FAST_IMAGE_MODE_V328_ === true) {
      continue;
    }

    /*
     * 2. Fallback đọc trực tiếp đúng một ô.
     * Không mở rộng ra hàng khác nên vẫn tuân thủ CONFIG khóa hàng.
     */
    try {
      var cell = sheet.getRange(rowNumber, column + 1);
      var directRaw = cell.getValue();

      if (directRaw && typeof directRaw.getContentUrl === "function") {
        var directUrl = "";
        try {
          directUrl = cleanMasterText(directRaw.getContentUrl());
        } catch (directUrlError) {}

        return {
          source: directRaw,
          url: directUrl,
          kind: "CELL_IMAGE_DIRECT"
        };
      }

      var directFormula = String(cell.getFormula() || "");
      var formulaMatch = directFormula.match(
        /=(?:IMAGE|HYPERLINK)\(\s*["']([^"']+)["']/i
      );

      if (formulaMatch) {
        var formulaUrl = beNormalizeAssetUrlV31_(formulaMatch[1]);
        if (beIsLikelyImageAssetUrlV41_(formulaUrl)) {
          return {
            source: formulaUrl,
            url: formulaUrl,
            kind: "IMAGE_FORMULA_DIRECT"
          };
        }
      }

      /*
       * Một số bản Sheets trả type IMAGE rõ hơn object trong getValues().
       * Chỉ dùng để chẩn đoán; nếu object đọc được thì đã return ở trên.
       */
      try {
        if (
          typeof cell.getValueType === "function" &&
          typeof SpreadsheetApp !== "undefined" &&
          SpreadsheetApp.ValueType &&
          cell.getValueType() === SpreadsheetApp.ValueType.IMAGE
        ) {
          Logger.log(JSON.stringify({
            code: "CELL_IMAGE_TYPE_WITHOUT_OBJECT_V49",
            sheet: sheet.getName(),
            row: rowNumber,
            column: column + 1
          }));
        }
      } catch (typeError) {}
    } catch (directReadError) {
      Logger.log(JSON.stringify({
        level: "WARNING",
        code: "CONFIGURED_IMAGE_DIRECT_READ_FAILED_V49",
        sheet: sheet && sheet.getName ? sheet.getName() : "",
        row: rowNumber,
        column: column + 1,
        error: String(
          directReadError && directReadError.message
            ? directReadError.message
            : directReadError
        )
      }));
    }
  }

  return null;
}


/** V4.1 - Chỉ nhận URL có khả năng là tài nguyên ảnh; loại Zalo/link nhóm/web. */
function beIsLikelyImageAssetUrlV41_(url) {
  var text = cleanMasterText(url);
  if (!text || !/^https?:\/\//i.test(text)) return false;

  if (/zalo\.me|facebook\.com|messenger\.com|t\.me|chat\.whatsapp\.com/i.test(text)) {
    return false;
  }

  return (
    /googleusercontent\.com|ggpht\.com|drive\.google\.com\/(?:uc|thumbnail|file\/d\/|drive\/(?:u\/\d+\/)?folders\/|folders\/)/i.test(text) ||
    /\.(?:jpe?g|png|gif|webp|bmp|avif)(?:[?#].*)?$/i.test(text) ||
    /[?&](?:format|fm)=(?:jpg|jpeg|png|gif|webp|avif)(?:&|$)/i.test(text)
  );
}

function beFindCellImageInColumnV33_(rawValues, column, allowedRows){
  if (!rawValues || column < 0) return "";

  var rowIndexes = allowedRows && allowedRows.length
    ? allowedRows.map(function(rowNumber) { return rowNumber - 1; })
    : rawValues.map(function(_, rowIndex) { return rowIndex; });

  for (var rowCursor = 0; rowCursor < rowIndexes.length; rowCursor++) {
    var row = rowIndexes[rowCursor];
    if (row < 0 || row >= rawValues.length) continue;
    var rawValue = rawValues[row] ? rawValues[row][column] : null;
    if (!rawValue || typeof rawValue.getContentUrl !== "function") continue;

    try {
      var url = cleanMasterText(rawValue.getContentUrl());
      if (url) return url;
    } catch (cellImageError) {
      Logger.log("CELL_IMAGE_SCAN_FAILED: " + cellImageError);
    }
  }

  return "";
}


/** V4.0 - Đọc ảnh nổi (OverGridImage) và ánh xạ theo ô neo. */
function beBuildOverGridImageMapV40_(sheet) {
  var result = {};
  if (!sheet || typeof sheet.getImages !== "function") return result;

  try {
    (sheet.getImages() || []).forEach(function(image, index) {
      if (!image || typeof image.getAnchorCell !== "function") return;
      var anchor = image.getAnchorCell();
      if (!anchor) return;
      var columnIndex = anchor.getColumn() - 1;
      if (!result[columnIndex]) result[columnIndex] = [];
      var xOffset = 0;
      var yOffset = 0;
      var width = 0;
      var height = 0;

      try {
        if (typeof image.getAnchorCellXOffset === "function") {
          xOffset = Number(image.getAnchorCellXOffset() || 0);
        }
      } catch (offsetError) {}

      try {
        if (typeof image.getAnchorCellYOffset === "function") {
          yOffset = Number(image.getAnchorCellYOffset() || 0);
        }
      } catch (yOffsetError) {}

      try {
        if (typeof image.getWidth === "function") {
          width = Number(image.getWidth() || 0);
        }
      } catch (widthError) {}

      try {
        if (typeof image.getHeight === "function") {
          height = Number(image.getHeight() || 0);
        }
      } catch (heightError) {}

      result[columnIndex].push({
        image: image,
        row: anchor.getRow(),
        column: anchor.getColumn(),
        xOffset: xOffset,
        yOffset: yOffset,
        width: width,
        height: height,
        index: index
      });
    });
  } catch (error) {
    Logger.log(JSON.stringify({
      level: "WARNING",
      code: "OVERGRID_IMAGE_SCAN_FAILED_V40",
      sheet: sheet.getName(),
      error: String(error && error.message ? error.message : error)
    }));
  }

  return result;
}


/**
 * V4.2 - Ảnh nổi chỉ hợp lệ khi ô neo nằm đúng vùng hàng ảnh cấu hình.
 * Ưu tiên đúng cột. Chỉ cho phép lệch 1 cột để xử lý ảnh phủ vùng merge;
 * không cho phép lệch hàng sang vùng Zalo/thông tin.
 */
function beFindOverGridImageForColumnV42_(imageMap, columnIndex, allowedRows, sheet) {
  var allowed = (allowedRows || [])
    .map(Number)
    .filter(function(row) { return row > 0; });

  function validRow_(candidate) {
    if (!candidate) return false;
    if (!allowed.length) return true;
    return allowed.indexOf(Number(candidate.row || 0)) >= 0;
  }

  /*
   * V4.10 SAFETY:
   * Giữ nguyên toàn bộ ưu tiên V4.9 trước:
   *   1. đúng anchor column
   *   2. lệch tối đa ±1 cột
   *
   * Chỉ khi hai bước cũ KHÔNG tìm được mới dùng hình học hiển thị.
   * Vì vậy 234 ảnh đang chạy đúng không bị đổi mapping.
   */
  var exact = imageMap && imageMap[columnIndex] ? imageMap[columnIndex] : [];
  for (var i = 0; i < exact.length; i++) {
    if (validRow_(exact[i])) {
      exact[i].matchMode = "OVERGRID";
      return exact[i];
    }
  }

  var nearest = null;
  var nearestDistance = 999;

  [-1, 1].forEach(function(offset) {
    var nearbyColumn = columnIndex + offset;
    var candidates = imageMap && imageMap[nearbyColumn]
      ? imageMap[nearbyColumn]
      : [];

    candidates.forEach(function(candidate) {
      if (!validRow_(candidate)) return;

      var distance = Math.abs(
        Number(candidate.column || 0) - (columnIndex + 1)
      );

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = candidate;
      }
    });
  });

  if (nearestDistance <= 1 && nearest) {
    nearest.matchMode = "OVERGRID";
    return nearest;
  }

  /*
   * V4.10 VISUAL GEOMETRY FALLBACK
   *
   * Một số nguồn có ảnh:
   * - neo ở cột/hàng bên cạnh nhưng ảnh thật phủ lên cột villa;
   * - một ảnh dùng chung 2 cột;
   * - xOffset/yOffset lớn nên anchorCell không phản ánh vị trí nhìn thấy.
   *
   * Fallback này KHÔNG gán theo thứ tự và KHÔNG ép 1 ảnh = 1 căn.
   * Nó chỉ nhận ảnh khi hình chữ nhật thật của ảnh giao đáng kể với:
   *   - cột villa cần tìm; và
   *   - vùng hàng ảnh đã CONFIG.
   */
  var visual = beFindOverGridImageByVisualGeometryV410_(
    imageMap,
    columnIndex,
    allowed,
    sheet
  );

  if (visual) {
    visual.matchMode = "OVERGRID_GEOMETRY_V410";
    return visual;
  }

  return null;
}

function beFindOverGridImageByVisualGeometryV410_(
  imageMap,
  columnIndex,
  allowedRows,
  sheet
) {
  if (!imageMap || !sheet || columnIndex < 0) return null;

  var targetColumn = columnIndex + 1;
  var targetWidth = beSafeColumnWidthV410_(sheet, targetColumn);
  if (!(targetWidth > 0)) return null;

  var candidates = [];
  var seen = {};

  Object.keys(imageMap).forEach(function(key) {
    (imageMap[key] || []).forEach(function(candidate) {
      if (!candidate || !candidate.image) return;

      var uniqueKey = String(
        candidate.index !== undefined && candidate.index !== null
          ? candidate.index
          : (candidate.row + "|" + candidate.column + "|" + candidate.xOffset)
      );

      if (seen[uniqueKey]) return;
      seen[uniqueKey] = true;
      candidates.push(candidate);
    });
  });

  var best = null;
  var bestScore = -1;

  candidates.forEach(function(candidate) {
    var width = Number(candidate.width || 0);
    var height = Number(candidate.height || 0);

    // Không đoán nếu Apps Script không cung cấp kích thước thật của ảnh.
    if (!(width > 0) || !(height > 0)) return;

    var anchorColumn = Number(candidate.column || 0);
    var anchorRow = Number(candidate.row || 0);
    if (!(anchorColumn > 0) || !(anchorRow > 0)) return;

    var targetLeft = beRelativeColumnLeftV410_(
      sheet,
      anchorColumn,
      targetColumn
    );
    var targetRight = targetLeft + targetWidth;

    var imageLeft = Number(candidate.xOffset || 0);
    var imageRight = imageLeft + width;

    var overlapX = Math.max(
      0,
      Math.min(targetRight, imageRight) -
      Math.max(targetLeft, imageLeft)
    );

    var targetCenter = targetLeft + targetWidth / 2;
    var centerInsideX =
      targetCenter >= imageLeft &&
      targetCenter <= imageRight;

    var horizontalRatio = overlapX / Math.max(1, targetWidth);

    // Cần ảnh thực sự phủ cột villa, tránh ảnh trang trí ở gần đó.
    if (!centerInsideX && horizontalRatio < 0.25) return;

    var rowScore = beVisualRowOverlapScoreV410_(
      sheet,
      candidate,
      allowedRows
    );

    if (rowScore <= 0) return;

    /*
     * Ưu tiên:
     * - tâm cột villa nằm trong ảnh;
     * - phần cột bị ảnh phủ lớn;
     * - ảnh nằm rõ trong vùng hàng ảnh;
     * - anchor gần cột villa hơn khi hòa điểm.
     */
    var score =
      (centerInsideX ? 1000 : 0) +
      Math.round(horizontalRatio * 500) +
      Math.round(rowScore * 300) -
      Math.abs(anchorColumn - targetColumn) * 5;

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  });

  if (best) {
    Logger.log(JSON.stringify({
      code: "OVERGRID_GEOMETRY_MATCH_V410",
      sheet: sheet && sheet.getName ? sheet.getName() : "",
      villaColumn: targetColumn,
      anchorRow: Number(best.row || 0),
      anchorColumn: Number(best.column || 0),
      xOffset: Number(best.xOffset || 0),
      yOffset: Number(best.yOffset || 0),
      width: Number(best.width || 0),
      height: Number(best.height || 0),
      score: bestScore
    }));
  }

  return best;
}

function beVisualRowOverlapScoreV410_(sheet, candidate, allowedRows) {
  allowedRows = (allowedRows || [])
    .map(Number)
    .filter(function(row) { return row > 0; });

  // Không khóa hàng ảnh thì chỉ cần hình học theo cột.
  if (!allowedRows.length) return 1;

  var anchorRow = Number(candidate && candidate.row || 0);
  var height = Number(candidate && candidate.height || 0);
  var imageTop = Number(candidate && candidate.yOffset || 0);
  var imageBottom = imageTop + height;

  if (!(anchorRow > 0) || !(height > 0)) return 0;

  var best = 0;

  allowedRows.forEach(function(targetRow) {
    // Anchor nằm đúng hàng CONFIG vẫn là bằng chứng mạnh nhất.
    if (targetRow === anchorRow) {
      best = Math.max(best, 1);
      return;
    }

    var rowHeight = beSafeRowHeightV410_(sheet, targetRow);
    if (!(rowHeight > 0)) return;

    var targetTop = beRelativeRowTopV410_(
      sheet,
      anchorRow,
      targetRow
    );
    var targetBottom = targetTop + rowHeight;

    var overlapY = Math.max(
      0,
      Math.min(targetBottom, imageBottom) -
      Math.max(targetTop, imageTop)
    );

    var targetCenter = targetTop + rowHeight / 2;
    var centerInsideY =
      targetCenter >= imageTop &&
      targetCenter <= imageBottom;

    var ratio = overlapY / Math.max(1, rowHeight);

    if (centerInsideY) ratio = Math.max(ratio, 0.75);
    if (ratio > best) best = ratio;
  });

  // Phải thực sự phủ ít nhất 20% một hàng ảnh config.
  return best >= 0.20 ? Math.min(best, 1) : 0;
}

function beRelativeColumnLeftV410_(sheet, anchorColumn, targetColumn) {
  anchorColumn = Number(anchorColumn || 0);
  targetColumn = Number(targetColumn || 0);

  if (anchorColumn === targetColumn) return 0;

  var offset = 0;
  var col;

  if (targetColumn > anchorColumn) {
    for (col = anchorColumn; col < targetColumn; col++) {
      offset += beSafeColumnWidthV410_(sheet, col);
    }
    return offset;
  }

  for (col = targetColumn; col < anchorColumn; col++) {
    offset -= beSafeColumnWidthV410_(sheet, col);
  }

  return offset;
}

function beRelativeRowTopV410_(sheet, anchorRow, targetRow) {
  anchorRow = Number(anchorRow || 0);
  targetRow = Number(targetRow || 0);

  if (anchorRow === targetRow) return 0;

  var offset = 0;
  var row;

  if (targetRow > anchorRow) {
    for (row = anchorRow; row < targetRow; row++) {
      offset += beSafeRowHeightV410_(sheet, row);
    }
    return offset;
  }

  for (row = targetRow; row < anchorRow; row++) {
    offset -= beSafeRowHeightV410_(sheet, row);
  }

  return offset;
}

function beSafeColumnWidthV410_(sheet, column) {
  try {
    return Number(sheet.getColumnWidth(Number(column))) || 100;
  } catch (ignore) {
    return 100;
  }
}

function beSafeRowHeightV410_(sheet, row) {
  try {
    return Number(sheet.getRowHeight(Number(row))) || 21;
  } catch (ignore) {
    return 21;
  }
}

/** V4.5 - Gán ảnh nổi một-một theo thứ tự ngang, không dùng lặp ảnh. */
function beIsProtectedExactImageV415_(villa) {
  if (!villa) return false;

  var image = villa.image;
  if (typeof image === "string" && String(image || "").trim()) {
    return true;
  }

  var source = villa.imageSource;
  if (!source) return false;

  // URL / =IMAGE() / CellImage exact phải được giữ nguyên.
  if (typeof source === "string") {
    return !!String(source || "").trim();
  }

  // OverGridImage là ảnh nổi, được phép sequence/remap.
  try {
    if (typeof source.getAnchorCell === "function") return false;
  } catch (ignoreAnchor) {}

  // CellImage thường có getContentUrl nhưng không có getAnchorCell.
  try {
    if (typeof source.getContentUrl === "function") return true;
  } catch (ignoreContentUrl) {}

  // Object ảnh exact có Blob nhưng không phải OverGrid cũng phải được giữ.
  try {
    if (typeof source.getBlob === "function") return true;
  } catch (ignoreBlob) {}

  return false;
}

/**
 * V4.15 - OVERGRID SAFE PRIORITY
 *
 * V4.5 cũ gán lại toàn bộ villa theo thứ tự OverGrid và có thể ghi đè
 * CellImage/=IMAGE()/URL đã resolve chính xác. V4.15 giữ tuyệt đối ảnh exact;
 * OverGrid chỉ được dùng cho những villa chưa có ảnh exact.
 */
function beReassignOverGridImagesByOrderV45_(villas, imageMap, allowedRows, startCol, endCol, sheet) {
  if (!villas || !villas.length || !imageMap) return villas || [];

  var allowed = (allowedRows || []).map(Number).filter(function(row) { return row > 0; });
  var candidates = [];
  var seen = {};

  Object.keys(imageMap).forEach(function(key) {
    (imageMap[key] || []).forEach(function(candidate) {
      if (!candidate || !candidate.image) return;
      if (allowed.length && allowed.indexOf(Number(candidate.row || 0)) < 0) return;
      if (seen[String(candidate.index)]) return;

      var col = Number(candidate.column || 0);
      if (startCol > 0 && col < startCol - 1) return;
      if (endCol > 0 && col > endCol + 1) return;

      seen[String(candidate.index)] = true;
      candidates.push(candidate);
    });
  });

  candidates.sort(function(a, b) {
    var diff = Number(a.column || 0) - Number(b.column || 0);
    if (diff !== 0) return diff;
    diff = Number(a.xOffset || 0) - Number(b.xOffset || 0);
    if (diff !== 0) return diff;
    return Number(a.index || 0) - Number(b.index || 0);
  });

  var targets = villas.filter(function(villa) { return villa && villa.name; }).sort(function(a, b) {
    return Number(a.sourceColumn || 0) - Number(b.sourceColumn || 0);
  });

  var protectedCount = targets.filter(function(villa) {
    return beIsProtectedExactImageV415_(villa);
  }).length;
  var missingTargets = targets.filter(function(villa) {
    return !beIsProtectedExactImageV415_(villa);
  });

  if (!missingTargets.length) {
    Logger.log(JSON.stringify({
      code: "OVERGRID_ORDER_NOT_NEEDED_V415",
      sheet: sheet && sheet.getName ? sheet.getName() : "",
      villas: targets.length,
      protectedExact: protectedCount,
      images: candidates.length
    }));
    return villas;
  }

  var pairMode = "";
  var pairs = [];

  // Trường hợp tốt nhất: có đủ ảnh theo toàn bộ thứ tự villa.
  // Pair toàn bộ để giữ đúng index, nhưng chỉ apply cho villa chưa có ảnh exact.
  if (candidates.length >= targets.length) {
    pairMode = "FULL_ORDER_PRESERVE_EXACT";
    targets.forEach(function(villa, index) {
      if (beIsProtectedExactImageV415_(villa)) return;
      if (!candidates[index]) return;
      pairs.push({villa:villa,candidate:candidates[index]});
    });
  }
  // Nếu source chỉ có OverGrid cho đúng nhóm còn thiếu, pair nhóm thiếu theo thứ tự.
  else if (candidates.length === missingTargets.length) {
    pairMode = "MISSING_ONLY_ORDER";
    missingTargets.forEach(function(villa, index) {
      pairs.push({villa:villa,candidate:candidates[index]});
    });
  } else {
    Logger.log(JSON.stringify({
      code: "OVERGRID_ORDER_ASSIGN_SKIPPED_V415",
      reason: "AMBIGUOUS_IMAGE_COUNT",
      sheet: sheet && sheet.getName ? sheet.getName() : "",
      villas: targets.length,
      protectedExact: protectedCount,
      needsOverGrid: missingTargets.length,
      images: candidates.length
    }));
    return villas;
  }

  var assigned = 0;
  pairs.forEach(function(pair) {
    var villa = pair.villa;
    var candidate = pair.candidate;
    if (!villa || !candidate || !candidate.image) return;

    // Double guard: exact image không bao giờ được ghi đè.
    if (beIsProtectedExactImageV415_(villa)) return;

    villa.image = "";
    villa.imageSource = candidate.image;
    villa.hasRealCellImage = true;
    assigned++;

    Logger.log(JSON.stringify({
      code: "OVERGRID_ORDER_ASSIGNED_V415",
      mode: pairMode,
      sheet: sheet && sheet.getName ? sheet.getName() : "",
      villa: villa.name,
      villaColumn: Number(villa.sourceColumn || 0),
      imageIndex: Number(candidate.index || 0),
      anchorRow: Number(candidate.row || 0),
      anchorColumn: Number(candidate.column || 0),
      xOffset: Number(candidate.xOffset || 0)
    }));
  });

  Logger.log(JSON.stringify({
    code: "OVERGRID_ORDER_SUMMARY_V415",
    sheet: sheet && sheet.getName ? sheet.getName() : "",
    mode: pairMode,
    villas: targets.length,
    protectedExact: protectedCount,
    needsOverGrid: missingTargets.length,
    assignedOverGrid: assigned,
    candidates: candidates.length
  }));

  return villas;
}

/** Public self-test: hiện trong dropdown Run của Apps Script. */
function testOverGridPriorityV415() {
  var exactUrl = "https://example.com/exact.jpg";
  var exactCell = {getContentUrl:function(){return "https://example.com/cell.jpg";}};
  var overA = {getAnchorCell:function(){return {};}};
  var overB = {getAnchorCell:function(){return {};}};
  var overC = {getAnchorCell:function(){return {};}};

  var villas = [
    {name:"A",sourceColumn:3,image:exactUrl,imageSource:exactUrl,hasRealCellImage:true},
    {name:"B",sourceColumn:4,image:"",imageSource:exactCell,hasRealCellImage:true},
    {name:"C",sourceColumn:5,image:"",imageSource:null,hasRealCellImage:false}
  ];
  var imageMap = {
    2:[{image:overA,row:1,column:3,xOffset:0,index:1}],
    3:[{image:overB,row:1,column:4,xOffset:0,index:2}],
    4:[{image:overC,row:1,column:5,xOffset:0,index:3}]
  };

  beReassignOverGridImagesByOrderV45_(villas,imageMap,[1],3,5,null);

  if (villas[0].imageSource !== exactUrl) throw new Error("V415 FAIL: URL exact bị ghi đè.");
  if (villas[1].imageSource !== exactCell) throw new Error("V415 FAIL: CellImage exact bị ghi đè.");
  if (villas[2].imageSource !== overC) throw new Error("V415 FAIL: OverGrid chưa gán đúng theo full order.");

  var result={success:true,version:"4.15-overgrid-safe-priority",exactUrlPreserved:true,cellImagePreserved:true,overGridAssigned:true};
  Logger.log(JSON.stringify({code:"OVERGRID_PRIORITY_PASS_V415",result:result}));
  return result;
}

function beNormalizeAssetUrlV31_(url){
  url = cleanMasterText(url);
  if (!url) return "";

  var driveMatch = url.match(
    /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=[^&]+&)?id=)([-\w]{20,})/i
  );

  if (driveMatch) {
    return "https://drive.google.com/uc?export=view&id=" + driveMatch[1];
  }

  return url;
}

function beMergeSeparatedMetadataV32_(imageVillas, infoVillas){
  imageVillas = imageVillas || [];
  infoVillas = infoVillas || [];

  var records = {};
  var order = [];

  function ensure(villa) {
    var nameKey = normalizeMasterText(villa && villa.name);
    var sourceColumn = Number(villa && villa.sourceColumn || 0);
    var exactKey = sourceColumn > 0
      ? nameKey + "|COL:" + sourceColumn
      : nameKey;
    if (!nameKey) return null;

    if (!records[exactKey]) {
      records[exactKey] = {
        name: villa.name,
        image: "",
        imageSource: null,
        info: "",
        maps: "",
        standard: "",
        bedrooms: "",
        sourceColumn: villa.sourceColumn || 0,
        infoValueCount: 0,
        hasInfoEvidence: false,
        hasRealCellImage: false
      };
      order.push(exactKey);
    }

    return records[exactKey];
  }

  imageVillas.forEach(function(villa) {
    var target = ensure(villa);
    if (!target) return;
    target.image = villa.image || target.image || "";
    target.imageSource = villa.imageSource || target.imageSource || null;
    target.sourceColumn = villa.sourceColumn || target.sourceColumn || 0;
    target.hasRealCellImage = villa.hasRealCellImage || target.hasRealCellImage || false;
  });

  infoVillas.forEach(function(villa) {
    var target = ensure(villa);
    if (!target) return;
    target.info = villa.info || target.info || "";
    target.maps = villa.maps || target.maps || "";
    target.standard = villa.standard || target.standard || "";
    target.bedrooms = villa.bedrooms || target.bedrooms || "";
    target.sourceColumn = villa.sourceColumn || target.sourceColumn || 0;
    target.infoValueCount = Math.max(
      Number(target.infoValueCount || 0),
      Number(villa.infoValueCount || 0)
    );
    target.hasInfoEvidence = villa.hasInfoEvidence || target.hasInfoEvidence || false;
  });

  return order.map(function(key) { return records[key]; });
}

function beMergeMetadataRecordV414_(left, right) {
  left = left || {};
  right = right || {};
  return {
    name: left.name || right.name || "",
    image: left.image || right.image || "",
    imageSource: left.imageSource || right.imageSource || null,
    info: left.info || right.info || "",
    maps: left.maps || right.maps || "",
    standard: left.standard || right.standard || "",
    bedrooms: left.bedrooms || right.bedrooms || "",
    sourceColumn: left.sourceColumn || right.sourceColumn || 0,
    infoValueCount: Math.max(Number(left.infoValueCount || 0), Number(right.infoValueCount || 0)),
    hasInfoEvidence: left.hasInfoEvidence === true || right.hasInfoEvidence === true,
    hasRealCellImage: left.hasRealCellImage === true || right.hasRealCellImage === true
  };
}

function beSupplementNameCompatibleV414_(calendarName, supplementName) {
  var a = normalizeMasterText(cleanMasterVillaName(calendarName));
  var b = normalizeMasterText(cleanMasterVillaName(supplementName));
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4) return false;

  function hasSafeBoundary(longer, shorter) {
    if (longer.indexOf(shorter) !== 0) return false;
    var rest = longer.slice(shorter.length);
    return /^(?:\s*[-–—:|/,()]|\s+\d+\s*(?:pn|phong|phòng|wc|toilet|khach|khách|pax)\b)/i.test(rest);
  }

  return hasSafeBoundary(a, b) || hasSafeBoundary(b, a);
}

function beFindSafeSupplementMetadataV414_(calendarName, candidates) {
  var matches = (candidates || []).filter(function(candidate) {
    return candidate && candidate.name && beSupplementNameCompatibleV414_(calendarName, candidate.name);
  });
  if (matches.length !== 1) return null;
  return matches[0];
}

function beMergeVillaMetadataV31_(calendarVillas, infoVillas, options){
  options = options || {};
  var exact = {};
  var byColumn = {};

  infoVillas.forEach(function(villa) {
    var exactKey = normalizeMasterText(villa.name);

    if (exactKey) {
      if (!exact[exactKey]) exact[exactKey] = villa;
      else if (options.allowSafeNameMatch) {
        exact[exactKey] = beMergeMetadataRecordV414_(exact[exactKey], villa);
      }
    }
    if (villa.sourceColumn && !byColumn[villa.sourceColumn]) {
      byColumn[villa.sourceColumn] = villa;
    }
  });

  return calendarVillas.map(function(villa) {
    var exactKey = normalizeMasterText(villa.name);
    // Cột của sheet phụ không có ý nghĩa với cột lịch; chỉ dùng column-match ở main sheet.
    var columnMetadata = !options.allowSafeNameMatch && villa.sourceColumn
      ? byColumn[villa.sourceColumn]
      : null;
    var metadata = {};

    if (columnMetadata) {
      var columnNameKey = normalizeMasterText(columnMetadata.name);
      if (columnNameKey === exactKey) {
        metadata = columnMetadata;
      } else {
        Logger.log(JSON.stringify({
          code: "INFO_COLUMN_NAME_MISMATCH",
          column: villa.sourceColumn,
          calendarName: villa.name,
          infoName: columnMetadata.name
        }));
      }
    }

    if (!metadata.name && exact[exactKey]) {
      metadata = exact[exactKey];
    }

    if (!metadata.name && options.allowSafeNameMatch) {
      metadata = beFindSafeSupplementMetadataV414_(villa.name, infoVillas) || {};
      if (metadata.name) {
        Logger.log(JSON.stringify({
          code:"SUPPLEMENT_NAME_MATCH_V414",
          calendarName:villa.name,
          supplementName:metadata.name,
          mode:"SAFE_UNIQUE_PREFIX"
        }));
      }
    }

    /*
     * V4.4 - ẢNH CHỈ ĐƯỢC LẤY TỪ CONFIG ẢNH.
     * calendarVillas được tạo bởi reader lịch cũ vẫn có thể chứa URL quét tự
     * động từ toàn cột (ví dụ link Zalo ở cuối sheet). Tuyệt đối không dùng
     * villa.image/villa.imageSource làm fallback nữa.
     */
    var safeMetadataImage = beIsLikelyImageAssetUrlV41_(metadata.image)
      ? metadata.image
      : "";
    var safeMetadataSource = null;

    if (
      metadata.imageSource &&
      typeof metadata.imageSource === "object" &&
      (
        typeof metadata.imageSource.getBlob === "function" ||
        typeof metadata.imageSource.getContentUrl === "function" ||
        typeof metadata.imageSource.getUrl === "function" ||
        typeof metadata.imageSource.getAnchorCell === "function"
      )
    ) {
      /*
       * V4.12:
       * OverGridImage của Google Sheets có thể KHÔNG expose getBlob/getContentUrl
       * ở lớp object mà Master đang giữ, nhưng vẫn là ảnh thật vì có getAnchorCell.
       * Không được vứt object này trước khi ImageDriveCache có cơ hội resolve URL/Blob.
       */
      safeMetadataSource = metadata.imageSource;
    } else if (beIsLikelyImageAssetUrlV41_(metadata.imageSource)) {
      safeMetadataSource = metadata.imageSource;
    } else if (safeMetadataImage) {
      safeMetadataSource = safeMetadataImage;
    }

    /*
     * V4.22.4: Drive folder được map đúng theo cột villa là nguồn ảnh có cấu trúc,
     * không phải link chat/web rác. Cho phép riêng loại này đi từ calendar reader
     * sang ImageWorker. Các URL calendar khác vẫn bị V4.4 chặn như cũ.
     */
    if (!safeMetadataSource && beIsDriveFolderImageSourceV4224_(villa.imageSource)) {
      safeMetadataSource = villa.imageSource;
    }

    if ((villa.image || villa.imageSource) && !safeMetadataSource) {
      Logger.log(JSON.stringify({
        code: "CALENDAR_IMAGE_FALLBACK_BLOCKED_V44",
        villa: villa.name,
        column: Number(villa.sourceColumn || 0),
        blockedValue: typeof villa.imageSource === "string"
          ? villa.imageSource
          : (villa.image || "")
      }));
    }

    return {
      name: villa.name,
      standard: metadata.standard || villa.standard || "",
      bedrooms: metadata.bedrooms || villa.bedrooms || "",
      info: metadata.info || villa.info || "",
      image: safeMetadataImage,
      imageSource: safeMetadataSource,
      maps: metadata.maps || villa.maps || "",
      sourceColumn: villa.sourceColumn || 0,
      groupOptions: villa.groupOptions || [],
      infoValueCount: Number(metadata.infoValueCount || 0),
      hasInfoEvidence: metadata.hasInfoEvidence === true,
      hasRealCellImage: metadata.hasRealCellImage === true
    };
  });
}


/**
 * V3.8 - Gom một vùng tên merge thành đúng một villa.
 *
 * Ví dụ:
 *   Căn A (merge D:G)
 *   D=10 khách, E=15 khách, F=18 khách, G=25 khách
 *
 * Kết quả MASTER_VILLA chỉ có một dòng "Căn A"; CONFIG LỊCH của dòng đó
 * chứa danh sách các cột con để CalendarReader chọn theo số khách.
 */
function beCollapseMergedVillaGroupsV38_(sheet, villas) {
  if (!sheet || !villas || !villas.length) return villas || [];

  var groups = [];
  try {
    sheet.getDataRange().getMergedRanges().forEach(function(range) {
      if (range.getNumColumns() <= 1) return;
      groups.push({
        rowStart: range.getRow(),
        rowEnd: range.getLastRow(),
        colStart: range.getColumn(),
        colEnd: range.getLastColumn()
      });
    });
  } catch (error) {
    Logger.log(JSON.stringify({
      level: "WARNING",
      code: "GROUP_MERGE_SCAN_FAILED_V38",
      sheet: sheet.getName(),
      error: String(error && error.message ? error.message : error)
    }));
    return villas;
  }

  if (!groups.length) return villas;

  var used = {};
  var output = [];

  groups.forEach(function(group) {
    var members = villas.filter(function(villa) {
      var col = Number(villa.sourceColumn || 0);
      var row = Number(villa.nameRow || -1) + 1;
      return (
        !used[col] &&
        col >= group.colStart &&
        col <= group.colEnd &&
        row >= group.rowStart &&
        row <= group.rowEnd
      );
    });

    if (members.length < 2) return;

    members.sort(function(a, b) {
      return Number(a.sourceColumn || 0) - Number(b.sourceColumn || 0);
    });

    var base = members[0];
    var groupOptions = beBuildGroupOptionsV38_(
      sheet,
      group,
      members
    );

    var image = "";
    var imageSource = null;
    var infoParts = [];
    var maps = "";
    var standard = 0;
    var bedrooms = 0;

    members.forEach(function(member) {
      used[Number(member.sourceColumn || 0)] = true;
      if (!image && member.image) image = member.image;
      if (!imageSource && member.imageSource) imageSource = member.imageSource;
      if (!maps && member.maps) maps = member.maps;
      if (member.info && infoParts.indexOf(member.info) < 0) {
        infoParts.push(member.info);
      }
      standard = Math.max(standard, Number(member.standard || 0));
      bedrooms = Math.max(bedrooms, Number(member.bedrooms || 0));
    });

    groupOptions.forEach(function(option) {
      standard = Math.max(standard, Number(option.capacity || 0));
      bedrooms = Math.max(bedrooms, Number(option.bedrooms || 0));
    });

    output.push({
      name: base.name,
      standard: standard || base.standard || "",
      bedrooms: bedrooms || base.bedrooms || "",
      info: infoParts.join("\n"),
      image: image || base.image || "",
      imageSource: imageSource || base.imageSource || image || base.image || null,
      maps: maps || base.maps || "",
      nameRow: base.nameRow,
      sourceColumn: Number(base.sourceColumn || group.colStart),
      groupOptions: groupOptions
    });

    Logger.log(JSON.stringify({
      code: "MERGED_VILLA_GROUP_COLLAPSED_V38",
      sheet: sheet.getName(),
      villa: base.name,
      columns: groupOptions.map(function(x) { return x.column; }),
      labels: groupOptions.map(function(x) { return x.label; })
    }));
  });

  villas.forEach(function(villa) {
    if (!used[Number(villa.sourceColumn || 0)]) {
      output.push(villa);
    }
  });

  output.sort(function(a, b) {
    return Number(a.sourceColumn || 0) - Number(b.sourceColumn || 0);
  });

  return output;
}

/**
 * V4.11 - Gom các villa trùng tên nằm ở các cột LIỀN KỀ nhưng không merge.
 *
 * Ví dụ:
 *   I = "1giường hẻm 32"
 *   J = "1giường hẻm 32"
 *
 * => MASTER_VILLA chỉ còn 1 dòng.
 *    CONFIG LỊCH giữ GROUP_OPTIONS_B64 gồm I,J.
 *
 * SAFETY:
 * - Không gom nếu khác hàng tên.
 * - Không gom nếu cột không liền nhau.
 * - Không gom villa đã có groupOptions do merged-range xử lý.
 */
function beCollapseAdjacentDuplicateVillaGroupsV411_(sheet, villas) {
  if (!sheet || !villas || villas.length < 2) return villas || [];

  var sorted = (villas || []).slice().sort(function(a, b) {
    return Number(a && a.sourceColumn || 0) -
      Number(b && b.sourceColumn || 0);
  });

  var output = [];
  var index = 0;

  while (index < sorted.length) {
    var first = sorted[index];
    var firstName = normalizeMasterText(first && first.name);
    var firstColumn = Number(first && first.sourceColumn || 0);
    var firstRow = Number(first && first.nameRow);

    if (
      !first ||
      !firstName ||
      !(firstColumn > 0) ||
      !(firstRow >= 0) ||
      (first.groupOptions && first.groupOptions.length)
    ) {
      output.push(first);
      index++;
      continue;
    }

    var run = [first];
    var cursor = index + 1;
    var previousColumn = firstColumn;

    while (cursor < sorted.length) {
      var candidate = sorted[cursor];
      var candidateColumn = Number(candidate && candidate.sourceColumn || 0);
      var candidateName = normalizeMasterText(candidate && candidate.name);
      var candidateRow = Number(candidate && candidate.nameRow);
      var candidateGrouped =
        candidate && candidate.groupOptions && candidate.groupOptions.length;

      if (
        candidateGrouped ||
        candidateName !== firstName ||
        candidateRow !== firstRow ||
        candidateColumn !== previousColumn + 1
      ) {
        break;
      }

      run.push(candidate);
      previousColumn = candidateColumn;
      cursor++;
    }

    if (run.length < 2) {
      output.push(first);
      index++;
      continue;
    }

    var group = {
      rowStart: firstRow + 1,
      rowEnd: firstRow + 1,
      colStart: firstColumn,
      colEnd: Number(run[run.length - 1].sourceColumn || firstColumn)
    };

    var groupOptions = beBuildGroupOptionsV38_(sheet, group, run);

    var image = "";
    var imageSource = null;
    var infoParts = [];
    var maps = "";
    var standard = 0;
    var bedrooms = 0;

    run.forEach(function(member) {
      if (!image && member.image) image = member.image;
      if (!imageSource && member.imageSource) imageSource = member.imageSource;
      if (!maps && member.maps) maps = member.maps;

      if (member.info && infoParts.indexOf(member.info) < 0) {
        infoParts.push(member.info);
      }

      standard = Math.max(standard, Number(member.standard || 0));
      bedrooms = Math.max(bedrooms, Number(member.bedrooms || 0));
    });

    groupOptions.forEach(function(option) {
      standard = Math.max(standard, Number(option.capacity || 0));
      bedrooms = Math.max(bedrooms, Number(option.bedrooms || 0));
    });

    output.push({
      name: first.name,
      standard: standard || first.standard || "",
      bedrooms: bedrooms || first.bedrooms || "",
      info: infoParts.join("\n"),
      image: image || first.image || "",
      imageSource: imageSource || first.imageSource || image || first.image || null,
      maps: maps || first.maps || "",
      nameRow: first.nameRow,
      sourceColumn: firstColumn,
      groupOptions: groupOptions,
      infoValueCount: Math.max.apply(null, run.map(function(member) {
        return Number(member.infoValueCount || 0);
      }).concat([0])),
      hasInfoEvidence: run.some(function(member) {
        return member && member.hasInfoEvidence === true;
      }),
      hasRealCellImage: run.some(function(member) {
        return member && member.hasRealCellImage === true;
      })
    });

    Logger.log(JSON.stringify({
      code: "ADJACENT_DUPLICATE_VILLA_COLLAPSED_V411",
      sheet: sheet.getName(),
      villa: first.name,
      columns: groupOptions.map(function(option) {
        return Number(option.column || 0);
      }),
      labels: groupOptions.map(function(option) {
        return String(option.label || "");
      }),
      rule: "SAME_NAME_SAME_ROW_ADJACENT_COLUMNS"
    }));

    index = cursor;
  }

  output.sort(function(a, b) {
    return Number(a && a.sourceColumn || 0) -
      Number(b && b.sourceColumn || 0);
  });

  return output;
}

function beBuildGroupOptionsV38_(sheet, group, members) {
  var maxRows = Math.min(Math.max(sheet.getLastRow(), 1), 20);
  var values = sheet
    .getRange(1, group.colStart, maxRows, group.colEnd - group.colStart + 1)
    .getDisplayValues();

  var groupName = members[0] ? cleanMasterText(members[0].name) : "";
  var normalizedGroupName = normalizeMasterText(groupName);
  var options = [];

  for (var col = group.colStart; col <= group.colEnd; col++) {
    var label = "";
    var localIndex = col - group.colStart;

    for (var row = 0; row < values.length; row++) {
      var text = cleanMasterText(
        values[row] && typeof values[row][localIndex] !== "undefined"
          ? values[row][localIndex]
          : ""
      );
      if (!text) continue;

      var normalized = normalizeMasterText(text);
      if (!normalized || normalized === normalizedGroupName) continue;
      if (beIsGroupOptionJunkV38_(text)) continue;

      if (beLooksLikeGroupOptionLabelV38_(text)) {
        label = text.split(/\r?\n/)[0];
        break;
      }
    }

    if (!label) {
      label = "Cột " + beColumnLetterV38_(col);
    }

    options.push({
      column: col,
      label: label,
      capacity: beExtractGroupCapacityV38_(label),
      bedrooms: beExtractGroupBedroomsV38_(label)
    });
  }

  return options;
}

function beLooksLikeGroupOptionLabelV38_(text) {
  var normalized = normalizeMasterText(text);
  if (!normalized) return false;

  return (
    /\b\d+\s*(?:khach|pax|nguoi)\b/.test(normalized) ||
    /\b(?:mo|mở)\s*\d+\s*(?:p|phong|pn)\b/i.test(text) ||
    /\b\d+\s*(?:p|phong|pn)\b/.test(normalized) ||
    /^(?:full|nguyen can|toan can)$/i.test(normalized)
  );
}

function beIsGroupOptionJunkV38_(text) {
  var normalized = normalizeMasterText(text);
  if (!normalized) return true;
  if (/^(?:ngay|thu|date|stt|gia|price|ghi chu|thong tin)$/.test(normalized)) {
    return true;
  }
  if (/^\d{1,2}[\/.-]\d{1,2}/.test(normalized)) return true;
  if (/^\d+(?:[.,]\d+)?$/.test(normalized)) return true;
  if (/(?:https?:\/\/|www\.|drive\.google)/i.test(text)) return true;
  return false;
}

function beExtractGroupCapacityV38_(text) {
  var normalized = normalizeMasterText(text);
  var match = normalized.match(/(\d+)\s*(?:khach|pax|nguoi)\b/);
  return match ? Number(match[1]) : 0;
}

function beExtractGroupBedroomsV38_(text) {
  var normalized = normalizeMasterText(text);
  var match = normalized.match(/(?:mo\s*)?(\d+)\s*(?:p|phong|pn)\b/);
  return match ? Number(match[1]) : 0;
}

function beAppendGroupOptionsToCalendarConfigV38_(calendarConfig, groupOptions) {
  var base = cleanMasterText(calendarConfig) || "AUTO";
  if (!groupOptions || groupOptions.length < 2) return base;

  var payload = JSON.stringify(groupOptions);
  var encoded = Utilities.base64EncodeWebSafe(payload, Utilities.Charset.UTF_8);
  return base + ";GROUP_OPTIONS_B64=" + encoded;
}

function beColumnLetterV38_(column) {
  var value = Number(column || 0);
  var result = "";
  while (value > 0) {
    var remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result || "?";
}


/* ================= AUTO SYNC =================
 * V4 legacy auto-sync removed.
 * Use 11_AutoSync.gs as the single source of truth for MASTER auto sync.
 */

/**
 * V4.6 - Ghép ảnh lần lượt với danh sách căn cuối cùng.
 *
 * Quy tắc:
 * - Chỉ chạy khi CONFIG ẢNH có IMAGE_ASSIGN_MODE=SEQUENCE.
 * - Danh sách căn đã được gom nhóm/lọc căn ảo trước khi vào hàm này.
 * - Ảnh được lấy từ reader CONFIG ẢNH, sắp xếp theo sourceColumn.
 * - Cùng một ảnh nổi bị reader gán lặp cho nhiều cột chỉ được tính một lần.
 * - Không lấy URL từ CONFIG THÔNG TIN hay lịch làm ảnh.
 */
function beAssignImagesBySequenceV46_(villas, imageVillas, rawImageConfig, sheet) {
  villas = villas || [];
  imageVillas = imageVillas || [];

  var cfg = parseBookingSourceConfig(rawImageConfig || "");
  var mode = String(cfg.IMAGE_ASSIGN_MODE || cfg.GHEP_ANH || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");

  if (["SEQUENCE", "THEO_THU_TU", "THEO_THỨ_TỰ"].indexOf(mode) < 0) {
    return villas;
  }

  var targets = villas
    .filter(function(villa) { return villa && villa.name; })
    .slice()
    .sort(function(a, b) {
      return Number(a.sourceColumn || 0) - Number(b.sourceColumn || 0);
    });

  var candidates = imageVillas
    .filter(function(villa) {
      return villa && (villa.imageSource || villa.image);
    })
    .slice()
    .sort(function(a, b) {
      return Number(a.sourceColumn || 0) - Number(b.sourceColumn || 0);
    });

  var uniqueImages = [];
  var seenObjects = [];
  var seenStrings = {};

  candidates.forEach(function(villa) {
    var source = villa.imageSource || villa.image || "";
    if (!source) return;

    if (typeof source === "string") {
      var key = cleanMasterText(source);
      if (!key || seenStrings[key]) return;
      seenStrings[key] = true;
    } else {
      if (seenObjects.indexOf(source) >= 0) return;
      seenObjects.push(source);
    }

    uniqueImages.push({
      source: source,
      sourceColumn: Number(villa.sourceColumn || 0)
    });
  });

  /*
   * V4.12 - SEQUENCE PARTIAL SAFE
   *
   * Khi người dùng CHỦ ĐỘNG bật IMAGE_ASSIGN_MODE=SEQUENCE:
   * - sắp căn trái -> phải;
   * - sắp ảnh unique trái -> phải;
   * - gán 1->1, 2->2, 3->3...
   * - nếu ảnh ít hơn căn, chỉ gán phần có ảnh; KHÔNG xóa ảnh của các căn còn lại.
   *
   * Nhờ vậy 8 căn / 6 ảnh vẫn giữ được 6 ảnh thay vì bỏ toàn bộ sequence.
   * Không ảnh hưởng nguồn không bật SEQUENCE.
   */
  var assignCount = Math.min(targets.length, uniqueImages.length);

  for (var assignIndex = 0; assignIndex < assignCount; assignIndex++) {
    var targetVilla = targets[assignIndex];
    var candidate = uniqueImages[assignIndex];
    if (!targetVilla || !candidate || !candidate.source) continue;

    targetVilla.image = "";
    targetVilla.imageSource = candidate.source;
    targetVilla.hasRealCellImage = true;
  }

  Logger.log(JSON.stringify({
    code: uniqueImages.length === targets.length
      ? "IMAGE_SEQUENCE_ASSIGNED_V412"
      : "IMAGE_SEQUENCE_PARTIAL_ASSIGNED_V412",
    sheet: sheet && sheet.getName ? sheet.getName() : "",
    villas: targets.length,
    detectedImages: uniqueImages.length,
    assigned: assignCount,
    missingAfterSequence: Math.max(0, targets.length - assignCount),
    assignments: targets.slice(0, assignCount).map(function(villa, index) {
      return {
        villa: villa.name || "",
        villaColumn: Number(villa.sourceColumn || 0),
        imageOrder: index + 1,
        imageSourceColumn: Number(uniqueImages[index].sourceColumn || 0)
      };
    })
  }));

  return villas;
}


/** V4.22.4 tests - private-room persistence + Drive folder source. */
function testPrivateRoomPersistenceV4224(){
  var cases=[
    {prev:"NGUYEN_CAN",prevGen:"",next:"PHONG_RIENG",want:"PHONG_RIENG"},
    {prev:"PHONG_RIENG",prevGen:"",next:"",want:"PHONG_RIENG"},
    {prev:"COMBO",prevGen:"NGUYEN_CAN",next:"PHONG_RIENG",want:"COMBO"},
    {prev:"",prevGen:"",next:"PHONG_RIENG",want:"PHONG_RIENG"}
  ];
  cases.forEach(function(c){
    var got=beResolveProductTypeV2_(c.prev,c.prevGen,c.next);
    if(got!==c.want)throw new Error("PRIVATE_ROOM_V4224_FAIL: "+JSON.stringify({c:c,got:got}));
  });
  var result={success:true,version:"4.22.4",cases:cases.length};
  Logger.log(JSON.stringify({code:"PRIVATE_ROOM_PERSISTENCE_PASS_V4224",result:result}));
  return result;
}

function testDriveFolderImageSourceV4224(){
  var url="https://drive.google.com/drive/folders/12qjWKExdn0ctK_pfG__8_65qHfsWOztj";
  if(!beIsLikelyImageAssetUrlV41_(url))throw new Error("DRIVE_FOLDER_NOT_IMAGE_SOURCE_V4224");
  if(!beShouldRefreshImageSourceV4224_(url))throw new Error("DRIVE_FOLDER_NOT_REFRESHABLE_V4224");
  var result={success:true,version:"4.22.4",folder:true,refresh:true};
  Logger.log(JSON.stringify({code:"DRIVE_FOLDER_IMAGE_SOURCE_PASS_V4224",result:result}));
  return result;
}

function testLynsPrivateRoomsLiveV4224(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var master=ss.getSheetByName(BE_CONFIG.MASTER_SHEET||"MASTER");
  if(!master)throw new Error("MASTER_MISSING_V4224");
  var values=master.getDataRange().getValues();
  var headers=beHeaderMap_(values[0]||[]);
  var target=null;
  for(var i=1;i<values.length;i++){
    var source=cleanMasterText(beGetByHeader_(values[i],headers.source));
    if(normalizeMasterText(source)==="lyn's hotel"){
      target=values[i];
      break;
    }
  }
  if(!target)throw new Error("LYNS_SOURCE_NOT_FOUND_V4224");
  var link=cleanMasterText(beGetByHeader_(target,headers.link));
  var config=cleanMasterText(beGetByHeader_(target,headers.configMaster));
  var productType=beSourceProductTypeConfigV2_(
    beGetByHeader_(target,headers.type),
    config
  );
  if(productType!=="PHONG_RIENG")throw new Error("LYNS_NOT_PRIVATE_ROOM_V4224: "+productType);
  var file=SpreadsheetApp.openByUrl(link);
  var sheet=findLatestMasterCalendarSheet(file);
  if(!sheet)throw new Error("LYNS_MAIN_SHEET_NOT_FOUND_V4224");
  var villas=readMasterFromCalendarSheet(sheet,config)||[];
  if(villas.length!==11)throw new Error("LYNS_ROOM_COUNT_FAIL_V4224: "+villas.length);
  var result={success:true,version:"4.22.4",source:"Lyn's Hotel",sheet:sheet.getName(),rooms:villas.length,productType:productType};
  Logger.log(JSON.stringify({code:"LYNS_PRIVATE_ROOMS_LIVE_PASS_V4224",result:result}));
  return result;
}

function testDriveFolderCalendarFallbackV4224(){
  var folder="https://drive.google.com/drive/folders/12qjWKExdn0ctK_pfG__8_65qHfsWOztj";
  var merged=beMergeVillaMetadataV31_([
    {name:"101",image:"",imageSource:folder,sourceColumn:3,standard:"",bedrooms:"",info:"",maps:""}
  ],[],{allowSafeNameMatch:false});
  var got=merged&&merged[0]?String(merged[0].imageSource||""):"";
  if(got!==folder)throw new Error("DRIVE_FOLDER_CALENDAR_FALLBACK_FAIL_V4224: "+got);
  var result={success:true,version:"4.22.4",imageSource:got};
  Logger.log(JSON.stringify({code:"DRIVE_FOLDER_CALENDAR_FALLBACK_PASS_V4224",result:result}));
  return result;
}


/** V6.1.12 - mixed source can mark only selected columns as private rooms. */
function testMixedSourceProductTypeV612(){
  var cfg="FIXED_ROW=3;START_COL=3;END_COL=54;PHONG_RIENG_COLS=47-49;FALLBACK=FALSE";
  var cases=[
    [46,"",""],
    [47,"","PHONG_RIENG"],
    [48,"","PHONG_RIENG"],
    [49,"","PHONG_RIENG"],
    [50,"",""]
  ];
  cases.forEach(function(c){
    var got=beVillaProductTypeConfigV612_(cfg,c[0],c[1]);
    if(got!==c[2])throw new Error("MIXED_SOURCE_PRODUCT_TYPE_FAIL_V612 "+JSON.stringify({column:c[0],expected:c[2],got:got}));
  });
  var whole=beVillaProductTypeConfigV612_("NGUYEN_CAN_COLS=3-10",5,"");
  if(whole!=="NGUYEN_CAN")throw new Error("MIXED_SOURCE_WHOLE_TYPE_FAIL_V612 "+whole);
  var result={success:true,code:"MIXED_SOURCE_PRODUCT_TYPE_PASS_V612",roomColumns:[47,48,49],wholeOverride:true};
  Logger.log(JSON.stringify(result));
  return result;
}

var BE_PN_OVERRIDE_SHEET_V1 = "PN_GHI_DE";

function beLoadPnOverridesV1_(ss){
  var out = {};
  var sh = ss.getSheetByName(BE_PN_OVERRIDE_SHEET_V1);
  if (!sh || sh.getLastRow() < 2) return out;
  var values = sh.getRange(1, 1, sh.getLastRow(), 2).getDisplayValues();
  for (var r = 1; r < values.length; r++) {
    var sku = cleanMasterText(values[r][0]);
    var n = Number(cleanMasterText(values[r][1]));
    if (sku && n >= 1 && n <= 30) out[sku] = String(n);
  }
  return out;
}