# B8 - Hàm không còn được gọi (báo cáo tự động)

Công cụ: phân tích cú pháp toàn bộ file .js (acorn) + quét Index.html, dựng đồ thị gọi hàm.
Gốc của đồ thị: mọi hàm public (chạy tay/trigger/google.script.run), code top-level, chuỗi tên hàm (trigger, menu, danh sách test), doGet/doPost/onOpen.

## 1. Đã gỡ: 41 hàm nội bộ (tên kết thúc bằng `_`) không thể chạy tay và không còn đường gọi nào

Hàm có tên kết thúc bằng `_` không hiện trong menu Run của Apps Script và không gọi được từ web, nên không có đường gọi = chắc chắn không chạy.

| File | Hàm | Byte |
|---|---|---|
| Admin.js | `beLogSystemErrorV34_` | 389 |
| Admin.js | `beReadSystemErrorsV34_` | 395 |
| CalendarContext.js | `ceMarkSafeFallbackV30_` | 387 |
| CalendarReader.js | `ceHueBusyV34_` | 175 |
| ConfigDoctorV41.js | `opsV41Clone_` | 126 |
| CustomerApi.js | `ceCustomerFeaturedMapV616_` | 249 |
| ImageAudit.js | `beImageAuditQueueMapV30_` | 76 |
| ImageDriveCache.js | `beExportSpreadsheetXlsxFilesV14_` | 124 |
| MasterEngine.js | `buildMasterVillaLegacy_` | 3807 |
| MasterEngine.js | `beRenameSkuMapV416_` | 299 |
| MasterEngine.js | `testImageOverrideReconcileV330_` | 796 |
| MasterEngine.js | `beFindInfoSheetV31_` | 119 |
| MasterEngine.js | `beFindOverGridImageForColumnV40_` | 174 |
| MasterEngine.js | `testMasterSafeConfigV414_` | 2043 |
| PriceEngine.js | `cePriceFilterIsActiveV30_` | 153 |
| ScheduleSnapshot.js | `ssEncodeNightCellV320_` | 539 |
| ScheduleSnapshot.js | `ssQueueScheduleSourceV320_` | 811 |
| SearchEngine.js | `ceSortBestCapacityFirstV332_` | 1642 |
| SearchEngine.js | `ceSortableTotalPriceV332_` | 238 |
| SearchEngine.js | `testSearchShuffleV340_` | 834 |
| SearchTraceDoctorV1.js | `stMatchesSelectorLooseV12_` | 302 |
| SourceAccess.js | `saGetMasterSheetV1_` | 276 |
| SourceAccess.js | `saGetNoAccessCountV1_` | 81 |
| SourceAccess.js | `saIsNoAccessSourceV1_` | 122 |
| StructureSnapshot.js | `ssStructureSetDiffRatioV320_` | 370 |
| TelegramBot.js | `aiGetPropertyV31FallbackTelegram_` | 82 |
| TelegramBot.js | `tgHelpV312_` | 48 |
| TelegramBot.js | `tgFormatImageV31_` | 67 |
| TelegramBot.js | `tgFormatSourcesV312_` | 676 |
| TelegramBot.js | `tgFormatOneSourceV312_` | 190 |
| Utils.js | `beNowIso_` | 56 |
| Utils.js | `beJson_` | 57 |
| Utils.js | `ceParseInteger_` | 122 |
| Utils.js | `ceCleanVillaName_` | 174 |
| Utils.js | `ceSimplifyVillaName_` | 202 |
| Utils.js | `ceLooksLikeVillaName_` | 515 |
| Utils.js | `ceParseCalendarDate_` | 1191 |
| Utils.js | `ceSameDate_` | 158 |
| Utils.js | `ceHexToRgb_` | 288 |
| Utils.js | `ceIsRed_` | 212 |
| Utils.js | `ceIsYellow_` | 197 |

Kiểm chứng sau khi gỡ: toàn bộ test chạy được ngoài Apps Script cho kết quả giống hệt trước khi gỡ (trừ 3 test nội bộ đã gỡ).

## 2. Giữ lại, cần người quyết: 236 hàm public không có code nào gọi

Các hàm này chỉ chạy khi có người bấm Run trong Apps Script (hoặc trigger cài tay). Không gỡ tự động.

### 2a. Hàm test chạy tay: 162 hàm (127 KB)

- **Admin.js** (1): `testMasterIncrementalDisabledEmptyNoopV6110`
- **AiConfigApply.js** (4): `testAiApplyStatusGuardV4222`, `testAiVillaCapacityRangeV13`, `testAiConfigIgnoreV4221`, `testAiConfigApplyGuardsV1`
- **AiConfigDoctor.js** (3): `testAiModeSelectionV4222`, `testAiConfigDoctorV1ChonVilla`, `testAiConfigManualOnlyV12`
- **AiConfigValidator.js** (3): `testAiConfigValidatorV1NoWrite`, `testAiVillaFactsBungalowRuleV11`, `testAiVillaFactsOptimisticLockV12`
- **AiHealthWatch.js** (2): `testHealthWatchButtonsV4221`, `testHealthWatchV315`
- **AiProjectBrain.js** (1): `testAiProjectBrainV4222`
- **AiService.js** (1): `testOpenAiV31`
- **AiSourceInspector.js** (3): `testAiSourceInspectorV1ChonVilla`, `testAiSourceInspectorV12Kina`, `testAiSourceFastV4222`
- **AiTools.js** (1): `testAiToolsV31`
- **Api.js** (1): `testPublicApiBoundaryV61`
- **AutoSync.js** (2): `testEhomeAutoSyncNow`, `testEhomeAutoSyncStatus`
- **CalendarReader.js** (4): `testInlineMonthMarkerCalendarV4223`, `testNhaChangVangCalendarLiveV4223`, `testCalendarSheetMonthAnchorV58`, `testCalendarRawYearAnchorV58`
- **ConfigDoctor.js** (18): `testConfigDoctorGrammarV327`, `testConfigDoctorNewSourcePendingV4211`, `testConfigDoctorDeepV4`, `testConfigDoctorDeepV4_10_19`, `testConfigDoctorDeepV4_20_29`, `testConfigDoctorDeepV4_30_39`, `testConfigDoctorDeepV4_40_49`, `testConfigDoctorDeepV4_50_59`, `testConfigDoctorDeepV4_60_69`, `testConfigDoctorDeepV4_70_79`, `testConfigDoctorDeepV4_80_89`, `testConfigDoctorDeepV4_90_99`, `testConfigDoctorDeepV4_100_109`, `testConfigDoctorDeepV4_110_119`, `testConfigDoctorDeepV4_120_129`, `testConfigDoctorDeepV4_130_139`, `testConfigDoctorDeepV4_140_149`, `testConfigDoctorDeepV4_150_150`
- **ConfigDoctorV41.js** (2): `testConfigDoctorDeepV41_ALL`, `testConfigDoctorV41Grammar`
- **CustomerApi.js** (7): `testCustomerRoomGroupingV616`, `testCustomerSanitizeDriverV616`, `testCustomerPricingV61`, `testCustomerSanitizeV61`, `testCustomerProductTypeV61`, `testCustomerLegacyWholeVillaV619`, `testCustomerSecurityV61`
- **CustomerConnectionCheckV1.js** (1): `testCustomerConnectionFix16V1`
- **CustomerPriority.js** (1): `testCustomerPriorityLogicV617`
- **GhostGuard.js** (1): `testGhostGuardV1`
- **ImageDriveCache.js** (2): `testImageDriveCacheV17`, `testDriveFolderParserV4224`
- **ImageWorker.js** (1): `testImageWorkerV330`
- **MaintenanceV620.js** (1): `testEhomeRegressionSuiteV620`
- **MasterEngine.js** (13): `testMasterActiveCalendarPolicyV4210`, `testNumericFixedRowRoomCodesV4223`, `testSachiNumericRoomsLiveV4223`, `testNhaChangVangSheetSelectionV4223`, `testMasterLeadingSpaceSourceV4210`, `testMasterKinaCalendarLockV4210`, `testAutoRowMergedInstructionV341`, `testDeletedSourceAutoGuardV619`, `testOverGridPriorityV415`, `testPrivateRoomPersistenceV4224`, `testDriveFolderImageSourceV4224`, `testLynsPrivateRoomsLiveV4224`, `testDriveFolderCalendarFallbackV4224`
- **OpsTests.gs.js** (4): `testFullOpsV312`, `testTelegramOpsV312`, `testSourceHealthV313`, `testHealthWatchAntiSpamV314`
- **PnOverrideTestV1.js** (2): `testPnOverrideAndVillaConflictV1`, `testPnOverrideSheetV1`
- **ProductTypeFallbackV1.js** (1): `testProductTypeFallbackV1`
- **QualityTestsV1.js** (1): `testQualityFixesV1`
- **Repositories.js** (2): `testRepositoryProductTypeFallbackV4220`, `testRepositoryPrivateRoomLiveV4220`
- **ScheduleSnapshot.js** (3): `testScheduleSnapshotCoverageSummaryV341`, `testScheduleSnapshotCoverageHealthV341`, `testScheduleSnapshotReadV320`
- **SearchEngine.js** (6): `testSearchBalancedRecallV344`, `testSearchCapacityHighRecallV343`, `testSearchCapacityRangeV4220`, `testSearchAllowedVillaIdsV61`, `testSearchCityFilterV341`, `testSearchPriceHighRecallV341`
- **SearchTraceDoctorV1.js** (5): `testSearchTraceDoctorV11`, `testSearchPaginationTraceV13`, `testSearchAvailabilityTargetsV13`, `testSearchTraceSelectorExactV12`, `testSearchTraceBalancedPositionsV13`
- **SheetMonthNormalizer.js** (1): `testSheetMonthNormalizerV1`
- **SourceHealth.js** (2): `testSourceHealthV341`, `testSourceHealthNewSourcePendingV4211`
- **SourceXlsxOpenV_FIX.js** (1): `testXlsxSourceOpenV_FIX`
- **StructureSnapshot.js** (5): `testStructureConfirmationV340`, `testStructureLabelNoiseV341`, `testVungHungAutoV341`, `testPriorityStructureQueueV340`, `testMasterReconcileSweepFilterV618`
- **SystemEventBus.js** (1): `testSystemEventsV315`
- **TelegramBot.js** (8): `testTelegramV31`, `testTelegramPollingV315`, `testTelegramButtonsV4221`, `testTelegramImageV311`, `testTelegramEventsV311`, `testTelegramReportV329`, `testTelegramUxV4222`, `testTelegramButtonsV4222`
- **TelegramVietnamese.js** (1): `testTelegramVietnameseV1`
- **UnknownResolver.js** (1): `testUnknownResolverV1`
- **VillaIdentity.js** (2): `testVillaIdentityLogicalSourceKeyV11`, `testVillaIdentityReviveRetiredV1`
- **configparser.js** (2): `testConfigParser`, `testConfigParserV53`
- **test.js** (41): `testCE_Search`, `testCE_PriceParser`, `testCE_AutoReader`, `testCE_DateColumnDetection`, `testCE_SearchOneVilla`, `testCE_SearchFiveVillas`, `testBookingSearch`, `testMigrationV31`, `testMasterMetadataConfigV31`, `testMetadataReaderV31`, `testBuildMasterV31`, `testGhostVillaFilterV322`, `testSearchNgay_8_10_8`, `test_08_10_Aug`, `testAreaGroupV21`, `testFastMasterConfigV21`, `testFastSearchConfigV23`, `testFastSearchBenchmarkV23`, `testPriceEngineV30`, `testPriceFilterSearchV30`, `testScheduleSnapshotStatusV1`, `testStaticDataReleaseGateV418`, `testSearchManualFieldsV1`, `testR2SearchRegressionV1`, `testSearchCompletenessLiveV1`, `testCustomerSearchLiveV629`, `testSearchPatchV2UnitSuite`, `testKnownSourceDateRecoveryLiveV2`, `testSourceProductTypeLiveV2`, `testSearchBedroomLiveV2`, `testSearchCompletenessAccountingLiveV2`, `testMasterSourceColumnIntegrityV4193`, `testConfirmedRenameSkuPreservationV4194`, `testSourceColumnReorderReconcileV4195`, `testProductTypeSchemaRepairV4196`, `testDeletedSourceOrphanPreviewV4196`, `testMasterNumericRoomNamesV4200`, `testStructureNumericRoomNamesV4200`, `testPriceParserV59`, `testPriceParserTrieuShorthandV59`, `testImageSourceColumnInvalidationV329`

### 2b. Công cụ vận hành / sửa lỗi chạy tay: 74 hàm

| File | Hàm | Byte |
|---|---|---|
| Admin.js:681 | `startStaticInfoBackfillV417` | 262 |
| Admin.js:781 | `getStaticInfoBackfillStatusV417` | 461 |
| Admin.js:894 | `getMasterIncrementalStatusV328` | 574 |
| Admin.js:952 | `onOpen` | 1941 |
| Admin.js:989 | `setupDevImageDriveV211` | 435 |
| AiConfigApply.js:173 | `listAiConfigProposalsV1` | 586 |
| AiConfigApply.js:197 | `applySelectedAiConfigProposalV1` | 579 |
| AiConfigApply.js:198 | `applySelectedAiVillaCorrectionsV1` | 572 |
| AiConfigApply.js:199 | `sendSelectedAiConfigProposalTelegramV1` | 593 |
| AiConfigDoctor.js:116 | `proposeAiConfigDeepV1` | 82 |
| AiHealthWatch.js:357 | `installAiHealthWatchV31` | 597 |
| AiHealthWatch.js:405 | `removeAiHealthWatchV31` | 417 |
| AiHealthWatch.js:429 | `resetAiHealthWatchBaselineV315` | 88 |
| AiHealthWatch.js:433 | `pauseAiHealthWatchV314` | 172 |
| AiHealthWatch.js:438 | `resumeAiHealthWatchV314` | 209 |
| Api.js:3 | `doGet` | 1288 |
| Api.js:38 | `doPost` | 1347 |
| Api.js:110 | `apiSystemHealthV30` | 62 |
| Api.js:111 | `apiRunImageAuditV30` | 61 |
| AuditNoAccessSources.js:58 | `auditNoAccessSourcesV1` | 2387 |
| CalendarMetadata.js:28 | `getCalendarMetadata` | 256 |
| ConfigDoctor.js:119 | `getConfigIssuesV312` | 517 |
| ConfigDoctor.js:411 | `getConfigIssuesV4` | 650 |
| ConfigDoctorV41.js:317 | `getConfigDoctorDeepV41AllState` | 174 |
| ConfigDoctorV41.js:326 | `stopConfigDoctorDeepV41_ALL` | 263 |
| ConfigGuide.js:5 | `createBookingConfigGuide` | 6198 |
| GhostGuard.js:263 | `ghostStatusV1` | 399 |
| HiddenColumnHandler.js:131 | `purgeHiddenColumnSnapshotResetV1` | 267 |
| HiddenColumnHandler.js:137 | `purgeHiddenColumnSnapshotDryRunV1` | 99 |
| HiddenColumnHandler.js:141 | `purgeHiddenColumnSnapshotV1` | 94 |
| ImageDoctor.js:89 | `getImageCheckV312` | 742 |
| ImageDoctor.js:133 | `retryImageIssuesV312` | 3305 |
| MaintenanceV620.js:65 | `startFullPropertyInfoRefreshV620` | 710 |
| MaintenanceV620.js:108 | `startFullImageRefreshV620` | 380 |
| MaintenanceV620.js:116 | `startEhomeFullRefreshV620` | 646 |
| MaintenanceV620.js:161 | `getEhomeFullRefreshStatusV620` | 425 |
| MaintenanceV620.js:168 | `stopEhomeFullRefreshV620` | 589 |
| MasterEngine.js:141 | `findMasterInfoSheet` | 444 |
| MasterEngine.js:172 | `readMasterFromInfoSheet` | 983 |
| MasterEngine.js:2237 | `isValidCalendarVillaName` | 90 |
| MasterEngine.js:3456 | `debugMasterColumnLayout` | 1402 |
| MasterEngine.js:3534 | `rebuildMasterVilla` | 59 |
| MasterEngine.js:5461 | `repairMasterVillaProductTypeV4196` | 4370 |
| MasterEngine.js:5614 | `applyDeletedSourceOrphansV4196` | 924 |
| MasterEngine.js:6091 | `reconcileImageOverridesV330` | 121 |
| PROPERTIES_DOCTOR.gs.js:1 | `propertiesDoctor` | 902 |
| PropertyHubBridge.js:247 | `getEhomePropertyHubStatusV1` | 431 |
| Repositories.js:491 | `getBookingMasterVillas` | 66 |
| ScheduleSnapshot.js:1104 | `migrateScheduleSnapshotLogicalKeysV2` | 392 |
| ScheduleSnapshot.js:1122 | `repairScheduleSnapshotCoverageStatusesV341` | 3568 |
| ScheduleSnapshot.js:1322 | `drainScheduleSnapshotQueueV322` | 486 |
| SearchEngine.js:1689 | `searchAvailableVilla` | 267 |
| SearchTraceDoctorV1.js:223 | `auditSearchRepositoryDropsV11` | 787 |
| SnapshotReasonDoctorV1.js:7 | `diagnoseSnapshotReasonsV1` | 3381 |
| SourceRepairTools.js:20 | `rebuildSourcesAfterConfigFixV1` | 711 |
| SourceRepairTools.js:46 | `cleanupStaleQueueRowsDryRunV1` | 72 |
| SourceRepairTools.js:47 | `cleanupStaleQueueRowsV1` | 67 |
| StructureSnapshot.js:1143 | `reclassifyStructureSnapshotV341` | 1015 |
| StructureSnapshot.js:1165 | `refreshVungHungStructureV341` | 302 |
| StructureSnapshot.js:1528 | `acceptStructureSnapshotBaselineV320` | 822 |
| StructureSnapshot.js:1692 | `repairMasterReconcileBacklogV618` | 660 |
| StructureSnapshot.js:1708 | `getMasterReconcileBacklogStatusV618` | 1292 |
| TelegramBot.js:192 | `setupTelegramWebhookV31` | 322 |
| TelegramBot.js:203 | `removeTelegramWebhookV31` | 212 |
| TelegramBot.js:209 | `getTelegramWebhookInfoV31` | 186 |
| TelegramBot.js:280 | `removeTelegramPollingV315` | 304 |
| TelegramBot.js:477 | `captureTelegramAdminChatIdV31` | 861 |
| TelegramVietnamese.js:307 | `sendTelegramVietnameseSampleV1` | 1395 |
| test.js:897 | `previewStaticInfoIntegrityV417` | 87 |
| test.js:1690 | `debugStructureLookupSource12V2` | 1133 |
| VillaIdentity.js:32 | `enableVillaIdentityV1` | 649 |
| VillaIdentity.js:43 | `disableVillaIdentityV1` | 246 |
| VillaIdentity.js:50 | `initializeVillaIdentityRegistryV1` | 2461 |
| VillaIdentity.js:172 | `diagnoseBlankMasterSkuV12` | 1142 |

## 3. Đề xuất

- Các hàm ở mục 2b có hậu tố phiên bản cũ (V31, V312, V328...) là công cụ sửa lỗi một lần của các đợt trước. Đề xuất: anh/kỹ thuật xem lướt danh sách, hàm nào chắc chắn không dùng nữa thì gỡ theo lô, mỗi lô chạy lại testQualityFixesV1 và testEhomeRegressionSuiteV620.
- File test (test.js, OpsTests.gs.js, PnOverrideTestV1.js) vẫn để trong dự án vì hàm testEhomeRegressionSuiteV620 gọi tới. Chúng không chạy khi khách/sale dùng app, chỉ tốn thời gian nạp code rất nhỏ.
