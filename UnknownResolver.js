/**
 * EHOME BOOKING - UNKNOWN RESOLVER V1 (FIX4)
 *
 * Man tim NOI BO: can nao snapshot khong dung duoc se hien the "Can kiem tra lich / gia".
 * Ham nay cho man tim goi them (sau khi da hien ket qua) de DOC THAT theo dot nho
 * cac can do, giong pha LIVE cua web khach (CustomerApi.js).
 *
 * - Chi DOC file lich. Khong ghi MASTER, villa_id, snapshot, queue.
 * - Moi lan toi da 5 can, toi da 12 giay doc.
 * - Ket qua doc that (FREE/BUSY/HIDDEN) duoc nho tam 10 phut (CacheService) de tim lai nhanh.
 * - Khong thay doi Booking Engine / logic lich / gia: dung lai ceSearchAvailableVillasInternal_ voi forceLiveV627.
 */
var EHOME_UNKNOWN_RESOLVER_V1 = {
  MAX_IDS: 5,
  RUNTIME_MS: 12000,
  CACHE_SECONDS: 600,
  CACHE_PREFIX: "EHOME_UR1|"
};

function urCacheKeyV1_(id, checkIn, checkOut, guests) {
  return EHOME_UNKNOWN_RESOLVER_V1.CACHE_PREFIX + [id, checkIn, checkOut, guests].join("|");
}

/**
 * Internal Apps Script UI only (nhu apiSearchVillas). Khong noi qua HTTP cong khai.
 * @param {{checkIn:string, checkOut:string, guests:number, villaIds:string[]}} request
 * @return {{success:boolean, freeCards:Object[], busyIds:string[], hiddenIds:string[],
 *           deniedIds:string[], failed:Object, uncheckedIds:string[], cachedCount:number, elapsedMs:number}}
 */
function apiResolveUnknownVillasV1(request) {
  var started = new Date().getTime();
  request = request || {};
  var out = {
    success: true, freeCards: [], busyIds: [], hiddenIds: [], deniedIds: [],
    failed: {}, uncheckedIds: [], cachedCount: 0, elapsedMs: 0
  };
  try {
    var checkIn = String(request.checkIn || "");
    var checkOut = String(request.checkOut || "");
    var guests = Number(request.guests || 0);
    var seen = {};
    var ids = (Array.isArray(request.villaIds) ? request.villaIds : []).map(function (x) {
      return String(x || "").trim();
    }).filter(function (x) {
      if (!x || seen[x]) return false;
      seen[x] = true;
      return true;
    }).slice(0, EHOME_UNKNOWN_RESOLVER_V1.MAX_IDS);
    if (!ids.length || !checkIn || !checkOut) {
      out.elapsedMs = new Date().getTime() - started;
      return out;
    }

    var cache = null;
    try { cache = CacheService.getScriptCache(); } catch (ignoreCache) { cache = null; }

    // 1) Lay ket qua da nho tam
    var todo = [];
    ids.forEach(function (id) {
      var cached = null;
      if (cache) {
        try {
          var raw = cache.get(urCacheKeyV1_(id, checkIn, checkOut, guests));
          if (raw) cached = JSON.parse(raw);
        } catch (ignoreRead) { cached = null; }
      }
      if (cached && cached.o) {
        out.cachedCount++;
        if (cached.o === "FREE" && cached.card) out.freeCards.push(cached.card);
        else if (cached.o === "BUSY") out.busyIds.push(id);
        else if (cached.o === "HIDDEN") out.hiddenIds.push(id);
        else todo.push(id);
      } else {
        todo.push(id);
      }
    });

    // 2) Doc that cac can con lai (cung cach web khach: forceLiveV627)
    if (todo.length) {
      var batch = ceSearchAvailableVillasInternal_(checkIn, checkOut, guests, {
        city: "", cursor: 0, pageSize: todo.length, minPrice: 0, maxPrice: 0, sortMode: "BEST",
        shuffleSeed: "", productType: "ALL", bedrooms: 0,
        allowedVillaIds: todo, maxVillas: 0, debug: false,
        forceLiveV627: true, maxRuntimeMs: EHOME_UNKNOWN_RESOLVER_V1.RUNTIME_MS
      }) || {};

      var freeById = {};
      (batch.results || []).forEach(function (card) {
        var id = String(card && card.villaId || "").trim();
        if (id) freeById[id] = card;
      });
      var errorById = {};
      (batch.errors || []).forEach(function (e) {
        var id = String(e && e.villaId || "").trim();
        if (id && !errorById[id]) errorById[id] = ceSearchLiveErrorReasonV2_({message: e && e.message});
      });
      var samples = batch.dropReasonSamples || {};
      function idsOf(reason) {
        var map = {};
        (samples[reason] || []).forEach(function (s) {
          var id = String(s && s.villaId || "").trim();
          if (id) map[id] = true;
        });
        return map;
      }
      var deniedMap = idsOf("PERMISSION_DENIED");
      var hiddenMap = idsOf("HIDDEN_COLUMN");
      var stopped = batch.stoppedEarly === true;

      function remember(id, outcome, card) {
        if (!cache) return;
        try {
          cache.put(urCacheKeyV1_(id, checkIn, checkOut, guests),
            JSON.stringify({o: outcome, card: card || null}),
            EHOME_UNKNOWN_RESOLVER_V1.CACHE_SECONDS);
        } catch (ignorePut) {}
      }

      todo.forEach(function (id) {
        if (freeById[id]) {
          out.freeCards.push(freeById[id]);
          remember(id, "FREE", freeById[id]);
        } else if (errorById[id]) {
          out.failed[id] = errorById[id];
        } else if (deniedMap[id]) {
          out.deniedIds.push(id);
        } else if (hiddenMap[id]) {
          out.hiddenIds.push(id);
          remember(id, "HIDDEN", null);
        } else if (stopped) {
          out.uncheckedIds.push(id);       // chua kip doc (het gio): se thu lai
        } else {
          out.busyIds.push(id);            // da doc that, khong trong
          remember(id, "BUSY", null);
        }
      });
    }
  } catch (err) {
    out.success = false;
    out.error = err && err.message ? err.message : String(err);
  }
  out.elapsedMs = new Date().getTime() - started;
  return out;
}

/** Kiem tra nhanh khong mo file nao: goi voi danh sach rong va voi 1 id gia. */
function testUnknownResolverV1() {
  var empty = apiResolveUnknownVillasV1({checkIn: "", checkOut: "", guests: 2, villaIds: []});
  if (!empty.success) throw new Error("UR_TEST_FAIL: empty -> " + empty.error);
  var none = apiResolveUnknownVillasV1({checkIn: "2026-12-10", checkOut: "2026-12-12", guests: 4, villaIds: ["VL-KHONG-TON-TAI"]});
  if (!none.success) throw new Error("UR_TEST_FAIL: unknown id -> " + none.error);
  if (none.freeCards.length) throw new Error("UR_TEST_FAIL: id gia khong duoc ra the trong");
  var res = {code: "UNKNOWN_RESOLVER_V1_PASS", emptyOk: true, fakeId: {busy: none.busyIds.length, unchecked: none.uncheckedIds.length}};
  Logger.log(JSON.stringify(res));
  return res;
}
