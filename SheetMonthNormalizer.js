/**
 * EHOME BOOKING - CHUAN HOA TEN TAB THANG (V2, FIX6)
 *
 * Muc dich: nhan ra thang (va nam neu co) trong ten tab du chu viet sai / viet nhieu kieu:
 *   "Thang.10", "Thang-10", "Thang_10", "Thang10", "THANG  10", "Thg 10", "Month 10",
 *   "T.10", "T-10", "Thang muoi", "Thang muoi mot", "Thang muoi hai", "Thang mot".."Thang chin",
 *   "Thang gieng", "Thang chap", "Thang XI", "T.XII", "10.2026", "10_2026",
 *   Go sai nam:  "11/026", "11/206", "11/20266", "11-26", "11.26", "11/'26"
 *   Nam dung truoc: "2026-11", "2026/11", "2026.11"
 *   Ten thang tieng Anh: "Nov", "November", "Nov 2026", "Nov-26", "Sept", "Dec"
 *   Go sai chu: "Thag 11", "Thnag 11", "Tahng 11", "Thang 1O" (chu O thay so 0), "11/2O26"
 *   Ky tu full-width: "11／2026"
 *
 * Ham ceNormalizeMonthSheetTextV1_ tra ve CHUOI da chuan hoa (khong dau, thuong) co dang
 * "thang N" hoac "thang N 20YY" de cac bo doc ten tab hien co (Utils.ceExtractMonthFromSheetName_,
 * MasterEngine.beCalendarSheetDescriptorV4210_) nhan ra thang nhu binh thuong.
 * KHONG doi gi neu ten da dung dang cu.
 * KHONG dung cho tab gop nhieu thang ("T6 + 7 + 8") - tab nay van xu ly o noi khac.
 * Bo chuan hoa KHONG tu doan nam khi hai so deu nho ("11/10", "10.11"): nam chi duoc doan khi la 2026, 026, 206, 20266 hoac 24..35.
 */
function ceNormalizeMonthSheetTextV1_(text) {
  var s = String(text == null ? "" : text);
  try { s = s.normalize("NFKC"); } catch (ignoreNfkc) {}
  s = s.toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d");

  // Tab gop nhieu thang ("t6 + 7 + 8"): giu nguyen de noi khac xu ly.
  if (s.indexOf("+") >= 0) return s.replace(/\s+/g, " ").trim();

  // Chu O go nham thay so 0 khi dinh vao so: "1o" -> "10", "2o26" -> "2026", " o9" -> " 09"
  s = s.replace(/(\d)o/g, "$10").replace(/(^|[^a-z])o(\d)/g, "$10$2").replace(/(\d)o/g, "$10");
  // Dau nhay nam: "11/'26" -> "11/26"
  s = s.replace(/['`’]\s*(\d{2})(?!\d)/g, "$1");

  // Go sai chu "thang"
  s = s.replace(/(^|[^a-z])(?:thag|thnag|tahng|thnga|thagn|thang|tang|thag)(?![a-z])/g, "$1thang");

  var words = [
    [/(^|[^a-z])(thang|thg|month)[\s._\-:,]*muoi[\s._\-]*hai(?![a-z])/g, "$1thang 12"],
    [/(^|[^a-z])(thang|thg|month)[\s._\-:,]*muoi[\s._\-]*mot(?![a-z])/g, "$1thang 11"],
    [/(^|[^a-z])(thang|thg|month)[\s._\-:,]*muoi(?![a-z])/g, "$1thang 10"],
    [/(^|[^a-z])(thang|thg|month)[\s._\-:,]*(?:mot|gieng)(?![a-z])/g, "$1thang 1"],
    [/(^|[^a-z])(thang|thg|month)[\s._\-:,]*hai(?![a-z])/g, "$1thang 2"],
    [/(^|[^a-z])(thang|thg|month)[\s._\-:,]*ba(?![a-z])/g, "$1thang 3"],
    [/(^|[^a-z])(thang|thg|month)[\s._\-:,]*(?:tu|bon)(?![a-z])/g, "$1thang 4"],
    [/(^|[^a-z])(thang|thg|month)[\s._\-:,]*nam(?![a-z])/g, "$1thang 5"],
    [/(^|[^a-z])(thang|thg|month)[\s._\-:,]*sau(?![a-z])/g, "$1thang 6"],
    [/(^|[^a-z])(thang|thg|month)[\s._\-:,]*bay(?![a-z])/g, "$1thang 7"],
    [/(^|[^a-z])(thang|thg|month)[\s._\-:,]*tam(?![a-z])/g, "$1thang 8"],
    [/(^|[^a-z])(thang|thg|month)[\s._\-:,]*chin(?![a-z])/g, "$1thang 9"],
    [/(^|[^a-z])(thang|thg|month)[\s._\-:,]*chap(?![a-z])/g, "$1thang 12"]
  ];
  words.forEach(function (w) { s = s.replace(w[0], w[1]); });

  // So La Ma sau "thang/thg/month/t": "thang xi", "t.xii"
  var romans = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };
  s = s.replace(/(^|[^a-z])(?:thang|thg|month)[\s._\-:,]*(xii|xi|x|ix|viii|vii|vi|iv|v|iii|ii|i)(?![a-z0-9])/g,
    function (all, pre, r) { return pre + "thang " + romans[r]; });
  s = s.replace(/(^|[^a-z])t[._\-]?\s*(xii|xi|x|ix|viii|vii|vi|iv|v|iii|ii|i)(?![a-z0-9])/g,
    function (all, pre, r) { return pre + "thang " + romans[r]; });
  // La Ma + nam: "xi/2026", "xi-26"
  s = s.replace(/(^|[^a-z])(xii|xi|x|ix|viii|vii|vi|iv|v|iii|ii|i)\s*[\/._\-]\s*(20\d{2}|\d{2})(?!\d)/g,
    function (all, pre, r, y) { return pre + "thang " + romans[r] + " " + (y.length === 2 ? "20" + y : y); });

  // Ten thang tieng Anh (nguyen tu): nov, november, dec ...
  var eng = [
    [/(?:january|jan)/, 1], [/(?:february|feb)/, 2], [/(?:march|mar)/, 3], [/(?:april|apr)/, 4],
    [/may/, 5], [/(?:june|jun)/, 6], [/(?:july|jul)/, 7], [/(?:august|aug)/, 8],
    [/(?:september|sept|sep)/, 9], [/(?:october|oct)/, 10], [/(?:november|nov)/, 11], [/(?:december|dec)/, 12]
  ];
  eng.forEach(function (e) {
    var re = new RegExp("(^|[^a-z])" + e[0].source + "(?![a-z])", "g");
    s = s.replace(re, "$1thang " + e[1]);
  });

  // B5: "th 11", "th.11", "th01" (viết tắt "Tháng" của nhiều nguồn) => "thang 11"
  s = s.replace(/(^|[^a-z])th[\s._\-:,]*0?(1[0-2]|[1-9])(?!\d)/g, "$1thang $2");
  // "thang.10", "thang_10", "thang-10", "thang10", "thg 10", "month 10" => "thang 10"
  s = s.replace(/(^|[^a-z])(thang|thg|month)[\s._\-:,]*0?(1[0-2]|[1-9])(?!\d)/g, "$1thang $3");
  // "t.10", "t-10", "t_10" (chu T don le + dau ngan) => "thang 10"
  s = s.replace(/(^|[^a-z])t[._\-]\s*0?(1[0-2]|[1-9])(?!\d)/g, "$1thang $2");

  // Nam dung truoc: "2026-11", "2026/11", "2026.11" (khong phai ngay day du 2026/11/05)
  s = s.replace(/(^|[^0-9])(20\d{2})\s*[\/._\-]\s*(0?[1-9]|1[0-2])(?![0-9]|\s*[\/._\-]\s*\d)/g,
    function (all, pre, y, m) { return pre + "thang " + Number(m) + " " + y; });

  // Thang + nam so: "11/2026", "11/026", "11/206", "11/20266", "11-26", "11.26"
  s = s.replace(/(^|[^0-9a-z])(?:thang\s*)?(0?[1-9]|1[0-2])\s*[\/._\-]\s*(\d{2,5})(?![0-9])/g, function (all, pre, m, y) {
    var year = ceYearFromDigitsV1_(y);
    if (!year) return all;
    return pre + "thang " + Number(m) + " " + year;
  });

  return s.replace(/\s+/g, " ").trim();
}

/**
 * Doc nam tu chuoi so di sau "thang/": tra 0 neu khong chac, de khong nhan nham ngay/thang.
 *   "2026"->2026, "026"->2026, "206"->2026, "20266"->2026, "26"->2026 (24..35), "10"/"11"/"05" -> 0 (la ngay/thang)
 */
function ceYearFromDigitsV1_(d) {
  d = String(d || "");
  var n;
  if (d.length === 4 && d.indexOf("20") === 0) return Number(d);
  if (d.length === 2) { n = Number(d); return (n >= 24 && n <= 35) ? 2000 + n : 0; }
  if (d.length === 3) {
    if (d.charAt(0) === "0") { n = Number(d.slice(1)); return (n >= 24 && n <= 35) ? 2000 + n : 0; }   // 026
    if (d.indexOf("20") === 0) { n = Number(d.charAt(2)); return (n >= 4 && n <= 9) ? 2020 + n : 0; }  // 206 -> 2026 (thieu so 2)
    return 0;
  }
  if (d.length === 5 && d.indexOf("20") === 0) {                                                       // 20266 (go thua)
    n = Number(d.slice(2, 4));
    return (n >= 24 && n <= 35) ? 2000 + n : 0;
  }
  return 0;
}

/** Thang (1..12) doc duoc tu ten tab, 0 neu khong nhan ra. Dung de test. */
function ceMonthFromSheetNameV1_(name) {
  var s = ceNormalizeMonthSheetTextV1_(name);
  var m = s.match(/(?:^|\b)(?:thang|month|t)\s*0?(1[0-2]|[1-9])(?:\b|\D)/i);
  if (m) return Number(m[1]);
  m = s.match(/(?:^|\D)0?(1[0-2]|[1-9])\s*[\.\/_-]\s*(?:20)?\d{2,4}(?:\D|$)/i);
  return m ? Number(m[1]) : 0;
}

/** Nam (20xx) doc duoc tu ten tab da chuan hoa, 0 neu khong co. */
function ceYearFromSheetNameV1_(name) {
  var s = ceNormalizeMonthSheetTextV1_(name);
  var m = s.match(/thang\s*\d{1,2}\s+(20\d{2})(?!\d)/);
  if (!m) m = s.match(/(?:^|[^0-9])(20\d{2})(?![0-9])/);
  return m ? Number(m[1]) : 0;
}

/** Dang [chuoi, nam] giong ket qua String.match, hoac null. Cho Utils.ceExtractYearFromSheetName_. */
function ceYearMatchV1_(name) {
  var y = ceYearFromSheetNameV1_(name);
  return y ? [String(y), String(y)] : null;
}

/** Chay trong Apps Script de kiem tra: ket qua phai la PASS. */
function testSheetMonthNormalizerV1() {
  var cases = [
    // --- 35 truong hop cu ---
    ["Tháng.10", 10], ["Tháng-10", 10], ["Tháng_10", 10], ["Tháng10", 10], ["THÁNG  10", 10],
    ["Tháng 10", 10], ["Tháng 10.", 10], ["Thg 10", 10], ["Month 10", 10], ["T.10", 10], ["T-10", 10],
    ["T10-2026", 10], ["T10/26", 10], ["Tháng 11", 11], ["Tháng.11", 11], ["Tháng 12", 12],
    ["Tháng mười", 10], ["Tháng mười một", 11], ["Tháng mười hai", 12], ["Tháng một", 1], ["Tháng chín", 9],
    ["Tháng 9", 9], ["Tháng 09", 9], ["Tháng.9", 9], ["Tháng 1", 1], ["Thang 6 hè", 6],
    ["10/2026", 10], ["10.2026", 10], ["10_2026", 10], ["Booking 10/2026", 10], ["Tháng 10-2026", 10],
    ["Trang tính1", 0], ["THÔNG TIN", 0], ["Sheet16", 0], ["Tháng 13", 0],
    // --- go sai nam (loi thuc te: 11/026) ---
    ["11/026", 11], ["11/206", 11], ["11/20266", 11], ["11-26", 11], ["11.26", 11], ["12/027", 12], ["1/027", 1],
    ["01/027", 1], ["10/026", 10], ["11 / 026", 11], ["11/'26", 11], ["11／2026", 11],
    // --- nam dung truoc ---
    ["2026-11", 11], ["2026/11", 11], ["2026.12", 12], ["2027-01", 1],
    // --- go sai chu ---
    ["Thag 11", 11], ["Thnag 11", 11], ["Tahng 11", 11], ["Tang 11", 11], ["Thang 1O", 10], ["11/2O26", 11], ["Thángg 11", 0],
    // --- thang bang chu / La Ma / ten tieng Anh ---
    ["Tháng giêng", 1], ["Tháng chạp", 12], ["Tháng XI", 11], ["T.XII", 12], ["Tháng X", 10], ["Tháng IX", 9], ["XI/2026", 11],
    ["Nov", 11], ["November", 11], ["Nov 2026", 11], ["Nov-26", 11], ["Dec", 12], ["December 2026", 12],
    ["Sept", 9], ["Oct", 10], ["January", 1], ["Feb", 2],
    // --- cac kieu hay gap khac ---
    ["Tháng 11 (mới)", 11], ["Bản sao của Tháng 11", 11], ["LỊCH THÁNG 11", 11], ["Lịch T11", 11], ["Tháng 11 - 2026", 11],
    ["Tháng 11/2026", 11], ["Tháng 11.2026", 11], ["Tháng 11 năm 2026", 11], ["THÁNG 12/2026", 12], ["Tháng 1/2027", 1],
    ["Tháng 01-2027", 1], ["Tháng 2 2027", 2], ["T.11/2026", 11], ["T-12-2026", 12], ["Tháng .11", 11], ["Tháng:11", 11],
    // --- khong duoc nhan nham (ngay/thang, thu) ---
    ["31/10", 0], ["Th 2", 0], ["Thứ 5", 0], ["Villa 11", 0], ["Căn 12", 0], ["Informations", 0],
    ["2026", 0], ["Bảng giá 2026", 0], ["Sheet1", 0], ["Phòng 10", 0]
  ];
  var failed = [];
  cases.forEach(function (c) {
    var got = ceMonthFromSheetNameV1_(c[0]);
    if (got !== c[1]) failed.push({ name: c[0], expected: c[1], got: got });
  });
  var yearCases = [["11/026", 2026], ["11/206", 2026], ["12/027", 2027], ["11/2026", 2026], ["11-26", 2026], ["2027-01", 2027], ["Nov 2026", 2026], ["Tháng 11", 0], ["31/10", 0]];
  yearCases.forEach(function (c) {
    var got = ceYearFromSheetNameV1_(c[0]);
    if (got !== c[1]) failed.push({ name: c[0] + " (nam)", expected: c[1], got: got });
  });
  var result = { code: failed.length ? "FAIL" : "PASS", total: cases.length + yearCases.length, failed: failed };
  Logger.log(JSON.stringify(result));
  return result;
}
