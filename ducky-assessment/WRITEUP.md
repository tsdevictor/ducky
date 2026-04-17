# Ducky — WRITEUP

## Tracking Approach

Ducky collects signal from five independent evidence layers that AI tools leave on a developer's machine. The philosophy is triangulation: any one signal can be a false positive; convergence across multiple layers builds confident attribution.

### 1. Process Monitoring (`processTracker.js`)

Every 15 seconds the daemon runs `ps aux` and pattern-matches against a list of known AI tool process names: `cursor`, `claude`, `aider`, `copilot`, `codeium`, `tabnine`, `windsurf`, `supermaven`, and others. Each match is timestamped and stored with CPU/memory stats, giving a timeline of which tools were actively running during the session.

**Why**: Running process detection is the highest-confidence signal. A Cursor or Claude Code process can't be there by accident — the developer explicitly launched it.

### 2. File System Change Heuristics (`fileTracker.js`)

`chokidar` watches the project directory in real time. For each change event, the tracker computes the byte-delta against the previous file size. Two heuristics flag likely AI-generated changes:

- **Large single-write**: a file grows by >800 bytes in a single save event. Human typing produces many incremental saves; AI output typically lands in one large write.
- **Simultaneous multi-file edits**: 3+ files change within a 4-second window. AI tools that scaffold (Claude Code's multi-file edit, Cursor Composer, Aider) routinely write to multiple files atomically. A developer typing does not.

Both signals are stored per-event and aggregated in the report.

**Why**: File system traces survive even if the AI tool process is gone by the time `ducky stop` runs, giving retrospective evidence.

### 3. Git Commit Analysis (`gitTracker.js`)

Every 60 seconds the tracker reads `git log` since session start and scores each commit on:

- **Insertion count** (>50 lines → moderate signal; >200 lines → strong signal)
- **Files-changed count** (>5 files in one commit suggests scaffolding)
- **Message pattern** (short, imperative, generic messages like "Add feature" or "Update code" correlate with AI-suggested commit messages)

A composite 0–1 `aiScore` is assigned per commit.

**Why**: Git is ground truth. A commit that adds 500 lines across 12 files, authored with the message "Implement authentication," is a fundamentally different artifact than a series of small focused commits with context-rich messages.

### 4. Shell History (`historyTracker.js`)

Ducky tails `~/.zsh_history`, `~/.bash_history`, and `~/.local/share/fish/fish_history` every 30 seconds, filtering for direct invocations of AI CLIs: `claude`, `aider`, `cody`, `windsurf`, and others, plus API key exports (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).

**Why**: Direct CLI usage is unambiguous. If a developer typed `claude` or `aider` during the session, they chose to involve AI — the shell history records that intent explicitly.

### 5. Artifact Scanning (`artifactTracker.js`)

At startup and every 2 minutes, the tracker scans for files and directories that AI tools leave as configuration artifacts:

- **Project-level**: `.claude/`, `CLAUDE.md`, `.cursor/`, `.aider.chat.history.md`, `.continue/`, `.github/copilot-instructions.md`, etc.
- **Global**: `~/.claude/`, `~/.cursor/`, `~/.config/continue/`
- **IDE extensions**: scans `~/.vscode/extensions/` for known AI extension directories (e.g. `github.copilot-*`, `sourcegraph.cody-*`, `tabnine.*`)
- **Dependency files**: `package.json` and `requirements.txt` are checked for AI SDK packages (`@anthropic-ai/sdk`, `openai`, `langchain`, etc.)

**Why**: Artifacts persist across sessions and establish baseline capability context. A repo with `CLAUDE.md` is a project that has been configured for AI — that's meaningful even before any code is written.

---

## Signal Value: Why AI Usage Tracking Matters for Assessment

Traditional technical assessments — LeetCode, take-home projects, timed coding challenges — have a single-axis problem: they measure output quality without capturing how that output was produced. AI tools break that model entirely.

**What AI tracking reveals:**

1. **Cognitive ownership vs. delegation**: A developer who uses Claude Code to generate an initial scaffold but then heavily modifies, debugs, and refines the result demonstrates understanding. A developer who paste-accepts AI output without modification does not. The combination of large initial file writes followed by many small subsequent changes (visible in the file change timeline) indicates the former pattern.

2. **Prompt quality as a skill proxy**: Good engineers write precise, context-rich prompts. The `CLAUDE.md` file in a project is a direct artifact of that — developers who invest in crafting a detailed instructions file are engaging deeply with the tool, not outsourcing thinking to it.

3. **Tool selection judgment**: The set of AI tools in use (detected via processes and artifacts) reveals sophistication. A developer using Aider's architecture mode plus git-aware diffs is making different tool choices than one who pastes into ChatGPT repeatedly. These choices are visible.

4. **Iteration speed as leverage measurement**: High file-change velocity combined with frequent AI CLI invocations, small careful commits, and low large-write counts suggests a developer who uses AI at high cadence while retaining editorial control — arguably the highest-value pattern for a modern engineering team.

5. **What traditional assessments miss**: A 4-hour take-home can be completed by a poor engineer with heavy AI use and a great engineer without it, producing similar artifacts. Ducky adds the dimension of *how* the work was done — the pattern of tool invocations, change sizes, and commit velocity tells a story about the developer's process that the final code cannot.

---

## Limitations and Extensions

### Current Limitations

- **No clipboard monitoring**: The highest-signal individual event is a paste — a large block of text appearing in an editor from the clipboard after an AI query. macOS requires specific permissions (`com.apple.security.automation.apple-events`) to read clipboard content, so Ducky currently infers paste events from file size deltas rather than detecting them directly.

- **File size proxy is imprecise**: Byte-delta heuristics catch bulk changes but miss AI-assisted line rewrites (same file size, different content). A developer who asks AI to refactor existing code leaves no size footprint.

- **No editor telemetry**: VS Code and Cursor expose extension APIs that could stream Copilot ghost-text acceptance events, inline suggestion triggers, and chat message counts. Without hooking those APIs, Ducky sees the effect (file changes) rather than the cause (accepted suggestion).

- **Git analysis is retrospective**: The git tracker only sees committed work. Large amounts of AI-generated code that were written and then deleted before committing are invisible.

### Extensions I Would Build

**1. Clipboard monitoring**
With `com.apple.security.automation.apple-events` permissions (or the Accessibility API), a background watcher could track clipboard size on each change event. A paste of >500 characters into an editor window, preceded by a clipboard copy from a browser process (Chrome/Arc pointing at claude.ai or chatgpt.com), would be a very high-confidence AI paste event. On macOS this requires user-granted Accessibility permission, which is granted once at first `ducky start`.

**2. Browser tab monitoring via AppleScript**
```applescript
tell application "Google Chrome" to get URL of active tab of front window
```
Sampling open browser tabs for domains like `claude.ai`, `chat.openai.com`, `aistudio.google.com`, and `cursor.sh/chat` gives context-switch evidence: the developer left their editor, visited an AI chat, then returned and made changes. This is cheap (AppleScript, no special permissions beyond Accessibility) and high signal — it directly measures the "go ask AI" workflow.

**3. VS Code extension telemetry tap**
VS Code stores extension logs in `~/Library/Application Support/Code/logs/`. The GitHub Copilot extension logs accepted suggestion events with file and line context. A watcher on these log files would give per-file Copilot acceptance counts without requiring any VS Code API calls.

**4. Semantic diff analysis**
A post-session analysis step using a local LLM or simple statistical techniques (comment density, identifier naming entropy, cyclomatic complexity distribution) could compare AI-generated code patterns against the developer's established style in existing commits. If a new file has dramatically different stylometric fingerprints from the developer's historical commits, it's likely externally sourced.

**5. Keystroke dynamics**
macOS Input Monitoring permission allows reading keystroke events. The typing speed distribution before and after a file change differs dramatically: human typing clusters around 70–100 WPM with variance; AI-assisted content appears at effective "infinite" WPM (instant write). A keystroke monitor would make the "did a human type this or paste it" question answerable with near-certainty.

**6. Network DNS sampling**
`/usr/sbin/dscacheutil -cachedump -entries Host` shows recent DNS cache entries on macOS, which can reveal lookups to `api.anthropic.com`, `api.openai.com`, `copilot.githubusercontent.com` etc. — evidence that an AI API was called, even if no local process binary is detectable. This requires no special permissions and runs as a standard user.

**7. Screen content OCR (screenshotting)**
A periodic screenshot + OCR pass looking for AI chat UI patterns (the Claude gradient, the ChatGPT response bubbles, the Cursor chat panel) would capture tool usage even when the developer is running AI through a browser rather than a CLI. macOS Screen Recording permission would be required. Privacy-preserving: only analyze presence/absence of UI patterns, don't store screenshots.
