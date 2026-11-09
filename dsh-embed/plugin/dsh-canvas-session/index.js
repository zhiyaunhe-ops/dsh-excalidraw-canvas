/**
 * dsh-canvas-session — node half.
 *
 * Pure UI plugin: the browser half (client.js) is discovered through the
 * package.json `dsh.client` declaration and served on the `/plugins/` route.
 * This empty apply only exists so the package can be inserted into the host
 * plugin list without dragging host-side behaviour along.
 */
export function apply() {}
