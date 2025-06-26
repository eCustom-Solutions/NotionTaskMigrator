// daily_reporting/summarize_logs.js

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const dayjs = require('dayjs');

const FULL_LOG_DIR = path.resolve(__dirname, '../logging/logs/full');
const SUMMARY_OUTPUT_DIR = path.resolve(__dirname, './summaries');

async function summarizeLogs() {
  const now = new Date();
  const dateStr = dayjs(now).format('YYYY-MM-DD');
  const timestamp = dayjs(now).format('YYYY-MM-DD__HH-mm-ss');
  const summaryFilePath = path.join(SUMMARY_OUTPUT_DIR, `${timestamp}.json`);

  const logFiles = fs.readdirSync(FULL_LOG_DIR)
    .filter(file => file.endsWith('.jsonl') && file.startsWith(dateStr));

  // Includes aggregated totals and per-job breakdowns for better traceability
  const summary = {
    date: dateStr,
    timestamp,
    logFilesParsed: logFiles.length,
    total: 0,
    migrated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    warnings: [],
    jobIds: new Set(),
    durationsMs: [],
    jobSummaries: {},
    eventCounts: {}
  };

  for (const file of logFiles) {
    const filePath = path.join(FULL_LOG_DIR, file);
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch (err) {
        summary.warnings.push(`Malformed JSON in ${file}: ${line}`);
        continue;
      }

      const { level, msg, jobId, sourceId, elapsedMs } = entry;

      if (jobId) {
        summary.jobIds.add(jobId);
        if (!summary.jobSummaries[jobId]) {
          summary.jobSummaries[jobId] = {
            migrated: 0,
            skipped: 0,
            failed: 0,
            durationsMs: [],
            errors: [],
            warnings: [],
            eventCounts: {}
          };
        }
      }

      const event = entry.event;
      if (event) {
        summary.eventCounts[event] = (summary.eventCounts[event] || 0) + 1;

        if (jobId) {
          const jobStats = summary.jobSummaries[jobId];
          jobStats.eventCounts[event] = (jobStats.eventCounts[event] || 0) + 1;
        }
      }

      if (jobId) {
        if (msg?.includes('Skipped')) summary.jobSummaries[jobId].skipped++;
        else if (msg?.includes('Page created')) summary.jobSummaries[jobId].migrated++;

        if (level === 40) {
          summary.jobSummaries[jobId].failed++;
          const errorMsg = msg || entry.err || 'Unknown error';
          const id = sourceId || entry.pageId || entry.targetId || 'unknown';
          summary.jobSummaries[jobId].errors.push({ sourceId: id, msg: errorMsg });
        }

        if (elapsedMs) summary.jobSummaries[jobId].durationsMs.push(elapsedMs);
      }

      if (msg?.includes('Migration finished') && entry.total) {
        summary.total = Math.max(summary.total, entry.total);
      }
    }
  }

  for (const [jobId, stats] of Object.entries(summary.jobSummaries)) {
    summary.total += stats.migrated + stats.skipped + stats.failed;
    summary.migrated += stats.migrated;
    summary.skipped += stats.skipped;
    summary.failed += stats.failed;
    summary.errors.push(...stats.errors);
    summary.warnings.push(...stats.warnings);
    summary.durationsMs.push(...stats.durationsMs);
  }

  summary.jobIds = Array.from(summary.jobIds);
  summary.avgDurationMs = summary.durationsMs.length
    ? Math.round(summary.durationsMs.reduce((a, b) => a + b, 0) / summary.durationsMs.length)
    : null;

  fs.mkdirSync(SUMMARY_OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(summaryFilePath, JSON.stringify(summary, null, 2));

  return summary;
}

if (require.main === module) {
  summarizeLogs().then(summary => {
    console.log(`✅ Summary written:\n`, summary);
  }).catch(err => {
    console.error('❌ Failed to summarize logs:', err);
  });
}

module.exports = summarizeLogs;