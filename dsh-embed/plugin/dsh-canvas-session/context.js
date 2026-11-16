import { readFileSync } from 'node:fs';
import path from 'node:path';

export function readCanvasContext(root, sessionIds, publicUrl) {
  let bindings;
  try { bindings = JSON.parse(readFileSync(path.join(root, '.assistant-bindings.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const sessionId = sessionIds.find(id => bindings[id]);
  if (!sessionId) return null;
  const canvasId = bindings[sessionId];
  const filePath = path.join(root, 'drawings', `${canvasId}.excalidraw`);
  let scene;
  try { scene = JSON.parse(readFileSync(filePath, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return { sessionId, canvasId, filePath, missing: true };
    throw error;
  }
  let activeId;
  try { ({ activeId } = JSON.parse(readFileSync(path.join(root, '.active-canvas.json'), 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { sessionId, canvasId, filePath, title: scene.name || canvasId, revision: scene.canvasMeta?.revision || 0, activeId, url: `${publicUrl.replace(/\/$/, '')}/canvas/${encodeURIComponent(canvasId)}` };
}

export function canvasPrompt(context) {
  if (!context) return '本会话尚未绑定 Excalidraw 画布。新绘图任务默认在后台新建独立画布：可用 canvas_create 指定名称，也可直接调用画布工具，系统会自动创建并绑定。只有用户明确指定现有画布时，才用 canvas_list / canvas_select 选择它。绝不能默认修改用户浏览器当前打开的图。其他 agent 的画布独立运行，不占用本会话。';
  if (context.missing) return `本会话绑定的画布 ${context.canvasId} 已不存在。不要新建同名文件或改动其他画布；请告知用户并从目标画布重新打开助手。`;
  return [
    '当前会话的 Excalidraw 编辑目标（每轮自动更新，绑定不随窗口切换或会话重命名而改变）：',
    `canvas_id: ${context.canvasId}`,
    `名称: ${context.title}`,
    `地址: ${context.url}`,
    `画布文件: ${context.filePath}`,
    `保存版本: ${context.revision}`,
    '本画布拥有独立执行环境，可以与其他画布并行绘图；无需用户打开本画布。',
    '仅编辑上述画布。使用 mcp__excalidraw__* 工具读写；工具操作自动保存到此画布。同一画布内的工具操作自动按顺序执行。',
    '画布文件路径用于识别和读取。保存由工作空间管理，不要向该路径 export_scene，也不要导出覆写任何工作空间图纸。用户明确要求下载时，再导出到单独的导出目录。',
    '不要用 bash/curl/CLI 或直接改画布文件绕过画布绑定；不要自动切换到其他画布，不要复制出额外版本，除非用户明确要求。',
    '用户切换窗口、前台查看其他画布，不改变本会话目标，不影响本画布后台绘图；不要要求用户先切换或连接此画布。',
    '修改前先读取此画布的现有内容；保留未要求修改的文字、元素 ID、分组与关系。修改后确认工具返回成功再报告完成。',
    '本会话派生的子任务继承同一画布目标。',
  ].join('\n');
}
