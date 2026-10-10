# NBA 高阶数据 TOP 30

按赛季查看 NBA 球员常规赛或季后赛高级数据，并按选定指标显示联盟前 30 名。

## 历史数据

- 覆盖 1996–97 至 2025–26，共 30 个赛季。
- 网页从项目内的 `data/{赛季结束年份}.json` 读取数据，不在每次访问时请求 NBA Stats 或第三方 API。
- 例如 `data/1997.json` 对应 1996–97 赛季，`data/2026.json` 对应 2025–26 赛季。
- 数据来自 [SportsDataverse 的 NBA Stats 历史档案](https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/nba_stats_player_season_stats)，该档案基于 NBA Stats 数据并发布常规赛和季后赛记录。

网页展示的官方高级指标为 OFF RTG、DEF RTG、NET RTG、TS%、USG%、REB%、AST% 和 PIE。PER、WS、VORP、OBPM、DBPM 属于另一套统计口径，本版不展示这些指标。

## RAPTOR 指标

- FiveThirtyEight 原版 RAPTOR 档案提供 RAPTOR 进攻、防守、总值，覆盖至 2021–22。原始 RAPTOR 是赛季级数据，常规赛与季后赛行会共用当季 RAPTOR 值；WAR 则按赛制拆分。
- 为补充后续赛季，网页提供 Neil Paine 的 Estimated RAPTOR 估算版（进攻、防守、总值与 WAR），公开 CSV 覆盖至 2024–25 常规赛。排行榜和生涯曲线新增“RAPTOR 自动接续”选项：优先使用 FiveThirtyEight 原版，缺失时接续 Estimated RAPTOR；表格显示每名球员实际使用的数据来源。两种模型口径不同，跨来源的连续曲线应谨慎解读；2024–25 季后赛和 2025–26 赛季暂无公开 Estimated RAPTOR 档案。
- 数据来源：[FiveThirtyEight RAPTOR 历史档案](https://github.com/fivethirtyeight/data/tree/master/nba-raptor)、[Neil Paine Estimated RAPTOR CSV](https://github.com/Neil-Paine-1/NBA-elo/blob/main/nba-estimated-raptor.csv)、[估算方法说明](https://github.com/Neil-Paine-1/NBA-elo/blob/main/README.md)。

## 更新历史数据

`scripts/build-data.mjs` 使用 Node.js 从公开 CSV 档案提取 NBA 高级数据，`scripts/add-raptor.mjs` 合并 RAPTOR 与 Estimated RAPTOR 数据；都不需要 Python。GitHub Actions 每周检查并刷新数据；也可以手动回填全部 30 个赛季：

1. 打开仓库的 **Actions** 页面。
2. 选择 **Update NBA season archive**。
3. 点击 **Run workflow**，勾选 `backfill`，再运行。

合并到 `main` 后，工作流会先回填这 30 个赛季并提交 JSON 文件；之后每周检查新赛季数据。更新只写入有变化的赛季文件。
