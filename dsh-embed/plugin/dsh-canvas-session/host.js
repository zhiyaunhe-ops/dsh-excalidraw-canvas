import { realpathSync } from 'node:fs';
import path from 'node:path';
import { readCanvasContext, canvasPrompt } from './context.js?v=0.6.0';

export const name = 'dsh-canvas-session-scope';
export const inject = ['agents', 'tools', 'systemPrompt'];

export function apply(ctx, config = {}) {
  const root = config.libraryDir || '/var/www/canvas-library';
  const workspaceUrl = config.workspaceUrl || 'http://127.0.0.1:9111';
  const publicUrl = config.publicUrl || workspaceUrl;
  // The rail entry in the browser client opens this URL in a Browser tab. The
  // desktop port is configurable, so the client asks instead of hardcoding it.
  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => scope.webServer.register({
      kind: 'exact',
      path: '/dsh-excalidraw-canvas/info.json',
      resource: async () => new Response(JSON.stringify({ url: `${publicUrl}/library/`, workspaceUrl }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      }),
    }));
  });
  const decorated = new Map();
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
    let context = contextOf(execution.agent);
    if (!context) {
      const ids = lineage(execution.agent);
      await request('/assistant/ensure', { sessionId: ids.at(-1) }, execution.signal);
      context = contextOf(execution.agent);
    }
    if (context.missing) throw new Error(`绑定画布 ${context.canvasId} 已不存在，未执行任何画布操作`);
    // Export is a file write outside the REST canvas API. It must never
    // overwrite a cloud drawing (including through the ~/canvases symlink).
    if (['mcp__excalidraw__export_scene', 'mcp__excalidraw__export_to_image'].includes(execution.name) && execution.arguments?.filePath) {
      const requested = path.resolve(execution.arguments.filePath);
      const destination = path.join(realpathSync(path.dirname(requested)), path.basename(requested));
      const drawings = realpathSync(path.join(root, 'drawings'));
      if (destination.startsWith(drawings + path.sep)) throw new Error('工作空间画布由工作空间自动保存。导出副本请使用单独的导出目录，不能用 export_scene / export_to_image 覆写工作空间画布文件。');
    }
    // The transport routes by this injected session, never by the browser's
    // foreground canvas. Each document executes in its own runtime.
    execution.arguments = { ...execution.arguments, __dshCanvasSession: context.sessionId };
    return next();
  });
  const tool = (name, description, properties, required, execute) => ctx.tools.register({
    name, description, parameters: { type: 'object', properties, required, additionalProperties: false },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute,
  });
  tool('canvas_list', '列出工作空间 Excalidraw 画布及 ID。不会切换或修改画布。', {}, [], async (_args, execution) => request('/documents', undefined, execution.signal));
  tool('canvas_folders', '列出画布库文件夹与 parentId，可按项目及子文件夹整理图纸。', {}, [], async (_args, execution) => request('/folders', undefined, execution.signal));
  tool('canvas_folder_create', '新建画布文件夹。parentId 指定上级文件夹，省略则建在画布库根目录。', { name: { type: 'string' }, parentId: { type: ['string', 'null'] } }, ['name'], async (args, execution) => request('/folders', args, execution.signal));
  tool('canvas_move', '把选中的画布批量移入文件夹，folderId 为 null 时移回根目录。只整理位置，不修改图纸内容、版本、ID或助手绑定。', { canvasIds: { type: 'array', items: { type: 'string' } }, folderId: { type: ['string', 'null'] } }, ['canvasIds', 'folderId'], async ({ canvasIds, folderId }, execution) => request('/documents/move', { ids: canvasIds, folderId }, execution.signal));
  tool('canvas_create', '为当前绘图任务在后台新建并绑定独立画布，可用 folderId 指定项目文件夹。不会切换用户页面；已有绑定时返回原画布。', { title: { type: 'string', description: '新画布名称' }, folderId: { type: ['string', 'null'], description: '从 canvas_folders 读取的目标文件夹 ID' } }, [], async ({ title, folderId }, execution) => {
    if (!execution.agent) throw new Error('缺少助手会话');
    const inherited = contextOf(execution.agent);
    if (inherited) return request(`/assistant/bindings/${encodeURIComponent(inherited.sessionId)}`, undefined, execution.signal);
    return request('/assistant/ensure', { sessionId: lineage(execution.agent).at(-1), title, folderId }, execution.signal);
  });
  tool('canvas_select', '给尚未绑定的当前助手会话绑定一张画布。每个会话固定对应一张画布，不会切换浏览器当前画布。', { canvasId: { type: 'string', description: '从 canvas_list 读取的目标画布 ID' } }, ['canvasId'], async ({ canvasId }, execution) => {
    if (!execution.agent) throw new Error('缺少助手会话');
    const inherited = contextOf(execution.agent);
    if (inherited && inherited.canvasId !== canvasId) throw new Error(`本会话已绑定 ${inherited.canvasId}，请使用目标画布对应的助手会话`);
    return request('/assistant/bindings', { sessionId: inherited?.sessionId || execution.agent.id, canvasId }, execution.signal);
  });
  tool('canvas_context', '读取本会话独立绑定的画布 ID、名称、路径和保存版本；前台查看哪张图不影响编辑目标。', {}, [], async (_args, execution) => {
    if (!execution.agent) throw new Error('缺少助手会话');
    const context = contextOf(execution.agent);
    if (!context) throw new Error('本会话尚未绑定画布');
    return { ...context };
  });
  ctx.effect(() => () => {
    for (const dispose of decorated.values()) dispose();
    decorated.clear();
  });
  console.info('[canvas-session] Independent canvas routing and background creation enabled');
}
