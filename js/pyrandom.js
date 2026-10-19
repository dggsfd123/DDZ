/* Python 兼容随机数（MT19937）——对应 Python 标准库 random 模块。
 *
 * 用途：Deck.shuffle(seed) 在传入 seed 时，用本实现复现 Python random.shuffle
 * 的洗牌结果，保证 web 版与 win 版（pygame）在同一 seed 下发到的牌完全相同。
 * 不传 seed 时游戏使用 Math.random（与 Python 不种子的 random 行为等价）。
 *
 * 实现参照 CPython _randommodule.c：init_by_array / genrand_uint32 /
 * random_random / getrandbits / _randbelow / shuffle。
 */
(function (global) {
  "use strict";

  class PyRandom {
    constructor(seed) {
      this.N = 624;
      this.M = 397;
      this.MATRIX_A = 0x9908b0df;
      this.UPPER_MASK = 0x80000000;
      this.LOWER_MASK = 0x7fffffff;
      this.mt = new Array(this.N).fill(0);
      this.mti = this.N + 1;
      this.seed(seed);
    }

    /* random.seed(int)：取绝对值，按 32 位小节拆分后 init_by_array */
    seed(seed) {
      const key = [];
      let n = Math.abs(Math.trunc(seed));
      while (n > 0) {
        key.push(n % 4294967296);
        n = Math.floor(n / 4294967296);
      }
      if (key.length === 0) key.push(0);
      this._init_by_array(key);
    }

    _init_by_array(key) {
      const N = this.N;
      // init_genrand(19650218)：先用标准递推铺满整个状态数组
      this.mt[0] = 19650218 >>> 0;
      for (let mti = 1; mti < N; mti++) {
        this.mt[mti] = (Math.imul(1812433253, this.mt[mti - 1] ^ (this.mt[mti - 1] >>> 30)) + mti) >>> 0;
      }
      let i = 1;
      let j = 0;
      let k = Math.max(N, key.length);
      for (; k > 0; k--) {
        const prev = this.mt[i - 1];
        // mt[i] = (mt[i] ^ ((mt[i-1] ^ (mt[i-1] >> 30)) * 1664525)) + key[j] + j
        this.mt[i] = ((Math.imul(prev ^ (prev >>> 30), 1664525) ^ this.mt[i]) + key[j] + j) >>> 0;
        i++;
        j++;
        if (i >= N) {
          this.mt[0] = this.mt[N - 1];
          i = 1;
        }
        if (j >= key.length) j = 0;
      }
      k = N - 1;
      for (; k > 0; k--) {
        const prev = this.mt[i - 1];
        // mt[i] = (mt[i] ^ ((mt[i-1] ^ (mt[i-1] >> 30)) * 1566083941)) - i
        this.mt[i] = ((Math.imul(prev ^ (prev >>> 30), 1566083941) ^ this.mt[i]) - i) >>> 0;
        i++;
        if (i >= N) {
          this.mt[0] = this.mt[N - 1];
          i = 1;
        }
      }
      this.mt[0] = 0x80000000;
    }

    _genrand_uint32() {
      const N = this.N;
      const M = this.M;
      let y;
      if (this.mti >= N) {
        let kk;
        for (kk = 0; kk < N - M; kk++) {
          y = (this.mt[kk] & this.UPPER_MASK) | (this.mt[kk + 1] & this.LOWER_MASK);
          this.mt[kk] = (this.mt[kk + M] ^ (y >>> 1) ^ ((y & 1) ? this.MATRIX_A : 0)) >>> 0;
        }
        for (; kk < N - 1; kk++) {
          y = (this.mt[kk] & this.UPPER_MASK) | (this.mt[kk + 1] & this.LOWER_MASK);
          this.mt[kk] = (this.mt[kk + (M - N)] ^ (y >>> 1) ^ ((y & 1) ? this.MATRIX_A : 0)) >>> 0;
        }
        y = (this.mt[N - 1] & this.UPPER_MASK) | (this.mt[0] & this.LOWER_MASK);
        this.mt[N - 1] = (this.mt[M - 1] ^ (y >>> 1) ^ ((y & 1) ? this.MATRIX_A : 0)) >>> 0;
        this.mti = 0;
      }
      y = this.mt[this.mti++];
      y = (y ^ (y >>> 11)) >>> 0;
      y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0;
      y = (y ^ ((y << 15) & 0xefc60000)) >>> 0;
      y = (y ^ (y >>> 18)) >>> 0;
      return y;
    }

    /* random.random() */
    random() {
      const a = this._genrand_uint32() >>> 5;
      const b = this._genrand_uint32() >>> 6;
      return (a * 67108864.0 + b) / 9007199254740992.0;
    }

    /* random.getrandbits(k)，k <= 32 */
    _getrandbits(k) {
      return this._genrand_uint32() >>> (32 - k);
    }

    /* random._randbelow(n) */
    _randbelow(n) {
      const k = n.toString(2).length; // bit_length
      let r = this._getrandbits(k);
      while (r >= n) r = this._getrandbits(k);
      return r;
    }

    /* random.shuffle(list)：原地洗牌（从尾部向前交换） */
    shuffleInPlace(arr) {
      for (let i = arr.length - 1; i >= 1; i--) {
        const j = this._randbelow(i + 1);
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
    }
  }

  global.PyRandom = PyRandom;
})(typeof window !== "undefined" ? window : globalThis);
