// bundle_logs.js
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { getDateForLogQuery, formatTimestampForFilename, getAllLogFilesForDate } = require('./utils');

function bundleLogs(date = getDateForLogQuery()) {
  const logFiles = getAllLogFilesForDate(date);
  const timestamp = formatTimestampForFilename(new Date());
  const archiveName = `logs_bundle_${date}__${timestamp}.zip`;
  const tmpDir = path.resolve(__dirname, '..', 'tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  const archivePath = path.resolve(tmpDir, archiveName);

  const zip = new AdmZip();

  for (const filePath of logFiles) {
    if (fs.existsSync(filePath)) {
      const relativePath = path.relative(path.resolve(__dirname, '..'), filePath);
      zip.addLocalFile(filePath, path.dirname(relativePath));
    }
  }

  zip.writeZip(archivePath);
  console.log(`📦 Logs bundled at: ${archivePath}`);
  return archivePath;
}

if (require.main === module) {
  bundleLogs();
}

module.exports = { bundleLogs };