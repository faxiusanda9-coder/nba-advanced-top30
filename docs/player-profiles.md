# 球员档案实现及验收

## 覆盖与加载

2,860 个稳定 NBA ID，1996–97 至 2025–26 共 20,668 条独立常规赛/季后赛记录。只有一个 HTML 模板；构建生成的按 ID 分拆 JSON 保留在后端函数包中，由 `/api/player?slug=...` 一次返回所选球员。完整数据包约 23.5 MiB；LeBron 的单人历史 JSON 约 47.5 KiB，搜索仍使用原轻量索引并延迟加载。

## 新增与修改文件

- 新增 `scripts/add-player-basic.mjs`、`scripts/lib/player-basic.mjs`、`sources/player-basic/1997.json`–`2026.json`：提取和保存基础统计。
- 新增 `scripts/build-player-profiles.mjs`、`assets/player-profile-core.mjs`、`assets/player-profile.css`、`tests/player-profile.test.mjs` 和本文档。
- 修改 `player.html`、`assets/player-profile.js`、`api/player.js`：统一档案模板、API 按需加载和界面。
- 修改 `data/1997.json`–`2026.json`：仅添加基础统计、年龄、队数及来源；全部原有字段值不变。
- 修改 `scripts/build-data.mjs`：后续下载同时提取基础统计，不重复请求 CSV。
- 修改 `vercel.json`、`.github/workflows/update-data.yml`、`.gitignore` 和 `README.md`：生成、部署、更新及说明。
- 搜索组件/索引、热度权重、首页排行榜脚本及现有高阶指标导入脚本保持原样。

## 真实来源

| 指标 | 来源和处理 |
| --- | --- |
| PTS、REB、AST、STL、BLK、TOV、MIN、GP、TS%、USG% 等 | [NBA Stats / SportsDataverse 的 30 季公开 CSV](https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/nba_stats_player_season_stats)。基础统计取 base/pergame，按 NBA ID、年和赛制关联并核对 GP/MIN |
| PER、BPM、OBPM、DBPM、VORP、WS、WS/48、OWS、DWS | 复用现有 Basketball Reference 衍生档案：常规赛 [Kaggle NBA stats](https://www.kaggle.com/datasets/sumitrodatta/nba-aba-baa-stats)；早期季后赛 [NBA playoffs](https://www.kaggle.com/datasets/robertsunderhaft/nba-playoffs)；2023–2026 季后赛使用已保存的 NBA Stats API 快照 |
| 早期分赛制 RAPTOR | [FiveThirtyEight historical_RAPTOR_by_team.csv](https://github.com/fivethirtyeight/data/blob/master/nba-raptor/historical_RAPTOR_by_team.csv)，原始赛制为 RS/PO。没有使用共享常规赛/季后赛评级替代 |
| 接续 RAPTOR | [Neil Paine Estimated RAPTOR](https://github.com/Neil-Paine-1/NBA-elo/blob/main/nba-estimated-raptor.csv)，保留现有独立赛制合并值 |
| 2025–26 LAKER | 已有作者公开榜单快照：[常规赛](https://datawrapper.dwcdn.net/t5PSm/161/)、[季后赛](https://datawrapper.dwcdn.net/5L6UD/44/)，分开读取；名称与来源逐季显示 |

## 未覆盖内容

位置没有源字段，明确显示未提供；零出场且未进入档案的注册球员不在这套数据中。球队历史仅包括登记球队，源未列出完整转会名单和球队分段，不推断或重复累加。同赛季多队只展示一条合计。1996–97 以前的生涯不在本站覆盖范围内，完整生涯未核验；Jordan 早期赛季不在本页。

2024–25 季后赛 RAPTOR 接续缺失，其他缺失单元格保持空值「—」。没有加入 EPM、RAPM、DPM 或未经验证的估计。每日 GmSc、历史逐场、AI 评分及球队页均未开发。

## 验收结果

| 球员 | 常规赛 / 季后赛已收录季数 | 结果 |
| --- | --- | --- |
| Michael Jordan（893） | 4 / 2 | 搜索跳转、赛制切换、图表、排序通过；1997/1998 与 2002/2003 间断线，不编造缺席年；1997 PTS 常规赛 29.6、季后赛 31.1 与源一致 |
| LeBron James（2544） | 23 / 19 | 搜索跳转、逐季值、LAKER、指标切换、排序通过；2026 PTS 常规赛 20.9 与基础源一致 |
| Stephen Curry（201939） | 17 / 10 | 搜索跳转、赛制切换、图表、排序通过；2025 季后赛 RAPTOR 留空 |
| Alex Caruso（1627936） | 9 / 5 | 普通角色球员搜索、全部赛季及两个赛制、图表、排序通过 |

1. Node 内置测试 8/8 通过：对全部 20,668 条记录逐指标对照源档案与基础快照；独立 ID、同名 Patrick Ewing、复出断点、多队合计、缺失/零值、排序、API 及搜索验证。
2. Edge/Chromium 桌面 1280×900 和 Android 触屏尺寸 390×844：四位球员从搜索进入主页，两种赛制、赛季选择、BPM/VORP/WS/48/RAPTOR 图表选点、排序及横向滚动均通过，页面无横向溢出、无 JS 错误。使用头像失败回退场景。
3. 单季图表、无季后赛记录状态、未知球员 404、完整后端档案不可公开下载均通过。
4. 首页 TOP30、RAPTOR 自动接续和 LAKER 入口在两个尺寸下仍显示 30 行。逐一对比原始指标全部未改变，首页 HTML/脚本与原分支相同。
5. Vercel 构建命令通过，基础导入默认复用快照，不需要外部 API 或 Python。自动更新先导入来源数据、再生成索引及档案、测试后提交源 JSON；构建期生成的按球员 JSON 不提交。

```sh
node scripts/add-player-basic.mjs
node scripts/build-player-index.mjs
node scripts/build-player-profiles.mjs
node --test tests/player-search.test.mjs tests/player-profile.test.mjs
node scripts/build-site.mjs
```
