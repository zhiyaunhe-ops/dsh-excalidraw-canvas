import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { transformWithEsbuild } from 'vite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(appRoot, 'src/AssistantDock.jsx'), 'utf8');
const transformed = await transformWithEsbuild(source, 'AssistantDock.jsx', { loader: 'jsx' });
const temp = await mkdtemp(path.join(appRoot, '.assistant-dock-test-'));
await writeFile(path.join(temp, 'AssistantDock.mjs'), transformed.code);
const { AssistantDock } = await import(pathToFileURL(path.join(temp, 'AssistantDock.mjs')).href);
await rm(temp, { recursive: true, force: true });

const Icon = () => React.createElement('svg');
const dock = props => React.createElement(AssistantDock, { Icon, onClose() {}, onConnect() {}, onKeyDown() {}, ...props });
const iframeByCanvas = renderer => Object.fromEntries(renderer.root.findAllByType('iframe').map(frame => [
  decodeURIComponent(new URL(frame.props.src, 'http://local').searchParams.get('canvas')),
  frame,
]));

test('preloads each document once and keeps its iframe mounted while collapsing and navigating', () => {
  let renderer;
  act(() => {
    renderer = TestRenderer.create(dock({ documents: [{ id: 'A', title: 'Canvas A', active: true }], currentId: null, open: false }));
  });

  const initial = iframeByCanvas(renderer);
  assert.deepEqual(Object.keys(initial), ['A']);
  assert.equal(initial.A.props.loading, 'eager');
  assert.equal(initial.A.props.src, '/dsh/login?canvas=A');
  assert.equal(renderer.root.findByType('aside').props['aria-hidden'], true);

  act(() => renderer.update(dock({ documents: [{ id: 'A', title: 'Canvas A', active: true }], currentId: 'A', open: true })));
  assert.equal(renderer.root.findByType('aside').props['aria-hidden'], false);
  assert.equal(iframeByCanvas(renderer).A.props.src, initial.A.props.src);

  // Closing the dock and returning to the library only changes visibility.
  act(() => renderer.update(dock({ documents: [{ id: 'A', title: 'Canvas A', active: true }], currentId: null, open: false })));
  assert.equal(iframeByCanvas(renderer).A.props.src, initial.A.props.src);

  // A new document is preloaded while the dock is closed, then both sessions
  // remain in the tree as navigation switches between them.
  const documents = [
    { id: 'A', title: 'Canvas A', active: true },
    { id: 'B', title: 'Canvas B', active: true },
  ];
  act(() => renderer.update(dock({ documents, currentId: null, open: false })));
  const withB = iframeByCanvas(renderer);
  assert.deepEqual(Object.keys(withB).sort(), ['A', 'B']);
  assert.equal(withB.B.props.src, '/dsh/login?canvas=B');
  act(() => renderer.update(dock({ documents, currentId: 'B', open: true })));
  assert.equal(iframeByCanvas(renderer).A.props.src, initial.A.props.src);
  assert.equal(iframeByCanvas(renderer).B.props.src, withB.B.props.src);
  act(() => renderer.update(dock({ documents, currentId: 'A', open: false })));
  assert.equal(iframeByCanvas(renderer).A.props.src, initial.A.props.src);
  assert.equal(iframeByCanvas(renderer).B.props.src, withB.B.props.src);

  act(() => renderer.unmount());
});
