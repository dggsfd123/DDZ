# 老周家斗地主（Web 版）

基于 HTML5 Canvas + 原生 JavaScript 的前端版斗地主，由 `win/` 目录下的 Python + Pygame 版本完整移植而来：
**规则、AI 策略、界面布局、配色、动画、计分体系与桌面版逐点对齐**，可直接通过 GitHub Pages 分发。

## 玩法

- 鼠标操作：点击开始界面的难度卡片进入对局
- 三家斗地主（你 = 下方"诹恺"，左上/右上为 AI），逆时针出牌（你 → 右上 → 左上）
- 叫地主（1/2/3 分或不叫）→ 出牌（出牌 / 不出 / 提示）→ 结算
- 初始每人 50 分；有人到 100 分"游戏胜利"，掉到 0 分"游戏结束"，点击按钮返回开始界面
- 每 15 分钟弹出 1 分钟黑屏休息提醒（"起来活动一下吧！"）
- 支持单张/对子/三张/三带一/三带二/顺子/连对/飞机/飞机带单/飞机带双/炸弹/四带二/王炸
- 炸弹与王炸有全屏闪光 + 大字 + 粒子特效，每个炸弹得分翻倍

## 本地运行

纯静态页面，无需构建。任选其一：

```bash
# 方式 1：Python
python -m http.server 8000

# 方式 2：Node
npx serve .
```

然后浏览器打开 <http://localhost:8000>。

> 注意：请通过 HTTP 服务访问（不要直接双击 index.html），
> 否则部分浏览器会因 `file://` 安全策略导致头像/音频加载失败。

## 部署到 GitHub Pages

1. 把本目录（`web/`）的全部文件推送到 GitHub 仓库根目录
   （即仓库中应直接看到 `index.html`、`css/`、`js/`、`resources/`）
2. 进入仓库 **Settings → Pages**
3. **Source** 选择 `Deploy from a branch`，Branch 选 `main`（或 `master`）、目录选 `/ (root)`，保存
4. 等待约 1 分钟，访问 `https://<你的用户名>.github.io/<仓库名>/`

无需任何构建步骤，推上去即用。

## URL 参数（调试用）

| 参数 | 说明 |
| --- | --- |
| `?seed=42` | 固定随机种子，复现同一副牌（与 Python 版 `GameUI(seed=42)` 一致） |
| `?bgm=0` | 关闭背景音乐 |

例如：`https://<用户名>.github.io/<仓库名>/?seed=42`

## 目录结构

```
web/
├── index.html            入口页面（1000x700 画布）
├── css/style.css         页面样式（画布自适应缩放、居中）
├── js/
│   ├── pyrandom.js       Python 兼容 MT19937 随机数（seed 复现）
│   ├── card.js           牌定义（点数/花色/大小）
│   ├── deck.js           牌堆（54 张、洗牌、发牌）
│   ├── rule_engine.js    牌型判定与大小比较
│   ├── game_state.js     游戏状态机（叫地主/出牌/结算）
│   ├── ai_player.js      三档难度 AI
│   ├── ui.js             Canvas 渲染与鼠标交互
│   └── main.js           入口
└── resources/            头像 p01-p07.png、背景音乐 b_music.ogg
```

## 与 Python 桌面版的对应关系

| Python 模块 | Web 文件 |
| --- | --- |
| `card.py` | `js/card.js` |
| `deck.py` | `js/deck.js` |
| `rule_engine.py` | `js/rule_engine.js` |
| `game_state.py` | `js/game_state.js` |
| `ai_player.py` | `js/ai_player.js` |
| `ui.py` / `main.py` | `js/ui.js` / `js/main.js` |

移植时保持了逐行等价：包括叫分轮转、结算计分（基础分 × 2^炸弹数 × 春天/反春）、
AI 三档策略差异、选中牌上移 22px、手牌点击条带命中等细节；
随机数部分实现了与 CPython 完全一致的 MT19937（含 `seed()` 与 `shuffle`），
传 `?seed=42` 时发牌与 Python 版逐张相同。

## 致谢

- 背景音乐：`resources/b_music.ogg`
- 字体优先使用 LXGW WenKai / 微软雅黑 / PingFang SC 等系统中文字体
