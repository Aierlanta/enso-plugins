import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CLIENT_ID = 'Ov23liudxhEHEczTvPcC';
const API = 'https://api.github.com';
const GH_PATHS = ['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh'];
const MAX_BODY = 65536;

const run = (bin, args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err = (err + d).slice(-1000)));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `退出码 ${code}`))));
  });

/** 支持 https / ssh / git@ 形式的 github.com 远程地址 */
export function parseRemote(url) {
  const m = /github\.com[:/]+([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(String(url ?? '').trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function activate(enso) {
  const file = join(enso.dataDir, 'auth.json');
  let auth = null; // { token, login }
  let ghToken; // undefined 未探测；null 没有
  let pending = null; // { userCode, uri, expiresAt }
  let loginError = '';

  const loaded = readFile(file, 'utf8')
    .then((s) => {
      const a = JSON.parse(s);
      auth = a?.token ? a : null;
    })
    .catch(() => {});
  const saveAuth = async (next) => {
    auth = next;
    if (!next) return rm(file, { force: true });
    await mkdir(enso.dataDir, { recursive: true });
    await writeFile(file, JSON.stringify(next), { mode: 0o600 });
  };

  const ghAuthToken = async () => {
    if (ghToken !== undefined) return ghToken;
    for (const bin of GH_PATHS) {
      try {
        return (ghToken = (await run(bin, ['auth', 'token', '--hostname', 'github.com'])) || null);
      } catch {}
    }
    return (ghToken = null);
  };

  /** 优先级：设备登录 → 设置里的 PAT → 环境变量 → gh auth token */
  const credential = async () => {
    await loaded;
    if (auth?.token) return { token: auth.token, source: 'device' };
    const { token } = (await enso.config.get()) ?? {};
    if (token) return { token, source: 'config' };
    const env = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (env) return { token: env, source: 'env' };
    const gh = await ghAuthToken();
    return gh ? { token: gh, source: 'gh' } : null;
  };

  const call = async (method, path, body, accept = 'application/vnd.github+json') => {
    const cred = await credential();
    if (!cred) throw new Error('未登录 GitHub：在 GitHub 面板里登录，或安装 gh 并执行 gh auth login');
    const res = await enso.net.fetch(`${API}${path}`, {
      method,
      headers: {
        accept,
        authorization: `Bearer ${cred.token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'enso-github',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = res.body ? JSON.parse(res.body) : null;
    } catch {}
    if (res.status === 401) {
      if (cred.source === 'device') await saveAuth(null);
      if (cred.source === 'gh') ghToken = undefined;
    }
    if (res.status >= 400) throw new Error(`GitHub ${res.status}：${data?.message ?? '请求失败'}`);
    return data;
  };

  const post = async (url, params) => {
    const res = await enso.net.fetch(url, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'enso-github' },
      body: JSON.stringify({ client_id: CLIENT_ID, ...params }),
    });
    try {
      return JSON.parse(res.body);
    } catch {
      throw new Error(`GitHub 返回 HTTP ${res.status}`);
    }
  };

  const poll = async (deviceCode, interval, expiresAt) => {
    while (pending && Date.now() < expiresAt) {
      await sleep(interval * 1000);
      if (!pending) return;
      try {
        const r = await post('https://github.com/login/oauth/access_token', {
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        });
        if (r.access_token) {
          await saveAuth({ token: r.access_token });
          pending = null;
          const me = await call('GET', '/user').catch(() => null);
          if (me?.login) await saveAuth({ token: r.access_token, login: me.login });
          return;
        }
        if (r.error === 'slow_down') interval = r.interval ?? interval + 5;
        else if (r.error !== 'authorization_pending') throw new Error(r.error_description ?? r.error);
      } catch (e) {
        loginError = e.message;
        pending = null;
        return;
      }
    }
    if (pending) loginError = '验证码已过期，请重新登录';
    pending = null;
  };

  const login = async () => {
    const r = await post('https://github.com/login/device/code', { scope: 'repo' });
    if (!r.device_code) throw new Error(r.error_description ?? r.error ?? '无法发起登录');
    const expiresAt = Date.now() + r.expires_in * 1000;
    pending = { userCode: r.user_code, uri: r.verification_uri, expiresAt };
    loginError = '';
    poll(r.device_code, r.interval ?? 5, expiresAt);
    await enso.ui.openExternal(r.verification_uri).catch(() => {});
    return pending;
  };

  const repoOf = async (args, ctx) => {
    const given = String(args?.repo ?? '').trim();
    if (given) {
      if (!/^[\w.-]+\/[\w.-]+$/.test(given)) throw new Error(`repo 格式应为 owner/name：${given}`);
      return given;
    }
    if (!ctx?.projectRoot) throw new Error('没有打开项目，请指定 repo（owner/name）');
    const url = await run('git', ['remote', 'get-url', 'origin'], ctx.projectRoot).catch(() => '');
    const repo = parseRemote(url);
    if (!repo) throw new Error('当前项目的 origin 不是 GitHub 仓库，请指定 repo（owner/name）');
    return repo;
  };
  const num = (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new Error('number 必须是正整数');
    return n;
  };

  const brief = (i, pr) => ({
    number: i.number,
    title: i.title,
    state: i.state,
    pr: Boolean(pr || i.pull_request),
    draft: Boolean(i.draft),
    author: i.user?.login,
    labels: (i.labels ?? []).map((l) => l.name),
    comments: i.comments,
    updatedAt: i.updated_at,
    url: i.html_url,
  });

  const list = async (args, ctx) => {
    const repo = await repoOf(args, ctx);
    const state = ['open', 'closed', 'all'].includes(args?.state) ? args.state : 'open';
    const pr = args?.kind === 'pr';
    const items = await call('GET', `/repos/${repo}/${pr ? 'pulls' : 'issues'}?state=${state}&per_page=50&sort=updated&direction=desc`);
    return { repo, items: items.filter((i) => pr || !i.pull_request).map((i) => brief(i, pr)) };
  };

  /** html 为 true 时附带 GitHub 渲染好的 body_html，供面板显示 */
  const view = async (args, ctx, html = false) => {
    const repo = await repoOf(args, ctx);
    const n = num(args?.number);
    const accept = html ? 'application/vnd.github.full+json' : undefined;
    const [issue, comments] = await Promise.all([
      call('GET', `/repos/${repo}/issues/${n}`, null, accept),
      call('GET', `/repos/${repo}/issues/${n}/comments?per_page=100`, null, accept),
    ]);
    const out = { repo, ...brief(issue), body: issue.body ?? '', stateReason: issue.state_reason ?? null };
    if (html) out.bodyHtml = issue.body_html ?? '';
    if (issue.pull_request) {
      const p = await call('GET', `/repos/${repo}/pulls/${n}`);
      Object.assign(out, {
        draft: p.draft,
        merged: p.merged,
        head: p.head?.label,
        base: p.base?.ref,
        changes: { files: p.changed_files, additions: p.additions, deletions: p.deletions },
      });
    }
    out.commentList = comments.map((c) => ({
      author: c.user?.login,
      createdAt: c.created_at,
      body: c.body ?? '',
      ...(html ? { bodyHtml: c.body_html ?? '' } : {}),
    }));
    return out;
  };

  const comment = async (args, ctx) => {
    const repo = await repoOf(args, ctx);
    const body = String(args?.body ?? '').trim().slice(0, MAX_BODY);
    if (!body) throw new Error('body 不能为空');
    const c = await call('POST', `/repos/${repo}/issues/${num(args?.number)}/comments`, { body });
    return { url: c.html_url };
  };

  const setState = async (args, ctx) => {
    const repo = await repoOf(args, ctx);
    const n = num(args?.number);
    const state = args?.state === 'open' ? 'open' : 'closed';
    if (String(args?.comment ?? '').trim()) await comment({ repo, number: n, body: args.comment });
    const issue = await call('GET', `/repos/${repo}/issues/${n}`);
    if (issue.pull_request) await call('PATCH', `/repos/${repo}/pulls/${n}`, { state });
    else {
      const reason = state === 'open' ? 'reopened' : args?.reason === 'not_planned' ? 'not_planned' : 'completed';
      await call('PATCH', `/repos/${repo}/issues/${n}`, { state, state_reason: reason });
    }
    return { repo, number: n, state, pr: Boolean(issue.pull_request) };
  };

  enso.tools.register('github_list', list);
  enso.tools.register('github_view', (args, ctx) => view(args, ctx));
  enso.tools.register('github_comment', comment);
  enso.tools.register('github_set_state', setState);

  enso.renderer.handle('state', async (_args, ctx) => {
    const cred = await credential();
    let repo = null;
    if (ctx?.projectRoot) repo = parseRemote(await run('git', ['remote', 'get-url', 'origin'], ctx.projectRoot).catch(() => ''));
    return { source: cred?.source ?? null, login: auth?.login ?? null, pending, error: loginError, repo };
  });
  enso.renderer.handle('login', login);
  enso.renderer.handle('cancelLogin', () => ((pending = null), null));
  enso.renderer.handle('logout', async () => {
    await saveAuth(null);
    return null;
  });
  enso.renderer.handle('list', list);
  enso.renderer.handle('view', (args, ctx) => view(args, ctx, true));
  enso.renderer.handle('comment', comment);
  enso.renderer.handle('setState', setState);
  enso.renderer.handle('open', async (args) => {
    const url = String(args?.url ?? '');
    if (/^https?:\/\//.test(url)) await enso.ui.openExternal(url);
    return null;
  });
}
