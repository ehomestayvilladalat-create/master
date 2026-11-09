/**
 * ProductTypeFallbackV1.js - SUA LOI "can nguyen can bi hieu la phong le".
 *
 * Quy uoc cua Ehomestay: cot LOAI chi ghi PHONG_RIENG cho dong phong le; dong nguyen can de TRONG.
 * Loi cu (Repositories.js, ceReadSourceConfigMap_): can de trong LOAI_SP "muon" loai theo LINK LICH.
 * Khi 1 link co 2 dong (1 nguyen can de trong + 1 phong le PHONG_RIENG) thi can nguyen can bi hieu thanh PHONG_RIENG.
 *
 * Sua: chi muon loai theo link/nguon khi TAT CA dong cung link (cung nguon) deu cung 1 loai.
 * Co dong de trong hoac khac loai -> khong muon, can de trong = nguyen can.
 * Khong ghi MASTER, khong doi villa_id, khong dong Booking Engine / gia / lich.
 */
function ceSrcTypeTrackV1_(result, kind, key, type) {
  var seen = result._seenTypeV1 || (result._seenTypeV1 = { S: {}, U: {} });
  var m = seen[kind];
  var t = String(type || "");
  if (!Object.prototype.hasOwnProperty.call(m, key)) m[key] = t;
  else if (m[key] !== t) m[key] = "\u0000CONFLICT";
  var target = kind === "S" ? result.bySourceType : result.byUrlType;
  if (m[key] && m[key] !== "\u0000CONFLICT") target[key] = m[key];
  else delete target[key];
}

function testProductTypeFallbackV1() {
  var r = { bySourceType: {}, byUrlType: {} };
  // Nghi Nguyen: nguyen can (de trong) + phong le (PHONG_RIENG) cung link -> khong muon
  ceSrcTypeTrackV1_(r, "U", "u1", "");
  ceSrcTypeTrackV1_(r, "U", "u1", "PHONG_RIENG");
  // Nguon chi co phong le (2 dong cung loai) -> van muon
  ceSrcTypeTrackV1_(r, "U", "u2", "PHONG_RIENG");
  ceSrcTypeTrackV1_(r, "U", "u2", "PHONG_RIENG");
  // Chai Nho: NGUYEN_CAN + PHONG_RIENG -> khong muon
  ceSrcTypeTrackV1_(r, "U", "u3", "NGUYEN_CAN");
  ceSrcTypeTrackV1_(r, "U", "u3", "PHONG_RIENG");
  // Thu tu nguoc: phong le truoc, nguyen can de trong sau
  ceSrcTypeTrackV1_(r, "U", "u4", "PHONG_RIENG");
  ceSrcTypeTrackV1_(r, "U", "u4", "");
  ceSrcTypeTrackV1_(r, "S", "s1", "PHONG_RIENG");
  var fails = [];
  if (r.byUrlType.u1) fails.push("u1 phai khong muon");
  if (r.byUrlType.u2 !== "PHONG_RIENG") fails.push("u2 phai van la PHONG_RIENG");
  if (r.byUrlType.u3) fails.push("u3 phai khong muon");
  if (r.byUrlType.u4) fails.push("u4 phai khong muon");
  if (r.bySourceType.s1 !== "PHONG_RIENG") fails.push("s1 phai la PHONG_RIENG");
  var res = { code: fails.length ? "PRODUCT_TYPE_FALLBACK_FAIL_V1" : "PRODUCT_TYPE_FALLBACK_PASS_V1", fails: fails };
  Logger.log(JSON.stringify(res));
  return res;
}
