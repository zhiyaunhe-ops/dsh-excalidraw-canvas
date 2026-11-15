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
  if (!context) return '本会话尚未绑定 Excalidraw 画布。需要画图时先调用 canvas_list，再调用 canvas_select 指定用户要编辑的画布。浏览器当前打开的画布不是本会话的隐式编辑目标。';
  if (context.missing) return `本会话绑定的画布 ${context.canvasId} 已不存在。不要新建同名文件或改动其他画布；请告知用户并从目标画布重新打开助手。`;
  return [
    '当前会话的 Excalidraw 编辑目标（每轮自动更新，绑定不随窗口切换或会话重命名而改变）：',
    `canvas_id: ${context.canvasId}`,
    `名称: ${context.title}`,
    `地址: ${context.url}`,
    `画布文件: ${context.filePath}`,
    `保存版本: ${context.revision}`,
    `当前直播画布: ${context.activeId || '未打开'}`,
    '仅编辑上述画布。使用 mcp__excalidraw__* 工具读写；工具操作自动保存到此画布。调用画布工具时串行执行。',
    '画布文件路径用于识别和读取。保存由工作空间管理，不要向该路径 export_scene，也不要导出覆写任何工作空间图纸。用户明确要求下载时，再导出到单独的导出目录。',
    '不要用 bash/curl/CLI 或直接改画布文件绕过画布绑定；不要自动切换到其他画布，不要复制出额外版本，除非用户明确要求。',
    '如果用户切换窗口导致当前直播画布与绑定不同，停止画布操作，提示打开绑定画布或使用另一张画布对应的助手会话。',
    '修改前先读取此画布的现有内容；保留未要求修改的文字、元素 ID、分组与关系。修改后确认工具返回成功再报告完成。',
    '本会话派生的子任务继承同一画布目标。',
  ].join('\n');
}
