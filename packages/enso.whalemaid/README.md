# 深海女仆工坊

鲸鱼娘女仆主题，移植自 [dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale) 的 maid-atelier 皮肤。浅色是白昼水晶宫殿配瓷白与海军蓝，深色是月夜宫殿配金色描边。主题键是 `enso.whalemaid/whalemaid`。

需要 EnsoCode 0.2.16 以上：图片放在插件目录里，主题 CSS 用相对 `url()` 引用。带 `themes/whalemaid.css`，安装或更新时要同意「修改界面样式」。`permissions` 是空数组。

## 版权

美术按 [CC BY-NC-SA 4.0](LICENSE-ARTWORK) 使用，禁止商业使用，衍生作品须以相同方式共享。署名链见 [NOTICE](NOTICE)：

- 鲸鱼娘角色原作：上善（[Pixiv](https://www.pixiv.net/users/62155430)）。
- 女仆鲸鱼娘二次设计：ZipZipPipe（[Pixiv](https://www.pixiv.net/users/18604994)）。
- 皮肤素材与再设计：Small-tailqwq（[dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale)）。

本插件只把上游 `maid-atelier/assets/` 里的图片缩放并转成 webp，没有改画面内容。

## 界面上的女仆

| 位置 | 锚点 | 素材 |
| --- | --- | --- |
| 主窗口的水晶宫殿 | `canvas` | 宫殿日景、夜景 |
| 对话有消息后两侧站着的女仆，宽度跟着对话列两侧留白走，放不下或开了宽屏对话就隐藏 | `timeline` | 提裙的女仆、拿记事本的女仆 |
| 没打开对话时两位女仆完整亮相，标题上方的徽饰 | `main` | 另外两款全身立绘、金色蓝宝石徽饰 |
| 新对话没有消息时托腮欢迎 | `timeline` | Q 版托腮 |
| 输入框上沿正中的蝴蝶结，聚焦时往上跳，整段留在框外 | `composer` | 蝴蝶结 |
| 侧栏实色海军蓝、浅色字、底栏上方困倦的小女仆 | `sidebar` | Q 版困倦 |
| 用户消息气泡 | `message-user` | 纯 CSS，瓷白配金边，暗色海军蓝配金边 |
| 思考块前认真的小脸，思考中轻轻点头 | `thinking` | Q 版鼓脸 |
| 代码块右上角的盾徽 | `code-block` | 鲸鱼盾徽 |
| 待办条上沿和会话标签栏底部的细金线 | `todo`、`session-tabs` | 纯 CSS 渐变 |
| 右侧面板角落转圈晕乎乎的小女仆 | `side-panel` | Q 版转圈 |
| 标题栏中间的蕾丝垂饰 | `title-bar` | 蕾丝垂饰 |
| 设置窗口导航底部的小女仆、内容区右下角的缎带 | `settings-nav`、`settings-content` | Q 版困倦、燕尾缎带 |

系统开了「减少动态效果」时，蝴蝶结不再跳，思考中的小脸不再点头。
