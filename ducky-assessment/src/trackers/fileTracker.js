import { statSync, existsSync } from 'fs';
import { relative } from 'path';

// Files/dirs to ignore — these generate too much noise
const IGNORE_PATTERNS = [
  /node_modules/,
  /\.git\//,
  /\.ducky\//,
  /ducky-report\.json/,
  /\.DS_Store/,
  /\.(log|lock)$/,
  /dist\//,
  /__pycache__/,
  /\.pyc$/,
  /\.egg-info/,
  /\.cache\//,
];

// Large threshold in bytes — changes above this are flagged as potential AI-generated
const LARGE_CHANGE_THRESHOLD = 800;
const VERY_LARGE_CHANGE_THRESHOLD = 3000;

// Window for detecting "simultaneous multi-file edits" (likely AI generating multiple files)
const SIMULTANEOUS_WINDOW_MS = 4000;

export function createFileTracker(projectDir) {
  const events = [];
  const fileSizeCache = new Map();
  let recentChanges = [];

  function shouldIgnore(absPath) {
    const rel = relative(projectDir, absPath);
    return IGNORE_PATTERNS.some((p) => p.test(rel) || p.test(absPath));
  }

  function getSize(absPath) {
    try {
      return existsSync(absPath) ? statSync(absPath).size : 0;
    } catch {
      return 0;
    }
  }

  function onFileEvent(eventType, absPath) {
    if (shouldIgnore(absPath)) return;

    const now = Date.now();
    const rel = relative(projectDir, absPath);
    const newSize = getSize(absPath);
    const prevSize = fileSizeCache.get(absPath) ?? null;
    const sizeDelta = prevSize !== null ? newSize - prevSize : newSize;

    fileSizeCache.set(absPath, newSize);

    // Prune old recent changes
    recentChanges = recentChanges.filter((e) => now - e.ts < SIMULTANEOUS_WINDOW_MS);
    recentChanges.push({ ts: now, path: rel });

    const simultaneousFiles = recentChanges.map((e) => e.path);
    const isSimultaneous = simultaneousFiles.length >= 3;

    const likelyAI =
      sizeDelta > VERY_LARGE_CHANGE_THRESHOLD ||
      (sizeDelta > LARGE_CHANGE_THRESHOLD && prevSize !== null) ||
      isSimultaneous;

    const event = {
      time: new Date(now).toISOString(),
      path: rel,
      type: eventType,
      newSize,
      prevSize,
      sizeDelta,
      isSimultaneous,
      simultaneousCount: isSimultaneous ? simultaneousFiles.length : 0,
      likelyAI,
    };

    events.push(event);
  }

  function getEvents() {
    return events;
  }

  function initSizes(absPath) {
    if (!shouldIgnore(absPath)) {
      fileSizeCache.set(absPath, getSize(absPath));
    }
  }

  return { onFileEvent, getEvents, initSizes };
}
