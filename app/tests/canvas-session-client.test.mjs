import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clientSource = await readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dsh-embed/plugin/dsh-canvas-session/client.js'), 'utf8');

async function runClient({ rememberedId, sessionRows = {}, bindingOk = true }) {
  const events = [];
  const stored = new Map(rememberedId ? [[`dsh-canvas-session:canvas-a`, rememberedId]] : []);
  let definition;
  const window = {
    location: { search: '?canvas=canvas-a', origin: 'https://canvas.example.test' },
    __ModuleLoader__: { load(value) { definition = value; } },
    localStorage: {
      getItem(key) { return stored.has(key) ? stored.get(key) : null; },
      setItem(key, value) { stored.set(key, value); },
      removeItem(key) { stored.delete(key); },
    },
    setInterval(callback) { window.poll = callback; return 1; },
    clearInterval() {},
    setTimeout() { return 2; },
    parent: { postMessage(message) { events.push(['postMessage', message]); } },
  };
  const fetch = async (url, options) => {
    events.push(['fetch', url, JSON.parse(options.body)]);
    return {
      ok: bindingOk,
      async json() { return bindingOk ? { document: { title: 'Canvas A' } } : { error: 'binding rejected' }; },
    };
  };
  const sandbox = { window, URLSearchParams, fetch, console: { warn() {} } };
  vm.runInNewContext(clientSource, sandbox, { filename: 'dsh-canvas-session/client.js' });

  const sessions = {
    list: { getSnapshot: () => ({ phase: 'ready', byId: sessionRows }) },
    async create(request) { events.push(['create', request]); return 'new-session'; },
    async using(id, options, callback) {
      events.push(['rename', id, options]);
      await callback({ binding: { session: { rename: async title => events.push(['title', title]) } } });
    },
  };
  const workspaces = { list: { getSnapshot: () => ({ phase: 'ready', items: [{ path: '/var/www/canvas-library/drawings/', workspaceId: 'canvas-library' }] }) } };
  const uiWorkspace = { openSession(id) { events.push(['openSession', id]); } };
  definition.factory().apply({ get(key) { return { sessions, workspaces, uiWorkspace }[key]; } });
  await new Promise(resolve => setImmediate(resolve));
  return { events, stored, window };
}

test('opens a canvas session only after its workspace binding succeeds', async () => {
  const created = await runClient({});
  const bindIndex = created.events.findIndex(([kind]) => kind === 'fetch');
  const openIndex = created.events.findIndex(([kind]) => kind === 'openSession');
  assert(bindIndex >= 0);
  assert(openIndex > bindIndex);
  assert.deepEqual(created.events[bindIndex][2], { sessionId: 'new-session', canvasId: 'canvas-a' });
  assert.equal(created.events[openIndex][1], 'new-session');
  assert.equal(created.stored.get('dsh-canvas-session:canvas-a'), 'new-session');

  const refused = await runClient({ bindingOk: false });
  assert.equal(refused.events.some(([kind]) => kind === 'openSession'), false);
});

test('restores a remembered existing session only after registering its canvas binding', async () => {
  const restored = await runClient({ rememberedId: 'remembered-session', sessionRows: { 'remembered-session': { title: 'Canvas A' } } });
  const bindIndex = restored.events.findIndex(([kind]) => kind === 'fetch');
  const openIndex = restored.events.findIndex(([kind]) => kind === 'openSession');
  assert(bindIndex >= 0);
  assert(openIndex > bindIndex);
  assert.equal(restored.events[bindIndex][2].sessionId, 'remembered-session');
  assert.equal(restored.events.some(([kind]) => kind === 'create'), false);
  assert.equal(restored.events[openIndex][1], 'remembered-session');
});
