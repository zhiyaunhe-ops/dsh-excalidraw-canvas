import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, rename, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const blank = () => ({ type: 'excalidraw', version: 2, source: 'dsh-canvas', elements: [], appState: { viewBackgroundColor: '#ffffff', gridSize: null }, files: {} });
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const fail = (status, message) => Object.assign(new Error(message), { status });

export async function createWorkspace({ root, upstream, mode = 'cloud', expandElements = elements => elements, renderScene } = {}) {
  const drawings = path.join(root, 'drawings');
  await mkdir(drawings, { recursive: true });
  const stateFile = path.join(root, '.active-canvas.json');
  const bindingsFile = path.join(root, '.assistant-bindings.json');
  let bindings = {};
  try { bindings = JSON.parse(await readFile(bindingsFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let toolRun = null;
  let pendingActivation = null;
  let activeId;
  let upstreamConnected = false;
  let socket;
  let refreshTimer;
  let reconnectTimer;
  let closed = false;
  let internalWrite = false;
  let queue = Promise.resolve();
  const serialized = fn => { const job = queue.then(fn); queue = job.catch(() => {}); return job; };
  const previews = new Map();
  const fileFor = id => {
    if (!id || path.basename(id) !== id || id === '.' || id === '..') throw fail(400, '画布名称无效');
    return path.join(drawings, `${id}.excalidraw`);
  };
  async function atomicWrite(file, value) {
    await writeFile(`${file}.tmp`, JSON.stringify(value));
    await rename(`${file}.tmp`, file);
  }
  async function read(id) {
    try { return JSON.parse(await readFile(fileFor(id), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') throw fail(404, '这张画布不存在'); throw error; }
  }
  const summary = (id, scene, modified) => ({ id, title: scene.name || id.replace(/-\d{8}-\d{4}$/, ''), updatedAt: modified, count: scene.elements.filter(el => !el.isDeleted).length, revision: scene.canvasMeta?.revision || 0, active: id === activeId });
  async function document(id) {
    const scene = await read(id);
    return { document: summary(id, scene, (await stat(fileFor(id))).mtime.toISOString()), scene };
  }
  async function persist(id, scene) {
    await atomicWrite(fileFor(id), scene);
    previews.delete(id);
    return document(id);
  }
  async function api(endpoint, body, method = 'POST') {
    const response = await fetch(`${upstream}${endpoint}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (!response.ok) throw fail(503, result.error || '画布服务暂时无法连接');
    return result;
  }
  async function upstreamScene() {
    const [elements, files] = await Promise.all([api('/api/elements', undefined, 'GET'), api('/api/files', undefined, 'GET')]);
    // Native browser elements keep their versions, deleted flags and bindings.
    // The upstream expander is only needed for the compact agent format.
    const expanded = expandElements(elements.elements.filter(el => !el.isDeleted), { deterministic: true });
    return { elements: expanded, files: files.files };
  }
  async function replaceUpstream(scene) {
    internalWrite = true;
    try {
      const { files } = await api('/api/files', undefined, 'GET');
      for (const id of Object.keys(files)) if (!scene.files?.[id]) await api(`/api/files/${encodeURIComponent(id)}`, undefined, 'DELETE');
      await api('/api/files', { files: Object.values(scene.files || {}) });
      await api('/api/elements/sync', { elements: scene.elements.filter(el => !el.isDeleted), timestamp: Date.now() });
    } finally { internalWrite = false; }
  }
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/workspace/events' });
  const broadcast = message => { for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message)); };
  async function captureAgentChanges() {
    if (!activeId) return;
    const previous = await read(activeId);
    const live = await upstreamScene();
    const previousLive = { elements: expandElements(previous.elements.filter(el => !el.isDeleted), { deterministic: true }), files: previous.files || {} };
    if (stable(live) === stable(previousLive)) return;
    const scene = { ...previous, ...live, canvasMeta: { ...previous.canvasMeta, revision: (previous.canvasMeta?.revision || 0) + 1 } };
    const result = await persist(activeId, scene);
    broadcast({ type: 'scene', ...result, source: 'agent' });
  }
  async function activate(id) {
    if (toolRun && id !== toolRun.canvasId) {
      const result = await document(id);
      pendingActivation = id;
      return { ...result, activationPending: true };
    }
    // Capture any agent edits still waiting in the debounce queue before switching.
    if (activeId && upstreamConnected) await captureAgentChanges();
    clearTimeout(refreshTimer);
    const scene = await read(id);
    if (activeId === id) return document(id);
    await replaceUpstream(scene);
    activeId = id;
    await atomicWrite(stateFile, { activeId });
    const result = await document(id);
    broadcast({ type: 'active', id });
    return result;
  }
  function connect() {
    socket = new WebSocket(upstream.replace(/^http/, 'ws'));
    socket.on('open', () => { upstreamConnected = true; broadcast({ type: 'connection', connected: true }); });
    socket.on('message', data => {
      if (closed) return;
      const message = JSON.parse(data.toString());
      if (message.type === 'set_viewport' || message.type === 'export_image_request') { broadcast(message); return; }
      if (internalWrite || message.type === 'sync_status') return;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        if (!closed) serialized(captureAgentChanges).catch(error => console.error('Agent save:', error.message));
      }, 180);
    });
    socket.on('error', error => console.error('Canvas upstream:', error.message));
    socket.on('close', () => {
      upstreamConnected = false;
      broadcast({ type: 'connection', connected: false });
      if (!closed) reconnectTimer = setTimeout(async () => {
        try { if (activeId) await serialized(async () => replaceUpstream(await read(activeId))); }
        catch (error) { console.error('Canvas restore:', error.message); }
        if (!closed) connect();
      }, 2000);
    });
  }
  // First upgrade adopts the running canvas; subsequent restarts restore the saved one.
  try { ({ activeId } = JSON.parse(await readFile(stateFile, 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (activeId) await replaceUpstream(await read(activeId));
  else {
    activeId = `canvas-${randomUUID().slice(0, 12)}`;
    await persist(activeId, { ...blank(), ...await upstreamScene(), name: '当前画布', canvasMeta: { revision: 1 } });
    await atomicWrite(stateFile, { activeId });
  }
  connect();
  wss.on('connection', client => {
    client.send(JSON.stringify({ type: 'connection', connected: upstreamConnected }));
    client.send(JSON.stringify({ type: 'active', id: activeId }));
  });
  app.use(express.json({ limit: '25mb' }));
  app.get('/workspace/runtime.js', (_req, res) => res.type('js').set('Cache-Control', 'no-store').send(`window.CANVAS_RUNTIME=${JSON.stringify({ mode })};`));
  // Native viewport/image responses also work without nginx in Desktop mode.
  for (const endpoint of ['/api/viewport/result', '/api/export/image/result']) app.post(endpoint, async (req, res, next) => {
    try {
      const response = await fetch(upstream + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) });
      res.status(response.status).type('json').send(await response.text());
    } catch (error) { next(error); }
  });
  app.use('/workspace/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const route = fn => (req, res, next) => serialized(() => fn(req, res)).catch(next);
  function sessionKey(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 200) throw fail(400, '缺少有效的助手会话 ID');
    return value;
  }
  async function bindingContext(sessionId) {
    const canvasId = bindings[sessionId];
    if (!canvasId) throw fail(409, '此助手会话尚未绑定画布，请先使用 canvas_select 选择目标画布');
    const { document: info } = await document(canvasId);
    return { sessionId, canvasId, document: info, filePath: fileFor(canvasId), activeId };
  }
  app.post('/workspace/api/assistant/bindings', route(async (req, res) => {
    const sessionId = sessionKey(req.body.sessionId);
    const canvasId = req.body.canvasId;
    await read(canvasId);
    if (bindings[sessionId] && bindings[sessionId] !== canvasId) throw fail(409, '这个会话已经绑定其他画布。请打开目标画布对应的助手会话。');
    bindings[sessionId] = canvasId;
    await atomicWrite(bindingsFile, bindings);
    res.json(await bindingContext(sessionId));
  }));
  app.get('/workspace/api/assistant/bindings/:sessionId', route(async (req, res) => res.json(await bindingContext(req.params.sessionId))));
  app.post('/workspace/api/assistant/tool-runs', route(async (req, res) => {
    const context = await bindingContext(sessionKey(req.body.sessionId));
    if (context.canvasId !== activeId) throw fail(409, `此会话只编辑「${context.document.title}」(${context.canvasId})。当前画布是 ${activeId}，请打开绑定画布后继续，不能编辑其他画布。`);
    if (toolRun) throw fail(423, '另一个画布工具操作尚未结束，请串行调用画布工具');
    if (refreshTimer && upstreamConnected) { clearTimeout(refreshTimer); await captureAgentChanges(); }
    toolRun = { id: randomUUID(), sessionId: context.sessionId, canvasId: context.canvasId };
    broadcast({ type: 'assistant-editing', canvasId: toolRun.canvasId, editing: true });
    res.json({ ...toolRun, document: (await document(toolRun.canvasId)).document });
  }));
  app.post('/workspace/api/assistant/tool-runs/:id/finish', route(async (req, res) => {
    if (!toolRun || toolRun.id !== req.params.id) throw fail(409, '该画布工具操作已结束或不存在');
    const completed = toolRun;
    let saveError;
    try { if (upstreamConnected) await captureAgentChanges(); }
    catch (error) { saveError = error; }
    finally {
      toolRun = null;
      broadcast({ type: 'assistant-editing', canvasId: completed.canvasId, editing: false });
    }
    const next = pendingActivation;
    pendingActivation = null;
    if (next) await activate(next);
    if (saveError) throw saveError;
    res.json({ success: true, canvasId: completed.canvasId, activeId });
  }));
  app.get('/workspace/api/documents', route(async (_req, res) => {
    const names = (await readdir(drawings)).filter(name => name.endsWith('.excalidraw'));
    const documents = await Promise.all(names.map(name => document(name.slice(0, -11)).then(value => value.document)));
    res.json({ documents: documents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), activeId, connected: upstreamConnected });
  }));
  app.get('/workspace/api/documents/:id', route(async (req, res) => res.json(await document(req.params.id))));
  app.post('/workspace/api/documents', route(async (req, res) => {
    const id = `canvas-${randomUUID().slice(0, 12)}`;
    const scene = req.body.scene || blank();
    if (!Array.isArray(scene.elements)) throw fail(400, '请选择有效的 .excalidraw 文件');
    const result = await persist(id, { ...scene, type: 'excalidraw', version: 2, files: scene.files || {}, name: req.body.title?.trim() || '未命名画布', canvasMeta: { revision: 1 } });
    res.status(201).json(result);
  }));
  app.post('/workspace/api/documents/:id/open', route(async (req, res) => res.json(await activate(req.params.id))));
  app.put('/workspace/api/documents/:id', route(async (req, res) => {
    const id = req.params.id;
    if (toolRun && id === toolRun.canvasId) throw fail(423, '助手正在编辑这张画布，本地更改会在该操作结束后自动保存');
    if (id === activeId && refreshTimer && upstreamConnected) { clearTimeout(refreshTimer); await captureAgentChanges(); }
    const previous = await read(id);
    const revision = previous.canvasMeta?.revision || 0;
    if (req.body.revision !== revision) throw fail(409, '画布已在其他窗口或由助手更新。请保留为副本，或重新载入云端版本。');
    const scene = req.body.scene;
    if (!scene || !Array.isArray(scene.elements)) throw fail(400, '画布内容无效');
    const updated = { ...scene, type: 'excalidraw', version: 2, name: req.body.title?.trim() || previous.name || '未命名画布', canvasMeta: { revision: revision + 1 } };
    const result = await persist(id, updated);
    // Cloud persistence remains available while the live MCP canvas is offline.
    let liveSynced = false;
    if (id === activeId && upstreamConnected) {
      try { await replaceUpstream(updated); liveSynced = true; }
      catch (error) { console.error('Live sync:', error.message); upstreamConnected = false; broadcast({ type: 'connection', connected: false }); socket?.terminate(); }
    }
    broadcast({ type: 'scene', ...result, source: req.body.clientId });
    res.json({ ...result, liveSynced });
  }));
  app.patch('/workspace/api/documents/:id', route(async (req, res) => {
    const scene = await read(req.params.id);
    if (!req.body.title?.trim()) throw fail(400, '请输入画布名称');
    scene.name = req.body.title.trim();
    const result = await persist(req.params.id, scene);
    broadcast({ type: 'renamed', document: result.document });
    res.json(result);
  }));
  app.delete('/workspace/api/documents/:id', route(async (req, res) => {
    if (req.params.id === pendingActivation) throw fail(423, '这张画布正在等待打开，请切换后再删除');
    if (req.params.id === activeId) throw fail(409, '请先打开另一张画布，再删除当前正在使用的画布');
    await read(req.params.id);
    await unlink(fileFor(req.params.id));
    for (const extension of ['.png', '.svg']) await unlink(path.join(drawings, req.params.id + extension)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    previews.delete(req.params.id);
    res.json({ success: true });
  }));
  // Preview rendering is read-only and does not replace the live canvas.
  app.get('/workspace/api/documents/:id/preview', async (req, res, next) => {
    try {
      const { scene, document: info } = await document(req.params.id);
      let cached = previews.get(info.id);
      if (!cached || cached.updatedAt !== info.updatedAt) {
        const { data } = await renderScene(scene, { format: 'svg', embedFonts: false, viewBackgroundColor: scene.appState?.viewBackgroundColor || '#ffffff', padding: 30 });
        cached = { updatedAt: info.updatedAt, data }; previews.set(info.id, cached);
      }
      res.type('svg').set('Cache-Control', 'no-cache').send(cached.data);
    } catch (error) { next(error); }
  });
  app.get('/workspace/api/documents/:id/export/:format', async (req, res, next) => {
    try {
      const { scene, document: info } = await document(req.params.id);
      const format = req.params.format;
      res.attachment(`${info.title}.${format}`);
      if (format === 'excalidraw') return res.type('application/json').send(JSON.stringify(scene, null, 2));
      if (!['svg', 'png'].includes(format)) throw fail(400, '不支持的导出格式');
      const { data } = await renderScene(scene, { format, viewBackgroundColor: scene.appState?.viewBackgroundColor || '#ffffff' });
      res.type(format).send(format === 'png' ? Buffer.from(data, 'base64') : data);
    } catch (error) { next(error); }
  });
  app.use('/workspace', express.static(path.join(here, 'dist'), { index: false }));
  app.get(['/', '/library/', '/canvas/:id'], (_req, res) => res.set('Cache-Control', 'no-store').sendFile(path.join(here, 'dist/index.html')));
  app.use((error, _req, res, _next) => { console.error(error.message); res.status(error.status || 500).json({ error: error.message }); });
  return {
    server,
    async close() { closed = true; clearTimeout(refreshTimer); clearTimeout(reconnectTimer); if (refreshTimer && upstreamConnected) await serialized(captureAgentChanges); socket?.terminate(); for (const client of wss.clients) client.terminate(); await queue; await new Promise(resolve => server.close(resolve)); },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pkg = process.env.EXCALIDRAW_PACKAGE_DIR;
  const { expandElementsForExport } = await import(pathToFileURL(path.join(pkg, 'dist/core/expand-elements.js')));
  const { renderScene } = await import(pathToFileURL(path.join(pkg, 'dist/core/render/index.js')));
  const workspace = await createWorkspace({ root: process.env.CANVAS_LIBRARY_DIR || '/var/www/canvas-library', upstream: process.env.EXPRESS_SERVER_URL || 'http://127.0.0.1:3000', expandElements: expandElementsForExport, renderScene });
  workspace.server.listen(Number(process.env.PORT || 9111), '127.0.0.1', () => console.log('Canvas workspace listening'));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await workspace.close(); process.exit(0); });
}
