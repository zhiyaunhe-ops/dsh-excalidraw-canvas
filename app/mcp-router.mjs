import { randomUUID } from 'node:crypto';
import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { tools } from 'mcp-excalidraw-server/dist/core/mcp-tools.js';

const workspace = process.env.CANVAS_WORKSPACE_URL || 'http://127.0.0.1:9111';
// Other MCP clients get their own drawing too, even without the DSH scope plugin.
const connectionSession = process.env.CANVAS_SESSION_ID || `mcp-${randomUUID()}`;
serveStdio(() => {
  const server = new McpServer({ name: 'dsh-excalidraw-canvas', version: '0.5.0', description: 'Independent, automatically saved canvases. A new agent creates its own canvas in the background.' }, { capabilities: { tools: {} } });
  for (const tool of tools) server.registerTool(tool.name, { description: tool.description, inputSchema: fromJsonSchema(tool.inputSchema) }, async (input, execution) => {
    const { __dshCanvasSession, ...args } = input;
    try {
      const response = await fetch(`${workspace}/workspace/api/assistant/calls`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: __dshCanvasSession || connectionSession, name: tool.name, args }),
        signal: execution.signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '画布调用失败');
      const url = new URL(body.url, process.env.CANVAS_PUBLIC_URL || workspace).href;
      return { ...body.result, content: [{ type: 'text', text: `画布：${body.document.title}\ncanvas_id: ${body.document.id}\n地址：${url}\n已自动保存；未切换用户当前画布。` }, ...body.result.content] };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  return server;
});
