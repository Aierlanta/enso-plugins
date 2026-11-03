import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activate, parseRemote } from '../packages/enso.github/main.mjs';

test('parseRemote 识别 github 远程地址', () => {
  assert.equal(parseRemote('git@github.com:J3n5en/enso-plugins.git'), 'J3n5en/enso-plugins');
  assert.equal(parseRemote('https://github.com/a/b.c\n'), 'a/b.c');
  assert.equal(parseRemote('ssh://git@github.com/a/b'), 'a/b');
  assert.equal(parseRemote('https://gitlab.com/a/b.git'), null);
});

async function setup(routes) {
  const calls = [];
  const tools = {};
  const handlers = {};
  activate({
    dataDir: await mkdtemp(join(tmpdir(), 'gh-test-')),
    config: { get: async () => ({ token: 'pat' }) },
    net: {
      fetch: async (url, init) => {
        calls.push({ url, method: init.method, auth: init.headers.authorization, body: init.body && JSON.parse(init.body) });
        const key = `${init.method} ${url.replace('https://api.github.com', '')}`;
        const hit = Object.entries(routes).find(([k]) => key.startsWith(k));
        return hit ? { status: 200, body: JSON.stringify(hit[1]) } : { status: 404, body: '{"message":"Not Found"}' };
      },
    },
    ui: { openExternal: async () => {} },
    tools: { register: (n, fn) => (tools[n] = fn) },
    renderer: { handle: (n, fn) => (handlers[n] = fn) },
  });
  return { calls, tools, handlers };
}

test('list 过滤掉 issues 接口里的 PR，并带上 PAT', async () => {
  const { calls, tools } = await setup({
    'GET /repos/o/r/issues?': [
      { number: 1, title: 'bug', state: 'open', user: { login: 'u' }, labels: [{ name: 'x' }] },
      { number: 2, title: 'pr', state: 'open', pull_request: {} },
    ],
  });
  const r = await tools.github_list({ repo: 'o/r' });
  assert.deepEqual(r.items.map((i) => i.number), [1]);
  assert.equal(r.items[0].labels[0], 'x');
  assert.equal(calls[0].auth, 'Bearer pat');
});

test('关闭 PR 走 pulls 接口，先发评论', async () => {
  const { calls, tools } = await setup({
    'POST /repos/o/r/issues/5/comments': { html_url: 'u' },
    'GET /repos/o/r/issues/5': { number: 5, pull_request: {} },
    'PATCH /repos/o/r/pulls/5': {},
  });
  const r = await tools.github_set_state({ repo: 'o/r', number: 5, state: 'closed', comment: 'bye' });
  assert.equal(r.pr, true);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url.slice(22)}`), [
    'POST /repos/o/r/issues/5/comments',
    'GET /repos/o/r/issues/5',
    'PATCH /repos/o/r/pulls/5',
  ]);
  assert.deepEqual(calls[2].body, { state: 'closed' });
});

test('关闭 issue 带 state_reason；非法 repo 报错', async () => {
  const { calls, tools } = await setup({ 'GET /repos/o/r/issues/3': { number: 3 }, 'PATCH /repos/o/r/issues/3': {} });
  await tools.github_set_state({ repo: 'o/r', number: 3, state: 'closed', reason: 'not_planned' });
  assert.deepEqual(calls.at(-1).body, { state: 'closed', state_reason: 'not_planned' });
  await assert.rejects(tools.github_list({ repo: 'bad' }), /owner\/name/);
});
