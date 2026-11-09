function propertiesDoctor() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const keys = Object.keys(props).sort();

  Logger.log('========================================');
  Logger.log('EHOME PROPERTIES DOCTOR');
  Logger.log('========================================');
  Logger.log('TỔNG SỐ PROPERTIES: ' + keys.length);
  Logger.log('');

  keys.forEach((key, index) => {
    const value = props[key] || '';

    Logger.log(
      `${index + 1}. ${key} | length=${value.length}`
    );
  });

  Logger.log('');
  Logger.log('========================================');

  if (keys.length > 50) {
    Logger.log(
      '⚠️ Có hơn 50 properties. Giao diện Apps Script không hiển thị hết, nhưng Properties Service vẫn đọc được toàn bộ.'
    );
  } else {
    Logger.log('✅ Không vượt quá 50 properties.');
  }

  Logger.log('========================================');
}