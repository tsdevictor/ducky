# Ducky - AI Usage Tracker CLI

## Overview

Modern developers increasingly use AI coding assistants (Copilot, Cursor, Claude Code, ChatGPT, etc.) as part of their workflow. Build a CLI tool called **ducky** that passively monitors a developer's local environment to capture signal about how they use AI tools during a coding session.

### Functions

1. **`ducky start`**
   - Begins monitoring the current working directory for signals of AI tool usage.
   - Runs a background process or watcher that persists after the terminal command returns.
   - Prints confirmation that tracking has started and where data is being stored.
   - Handles the case where tracking is already active (do not start duplicate watchers).

2. **`ducky stop`**
   - Stops the background tracking process.
   - Generates a report file (`ducky-report.json`) in the project root summarizing the captured data.
   - Prints a summary to the terminal before exiting.
   - Handles the case where no active tracking session exists.
