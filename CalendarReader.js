/** 06_CalendarReader.gs - V6.0 DATE SPILLOVER SAFETY + V5.9 PRICE CONTEXT */
/** V3.0 - request-local caches. Không cache FREE/BUSY giữa các request. */
var CE_CALENDAR_CONFIG_CACHE_V30_ = {};
var CE_GROUP_OPTIONS_CACHE_V30_ = {};

function ceParsePrice_(value){
  if(value===null||value===undefined||value==='') return null;

  /*
   * V5.6 - PRICE NORMALIZER V1
   *
   * Quy ước dữ liệu giá thực tế của hệ thống villa:
   * - 0 < số < 100      => đơn vị TRIỆU
   *   3     -> 3.000.000
   *   5.5   -> 5.500.000
   *   12    -> 12.000.000
   *
   * - 100 <= số < 100000 => đơn vị NGHÌN
   *   750   ->   750.000
   *   1500  -> 1.500.000
   *   2800  -> 2.800.000
   *   6500  -> 6.500.000
   *
   * - số >= 100000      => đã là VNĐ thật, giữ nguyên
   *   750000  ->   750.000
   *   2800000 -> 2.800.000
   *
   * Các chuỗi có đơn vị rõ ràng như tr / triệu / k / nghìn vẫn được ưu tiên
   * parse theo đơn vị ghi trong ô.
   *
   * Nội dung trong ngoặc kiểu (6k), (6 khách), (6 pax) là sức chứa,
   * không được hiểu là 6.000đ.
   */
  if(typeof value==='number'&&isFinite(value)){
    return ceNormalizePriceNumberV56_(value);
  }

  var rawText=String(value||'').trim();
  if(!rawText) return null;

  var text=ceNormalize_(rawText)
    .replace(/\u00a0/g,' ')
    .replace(/[₫đ]/g,'d')
    .replace(/\s+/g,' ')
    .trim();

  text=ceStripGuestAnnotationFromPriceV51_(text);

  // Bỏ các từ dẫn không ảnh hưởng giá.
  text=text
    .replace(/^(?:gia|price|gia\s*phong|gia\s*can)\s*[:=\-]?\s*/i,'')
    .trim();

  /*
   * 1tr5 / 1tr50 / 1tr500
   * - 1tr5   = 1.5 triệu
   * - 1tr50  = 1.50 triệu
   * - 1tr500 = 1.500 triệu
   */
  var m=text.match(/(?:^|[^\d])(\d+)\s*tr\s*(\d{1,3})(?!\d)/i);
  if(m){
    return Math.round(
      (Number(m[1])+Number(m[2])/Math.pow(10,m[2].length))*1000000
    );
  }

  /*
   * 1.5tr / 1,5tr / 1.5 triệu / 1,5 triệu
   */
  m=text.match(/(?:^|[^\d])(\d+)(?:[.,](\d+))?\s*(?:tr|trieu|trieu\s*dong)(?![a-z])/i);
  if(m){
    return Math.round(
      (Number(m[1])+(m[2]?Number('0.'+m[2]):0))*1000000
    );
  }

  /*
   * 1500k / 850k / 1500 nghìn
   */
  m=text.match(/(?:^|[^\d])(\d+(?:[.,]\d+)?)\s*(?:k|nghin|ngan)(?![a-z])/i);
  if(m){
    return Math.round(Number(m[1].replace(',','.'))*1000);
  }

  /*
   * 1.500.000 / 1,500,000 / 750.000
   *
   * Nếu sau khi bỏ dấu mà số vẫn < 100000 thì áp quy ước shorthand:
   * "2,800" -> 2800 -> 2.800.000
   * Còn "750.000" -> 750000 giữ nguyên.
   */
  m=text.match(/(?:^|[^\d])(\d{1,3}(?:[.,]\d{3}){1,3})(?!\d)/);
  if(m){
    return ceNormalizePriceNumberV56_(
      Number(m[1].replace(/[.,]/g,''))
    );
  }

  /*
   * Số + hậu tố VND/đồng/d nhưng không có dấu phân cách:
   * 2800VND -> 2.800.000
   * 750000VND -> 750.000
   */
  m=text.match(/^\s*(\d+(?:[.,]\d+)?)\s*(?:vnd|dong|d)\s*$/i);
  if(m){
    return ceNormalizePriceNumberV56_(
      Number(m[1].replace(',','.'))
    );
  }

  /*
   * Số text thuần:
   * "3"    -> 3.000.000
   * "5,5"  -> 5.500.000
   * "2800" -> 2.800.000
   */
  if(/^\d+(?:[.,]\d+)?$/.test(text)){
    return ceNormalizePriceNumberV56_(
      Number(text.replace(',','.'))
    );
  }

  return null;
}


/**
 * V5.9 - Parse giá theo context căn, tránh đoán sai ô có nhiều mức giá.
 *
 * Quy tắc:
 * - Giá đơn (7tr, 7tr5, 7.5tr, 7.000.000, 7000...) dùng ceParsePrice_ cũ.
 * - Giá nhiều tier gắn PN (vd 7tr/6pn 8tr/8pn): chỉ lấy tier khớp PN căn.
 * - Giá tổng nhiều đêm (vd 17tr/3đêm): không tự chia/đoán -> UNKNOWN giá.
 * - Nếu ô có nhiều tier nhưng căn thiếu PN/không khớp tier -> UNKNOWN giá.
 */
function ceParsePriceForVillaV59_(value,villa,optionLabel){
  if(value===null||value===undefined||value==='') return null;

  var rawText=String(value||'').trim();
  if(!rawText) return null;

  var text=ceNormalize_(rawText)
    .replace(/\u00a0/g,' ')
    .replace(/[₫đ]/g,'d')
    .replace(/\s+/g,' ')
    .trim();

  // Tổng giá theo nhiều đêm không được coi là giá 1 đêm.
  if(/\b\d+\s*tr(?:\s*\d{1,3})?\s*\/\s*\d+\s*(?:dem|night|nights)\b/i.test(text)){
    return null;
  }

  var tiers=ceExtractPriceBedroomTiersV59_(text);
  if(tiers.length>=2){
    var targetBedrooms=Number(villa&&villa.bedrooms||0);
    if(!(targetBedrooms>0)){
      targetBedrooms=ceBedroomsFromOptionLabelV59_(optionLabel);
    }
    if(!(targetBedrooms>0)) return null;

    var matches=tiers.filter(function(t){
      return targetBedrooms>=t.minBedrooms && targetBedrooms<=t.maxBedrooms;
    });
    if(!matches.length) return null;

    matches.sort(function(a,b){
      var aw=a.maxBedrooms-a.minBedrooms;
      var bw=b.maxBedrooms-b.minBedrooms;
      if(aw!==bw)return aw-bw;
      var ac=Math.abs(((a.minBedrooms+a.maxBedrooms)/2)-targetBedrooms);
      var bc=Math.abs(((b.minBedrooms+b.maxBedrooms)/2)-targetBedrooms);
      if(ac!==bc)return ac-bc;
      return a.index-b.index;
    });
    return matches[0].price;
  }

  // Một tier PN duy nhất vẫn chỉ lấy khi PN căn khớp; tránh đọc nhầm giá option khác.
  if(tiers.length===1){
    var one=tiers[0];
    var oneBedrooms=Number(villa&&villa.bedrooms||0);
    if(!(oneBedrooms>0)) oneBedrooms=ceBedroomsFromOptionLabelV59_(optionLabel);
    if(oneBedrooms>0){
      if(oneBedrooms>=one.minBedrooms && oneBedrooms<=one.maxBedrooms) return one.price;
      // Có PN rõ nhưng không khớp tier -> không đoán giá.
      return null;
    }
    // Không có PN căn: nếu text còn thêm giá khác thì không lấy tier đầu.
    var priceTokens=ceExtractMillionPriceTokensV59_(text);
    if(priceTokens.length>1)return null;
  }

  return ceParsePrice_(value);
}

function ceExtractMillionPriceTokensV59_(text){
  var src=String(text||'');
  var re=/(?:\d+\s*tr\s*\d{1,3}|\d+(?:[.,]\d+)?\s*(?:trieu|tr))(?![a-z])/gi;
  var out=[];
  var m;
  while((m=re.exec(src))!==null){
    var price=ceParsePrice_(m[0]);
    if(price!==null)out.push({text:m[0],price:price,index:m.index});
    if(re.lastIndex===m.index)re.lastIndex++;
  }
  return out;
}

function ceExtractPriceBedroomTiersV59_(text){
  var src=String(text||'');
  var pricePattern='(\\d+\\s*tr\\s*\\d{1,3}|\\d+(?:[.,]\\d+)?\\s*(?:trieu|tr))';
  var re=new RegExp(pricePattern+'\\s*\\/?\\s*(\\d+)(?:\\s*-\\s*(\\d+))?\\s*(?:pn|phong ngu|phong)\\b','gi');
  var out=[];
  var m;
  while((m=re.exec(src))!==null){
    var price=ceParsePrice_(m[1]);
    var minBedrooms=Number(m[2]||0);
    var maxBedrooms=Number(m[3]||m[2]||0);
    if(price!==null && minBedrooms>0 && maxBedrooms>=minBedrooms){
      out.push({
        price:price,
        minBedrooms:minBedrooms,
        maxBedrooms:maxBedrooms,
        index:m.index,
        raw:m[0]
      });
    }
    if(re.lastIndex===m.index)re.lastIndex++;
  }
  return out;
}

function ceBedroomsFromOptionLabelV59_(label){
  var text=ceNormalize_(String(label||''));
  var m=text.match(/\b(\d+)\s*(?:pn|phong ngu|phong)\b/i);
  return m?Number(m[1]||0):0;
}


/**
 * V5.6 - Chuẩn hóa số giá shorthand về VNĐ.
 */
function ceNormalizePriceNumberV56_(value){
  var n=Number(value);
  if(!isFinite(n)||n<=0)return null;

  if(n<100){
    return Math.round(n*1000000);
  }

  if(n<100000){
    return Math.round(n*1000);
  }

  return Math.round(n);
}

function ceStripGuestAnnotationFromPriceV51_(text){
  text=String(text||'');

  /*
   * Trong ngoặc, k được hiểu là khách theo quy ước nguồn:
   *   1tr5 (6k)       -> giữ 1tr5
   *   1tr5 (6 khách)  -> giữ 1tr5
   *   1tr5 (6 pax)    -> giữ 1tr5
   *
   * Chỉ xóa ngoặc nếu nội dung trông như sức chứa.
   */
  return text.replace(/\(([^()]*)\)/g,function(full,inner){
    var normalized=ceNormalize_(inner||'')
      .replace(/\s+/g,' ')
      .trim();

    if(
      /^\d+(?:[.,]\d+)?\s*(?:k|khach|nguoi|pax|guest|guests?)\b/i.test(normalized) ||
      /\b(?:khach|nguoi|pax|guest|guests?)\b/i.test(normalized)
    ){
      return ' ';
    }

    return full;
  }).replace(/\s+/g,' ').trim();
}

function ceFormatMoney_(value){
  var n=Number(value);
  if(!isFinite(n)||n<=0) return 'Liên hệ';

  /*
   * V5.6: ceParsePrice_ đã chuẩn hóa toàn bộ giá về VNĐ trước khi tới đây.
   * Formatter chỉ có nhiệm vụ hiển thị, không suy diễn đơn vị lần hai.
   */
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g,'.')+' đ';
}


function ceParseCalendarReadConfigV50_(rawConfig) {
  var rawKeyV30 = String(rawConfig || "AUTO");
  if (Object.prototype.hasOwnProperty.call(CE_CALENDAR_CONFIG_CACHE_V30_, rawKeyV30)) {
    return CE_CALENDAR_CONFIG_CACHE_V30_[rawKeyV30];
  }

  var cfg = {};
  try {
    cfg = parseBookingSourceConfig(rawKeyV30) || {};
  } catch (ignore) {}

  var rawRows = String(
    cfg.DATE_ROWS ||
    cfg.DATE_ROW ||
    cfg.CALENDAR_ROWS ||
    ""
  ).trim();

  var dateRows = [];
  if (rawRows) {
    if (typeof beParseRowRangeConfig_ === "function") {
      dateRows = beParseRowRangeConfig_(rawRows);
    } else {
      dateRows = ceParseRowsV50_(rawRows);
    }
  }

  var startRow = Number(cfg.DATE_START_ROW || 0);
  var endRow = Number(cfg.DATE_END_ROW || 0);

  if (!dateRows.length && (startRow > 0 || endRow > 0)) {
    if (!(startRow > 0)) startRow = 1;
    if (!(endRow > 0)) endRow = startRow;
    if (startRow > endRow) {
      var temp = startRow;
      startRow = endRow;
      endRow = temp;
    }
    for (var r = startRow; r <= endRow; r++) dateRows.push(r);
  }

  var order = String(cfg.DATE_ORDER || "AUTO").trim().toUpperCase();
  if (["DM", "MD", "AUTO"].indexOf(order) < 0) order = "AUTO";

  var calendarSheet = String(cfg.CALENDAR_SHEET || "").trim();
  if (/^(auto|tu_dong|tự_động)$/i.test(calendarSheet)) calendarSheet = "";

  var parsedV30 = {
    raw: cfg,
    dateColumn: ceConfigColumnIndexV50_(cfg.DATE_COL || cfg.DATE_COLUMN || ""),
    dateRows: dateRows,
    dateOrder: order,
    calendarSheet: calendarSheet
  };
  CE_CALENDAR_CONFIG_CACHE_V30_[rawKeyV30] = parsedV30;
  return parsedV30;
}

function ceParseRowsV50_(value) {
  var result = [];
  String(value || "").split(/[,|]+/).forEach(function(part) {
    part = String(part || "").trim();
    if (!part) return;

    var range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      var from = Number(range[1]);
      var to = Number(range[2]);
      if (from > to) {
        var temp = from;
        from = to;
        to = temp;
      }
      for (var r = from; r <= to; r++) {
        if (r > 0 && result.indexOf(r) < 0) result.push(r);
      }
      return;
    }

    var single = Number(part);
    if (single > 0 && result.indexOf(single) < 0) result.push(single);
  });

  return result.sort(function(a, b) { return a - b; });
}

function ceConfigColumnIndexV50_(value) {
  var text = String(value == null ? "" : value).trim().toUpperCase();
  if (!text || text === "AUTO") return -1;

  if (/^\d+$/.test(text)) {
    var numeric = Number(text);
    return numeric > 0 ? numeric - 1 : -1;
  }

  if (/^[A-Z]+$/.test(text)) {
    var n = 0;
    for (var i = 0; i < text.length; i++) {
      n = n * 26 + (text.charCodeAt(i) - 64);
    }
    return n > 0 ? n - 1 : -1;
  }

  return -1;
}

function ceSheetMonthV50_(sheetName) {
  try {
    if (typeof ceExtractMonthFromSheetName_ === "function") {
      var existing = Number(ceExtractMonthFromSheetName_(sheetName) || 0);
      if (existing >= 1 && existing <= 12) return existing;
    }
  } catch (ignore) {}

  var text = String(sheetName || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .trim();

  var m = text.match(/(?:^|\b)(?:thang|month|t)\s*0?([1-9]|1[0-2])(?:\b|\D)/i);
  if (m) return Number(m[1]);

  m = text.match(/(?:^|\D)0?([1-9]|1[0-2])\s*[./-]\s*(?:20)?\d{2}(?:\D|$)/);
  if (m) return Number(m[1]);

  return 0;
}

function ceSheetYearV50_(sheetName, fallbackYear) {
  try {
    if (typeof ceExtractYearFromSheetName_ === "function") {
      var existing = Number(ceExtractYearFromSheetName_(sheetName) || 0);
      if (existing >= 2000 && existing <= 2100) return existing;
    }
  } catch (ignore) {}

  var text = String(sheetName || "");
  var m = text.match(/(?:^|\D)(20\d{2})(?:\D|$)/);
  if (m) return Number(m[1]);

  m = text.match(/[./-]\s*(\d{2})(?:\D|$)/);
  if (m) {
    var yy = Number(m[1]);
    if (yy >= 20 && yy <= 99) return 2000 + yy;
  }

  return Number(fallbackYear || new Date().getFullYear());
}

function ceInlineMonthMarkerV4223_(rawValue, displayValue, fallbackYear, previousMarker) {
  var text = String(
    displayValue !== undefined && displayValue !== null
      ? displayValue
      : (rawValue || "")
  ).trim();
  if (!text) return null;

  var normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();

  var match = normalized.match(
    /^(?:thang|month)\s*0?([1-9]|1[0-2])(?:\s*[\/.\-]\s*(20\d{2}|\d{2}))?$/i
  );
  if (!match) return null;

  var month = Number(match[1]);
  var year = 0;
  if (match[2]) {
    year = Number(match[2]);
    if (year < 100) year += 2000;
  }

  var previousMonth = previousMarker && Number(previousMarker.month || 0);
  var previousYear = previousMarker && Number(previousMarker.year || 0);

  if (!year && previousYear >= 2000 && previousYear <= 2100) {
    year = previousYear;
    if (previousMonth >= 11 && month <= 2) year++;
  }
  if (!year) year = Number(fallbackYear || new Date().getFullYear());

  return {month:month, year:year, text:text};
}

function ceMonthDistanceV50_(fromMonth, toMonth) {
  if (!(fromMonth >= 1 && fromMonth <= 12) || !(toMonth >= 1 && toMonth <= 12)) {
    return 99;
  }
  var d = Math.abs(fromMonth - toMonth);
  return Math.min(d, 12 - d);
}

function ceBuildDateCandidateV50_(year, month, day) {
  year = Number(year);
  month = Number(month);
  day = Number(day);

  if (!(year > 0) || month < 1 || month > 12 || day < 1 || day > 31) return null;

  var date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function ceCandidateYearV50_(month, sheetYear, previousDate, sheetMonth) {
  var normalizedSheetYear = Number(sheetYear || new Date().getFullYear());
  var normalizedSheetMonth = Number(sheetMonth || 0);

  /*
   * V5.8 - nếu candidate khớp đúng tháng đã xác định từ tên sheet,
   * năm của sheet là nguồn sự thật mạnh hơn previousDate/raw locale.
   * Ví dụ sheet "Tháng 9/2026" phải giữ 2/9 ở năm 2026, không bị kéo về 2025.
   */
  if (
    normalizedSheetMonth >= 1 && normalizedSheetMonth <= 12 &&
    Number(month) === normalizedSheetMonth &&
    normalizedSheetYear >= 2000 && normalizedSheetYear <= 2100
  ) {
    return normalizedSheetYear;
  }

  var year = normalizedSheetYear;

  if (previousDate instanceof Date && !isNaN(previousDate.getTime())) {
    year = previousDate.getFullYear();
    var previousMonth = previousDate.getMonth() + 1;

    if (previousMonth >= 11 && month <= 2) year++;
    else if (previousMonth <= 2 && month >= 11) year--;
  }

  return year;
}

function ceChooseTwoPartDateV50_(
  first,
  second,
  sheetMonth,
  sheetYear,
  previousDate,
  dateOrder
) {
  first = Number(first);
  second = Number(second);

  var candidates = [];

  function add_(kind, month, day) {
    var year = ceCandidateYearV50_(month, sheetYear, previousDate, sheetMonth);
    var date = ceBuildDateCandidateV50_(year, month, day);
    if (!date) return;

    /*
     * V6.0 - sheet đã có tháng rõ ràng thì không nhận date token quá xa
     * tháng đó. Case live Diệp Lan Anh có dòng "31.12" nằm phía trên
     * lịch Tháng 9.26; trước đây token này lọt vào index 31/12 và làm
     * diagnostics tưởng source có activity ngoài kỳ. Chỉ cho phép cùng
     * tháng hoặc spillover liền kề (tháng trước / tháng sau).
     */
    if (
      Number(sheetMonth) >= 1 && Number(sheetMonth) <= 12 &&
      ceMonthDistanceV50_(Number(sheetMonth), Number(month)) > 1
    ) {
      return;
    }

    var score = 0;

    if (dateOrder === "DM") score += kind === "DM" ? -5000 : 5000;
    if (dateOrder === "MD") score += kind === "MD" ? -5000 : 5000;

    /*
     * V5.8 - tên sheet đã xác định tháng thì ưu tiên tuyệt đối candidate
     * nằm đúng tháng đó. Continuity chỉ dùng để phá hòa / xử lý sheet mơ hồ.
     */
    if (sheetMonth >= 1 && sheetMonth <= 12) {
      if (month === sheetMonth) score -= 12000;
      else score += 12000 + ceMonthDistanceV50_(sheetMonth, month) * 300;
    }

    if (previousDate instanceof Date && !isNaN(previousDate.getTime())) {
      var expected = new Date(
        previousDate.getFullYear(),
        previousDate.getMonth(),
        previousDate.getDate() + 1
      );
      var diffExpected = Math.abs(
        Math.round((date.getTime() - expected.getTime()) / 86400000)
      );
      score += diffExpected * 20;

      // Không thích nhảy lùi xa trong cùng một trục ngày.
      if (date.getTime() < previousDate.getTime() - 86400000) score += 2000;
      if (diffExpected === 0) score -= 3000;
    } else if (!(sheetMonth >= 1 && sheetMonth <= 12)) {
      score += ceMonthDistanceV50_(sheetMonth, month) * 300;
      if (month === sheetMonth) score -= 500;
    }

    candidates.push({date: date, score: score, kind: kind});
  }

  // Việt Nam thường DD/MM.
  add_("DM", second, first);

  // Một số file nguồn hiển thị MM/DD.
  add_("MD", first, second);

  if (!candidates.length) return null;

  candidates.sort(function(a, b) {
    if (a.score !== b.score) return a.score - b.score;
    return a.kind === "DM" ? -1 : 1;
  });

  return candidates[0].date;
}

function ceParseCalendarDateCellV50_(
  rawValue,
  displayValue,
  sheetMonth,
  sheetYear,
  previousDate,
  dateOrder
) {
  var text = String(
    displayValue !== undefined && displayValue !== null
      ? displayValue
      : (rawValue || "")
  ).trim();

  var hasRawDateV58 =
    Object.prototype.toString.call(rawValue) === "[object Date]" &&
    !isNaN(rawValue.getTime());

  // V5.8 hotfix: displayValue có thể trống dù rawValue vẫn là Date hợp lệ.
  // Không return sớm trong case này; để raw Date fallback phía dưới khóa tháng/năm theo tên sheet.
  if (!text && !hasRawDateV58) return null;

  // Bỏ tiền tố thứ/ngày để không hiểu "Thứ 6 - 14/08" thành 06/14.
  var cleaned = text
    .replace(/^\s*(?:thứ|thu|t)\s*[2-8]\s*[-:|]?\s*/i, "")
    .replace(/^\s*(?:ngày|ngay)\s*/i, "")
    .trim();

  // YYYY-MM-DD / YYYY/MM/DD
  var iso = cleaned.match(
    /(?:^|\D)(20\d{2})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{1,2})(?:\D|$)/
  );
  if (iso) {
    return ceBuildDateCandidateV50_(
      Number(iso[1]),
      Number(iso[2]),
      Number(iso[3])
    );
  }

  // DD/MM/YYYY hoặc MM/DD/YYYY - chọn theo config/chuỗi ngày.
  var three = cleaned.match(
    /(?:^|\D)(\d{1,2})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{2,4})(?:\D|$)/
  );
  if (three) {
    var explicitYear = Number(three[3]);
    if (explicitYear < 100) explicitYear += 2000;

    var previousForYear = previousDate;
    var chosen = ceChooseTwoPartDateV50_(
      Number(three[1]),
      Number(three[2]),
      sheetMonth,
      explicitYear,
      previousForYear,
      dateOrder
    );

    if (chosen) {
      return ceBuildDateCandidateV50_(
        explicitYear,
        chosen.getMonth() + 1,
        chosen.getDate()
      );
    }
  }

  // DD/MM hoặc MM/DD.
  var two = cleaned.match(
    /(?:^|\D)(\d{1,2})\s*[\/.-]\s*(\d{1,2})(?:\D|$)/
  );
  if (two) {
    return ceChooseTwoPartDateV50_(
      Number(two[1]),
      Number(two[2]),
      sheetMonth,
      sheetYear,
      previousDate,
      dateOrder
    );
  }

  // "Ngày 1", "T7 - 1" sau khi bỏ prefix, hoặc ô chỉ ghi số 1..31.
  var single = cleaned.match(/^0?([1-9]|[12]\d|3[01])$/);
  if (single) {
    var day = Number(single[1]);
    var hasSheetAnchor =
      Number(sheetMonth) >= 1 && Number(sheetMonth) <= 12 &&
      Number(sheetYear) >= 2000 && Number(sheetYear) <= 2100;

    var month = hasSheetAnchor
      ? Number(sheetMonth)
      : (previousDate ? previousDate.getMonth() + 1 : 0);
    var year = hasSheetAnchor
      ? Number(sheetYear)
      : (previousDate ? previousDate.getFullYear() : 0);

    /*
     * V6.0 - anchored-sheet spillover.
     *
     * Tên sheet vẫn là nguồn sự thật cho các ngày bình thường: "22" trong
     * "Tháng 9/2026" luôn là 22/09. Nhưng nhiều nguồn để vài ngày đầu
     * tháng kế tiếp ngay cuối tab tháng cũ. Khi chuỗi thực sự đi 29,30,1,2,3
     * thì 1..3 phải được hiểu là tháng kế tiếp, không reset về đầu tháng cũ.
     * Chỉ cho spillover tối đa 7 ngày đầu và chỉ khi continuity đủ mạnh.
     */
    if (
      hasSheetAnchor &&
      previousDate instanceof Date &&
      !isNaN(previousDate.getTime())
    ) {
      var previousMonthV60 = previousDate.getMonth() + 1;
      var previousYearV60 = previousDate.getFullYear();
      var previousDayV60 = previousDate.getDate();
      var nextAnchorV60 = new Date(Number(sheetYear), Number(sheetMonth), 1);
      var nextMonthV60 = nextAnchorV60.getMonth() + 1;
      var nextYearV60 = nextAnchorV60.getFullYear();

      if (
        previousMonthV60 === Number(sheetMonth) &&
        previousYearV60 === Number(sheetYear) &&
        previousDayV60 >= 25 &&
        day <= 7
      ) {
        month = nextMonthV60;
        year = nextYearV60;
      } else if (
        previousMonthV60 === nextMonthV60 &&
        previousYearV60 === nextYearV60 &&
        previousDayV60 <= 7 &&
        day >= previousDayV60 &&
        day <= 7
      ) {
        month = nextMonthV60;
        year = nextYearV60;
      }
    } else if (
      !hasSheetAnchor &&
      previousDate instanceof Date &&
      !isNaN(previousDate.getTime())
    ) {
      month = previousDate.getMonth() + 1;
      year = previousDate.getFullYear();

      if (previousDate.getDate() >= 25 && day <= 7) {
        month++;
        if (month > 12) {
          month = 1;
          year++;
        }
      }
    }

    return ceBuildDateCandidateV50_(year, month, day);
  }

  /*
   * Raw Date chỉ là fallback cuối cùng.
   * Không ưu tiên raw Date trước display nữa vì một số sheet nhập 9/1 nhưng
   * Google locale lưu thành 09-Jan hoặc ngày/năm cũ.
   */
  if (
    Object.prototype.toString.call(rawValue) === "[object Date]" &&
    !isNaN(rawValue.getTime())
  ) {
    var rawMonth = rawValue.getMonth() + 1;

    if (
      !sheetMonth ||
      ceMonthDistanceV50_(sheetMonth, rawMonth) <= 1
    ) {
      var rawYear = rawValue.getFullYear();

      /*
       * V5.8 - Google Sheets có thể giữ serial/raw year cũ dù display là ngày
       * của tháng hiện tại. Nếu raw month khớp đúng tháng tên sheet, khóa năm
       * về sheetYear để tránh sinh index 2025 trong sheet 2026.
       */
      if (
        Number(sheetMonth) >= 1 && Number(sheetMonth) <= 12 &&
        rawMonth === Number(sheetMonth) &&
        Number(sheetYear) >= 2000 && Number(sheetYear) <= 2100
      ) {
        rawYear = Number(sheetYear);
      } else if (rawYear < 2000 || rawYear > 2100) {
        rawYear = sheetYear;
      }

      return ceBuildDateCandidateV50_(
        rawYear,
        rawMonth,
        rawValue.getDate()
      );
    }
  }

  return null;
}

/**
 * Giữ tên hàm cũ để các file khác không bị ảnh hưởng.
 */

function ceDateRowsForScanV50_(rowCount, readConfig) {
  var configured = readConfig && readConfig.dateRows
    ? readConfig.dateRows
    : [];

  if (configured.length) {
    return configured
      .map(function(row) { return Number(row) - 1; })
      .filter(function(rowIndex) {
        return rowIndex >= 0 && rowIndex < rowCount;
      });
  }

  var rows = [];
  for (var i = 0; i < rowCount; i++) rows.push(i);
  return rows;
}

function ceDetectDateColumnV1_(
  rawValues,
  displayValues,
  sheetName,
  fallbackDate,
  readConfig
) {
  rawValues = rawValues || [];
  displayValues = displayValues || [];
  fallbackDate = fallbackDate instanceof Date ? fallbackDate : new Date();
  readConfig = readConfig || {};

  var rowCount = Math.max(rawValues.length, displayValues.length);
  if (!rowCount) return -1;

  var maxColumns = 0;
  for (var r = 0; r < rowCount; r++) {
    maxColumns = Math.max(
      maxColumns,
      rawValues[r] ? rawValues[r].length : 0,
      displayValues[r] ? displayValues[r].length : 0
    );
  }

  if (
    Number(readConfig.dateColumn) >= 0 &&
    Number(readConfig.dateColumn) < maxColumns
  ) {
    Logger.log(JSON.stringify({
      code: "DATE_COLUMN_CONFIG_V50",
      sheet: sheetName,
      column: Number(readConfig.dateColumn) + 1,
      letter: ceColumnToLetterV33_(Number(readConfig.dateColumn) + 1),
      dateRows: readConfig.dateRows || []
    }));

    return Number(readConfig.dateColumn);
  }

  var configuredLimit = Number(CE_CONFIG.DATE_COLUMN_SCAN_LIMIT || 0);
  var columnCount = configuredLimit > 0
    ? Math.min(maxColumns, configuredLimit)
    : maxColumns;

  var sheetMonth = ceSheetMonthV50_(sheetName);
  var sheetYear = ceSheetYearV50_(sheetName, fallbackDate.getFullYear());
  var scanRows = ceDateRowsForScanV50_(rowCount, readConfig);

  var bestColumn = -1;
  var bestScore = -999999;
  var diagnostics = [];

  for (var column = 0; column < columnCount; column++) {
    var hits = 0;
    var unique = {};
    var dates = [];
    var previousDate = null;
    var inlineMonthV4223 = null;

    for (var ri = 0; ri < scanRows.length; ri++) {
      var row = scanRows[ri];
      var raw = rawValues[row] ? rawValues[row][column] : "";
      var display = displayValues[row] ? displayValues[row][column] : "";

      if (!(sheetMonth >= 1 && sheetMonth <= 12)) {
        var markerV4223 = ceInlineMonthMarkerV4223_(raw, display, sheetYear, inlineMonthV4223);
        if (markerV4223) {
          inlineMonthV4223 = markerV4223;
          previousDate = null;
          continue;
        }
      }

      var activeMonthV4223 = sheetMonth || (inlineMonthV4223 ? inlineMonthV4223.month : 0);
      var activeYearV4223 = sheetMonth
        ? sheetYear
        : (inlineMonthV4223 ? inlineMonthV4223.year : sheetYear);

      var parsed = ceParseCalendarDateCellV50_(
        raw,
        display,
        activeMonthV4223,
        activeYearV4223,
        previousDate,
        readConfig.dateOrder || "AUTO"
      );

      if (!parsed || isNaN(parsed.getTime())) continue;

      previousDate = parsed;
      var key = ceDateKey_(parsed);
      hits++;
      unique[key] = true;
      dates.push(parsed.getTime());
    }

    var uniqueCount = Object.keys(unique).length;

    var headerText = "";
    for (var hr = 0; hr < Math.min(5, rowCount); hr++) {
      headerText += " " + ceNormalize_(
        displayValues[hr] ? displayValues[hr][column] : ""
      );
    }

    var headerBonus = 0;
    if (/\b(ngay|ngay thang|date)\b/.test(headerText)) headerBonus += 500;
    if (/\b(stt|so thu tu|gia|price|khach|pax)\b/.test(headerText)) headerBonus -= 700;

    dates.sort(function(a, b) { return a - b; });
    var consecutive = 0;
    for (var i = 1; i < dates.length; i++) {
      var diffDays = Math.round((dates[i] - dates[i - 1]) / 86400000);
      if (diffDays === 1) consecutive++;
    }

    var duplicatePenalty = Math.max(0, hits - uniqueCount) * 30;
    var score =
      hits * 80 +
      uniqueCount * 25 +
      consecutive * 140 +
      headerBonus -
      duplicatePenalty -
      column;

    diagnostics.push({
      column: column + 1,
      hits: hits,
      unique: uniqueCount,
      consecutive: consecutive,
      score: score
    });

    if (
      hits >= (CE_CONFIG.DATE_COLUMN_MIN_HITS || 3) &&
      score > bestScore
    ) {
      bestScore = score;
      bestColumn = column;
    }
  }

  if (bestColumn < 0) {
    Logger.log(JSON.stringify({
      code: "DATE_COLUMN_NOT_FOUND_V50",
      sheet: sheetName,
      dateRows: readConfig.dateRows || [],
      scannedColumns: columnCount,
      topCandidates: diagnostics
        .sort(function(a, b) { return b.score - a.score; })
        .slice(0, 5)
    }));
  } else {
    Logger.log(JSON.stringify({
      code: "DATE_COLUMN_DETECTED_V50",
      sheet: sheetName,
      column: bestColumn + 1,
      letter: ceColumnToLetterV33_(bestColumn + 1),
      dateRows: readConfig.dateRows || [],
      score: bestScore
    }));
  }

  return bestColumn;
}

function ceResolveReader_() {
  return "COLUMN_V1";
}

function ceReadVillaByReader_(
  reader,
  sourceContext,
  villa,
  nights,
  guestCount,
  debug
) {
  return ceReadColumnCalendarV34_(
    sourceContext,
    villa,
    nights,
    guestCount,
    debug
  );
}

function ceCalendarColumnActivityV4194_(context, column) {
  context = context || {};
  column = Number(column);
  if (!isFinite(column) || column < 0) return {hasActivity:false,reason:"INVALID_SOURCE_COLUMN"};
  if (column === Number(context.dateColumn)) return {hasActivity:false,reason:"SOURCE_COLUMN_IS_DATE_COLUMN"};

  var rows = [];
  var dateIndex = context.dateIndexV50 || {};
  Object.keys(dateIndex).forEach(function(key){ var r=Number(dateIndex[key]); if(isFinite(r)&&r>=0)rows.push(r); });
  if (!rows.length) {
    var maxRows = Math.max((context.display||[]).length,(context.raw||[]).length,(context.backgrounds||[]).length);
    for (var i=1;i<maxRows;i++) rows.push(i);
  }
  rows.sort(function(a,b){return a-b;});
  var seen={};
  for (var j=0;j<rows.length;j++) {
    var row=rows[j]; if(seen[row])continue; seen[row]=true;
    var raw = context.raw&&context.raw[row] ? context.raw[row][column] : "";
    var display = context.display&&context.display[row] ? context.display[row][column] : "";
    var bg = context.backgrounds&&context.backgrounds[row] ? String(context.backgrounds[row][column]||"").toLowerCase() : "";
    if (String(raw==null?"":raw).trim() || String(display==null?"":display).trim()) return {hasActivity:true,reason:"VALUE",row:row};
    if (bg && !ceIsWhiteV34_(bg)) return {hasActivity:true,reason:"BACKGROUND",row:row};
  }
  return {hasActivity:false,reason:"NO_CALENDAR_ACTIVITY"};
}

function ceReadColumnCalendarV34_(
  sourceContext,
  villa,
  nights,
  guestCount,
  debug
) {
  var nightly = [];
  var total = 0;
  var complete = true;
  var previousSheet = "";

  for (var i = 0; i < nights.length; i++) {
    var loc = ceFindVillaNightCellV34_(
      sourceContext,
      villa,
      nights[i],
      previousSheet,
      guestCount
    );

    if (!loc) {
      throw new Error(
        "Không tìm thấy lịch " +
        villa.name +
        " ngày " +
        ceDisplayDate_(nights[i])
      );
    }

    loc.context.columnActivityV4194 = loc.context.columnActivityV4194 || {};
    var activityKeyV4194 = String(loc.column);
    var activityV4194 = loc.context.columnActivityV4194[activityKeyV4194];
    if (!activityV4194) {
      activityV4194 = ceCalendarColumnActivityV4194_(loc.context, loc.column);
      loc.context.columnActivityV4194[activityKeyV4194] = activityV4194;
    }
    if (!activityV4194.hasActivity) {
      throw new Error("NO_CALENDAR_ACTIVITY_V4194: " + String(villa&&villa.name||"") + " | " + String(loc.context&&loc.context.name||"") + " | col=" + String(loc.column+1));
    }

    previousSheet = loc.context.name;

    var state = ceReadCalendarCellStateV34_(
      loc.context,
      loc.row,
      loc.column,
      villa.config,
      villa,
      loc.optionLabel || ""
    );

    Logger.log(JSON.stringify({
      code: "CALENDAR_NIGHT_STATE_V51",
      villa: villa && villa.name || "",
      date: ceDateKey_(nights[i]),
      sheet: loc.context && loc.context.name || "",
      cell: ceColumnToLetterV33_(loc.column + 1) + (loc.row + 1),
      sourceColumn: Number(villa && villa.sourceColumn || 0),
      resolvedColumn: Number(loc.column || 0) + 1,
      status: state && state.status || "",
      background: state && state.background || "",
      display: state && state.display || "",
      price: state && state.price !== undefined ? state.price : null,
      mergedVisualV52: Boolean(
        loc.context &&
        loc.context.mergedCellsV52 &&
        loc.context.mergedCellsV52[loc.row + "|" + loc.column]
      )
    }));

    if (state.status === "BUSY") {
      return {
        available: false,
        priceStatus: "UNAVAILABLE",
        totalPrice: null,
        nightlyPrices: nightly,
        blockedDate: ceDateKey_(nights[i]),
        blockedReason: state.reason
      };
    }

    if (state.status === "UNKNOWN" && state.unknownReason === "WHITE_NO_PRICE_B6") {
      throw new Error(
        "WHITE_NO_PRICE_B6: Ô trống nhưng không có giá tại " +
        loc.context.name + "!" + ceColumnToLetterV33_(loc.column + 1) + (loc.row + 1) +
        " - cần kiểm tra lịch/giá"
      );
    }

    if (state.status === "UNKNOWN") {
      throw new Error(
        "Không xác định trạng thái màu tại " +
        loc.context.name +
        "!" +
        ceColumnToLetterV33_(loc.column + 1) +
        (loc.row + 1) +
        " | màu " +
        state.background +
        " | nội dung: " +
        String(state.display || "")
      );
    }

    if (state.price === null) complete = false;
    else total += state.price;

    nightly.push({
      date: ceDateKey_(nights[i]),
      price: state.price,
      priceText: state.price === null
        ? "Liên hệ"
        : ceFormatMoney_(state.price),
      sheet: loc.context.name,
      cell: ceColumnToLetterV33_(loc.column + 1) + (loc.row + 1),
      sourceLink: ceBuildSourceLinkV34_(
        sourceContext.file,
        loc.context.sheetId,
        loc.column,
        loc.row
      ),
      optionLabel: loc.optionLabel || "",
      optionColumn: loc.column + 1
    });
  }

  return {
    available: true,
    priceStatus: complete ? "KNOWN" : "CONTACT",
    totalPrice: complete ? total : null,
    totalPriceText: complete
      ? ceFormatMoney_(total)
      : "Liên hệ báo giá",
    nightlyPrices: nightly,
    sourceLinks: nightly.map(function(x) { return x.sourceLink; }),
    selectedOption: nightly.length ? nightly[0].optionLabel || "" : ""
  };
}

function ceFindVillaNightCellV34_(
  sourceContext,
  villa,
  targetDate,
  previousSheet,
  guestCount
) {
  var debugSheets = [];

  /*
   * FIX-L2 (sửa B2): ngày đã được xác nhận KHÔNG có trong các tab ứng viên
   * của nguồn thì không quét lại cho căn khác có CÙNG cấu hình đọc lịch.
   * Khóa cache gồm mọi cấu hình ảnh hưởng tới việc chọn tab và dò hàng ngày
   * (CALENDAR_SHEET, DATE_COL, DATE_ROWS, DATE_ORDER). Căn có cấu hình khác
   * không dùng lại kết quả "không có ngày" của căn khác.
   */
  var dateCfgV_FIX = ceParseCalendarReadConfigV50_(villa && villa.config || "");
  var noDateCacheKeyV_FIX = [
    ceDateKey_(targetDate),
    dateCfgV_FIX.calendarSheet || "",
    dateCfgV_FIX.dateColumn,
    (dateCfgV_FIX.dateRows || []).join(","),
    dateCfgV_FIX.dateOrder
  ].join("|");
  if (sourceContext && sourceContext.noDateCacheV_FIX &&
      sourceContext.noDateCacheV_FIX[noDateCacheKeyV_FIX]) {
    return null;
  }

  var candidateSheets = ceCalendarCandidateSheetsCachedV50_(
    sourceContext,
    targetDate,
    villa && villa.config || ""
  ).slice();

  /*
   * V5.4 - TARGET MONTH FIRST
   *
   * 1. Ngày thuộc tháng nào -> TARGET tháng đó thử trước.
   * 2. previousSheet chỉ được ưu tiên khi chính nó cũng là TARGET của ngày hiện tại.
   * 3. PREVIOUS chỉ fallback khi TARGET không có ngày cần tìm.
   * 4. Không dùng màu, giá hay FREE/BUSY để chọn sheet.
   */
  if (previousSheet) {
    var previousBucketV54 = ceCalendarSheetBucketForDateV54_(
      previousSheet,
      targetDate
    );

    if (previousBucketV54 === "TARGET") {
      candidateSheets.sort(function(a, b) {
        var aBucket = ceCalendarSheetBucketForDateV54_(a.getName(), targetDate);
        var bBucket = ceCalendarSheetBucketForDateV54_(b.getName(), targetDate);
        var priorityV54 = {
          TARGET: 0,
          PREVIOUS: 1,
          NEXT: 2,
          UNKNOWN: 3,
          OTHER: 4
        };

        if (aBucket !== bBucket) {
          return priorityV54[aBucket] - priorityV54[bBucket];
        }

        if (aBucket === "TARGET") {
          var aPrev = a.getName() === previousSheet ? 1 : 0;
          var bPrev = b.getName() === previousSheet ? 1 : 0;
          if (aPrev !== bPrev) return bPrev - aPrev;
        }

        return String(a.getName()).localeCompare(String(b.getName()), "vi");
      });
    }
  }

  var targetDateFoundInTargetSheetV54 = false;

  for (var i = 0; i < candidateSheets.length; i++) {
    var sheet = candidateSheets[i];
    var sheetBucketV54 = ceCalendarSheetBucketForDateV54_(
      sheet.getName(),
      targetDate
    );

    if (
      targetDateFoundInTargetSheetV54 &&
      sheetBucketV54 !== "TARGET"
    ) {
      Logger.log(JSON.stringify({
        code: "CALENDAR_PREVIOUS_FALLBACK_BLOCKED_V54",
        villa: villa && villa.name || "",
        date: ceDateKey_(targetDate),
        blockedSheet: sheet.getName(),
        reason: "TARGET_MONTH_ALREADY_CONTAINS_DATE"
      }));
      break;
    }

    var ctx = ceLoadCalendarSheetV34_(
      sourceContext,
      sheet,
      targetDate,
      villa && villa.config || "",
      Number(villa && villa.sourceColumn || 0)
    );

    /*
     * V2.3 Fast Search:
     * lần đầu chỉ tải đến cột cần thiết theo source plan. Nếu tên căn tại
     * sourceColumn không còn đủ bằng chứng, bung về full scan rồi để chính
     * cơ chế remap V5.3/V5.6 hiện tại quyết định cột đúng.
     */
    ctx = ceMaybeExpandCalendarForVillaV23_(
      sourceContext,
      sheet,
      ctx,
      targetDate,
      villa
    );

    var diagnostic = {
      sheet: ctx.name,
      dateColumn: ctx.dateColumn >= 0 ? ctx.dateColumn + 1 : -1,
      dateRow: -1,
      sourceColumn: Number(villa && villa.sourceColumn || 0),
      resolvedColumn: -1,
      result: ""
    };

    if (ctx.dateColumn < 0) {
      diagnostic.result = "DATE_COLUMN_NOT_FOUND";
      debugSheets.push(diagnostic);
      continue;
    }

    var row = ceFindCalendarDateRowV34_(ctx, targetDate);
    diagnostic.dateRow = row >= 0 ? row + 1 : -1;

    if (row < 0) {
      diagnostic.result = "DATE_NOT_FOUND";
      debugSheets.push(diagnostic);
      continue;
    }

    if (sheetBucketV54 === "TARGET") {
      targetDateFoundInTargetSheetV54 = true;
    }

    var groupSelection = ceResolveGroupedVillaColumnV38_(
      ctx,
      villa,
      guestCount
    );

    var col = groupSelection
      ? groupSelection.column
      : ceResolveVillaColumnV40_(ctx, villa);

    diagnostic.resolvedColumn = col >= 0 ? col + 1 : -1;

    if (col < 0) {
      diagnostic.result = "VILLA_COLUMN_NOT_FOUND";
      debugSheets.push(diagnostic);
      continue;
    }

    diagnostic.result = "SELECTED";
    debugSheets.push(diagnostic);

    if (previousSheet && previousSheet !== ctx.name) {
      Logger.log(JSON.stringify({
        code: "CALENDAR_SHEET_SWITCH_V50",
        villa: villa.name,
        date: ceDateKey_(targetDate),
        from: previousSheet,
        to: ctx.name
      }));
    }

    return {
      context: ctx,
      row: row,
      column: col,
      optionLabel: groupSelection ? groupSelection.label : ""
    };
  }

  var onlyDateMissingV_FIX = debugSheets.length > 0 && debugSheets.every(function(d) {
    return d.result === "DATE_NOT_FOUND" || d.result === "DATE_COLUMN_NOT_FOUND";
  });
  if (onlyDateMissingV_FIX && sourceContext) {
    sourceContext.noDateCacheV_FIX = sourceContext.noDateCacheV_FIX || {};
    sourceContext.noDateCacheV_FIX[noDateCacheKeyV_FIX] = true;
  }

  Logger.log(JSON.stringify({
    code: "VILLA_NIGHT_LOOKUP_FAIL_V50",
    villa: villa && villa.name || "",
    sourceColumn: Number(villa && villa.sourceColumn || 0),
    date: ceDateKey_(targetDate),
    previousSheet: previousSheet || "",
    sheets: debugSheets
  }));

  return null;
}

function ceCalendarCandidateSheetsCachedV50_(
  sourceContext,
  targetDate,
  rawConfig
) {
  sourceContext.calendarCandidateSheetsV50 =
    sourceContext.calendarCandidateSheetsV50 || {};

  var readConfig = ceParseCalendarReadConfigV50_(rawConfig);
  var manualSheet = readConfig.calendarSheet || "";

  /*
   * V5.4: ngày thuộc tháng nào thì TARGET của tháng đó luôn thử trước.
   * Cache key tách riêng rule mới để không lẫn với logic EARLY cũ.
   */
  var key =
    targetDate.getFullYear() +
    "-" +
    String(targetDate.getMonth() + 1) +
    "-TARGET_FIRST_V54-" +
    manualSheet;

  if (sourceContext.calendarCandidateSheetsV50[key]) {
    return sourceContext.calendarCandidateSheetsV50[key];
  }

  var sheets = ceCalendarCandidateSheetsV34_(
    sourceContext.file,
    targetDate,
    rawConfig
  );

  sourceContext.calendarCandidateSheetsV50[key] = sheets;
  return sheets;
}

/**
 * Alias giữ tương thích tên cache cũ.
 */

function ceCalendarSheetBucketForDateV54_(sheetName, targetDate) {
  var targetMonth = targetDate.getMonth() + 1;
  var targetYear = targetDate.getFullYear();

  var previousMonth = targetMonth - 1;
  var previousYear = targetYear;
  if (previousMonth < 1) {
    previousMonth = 12;
    previousYear--;
  }

  var nextMonth = targetMonth + 1;
  var nextYear = targetYear;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear++;
  }

  var month = ceSheetMonthV50_(sheetName);
  var year = ceSheetYearV50_(sheetName, targetYear);

  if (!month) return "UNKNOWN";
  if (month === targetMonth && (!year || year === targetYear)) return "TARGET";
  if (month === previousMonth && (!year || year === previousYear)) return "PREVIOUS";
  if (month === nextMonth && (!year || year === nextYear)) return "NEXT";
  return "OTHER";
}


function ceCalendarCandidateSheetsV34_(file, targetDate, rawConfig) {
  var readConfig = ceParseCalendarReadConfigV50_(rawConfig);
  var all = file.getSheets().filter(function(sheet) {
    if (sheet.isSheetHidden()) return false;

    var name = ceNormalize_(sheet.getName());
    if (
      /thong tin|information|image|hinh anh|master|config|ghi chu|data|file/.test(name)
    ) {
      return false;
    }

    return true;
  });

  if (readConfig.calendarSheet) {
    var exact = all.filter(function(sheet) {
      return ceNormalize_(sheet.getName()) === ceNormalize_(readConfig.calendarSheet);
    });

    if (exact.length) {
      Logger.log(JSON.stringify({
        code: "CALENDAR_SHEET_CONFIG_V50",
        date: ceDateKey_(targetDate),
        sheet: exact[0].getName()
      }));
      return exact;
    }
  }

  var targetMonth = targetDate.getMonth() + 1;
  var targetYear = targetDate.getFullYear();

  var previousMonth = targetMonth - 1;
  var previousYear = targetYear;
  if (previousMonth < 1) {
    previousMonth = 12;
    previousYear--;
  }

  var nextMonth = targetMonth + 1;
  var nextYear = targetYear;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear++;
  }

  function bucket_(sheet) {
    var month = ceSheetMonthV50_(sheet.getName());
    var year = ceSheetYearV50_(sheet.getName(), targetYear);

    if (!month) {
      return {sheet: sheet, bucket: "UNKNOWN", month: 0, year: year};
    }

    if (month === targetMonth && (!year || year === targetYear)) {
      return {sheet: sheet, bucket: "TARGET", month: month, year: year};
    }

    if (month === previousMonth && (!year || year === previousYear)) {
      return {sheet: sheet, bucket: "PREVIOUS", month: month, year: year};
    }

    if (month === nextMonth && (!year || year === nextYear)) {
      return {sheet: sheet, bucket: "NEXT", month: month, year: year};
    }

    return {sheet: sheet, bucket: "OTHER", month: month, year: year};
  }

  var items = all.map(bucket_);

  /*
   * V5.4 - TARGET MONTH FIRST:
   * 01/09 -> T9 TARGET trước; T8 PREVIOUS chỉ fallback nếu T9 không có ngày.
   */
  var priority = {
    TARGET: 0,
    PREVIOUS: 1,
    NEXT: 2,
    UNKNOWN: 3,
    OTHER: 4
  };

  items.sort(function(a, b) {
    var pa = priority[a.bucket];
    var pb = priority[b.bucket];
    if (pa !== pb) return pa - pb;
    return String(a.sheet.getName()).localeCompare(String(b.sheet.getName()), "vi");
  });

  var near = items.filter(function(item) {
    return item.bucket !== "OTHER";
  });

  // Nếu tên sheet quá lạ, vẫn cho thử tối đa vài tab thay vì bỏ nguồn.
  var selected = near.length
    ? near
    : items.slice(0, 6);

  Logger.log(JSON.stringify({
    code: "CALENDAR_SHEET_ORDER_V50",
    date: ceDateKey_(targetDate),
    earlyMonthRule: false,
    targetFirstRuleV54: true,
    selectionRule: "TARGET_FIRST_PREVIOUS_ONLY_IF_TARGET_DATE_MISSING",
    sheets: selected.map(function(item) {
      return {
        name: item.sheet.getName(),
        bucket: item.bucket,
        month: item.month,
        year: item.year
      };
    })
  }));

  return selected.map(function(item) { return item.sheet; });
}

function ceLoadCalendarSheetV34_(
  sourceContext,
  sheet,
  fallbackDate,
  rawConfig,
  sourceColumn
) {
  sourceContext.sheets = sourceContext.sheets || {};

  var key = String(sheet.getSheetId());
  var c = sourceContext.sheets[key];
  var readConfig = ceParseCalendarReadConfigV50_(rawConfig);
  var configKey = [
    readConfig.dateColumn,
    (readConfig.dateRows || []).join(","),
    readConfig.dateOrder
  ].join("|");
  var planV23 = sourceContext.fastSearchPlanV23 || {};
  sourceContext.fastSearchForceFullV23 = sourceContext.fastSearchForceFullV23 || {};
  var forceFullV23 = Boolean(sourceContext.fastSearchForceFullV23[key]);
  var requestedSourceColumnEarlyV30 = Number(sourceColumn || 0);

  // V3.0: nếu sheet đã được load đủ trong chính request này thì trả ngay.
  // Tránh getLastRow/getLastColumn/getMaxRows/getMaxColumns lặp lại cho từng căn/đêm.
  if (
    CE_CONFIG.V30_CONTEXT_CACHE_ENABLED === true &&
    c &&
    c.dateConfigKeyV50 === configKey &&
    requestedSourceColumnEarlyV30 <= Number(c.loadedCols || 0) &&
    (!forceFullV23 || !c.fastSearchNarrowV23)
  ) {
    if (fallbackDate instanceof Date && !isNaN(fallbackDate.getTime())) {
      c.dateReferenceYearV4223 = fallbackDate.getFullYear();
    }
    if (sourceContext.fastTimingV30) {
      sourceContext.fastTimingV30.contextHits = Number(sourceContext.fastTimingV30.contextHits || 0) + 1;
    }
    return c;
  }

  var highestConfiguredRow = 0;
  (readConfig.dateRows || []).forEach(function(row) {
    row = Number(row || 0);
    if (row > highestConfiguredRow) highestConfiguredRow = row;
  });

  var requestedDateColumn = Number(readConfig.dateColumn);
  var requestedSourceColumn = Number(sourceColumn || 0);

  sourceContext.sheetMetaV30 = sourceContext.sheetMetaV30 || {};
  var sheetMetaV30 = CE_CONFIG.V30_CONTEXT_CACHE_ENABLED === true
    ? sourceContext.sheetMetaV30[key]
    : null;
  if (!sheetMetaV30) {
    var metaStartedV30 = new Date().getTime();
    var lastRowV30 = Math.max(sheet.getLastRow(), 1);
    var lastColV30 = Math.max(sheet.getLastColumn(), 1);
    var maxRowsV30 = typeof sheet.getMaxRows === "function" ? sheet.getMaxRows() : lastRowV30;
    var maxColsV30 = typeof sheet.getMaxColumns === "function" ? sheet.getMaxColumns() : lastColV30;
    sheetMetaV30 = {
      lastRow: lastRowV30,
      lastCol: lastColV30,
      maxRows: maxRowsV30,
      maxCols: maxColsV30
    };
    if (CE_CONFIG.V30_CONTEXT_CACHE_ENABLED === true) {
      sourceContext.sheetMetaV30[key] = sheetMetaV30;
    }
    if (sourceContext.fastTimingV30) {
      sourceContext.fastTimingV30.sheetMetaMs = Number(sourceContext.fastTimingV30.sheetMetaMs || 0) + (new Date().getTime() - metaStartedV30);
      sourceContext.fastTimingV30.sheetMetaLoads = Number(sourceContext.fastTimingV30.sheetMetaLoads || 0) + 1;
    }
  }

  var maxRows = Number(sheetMetaV30.maxRows || 1);
  var maxCols = Number(sheetMetaV30.maxCols || 1);

  var autoRows = Number(CE_CONFIG.AUTO_SCAN_MAX_ROWS || 100);
  var autoCols = Number(CE_CONFIG.AUTO_SCAN_MAX_COLUMNS || 150);

  var rows = Math.max(
    1,
    Math.min(Number(sheetMetaV30.lastRow || 1), autoRows),
    highestConfiguredRow
  );
  rows = Math.min(rows, maxRows);

  var normalFullCols = Math.max(
    1,
    Math.min(Number(sheetMetaV30.lastCol || 1), autoCols),
    requestedDateColumn >= 0 ? requestedDateColumn + 1 : 0,
    requestedSourceColumn > 0 ? requestedSourceColumn : 0
  );
  normalFullCols = Math.min(normalFullCols, maxCols);

  var plannedMaxColumnV23 = Number(planV23.maxColumn || 0);
  var minColumnsV23 = Math.max(
    1,
    Number(CE_CONFIG.FAST_SEARCH_MIN_COLUMNS || 12),
    Number(CE_CONFIG.DATE_COLUMN_SCAN_LIMIT || 8),
    requestedDateColumn >= 0 ? requestedDateColumn + 1 : 0,
    requestedSourceColumn > 0 ? requestedSourceColumn : 0
  );
  var marginV23 = Math.max(0, Number(CE_CONFIG.FAST_SEARCH_COLUMN_MARGIN || 0));

  var canNarrowV23 = Boolean(
    CE_CONFIG.FAST_SEARCH_ENABLED === true &&
    !forceFullV23 &&
    !planV23.requiresFullScan &&
    plannedMaxColumnV23 > 0
  );

  var cols = normalFullCols;
  if (canNarrowV23) {
    cols = Math.max(
      minColumnsV23,
      plannedMaxColumnV23 + marginV23
    );
    cols = Math.min(cols, normalFullCols, maxCols);
  }

  var needReload =
    !c ||
    Number(c.loadedRows || 0) < rows ||
    Number(c.loadedCols || 0) < cols;

  if (needReload) {
    var loadStartedV23 = new Date().getTime();
    var range = sheet.getRange(1, 1, rows, cols);

    // Giữ raw/display/background y nguyên cho CalendarReader. Notes không tham gia
    // quyết định FREE/BUSY/giá nên V2.3 có thể bỏ một API call nặng.
    var rawValuesV52 = range.getValues();
    var displayValuesV52 = range.getDisplayValues();
    var backgroundsV52 = range.getBackgrounds();
    var notesV52 = CE_CONFIG.FAST_SEARCH_SKIP_NOTES === true
      ? null
      : range.getNotes();

    c = {
      name: sheet.getName(),
      sheetId: sheet.getSheetId(),
      raw: rawValuesV52,
      display: displayValuesV52,
      backgrounds: backgroundsV52,
      notes: notesV52,
      mergedCellsV52: ceBuildMergedCellMapV52_(
        range,
        backgroundsV52,
        displayValuesV52,
        rows,
        cols
      ),
      dateRows: {},
      villaColumns: {},
      loadedRows: rows,
      loadedCols: cols,
      fastSearchNarrowV23: Boolean(canNarrowV23 && cols < normalFullCols),
      fastSearchNormalFullColsV23: normalFullCols,
      dateConfigKeyV50: "",
      dateIndexV50: null,
      villaResolvedColumnsV30: {},
      villaEvidenceV30: {},
      groupSelectionV30: {}
    };

    sourceContext.sheets[key] = c;

    if (sourceContext.fastTimingV23) {
      var loadElapsedV23 = new Date().getTime() - loadStartedV23;
      sourceContext.fastTimingV23.sheetLoads =
        Number(sourceContext.fastTimingV23.sheetLoads || 0) + 1;
      sourceContext.fastTimingV23.sheetLoadMs =
        Number(sourceContext.fastTimingV23.sheetLoadMs || 0) + loadElapsedV23;
      sourceContext.fastTimingV23.loadedCells =
        Number(sourceContext.fastTimingV23.loadedCells || 0) + rows * cols;

      if (c.fastSearchNarrowV23) {
        sourceContext.fastTimingV23.narrowLoads =
          Number(sourceContext.fastTimingV23.narrowLoads || 0) + 1;
      } else {
        sourceContext.fastTimingV23.fullLoads =
          Number(sourceContext.fastTimingV23.fullLoads || 0) + 1;
      }
    }
  }

  if (fallbackDate instanceof Date && !isNaN(fallbackDate.getTime())) {
    c.dateReferenceYearV4223 = fallbackDate.getFullYear();
  }

  if (c.dateConfigKeyV50 !== configKey) {
    c.dateConfigKeyV50 = configKey;
    c.dateConfigV50 = readConfig;
    c.dateRows = {};
    c.dateIndexV50 = null;
    c.villaColumns = {};

    c.dateColumn = ceDetectDateColumnV1_(
      c.raw,
      c.display,
      c.name,
      fallbackDate,
      readConfig
    );
  }

  return c;
}

/**
 * V5.2 - Google Sheets có nguồn dùng MERGE dọc để biểu diễn ngày đã có khách.
 *
 * Ví dụ một vùng D9:D12 được merge và tô vàng:
 * - mắt người dùng thấy D9:D12 đều vàng;
 * - ma trận getBackgrounds() có thể chỉ giữ màu ở ô neo D9,
 *   còn D10:D12 trả về trắng/rỗng.
 *
 * Quy tắc an toàn:
 * - Không thay logic FREE/BUSY.
 * - Chỉ ánh xạ màu HIỂN THỊ của vùng merge từ ô neo sang toàn vùng merge.
 * - Không copy giá/raw value sang các ngày khác.
 * - Không đụng Conditional Formatting / Search / Master / Image.
 */
function ceMaybeExpandCalendarForVillaV23_(
  sourceContext,
  sheet,
  context,
  targetDate,
  villa
) {
  if (
    CE_CONFIG.FAST_SEARCH_ENABLED !== true ||
    CE_CONFIG.FAST_SEARCH_FULL_SCAN_ON_NAME_MISMATCH !== true ||
    !context ||
    !context.fastSearchNarrowV23
  ) {
    return context;
  }

  // GROUP_OPTIONS là mapping cột explicit do MasterEngine nhúng vào CONFIG.
  // Nếu các cột group cần dùng đã nằm trong vùng tải hẹp thì không cần full scan.
  try {
    var groupOptionsV23 = ceParseGroupOptionsV38_(villa && villa.config || "");
    if (groupOptionsV23 && groupOptionsV23.length) {
      var allGroupColumnsLoadedV23 = groupOptionsV23.every(function(option) {
        var col = Number(option && option.column || 0) - 1;
        return col >= 0 && col < Number(context.loadedCols || 0);
      });
      if (allGroupColumnsLoadedV23) return context;
    }
  } catch (ignoreGroupV23) {}

  var savedColumnV23 = Number(villa && villa.sourceColumn || 0) - 1;
  if (savedColumnV23 < 0 || savedColumnV23 >= Number(context.loadedCols || 0)) {
    return ceExpandCalendarSheetFullV23_(
      sourceContext, sheet, targetDate, villa, "SOURCE_COLUMN_OUTSIDE_NARROW_RANGE"
    );
  }

  var evidenceV23 = ceVillaColumnNameEvidenceV53_(
    context,
    villa && villa.name || "",
    savedColumnV23
  );

  if (Number(evidenceV23 && evidenceV23.score || 0) >= 70) {
    return context;
  }

  return ceExpandCalendarSheetFullV23_(
    sourceContext,
    sheet,
    targetDate,
    villa,
    "LOW_SOURCE_COLUMN_NAME_EVIDENCE:" +
      Number(evidenceV23 && evidenceV23.score || 0)
  );
}

function ceExpandCalendarSheetFullV23_(
  sourceContext,
  sheet,
  targetDate,
  villa,
  reason
) {
  sourceContext.fastSearchForceFullV23 = sourceContext.fastSearchForceFullV23 || {};
  var key = String(sheet.getSheetId());

  if (!sourceContext.fastSearchForceFullV23[key]) {
    sourceContext.fastSearchForceFullV23[key] = true;
    if (sourceContext.fastTimingV23) {
      sourceContext.fastTimingV23.fullFallbacks =
        Number(sourceContext.fastTimingV23.fullFallbacks || 0) + 1;
    }

    Logger.log(JSON.stringify({
      code: "FAST_SEARCH_FULL_FALLBACK_V23",
      source: villa && villa.source || "",
      villa: villa && villa.name || "",
      sheet: sheet && sheet.getName ? sheet.getName() : "",
      sourceColumn: Number(villa && villa.sourceColumn || 0),
      reason: reason || ""
    }));
  }

  return ceLoadCalendarSheetV34_(
    sourceContext,
    sheet,
    targetDate,
    villa && villa.config || "",
    Number(villa && villa.sourceColumn || 0)
  );
}

function ceBuildMergedCellMapV52_(
  loadedRange,
  backgrounds,
  displayValues,
  loadedRows,
  loadedCols
) {
  var map = {};

  if (!loadedRange || typeof loadedRange.getMergedRanges !== "function") {
    return map;
  }

  var mergedRanges = [];
  try {
    mergedRanges = loadedRange.getMergedRanges() || [];
  } catch (error) {
    Logger.log(JSON.stringify({
      code: "MERGED_RANGE_SCAN_FAIL_V52",
      error: String(error && error.message ? error.message : error)
    }));
    return map;
  }

  mergedRanges.forEach(function(mergedRange) {
    var startRow = Number(mergedRange.getRow() || 1) - 1;
    var startCol = Number(mergedRange.getColumn() || 1) - 1;
    var numRows = Number(mergedRange.getNumRows() || 1);
    var numCols = Number(mergedRange.getNumColumns() || 1);

    if (numRows <= 1 && numCols <= 1) return;
    if (startRow < 0 || startCol < 0) return;
    if (startRow >= loadedRows || startCol >= loadedCols) return;

    var anchorBg = String(
      backgrounds &&
      backgrounds[startRow] &&
      backgrounds[startRow][startCol] || ""
    ).toLowerCase();

    var anchorDisplay = String(
      displayValues &&
      displayValues[startRow] &&
      displayValues[startRow][startCol] || ""
    );

    var endRow = Math.min(loadedRows, startRow + numRows);
    var endCol = Math.min(loadedCols, startCol + numCols);

    for (var row = startRow; row < endRow; row++) {
      for (var col = startCol; col < endCol; col++) {
        map[row + "|" + col] = {
          anchorRow: startRow,
          anchorColumn: startCol,
          background: anchorBg,
          anchorDisplay: anchorDisplay
        };
      }
    }
  });

  return map;
}

function ceVisualBackgroundV52_(c, row, col, baseBackground) {
  var base = String(baseBackground || "").toLowerCase();
  var mergedMap = c && c.mergedCellsV52 || {};
  var merged = mergedMap[row + "|" + col];

  if (!merged || !merged.background) {
    return {
      background: base,
      merged: false,
      anchorRow: row,
      anchorColumn: col,
      anchorDisplay: ""
    };
  }

  var visual = String(merged.background || "").toLowerCase();

  if (visual && visual !== base) {
    Logger.log(JSON.stringify({
      code: "MERGED_VISUAL_BACKGROUND_V52",
      sheet: c && c.name || "",
      cell: ceColumnToLetterV33_(col + 1) + (row + 1),
      anchorCell:
        ceColumnToLetterV33_(Number(merged.anchorColumn || 0) + 1) +
        (Number(merged.anchorRow || 0) + 1),
      baseBackground: base,
      visualBackground: visual,
      anchorDisplay: String(merged.anchorDisplay || "")
    }));
  }

  return {
    background: visual || base,
    merged: true,
    anchorRow: Number(merged.anchorRow || 0),
    anchorColumn: Number(merged.anchorColumn || 0),
    anchorDisplay: String(merged.anchorDisplay || "")
  };
}

function ceFindCalendarDateRowV34_(c, targetDate) {
  var key = ceDateKey_(targetDate);

  if (key in c.dateRows) {
    return c.dateRows[key];
  }

  if (!c.dateIndexV50) {
    c.dateIndexV50 = ceBuildCalendarDateIndexV50_(c);
  }

  if (key in c.dateIndexV50) {
    c.dateRows[key] = c.dateIndexV50[key];
    return c.dateRows[key];
  }

  c.dateRows[key] = -1;
  return -1;
}

function ceBuildCalendarDateIndexV50_(c) {
  var index = {};

  if (
    !c ||
    c.dateColumn < 0 ||
    !c.display ||
    !c.display.length
  ) {
    return index;
  }

  var readConfig = c.dateConfigV50 || {
    dateRows: [],
    dateOrder: "AUTO"
  };

  var sheetMonth = ceSheetMonthV50_(c.name);
  var sheetYear = ceSheetYearV50_(
    c.name,
    Number(c.dateReferenceYearV4223 || new Date().getFullYear())
  );

  var rowIndexes = ceDateRowsForScanV50_(
    c.display.length,
    readConfig
  );

  var previousDate = null;
  var inlineMonthV4223 = null;
  var outsideSheetMonth = 0;
  var usedRows = 0;

  /*
   * V5.5 - KHÔNG KHÓA "NGÀY ĐẦU TIÊN GẶP ĐƯỢC".
   *
   * Một số sheet có ô header phía trên mang số "1". Parser có thể hiểu ô đó
   * thành 01/09, sau đó ngày 01/09 thật ở bảng lịch cũng parse thành 01/09.
   * V5.2/V5.3 dùng "first wins", nên index bị khóa vào row 1 và đọc nhầm
   * header giá thay vì hàng lịch thật.
   *
   * V5.5 giữ nguyên parser ngày hiện có nhưng thu TẤT CẢ candidate theo row.
   * Khi một ngày xuất hiện nhiều lần, chọn occurrence nằm trong chuỗi ngày
   * liên tục (01/09 -> 02/09 -> 03/09...) thay vì occurrence cô lập ở header.
   */
  var candidates = [];

  for (var i = 0; i < rowIndexes.length; i++) {
    var row = rowIndexes[i];

    var raw = c.raw[row]
      ? c.raw[row][c.dateColumn]
      : "";

    var display = c.display[row]
      ? c.display[row][c.dateColumn]
      : "";

    if (!(sheetMonth >= 1 && sheetMonth <= 12)) {
      var markerV4223 = ceInlineMonthMarkerV4223_(raw, display, sheetYear, inlineMonthV4223);
      if (markerV4223) {
        inlineMonthV4223 = markerV4223;
        previousDate = null;
        continue;
      }
    }

    var activeMonthV4223 = sheetMonth || (inlineMonthV4223 ? inlineMonthV4223.month : 0);
    var activeYearV4223 = sheetMonth
      ? sheetYear
      : (inlineMonthV4223 ? inlineMonthV4223.year : sheetYear);

    var parsed = ceParseCalendarDateCellV50_(
      raw,
      display,
      activeMonthV4223,
      activeYearV4223,
      previousDate,
      readConfig.dateOrder || "AUTO"
    );

    if (!parsed || isNaN(parsed.getTime())) continue;

    previousDate = parsed;
    usedRows++;

    candidates.push({
      row: row,
      date: parsed,
      key: ceDateKey_(parsed),
      display: String(display == null ? "" : display).trim()
    });

    if (
      sheetMonth &&
      parsed.getMonth() + 1 !== sheetMonth
    ) {
      outsideSheetMonth++;
    }
  }

  var byKey = {};
  candidates.forEach(function(item, position) {
    item.positionV55 = position;
    byKey[item.key] = byKey[item.key] || [];
    byKey[item.key].push(item);
  });

  var duplicateResolvedV55 = 0;

  Object.keys(byKey).forEach(function(key) {
    var list = byKey[key];

    if (list.length === 1) {
      index[key] = list[0].row;
      return;
    }

    var ranked = list.map(function(item) {
      return {
        item: item,
        score: ceDateIndexSequenceScoreV55_(candidates, item)
      };
    }).sort(function(a, b) {
      if (a.score !== b.score) return b.score - a.score;

      /*
       * Tie tuyệt đối: giữ hành vi cũ "first wins" để giảm rủi ro thay đổi
       * những nguồn đã chạy ổn.
       */
      return a.item.positionV55 - b.item.positionV55;
    });

    var chosen = ranked[0];
    index[key] = chosen.item.row;
    duplicateResolvedV55++;

    Logger.log(JSON.stringify({
      code: "CALENDAR_DATE_DUPLICATE_RESOLVED_V55",
      sheet: c.name,
      date: key,
      chosenRow: chosen.item.row + 1,
      chosenDisplay: chosen.item.display,
      chosenScore: chosen.score,
      candidates: ranked.map(function(entry) {
        return {
          row: entry.item.row + 1,
          display: entry.item.display,
          score: entry.score
        };
      }),
      rule: "PREFER_CONTIGUOUS_DATE_SEQUENCE_KEEP_FIRST_ON_TIE"
    }));
  });

  var keys = Object.keys(index).sort();

  Logger.log(JSON.stringify({
    code: "CALENDAR_DATE_INDEX_BUILT_V50",
    sheet: c.name,
    dateColumn: c.dateColumn + 1,
    configuredRows: readConfig.dateRows || [],
    dateOrder: readConfig.dateOrder || "AUTO",
    dates: keys.length,
    outsideSheetMonth: outsideSheetMonth,
    duplicateResolvedV55: duplicateResolvedV55,
    firstDates: keys.slice(0, 3),
    lastDates: keys.slice(-3)
  }));

  return index;
}


/**
 * V5.5 - Điểm liên tục của một occurrence ngày.
 *
 * Không nhìn màu, giá hay cột căn.
 * Chỉ xét thứ tự các candidate ngày đã parse trong chính cột ngày:
 * - candidate ngay trước = ngày -1  -> mạnh
 * - candidate ngay sau   = ngày +1  -> mạnh
 * - tiếp tục thêm tối đa 4 bước mỗi phía để ưu tiên block lịch thật.
 */
function ceDateIndexSequenceScoreV55_(candidates, item) {
  var position = Number(item && item.positionV55);
  if (!(position >= 0) || !item || !(item.date instanceof Date)) return -999999;

  var score = 0;
  var currentTime = item.date.getTime();
  var oneDay = 86400000;

  function dayDiff_(a, b) {
    return Math.round((a.getTime() - b.getTime()) / oneDay);
  }

  /*
   * Immediate neighbors có trọng số lớn nhất.
   * Header giả 01/09 thường đứng cô lập; 01/09 thật nằm cạnh 02/09.
   */
  var prev = position > 0 ? candidates[position - 1] : null;
  var next = position + 1 < candidates.length ? candidates[position + 1] : null;

  if (prev && prev.date instanceof Date) {
    var prevDiff = dayDiff_(item.date, prev.date);
    if (prevDiff === 1) score += 1200;
    else if (prevDiff === 0) score -= 50;
  }

  if (next && next.date instanceof Date) {
    var nextDiff = dayDiff_(next.date, item.date);
    if (nextDiff === 1) score += 1200;
    else if (nextDiff === 0) score -= 50;
  }

  /*
   * Nhìn sâu thêm để nhận diện cả block 01,02,03,04...
   * Không yêu cầu row phải sát nhau vì một số nguồn có dòng trống xen kẽ.
   */
  var expected = item.date;
  for (var back = 1; back <= 4 && position - back >= 0; back++) {
    var backItem = candidates[position - back];
    var expectedBack = new Date(
      item.date.getFullYear(),
      item.date.getMonth(),
      item.date.getDate() - back
    );

    if (
      backItem &&
      backItem.date instanceof Date &&
      ceDateKey_(backItem.date) === ceDateKey_(expectedBack)
    ) {
      score += Math.max(100, 500 - back * 75);
    } else {
      break;
    }
  }

  for (var forward = 1; forward <= 4 && position + forward < candidates.length; forward++) {
    var forwardItem = candidates[position + forward];
    var expectedForward = new Date(
      item.date.getFullYear(),
      item.date.getMonth(),
      item.date.getDate() + forward
    );

    if (
      forwardItem &&
      forwardItem.date instanceof Date &&
      ceDateKey_(forwardItem.date) === ceDateKey_(expectedForward)
    ) {
      score += Math.max(100, 500 - forward * 75);
    } else {
      break;
    }
  }

  return score;
}

/**
 * V3.8 - Đọc danh sách cột con được MasterEngine nhúng vào CONFIG LỊCH.
 * Chọn mức đủ khách gần nhất; nếu không có thì lấy mức thiếu gần nhất.
 * Nhóm chỉ có số phòng sẽ ưu tiên số phòng gần với PN của villa, sau đó
 * dùng cột đầu tiên ổn định.
 */
function ceResolveGroupedVillaColumnV38_(context,villa,guestCount){
  context = context || {};
  context.groupSelectionV30 = context.groupSelectionV30 || {};
  var groupKeyV30 = String(villa && (villa.id || villa.name) || "") + "|" +
    String(Number(guestCount || 0)) + "|" + String(villa && villa.bedrooms || "");
  if (Object.prototype.hasOwnProperty.call(context.groupSelectionV30, groupKeyV30)) {
    return context.groupSelectionV30[groupKeyV30];
  }

  var options=ceParseGroupOptionsV38_(villa&&villa.config||"");
  if(!options.length){
    context.groupSelectionV30[groupKeyV30]=null;
    return null;
  }

  var valid=options.filter(function(option){
    var column=Number(option.column||0)-1;
    return (
      column>=0 &&
      context.display.length &&
      column<context.display[0].length &&
      column!==context.dateColumn
    );
  });

  if(!valid.length){
    context.groupSelectionV30[groupKeyV30]=null;
    return null;
  }

  var guests=Number(guestCount||0);
  var targetBedrooms=Number(villa&&villa.bedrooms||0);

  valid.sort(function(a,b){
    var aScore=ceGroupOptionScoreV38_(a,guests,targetBedrooms);
    var bScore=ceGroupOptionScoreV38_(b,guests,targetBedrooms);
    if(aScore!==bScore)return bScore-aScore;
    return Number(a.column||0)-Number(b.column||0);
  });

  var selectedV30 = {
    column:Number(valid[0].column)-1,
    label:String(valid[0].label||"")
  };
  context.groupSelectionV30[groupKeyV30]=selectedV30;
  return selectedV30;
}

function ceGroupOptionScoreV38_(option,guestCount,targetBedrooms){
  var capacity=Number(option.capacity||0);
  var bedrooms=Number(option.bedrooms||0);
  var score=0;

  if(capacity>0&&guestCount>0){
    var diff=capacity-guestCount;
    if(diff>=0)score+=10000-diff*100;
    else score+=5000-Math.abs(diff)*100;
  }else if(bedrooms>0&&targetBedrooms>0){
    var roomDiff=bedrooms-targetBedrooms;
    if(roomDiff>=0)score+=3000-roomDiff*50;
    else score+=1500-Math.abs(roomDiff)*50;
  }else if(capacity>0){
    score+=1000-capacity;
  }else if(bedrooms>0){
    score+=500-bedrooms;
  }

  return score;
}

function ceParseGroupOptionsV38_(rawConfig){
  var text=String(rawConfig||"");
  if (Object.prototype.hasOwnProperty.call(CE_GROUP_OPTIONS_CACHE_V30_, text)) {
    return CE_GROUP_OPTIONS_CACHE_V30_[text];
  }
  var match=text.match(/(?:^|;)\s*GROUP_OPTIONS_B64=([^;\s]+)/i);
  if(!match){
    CE_GROUP_OPTIONS_CACHE_V30_[text]=[];
    return [];
  }

  try{
    var bytes;
    try{bytes=Utilities.base64DecodeWebSafe(match[1]);}
    catch(webSafeError){bytes=Utilities.base64Decode(match[1]);}
    var json=Utilities.newBlob(bytes).getDataAsString("UTF-8");
    var parsed=JSON.parse(json);
    var resultV30=Array.isArray(parsed)?parsed:[];
    CE_GROUP_OPTIONS_CACHE_V30_[text]=resultV30;
    return resultV30;
  }catch(error){
    Logger.log(JSON.stringify({
      code:"GROUP_OPTIONS_PARSE_SKIPPED_V355",
      error:String(error&&error.message?error.message:error)
    }));
    CE_GROUP_OPTIONS_CACHE_V30_[text]=[];
    return [];
  }
}

function ceResolveVillaColumnV40_(c,villa){
  var savedColumn=Number(villa&&villa.sourceColumn||0)-1;
  var villaName=villa&&villa.name||'';
  c = c || {};
  c.villaResolvedColumnsV30 = c.villaResolvedColumnsV30 || {};
  var resolvedKeyV30 = ceVillaMatchKeyV40_(villaName) + "|" + String(savedColumn);
  if (CE_CONFIG.V30_CONTEXT_CACHE_ENABLED === true && Object.prototype.hasOwnProperty.call(c.villaResolvedColumnsV30, resolvedKeyV30)) {
    return c.villaResolvedColumnsV30[resolvedKeyV30];
  }

  /*
   * V5.3 - SOURCE COLUMN AN TOÀN KHI QUA THÁNG
   *
   * V5.2 ưu tiên sourceColumn tuyệt đối nếu số cột vẫn tồn tại.
   * Điều đó đúng trong sheet đã dùng lúc build MASTER, nhưng sai khi chủ nguồn
   * đổi thứ tự/chèn/xóa căn ở sheet tháng kế tiếp.
   *
   * Ví dụ:
   *   T8: 81TP = AH
   *   T9: AH = "BÃI DÂU / GIÁ THU VỀ", còn 81TP nằm cột khác.
   *
   * Quy tắc V5.3:
   * 1. sourceColumn vẫn là lựa chọn số 1.
   * 2. Nếu chính cột đó có bằng chứng tên căn đủ mạnh -> dùng nguyên cột cũ.
   * 3. Nếu không khớp tên, chỉ remap khi bộ dò tên tìm được MỘT cột khác đủ
   *    tin cậy theo đúng rule V4.0 hiện có.
   * 4. Nếu không tìm được cột khác đáng tin -> GIỮ sourceColumn cũ.
   *
   * Như vậy không có chuyện "tìm cột trắng hơn" để cứu căn; chỉ đổi cột khi
   * tên căn trên sheet hiện tại chứng minh sourceColumn đã lệch.
   */
  var savedUsable=(
    savedColumn>=0 &&
    c.display.length &&
    savedColumn<c.display[0].length &&
    savedColumn!==c.dateColumn
  );

  if(!savedUsable){
    var missingResolvedV30 = ceFindCalendarVillaColumnV34_(c,villaName);
    if (CE_CONFIG.V30_CONTEXT_CACHE_ENABLED === true) c.villaResolvedColumnsV30[resolvedKeyV30] = missingResolvedV30;
    return missingResolvedV30;
  }

  var savedEvidence=ceVillaColumnNameEvidenceV53_(
    c,
    villaName,
    savedColumn
  );

  if(savedEvidence.score>=70){
    if (CE_CONFIG.V30_CONTEXT_CACHE_ENABLED === true) c.villaResolvedColumnsV30[resolvedKeyV30] = savedColumn;
    return savedColumn;
  }

  var detectedColumn=ceFindCalendarVillaColumnV34_(c,villaName);

  if(detectedColumn>=0&&detectedColumn!==savedColumn){
    var detectedEvidence=ceVillaColumnNameEvidenceV53_(
      c,
      villaName,
      detectedColumn
    );

    /*
     * ceFindCalendarVillaColumnV34_ đã áp ngưỡng:
     * best >= 70 và phải thắng cột thứ hai đủ xa (hoặc exact >=1000).
     * Check score lần nữa ở đây chỉ để log/chặn trường hợp dữ liệu bất thường.
     */
    if(detectedEvidence.score>=70){
      Logger.log(JSON.stringify({
        code:'CALENDAR_SOURCE_COLUMN_REMAPPED_V53',
        sheet:c&&c.name||'',
        villa:villaName,
        sourceColumn:savedColumn+1,
        sourceColumnEvidence:savedEvidence.score,
        sourceColumnLabel:savedEvidence.label||'',
        resolvedColumn:detectedColumn+1,
        resolvedColumnEvidence:detectedEvidence.score,
        resolvedColumnLabel:detectedEvidence.label||'',
        rule:'NAME_MATCH_ONLY_NO_FREE_CELL_SELECTION'
      }));

      if (CE_CONFIG.V30_CONTEXT_CACHE_ENABLED === true) c.villaResolvedColumnsV30[resolvedKeyV30] = detectedColumn;
      return detectedColumn;
    }
  }

  /*
   * Không có tên thay thế đủ chắc chắn => giữ hành vi ổn định V5.2.
   * Cần thiết cho nguồn có header merge/thiếu tên nhưng sourceColumn vẫn đúng.
   */
  Logger.log(JSON.stringify({
    code:'CALENDAR_SOURCE_COLUMN_FALLBACK_V53',
    sheet:c&&c.name||'',
    villa:villaName,
    sourceColumn:savedColumn+1,
    sourceColumnEvidence:savedEvidence.score,
    sourceColumnLabel:savedEvidence.label||'',
    detectedColumn:detectedColumn>=0?detectedColumn+1:-1,
    reason:'NO_RELIABLE_NAME_REMAP_KEEP_SAVED_COLUMN'
  }));

  if (ceSavedColumnContradictsNameV1_(villaName, savedEvidence)) {
    Logger.log(JSON.stringify({
      code: "CALENDAR_SOURCE_COLUMN_CONTRADICTED_V1",
      sheet: c && c.name || "",
      villa: villaName,
      sourceColumn: savedColumn + 1,
      sourceColumnEvidence: savedEvidence.score,
      sourceColumnLabel: savedEvidence.label || "",
      action: "UNKNOWN_NOT_READ"
    }));
    if (CE_CONFIG.V30_CONTEXT_CACHE_ENABLED === true) c.villaResolvedColumnsV30[resolvedKeyV30] = -1;
    return -1;
  }
  if (CE_CONFIG.V30_CONTEXT_CACHE_ENABLED === true) c.villaResolvedColumnsV30[resolvedKeyV30] = savedColumn;
  return savedColumn;
}


/**
 * V5.3 - Chấm bằng chứng tên căn RIÊNG trên một cột.
 *
 * Chỉ nhìn vùng header tối đa 20 hàng giống bộ dò tên hiện tại.
 * Không đọc màu, không đọc trạng thái FREE/BUSY, không đọc giá.
 */
function ceVillaColumnNameEvidenceV53_(c,villaName,column){
  var targetKey=ceVillaMatchKeyV40_(villaName);
  var targetTokens=ceVillaTokensV40_(targetKey);
  var bestScore=-999999;
  var bestLabel='';

  c = c || {};
  c.villaEvidenceV30 = c.villaEvidenceV30 || {};
  var evidenceKeyV30 = targetKey + "|" + String(column);
  if (CE_CONFIG.V30_CONTEXT_CACHE_ENABLED === true && Object.prototype.hasOwnProperty.call(c.villaEvidenceV30, evidenceKeyV30)) {
    return c.villaEvidenceV30[evidenceKeyV30];
  }

  if(
    !c ||
    !c.display ||
    !c.display.length ||
    column<0 ||
    !c.display[0] ||
    column>=c.display[0].length ||
    !targetKey
  ){
    return {score:bestScore,label:bestLabel};
  }

  var maxRows=Math.min(c.display.length,20);

  function scoreValue_(value){
    var original=String(value||'').trim();
    if(!original)return;

    var variants=[original];
    var firstLine=original.split(/\r?\n/)[0];
    if(firstLine&&firstLine!==original)variants.push(firstLine);

    variants.forEach(function(label){
      var key=ceVillaMatchKeyV40_(label);
      if(!key||!ceLooksLikeVillaCandidateV40_(key))return;

      var item={
        original:label,
        key:key,
        tokens:ceVillaTokensV40_(key)
      };

      var score=ceVillaNameScoreV40_(
        targetKey,
        targetTokens,
        item
      );

      if(score>bestScore){
        bestScore=score;
        bestLabel=label;
      }
    });
  }

  for(var row=0;row<maxRows;row++){
    scoreValue_(
      c.display[row]&&c.display[row][column]
    );
  }

  var resultV30 = {
    score:bestScore,
    label:bestLabel
  };
  if (CE_CONFIG.V30_CONTEXT_CACHE_ENABLED === true) c.villaEvidenceV30[evidenceKeyV30] = resultV30;
  return resultV30;
}

function ceFindCalendarVillaColumnV34_(c,villaName){
  c.villaColumns=c.villaColumns||{};
  c.villaNameIndex=c.villaNameIndex||null;

  var targetKey=ceVillaMatchKeyV40_(villaName);
  if(targetKey in c.villaColumns)return c.villaColumns[targetKey];

  if(!c.villaNameIndex){
    c.villaNameIndex=ceBuildVillaNameIndexV40_(c);
  }

  var targetTokens=ceVillaTokensV40_(targetKey);
  var scoresByColumn={};
  var labelsByColumn={};

  c.villaNameIndex.forEach(function(item){
    var score=ceVillaNameScoreV40_(targetKey,targetTokens,item);
    if(!(item.column in scoresByColumn)||score>scoresByColumn[item.column]){
      scoresByColumn[item.column]=score;
      labelsByColumn[item.column]=item.original;
    }
  });

  var ranked=Object.keys(scoresByColumn).map(function(column){
    return {
      column:Number(column),
      score:scoresByColumn[column],
      label:labelsByColumn[column]
    };
  }).sort(function(a,b){return b.score-a.score;});

  var best=ranked[0]||null;
  var second=ranked[1]||null;
  var secondScore=second?second.score:-999999;

  /*
   * FIX-L5b: hai cột cùng đạt điểm tuyệt đối (>=1000) là mơ hồ. Trước đây
   * cột có chỉ số nhỏ hơn thắng ngầm. Nay trả -1 để không đọc sai cột.
   */
  var ambiguousV_FIX = !!(best && second && best.score>=1000 && second.score>=1000);
  if(ambiguousV_FIX){
    Logger.log(JSON.stringify({
      code:'VILLA_COLUMN_AMBIGUOUS_V_FIX',
      sheet:c.name,
      villa:villaName,
      bestColumn:best.column+1,
      secondColumn:second.column+1,
      score:best.score
    }));
  }

  if(!ambiguousV_FIX && best&&best.score>=70&&(best.score-secondScore>=15||best.score>=1000)){
    c.villaColumns[targetKey]=best.column;
    return best.column;
  }

  Logger.log(JSON.stringify({
    code:'VILLA_COLUMN_NOT_FOUND_V40',
    sheet:c.name,
    villa:villaName,
    targetKey:targetKey,
    bestScore:best?best.score:-999999,
    secondScore:secondScore,
    bestColumn:best?best.column+1:-1,
    bestLabel:best?best.label:''
  }));

  c.villaColumns[targetKey]=-1;
  return -1;
}

function ceBuildVillaNameIndexV40_(c){
  var result=[];
  var seen={};
  var maxRows=Math.min(c.display.length,20);
  var maxCols=c.display.length&&c.display[0]?c.display[0].length:0;

  function add_(column,value){
    var original=String(value||'').trim();
    var key=ceVillaMatchKeyV40_(original);
    var unique=column+'|'+key;
    if(!key||seen[unique])return;
    if(!ceLooksLikeVillaCandidateV40_(key))return;

    seen[unique]=true;
    result.push({
      column:column,
      original:original,
      key:key,
      tokens:ceVillaTokensV40_(key)
    });
  }

  /*
   * FIX-L5a (sửa B1): banner = hàng có đúng MỘT ô có chữ và ô đó nằm ở cột A
   * (tiêu đề gộp kiểu "MƠ MỘT GIẤC" gộp A1:C1). Bản trước coi mọi hàng ≤1 ô là
   * banner, làm mất tên căn đơn ở cột khác (ví dụ "Villa Epsilon" ở cột E).
   * Hàng có tên căn đơn ở cột khác A vẫn được dò bình thường.
   */
  var bannerRowsV_FIX = {};
  for(var rowB=0;rowB<maxRows;rowB++){
    var nonEmptyV_FIX=0;
    var onlyColV_FIX=-1;
    for(var colB=0;colB<maxCols;colB++){
      if(String((c.display[rowB]&&c.display[rowB][colB])||'').trim()){
        nonEmptyV_FIX++;
        onlyColV_FIX=colB;
      }
    }
    if(nonEmptyV_FIX===1&&onlyColV_FIX===0)bannerRowsV_FIX[rowB]=true;
  }

  /*
   * Dùng bộ dò tên của Master khi có sẵn. Đây là bộ đã đọc đúng nguồn trong
   * lúc build MASTER_VILLA.
   */
  try{
    var cfg=parseMasterColumnConfig(
      'NAME_MODE=AUTO_ROW;NAME_SCAN_ROWS=1-20;START_COL=1;FALLBACK=TRUE;MIN_NAMES_IN_ROW=2;MIN_SCORE=0'
    );
    var detected=resolveMasterVillaNameRow(c.display,cfg);
    var detectedRowV_FIX=detected&&Number.isInteger(detected.row)?detected.row:-1;

    for(var col=0;col<maxCols;col++){
      if(col===c.dateColumn)continue;
      if(detectedRowV_FIX>=0&&bannerRowsV_FIX[detectedRowV_FIX])continue;
      var found=readMasterVillaNameAtColumn(c.display,[],col,detected,cfg);
      var foundRowV_FIX=found&&Number.isInteger(found.row)?found.row:-1;
      if(foundRowV_FIX>=0&&bannerRowsV_FIX[foundRowV_FIX])continue;
      if(found&&found.name)add_(col,found.name);
    }
  }catch(ignore){}

  /*
   * Fallback cho tab có hàng tên khác cấu trúc hoặc tên nằm nhiều dòng.
   */
  for(var col2=0;col2<maxCols;col2++){
    if(col2===c.dateColumn)continue;

    for(var row=0;row<maxRows;row++){
      if(bannerRowsV_FIX[row])continue;
      var raw=String((c.display[row]&&c.display[row][col2])||'').trim();
      if(!raw)continue;
      add_(col2,raw);
      add_(col2,raw.split(/\r?\n/)[0]);
    }
  }

  return result;
}

function ceVillaMatchKeyV40_(value){
  var text=String(value||'')
    .replace(/\r?\n/g,' ')
    /*
     * Tên Master có thể bị cắt giữa ngoặc:
     * "Mer House (2 Phòng", "Ohman Villa (6pn,6wc".
     */
    .replace(/\s*[\(\[].*$/,' ')
    .replace(/\s*:\s*.*$/,' ')
    .replace(/[._'’`´-]+/g,' ')
    .replace(/\b(?:suc chua|tieu chuan|toi da)\b.*$/i,' ')
    .replace(/\b\d+\s*(?:phong ngu|phong|pn|pax|khach|nguoi|wc|giuong)\b.*$/i,' ');

  var baseKeyV421=ceNormalize_(text)
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
  var keyV421=baseKeyV421
    .replace(/\b(?:homestay|home|villa|hotel|resort)\b/g,' ')
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
  /*
   * V4.21 - Tên ngắn kiểu "G Villa" bị bỏ chữ "villa" còn 1 ký tự "g", và
   * "g" là chuỗi con của "phong" -> mọi nhãn "Căn X Phòng" bị chấm khớp nhầm
   * (172 điểm), làm cột căn không được dò lại khi tháng sau đổi vị trí cột.
   * Khi phần còn lại < 3 ký tự thì giữ nguyên tên gốc ("g villa").
   */
  if(keyV421.length<3&&baseKeyV421.length>=3)return baseKeyV421;
  return keyV421;
}

function ceVillaTokensV40_(key){
  return String(key||'').split(/\s+/).filter(Boolean);
}

function ceLooksLikeVillaCandidateV40_(key){
  if(!key||key.length<2)return false;
  if(/^(ngay|thu|gia|khach|pax|ghi chu|thong tin|date|stt)$/.test(key))return false;
  if(/^\d+$/.test(key))return false;
  return true;
}

function ceVillaNameScoreV40_(targetKey,targetTokens,item){
  if(!item.key)return -999999;
  if(item.key===targetKey)return 1200;

  var score=0;
  if(item.key.indexOf(targetKey)>=0||targetKey.indexOf(item.key)>=0){
    score+=180;
  }

  var common=0;
  var itemSet={};
  item.tokens.forEach(function(token){itemSet[token]=true;});
  targetTokens.forEach(function(token){if(itemSet[token])common++;});

  var union={};
  targetTokens.concat(item.tokens).forEach(function(token){union[token]=true;});
  var ratio=common/(Object.keys(union).length||1);

  var targetNumbers=targetTokens.filter(function(token){return /^\d+$/.test(token);});
  var itemNumbers=item.tokens.filter(function(token){return /^\d+$/.test(token);});

  if(ratio>=0.45&&(targetNumbers.length||itemNumbers.length)){
    if(targetNumbers.join('|')!==itemNumbers.join('|'))return -500;
    score+=80;
  }

  score+=Math.round(ratio*150);
  score-=Math.abs(targetTokens.length-item.tokens.length)*4;
  return score;
}

/*
 * B6 - Ô TRẮNG KHÔNG CÓ GIÁ = CHƯA RÕ (quyết định của chủ hệ thống 10/11/2026).
 *
 * Chỉ áp dụng cho cột "thường ghi giá": trong các hàng ngày của tab, ít nhất 3 ô
 * và >= 20% số ô đọc được giá cho đúng căn/option này. Nguồn không ghi giá vào ô
 * lịch giữ nguyên quy tắc cũ (nền trắng = trống, giá "Liên hệ"), tránh mất cả nguồn.
 *
 * Tắt cho một nguồn: CONFIG LỊCH thêm  O_TRANG_KHONG_GIA=TRONG  (hoặc WHITE_NO_PRICE=FREE).
 * Tắt toàn hệ thống: Script Property  BE_B6_WHITE_NO_PRICE = FREE.
 */
var CE_B6_CACHE_ = {globalMode:null, configModes:{}};

function ceB6GlobalModeV1_(){
  if(CE_B6_CACHE_.globalMode!==null)return CE_B6_CACHE_.globalMode;
  var mode='UNKNOWN';
  try{
    var v=String(PropertiesService.getScriptProperties().getProperty('BE_B6_WHITE_NO_PRICE')||'').trim().toUpperCase();
    if(v==='FREE'||v==='TRONG'||v==='OFF')mode='FREE';
  }catch(ignore){}
  CE_B6_CACHE_.globalMode=mode;
  return mode;
}

function ceB6ConfigModeV1_(rawConfig){
  var key=String(rawConfig||'');
  if(Object.prototype.hasOwnProperty.call(CE_B6_CACHE_.configModes,key))return CE_B6_CACHE_.configModes[key];
  var mode='UNKNOWN';
  try{
    var cfg=parseBookingSourceConfig(key||'AUTO')||{};
    var v=String(beConfigValue_(cfg,['O_TRANG_KHONG_GIA','WHITE_NO_PRICE'],'')||'').trim().toUpperCase();
    v=typeof ceNormalize_==='function'?ceNormalize_(v).toUpperCase():v;
    if(v==='FREE'||v==='TRONG'||v==='OFF')mode='FREE';
  }catch(ignore){}
  CE_B6_CACHE_.configModes[key]=mode;
  return mode;
}

/** B6 - có coi ô trống-không-giá tại (c,col) là CHƯA RÕ không. */
function ceWhiteNoPriceIsUnknownB6_(c,col,rawConfig,villa,optionLabel){
  if(ceB6GlobalModeV1_()==='FREE')return false;
  if(ceB6ConfigModeV1_(rawConfig)==='FREE')return false;
  return ceColumnUsuallyHasPriceB6_(c,col,villa,optionLabel);
}

function ceWhiteNoPriceStateB6_(bg,display,note,baseReason){
  return {
    status:'UNKNOWN',available:null,price:null,unknownReason:'WHITE_NO_PRICE_B6',
    reason:baseReason+' nhưng không có giá - cần kiểm tra',
    background:bg,display:String(display||''),note:String(note||'')
  };
}

/** B6 - cột của căn có thói quen ghi giá: >= 3 ô và >= 20% hàng ngày đọc được giá. */
function ceColumnUsuallyHasPriceB6_(c,col,villa,optionLabel){
  if(!c)return false;
  c.priceColumnCacheB6=c.priceColumnCacheB6||{};
  var key=[col,String(optionLabel||''),String(villa&&(villa.id||villa.name)||''),String(villa&&villa.bedrooms||'')].join('|');
  if(Object.prototype.hasOwnProperty.call(c.priceColumnCacheB6,key))return c.priceColumnCacheB6[key];
  var rows=[],seen={};
  var idx=c.dateIndexV50||{};
  Object.keys(idx).forEach(function(k){var r=Number(idx[k]);if(isFinite(r)&&r>=0&&!seen[r]){seen[r]=true;rows.push(r);}});
  if(!rows.length){
    var maxRows=Math.max((c.display||[]).length,(c.raw||[]).length);
    for(var i=1;i<maxRows;i++)rows.push(i);
  }
  var priced=0;
  rows.forEach(function(r){
    var raw=c.raw&&c.raw[r]?c.raw[r][col]:'';
    var disp=c.display&&c.display[r]?c.display[r][col]:'';
    var p=ceParsePriceForVillaV59_(raw,villa,optionLabel);
    if(p===null)p=ceParsePriceForVillaV59_(disp,villa,optionLabel);
    if(p!==null)priced++;
  });
  var result=priced>=3&&priced>=Math.ceil(rows.length*0.2);
  c.priceColumnCacheB6[key]=result;
  return result;
}

function ceReadCalendarCellStateV34_(c,row,col,rawConfig,villa,optionLabel){
  var raw=c.raw[row][col];
  var display=c.display[row][col];
  var baseBg=String(c.backgrounds[row][col]||'').toLowerCase();
  var visualBgV52=ceVisualBackgroundV52_(c,row,col,baseBg);
  var bg=String(visualBgV52.background||baseBg||'').toLowerCase();
  var note=(c.notes&&c.notes[row]?c.notes[row][col]:'')||'';
  var price=ceParsePriceForVillaV59_(raw,villa,optionLabel);
  if(price===null)price=ceParsePriceForVillaV59_(display,villa,optionLabel);

  var cfg=parseBookingSourceConfig(rawConfig||'AUTO');

  /*
   * Quy tắc đã chốt:
   * - nền trắng = trống;
   * - màu khai báo rõ trong FREE_COLORS/MAU_TRONG = trống;
   * - tất cả màu khác = bận.
   */
  if(ceIsWhiteV34_(bg)){
    // B6: cột thường ghi giá mà ô trắng này không có giá => CHƯA RÕ, không mặc định TRỐNG.
    if(price===null&&ceWhiteNoPriceIsUnknownB6_(c,col,rawConfig,villa,optionLabel)){
      return ceWhiteNoPriceStateB6_(bg,display,note,'Nền trắng');
    }
    return {status:'FREE',available:true,price:price,reason:'Nền trắng',background:bg,display:String(display||''),note:String(note||'')};
  }

  var freeColors=ceParseColorListV34_(
    beConfigValue_(cfg,['FREE_COLORS','MAU_TRONG','AVAILABLE_COLORS'],'')||''
  );
  var freeColorGroups=ceParseColorListV34_(
    beConfigValue_(cfg,['FREE_COLOR_GROUPS','NHOM_MAU_TRONG','AVAILABLE_COLOR_GROUPS'],'')||''
  );
  var configuredFreeColors=freeColors.concat(freeColorGroups);

  if(configuredFreeColors.some(function(name){
    return ceColorMatchesFreeV41_(bg,name);
  })){
    if(price===null&&ceWhiteNoPriceIsUnknownB6_(c,col,rawConfig,villa,optionLabel)){
      return ceWhiteNoPriceStateB6_(bg,display,note,'Màu trống theo CONFIG');
    }
    return {status:'FREE',available:true,price:price,reason:'Màu trống theo CONFIG',background:bg,display:String(display||''),note:String(note||'')};
  }

  return {
    status:'BUSY',
    available:false,
    price:null,
    reason:
      'Ô có màu '+bg+
      (visualBgV52&&visualBgV52.merged
        ? ' | vùng merge neo tại '+
          ceColumnToLetterV33_(visualBgV52.anchorColumn+1)+
          (visualBgV52.anchorRow+1)
        : '')+
      (display?' | '+String(display):''),
    background:bg,
    display:String(display||''),
    note:String(note||'')
  };
}


/*
 * V4.2 - Bộ nhóm màu dùng cho CONFIG LỊCH.
 *
 * Quy tắc mặc định:
 *   1. Nền trắng luôn TRỐNG, không xét màu chữ hay nội dung chữ.
 *   2. Nhóm/mã màu được khai báo FREE sẽ TRỐNG.
 *   3. Đỏ chuẩn và toàn bộ màu còn lại mặc định BẬN.
 *
 * Vì FREE được xét trước, nguồn đặc biệt có thể tháo quy tắc đỏ:
 *   AUTO;FREE_COLOR_GROUPS=DO
 *
 * Nhóm hỗ trợ:
 *   TRANG, XAM, CAM, VANG, DO, HONG, TIM,
 *   XANH_LA, XANH_DUONG
 */
function ceColorMatchesFreeV42_(hex,name){
  name=ceNormalize_(name)
    .replace(/[^a-z0-9#]+/g,'_')
    .replace(/^_+|_+$/g,'');

  if(name.indexOf('#')===0){
    return String(hex||'').toLowerCase()===name.toLowerCase();
  }

  if(name==='trang'||name==='white')return ceIsWhiteV34_(hex);
  if(name==='xam'||name==='gray'||name==='grey')return ceIsGrayFamilyV42_(hex);
  if(name==='cam'||name==='orange')return ceIsOrangeFamilyV42_(hex);
  if(name==='vang'||name==='yellow')return ceIsYellowFamilyV42_(hex);
  if(name==='do'||name==='red')return ceIsRedFamilyV42_(hex);
  if(name==='hong'||name==='pink')return ceIsPinkFamilyV42_(hex);
  if(name==='tim'||name==='purple'||name==='violet')return ceIsPurpleFamilyV42_(hex);
  if(name==='xanh_la'||name==='xanhla'||name==='green')return ceIsGreenFamilyV42_(hex);
  if(name==='xanh_duong'||name==='xanhduong'||name==='blue')return ceIsBlueFamilyV42_(hex);

  // Giữ tương thích config cũ ghi "xanh" = xanh lá.
  if(name==='xanh')return ceIsGreenFamilyV42_(hex);
  return false;
}

function ceRgbToHslV42_(rgb){
  if(!rgb)return null;
  var r=rgb[0]/255,g=rgb[1]/255,b=rgb[2]/255;
  var max=Math.max(r,g,b),min=Math.min(r,g,b);
  var h=0,s=0,l=(max+min)/2;
  var d=max-min;
  if(d!==0){
    s=l>0.5?d/(2-max-min):d/(max+min);
    switch(max){
      case r:h=(g-b)/d+(g<b?6:0);break;
      case g:h=(b-r)/d+2;break;
      default:h=(r-g)/d+4;
    }
    h*=60;
  }
  return {h:h,s:s,l:l};
}

function ceColorHslV42_(hex){
  return ceRgbToHslV42_(ceHexRgbV34_(hex));
}

function ceIsGrayFamilyV42_(hex){
  var hsl=ceColorHslV42_(hex);
  if(!hsl)return false;
  // Nhiều tông xám từ đậm tới nhạt; trắng tinh xử lý riêng.
  return hsl.s<=0.14&&hsl.l>=0.16&&hsl.l<0.985;
}

function ceIsOrangeFamilyV42_(hex){
  var hsl=ceColorHslV42_(hex);
  if(!hsl)return false;
  // Cam/cam đào/be cam; không kéo đỏ hoặc hồng vào.
  return hsl.h>=18&&hsl.h<=48&&hsl.s>=0.16&&hsl.l>=0.32&&hsl.l<=0.97;
}

function ceIsYellowFamilyV42_(hex){
  var hsl=ceColorHslV42_(hex);
  if(!hsl)return false;
  return hsl.h>48&&hsl.h<=70&&hsl.s>=0.18&&hsl.l>=0.35&&hsl.l<=0.97;
}

function ceIsRedFamilyV42_(hex){
  var hsl=ceColorHslV42_(hex);
  if(!hsl)return false;
  /*
   * Dải đỏ cố ý hẹp: chỉ quanh các tone đỏ thường dùng để báo bận.
   * Không nhận hồng nhạt/cuối tuần làm đỏ.
   */
  var redHue=hsl.h<=10||hsl.h>=350;
  return redHue&&hsl.s>=0.48&&hsl.l>=0.24&&hsl.l<=0.72;
}

function ceIsPinkFamilyV42_(hex){
  var hsl=ceColorHslV42_(hex);
  if(!hsl)return false;
  // Hồng tách riêng khỏi đỏ để tránh lẫn màu cuối tuần.
  return hsl.h>=325&&hsl.h<350&&hsl.s>=0.18&&hsl.l>=0.48&&hsl.l<=0.96;
}

function ceIsPurpleFamilyV42_(hex){
  var hsl=ceColorHslV42_(hex);
  if(!hsl)return false;
  return hsl.h>=255&&hsl.h<325&&hsl.s>=0.16&&hsl.l>=0.28&&hsl.l<=0.94;
}

function ceIsGreenFamilyV42_(hex){
  var hsl=ceColorHslV42_(hex);
  if(!hsl)return false;
  return hsl.h>=75&&hsl.h<=165&&hsl.s>=0.14&&hsl.l>=0.22&&hsl.l<=0.94;
}

function ceIsBlueFamilyV42_(hex){
  var hsl=ceColorHslV42_(hex);
  if(!hsl)return false;
  return hsl.h>165&&hsl.h<255&&hsl.s>=0.14&&hsl.l>=0.22&&hsl.l<=0.94;
}

// Alias giữ tương thích với bản V4.1 đã gửi trước.
function ceColorMatchesFreeV41_(hex,name){return ceColorMatchesFreeV42_(hex,name);}
function ceIsWhiteV34_(h){return !h||h==='#ffffff'||h==='#fff'||h==='white';}
function ceHexRgbV34_(h){var m=String(h||'').match(/^#?([0-9a-f]{6})$/i);if(!m)return null;return [parseInt(m[1].slice(0,2),16),parseInt(m[1].slice(2,4),16),parseInt(m[1].slice(4,6),16)];}
function ceHueBusyV34_(h){var x=ceHexRgbV34_(h);if(!x)return false;var r=x[0],g=x[1],b=x[2];return (r>180&&g<190&&b<190)||(r>180&&b>150&&g<120)||(r>190&&g>120&&g<230&&b<120);}
function ceParseColorListV34_(v){return String(v||'').split(/[,|]+/).map(function(x){return ceNormalize_(x);}).filter(Boolean);}
function ceBuildSourceLinkV34_(file,gid,col,row){return 'https://docs.google.com/spreadsheets/d/'+file.getId()+'/edit#gid='+gid+'&range='+ceColumnToLetterV33_(col+1)+(row+1);}
function ceColumnToLetterV33_(n){var s='';while(n>0){var r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26);}return s;}


function testInlineMonthMarkerCalendarV4223(){
  var display = [
    [""],
    ["tháng 9"],
    ["1"],
    ["2"],
    ["3"],
    ["4"],
    ["5"],
    ["24"],
    ["25"]
  ];
  var raw = display.map(function(row){ return row.slice(); });
  var readConfig = {dateColumn:-1,dateRows:[],dateOrder:"AUTO"};
  var detected = ceDetectDateColumnV1_(raw, display, "CHẠNG VẠNG", new Date(2026,8,24), readConfig);
  if (detected !== 0) throw new Error("V4223_INLINE_MONTH_DATE_COLUMN_FAILED:" + detected);

  var context = {
    name:"CHẠNG VẠNG",
    raw:raw,
    display:display,
    dateColumn:0,
    dateRows:{},
    dateConfigV50:readConfig,
    dateReferenceYearV4223:2026
  };
  var index = ceBuildCalendarDateIndexV50_(context);
  if (Number(index["2026-09-24"]) !== 7 || Number(index["2026-09-25"]) !== 8) {
    throw new Error("V4223_INLINE_MONTH_INDEX_FAILED:" + JSON.stringify(index));
  }
  var result = {success:true,version:"4.22.3",dateColumn:detected,row24:index["2026-09-24"]+1,row25:index["2026-09-25"]+1};
  Logger.log(JSON.stringify({code:"INLINE_MONTH_CALENDAR_PASS_V4223",result:result}));
  return result;
}

function testNhaChangVangCalendarLiveV4223(){
  if (typeof opsFindSourceV312_ !== "function") throw new Error("OPS_SOURCE_HELPER_NOT_AVAILABLE");
  if (typeof beMasterCalendarSelectionV4210_ !== "function") throw new Error("MASTER_CALENDAR_SELECTOR_NOT_AVAILABLE");
  var source = opsFindSourceV312_("nhà chạng vạng");
  if (!source || !source.link) throw new Error("CHANG_VANG_SOURCE_NOT_FOUND");
  var file = SpreadsheetApp.openByUrl(source.link);
  var target = new Date(2026,10,15);
  var selected = beMasterCalendarSelectionV4210_(file, source.configCalendar || "AUTO", target);
  if (!selected.sheet || normalizeMasterText(selected.sheet.getName()) !== normalizeMasterText("CHẠNG VẠNG")) {
    throw new Error("CHANG_VANG_LIVE_SHEET_FAILED:" + (selected.sheet ? selected.sheet.getName() : ""));
  }
  var sourceContext = ceCreateSourceContextV30_(file, {requiresFullScan:true,maxColumn:15});
  var ctx = ceLoadCalendarSheetV34_(sourceContext, selected.sheet, target, source.configCalendar || "AUTO", 2);
  var row = ceFindCalendarDateRowV34_(ctx, target);
  if (row < 0) throw new Error("CHANG_VANG_LIVE_DATE_NOT_FOUND");
  var result = {success:true,version:"4.22.3",sheet:selected.sheet.getName(),mode:selected.mode,dateColumn:ctx.dateColumn+1,dateRow:row+1};
  Logger.log(JSON.stringify({code:"CHANG_VANG_CALENDAR_LIVE_PASS_V4223",result:result}));
  return result;
}

/**
 * V5.8 regression - sheet month/year phải thắng continuity sai.
 * File: CalendarReader.js
 * Run trực tiếp trong Apps Script: testCalendarSheetMonthAnchorV58
 */
function testCalendarSheetMonthAnchorV58() {
  function key_(d) { return d ? ceDateKey_(d) : ""; }
  function assertKey_(label, actual, expected) {
    var actualKey = key_(actual);
    if (actualKey !== expected) {
      throw new Error(label + " expected=" + expected + " actual=" + actualKey);
    }
  }

  var poisonedPrevious = new Date(2025, 1, 8); // 08/02/2025 - cố tình sai context.

  assertKey_(
    "DM 2/9 anchored to September 2026",
    ceParseCalendarDateCellV50_("2/9", "2/9", 9, 2026, poisonedPrevious, "AUTO"),
    "2026-09-02"
  );

  assertKey_(
    "Ambiguous 9/2 anchored to September 2026",
    ceParseCalendarDateCellV50_("9/2", "9/2", 9, 2026, poisonedPrevious, "AUTO"),
    "2026-09-02"
  );

  assertKey_(
    "Single day anchored to September 2026",
    ceParseCalendarDateCellV50_(22, "22", 9, 2026, poisonedPrevious, "AUTO"),
    "2026-09-22"
  );

  assertKey_(
    "Explicit DD/MM keeps sheet year",
    ceParseCalendarDateCellV50_("10/9", "10/9", 9, 2026, poisonedPrevious, "AUTO"),
    "2026-09-10"
  );

  Logger.log(JSON.stringify({
    code: "CALENDAR_SHEET_MONTH_ANCHOR_PASS_V58",
    version: "5.8-sheet-month-year-anchor",
    cases: 4
  }));

  return true;
}

/**
 * V5.8 regression - raw Date có năm cũ nhưng đúng tháng sheet phải lấy năm sheet.
 * File: CalendarReader.js
 * Run trực tiếp: testCalendarRawYearAnchorV58
 */
function testCalendarRawYearAnchorV58() {
  var parsed = ceParseCalendarDateCellV50_(
    new Date(2025, 8, 22),
    "", // ép đi qua raw Date fallback
    9,
    2026,
    null,
    "AUTO"
  );

  var key = parsed ? ceDateKey_(parsed) : "";
  if (key !== "2026-09-22") {
    throw new Error("RAW_YEAR_ANCHOR expected=2026-09-22 actual=" + key);
  }

  Logger.log(JSON.stringify({
    code: "CALENDAR_RAW_YEAR_ANCHOR_PASS_V58",
    version: "5.8-sheet-month-year-anchor",
    date: key
  }));

  return true;
}

function ceRoomCountV1_(text){
  var m = String(text || "").toLowerCase().match(/(\d+)\s*(?:phong|phòng|pn)/);
  return m ? Number(m[1]) : 0;
}

function ceSavedColumnContradictsNameV1_(villaName, savedEvidence){
  if (savedEvidence && Number(savedEvidence.score) < 0) return true;
  var roomsTarget = ceRoomCountV1_(villaName);
  var roomsLabel = ceRoomCountV1_(savedEvidence && savedEvidence.label || "");
  return roomsTarget > 0 && roomsLabel > 0 && roomsTarget !== roomsLabel;
}