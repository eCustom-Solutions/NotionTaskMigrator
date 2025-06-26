function formatSummaryForEmail(summary) {
  function formatDate(dt) {
    if (!dt) return 'N/A';
    try {
      const d = new Date(dt);
      return d.toLocaleString();
    } catch (e) {
      return String(dt);
    }
  }

  let lines = [];
  lines.push('=== Migration Summary ===');
  if (summary.date) lines.push(`Date: ${formatDate(summary.date)}`);
  if (summary.timestamp) lines.push(`Timestamp: ${formatDate(summary.timestamp)}`);
  lines.push('');

  lines.push('--- Overall Totals ---');
  lines.push(`Total pages: ${summary.total ?? 'N/A'}`);

  const eventCounts = summary.eventCounts || {
    skipped: summary.skipped,
    migrated: summary.migrated,
    failed: summary.failed
  };
  for (const [event, count] of Object.entries(eventCounts)) {
    lines.push(`${event[0].toUpperCase() + event.slice(1)}: ${count ?? 0}`);
  }

  if (typeof summary.avgDurationMs === 'number') {
    lines.push(`Average duration: ${(summary.avgDurationMs / 1000).toFixed(3)} seconds`);
  }
  lines.push('');

  if (summary.jobSummaries && typeof summary.jobSummaries === 'object') {
    lines.push('--- Job Breakdown ---');
    for (const [jobId, stats] of Object.entries(summary.jobSummaries)) {
      lines.push(`Job: ${jobId}`);

      const jobEvents = stats.eventCounts || {
        skipped: stats.skipped,
        migrated: stats.migrated,
        failed: stats.failed
      };
      for (const [event, count] of Object.entries(jobEvents)) {
        lines.push(`  ${event[0].toUpperCase() + event.slice(1)}: ${count ?? 0}`);
      }

      if (Array.isArray(stats.durationsMs) && stats.durationsMs.length > 0) {
        const avg = stats.durationsMs.reduce((a, b) => a + b, 0) / stats.durationsMs.length;
        lines.push(`  Avg duration: ${(avg / 1000).toFixed(3)} seconds`);
      }
      lines.push('');
    }
  }

  if (Array.isArray(summary.errors) && summary.errors.length > 0) {
    lines.push('--- Errors ---');
    for (const err of summary.errors) {
      let line = `  [${err.sourceId ?? 'unknown'}] ${err.msg ?? ''}`;
      lines.push(line);
    }
    lines.push('');
  }

  if (Array.isArray(summary.warnings) && summary.warnings.length > 0) {
    lines.push('--- Warnings ---');
    for (const warn of summary.warnings) {
      let line = `  [${warn.sourceId ?? 'unknown'}] ${warn.msg ?? ''}`;
      lines.push(line);
    }
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = formatSummaryForEmail;