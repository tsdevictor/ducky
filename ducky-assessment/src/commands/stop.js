import { writeFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import {
  readSession,
  readData,
  isDaemonAlive,
  SESSION_FILE,
  DATA_FILE,
} from '../utils/state.js';
import { buildReport } from '../report/buildReport.js';

export async function stopCommand() {
  const session = readSession();

  if (!session) {
    console.log('🦆 No active tracking session found.');
    console.log("   Run 'ducky start' to begin tracking.");
    return;
  }

  const isAlive = isDaemonAlive(session.pid);

  if (isAlive) {
    try {
      process.kill(session.pid, 'SIGTERM');
      // Give daemon a moment to flush data
      await new Promise((r) => setTimeout(r, 1500));
    } catch (e) {
      console.error(`Warning: could not signal daemon (PID ${session.pid}):`, e.message);
    }
  } else {
    console.log('Note: Daemon was not running (using cached data).');
  }

  const rawData = readData();
  const endTime = new Date().toISOString();
  const report = buildReport(session, rawData, endTime);

  const reportPath = join(session.projectDir, 'ducky-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // Clean up state files
  try { unlinkSync(SESSION_FILE); } catch {}
  try { unlinkSync(DATA_FILE); } catch {}

  printSummary(report, reportPath);
}

function printSummary(report, reportPath) {
  const { metadata, tracking } = report;
  const durationMin = Math.round(metadata.durationSeconds / 60);
  const tools = tracking.detectedTools.tools;
  const fileCount = tracking.fileActivity.uniqueFilesModified;
  const aiChanges = tracking.fileActivity.likelyAIGeneratedChanges;
  const gitCommits = tracking.gitActivity.totalCommits;
  const shellCmds = tracking.shellHistory.aiCommandsFound.length;

  console.log('\n🦆 Ducky session complete!\n');
  console.log(`   Duration       : ${durationMin} min`);
  console.log(`   Project        : ${metadata.projectDir}`);
  console.log(`   Report         : ${reportPath}\n`);

  console.log('── AI Signal Summary ──────────────────────────────');
  if (tools.length > 0) {
    console.log(`   Tools detected : ${tools.join(', ')}`);
  } else {
    console.log(`   Tools detected : none observed`);
  }
  console.log(`   Files changed  : ${fileCount}`);
  console.log(`   Large changes  : ${aiChanges} (likely AI-generated)`);
  console.log(`   Git commits    : ${gitCommits}`);
  console.log(`   AI CLI cmds    : ${shellCmds}`);

  const artifacts = Object.keys(tracking.aiArtifacts.found);
  if (artifacts.length > 0) {
    console.log(`   AI artifacts   : ${artifacts.join(', ')}`);
  }

  const score = tracking.signals.aiUsageScore;
  const bar = '█'.repeat(Math.round(score * 20)) + '░'.repeat(20 - Math.round(score * 20));
  console.log(`\n   AI usage score : [${bar}] ${Math.round(score * 100)}%`);
  console.log(`   Confidence     : ${tracking.signals.confidence}`);
  console.log('────────────────────────────────────────────────────\n');
}
