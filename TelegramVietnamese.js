/**
 * EHOME BOOKING - TELEGRAM TIENG VIET THUONG (V1, FIX6)
 *
 * Chi DICH chu cho tin nhan Telegram. Khong doi cach he thong phat hien loi, khong ghi du lieu,
 * khong dong vao Booking Engine / MASTER / villa_id / gia / lich.
 *
 * Moi tin tra loi 3 cau: CHUYEN GI xay ra - NGUON NAO - ANH CAN LAM GI.
 * Neu ham nay loi hay gap ma chua biet, noi goi se tu dung lai tin cu (an toan).
 *
 * Duoc goi tu:
 *   - AiHealthWatch.js: opsHealthAlertTextV315_  -> tgViAlertTextV1_(decision, current)
 *   - TelegramBot.js:   tgAiProposalTextV4221_   -> tgViAiProposalTextV1_(result, p, validation, changed, corrections)
 * Xem thu khong ghi gi: previewTelegramVietnameseV1() (chi hien trong Nhat ky), sendTelegramVietnameseSampleV1() (gui 2 tin mau vao Telegram admin).
 */

// level: "act" = can lam som, "watch" = xem sau / thuong tu het
var TG_VI_CODES_V1 = {
  MASTER_PENDING_SYNC: ["watch", "đang chờ cập nhật danh sách căn từ file nguồn", "Thường tự hết sau lượt đồng bộ kế tiếp (khoảng 1 giờ). Còn báo sau 1 giờ thì báo admin."],
  CONFIG_WARNING: ["watch", "cách đọc file nguồn có điểm cần xem lại", "Gõ /source <tên nguồn> để xem điểm nào."],
  CONFIG_ERROR: ["act", "cách đọc file nguồn bị lỗi, hệ thống có thể đọc sai căn hoặc sai lịch", "Báo admin kiểm tra nguồn này."],
  STRUCTURE_ERROR: ["act", "cấu trúc file nguồn đổi hoặc không đọc được (tab tháng, cột căn)", "Mở file nguồn xem tab tháng và cột căn, rồi báo admin."],
  STRUCTURE_WARNING: ["watch", "cấu trúc file nguồn có điểm lạ", "Gõ /source <tên nguồn> để xem chi tiết."],
  DUPLICATE_SOURCE_ALIAS: ["watch", "có hai dòng MASTER trùng tên hoặc gần giống nhau", "Kiểm tra trong MASTER xem có dòng nguồn thừa không."],
  SOURCE_ZERO_VILLAS: ["act", "nguồn này đọc ra 0 căn", "Kiểm tra file và cấu hình. Nếu nguồn không còn bán thì tắt nguồn."],
  SOURCE_LINK_MISSING: ["act", "chưa có link file lịch", "Điền link file lịch vào MASTER."],
  SOURCE_LINK_UNRESOLVED: ["act", "link file lịch không mở được", "Kiểm tra link và quyền xem file."],
  ERROR: ["act", "nguồn đang lỗi, không đọc được", "Gõ /source <tên nguồn> để xem lỗi cụ thể."],
  IMAGE_COVERAGE_NOT_FULL: ["watch", "còn căn chưa có ảnh", "Không gấp. Hệ thống tự bổ sung ảnh dần."],
  IMAGE_ISSUES: ["watch", "có ảnh lỗi hoặc thiếu", "Không gấp. Gõ /health xem số lượng."],
  "IMAGE:MISSING": ["watch", "có căn thiếu ảnh", "Không gấp. Hệ thống tự bổ sung ảnh dần."],
  "IMAGE:ERROR": ["watch", "có ảnh bị lỗi", "Gõ /health xem số lượng."],
  "IMAGE:BROKEN": ["watch", "có ảnh bị hỏng link", "Gõ /health xem số lượng."],
  "AUTOSYNC:TRIGGER_COUNT_NOT_1": ["act", "bộ hẹn giờ tự đồng bộ bất thường (phải có đúng 1)", "Báo admin kiểm tra bộ hẹn giờ."],
  SNAPSHOT_TRIGGER_COUNT: ["act", "bộ hẹn giờ chụp lịch bất thường (phải có đúng 1)", "Báo admin kiểm tra bộ hẹn giờ."],
  AUTO_SYNC_TRIGGER_COUNT: ["act", "bộ hẹn giờ tự đồng bộ bất thường (phải có đúng 1)", "Báo admin kiểm tra bộ hẹn giờ."],
  STRUCTURE_SNAPSHOT_ERRORS: ["watch", "nguồn bị lỗi khi chụp cấu trúc file", "Gõ /health để xem là nguồn nào."]
};

// Canh bao / loi cua AI soi cau hinh (AiConfigValidator.js)
var TG_VI_AI_CODES_V1 = {
  CURRENT_MASTER_ZERO_HIGH_RISK: "lúc AI xem, nguồn này đang ghi 0 căn trong MASTER (nếu vừa đồng bộ lại thì cảnh báo này đã cũ)",
  NO_CONFIG_CHANGE: "AI không đề xuất đổi cấu hình",
  DANGEROUS_VILLA_DROP: "AI muốn bỏ nhiều căn một lúc, rất nguy hiểm",
  EXPECTED_VILLA_COUNT_MISMATCH: "số căn đọc ra không khớp số căn dự kiến",
  SIMULATION_FAILED: "chạy thử cấu hình mới không thành công",
  SIMULATION_ZERO_VILLAS: "chạy thử cấu hình mới ra 0 căn",
  MASTER_EMPTY: "MASTER đang trống",
  CALENDAR_EMPTY: "không thấy dữ liệu lịch trong file",
  IMAGE_EMPTY: "không thấy ảnh",
  INFO_EMPTY: "không thấy thông tin mô tả",
  LOW_VILLA_CONFIDENCE: "AI chưa chắc về tên căn",
  PRODUCT_TYPE_UNSUPPORTED: "loại sản phẩm này hệ thống chưa hỗ trợ",
  SOURCE_NOT_FOUND: "không tìm thấy nguồn này",
  VILLA_CORRECTION_TARGET_NOT_FOUND: "không tìm thấy căn mà AI muốn sửa",
  VILLA_EVIDENCE_EMPTY: "AI không có bằng chứng cho phần sửa căn",
  EMPTY_VILLA_CORRECTION: "AI đề xuất sửa căn nhưng nội dung trống",
  BEDROOMS_OUT_OF_RANGE: "số phòng ngủ AI đề xuất bất thường",
  CAPACITY_STANDARD_OUT_OF_RANGE: "số khách tiêu chuẩn AI đề xuất bất thường",
  CAPACITY_MAX_OUT_OF_RANGE: "số khách tối đa AI đề xuất bất thường",
  CAPACITY_MAX_LT_STANDARD: "số khách tối đa nhỏ hơn số khách tiêu chuẩn",
  BEDROOMS_CHANGED_SINCE_PROPOSAL: "số phòng ngủ đã bị đổi từ lúc AI đề xuất",
  CAPACITY_CHANGED_SINCE_PROPOSAL: "số khách đã bị đổi từ lúc AI đề xuất"
};

var TG_VI_STATUS_V1 = {
  READY_FOR_APPROVAL: "sẵn sàng để anh duyệt",
  NEEDS_REVIEW: "cần xem kỹ trước khi duyệt",
  BLOCKED: "bị chặn, chưa đủ điều kiện duyệt",
  APPLIED: "đã áp dụng",
  IGNORED: "đã bỏ qua"
};

var TG_VI_PRODUCT_V1 = { NGUYEN_CAN: "nguyên căn", PHONG_LE: "phòng lẻ", MIXED: "nguyên căn và phòng lẻ" };

function tgViTitleCaseV1_(text) {
  return String(text || "").toLowerCase().replace(/(^|\s)(\S)/g, function (m, a, b) { return a + b.toUpperCase(); });
}

/** Tach 1 chuoi issue cua Health Watch thanh {scope, source, level, code, num}. */
function tgViParseIssueV1_(issue) {
  var raw = String(issue || "").trim();
  var parts = raw.split(":");
  var out = { raw: raw, scope: "", source: "", level: "", code: "", num: 0 };
  var head = parts[0];
  if (head === "CONFIG" && parts.length >= 4) {
    out.scope = "CONFIG"; out.source = parts[1]; out.level = parts[2]; out.code = parts.slice(3).join(":");
  } else if (head === "SOURCE" && parts.length >= 3) {
    out.scope = "SOURCE"; out.source = parts[1];
    if (parts.length === 3) { out.level = "ERROR"; out.code = "ERROR"; }
    else { out.level = parts[2]; out.code = parts.slice(3).join(":"); }
  } else if (head === "SYSTEM" && parts.length >= 2) {
    out.scope = "SYSTEM"; out.code = parts.slice(1).join(":");
  } else if (head === "IMAGE" && parts.length >= 2) {
    out.scope = "SYSTEM"; out.code = "IMAGE:" + parts[1];
  } else if (head === "AUTOSYNC") {
    out.scope = "SYSTEM"; out.code = raw;
  } else {
    out.scope = "SYSTEM"; out.code = raw;
  }
  var m = out.code.match(/^(.*?)_(\d+)$/);
  if (m) { out.num = Number(m[2]); out.codeBase = m[1]; } else { out.codeBase = out.code; }
  return out;
}

function tgViLookupV1_(parsed) {
  return TG_VI_CODES_V1[parsed.code] || TG_VI_CODES_V1[parsed.codeBase] || null;
}

/** Cau tieng Viet cho 1 issue: {level, line, todo}. */
function tgViIssueV1_(issue) {
  var p = tgViParseIssueV1_(issue);
  var info = tgViLookupV1_(p);
  var who = p.source ? tgViTitleCaseV1_(p.source) : "";
  var what, todo, level;
  if (info) {
    level = info[0]; what = info[1]; todo = info[2];
    if (p.num && /(_ERRORS|TRIGGER_COUNT)$/.test(p.codeBase || "")) {
      if (/_ERRORS$/.test(p.codeBase)) what = p.num + " " + what;
      else what = what.replace("(phải có đúng 1)", "(đang có " + p.num + ", phải đúng 1)");
    }
  } else {
    level = (p.level === "ERROR") ? "act" : "watch";
    what = "có cảnh báo mà hệ thống chưa có lời giải thích (mã: " + p.code + ")";
    todo = "Gõ /source <tên nguồn> hoặc /health để xem, rồi báo admin.";
  }
  return { level: level, who: who, what: what, todo: todo, key: (who || "-") + "|" + (p.codeBase || p.code) };
}

/** Tin "EHOME OPS" tieng Viet. Tra ve "" neu khong du du lieu (de noi goi dung tin cu). */
function tgViAlertTextV1_(decision, current) {
  decision = decision || {};
  current = current || {};
  var added = (decision.added || []).slice(0, 30);
  if (!added.length) {
    var sev0 = String(current.severity || "WARNING") === "ERROR" ? "Lỗi" : "Cảnh báo";
    return ["⚠️ EHOME OPS: mức báo vừa tăng lên (" + sev0 + ").", "Gõ /health để xem tổng thể."].join("\n");
  }

  var seen = {}, items = [];
  added.forEach(function (issue) {
    var it = tgViIssueV1_(issue);
    if (seen[it.key]) return;           // CONFIG:x và SOURCE:x cùng ý nghĩa chỉ nói 1 lần
    seen[it.key] = true;
    items.push(it);
  });

  var act = items.filter(function (x) { return x.level === "act"; });
  var watch = items.filter(function (x) { return x.level === "watch"; });
  var sev = String(current.severity || "WARNING") === "ERROR" ? "Lỗi" : "Cảnh báo";
  var lines = ["⚠️ EHOME OPS: có " + items.length + " cảnh báo mới (mức: " + sev + ")"];

  function emit(title, list) {
    if (!list.length) return;
    lines.push("", title);
    var groups = [], byKey = {};
    list.forEach(function (x) {
      var g = byKey[x.what];
      if (!g) { g = { what: x.what, todo: x.todo, whos: [] }; byKey[x.what] = g; groups.push(g); }
      if (x.who && g.whos.indexOf(x.who) < 0) g.whos.push(x.who);
    });
    groups.forEach(function (g) {
      var head = g.what.charAt(0).toUpperCase() + g.what.slice(1);
      lines.push("• " + head + (g.whos.length ? ": " + g.whos.join(", ") : ""));
      lines.push("   → " + g.todo);
    });
  }
  emit("🔴 Cần xử lý sớm:", act);
  emit("🟡 Xem sau (thường tự hết):", watch);

  lines.push("", "Gõ /health xem tổng thể, hoặc /source <tên nguồn> xem chi tiết.");
  return lines.join("\n");
}

function tgViAiCodeV1_(item) {
  var code = String(item && item.code != null ? item.code : item || "");
  return TG_VI_AI_CODES_V1[code] || ("cảnh báo mã " + code);
}

/** Tin "AI soi cau hinh" tieng Viet. */
function tgViAiProposalTextV1_(result, p, validation, changed, corrections) {
  result = result || {}; p = p || {}; validation = validation || {};
  changed = changed || []; corrections = corrections || [];
  var name = String(result.source || p.source || "");
  var id = String(result.sourceId || p.sourceId || "");
  var status = String(result.status || "");
  var conf = Math.round(Number(p.confidence || 0) * 100);
  var product = TG_VI_PRODUCT_V1[String(p.productType || "")] || String(p.productType || "chưa rõ");
  var changedAny = changed.length > 0;

  var lines = ["🤖 AI soi cấu hình: " + name + (id ? " (nguồn " + id + ")" : "")];
  lines.push("Kết luận: " + (changedAny ? "đề xuất ĐỔI cấu hình phần " + changed.join(", ") : "GIỮ NGUYÊN cấu hình") +
    " (AI tự tin " + conf + "%)");
  lines.push("Loại: " + product + (corrections.length ? " · đề xuất sửa PN/khách cho " + corrections.length + " căn" : ""));
  lines.push("Trạng thái: " + (TG_VI_STATUS_V1[status] || status || "—"));
  if (p.reason) lines.push("Lý do AI đưa ra: " + String(p.reason).slice(0, 700));

  var errors = (validation.errors || []).concat(validation.villaErrors || []);
  var warnings = (validation.warnings || []).concat(validation.villaWarnings || []);
  var noChangeWarn = false;
  var warnLines = [];
  warnings.slice(0, 6).forEach(function (w) {
    var code = String(w && w.code != null ? w.code : w);
    if (code === "NO_CONFIG_CHANGE") { noChangeWarn = true; return; }
    warnLines.push("• " + tgViAiCodeV1_(w));
  });
  if (errors.length) {
    lines.push("", "❌ Lỗi kiểm tra:");
    errors.slice(0, 4).forEach(function (e) { lines.push("• " + tgViAiCodeV1_(e)); });
  }
  if (warnLines.length) {
    lines.push("", "⚠️ Lưu ý:");
    warnLines.forEach(function (x) { lines.push(x); });
  }

  lines.push("");
  lines.push("Chưa ghi gì vào dữ liệu.");
  if (errors.length) lines.push("→ Anh bấm “Bỏ qua”, báo admin xem lỗi ở trên.");
  else if (!changedAny) lines.push("→ Anh nên bấm “Bỏ qua” (AI không đề xuất đổi gì).");
  else if (status === "READY_FOR_APPROVAL") lines.push("→ Xem kỹ phần đổi ở trên, đồng ý thì bấm “Duyệt CONFIG”.");
  else lines.push("→ Đề xuất này chưa đủ điều kiện tự duyệt, nhờ admin xem.");
  lines.push("Mã đề xuất: " + String(result.proposalId || ""));
  return lines.join("\n");
}



var TG_VI_WORDS_V1 = {
  STRUCTURE_READ_FAILED: "không đọc được cấu trúc file",
  STRUCTURE_ERROR: "cấu trúc file lỗi",
  VILLA_COUNT_CHANGED: "số căn trong file đã đổi",
  NO_ACCESS: "chưa được cấp quyền xem file",
  MAIN_CALENDAR_SHEET_NOT_FOUND: "không tìm thấy tab lịch chính (tab tháng)",
  COVERAGE_GAP: "thiếu một số ngày chưa đọc được (thường là tháng sau chưa có tab)",
  PARTIAL: "mới đọc một phần",
  DIRTY: "đang chờ đọc lại",
  RUNNING: "đang đọc",
  SKIPPED: "bỏ qua",
  PENDING: "đang chờ",
  PRESENT: "đã có",
  MISSING: "thiếu",
  ERROR: "lỗi",
  BROKEN: "hỏng",
  OK: "ổn",
  NOT_QUEUED: "chưa vào hàng chờ",
  DONE_BUT_MISSING: "xử lý xong nhưng vẫn thiếu ảnh",
  MANUAL_PENDING: "chờ bổ sung ảnh tay",
  IMAGE_WORKER_QUEUE: "đang chờ máy xử lý ảnh",
  MASTER_IMAGE_EMPTY_NO_QUEUE: "chưa có ảnh và chưa xếp hàng",
  QUEUE_DONE_MASTER_IMAGE_EMPTY: "đã xử lý nhưng chưa ghi ảnh",
  DRIVE_STABLE_UNVERIFIED: "ảnh Drive (chưa kiểm)",
  IMAGE_URL_UNVERIFIED: "link ảnh (chưa kiểm)"
};

/** Ma tieng Anh -> tieng Viet (khong biet thi giu nguyen). Chi doi chu hien thi. */
function tgViWordV1_(code) {
  var raw = String(code == null ? "" : code);
  var k = raw.toUpperCase().trim();
  return Object.prototype.hasOwnProperty.call(TG_VI_WORDS_V1, k) ? TG_VI_WORDS_V1[k] : raw;
}

/** Trang thai OK/WARNING/ERROR -> tieng Viet. Dung cho man chi tiet nguon. Chi doi chu. */
function tgViStatusWordV1_(status) {
  var k = String(status == null ? "" : status).toUpperCase().trim();
  var map = { OK: "ổn", WARNING: "cảnh báo", WARN: "cảnh báo", ERROR: "LỖI", UNKNOWN: "chưa rõ", PASS: "ổn", PENDING: "đang chờ" };
  return map[k] || tgViWordV1_(status);
}

/** Danh sach ma canh bao cua nguon -> cau tieng Viet ngan. */
function tgViWarnListV1_(warnings) {
  var out = [];
  (warnings || []).forEach(function (w) {
    var p = tgViParseIssueV1_(String(w || "").toUpperCase());
    var info = tgViLookupV1_(p);
    out.push(info ? info[1] : String(w));
  });
  return out.join("; ");
}

/** Xem thu: chi ghi Nhat ky, khong gui, khong ghi du lieu. */
function previewTelegramVietnameseV1() {
  var alertText = tgViAlertTextV1_(
    { added: [
      "CONFIG:HOME GOLD:WARNING:MASTER_PENDING_SYNC", "CONFIG:TỐNG DUY VILLA:WARNING:MASTER_PENDING_SYNC",
      "SOURCE:HOME GOLD:WARNING:CONFIG_WARNING", "SOURCE:HOME GOLD:WARNING:DUPLICATE_SOURCE_ALIAS",
      "SOURCE:HOME GOLD:WARNING:MASTER_PENDING_SYNC", "SOURCE:TỐNG DUY VILLA:WARNING:CONFIG_WARNING",
      "SOURCE:TỐNG DUY VILLA:WARNING:MASTER_PENDING_SYNC", "SYSTEM:STRUCTURE_SNAPSHOT_ERRORS_4"
    ] },
    { severity: "ERROR" }
  );
  var aiText = tgViAiProposalTextV1_(
    { source: "Tống Duy Villa", sourceId: 264, status: "READY_FOR_APPROVAL", proposalId: "AICFG-20261008-003550-1AD3080D" },
    { confidence: 0.98, productType: "NGUYEN_CAN", reason: "Giữ nguyên cấu hình hiện có: hàng 2 có ba địa chỉ căn tại C2, E2, G2; các cột D, F, H là ghi chú. Lịch chính hiển thị ngày ở cột B từ hàng 11." },
    { warnings: [{ code: "CURRENT_MASTER_ZERO_HIGH_RISK" }, { code: "NO_CONFIG_CHANGE" }] },
    [], []
  );
  Logger.log("=== TIN 1: EHOME OPS ===\n" + alertText);
  Logger.log("=== TIN 2: AI SOI CAU HINH ===\n" + aiText);
  return { alert: alertText, ai: aiText };
}

/**
 * Gui 2 tin mau (da dich) vao Telegram admin, KEM NUT BAM nhu tin that, de anh xem va bam thu.
 *  - Tin 1 (EHOME OPS): nut "AI soi Home Gold / Tong Duy Villa", "Nguon", "Health", "Menu" - nut AI soi se goi AI that cho nguon do (nhu binh thuong).
 *  - Tin 2 (AI soi cau hinh): nut Duyet CONFIG / Bo qua gan voi ma de xuat GIA nen bam chi bao khong ton tai, khong ghi gi.
 * Khong ghi du lieu.
 */
function sendTelegramVietnameseSampleV1() {
  var p = previewTelegramVietnameseV1();
  var chatId = typeof tgPropertyV315_ === "function"
    ? tgPropertyV315_("TELEGRAM_ADMIN_CHAT_ID")
    : String(PropertiesService.getScriptProperties().getProperty("TELEGRAM_ADMIN_CHAT_ID") || "").trim();
  if (!chatId) throw new Error("TELEGRAM_ADMIN_CHAT_ID chua dat");

  var rows1 = [], rows2 = [];
  try {
    rows1 = opsHealthAlertKeyboardV4221_(
      { reason: "NEW_ISSUE", added: ["SOURCE:HOME GOLD:WARNING:CONFIG_WARNING", "SOURCE:TỐNG DUY VILLA:WARNING:CONFIG_WARNING"] },
      { sources: { sources: [{ id: "219", source: "Home Gold", status: "WARNING" }, { id: "264", source: "Tống Duy Villa", status: "WARNING" }] } }
    );
  } catch (e1) { Logger.log("[TelegramVietnamese] nut tin 1: " + e1); }
  try {
    rows2 = tgAiProposalRowsV4221_("AICFG-MAU-KHONG-TON-TAI", "264", "READY_FOR_APPROVAL", 0);
  } catch (e2) { Logger.log("[TelegramVietnamese] nut tin 2: " + e2); }

  var head = "🧪 (TIN MẪU - bản dịch tiếng Việt)\n\n";
  var a = sendTelegramMessageWithKeyboardV4221_(chatId, head + p.alert, rows1);
  var b = sendTelegramMessageWithKeyboardV4221_(chatId, head + p.ai, rows2);
  var res = { code: "TELEGRAM_VI_SAMPLE_SENT_V1", alertSent: !!(a && a.success), aiSent: !!(b && b.success), buttons1: rows1.length, buttons2: rows2.length };
  Logger.log(JSON.stringify(res));
  return res;
}

/** Kiem tra tu dong khong gui gi: phai PASS. */
function testTelegramVietnameseV1() {
  var fails = [];
  var t = tgViAlertTextV1_({ added: ["CONFIG:HOME GOLD:WARNING:MASTER_PENDING_SYNC", "SOURCE:HOME GOLD:WARNING:MASTER_PENDING_SYNC"] }, { severity: "WARNING" });
  if (t.indexOf("MASTER_PENDING_SYNC") >= 0) fails.push("con ma tho MASTER_PENDING_SYNC");
  if ((t.match(/Home Gold/g) || []).length !== 1) fails.push("khong gop CONFIG+SOURCE cung ma");
  var t2 = tgViAlertTextV1_({ added: ["SYSTEM:STRUCTURE_SNAPSHOT_ERRORS_4"] }, { severity: "ERROR" });
  if (t2.indexOf("4 nguồn bị lỗi") < 0) fails.push("khong dich STRUCTURE_SNAPSHOT_ERRORS_4: " + t2);
  var t3 = tgViAlertTextV1_({ added: ["SYSTEM:MA_LA_KHONG_BIET"] }, { severity: "WARNING" });
  if (t3.indexOf("MA_LA_KHONG_BIET") < 0 || t3.indexOf("chưa có lời giải thích") < 0) fails.push("ma la phai ghi ro");
  var t4 = tgViAlertTextV1_({ added: ["SOURCE:TỐNG DUY VILLA:ERROR"] }, { severity: "ERROR" });
  if (t4.indexOf("🔴") < 0 || t4.indexOf("Tống Duy Villa") < 0) fails.push("loi nguon phai la do");
  var t5 = tgViAlertTextV1_({ added: ["AUTOSYNC:TRIGGER_COUNT_NOT_1"] }, { severity: "ERROR" });
  if (t5.indexOf("bộ hẹn giờ") < 0) fails.push("autosync");
  var ai = tgViAiProposalTextV1_({ source: "X", sourceId: 1, status: "READY_FOR_APPROVAL", proposalId: "P1" }, { confidence: 0.5, productType: "PHONG_LE" }, { warnings: [{ code: "NO_CONFIG_CHANGE" }] }, [], []);
  if (ai.indexOf("GIỮ NGUYÊN") < 0 || ai.indexOf("phòng lẻ") < 0 || ai.indexOf("Bỏ qua") < 0) fails.push("ai khong doi: " + ai);
  var ai2 = tgViAiProposalTextV1_({ source: "X", sourceId: 1, status: "READY_FOR_APPROVAL", proposalId: "P2" }, { confidence: 0.9, productType: "NGUYEN_CAN" }, { warnings: [] }, ["LỊCH"], []);
  if (ai2.indexOf("ĐỔI cấu hình phần LỊCH") < 0 || ai2.indexOf("Duyệt CONFIG") < 0) fails.push("ai co doi: " + ai2);
  if (tgViStatusWordV1_("ERROR") !== "LỖI" || tgViStatusWordV1_("WARNING") !== "cảnh báo" || tgViStatusWordV1_("OK") !== "ổn") fails.push("status word");
  if (tgViWarnListV1_(["MASTER_PENDING_SYNC"]).indexOf("chờ cập nhật") < 0) fails.push("warn list");
  if (tgViWordV1_("COVERAGE_GAP").indexOf("thiếu") !== 0 || tgViWordV1_("ABC_X") !== "ABC_X" || tgViWordV1_("IMAGE_WORKER_QUEUE").indexOf("chờ") < 0) fails.push("word");
  var res = { code: fails.length ? "FAIL" : "TELEGRAM_VI_TEST_PASS_V1", fails: fails };
  Logger.log(JSON.stringify(res));
  return res;
}
