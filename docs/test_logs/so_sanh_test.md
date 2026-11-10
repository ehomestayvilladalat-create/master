# So sánh từng test: bản gốc ec54041 -> bản mới

| Test | Bản gốc | Bản mới | Ghi chú |
|---|---|---|---|
| testAiBreakerRulesV1 | (không có) | PASS | test mới |
| testBatchedRowDeleteB7 | (không có) | PASS | test mới |
| testBlankCellUnknownB6 | (không có) | PASS | test mới |
| testColoredCellBusyV1 | (không có) | PASS | test mới |
| testConfiguredDateColumnSafetyV2 | FAIL | PASS | test cũ cập nhật theo hành vi có chủ đích |
| testGhostGuardV1 | (không có) | PASS | test mới |
| testImageOverrideReconcileV330_ | PASS | (đã gỡ) | hàm test nội bộ (_) đã gỡ ở B8 |
| testMasterSafeConfigV414_ | PASS | (đã gỡ) | hàm test nội bộ (_) đã gỡ ở B8 |
| testNamelessPriceColumnsB3 | (không có) | PASS | test mới |
| testNewYearCalendarB5 | (không có) | PASS | test mới |
| testNoAccessCacheB10 | (không có) | PASS | test mới |
| testPriceEngineV30 | FAIL | PASS | test cũ cập nhật theo hành vi có chủ đích |
| testQualityFixesV1 | (không có) | PASS | test mới |
| testSearchPatchV2UnitSuite | FAIL | PASS | test cũ cập nhật theo hành vi có chủ đích |
| testSearchShuffleV340_ | PASS | (đã gỡ) | hàm test nội bộ (_) đã gỡ ở B8 |
| testSourceProductTypeInheritanceV2 | FAIL | PASS | test cũ cập nhật theo hành vi có chủ đích |
| testTabYearPolicyB4 | (không có) | PASS | test mới |
| testVillaIdentityReviveRetiredV1 | (không có) | PASS | test mới |
| testXlsxTempDecisionV1 | (không có) | PASS | test mới |

195 test khác có kết quả GIỐNG HỆT nhau ở hai bản (kể cả các test NEEDS_LIVE vẫn NEEDS_LIVE).

Tổng bản gốc: {"PASS":108,"NEEDS_LIVE":82,"RETURNED_FALSE":2,"FAIL":10}
Tổng bản mới: {"PASS":121,"NEEDS_LIVE":82,"RETURNED_FALSE":2,"FAIL":6}
