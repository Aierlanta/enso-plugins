# GitHub

在侧栏查看、回复、关闭和重开当前项目的 GitHub issue 与 PR。会话里的 agent 也能通过工具做同样的操作。

需要 EnsoCode 0.2.14 及以上。

## 登录

插件按以下顺序找凭据，找到即用：

1. 侧栏里的设备码登录：点「登录」后自动打开 GitHub 授权页，输入页面上的代码即可。授权范围为 `repo`。
2. 设置 → 插件 → GitHub 填写的 Personal Access Token，需要 Issues 与 Pull requests 的读写权限。
3. 环境变量 `GH_TOKEN` 或 `GITHUB_TOKEN`。
4. 已登录的 gh CLI（`gh auth token`）。

设备码登录的 token 保存在插件数据目录（`auth.json`），可在侧栏退出登录。

## 使用

1. 打开侧栏「GitHub」。仓库默认取当前项目 git `origin` 指向的 GitHub 仓库，也可以手动填 `owner/name`。
2. 切换 Issues / PR，以及打开、已关闭、全部。列表按更新时间排序，最多 50 条。
3. 点开一条查看正文和评论；PR 还会显示分支、改动文件数和增删行数。
4. 在详情里可以回复（Markdown）、关闭（完成或不计划）、重新打开，或在浏览器中打开。

## Agent 工具

| 工具 | 作用 |
| --- | --- |
| `github_list` | 列出 issue 或 PR |
| `github_view` | 查看一条 issue 或 PR 及其评论 |
| `github_comment` | 发表评论 |
| `github_set_state` | 关闭或重新打开，可先附一条评论 |

`repo` 不填时使用当前项目的 `origin`。

## 权限

| 权限 | 用途 |
| --- | --- |
| `agent.tool` | 提供上面的 Agent 工具 |
| `net.fetch` | 访问 `github.com`（设备码登录）和 `api.github.com` |
| `ui.view` | 打开侧栏页面 |
| `ui.openExternal` | 打开授权页和 issue / PR 网页 |
