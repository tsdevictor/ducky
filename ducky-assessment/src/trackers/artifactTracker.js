import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PROJECT_ARTIFACTS = [
  { rel: '.claude', type: 'dir', tool: 'Claude Code', weight: 0.9 },
  { rel: 'CLAUDE.md', type: 'file', tool: 'Claude Code', weight: 0.85 },
  { rel: '.cursor', type: 'dir', tool: 'Cursor', weight: 0.9 },
  { rel: '.cursorignore', type: 'file', tool: 'Cursor', weight: 0.7 },
  { rel: '.cursorules', type: 'file', tool: 'Cursor', weight: 0.85 },
  { rel: '.aider.conf.yml', type: 'file', tool: 'Aider', weight: 0.9 },
  { rel: 'aider.conf.yml', type: 'file', tool: 'Aider', weight: 0.9 },
  { rel: '.aider.tags.cache.v3', type: 'dir', tool: 'Aider', weight: 0.85 },
  { rel: '.aider.chat.history.md', type: 'file', tool: 'Aider', weight: 0.95 },
  { rel: '.github/copilot-instructions.md', type: 'file', tool: 'GitHub Copilot', weight: 0.9 },
  { rel: '.copilot', type: 'dir', tool: 'GitHub Copilot', weight: 0.8 },
  { rel: '.continue', type: 'dir', tool: 'Continue.dev', weight: 0.9 },
  { rel: 'continue.json', type: 'file', tool: 'Continue.dev', weight: 0.85 },
  { rel: '.cody', type: 'dir', tool: 'Sourcegraph Cody', weight: 0.9 },
  { rel: '.tabnine', type: 'dir', tool: 'TabNine', weight: 0.85 },
  { rel: '.codeium', type: 'dir', tool: 'Codeium', weight: 0.85 },
  { rel: 'windsurf.json', type: 'file', tool: 'Windsurf', weight: 0.85 },
  { rel: '.supermaven', type: 'dir', tool: 'Supermaven', weight: 0.85 },
];

const HOME_ARTIFACTS = [
  { rel: '.claude', type: 'dir', tool: 'Claude Code', weight: 0.8 },
  { rel: '.cursor', type: 'dir', tool: 'Cursor', weight: 0.8 },
  { rel: '.aider', type: 'dir', tool: 'Aider', weight: 0.75 },
  { rel: '.config/continue', type: 'dir', tool: 'Continue.dev', weight: 0.75 },
];

const AI_VSCODE_EXTENSIONS = [
  'github.copilot',
  'github.copilot-chat',
  'sourcegraph.cody-ai',
  'continue.continue',
  'tabnine.tabnine-vscode',
  'codeium.codeium',
  'anthropic.claude',
  'rooveterinaryinc.roo-codemate',
  'supermaven.supermaven',
  'cursor',
];

export function scanArtifacts(projectDir) {
  const found = {};

  // Project-level artifacts
  for (const artifact of PROJECT_ARTIFACTS) {
    const fullPath = join(projectDir, artifact.rel);
    if (existsSync(fullPath)) {
      const stat = statSync(fullPath);
      found[artifact.rel] = {
        tool: artifact.tool,
        path: fullPath,
        weight: artifact.weight,
        size: stat.isDirectory() ? null : stat.size,
        modified: stat.mtime.toISOString(),
      };
    }
  }

  // Home-level artifacts
  const home = homedir();
  for (const artifact of HOME_ARTIFACTS) {
    const fullPath = join(home, artifact.rel);
    if (existsSync(fullPath)) {
      found[`~/${artifact.rel}`] = {
        tool: artifact.tool,
        path: fullPath,
        weight: artifact.weight,
        scope: 'global',
      };
    }
  }

  // VS Code extensions
  const vscodeExtDir = join(home, '.vscode', 'extensions');
  if (existsSync(vscodeExtDir)) {
    try {
      const extDirs = readdirSync(vscodeExtDir);
      const aiExts = extDirs.filter((d) =>
        AI_VSCODE_EXTENSIONS.some((p) => d.toLowerCase().startsWith(p))
      );
      if (aiExts.length > 0) {
        found['vscode-ai-extensions'] = {
          tool: 'VS Code AI Extensions',
          extensions: aiExts,
          weight: 0.7,
          scope: 'global',
        };
      }
    } catch {}
  }

  // Cursor extensions (Cursor uses same extension dir pattern)
  const cursorExtDir = join(home, '.cursor', 'extensions');
  if (existsSync(cursorExtDir)) {
    found['cursor-extensions'] = {
      tool: 'Cursor IDE',
      path: cursorExtDir,
      weight: 0.9,
      scope: 'global',
    };
  }

  // Check for AI content in package.json (SDK dependencies)
  const pkgPath = join(projectDir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };
      const aiDeps = Object.keys(allDeps).filter((d) =>
        /anthropic|openai|@ai-sdk|langchain|llm|gpt|claude/i.test(d)
      );
      if (aiDeps.length > 0) {
        found['package.json#ai-deps'] = {
          tool: 'AI SDK Dependencies',
          dependencies: aiDeps,
          weight: 0.6,
        };
      }
    } catch {}
  }

  // Check for Python AI packages
  const requirementsPath = join(projectDir, 'requirements.txt');
  if (existsSync(requirementsPath)) {
    try {
      const content = readFileSync(requirementsPath, 'utf8');
      const aiPkgs = content
        .split('\n')
        .filter((l) => /anthropic|openai|langchain|transformers|llm/i.test(l))
        .map((l) => l.trim())
        .filter(Boolean);
      if (aiPkgs.length > 0) {
        found['requirements.txt#ai-pkgs'] = {
          tool: 'Python AI Libraries',
          packages: aiPkgs,
          weight: 0.6,
        };
      }
    } catch {}
  }

  return found;
}
