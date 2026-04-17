import { getRecentCommits } from '../trackers/gitTracker.js';
import { sampleShellHistory } from '../trackers/historyTracker.js';
import { scanBrowserHistory } from '../trackers/browserTracker.js';
import { scanEnvironmentVars, scanEnvFiles, scanShellRcFiles } from '../trackers/envScanner.js';
import { correlatePastesWithFileChanges } from '../trackers/clipboardTracker.js';

/**
 * Transforms raw daemon data into the final ducky-report.json structure.
 * Also performs a final synchronous scan to catch anything the daemon missed.
 */

export function buildReport(session, rawData, endTime) {
  const start = new Date(session.startTime);
  const end = new Date(endTime);
  const durationSeconds = Math.round((end - start) / 1000);

  if (!rawData) {
    return {
      metadata: buildMetadata(session, endTime, durationSeconds),
      tracking: emptyTracking(),
    };
  }

  // Final synchronous scans — catch anything the daemon missed
  const finalGitCommits = mergeCommits(
    rawData.gitCommits || [],
    getRecentCommits(session.projectDir, session.startTime)
  );
  const finalShellHistory = mergeHistory(
    rawData.shellHistory || [],
    sampleShellHistory(session.startTime)
  );
  const finalBrowserHistory = mergeBrowser(
    rawData.browserHistory || [],
    scanBrowserHistory(session.startTime)
  );

  const fileActivity = analyzeFileActivity(rawData.fileEvents || []);
  const processActivity = analyzeProcessActivity(rawData.processSnapshots || []);
  const gitActivity = analyzeGitActivity(finalGitCommits);
  const shellHistory = analyzeShellHistory(finalShellHistory);
  const aiArtifacts = analyzeArtifacts(rawData.aiArtifacts || {});
  const networkActivity = analyzeNetwork(rawData.dnsFindings || {}, rawData.networkSnapshots || []);
  const browserActivity = analyzeBrowser(finalBrowserHistory, rawData.openBrowserTabs || []);
  const clipboardActivity = analyzeClipboard(
    rawData.clipboardPasteEvents || [],
    rawData.fileEvents || []
  );
  const envActivity = analyzeEnv(
    rawData.envContext || {},
    session.projectDir
  );
  const codeAnalysis = analyzeCode(rawData.codeAnalysis || {});

  const envContext = {
    installedTools: rawData.installedTools || {},
    gitConfig: rawData.gitConfig || {},
    editorContext: rawData.editorContext || {},
  };

  const signals = computeSignals({
    fileActivity,
    processActivity,
    gitActivity,
    shellHistory,
    aiArtifacts,
    networkActivity,
    browserActivity,
    clipboardActivity,
    envActivity,
    codeAnalysis,
  });

  return {
    metadata: buildMetadata(session, endTime, durationSeconds),
    tracking: {
      detectedTools: signals.detectedTools,
      fileActivity,
      processActivity,
      gitActivity,
      shellHistory,
      browserActivity,
      clipboardActivity,
      networkActivity,
      aiArtifacts,
      envActivity,
      codeAnalysis,
      envContext,
      signals,
    },
  };
}

function buildMetadata(session, endTime, durationSeconds) {
  return {
    startTime: session.startTime,
    endTime,
    durationSeconds,
    projectDir: session.projectDir,
    version: '1.0.0',
  };
}

// ── Merge helpers ─────────────────────────────────────────────────────────────
function mergeCommits(existing, fresh) {
  const seen = new Set(existing.map((c) => c.hash));
  return [...existing, ...fresh.filter((c) => !seen.has(c.hash))];
}

function mergeHistory(existing, fresh) {
  const seen = new Set(existing.map((c) => `${c.tool}:${c.command}`));
  return [...existing, ...fresh.filter((c) => !seen.has(`${c.tool}:${c.command}`))];
}

function mergeBrowser(existing, fresh) {
  const seen = new Set(existing.map((b) => b.url));
  return [...existing, ...fresh.filter((b) => !seen.has(b.url))];
}

// ── File activity ─────────────────────────────────────────────────────────────
function analyzeFileActivity(events) {
  const uniqueFiles = new Set(events.map((e) => e.path));
  const likelyAI = events.filter((e) => e.likelyAI);
  const largeChanges = events.filter((e) => e.sizeDelta > 3000);
  const simultaneousGroups = detectSimultaneousGroups(events);
  const timeline = buildTimeline(events, 300_000);

  return {
    totalEvents: events.length,
    uniqueFilesModified: uniqueFiles.size,
    modifiedFiles: [...uniqueFiles].slice(0, 50),
    likelyAIGeneratedChanges: likelyAI.length,
    largeChanges: largeChanges.slice(0, 20).map((e) => ({
      time: e.time,
      path: e.path,
      sizeDelta: e.sizeDelta,
      type: e.type,
    })),
    simultaneousEditGroups: simultaneousGroups.length,
    simultaneousGroupDetails: simultaneousGroups.slice(0, 5),
    changeTimeline: timeline,
    topChangedFiles: topChangedFiles(events),
  };
}

function detectSimultaneousGroups(events) {
  const groups = [];
  let i = 0;
  while (i < events.length) {
    const base = new Date(events[i].time).getTime();
    const group = [events[i]];
    let j = i + 1;
    while (j < events.length && new Date(events[j].time).getTime() - base < 4000) {
      group.push(events[j]);
      j++;
    }
    if (group.length >= 3) groups.push(group.map((e) => e.path));
    i = j;
  }
  return groups;
}

function buildTimeline(events, windowMs) {
  if (events.length === 0) return [];
  const buckets = {};
  for (const e of events) {
    const t = Math.floor(new Date(e.time).getTime() / windowMs) * windowMs;
    if (!buckets[t]) buckets[t] = { changes: 0, likelyAI: 0 };
    buckets[t].changes++;
    if (e.likelyAI) buckets[t].likelyAI++;
  }
  return Object.entries(buckets).map(([t, v]) => ({
    windowStart: new Date(parseInt(t)).toISOString(),
    totalChanges: v.changes,
    likelyAIChanges: v.likelyAI,
  }));
}

function topChangedFiles(events) {
  const counts = {};
  for (const e of events) counts[e.path] = (counts[e.path] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([path, count]) => ({ path, changeCount: count }));
}

// ── Process activity ──────────────────────────────────────────────────────────
function analyzeProcessActivity(snapshots) {
  const toolSeen = new Map();
  for (const snap of snapshots) {
    for (const proc of snap.aiProcesses) {
      if (!toolSeen.has(proc.name)) {
        toolSeen.set(proc.name, { firstSeen: snap.time, lastSeen: snap.time, appearances: 1 });
      } else {
        const entry = toolSeen.get(proc.name);
        entry.lastSeen = snap.time;
        entry.appearances++;
      }
    }
  }
  return {
    snapshotCount: snapshots.length,
    aiProcessesDetected: Object.fromEntries(toolSeen),
    toolNames: [...toolSeen.keys()],
  };
}

// ── Git activity ──────────────────────────────────────────────────────────────
function analyzeGitActivity(commits) {
  if (commits.length === 0) {
    return { totalCommits: 0, likelyAICommits: 0, commits: [], rapidCommitGroups: [] };
  }

  const likelyAI = commits.filter((c) => c.likelyAI);
  const avgLines = Math.round(commits.reduce((s, c) => s + c.totalLines, 0) / commits.length);

  const sorted = [...commits].sort((a, b) => new Date(a.time) - new Date(b.time));
  const rapidGroups = [];
  let i = 0;
  while (i < sorted.length) {
    const group = [sorted[i]];
    let j = i + 1;
    while (j < sorted.length && new Date(sorted[j].time) - new Date(sorted[j - 1].time) < 180_000) {
      group.push(sorted[j]);
      j++;
    }
    if (group.length >= 2) rapidGroups.push(group.map((c) => c.hash.substring(0, 8)));
    i = j;
  }

  return {
    totalCommits: commits.length,
    likelyAICommits: likelyAI.length,
    averageLinesPerCommit: avgLines,
    rapidCommitGroups: rapidGroups,
    commits: commits.map((c) => ({
      hash: c.hash.substring(0, 8),
      time: c.time,
      message: c.message,
      filesChanged: c.filesChanged,
      insertions: c.insertions,
      deletions: c.deletions,
      aiScore: c.aiScore,
    })),
  };
}

// ── Shell history ─────────────────────────────────────────────────────────────
function analyzeShellHistory(commands) {
  const byTool = {};
  for (const cmd of commands) byTool[cmd.tool] = (byTool[cmd.tool] || 0) + 1;
  return {
    aiCommandsFound: commands.slice(0, 100),
    commandCountByTool: byTool,
    uniqueToolsInvoked: Object.keys(byTool),
  };
}

// ── Browser activity ──────────────────────────────────────────────────────────
function analyzeBrowser(historyItems, openTabs) {
  const byTool = {};
  for (const item of historyItems) {
    byTool[item.tool] = (byTool[item.tool] || 0) + item.visitCount;
  }

  return {
    aiSitesVisited: historyItems.slice(0, 50),
    visitCountByTool: byTool,
    toolsAccessedViaBrowser: Object.keys(byTool),
    currentlyOpenAITabs: openTabs,
    totalVisits: historyItems.reduce((s, i) => s + i.visitCount, 0),
  };
}

// ── Clipboard activity ────────────────────────────────────────────────────────
function analyzeClipboard(pasteEvents, fileEvents) {
  const largePastes = pasteEvents.filter((e) => e.size > 500);
  const codelikePastes = pasteEvents.filter((e) => e.looksLikeCode);
  const correlated = correlatePastesWithFileChanges(pasteEvents, fileEvents);

  return {
    totalPasteEvents: pasteEvents.length,
    largePastesDetected: largePastes.length,
    codelikePastes: codelikePastes.length,
    pasteToFileCorrelations: correlated,
    pasteEvents: pasteEvents.slice(0, 30),
  };
}

// ── Network activity ──────────────────────────────────────────────────────────
function analyzeNetwork(dnsFindings, networkSnapshots) {
  const toolsViaNetwork = Object.keys(dnsFindings);
  return {
    aiDomainsResolved: dnsFindings,
    activeConnectionSnapshots: networkSnapshots.slice(0, 50),
    toolsViaNetwork,
  };
}

// ── Artifacts ─────────────────────────────────────────────────────────────────
function analyzeArtifacts(artifacts) {
  const toolsFromArtifacts = [...new Set(
    Object.values(artifacts).map((a) => a.tool).filter(Boolean)
  )];
  return { found: artifacts, toolsFromArtifacts };
}

// ── Environment / API key context ────────────────────────────────────────────
function analyzeEnv(envContext, projectDir) {
  // Also do a fresh scan at report time
  const freshVars = scanEnvironmentVars();
  const freshFiles = scanEnvFiles(projectDir);
  const freshRc = scanShellRcFiles();

  const allVars = { ...(envContext.envVars || {}), ...freshVars };
  const allFiles = [...(envContext.envFiles || []), ...freshFiles].filter(
    (f, i, arr) => arr.findIndex((x) => x.file === f.file) === i
  );
  const allRc = [...(envContext.shellRcKeys || []), ...freshRc].filter(
    (r, i, arr) => arr.findIndex((x) => x.file === r.file && x.key === r.key) === i
  );

  const toolsWithAPIKeys = [...new Set([
    ...Object.values(allVars).map((v) => v.tool),
    ...allFiles.flatMap((f) => f.aiKeys.map((k) => k.tool)),
    ...allRc.map((r) => r.tool),
  ])];

  return {
    activeEnvVars: allVars,
    envFilesWithAIKeys: allFiles,
    shellRcAPIKeys: allRc,
    toolsWithAPIKeys,
  };
}

// ── Code content analysis ─────────────────────────────────────────────────────
function analyzeCode(codeAnalysisMap) {
  const files = Object.entries(codeAnalysisMap);
  if (files.length === 0) return { filesAnalyzed: 0, highAIScoreFiles: [], avgCommentRatio: 0 };

  const highScore = files.filter(([, m]) => m.aiContentScore > 0.3);
  const avgComment = files.reduce((s, [, m]) => s + (m.commentRatio || 0), 0) / files.length;

  return {
    filesAnalyzed: files.length,
    avgCommentRatio: Math.round(avgComment * 100) / 100,
    highAIScoreFiles: highScore.map(([path, m]) => ({
      path,
      aiContentScore: m.aiContentScore,
      commentRatio: m.commentRatio,
      patternHits: m.aiPatternHits,
      lineCount: m.lineCount,
    })).sort((a, b) => b.aiContentScore - a.aiContentScore).slice(0, 10),
    allFileScores: Object.fromEntries(
      files.map(([p, m]) => [p, { score: m.aiContentScore, commentRatio: m.commentRatio }])
    ),
  };
}

// ── Signal scoring ────────────────────────────────────────────────────────────
function computeSignals({
  fileActivity, processActivity, gitActivity, shellHistory,
  aiArtifacts, networkActivity, browserActivity, clipboardActivity,
  envActivity, codeAnalysis,
}) {
  const evidence = [];
  let score = 0;

  // 1. Process detection — strongest local signal
  const activeTools = processActivity.toolNames;
  if (activeTools.length > 0) {
    score += 0.30;
    evidence.push({ signal: 'AI tools observed running as processes', tools: activeTools, weight: 0.30 });
  }

  // 2. Browser — visiting AI chat sites is direct evidence
  const browserTools = browserActivity?.toolsAccessedViaBrowser ?? [];
  if (browserTools.length > 0) {
    score += 0.30;
    evidence.push({ signal: 'AI websites visited in browser', tools: browserTools, weight: 0.30 });
  }
  const openTabs = browserActivity?.currentlyOpenAITabs ?? [];
  if (openTabs.length > 0) {
    score += 0.10;
    evidence.push({ signal: 'AI chat tab currently open in browser', tools: openTabs.map((t) => t.tool), weight: 0.10 });
  }

  // 3. Clipboard paste correlated with file changes
  const pasteCorrelations = clipboardActivity?.pasteToFileCorrelations ?? [];
  if (pasteCorrelations.length > 0) {
    score += 0.20;
    evidence.push({ signal: 'Large clipboard paste followed by file changes', count: pasteCorrelations.length, weight: 0.20 });
  } else if ((clipboardActivity?.codelikePastes ?? 0) > 0) {
    score += 0.10;
    evidence.push({ signal: 'Code-like content detected in clipboard', count: clipboardActivity.codelikePastes, weight: 0.10 });
  }

  // 4. Environment / API keys
  const apiKeyTools = envActivity?.toolsWithAPIKeys ?? [];
  if (apiKeyTools.length > 0) {
    score += 0.15;
    evidence.push({ signal: 'AI API keys found in environment', tools: apiKeyTools, weight: 0.15 });
  }

  // 5. Shell history
  if (shellHistory.uniqueToolsInvoked.length > 0) {
    score += 0.15;
    evidence.push({ signal: 'AI CLI commands in shell history', tools: shellHistory.uniqueToolsInvoked, weight: 0.15 });
  }

  // 6. Artifact detection
  const artifactTools = aiArtifacts.toolsFromArtifacts;
  if (artifactTools.length > 0) {
    score += 0.10;
    evidence.push({ signal: 'AI config artifacts found in project/home', tools: artifactTools, weight: 0.10 });
  }

  // 7. File change patterns
  if (fileActivity.likelyAIGeneratedChanges > 5) {
    score += 0.12;
    evidence.push({ signal: 'Multiple large file changes (paste pattern)', count: fileActivity.likelyAIGeneratedChanges, weight: 0.12 });
  } else if (fileActivity.likelyAIGeneratedChanges > 0) {
    score += 0.06;
    evidence.push({ signal: 'Some large file changes detected', count: fileActivity.likelyAIGeneratedChanges, weight: 0.06 });
  }

  if (fileActivity.simultaneousEditGroups > 0) {
    score += 0.08;
    evidence.push({ signal: 'Simultaneous multi-file edits (scaffolding pattern)', count: fileActivity.simultaneousEditGroups, weight: 0.08 });
  }

  // 8. Code content analysis
  const highScoreFiles = codeAnalysis?.highAIScoreFiles ?? [];
  if (highScoreFiles.length > 0) {
    score += 0.08;
    evidence.push({ signal: 'AI code patterns detected in file content', count: highScoreFiles.length, weight: 0.08 });
  }

  // 9. Git signals
  if (gitActivity.likelyAICommits > 0) {
    score += 0.08;
    evidence.push({ signal: 'Commits with AI-like characteristics', count: gitActivity.likelyAICommits, weight: 0.08 });
  }

  // 10. Network DNS
  const networkTools = networkActivity?.toolsViaNetwork ?? [];
  if (networkTools.length > 0) {
    score += 0.10;
    evidence.push({ signal: 'AI API domains resolved via DNS', tools: networkTools, weight: 0.10 });
  }

  score = Math.min(score, 1.0);

  const allTools = [
    ...activeTools, ...browserTools, ...apiKeyTools,
    ...artifactTools, ...shellHistory.uniqueToolsInvoked, ...networkTools,
  ];
  const toolCounts = {};
  for (const t of allTools) toolCounts[t] = (toolCounts[t] || 0) + 1;
  const primaryTool = Object.entries(toolCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  const confidence =
    evidence.length >= 3 && score > 0.5 ? 'high'
    : evidence.length >= 2 || score > 0.25 ? 'medium'
    : evidence.length > 0 ? 'low'
    : 'none';

  const detectedTools = { tools: [...new Set(allTools)], primaryTool, confidence };

  return { aiUsageScore: Math.round(score * 100) / 100, primaryTool, confidence, evidence, detectedTools };
}

function emptyTracking() {
  return {
    detectedTools: { tools: [], primaryTool: null, confidence: 'none' },
    fileActivity: { totalEvents: 0, uniqueFilesModified: 0, likelyAIGeneratedChanges: 0 },
    processActivity: { snapshotCount: 0, aiProcessesDetected: {}, toolNames: [] },
    gitActivity: { totalCommits: 0, likelyAICommits: 0, commits: [] },
    shellHistory: { aiCommandsFound: [], commandCountByTool: {}, uniqueToolsInvoked: [] },
    browserActivity: { aiSitesVisited: [], visitCountByTool: {}, toolsAccessedViaBrowser: [], currentlyOpenAITabs: [], totalVisits: 0 },
    clipboardActivity: { totalPasteEvents: 0, largePastesDetected: 0, codelikePastes: 0, pasteToFileCorrelations: [] },
    networkActivity: { aiDomainsResolved: {}, activeConnectionSnapshots: [], toolsViaNetwork: [] },
    aiArtifacts: { found: {}, toolsFromArtifacts: [] },
    envActivity: { activeEnvVars: {}, envFilesWithAIKeys: [], shellRcAPIKeys: [], toolsWithAPIKeys: [] },
    codeAnalysis: { filesAnalyzed: 0, highAIScoreFiles: [], avgCommentRatio: 0 },
    envContext: { installedTools: {}, gitConfig: {}, editorContext: {} },
    signals: { aiUsageScore: 0, primaryTool: null, confidence: 'none', evidence: [] },
  };
}
