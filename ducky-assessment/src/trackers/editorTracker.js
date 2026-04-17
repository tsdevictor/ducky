import { execSync } from 'child_process';
import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const home = homedir();

/**
 * Reads Cursor's recent conversation logs to detect active AI chat sessions.
 * Cursor stores chat history in a SQLite DB under:
 * ~/Library/Application Support/Cursor/User/globalStorage/
 */
export function scanCursorChatHistory() {
  const cursorStorage = join(
    home,
    'Library/Application Support/Cursor/User/globalStorage'
  );
  if (!existsSync(cursorStorage)) return null;

  try {
    const entries = readdirSync(cursorStorage, { withFileTypes: true });
    const dbFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith('.vscdb'))
      .map((e) => {
        const p = join(cursorStorage, e.name);
        return { path: p, mtime: statSync(p).mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);

    if (dbFiles.length === 0) return null;

    return {
      dbCount: dbFiles.length,
      mostRecentDb: dbFiles[0].path,
      lastModified: dbFiles[0].mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Checks Claude Code's conversation logs stored in ~/.claude/
 */
export function scanClaudeCodeLogs() {
  const claudeDir = join(home, '.claude');
  if (!existsSync(claudeDir)) return null;

  const result = { logsFound: false, recentConversations: [] };

  try {
    // Check global history.jsonl
    const histPath = join(claudeDir, 'history.jsonl');
    if (existsSync(histPath)) {
      const stat = statSync(histPath);
      result.globalHistorySize = stat.size;
      result.globalHistoryModified = stat.mtime.toISOString();
    }

    const projectsDir = join(claudeDir, 'projects');
    if (existsSync(projectsDir)) {
      const projectDirs = readdirSync(projectsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
      result.projectCount = projectDirs.length;

      for (const dir of projectDirs.slice(0, 10)) {
        const dirPath = join(projectsDir, dir.name);
        try {
          const files = readdirSync(dirPath)
            .filter((f) => f.endsWith('.jsonl') || f.endsWith('.json'))
            .map((f) => {
              const p = join(dirPath, f);
              const s = statSync(p);
              return { file: f, mtime: s.mtime, size: s.size };
            })
            .filter((f) => f.size > 100)
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, 2);

          for (const f of files) {
            result.recentConversations.push({
              project: dir.name,
              file: f.file,
              lastModified: f.mtime.toISOString(),
              sizeBytes: f.size,
            });
          }
        } catch {}
      }
    }

    result.logsFound = result.recentConversations.length > 0 || !!result.globalHistorySize;
  } catch {}

  return result;
}

/**
 * Checks VS Code extension host logs for Copilot activity
 */
export function scanVSCodeCopilotLogs() {
  const logsBase = join(home, 'Library/Application Support/Code/logs');
  if (!existsSync(logsBase)) return null;

  try {
    // Find most recent log session directory
    const sessions = readdirSync(logsBase, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => ({
        name: e.name,
        path: join(logsBase, e.name),
        mtime: statSync(join(logsBase, e.name)).mtime,
      }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 3);

    let copilotLogFound = false;
    let lastActivity = null;
    let suggestionCount = 0;

    for (const session of sessions) {
      try {
        const files = readdirSync(session.path, { recursive: true })
          .filter((f) => typeof f === 'string' && f.includes('copilot') && f.endsWith('.log'))
          .slice(0, 2);

        for (const logFile of files) {
          const fullPath = join(session.path, logFile);
          try {
            const stat = statSync(fullPath);
            if (stat.size > 0) {
              copilotLogFound = true;
              lastActivity = stat.mtime.toISOString();
              // Count suggestion lines as a proxy for usage intensity
              const content = readFileSync(fullPath, 'utf8');
              suggestionCount += (content.match(/acceptedSuggestion|completionAccepted/g) || []).length;
            }
          } catch {}
        }
      } catch {}
    }

    if (!copilotLogFound) return null;

    return { copilotLogFound, lastActivity, acceptedSuggestionCount: suggestionCount };
  } catch {
    return null;
  }
}

/**
 * Checks macOS recent apps using `mdls` on common AI app bundles
 */
export function checkInstalledAIApps() {
  const apps = [
    { name: 'Cursor', bundle: 'com.todesktop.230313mzl4w4u92' },
    { name: 'Claude', bundle: 'com.anthropic.claudefordesktop' },
    { name: 'ChatGPT', bundle: 'com.openai.chat' },
    { name: 'Windsurf', bundle: 'com.exafunction.windsurf' },
  ];

  const appPaths = [
    '/Applications',
    join(home, 'Applications'),
  ];

  const found = [];

  for (const { name, bundle } of apps) {
    // Try mdfind to locate the app
    try {
      const result = execSync(
        `mdfind "kMDItemCFBundleIdentifier == '${bundle}'" 2>/dev/null`,
        { encoding: 'utf8', timeout: 3000 }
      ).trim();
      if (result) {
        found.push({ name, bundle, path: result.split('\n')[0] });
        continue;
      }
    } catch {}

    // Fallback: check /Applications directly
    for (const appDir of appPaths) {
      const appPath = join(appDir, `${name}.app`);
      if (existsSync(appPath)) {
        found.push({ name, bundle, path: appPath });
        break;
      }
    }
  }

  return found;
}
