/* AI 出牌策略——对应 win/ai_player.py（含三档难度系统）
 *
 * 难度说明：
 * - EASY   简单：乱抢地主、有牌就压、有炸就炸、完全不记牌、无农民配合
 * - NORMAL 中等：基于牌力叫分、优先弱势牌型、对手残血才炸、记关键大牌、农民有配合
 * - HARD   困难：精准牌力评估、主动拆牌组牌路、关键轮次才炸、记全牌、强农民配合
 *
 * 对外接口（与 Python 版一致）：
 * - ai_bid(gs, pid, diff)        返回叫分 0/1/2/3
 * - choose_action(gs, pid, diff) -> [cards, is_pass]
 */
(function (global) {
  "use strict";

  const { RANK_VALUE, Play, CardType, can_beat, RANK_VALUE_OF } = global;

  const Difficulty = {
    EASY: "easy",
    NORMAL: "normal",
    HARD: "hard",
    MEDIUM: "normal", // 兼容旧调用中的 MEDIUM 别名
  };

  /* 把字符串或枚举统一成 Difficulty，兼容旧调用（如 'medium'） */
  function _norm(d) {
    if (d === Difficulty.EASY || d === Difficulty.NORMAL || d === Difficulty.HARD) return d;
    return {
      easy: Difficulty.EASY,
      medium: Difficulty.NORMAL,
      normal: Difficulty.NORMAL,
      hard: Difficulty.HARD,
    }[String(d).toLowerCase()] || Difficulty.NORMAL;
  }

  /* 返回 (Play, null)。非法返回 (null, 'err')。 */
  function parse_type(cards) {
    if (!cards || cards.length === 0) return [null, "empty"];
    const p = new Play(cards);
    if (!p.valid) return [null, "invalid"];
    return [p, null];
  }

  /* cards 能否压过 prev_cards。返回 (bool, err)。 */
  function compare_type(cards, prev_cards) {
    if (!cards || cards.length === 0) return [false, "empty"];
    const curr = new Play(cards);
    if (!curr.valid) return [false, "invalid"];
    const prev = prev_cards && prev_cards.length ? new Play(prev_cards) : null;
    return [can_beat(prev, curr), null];
  }

  /* 把一批牌按点数分组：rank -> [Card, ...]（Map 保留插入顺序，与 Python defaultdict 一致） */
  function _group(hand) {
    const g = new Map();
    for (const c of hand) {
      if (!g.has(c.rank)) g.set(c.rank, []);
      g.get(c.rank).push(c);
    }
    return g;
  }

  function _rv(rank) {
    return RANK_VALUE[rank];
  }

  /* 手牌中四张相同的点数列表 */
  function _bomb_ranks(hand) {
    const res = [];
    for (const [r, cs] of _group(hand)) {
      if (cs.length === 4) res.push(r);
    }
    return res;
  }

  function _has_rocket(hand) {
    const ranks = new Set(hand.map((c) => c.rank));
    return ranks.has("BJ") && ranks.has("RJ");
  }

  function _smallest_single(hand) {
    let best = hand[0];
    for (const c of hand) {
      if (c.value < best.value) best = c; // 严格小于：取第一张最小牌
    }
    return [best];
  }

  function _smallest_pair(hand) {
    const g = _group(hand);
    const pairs = [...g.keys()].filter((r) => g.get(r).length >= 2).sort((a, b) => _rv(a) - _rv(b));
    if (pairs.length === 0) return null;
    return g.get(pairs[0]).slice(0, 2);
  }

  /* 为带牌挑一张单牌（尽量不拆对/炸），排除 exclude_ranks */
  function _pick_kicker_single(hand, exclude_ranks) {
    const g = _group(hand);
    // 优先用孤张
    const lonely = [...g.keys()].filter((r) => g.get(r).length === 1 && !exclude_ranks.has(r));
    if (lonely.length > 0) {
      const r = lonely.sort((a, b) => _rv(a) - _rv(b))[0];
      return [g.get(r)[0]];
    }
    // 否则用最小的非炸弹点数的一张
    const cand = [...g.keys()].filter((r) => !exclude_ranks.has(r) && g.get(r).length < 4);
    if (cand.length === 0) return null;
    const r = cand.sort((a, b) => _rv(a) - _rv(b))[0];
    return [g.get(r)[0]];
  }

  /* 为带牌挑一对，排除 exclude_ranks */
  function _pick_kicker_pair(hand, exclude_ranks) {
    const g = _group(hand);
    const cand = [...g.keys()].filter((r) => g.get(r).length >= 2 && !exclude_ranks.has(r));
    if (cand.length === 0) return null;
    const r = cand.sort((a, b) => _rv(a) - _rv(b))[0];
    return g.get(r).slice(0, 2);
  }

  /* 返回所有长度为 length 的顺子（单牌），点数 3..A 连续，不含 2/王 */
  function _straight_runs(hand, length) {
    const g = _group(hand);
    const avaix = [...g.keys()].filter((r) => r !== "2" && r !== "BJ" && r !== "RJ").map(_rv).sort((a, b) => a - b);
    const res = [];
    for (let start = 3; start <= 15 - length; start++) { // 3..14(A)
      const vals = [];
      for (let v = start; v < start + length; v++) vals.push(v);
      if (vals.every((v) => avaix.includes(v))) {
        const cards = [];
        for (const v of vals) {
          const rank = [...g.keys()].find((r) => _rv(r) === v);
          cards.push(g.get(rank)[0]);
        }
        res.push(cards);
      }
    }
    return res;
  }

  /* 返回所有长度为 k 对的连对 */
  function _straight_pair_runs(hand, k) {
    const g = _group(hand);
    const avai = [...g.keys()]
      .filter((r) => g.get(r).length >= 2 && r !== "2" && r !== "BJ" && r !== "RJ")
      .map(_rv).sort((a, b) => a - b);
    const res = [];
    for (let start = 3; start <= 15 - k; start++) {
      const vals = [];
      for (let v = start; v < start + k; v++) vals.push(v);
      if (vals.every((v) => avai.includes(v))) {
        const cards = [];
        for (const v of vals) {
          const rank = [...g.keys()].find((r) => _rv(r) === v);
          cards.push(...g.get(rank).slice(0, 2));
        }
        res.push(cards);
      }
    }
    return res;
  }

  /* 返回所有长度为 k 组的连续三张（飞机主体） */
  function _consec_triple_runs(hand, k) {
    const g = _group(hand);
    const avai = [...g.keys()]
      .filter((r) => g.get(r).length >= 3 && r !== "2" && r !== "BJ" && r !== "RJ")
      .map(_rv).sort((a, b) => a - b);
    const res = [];
    for (let start = 3; start <= 15 - k; start++) {
      const vals = [];
      for (let v = start; v < start + k; v++) vals.push(v);
      if (vals.every((v) => avai.includes(v))) {
        const cards = [];
        for (const v of vals) {
          const rank = [...g.keys()].find((r) => _rv(r) === v);
          cards.push(...g.get(rank).slice(0, 3));
        }
        res.push(cards);
      }
    }
    return res;
  }

  /* 返回能压过 target 的所有候选出牌（列表的列表），按 (牌数, 主权重) 升序 */
  function candidates_to_beat(hand, target, keep_bomb = true) {
    const res = [];
    const g = _group(hand);
    const t = target.card_type;
    const mv = target.main_value;

    // ---- 普通牌型 ----
    if (t === CardType.SINGLE) {
      for (const c of hand) {
        if (c.value > mv) res.push([c]);
      }
    } else if (t === CardType.PAIR) {
      for (const [r, cs] of g) {
        if (cs.length >= 2 && _rv(r) > mv) res.push(cs.slice(0, 2));
      }
    } else if (t === CardType.TRIPLE) {
      for (const [r, cs] of g) {
        if (cs.length >= 3 && _rv(r) > mv) res.push(cs.slice(0, 3));
      }
    } else if (t === CardType.TRIPLE_ONE) {
      for (const [r, cs] of g) {
        if (cs.length >= 3 && _rv(r) > mv) {
          const k = _pick_kicker_single(hand, new Set([r]));
          if (k) res.push([...cs.slice(0, 3), ...k]);
        }
      }
    } else if (t === CardType.TRIPLE_TWO) {
      for (const [r, cs] of g) {
        if (cs.length >= 3 && _rv(r) > mv) {
          const k = _pick_kicker_pair(hand, new Set([r]));
          if (k) res.push([...cs.slice(0, 3), ...k]);
        }
      }
    } else if (t === CardType.STRAIGHT) {
      for (const run of _straight_runs(hand, target.length)) {
        if (Math.max(...run.map((c) => c.value)) > mv) res.push(run);
      }
    } else if (t === CardType.STRAIGHT_PAIR) {
      for (const run of _straight_pair_runs(hand, target.length)) {
        if (Math.max(...run.map((c) => c.value)) > mv) res.push(run);
      }
    } else if (t === CardType.AIRPLANE) {
      for (const run of _consec_triple_runs(hand, target.length)) {
        if (Math.max(...run.map((c) => c.value)) > mv) res.push(run);
      }
    } else if (t === CardType.AIRPLANE_ONE) {
      for (const run of _consec_triple_runs(hand, target.length)) {
        const triple_ranks = new Set(run.map((c) => c.rank));
        // 需要 length 张单（带 length 个单）
        const kickers = [];
        const tmp = hand.filter((c) => !triple_ranks.has(c.rank));
        // 选最小若干张单（允许拆但对 AI 来说够用）
        tmp.sort((a, b) => a.value - b.value);
        if (tmp.length >= target.length) res.push([...run, ...tmp.slice(0, target.length)]);
      }
    } else if (t === CardType.AIRPLANE_TWO) {
      for (const run of _consec_triple_runs(hand, target.length)) {
        const triple_ranks = new Set(run.map((c) => c.rank));
        // 选 length 个对子
        const g2 = _group(hand.filter((c) => !triple_ranks.has(c.rank)));
        const pairs = [...g2.keys()].filter((r) => g2.get(r).length >= 2).sort((a, b) => _rv(a) - _rv(b));
        if (pairs.length >= target.length) {
          const kickers = [];
          for (const r of pairs.slice(0, target.length)) {
            kickers.push(...g2.get(r).slice(0, 2));
          }
          res.push([...run, ...kickers]);
        }
      }
    } else if (t === CardType.FOUR_TWO) {
      // 四带二只能同型比较，这里只比主权重更高的四带二
      for (const [r, cs] of g) {
        if (cs.length === 4 && _rv(r) > mv) {
          const rest = hand.filter((c) => c.rank !== r);
          if (rest.length >= 2) res.push([...cs, ...rest.slice(0, 2)]);
        }
      }
    }

    // ---- 炸弹 / 王炸 ----
    if (t !== CardType.BOMB && t !== CardType.ROCKET) {
      // 普通/四带二 牌型：任意炸弹或王炸都能压
      if (!keep_bomb) {
        for (const r of _bomb_ranks(hand)) {
          res.push(g.get(r).slice(0, 4));
        }
      }
      if (_has_rocket(hand)) {
        res.push(hand.filter((c) => c.rank === "BJ" || c.rank === "RJ"));
      }
    } else if (t === CardType.BOMB) {
      // 炸弹之间比权重
      if (!keep_bomb) {
        for (const r of _bomb_ranks(hand)) {
          if (_rv(r) > mv) res.push(g.get(r).slice(0, 4));
        }
      }
      if (_has_rocket(hand) && mv < 100) {
        res.push(hand.filter((c) => c.rank === "BJ" || c.rank === "RJ"));
      }
    }

    // 排序：优先牌数少、再主权重小（出最小能压的）
    const _key = (cards) => {
      const p = new Play(cards);
      return [cards.length, p.valid ? p.main_value : 999];
    };
    res.sort((a, b) => {
      const ka = _key(a);
      const kb = _key(b);
      if (ka[0] !== kb[0]) return ka[0] - kb[0];
      return ka[1] - kb[1];
    });
    return res;
  }

  // ---------------------------------------------------------------------------
  // 公共辅助：角色 / 队友 / 残血
  // ---------------------------------------------------------------------------
  function _role_of(gs, pid) {
    return gs.landlord_id === pid ? "landlord" : "farmer";
  }

  function _teammate_and_opponents(gs, pid) {
    if (gs.landlord_id === pid) {
      const opponents = [];
      for (let i = 0; i < 3; i++) if (i !== pid) opponents.push(i);
      return [null, opponents];
    }
    let teammate = null;
    for (let i = 0; i < 3; i++) {
      if (i !== pid && i !== gs.landlord_id) { teammate = i; break; }
    }
    return [teammate, [gs.landlord_id]];
  }

  function _min_opponent_hand(gs, pid) {
    const [, opponents] = _teammate_and_opponents(gs, pid);
    return Math.min(...opponents.map((o) => gs.players[o].hand.length));
  }

  /* 上一次出牌的是队友（农民配合用） */
  function _is_teammate_lead(gs, pid) {
    if (gs.last_play_owner === null) return false;
    return (
      gs.last_play_owner !== gs.landlord_id &&
      pid !== gs.landlord_id &&
      gs.last_play_owner !== pid
    );
  }

  // ===========================================================================
  // 一、叫地主策略（按难度分支）
  // ===========================================================================
  /* 简单难度叫分：随机叫分，30% 概率乱抢 3 分，不评估牌力 */
  function bid_easy(gs, pid) {
    if (Math.random() < 0.30) return 3;
    return Math.floor(Math.random() * 4); // random.choice([0,1,2,3])
  }

  /* 粗略牌力评分（0~100+），NORMAL/HARD 共用基础 */
  function _hand_strength(hand) {
    let score = 0.0;
    const g = _group(hand);
    if (g.has("RJ")) score += 12;
    if (g.has("BJ")) score += 10;
    score += (g.get("2") || []).length * 6;
    score += [...g.values()].filter((cs) => cs.length === 4).length * 10; // 炸弹
    score += (g.get("A") || []).length * 3;
    score += (g.get("K") || []).length * 1.5;
    const singles = [...g.keys()].filter(
      (r) => g.get(r).length === 1 && r !== "BJ" && r !== "RJ"
    ).length;
    score -= singles * 1.2;
    return score;
  }

  /* 中等难度叫分：有王炸/2个以上炸弹才叫3分，牌力一般叫1分，差牌不叫 */
  function bid_normal(gs, pid) {
    const hand = gs.players[pid].hand;
    const g = _group(hand);
    const bombs = [...g.keys()].filter((r) => g.get(r).length === 4);
    const rocket = _has_rocket(hand);
    const strength = _hand_strength(hand);
    if (rocket || bombs.length >= 2) return 3;
    if (strength >= 35) return 2;
    if (strength >= 18) return 1;
    return 0;
  }

  /* 困难难度叫分：综合评估炸弹数/王/2/牌型完整度/散牌，分数精确匹配牌力 */
  function bid_hard(gs, pid) {
    const hand = gs.players[pid].hand;
    const g = _group(hand);
    const bombs = [...g.keys()].filter((r) => g.get(r).length === 4);
    const rocket = _has_rocket(hand);
    let strength = _hand_strength(hand);
    // 牌型完整度：长顺子潜力加分
    const vals = [...g.keys()]
      .filter((r) => r !== "BJ" && r !== "RJ" && r !== "2")
      .map(_rv).sort((a, b) => a - b);
    let run = 1;
    let best = 1;
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] === vals[i - 1] + 1) {
        run += 1;
        best = Math.max(best, run);
      } else {
        run = 1;
      }
    }
    if (best >= 5) strength += 8;
    if (rocket) strength += 8;
    strength += bombs.length * 6;
    if (strength < 22) return 0;
    if (strength >= 55) return 3;
    if (strength >= 38) return 2;
    return 1;
  }

  function ai_bid(gs, pid, difficulty = Difficulty.NORMAL) {
    const d = _norm(difficulty);
    let score;
    if (d === Difficulty.EASY) {
      score = bid_easy(gs, pid);
    } else if (d === Difficulty.HARD) {
      score = bid_hard(gs, pid);
    } else {
      score = bid_normal(gs, pid);
    }
    // 遵守叫分规则：必须高于当前最高分，否则不叫(0)
    const max_score = Math.max(...(gs.bid_scores || [0]));
    if (score > max_score) return score;
    return 0;
  }

  // ===========================================================================
  // 二、炸弹使用决策（按难度分支）
  // ===========================================================================
  /* 简单难度：只要炸弹能压住就炸，不看时机、不看剩余牌 */
  function bomb_easy(gs, pid, target) {
    return true;
  }

  /* 中等难度：对手剩 <=4 张才炸；或自己能一次跑完才炸；不炸无关小牌 */
  function bomb_normal(gs, pid, target) {
    if (target === null) return false;
    const min_opp = _min_opponent_hand(gs, pid);
    if (min_opp <= 4) return true;
    const hand = gs.players[pid].hand;
    if (hand.length === 4 && _bomb_ranks(hand).length > 0) return true;
    return false;
  }

  /* 困难难度：关键轮次才炸，估算对手有没有炸；地主/农民策略不同 */
  function bomb_hard(gs, pid, target) {
    if (target === null) return false;
    const role = _role_of(gs, pid);
    const my_hand = gs.players[pid].hand.length;
    const min_opp = _min_opponent_hand(gs, pid);
    const [tm] = _teammate_and_opponents(gs, pid);
    // 队友快跑赢时不炸，把机会让给队友
    if (tm !== null && gs.players[tm].hand.length <= 2) return false;
    // 地主快赢时必炸
    if (role === "landlord" && my_hand <= 4) return true;
    // 农民判断地主快赢：地主剩 <=2 张时必炸拦截
    if (role === "farmer" && gs.players[gs.landlord_id].hand.length <= 2) return true;
    if (role === "landlord") {
      if (my_hand > 6) return false; // 地主剩牌多不轻易炸，留炸防春天
      return min_opp <= 3;
    }
    return min_opp <= 3;
  }

  function _use_bomb(gs, pid, target, d) {
    if (d === Difficulty.EASY) return bomb_easy(gs, pid, target);
    if (d === Difficulty.HARD) return bomb_hard(gs, pid, target);
    return bomb_normal(gs, pid, target);
  }

  // ===========================================================================
  // 三、先手出牌（按难度分支）
  // ===========================================================================
  /* 简单难度先手：有牌就出，打最小单张，不考虑后续 */
  function lead_easy(gs, pid) {
    return _smallest_single(gs.players[pid].hand);
  }

  /* 中等难度先手：优先出弱势牌型（小单牌、小对子），不主动拆牌。
   * 手中有对子时优先甩最小的对子（让对子能流动起来），否则出最小单张。 */
  function lead_normal(gs, pid) {
    const hand = gs.players[pid].hand;
    const pair = _smallest_pair(hand);
    if (pair !== null) return pair;
    return _smallest_single(hand);
  }

  /* 困难难度先手：提前规划牌路，优先处理散牌、保留压制力；能一手走光直接走 */
  function lead_hard(gs, pid) {
    const hand = gs.players[pid].hand;
    // 1) 整手能一次走光就直接走
    if (new Play(hand).valid) return hand;
    const g = _group(hand);
    // 2) 优先甩最小的对子（让对子流动），而非一直出单张
    const pair = _smallest_pair(hand);
    if (pair !== null) return pair;
    // 3) 没有对子：打最小单张散牌里最小且非 2/王 的，保留大牌压制
    const singles = [...g.keys()]
      .filter((r) => g.get(r).length === 1 && r !== "BJ" && r !== "RJ" && r !== "2")
      .sort((a, b) => _rv(a) - _rv(b));
    if (singles.length > 0) {
      const r = singles[0];
      return [g.get(r)[0]];
    }
    // 4) 兜底：最小单张
    return _smallest_single(hand);
  }

  // ===========================================================================
  // 四、跟牌出牌（按难度分支）
  // ===========================================================================
  /* 简单难度跟牌：有能压的牌就压（含炸弹），压不住直接 Pass，从不拆牌 */
  function follow_easy(gs, pid, target, d) {
    const hand = gs.players[pid].hand;
    // keep_bomb=false：把炸弹也当成可压手段（有炸就炸）
    const cands = candidates_to_beat(hand, target, false);
    return cands.length > 0 ? cands[0] : [];
  }

  /* 中等难度跟牌：能压就压最小牌型；炸弹保留（对手残血才炸）；队友先手不压 */
  function follow_normal(gs, pid, target, d) {
    const hand = gs.players[pid].hand;
    // 农民配合：队友先手出的牌不压
    if (_is_teammate_lead(gs, pid)) return [];
    const cands = candidates_to_beat(hand, target, true);
    if (cands.length > 0) return cands[0];
    // 压不住：考虑炸弹（对手残血才炸 / 自己能跑）
    if (_use_bomb(gs, pid, target, d)) {
      const bombs = _bomb_ranks(hand).sort((a, b) => _rv(a) - _rv(b));
      if (bombs.length > 0) return _group(hand).get(bombs[0]).slice(0, 4);
      if (_has_rocket(hand)) return hand.filter((c) => c.rank === "BJ" || c.rank === "RJ");
    }
    return [];
  }

  /* 困难难度跟牌：可主动拆牌组顺子/连对/飞机；关键轮才炸；强农民配合 */
  function follow_hard(gs, pid, target, d) {
    const hand = gs.players[pid].hand;
    const [tm] = _teammate_and_opponents(gs, pid);
    // 农民配合：队友正在跑牌（剩 <=3 张）且不必拦截地主时不抢
    if (tm !== null && gs.players[tm].hand.length <= 3 && !_must_block(gs, pid)) {
      return [];
    }
    // 普通跟牌：candidates_to_beat 已能拆牌找顺子/连对/飞机
    const cands = candidates_to_beat(hand, target, true);
    if (cands.length > 0) return cands[0];
    // 压不住：关键轮次才炸
    if (_use_bomb(gs, pid, target, d)) {
      const bombs = _bomb_ranks(hand).sort((a, b) => _rv(a) - _rv(b));
      if (bombs.length > 0) return _group(hand).get(bombs[0]).slice(0, 4);
      if (_has_rocket(hand)) return hand.filter((c) => c.rank === "BJ" || c.rank === "RJ");
    }
    return [];
  }

  /* 地主即将走光，必须拦截 */
  function _must_block(gs, pid) {
    return pid !== gs.landlord_id && gs.players[gs.landlord_id].hand.length <= 2;
  }

  // ===========================================================================
  // 五、总入口
  // ===========================================================================
  /* 返回 [要出的牌列表, 是否 Pass]。先手时返回 (牌, False)。 */
  function choose_action(gs, player_id, difficulty = Difficulty.NORMAL) {
    const d = _norm(difficulty);
    const hand = gs.players[player_id].hand;

    // 先手：自己决定出什么
    if (gs.last_play === null || gs.last_play_owner === player_id) {
      let cards;
      if (d === Difficulty.EASY) {
        cards = lead_easy(gs, player_id);
      } else if (d === Difficulty.HARD) {
        cards = lead_hard(gs, player_id);
      } else {
        cards = lead_normal(gs, player_id);
      }
      return [cards && cards.length ? cards : _smallest_single(hand), false];
    }

    // 跟牌：上家牌型就是 gs.last_play（已是 Play 对象）
    const target = gs.last_play;
    if (target === null || !target.valid) return [[], true];
    let cards;
    if (d === Difficulty.EASY) {
      cards = follow_easy(gs, player_id, target, d);
    } else if (d === Difficulty.HARD) {
      cards = follow_hard(gs, player_id, target, d);
    } else {
      cards = follow_normal(gs, player_id, target, d);
    }

    if (!cards || cards.length === 0) return [[], true];
    // 二次校验合法性
    if (!can_beat(target, new Play(cards))) return [[], true];
    return [cards, false];
  }

  /* 兼容旧接口：直接复用中等难度逻辑 */
  function simple_legal_play(gs, player_id) {
    return choose_action(gs, player_id, Difficulty.NORMAL);
  }

  /* 返回能压过 target 的最小一组牌；压不过返回 null（供 UI 提示用） */
  function find_beats(hand, target, keep_bomb = true) {
    if (target === null || target === undefined || !target.valid) return null;
    const cands = candidates_to_beat(hand, target, keep_bomb);
    return cands.length > 0 ? cands[0] : null;
  }

  global.Difficulty = Difficulty;
  global.parse_type = parse_type;
  global.compare_type = compare_type;
  global.ai_bid = ai_bid;
  global.choose_action = choose_action;
  global.simple_legal_play = simple_legal_play;
  global.find_beats = find_beats;
  global._has_rocket = _has_rocket;
  global._bomb_ranks = _bomb_ranks;
  global._group = _group;
})(typeof window !== "undefined" ? window : globalThis);
