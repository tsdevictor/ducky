import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export const DUCKY_DIR = join(homedir(), '.ducky');
export const SESSION_FILE = join(DUCKY_DIR, 'session.json');
export const DATA_FILE = join(DUCKY_DIR, 'data.json');
export const DAEMON_LOG = join(DUCKY_DIR, 'daemon.log');

export function ensureDuckyDir() {
  if (!existsSync(DUCKY_DIR)) {
    mkdirSync(DUCKY_DIR, { recursive: true });
  }
}

export function readSession() {
  if (!existsSync(SESSION_FILE)) return null;
  try {
    return JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export function writeSession(session) {
  ensureDuckyDir();
  writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
}

export function clearSession() {
  if (existsSync(SESSION_FILE)) {
    import('fs').then(({ unlinkSync }) => {
      try { unlinkSync(SESSION_FILE); } catch {}
    });
  }
}

export function readData() {
  if (!existsSync(DATA_FILE)) return null;
  try {
    return JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export function isDaemonAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
