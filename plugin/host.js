import Schema from '@deepseek-ai/schemastery';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { apply as applyScope } from '../dsh-embed/plugin/dsh-canvas-session/host.js';
export { name, inject } from '../dsh-embed/plugin/dsh-canvas-session/host.js';

export async function apply(ctx, config = {}) {
  if (config.mode === 'desktop') {
    if (!config.desktopDirectory) throw new Error('请先执行 npm run setup:desktop，再设置 desktopDirectory 为仓库的绝对路径');
    const { startDesktop, desktopOptions } = await import(pathToFileURL(path.join(config.desktopDirectory, 'scripts/desktop.mjs')));
    const options = desktopOptions();
    if (config.libraryDir) options.root = path.resolve(config.libraryDir);
    if (config.canvasPort) options.canvasPort = config.canvasPort;
    if (config.workspacePort) options.workspacePort = config.workspacePort;
    const desktop = await startDesktop(options);
    ctx.effect(() => () => desktop.close());
    applyScope(ctx, { libraryDir: desktop.libraryDir, workspaceUrl: desktop.url, publicUrl: desktop.url });
    const mcpClient = await import('@deepseek-ai/dsh-mcp-client');
    ctx.plugin(mcpClient, desktop.mcp);
    console.info(`[canvas-session] Desktop workspace: ${desktop.url}/library/`);
  } else applyScope(ctx, config);
}

export const Config = Schema.object({
  mode: Schema.union(['cloud', 'desktop']).default('cloud').description('cloud: connect a deployed workspace; desktop: start local services with this plugin.'),
  desktopDirectory: Schema.string().description('Desktop only: absolute path of the prepared repository checkout.'),
  libraryDir: Schema.string().description('Storage directory. Cloud default: /var/www/canvas-library; Desktop default: ~/.dsh-canvas.'),
  workspaceUrl: Schema.string().description('Cloud API URL; default http://127.0.0.1:9111. Desktop uses its local listener.'),
  publicUrl: Schema.string().description('Cloud website URL shown to the assistant; defaults to workspaceUrl.'),
  canvasPort: Schema.number().default(3130).description('Desktop live canvas port.'),
  workspacePort: Schema.number().default(9112).description('Desktop workspace port.'),
});
