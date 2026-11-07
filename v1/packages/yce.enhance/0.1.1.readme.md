# YCE Prompt Enhance for EnsoCode (`yce.enhance`)

基于 [EnsoCode](https://github.com/J3n5en/EnsoCode)（`>= 0.2.13`）扩展插件体系与 [dsh-bce](https://github.com/linqiu919/dsh-bce) 的零密钥架构实现：

- **凭证零驻留插件**：`YCE_RELAY_TOKEN`、`YCE_MCP_SKILL_ROOT` 等配置始终只保存在 EnsoCode 自己的 MCP 设置中，插件不存储、不读取任何密钥。
- **输入框一键增强**：在底部输入框左侧工具栏（`composer.left`）挂载 `Y✨` 按钮，调用宿主已配置的 `yce-mcp`（`yce_enhance` + `yce_read_result` 分页收据协议）将草稿改写为清晰、结构化的提示词。
- **未配置 MCP 时内置引导**：若尚未添加或启用 `yce-mcp`，状态胶囊会提示配置位置（`Settings → MCP`）并提供一键 **复制 MCP 配置** 按钮。
- **并发防覆盖与兜底**：写回时校验 Enso 草稿 `{ generation, rev }` 版本号；增强期间手动改动草稿不会误覆盖；连续多次增强可一键 **还原** 到最初原文；遇到文件/会话引用标签或超 32KB 草稿上限时提供 **复制增强结果** 兜底；自动传递 `no_task: true`，避免在发送前污染 `.yce/tasks/` 任务卡。
- **MCP 全能力协同**：在 EnsoCode 中配好 `yce-mcp` 后，输入框按钮负责发送前一键改写提示词，而会话中的 Agent 同时可以直接调用 `yce_search`、`yce_network_search`、`yce_plan`、`yce_task`、`yce_read_result` 等全部 MCP 工具。

---

## 1. 先在 EnsoCode 配置 `yce-mcp`

打开 **EnsoCode → Settings → MCP**，新增并启用 `yce` 服务（选择以下任一启动方式；如需获取 `YCE_RELAY_TOKEN` 可前往 [YCE 控制台](https://yce.aigy.de/console)）：

### 方式 A：通过 `npx --yes yce-mcp@latest` 启动（推荐）

```json
{
  "mcpServers": {
    "yce": {
      "command": "npx",
      "args": ["--yes", "yce-mcp@latest"],
      "env": {
        "YCE_RELAY_TOKEN": "你的 YCE Key",
        "YCE_TIMEOUT_NETWORK_MS": "90000",
        "YCE_TIMEOUT_SEARCH_MS": "90000",
        "YCE_TIMEOUT_ENHANCE_MS": "120000",
        "YCE_TIMEOUT_AUTO_ENHANCE_MS": "120000",
        "YCE_TIMEOUT_PLAN_MS": "300000"
      }
    }
  }
}
```

### 方式 B：使用本地已克隆的 [`YCE-enhance`](https://github.com/xiamuwnagwang/YCE-enhance) 仓库

```json
{
  "mcpServers": {
    "yce": {
      "command": "node",
      "args": ["/abs/path/to/YCE-enhance/mcp/src/index.mjs"],
      "env": {
        "YCE_RELAY_TOKEN": "你的 YCE Key",
        "YCE_TIMEOUT_NETWORK_MS": "90000",
        "YCE_TIMEOUT_SEARCH_MS": "90000",
        "YCE_TIMEOUT_ENHANCE_MS": "120000",
        "YCE_TIMEOUT_AUTO_ENHANCE_MS": "120000",
        "YCE_TIMEOUT_PLAN_MS": "300000"
      }
    }
  }
}
```

---

## 2. 安装与更新 EnsoCode 插件

打开 **EnsoCode → Settings → Plugins → Enso plugins**（安装后记得将插件切换为 **启用**）：

1. **GitHub 仓库链接安装（推荐，支持自动检查更新）**：
   粘贴仓库地址即可安装，EnsoCode 会自动读取仓库中的 `enso-plugin.json` 检查新版本：
   ```text
   https://github.com/xiamuwnagwang/enso-yce
   ```
2. **ZIP 链接在线安装**：
   - GitHub Release：`https://github.com/xiamuwnagwang/enso-yce/releases/latest/download/yce-enso-plugin.zip`
   - YCE 镜像：`https://yce.aigy.de/downloads/yce-enso-plugin.zip`
3. **CLI / Headless Server 安装**：
   ```bash
   enso-server plugin install https://github.com/xiamuwnagwang/enso-yce --yes
   enso-server plugin enable yce.enhance
   ```
4. **本地源码目录安装**：
   克隆本仓库后，在 **Enso plugins → Install directory** 选择仓库根目录，或执行：
   ```bash
   enso-server plugin install . --yes
   enso-server plugin enable yce.enhance
   ```

安装时 EnsoCode 会展示插件申请的四项最小权限，确认即可：
- `ui.slot`：在输入框工具栏挂载增强按钮
- `composer.draft`：读取并替换当前输入框草稿
- `mcp.call`：仅允许调用 `yce_enhance` 与 `yce_read_result`
- `ui.clipboard`：复制 MCP 配置模板，或在草稿含文件引用 / 超出 32KB 时复制增强结果

---

## 3. 插件可选配置

在 **Settings → Plugins → Enso plugins → YCE Prompt Enhance** 中可按需调整：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `server` | 留空自动识别 | 优先匹配名称包含 `yce` 的 MCP 服务，也可手动指定服务名 |
| `language` | `auto` | 增强后提示词语言：`auto` / `zh-CN` / `en-US` |
| `enhanceBackend` | `default` | 增强后端：`default`（沿用 MCP 环境变量）/ `relay` / `local` |

---

## 4. 本地测试

零外部依赖，直接使用 Node.js 内置测试运行器即可：

```bash
node --test
```

## License

MIT
