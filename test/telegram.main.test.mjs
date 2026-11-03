import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { activate } from '../packages/enso.telegram/main.mjs';

/** 假宿主 + 假 Bot API：记录每次调用，按队列返回 getUpdates */
async function setup({ injectError } = {}) {
  const calls = [];
  const updates = [];
  const injected = [];
  const notes = [];
  let nextId = 100;
  const handlers = { events: {}, renderer: {}, tools: {}, schedules: {} };
  const opened = [];
  const enso = {
    dataDir: await mkdtemp(join(tmpdir(), 'tg-')),
    config: { get: async () => ({ botToken: 'T' }) },
    net: {
      fetch: async (url, init) => {
        if (url.includes('/file/botT/')) {
          calls.push({ method: 'download', url, init });
          return { status: 200, body: 'iVBORw0K' };
        }
        const method = url.split('/').pop();
        const body = JSON.parse(init.body);
        calls.push({ method, body });
        const ok = (result) => ({ status: 200, body: JSON.stringify({ ok: true, result }) });
        if (method === 'getMe') return ok({ id: 99, username: 'enso_bot' });
        if (method === 'getUpdates') return ok(updates.splice(0));
        if (method === 'getFile') return ok({ file_path: `photos/${body.file_id}.jpg` });
        if (body.parse_mode === 'HTML' && body.text.includes('<b>坏'))
          return { status: 400, body: JSON.stringify({ ok: false, description: "can't parse entities" }) };
        if (method === 'sendMessage') return ok({ message_id: nextId++ });
        return ok(true);
      },
    },
    session: {
      abort: async (sessionId) => {
        if (injectError) throw Object.assign(new Error('x'), { code: 'ABORT_FAILED' });
        injected.push({ abort: sessionId });
      },
      inject: async (input) => {
        if (injectError) throw Object.assign(new Error('x'), { code: injectError });
        injected.push(input);
      },
    },
    ui: { notify: async (title, body) => notes.push(body), openExternal: async (url) => opened.push(url) },
    events: { on: (name, fn) => (handlers.events[name] = fn) },
    renderer: { handle: (id, fn) => (handlers.renderer[id] = fn) },
    tools: { register: (id, fn) => (handlers.tools[id] = fn) },
  };
  const { tick } = activate(enso, { loop: false });
  const message = (text, extra = {}) =>
    updates.push({
      update_id: updates.length + calls.length + 1,
      message: { message_id: 1, chat: { id: 42, type: 'private' }, from: { id: 7, username: 'al' }, text, ...extra },
    });
  const pair = async () => {
    const view = await handlers.renderer.pair({}, { sessionId: 's1' });
    message(`/start ${view.pairing.code}`);
  };
  return { tick, calls, injected, opened, handlers, message, pair, of: (m) => calls.filter((c) => c.method === m) };
}

const runPoll = (t) => t.tick(0);

test('配对后发消息：先发占位，注入会话，进度原位更新，结束时把回复写进占位', async () => {
  const t = await setup();
  await t.pair();
  t.message('帮我看下测试');
  await runPoll(t);
  assert.equal(t.of('setMyCommands').length, 1);
  assert.equal(t.injected.length, 1);
  assert.equal(t.injected[0].sessionId, 's1');
  assert.equal(t.injected[0].deliverAs, 'followUp');
  assert.match(t.injected[0].text, /帮我看下测试$/);
  const placeholder = t.of('sendMessage').find((c) => c.body.text.startsWith('⏳'));
  assert.ok(placeholder);

  await t.handlers.events.tool_call({ toolName: 'bash' }, { sessionId: 's1', agent: null });
  assert.match(t.of('editMessageText').at(-1).body.text, /第 1 步：bash/);

  await t.handlers.events.agent_end({ text: '**全部通过**' }, { sessionId: 's1', agent: null });
  const final = t.of('editMessageText').at(-1).body;
  assert.equal(final.text, '<b>全部通过</b>');
  assert.equal(final.parse_mode, 'HTML');

  // 已回发，再结束一轮不会重复发
  const before = t.calls.length;
  await t.handlers.events.agent_end({ text: '别的' }, { sessionId: 's1', agent: null });
  assert.equal(t.calls.length, before);
});

test('富文本解析失败退回纯文本', async () => {
  const t = await setup();
  await t.pair();
  t.message('hi');
  await runPoll(t);
  await t.handlers.events.agent_end({ text: '**坏**' }, { sessionId: 's1', agent: null });
  const last = t.calls.at(-1).body;
  assert.equal(last.text, '**坏**');
  assert.equal(last.parse_mode, undefined);
});

test('子代理的轮次结束不回发；会话没运行时在占位里说明原因', async () => {
  const t = await setup({ injectError: 'INJECT_FAILED' });
  await t.pair();
  t.message('hi');
  await runPoll(t);
  assert.match(t.of('editMessageText').at(-1).body.text, /没在运行/);
  const before = t.calls.length;
  await t.handlers.events.agent_end({ text: 'x' }, { sessionId: 's1', agent: { name: 'Scout' } });
  await t.handlers.events.agent_end({ text: 'x' }, { sessionId: 's1', agent: null });
  assert.equal(t.calls.length, before);
});

test('/sync on 后，EnsoCode 里的输入和回复都同步过来；插件注入的消息不重复', async () => {
  const t = await setup();
  await t.pair();
  t.message('/sync on');
  await runPoll(t);
  await t.handlers.events.input({ text: '本地提问', source: 'interactive' }, { sessionId: 's1', agent: null });
  await t.handlers.events.input({ text: '注入', source: 'extension' }, { sessionId: 's1', agent: null });
  await t.handlers.events.agent_end({ text: '本地回答' }, { sessionId: 's1', agent: null });
  const texts = t.of('sendMessage').map((c) => c.body.text);
  assert.ok(texts.includes('💬 EnsoCode：本地提问'));
  assert.ok(texts.includes('本地回答'));
  assert.ok(!texts.some((x) => x.includes('注入')));
});

test('图片：先 getFile 再以 base64 下载，随文字注入会话', async () => {
  const t = await setup();
  await t.pair();
  t.message(undefined, { photo: [{ file_id: 'F1', file_size: 100 }], caption: '这是啥' });
  await runPoll(t);
  const download = t.calls.find((c) => c.method === 'download');
  assert.match(download.url, /\/file\/botT\/photos\/F1\.jpg$/);
  assert.equal(download.init.responseType, 'base64');
  assert.deepEqual(t.injected[0].images, [{ data: 'iVBORw0K', mimeType: 'image/jpeg' }]);
  assert.match(t.injected[0].text, /这是啥$/);
});

test('/stop 中止会话；失败时说明原因', async () => {
  const t = await setup();
  await t.pair();
  t.message('/stop');
  await runPoll(t);
  assert.deepEqual(t.injected.at(-1), { abort: 's1' });
  assert.match(t.of('sendMessage').at(-1).body.text, /已停止/);

  const f = await setup({ injectError: 'x' });
  await f.pair();
  f.message('/stop');
  await runPoll(f);
  assert.match(f.of('sendMessage').at(-1).body.text, /没有正在运行/);
});

test('侧栏：未配置时提示；生成配对码带 t.me 链接；列出绑定，可开关同步与解绑', async () => {
  const t = await setup();
  assert.equal((await t.handlers.renderer.state({}, { sessionId: null })).configured, true);
  await assert.rejects(t.handlers.renderer.pair({}, { sessionId: null }), /打开一个会话/);
  const paired = await t.handlers.renderer.pair({}, { sessionId: 's1::child' });
  assert.equal(paired.bot.username, 'enso_bot');
  assert.equal(paired.pairing.link, `https://t.me/enso_bot?start=${paired.pairing.code}`);
  t.message(`/start ${paired.pairing.code}`);
  await runPoll(t);
  let view = await t.handlers.renderer.state({}, { sessionId: 's1' });
  assert.equal(view.pairing, undefined);
  assert.equal(view.bindings.length, 1);
  view = await t.handlers.renderer.sync({ chatId: 42, on: true }, { sessionId: 's1' });
  assert.equal(view.bindings[0].sync, true);
  assert.equal((await t.handlers.renderer.state({}, { sessionId: 's2' })).others, 1);
  await t.handlers.renderer.unbind({ chatId: 42 }, { sessionId: 's2' });
  view = await t.handlers.renderer.unbind({ chatId: 42 }, { sessionId: 's1' });
  assert.equal(view.bindings.length, 0);
  assert.match(t.of('sendMessage').at(-1).body.text, /已在 EnsoCode 里解绑/);
  await t.handlers.renderer.open({ url: 'https://evil.com' });
  await t.handlers.renderer.open({ url: paired.pairing.link });
  assert.deepEqual(t.opened, [paired.pairing.link]);
});
