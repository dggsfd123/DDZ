/* 游戏状态机——对应 win/game_state.py
 *
 * 管理三人斗地主的完整流程：
 * - 发牌、叫地主（1/2/3 分 / 不叫）
 * - 回合流转、出牌判定、Pass 处理
 * - 胜负判定、计分（基础分 = 叫分，炸弹翻倍，春天/反春翻倍）
 */
(function (global) {
  "use strict";

  const { Deck, cardCompare, listContains, listRemove, Play, can_beat, CardType } = global;

  const GamePhase = {
    DEAL: "deal",   // 发牌
    BID: "bid",     // 叫地主
    PLAY: "play",   // 出牌
    OVER: "over",   // 结算
  };

  class Player {
    constructor(name, player_id) {
      this.name = name;
      this.player_id = player_id;
      this.hand = []; // 手牌列表，始终按大小升序排序
    }

    reset_hand(cards) {
      this.hand = cards.slice();
      this.sort_hand();
    }

    add_cards(cards) {
      for (const c of cards) this.hand.push(c);
      this.sort_hand();
    }

    sort_hand() {
      this.hand.sort(cardCompare);
    }

    play_cards(cards) {
      for (const c of cards) {
        if (!listContains(this.hand, c)) throw new Error("手牌中不存在要打出的牌");
      }
      for (const c of cards) {
        listRemove(this.hand, c);
      }
    }

    hand_size() {
      return this.hand.length;
    }
  }

  class GameState {
    constructor(seed = null) {
      this.players = [new Player("玩家0", 0), new Player("玩家1", 1), new Player("玩家2", 2)];
      this.bottom = [];            // 3 张底牌
      this.landlord_id = null;     // 地主玩家 id
      this.phase = GamePhase.DEAL;
      this.bid_scores = [0, 0, 0]; // 各家叫分
      this.bid_turn = 0;           // 当前叫分玩家
      this.first_bidder = 0;       // 本局第一个叫分玩家（轮流叫地主）
      this.bid_round_done = false;
      this.last_play = null;       // 上一手有效出牌 Play
      this.last_play_owner = null; // 上一手出牌者 id
      this.current_turn = 0;       // 当前出牌玩家
      this.pass_count = 0;         // 连续 Pass 计数
      this.bomb_count = 0;         // 炸弹/王炸累计次数
      this.landlord_played_count = 0; // 地主出牌手数
      this.farmer_played_count = 0;   // 农民出牌总手数
      this.winner_id = null;
      this.winner_role = null;     // "landlord" / "farmer"
      this.score = 0;
      this.seed = seed;
    }

    // 叫分候选
    static get BID_OPTIONS() {
      return { 0: "不叫", 1: "1分", 2: "2分", 3: "3分" };
    }

    /* 发牌并进入叫地主阶段。
     * first_bidder: 本局第一个叫分的玩家（实现轮流叫地主，避免固定 0 号先叫）。
     */
    deal(first_bidder = 0) {
      const deck = new Deck();
      deck.shuffle(this.seed);
      const [hands, bottom] = deck.deal();
      for (let i = 0; i < hands.length; i++) {
        this.players[i].reset_hand(hands[i]);
      }
      this.bottom = bottom;
      this.phase = GamePhase.BID;
      this.first_bidder = ((first_bidder % 3) + 3) % 3;
      this.bid_turn = this.first_bidder;
      this.bid_scores = [0, 0, 0];
    }

    /* 玩家叫分。score 只能为 0(不叫)/1/2/3，且不能低于当前最高分（除非 0）。 */
    bid(player_id, score) {
      if (this.phase !== GamePhase.BID) {
        throw new Error("当前不是叫地主阶段");
      }
      if (player_id !== this.bid_turn) {
        throw new Error("还没轮到该玩家叫分");
      }
      score = Math.trunc(Number(score));
      if (![0, 1, 2, 3].includes(score)) {
        throw new Error("叫分必须是 0/1/2/3");
      }
      const max_score = Math.max(...this.bid_scores);
      if (score !== 0 && score <= max_score) {
        throw new Error(`叫分必须高于当前最高分 ${max_score}，或不叫(0)`);
      }
      this.bid_scores[player_id] = score;

      // 提前锁定：若有人叫 3 分，直接结束
      if (score === 3) {
        this._finish_bid();
        return;
      }
      // 逆时针推进叫分轮次；若已轮到起始玩家之前（三家都叫过）则结束
      this.bid_turn = (this.bid_turn - 1 + 3) % 3;
      if (this.bid_turn === 0) {
        // 叫分一轮走完回到 0 号，结束叫分
        this._finish_bid();
      }
    }

    /* 结束叫分，确定地主。若全不叫则强制 0 号玩家当地主（兜底）。 */
    _finish_bid() {
      const top = Math.max(...this.bid_scores);
      if (top === 0) {
        // 全不叫：默认本局第一个叫分的玩家当地主，叫分计 1（兜底规则）
        this.landlord_id = this.first_bidder;
        this.bid_scores[this.first_bidder] = 1;
      } else {
        // 叫分最高者当地主；若多人同最高，取第一个
        for (let i = 0; i < this.bid_scores.length; i++) {
          if (this.bid_scores[i] === top) {
            this.landlord_id = i;
            break;
          }
        }
      }
      // 地主获得底牌
      this.players[this.landlord_id].add_cards(this.bottom);
      this.current_turn = this.landlord_id;
      this.phase = GamePhase.PLAY;
      this.last_play = null;
      this.last_play_owner = null;
      this.pass_count = 0;
    }

    /* 玩家出牌。cards 为空数组表示 Pass（不出）。返回是否出牌成功。 */
    play(player_id, cards) {
      if (this.phase !== GamePhase.PLAY) {
        throw new Error("当前不是出牌阶段");
      }
      if (player_id !== this.current_turn) {
        throw new Error("还没轮到该玩家出牌");
      }

      // Pass
      if (cards.length === 0) {
        // 新一轮先手不能 Pass
        if (this.last_play === null) {
          throw new Error("你是本轮先手，必须出牌");
        }
        this.pass_count += 1;
        this._advance_turn();
        // 若其他两家都 Pass，当前出牌者重新获得先手
        if (this.pass_count >= 2) {
          this.last_play = null;
          this.last_play_owner = null;
          this.pass_count = 0;
        }
        return true;
      }

      // 校验手牌中确实有这些牌
      const hand_set = this.players[player_id].hand.slice();
      for (const c of cards) {
        if (!listContains(hand_set, c)) {
          throw new Error("手牌中不存在要打出的牌");
        }
        listRemove(hand_set, c);
      }

      const play = new Play(cards);
      if (!play.valid) {
        throw new Error("非法牌型");
      }
      // 校验是否压得过上一手
      if (this.last_play !== null && !can_beat(this.last_play, play)) {
        throw new Error("出的牌压不过上一手");
      }

      // 出牌成功
      this.players[player_id].play_cards(cards);

      // 炸弹/王炸翻倍计数
      if (play.card_type === CardType.BOMB || play.card_type === CardType.ROCKET) {
        this.bomb_count += 1;
      }

      // 统计出牌手数
      if (player_id === this.landlord_id) {
        this.landlord_played_count += 1;
      } else {
        this.farmer_played_count += 1;
      }

      // 若本轮先手或新的一轮，更新 last_play
      this.last_play = play;
      this.last_play_owner = player_id;
      this.pass_count = 0;

      // 胜负判定
      if (this.players[player_id].hand_size() === 0) {
        this._finish_game(player_id);
        return true;
      }

      this._advance_turn();
      return true;
    }

    /* 逆时针推进到下一个玩家：0(下) -> 2(右上) -> 1(左上) -> 0。 */
    _advance_turn() {
      this.current_turn = (this.current_turn - 1 + 3) % 3;
    }

    /* 游戏结束，计算胜负与分数。 */
    _finish_game(winner_id) {
      this.winner_id = winner_id;
      if (winner_id === this.landlord_id) {
        this.winner_role = "landlord";
      } else {
        this.winner_role = "farmer";
      }
      this.phase = GamePhase.OVER;

      const base = this.landlord_id !== null ? Math.max(...this.bid_scores) : 1;
      let multiplier = Math.pow(2, this.bomb_count); // 每个炸弹/王炸翻倍

      // 春天：地主出完牌，两个农民一张都没出
      if (this.winner_role === "landlord" && this.farmer_played_count === 0) {
        multiplier *= 2;
      }
      // 反春：农民出完牌，地主只出过一手牌
      if (this.winner_role === "farmer" && this.landlord_played_count <= 1) {
        multiplier *= 2;
      }

      this.score = base * multiplier;
    }

    is_landlord(player_id) {
      return player_id === this.landlord_id;
    }

    current_player() {
      return this.players[this.current_turn];
    }
  }

  global.GamePhase = GamePhase;
  global.Player = Player;
  global.GameState = GameState;
})(typeof window !== "undefined" ? window : globalThis);
