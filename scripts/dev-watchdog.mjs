import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const progressPath = path.join(repoRoot, 'memory', 'dev-loop-progress.md');

const taskCommands = new Map([
  ['v1.3.1-regression-checks', ['npm', ['run', 'check']]],
  ['v1.4.0-cdp-engine', ['npm', ['run', 'check']]],
  ['v1.5.0-realtime-suggestions', ['npm', ['run', 'check']]],
  ['v2.0.0-ai-recording', ['npm', ['run', 'check']]],
  ['v2.0.2-idempotent-operations', ['npm', ['run', 'check']]],
  ['v2.0.3-transaction-recovery', ['npm', ['run', 'check']]],
  ['v2.1.0-asset-store', ['npm', ['run', 'check']]],
  ['v2.1.1-export-scaling', ['npm', ['run', 'check']]],
  ['v2.2.0-agent-hardening', ['npm', ['run', 'check']]],
  ['v2.2.1-scale-stress', ['npm', ['run', 'check']]],
  ['v2.2.2-target-tab-guard', ['npm', ['run', 'check']]]
]);

const progress = await readFile(progressPath, 'utf8');
const nextTask = progress
  .split('\n')
  .map((line) => line.match(/^- \[ \] `([^`]+)` - (.+)$/))
  .find(Boolean);

if (!nextTask) {
  console.log('No pending dev-loop tasks found.');
  process.exit(0);
}

const [, taskId, description] = nextTask;
const command = taskCommands.get(taskId);

console.log(`Next task: ${taskId} - ${description}`);

if (!command) {
  throw new Error(`No watchdog command is registered for task: ${taskId}`);
}

const [bin, args] = command;
const child = spawn(bin, args, {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Watchdog command terminated by signal ${signal}`);
    process.exit(1);
  }

  process.exit(code ?? 1);
});
