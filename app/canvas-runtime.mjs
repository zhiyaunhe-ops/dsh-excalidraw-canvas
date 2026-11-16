import { Worker } from 'node:worker_threads';
import { WebSocket } from 'ws';

export async function createCanvasRuntime({ packageDir, onEvent }) {
  const worker = new Worker(new URL('./canvas-worker.mjs', import.meta.url), { workerData: { packageDir } });
  let sequence = 0;
  let socket;
  const pending = new Map();
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  worker.on('message', message => {
    if (message.ready) { resolveReady(message.upstream); return; }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(message.result);
  });
  const failed = error => { rejectReady(error); for (const request of pending.values()) request.reject(error); pending.clear(); };
  worker.on('error', failed);
  worker.on('exit', code => { failed(new Error(`画布执行环境已退出 (${code})`)); });
  try {
    const upstream = await ready;
    socket = new WebSocket(upstream.replace(/^http/, 'ws'));
    socket.on('message', data => {
      const event = JSON.parse(data.toString());
      if (['set_viewport', 'export_image_request'].includes(event.type)) onEvent?.(event);
    });
    socket.on('error', error => console.error('Canvas runtime:', error.message));
    function request(method, data = {}) {
      const id = ++sequence;
      return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, method, ...data }); });
    }
    return {
      upstream,
      load: scene => request('load', { scene }),
      scene: () => request('scene'),
      call: (name, args) => request('call', { name, args }),
      async close() { socket.terminate(); await worker.terminate(); },
    };
  } catch (error) { socket?.terminate(); await worker.terminate(); throw error; }
}
