import { cp, mkdir, rm } from 'node:fs/promises';

// Copy instead of a Git symlink so Windows checkouts receive real font files.
const destination = new URL('./public/fonts/', import.meta.url);
await mkdir(new URL('./public/', import.meta.url), { recursive: true });
await rm(new URL('./public/fonts', import.meta.url), { recursive: true, force: true });
await cp(new URL('./node_modules/@excalidraw/excalidraw/dist/prod/fonts/', import.meta.url), destination, { recursive: true });
