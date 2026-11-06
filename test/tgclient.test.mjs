import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activate, deactivate, parseProxy } from '../packages/enso.tgclient/main.mjs';

test('解析代理', () => {
  assert.equal(parseProxy(''), undefined);
  assert.deepEqual(parseProxy('socks5://127.0.0.1:7890'), { ip: '127.0.0.1', port: 7890, socksType: 5 });
  assert.deepEqual(parseProxy('socks5://u:p%40@h:1'), { ip: 'h', port: 1, socksType: 5, username: 'u', password: 'p@' });
  assert.deepEqual(parseProxy('tg://proxy?server=a.b&port=443&secret=ee00'), { ip: 'a.b', port: 443, secret: 'ee00', MTProxy: true });
  assert.deepEqual(parseProxy('https://t.me/proxy?server=a.b&port=443&secret=dd11'), { ip: 'a.b', port: 443, secret: 'dd11', MTProxy: true });
  assert.throws(() => parseProxy('http://127.0.0.1:8080'));
});

test('未登录时停在登录页，校验参数，轮询立即返回状态', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'tgclient-'));
  const handlers = new Map();
  const tools = new Map();
  const enso = {
    tools: { register: (name, fn) => tools.set(name, fn) },
    dataDir,
    config: { get: async () => ({}) },
    renderer: { handle: (name, fn) => handlers.set(name, fn) },
    ui: { notify: async () => {}, openExternal: async () => {} },
  };
  try {
    await activate(enso);
    const st = await handlers.get('state')({});
    assert.equal(st.status, 'setup');
    await assert.rejects(handlers.get('login')({ phone: 'abc' }), /手机号/);
    await assert.rejects(handlers.get('dialogs')({}), /请先登录/);
    for (const m of ['edit', 'react', 'reactionList', 'press', 'stickers', 'stickerThumbs', 'sendSticker', 'readers', 'sendAs', 'setSendAs', 'topics'])
      await assert.rejects(handlers.get(m)({ chat: '1', id: 1 }), /请先登录/);
    const r = await handlers.get('poll')({ cursor: 0 });
    assert.equal(r.status, 'setup');
    assert.ok(r.events.some((e) => e.type === 'status'));
    assert.ok(Buffer.byteLength(JSON.stringify(r)) < 64 * 1024);
    await assert.rejects(handlers.get('open')({ url: 'file:///etc/passwd' }));
    const manifest = JSON.parse(await readFile(new URL('../packages/enso.tgclient/enso-plugin.json', import.meta.url), 'utf8'));
    assert.deepEqual([...tools.keys()].sort(), manifest.contributes.agentTools.map((t) => t.name).sort());
    for (const [name, fn] of tools) if (name !== 'tg_unwatch') await assert.rejects(fn({ chat: 'me', query: 'x', text: 'x' }), /请先登录/);
    assert.deepEqual(await tools.get('tg_unwatch')({}, { sessionId: 's1' }), { ok: true, watching: null });
  } finally {
    await deactivate();
    await rm(dataDir, { recursive: true, force: true });
  }
});
