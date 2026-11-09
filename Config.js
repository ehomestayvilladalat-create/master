/** Booking Engine V3.2.0 - tách CONFIG ẢNH và CONFIG THÔNG TIN */
var BE_CONFIG = {
  VERSION: "5.0.0-v30-accuracy-first-dev",
  MASTER_SHEET: "MASTER",
  MASTER_VILLA_SHEET: "MASTER_VILLA",
  CALENDAR_METADATA_SHEET: "CALENDAR_METADATA",
  DEFAULT_READER: "AUTO",
  CACHE_SECONDS: 120,
  MAX_RUNTIME_MS: 280000,

  // V2.3 Fast Search: cache dữ liệu tĩnh + đọc lịch theo cột cần thiết.
  FAST_SEARCH_ENABLED: true,
  FAST_SEARCH_MASTER_CACHE_SECONDS: 300,
  FAST_SEARCH_MIN_COLUMNS: 12,
  FAST_SEARCH_COLUMN_MARGIN: 2,
  FAST_SEARCH_SKIP_NOTES: true,
  FAST_SEARCH_FULL_SCAN_ON_NAME_MISMATCH: true,
  FAST_SEARCH_TIMING_LOG: true,
  V30_CONTEXT_CACHE_ENABLED: true,
  V30_DEFAULT_PAGE_SIZE: 12,
  V30_EXHAUSTIVE_PRICE_SORT: true,
  V30_EVENT_LOG_ENABLED: true,
  V30_IMAGE_AUDIT_SHEET: "IMAGE_AUDIT_V3",
  V30_SYSTEM_EVENT_SHEET: "SYSTEM_EVENT_LOG_V3",

  // V2.1: cache ảnh vẫn bật, nhưng KHÔNG chạy nặng ngay trong Build Master.
  // Ảnh mới được đưa vào queue và xử lý bởi Image Worker chạy riêng.
  IMAGE_CACHE_ENABLED: true,
  IMAGE_CACHE_INLINE: false,
  IMAGE_RECHECK_SHARING_ON_HIT: false,
  IMAGE_WORKER_MAX_RUNTIME_MS: 220000,
  IMAGE_WORKER_SOURCES_PER_RUN: 2,
  IMAGE_QUEUE_SHEET: "IMAGE_CACHE_QUEUE_V2",

  // V2.1.1 DEV: tách hoàn toàn kho ảnh khỏi Production.
  // Để trống ID ở lần đầu: worker sẽ tự tạo folder DEV theo tên bên dưới.
  IMAGE_DRIVE_ISOLATED: true,
  IMAGE_DRIVE_FOLDER_ID: "",
  IMAGE_DRIVE_FOLDER_NAME: "EHOME_BOOKING_IMAGE_CACHE_DEV_V2",
  IMAGE_DRIVE_PROPERTY_KEY: "BE_IMAGE_DRIVE_FOLDER_ID_DEV_V2",

  // V3.4.0 storage hygiene. Chỉ áp dụng cho file cache EHOME_ trong folder cache.
  // Cache mồ côi phải đủ 7 ngày mới đưa vào Trash; file đang được MASTER dùng không đụng.
  IMAGE_CACHE_ORPHAN_RETENTION_DAYS: 7,
  IMAGE_CACHE_CLEANUP_MAX_DELETE: 50,
  IMAGE_CACHE_CLEANUP_TO_TRASH: true,
  STORAGE_MAINTENANCE_HANDLER: "runEhomeStorageMaintenanceV340",

  // MASTER có cấu hình riêng cho tên, lịch, ảnh và thông tin.
  MASTER_HEADERS: [
    "ID", "Thành phố", "Nguồn", "Link", "Enable",
    "CONFIG MASTER", "CONFIG LỊCH", "CONFIG ẢNH", "CONFIG THÔNG TIN", "LOẠI"
  ],

  // MASTER_VILLA chỉ lưu dữ liệu app/search thực sự dùng.
  MASTER_VILLA_HEADERS: [
    "MÃ CĂN", "ẢNH", "TÊN CĂN", "THÀNH PHỐ", "NGUỒN", "LINK LỊCH",
    "TIÊU CHUẨN", "PN", "THÔNG TIN", "MAPS", "CONFIG LỊCH", "CẬP NHẬT"
  ]
};

var CE_CONFIG = {
  MASTER_SHEET: "MASTER",
  MASTER_VILLA_SHEET: "MASTER_VILLA",
  DEFAULT_READER: "AUTO",
  AUTO_READER_FALLBACK: "COLUMN_V1",
  VILLA_NAME_SCAN_ROWS: 20,
  AUTO_SCAN_MAX_ROWS: 80,
  AUTO_SCAN_MAX_COLUMNS: 120,
  DATE_COLUMN_SCAN_LIMIT: 8,
  DATE_COLUMN_MIN_HITS: 3,
  UNAVAILABLE_KEYWORDS: ["coc","khach","book","booking","giu","tam giu","cho coc","da coc","co khach","full","het phong","kin lich"],
  CACHE_SECONDS: 120,

  // V2.3 Fast Search. CalendarReader V5.6 vẫn quyết định FREE/BUSY/giá.
  FAST_SEARCH_ENABLED: true,
  FAST_SEARCH_MIN_COLUMNS: 12,
  FAST_SEARCH_COLUMN_MARGIN: 2,
  FAST_SEARCH_SKIP_NOTES: true,
  FAST_SEARCH_FULL_SCAN_ON_NAME_MISMATCH: true,
  FAST_SEARCH_TIMING_LOG: true,
  V30_CONTEXT_CACHE_ENABLED: true,
  V30_ACCURACY_FIRST: true,
};
