import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const repository = fileURLToPath(new URL('../', import.meta.url));
const upstreamPackage = path.join(repository, 'app/node_modules/mcp-excalidraw-server');

export function desktopOptions(env = process.env) {
  return {
    root: path.resolve(env.CANVAS_LIBRARY_DIR || path.join(homedir(), '.dsh-canvas')),
    canvasPort: Number(env.EXCALIDRAW_PORT || 3130),
    workspacePort: Number(env.CANVAS_PORT || 9112),
  };
}

export function desktopConfiguration(options = desktopOptions()) {
  const url = `http://127.0.0.1:${options.workspacePort}`;
  return {
    mode: 'desktop',
    desktopDirectory: repository,
    libraryDir: options.root,
    workspaceUrl: url,
    publicUrl: url,
    canvasPort: options.canvasPort,
    workspacePort: options.workspacePort,
  };
}

export async function startDesktop(options = desktopOptions()) {
  await mkdir(options.root, { recursive: true });
  const upstream = `http://127.0.0.1:${options.canvasPort}`;
  const child = spawn(process.execPath, [path.join(upstreamPackage, 'dist/server.js')], {
    cwd: options.root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', HOST: '127.0.0.1', PORT: String(options.canvasPort) },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  let spawnError;
  child.on('error', error => { spawnError = error; });
  let workspace;
  async function close() {
    if (workspace) { await workspace.close(); workspace = undefined; }
    if (child.exitCode === null && child.signalCode === null && child.pid) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
  try {
    // A cold start of the canvas server can take tens of seconds: the Electron
    // binary is ~250 MB and the upstream bundle loads slowly before it binds
    // (measured 19s cold vs under 1s warm on Windows). Wait on a deadline, not
    // on a fixed attempt count, so a slow first start is not reported as a
    // timeout. CANVAS_READY_TIMEOUT_MS overrides the budget for slow machines.
    const readyTimeout = Number(process.env.CANVAS_READY_TIMEOUT_MS) || 60_000;
    const started = Date.now();
    let ready = false;
    for (let attempt = 0; !ready && Date.now() - started < readyTimeout; attempt++) {
      // Wait for this child to bind; an occupied port must not be adopted.
      await delay(100);
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`本机画布启动失败，请检查端口 ${options.canvasPort} 和上方日志`);
      try {
        const response = await fetch(`${upstream}/health`, { signal: AbortSignal.timeout(500) });
        ready = response.ok && (await response.json()).pid === child.pid;
      }
      catch { /* The new process is still starting. */ }
      if (!ready && attempt > 0 && attempt % 50 === 0) {
        console.info(`[canvas-session] 等待本机画布就绪 ${Math.round((Date.now() - started) / 1000)}s（端口 ${options.canvasPort}）`);
      }
    }
    if (!ready) throw new Error(`本机画布启动超时（${Math.round((Date.now() - started) / 1000)}s，端口 ${options.canvasPort}）`);
    const { createWorkspace } = await import('../app/server.mjs');
    const { expandElementsForExport } = await import(pathToFileURL(path.join(upstreamPackage, 'dist/core/expand-elements.js')));
    const { renderScene } = await import(pathToFileURL(path.join(upstreamPackage, 'dist/core/render/index.js')));
    workspace = await createWorkspace({ root: options.root, upstream, mode: 'desktop', expandElements: expandElementsForExport, renderScene });
    workspace.server.listen(options.workspacePort, '127.0.0.1');
    await once(workspace.server, 'listening');
    return {
      close,
      url: `http://127.0.0.1:${options.workspacePort}`,
      libraryDir: options.root,
      mcp: {
        serverName: 'excalidraw', transport: 'stdio', command: process.execPath,
        args: [path.join(repository, 'app/mcp-router.mjs')],
        env: { ELECTRON_RUN_AS_NODE: '1', CANVAS_WORKSPACE_URL: `http://127.0.0.1:${options.workspacePort}`, EXCALIDRAW_EXPORT_DIR: homedir() },
        failOnStartupError: false,
      },
    };
  } catch (error) { await close(); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--config')) console.log(JSON.stringify(desktopConfiguration(), null, 2));
  else {
    const desktop = await startDesktop();
    console.log(`本机画布：${desktop.url}/library/\n数据目录：${desktop.libraryDir}\nCtrl+C 停止；已有画布会保留。`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await desktop.close(); process.exit(0); });
  }
}
