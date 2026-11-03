import assert from 'node:assert/strict';
import test from 'node:test';
import { activate, translate } from '../packages/enso.thinking.translate/main.mjs';
import { createQueue, segment } from '../packages/enso.thinking.translate/ui.js';

const PROMPT = '请将以下文本翻译为中文，直接输出翻译结果，不要进行任何解释。\n\n';

test('空行分段；围栏含空行仍是一段且不参与前后分段', () => {
  const text = ['This is English.', '', '```js', 'const a = 1;', '', 'const b = 2;', '```', '', 'tail'].join('\n');
  assert.deepEqual(segment(text, false), [
    { source: 'This is English.', kind: 'prose', final: true },
    { source: '```js\nconst a = 1;\n\nconst b = 2;\n```', kind: 'code', final: true },
    { source: 'tail', kind: 'prose', final: true },
  ]);
});

test('汉字占比过半的段跳过，未闭合围栏整段视为代码', () => {
  assert.deepEqual(segment('这是中文段落，不要翻译它。\n\nOK 好', false), [
    { source: '这是中文段落，不要翻译它。', kind: 'skip', final: true },
    { source: 'OK 好', kind: 'prose', final: true },
  ]);
  assert.deepEqual(segment('done\n\n```py\nprint(1)', false), [
    { source: 'done', kind: 'prose', final: true },
    { source: '```py\nprint(1)', kind: 'code', final: true },
  ]);
  assert.deepEqual(segment('  ```\n  中文\n  ```', false), [
    { source: '  ```\n  中文\n  ```', kind: 'code', final: true },
  ]);
});

test('流式时只有最后一段不是 final，结束后才 final', () => {
  const text = 'first\n\nsecond';
  assert.deepEqual(segment(text, true), [
    { source: 'first', kind: 'prose', final: true },
    { source: 'second', kind: 'prose', final: false },
  ]);
  assert.equal(segment(text, false).at(-1).final, true);
  assert.deepEqual(segment('', true), []);
  assert.deepEqual(segment('\n\n', false), []);
  assert.deepEqual(segment('a\r\n\r\nb', true), [
    { source: 'a', kind: 'prose', final: true },
    { source: 'b', kind: 'prose', final: false },
  ]);
});

function fakeEnso(fetch) {
  const handlers = {};
  const enso = {
    config: { get: async () => ({}) },
    net: { fetch },
    renderer: { handle: (name, fn) => (handlers[name] = fn) },
  };
  activate(enso);
  return { enso, handlers };
}

const okBody = (content) => ({
  status: 200,
  headers: {},
  body: JSON.stringify({ choices: [{ message: { content } }] }),
});

test('translate 提交指定请求体，并去掉 think 标记', async () => {
  const calls = [];
  const { enso, handlers } = fakeEnso(async (url, init) => {
    calls.push({ url, init });
    return okBody('<think>\n内部\n</think>\n\n译文结果');
  });
  enso.config.get = async () => ({ model: 'Index-Translate-9B' });
  const result = await handlers.translate({ text: 'Hello `code`' });
  assert.deepEqual(result, { text: '译文结果' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://index-translate.bilibili.com/v1/chat/completions');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    model: 'Index-Translate-9B',
    messages: [{ role: 'user', content: `${PROMPT}Hello \`code\`` }],
    temperature: 0,
    max_tokens: 2048,
    stream: false,
    chat_template_kwargs: { enable_thinking: false },
  });

  const plain = await translate(enso, 'Hi');
  assert.equal(plain.text, '译文结果');
  assert.equal(JSON.parse(calls[1].init.body).model, 'Index-Translate-9B');
});

test('未配置或未知模型时用 35B，没有 think 标记则原样 trim', async () => {
  const calls = [];
  const { enso, handlers } = fakeEnso(async (_url, init) => {
    calls.push(JSON.parse(init.body).model);
    return okBody('  直接译文  ');
  });
  assert.equal((await handlers.translate({ text: 'A' })).text, '直接译文');
  enso.config.get = async () => ({ model: 'not-a-model' });
  assert.equal((await handlers.translate({ text: 'B' })).text, '直接译文');
  assert.deepEqual(calls, ['Index-Translate-35B-A3B', 'Index-Translate-35B-A3B']);
});

test('非 200 视为失败', async () => {
  const { handlers } = fakeEnso(async () => ({ status: 503, headers: {}, body: 'nope' }));
  await assert.rejects(handlers.translate({ text: 'Hello' }), /503/);
});

test('队列并发不超过上限', async () => {
  let started = 0;
  let release;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  const queue = createQueue(3);
  const job = async () => {
    started += 1;
    await hold;
    return '好';
  };
  const pending = [1, 2, 3, 4].map(() => queue(job));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started, 3);
  release();
  const results = await Promise.all(pending);
  assert.equal(started, 4);
  assert.deepEqual(results, ['好', '好', '好', '好']);
});
