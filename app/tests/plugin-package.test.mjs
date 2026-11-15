import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function parseWithDshManifestLibrary(patchPath, fallbackText) {
  const globalModules = path.resolve(path.dirname(process.execPath), '../lib/node_modules');
  const dshPackage = path.join(globalModules, '@deepseek-ai/dsh/package.json');
  if (!existsSync(dshPackage)) {
    assert.match(fallbackText, /^- insert:\s*$/m);
    assert.match(fallbackText, /name:\s*dsh-excalidraw-canvas\s*$/m);
    assert.match(fallbackText, /name:\s*dsh-excalidraw-canvas\/host\s*$/m);
    return;
  }
  const dshRequire = createRequire(dshPackage);
  const cordisPath = dshRequire.resolve('@deepseek-ai/cordis/package.json');
  const cordisRequire = createRequire(cordisPath);
  const includePath = cordisRequire.resolve('@deepseek-ai/cordis-plugin-include');
  const { entryListSchema, applyEntryPatches } = await import(pathToFileURL(includePath).href);
  const yamlPath = createRequire(includePath).resolve('js-yaml');
  const yaml = await import(pathToFileURL(yamlPath).href);
  const patches = yaml.load(await readFile(patchPath, 'utf8'), { schema: entryListSchema });
  const warnings = [];
  const rows = applyEntryPatches([], patches, message => warnings.push(message));
  assert.deepEqual(warnings, []);
  assert.deepEqual(rows.map(row => [row.id, row.name]), [
    ['canvas-session', 'dsh-excalidraw-canvas'],
    ['canvas-session-scope', 'dsh-excalidraw-canvas/host'],
  ]);
}

test('packs a resolvable DSH bundle with its host, context, and root-namespaced client', async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'canvas-plugin-pack-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const sourceManifest = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const declaredPatch = sourceManifest.dsh?.bundle?.patch;
  assert.equal(declaredPatch, './cordis.patch.yml');
  const sourcePatch = path.resolve(repoRoot, declaredPatch);
  assert(sourcePatch.startsWith(repoRoot + path.sep));
  assert(existsSync(sourcePatch));
  await parseWithDshManifestLibrary(sourcePatch, await readFile(sourcePatch, 'utf8'));

  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', temp], { cwd: repoRoot, encoding: 'utf8' }));
  assert.equal(packed.length, 1);
  const archive = path.join(temp, packed[0].filename);
  const listing = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
  for (const file of [
    'package/package.json', 'package/INSTALL.md', 'package/cordis.patch.yml', 'package/plugin/index.js', 'package/plugin/host.js', 'package/plugin/client.js',
    'package/dsh-embed/plugin/dsh-canvas-session/index.js', 'package/dsh-embed/plugin/dsh-canvas-session/host.js',
    'package/dsh-embed/plugin/dsh-canvas-session/context.js', 'package/dsh-embed/plugin/dsh-canvas-session/client.js',
  ]) assert(listing.includes(file), `npm pack omitted ${file}`);

  const profile = path.join(temp, 'dsh-profile');
  const installedPackage = path.join(profile, 'node_modules', sourceManifest.name);
  await mkdir(installedPackage, { recursive: true });
  execFileSync('tar', ['-xzf', archive, '-C', installedPackage, '--strip-components=1']);
  const profileRequire = createRequire(path.join(profile, 'probe.cjs'));
  const manifestPath = profileRequire.resolve(`${sourceManifest.name}/package.json`);
  const packedManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(packedManifest.name, sourceManifest.name);
  assert.equal(packedManifest.dsh.bundle.patch, './cordis.patch.yml');
  const packedPatch = path.resolve(path.dirname(manifestPath), packedManifest.dsh.bundle.patch);
  await parseWithDshManifestLibrary(packedPatch, await readFile(packedPatch, 'utf8'));

  const entryPath = profileRequire.resolve(sourceManifest.name);
  const hostPath = profileRequire.resolve(`${sourceManifest.name}/host`);
  const clientPath = profileRequire.resolve(`${sourceManifest.name}/client`);
  const entry = await import(pathToFileURL(entryPath).href);
  assert.equal(typeof entry.apply, 'function');
  const client = await readFile(clientPath, 'utf8');
  let loadedClient;
  vm.runInNewContext(client, { window: { __ModuleLoader__: { load(definition) { loadedClient = definition; } } } });
  assert.equal(loadedClient.id, packedManifest.name);
  assert.equal(typeof loadedClient.factory, 'function');
  const hostSource = await readFile(hostPath, 'utf8');
  assert.match(hostSource, /export \{ name, inject \}/);
  assert.match(hostSource, /export async function apply\(/);
});
