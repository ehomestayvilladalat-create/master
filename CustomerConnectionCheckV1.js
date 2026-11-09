/**
 * CustomerConnectionCheckV1.js
 * Test chi doc (read-only) cho ket noi web khach: kiem tra phan trang khong bi ket.
 * Chay: testCustomerConnectionFix16V1() trong Apps Script editor.
 * Tien do = nextCursor + candidateCursor (pha LIVE khong co candidateCursor nen chi dung nextCursor).
 */
function testCustomerConnectionFix16V1() {
  var cases = [
    {name: "NOV", checkIn: "2026-11-20", checkOut: "2026-11-22", guests: 8},
    {name: "DEC", checkIn: "2026-12-17", checkOut: "2026-12-20", guests: 8},
    {name: "YEAR_END", checkIn: "2026-12-31", checkOut: "2027-01-03", guests: 35}
  ];
  var MAX_PAGES = 30;
  var report = cases.map(function (c) {
    var base = {
      checkIn: c.checkIn, checkOut: c.checkOut, guests: c.guests, city: "Đà Lạt",
      pageSize: 12, sortMode: "BEST", productType: "NGUYEN_CAN",
      shuffleSeed: "fix16_" + c.name
    };
    var r = apiCustomerSearchV61(base);
    connAssertV1_(r && r.success === true, c.name + ": search lỗi");
    var token = r.searchToken;
    var cursor = Number(r.nextCursor || 0);
    var progress = cursor + Number(r.candidateCursor || 0);
    var pages = 1, totalShown = Number(r.count || 0), stuck = 0;
    var done = r.hasMore !== true || r.snapshotScanDone === true;
    Logger.log(JSON.stringify({case: c.name, page: 1, phase: r.phase, count: r.count,
      nextCursor: r.nextCursor, candidateCursor: r.candidateCursor, hasMore: r.hasMore, snapshotScanDone: r.snapshotScanDone}));
    while (!done && pages < MAX_PAGES) {
      var rn = apiCustomerSearchV61({
        checkIn: base.checkIn, checkOut: base.checkOut, guests: base.guests, city: base.city,
        pageSize: 12, sortMode: base.sortMode, productType: base.productType,
        shuffleSeed: base.shuffleSeed, searchToken: token, cursor: cursor
      });
      connAssertV1_(rn && rn.success === true, c.name + ": trang " + (pages + 1) + " lỗi");
      pages++;
      totalShown += Number(rn.count || 0);
      var newProgress = Number(rn.nextCursor || 0) + Number(rn.candidateCursor || 0);
      Logger.log(JSON.stringify({case: c.name, page: pages, phase: rn.phase, count: rn.count,
        nextCursor: rn.nextCursor, candidateCursor: rn.candidateCursor, hasMore: rn.hasMore, snapshotScanDone: rn.snapshotScanDone}));
      if (newProgress <= progress && rn.snapshotScanDone !== true && rn.hasMore === true) stuck++;
      else stuck = 0;
      progress = Math.max(progress, newProgress);
      cursor = Number(rn.nextCursor || cursor);
      done = rn.hasMore !== true || rn.snapshotScanDone === true;
      connAssertV1_(stuck < 3, c.name + ": con trỏ bị kẹt ở trang " + pages + " (nextCursor=" + rn.nextCursor + ")");
    }
    return {case: c.name, pages: pages, shown: totalShown, progress: progress, done: done};
  });
  var out = {success: true, code: "CUSTOMER_CONNECTION_FIX16_PASS_V1", cases: report};
  Logger.log(JSON.stringify(out));
  return out;
}

function connAssertV1_(cond, msg) {
  if (!cond) throw new Error("CUSTOMER_CONNECTION_FAIL_V1: " + msg);
}
