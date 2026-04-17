import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const AI_TOOL_PATTERNS = [
  { regex: /\bclaude\b/i, tool: 'Claude Code' },
  { regex: /\baider\b/i, tool: 'Aider' },
  { regex: /\bcursor\b/i, tool: 'Cursor' },
  { regex: /\bcody\b/i, tool: 'Sourcegraph Cody' },
  { regex: /\bcontinue\b/i, tool: 'Continue.dev' },
  { regex: /\bwindsurf\b/i, tool: 'Windsurf' },
  { regex: /openai/i, tool: 'OpenAI CLI' },
  { regex: /anthropic/i, tool: 'Anthropic CLI' },
  { regex: /chatgpt/i, tool: 'ChatGPT' },
  { regex: /ANTHROPIC_API_KEY|OPENAI_API_KEY|CLAUDE_API_KEY/i, tool: 'API Key Usage' },
  { regex: /npx\s+@anthropic|npm.*anthropic|pip install.*anthropic|pip install.*openai/i, tool: 'AI SDK Install' },
];

const HISTORY_FILES = [
  { path: join(homedir(), '.zsh_history'), format: 'zsh' },
  { path: join(homedir(), '.bash_history'), format: 'bash' },
  { path: join(homedir(), '.local/share/fish/fish_history'), format: 'fish' },
];

let historyCache = {};

export function sampleShellHistory(sinceISO) {
  const since = new Date(sinceISO).getTime() / 1000;
  const results = [];

  for (const { path, format } of HISTORY_FILES) {
    if (!existsSync(path)) continue;

    try {
      const stat = statSync(path);
      const cacheKey = path;
      const lastMtime = historyCache[cacheKey]?.mtime || 0;

      // Only re-read if file changed
      if (stat.mtimeMs <= lastMtime && historyCache[cacheKey]?.commands) {
        results.push(...historyCache[cacheKey].commands);
        continue;
      }

      const content = readFileSync(path, 'latin1');
      const lines = content.split('\n');
      const commands = [];

      for (const line of lines) {
        let timestamp = null;
        let command = '';

        if (format === 'zsh') {
          // ": 1700000000:0;command"
          const match = line.match(/^: (\d+):\d+;(.*)$/);
          if (match) {
            timestamp = parseInt(match[1]);
            command = match[2];
          } else if (!line.startsWith(':')) {
            command = line.trim();
          }
        } else if (format === 'fish') {
          // "- cmd: command\n  when: timestamp"
          const cmdMatch = line.match(/^- cmd: (.*)$/);
          if (cmdMatch) command = cmdMatch[1];
          const whenMatch = line.match(/^\s+when: (\d+)$/);
          if (whenMatch) timestamp = parseInt(whenMatch[1]);
        } else {
          command = line.trim();
        }

        if (!command) continue;
        if (timestamp !== null && timestamp < since) continue;

        for (const { regex, tool } of AI_TOOL_PATTERNS) {
          if (regex.test(command)) {
            commands.push({
              command: command.substring(0, 300),
              tool,
              timestamp: timestamp ? new Date(timestamp * 1000).toISOString() : null,
            });
            break;
          }
        }
      }

      historyCache[cacheKey] = { mtime: stat.mtimeMs, commands };
      results.push(...commands);
    } catch {}
  }

  // Deduplicate by command text
  const seen = new Set();
  return results.filter((c) => {
    if (seen.has(c.command)) return false;
    seen.add(c.command);
    return true;
  });
}
