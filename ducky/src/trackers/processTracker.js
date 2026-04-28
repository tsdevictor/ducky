import { execSync } from 'child_process';

const AI_SIGNATURES = [
  { regex: /\bcursor\b/i, name: 'Cursor' },
  { regex: /claude[- _]?code/i, name: 'Claude Code' },
  { regex: /claude(?!.*ducky)/i, name: 'Claude CLI' },
  { regex: /\baider\b/i, name: 'Aider' },
  { regex: /continue\.dev/i, name: 'Continue.dev' },
  { regex: /cody/i, name: 'Sourcegraph Cody' },
  { regex: /tabnine/i, name: 'TabNine' },
  { regex: /codeium/i, name: 'Codeium' },
  { regex: /windsurf/i, name: 'Windsurf' },
  { regex: /copilot/i, name: 'GitHub Copilot' },
  { regex: /supermaven/i, name: 'Supermaven' },
  { regex: /\bghostwriter\b/i, name: 'Replit Ghostwriter' },
];

// Exclude our own daemon process
const SELF_PATTERNS = [/ducky/, /daemon\.js/];

export function sampleProcesses() {
  try {
    const output = execSync('ps aux', { encoding: 'utf8', timeout: 5000 });
    const lines = output.split('\n').slice(1);
    const found = [];
    const seen = new Set();

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 11) continue;

      const pid = parseInt(parts[1]);
      const cpu = parseFloat(parts[2]);
      const mem = parseFloat(parts[3]);
      const cmd = parts.slice(10).join(' ');

      if (SELF_PATTERNS.some((p) => p.test(cmd))) continue;

      for (const { regex, name } of AI_SIGNATURES) {
        if (regex.test(cmd) && !seen.has(name)) {
          seen.add(name);
          found.push({ name, pid, cpu, mem, cmd: cmd.substring(0, 300) });
        }
      }
    }

    return { time: new Date().toISOString(), aiProcesses: found };
  } catch {
    return { time: new Date().toISOString(), aiProcesses: [] };
  }
}

export function getInstalledAITools() {
  const tools = {};

  const binaries = [
    { cmd: 'which claude', name: 'claude-cli' },
    { cmd: 'which aider', name: 'aider' },
    { cmd: 'which cursor', name: 'cursor' },
    { cmd: 'which cody', name: 'cody' },
    { cmd: 'which continue', name: 'continue' },
    { cmd: 'which gh', name: 'github-cli' },
  ];

  for (const { cmd, name } of binaries) {
    try {
      const path = execSync(cmd, { encoding: 'utf8', timeout: 2000 }).trim();
      if (path) tools[name] = { path };
    } catch {}
  }

  // Check npm global packages
  try {
    const globalPkgs = execSync('npm list -g --depth=0 --json 2>/dev/null', {
      encoding: 'utf8',
      timeout: 5000,
    });
    const parsed = JSON.parse(globalPkgs);
    const deps = Object.keys(parsed.dependencies || {});
    const aiPkgs = deps.filter((d) =>
      /anthropic|openai|claude|copilot|aider|codeium|tabnine|cursor|continue/i.test(d)
    );
    if (aiPkgs.length > 0) tools['npm-global-ai-packages'] = { packages: aiPkgs };
  } catch {}

  return tools;
}
