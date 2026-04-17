import { execSync } from 'child_process';

// Minimum clipboard size to consider "potentially AI output"
const PASTE_SIZE_THRESHOLD = 300;
// If a large paste is followed by a file change within this many ms, flag it
const CORRELATION_WINDOW_MS = 20_000;

let prevClipboardSize = 0;
let prevClipboardHash = null;
const pasteEvents = [];

function getClipboardSize() {
  try {
    const out = execSync('pbpaste | wc -c', {
      encoding: 'utf8',
      timeout: 1000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parseInt(out.trim()) || 0;
  } catch {
    return 0;
  }
}

function getClipboardPreview() {
  try {
    const out = execSync('pbpaste', {
      encoding: 'utf8',
      timeout: 1000,
      maxBuffer: 2048,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.substring(0, 200);
  } catch {
    return '';
  }
}

function looksLikeCode(text) {
  if (!text) return false;
  // Heuristics: contains common code patterns
  const codePatterns = [
    /^\s*(import|export|const|let|var|function|class|def |async |await )/m,
    /[{};]\s*$/m,
    /=>/,
    /^\s{2,}/m,  // indented lines
    /\/\//,       // comments
    /#.+/,        // hash comments
  ];
  return codePatterns.filter((p) => p.test(text)).length >= 2;
}

export function sampleClipboard(recentFileEvents) {
  const now = Date.now();
  const currentSize = getClipboardSize();

  if (currentSize > PASTE_SIZE_THRESHOLD && currentSize !== prevClipboardSize) {
    const preview = getClipboardPreview();
    const isCode = looksLikeCode(preview);

    const event = {
      time: new Date(now).toISOString(),
      size: currentSize,
      prevSize: prevClipboardSize,
      delta: currentSize - prevClipboardSize,
      looksLikeCode: isCode,
      preview: preview.substring(0, 120).replace(/\n/g, '↵'),
    };

    pasteEvents.push(event);
    prevClipboardSize = currentSize;

    return event;
  }

  prevClipboardSize = currentSize;
  return null;
}

export function correlatePastesWithFileChanges(pasteEvents, fileEvents) {
  const correlations = [];

  for (const paste of pasteEvents) {
    const pasteTime = new Date(paste.time).getTime();
    const nearbyFiles = fileEvents.filter((fe) => {
      const fileTime = new Date(fe.time).getTime();
      return fileTime >= pasteTime && fileTime <= pasteTime + CORRELATION_WINDOW_MS;
    });

    if (nearbyFiles.length > 0) {
      correlations.push({
        pasteTime: paste.time,
        pasteSize: paste.size,
        looksLikeCode: paste.looksLikeCode,
        filesChangedAfterPaste: nearbyFiles.map((f) => f.path),
        confidence: paste.looksLikeCode ? 'high' : 'medium',
      });
    }
  }

  return correlations;
}

export function getPasteEvents() {
  return pasteEvents;
}
