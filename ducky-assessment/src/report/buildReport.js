/**
 * Transforms raw daemon data into the final ducky-report.json structure.
 */

export function buildReport(session, rawData, endTime) {
  const start = new Date(session.startTime);
  const end = new Date(endTime);
  const durationSeconds = Math.round((end - start) / 1000);

  if (!rawData) {
    return {
      metadata: {
        startTime: session.startTime,
        endTime,
        durationSeconds,
        projectDir: session.projectDir,
        version: '1.0.0',
      },
      tracking: emptyTracking(),
    };
  }

  const fileActivity = analyzeFileActivity(rawData.fileEvents || []);
  const processActivity = analyzeProcessActivity(rawData.processSnapshots || []);
  const gitActivity = analyzeGitActivity(rawData.gitCommits || []);
  const shellHistory = analyzeShellHistory(rawData.shellHistory || []);
  const aiArtifacts = analyzeArtifacts(rawData.aiArtifacts || {});
  const envContext = {
    installedTools: rawData.installedTools || {},
    gitConfig: rawData.gitConfig || {},
  };

  const signals = computeSignals({
    fileActivity,
    processActivity,
    gitActivity,
    shellHistory,
    aiArtifacts,
  });

  return {
    metadata: {
      startTime: session.startTime,
      endTime,
      durationSeconds,
      projectDir: session.projectDir,
      version: '1.0.0',
    },
    tracking: {
      detectedTools: signals.detectedTools,
      fileActivity,
      processActivity,
      gitActivity,
      shellHistory,
      aiArtifacts,
      envContext,
      signals,
    },
  };
}

// ── File activity ─────────────────────────────────────────────────────────────
function analyzeFileActivity(events) {
  const uniqueFiles = new Set(events.map((e) => e.path));
  const likelyAI = events.filter((e) => e.likelyAI);
  const largeChanges = events.filter((e) => e.sizeDelta > 3000);
  const simultaneousGroups = detectSimultaneousGroups(events);

  // Build a timeline: bucket events into 5-minute windows
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
  for (const e of events) {
    counts[e.path] = (counts[e.path] || 0) + 1;
  }
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
  const avgLines = Math.round(
    commits.reduce((s, c) => s + c.totalLines, 0) / commits.length
  );

  // Detect rapid commits (< 3 min apart)
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
  for (const cmd of commands) {
    byTool[cmd.tool] = (byTool[cmd.tool] || 0) + 1;
  }

  return {
    aiCommandsFound: commands.slice(0, 100),
    commandCountByTool: byTool,
    uniqueToolsInvoked: Object.keys(byTool),
  };
}

// ── Artifacts ─────────────────────────────────────────────────────────────────
function analyzeArtifacts(artifacts) {
  const found = artifacts;
  const toolsFromArtifacts = [...new Set(
    Object.values(found)
      .map((a) => a.tool)
      .filter(Boolean)
  )];

  return { found, toolsFromArtifacts };
}

// ── Signal scoring ────────────────────────────────────────────────────────────
function computeSignals({ fileActivity, processActivity, gitActivity, shellHistory, aiArtifacts }) {
  const evidence = [];
  let score = 0;

  // Process detection — strongest signal
  const activeTools = processActivity.toolNames;
  if (activeTools.length > 0) {
    score += 0.35;
    evidence.push({ signal: 'AI tools observed running', tools: activeTools, weight: 0.35 });
  }

  // Artifact detection
  const artifactTools = aiArtifacts.toolsFromArtifacts;
  if (artifactTools.length > 0) {
    score += 0.2;
    evidence.push({ signal: 'AI config artifacts found', tools: artifactTools, weight: 0.2 });
  }

  // Shell commands
  if (shellHistory.uniqueToolsInvoked.length > 0) {
    score += 0.2;
    evidence.push({ signal: 'AI CLI commands in shell history', tools: shellHistory.uniqueToolsInvoked, weight: 0.2 });
  }

  // File change patterns
  if (fileActivity.likelyAIGeneratedChanges > 5) {
    score += 0.15;
    evidence.push({ signal: 'Multiple large file changes detected', count: fileActivity.likelyAIGeneratedChanges, weight: 0.15 });
  } else if (fileActivity.likelyAIGeneratedChanges > 0) {
    score += 0.07;
    evidence.push({ signal: 'Some large file changes detected', count: fileActivity.likelyAIGeneratedChanges, weight: 0.07 });
  }

  if (fileActivity.simultaneousEditGroups > 0) {
    score += 0.1;
    evidence.push({ signal: 'Simultaneous multi-file edits detected', count: fileActivity.simultaneousEditGroups, weight: 0.1 });
  }

  // Git signals
  if (gitActivity.likelyAICommits > 0) {
    score += 0.1;
    evidence.push({ signal: 'Commits with AI-like characteristics', count: gitActivity.likelyAICommits, weight: 0.1 });
  }

  score = Math.min(score, 1.0);

  // Determine primary tool
  const allTools = [
    ...activeTools,
    ...artifactTools,
    ...shellHistory.uniqueToolsInvoked,
  ];
  const toolCounts = {};
  for (const t of allTools) toolCounts[t] = (toolCounts[t] || 0) + 1;
  const primaryTool = Object.entries(toolCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  const confidence =
    evidence.length >= 3 && score > 0.5
      ? 'high'
      : evidence.length >= 2 || score > 0.25
      ? 'medium'
      : evidence.length > 0
      ? 'low'
      : 'none';

  const detectedTools = {
    tools: [...new Set(allTools)],
    primaryTool,
    confidence,
  };

  return {
    aiUsageScore: Math.round(score * 100) / 100,
    primaryTool,
    confidence,
    evidence,
    detectedTools,
  };
}

function emptyTracking() {
  return {
    detectedTools: { tools: [], primaryTool: null, confidence: 'none' },
    fileActivity: { totalEvents: 0, uniqueFilesModified: 0, likelyAIGeneratedChanges: 0 },
    processActivity: { snapshotCount: 0, aiProcessesDetected: {}, toolNames: [] },
    gitActivity: { totalCommits: 0, likelyAICommits: 0, commits: [] },
    shellHistory: { aiCommandsFound: [], commandCountByTool: {}, uniqueToolsInvoked: [] },
    aiArtifacts: { found: {}, toolsFromArtifacts: [] },
    envContext: { installedTools: {}, gitConfig: {} },
    signals: { aiUsageScore: 0, primaryTool: null, confidence: 'none', evidence: [] },
  };
}
