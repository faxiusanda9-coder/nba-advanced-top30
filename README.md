# NBA 高阶数据 TOP 30

按赛季查看 NBA 球员常规赛或季后赛高级数据，并按选定指标显示联盟前 30 名。

## 历史数据

- 覆盖 1996–97 至 2025–26，共 30 个赛季。
- 网页从项目内的 `data/{赛季结束年份}.json` 读取数据，不在每次访问时请求 NBA Stats 或第三方 API。
- 例如 `data/1997.json` 对应 1996–97 赛季，`data/2026.json` 对应 2025–26 赛季。
- 数据来自 [SportsDataverse 的 NBA Stats 历史档案](https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/nba_stats_player_season_stats)，该档案基于 NBA Stats 数据并发布常规赛和季后赛记录。

网页展示的官方高级指标为 OFF RTG、DEF RTG、NET RTG、TS%、USG%、REB%、AST% 和 PIE。PER、WS、VORP、OBPM、DBPM 属于另一套统计口径，本版不展示这些指标。

## RAPTOR 指标

- RAPTOR 统一采用 Neil Paine 的 Estimated RAPTOR 历史版，提供总值、进攻、防守和 WAR，避免把截止于 2021–22 的 FiveThirtyEight 原版与另一个模型拼成一条曲线。
- 当前公开 CSV 覆盖至 2024–25 常规赛；2024–25 季后赛和 2025–26 完整赛季暂未包含在公开 CSV 中。作者已将 2025–26 Estimated RAPTOR 改名为 LAKER，并发布了赛季排行榜；但完整历史表格位于付费订阅内容中，项目不会把不完整快照冒充全季档案。
- 数据来源：[Neil Paine Estimated RAPTOR CSV](https://github.com/Neil-Paine-1/NBA-elo/blob/main/nba-estimated-raptor.csv)、[LAKER/RAPTOR 方法说明](https://github.com/Neil-Paine-1/NBA-elo/blob/main/README.md)、[2025–26 LAKER 页面](https://neilpaine.substack.com/p/2025-26-nba-elo-forecast-and-player)。

## 更新历史数据

`scripts/build-data.mjs` 使用 Node.js 从公开 CSV 档案提取 NBA 高级数据，`scripts/add-raptor.mjs` 合并统一口径的 Estimated RAPTOR 数据；都不需要 Python。GitHub Actions 每周检查并刷新数据；也可以手动回填全部 30 个赛季：

1. 打开仓库的 **Actions** 页面。
2. 选择 **Update NBA season archive**。
3. 点击 **Run workflow**，勾选 `backfill`，再运行。

合并到 `main` 后，工作流会先回填这 30 个赛季并提交 JSON 文件；之后每周检查新赛季数据。更新只写入有变化的赛季文件。
