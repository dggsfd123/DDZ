/* 牌堆模块——对应 win/deck.py
 *
 * 一副完整 54 张牌的生成、洗牌、发牌、预留 3 张底牌。
 */
(function (global) {
  "use strict";

  const { Suit, RANK_ORDER, Card, cardCompare, PyRandom } = global;

  class Deck {
    constructor() {
      // 54 张牌：4 种花色 × 13 个点数 + 大王 + 小王
      this.cards = [];
      for (const suit of [Suit.SPADE, Suit.HEART, Suit.CLUB, Suit.DIAMOND]) {
        for (const rank of RANK_ORDER) {
          if (rank === "BJ" || rank === "RJ") continue;
          this.cards.push(new Card(suit, rank));
        }
      }
      // 小王、大王
      this.cards.push(new Card(Suit.JOKER, "BJ"));
      this.cards.push(new Card(Suit.JOKER, "RJ"));
    }

    /* 洗牌，可传入随机种子保证测试可复现（与 Python random.shuffle 完全一致） */
    shuffle(seed = null) {
      if (seed !== null && seed !== undefined) {
        // 有种子：使用 Python 兼容 MT19937，复现 Python 版同种子发牌
        const rng = new PyRandom(seed);
        rng.shuffleInPlace(this.cards);
      } else {
        // 无种子：与 Python random.shuffle 等价的 Fisher-Yates
        for (let i = this.cards.length - 1; i >= 1; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const tmp = this.cards[i];
          this.cards[i] = this.cards[j];
          this.cards[j] = tmp;
        }
      }
    }

    /* 发牌：返回 (三份手牌, 三张底牌)。每位玩家 17 张，剩余 3 张为底牌。 */
    deal() {
      if (this.cards.length !== 54) {
        throw new Error("牌堆数量异常，无法发牌");
      }
      const hands = [[], [], []];
      for (let i = 0; i < 51; i++) {
        hands[i % 3].push(this.cards[i]);
      }
      const bottom = this.cards.slice(51, 54);
      // 手牌自动排序（依赖 cardCompare）
      for (const hand of hands) hand.sort(cardCompare);
      bottom.sort(cardCompare);
      return [hands, bottom];
    }
  }

  global.Deck = Deck;
})(typeof window !== "undefined" ? window : globalThis);
