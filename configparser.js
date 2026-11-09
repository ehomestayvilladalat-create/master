/** 02_ConfigParser.gs - V5.2 CLEAN CALENDAR + IMAGE SEQUENCE CONFIG */
function beCanonicalConfigKey_(key) {
  var raw = String(key || "").trim().toUpperCase();
  var normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/Đ/g, "D")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  var aliases = {
    "TRANG_TINH": "SHEET",
    "BO_CUC": "LAYOUT",
    "THEO_COT": "COLUMN",
    "THEO_HANG": "ROW",
    "TU_DONG": "AUTO",
    "LICH_MOI_NHAT": "LATEST_CALENDAR",
    "COT_BAT_DAU": "START_COL",
    "COT_KET_THUC": "END_COL",
    "HANG_BAT_DAU": "START_ROW",
    "HANG_TEN": "NAME_ROW",
    "COT_TEN": "NAME_COL",
    "HANG_ANH": "IMAGE_ROW",
    "COT_ANH": "IMAGE_COL",
    "VUNG_HANG_TEN": "NAME_SCAN_ROWS",
    "VUNG_HANG_ANH": "IMAGE_SCAN_ROWS",
    "HANG_THONG_TIN": "INFO_ROW",
    "VUNG_HANG_THONG_TIN": "INFO_ROWS",
    "COT_THONG_TIN": "INFO_COL",
    "HANG_MAPS": "MAPS_ROW",
    "COT_MAPS": "MAPS_COL",
    "HANG_TIEU_CHUAN": "STANDARD_ROW",
    "COT_TIEU_CHUAN": "STANDARD_COL",
    "HANG_PHONG_NGU": "BEDROOMS_ROW",
    "COT_PHONG_NGU": "BEDROOMS_COL",
    "SO_HANG_QUET": "SCAN_ROWS",
    "SO_COT_QUET": "SCAN_COLS",
    "THONG_TIN_CUNG_O_TEN": "INFO_FROM_NAME_CELL",
    "BAT_BUOC_ANH": "REQUIRE_IMAGE",
    "YEU_CAU_ANH": "REQUIRE_IMAGE",
    "GHEP_ANH": "IMAGE_ASSIGN_MODE",
    "CHE_DO_GHEP_ANH": "IMAGE_ASSIGN_MODE",

    // V5.3 - tên căn cố định cho nguồn một căn không có hàng tên rõ ràng.
    "TEN_CO_DINH": "FIXED_NAME",
    "TEN_CAN_CO_DINH": "FIXED_NAME",
    "TEN_VILLA_CO_DINH": "FIXED_NAME",

    // V5.0 - CONFIG LỊCH dễ đọc, có thể khóa cột/hàng ngày.
    "COT_NGAY": "DATE_COL",
    "COT_NGAY_LICH": "DATE_COL",
    "COT_LICH_NGAY": "DATE_COL",

    "HANG_NGAY": "DATE_ROWS",
    "VUNG_HANG_NGAY": "DATE_ROWS",
    "HANG_LICH": "DATE_ROWS",
    "VUNG_HANG_LICH": "DATE_ROWS",

    "HANG_BAT_DAU_NGAY": "DATE_START_ROW",
    "HANG_BAT_DAU_LICH": "DATE_START_ROW",
    "HANG_KET_THUC_NGAY": "DATE_END_ROW",
    "HANG_KET_THUC_LICH": "DATE_END_ROW",

    "DINH_DANG_NGAY": "DATE_ORDER",
    "KIEU_NGAY": "DATE_ORDER",

    "TRANG_LICH": "CALENDAR_SHEET",
    "SHEET_LICH": "CALENDAR_SHEET"
  };

  return aliases[normalized] || normalized;
}

function beCanonicalConfigValue_(key, value) {
  var text = String(value === null || value === undefined ? "" : value).trim();
  var normalized = text
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/Đ/g, "D")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (key === "LAYOUT") {
    if (normalized === "THEO_COT") return "COLUMN";
    if (normalized === "THEO_HANG") return "ROW";
    if (normalized === "TU_DONG") return "AUTO";
  }
  if (key === "SHEET") {
    if (normalized === "TU_DONG") return "AUTO";
    if (normalized === "LICH_MOI_NHAT") return "LATEST_CALENDAR";
  }

  if (key === "DATE_ORDER") {
    if (["DM", "DMY", "NGAY_THANG", "NGAY_THANG_NAM"].indexOf(normalized) >= 0) {
      return "DM";
    }
    if (["MD", "MDY", "THANG_NGAY", "THANG_NGAY_NAM"].indexOf(normalized) >= 0) {
      return "MD";
    }
    return "AUTO";
  }
  if (key === "INFO_FROM_NAME_CELL" || key === "REQUIRE_IMAGE") {
    if (["CO", "YES", "TRUE", "1"].indexOf(normalized) >= 0) return true;
    if (["KHONG", "NO", "FALSE", "0"].indexOf(normalized) >= 0) return false;
  }
  return text;
}

function parseBookingSourceConfig(rawConfig) {
  var result = {};
  if (!rawConfig) return result;

  if (typeof rawConfig === "object" && !Array.isArray(rawConfig)) {
    Object.keys(rawConfig).forEach(function(key) {
      var canonicalKey = beCanonicalConfigKey_(key);
      result[canonicalKey] = beCanonicalConfigValue_(canonicalKey, rawConfig[key]);
    });
    return result;
  }

  String(rawConfig).split(/[;\n]+/).forEach(function(part) {
    part = String(part || "").trim();
    if (!part) return;

    var separator = part.indexOf("=");
    if (separator < 0) {
      result[beCanonicalConfigKey_(part)] = true;
      return;
    }

    var canonicalKey = beCanonicalConfigKey_(part.slice(0, separator));
    result[canonicalKey] = beCanonicalConfigValue_(
      canonicalKey,
      part.slice(separator + 1)
    );
  });

  return result;
}

function beParseRowRangeConfig_(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue.map(Number).filter(function(row) { return row > 0; });
  }

  var text = String(rawValue || "").trim();
  if (!text) return [];
  var rows = [];

  text.split(/[,|]+/).forEach(function(part) {
    part = String(part || "").trim();
    if (!part) return;
    var match = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (match) {
      var start = Number(match[1]);
      var end = Number(match[2]);
      if (start > end) { var temp = start; start = end; end = temp; }
      for (var row = start; row <= end; row++) rows.push(row);
      return;
    }
    var single = Number(part);
    if (single > 0) rows.push(single);
  });

  return rows.filter(function(row, index, all) {
    return all.indexOf(row) === index;
  });
}

function beConfigValue_(cfg, keys, fallback) {
  cfg = cfg || {};

  for (var i = 0; i < keys.length; i++) {
    var key = String(keys[i]).toUpperCase();
    var value = cfg[key];

    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ""
    ) {
      return value;
    }
  }

  return fallback;
}

function beConfigInt_(cfg, keys, fallback) {
  var value = parseInt(beConfigValue_(cfg, keys, fallback), 10);
  return Number.isFinite(value) ? value : fallback;
}

function beConfigBool_(cfg, keys, fallback) {
  var value = beConfigValue_(cfg, keys, "");
  if (value === "") return fallback;

  var normalized = ceNormalize_(value);
  if (["1", "true", "yes", "y", "co"].indexOf(normalized) >= 0) return true;
  if (["0", "false", "no", "n", "khong"].indexOf(normalized) >= 0) return false;
  return fallback;
}

/**
 * Đọc CONFIG ẢNH hoặc CONFIG THÔNG TIN.
 *
 * Dạng mỗi hàng là một căn:
 * SHEET=Thông tin;LAYOUT=ROW;HEADER_ROW=1;START_ROW=2;
 * NAME_COL=A;IMAGE_COL=B;INFO_COL=C;MAPS_COL=D
 *
 * Dạng mỗi cột là một căn:
 * SHEET=Thông tin;LAYOUT=COLUMN;START_COL=3;
 * NAME_ROW=2;IMAGE_ROW=6;INFO_ROW=8;MAPS_ROW=9
 *
 * Tên và ảnh/thông tin không cần cùng hàng; chỉ cần cùng cột của một căn.
 */
function parseMetadataConfig(rawConfig) {
  var source = parseBookingSourceConfig(rawConfig);
  var layout = String(beConfigValue_(source, [
    "INFO_LAYOUT", "METADATA_LAYOUT", "LAYOUT"
  ], "AUTO")).trim().toUpperCase();

  var isRowLayout = layout === "ROW" || layout === "ROWS";
  var isColumnLayout = layout === "COLUMN" || layout === "COLUMNS";

  /*
   * NAME_ROW và START_COL vốn đã được CONFIG MASTER dùng để đọc tên ở lịch.
   * Chỉ coi chúng là config metadata khi INFO_LAYOUT=COLUMN được ghi rõ.
   * Tương tự, NAME_COL/START_ROW chỉ dùng khi INFO_LAYOUT=ROW.
   * Các key INFO_* luôn ưu tiên và không xung đột.
   */
  var config = {
    raw: source,
    layout: layout,

    sheetName: String(beConfigValue_(source, [
      "SHEET", "TAB", "INFO_SHEET", "METADATA_SHEET", "SHEET_INFO"
    ], "")).trim(),

    headerRow: beConfigInt_(source, ["INFO_HEADER_ROW"],
      isRowLayout ? beConfigInt_(source, ["HEADER_ROW"], 0) : 0),
    startRow: beConfigInt_(source, ["INFO_START_ROW", "DATA_START_ROW"],
      isRowLayout ? beConfigInt_(source, ["START_ROW"], 0) : 0),
    endRow: beConfigInt_(source, ["INFO_END_ROW", "DATA_END_ROW"],
      isRowLayout ? beConfigInt_(source, ["END_ROW"], 0) : 0),
    startCol: beConfigInt_(source, ["INFO_START_COL", "DATA_START_COL"],
      isColumnLayout ? beConfigInt_(source, ["START_COL"], 0) : 0),
    endCol: beConfigInt_(source, ["INFO_END_COL", "DATA_END_COL"],
      isColumnLayout ? beConfigInt_(source, ["END_COL"], 0) : 0),

    nameRow: beConfigInt_(source, ["INFO_NAME_ROW"],
      isColumnLayout ? beConfigInt_(source, ["NAME_ROW"], 0) : 0),
    nameCol: beConfigValue_(source, ["INFO_NAME_COL"],
      isRowLayout ? beConfigValue_(source, ["NAME_COL"], "") : ""),

    imageRow: beConfigInt_(source, ["IMAGE_ROW", "PHOTO_ROW"], 0),
    imageRows: beParseRowRangeConfig_(
      beConfigValue_(source, ["IMAGE_SCAN_ROWS", "IMAGE_ROWS"], "")
    ),
    imageCol: beConfigValue_(source, ["IMAGE_COL", "PHOTO_COL"], ""),
    requireImage: beConfigBool_(source, ["REQUIRE_IMAGE"], false),

    infoRow: beConfigInt_(source, ["INFO_ROW", "DESCRIPTION_ROW"], 0),
    infoRows: (function() {
      var explicitRows = beParseRowRangeConfig_(
        beConfigValue_(source, ["INFO_ROWS"], "")
      );
      if (explicitRows.length) return explicitRows;

      // Cho phép cấu hình quen thuộc HÀNG_THÔNG_TIN=40-59.
      // Số đơn vẫn đi vào infoRow; chuỗi dạng vùng được mở thành nhiều hàng.
      var legacyInfoRow = String(
        beConfigValue_(source, ["INFO_ROW", "DESCRIPTION_ROW"], "") || ""
      ).trim();
      return /[-,]/.test(legacyInfoRow)
        ? beParseRowRangeConfig_(legacyInfoRow)
        : [];
    })(),
    infoCol: beConfigValue_(source, ["INFO_COL", "DESCRIPTION_COL"], ""),

    mapsRow: beConfigInt_(source, ["MAP_ROW", "MAPS_ROW"], 0),
    mapsCol: beConfigValue_(source, ["MAP_COL", "MAPS_COL"], ""),

    standardRow: beConfigInt_(source, ["STANDARD_ROW", "CAPACITY_ROW"], 0),
    standardCol: beConfigValue_(source, ["STANDARD_COL", "CAPACITY_COL"], ""),

    bedroomsRow: beConfigInt_(source, ["BEDROOMS_ROW", "PN_ROW"], 0),
    bedroomsCol: beConfigValue_(source, ["BEDROOMS_COL", "PN_COL"], ""),

    scanRows: beConfigInt_(source, ["INFO_SCAN_ROWS", "SCAN_ROWS", "TOP_ROWS"], 80),
    scanCols: beConfigInt_(source, ["INFO_SCAN_COLS", "SCAN_COLS"], 120)
  };

  beApplyGenericMetadataRef_(config, "image", beConfigValue_(source, ["IMAGE", "PHOTO"], ""));
  beApplyGenericMetadataRef_(config, "info", beConfigValue_(source, ["INFO", "DESCRIPTION"], ""));
  beApplyGenericMetadataRef_(config, "maps", beConfigValue_(source, ["MAPS", "MAP"], ""));

  if (["ROW", "ROWS", "COLUMN", "COLUMNS", "AUTO"].indexOf(config.layout) < 0) {
    config.layout = "AUTO";
  }

  var requiredRows = [
    config.nameRow,
    config.imageRow,
    config.infoRow,
    config.mapsRow,
    config.standardRow,
    config.bedroomsRow
  ].concat(config.imageRows || [], config.infoRows || []);
  var highestRequiredRow = requiredRows.reduce(function(maximum, row) {
    row = Number(row || 0);
    return row > maximum ? row : maximum;
  }, 0);

  config.scanRows = Math.max(1, config.scanRows || 80, highestRequiredRow, Number(config.endRow || 0));
  config.scanCols = Math.max(1, config.scanCols || 120, Number(config.endCol || 0));
  return config;
}

/**
 * Cho phép viết gọn IMAGE=B ở layout ROW hoặc IMAGE=3 ở layout COLUMN.
 * AUTO không ép vị trí, reader vẫn tự nhận.
 */
function beApplyGenericMetadataRef_(config, field, rawValue) {
  if (rawValue === null || rawValue === undefined) return;

  var value = String(rawValue).trim();
  if (!value || value.toUpperCase() === "AUTO") return;

  var rowKey = field + "Row";
  var colKey = field + "Col";

  if ((config.layout === "ROW" || config.layout === "ROWS") && !config[colKey]) {
    config[colKey] = value;
    return;
  }

  if ((config.layout === "COLUMN" || config.layout === "COLUMNS") && !config[rowKey]) {
    var row = parseInt(value, 10);
    if (Number.isFinite(row) && row > 0) config[rowKey] = row;
    return;
  }

  // Khi layout AUTO: chữ là cột, số là hàng.
  if (/^[A-Za-z]+$/.test(value) && !config[colKey]) {
    config[colKey] = value;
  } else if (/^\d+$/.test(value) && !config[rowKey]) {
    config[rowKey] = parseInt(value, 10);
  }
}


/** Alias rõ nghĩa cho hai cột config mới trong MASTER. */
function parseImageConfig(rawConfig) {
  var config = parseMetadataConfig(rawConfig);
  config.kind = "IMAGE";
  return config;
}

function parseInfoConfig(rawConfig) {
  var config = parseMetadataConfig(rawConfig);
  config.kind = "INFO";
  return config;
}

function testConfigParser(rawConfig) {
  var result = {
    source: parseBookingSourceConfig(rawConfig),
    metadata: parseMetadataConfig(rawConfig)
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/** V5.3 self-test: END_COL metadata + FIXED_NAME alias. Không mở source. */
function testConfigParserV53(){
  var image = parseMetadataConfig("LAYOUT=COLUMN;START_COL=3;END_COL=6;IMAGE_ROW=6");
  if (Number(image.startCol) !== 3 || Number(image.endCol) !== 6) {
    throw new Error("V53 FAIL metadata END_COL: " + JSON.stringify(image));
  }

  var fixed = parseBookingSourceConfig("TÊN_CỐ_ĐỊNH=B37 VILLA;START_COL=3;END_COL=3");
  if (String(fixed.FIXED_NAME || "") !== "B37 VILLA") {
    throw new Error("V53 FAIL FIXED_NAME alias: " + JSON.stringify(fixed));
  }

  var result = {success:true,version:"5.3-metadata-endcol-fixed-name",endColPass:true,fixedNameAliasPass:true};
  Logger.log(JSON.stringify({code:"CONFIG_PARSER_PASS_V53",result:result}));
  return result;
}
