import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopOptions, desktopConfiguration, startDesktop } from '../../scripts/desktop.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function json(url, method = 'GET', body) {
  const response = await fetch(url, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { response, body: await response.json() };
}

test('desktop config uses absolute local paths, dedicated ports, and MCP environment', async () => {
  const root = path.join(os.tmpdir(), 'canvas-desktop-config');
  const options = desktopOptions({ CANVAS_LIBRARY_DIR: root, EXCALIDRAW_PORT: '31331', CANVAS_PORT: '19112' });
  assert.deepEqual(options, { root, canvasPort: 31331, workspacePort: 19112 });
  const config = desktopConfiguration(options);
  assert.equal(config.mode, 'desktop');
  assert.equal(path.isAbsolute(config.desktopDirectory), true);
  assert.equal(config.libraryDir, root);
  assert.equal(config.workspaceUrl, 'http://127.0.0.1:19112');
  assert.equal(config.publicUrl, config.workspaceUrl);
});

test('desktop startup saves and restores a document while releasing its ephemeral ports', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'canvas-desktop-state-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const canvasPort = await freePort();
  let workspacePort = await freePort();
  while (workspacePort === canvasPort) workspacePort = await freePort();
  const options = { root, canvasPort, workspacePort };
  let desktop;
  t.after(async () => { if (desktop) await desktop.close(); });

  desktop = await startDesktop(options);
  assert.equal(desktop.url, `http://127.0.0.1:${workspacePort}`);
  assert.equal(desktop.libraryDir, root);
  assert.equal(desktop.mcp.serverName, 'excalidraw');
  assert.equal(desktop.mcp.transport, 'stdio');
  assert.equal(desktop.mcp.env.EXPRESS_SERVER_URL, `http://127.0.0.1:${canvasPort}`);
  assert.equal(desktop.mcp.env.EXCALIDRAW_NO_AUTOSTART, '1');
  assert.equal(desktop.mcp.failOnStartupError, false);
  const runtime = await fetch(`${desktop.url}/workspace/runtime.js`);
  assert.match(await runtime.text(), /CANVAS_RUNTIME=\{"mode":"desktop"\}/);

  const created = await json(`${desktop.url}/workspace/api/documents`, 'POST', { title: 'Local notes', scene: { elements: [], files: {} } });
  assert.equal(created.response.status, 201);
  const id = created.body.document.id;
  await json(`${desktop.url}/workspace/api/documents/${id}/open`, 'POST', {});
  const current = await json(`${desktop.url}/workspace/api/documents/${id}`);
  const scene = { ...current.body.scene, elements: [{ id: 'saved-local', type: 'rectangle', x: 10, y: 20, width: 100, height: 60, version: 1 }] };
  const saved = await json(`${desktop.url}/workspace/api/documents/${id}`, 'PUT', { revision: current.body.document.revision, title: 'Local notes', scene });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.document.revision, current.body.document.revision + 1);

  await desktop.close();
  desktop = undefined;
  desktop = await startDesktop(options);
  const restored = await json(`${desktop.url}/workspace/api/documents/${id}`);
  assert.equal(restored.body.scene.elements[0].id, 'saved-local');
  assert.equal(restored.body.document.revision, saved.body.document.revision);
  assert.equal((await json(`${desktop.url}/workspace/api/documents`)).body.activeId, id);
  await desktop.close();
  desktop = undefined;

  for (const port of [canvasPort, workspacePort]) {
    const probe = createServer();
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
    await new Promise(resolve => probe.close(resolve));
  }
});

test('desktop refuses to adopt an unrelated service already occupying its canvas port', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'canvas-desktop-conflict-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const occupied = createServer((_request, response) => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ pid: -1 })); });
  await new Promise((resolve, reject) => { occupied.once('error', reject); occupied.listen(0, '127.0.0.1', resolve); });
  const canvasPort = occupied.address().port;
  const workspacePort = await freePort();
  try {
    await assert.rejects(startDesktop({ root, canvasPort, workspacePort }), /画布启动失败|超时/);
  } finally {
    await new Promise(resolve => occupied.close(resolve));
  }
});

test('host desktop mode starts the workspace, wires MCP, and registers cleanup', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'canvas-desktop-host-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pluginDir = path.join(root, 'plugin');
  const sessionDir = path.join(root, 'dsh-embed/plugin/dsh-canvas-session');
  const scriptsDir = path.join(root, 'scripts');
  const schemaDir = path.join(root, 'node_modules/@deepseek-ai/schemastery');
  const mcpDir = path.join(root, 'node_modules/@deepseek-ai/dsh-mcp-client');
  await Promise.all([mkdir(pluginDir, { recursive: true }), mkdir(sessionDir, { recursive: true }), mkdir(scriptsDir, { recursive: true }), mkdir(schemaDir, { recursive: true }), mkdir(mcpDir, { recursive: true })]);
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await cp(path.join(repoRoot, 'plugin/host.js'), path.join(pluginDir, 'host.js'));
  await cp(path.join(repoRoot, 'dsh-embed/plugin/dsh-canvas-session/host.js'), path.join(sessionDir, 'host.js'));
  await cp(path.join(repoRoot, 'dsh-embed/plugin/dsh-canvas-session/context.js'), path.join(sessionDir, 'context.js'));
  await writeFile(path.join(schemaDir, 'package.json'), '{"type":"module","exports":"./index.js"}');
  await writeFile(path.join(schemaDir, 'index.js'), `const chain = () => ({ default() { return this; }, description() { return this; } });\nexport default { object(value) { return value; }, union: chain, string: chain, number: chain };\n`);
  await writeFile(path.join(mcpDir, 'package.json'), '{"type":"module","exports":"./index.js"}');
  await writeFile(path.join(mcpDir, 'index.js'), 'export function apply() {}\n');
  await writeFile(path.join(scriptsDir, 'desktop.mjs'), `export function desktopOptions() { return { root: '/default', canvasPort: 3130, workspacePort: 9112 }; }\nexport async function startDesktop(options) { globalThis.__canvasDesktopStarted = options; return { url: 'http://127.0.0.1:49112', libraryDir: options.root, mcp: { serverName: 'excalidraw', transport: 'stdio', env: { EXPRESS_SERVER_URL: 'http://127.0.0.1:43130' } }, close: async () => { globalThis.__canvasDesktopClosed = true; } }; }\n`);
  const module = await import(new URL(`file://${path.join(pluginDir, 'host.js')}`).href + `?test=${Date.now()}`);
  const effects = [];
  const pluginCalls = [];
  const ctx = {
    agents: { list: () => [], get: () => undefined },
    tools: { register() {} }, on() {}, effect(fn) { effects.push(fn); },
    plugin(...args) { pluginCalls.push(args); }, logger: { info() {} },
  };
  await module.apply(ctx, { mode: 'desktop', desktopDirectory: root, libraryDir: path.join(root, 'canvas-data'), canvasPort: 41130, workspacePort: 49112 });
  assert.deepEqual(globalThis.__canvasDesktopStarted, { root: path.join(root, 'canvas-data'), canvasPort: 41130, workspacePort: 49112 });
  assert.equal(pluginCalls.length, 1);
  assert.equal(pluginCalls[0][1].serverName, 'excalidraw');
  assert.equal(pluginCalls[0][1].env.EXPRESS_SERVER_URL, 'http://127.0.0.1:43130');
  const stopDesktop = await effects[0]();
  await stopDesktop();
  assert.equal(globalThis.__canvasDesktopClosed, true);
  delete globalThis.__canvasDesktopStarted;
  delete globalThis.__canvasDesktopClosed;
});
