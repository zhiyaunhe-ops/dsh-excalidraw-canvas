import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../app/', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const args of [['ci'], ['run', 'build']]) {
  const result = spawnSync(npm, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('本机依赖已就绪。运行 npm run desktop:config，将输出填入 DSH 插件的 canvas-session-scope 配置，并设置 mode 为 desktop。');
