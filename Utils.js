/** 01_Utils.gs - shared helpers */

function beNowIso_(){ return new Date().toISOString(); }
function beSafeString_(v){ return v === null || v === undefined ? "" : String(v).trim(); }
function beJson_(v){ return JSON.stringify(v, null, 2); }

/**
 * CALENDAR ENGINE V2 - UTILS
 */

function ceNormalize_(value) {
  if (typeof normalizeMasterText === "function") {
    return normalizeMasterText(value);
  }

  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ");
}

function ceCell_(row, column) {
  if (
    column === null ||
    column === undefined ||
    column < 0 ||
    !row ||
    column >= row.length
  ) {
    return "";
  }

  return row[column] === null || row[column] === undefined
    ? ""
    : row[column];
}

function ceFindHeader_(headers, candidates) {
  var normalizedCandidates = candidates.map(ceNormalize_);

  for (var i = 0; i < normalizedCandidates.length; i++) {
    var exact = headers.indexOf(normalizedCandidates[i]);
    if (exact >= 0) return exact;
  }

  for (var c = 0; c < headers.length; c++) {
    if (!headers[c]) continue;

    for (var j = 0; j < normalizedCandidates.length; j++) {
      if (headers[c].indexOf(normalizedCandidates[j]) >= 0) {
        return c;
      }
    }
  }

  return -1;
}

function ceParseInteger_(value) {
  var match = String(value || "").match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function ceCleanVillaName_(value) {
  var text = String(value || "").trim();

  if (text.indexOf("\n") >= 0) {
    text = text.split(/\r?\n/)[0].trim();
  }

  return text;
}

function ceSimplifyVillaName_(value) {
  return String(value || "")
    .replace(/\b(villa|homestay|home|hotel|resort)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ceLooksLikeVillaName_(value) {
  var text = String(value || "").trim();
  var normalized = ceNormalize_(text);

  if (!text || text.length > 100) return false;
  if (/^\d+$/.test(text)) return false;
  if (ceParsePrice_(text) !== null) return false;

  var invalid = [
    "thang ngay",
    "ngay",
    "thu",
    "so luong khach",
    "ghi chu",
    "luu y",
    "chinh sach",
    "gia",
    "thong tin"
  ];

  return !invalid.some(function(keyword) {
    return normalized.indexOf(keyword) >= 0;
  });
}

function ceParseInputDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return ceStartOfDay_(value);
  }

  var text = String(value || "").trim();
  if (!text) return null;

  var match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (match) {
    var y1 = Number(match[1]), m1 = Number(match[2]), d1 = Number(match[3]);
    var candidate1 = new Date(y1, m1 - 1, d1);
    if (candidate1.getFullYear() !== y1 || candidate1.getMonth() !== m1 - 1 || candidate1.getDate() !== d1) return null;
    return ceStartOfDay_(candidate1);
  }

  match = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);

  if (match) {
    var y2 = Number(match[3]), m2 = Number(match[2]), d2 = Number(match[1]);
    var candidate2 = new Date(y2, m2 - 1, d2);
    if (candidate2.getFullYear() !== y2 || candidate2.getMonth() !== m2 - 1 || candidate2.getDate() !== d2) return null;
    return ceStartOfDay_(candidate2);
  }

  var parsed = new Date(text);

  return isNaN(parsed.getTime())
    ? null
    : ceStartOfDay_(parsed);
}

function ceParseCalendarDate_(
  rawValue,
  displayValue,
  sheetName,
  fallbackDate
) {
  if (rawValue instanceof Date && !isNaN(rawValue.getTime())) {
    return ceStartOfDay_(rawValue);
  }

  var text = String(displayValue || rawValue || "").trim();
  if (!text) return null;

  var match = text.match(
    /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/
  );

  if (match) {
    var fullYear = Number(match[3]);
    if (fullYear < 100) fullYear += 2000;

    return new Date(
      fullYear,
      Number(match[2]) - 1,
      Number(match[1])
    );
  }

  match = text.match(/^(\d{1,2})[\/.-](\d{1,2})$/);

  if (match) {
    var year =
      ceExtractYearFromSheetName_(sheetName) ||
      fallbackDate.getFullYear();

    return new Date(
      year,
      Number(match[2]) - 1,
      Number(match[1])
    );
  }

  match = text.match(/^(\d{1,2})$/);

  if (match) {
    var month =
      ceExtractMonthFromSheetName_(sheetName) ||
      (fallbackDate.getMonth() + 1);

    var fallbackYear =
      ceExtractYearFromSheetName_(sheetName) ||
      fallbackDate.getFullYear();

    return new Date(
      fallbackYear,
      month - 1,
      Number(match[1])
    );
  }

  return null;
}

function ceExtractMonthFromSheetName_(sheetName) {
  var name = ceNormalize_(sheetName);
  var nameAltV1 = typeof ceNormalizeMonthSheetTextV1_ === "function" ? ceNormalizeMonthSheetTextV1_(sheetName) : name;

  var patterns = [
    /thang\s*0?(\d{1,2})/,
    /\bt0?(\d{1,2})\b/,
    /\b0?(\d{1,2})\s*[\/_-]\s*20\d{2}\b/
  ];

  for (var i = 0; i < patterns.length; i++) {
    var match = name.match(patterns[i]) || nameAltV1.match(patterns[i]);

    if (match) {
      var month = Number(match[1]);
      if (month >= 1 && month <= 12) return month;
    }
  }

  return null;
}

function ceExtractYearFromSheetName_(sheetName) {
  var match = String(sheetName || "").match(/\b(20\d{2})\b/) || (typeof ceYearMatchV1_ === "function" ? ceYearMatchV1_(sheetName) : null);
  return match ? Number(match[1]) : null;
}

function ceListNights_(checkIn, checkOut) {
  var result = [];
  var cursor = new Date(checkIn.getTime());

  while (cursor.getTime() < checkOut.getTime()) {
    result.push(new Date(cursor.getTime()));
    cursor.setDate(cursor.getDate() + 1);
  }

  return result;
}

function ceStartOfDay_(date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
}

function ceSameDate_(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function ceDateKey_(date) {
  return [
    date.getFullYear(),
    ("0" + (date.getMonth() + 1)).slice(-2),
    ("0" + date.getDate()).slice(-2)
  ].join("-");
}

function ceDisplayDate_(date) {
  return [
    ("0" + date.getDate()).slice(-2),
    ("0" + (date.getMonth() + 1)).slice(-2),
    date.getFullYear()
  ].join("/");
}

function ceHexToRgb_(hex) {
  var text = String(hex || "").trim();

  var match = text.match(
    /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i
  );

  if (!match) return null;

  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16)
  };
}

function ceIsRed_(hex) {
  var rgb = ceHexToRgb_(hex);
  if (!rgb) return false;

  return (
    rgb.r >= 180 &&
    rgb.g <= 110 &&
    rgb.b <= 110 &&
    rgb.r >= rgb.g * 1.5 &&
    rgb.r >= rgb.b * 1.5
  );
}

function ceIsYellow_(hex) {
  var rgb = ceHexToRgb_(hex);
  if (!rgb) return false;

  return (
    rgb.r >= 180 &&
    rgb.g >= 150 &&
    rgb.b <= 130 &&
    Math.abs(rgb.r - rgb.g) <= 110
  );
}
