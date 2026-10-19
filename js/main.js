/* 程序入口——对应 win/main.py
 *
 * 启动斗地主图形化界面（HTML5 Canvas）。
 * start_scene=true 先显示开始界面（标题 + 难度选择 + 头像），选难度后再开局。
 *
 * 可选 URL 参数（便于测试/分享，不影响默认行为）：
 *   ?seed=42   固定随机种子（与 Python 版 GameUI(seed=42) 发牌一致）
 *   ?bgm=0     关闭背景音乐
 */
(function () {
  "use strict";

  const params = new URLSearchParams(location.search);
  let seed = null;
  if (params.has("seed")) {
    const v = parseInt(params.get("seed"), 10);
    if (!isNaN(v)) seed = v;
  }

  const ui = new GameUI(seed, true);
  ui.run();
})();
