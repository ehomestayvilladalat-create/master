# Chạy test ngoài Apps Script

Yêu cầu: Node 18+. Thư mục này KHÔNG được đẩy lên Apps Script (đã chặn trong `.claspignore`).

```bash
cd tools/local_test
npm install            # chỉ cần cho callgraph / check_undefined_calls
npm test               # chạy mọi hàm test* trong dự án
npm run flow           # mô phỏng chống căn ảo + mã căn qua nhiều lần build
npm run callgraph      # tìm hàm không còn đường gọi (ghi callgraph.json)
npm run undefined-calls
```

So sánh với bản gốc: `git worktree add /tmp/base ec54041` rồi `TZ=Asia/Ho_Chi_Minh node harness.js /tmp/base`.

## Giới hạn - đọc kỹ trước khi dùng con số

- Dịch vụ Google (SpreadsheetApp, DriveApp, UrlFetchApp, ScriptApp...) **không có thật** ở đây.
  Test nào chạm vào chúng bị đánh dấu `NEEDS_LIVE` và **không được tính là đạt**.
- PropertiesService, CacheService, LockService, Utilities, Logger là bản giả lập trong bộ nhớ.
- Kết quả "PASS" chỉ chứng minh logic thuần (không đọc Sheet thật) chạy đúng. Các test
  `NEEDS_LIVE` phải chạy trong Apps Script.
- Test cần tham số (testSnapshotABV320, testSearchAvailableVillasLimited) hoặc cần Telegram/OpenAI
  thật sẽ báo FAIL/RETURNED_FALSE ở đây; đó không phải lỗi code.
