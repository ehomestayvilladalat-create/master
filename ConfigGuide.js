/**
 * 11_ConfigGuide.gs
 * Tạo bảng hướng dẫn CONFIG tiếng Việt ngay trong file điều khiển.
 */
function createBookingConfigGuide() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = "HUONG_DAN_CONFIG";
  var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);

  var rows = [
    ["BOOKING ENGINE " + BE_CONFIG.VERSION, "", "", ""],
    ["QUY TẮC KẾ THỪA CONFIG", "", "", ""],
    ["CONFIG MASTER", "Cấu trúc gốc", "Xác định vùng tên, cột bắt đầu/kết thúc và thông tin chung ô tên", "AUTO hoặc FIXED_ROW=2;START_COL=2"],
    ["CONFIG ẢNH", "Chỉ ghi đè phần ảnh", "Kế thừa tên/cột từ CONFIG MASTER", "VÙNG_HÀNG_ẢNH=1"],
    ["CONFIG THÔNG TIN", "Chỉ kiểm lại thông tin", "Kế thừa tên/cột từ CONFIG MASTER", "HÀNG_THÔNG_TIN=2"],
    ["Mẫu ngắn khuyên dùng", "AUTO | AUTO | VÙNG_HÀNG_ẢNH=1 | HÀNG_THÔNG_TIN=2", "Theo thứ tự 4 cột CONFIG", "Không cần lặp TRANG_TÍNH/BỐ_CỤC"],
    ["Quy tắc chọn tab", "CONFIG THÔNG TIN ngắn bám tab lịch MASTER", "Chỉ đọc tab khác khi ghi rõ TRANG_TÍNH=Tên tab", "Chống lệch cột giữa các tab"],
    ["", "", "", ""],
    ["CONFIG ẢNH - BẢNG QUY ĐỔI", "", "", ""],
    ["Khóa tiếng Việt", "Khóa nội bộ", "Ý nghĩa", "Ví dụ / mặc định"],
    ["TRANG_TÍNH", "SHEET", "Tên tab hoặc chế độ tìm tab", "TỰ_ĐỘNG / LỊCH_MỚI_NHẤT / Thông tin"],
    ["BỐ_CỤC", "LAYOUT", "Mỗi căn nằm theo hàng hay cột", "TỰ_ĐỘNG / THEO_HÀNG / THEO_CỘT"],
    ["VÙNG_HÀNG_TÊN", "NAME_SCAN_ROWS", "Vùng AUTO dò hàng tên", "1-6"],
    ["VÙNG_HÀNG_ẢNH", "IMAGE_SCAN_ROWS", "Vùng AUTO dò ảnh", "1-6"],
    ["CỘT_BẮT_ĐẦU", "START_COL", "Cột bắt đầu, A=1", "2 hoặc 3"],
    ["HÀNG_TÊN", "NAME_ROW", "Hàng tên cố định", "2"],
    ["HÀNG_ẢNH", "IMAGE_ROW", "Hàng ảnh cố định", "5"],
    ["CỘT_TÊN", "NAME_COL", "Cột tên ở bố cục theo hàng", "A"],
    ["CỘT_ẢNH", "IMAGE_COL", "Cột ảnh ở bố cục theo hàng", "B"],
    ["SỐ_HÀNG_QUÉT", "SCAN_ROWS", "Giới hạn hàng tải", "80"],
    ["SỐ_CỘT_QUÉT", "SCAN_COLS", "Giới hạn cột tải", "120"],
    ["", "", "", ""],

    ["MẪU CONFIG ẢNH", "", "", ""],
    ["AUTO cơ bản", "TRANG_TÍNH=TỰ_ĐỘNG;BỐ_CỤC=TỰ_ĐỘNG;VÙNG_HÀNG_TÊN=1-6;VÙNG_HÀNG_ẢNH=1-6", "Tự tìm tab, tên và ảnh", "Khuyên dùng đầu tiên"],
    ["Ảnh trong tab lịch", "TRANG_TÍNH=LỊCH_MỚI_NHẤT;BỐ_CỤC=THEO_CỘT;VÙNG_HÀNG_TÊN=1-6;VÙNG_HÀNG_ẢNH=1-6", "Tên và ảnh cùng tab lịch", ""],
    ["Cố định", "TRANG_TÍNH=Thông tin;BỐ_CỤC=THEO_CỘT;CỘT_BẮT_ĐẦU=3;HÀNG_TÊN=2;HÀNG_ẢNH=5", "Nguồn ổn định", "Nhanh nhất"],
    ["", "", "", ""],

    ["CONFIG THÔNG TIN - BẢNG QUY ĐỔI", "", "", ""],
    ["Khóa tiếng Việt", "Khóa nội bộ", "Ý nghĩa", "Ví dụ"],
    ["TRANG_TÍNH", "SHEET", "Tab chứa thông tin", "TỰ_ĐỘNG / LỊCH_MỚI_NHẤT / Thông tin"],
    ["BỐ_CỤC", "LAYOUT", "Mỗi căn theo hàng hoặc cột", "TỰ_ĐỘNG / THEO_HÀNG / THEO_CỘT"],
    ["HÀNG_THÔNG_TIN", "INFO_ROW", "Một hàng chứa mô tả", "2"],
    ["VÙNG_HÀNG_THÔNG_TIN", "INFO_ROWS", "Một hoặc nhiều hàng cần ghép", "2 hoặc 2-5"],
    ["THÔNG_TIN_CÙNG_Ô_TÊN", "INFO_FROM_NAME_CELL", "Giữ nguyên mô tả nằm chung ô tên", "CÓ (mặc định khi kế thừa)"],
    ["HÀNG_MAPS", "MAPS_ROW", "Hàng chứa link Google Maps", "3"],
    ["HÀNG_TIÊU_CHUẨN", "STANDARD_ROW", "Hàng chỉ chứa số sức chứa", "4"],
    ["HÀNG_PHÒNG_NGỦ", "BEDROOMS_ROW", "Hàng chỉ chứa số phòng ngủ", "5"],
    ["CỘT_THÔNG_TIN", "INFO_COL", "Cột mô tả ở bố cục theo hàng", "C"],
    ["CỘT_MAPS", "MAPS_COL", "Cột Google Maps ở bố cục theo hàng", "D"],
    ["CỘT_TIÊU_CHUẨN", "STANDARD_COL", "Cột sức chứa", "E"],
    ["CỘT_PHÒNG_NGỦ", "BEDROOMS_COL", "Cột phòng ngủ", "F"],
    ["", "", "", ""],

    ["MẪU CONFIG THÔNG TIN", "", "", ""],
    ["Tên và mô tả chung ô", "THÔNG_TIN_CÙNG_Ô_TÊN=CÓ", "Giữ toàn bộ mô tả, tự tách tên/PN/sức chứa", "Mặc định đã bật"],
    ["Kiểm lại hàng thông tin", "HÀNG_THÔNG_TIN=2", "Dùng hàng 2 để kiểm/ghi đè thông tin", "Kế thừa cấu trúc MASTER"],
    ["Theo cột, khác hàng", "TRANG_TÍNH=Thông tin;BỐ_CỤC=THEO_CỘT;CỘT_BẮT_ĐẦU=3;HÀNG_TÊN=2;VÙNG_HÀNG_THÔNG_TIN=3-5;HÀNG_MAPS=6", "Mỗi căn một cột", ""],
    ["Theo hàng", "TRANG_TÍNH=Thông tin;BỐ_CỤC=THEO_HÀNG;HÀNG_TIÊU_ĐỀ=1;HÀNG_BẮT_ĐẦU=2;CỘT_TÊN=A;CỘT_THÔNG_TIN=C;CỘT_MAPS=D", "Mỗi căn một hàng", ""],
    ["Lưu ý PN/sức chứa", "Không đặt HÀNG_PHÒNG_NGỦ hoặc HÀNG_TIÊU_CHUẨN nếu ô đó là cả đoạn văn", "Engine sẽ tự trích 3PN, 10 khách... từ THÔNG TIN", ""],
    ["", "", "", ""],

    ["NGUYÊN TẮC AN TOÀN TÊN CĂN", "", "", ""],
    ["Tên nhiều dòng", "Dòng có nội dung đầu tiên là tên", "Các dòng sau vẫn giữ trong THÔNG TIN", ""],
    ["Tên và mô tả cùng dòng", "Cắt tại Gồm / Cơ cấu / Sức chứa / Tiêu chuẩn / Tối đa / Giá: / Địa chỉ:", "Không cắt hậu tố tên như Villa 6PN hoặc White II 8.2", ""],
    ["Ghép metadata", "Ưu tiên tên khớp tuyệt đối và cùng cột", "Không khớp thì ghi INFO_COLUMN_NAME_MISMATCH, không ghép đoán", ""],
    ["Loại tên giả", "Tên / Tên căn / địa chỉ bắt đầu bằng Hẻm, Đường...", "Không đưa tiêu đề hoặc địa chỉ vào MASTER_VILLA", ""],
    ["", "", "", ""],

    ["THỨ TỰ TEST", "1. testConfigTiengVietV36", "2. buildMasterVilla", "3. kiểm tra MASTER_VILLA"]
  ];

  // Luôn ép mỗi dòng đúng 4 cột để setValues không lỗi khi sửa hướng dẫn.
  rows = rows.map(function(row) {
    var normalizedRow = (row || []).slice(0, 4);
    while (normalizedRow.length < 4) normalizedRow.push("");
    return normalizedRow;
  });

  sheet.getDataRange().breakApart();
  sheet.clear();
  sheet.getRange(1, 1, rows.length, 4).setValues(rows);
  sheet.setFrozenRows(3);
  sheet.autoResizeColumns(1, 4);
  sheet.setColumnWidth(1, 210);
  sheet.setColumnWidth(2, 650);
  sheet.setColumnWidth(3, 350);
  sheet.setColumnWidth(4, 230);
  sheet.getDataRange().setWrap(true).setVerticalAlignment("top");

  var titleNames = {
    "QUY TẮC KẾ THỪA CONFIG": true,
    "CONFIG ẢNH - BẢNG QUY ĐỔI": true,
    "MẪU CONFIG ẢNH": true,
    "CONFIG THÔNG TIN - BẢNG QUY ĐỔI": true,
    "MẪU CONFIG THÔNG TIN": true,
    "NGUYÊN TẮC AN TOÀN TÊN CĂN": true
  };

  rows.forEach(function(row, index) {
    var rowNumber = index + 1;
    if (index === 0 || titleNames[row[0]]) {
      sheet.getRange(rowNumber, 1, 1, 4).merge();
      sheet.getRange(rowNumber, 1, 1, 4)
        .setFontWeight("bold")
        .setBackground("#1F6B4F")
        .setFontColor("#FFFFFF");
    }
  });

  return {
    success: true,
    sheet: sheetName,
    version: BE_CONFIG.VERSION,
    rows: rows.length
  };
}
