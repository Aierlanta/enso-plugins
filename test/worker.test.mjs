import assert from 'node:assert/strict';
import test from 'node:test';
import { handle } from '../worker/src/index.js';

function bucket(files) {
  const keys = [];
  return {
    keys,
    env: {
      BUCKET: {
        async get(key) {
          keys.push(key);
          const body = files.get(key);
          if (!body) return null;
          return { body, size: body.length, httpEtag: '"abc"' };
        },
      },
    },
  };
}

const ctx = { waitUntil() {} };

test('索引、包和非法路径', async () => {
  const files = new Map([
    ['v1/index.json', Buffer.from('{"schemaVersion":1}')],
    ['v1/index.json.sig', Buffer.from('sig')],
    ['v1/packages/enso.example.notes/1.0.0.zip', Buffer.from('PK')],
  ]);
  const { env, keys } = bucket(files);
  const index = await handle(new Request('https://plugins.example/v1/index.json'), env, ctx);
  assert.equal(index.status, 200);
  assert.equal(index.headers.get('cache-control'), 'public, max-age=300');
  assert.equal(index.headers.get('etag'), '"abc"');
  assert.equal(await index.text(), '{"schemaVersion":1}');

  const zip = await handle(new Request('https://plugins.example/v1/packages/enso.example.notes/1.0.0.zip'), env, ctx);
  assert.equal(zip.status, 200);
  assert.equal(zip.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(zip.headers.get('content-type'), 'application/zip');

  const missing = await handle(new Request('https://plugins.example/v1/packages/enso.example.notes/9.9.9.zip'), env, ctx);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('cache-control'), 'no-store');

  for (const path of [
    '/v1/packages/../secret.zip',
    '/v1/packages/enso.example.notes/%2e%2e/%2e%2e/secret.zip',
    '/v1/packages/enso.example.notes/1.0.0.zip/../../index.json',
    '/v1/nope',
  ]) {
    const before = keys.length;
    const response = await handle(new Request(`https://plugins.example${path}`), env, ctx);
    assert.equal(response.status, 404, path);
    assert.equal(keys.length, before, path);
  }
  assert.equal((await handle(new Request('https://plugins.example/v1/index.json', { method: 'POST' }), env, ctx)).status, 404);
  assert.deepEqual(keys.filter((key) => key.includes('..')), []);
});

test('配置源站时：索引成对取自源站并写回 R2；包缺失时回源写入；源站不可用回落 R2', async () => {
  const original = globalThis.fetch;
  const origin = new Map([
    ['https://o.example/v1/index.json', 'NEW'],
    ['https://o.example/v1/index.json.sig', 'NEWSIG'],
    ['https://o.example/v1/packages/enso.a/1.0.0.zip', 'PKA'],
  ]);
  const put = new Map();
  const waits = [];
  const c = { waitUntil: (p) => waits.push(p) };
  const env = {
    ORIGIN: 'https://o.example/',
    BUCKET: {
      async get(key) {
        const body = put.get(key) ?? (key === 'v1/index.json' ? 'OLD' : null);
        return body ? { body, size: body.length } : null;
      },
      async put(key, value) {
        put.set(key, Buffer.from(value).toString());
      },
    },
  };
  try {
    globalThis.fetch = async (url) => {
      const body = origin.get(String(url));
      return body ? new Response(body) : new Response('no', { status: 404 });
    };
    assert.equal(await (await handle(new Request('https://p/v1/index.json'), env, c)).text(), 'NEW');
    assert.equal(await (await handle(new Request('https://p/v1/packages/enso.a/1.0.0.zip'), env, c)).text(), 'PKA');
    await Promise.all(waits);
    assert.equal(put.get('v1/index.json.sig'), 'NEWSIG');
    assert.equal(put.get('v1/packages/enso.a/1.0.0.zip'), 'PKA');
    globalThis.fetch = async () => {
      throw new Error('down');
    };
    assert.equal(await (await handle(new Request('https://p/v1/index.json'), env, c)).text(), 'NEW');
    assert.equal((await handle(new Request('https://p/v1/packages/enso.b/1.0.0.zip'), env, c)).status, 404);
  } finally {
    globalThis.fetch = original;
  }
});

test('图标代理不转发请求头，并按状态缓存', async () => {
  const original = globalThis.fetch;
  const seen = [];
  try {
    globalThis.fetch = async (url, init) => {
      seen.push({ url: String(url), init });
      if (String(url).includes('missing')) return new Response('no', { status: 404 });
      if (String(url).includes('down')) return new Response('no', { status: 503 });
      if (String(url).includes('huge')) {
        return new Response('x', { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(2 * 1024 * 1024) } });
      }
      if (String(url).includes('html')) return new Response('<p>', { status: 200, headers: { 'content-type': 'text/html' } });
      if (String(url).includes('jump')) {
        return new Response(null, { status: 302, headers: { location: 'http://evil.example/a.png' } });
      }
      return new Response(Uint8Array.from([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png; charset=binary' } });
    };
    const ok = await handle(
      new Request('https://plugins.example/v1/icon?url=https://cdn.example/a.png', {
        headers: { authorization: 'secret', cookie: 'a=b' },
      }),
      {},
      ctx,
    );
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'image/png');
    assert.equal(ok.headers.get('cache-control'), 'public, max-age=86400');
    assert.deepEqual(Object.keys(seen[0].init.headers), ['accept']);
    assert.equal(seen[0].init.headers.accept, 'image/*');

    const missing = await handle(new Request('https://plugins.example/v1/icon?url=https://cdn.example/missing.png'), {}, ctx);
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('cache-control'), 'public, max-age=300');
    const down = await handle(new Request('https://plugins.example/v1/icon?url=https://cdn.example/down.png'), {}, ctx);
    assert.equal(down.status, 502);
    assert.equal(down.headers.get('cache-control'), 'no-store');
    assert.equal((await handle(new Request('https://plugins.example/v1/icon?url=http://cdn.example/a.png'), {}, ctx)).status, 400);
    assert.equal((await handle(new Request('https://plugins.example/v1/icon?url=https://cdn.example/huge.png'), {}, ctx)).status, 413);
    assert.equal((await handle(new Request('https://plugins.example/v1/icon?url=https://cdn.example/html'), {}, ctx)).status, 415);
    assert.equal((await handle(new Request('https://plugins.example/v1/icon?url=https://cdn.example/jump'), {}, ctx)).status, 400);

    const branch = 'https://cdn.jsdelivr.net/gh/J3n5en/enso-plugins@main/registry/icons/enso.kanban.svg';
    const fresh = await handle(new Request(`https://plugins.example/v1/icon?url=${encodeURIComponent(branch)}`), {}, ctx);
    assert.equal(fresh.headers.get('cache-control'), 'public, max-age=300');
    assert.equal(new URL(seen.at(-1).url).searchParams.get('enso-rev'), '2');
  } finally {
    globalThis.fetch = original;
  }
});
