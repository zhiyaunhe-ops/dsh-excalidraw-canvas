import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWorkspace } from '../server.mjs';
import { apply as applyCanvasHost } from '../../dsh-embed/plugin/dsh-canvas-session/host.js';

const element = (id, x = 1) => ({ id, type: 'rectangle', x, y: 2, width: 30, height: 20, version: 1 });
const expandElements = process.env.MCP_EXCALIDRAW_EXPANDER
  ? (await import(pathToFileURL(process.env.MCP_EXCALIDRAW_EXPANDER).href)).expandElementsForExport
  : undefined;

async function fixture(initial = { elements: [], files: {} }, workspaceOptions = {}) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'canvas-workspace-'));
  const app = express();
  app.use(express.json());
  const controls = { failSync: false, delayedSyncEventMs: 0 };
  let live = structuredClone(initial);
  app.get('/api/elements', (_req, res) => res.json({ elements: live.elements }));
  app.get('/api/files', (_req, res) => res.json({ files: live.files }));
  app.post('/api/files', (req, res) => { live.files = Object.fromEntries(req.body.files.map(file => [file.id, file])); res.json({}); });
  app.delete('/api/files/:id', (req, res) => { delete live.files[req.params.id]; res.json({}); });
  app.post('/api/elements/sync', (req, res) => {
    if (controls.failSync) return res.status(503).json({ error: 'mock upstream failure' });
    live.elements = req.body.elements;
    if (controls.delayedSyncEventMs) setTimeout(() => {
      for (const client of wss.clients) client.send(JSON.stringify({ type: 'scene' }));
    }, controls.delayedSyncEventMs);
    res.json({});
  });
  const server = createServer(app);
  const wss = new WebSocketServer({ server });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const upstream = `http://127.0.0.1:${server.address().port}`;
  const startWorkspace = async () => {
    const instance = await createWorkspace({ root: temp, upstream, expandElements, renderScene: async () => ({ data: '<svg />' }), ...workspaceOptions });
    await new Promise((resolve, reject) => {
      instance.server.once('listening', resolve);
      instance.server.once('error', reject);
      instance.server.listen(0, '127.0.0.1');
    });
    return instance;
  };
  let workspace = await startWorkspace();
  let base = `http://127.0.0.1:${workspace.server.address().port}`;
  const request = async (url, options = {}) => {
    const response = await fetch(base + url, options);
    const type = response.headers.get('content-type') || '';
    return { response, body: type.includes('json') ? await response.json() : await response.text() };
  };
  const send = (method, url, body) => request(url, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const close = async () => {
    await workspace.close();
    for (const client of wss.clients) client.terminate();
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  };
  const restart = async () => {
    await workspace.close();
    workspace = await startWorkspace();
    base = `http://127.0.0.1:${workspace.server.address().port}`;
  };
  return { temp, get workspace() { return workspace; }, get base() { return base; }, request, send, close, restart, get live() { return live; }, set live(value) { live = value; }, controls, wss };
}

function mockHost(f, agentSpecs) {
  const handlers = new Map();
  const tools = new Map();
  const prompts = new Map();
  const effects = [];
  const agents = new Map(agentSpecs.map(({ id, parentSession }) => {
    const agent = {
      id,
      session: { header: { parentSession } },
      ctx: { systemPrompt: { context(options) { prompts.set(id, options); return () => prompts.delete(id); } } },
    };
    return [id, agent];
  }));
  const ctx = {
    agents: { list: () => [...agents.values()], get: id => agents.get(id) },
    tools: { register(definition) { tools.set(definition.name, definition); } },
    on(name, handler) { handlers.set(name, handler); },
    effect(effect) { effects.push(effect); },
    logger: { info() {} },
  };
  applyCanvasHost(ctx, { libraryDir: f.temp, workspaceUrl: f.base, publicUrl: 'https://canvas.example.test' });
  return {
    agents, tools, prompts,
    execute(execution, next = async () => ({ ok: true })) { return handlers.get('tools/execute')(execution, next); },
    async close() { const cleanup = await effects[0](); await cleanup(); },
  };
}

test('adopts existing upstream scene and supports create, save, rename, list, export, and delete', async t => {
  const image = { id: 'image-1', dataURL: 'data:image/png;base64,AA==', mimeType: 'image/png' };
  const f = await fixture({ elements: [element('adopted')], files: { 'image-1': image } });
  t.after(f.close);
  const initial = await f.request('/workspace/api/documents');
  assert.equal(initial.body.documents.length, 1);
  const adopted = initial.body.documents[0];
  let detail = await f.request(`/workspace/api/documents/${adopted.id}`);
  assert.deepEqual(detail.body.scene.elements.map(el => el.id), ['adopted']);
  assert.deepEqual(detail.body.scene.files, { 'image-1': image });

  const created = await f.send('POST', '/workspace/api/documents', { title: 'Draft', scene: { elements: [element('created')], appState: {}, files: { 'image-1': image } } });
  assert.equal(created.response.status, 201);
  const id = created.body.document.id;
  const savedScene = { ...created.body.scene, elements: [element('saved', 10)] };
  const saved = await f.send('PUT', `/workspace/api/documents/${id}`, { revision: 1, title: 'Saved title', scene: savedScene });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.document.revision, 2);
  const renamed = await f.send('PATCH', `/workspace/api/documents/${id}`, { title: 'Renamed' });
  assert.equal(renamed.body.document.title, 'Renamed');
  const exported = await f.request(`/workspace/api/documents/${id}/export/excalidraw`);
  assert.equal(exported.body.elements[0].id, 'saved');
  assert.equal(exported.body.files['image-1'].dataURL, image.dataURL);
  const listed = await f.request('/workspace/api/documents');
  assert(listed.body.documents.some(doc => doc.id === id && doc.title === 'Renamed'));
  const deleted = await f.send('DELETE', `/workspace/api/documents/${id}`);
  assert.equal(deleted.body.success, true);
  assert.equal((await f.request(`/workspace/api/documents/${id}`)).response.status, 404);
});

test('persists nested folders and moves documents without changing scenes or bindings', async t => {
  const f = await fixture({ elements: [element('foreground')], files: {} });
  t.after(f.close);
  const foregroundId = (await f.request('/workspace/api/documents')).body.activeId;
  const project = await f.send('POST', '/workspace/api/folders', { name: 'Hainan' });
  assert.equal(project.response.status, 201);
  const projectId = project.body.folder.id;
  const nested = await f.send('POST', '/workspace/api/folders', { name: 'Diagrams', parentId: projectId });
  assert.equal(nested.response.status, 201);
  const folderId = nested.body.folder.id;

  const doc = await f.send('POST', '/workspace/api/documents', { title: 'Route map', folderId, scene: { elements: [element('route-map')], files: { image: { id: 'image', dataURL: 'data:image/png;base64,AA==', mimeType: 'image/png' } } } });
  assert.equal(doc.response.status, 201);
  const docId = doc.body.document.id;
  assert.equal(doc.body.document.folderId, folderId);
  assert.equal(doc.body.document.folderPath, 'Hainan / Diagrams');
  const agent = await f.send('POST', '/workspace/api/assistant/ensure', { sessionId: 'folder-agent', title: 'Agent map', folderId: projectId });
  const agentId = agent.body.canvasId;
  assert.equal(agent.body.document.folderPath, 'Hainan');
  const host = mockHost(f, [{ id: 'folder-agent' }]);
  t.after(() => host.close());
  assert.match(host.prompts.get('folder-agent').text(), /文件夹: Hainan/);

  const beforeDoc = await f.request(`/workspace/api/documents/${docId}`);
  const beforeAgentBinding = await f.request('/workspace/api/assistant/bindings/folder-agent');
  const beforeActive = (await f.request('/workspace/api/documents')).body.activeId;
  assert.equal(beforeActive, foregroundId);
  assert.equal((await f.send('DELETE', `/workspace/api/folders/${projectId}`)).response.status, 409, 'a folder with children/documents cannot be deleted');
  assert.equal((await f.send('PATCH', `/workspace/api/folders/${projectId}`, { parentId: folderId })).response.status, 400, 'moving a parent into its child must be rejected');

  const invalidBatch = await f.send('POST', '/workspace/api/documents/move', { ids: [docId, 'missing-document'], folderId: null });
  assert.equal(invalidBatch.response.status, 404);
  assert.equal((await f.request(`/workspace/api/documents/${docId}`)).body.document.folderId, folderId, 'invalid batches must not move any document');

  const moved = await f.send('POST', '/workspace/api/documents/move', { ids: [docId, agentId], folderId });
  assert.equal(moved.response.status, 200);
  assert.deepEqual(moved.body.documents.map(item => item.folderId), [folderId, folderId]);
  const afterMove = await f.request(`/workspace/api/documents/${docId}`);
  const afterAgentBinding = await f.request('/workspace/api/assistant/bindings/folder-agent');
  assert.deepEqual(afterMove.body.scene, beforeDoc.body.scene);
  assert.equal(afterMove.body.document.revision, beforeDoc.body.document.revision);
  assert.equal(afterMove.body.document.folderPath, 'Hainan / Diagrams');
  assert.match(host.prompts.get('folder-agent').text(), /文件夹: Hainan \/ Diagrams/);
  assert.equal(afterAgentBinding.body.canvasId, beforeAgentBinding.body.canvasId);
  assert.equal((await f.request('/workspace/api/documents')).body.activeId, beforeActive);

  const saved = await f.send('PUT', `/workspace/api/documents/${docId}`, {
    revision: afterMove.body.document.revision,
    title: 'Route map saved',
    scene: { ...afterMove.body.scene, elements: [element('route-map-saved')] },
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.document.folderId, folderId);
  assert.equal(saved.body.document.folderPath, 'Hainan / Diagrams');

  await f.restart();
  const restored = await f.request('/workspace/api/documents');
  assert(restored.body.folders.some(item => item.id === projectId && item.name === 'Hainan'));
  assert(restored.body.folders.some(item => item.id === folderId && item.parentId === projectId));
  assert.equal(restored.body.documents.find(item => item.id === docId).folderId, folderId);
  assert.equal(restored.body.documents.find(item => item.id === agentId).folderId, folderId);
  assert.equal(restored.body.activeId, foregroundId);
  assert.equal((await f.request('/workspace/api/assistant/bindings/folder-agent')).body.canvasId, agentId);
});

test('rejects stale revisions and opening a different document preserves both documents', async t => {
  const f = await fixture({ elements: [element('initial')], files: {} });
  t.after(f.close);
  const created = await f.send('POST', '/workspace/api/documents', { title: 'Other', scene: { elements: [element('other')], files: {} } });
  const otherId = created.body.document.id;
  const activeId = (await f.request('/workspace/api/documents')).body.activeId;
  const detail = await f.request(`/workspace/api/documents/${activeId}`);
  const stale = await f.send('PUT', `/workspace/api/documents/${activeId}`, { revision: detail.body.document.revision - 1, scene: detail.body.scene });
  assert.equal(stale.response.status, 409);
  const opened = await f.send('POST', `/workspace/api/documents/${otherId}/open`, {});
  assert.equal(opened.body.document.id, otherId);
  assert.deepEqual(f.live.elements.map(el => el.id), ['other']);
  const preserved = await f.request(`/workspace/api/documents/${activeId}`);
  assert.deepEqual(preserved.body.scene.elements.map(el => el.id), ['initial']);
  assert.equal((await f.request(`/workspace/api/documents/${otherId}`)).body.scene.elements[0].id, 'other');
});

test('captures upstream websocket edits with their files and restores active document after restart', async t => {
  const f = await fixture({ elements: [element('start')], files: {} });
  t.after(f.close);
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('workspace did not connect to upstream')), 2000);
    f.wss.once('connection', () => { clearTimeout(deadline); resolve(); });
  });
  const docs = await f.request('/workspace/api/documents');
  const id = docs.body.activeId;
  const image = { id: 'agent-image', dataURL: 'data:image/png;base64,BB==', mimeType: 'image/png' };
  f.live = { elements: [element('agent-edited', 12)], files: { 'agent-image': image } };
  for (const client of f.wss.clients) client.send(JSON.stringify({ type: 'scene' }));
  let persisted;
  for (let i = 0; i < 30; i++) {
    persisted = await f.request(`/workspace/api/documents/${id}`);
    if (persisted.body.scene.elements[0]?.id === 'agent-edited') break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(persisted.body.scene.elements[0].id, 'agent-edited');
  assert.equal(persisted.body.scene.files['agent-image'].dataURL, image.dataURL);
  await f.restart();
  const restored = await f.request('/workspace/api/documents');
  assert.equal(restored.body.activeId, id);
  assert.deepEqual(f.live.elements.map(el => el.id), ['agent-edited']);
  assert.equal(f.live.files['agent-image'].dataURL, image.dataURL);
});

test('keeps cloud save successful when upstream sync fails and returns the committed revision', async t => {
  const f = await fixture({ elements: [element('start')], files: {} });
  t.after(f.close);
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('workspace did not connect to upstream')), 2000);
    f.wss.once('connection', () => { clearTimeout(deadline); resolve(); });
  });
  const id = (await f.request('/workspace/api/documents')).body.activeId;
  const current = await f.request(`/workspace/api/documents/${id}`);
  f.controls.failSync = true;
  const attempted = await f.send('PUT', `/workspace/api/documents/${id}`, {
    revision: current.body.document.revision,
    scene: { ...current.body.scene, elements: [element('saved-to-cloud')] },
  });
  assert.equal(attempted.response.status, 200);
  assert.equal(attempted.body.liveSynced, false);
  assert.equal(attempted.body.document.revision, current.body.document.revision + 1);
  const committed = await f.request(`/workspace/api/documents/${id}`);
  assert.equal(committed.body.scene.elements[0].id, 'saved-to-cloud');
  assert.equal(committed.body.document.revision, attempted.body.document.revision);
  f.controls.failSync = false;
  const retry = await f.send('PUT', `/workspace/api/documents/${id}`, {
    revision: attempted.body.document.revision,
    scene: { ...committed.body.scene, elements: [element('retry')] },
  });
  assert.equal(retry.response.status, 200);
  assert.equal(retry.body.document.revision, attempted.body.document.revision + 1);
});

test('ignores delayed upstream scene notifications caused by its own cloud save', async t => {
  const f = await fixture({ elements: [element('start')], files: {} });
  t.after(f.close);
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('workspace did not connect to upstream')), 2000);
    f.wss.once('connection', () => { clearTimeout(deadline); resolve(); });
  });
  const id = (await f.request('/workspace/api/documents')).body.activeId;
  const current = await f.request(`/workspace/api/documents/${id}`);
  const image = { id: 'saved-image', dataURL: 'data:image/png;base64,CC==', mimeType: 'image/png' };
  f.controls.delayedSyncEventMs = 50;
  const saved = await f.send('PUT', `/workspace/api/documents/${id}`, {
    revision: current.body.document.revision,
    scene: { ...current.body.scene, elements: [element('client-save')], files: { 'saved-image': image } },
    clientId: 'test-client',
  });
  assert.equal(saved.response.status, 200);
  await new Promise(resolve => setTimeout(resolve, 350));
  const afterNotification = await f.request(`/workspace/api/documents/${id}`);
  assert.equal(afterNotification.body.scene.elements[0].id, 'client-save');
  assert.equal(afterNotification.body.scene.files['saved-image'].dataURL, image.dataURL);
  assert.equal(afterNotification.body.document.revision, saved.body.document.revision);
});

test('captures an agent edit before rejecting a client save with the old revision', async t => {
  const f = await fixture({ elements: [element('start')], files: {} });
  t.after(f.close);
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('workspace did not connect to upstream')), 2000);
    f.wss.once('connection', () => { clearTimeout(deadline); resolve(); });
  });
  const id = (await f.request('/workspace/api/documents')).body.activeId;
  const current = await f.request(`/workspace/api/documents/${id}`);
  f.live = { elements: [element('agent-first')], files: {} };
  for (const client of f.wss.clients) client.send(JSON.stringify({ type: 'scene' }));
  await new Promise(resolve => setTimeout(resolve, 20));
  const oldRevisionSave = await f.send('PUT', `/workspace/api/documents/${id}`, {
    revision: current.body.document.revision,
    scene: { ...current.body.scene, elements: [element('client-stale')] },
  });
  assert.equal(oldRevisionSave.response.status, 409);
  const persistedAgent = await f.request(`/workspace/api/documents/${id}`);
  assert.equal(persistedAgent.body.scene.elements[0].id, 'agent-first');
  assert.equal(persistedAgent.body.document.revision, current.body.document.revision + 1);
});

test('flushes a pending agent edit when the workspace closes', async t => {
  const f = await fixture({ elements: [element('start')], files: {} });
  t.after(f.close);
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('workspace did not connect to upstream')), 2000);
    f.wss.once('connection', () => { clearTimeout(deadline); resolve(); });
  });
  const id = (await f.request('/workspace/api/documents')).body.activeId;
  const before = await f.request(`/workspace/api/documents/${id}`);
  f.live = { elements: [element('agent-before-close')], files: {} };
  for (const client of f.wss.clients) client.send(JSON.stringify({ type: 'scene' }));
  await new Promise(resolve => setTimeout(resolve, 20));
  await f.restart();
  const after = await f.request(`/workspace/api/documents/${id}`);
  assert.equal(after.body.scene.elements[0].id, 'agent-before-close');
  assert.equal(after.body.document.revision, before.body.document.revision + 1);
});

test('runs different canvas calls concurrently and queues same-canvas calls through failures', async t => {
  const entered = [];
  const gates = new Map();
  const createRuntime = async () => {
    let scene = { elements: [], files: {} };
    return {
      async load(value) { scene = structuredClone(value); },
      call(_name, args) {
        entered.push(args.step);
        return new Promise((resolve, reject) => gates.set(args.step, { resolve, reject, scene: () => scene, update: value => { scene = value; } }));
      },
      async scene() { return structuredClone(scene); },
      async close() {},
    };
  };
  const f = await fixture({ elements: [element('foreground-original')], files: {} }, { createRuntime });
  t.after(f.close);
  const foregroundId = (await f.request('/workspace/api/documents')).body.activeId;
  const a = await f.send('POST', '/workspace/api/assistant/ensure', { sessionId: 'parallel-a' });
  const b = await f.send('POST', '/workspace/api/assistant/ensure', { sessionId: 'parallel-b' });
  const aId = a.body.canvasId;
  const bId = b.body.canvasId;
  assert.notEqual(aId, bId);
  assert.equal((await f.request('/workspace/api/documents')).body.activeId, foregroundId);

  const call = (sessionId, step) => f.send('POST', '/workspace/api/assistant/calls', { sessionId, name: 'test_tool', args: { step } });
  const waitFor = async step => {
    for (let attempt = 0; attempt < 100 && !entered.includes(step); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert(entered.includes(step), `runtime.call did not enter for ${step}`);
  };
  const aFirst = call('parallel-a', 'a-first');
  await waitFor('a-first');
  const aSecond = call('parallel-a', 'a-second');
  const bFirst = call('parallel-b', 'b-first');
  await waitFor('b-first');
  assert.deepEqual(entered, ['a-first', 'b-first'], 'B should enter while A is blocked, but A’s second call must wait');

  const foreground = await f.request(`/workspace/api/documents/${foregroundId}`);
  const foregroundSave = await f.send('PUT', `/workspace/api/documents/${foregroundId}`, {
    revision: foreground.body.document.revision,
    scene: { ...foreground.body.scene, elements: [element('foreground-saved')] },
  });
  assert.equal(foregroundSave.response.status, 200);
  assert.equal((await f.request('/workspace/api/documents')).body.activeId, foregroundId);

  gates.get('a-first').reject(new Error('first A call failed'));
  const failed = await aFirst;
  assert.equal(failed.response.status, 500);
  await waitFor('a-second');
  assert.deepEqual(entered, ['a-first', 'b-first', 'a-second']);

  gates.get('a-second').update({ elements: [element('a-second-saved')], files: {} });
  gates.get('a-second').resolve({ content: [] });
  gates.get('b-first').update({ elements: [element('b-first-saved')], files: {} });
  gates.get('b-first').resolve({ content: [] });
  const [aSaved, bSaved] = await Promise.all([aSecond, bFirst]);
  assert.equal(aSaved.response.status, 200);
  assert.equal(bSaved.response.status, 200);
  assert.deepEqual((await f.request(`/workspace/api/documents/${aId}`)).body.scene.elements.map(item => item.id), ['a-second-saved']);
  assert.deepEqual((await f.request(`/workspace/api/documents/${bId}`)).body.scene.elements.map(item => item.id), ['b-first-saved']);
  assert.deepEqual((await f.request(`/workspace/api/documents/${foregroundId}`)).body.scene.elements.map(item => item.id), ['foreground-saved']);
});

test('persists one canvas binding per session and serializes agent edits against navigation', async t => {
  const f = await fixture({ elements: [element('canvas-a')], files: {} });
  t.after(f.close);
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('workspace did not connect to upstream')), 2000);
    f.wss.once('connection', () => { clearTimeout(deadline); resolve(); });
  });
  const aId = (await f.request('/workspace/api/documents')).body.activeId;
  const created = await f.send('POST', '/workspace/api/documents', { title: 'Canvas B', scene: { elements: [element('canvas-b')], files: {} } });
  const bId = created.body.document.id;
  const missingBinding = await f.send('POST', '/workspace/api/assistant/tool-runs', { sessionId: 'unbound' });
  assert.equal(missingBinding.response.status, 409);
  const missingCanvas = await f.send('POST', '/workspace/api/assistant/bindings', { sessionId: 'bad-target', canvasId: 'does-not-exist' });
  assert.equal(missingCanvas.response.status, 404);

  const binding = await f.send('POST', '/workspace/api/assistant/bindings', { sessionId: 'session-a', canvasId: aId });
  assert.equal(binding.response.status, 200);
  assert.equal(binding.body.canvasId, aId);
  assert.equal(binding.body.document.title, '当前画布');
  assert.match(binding.body.filePath, new RegExp(`${aId}\\.excalidraw$`));
  assert.equal((await f.send('POST', '/workspace/api/assistant/bindings', { sessionId: 'session-a', canvasId: bId })).response.status, 409);
  await f.restart();
  const restoredBinding = await f.request('/workspace/api/assistant/bindings/session-a');
  assert.equal(restoredBinding.body.canvasId, aId);

  const run = await f.send('POST', '/workspace/api/assistant/tool-runs', { sessionId: 'session-a' });
  assert.equal(run.response.status, 200);
  f.live = { elements: [element('agent-write')], files: {} };
  const lockedSave = await f.send('PUT', `/workspace/api/documents/${aId}`, { revision: run.body.document.revision, scene: { elements: [element('browser-write')], files: {} } });
  assert.equal(lockedSave.response.status, 423);
  const pendingOpen = await f.send('POST', `/workspace/api/documents/${bId}/open`, {});
  assert.equal(pendingOpen.body.activationPending, true);
  assert.equal(pendingOpen.body.document.active, false);
  const stillActive = await f.request('/workspace/api/documents');
  assert.equal(stillActive.body.activeId, aId);
  const overlappingRun = await f.send('POST', '/workspace/api/assistant/tool-runs', { sessionId: 'session-a' });
  assert.equal(overlappingRun.response.status, 423);

  const finished = await f.send('POST', `/workspace/api/assistant/tool-runs/${run.body.id}/finish`, {});
  assert.equal(finished.response.status, 200);
  assert.equal(finished.body.activeId, bId);
  const savedA = await f.request(`/workspace/api/documents/${aId}`);
  assert.equal(savedA.body.scene.elements[0].id, 'agent-write');
  const wrongActiveRun = await f.send('POST', '/workspace/api/assistant/tool-runs', { sessionId: 'session-a' });
  assert.equal(wrongActiveRun.response.status, 409);

  await f.send('POST', `/workspace/api/documents/${aId}/open`, {});
  const releasedRun = await f.send('POST', '/workspace/api/assistant/tool-runs', { sessionId: 'session-a' });
  assert.equal(releasedRun.response.status, 200);
  await f.send('POST', `/workspace/api/assistant/tool-runs/${releasedRun.body.id}/finish`, {});
});

test('host prompts follow inherited bindings and read current title and revision', async t => {
  const f = await fixture({ elements: [element('canvas-a')], files: {} });
  t.after(f.close);
  const aId = (await f.request('/workspace/api/documents')).body.activeId;
  const created = await f.send('POST', '/workspace/api/documents', { title: 'Canvas B', scene: { elements: [element('canvas-b')], files: {} } });
  const bId = created.body.document.id;
  await f.send('POST', '/workspace/api/assistant/bindings', { sessionId: 'parent-session', canvasId: aId });
  await f.send('POST', '/workspace/api/assistant/bindings', { sessionId: 'stale-session', canvasId: bId });
  await f.send('DELETE', `/workspace/api/documents/${bId}`);

  const host = mockHost(f, [
    { id: 'parent-session' },
    { id: 'child-session', parentSession: 'parent-session' },
    { id: 'stale-session' },
    { id: 'unbound-session' },
  ]);
  t.after(() => host.close());

  const prompt = host.prompts.get('child-session').text();
  assert.match(prompt, new RegExp(`canvas_id: ${aId}`));
  assert.match(prompt, /名称: 当前画布/);
  assert.match(prompt, /保存版本: 1/);
  assert.match(prompt, new RegExp(`https://canvas\\.example\\.test/canvas/${aId}`));
  const inherited = await host.tools.get('canvas_context').execute({}, { agent: host.agents.get('child-session') });
  assert.equal(inherited.sessionId, 'parent-session');
  assert.equal(inherited.canvasId, aId);

  const detail = await f.request(`/workspace/api/documents/${aId}`);
  await f.send('PATCH', `/workspace/api/documents/${aId}`, { title: 'Updated canvas name' });
  await f.send('PUT', `/workspace/api/documents/${aId}`, { revision: detail.body.document.revision, scene: { ...detail.body.scene, elements: [element('next-revision')] } });
  const updatedPrompt = host.prompts.get('child-session').text();
  assert.match(updatedPrompt, /名称: Updated canvas name/);
  assert.match(updatedPrompt, /保存版本: 2/);

  const missingPrompt = host.prompts.get('stale-session').text();
  assert.match(missingPrompt, /绑定的画布 .* 已不存在/);
  let missingNext = false;
  await assert.rejects(host.execute({ name: 'mcp__excalidraw__edit', agent: host.agents.get('stale-session') }, async () => { missingNext = true; }), /已不存在/);
  assert.equal(missingNext, false);
  assert.match(host.prompts.get('unbound-session').text(), /默认在后台新建独立画布/);
  let unboundSession;
  const unboundExecution = { name: 'mcp__excalidraw__edit', agent: host.agents.get('unbound-session'), arguments: {} };
  await host.execute(unboundExecution, async () => {
    unboundSession = unboundExecution.arguments.__dshCanvasSession;
    return { ok: true };
  });
  assert.equal(unboundSession, 'unbound-session');
  assert.equal((await f.request('/workspace/api/assistant/bindings/unbound-session')).body.canvasId !== undefined, true);

  // A session keeps its own target while another canvas is open in the foreground.
  const another = await f.send('POST', '/workspace/api/documents', { title: 'Canvas C', scene: { elements: [element('canvas-c')], files: {} } });
  const cId = another.body.document.id;
  await f.send('POST', `/workspace/api/documents/${cId}/open`, {});
  let switchedSession;
  const switchedExecution = { name: 'mcp__excalidraw__edit', agent: host.agents.get('child-session'), arguments: {} };
  await host.execute(switchedExecution, async () => {
    switchedSession = switchedExecution.arguments.__dshCanvasSession;
    return { ok: true };
  });
  assert.equal(switchedSession, 'parent-session');
});

test('host tool hook routes the explicit session marker and propagates tool failures', async t => {
  const f = await fixture({ elements: [element('canvas-a')], files: {} });
  t.after(f.close);
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('workspace did not connect to upstream')), 2000);
    f.wss.once('connection', () => { clearTimeout(deadline); resolve(); });
  });
  const aId = (await f.request('/workspace/api/documents')).body.activeId;
  const created = await f.send('POST', '/workspace/api/documents', { title: 'Canvas B', scene: { elements: [element('canvas-b')], files: {} } });
  const bId = created.body.document.id;
  await f.send('POST', '/workspace/api/assistant/bindings', { sessionId: 'agent-a', canvasId: aId });
  await f.send('POST', '/workspace/api/assistant/bindings', { sessionId: 'agent-b', canvasId: bId });
  const host = mockHost(f, [{ id: 'agent-a' }, { id: 'agent-b' }]);
  t.after(() => host.close());

  let routedSession;
  const execution = { name: 'mcp__excalidraw__edit', agent: host.agents.get('agent-a'), arguments: {} };
  await assert.rejects(host.execute(execution, async () => {
    routedSession = execution.arguments.__dshCanvasSession;
    throw new Error('mock tool failure');
  }), /mock tool failure/);
  assert.equal(routedSession, 'agent-a');
  assert.equal((await f.request('/workspace/api/documents')).body.activeId, aId);
});

test('rejects Excalidraw exports into drawings through a directory symlink but allows an export folder', async t => {
  const f = await fixture({ elements: [element('protected-canvas')], files: {} });
  t.after(f.close);
  const canvasId = (await f.request('/workspace/api/documents')).body.activeId;
  await f.send('POST', '/workspace/api/assistant/bindings', { sessionId: 'export-session', canvasId });
  const host = mockHost(f, [{ id: 'export-session' }]);
  t.after(() => host.close());

  const home = path.join(f.temp, 'home');
  await mkdir(home);
  await symlink(path.join(f.temp, 'drawings'), path.join(home, 'canvases'), 'dir');
  for (const name of ['mcp__excalidraw__export_scene', 'mcp__excalidraw__export_to_image']) {
    let invoked = false;
    await assert.rejects(host.execute({ name, agent: host.agents.get('export-session'), arguments: { filePath: path.join(home, 'canvases', `${canvasId}.excalidraw`) } }, async () => { invoked = true; }), /不能用 export_scene \/ export_to_image 覆写工作空间画布文件/);
    assert.equal(invoked, false);
  }

  const exports = path.join(f.temp, 'exports');
  await mkdir(exports);
  let allowed = false;
  const result = await host.execute({ name: 'mcp__excalidraw__export_scene', agent: host.agents.get('export-session'), arguments: { filePath: path.join(exports, 'copy.excalidraw') } }, async () => { allowed = true; return 'exported'; });
  assert.equal(allowed, true);
  assert.equal(result, 'exported');
});
