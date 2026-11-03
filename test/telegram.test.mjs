import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bindChat,
  chunkText,
  createPairing,
  emptyState,
  inboundText,
  markdownToHtml,
  markPending,
  mirrorTargets,
  rootSession,
  route,
  takeReply,
} from '../packages/enso.telegram/lib.mjs';

const BOT = { id: 99, username: 'enso_bot' };
const msg = (text, chatId = 42, extra = {}) => ({
  update_id: 1,
  message: {
    message_id: 5,
    chat: { id: chatId, type: 'private' },
    from: { id: 7, username: 'alice' },
    text,
    ...extra,
  },
});
const group = (text, extra = {}) =>
  msg(text, -100, { chat: { id: -100, type: 'supergroup', title: 'G' }, ...extra });
const bound = (patch = {}) => {
  const state = emptyState();
  bindChat(state, { chatId: 42, sessionId: 's1', ...patch });
  return state;
};

test('长文本按 4000 字切块，优先断在换行', () => {
  const parts = chunkText(`${'a'.repeat(3990)}\n${'b'.repeat(100)}`, 4000);
  assert.deepEqual(parts, ['a'.repeat(3990), 'b'.repeat(100)]);
  assert.deepEqual(chunkText('', 4000), []);
  assert.ok(chunkText('x'.repeat(9000), 4000).every((p) => p.length <= 4000));
});

test('Markdown 转 Telegram HTML：转义、代码、粗斜体、链接、标题、引用', () => {
  assert.equal(markdownToHtml('a < b & c'), 'a &lt; b &amp; c');
  assert.equal(markdownToHtml('**粗** *斜* ~~删~~'), '<b>粗</b> <i>斜</i> <s>删</s>');
  assert.equal(markdownToHtml('用 `a<b>` 吧'), '用 <code>a&lt;b&gt;</code> 吧');
  assert.equal(
    markdownToHtml('```js\nif (a < 1) **x**\n```'),
    '<pre><code class="language-js">if (a &lt; 1) **x**</code></pre>'
  );
  assert.equal(
    markdownToHtml('[文档](https://x.y/?a=1&b=2)'),
    '<a href="https://x.y/?a=1&amp;b=2">文档</a>'
  );
  assert.equal(markdownToHtml('[坏](javascript:alert(1))'), '[坏](javascript:alert(1))');
  assert.equal(markdownToHtml('## 标题\n> 引用'), '<b>标题</b>\n<blockquote>引用</blockquote>');
  assert.equal(markdownToHtml('snake_case_name 2*3*4'), 'snake_case_name 2*3*4');
});

test('未配对的聊天被忽略，错误配对码被拒', () => {
  const state = emptyState();
  assert.deepEqual(route(state, msg('rm -rf /'), 1000, BOT), { kind: 'ignore' });
  assert.equal(route(state, msg('/bind 123456'), 1000, BOT).kind, 'reply');
  assert.equal(state.bindings.length, 0);
});

test('配对码一次有效、过期失效；配对后消息投到绑定的会话', () => {
  const state = emptyState();
  const code = createPairing(state, 's1', 1000, () => 0.5);
  assert.match(code, /^\d{6}$/);
  assert.equal(route(state, msg(`/bind ${code}`), 1000 + 11 * 60_000, BOT).kind, 'reply');
  const fresh = createPairing(state, 's1', 2000, () => 0.5);
  assert.equal(route(state, msg(`/bind ${fresh}`), 2000, BOT).kind, 'bound');
  assert.equal(state.pairings.length, 0);
  assert.deepEqual(state.bindings[0], {
    chatId: 42,
    chatType: 'private',
    title: 'alice',
    sessionId: 's1',
    sync: false,
  });
  assert.deepEqual(route(state, msg('你好'), 3000, BOT), {
    kind: 'inject',
    chatId: 42,
    sessionId: 's1',
    text: '你好',
    from: 'alice',
    messageId: 5,
    deliverAs: 'followUp',
  });
});

test('群聊只响应 @机器人 或回复机器人，并去掉 @', () => {
  const state = emptyState();
  bindChat(state, { chatId: -100, sessionId: 's1' });
  assert.deepEqual(route(state, group('大家好'), 0, BOT), { kind: 'ignore' });
  assert.equal(route(state, group('@enso_bot 看下日志'), 0, BOT).text, '看下日志');
  const reply = group('继续', { reply_to_message: { from: { id: 99 } } });
  assert.equal(route(state, reply, 0, BOT).text, '继续');
  assert.equal(route(state, group('/status@enso_bot'), 0, BOT).kind, 'reply');
  assert.deepEqual(route(state, group('/status@other_bot'), 0, BOT), { kind: 'ignore' });
});

test('/steer 插话，/sync 开关同步，/unbind 解绑，/help 和 /status 回复', () => {
  const state = bound();
  assert.equal(route(state, msg('/steer 改用 pnpm'), 0, BOT).deliverAs, 'steer');
  assert.equal(route(state, msg('/steer 改用 pnpm'), 0, BOT).text, '改用 pnpm');
  assert.equal(route(state, msg('/steer'), 0, BOT).kind, 'reply');
  route(state, msg('/sync on'), 0, BOT);
  assert.equal(state.bindings[0].sync, true);
  route(state, msg('/sync off'), 0, BOT);
  assert.equal(state.bindings[0].sync, false);
  assert.match(route(state, msg('/help'), 0, BOT).text, /\/steer/);
  assert.match(route(state, msg('/status'), 0, BOT).text, /s1/);
  assert.equal(route(state, msg('/unbind'), 0, BOT).kind, 'reply');
  assert.equal(state.bindings.length, 0);
});

test('图片：取 5MB 内最大尺寸并带说明；超限、文件和语音给出提示', () => {
  const state = bound();
  const photo = [
    { file_id: 's', file_size: 1000 },
    { file_id: 'm', file_size: 90_000 },
    { file_id: 'xl', file_size: 6 * 1024 * 1024 },
  ];
  const routed = route(state, msg(undefined, 42, { photo, caption: '看这个' }), 0, BOT);
  assert.equal(routed.kind, 'inject');
  assert.equal(routed.text, '看这个');
  assert.deepEqual(routed.image, { fileId: 'm', mimeType: 'image/jpeg' });
  assert.equal(route(state, msg(undefined, 42, { photo: [photo[0]] }), 0, BOT).text, '（用户发来一张图片）');
  const big = msg(undefined, 42, { photo: [photo[2]] });
  assert.match(route(state, big, 0, BOT).text, /5MB/);
  const png = { file_id: 'd', mime_type: 'image/png', file_size: 10 };
  assert.deepEqual(route(state, msg('图', 42, { document: png }), 0, BOT).image, {
    fileId: 'd',
    mimeType: 'image/png',
  });
  const pdf = { file_id: 'p', mime_type: 'application/pdf' };
  assert.equal(route(state, msg(undefined, 42, { document: pdf }), 0, BOT).kind, 'reply');
  assert.equal(route(state, msg(undefined, 42, { voice: {} }), 0, BOT).kind, 'reply');
  assert.deepEqual(route(state, msg(undefined, 42), 0, BOT), { kind: 'ignore' });
});

test('/stop 停止绑定的会话', () => {
  assert.deepEqual(route(bound(), msg('/stop'), 0, BOT), { kind: 'stop', chatId: 42, sessionId: 's1' });
  assert.deepEqual(route(emptyState(), msg('/stop'), 0, BOT), { kind: 'ignore' });
});
test('Telegram 发起的轮次结束时回发到占位消息，取出后清除；空回复保留待回', () => {
  const state = emptyState();
  assert.equal(takeReply(state, 's1', '答'), null);
  markPending(state, 's1', { chatId: 42, placeholderId: 8 });
  markPending(state, 's1::child', { chatId: 42, placeholderId: 9 });
  assert.equal(takeReply(state, 's2', '答'), null);
  assert.equal(takeReply(state, 's1', '  '), null);
  assert.deepEqual(takeReply(state, 's1', '答'), {
    targets: [{ chatId: 42, placeholderId: 9 }],
    text: '答',
  });
  assert.equal(takeReply(state, 's1', '再答'), null);
});

test('同步：只发给开启 sync 的绑定，且排除本轮已回发的聊天', () => {
  const state = emptyState();
  bindChat(state, { chatId: 1, sessionId: 's1', sync: true });
  bindChat(state, { chatId: 2, sessionId: 's1', sync: false });
  bindChat(state, { chatId: 3, sessionId: 's2', sync: true });
  assert.deepEqual(mirrorTargets(state, 's1::x', [1]), []);
  assert.deepEqual(mirrorTargets(state, 's1', []), [1]);
});

test('子会话归到主会话；投递文本带来源', () => {
  assert.equal(rootSession('main::child'), 'main');
  assert.equal(inboundText({ from: 'alice', text: 'hi' }), '[Telegram 消息，来自 alice]\n\nhi');
});

test('深链 /start <配对码> 等同 /bind', () => {
  const state = emptyState();
  const code = createPairing(state, 's1', 0, () => 0.25);
  assert.equal(route(state, msg(`/start ${code}`), 0, BOT).kind, 'bound');
  assert.equal(state.bindings[0].sessionId, 's1');
  assert.equal(route(emptyState(), msg('/start 999999'), 0, BOT).kind, 'reply');
});
