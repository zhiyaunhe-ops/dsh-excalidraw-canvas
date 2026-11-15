import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readScript = name => readFile(path.join(repoRoot, name), 'utf8');

async function stub(dir, name, body) {
  const file = path.join(dir, name);
  await writeFile(file, `#!/usr/bin/env bash\n${body}\n`);
  await chmod(file, 0o755);
}

async function embedFixture(t, { siteSuffix = '.conf', mode = 'local', bundleInstalled = false, workspaceInstalled = false } = {}) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'canvas-install-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = path.join(temp, 'repo');
  await cp(path.join(repoRoot, 'dsh-embed'), path.join(repo, 'dsh-embed'), { recursive: true });
  await cp(path.join(repoRoot, 'scripts'), path.join(repo, 'scripts'), { recursive: true });
  const embedPath = path.join(repo, 'dsh-embed/install.sh');
  let embed = await readFile(embedPath, 'utf8');
  for (const [from, to] of [
    ['/var/www/canvas-library', path.join(temp, 'var/www/canvas-library')],
    ['/var/www/canvas-embed', path.join(temp, 'var/www/canvas-embed')],
    ['/usr/local/bin', path.join(temp, 'usr/local/bin')],
    ['/etc/systemd/system', path.join(temp, 'etc/systemd/system')],
    ['/etc/nginx/sites-available/excalidraw-canvas', path.join(temp, 'etc/nginx/sites-available/excalidraw-canvas')],
    ['/etc/excalidraw-canvas', path.join(temp, 'etc/excalidraw-canvas')],
  ]) embed = embed.split(from).join(to);
  await writeFile(embedPath, embed);

  const home = path.join(temp, 'home');
  const profile = path.join(home, '.dsh/profiles/web');
  const targetBase = path.join(temp, 'etc/nginx/sites-available/canvas-site');
  const site = `${targetBase}${siteSuffix}`;
  const log = path.join(temp, 'commands.log');
  const stubBin = path.join(temp, 'stubs');
  await mkdir(path.join(profile, 'node_modules'), { recursive: true });
  await mkdir(path.dirname(site), { recursive: true });
  await mkdir(path.join(temp, 'var/www/canvas-library/drawings'), { recursive: true });
  await mkdir(path.join(temp, 'etc/systemd/system'), { recursive: true });
  await mkdir(path.join(temp, 'usr/local/bin'), { recursive: true });
  await mkdir(path.join(temp, 'etc/excalidraw-canvas'), { recursive: true });
  await mkdir(stubBin);
  await writeFile(path.join(profile, 'package.json'), '{}');
  await writeFile(path.join(profile, 'cordis.patch.yml'), '# existing profile patch\n');
  await writeFile(path.join(temp, 'var/www/canvas-library/index.html'), '<html></html>');
  await writeFile(path.join(temp, 'etc/excalidraw-canvas/token'), 'fixture-token');
  await writeFile(site, 'server {\n  server_name canvas.example.test;\n  location /dsh/ {}\n}\n');
  if (bundleInstalled) {
    const bundle = path.join(profile, 'node_modules/dsh-excalidraw-canvas');
    await mkdir(bundle, { recursive: true });
    await writeFile(path.join(bundle, 'package.json'), '{"name":"dsh-excalidraw-canvas"}');
  }
  if (workspaceInstalled) await writeFile(path.join(temp, 'etc/systemd/system/canvas-workspace.service'), '[Unit]\n');

  // Stub privileged and network commands. The two delegated installers only record their selected paths.
  await stub(stubBin, 'id', 'if [[ "$1" == "-u" ]]; then echo 0; else echo "$TEST_USER"; fi');
  await stub(stubBin, 'getent', 'echo "fixture:x:1000:1000::${TEST_HOME}:/bin/bash"');
  for (const cmd of ['node', 'systemctl', 'curl', 'chgrp', 'chown', 'sleep']) {
    await stub(stubBin, cmd, '[[ "$1" == "-u" ]] && exit 0; printf "%s %s\\n" "' + cmd + '" "$*" >> "$TEST_LOG"; exit 0');
  }
  await stub(stubBin, 'sudo', 'if [[ "$1" == "-u" ]]; then shift 2; fi; exec "$@"');
  await stub(stubBin, 'install', `
  directory=false; mode=644; args=()
  while (($#)); do
    case "$1" in
      -d) directory=true; shift ;;
      -m) mode="$2"; shift 2 ;;
      -o|-g) shift 2 ;;
      *) args+=("$1"); shift ;;
    esac
  done
  destination="\${args[-1]}"
  if [[ "$directory" == true ]]; then mkdir -p "$destination"; exit; fi
  if [[ -d "$destination" ]]; then
    for source in "\${args[@]:0:\${#args[@]}-1}"; do cp "$source" "$destination/"; chmod "$mode" "$destination/\$(basename "$source")"; done
  else
    mkdir -p "\$(dirname "$destination")"; cp "\${args[0]}" "$destination"; chmod "$mode" "$destination"
  fi
`);
  await writeFile(path.join(repo, 'scripts/install-workspace.sh'), '#!/usr/bin/env bash\nprintf "workspace:%s\\n" "$CANVAS_SITE" >> "$TEST_LOG"\n');
  await chmod(path.join(repo, 'scripts/install-workspace.sh'), 0o755);
  await writeFile(path.join(repo, 'scripts/install-session-scope.sh'), '#!/usr/bin/env bash\nprintf "session-scope:%s\\n" "$CANVAS_SITE" >> "$TEST_LOG"\n');
  await chmod(path.join(repo, 'scripts/install-session-scope.sh'), 0o755);
  await writeFile(path.join(repo, 'scripts/bind-existing-sessions.py'), 'import os\nopen(os.environ["TEST_LOG"], "a").write("bundle-migration:" + os.environ.get("DSH_RUN_HOME", "") + "\\n")\n');
  const env = {
    ...process.env,
    PATH: `${stubBin}:${process.env.PATH}`,
    SUDO_USER: process.env.USER || 'ubuntu',
    TEST_USER: process.env.USER || 'ubuntu',
    TEST_HOME: home,
    TEST_LOG: log,
    CANVAS_SITE: targetBase,
    CANVAS_PLUGIN_MODE: mode,
  };
  return { temp, repo, home, profile, site, targetBase, log, env, script: embedPath };
}

function runEmbed(fixture) {
  return execFileSync('bash', [fixture.script], { cwd: fixture.repo, env: fixture.env, encoding: 'utf8' });
}

test('embed installer selects the fresh .conf site and local plugin path without a workspace install', async t => {
  const f = await embedFixture(t, { siteSuffix: '.conf', mode: 'local', workspaceInstalled: true });
  const output = runEmbed(f);
  const log = await readFile(f.log, 'utf8');
  assert.match(output, /插件模式\s+local/);
  assert.match(log, new RegExp(`session-scope:${f.site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.doesNotMatch(log, /workspace:/);
  assert.doesNotMatch(log, /bundle-migration:/);
  assert.match(await readFile(path.join(f.profile, 'cordis.patch.yml'), 'utf8'), /name: dsh-canvas-session/);
  assert.equal(await (await import('node:fs/promises')).lstat(path.join(f.profile, 'node_modules/dsh-canvas-session')).then(stat => stat.isSymbolicLink()), true);
});

test('embed installer uses legacy site path and bundle mode without mixing local plugins', async t => {
  const f = await embedFixture(t, { siteSuffix: '', mode: 'bundle', bundleInstalled: true });
  runEmbed(f);
  const log = await readFile(f.log, 'utf8');
  assert.match(log, new RegExp(`workspace:${f.site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(log, new RegExp(`bundle-migration:${f.home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.doesNotMatch(log, /session-scope:/);
  assert.doesNotMatch(log, /workspace:.*\.conf/);
  assert.equal(await (await import('node:fs/promises')).access(path.join(f.profile, 'node_modules/dsh-canvas-session')).then(() => true, () => false), false);
  assert.equal(await readFile(path.join(f.profile, 'cordis.patch.yml'), 'utf8'), '# existing profile patch\n');
});

test('embed installer rejects mixing local and bundle modes before installing files', async t => {
  const localOverBundle = await embedFixture(t, { mode: 'local', bundleInstalled: true });
  assert.throws(() => runEmbed(localOverBundle), /already|bundle|请用/u);
  assert.equal(await (await import('node:fs/promises')).access(path.join(localOverBundle.profile, 'node_modules/dsh-canvas-session')).then(() => true, () => false), false);

  const bundleWithoutPackage = await embedFixture(t, { mode: 'bundle' });
  assert.throws(() => runEmbed(bundleWithoutPackage), /bundle|请先/u);
});

async function workspaceFixture(t, { readyAfter = 3 } = {}) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'canvas-workspace-install-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = path.join(temp, 'repo');
  const scriptDir = path.join(repo, 'scripts');
  await mkdir(scriptDir, { recursive: true });
  await mkdir(path.join(repo, 'templates'), { recursive: true });
  await mkdir(path.join(repo, 'app'), { recursive: true });
  let source = await readScript('scripts/install-workspace.sh');
  source = source
    .replaceAll('/var/www/canvas-library', path.join(temp, 'var/www/canvas-library'))
    .replaceAll('/etc/systemd/system', path.join(temp, 'etc/systemd/system'));
  const installer = path.join(scriptDir, 'install-workspace.sh');
  await writeFile(installer, source);
  await cp(path.join(repoRoot, 'templates/canvas-workspace.service.tpl'), path.join(repo, 'templates/canvas-workspace.service.tpl'));
  const globalRoot = path.join(temp, 'global');
  await mkdir(path.join(globalRoot, 'mcp-excalidraw-server/dist'), { recursive: true });
  await writeFile(path.join(globalRoot, 'mcp-excalidraw-server/dist/server.js'), '');
  const site = path.join(temp, 'etc/nginx/sites-available/canvas-site.conf');
  await mkdir(path.dirname(site), { recursive: true });
  await writeFile(site, 'server {\n    location = / {\n        return 200;\n    }\n    location /library/ {\n        return 200;\n    }\n    location = /dsh/login {\n        return 200;\n    }\n}\n');
  await mkdir(path.join(temp, 'var/www/canvas-library/drawings'), { recursive: true });
  await mkdir(path.join(temp, 'etc/systemd/system'), { recursive: true });
  const stubBin = path.join(temp, 'stubs');
  await mkdir(stubBin);
  const log = path.join(temp, 'commands.log');
  const countFile = path.join(temp, 'curl-count');
  await stub(stubBin, 'id', '[[ "$1" == "-u" ]] && echo 0 || echo "$TEST_USER"');
  await stub(stubBin, 'node', 'exit 0');
  await stub(stubBin, 'npm', `if [[ "$1 $2" == "root -g" ]]; then echo "$TEST_NPM_ROOT"; else printf "npm:%s\\n" "$*" >> "$TEST_LOG"; [[ "$PATH" == *"$TEST_STUB_BIN"* ]] && echo "npm-path-forwarded" >> "$TEST_LOG"; fi`);
  await stub(stubBin, 'sudo', `
    if [[ "$1" == "-u" ]]; then shift 2; fi
    if [[ "$1" == "env" ]]; then
      shift
      while [[ "$1" == *=* ]]; do export "$1"; shift; done
    elif [[ "$STRICT_SUDO_PATH" == 1 ]]; then
      echo "sudo command omitted env PATH forwarding" >&2; exit 88
    fi
    exec "$@"
  `);
  await stub(stubBin, 'curl', `
    count=0; [[ -f "$TEST_CURL_COUNT" ]] && count=$(cat "$TEST_CURL_COUNT")
    count=$((count + 1)); echo "$count" > "$TEST_CURL_COUNT"
    printf "curl:%s\\n" "$*" >> "$TEST_LOG"
    (( count >= READY_AFTER ))
  `);
  await stub(stubBin, 'sleep', 'exit 0');
  for (const cmd of ['systemctl', 'nginx', 'chown']) await stub(stubBin, cmd, 'printf "' + cmd + ':%s\\n" "$*" >> "$TEST_LOG"; exit 0');
  await stub(stubBin, 'install', `
    directory=false; args=()
    while (($#)); do case "$1" in -d) directory=true; shift;; -m|-o|-g) shift 2;; *) args+=("$1"); shift;; esac; done
    destination="\${args[-1]}"
    if [[ "$directory" == true ]]; then mkdir -p "$destination"; exit; fi
    mkdir -p "\$(dirname "$destination")"
    if [[ -d "$destination" ]]; then for source in "\${args[@]:0:\${#args[@]}-1}"; do cp -a "$source" "$destination/"; done; else cp -a "\${args[0]}" "$destination"; fi
  `);
  return {
    temp, repo, installer, site, log, countFile, stubBin,
    env: { ...process.env, PATH: `${stubBin}:${process.env.PATH}`, SUDO_USER: process.env.USER || 'ubuntu', TEST_USER: process.env.USER || 'ubuntu', TEST_LOG: log, TEST_NPM_ROOT: globalRoot, TEST_STUB_BIN: stubBin, TEST_CURL_COUNT: countFile, READY_AFTER: String(readyAfter), STRICT_SUDO_PATH: '1', CANVAS_SITE: site },
  };
}

test('workspace install waits for its API, forwards Node PATH through sudo, then rewrites the site', async t => {
  const f = await workspaceFixture(t, { readyAfter: 3 });
  execFileSync('bash', [f.installer], { cwd: f.repo, env: f.env, encoding: 'utf8' });
  const log = await readFile(f.log, 'utf8');
  assert.match(log, /npm:ci --no-audit --no-fund/);
  assert.match(log, /npm:run build/);
  assert.match(log, /npm-path-forwarded/);
  assert.equal((await readFile(f.countFile, 'utf8')).trim(), '4');
  const site = await readFile(f.site, 'utf8');
  assert.match(site, /location \/workspace\//);
  assert.match(site, /location = \/dsh\/login/);
  assert.match(log, /systemctl:restart canvas-workspace.service/);
  assert.match(log, /nginx:-t/);
});

test('workspace install stops before site edits when its API never becomes ready', async t => {
  const f = await workspaceFixture(t, { readyAfter: 100 });
  assert.throws(() => execFileSync('bash', [f.installer], { cwd: f.repo, env: f.env, encoding: 'utf8' }), error => {
    assert.match(error.stderr.toString(), /工作空间未就绪/);
    return true;
  });
  assert.equal((await readFile(f.countFile, 'utf8')).trim(), '21');
  assert.doesNotMatch(await readFile(f.log, 'utf8'), /nginx:/);
  assert.match(await readFile(f.site, 'utf8'), /location = \/ \{/);
});

async function mcpFixture(t, { dependencyInstalled = false } = {}) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'canvas-mcp-install-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = path.join(temp, 'repo');
  const scripts = path.join(repo, 'scripts');
  const stubBin = path.join(temp, 'stubs');
  const home = path.join(temp, 'home');
  const profile = path.join(home, '.dsh/profiles/web');
  const globalRoot = path.join(temp, 'global');
  const log = path.join(temp, 'commands.log');
  await mkdir(scripts, { recursive: true });
  await mkdir(stubBin, { recursive: true });
  await mkdir(profile, { recursive: true });
  await mkdir(path.join(globalRoot, 'mcp-excalidraw-server/dist'), { recursive: true });
  await writeFile(path.join(profile, 'package.json'), '{}');
  await writeFile(path.join(globalRoot, 'mcp-excalidraw-server/dist/index.js'), '');
  if (dependencyInstalled) {
    await mkdir(path.join(profile, 'node_modules/@deepseek-ai/dsh-mcp-client'), { recursive: true });
    await writeFile(path.join(profile, 'node_modules/@deepseek-ai/dsh-mcp-client/package.json'), '{}');
  }
  await cp(path.join(repoRoot, 'scripts/install-dsh-mcp.sh'), path.join(scripts, 'install-dsh-mcp.sh'));
  await cp(path.join(repoRoot, 'templates/cordis.patch.insert.yml.tpl'), path.join(repo, 'templates/cordis.patch.insert.yml.tpl'));
  await stub(stubBin, 'npm', '[[ "$1 $2" == "root -g" ]] && echo "$TEST_NPM_ROOT"');
  await stub(stubBin, 'node', 'exit 0');
  await stub(stubBin, 'dsh', 'echo mcp-excalidraw');
  await stub(stubBin, 'systemctl', 'exit 0');
  await stub(stubBin, 'pnpm', 'printf "pnpm:%s\\n" "$*" >> "$TEST_LOG"; exit 0');
  return { temp, repo, home, profile, log, script: path.join(scripts, 'install-dsh-mcp.sh'), stubBin, globalRoot,
    env: { ...process.env, HOME: home, PATH: `${stubBin}:${process.env.PATH}`, TEST_NPM_ROOT: globalRoot, TEST_LOG: log } };
}

test('MCP installer adds the missing client dependency to the selected profile and skips it when present', async t => {
  const missing = await mcpFixture(t);
  execFileSync('bash', [missing.script, 'web'], { cwd: missing.repo, env: missing.env, encoding: 'utf8' });
  const added = await readFile(missing.log, 'utf8');
  assert.match(added, new RegExp(`--dir ${missing.profile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} add --save-exact @deepseek-ai/dsh-mcp-client@0\\.2\\.1-rc\\.2`));
  assert.match(await readFile(path.join(missing.profile, 'cordis.patch.yml'), 'utf8'), /id: mcp-excalidraw/);

  const installed = await mcpFixture(t, { dependencyInstalled: true });
  execFileSync('bash', [installed.script, 'web'], { cwd: installed.repo, env: installed.env, encoding: 'utf8' });
  assert.equal(await (await import('node:fs/promises')).access(installed.log).then(() => true, () => false), false);
});

test('installer shell entrypoints parse without executing system commands', async () => {
  for (const file of ['install.sh', 'dsh-embed/install.sh', 'scripts/install-workspace.sh', 'scripts/install-dsh-mcp.sh', 'scripts/install-session-scope.sh']) {
    execFileSync('bash', ['-n', path.join(repoRoot, file)]);
  }
  execFileSync('python3', ['-c', `import ast; ast.parse(open(${JSON.stringify(path.join(repoRoot, 'scripts/bind-existing-sessions.py'))}).read())`]);
});
