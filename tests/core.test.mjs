import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { SemanticTools } from '../packages/bridge/dist/semantic/tools.js';
import { CommandRouter } from '../packages/bridge/dist/command-router.js';

test('command router rejects pending work when a plugin is replaced', async () => {
  const router = new CommandRouter();
  const socket = {
    readyState: 1,
    send(payload, callback) { this.lastPayload = payload; callback(); },
  };
  router.setSocket(socket);
  const pending = router.sendCommand('getDocumentInfo');
  router.cleanup();
  await assert.rejects(pending, /Connection lost/);
});

test('diff_apply preserves added node types and recreates child trees', async () => {
  const calls = [];
  let sequence = 0;
  const current = {
    id: 'root', name: 'Root', type: 'FRAME', properties: {}, children: [],
  };
  const executor = async (cmd, params) => {
    calls.push({ cmd, params });
    if (cmd === 'snapshotNode') return current;
    if (cmd === 'createNode') return { id: `new-${++sequence}`, name: params.name, type: params.type };
    if (cmd === 'createTextNode') return { id: `new-${++sequence}`, name: params.name, type: 'TEXT' };
    return {};
  };
  const tools = new SemanticTools(executor);
  const result = await tools.execute('diff_apply', {
    parentId: 'root',
    targetSnapshot: {
      ...current,
      children: [{
        id: 'old-card', name: 'Card', type: 'RECTANGLE',
        properties: { width: 100, height: 60 },
        children: [{ id: 'old-label', name: 'Label', type: 'TEXT', properties: { characters: 'Hello', fontSize: 14 } }],
      }],
    },
  });
  assert.equal(result.success, true);
  assert.equal(calls.find(call => call.cmd === 'createNode')?.params.type, 'RECTANGLE');
  assert.equal(calls.find(call => call.cmd === 'createTextNode')?.params.parentId, 'new-1');
});

test('semantic registry is hydrated from plugin data', async () => {
  const stored = [{ nodeId: '1:2', type: 'button', name: 'Primary', createdAt: 1 }];
  const executor = async (cmd) => cmd === 'getSemanticEntries' ? stored : {};
  const tools = new SemanticTools(executor);
  const result = await tools.execute('get_semantic_map', {});
  assert.equal(result.success, true);
  assert.deepEqual(result.data.entries, stored);
});

test('create_container uses FIXED for provided dimensions and HUG otherwise', async () => {
  const calls = [];
  let id = 0;
  const executor = async (cmd, params) => {
    calls.push({ cmd, params });
    if (cmd === 'createNode') return { id: `frame-${++id}`, name: params.name, type: 'FRAME' };
    return {};
  };
  const tools = new SemanticTools(executor);
  const fixed = await tools.execute('create_container', { name: 'Fixed', width: 320, height: 120 });
  const hug = await tools.execute('create_container', { name: 'Hug' });
  assert.equal(fixed.success, true);
  assert.deepEqual(fixed.data.sizing, { horizontal: 'FIXED', vertical: 'FIXED' });
  assert.deepEqual(hug.data.sizing, { horizontal: 'HUG', vertical: 'HUG' });
  const layouts = calls.filter(call => call.cmd === 'setLayout');
  assert.equal(layouts[0].params.layoutSizingHorizontal, 'FIXED');
  assert.equal(layouts[0].params.layoutSizingVertical, 'FIXED');
  assert.equal(layouts[1].params.layoutSizingHorizontal, 'HUG');
  assert.equal(layouts[1].params.layoutSizingVertical, 'HUG');
});

test('stdio server keeps diagnostic logs off stdout', async () => {
  const child = spawn(process.execPath, ['packages/bridge/dist/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, BRIDGE_WS_PORT: '0', BRIDGE_HTTP_PORT: '0' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => stdout += chunk);
  child.stderr.on('data', chunk => stderr += chunk);
  await delay(500);
  child.kill();
  await new Promise(resolve => child.once('exit', resolve));
  assert.equal(stdout, '');
  assert.match(stderr, /MCP Server started/);
});
