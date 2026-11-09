/**
 * FILE: work/new/src/ImageReplaceButton.js
 * EHOME BOOKING — V1 "Thay ảnh căn" (mục trong menu Booking Engine).
 *
 * Hàm gắn menu: ehomeReplaceVillaImageV1
 *
 * Khi nhập MÃ CĂN, hàm này:
 *  1. Lấy căn trong MASTER_VILLA (TÊN CĂN, NGUỒN, LINK LỊCH, CỘT NGUỒN, ẢNH) và CONFIG của nguồn trong MASTER.
 *  2. Ghi hàng queue của căn trong IMAGE_CACHE_QUEUE_V2 thành PENDING, với CONFIG MASTER / CONFIG ẢNH
 *     hiện tại của nguồn (không dùng config cũ đang nằm trong queue) và CỘT NGUỒN hiện tại.
 *     Hàng này được đưa lên đầu queue để worker xử lý trước.
 *  3. Xóa ô ẢNH của căn trong MASTER_VILLA để ảnh sai không đứng lại.
 *  4. Chạy Image Worker ngay, rồi đọc lại trạng thái để báo kết quả.
 *
 * Không xóa file Drive nào. Cache tái dùng file theo tên (beCacheVillaImageToDrive_), nên nếu tên chuẩn
 * EHOME_<sourceId>_COL_<cột>__<tên căn> đã có file thì hàm thêm hậu tố _R<timestamp> để tạo file mới.
 *
 * Chỉ gọi lại hàm có sẵn, không sửa Booking Engine:
 *   ImageWorker.js     : beImageQueueSheetNameV21_, beImageQueueHeadersV21_, beImageQueueSourceConfigMapV342_,
 *                        ehomeImageCacheWorkerV21_, beScheduleImageWorkerV21_
 *   MasterEngine.js    : beImageCacheSourceKeyV329_, normalizeMasterText
 *   ImageDriveCache.js : beGetImageCacheFolder_, beVillaImageCacheKey_, beFindCachedVillaImage_
 *   Utils.js           : ceNormalize_, ceFindHeader_
 */

/** Điểm vào của nút menu: hỏi MÃ CĂN, thay ảnh, báo kết quả. */
function ehomeReplaceVillaImageV1() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt(
    "Thay ảnh căn",
    "Nhập MÃ CĂN cần thay ảnh (nhiều mã thì cách nhau bằng dấu phẩy hoặc khoảng trắng):",
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) {
    return { success: false, reason: "CANCELLED", items: [] };
  }

  var skus = beReplaceParseSkusV1_(resp.getResponseText());
  if (!skus.length) {
    ui.alert("Chưa nhập MÃ CĂN nào.");
    return { success: false, reason: "NO_SKU", items: [] };
  }

  var result = beReplaceVillaImagesV1_(skus);
  ui.alert(beReplaceSummaryTextV1_(result));
  return result;
}

function beReplaceParseSkusV1_(text) {
  var seen = {};
  var out = [];
  String(text || "").split(/[\s,;]+/).forEach(function (part) {
    var sku = String(part || "").trim().toUpperCase();
    if (sku && !seen[sku]) {
      seen[sku] = true;
      out.push(sku);
    }
  });
  return out;
}

/** Lõi: ghi queue + xóa ẢNH dưới lock, sau đó chạy worker (worker tự giữ lock). */
function beReplaceVillaImagesV1_(skus) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { success: false, reason: "LOCKED_RETRY_LATER", items: [] };
  }

  var prep;
  try {
    prep = beReplaceQueueVillasV1_(ss, skus);
  } finally {
    lock.releaseLock();
  }

  // Worker tự xin lock nên phải gọi sau khi đã nhả lock ở trên.
  var worker = null;
  if (prep.queuedSkus.length) {
    try {
      worker = ehomeImageCacheWorkerV21_();
    } catch (workerError) {
      worker = {
        success: false,
        error: String(workerError && workerError.message ? workerError.message : workerError)
      };
    }
  }

  var status = beReplaceReadStatusV1_(ss, prep.queuedSkus);
  var items = prep.items.map(function (item) {
    if (item.skipped) return item;
    var st = status[item.sku] || {};
    item.queueStatus = st.status || "";
    item.error = st.error || "";
    item.currentImage = st.image || "";
    return item;
  });

  var stillPending = items.some(function (item) {
    return !item.skipped && item.queueStatus !== "DONE" && item.queueStatus !== "ERROR";
  });
  if (stillPending) beScheduleImageWorkerV21_();

  return { success: true, worker: worker, items: items };
}

/**
 * Đọc MASTER_VILLA và MASTER, ghi queue cho các căn hợp lệ, xóa ẢNH của các căn đó.
 * Phải gọi trong lock. Nếu lỗi trước khi ghi thì không có gì bị thay đổi.
 */
function beReplaceQueueVillasV1_(ss, skus) {
  var masterName = BE_CONFIG.MASTER_VILLA_SHEET || "MASTER_VILLA";
  var master = ss.getSheetByName(masterName);
  if (!master || master.getLastRow() < 2) throw new Error("Không có " + masterName + ".");

  var mValues = master.getRange(1, 1, master.getLastRow(), master.getLastColumn()).getDisplayValues();
  var mHead = mValues[0].map(ceNormalize_);
  var mSku = ceFindHeader_(mHead, ["ma can", "sku"]);
  var mName = ceFindHeader_(mHead, ["ten can", "ten villa"]);
  var mSource = ceFindHeader_(mHead, ["nguon", "source"]);
  var mLink = ceFindHeader_(mHead, ["link lich", "link"]);
  var mCol = ceFindHeader_(mHead, ["cot nguon", "source column"]);
  var mImage = ceFindHeader_(mHead, ["anh", "image"]);
  if (mSku < 0 || mName < 0 || mSource < 0 || mLink < 0 || mCol < 0 || mImage < 0) {
    throw new Error(masterName + " thiếu cột MÃ CĂN / TÊN CĂN / NGUỒN / LINK LỊCH / CỘT NGUỒN / ẢNH.");
  }

  var sourceCfg = beImageQueueSourceConfigMapV342_(ss);
  // Mở thư mục cache trước khi ghi gì: nếu không mở được thì dừng, queue và MASTER giữ nguyên.
  var folder = beGetImageCacheFolder_();

  var items = [];
  var toQueue = [];
  skus.forEach(function (sku) {
    var rowIndex = -1;
    for (var r = 1; r < mValues.length; r++) {
      if (String(mValues[r][mSku] || "").trim().toUpperCase() === sku) {
        rowIndex = r;
        break;
      }
    }
    if (rowIndex < 0) {
      items.push({ sku: sku, skipped: true, reason: "Không có MÃ CĂN này trong " + masterName + "." });
      return;
    }

    var mRow = mValues[rowIndex];
    var name = String(mRow[mName] || "").trim();
    var source = String(mRow[mSource] || "").trim();
    var link = String(mRow[mLink] || "").trim();
    var sourceColumn = Number(String(mRow[mCol] || "").trim() || 0);
    var oldImage = String(mRow[mImage] || "").trim();

    if (!name || !link || !(sourceColumn > 0)) {
      items.push({
        sku: sku,
        name: name,
        skipped: true,
        reason: "Thiếu TÊN CĂN, LINK LỊCH hoặc CỘT NGUỒN (> 0) trong " + masterName + "."
      });
      return;
    }

    var cfg = sourceCfg["LINK|" + link] || sourceCfg["SOURCE|" + normalizeMasterText(source)] || null;
    if (!cfg || !cfg.sourceId) {
      items.push({
        sku: sku,
        name: name,
        skipped: true,
        reason: "Không tìm thấy nguồn hoặc CONFIG của nguồn trong MASTER."
      });
      return;
    }

    // Tên ghi vào queue phải là tên reader ảnh của worker đọc được (không phải tên MASTER),
    // vì worker so khớp theo cột + tên. Tên MASTER dài hơn sẽ làm worker đọc theo nhánh trực tiếp.
    var readerName = "";
    var readerProblem = "";
    try {
      readerName = beReplaceReaderNameV1_(cfg, link, sourceColumn);
    } catch (readError) {
      readerProblem = String(readError && readError.message ? readError.message : readError);
    }
    if (!readerName) {
      items.push({
        sku: sku,
        name: name,
        skipped: true,
        reason: readerProblem ||
          ("Không đọc được tên căn ở cột " + sourceColumn + " của lịch nguồn. Chưa thay để tránh ghép sai ảnh.")
      });
      return;
    }
    name = readerName;

    var baseKey = beImageCacheSourceKeyV329_("", sku, cfg.sourceId, sourceColumn);
    var cacheKey = beReplaceChooseCacheKeyV1_(folder, baseKey, name);

    toQueue.push({
      sku: sku,
      name: name,
      source: source,
      link: link,
      sourceId: cfg.sourceId,
      sourceColumn: sourceColumn,
      cacheKey: cacheKey,
      masterConfig: cfg.masterConfig || "",
      imageConfig: cfg.imageConfig || "",
      masterRow: rowIndex + 1
    });
    items.push({
      sku: sku,
      name: name,
      skipped: false,
      cacheKey: cacheKey,
      keySuffixed: cacheKey !== baseKey,
      oldImage: oldImage,
      imageConfig: cfg.imageConfig || ""
    });
  });

  if (!toQueue.length) return { queuedSkus: [], items: items };

  // Ghi queue: thay hàng cũ của các căn này bằng hàng PENDING mới, đặt lên đầu queue.
  var queueName = beImageQueueSheetNameV21_();
  var queue = ss.getSheetByName(queueName) || ss.insertSheet(queueName);
  var qLast = queue.getLastRow();
  var qValues = qLast > 0 ? queue.getRange(1, 1, qLast, queue.getLastColumn()).getValues() : [];
  if (!qValues.length) qValues = [beImageQueueHeadersV21_().slice()];

  var qHead = qValues[0].map(ceNormalize_);
  var required = [
    "status", "source id", "nguon", "link", "ma can", "ten can",
    "cot nguon", "config master", "config anh", "cache source key"
  ];
  var missing = required.filter(function (h) { return qHead.indexOf(h) < 0; });
  if (missing.length) throw new Error(queueName + " thiếu cột: " + missing.join(", "));

  var qSku = qHead.indexOf("ma can");
  var width = qHead.length;
  var removeSku = {};
  toQueue.forEach(function (rec) { removeSku[rec.sku] = true; });

  var newRows = toQueue.map(function (rec) { return beReplaceQueueRowV1_(qHead, rec); });
  var kept = qValues.slice(1).filter(function (row) {
    return !removeSku[String(row[qSku] || "").trim().toUpperCase()];
  });
  var out = [qValues[0]].concat(newRows, kept).map(function (row) {
    var x = row.slice(0, width);
    while (x.length < width) x.push("");
    return x;
  });

  var oldLast = queue.getLastRow();
  queue.getRange(1, 1, out.length, width).setValues(out);
  if (oldLast > out.length) {
    queue.getRange(out.length + 1, 1, oldLast - out.length, width).clearContent();
  }

  // Xóa ô ẢNH của các căn đã vào queue, để worker ghi ảnh mới vào đúng ô này.
  toQueue.forEach(function (rec) {
    master.getRange(rec.masterRow, mImage + 1).setValue("");
  });

  var queuedSkus = toQueue.map(function (rec) { return rec.sku; });
  Logger.log(JSON.stringify({ code: "IMAGE_REPLACE_QUEUED_V1", skus: queuedSkus }));
  return { queuedSkus: queuedSkus, items: items };
}

/**
 * Tên cache chuẩn nếu chưa có file trong thư mục cache; nếu đã có file thì thêm hậu tố
 * để worker tạo file mới thay vì tái dùng file cũ (file cũ không bị xóa).
 */
function beReplaceChooseCacheKeyV1_(folder, baseKey, villaName) {
  var existing = beFindCachedVillaImage_(folder, beVillaImageCacheKey_(baseKey, villaName));
  return existing ? baseKey + "_R" + new Date().getTime() : baseKey;
}

/**
 * Tên căn đúng như worker so khớp: reader ảnh đọc lịch nguồn bằng CONFIG hiện tại rồi lấy tên ở đúng cột.
 * Gọi cùng hàm và cùng CONFIG với worker (ImageWorker.js, đoạn đọc ảnh), nên tên trả về khớp với worker.
 * Ném lỗi khi CONFIG ẢNH có SHEET riêng (chưa hỗ trợ thay tự động). Trả "" nếu không thấy căn ở cột đó.
 */
function beReplaceReaderNameV1_(cfg, link, sourceColumn) {
  if (typeof beHasExplicitMetadataSheetV38_ === "function" && beHasExplicitMetadataSheetV38_(cfg.imageConfig || "")) {
    throw new Error("CONFIG ẢNH có SHEET riêng: chưa hỗ trợ thay tự động, cần thay tay.");
  }
  if (typeof beClearMasterSheetRuntimeCacheV21_ === "function") beClearMasterSheetRuntimeCacheV21_();

  var file = beOpenSourceSpreadsheetV_FIX(link);
  var calendarConfig = "AUTO";
  try {
    if (typeof opsFindSourceV312_ === "function") {
      var found = opsFindSourceV312_(cfg.sourceId);
      if (found && found.configCalendar) calendarConfig = found.configCalendar;
    }
  } catch (ignoreCalendarConfig) {}

  var calendarSheet = beFindMasterCalendarSheetV4210_(file, calendarConfig, new Date());
  if (!calendarSheet) throw new Error("Không tìm thấy MAIN SHEET của nguồn.");

  var effectiveImageConfig = beBuildInheritedMetadataConfigV37_(
    cfg.masterConfig || "",
    cfg.imageConfig || "",
    "IMAGE"
  );
  var villas = beReadInfoSheetV31_(calendarSheet, effectiveImageConfig) || [];
  for (var i = 0; i < villas.length; i++) {
    if (Number(villas[i].sourceColumn || 0) === Number(sourceColumn)) {
      return String(villas[i].name || "").trim();
    }
  }
  return "";
}

/** Tạo một mảng đúng độ rộng header queue, điền theo tên cột đã chuẩn hóa. */
function beReplaceQueueRowV1_(qHead, rec) {
  var byHeader = {
    "status": "PENDING",
    "attempts": 0,
    "cache source key": rec.cacheKey,
    "ma can": rec.sku,
    "source id": rec.sourceId,
    "nguon": rec.source,
    "link": rec.link,
    "ten can": rec.name,
    "cot nguon": rec.sourceColumn,
    "config master": rec.masterConfig,
    "config anh": rec.imageConfig,
    "image url": "",
    "error": "",
    "cap nhat": new Date()
  };
  return qHead.map(function (h) {
    return Object.prototype.hasOwnProperty.call(byHeader, h) ? byHeader[h] : "";
  });
}

/** Trạng thái queue và ẢNH hiện tại của các MÃ CĂN đã xếp hàng. */
function beReplaceReadStatusV1_(ss, skus) {
  var out = {};
  if (!skus.length) return out;

  var queue = ss.getSheetByName(beImageQueueSheetNameV21_());
  if (queue && queue.getLastRow() > 1) {
    var qv = queue.getRange(1, 1, queue.getLastRow(), queue.getLastColumn()).getValues();
    var qh = qv[0].map(ceNormalize_);
    var qs = ceFindHeader_(qh, ["ma can", "sku"]);
    var qst = ceFindHeader_(qh, ["status"]);
    var qe = ceFindHeader_(qh, ["error"]);
    for (var r = 1; r < qv.length; r++) {
      var sku = String(qv[r][qs] || "").trim().toUpperCase();
      if (skus.indexOf(sku) < 0) continue;
      out[sku] = {
        status: qst >= 0 ? String(qv[r][qst] || "").trim().toUpperCase() : "",
        error: qe >= 0 ? String(qv[r][qe] || "") : ""
      };
    }
  }

  var master = ss.getSheetByName(BE_CONFIG.MASTER_VILLA_SHEET || "MASTER_VILLA");
  if (master && master.getLastRow() > 1) {
    var mv = master.getRange(1, 1, master.getLastRow(), master.getLastColumn()).getDisplayValues();
    var mh = mv[0].map(ceNormalize_);
    var ms = ceFindHeader_(mh, ["ma can", "sku"]);
    var mi = ceFindHeader_(mh, ["anh", "image"]);
    for (var m = 1; m < mv.length; m++) {
      var msku = String(mv[m][ms] || "").trim().toUpperCase();
      if (skus.indexOf(msku) < 0) continue;
      out[msku] = out[msku] || {};
      out[msku].image = mi >= 0 ? String(mv[m][mi] || "").trim() : "";
    }
  }
  return out;
}

/** Nội dung hộp thoại kết quả, ngắn gọn cho từng MÃ CĂN. */
function beReplaceSummaryTextV1_(result) {
  if (!result || !result.success) {
    if (result && result.reason === "LOCKED_RETRY_LATER") {
      return "Worker hoặc Build đang chạy. Chờ vài phút rồi bấm lại.";
    }
    return "Không chạy được: " + ((result && result.reason) || "lỗi không rõ");
  }

  var lines = ["Thay ảnh căn — kết quả:"];
  var suffixed = false;
  (result.items || []).forEach(function (item) {
    if (item.skipped) {
      lines.push("• " + item.sku + ": bỏ qua — " + item.reason);
      return;
    }
    if (item.keySuffixed) suffixed = true;

    var label;
    if (item.queueStatus === "DONE") {
      label = "xong, ảnh mới đã ghi vào MASTER_VILLA";
    } else if (item.queueStatus === "ERROR") {
      label = "LỖI — " + (item.error || "xem IMAGE_CACHE_QUEUE_V2");
    } else if (item.queueStatus === "PENDING") {
      label = "đang chờ worker (tự chạy lại sau khoảng 1 phút)";
    } else {
      label = "không thấy trong IMAGE_CACHE_QUEUE_V2";
    }
    lines.push("• " + item.sku + " (" + item.name + "): " + label + " | key " + item.cacheKey);
  });

  if (suffixed) {
    lines.push("Tên cache chuẩn đã có file nên dùng hậu tố _R. File Drive cũ KHÔNG bị xóa.");
  }
  return lines.join("\n");
}
