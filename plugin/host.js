import Schema from '@deepseek-ai/schemastery';
export { name, inject, apply } from '../dsh-embed/plugin/dsh-canvas-session/host.js';

export const Config = Schema.object({
  libraryDir: Schema.string().default('/var/www/canvas-library').description('Cloud workspace storage directory on this host.'),
  workspaceUrl: Schema.string().default('http://127.0.0.1:9111').description('Cloud workspace API URL accessible to the DSH host.'),
  publicUrl: Schema.string().default('http://127.0.0.1:9111').description('Canvas website URL shown to the assistant and user.'),
});
