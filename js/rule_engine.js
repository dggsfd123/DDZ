/* 核心规则引擎——对应 win/rule_engine.py
 *
 * 牌型判定、大小比较、出牌合法性校验。
 * 牌型枚举（CardType）:
 *    SINGLE      单张          PAIR        对子
 *    TRIPLE      三张          TRIPLE_ONE  三带一
 *    TRIPLE_TWO  三带二        STRAIGHT    顺子（>=5 张连续单牌）
 *    STRAIGHT_PAIR 连对        AIRPLANE    飞机（>=2 组连续三张）
 *    AIRPLANE_ONE 飞机带单      AIRPLANE_TWO 飞机带双
 *    BOMB        炸弹          FOUR_TWO    四带二
 *    ROCKET      王炸          INVALID     非法
 */
(function (global) {
  "use strict";

  const { RANK_VALUE } = global;

  const CardType = {
    SINGLE: "single",
    PAIR: "pair",
    TRIPLE: "triple",
    TRIPLE_ONE: "triple_one",
    TRIPLE_TWO: "triple_two",
    STRAIGHT: "straight",
    STRAIGHT_PAIR: "straight_pair",
    AIRPLANE: "airplane",
    AIRPLANE_ONE: "airplane_one",
    AIRPLANE_TWO: "airplane_two",
    BOMB: "bomb",
    FOUR_TWO: "four_two",
    ROCKET: "rocket",
    INVALID: "invalid",
  };

  // 顺子/连对/飞机中不能出现的点数（2 和 王不参与）
  // 注意：A 的权重为 14，可参与 10JQKA（10=10, J=11, Q=12, K=13, A=14）
  const NON_SEQUENCE_RANKS = ["2", "BJ", "RJ"];

  /* 对应 Python collections.Counter(ranks)：保留首次插入顺序的计数 Map */
  function counterOf(ranks) {
    const m = new Map();
    for (const r of ranks) {
      m.set(r, (m.get(r) || 0) + 1);
    }
    return m;
  }

  class Play {
    constructor(cards) {
      this.cards = cards.slice();
      this.card_type = CardType.INVALID;
      this.main_value = 0;
      this.length = this.cards.length;
      this.valid = false;
      this._parse();
    }

    _parse() {
      const cards = this.cards;
      const n = cards.length;
      if (n === 0) return;
      const values = cards.map((c) => c.value);
      const ranks = cards.map((c) => c.rank);
      const cnt = counterOf(ranks);

      // 王炸
      if (n === 2 && cnt.has("BJ") && cnt.has("RJ")) {
        this.card_type = CardType.ROCKET;
        this.main_value = Math.max(...values);
        this.valid = true;
        return;
      }

      // 单张
      if (n === 1) {
        this.card_type = CardType.SINGLE;
        this.main_value = values[0];
        this.valid = true;
        return;
      }

      // 对子
      if (n === 2 && cnt.size === 1) {
        this.card_type = CardType.PAIR;
        this.main_value = values[0];
        this.valid = true;
        return;
      }

      // 炸弹
      if (n === 4 && cnt.size === 1) {
        this.card_type = CardType.BOMB;
        this.main_value = values[0];
        this.valid = true;
        return;
      }

      // 三张
      if (n === 3 && cnt.size === 1) {
        this.card_type = CardType.TRIPLE;
        this.main_value = values[0];
        this.valid = true;
        return;
      }

      // 三带一
      if (n === 4) {
        const triple_rank = Play._find_rank_with_count(cnt, 3);
        if (triple_rank !== null && cnt.size === 2) {
          this.card_type = CardType.TRIPLE_ONE;
          this.main_value = RANK_VALUE_OF(triple_rank);
          this.valid = true;
          return;
        }
      }

      // 三带二（三张 + 一对）
      if (n === 5) {
        const triple_rank = Play._find_rank_with_count(cnt, 3);
        const pair_rank = Play._find_rank_with_count(cnt, 2);
        if (triple_rank !== null && pair_rank !== null && cnt.size === 2) {
          this.card_type = CardType.TRIPLE_TWO;
          this.main_value = RANK_VALUE_OF(triple_rank);
          this.valid = true;
          return;
        }
      }

      // 顺子：>=5 张连续单牌
      if (n >= 5 && cnt.size === n && Play._is_consecutive(values, cnt)) {
        this.card_type = CardType.STRAIGHT;
        this.main_value = Math.max(...values);
        this.valid = true;
        return;
      }

      // 连对：>=3 对连续对子
      if (n >= 6 && n % 2 === 0 && [...cnt.values()].every((v) => v === 2)) {
        if (Play._is_consecutive_pair(cnt)) {
          this.card_type = CardType.STRAIGHT_PAIR;
          this.main_value = Math.max(...values);
          this.valid = true;
          this.length = n / 2;
          return;
        }
      }

      // 飞机（纯三张连续）：>=2 组连续三张
      if (n >= 6 && n % 3 === 0 && [...cnt.values()].every((v) => v === 3)) {
        if (Play._is_consecutive_triple(cnt)) {
          this.card_type = CardType.AIRPLANE;
          this.main_value = Math.max(...values);
          this.valid = true;
          this.length = n / 3;
          return;
        }
      }

      // 飞机带单：三张组 k 组 + k 张单（k>=2）
      if (n >= 8) {
        const triple_rank = Play._find_ranks_with_count(cnt, 3);
        if (triple_rank.length >= 2) {
          const k = triple_rank.length;
          const tripleMap = new Map();
          for (const r of triple_rank) tripleMap.set(r, 3);
          if (Play._is_consecutive_triple(tripleMap)) {
            // 剩余牌数应为 k（带单）或 2k（带双）
            if (n === k * 4) { // 带单：3k + k
              this.card_type = CardType.AIRPLANE_ONE;
              this.main_value = RANK_VALUE_OF(
                triple_rank.reduce((a, b) => (RANK_VALUE_OF(a) >= RANK_VALUE_OF(b) ? a : b))
              );
              this.valid = true;
              this.length = k;
              return;
            }
            if (n === k * 5) { // 带双：3k + 2k
              // 剩余必须全为对子
              const remaining = new Map();
              for (const [r, c] of cnt) {
                if (!triple_rank.includes(r)) remaining.set(r, c);
              }
              if ([...remaining.values()].every((v) => v === 2) && remaining.size === k) {
                this.card_type = CardType.AIRPLANE_TWO;
                this.main_value = RANK_VALUE_OF(
                  triple_rank.reduce((a, b) => (RANK_VALUE_OF(a) >= RANK_VALUE_OF(b) ? a : b))
                );
                this.valid = true;
                this.length = k;
                return;
              }
            }
          }
        }
      }

      // 四带二：四张 + 2 单（或 2 对）
      if (n === 6) {
        const four_rank = Play._find_rank_with_count(cnt, 4);
        if (four_rank !== null) {
          this.card_type = CardType.FOUR_TWO;
          this.main_value = RANK_VALUE_OF(four_rank);
          this.valid = true;
          return;
        }
      }
      if (n === 8) {
        const four_rank = Play._find_rank_with_count(cnt, 4);
        // 四带两对：4 + 2对
        if (four_rank !== null) {
          let ok = true;
          for (const [r, v] of cnt) {
            if (r !== four_rank && v !== 2) { ok = false; break; }
          }
          if (ok) {
            this.card_type = CardType.FOUR_TWO;
            this.main_value = RANK_VALUE_OF(four_rank);
            this.valid = true;
            return;
          }
        }
      }
    }

    /* ---------- 辅助方法 ---------- */

    static _find_rank_with_count(cnt, count) {
      for (const [r, c] of cnt) {
        if (c === count) return r;
      }
      return null;
    }

    static _find_ranks_with_count(cnt, count) {
      const res = [];
      for (const [r, c] of cnt) {
        if (c === count) res.push(r);
      }
      return res;
    }

    /* 判断是否连续单牌（无重复、无 2/王，且差值连续） */
    static _is_consecutive(values, cnt) {
      for (const r of cnt.keys()) {
        if (NON_SEQUENCE_RANKS.includes(r)) return false;
      }
      const uniq = [...new Set(values)].sort((a, b) => a - b);
      if (uniq.length !== cnt.size) return false; // 有重复点数
      for (let i = 1; i < uniq.length; i++) {
        if (uniq[i] - uniq[i - 1] !== 1) return false;
      }
      return true;
    }

    /* 连对：所有点数为对子且连续，2/王不可参与 */
    static _is_consecutive_pair(cnt) {
      for (const r of cnt.keys()) {
        if (NON_SEQUENCE_RANKS.includes(r)) return false;
      }
      // cnt 的 key 是 rank 字符串，需转换为 value
      const value_list = [...cnt.keys()].map(RANK_VALUE_OF).sort((a, b) => a - b);
      for (let i = 1; i < value_list.length; i++) {
        if (value_list[i] - value_list[i - 1] !== 1) return false;
      }
      return true;
    }

    /* 飞机：所有点数为三张且连续，2/王不可参与 */
    static _is_consecutive_triple(cnt) {
      for (const r of cnt.keys()) {
        if (NON_SEQUENCE_RANKS.includes(r)) return false;
      }
      if (![...cnt.values()].every((v) => v === 3)) return false;
      const value_list = [...cnt.keys()].map(RANK_VALUE_OF).sort((a, b) => a - b);
      for (let i = 1; i < value_list.length; i++) {
        if (value_list[i] - value_list[i - 1] !== 1) return false;
      }
      return true;
    }
  }

  function RANK_VALUE_OF(rank) {
    return RANK_VALUE[rank];
  }

  // 普通牌型集合（非炸弹/王炸/四带二）
  const _COMPARABLE_NORMAL = new Set([
    CardType.SINGLE, CardType.PAIR, CardType.TRIPLE, CardType.TRIPLE_ONE,
    CardType.TRIPLE_TWO, CardType.STRAIGHT, CardType.STRAIGHT_PAIR,
    CardType.AIRPLANE, CardType.AIRPLANE_ONE, CardType.AIRPLANE_TWO,
  ]);

  /* 判断 curr 能否压过 prev。
   *
   * 规则:
   * - prev 为空（新一轮先手）：合法牌型即可
   * - 王炸：压一切
   * - 炸弹：压一切普通牌型；炸弹之间比权重；炸弹被王炸压
   * - 四带二：只能与四带二同型比较
   * - 普通牌型：必须同类型、同长度，且权重更大
   */
  function can_beat(prev, curr) {
    if (!curr.valid) return false;
    if (prev === null || prev === undefined || !prev.valid) return true;

    // 王炸最大
    if (curr.card_type === CardType.ROCKET) return true;

    // 炸弹
    if (curr.card_type === CardType.BOMB) {
      if (prev.card_type === CardType.ROCKET) return false;
      if (prev.card_type === CardType.BOMB) return curr.main_value > prev.main_value;
      // 炸弹压普通牌型与四带二
      return true;
    }

    // 四带二：只能同牌型比较
    if (curr.card_type === CardType.FOUR_TWO) {
      return prev.card_type === CardType.FOUR_TWO && curr.main_value > prev.main_value;
    }

    // 普通牌型：必须同类型且同长度
    if (_COMPARABLE_NORMAL.has(curr.card_type)) {
      if (prev.card_type === CardType.ROCKET) return false;
      if (prev.card_type === CardType.BOMB) return false; // 普通牌型压不过炸弹
      if (prev.card_type === CardType.FOUR_TWO) return false; // 普通牌型压不过四带二
      if (prev.card_type !== curr.card_type) return false;
      if (curr.length !== prev.length) return false;
      return curr.main_value > prev.main_value;
    }

    return false;
  }

  /* 同 can_beat，作为对外接口 */
  function compare_play(prev, curr) {
    return can_beat(prev, curr);
  }

  global.CardType = CardType;
  global.NON_SEQUENCE_RANKS = NON_SEQUENCE_RANKS;
  global.Play = Play;
  global.RANK_VALUE_OF = RANK_VALUE_OF;
  global.can_beat = can_beat;
  global.compare_play = compare_play;
})(typeof window !== "undefined" ? window : globalThis);
