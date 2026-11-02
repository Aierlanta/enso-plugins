const ID_RE = /^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const MAX_ICON = 1024 * 1024;

function text(status, body, headers) {
  return new Response(body, { status, headers });
}

function packageKey(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\\') || decoded.split('/').includes('..')) return null;
  const match = /^\/v1\/packages\/([a-z][a-z0-9]*(?:\.[a-z0-9]+)+)\/([^/]+)\.zip$/.exec(decoded);
  if (!match || match[1].length > 40 || !ID_RE.test(match[1]) || !SEMVER_RE.test(match[2])) return null;
  return `v1/packages/${match[1]}/${match[2]}.zip`;
}

async function fromBucket(env, key, cacheControl, contentType) {
  const object = await env.BUCKET?.get(key);
  if (!object) return text(404, 'not found', { 'cache-control': 'no-store' });
  const headers = { 'content-type': contentType, 'cache-control': cacheControl };
  const etag = object.httpEtag || object.etag;
  if (etag) headers.etag = etag;
  if (Number.isSafeInteger(object.size)) headers['content-length'] = String(object.size);
  return new Response(object.body, { headers });
}

function allowedIconUrl(url) {
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number);
    if (parts.some((part) => part > 255)) return false;
    const [a, b] = parts;
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) {
      return false;
    }
  }
  if (host.includes(':') && (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80'))) {
    return false;
  }
  return true;
}

async function readLimited(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_ICON) return null;
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ICON) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchIcon(target) {
  let current = target;
  for (let hop = 0; hop < 3; hop++) {
    const init = { method: 'GET', redirect: 'manual', headers: { accept: 'image/*' } };
    if (globalThis.navigator?.userAgent === 'Cloudflare-Workers') {
      init.cf = { cacheEverything: true, cacheTtlByStatus: { '200-299': 86400, 404: 300, '500-599': -1 } };
    }
    const response = await fetch(current, init);
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    let next;
    try {
      next = new URL(location, current);
    } catch {
      return text(400, 'bad url', { 'cache-control': 'no-store' });
    }
    if (!allowedIconUrl(next)) return text(400, 'bad url', { 'cache-control': 'no-store' });
    current = next;
  }
  return text(502, 'bad gateway', { 'cache-control': 'no-store' });
}

async function proxyIcon(url, ctx) {
  const raw = url.searchParams.get('url');
  let target;
  try {
    target = raw ? new URL(raw) : null;
  } catch {
    target = null;
  }
  if (!target || !allowedIconUrl(target)) return text(400, 'bad url', { 'cache-control': 'no-store' });
  const cacheKey = new Request(url.origin + url.pathname + url.search, { method: 'GET' });
  const cache = globalThis.caches?.default;
  if (cache) {
    const hit = await cache.match(cacheKey).catch(() => undefined);
    if (hit) return hit;
  }
  const upstream = await fetchIcon(target);
  if (upstream.status >= 500) return text(502, 'bad gateway', { 'cache-control': 'no-store' });
  if (upstream.status === 404) {
    const missing = text(404, 'not found', { 'cache-control': 'public, max-age=300' });
    if (cache && ctx) ctx.waitUntil(cache.put(cacheKey, missing.clone()).catch(() => {}));
    return missing;
  }
  if (!upstream.ok) return text(upstream.status, 'bad gateway', { 'cache-control': 'no-store' });
  const type = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!type.startsWith('image/')) return text(415, 'not image', { 'cache-control': 'no-store' });
  const bytes = await readLimited(upstream);
  if (!bytes) return text(413, 'too large', { 'cache-control': 'no-store' });
  const response = new Response(bytes, {
    headers: { 'content-type': type, 'cache-control': 'public, max-age=86400' },
  });
  if (cache && ctx) ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(() => {}));
  return response;
}

export async function handle(request, env, ctx) {
  if (request.method !== 'GET') return text(404, 'not found');
  const url = new URL(request.url);
  if (url.pathname === '/v1/index.json') {
    return fromBucket(env, 'v1/index.json', 'public, max-age=300', 'application/json; charset=utf-8');
  }
  if (url.pathname === '/v1/index.json.sig') {
    return fromBucket(env, 'v1/index.json.sig', 'public, max-age=300', 'text/plain; charset=utf-8');
  }
  const key = packageKey(url.pathname);
  if (key) return fromBucket(env, key, 'public, max-age=31536000, immutable', 'application/zip');
  if (url.pathname === '/v1/icon') return proxyIcon(url, ctx);
  return text(404, 'not found');
}

export default { fetch: handle };
