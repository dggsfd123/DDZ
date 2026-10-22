/* 图形化界面——对应 win/ui.py（Pygame -> HTML5 Canvas 移植）
 *
 * 实现斗地主牌桌渲染与鼠标交互：
 * - 牌桌背景、三名玩家位置（下方自己，左上/右上是对手）
 * - 牌面绘制、手牌横向排列、点击选中高亮
 * - 出牌/不出(Pass)/叫地主按钮
 * - 底牌展示区、当前出牌区
 * - 分数显示、胜负结算弹窗
 * - 开始界面（标题 + 难度选择 + 头像）、发牌动画、炸弹特效、久坐提醒
 *
 * 逻辑分辨率固定 1200x540（20:9 宽屏，适配手机横屏），CSS 自适应缩放。
 * 相对 1000x700 的 pygame 版：横向更宽、纵向更紧凑，个别硬编码坐标
 * （顶部面板、出牌区、开始界面卡片、手牌基線）按新比例重新分配；
 * 字体整体放大一档。游戏逻辑、AI、计分与 pygame 版完全一致。
 */
(function (global) {
  "use strict";

  const {
    Suit, RANK_DISPLAY, RANK_VALUE,
    GameState, GamePhase, CardType,
    ai_bid, choose_action, find_beats, _has_rocket, _bomb_ranks,
  } = global;

  // 中文字体栈（优先 LXGW WenKai，回退系统黑体类字体）
  const FONT_STACK = '"LXGW WenKai", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", "SimHei", sans-serif';

  // 颜色常量（与 ui.py 完全一致）
  const GREEN_DARK = [28, 94, 54];
  const WHITE = [255, 255, 255];
  const BLACK = [20, 20, 20];
  const RED = [200, 40, 40];
  const GOLD = [240, 200, 60];
  const GRAY = [120, 120, 120];
  const BLUE = [40, 90, 180];
  const BTN_BLUE = [52, 110, 200];
  const BTN_RED = [200, 60, 60];
  const BTN_GRAY = [110, 110, 110];
  const ORANGE = [240, 140, 30];
  const PURPLE = [150, 70, 200];
  const SELECTED_Y = -22; // 选中牌上移像素

  const CARD_W = 72;
  const CARD_H = 100;
  const CARD_GAP = 40; // 手牌横向间距（保证点数"10"等不被下一张遮挡）

  // AI 叫/出牌之间的停顿秒数（让玩家看清 AI 行为）；叫地主时停顿更久
  const AI_ACT_PAUSE = 1.3;  // 出牌阶段每个 AI 行动之间的间隔
  const AI_BID_PAUSE = 2.5;  // 叫地主阶段：AI 叫完后停留几秒

  // 玩家姓名 & 头像配置
  const HUMAN_PLAYER = ["诹恺", "p01"];
  const DIFF_AI_PLAYERS = {
    easy: [["周老爷", "p02"], ["刘姥姥", "p03"]],
    normal: [["东一躺", "p04"], ["靶拔", "p05"]],
    hard: [["华姐", "p06"], ["秋奇", "p07"]],
  };
  const DIFF_LABEL = { easy: "简单难度", normal: "中档难度", hard: "困难难度" };

  // ---------- 基础绘制工具 ----------

  function rgb(c) {
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  function fontStr(size) {
    return `${size}px ${FONT_STACK}`;
  }

  /* 以左上角为基准绘制文字（对齐 pygame blit 行为） */
  function drawText(ctx, text, x, y, size, color, align = "left") {
    ctx.font = fontStr(size);
    ctx.fillStyle = rgb(color);
    ctx.textAlign = align;
    ctx.textBaseline = "top";
    ctx.fillText(text, x, y);
  }

  function textWidth(ctx, text, size) {
    ctx.font = fontStr(size);
    return ctx.measureText(text).width;
  }

  /* 圆角矩形路径；corners = [左上, 右上, 右下, 左下] 是否圆角 */
  function roundRectPath(ctx, x, y, w, h, r, corners = [true, true, true, true]) {
    const c0 = corners[0] ? r : 0;
    const c1 = corners[1] ? r : 0;
    const c2 = corners[2] ? r : 0;
    const c3 = corners[3] ? r : 0;
    ctx.beginPath();
    ctx.moveTo(x + c0, y);
    ctx.lineTo(x + w - c1, y);
    ctx.arcTo(x + w, y, x + w, y + c1, c1);
    ctx.lineTo(x + w, y + h - c2);
    ctx.arcTo(x + w, y + h, x + w - c2, y + h, c2);
    ctx.lineTo(x + c3, y + h);
    ctx.arcTo(x, y + h, x, y + h - c3, c3);
    ctx.lineTo(x, y + c0);
    ctx.arcTo(x, y, x + c0, y, c0);
    ctx.closePath();
  }

  function fillRoundRect(ctx, x, y, w, h, r, color, corners) {
    roundRectPath(ctx, x, y, w, h, r, corners);
    ctx.fillStyle = typeof color === "string" ? color : rgb(color);
    ctx.fill();
  }

  function strokeRoundRect(ctx, x, y, w, h, r, color, lineWidth, corners) {
    roundRectPath(ctx, x, y, w, h, r, corners);
    ctx.strokeStyle = typeof color === "string" ? color : rgb(color);
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  /* 用矢量图形绘制花色（不依赖字体，保证可识别）。s 为大致半径尺度。 */
  function drawSuit(ctx, suit, cx, cy, s, color) {
    ctx.fillStyle = rgb(color);
    if (suit === Suit.HEART) {
      ctx.beginPath();
      ctx.arc(cx - s * 0.25, cy - s * 0.12, s * 0.3, 0, Math.PI * 2);
      ctx.arc(cx + s * 0.25, cy - s * 0.12, s * 0.3, 0, Math.PI * 2);
      ctx.moveTo(cx - s * 0.52, cy - s * 0.02);
      ctx.lineTo(cx + s * 0.52, cy - s * 0.02);
      ctx.lineTo(cx, cy + s * 0.55);
      ctx.closePath();
      ctx.fill();
    } else if (suit === Suit.DIAMOND) {
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 0.6);
      ctx.lineTo(cx + s * 0.45, cy);
      ctx.lineTo(cx, cy + s * 0.6);
      ctx.lineTo(cx - s * 0.45, cy);
      ctx.closePath();
      ctx.fill();
    } else if (suit === Suit.SPADE) {
      ctx.beginPath();
      ctx.arc(cx - s * 0.25, cy + s * 0.12, s * 0.26, 0, Math.PI * 2);
      ctx.arc(cx + s * 0.25, cy + s * 0.12, s * 0.26, 0, Math.PI * 2);
      ctx.moveTo(cx, cy - s * 0.6);
      ctx.lineTo(cx - s * 0.55, cy + s * 0.22);
      ctx.lineTo(cx + s * 0.55, cy + s * 0.22);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(cx - 2, cy + s * 0.22, 4, s * 0.45);
    } else if (suit === Suit.CLUB) {
      ctx.beginPath();
      ctx.arc(cx, cy - s * 0.28, s * 0.3, 0, Math.PI * 2);
      ctx.arc(cx - s * 0.32, cy + s * 0.12, s * 0.3, 0, Math.PI * 2);
      ctx.arc(cx + s * 0.32, cy + s * 0.12, s * 0.3, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(cx - 2, cy + s * 0.12, 4, s * 0.5);
    }
    // 王（joker）无花色图形
  }

  /* 绘制单张牌。selected 时上移高亮；back 为牌背。 */
  function drawCardFace(ctx, x, y, card, selected = false, back = false) {
    const oy = y + (selected ? SELECTED_Y : 0);
    // 投影
    fillRoundRect(ctx, x + 2, oy + 3, CARD_W, CARD_H, 8, "rgba(0,0,0,0.353)");
    // 牌底
    fillRoundRect(ctx, x, oy, CARD_W, CARD_H, 8, WHITE);
    strokeRoundRect(ctx, x, oy, CARD_W, CARD_H, 8, [40, 40, 40], 1);
    if (selected) {
      // 选中高亮：金色粗边框
      strokeRoundRect(ctx, x, oy, CARD_W, CARD_H, 8, GOLD, 3);
    }

    if (back) {
      // 牌背：渐变蓝 + 花纹
      fillRoundRect(ctx, x + 4, oy + 4, CARD_W - 8, CARD_H - 8, 6, [30, 70, 150]);
      fillRoundRect(ctx, x + 9, oy + 9, CARD_W - 18, CARD_H - 18, 4, [120, 170, 230]);
      const cx = x + CARD_W / 2;
      const cy = oy + CARD_H / 2;
      ctx.fillStyle = rgb([30, 70, 150]);
      ctx.beginPath();
      ctx.moveTo(cx, cy - 16);
      ctx.lineTo(cx + 12, cy);
      ctx.lineTo(cx, cy + 16);
      ctx.lineTo(cx - 12, cy);
      ctx.closePath();
      ctx.fill();
      return;
    }

    const is_red = card.suit === Suit.HEART || card.suit === Suit.DIAMOND;
    const color = is_red ? RED : BLACK;

    if (card.suit === Suit.JOKER) {
      // 王：显示文字
      drawText(ctx, RANK_DISPLAY[card.rank], x + 8, oy + 13, 24, color);
      // 王简笔画皇冠标识
      const cx = x + CARD_W / 2;
      ctx.fillStyle = rgb(GOLD);
      ctx.beginPath();
      ctx.moveTo(cx - 14, oy + CARD_H - 22);
      ctx.lineTo(cx - 14, oy + CARD_H - 36);
      ctx.lineTo(cx - 6, oy + CARD_H - 28);
      ctx.lineTo(cx, oy + CARD_H - 40);
      ctx.lineTo(cx + 6, oy + CARD_H - 28);
      ctx.lineTo(cx + 14, oy + CARD_H - 36);
      ctx.lineTo(cx + 14, oy + CARD_H - 22);
      ctx.closePath();
      ctx.fill();
      return;
    }

    // 左上角点数
    drawText(ctx, RANK_DISPLAY[card.rank], x + 7, oy + 6, 26, color);
    // 左上角小花色
    drawSuit(ctx, card.suit, x + 17, oy + 46, 9, color);
    // 中央大花色
    drawSuit(ctx, card.suit, x + CARD_W / 2, oy + 62, 18, color);
    // 右下角点数（便于远距离识别）
    const r2w = textWidth(ctx, RANK_DISPLAY[card.rank], 20);
    drawText(ctx, RANK_DISPLAY[card.rank], x + CARD_W - 7 - r2w, oy + CARD_H - 7 - 20, 20, color);
  }

  /* 简单矩形按钮，支持点击命中检测 */
  class Button {
    constructor(x, y, w, h, text, color = BTN_BLUE) {
      this.x = x;
      this.y = y;
      this.w = w;
      this.h = h;
      this.text = text;
      this.color = color;
    }

    draw(ctx, enabled = true) {
      const color = enabled ? this.color : BTN_GRAY;
      fillRoundRect(ctx, this.x, this.y, this.w, this.h, 8, color);
      strokeRoundRect(ctx, this.x, this.y, this.w, this.h, 8, WHITE, 2);
      // 文字居中（textBaseline=top，手动上移约半个字高）
      drawText(ctx, this.text, this.x + this.w / 2, this.y + this.h / 2 - 12, 24, WHITE, "center");
    }

    hit(px, py) {
      return px >= this.x && px <= this.x + this.w && py >= this.y && py <= this.y + this.h;
    }
  }

  class GameUI {
    constructor(seed = null, start_scene = false) {
      this.W = 1200;
      this.H = 540;
      this.canvas = document.getElementById("game-canvas");
      this.ctx = this.canvas.getContext("2d");
      this.seed = seed;

      // 资源：头像
      this.avatars = this._load_avatars();
      this.player_avatars = { 0: HUMAN_PLAYER[1] };

      // 难度（可调整），0 号为人类玩家，1/2 号为 AI
      this.difficulty = "normal";

      // 轮流叫地主：本局第一个叫分的玩家（每局推进为 上一把地主+1）
      this.first_bidder = 0;

      // 背景音乐：循环播放（文件缺失/无法播放时静默跳过，不影响游戏）
      this._start_bgm();

      // 场景状态：'start' 开始界面 / 'game' 对局界面
      this.scene = start_scene ? "start" : "game";

      // 交互状态
      this.selected = new Set();   // 选中的手牌索引（玩家0）
      this.msg = "";               // 事件提示（最近一次出牌/叫分结果）
      this.msg_turn = "";          // 回合提示（当前轮到谁）
      this._ai_next_delay = AI_ACT_PAUSE; // AI 下一次行动的等待间隔
      this.last_play_area = {};    // {player_id: [cards]} 当前出牌区展示
      this.result_popup = null;    // [title, detail]
      this.game_end = false;       // 是否终局弹窗（胜利/失败）
      this.hand_rects = [];        // 手牌绘制矩形列表（用于精准点击命中）
      this.effects = [];           // 炸弹/王炸特效列表

      // 累计分数与局数（初始每人 50 分）
      this.total_scores = [50, 50, 50];
      this.round_no = 1;
      this.result_time = null;     // 结算弹窗出现时间（用于自动进入下一局）
      this.auto_next_delay = 3.0;  // 结算后自动开下一局的等待秒数

      this.deal_duration = 1.6;

      // 久坐提醒：每 15 分钟进入 1 分钟全屏黑屏休息（"起来活动一下吧！"）
      this.reminder_play = 15 * 60;   // 对局阶段倒计时秒数（15 分钟）
      this.reminder_break = 60;       // 黑屏休息倒计时秒数（1 分钟）
      this.reminder_remaining = this.reminder_play;
      this.reminder_break_mode = false;

      // 游戏状态：start_scene=true 时先显示开始界面，选难度后再创建 gs
      if (start_scene) {
        this.gs = null;
        this.dealing = false;
        this.deal_start = 0;
      } else {
        this.gs = new GameState(seed);
        this.gs.deal();
        this.msg = "发牌中…请叫地主";
        this.dealing = true;
        this.deal_start = this.now();
      }

      // 按钮（根据阶段动态启用）
      this.buttons = this._build_buttons();
      // 开始界面难度选择面板
      this.start_panels = this._build_start_panels();

      this._last_ai_time = this.now();
      this.reminder_last = this.now();
      this._event_queue = [];
      this._running = true;
      this._bind_events();
      this._resize();
    }

    /* ---------- 时间基准（对应 Python time.time()，仅使用差值） ---------- */
    now() {
      if (this._t0 === undefined) this._t0 = performance.now() / 1000;
      return performance.now() / 1000 - this._t0;
    }

    /* ---------- 画布尺寸 / 事件 ---------- */
    _resize() {
      const dpr = window.devicePixelRatio || 1;
      const scale = Math.min(window.innerWidth / this.W, window.innerHeight / this.H);
      const cssW = Math.max(1, Math.floor(this.W * scale));
      const cssH = Math.max(1, Math.floor(this.H * scale));
      this.canvas.style.width = cssW + "px";
      this.canvas.style.height = cssH + "px";
      this.canvas.width = Math.floor(this.W * dpr);
      this.canvas.height = Math.floor(this.H * dpr);
      this._dpr = dpr;
    }

    _bind_events() {
      window.addEventListener("resize", () => this._resize());
      this.canvas.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        // 浏览器要求用户手势后才能播放音频：首次点击时启动 BGM
        this._try_start_bgm();
        const rect = this.canvas.getBoundingClientRect();
        const pos = [
          (e.clientX - rect.left) * (this.W / rect.width),
          (e.clientY - rect.top) * (this.H / rect.height),
        ];
        this._event_queue.push(pos);
      });
      this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    }

    /* ---------- 资源 ---------- */
    _load_avatars() {
      const av = {};
      for (const key of ["p01", "p02", "p03", "p04", "p05", "p06", "p07"]) {
        const img = new Image();
        img._ok = false;
        img.onload = () => { img._ok = true; };
        img.src = "resources/" + key + ".png";
        av[key] = img;
      }
      return av;
    }

    _start_bgm() {
      // 桌面用 mp3，浏览器用 ogg（mp3 在部分浏览器需额外解码，ogg 原生支持）
      try {
        const params = new URLSearchParams(location.search);
        if (params.get("bgm") === "0") return;
        this.bgm = new Audio("resources/b_music.ogg");
        this.bgm.loop = true;
        this.bgm.volume = 0.5; // 音量减半，避免过响
        this._bgm_started = false;
        // 尝试直接播放（多数浏览器会因自动播放策略拒绝，忽略错误）
        this._try_start_bgm();
      } catch (e) {
        this.bgm = null;
      }
    }

    _try_start_bgm() {
      if (!this.bgm || this._bgm_started) return;
      this._bgm_started = true;
      const p = this.bgm.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => { this._bgm_started = false; });
      }
    }

    /* ---------- 场景切换 ---------- */
    _build_start_panels() {
      /* 开始界面三个难度选择卡片（矩形 + 对应难度），整体控制在窗口高度内。
       * 20:9（1200x540）下重新分配：卡片更高更扁、间距收紧。 */
      const panels = [];
      const card_w = 460;
      const card_h = 90;
      const x = this.W / 2 - card_w / 2;
      const y0 = 194;
      const gap = 12;
      const diffs = ["easy", "normal", "hard"];
      for (let i = 0; i < diffs.length; i++) {
        panels.push({
          x: x,
          y: y0 + i * (card_h + gap),
          w: card_w,
          h: card_h,
          diff: diffs[i],
        });
      }
      return panels;
    }

    _start_game(difficulty) {
      /* 根据所选难度开始一局：设置 AI 姓名/头像、重置分数、发牌。 */
      this.difficulty = difficulty;
      const ai = DIFF_AI_PLAYERS[difficulty];
      this.player_avatars = { 0: HUMAN_PLAYER[1], 1: ai[0][1], 2: ai[1][1] };
      this.total_scores = [50, 50, 50];
      this.round_no = 1;
      this.first_bidder = 0;
      this.gs = new GameState(this.seed);
      this.gs.deal();
      this.gs.players[0].name = HUMAN_PLAYER[0];
      this.gs.players[1].name = ai[0][0];
      this.gs.players[2].name = ai[1][0];
      this.selected.clear();
      this.last_play_area = {};
      this.result_popup = null;
      this.game_end = false;
      this.msg = "发牌中…请叫地主";
      this.dealing = true;
      this.deal_start = this.now();
      this.scene = "game";
    }

    _back_to_start() {
      /* 返回开始界面，重置场景（分数在 _start_game 中重置）。 */
      this.scene = "start";
      this.gs = null;
      this.result_popup = null;
      this.game_end = false;
      this.selected.clear();
      this.last_play_area = {};
    }

    /* ---------- 按钮 ---------- */
    _build_buttons() {
      const bx = this.W / 2 - 220;
      const by = this.H - 56;
      return {
        bid1: new Button(bx, by, 100, 44, "叫1分", BTN_BLUE),
        bid2: new Button(bx + 110, by, 100, 44, "叫2分", BTN_BLUE),
        bid3: new Button(bx + 220, by, 100, 44, "叫3分", BTN_BLUE),
        nobid: new Button(bx + 330, by, 100, 44, "不叫", BTN_GRAY),
        play: new Button(bx, by, 140, 44, "出牌", BTN_RED),
        pass: new Button(bx + 160, by, 140, 44, "不出", BTN_GRAY),
        hint: new Button(bx + 320, by, 140, 44, "提示", BTN_BLUE),
        again: new Button(this.W / 2 - 80, this.H / 2 + 60, 160, 48, "再来一局", BTN_BLUE),
      };
    }

    /* ---------- 主循环（30FPS 固定步进，对齐 pygame clock.tick(30)） ---------- */
    run() {
      this._last = performance.now();
      this._acc = 0;
      const step = 1000 / 30;
      const loop = (ts) => {
        if (!this._running) return;
        let delta = ts - this._last;
        this._last = ts;
        if (delta > 250) delta = 250; // 防止切后台后追帧
        this._acc += delta;
        while (this._acc >= step) {
          this._acc -= step;
          this.tick();
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    stop() {
      this._running = false;
    }

    tick() {
      // 1) 处理累积的点击事件（对应 pygame 事件轮询）
      const events = this._event_queue;
      this._event_queue = [];
      for (const pos of events) {
        this._on_click(pos);
      }

      const now = this.now();

      // 开始界面不运行对局逻辑
      if (this.scene === "start") {
        this.draw();
        return;
      }

      // 久坐提醒：黑屏休息阶段冻结对局逻辑，仅倒计时；结束后重置 15 分钟继续
      this._update_reminder(now);
      if (this.reminder_break_mode) {
        this._update_effects();
        this.draw();
        return;
      }

      // 发牌动画期间不接受 AI 行动
      if (this.dealing) {
        if (now - this.deal_start >= this.deal_duration) {
          this.dealing = false;
          if (this.gs.phase === GamePhase.BID) this.msg = "请叫地主";
        }
      } else {
        // 结算后自动进入下一局（仅非终局时）
        if (this.result_popup !== null && this.result_time !== null) {
          if (!this.game_end && now - this.result_time >= this.auto_next_delay) {
            this._restart();
          }
        } else if (this.gs.phase === GamePhase.BID) {
          // 回合提示：叫地主/出牌是轮流进行的，明确告诉玩家当前轮到谁
          this.msg_turn = this.gs.bid_turn === 0
            ? "轮到你叫地主，请点击按钮"
            : `叫地主中… 轮到 ${this.gs.players[this.gs.bid_turn].name} 考虑`;
        } else if (this.gs.phase === GamePhase.PLAY) {
          this.msg_turn = this.gs.current_turn === 0
            ? "轮到你出牌"
            : `轮到 ${this.gs.players[this.gs.current_turn].name} 出牌`;
        }
        // AI 自动行动：当前不是人类（0 号）回合时，延时后自动出牌/叫分
        if ((this.gs.phase === GamePhase.BID && this.gs.bid_turn !== 0) ||
            (this.gs.phase === GamePhase.PLAY && this.gs.current_turn !== 0)) {
          if (now - this._last_ai_time >= this._ai_next_delay) {
            this._auto_step();
            this._last_ai_time = now;
          }
        }
      }

      this._update_effects();
      this.draw();
    }

    _auto_step() {
      /* 自动执行当前 AI（1/2 号）玩家的一步：叫分或出牌。 */
      if (this.gs.phase === GamePhase.BID) {
        this._auto_bid_for(this.gs.bid_turn);
      } else if (this.gs.phase === GamePhase.PLAY) {
        this._auto_play_for(this.gs.current_turn);
      }
    }

    /* ---------- 点击处理 ---------- */
    _on_click(pos) {
      // 开始界面：点击难度面板进入对应难度对局
      if (this.scene === "start") {
        for (const panel of this.start_panels) {
          if (pos[0] >= panel.x && pos[0] <= panel.x + panel.w &&
              pos[1] >= panel.y && pos[1] <= panel.y + panel.h) {
            this._start_game(panel.diff);
          }
        }
        return;
      }
      // 发牌动画期间不响应
      if (this.dealing) return;
      // 结算弹窗：终局返回开始界面，普通局再来一局
      if (this.result_popup !== null) {
        if (this.buttons.again.hit(pos[0], pos[1])) {
          if (this.game_end) {
            this._back_to_start();
          } else {
            this._restart();
          }
        }
        return;
      }

      // 仅人类（0 号）回合允许手动操作；AI 回合由主循环自动处理
      if (this.gs.phase === GamePhase.BID) {
        if (this.gs.bid_turn !== 0) return;
        if (this.buttons.bid1.hit(pos[0], pos[1])) {
          this._do_bid(1);
        } else if (this.buttons.bid2.hit(pos[0], pos[1])) {
          this._do_bid(2);
        } else if (this.buttons.bid3.hit(pos[0], pos[1])) {
          this._do_bid(3);
        } else if (this.buttons.nobid.hit(pos[0], pos[1])) {
          this._do_bid(0);
        }
        return;
      }

      // 出牌阶段：只有 0 号人类回合可操作
      if (this.gs.phase === GamePhase.PLAY) {
        if (this.gs.current_turn !== 0) return;
        if (this.buttons.play.hit(pos[0], pos[1])) {
          this._do_play();
          return;
        }
        if (this.buttons.pass.hit(pos[0], pos[1])) {
          this._do_pass();
          return;
        }
        if (this.buttons.hint.hit(pos[0], pos[1])) {
          this._hint_select();
          return;
        }
        // 点击手牌选中/取消
        this._toggle_hand_card(pos);
        return;
      }
    }

    _toggle_hand_card(pos) {
      /* 根据绘制时记录的矩形精准命中，左起为最大牌。
       * 手牌横向重叠（CARD_GAP < CARD_W），每张牌仅其未被覆盖的
       * 左侧条带可点击；最右侧一张整张可点击。点击命中的是可见部分。 */
      const rects = this.hand_rects;
      const n = rects.length;
      for (let disp_idx = 0; disp_idx < n; disp_idx++) {
        const rect = rects[disp_idx];
        // 垂直范围：含选中上移部分
        const top = rect.y - 22;
        const bottom = rect.y + rect.h;
        if (!(top <= pos[1] && pos[1] <= bottom)) continue;
        // 水平范围：除最后一张外只取左侧 CARD_GAP 条带
        let left, right;
        if (disp_idx === n - 1) {
          left = rect.x;
          right = rect.x + rect.w;
        } else {
          left = rect.x;
          right = rect.x + CARD_GAP;
        }
        if (left <= pos[0] && pos[0] <= right) {
          const hand_idx = this._display_to_hand(disp_idx);
          if (this.selected.has(hand_idx)) {
            this.selected.delete(hand_idx);
          } else {
            this.selected.add(hand_idx);
          }
          return;
        }
      }
    }

    _display_order() {
      /* 返回手牌索引按权重从大到小排列的顺序（左=大）。 */
      const hand = this.gs.players[0].hand;
      const idx = [];
      for (let i = 0; i < hand.length; i++) idx.push(i);
      idx.sort((a, b) => hand[b].value - hand[a].value); // 稳定排序
      return idx;
    }

    _display_to_hand(disp_idx) {
      return this._display_order()[disp_idx];
    }

    /* ---------- 提示：是否有更大的牌可出 ---------- */
    _player0_can_beat() {
      /* 判断玩家0（人类）当前是否有能压过上一手的牌。
       * 返回 [can_beat, cards]：
       * - 先手（无上一手）：[true, null]（自由出牌）
       * - 跟牌有可压牌：[true, 建议的一组牌]
       * - 跟牌无可压牌：[false, null] */
      const target = this.gs.last_play;
      const hand = this.gs.players[0].hand;
      if (target === null) return [true, null];
      // 普通可压牌（保留炸弹，仅当普通牌压不过才用炸弹）
      const cards = find_beats(hand, target, true);
      if (cards) return [true, cards];
      // 炸弹/王炸也可压（普通跟牌之外的保命手段）
      if (_has_rocket(hand)) {
        return [true, hand.filter((c) => c.rank === "BJ" || c.rank === "RJ")];
      }
      const bombs = _bomb_ranks(hand);
      if (bombs.length > 0) {
        if (target.card_type === CardType.ROCKET) {
          return [false, null];
        }
        if (target.card_type === CardType.BOMB) {
          const bigger = bombs.filter((r) => RANK_VALUE[r] > target.main_value);
          if (bigger.length > 0) {
            return [true, hand.filter((c) => c.rank === bigger[0])];
          }
          return [false, null];
        }
        return [true, hand.filter((c) => c.rank === bombs[0])];
      }
      return [false, null];
    }

    _hint_select() {
      /* 提示按钮：自动选中一组可出的最小牌。 */
      const [can, cards] = this._player0_can_beat();
      if (!can) {
        this.msg = "没有能压过的牌，请选择不出";
        return;
      }
      if (cards === null) {
        // 先手：提示出最小的一张
        const hand = this.gs.players[0].hand;
        let smallest = 0;
        for (let i = 1; i < hand.length; i++) {
          if (hand[i].value < hand[smallest].value) smallest = i;
        }
        this.selected = new Set([smallest]);
        this.msg = "提示：出一张小牌";
        return;
      }
      // 选中建议的牌
      const hand = this.gs.players[0].hand;
      const chosen = new Set();
      for (const c of cards) {
        for (let i = 0; i < hand.length; i++) {
          if (!chosen.has(i) && hand[i].equals(c)) {
            chosen.add(i);
            break;
          }
        }
      }
      this.selected = chosen;
      this.msg = "提示：已为你选中最小的可压牌";
    }

    /* ---------- 动作 ---------- */
    _do_bid(score) {
      try {
        this.gs.bid(0, score);
        this.msg = score ? `你叫了 ${score} 分` : "你不叫";
        this.selected.clear();
        this._ai_next_delay = AI_ACT_PAUSE; // 你叫完后 AI 正常节奏响应
      } catch (e) {
        this.msg = String(e.message || e);
      }
    }

    _auto_bid_for(pid) {
      /* AI 玩家（1/2 号）叫分。叫完后停顿数秒，方便玩家看清是否叫了地主。 */
      try {
        const score = ai_bid(this.gs, pid, this.difficulty);
        this.gs.bid(pid, score);
        const name = this.gs.players[pid].name;
        if (score) {
          this.msg = `AI 玩家 ${name} 叫了 ${score} 分！`;
        } else {
          this.msg = `AI 玩家 ${name} 选择不叫`;
        }
        // 停顿更久，让玩家看清楚 AI 的叫分结果
        this._ai_next_delay = AI_BID_PAUSE;
      } catch (e) {
        // 与 Python 版一致：异常时静默跳过
      }
    }

    _do_play() {
      const hand = this.gs.players[0].hand;
      const cards = [...this.selected].sort((a, b) => a - b).map((i) => hand[i]);
      // 没有任何能压过的牌时，禁止出牌，默认改为不出
      if (this.gs.last_play !== null) {
        const [can] = this._player0_can_beat();
        if (!can) {
          this.msg = "你没有更大的牌，已自动不出";
          this._do_pass();
          return;
        }
      }
      if (cards.length === 0) {
        this.msg = "请先选择要出的牌";
        return;
      }
      try {
        this.gs.play(0, cards);
        this.selected.clear();
        this.msg = "你出牌成功";
        this._after_action();
      } catch (e) {
        this.msg = String(e.message || e);
      }
    }

    _do_pass() {
      if (this.gs.last_play === null) {
        this.msg = "你是先手，必须出牌";
        return;
      }
      try {
        this.gs.play(0, []);
        this.selected.clear();
        this.msg = "你选择不出";
        this._after_action();
      } catch (e) {
        this.msg = String(e.message || e);
      }
    }

    _auto_play_for(pid) {
      /* AI 玩家（1/2 号）出牌。 */
      const [cards, is_pass] = choose_action(this.gs, pid, this.difficulty);
      try {
        if (is_pass) {
          this.gs.play(pid, []);
          this.msg = `${this.gs.players[pid].name} 不出`;
        } else {
          this.gs.play(pid, cards);
          this.msg = `${this.gs.players[pid].name} 出牌: ` +
            cards.map((c) => RANK_DISPLAY[c.rank]).join(" ");
        }
      } catch (e) {
        this.msg = String(e.message || e);
      }
      this._ai_next_delay = AI_ACT_PAUSE; // 出牌阶段 AI 行动间隔较短
      this._after_action();
    }

    _after_action() {
      /* 每次出牌后刷新出牌区展示，并检查游戏是否结束。 */
      // 记录各家最近一次出牌用于展示
      if (this.gs.last_play !== null) {
        this.last_play_area[this.gs.last_play_owner] = this.gs.last_play.cards.slice();
        // 炸弹 / 王炸 特效
        const ct = this.gs.last_play.card_type;
        if (ct === CardType.BOMB) {
          this._trigger_effect("炸弹!", ORANGE);
        } else if (ct === CardType.ROCKET) {
          this._trigger_effect("王炸!", GOLD);
        }
      } else {
        // 新一轮：清空展示（保留地主未出时的空）
        this.last_play_area = {};
      }
      if (this.gs.phase === GamePhase.OVER) {
        this._build_result();
      }
    }

    /* ---------- 特效系统 ---------- */
    _trigger_effect(text, color) {
      /* 触发一次炸弹/王炸特效（全屏闪光 + 文字缩放 + 粒子爆裂）。 */
      // 去重保护：同一特效在极短时间内不重复叠加（避免王炸被触发两次的视觉重复）
      if (this.effects.length > 0) {
        const last = this.effects[this.effects.length - 1];
        if (last.text === text && this.now() - last.t0 < 0.4) return;
      }
      const particles = [];
      const cx = this.W / 2;
      const cy = this.H / 2;
      for (let i = 0; i < 36; i++) {
        const ang = Math.random() * 6.283;
        const spd = 4 + Math.random() * 7; // uniform(4, 11)
        particles.push({
          x: cx,
          y: cy,
          vx: (Math.random() * 2 - 1) * spd, // uniform(-1, 1) * spd
          vy: (Math.random() * 2 - 1) * spd - 2,
          r: 3 + Math.random() * 5, // uniform(3, 8)
          life: 0.5 + Math.random() * 0.6, // uniform(0.5, 1.1)
        });
      }
      this.effects.push({
        text: text,
        color: color,
        t0: this.now(),
        dur: 1.4,
        particles: particles,
      });
    }

    _update_effects() {
      const now = this.now();
      const keep = [];
      for (const e of this.effects) {
        if (now - e.t0 < e.dur) {
          // 更新粒子（与 pygame 30FPS 循环相同的每帧步进）
          for (const p of e.particles) {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.35; // 重力
          }
          keep.push(e);
        }
      }
      this.effects = keep;
    }

    _draw_effects() {
      const now = this.now();
      for (const e of this.effects) {
        const dt = (now - e.t0) / e.dur; // 0..1
        // 全屏闪光：前 30% 强闪，之后淡出
        const flash = dt < 0.3 ? Math.max(0, 1 - dt / 0.3) : 0;
        if (flash > 0) {
          this.ctx.fillStyle = `rgba(255,255,255,${(140 * flash) / 255})`;
          this.ctx.fillRect(0, 0, this.W, this.H);
        }
        // 文字：0->1 缩放放大并淡出
        const scale = 0.6 + dt * 1.2;
        const alpha = Math.max(0, 255 - Math.trunc(((dt - 0.2) / 0.8) * 255));
        if (alpha > 0) {
          this.ctx.save();
          this.ctx.globalAlpha = alpha / 255;
          this.ctx.textAlign = "center";
          this.ctx.textBaseline = "middle";
          this.ctx.translate(this.W / 2, this.H / 2 - 40);
          this.ctx.scale(scale, scale);
          // 描边
          this.ctx.font = fontStr(84);
          this.ctx.lineWidth = 6;
          this.ctx.strokeStyle = rgb([0, 0, 0]);
          this.ctx.strokeText(e.text, 0, 0);
          this.ctx.fillStyle = rgb(e.color);
          this.ctx.fillText(e.text, 0, 0);
          this.ctx.restore();
        }
        // 粒子
        for (const p of e.particles) {
          this.ctx.fillStyle = rgb(e.color);
          this.ctx.beginPath();
          this.ctx.arc(p.x, p.y, Math.max(1, Math.trunc(p.r)), 0, Math.PI * 2);
          this.ctx.fill();
          this.ctx.fillStyle = rgb([255, 240, 200]);
          this.ctx.beginPath();
          this.ctx.arc(p.x, p.y, Math.max(1, Math.trunc(p.r / 2)), 0, Math.PI * 2);
          this.ctx.fill();
        }
      }
    }

    _build_result() {
      const winner = this.gs.players[this.gs.winner_id];
      const role = this.gs.winner_role === "landlord" ? "地主" : "农民";
      const title = `第${this.round_no}局：${winner.name} 获胜（${role}）`;
      // 累计计分（零和）：地主赢则地主收两家，+2*score，两农民各 -score；
      // 农民赢则两农民各 +score，地主 -2*score。总分始终不变。
      const s = this.gs.score;
      const lid = this.gs.landlord_id;
      if (this.gs.winner_role === "landlord") {
        this.total_scores[lid] += 2 * s;
        for (let i = 0; i < 3; i++) {
          if (i !== lid) this.total_scores[i] -= s;
        }
      } else {
        this.total_scores[lid] -= 2 * s;
        for (let i = 0; i < 3; i++) {
          if (i !== lid) this.total_scores[i] += s;
        }
      }
      const detail =
        `本局得分 ${s}（叫分 ${Math.max(...this.gs.bid_scores)} 炸弹 ${this.gs.bomb_count}）\n` +
        `累计：${this.gs.players[0].name} ${this.total_scores[0]}  ` +
        `${this.gs.players[1].name} ${this.total_scores[1]}  ` +
        `${this.gs.players[2].name} ${this.total_scores[2]}`;
      this.result_popup = [title, detail];
      this.result_time = this.now();
      // 终局判定：任一玩家分数达到 100（胜利）或降到 0（失败）
      this.game_end = Math.max(...this.total_scores) >= 100 || Math.min(...this.total_scores) <= 0;
    }

    _restart() {
      /* 开始下一局：保留累计分数，重发牌并播放发牌动画。 */
      // 轮流叫地主：下一局第一个叫分的人 = 上一把地主 + 1
      const prev_landlord = this.gs.landlord_id;
      this.first_bidder = prev_landlord !== null ? (prev_landlord + 1) % 3 : 0;
      this.gs = new GameState();
      this.gs.deal(this.first_bidder);
      // 重新套用本难度对应的 AI 姓名/头像（否则会变回默认的 玩家1/2/3）
      const ai = DIFF_AI_PLAYERS[this.difficulty];
      this.gs.players[0].name = HUMAN_PLAYER[0];
      this.gs.players[1].name = ai[0][0];
      this.gs.players[2].name = ai[1][0];
      this.player_avatars = { 0: HUMAN_PLAYER[1], 1: ai[0][1], 2: ai[1][1] };
      this.round_no += 1;
      this.selected.clear();
      this.last_play_area = {};
      this.result_popup = null;
      this.result_time = null;
      this.msg = "发牌中…请叫地主";
      // 触发发牌动画
      this.dealing = true;
      this.deal_start = this.now();
    }

    /* ---------- 布局工具 ---------- */
    _hand_start_x(n) {
      const total = (n - 1) * CARD_GAP + CARD_W;
      return (this.W - total) / 2;
    }

    /* ---------- 绘制 ---------- */
    draw() {
      const ctx = this.ctx;
      // 高分屏适配：重置变换（canvas 尺寸变化会重置上下文状态）
      ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      if (this.scene === "start") {
        this._draw_start_screen();
        return;
      }
      // 渐变背景（深绿 -> 墨绿）
      const bgGrad = ctx.createLinearGradient(0, 0, 0, this.H);
      bgGrad.addColorStop(0, rgb(GREEN_DARK));
      bgGrad.addColorStop(1, "rgb(18,70,40)");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, this.W, this.H);
      // 椭圆牌桌
      ctx.fillStyle = "rgba(30,110,66,0.902)"; // (30,110,66,230)
      ctx.beginPath();
      ctx.ellipse(50 + (this.W - 100) / 2, 110 + (this.H - 240) / 2,
        (this.W - 100) / 2, (this.H - 240) / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgb(20,90,54)";
      ctx.lineWidth = 6;
      ctx.stroke();

      this._draw_top_players();
      this._draw_bottom_player();
      if (this.dealing) {
        this._draw_dealing();
      } else {
        this._draw_bottom_cards();
      }
      this._draw_play_area();
      this._draw_bottom_info();
      this._draw_message();
      this._draw_buttons();
      this._draw_effects();
      if (this.result_popup) {
        this._draw_result();
      }
      // 久坐提醒：对局阶段在左下角显示 15 分钟倒计时（浅色小字）
      this._draw_reminder();
      // 黑屏休息：覆盖全屏
      if (this.reminder_break_mode) {
        this._draw_break_screen();
      }
    }

    _draw_dealing() {
      /* 发牌动画：牌从中央牌堆飞向三家，按进度逐张飞出。 */
      const ctx = this.ctx;
      const progress = Math.min(1.0, (this.now() - this.deal_start) / this.deal_duration);
      // 中央牌堆
      const deck_x = this.W / 2 - 20;
      const deck_y = 210;
      fillRoundRect(ctx, deck_x, deck_y, 40, 56, 4, [200, 200, 210]);
      strokeRoundRect(ctx, deck_x, deck_y, 40, 56, 4, [60, 60, 60], 2);
      // 三家手牌目标位置
      const targets = {
        0: [this.W / 2 - 200, this.H - CARD_H - 68],
        1: [60, 202],
        2: [this.W - 60 - 26, 202],
      };
      // 每张牌按顺序飞出，最后 3 张为底牌（底牌展示已取消，发牌时留在牌堆中央）
      const total = 54;
      const flown = Math.trunc(progress * total);
      // 底牌落点：保持在中央牌堆（不再飞到顶部中央，避免遮挡文字）
      const bottom_pos = [[deck_x, deck_y], [deck_x, deck_y], [deck_x, deck_y]];
      for (let idx = 0; idx < flown; idx++) {
        const seq = idx % 3; // 依次发给 0/1/2
        let tx = targets[seq][0];
        let ty = targets[seq][1];
        if (idx >= 51) {
          tx = bottom_pos[idx - 51][0];
          ty = bottom_pos[idx - 51][1];
        }
        // 用进度差让每张牌有飞行感：计算该张牌自身进度
        let card_progress = (progress * total - idx) / 6.0;
        card_progress = Math.min(1.0, Math.max(0.0, card_progress));
        const cx = deck_x + (tx - deck_x) * card_progress;
        const cy = deck_y + (ty - deck_y) * card_progress;
        fillRoundRect(ctx, cx, cy, 40, 56, 4, [30, 70, 150]);
        fillRoundRect(ctx, cx + 4, cy + 4, 32, 48, 3, [120, 170, 230]);
      }
      // 提示
      drawText(ctx, "发牌中…", this.W / 2, 250, 28, GOLD, "center");
    }

    _draw_avatar(cx, cy, radius, key) {
      /* 绘制圆形头像（用图片裁剪成圆形，失败则用色块占位）。 */
      const ctx = this.ctx;
      const img = this.avatars[key];
      if (!img || !img._ok) {
        ctx.fillStyle = rgb(BTN_BLUE);
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, cx - radius, cy - radius, radius * 2, radius * 2);
      ctx.restore();
    }

    _draw_top_players() {
      const ctx = this.ctx;
      // 玩家1（左上）、玩家2（右上）：面板 + 密集手牌（牌背）展示数量
      const layout = [
        [1, 20, 136],                 // 左上，面板左对齐留边距
        [2, this.W - 20 - 172, 136],  // 右上，面板右对齐留边距（172=面板宽）
      ];
      for (const [pid, px, py] of layout) {
        const p = this.gs.players[pid];
        const role = this.gs.landlord_id === pid
          ? "地主"
          : (this.gs.landlord_id !== null ? "农民" : "");
        const is_turn = this.gs.phase === GamePhase.PLAY && this.gs.current_turn === pid;
        const panel_w = 172;
        const panel_h = 60;
        fillRoundRect(ctx, px, py, panel_w, panel_h, 10, "rgba(0,0,0,0.588)"); // (0,0,0,150)
        if (is_turn) {
          strokeRoundRect(ctx, px, py, panel_w, panel_h, 10, GOLD, 3);
        }
        // 头像圆
        this._draw_avatar(px + 24, py + 30, 18, this.player_avatars[pid] || "p01");
        // 名字 / 角色 / 剩余
        drawText(ctx, p.name, px + 50, py + 6, 20, WHITE);
        drawText(ctx, role, px + 50, py + 32, 20,
          role === "地主" ? GOLD : [180, 220, 180]);
        drawText(ctx, `剩 ${p.hand.length}`, px + 110, py + 32, 20, WHITE);
        // 密集手牌（牌背小卡），展示数量
        this._draw_opponent_hand(p, px, py + panel_h + 6, panel_w);
        if (is_turn) {
          drawText(ctx, "▶ 出牌中", px, py - 24, 20, GOLD);
        }
      }
    }

    _draw_opponent_hand(player, px, py, panel_w) {
      /* 用密集重叠的小牌背表示对手手牌数量。 */
      const ctx = this.ctx;
      const n = player.hand.length;
      if (n === 0) return;
      const bw = 26;
      const bh = 36;    // 小牌尺寸
      const overlap = 11; // 重叠后步进
      const total = Math.min(n, 14);
      const width = (total - 1) * overlap + bw;
      const start_x = px + Math.max(0, Math.trunc((panel_w - width) / 2));
      for (let i = 0; i < total; i++) {
        const x = start_x + i * overlap;
        fillRoundRect(ctx, x, py, bw, bh, 3, [30, 70, 150]);
        fillRoundRect(ctx, x + 3, py + 3, bw - 6, bh - 6, 2, [120, 170, 230]);
        strokeRoundRect(ctx, x, py, bw, bh, 3, [10, 30, 70], 1);
      }
    }

    _draw_bottom_player() {
      const ctx = this.ctx;
      const p = this.gs.players[0];
      const role = this.gs.landlord_id === 0
        ? "地主"
        : (this.gs.landlord_id !== null ? "农民" : "");
      // 人类头像
      this._draw_avatar(34, this.H - CARD_H - 100, 18, this.player_avatars[0] || "p01");
      drawText(ctx,
        `${p.name} ${role} 剩余 ${p.hand.length} 张   累计得分 ${this.total_scores[0]}`,
        60, this.H - CARD_H - 122, 20, WHITE);
      if (this.gs.phase === GamePhase.PLAY && this.gs.current_turn === 0) {
        drawText(ctx, "▶ 轮到你", 450, this.H - CARD_H - 122, 20, GOLD);
      }
    }

    _draw_bottom_cards() {
      /* 绘制自己（玩家0）的手牌，左起从大到小，选中上移高亮。 */
      const ctx = this.ctx;
      const hand = this.gs.players[0].hand;
      const n = hand.length;
      if (n === 0) return;
      const order = this._display_order(); // 权重从大到小
      this.hand_rects = [];                // 记录每张牌的绘制矩形，供点击命中
      const start_x = this._hand_start_x(n);
      const y = this.H - CARD_H - 68;
      for (let disp_idx = 0; disp_idx < order.length; disp_idx++) {
        const hand_idx = order[disp_idx];
        const x = start_x + disp_idx * CARD_GAP;
        const card = hand[hand_idx];
        const selected = this.selected.has(hand_idx);
        drawCardFace(ctx, x, y, card, selected, false);
        const oy = y + (selected ? SELECTED_Y : 0);
        this.hand_rects.push({ x: x, y: oy, w: CARD_W, h: CARD_H });
      }
      // 选中反馈改为牌面上移高亮；不再显示易乱码的文字行
    }

    _draw_play_area() {
      /* 中央出牌区展示各家最近一手，并标注出牌者姓名。 */
      const ctx = this.ctx;
      if (Object.keys(this.last_play_area).length === 0) return;
      // 三家相对位置：0 下（上移到手牌上方，避免遮挡自己的手牌），1 左，2 右
      const slots = {
        0: [this.W / 2 - 100, this.H - CARD_H - 240],
        1: [120, 266],
        2: [this.W - 120 - 5 * (CARD_W / 2), 266],
      };
      for (const [pidStr, cards] of Object.entries(this.last_play_area)) {
        const pid = Number(pidStr);
        if (!(pid in slots)) continue;
        const x = slots[pid][0];
        const y = slots[pid][1];
        // 出牌者姓名标签，避免看不清是谁出的
        const name = pid < this.gs.players.length ? this.gs.players[pid].name : "";
        drawText(ctx, name, x, y - 22, 20, WHITE);
        for (let j = 0; j < cards.length; j++) {
          drawCardFace(ctx, x + j * (CARD_W / 2 + 4), y, cards[j], false, false);
        }
      }
    }

    _draw_bottom_info() {
      /* 分数 / 局数信息 + 底牌展示。 */
      const ctx = this.ctx;
      // 底牌：仅在叫地主阶段（地主未定，landlord_id 为 None）显示，供玩家判断是否叫地主；
      // 地主确定后立即隐藏，避免与顶部文字互相遮挡。
      if (this.gs.landlord_id === null && this.gs.bottom.length > 0) {
        drawText(ctx, "底牌", this.W / 2, 120, 20, GOLD, "center");
        for (let j = 0; j < this.gs.bottom.length; j++) {
          drawCardFace(ctx, this.W / 2 - 100 + j * (CARD_W + 6), 140, this.gs.bottom[j], false, false);
        }
      }
      // 分数显示（右上角，地主确定后展示）
      if (this.gs.landlord_id !== null) {
        const base = Math.max(...this.gs.bid_scores);
        const info =
          `第${this.round_no}局  叫分 ${base}  炸弹 ${this.gs.bomb_count}  ` +
          `预计得分 ${base * Math.pow(2, this.gs.bomb_count)}`;
        const w = textWidth(ctx, info, 20);
        drawText(ctx, info, Math.max(10, this.W - w - 20), 14, 20, GOLD);
      }
    }

    _draw_message() {
      const ctx = this.ctx;
      // 顶部中央：回合提示（当前轮到谁，表明叫地主/出牌是轮流进行）
      if (this.msg_turn) {
        drawText(ctx, this.msg_turn, this.W / 2, 44, 20, GOLD, "center");
      }
      // 事件提示（最近一次叫分/出牌结果）
      if (this.msg) {
        drawText(ctx, this.msg, this.W / 2, 74, 28, WHITE, "center");
      }
    }

    /* ---------- 久坐提醒 ---------- */
    _update_reminder(now) {
      /* 按真实时间推进 15 分钟 -> 1 分钟黑屏休息的循环。 */
      const dt = now - this.reminder_last;
      this.reminder_last = now;
      if (dt <= 0) return;
      this.reminder_remaining -= dt;
      if (this.reminder_remaining > 0) return;
      // 当前阶段倒计时归零
      if (this.reminder_break_mode) {
        // 黑屏休息结束：重置 15 分钟，继续对局
        this.reminder_break_mode = false;
        this.reminder_remaining = this.reminder_play;
      } else {
        // 对局阶段结束：进入 1 分钟黑屏休息
        this.reminder_break_mode = true;
        this.reminder_remaining = this.reminder_break;
      }
    }

    _draw_reminder() {
      /* 对局阶段：左下角浅色小字显示 15 分钟倒计时（XX:XX）。 */
      if (this.reminder_break_mode) return;
      const sec = Math.max(0, Math.trunc(this.reminder_remaining));
      const mm = Math.trunc(sec / 60);
      const ss = sec % 60;
      const text = `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
      drawText(this.ctx, text, 12, this.H - 26, 20, [180, 180, 180]); // 浅灰小字
    }

    _draw_break_screen() {
      /* 黑屏休息界面：全屏黑 + '起来活动一下吧！' + 1 分钟倒计时。 */
      const ctx = this.ctx;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, this.W, this.H);
      drawText(ctx, "起来活动一下吧！", this.W / 2, this.H / 2 - 40, 40, WHITE, "center");
      const sec = Math.max(0, Math.trunc(this.reminder_remaining));
      const mm = Math.trunc(sec / 60);
      const ss = sec % 60;
      const sub = `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
      drawText(ctx, sub, this.W / 2, this.H / 2 + 20, 28, GOLD, "center");
    }

    _draw_buttons() {
      const ctx = this.ctx;
      if (this.dealing) return;
      if (this.result_popup !== null) {
        this.buttons.again.draw(ctx);
        return;
      }
      if (this.gs.phase === GamePhase.BID) {
        const active = this.gs.bid_turn === 0;
        this.buttons.bid1.draw(ctx, active);
        this.buttons.bid2.draw(ctx, active);
        this.buttons.bid3.draw(ctx, active);
        this.buttons.nobid.draw(ctx, active);
      } else if (this.gs.phase === GamePhase.PLAY) {
        const active = this.gs.current_turn === 0;
        // 人类回合判断是否有可压的牌
        let can_beat_flag = true;
        if (active && this.gs.last_play !== null) {
          [can_beat_flag] = this._player0_can_beat();
        }
        // 出牌：仅当轮到自己且（先手 或 有更大牌）时可用
        const play_enabled = active && can_beat_flag;
        this.buttons.play.draw(ctx, play_enabled);
        // 不出：仅当轮到自己且非先手
        const can_pass = active && this.gs.last_play !== null;
        this.buttons.pass.draw(ctx, can_pass);
        // 提示按钮：轮到自己时可用
        this.buttons.hint.draw(ctx, active);
        // 提示文字：是否有更大的牌（显示在按钮右侧空白处）
        let hint = null;
        let color = null;
        if (active && this.gs.last_play !== null) {
          if (can_beat_flag) {
            hint = "提示：你有更大的牌可出";
            color = [170, 255, 170];
          } else {
            hint = "提示：你没有更大的牌，默认不出";
            color = [255, 200, 120];
          }
        } else if (active) {
          hint = "提示：本轮由你先出牌";
          color = [170, 220, 255];
        }
        if (hint) {
          drawText(ctx, hint, this.W / 2 - 220 + 470, this.H - 44, 20, color);
        }
      }
    }

    _draw_result() {
      const ctx = this.ctx;
      let title = this.result_popup[0];
      let detail = this.result_popup[1];
      // 终局时覆盖标题与详情
      let bar_color = GOLD;
      if (this.game_end) {
        if (Math.max(...this.total_scores) >= 100) {
          title = "游戏胜利！";
          bar_color = GOLD;
        } else {
          title = "游戏结束";
          bar_color = BTN_RED;
        }
        detail =
          `累计分数：${this.gs.players[0].name} ${this.total_scores[0]}  ` +
          `${this.gs.players[1].name} ${this.total_scores[1]}  ` +
          `${this.gs.players[2].name} ${this.total_scores[2]}`;
      }
      // 半透明遮罩
      ctx.fillStyle = "rgba(0,0,0,0.667)"; // (0,0,0,170)
      ctx.fillRect(0, 0, this.W, this.H);
      // 弹窗
      const pw = 520;
      const ph = 280;
      const px = this.W / 2 - pw / 2;
      const py = this.H / 2 - ph / 2;
      fillRoundRect(ctx, px, py, pw, ph, 16, WHITE);
      strokeRoundRect(ctx, px, py, pw, ph, 16, bar_color, 4);
      // 顶部彩条 + 标题
      fillRoundRect(ctx, px, py, pw, 56, 16, bar_color, [true, true, false, false]);
      const t1w = textWidth(ctx, title, 40);
      drawText(ctx, title, px + (pw - t1w) / 2, py + 10, 40, BLACK);
      // 多行详情
      const lines = detail.split("\n");
      let ly = py + 84;
      for (const line of lines) {
        const t2w = textWidth(ctx, line, 20);
        drawText(ctx, line, px + (pw - t2w) / 2, ly, 20, [40, 40, 40]);
        ly += 34;
      }
      // 提示 / 倒计时
      let hint;
      if (this.game_end) {
        hint = "点击按钮返回开始界面，重新选择难度";
        this.buttons.again.text = "返回开始界面";
      } else {
        const remain = Math.max(0, this.auto_next_delay -
          (this.now() - (this.result_time === null ? this.now() : this.result_time)));
        hint = `${remain.toFixed(0)} 秒后自动开始下一局（或点击按钮）`;
        this.buttons.again.text = "再来一局";
      }
      const hw = textWidth(ctx, hint, 20);
      drawText(ctx, hint, px + (pw - hw) / 2, py + ph - 60, 20, [120, 120, 120]);
      this.buttons.again.draw(ctx);
    }

    /* ---------- 开始界面 ---------- */
    _draw_start_screen() {
      const ctx = this.ctx;
      // 牌桌渐变背景（深墨绿 -> 暗红，营造桌面质感）
      const grad = ctx.createLinearGradient(0, 0, 0, this.H);
      grad.addColorStop(0, "rgb(20,70,45)");
      grad.addColorStop(1, "rgb(60,18,22)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, this.W, this.H);

      // 顶部柔光
      ctx.fillStyle = "rgba(255,215,120,0.086)"; // (255,215,120,22)
      ctx.fillRect(0, 0, this.W, 260);

      // 标题（金色，居中，带阴影描边）
      const title = "老周家斗地主";
      const tw = textWidth(ctx, title, 40);
      drawText(ctx, title, this.W / 2 - tw / 2 + 2, 78, 40, [40, 28, 0]);
      drawText(ctx, title, this.W / 2 - tw / 2, 76, 40, GOLD);
      // 标题装饰双线
      const lw = 220;
      ctx.strokeStyle = rgb(GOLD);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(this.W / 2 - lw, 124);
      ctx.lineTo(this.W / 2 - 40, 124);
      ctx.moveTo(this.W / 2 + 40, 124);
      ctx.lineTo(this.W / 2 + lw, 124);
      ctx.stroke();
      ctx.fillStyle = rgb(GOLD);
      ctx.beginPath();
      ctx.arc(this.W / 2, 124, 5, 0, Math.PI * 2);
      ctx.fill();

      // 副标题
      drawText(ctx, "选择难度开始游戏", this.W / 2, 148, 28, [235, 230, 215], "center");

      // 三个难度卡片：仅展示难度名称 + 三个头像（无姓名、无说明）
      const accent = {
        easy: [90, 200, 120],
        normal: [240, 200, 80],
        hard: [230, 90, 90],
      };
      for (const panel of this.start_panels) {
        const col = accent[panel.diff];
        // 卡片底（半透明深色 + 圆角）
        fillRoundRect(ctx, panel.x, panel.y, panel.w, panel.h, 16, "rgba(10,18,14,0.824)"); // (10,18,14,210)
        // 外描边（难度配色）
        strokeRoundRect(ctx, panel.x, panel.y, panel.w, panel.h, 16, col, 3);
        // 左侧色条
        fillRoundRect(ctx, panel.x, panel.y, 8, panel.h, 16, col, [true, false, false, true]);

        // 难度名称（居中）
        drawText(ctx, DIFF_LABEL[panel.diff], panel.x + panel.w / 2, panel.y + 10, 28, col, "center");

        // 三个头像（你 + 两个 AI），横向居中排列，无文字
        const players = [HUMAN_PLAYER[1]].concat(DIFF_AI_PLAYERS[panel.diff].map((ai) => ai[1]));
        const total = players.length;
        const gap = 80;
        const start_x = panel.x + panel.w / 2 - ((total - 1) * gap) / 2;
        const cy = panel.y + 64;
        for (let j = 0; j < total; j++) {
          const cx = start_x + j * gap;
          this._draw_avatar(cx, cy, 23, players[j]);
          // 头像外圈描边
          ctx.strokeStyle = "rgba(255,255,255,0.235)"; // (255,255,255,60)
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy, 24, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // 底部提示
      drawText(ctx, "点击卡片选择难度", this.W / 2, this.H - 28, 20, [200, 210, 200], "center");
    }
  }

  global.GameUI = GameUI;
})(typeof window !== "undefined" ? window : globalThis);
