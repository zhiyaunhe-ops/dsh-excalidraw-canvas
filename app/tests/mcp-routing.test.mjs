import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import express from 'express';
import { WebSocketServer } from 'ws';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkspace } from '../server.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const packageDir = path.dirname(require.resolve('mcp-excalidraw-server/package.json'));

test('MCP stdio routes two concurrent sessions to independent real canvas workers', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'canvas-mcp-routing-'));
  const app = express();
  app.use(express.json());
  let upstreamScene = { elements: [{ id: 'foreground-marker', type: 'rectangle', x: 1, y: 1, width: 20, height: 20, version: 1 }], files: {} };
  app.get('/api/elements', (_req, res) => res.json({ elements: upstreamScene.elements }));
  app.get('/api/files', (_req, res) => res.json({ files: upstreamScene.files }));
  app.post('/api/files', (req, res) => { upstreamScene.files = Object.fromEntries(req.body.files.map(file => [file.id, file])); res.json({}); });
  app.delete('/api/files/:id', (req, res) => { delete upstreamScene.files[req.params.id]; res.json({}); });
  app.post('/api/elements/sync', (req, res) => { upstreamScene.elements = req.body.elements; res.json({}); });
  const upstreamServer = createServer(app);
  const upstreamWss = new WebSocketServer({ server: upstreamServer });
  await new Promise(resolve => upstreamServer.listen(0, '127.0.0.1', resolve));
  const workspace = await createWorkspace({ root, packageDir, upstream: `http://127.0.0.1:${upstreamServer.address().port}` });
  workspace.server.listen(0, '127.0.0.1');
  await once(workspace.server, 'listening');
  const workspaceUrl = `http://127.0.0.1:${workspace.server.address().port}`;
  const router = spawn(process.execPath, [path.join(appRoot, 'mcp-router.mjs')], {
    cwd: appRoot,
    env: { ...process.env, CANVAS_WORKSPACE_URL: workspaceUrl },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const pending = new Map();
  let rpcId = 0;
  let stderr = '';
  router.stderr?.on('data', chunk => { stderr += chunk.toString(); });
  const lines = (await import('node:readline')).createInterface({ input: router.stdout });
  lines.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id === undefined) return;
    const waiter = pending.get(message.id);
    if (waiter) { pending.delete(message.id); clearTimeout(waiter.timer); waiter.resolve(message); }
  });
  function rpc(method, params) {
    const id = ++rpcId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP ${method} timed out. stderr: ${stderr}`)); }, 15000);
      pending.set(id, { resolve, reject, timer });
      router.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }
  async function api(url) {
    const response = await fetch(`${workspaceUrl}/workspace/api${url}`);
    return { response, body: await response.json() };
  }
  t.after(async () => {
    router.stdin.end();
    await Promise.race([once(router, 'exit'), new Promise(resolve => setTimeout(resolve, 1000))]);
    if (router.exitCode === null) router.kill();
    lines.close();
    await workspace.close();
    for (const client of upstreamWss.clients) client.terminate();
    await new Promise(resolve => upstreamWss.close(resolve));
    await new Promise(resolve => upstreamServer.close(resolve));
    await rm(root, { recursive: true, force: true });
  });

  const initialized = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'canvas-ci', version: '1' } });
  assert.equal(initialized.error, undefined);
  router.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
  const before = (await api('/documents')).body.activeId;
  const foregroundBefore = (await api(`/documents/${before}`)).body.scene;

  // One MCP connection carries two DSH session markers concurrently.
  const [a, b] = await Promise.all([
    rpc('tools/call', { name: 'create_element', arguments: { __dshCanvasSession: 'agent-session-a', id: 'element-from-a', type: 'rectangle', x: 10, y: 20 } }),
    rpc('tools/call', { name: 'create_element', arguments: { __dshCanvasSession: 'agent-session-b', id: 'element-from-b', type: 'ellipse', x: 80, y: 90 } }),
  ]);
  assert.equal(a.error, undefined);
  assert.equal(b.error, undefined);
  assert.notEqual(a.result?.isError, true, JSON.stringify(a));
  assert.notEqual(b.result?.isError, true, JSON.stringify(b));

  const [bindingA, bindingB] = await Promise.all([
    api('/assistant/bindings/agent-session-a'), api('/assistant/bindings/agent-session-b'),
  ]);
  assert.equal(bindingA.response.status, 200);
  assert.equal(bindingB.response.status, 200);
  const idA = bindingA.body.canvasId;
  const idB = bindingB.body.canvasId;
  assert.notEqual(idA, idB);
  const [docA, docB] = await Promise.all([api(`/documents/${idA}`), api(`/documents/${idB}`)]);
  assert.deepEqual(docA.body.scene.elements.map(element => element.id), ['element-from-a']);
  assert.deepEqual(docB.body.scene.elements.map(element => element.id), ['element-from-b']);
  assert.equal((await api('/documents')).body.activeId, before, 'background agent creation must not switch the foreground canvas');
  assert.deepEqual((await api(`/documents/${before}`)).body.scene.elements, foregroundBefore.elements, 'background tools must not overwrite the foreground canvas scene');

  await Promise.all([
    rpc('tools/call', { name: 'create_element', arguments: { __dshCanvasSession: 'agent-session-a', id: 'element-from-a-2', type: 'diamond', x: 40, y: 50 } }),
    rpc('tools/call', { name: 'create_element', arguments: { __dshCanvasSession: 'agent-session-a', id: 'element-from-a-3', type: 'ellipse', x: 60, y: 70 } }),
  ]);
  const docAAfter = await api(`/documents/${idA}`);
  assert.deepEqual(docAAfter.body.scene.elements.map(element => element.id).sort(), ['element-from-a', 'element-from-a-2', 'element-from-a-3']);
  assert.deepEqual((await api(`/documents/${idB}`)).body.scene.elements.map(element => element.id), ['element-from-b']);
});
