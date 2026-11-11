# 每日比赛与单场 GmSc

## 页面与数据范围

- `/daily-games` 默认按 `Asia/Shanghai` 显示今天；支持昨天和指定日期。
- `/game/{NBA game_id}` 先展示得分、篮板、助攻、抢断、盖帽、失误六项本场基础数据，再展示双方全部实际出场球员的技术统计、DNP 名单及 GmSc 图表。赛季排行榜也把六项场均基础数据放在前部，高阶指标保留中文释义和指南入口。
- 截至 **2026-11-11**，已连续保存北京时间 `2026-10-21` 开赛日至 `2026-11-11` 的 **22 个日期**：160 场正式比赛全部完赛、160 份最终 Box Score 完整归档；`2026-11-04` 确认为无比赛日。`2026-11-12`、`2026-11-13` 的未来赛程也已预存。此后每天由定时任务延续归档。
- 只纳入 NBA 官方比赛 ID 的常规赛 `002`、附加赛 `005`、季后赛 `004`。季前赛 `001`、全明星及不计入常规赛技术统计的 NBA Cup 决赛 `006` 不混入本模块。

## 来源与身份

- 官方赛程：[`scheduleLeagueV2.json`](https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json)，不可用时尝试官方 `_1` 版本。读取 `gameDateTimeUTC`，用真实 UTC 时刻换算北京时间，并同时保存赛程中的 NBA 官方比赛日期。比分与状态可由[当日 Scoreboard](https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json)覆盖；该滚动接口**不用于历史查询**。
- 单场技术统计：[`boxscore_{game_id}.json`](https://cdn.nba.com/static/json/liveData/boxscore/boxscore_0022600211.json)。校验比赛、主客队、球员 ID、至少五名实际出场球员、最终比分及 GmSc 必要字段。保存 `data/games/boxscores/{game_id}.json`，不会随当日接口滚动消失。
- 队标来自 NBA CDN，30 支球队 SVG 缓存在 `assets/team-logos/`。已归档球员共 477 名，475 名取得 NBA CDN 头像；2 名的 NBA CDN 返回通用图，使用同场比赛、球队、开赛 UTC、姓名精确核对的 ESPN 头像，来源记录于 `data/games/headshot-sources.json`。新增球员由独立工作流补充头像。
- 已有球员主页只按 NBA `player_id` 精确匹配。未收录的新球员保留官方姓名与 NBA ID，不做模糊姓名合并。

## GmSc 口径

`GmSc = PTS + 0.4×FGM − 0.7×FGA − 0.4×(FTA−FTM) + 0.7×ORB + 0.3×DRB + STL + 0.7×AST + 0.7×BLK − 0.4×PF − TOV`。

FGM/FGA 为包含两分和三分的运动战合计。仅使用该场球员原始技术统计；任一必要字段缺失则保存 `null` 和 `missing_inputs`，不补零。DNP 保存 `null` 和 `dnp`；真实零值保留 `0`；负值照实保留。计算使用整数十分位，排序使用原始数值，展示一位小数。`gmsc_formula_version` 为 `hollinger-game-score-v1`。公式与局限统一在 `data/advanced_metrics_explanation.json` 的 `GMSC` 条目维护。

GmSc 是单场技术统计汇总，不是 BPM、RAPTOR、LAKER 或真实正负值；本模块不推算任何“单场 RAPTOR”。

## 更新机制

独立工作流 `.github/workflows/update-daily-games.yml` 每 **30 分钟**执行一次：UTC 每小时 `07` 与 `37` 分，北京时间为每小时 `07` 与 `37` 分。GitHub Actions 排队和 Vercel 部署还会增加延迟；页面显示的是**数据实际最后变化时间**，不承诺秒级直播。

默认从当前赛季常规赛首个北京时间比赛日逐日检查至明日，包括无比赛日；这也会修补定时任务中断造成的日期空档。已完成的历史比赛不会重复下载，最近约 48 小时内已结束的比赛会再次核对。赛程更改时按 `game_id` 移动日期索引；已完成快照不会被接口失败或不完整的新响应覆盖。日期只有在全部应收录比赛均已结束且每场技术统计完整时标记 `complete`。延期、取消、未开始、进行中、缺失与接口失败各自保留状态。无内容变化不提交。所有数据写入工作流共享 `nba-archive-writer` 串行组；`data/games/**` 与头像缓存的提交不会触发赛季档案整库回填。

手动补抓：仓库 **Actions → Update NBA daily games and Game Score → Run workflow**，可填北京时间 `date`（`YYYY-MM-DD`）、10 位 NBA `game_id`，或都留空运行常规检查。本地等效命令：

```sh
node scripts/update-daily-games.mjs --date=2026-11-11
node scripts/update-daily-games.mjs --game-id=0022600211
node scripts/fetch-player-headshots.mjs
```

当前赛程端点只提供当前赛季；手动指定不在当前赛程范围且尚未保存的历史日期不会伪造“无比赛”。已保存的历史日期仍可查询。

## 验收记录

- `node --test tests/*.test.mjs`：25 项通过；覆盖公式、负值、真实零值、DNP、字段缺失、夏令时与跨日、连续日期、比赛状态、改期、幂等、失败保留及赛后修正；原排行榜、球员主页、搜索、荣誉与解释系统回归通过。
- `node scripts/verify-season-archive.mjs`：对照 NBA 官方当季赛程，核对开赛日至今 22 天的每个日期、160 个比赛 ID、双方球队与比分，并独立复算 3620 名实际出场球员的 GmSc；全部一致。
- `node scripts/verify-daily-games.mjs --date=2026-11-11`：官方赛程当日 6 场均在索引中；抽查 3 场、每场双方各 1 名球员，共 6 人。对照 NBA 单场 Box Score 和 ESPN 独立公开记录，双方比分、必要技术统计与独立复算 GmSc 均一致。逐场证据见 `docs/daily-games-live-check.json`；本次未发现统计修正或四舍五入差异。
- Edge/Chromium 真实 CSS 视口 320、390、1280 像素：首页、日期页、比赛页宽度无溢出；三列主导航及六项基础数据展示正常；比赛页显示 27 名实际出场球员、球员头像、前 10 名 GmSc 图表；“查看全部”显示 27 人；得分列排序、表格内部横向滚动通过。浏览器验证脚本为 `scripts/check-daily-browser.mjs`，需先运行 `node scripts/serve-static.mjs`。
- 477 名球员头像与 30 支球队队标已缓存。比赛数据目录与原赛季 `data/{year}.json` 分离。

## 限制

官方赛程与 Box Score 会赛后修正，近 48 小时数据会重复核对，差异会更新快照。NBA CDN 的公开接口可能在某些网络环境返回 403 或超时；工作流会记录失败并保留已有有效文件。当前不回填几十年逐场比赛。
