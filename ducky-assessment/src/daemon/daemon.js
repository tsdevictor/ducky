#!/usr/bin/env node
/**
 * Ducky background daemon — collects AI usage signals while the developer works.
 * Spawned detached by `ducky start`, killed by `ducky stop`.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname, extname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = process.argv[2];

if (!projectDir) {
  process.stderr.write('daemon: missing projectDir argument\n');
  process.exit(1);
}

const DUCKY_DIR = join(homedir(), '.ducky');
const DATA_FILE = join(DUCKY_DIR, 'data.json');

// ── Dynamic import for chokidar (ESM peer dep) ───────────────────────────────
let chokidar;
try {
  chokidar = (await import('chokidar')).default;
} catch {
  process.stderr.write('daemon: chokidar not available, file tracking disabled\n');
}

import { createFileTracker } from '../trackers/fileTracker.js';
import { sampleProcesses, getInstalledAITools } from '../trackers/processTracker.js';
import { getRecentCommits, getGitConfig } from '../trackers/gitTracker.js';
import { sampleShellHistory } from '../trackers/historyTracker.js';
import { scanArtifacts } from '../trackers/artifactTracker.js';
import { checkDNSCache, sampleNetworkConnections } from '../trackers/networkTracker.js';
import { scanCursorChatHistory, scanClaudeCodeLogs, scanVSCodeCopilotLogs, checkInstalledAIApps } from '../trackers/editorTracker.js';
import { scanBrowserHistory, getOpenBrowserTabs } from '../trackers/browserTracker.js';
import { sampleClipboard, getPasteEvents } from '../trackers/clipboardTracker.js';
import { scanEnvironmentVars, scanEnvFiles, scanShellRcFiles } from '../trackers/envScanner.js';
import { analyzeFileContent } from '../trackers/codeAnalyzer.js';

// ── Session state ────────────────────────────────────────────────────────────
const startTime = new Date().toISOString();

const data = {
  startTime,
  projectDir,
  processSnapshots: [],
  gitCommits: [],
  shellHistory: [],
  aiArtifacts: {},
  installedTools: {},
  gitConfig: {},
  fileEvents: [],
  networkSnapshots: [],
  dnsFindings: {},
  editorContext: {},
  browserHistory: [],
  openBrowserTabs: [],
  clipboardPasteEvents: [],
  envContext: {},
  codeAnalysis: {},
};

// ── File tracker ─────────────────────────────────────────────────────────────
const fileTracker = createFileTracker(projectDir);

if (chokidar) {
  const watcher = chokidar.watch(projectDir, {
    ignored: [/(^|[/\\])\..+/, /node_modules/, /ducky-report\.json/, /__pycache__/, /\.egg-info/],
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    depth: 8,
  });

  watcher.on('add', (p) => fileTracker.initSizes(p));
  watcher.on('change', (p) => {
    fileTracker.onFileEvent('change', p);
    // Analyze content of changed code files (debounced via the flush cycle)
    scheduleCodeAnalysis(p);
  });
  watcher.on('add', (p) => fileTracker.onFileEvent('add', p));
  watcher.on('unlink', (p) => fileTracker.onFileEvent('unlink', p));
  watcher.on('error', (err) => process.stderr.write(`watcher error: ${err}\n`));
}

// Track which files need re-analysis (avoid analyzing on every keystroke)
const pendingAnalysis = new Map();
function scheduleCodeAnalysis(filePath) {
  clearTimeout(pendingAnalysis.get(filePath));
  pendingAnalysis.set(filePath, setTimeout(() => {
    try {
      const ext = extname(filePath);
      const rel = filePath.replace(projectDir + '/', '');
      const analysis = analyzeFileContent(filePath, ext);
      if (analysis && analysis.aiContentScore > 0) {
        data.codeAnalysis[rel] = analysis;
      }
    } catch {}
    pendingAnalysis.delete(filePath);
  }, 2000));
}

// ── Initial static scans ─────────────────────────────────────────────────────
data.installedTools = getInstalledAITools();
data.aiArtifacts = scanArtifacts(projectDir);
data.gitConfig = getGitConfig(projectDir);
data.dnsFindings = checkDNSCache();
data.editorContext = {
  cursorChatHistory: scanCursorChatHistory(),
  claudeCodeLogs: scanClaudeCodeLogs(),
  vscodeCopilotLogs: scanVSCodeCopilotLogs(),
  installedAIApps: checkInstalledAIApps(),
};
data.envContext = {
  envVars: scanEnvironmentVars(),
  envFiles: scanEnvFiles(projectDir),
  shellRcKeys: scanShellRcFiles(),
};
data.browserHistory = scanBrowserHistory(startTime);
data.openBrowserTabs = getOpenBrowserTabs();

// ── Polling intervals ────────────────────────────────────────────────────────
const intervals = [];

// Process snapshot every 15 seconds
intervals.push(setInterval(() => {
  const snap = sampleProcesses();
  if (snap.aiProcesses.length > 0) data.processSnapshots.push(snap);
}, 15_000));

// Git commits every 60 seconds
intervals.push(setInterval(() => {
  try {
    const commits = getRecentCommits(projectDir, startTime);
    const existingHashes = new Set(data.gitCommits.map((c) => c.hash));
    for (const c of commits) {
      if (!existingHashes.has(c.hash)) {
        data.gitCommits.push(c);
        existingHashes.add(c.hash);
      }
    }
  } catch {}
}, 60_000));

// Shell history every 30 seconds
intervals.push(setInterval(() => {
  try {
    const cmds = sampleShellHistory(startTime);
    const existingKeys = new Set(data.shellHistory.map((c) => `${c.tool}:${c.command}`));
    for (const c of cmds) {
      const key = `${c.tool}:${c.command}`;
      if (!existingKeys.has(key)) {
        data.shellHistory.push(c);
        existingKeys.add(key);
      }
    }
  } catch {}
}, 30_000));

// Re-scan artifacts every 2 minutes
intervals.push(setInterval(() => {
  try { data.aiArtifacts = scanArtifacts(projectDir); } catch {}
}, 120_000));

// DNS + active connections every 45 seconds
intervals.push(setInterval(() => {
  try {
    const dns = checkDNSCache();
    data.dnsFindings = { ...data.dnsFindings, ...dns };
    const conns = sampleNetworkConnections();
    if (conns.length > 0) data.networkSnapshots.push(...conns);
  } catch {}
}, 45_000));

// Browser history every 90 seconds (SQLite copy is slow)
intervals.push(setInterval(() => {
  try {
    const fresh = scanBrowserHistory(startTime);
    const existingUrls = new Set(data.browserHistory.map((b) => b.url));
    for (const b of fresh) {
      if (!existingUrls.has(b.url)) {
        data.browserHistory.push(b);
        existingUrls.add(b.url);
      }
    }
    data.openBrowserTabs = getOpenBrowserTabs();
  } catch {}
}, 90_000));

// Clipboard every 5 seconds
intervals.push(setInterval(() => {
  try {
    sampleClipboard();
  } catch {}
}, 5_000));

// Persist data every 5 seconds
intervals.push(setInterval(() => { flush(); }, 5_000));

// Initial samples
setTimeout(() => {
  const snap = sampleProcesses();
  if (snap.aiProcesses.length > 0) data.processSnapshots.push(snap);
  data.shellHistory = sampleShellHistory(startTime);
  data.gitCommits = getRecentCommits(projectDir, startTime);
}, 2_000);

// ── Flush & shutdown ─────────────────────────────────────────────────────────
function flush() {
  try {
    mkdirSync(DUCKY_DIR, { recursive: true });
    data.fileEvents = fileTracker.getEvents();
    data.clipboardPasteEvents = getPasteEvents();
    writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    process.stderr.write(`daemon flush error: ${e.message}\n`);
  }
}

function shutdown() {
  flush();
  for (const iv of intervals) clearInterval(iv);
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('uncaughtException', (e) => {
  process.stderr.write(`daemon uncaughtException: ${e.stack}\n`);
  flush();
});
