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
  const browserSites = tracking.browserActivity?.aiSitesVisited?.length ?? 0;
  const openTabs = tracking.browserActivity?.currentlyOpenAITabs?.length ?? 0;
  const pastes = tracking.clipboardActivity?.pasteToFileCorrelations?.length ?? 0;
  const apiKeys = tracking.envActivity?.toolsWithAPIKeys ?? [];
  const codeFiles = tracking.codeAnalysis?.highAIScoreFiles?.length ?? 0;

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

  console.log(`   Files changed  : ${fileCount}  (${aiChanges} large/AI-likely)`);
  console.log(`   Git commits    : ${gitCommits}`);
  console.log(`   AI CLI cmds    : ${shellCmds}`);
  console.log(`   Browser visits : ${browserSites} AI sites${openTabs > 0 ? ` (${openTabs} tab open now)` : ''}`);
  if (pastes > 0) console.log(`   Clipboard      : ${pastes} paste-to-file correlation(s)`);
  if (apiKeys.length > 0) console.log(`   API keys found : ${apiKeys.join(', ')}`);
  if (codeFiles > 0) console.log(`   Code patterns  : ${codeFiles} file(s) with AI content markers`);

  const artifacts = Object.keys(tracking.aiArtifacts.found);
  if (artifacts.length > 0) {
    console.log(`   AI artifacts   : ${artifacts.slice(0, 5).join(', ')}${artifacts.length > 5 ? ` +${artifacts.length - 5} more` : ''}`);
  }

  console.log('');
  for (const ev of tracking.signals.evidence.slice(0, 5)) {
    const detail = ev.tools ? ev.tools.slice(0, 3).join(', ') : `×${ev.count}`;
    console.log(`   ✓ ${ev.signal} [${detail}]`);
  }

  const score = tracking.signals.aiUsageScore;
  const filled = Math.round(score * 20);
  const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
  console.log(`\n   AI usage score : [${bar}] ${Math.round(score * 100)}%`);
  console.log(`   Confidence     : ${tracking.signals.confidence}`);
  console.log('────────────────────────────────────────────────────\n');
}
