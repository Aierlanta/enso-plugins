import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { activate } from '../packages/enso.pstack/main.mjs';

async function harness(dir) {
  const handlers = {};
  let onInput;
  await activate({
    dataDir: dir,
    renderer: { handle: (name, fn) => (handlers[name] = fn) },
    events: { on: (event, fn) => event === 'input' && (onInput = fn) },
  });
  return {
    session: (sessionId, pstack = true) => handlers.session({ sessionId, pstack }),
    toggle: (sessionId, pstack = true) => handlers.toggle({ sessionId, pstack }),
    input: (text, ctx) => onInput({ text }, ctx),
  };
}

async function withDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'pstack-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const wrapped = (text) => ({ action: 'transform', text: `/skill:poteto-mode ${text}` });

test('未开启的会话不改写', async () => {
  await withDir(async (dir) => {
    const p = await harness(dir);
    assert.deepEqual(await p.session('s'), { on: false });
    assert.equal(p.input('hi', { sessionId: 's' }), undefined);
  });
});

test('开关只作用于打开它的会话', async () => {
  await withDir(async (dir) => {
    const p = await harness(dir);
    assert.deepEqual(await p.toggle('a'), { on: true });
    assert.deepEqual(p.input('hi', { sessionId: 'a' }), wrapped('hi'));
    assert.equal(p.input('hi', { sessionId: 'b' }), undefined);
    assert.deepEqual(await p.session('b'), { on: false });
    assert.deepEqual(await p.toggle('a'), { on: false });
    assert.equal(p.input('hi', { sessionId: 'a' }), undefined);
  });
});

test('斜杠开头和子代理的消息不改写', async () => {
  await withDir(async (dir) => {
    const p = await harness(dir);
    await p.toggle('s');
    assert.equal(p.input('/skill:poteto-mode hi', { sessionId: 's' }), undefined);
    assert.equal(p.input('  /cmd', { sessionId: 's' }), undefined);
    assert.equal(p.input('hi', { sessionId: 's', agent: { kind: 'subagent' } }), undefined);
  });
});

test('非 pstack 预设打不开，切离 pstack 预设后关闭', async () => {
  await withDir(async (dir) => {
    const p = await harness(dir);
    assert.deepEqual(await p.toggle('s', false), { on: false });
    await p.toggle('s');
    assert.deepEqual(await p.session('s', false), { on: false });
    assert.equal(p.input('hi', { sessionId: 's' }), undefined);
  });
});

test('状态写入磁盘，进程重启后仍生效', async () => {
  await withDir(async (dir) => {
    await (await harness(dir)).toggle('s');
    const second = await harness(dir);
    assert.deepEqual(await second.session('s'), { on: true });
    assert.deepEqual(second.input('hi', { sessionId: 's' }), wrapped('hi'));
  });
});

test('状态文件损坏或是旧格式时按全部关闭处理', async () => {
  await withDir(async (dir) => {
    await writeFile(join(dir, 'state.json'), '{');
    assert.equal((await harness(dir)).input('hi', { sessionId: 's' }), undefined);
    await writeFile(join(dir, 'state.json'), JSON.stringify({ auto: true, sessions: ['s'] }));
    assert.equal((await harness(dir)).input('hi', { sessionId: 's' }), undefined);
  });
});

test('并发切换不会互相覆盖', async () => {
  await withDir(async (dir) => {
    const p = await harness(dir);
    const results = await Promise.all([p.toggle('a'), p.toggle('b'), p.toggle('a')]);
    assert.deepEqual(results, [{ on: true }, { on: true }, { on: false }]);
    const saved = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'));
    assert.deepEqual(saved, { on: ['b'] });
  });
});

test('只保留最近打开的 200 个会话', async () => {
  await withDir(async (dir) => {
    const p = await harness(dir);
    for (let i = 0; i < 201; i += 1) await p.toggle(`s${i}`);
    assert.equal(p.input('hi', { sessionId: 's0' }), undefined);
    assert.deepEqual(p.input('hi', { sessionId: 's200' }), wrapped('hi'));
  });
});
