# Bugbot Review (`enso.bugbot`)

将 Cursor 的 `review-bugbot` 技能、只读 `bugbot` 审查子代理与 IDE 本地 Agent Review 上下文组装完整移植到 Enso。

## 功能特性

- **本地上下文组装 (`bugbot_prepare`)**：
  - 支持 `branch_changes`（自动解析 `origin/HEAD` / `origin/main` / `main` 等默认基准分支并计算 `merge-base` + 工作区改动）、`uncommitted_changes`（仅未提交/未跟踪改动）和 `natural_language` 三种模式。
  - 通过 `git check-attr linguist-generated` 自动剔除构建产物/生成文件。
  - 自动读取仓库下的 `.cursor/BUGBOT.md` / `.enso/BUGBOT.md` / `BUGBOT.md` 规则，并以 `[EXTREMELY IMPORTANT] User instructions for this run:` 拼入当次用户指令。
  - 默认低于 10 行有效改动时自动短路跳过（`Not enough changes to review`）。
- **只读审查子代理 (`agentTypes: ["bugbot"]`)**：
  - 锁定 `tools: "readonly"`，使用只读工具交叉核对上下文以压低误报，禁止直接修改业务文件。
- **结果归档与 Findings 侧栏 (`bugbot_report` + `bugbot.html`)**：
  - 支持解析 Markdown 表格或 `<answer><bug>` XML，按 `high → medium → low` 排序展示。
  - 支持单条 **Fix in Chat** 与 **Fix All in Chat**（复刻 Cursor `Verify this issue exists and fix it:` + `Affected files:` / `Related files (could not be opened):` 提示词结构写入输入框草稿），以及单条忽略/恢复。
