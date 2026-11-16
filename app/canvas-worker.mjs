import { parentPort, workerData } from 'node:worker_threads';
import { createServer } from 'node:net';
import { once } from 'node:events';
import path from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// The upstream toolkit keeps its scene, groups and snapshots in module globals.
// A worker gives each document its own copy of all of that state.
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const upstream = `http://127.0.0.1:${port}`;
Object.assign(process.env, { PORT: String(port), HOST: '127.0.0.1', EXPRESS_SERVER_URL: upstream, EXCALIDRAW_NO_AUTOSTART: '1', ENABLE_CANVAS_SYNC: 'true', EXCALIDRAW_EXPORT_DIR: process.env.EXCALIDRAW_EXPORT_DIR || homedir() });
const moduleAt = file => import(pathToFileURL(path.join(workerData.packageDir, 'dist', file)));
const { startServer } = await moduleAt('server.js');
await startServer();
let ready = false;
for (let attempt = 0; attempt < 100; attempt++) {
  try { ready = (await fetch(upstream + '/health')).ok; } catch { /* Listener starting. */ }
  if (ready) break;
  await delay(50);
}
if (!ready) throw new Error('画布执行环境启动失败');
const { callExcalidrawTool } = await moduleAt('core/mcp-dispatch.js');
const { expandElementsForExport } = await moduleAt('core/expand-elements.js');

async function api(endpoint, body, method = 'POST') {
  const response = await fetch(upstream + endpoint, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '画布执行失败');
  return result;
}
parentPort.on('message', async ({ id, method, scene, name, args }) => {
  try {
    let result;
    if (method === 'load') {
      const { files } = await api('/api/files', undefined, 'GET');
      for (const id of Object.keys(files)) if (!scene.files?.[id]) await api(`/api/files/${encodeURIComponent(id)}`, undefined, 'DELETE');
      await api('/api/files', { files: Object.values(scene.files || {}) });
      result = await api('/api/elements/sync', { elements: scene.elements.filter(element => !element.isDeleted), timestamp: Date.now() });
    } else if (method === 'scene') {
      const [elements, files] = await Promise.all([api('/api/elements', undefined, 'GET'), api('/api/files', undefined, 'GET')]);
      result = { elements: expandElementsForExport(elements.elements.filter(element => !element.isDeleted), { deterministic: true }), files: files.files };
    } else if (method === 'call') result = await callExcalidrawTool(name, args);
    else throw new Error('未知的画布请求');
    parentPort.postMessage({ id, result });
  } catch (error) { parentPort.postMessage({ id, error: error.message }); }
});
parentPort.postMessage({ ready: true, upstream });
