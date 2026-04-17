import { execSync } from 'child_process';

const AI_DOMAINS = [
  { regex: /api\.anthropic\.com/i, tool: 'Claude API' },
  { regex: /api\.openai\.com/i, tool: 'OpenAI API' },
  { regex: /copilot\.githubusercontent\.com/i, tool: 'GitHub Copilot' },
  { regex: /proxy\.cursor\.sh/i, tool: 'Cursor' },
  { regex: /api\.cursor\.sh/i, tool: 'Cursor' },
  { regex: /claude\.ai/i, tool: 'Claude.ai' },
  { regex: /chat\.openai\.com/i, tool: 'ChatGPT' },
  { regex: /aistudio\.google\.com/i, tool: 'Google AI Studio' },
  { regex: /generativelanguage\.googleapis\.com/i, tool: 'Gemini API' },
  { regex: /api\.cohere\.ai/i, tool: 'Cohere API' },
  { regex: /api\.mistral\.ai/i, tool: 'Mistral API' },
  { regex: /api\.together\.ai/i, tool: 'Together AI' },
  { regex: /openrouter\.ai/i, tool: 'OpenRouter' },
  { regex: /codeium\.com/i, tool: 'Codeium' },
  { regex: /tabnine\.com/i, tool: 'TabNine' },
  { regex: /aider\.chat/i, tool: 'Aider' },
  { regex: /sourcegraph\.com/i, tool: 'Sourcegraph Cody' },
];

export function checkDNSCache() {
  const results = {};

  // macOS DNS cache dump
  try {
    const output = execSync('dscacheutil -cachedump -entries Host 2>/dev/null', {
      encoding: 'utf8',
      timeout: 3000,
    });

    const hostMatches = [...output.matchAll(/name:\s+(\S+)/g)].map((m) => m[1]);

    for (const host of hostMatches) {
      for (const { regex, tool } of AI_DOMAINS) {
        if (regex.test(host)) {
          if (!results[tool]) results[tool] = { domains: [], source: 'dns-cache' };
          if (!results[tool].domains.includes(host)) results[tool].domains.push(host);
        }
      }
    }
  } catch {}

  // Check active TCP connections to AI provider IP ranges via lsof
  try {
    const lsofOutput = execSync('lsof -i TCP -n -P 2>/dev/null | grep ESTABLISHED', {
      encoding: 'utf8',
      timeout: 3000,
    });

    const lines = lsofOutput.split('\n').filter(Boolean);
    for (const line of lines) {
      for (const { regex, tool } of AI_DOMAINS) {
        if (regex.test(line)) {
          if (!results[tool]) results[tool] = { domains: [], source: 'active-connection' };
          results[tool].source = 'active-connection';
        }
      }
    }
  } catch {}

  return results;
}

export function sampleNetworkConnections() {
  // Snapshot current TCP connections to AI providers
  const active = [];
  try {
    const out = execSync('lsof -i TCP:443 -n -P 2>/dev/null | grep ESTABLISHED', {
      encoding: 'utf8',
      timeout: 3000,
    });
    for (const line of out.split('\n').filter(Boolean)) {
      for (const { regex, tool } of AI_DOMAINS) {
        if (regex.test(line)) {
          const parts = line.trim().split(/\s+/);
          active.push({ tool, process: parts[0], time: new Date().toISOString() });
          break;
        }
      }
    }
  } catch {}
  return active;
}
