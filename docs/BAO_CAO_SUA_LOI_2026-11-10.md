# EHOME BOOKING - Báo cáo sửa lỗi theo danh sách ngày 10/11/2026

Nhánh: `claude/che-do-cuc-cao-giao-viec-1q8c1w`. Mốc gốc (code live chưa sửa): commit `ec54041`.

## Cách em kiểm chứng - và giới hạn của nó

- Bộ chạy test ngoài Apps Script nằm trong repo: `tools/local_test/` (Node + giả lập dịch vụ Google, xem README ở đó). Không đẩy lên Apps Script.
- Đã chạy **toàn bộ hàm test có sẵn trên bản gốc `ec54041` và bản mới**, log đầy đủ:
  `docs/test_logs/test_base.txt`, `docs/test_logs/test_head.txt`, so sánh từng test: `docs/test_logs/so_sanh_test.md`.
  - Bản gốc: 108 PASS, 82 NEEDS_LIVE, 10 FAIL, 2 RETURNED_FALSE.
  - Bản mới: 121 PASS, 82 NEEDS_LIVE, 6 FAIL, 2 RETURNED_FALSE.
  - **Ý nghĩa đúng của con số:** PASS chỉ chứng minh phần logic không đọc Sheet thật chạy đúng.
    **82 test NEEDS_LIVE chưa được chạy** (cần Google Sheet/Drive thật) - kết quả của chúng chưa biết,
    phải chạy trong Apps Script. 6 FAIL + 2 RETURNED_FALSE còn lại là do máy kiểm tra không có
    Telegram/OpenAI hoặc test cần tham số ngày, không phải lỗi code.
  - Không test nào từ PASS chuyển sang FAIL.
- Toàn bộ thay đổi code so với bản gốc: `docs/DIFF_ec54041_den_ban_moi.patch` (không gồm docs/ và tools/).
- Mô phỏng từng tình huống trong danh sách lỗi bằng code thật: căn biến mất qua 2 lần build, căn quay lại, nguồn giảm >30%, tên tab "Th 01.1027", "Tháng 11.2025", tìm căn qua giao thừa...
- Quét toàn bộ code bằng bộ phân tích cú pháp: không có lời gọi nào tới hàm không tồn tại (cả trước và sau khi gỡ hàm chết).

## Bảng trạng thái

Ký hiệu: **[ĐÃ SỬA]** đã sửa và kiểm chứng ngoài Apps Script · **[CHỜ ANH]** cần anh quyết hoặc cần link · **[XEM SAU PUSH]** chỉ xác nhận được khi chạy thật.

### B. Lỗi trong code

| Mục | Trạng thái | Đã làm |
|---|---|---|
| B1 Căn ảo | [ĐÃ SỬA] | Nguyên nhân gốc: khi một căn biến mất khỏi nguồn đang bật, code khóa **cả nguồn** chờ Structure Snapshot xác nhận, nhưng 2 đường xác nhận đều hay tắc (bắt bộ đọc AUTO khớp y hệt; cờ xác nhận bị xóa sau khi baseline nhận danh sách mới) => căn ảo tồn tại mãi và nguồn không nhận căn mới. Thêm `GhostGuard.js`: cùng danh sách căn đọc được ở 2 lần build liên tiếp (trong 72 giờ) thì ẩn căn biến mất (RETIRED, giữ mã). Giảm >30% **và** mất từ 2 căn trở lên trong 1 lần đọc => không ẩn gì, báo Telegram 1 lần, anh duyệt bằng `ghostApproveSourceV1("ID")`. Tối đa 40 căn ẩn mỗi build. Tab `GHOST_PREVIEW` ghi mọi quyết định (mới nhất ở trên). Nguồn đọc 0 căn/lỗi: giữ căn cũ như trước. |
| B2 Mã căn | [ĐÃ SỬA] | (1) Căn RETIRED quay lại nguồn lấy lại đúng mã cũ (khớp nguồn + tên/tên cũ; trùng tên thì phải khớp cột; mơ hồ thì không ghép). (2) Sửa lỗi tìm thấy: đổi tên được xác nhận (quy tắc V4194) làm sổ mã retire mã cũ trong khi MASTER_VILLA vẫn dùng nó => **lần build sau căn bị cấp mã mới, lệch ảnh**. Lỗi này sẽ xảy ra nhiều khi bật B1 nên đã sửa: sổ mã ghi nhận đúng là đổi tên của mã cũ. (3) Không dùng mã cũ nếu sổ mã đã gán mã đó cho căn khác. |
| B3 Cột có giá thiếu tên | [ĐÃ SỬA] | Cột trong vùng cấu hình có >= 3 ô giá mà hàng tên trống => cảnh báo ngay trong cột trạng thái của nguồn ở tab MASTER (vd "cột D, F có giá nhưng hàng tên (hàng 3) trống - căn ở cột này đang bị bỏ qua") + 1 sự kiện tổng hợp trong SYSTEM_EVENT_LOG_V3. Với cấu hình sai của thảo anh (FIXED_ROW=2), cảnh báo chỉ ra luôn nguyên nhân đọc 0 căn. |
| B4 Năm của tên tab | [ĐÃ SỬA] | "Th 01.1027" không còn bị hiểu là 1/2026: chỉ nhận khi tháng nằm trong ±1 tháng hiện tại, ngoài ra bỏ qua + cảnh báo. Đối chiếu thứ-ngày trong tab để cảnh báo tab ghi sai năm ("Tháng 11.2025" thực tế là 11/2026 vì ngày 1 là Chủ nhật). **Lỗi thêm tìm được:** tab không ghi năm ("Tháng 1") luôn bị gán năm hiện tại => tháng 12/2026 việc chuyển sang tab tháng 1 sẽ hỏng. Đã sửa. |
| B5 Quy tắc chọn tab | [ĐÃ SỬA] | Bộ đọc tháng đã dùng chung một bộ chuẩn hóa (kiểm 46 kiểu tên tab: khớp nhau). Phần khác nhau là đoán năm => gom về 1 quy tắc `ceSheetYearForDateB5_` dùng cho build MASTER, tìm căn, snapshot, cột ẩn. **Lỗi thật đã chứng minh và sửa:** tìm căn 2-3/1/2027 ở nguồn có tab "Tháng 12" kéo sang tháng 1 => bản cũ báo "Không tìm thấy lịch", bản mới đọc đúng giá. Nhận thêm tên tab viết tắt "Th 11" (trước đây không nhận ra tháng). Hai bộ chọn tab (build MASTER theo ngày hôm nay / tìm căn theo ngày khách ở) phục vụ 2 câu hỏi khác nhau nên giữ cả hai, nhưng giờ cùng một quy tắc đọc tên tab. |
| B6 Ô trắng không giá | [ĐÃ SỬA - ĐỔI LẠI 10/11] | **Cập nhật 10/11: B6 MẶC ĐỊNH TẮT, quy tắc đã chốt trắng = trống.** Bật toàn hệ thống: Script Property `BE_B6_WHITE_NO_PRICE` = `CHUA_RO`. Bật/tắt theo nguồn: CONFIG LỊCH `O_TRANG_KHONG_GIA=CHUA_RO` hoặc `=TRONG` (nguồn thắng toàn hệ thống). Phần dưới mô tả khi B6 được bật. Bản trước: theo quyết định của anh: **chưa rõ**, không coi là trống. Chỉ áp dụng cho cột có thói quen ghi giá (>= 3 ô và >= 20% ngày có giá) để không làm mất cả nguồn không ghi giá vào ô lịch. Áp dụng thống nhất cho đọc trực tiếp, snapshot (kể cả snapshot cũ) và web khách. Màn nội bộ hiện "💬 Ô lịch để trắng nhưng chưa có giá – hỏi chủ nhà trước khi chốt". (Cách bật/tắt: xem đầu dòng này. Mặc định: tắt.) |
| B7 Tốc độ | [ĐÃ SỬA] + [XEM SAU PUSH] | Gắn đồng hồ đo từng bước của build (mở file, chọn tab, đọc ảnh/thông tin, đọc tên căn, đối chiếu/mã căn, xử lý từng căn, ghi kết quả), in 10 nguồn chậm nhất; xem lại bằng `showLastBuildTimingB7()`. Đã bỏ các lệnh chậm chắc chắn: tự chỉnh độ rộng cột MASTER_VILLA (vài giây/build, chỉ để đẹp, bật lại bằng `MASTER_AUTO_RESIZE_COLUMNS: true`), xóa dòng từng cái khi gỡ nguồn tắt (giờ xóa theo khối), log hệ thống khi đầy (xem C2), mở lại file bị chặn quyền mỗi lần tìm (xem B10). Số đo thật cần 1 lần build sau khi push. |
| B8 Hàm trùng/chết | [ĐÃ SỬA] | Gỡ 41 hàm nội bộ không còn đường gọi (dựng đồ thị gọi hàm bằng parser), có `aiGetPropertyV31FallbackTelegram_`, `buildMasterVillaLegacy_`... 236 hàm public chỉ chạy tay được **giữ lại** và liệt kê trong `docs/B8_HAM_KHONG_DUNG.md` để duyệt. Cập nhật 4 test cũ hỏng vì viết theo hành vi trước các thay đổi có chủ đích. |
| B9 Đẩy nhầm backup | [ĐÃ SỬA] | `.claspignore` chặn `_backup_*`, `docs/`, `tools/`, `*.md`, `package.json`, file ẩn. |
| B10 Quyền truy cập nguồn | [ĐÃ SỬA] | Đã kiểm chứng: web khách và web nội bộ **đều bỏ qua đúng** nguồn bị chặn (không hiện là trống; lịch tháng hiện "Liên hệ"). Thêm: nhớ file bị chặn 15 phút để không mở lại mỗi lần tìm (1-3 giây/nguồn). Cột "Dòng MASTER" của NO_ACCESS_SOURCES giờ tính lại từ ID mỗi lượt chạy (bản cũ chỉ ghi 1 lần nên lệch khi MASTER chèn/xóa dòng). |

### C. AI và log

| Mục | Trạng thái | Đã làm |
|---|---|---|
| C1 Ngắt mạch AI | [ĐÃ SỬA] | **Chỉ giữ MỘT bản `AiService.js`: bản trong nhánh/zip này** (= bản live gốc + ngắt mạch, commit `8698b11`, sha256 bắt đầu `44163bec2e8d0720`). **Không dùng** file `AiService.js` đã gửi riêng trong chat trước đây - hai bản khác nhau, chép đè sẽ mất phần ngắt mạch này hoặc lệch tên hàm. Code anh gửi chưa có bản ngắt mạch nên em viết lại trong `AiService.js`: 401/402/403 hoặc 429 do hết hạn mức => ngưng gọi OpenAI 1 giờ, tự thử lại mỗi giờ, báo Telegram 1 lần mỗi đợt (+1 lần khi hoạt động lại), ghi SYSTEM_EVENT_LOG_V3. `aiResetBreakerV1()` mở ngay sau khi nạp tiền, `getAiBreakerStatusV1()` xem trạng thái. Tìm căn/lịch/giá không dùng AI nên không bị ảnh hưởng. Model rẻ hơn: đặt Script Property `OPENAI_MODEL` (em không đoán tên model). |
| C2 Log lỗi | [ĐÃ SỬA] | `cleanupSystemEventsV340_` chạy đúng logic nhưng gọi sai nhịp: khi log đầy 2.500 dòng thì **mỗi sự kiện** đều xóa 1 dòng và đọc lại 2.500 ô thời gian. Giờ dọn theo lô 100 dòng; vẫn dọn dòng cũ hơn 7 ngày định kỳ. |
| C3 Ảnh dev/live | [ĐÃ KIỂM TRA] + [XEM SAU PUSH] | Dự án này chỉ ghi ảnh vào **một** thư mục (tên `EHOME_BOOKING_IMAGE_CACHE_DEV_V2`, ID cố định trong Script Property). Không có code nào ghi vào thư mục khác. Hàm chỉ đọc `checkImageFolderC3()` cho số liệu thật: ảnh MASTER_VILLA nằm trong/ngoài thư mục đó. |

### A. Cấu hình MASTER và D. Việc chờ

| Mục | Trạng thái | Ghi chú |
|---|---|---|
| A1 an vy | [XEM SAU PUSH] | Cấu hình đã đúng; sau build kiểm tra cột trạng thái "OK: 2 căn". Dọn link gid: xem A7. |
| A2 Kimi | [CHỜ CHỦ NGUỒN] | Code đã cảnh báo cột H, O (B3). Cần chủ nguồn đặt tên H4, O4. |
| A3 mp phương | [XEM SAU PUSH] | Sau build: trạng thái phải là "OK: 8 căn". |
| A4 Palm Villa | [CHỜ ANH] | Bật hay chưa? Và ý nghĩa ô "6000 duy", "3500 kch viva" (xem câu hỏi). |
| A5 thảo anh | [CHỜ ANH] | Chọn phương án (a) hay (b). |
| A6 The Min'n House | [CHỜ CHỦ NGUỒN] | Code đã cảnh báo tab ghi sai năm. Chủ nguồn đổi tên tab thành "Tháng 11.2026" rồi xóa `CALENDAR_SHEET=...` khỏi G198. Lưu ý: khi còn tên "Tháng 11.2025", bộ tìm căn hiểu ngày trong tab là năm 2025, nên cách tạm `CALENDAR_SHEET` chỉ giúp đọc tên căn, chưa chắc đọc được lịch tháng 11/2026. |
| A7 Link gid cũ | [CHỜ LINK] | Cần link sheet MASTER để em dọn. |
| D BEOHI STAY, LaLa House, màu vàng | [CHỜ ANH] | Cần link B của BEOHI, câu trả lời LaLa, và quy ước màu vàng. Hiện tại code: trắng = trống, mọi màu khác (kể cả vàng) = bận, trừ khi CONFIG LỊCH khai báo màu trống. |


## Review 10/11/2026 - các mục bổ sung

| # | Trạng thái | Kết quả |
|---|---|---|
| 1 | [ĐÃ SỬA] | B6 mặc định tắt (trắng = trống). Công tắc `BE_B6_WHITE_NO_PRICE` và tùy chọn theo nguồn giữ nguyên để bật lại. Test: `testBlankCellUnknownB6`. |
| 2 | [ĐÃ SỬA] | `ceFreeColorConfigIssuesV1_`: tên màu không hỗ trợ (vd `NAU`), mã màu sai (`#ff0`), khóa màu trùng bị bỏ qua (vd có cả `FREE_COLORS` và `MAU_TRONG`) => cảnh báo ở cột trạng thái MASTER mỗi build và trong Config Doctor. Cách đọc màu không đổi. |
| 3 | [ĐÃ TÌM 1 NGUYÊN NHÂN + CÔNG CỤ] | Test 11 màu nền (đỏ, vàng, vàng nhạt, xám rất nhạt `#f3f3f3`, gần trắng `#fffffe`, nâu…), chữ hoa/thường, ô gộp: **đều ra BẬN** => bộ đọc màu đúng. Tìm được 1 lỗ hổng: ô ngoài vùng đã tải bị coi là nền trắng => TRỐNG; đã sửa thành CHƯA RÕ. Các nguyên nhân khác không tái hiện được bằng code vì nằm ở dữ liệu thật, nghi nhất là **định dạng có điều kiện** và **dải màu xen kẽ** (Apps Script `getBackgrounds()` không thấy 2 loại màu này). Công cụ chỉ đọc: `diagnoseCellColorV1("mã căn","yyyy-MM-dd")` cho biết đúng ô app đọc, màu app thấy, màu thật, quy tắc có điều kiện, banding, snapshot; `auditConditionalColorsV1()` rà mọi nguồn đang bật. Test: `testColoredCellBusyV1`. |
| 4 | [ĐÃ GHI] | Xem dòng C1: chỉ giữ `AiService.js` trong nhánh/zip này. |
| 5 | [CHỜ ANH ĐỒNG Ý] | Đã đổi tên `SourceXlsxOpenV_FIX.js` → `SourceXlsxOpen.js` (tên hàm giữ nguyên). Phương án xóa xem mục "Đề xuất dọn file" bên dưới - **chưa xóa gì**. |
| 6 | [ĐÃ BỔ SUNG] | Zip giờ có `docs/` và `tools/`; log test thật + diff như mục "Cách em kiểm chứng". Con số test đã ghi rõ phần chưa chạy. |
| 7 | [ĐÃ SỬA - CHỜ ANH CHỐT SỐ GIỜ] | Hai lần đọc phải cách nhau ít nhất `BE_GHOST_MIN_GAP_HOURS` giờ (tạm mặc định **6**); build dày trong khoảng đó không được tính thêm. Đổi số giờ: Script Property, không cần sửa code. |
| 8 | [ĐÃ SỬA] | Toàn bộ trạng thái GhostGuard trong **1** Script Property `BE_GHOST_STATE_V2` (tự dọn mục quá 72 giờ, duyệt hết hạn 7 ngày, tối đa 8 KB). Khóa kiểu cũ tự chuyển rồi xóa. `ghostStatusV1()` hiện tổng số Script Property và kích thước. |
| 9 | [KHÔNG PHẢI THAY ĐỔI CỦA BẢN NÀY] | "Liên hệ kiểm tra lịch" có sẵn trong code gốc `ec54041` (`SearchEngine.js:358`, nhánh V7 NO_CALENDAR_MONTH): nguồn chưa mở tab tháng thì căn vẫn hiện, giá ghi "Liên hệ kiểm tra lịch", áp dụng cho cả web khách lẫn nội bộ. Cần anh xác nhận có giữ cho web khách không. |
| 10 | [ĐÃ SỬA - CẦN CHẠY THẬT] | Bản cũ chuyển đổi lại file .xlsx **mỗi lần mở** (mỗi build, mỗi lượt tìm căn, mỗi snapshot) => chậm vài giây và thêm 1 file vào thùng rác Drive mỗi lần. Giờ dùng lại bản tạm khi file gốc chưa đổi, khóa khi chuyển đổi. **Chưa chạy thật**: chạy `testXlsxSourceOpenV_FIX()` 2 lần trên nguồn pontus; lần 2 phải có `XLSX_SOURCE_TMP_REUSED_V1`. |

### Đề xuất dọn file (mục 5) - chờ anh đồng ý, CHƯA làm

Trước khi dọn: chạy `checkTriggerHandlersV1(["startSearchBenchmarkV1","runNextSearchBenchmarkV1","startSearchBenchmarkV2","runNextSearchBenchmarkV2"])` để chắc không trigger nào trỏ vào hàm sắp gỡ.

| File | Kích thước | Code khác có gọi không | Đề xuất |
|---|---|---|---|
| `test.js` | 99 KB, 74 hàm | **Có, 13 hàm (~20 KB):** 4 mục menu Admin (Test nhanh, Test V3 Core, Test Calendar A/B, Benchmark), 6 test của `testEhomeRegressionSuiteV620`, công cụ thật `previewStaticInfoIntegrityV418` | Tách 13 hàm sang `RegressionTestsCore.js`, chuyển 61 hàm còn lại ra `tools/legacy_tests/` (vẫn trong repo, không đẩy lên Apps Script). |
| `OpsTests.gs.js` | 2,5 KB | Không | Chuyển ra `tools/legacy_tests/`. |
| `PnOverrideTestV1.js` | 1,6 KB | Không (bản nháp test) | Chuyển ra `tools/legacy_tests/`. |
| `AuditNoAccessSources.js` | 4,6 KB | Không (công cụ audit chạy tay) | Chuyển ra, hoặc giữ nếu anh còn dùng. |
| `PROPERTIES_DOCTOR.gs.js` | 0,9 KB | Không (`propertiesDoctor` chạy tay) | Chuyển ra; `ghostStatusV1()` đã đếm Script Property. |

## Triển khai

1. Lấy code nhánh `claude/che-do-cuc-cao-giao-viec-1q8c1w` (hoặc file zip em gửi), chép đè vào thư mục app_live. Xóa file cũ `SourceXlsxOpenV_FIX.js` trong app_live (đã đổi tên). `clasp push`.
2. Trong Apps Script chạy `testQualityFixesV1` => phải thấy `QUALITY_FIXES_PASS_V1`.
3. Build Master như bình thường **2 lần**. Xem tab `GHOST_PREVIEW` và cột trạng thái tab MASTER (dòng có ⚠ là nguồn cần xem).
4. Chạy `showLastBuildTimingB7` và `checkImageFolderC3`, gửi log cho em.

## Quay lại bản cũ nếu cần

- Tắt riêng chống căn ảo: Script Property `BE_GHOST_GUARD_V1_DISABLED` = `TRUE`.
- B6 đã tắt mặc định; nếu đã bật bằng Script Property thì xóa `BE_B6_WHITE_NO_PRICE`.
- Quay lại toàn bộ: lấy code ở commit `ec54041` rồi `clasp push`.
