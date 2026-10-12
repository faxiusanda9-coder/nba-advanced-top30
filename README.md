# NBA 高阶数据 TOP 30

按赛季查看 NBA 球员常规赛或季后赛高级数据，并按选定指标显示联盟前 30 名。

## 历史数据

- 覆盖 1996–97 至 2025–26，共 30 个赛季。
- 网页从项目内的 `data/{赛季结束年份}.json` 读取数据，不在每次访问时请求 NBA Stats 或第三方 API。
- 例如 `data/1997.json` 对应 1996–97 赛季，`data/2026.json` 对应 2025–26 赛季。
- 数据来自 [SportsDataverse 的 NBA Stats 历史档案](https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/nba_stats_player_season_stats)，该档案基于 NBA Stats 数据并发布常规赛和季后赛记录。

网页展示的 NBA Stats 高级指标包括 OFF RTG、DEF RTG、NET RTG、TS%、USG%、REB%、AST% 和 PIE。另从 [Basketball Reference 衍生常规赛档案](https://www.kaggle.com/datasets/sumitrodatta/nba-aba-baa-stats)合并 PER、OWS、DWS、WS、WS/48、OBPM、DBPM、BPM 和 VORP，覆盖 1996–97 至 2025–26；季后赛同一组指标也覆盖这 30 个赛季，其中 1996–97 至 2021–22 来自 [季后赛历史档案](https://www.kaggle.com/datasets/robertsunderhaft/nba-playoffs)，2022–23 至 2025–26 来自 [NBA Stats API 的季后赛查询](https://github.com/ehammill/nbastats)。该 API 声明统计对照 Basketball Reference 和 NBA.com，近四季快照保存在 `sources/bbref-playoffs/`，包含获取时间、来源和官网对应页面。个别原始数值缺失时留空。

WS、VORP 是累计贡献值，比较时受出场时间影响；WS/48、BPM 等更适合看效率。档案按球员姓名和赛季出场场次匹配，遇到转队球员使用 Basketball Reference 的赛季合计行；姓名或场次对不上的少数记录留空。历史 CSV 由 Kaggle 作者整理，原始统计口径来自 Basketball Reference，并非 NBA Stats 官方指标。

## RAPTOR 指标

- FiveThirtyEight 原版 RAPTOR 档案提供 RAPTOR 进攻、防守、总值，覆盖至 2021–22。原始 RAPTOR 是赛季级数据，常规赛与季后赛行会共用当季 RAPTOR 值；WAR 则按赛制拆分。
- 为补充后续赛季，网页提供 Neil Paine 的 Estimated RAPTOR 估算版（进攻、防守、总值与 WAR），公开 CSV 覆盖至 2024–25 常规赛。排行榜和生涯曲线新增“RAPTOR 自动接续”选项：优先使用 FiveThirtyEight 原版，缺失时接续 Estimated RAPTOR；表格显示每名球员实际使用的数据来源。两种模型口径不同，跨来源的连续曲线应谨慎解读；2024–25 季后赛和 2025–26 赛季暂无公开 Estimated RAPTOR 档案。
- 数据来源：[FiveThirtyEight RAPTOR 历史档案](https://github.com/fivethirtyeight/data/tree/master/nba-raptor)、[Neil Paine Estimated RAPTOR CSV](https://github.com/Neil-Paine-1/NBA-elo/blob/main/nba-estimated-raptor.csv)、[估算方法说明](https://github.com/Neil-Paine-1/NBA-elo/blob/main/README.md)。

## 更新历史数据

`scripts/build-data.mjs` 使用 Node.js 从公开 CSV 档案提取 NBA 高级数据，`scripts/add-raptor.mjs` 合并 RAPTOR 与 Estimated RAPTOR，`scripts/add-bbref.mjs` 合并 Basketball Reference 衍生常规赛高级指标，`scripts/add-bbref-playoffs.mjs` 合并历史季后赛高级指标，`scripts/add-bbref-recent-playoffs.mjs` 合并近四季季后赛快照；都不需要 Python。近四季脚本加 `--refresh` 可更新 API 快照，接口不可用时使用已保存数据；按球队查询并核对全季总人数，避免并列排序造成分页重复。GitHub Actions 每周检查并刷新数据；也可以手动回填全部 30 个赛季：

1. 打开仓库的 **Actions** 页面。
2. 选择 **Update NBA season archive**。
3. 点击 **Run workflow**，勾选 `backfill`，再运行。

合并到 `main` 后，工作流会先回填这 30 个赛季并提交 JSON 文件；之后每周检查新赛季数据。更新只写入有变化的赛季文件。
