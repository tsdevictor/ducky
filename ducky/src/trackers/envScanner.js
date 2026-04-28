import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const AI_ENV_VARS = [
  { key: 'ANTHROPIC_API_KEY', tool: 'Claude API' },
  { key: 'OPENAI_API_KEY', tool: 'OpenAI API' },
  { key: 'OPENAI_ORG_ID', tool: 'OpenAI API' },
  { key: 'CLAUDE_API_KEY', tool: 'Claude API' },
  { key: 'GROQ_API_KEY', tool: 'Groq API' },
  { key: 'GEMINI_API_KEY', tool: 'Gemini API' },
  { key: 'GOOGLE_AI_API_KEY', tool: 'Google AI API' },
  { key: 'COHERE_API_KEY', tool: 'Cohere API' },
  { key: 'MISTRAL_API_KEY', tool: 'Mistral API' },
  { key: 'TOGETHER_API_KEY', tool: 'Together AI' },
  { key: 'OPENROUTER_API_KEY', tool: 'OpenRouter' },
  { key: 'HUGGINGFACE_API_KEY', tool: 'HuggingFace' },
  { key: 'REPLICATE_API_TOKEN', tool: 'Replicate' },
  { key: 'PERPLEXITY_API_KEY', tool: 'Perplexity AI' },
  // Indirect indicators
  { key: 'CLAUDECODE', tool: 'Claude Code (active session)' },
  { key: 'CLAUDE_CODE_ENTRYPOINT', tool: 'Claude Code (active session)' },
  { key: 'CURSOR_TRACE', tool: 'Cursor' },
  { key: 'COPILOT_TOKEN', tool: 'GitHub Copilot' },
];

const ENV_FILE_NAMES = [
  '.env', '.env.local', '.env.development', '.env.production',
  '.env.test', '.envrc', 'config.env', '.secrets',
];

export function scanEnvironmentVars() {
  const found = {};
  for (const { key, tool } of AI_ENV_VARS) {
    if (process.env[key] !== undefined) {
      // Never store the actual key value — just record presence
      found[key] = {
        tool,
        present: true,
        hasValue: process.env[key].length > 0,
      };
    }
  }
  return found;
}

export function scanEnvFiles(projectDir) {
  const found = [];
  const searchDirs = [projectDir, join(projectDir, '..'), process.env.HOME || ''];

  for (const dir of searchDirs) {
    for (const fname of ENV_FILE_NAMES) {
      const fpath = join(dir, fname);
      if (!existsSync(fpath)) continue;

      try {
        const content = readFileSync(fpath, 'utf8');
        const lines = content.split('\n');
        const aiKeys = [];

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
          const varName = trimmed.split('=')[0].trim();

          for (const { key, tool } of AI_ENV_VARS) {
            if (varName === key || varName.includes(key.replace('_API_KEY', ''))) {
              aiKeys.push({ varName, tool });
              break;
            }
          }
        }

        if (aiKeys.length > 0) {
          found.push({
            file: fpath,
            aiKeys,
          });
        }
      } catch {}
    }
  }

  return found;
}

/**
 * Scan shell rc files for API key exports (static configuration).
 */
export function scanShellRcFiles() {
  const home = process.env.HOME || '';
  const rcFiles = [
    join(home, '.zshrc'),
    join(home, '.bashrc'),
    join(home, '.bash_profile'),
    join(home, '.profile'),
    join(home, '.zprofile'),
    join(home, '.config/fish/config.fish'),
  ];

  const found = [];
  for (const rcPath of rcFiles) {
    if (!existsSync(rcPath)) continue;
    try {
      const content = readFileSync(rcPath, 'utf8');
      for (const { key, tool } of AI_ENV_VARS) {
        if (content.includes(key)) {
          found.push({ file: rcPath, key, tool });
        }
      }
    } catch {}
  }
  return found;
}
