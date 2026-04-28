import { readSession, isDaemonAlive } from '../utils/state.js';

export function statusCommand() {
  const session = readSession();

  if (!session) {
    console.log('🦆 No active tracking session.');
    return;
  }

  const alive = isDaemonAlive(session.pid);
  const elapsed = Math.round((Date.now() - new Date(session.startTime).getTime()) / 1000);
  const min = Math.floor(elapsed / 60);
  const sec = elapsed % 60;

  console.log(`🦆 Ducky tracking status:`);
  console.log(`   Status   : ${alive ? '● running' : '○ daemon stopped (stale session)'}`);
  console.log(`   Project  : ${session.projectDir}`);
  console.log(`   PID      : ${session.pid}`);
  console.log(`   Started  : ${new Date(session.startTime).toLocaleString()}`);
  console.log(`   Elapsed  : ${min}m ${sec}s`);
}
