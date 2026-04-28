import { execSync, spawnSync } from 'child_process';
import { existsSync, copyFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';

const home = homedir();

const AI_URL_PATTERNS = [
  { regex: /claude\.ai/i, tool: 'Claude.ai' },
  { regex: /chat\.openai\.com|chatgpt\.com/i, tool: 'ChatGPT' },
  { regex: /copilot\.microsoft\.com/i, tool: 'Microsoft Copilot' },
  { regex: /github\.com\/copilot/i, tool: 'GitHub Copilot' },
  { regex: /cursor\.sh|cursor\.com/i, tool: 'Cursor' },
  { regex: /aistudio\.google\.com/i, tool: 'Google AI Studio' },
  { regex: /gemini\.google\.com/i, tool: 'Gemini' },
  { regex: /perplexity\.ai/i, tool: 'Perplexity AI' },
  { regex: /phind\.com/i, tool: 'Phind' },
  { regex: /you\.com/i, tool: 'You.com AI' },
  { regex: /v0\.dev/i, tool: 'Vercel v0' },
  { regex: /bolt\.new/i, tool: 'StackBlitz Bolt' },
  { regex: /replit\.com.*ghostwriter/i, tool: 'Replit Ghostwriter' },
  { regex: /sourcegraph\.com.*cody/i, tool: 'Sourcegraph Cody' },
  { regex: /codeium\.com/i, tool: 'Codeium' },
  { regex: /tabnine\.com/i, tool: 'TabNine' },
  { regex: /windsurf\.ai|codeium.*windsurf/i, tool: 'Windsurf' },
  { regex: /aider\.chat/i, tool: 'Aider' },
  { regex: /anthropic\.com/i, tool: 'Anthropic' },
  { regex: /openai\.com/i, tool: 'OpenAI' },
  { regex: /console\.anthropic\.com/i, tool: 'Anthropic Console' },
  { regex: /platform\.openai\.com/i, tool: 'OpenAI Platform' },
];

// Chrome time is microseconds since Windows epoch (1601-01-01)
// Unix time is seconds since Unix epoch (1970-01-01)
// Difference: 11644473600 seconds
function chromeTimeToISO(chromeTime) {
  const unixMs = (Number(chromeTime) / 1000) - 11644473600000;
  return new Date(unixMs).toISOString();
}

const CHROME_PROFILES = [
  { name: 'Chrome', db: join(home, 'Library/Application Support/Google/Chrome/Default/History') },
  { name: 'Chrome Profile 1', db: join(home, 'Library/Application Support/Google/Chrome/Profile 1/History') },
  { name: 'Brave', db: join(home, 'Library/Application Support/BraveSoftware/Brave-Browser/Default/History') },
  { name: 'Arc', db: join(home, 'Library/Application Support/Arc/User Data/Default/History') },
  { name: 'Edge', db: join(home, 'Library/Application Support/Microsoft Edge/Default/History') },
  { name: 'Vivaldi', db: join(home, 'Library/Application Support/Vivaldi/Default/History') },
];

export function scanBrowserHistory(sinceISO) {
  const sinceMs = new Date(sinceISO).getTime();
  // Convert to Chrome time for filtering
  const sinceChromeTime = (sinceMs + 11644473600000) * 1000;
  const results = [];

  for (const profile of CHROME_PROFILES) {
    if (!existsSync(profile.db)) continue;

    const tmpDb = join(tmpdir(), `ducky_browser_${Date.now()}.db`);
    try {
      // Copy DB because Chrome locks it
      copyFileSync(profile.db, tmpDb);

      const query = `
        SELECT url, title, visit_count, last_visit_time
        FROM urls
        WHERE last_visit_time >= ${sinceChromeTime}
        ORDER BY last_visit_time DESC
        LIMIT 500;
      `;

      const result = spawnSync('sqlite3', [tmpDb, query], {
        encoding: 'utf8',
        timeout: 5000,
      });

      if (result.status !== 0) continue;

      const rows = result.stdout.trim().split('\n').filter(Boolean);
      for (const row of rows) {
        const parts = row.split('|');
        if (parts.length < 4) continue;
        const [url, title, visitCount, lastVisitTime] = parts;

        // Skip referral URLs (utm_source=chatgpt.com etc) — not direct AI visits
        if (url.includes('utm_source=')) continue;

        // Skip entries with bogus timestamps (Chrome time near zero = no real visit)
        const chromeTime = Number(lastVisitTime);
        if (chromeTime < 13_000_000_000_000_000) continue; // before ~2012

        for (const { regex, tool } of AI_URL_PATTERNS) {
          if (regex.test(url)) {
            results.push({
              browser: profile.name,
              url: url.substring(0, 200),
              title: (title || '').substring(0, 100),
              tool,
              visitCount: parseInt(visitCount) || 1,
              lastVisit: chromeTimeToISO(lastVisitTime),
            });
            break;
          }
        }
      }
    } catch {}

    try { unlinkSync(tmpDb); } catch {}
  }

  // Deduplicate by domain+tool
  const seen = new Set();
  return results.filter((r) => {
    try {
      const domain = new URL(r.url).hostname;
      const key = `${r.browser}:${domain}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    } catch {
      return true;
    }
  });
}

export function getOpenBrowserTabs() {
  // macOS AppleScript to read currently open tabs
  const browsers = [
    { name: 'Google Chrome', script: 'tell application "Google Chrome" to get URL of active tab of front window' },
    { name: 'Arc', script: 'tell application "Arc" to get URL of active tab of front window' },
    { name: 'Brave Browser', script: 'tell application "Brave Browser" to get URL of active tab of front window' },
    { name: 'Safari', script: 'tell application "Safari" to get URL of current tab of front window' },
  ];

  const openAITabs = [];

  for (const { name, script } of browsers) {
    try {
      const url = execSync(`osascript -e '${script}'`, {
        encoding: 'utf8',
        timeout: 2000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();

      for (const { regex, tool } of AI_URL_PATTERNS) {
        if (regex.test(url)) {
          openAITabs.push({ browser: name, url: url.substring(0, 200), tool });
          break;
        }
      }
    } catch {}
  }

  return openAITabs;
}
