# 奶蛙

奶蛙主题。浅色是荷叶绿配奶黄，深色是荷塘夜配奶蛙黄。主题键是 `enso.naiwa/naiwa`。

需要 EnsoCode 0.2.16 以上：图片放在插件目录里，主题 CSS 用相对 `url()` 引用，旧版本不会改写这些地址。带 `themes/naiwa.css`，安装或更新时要同意「修改界面样式」。`permissions` 是空数组。

## 界面上的奶蛙

| 位置                                                 | 锚点                        | 素材                              |
| ---------------------------------------------------- | --------------------------- | --------------------------------- |
| 主窗口画布的荷叶斑点                                 | `canvas`                    | 纯 CSS 圆点                       |
| 侧栏底部趴着往前爬                                   | `sidebar`                   | 像素「向右爬行」动图              |
| 输入区最上面那一条后面探头，聚焦时往上探             | 输入区第一条                | 半颗奶蛙头                        |
| 新对话没有消息时捧腹大笑                             | `timeline`                  | 像素「捧腹大笑」动图              |
| 没打开对话时站着，下面是字标                         | `main`                      | 桌宠「待机」动图、宋体字标        |
| 用户消息奶黄气泡                                     | `message-user`              | 纯 CSS                            |
| 思考块前托腮思考                                     | `thinking`                  | 像素「托腮思考」动图              |
| 代码块上沿和状态行左边的小奶蛙                       | `code-block`、`status-line` | 像素「悬停大笑」动图              |
| 时间线里的待办捧腹大笑                               | `todo`                      | 桌宠「捧腹大笑」动图              |
| 右侧面板角落侧耳倾听                                 | `side-panel`                | 桌宠「倾听」动图                  |

系统开了「减少动态效果」时，动图换成第一帧，探头不再跳。

## 素材来源

动图取自 [Nailong-Studio/NaiWa-Wallpaper](https://github.com/Nailong-Studio/NaiWa-Wallpaper)（MIT）素材仓，只改了文件名：

| 文件                         | 上游原名            | 原始作者与许可                                                                                                  |
| ---------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------- |
| `laugh.gif`                  | 奶蛙-捧腹大笑像素   | [Maple498/nai-wa-codex-pet](https://github.com/Maple498/nai-wa-codex-pet) `hover-belly-laugh.gif`，CC BY 4.0   |
| `think.gif`                  | 奶蛙-托腮思考像素   | [sandytruant/codex-pet-naiwa](https://github.com/sandytruant/codex-pet-naiwa) `thinking.gif`，MIT               |
| `hover.gif`                  | 奶蛙-悬停大笑       | sandytruant/codex-pet-naiwa `hover-laugh.gif`，MIT                                                              |
| `puff.gif`                   | 奶蛙-鼓腮得意       | sandytruant/codex-pet-naiwa，MIT                                                                                |
| `crawl.gif`                  | 奶蛙-向右爬行       | sandytruant/codex-pet-naiwa `crawl-right.gif`，MIT                                                              |
| `belly.gif`、`idle.gif`、`listen.gif` | 桌宠捧腹大笑、待机、倾听 | [liaosongjie/Codex-Voice-Input](https://github.com/liaosongjie/Codex-Voice-Input) 的 MIT 动画帧，由素材仓合成 |

`peek.webp` 取自 [DevourerM/dsh-naiwa-theme](https://github.com/DevourerM/dsh-naiwa-theme) 的 `naiwa-peek.webp`（MIT，素材声明见其 `ASSETS_NOTICE.md`），裁掉黑边后缩到 320px 宽。字标是本地用宋体渲染的「奶蛙」二字。
