# Enso 插件仓库

官方插件市场的源。社区用 Pull Request 提交插件；合并到 `main` 后，CI 打包、签名，并把同一份目录发到 `dist` 分支和 Cloudflare R2。客户端不信任任何一个分发节点，只验 Ed25519 签名和 zip 的 sha256。

索引由客户端解析（`schemaVersion: 1`）。`path` 相对 `v1/`，例如 `packages/<id>/<version>.zip`。`sequence` 每次发布加 1，用来拒绝回滚。

## 目录

```text
packages/<id>/enso-plugin.json   插件本体，目录名必须等于清单 id
registry/meta/<id>.json          tier、tags、homepage、icon（不进清单）
scripts/                         校验、打包、签名
worker/                          只读分发
out/v1/                          本地构建产物，不提交
```

仓库里先放了两个示例：`enso.example.notes`、`enso.example.wordstats`（来自 EnsoCode `examples/plugins`），`tier` 为 `official`。

## 贡献插件

1. 在 `packages/<id>/` 放入带 `enso-plugin.json` 的目录。依赖必须已经打进目录里（安装时不会 `npm install`）。
2. 可选：加 `registry/meta/<id>.json`。

```json
{ "tier": "community", "tags": ["ui"], "homepage": "https://example.com", "icon": "icon.png" }
```

`tier` 只能是 `official` 或 `community`。不写元数据时按 `community`。`icon` 可以是相对路径，或 `https` 图片（客户端经 Worker `/v1/icon` 拉取）。

3. 本地检查：

```bash
node scripts/validate.mjs
node --test
```

4. 开 PR 到 `main`。CI 会校验，并把权限变更摘要写到 PR 评论。

## 审核规则

- `id` 匹配 `^[a-z][a-z0-9]*(\.[a-z0-9]+)+$`，不超过 40 字符，且等于目录名。
- `version` 是不带 `v` 前缀、不带构建元数据的 semver。已经发布的 `<id>@<version>` 内容不能改；要改就升版本。
- 插件不超过 5000 个文件、合计 200MB。禁止 `.node` 和符号链接。
- 清单 `schemaVersion` 为 1。声明了 `engines.enso` 时只能是 `>=x.y.z`。
- 权限、文件范围、域名、MCP 工具、环境变量、可调用插件、拦截事件、是否常驻，有变化就会出现在 PR 评论里，供维护者确认。安装时仍以包内清单为准。
- `tier` 只有维护者能改。CI 用 `ENSO_COMMUNITY_PR=true` 标记社区 PR（作者不是 `OWNER` / `MEMBER`）。社区 PR 把 `tier` 改成另一个值，或把新插件标成 `official`，都会失败。

## 本地发布演练

```bash
node scripts/keygen.mjs --private-out market-key.pem   # 公钥打到 stdout，私钥写入文件
node scripts/build.mjs                                 # out/v1/index.json 与 zip
ENSO_MARKET_PRIVATE_KEY="$(cat market-key.pem)" node scripts/sign.mjs
```

已有 `out/v1/index.json`（或 git 的 `dist` / `origin/dist` 上的 `v1/index.json`）时，build 会合并历史版本，`sequence` 取旧值加 1。同一版本 sha256、大小或路径不同则失败。可用 `ENSO_INDEX_TIME` 固定 `generatedAt`（ISO 时间）。

签名是对 `index.json` 原始字节做 Ed25519，base64 写入 `index.json.sig`。私钥是 PKCS8 PEM；GitHub secret 里可以把换行写成 `\n`。

## 发布流程

PR 合并到 `main` 后，`.github/workflows/publish.yml`：

1. 若已有 `dist` 分支，先取出其中的 `v1/`（保留历史 zip 和索引）。
2. `build` + `sign`。
3. 把 `out/v1` 提交并推到 `dist`（与 R2 相同的目录：`v1/index.json`、`v1/index.json.sig`、`v1/packages/<id>/<version>.zip`）。
4. 用 `wrangler r2 object put` 上传到 R2。

客户端内置公钥，源可以是 Worker、jsDelivr 或 GitHub raw，内容必须对得上同一份签名。

### Secrets

| 名称 | 用途 |
| --- | --- |
| `ENSO_MARKET_PRIVATE_KEY` | Ed25519 PKCS8 PEM，只放在 GitHub Actions |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账号 |
| `CLOUDFLARE_API_TOKEN` | 具备目标 R2 桶写权限的 token |
| `R2_BUCKET` | 桶名，需与 `worker/wrangler.toml` 里的 `bucket_name` 一致 |

推送 `dist` 用工作流自带的 `GITHUB_TOKEN`（`contents: write`）。

密钥轮换：`keygen` 生成新密钥对，先让客户端同时信任新旧公钥，再换成新的 `ENSO_MARKET_PRIVATE_KEY` 发一版索引，确认客户端更新后移除旧公钥。不要把私钥提交进仓库。

## Worker

`worker/` 只读，从 R2 绑定 `BUCKET` 取对象。

| 路由 | 行为 |
| --- | --- |
| `GET /v1/index.json`、`/v1/index.json.sig` | `cache-control: public, max-age=300` |
| `GET /v1/packages/<id>/<version>.zip` | 一年 immutable，带 ETag。路径按 id 与 semver 校验 |
| `GET /v1/icon?url=` | 只代理 `https` 图片，不转发请求头，最大 1MB。200 缓存一天，404 五分钟，5xx 不缓存 |
| 其他 | 404 |

自定义域名尚未确定。在 `worker/` 执行 `npx wrangler deploy` 前，改好 `bucket_name` 和路由。
