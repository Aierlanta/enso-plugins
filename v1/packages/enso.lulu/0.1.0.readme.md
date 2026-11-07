# 噜噜和噜妹

噜噜和噜妹主题。浅色是奶油橘底配焦糖棕字，深色是焦糖夜配暖杏字。主题键是 `enso.lulu/lulu`。

需要 EnsoCode 0.3.3 以上：角色图写在 `themes/lulu.json` 的 `assets` 素材槽位里，旧版本不认这个字段。橘色和粉色斑点、字标、用户气泡仍在 `themes/lulu.css`，安装或更新时要同意「修改界面样式」。`permissions` 是空数组。

## 界面上的噜噜和噜妹

| 位置 | 锚点 | 素材 |
| --- | --- | --- |
| 主窗口画布的橘色圆点和粉色圆点 | `canvas` | 纯 CSS |
| 侧栏底部两人并排待机。工作中、等待、出错时换成对应动作 | `sidebar` | `pair-idle.webp`，状态为 `pair-run.webp`、`pair-wait.webp`、`pair-fail.webp` |
| 输入框后面探出噜噜的头顶 | `composer` | `lulu-peek.webp` |
| 新对话没有消息时噜妹跳跃 | `timeline` | `lumei-jump.webp` |
| 没打开对话时两人挥手，下面是字标 | `main` | `pair-wave.webp`、圆体字标 |
| 用户消息粉色气泡 | `message-user` | 纯 CSS |
| 思考块前噜噜托腮 | `thinking` | `lulu-think.webp` |
| 代码块上沿噜妹的脸，状态行左边噜噜的脸 | `code-block`、`status-line` | `lumei-face.webp`、`lulu-face.webp` |
| 时间线里的待办，噜妹挥手 | `todo` | `lumei-wave.webp` |
| 右侧面板角落噜妹双手合十 | `side-panel` | `lumei-wait.webp` |

系统开了「减少动态效果」时，动图换成第一帧，探头不再跳。

## 素材来源

角色版权归铁罐（北京）文化传媒有限公司。下面两套精灵都是非官方粉丝作品。噜妹素材仅限非商业使用，本插件免费、不作商业用途。

帧数按精灵图里 alpha 非空的格子计，不把空格算进去。两人同一行的帧数相同，并排动图按这个帧数循环。静止图是该动图的第一帧。

| 文件 | 上游 | 作者与许可 |
| --- | --- | --- |
| `pair-idle.webp`、`lulu-peek.webp`、`lulu-face.webp` 中的噜噜 | [czy666chen/lulu](https://github.com/czy666chen/lulu) 精灵图第 0 行待机，7 帧。探头和脸只用第 1 帧，裁到头顶橘子至下巴 | Copyright (c) 2026 czy666chen，MIT |
| `pair-wave.webp` 中的噜噜 | 同一精灵图第 3 行挥手，4 帧 | 同上，MIT |
| `pair-fail.webp` 中的噜噜 | 同一精灵图第 5 行失败，8 帧 | 同上，MIT |
| `pair-wait.webp` 中的噜噜 | 同一精灵图第 6 行等待，6 帧 | 同上，MIT |
| `pair-run.webp` 中的噜噜 | 同一精灵图第 7 行工作中，6 帧 | 同上，MIT |
| `lulu-think.webp` | 同一精灵图第 8 行托腮，6 帧 | 同上，MIT |
| `pair-idle.webp`、`lumei-face.webp` 中的噜妹 | [legeling/awesome-codex-pet](https://github.com/legeling/awesome-codex-pet/tree/main/pets/lumei--legeling) `pets/lumei--legeling` 第 0 行待机，7 帧。脸只用第 1 帧 | legeling。原文：Non-commercial use only. Commercial use is prohibited. Character rights remain with their respective owners. |
| `pair-wave.webp`、`lumei-wave.webp` 中的噜妹 | 同一精灵图第 3 行挥手，4 帧 | 同上，仅限非商业使用 |
| `lumei-jump.webp` | 同一精灵图第 4 行跳跃，5 帧 | 同上 |
| `pair-fail.webp` 中的噜妹 | 同一精灵图第 5 行失败，8 帧 | 同上 |
| `pair-wait.webp`、`lumei-wait.webp` 中的噜妹 | 同一精灵图第 6 行等待，6 帧 | 同上 |
| `pair-run.webp` 中的噜妹 | 同一精灵图第 7 行工作中，6 帧 | 同上 |
| `wordmark.webp`、`wordmark-dark.webp` | 本机圆体「Yuanti SC Bold」渲染的「噜噜和噜妹」，浅色深棕、深色奶白。字体不打包 | 无上游图片 |
