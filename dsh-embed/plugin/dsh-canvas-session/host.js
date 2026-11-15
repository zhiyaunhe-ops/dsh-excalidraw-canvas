import { realpathSync } from 'node:fs';
import path from 'node:path';
import { readCanvasContext, canvasPrompt } from './context.js?v=0.2.0';

export const name = 'dsh-canvas-session-scope';
export const inject = ['agents', 'tools', 'systemPrompt'];

export function apply(ctx, config = {}) {
  const root = config.libraryDir || '/var/www/canvas-library';
  const workspaceUrl = config.workspaceUrl || 'http://127.0.0.1:9111';
  const publicUrl = config.publicUrl || workspaceUrl;
  const decorated = new Map();
  const activeRuns = new Set();
  function lineage(agent) {
    const ids = [];
    while (agent && !ids.includes(agent.id)) {
      ids.push(agent.id);
      const parentId = agent.session.header.parentSession;
      if (!parentId) break;
      if (!ctx.agents.get(parentId)) { ids.push(parentId); break; }
      agent = ctx.agents.get(parentId);
    }
    return ids;
  }
  const contextOf = agent => readCanvasContext(root, lineage(agent), publicUrl);
  async function request(endpoint, body, signal) {
    const response = await fetch(`${workspaceUrl}/workspace/api${endpoint}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '画布工作空间请求失败');
    return result;
  }
  function decorate(agent) {
    if (decorated.has(agent)) return;
    const dispose = agent.ctx.systemPrompt.context({ name: 'canvas-edit-target', order: 140, required: true, interpolate: false, text: () => canvasPrompt(contextOf(agent)) });
    decorated.set(agent, dispose);
  }
  ctx.on('agent/created', ({ agent }) => { decorate(agent); });
  ctx.on('agent/disposed', ({ agent }) => { decorated.get(agent)?.(); decorated.delete(agent); });
  for (const agent of ctx.agents.list()) decorate(agent);

  ctx.on('tools/execute', async (execution, next) => {
    if (!execution.name.startsWith('mcp__excalidraw__')) return next();
    if (!execution.agent) throw new Error('画布工具缺少助手会话，无法确定编辑目标');
    const context = contextOf(execution.agent);
    if (!context) throw new Error('请先使用 canvas_list / canvas_select 绑定目标画布，再调用画布工具');
    if (context.missing) throw new Error(`绑定画布 ${context.canvasId} 已不存在，未执行任何画布操作`);
    // Export is a file write outside the REST canvas API. It must never
    // overwrite a cloud drawing (including through the ~/canvases symlink).
    if (['mcp__excalidraw__export_scene', 'mcp__excalidraw__export_to_image'].includes(execution.name) && execution.arguments?.filePath) {
      const requested = path.resolve(execution.arguments.filePath);
      const destination = path.join(realpathSync(path.dirname(requested)), path.basename(requested));
      const drawings = realpathSync(path.join(root, 'drawings'));
      if (destination.startsWith(drawings + path.sep)) throw new Error('工作空间画布由工作空间自动保存。导出副本请使用单独的导出目录，不能用 export_scene / export_to_image 覆写工作空间画布文件。');
    }
    const run = await request('/assistant/tool-runs', { sessionId: context.sessionId }, execution.signal);
    activeRuns.add(run.id);
    try { return await next(); }
    finally {
      // Release even when the tool fails or its caller cancels. The caller's
      // cancelled signal must not cancel saving and releasing this operation.
      try { await request(`/assistant/tool-runs/${encodeURIComponent(run.id)}/finish`, {}, AbortSignal.timeout(15000)); }
      finally { activeRuns.delete(run.id); }
    }
  });
  const tool = (name, description, properties, required, execute) => ctx.tools.register({
    name, description, parameters: { type: 'object', properties, required, additionalProperties: false },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute,
  });
  tool('canvas_list', '列出工作空间 Excalidraw 画布及 ID。不会切换或修改画布。', {}, [], async (_args, execution) => request('/documents', undefined, execution.signal));
  tool('canvas_select', '给尚未绑定的当前助手会话绑定一张画布。每个会话固定对应一张画布，不会切换浏览器当前画布。', { canvasId: { type: 'string', description: '从 canvas_list 读取的目标画布 ID' } }, ['canvasId'], async ({ canvasId }, execution) => {
    if (!execution.agent) throw new Error('缺少助手会话');
    const inherited = contextOf(execution.agent);
    if (inherited && inherited.canvasId !== canvasId) throw new Error(`本会话已绑定 ${inherited.canvasId}，请使用目标画布对应的助手会话`);
    return request('/assistant/bindings', { sessionId: inherited?.sessionId || execution.agent.id, canvasId }, execution.signal);
  });
  tool('canvas_context', '读取本会话绑定画布的 ID、名称、路径、版本和是否为当前直播画布。', {}, [], async (_args, execution) => {
    if (!execution.agent) throw new Error('缺少助手会话');
    const context = contextOf(execution.agent);
    if (!context) throw new Error('本会话尚未绑定画布');
    return { ...context };
  });
  ctx.effect(() => async () => {
    for (const dispose of decorated.values()) dispose();
    decorated.clear();
    await Promise.allSettled([...activeRuns].map(id => request(`/assistant/tool-runs/${encodeURIComponent(id)}/finish`, {}, AbortSignal.timeout(15000))));
  });
  console.info('[canvas-session] Context injection and document-bound tools enabled');
}
