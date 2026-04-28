import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import {
  DUCKY_DIR,
  readSession,
  writeSession,
  isDaemonAlive,
  DAEMON_LOG,
} from '../utils/state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function startCommand() {
  const existing = readSession();

  if (existing) {
    if (isDaemonAlive(existing.pid)) {
      console.log(`🦆 Ducky is already tracking!`);
      console.log(`   Project : ${existing.projectDir}`);
      console.log(`   PID     : ${existing.pid}`);
      console.log(`   Started : ${new Date(existing.startTime).toLocaleString()}`);
      console.log(`\nRun 'ducky stop' to stop tracking and generate a report.`);
      return;
    }
    console.log('Found stale session (daemon not running), starting fresh...');
  }

  if (!existsSync(DUCKY_DIR)) {
    mkdirSync(DUCKY_DIR, { recursive: true });
  }

  const projectDir = process.cwd();
  const daemonPath = join(__dirname, '../daemon/daemon.js');

  let logFd;
  try {
    const { openSync } = await import('fs');
    logFd = openSync(DAEMON_LOG, 'a');
  } catch {
    logFd = null;
  }

  const stdioTarget = logFd !== null ? logFd : 'ignore';

  const daemon = spawn(process.execPath, [daemonPath, projectDir], {
    detached: true,
    stdio: ['ignore', stdioTarget, stdioTarget],
    env: { ...process.env },
  });

  daemon.unref();

  const session = {
    pid: daemon.pid,
    projectDir,
    startTime: new Date().toISOString(),
    dataFile: join(DUCKY_DIR, 'data.json'),
  };

  writeSession(session);

  console.log(`🦆 Ducky started tracking!`);
  console.log(`   Project : ${projectDir}`);
  console.log(`   PID     : ${daemon.pid}`);
  console.log(`   Data    : ${session.dataFile}`);
  console.log(`   Log     : ${DAEMON_LOG}`);
  console.log(`\nRun 'ducky stop' to stop tracking and generate ducky-report.json.`);
}
