import { spawn } from 'node:child_process';

const processes = [
  spawn(process.execPath, ['--watch', 'server/index.js'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' }),
];
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  for (const child of processes) child.kill();
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
for (const child of processes) child.on('exit', close);
