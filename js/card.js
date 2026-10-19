/* 牌的基础定义——对应 win/card.py
 *
 * 点数大小顺序（由大到小）：大王 > 小王 > 2 > A > K > Q > J > 10 > 9 > 8 > 7 > 6 > 5 > 4 > 3。
 */
(function (global) {
  "use strict";

  /* 花色枚举，仅用于展示，不参与大小比较 */
  const Suit = {
    SPADE: 0,     // 黑桃
    HEART: 1,     // 红桃
    CLUB: 2,      // 梅花
    DIAMOND: 3,   // 方块
    JOKER: 4,     // 王（无花色）
  };

  /* 点数到比较权重的映射，数值越大代表越大 */
  const RANK_VALUE = {
    "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10,
    "J": 11, "Q": 12, "K": 13, "A": 14, "2": 15,
    "BJ": 16,   // 小王 (Black Joker)
    "RJ": 17,   // 大王 (Red Joker)
  };

  /* 点数顺序（与 Python RANK_VALUE 字典插入顺序严格一致：3..10,J,Q,K,A,2,王）。
   * 注意：不能用 Object.keys(RANK_VALUE) 遍历——JS 会把 "2" 这类整数样式键
   * 排到最前面，导致牌堆构造顺序与 Python 版不同。 */
  const RANK_ORDER = [
    "3", "4", "5", "6", "7", "8", "9", "10",
    "J", "Q", "K", "A", "2", "BJ", "RJ",
  ];

  /* 用于显示的点数字符串 */
  const RANK_DISPLAY = {
    "3": "3", "4": "4", "5": "5", "6": "6", "7": "7", "8": "8", "9": "9",
    "10": "10", "J": "J", "Q": "Q", "K": "K", "A": "A", "2": "2",
    "BJ": "小王", "RJ": "大王",
  };

  const SUIT_CHAR = {
    [Suit.SPADE]: "♠",
    [Suit.HEART]: "♥",
    [Suit.CLUB]: "♣",
    [Suit.DIAMOND]: "♦",
  };

  class Card {
    constructor(suit, rank) {
      if (!Object.prototype.hasOwnProperty.call(RANK_VALUE, rank)) {
        throw new Error("非法点数: " + rank);
      }
      this.suit = suit;
      this.rank = rank;
      this.value = RANK_VALUE[rank];
    }

    /* 对应 Python __repr__ */
    toString() {
      if (this.suit === Suit.JOKER) return RANK_DISPLAY[this.rank];
      return SUIT_CHAR[this.suit] + RANK_DISPLAY[this.rank];
    }

    /* 对应 Python __eq__（同花色同点数即相等） */
    equals(other) {
      return other instanceof Card && this.suit === other.suit && this.rank === other.rank;
    }
  }

  /* 对应 Python Card.__lt__：先比权重，再比花色，保证排序稳定 */
  function cardCompare(a, b) {
    if (a.value !== b.value) return a.value - b.value;
    return a.suit - b.suit;
  }

  /* 对应 Python `c in list` / list.remove(c)（按相等性匹配第一张） */
  function listContains(list, card) {
    return list.some((c) => c.equals(card));
  }

  function listRemove(list, card) {
    const idx = list.findIndex((c) => c.equals(card));
    if (idx >= 0) list.splice(idx, 1);
  }

  global.Suit = Suit;
  global.RANK_VALUE = RANK_VALUE;
  global.RANK_ORDER = RANK_ORDER;
  global.RANK_DISPLAY = RANK_DISPLAY;
  global.SUIT_CHAR = SUIT_CHAR;
  global.Card = Card;
  global.cardCompare = cardCompare;
  global.listContains = listContains;
  global.listRemove = listRemove;
})(typeof window !== "undefined" ? window : globalThis);
