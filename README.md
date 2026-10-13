# NBA 高阶数据 TOP 30

按赛季查看 NBA 球员常规赛或季后赛高级数据，并按选定指标显示联盟前 30 名。

## 历史数据

- 覆盖 1996–97 至 2025–26，共 30 个赛季。
- 网页从项目内的 `data/{赛季结束年份}.json` 读取数据，不在每次访问时请求 NBA Stats 或第三方 API。
- 例如 `data/1997.json` 对应 1996–97 赛季，`data/2026.json` 对应 2025–26 赛季。
- 数据来自 [SportsDataverse 的 NBA Stats 历史档案](https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/nba_stats_player_season_stats)，该档案基于 NBA Stats 数据并发布常规赛和季后赛记录。

网页展示的 NBA Stats 高级指标包括 OFF RTG、DEF RTG、NET RTG、TS%、USG%、REB%、AST% 和 PIE。另从 [Basketball Reference 衍生常规赛档案](https://www.kaggle.com/datasets/sumitrodatta/nba-aba-baa-stats)合并 PER、OWS、DWS、WS、WS/48、OBPM、DBPM、BPM 和 VORP，覆盖 1996–97 至 2025–26；季后赛同一组指标也覆盖这 30 个赛季，其中 1996–97 至 2021–22 来自 [季后赛历史档案](https://www.kaggle.com/datasets/robertsunderhaft/nba-playoffs)，2022–23 至 2025–26 来自 [NBA Stats API 的季后赛查询](https://github.com/ehammill/nbastats)。该 API 声明统计对照 Basketball Reference 和 NBA.com，近四季快照保存在 `sources/bbref-playoffs/`，包含获取时间、来源和官网对应页面。个别原始数值缺失时留空。

WS、VORP 是累计贡献值，比较时受出场时间影响；WS/48、BPM 等更适合看效率。档案按球员姓名和赛季出场场次匹配，遇到转队球员使用 Basketball Reference 的赛季合计行；姓名或场次对不上的少数记录留空。历史 CSV 由 Kaggle 作者整理，原始统计口径来自 Basketball Reference，并非 NBA Stats 官方指标。

## RAPTOR / LAKER 指标

- FiveThirtyEight 原版 RAPTOR 档案提供 RAPTOR 进攻、防守、总值，覆盖至 2021–22。原始 RAPTOR 是赛季级数据，常规赛与季后赛行会共用当季 RAPTOR 值；WAR 则按赛制拆分。
- Neil Paine 的 Estimated RAPTOR 估算版提供进攻、防守、总值与 WAR，GitHub CSV 覆盖至 2024–25 常规赛。作者将后续模型改名为 LAKER，2025–26 常规赛和季后赛的同一组指标已从作者公开榜单导入，分别匹配 582/582 和 230/230 名球员。来源快照保存在 `sources/laker/`；常规赛榜单更新于 2026-04-13，季后赛更新于 2026-06-14，球员场次及出场时间与本项目对应赛制的全季记录一致。保留作者公开的总值与 WAR，部分源单元格经过四舍五入。
- 排行榜和生涯曲线提供“RAPTOR / LAKER 自动接续”：优先使用 FiveThirtyEight 原版，然后 Estimated RAPTOR，再接续 LAKER；表格和曲线悬停显示实际来源。网页保留自动接续及 LAKER 综合、进攻、防守和 WAR 的单独入口；已移除旧版 RAPTOR 与 Estimated RAPTOR 的单独选择项。各版本模型口径不同，跨来源的连续曲线需谨慎解读；2024–25 季后赛仍缺少已导入的接续指标。
- 数据来源：[FiveThirtyEight RAPTOR 历史档案](https://github.com/fivethirtyeight/data/tree/master/nba-raptor)、[Neil Paine Estimated RAPTOR CSV](https://github.com/Neil-Paine-1/NBA-elo/blob/main/nba-estimated-raptor.csv)、[估算方法说明](https://github.com/Neil-Paine-1/NBA-elo/blob/main/README.md)。
- LAKER 来源：[作者 2025–26 页面](https://neilpaine.substack.com/p/2025-26-nba-elo-forecast-and-player)、[公开常规赛榜单](https://datawrapper.dwcdn.net/t5PSm/)、[公开季后赛榜单](https://datawrapper.dwcdn.net/5L6UD/)。导入使用页面公开加载的数据文件；不依赖订阅区的历史电子表格。

## 更新历史数据

`scripts/build-data.mjs` 使用 Node.js 从公开 CSV 档案提取 NBA 高级数据，`scripts/add-raptor.mjs` 合并 RAPTOR 与 Estimated RAPTOR，`scripts/add-bbref.mjs` 合并 Basketball Reference 衍生常规赛高级指标，`scripts/add-bbref-playoffs.mjs` 合并历史季后赛高级指标，`scripts/add-bbref-recent-playoffs.mjs` 合并近四季季后赛快照；都不需要 Python。近四季脚本加 `--refresh` 可更新 API 快照，接口不可用时使用已保存数据；按球队查询并核对全季总人数，避免并列排序造成分页重复。GitHub Actions 每周检查并刷新数据；也可以手动回填全部 30 个赛季：

1. 打开仓库的 **Actions** 页面。
2. 选择 **Update NBA season archive**。
3. 点击 **Run workflow**，勾选 `backfill`，再运行。

`scripts/add-laker.mjs` 从保存的 LAKER 快照重建 2025–26 两种赛制的数据；加 `--refresh` 可核对作者公开榜单并保存更新，下载失败或榜单切换赛季时保留已保存快照。每周更新流程已接入此脚本。

合并到 `main` 后，工作流会先回填这 30 个赛季并提交 JSON 文件；之后每周检查新赛季数据。更新只写入有变化的赛季文件。

## 球员搜索与主页

右上角搜索覆盖 1996–97 至 2025–26 的赛季档案。按 NBA `player_id` 合并常规赛与季后赛全部记录，包括没有达到 TOP30 场次/分钟门槛的球员。同名球员保留不同 ID 和主页地址；这套来源包含统计档案中的球员，零出场且未进入档案的注册球员需后续接入名单源补充。球员生涯范围、球队历史也以这 30 季档案中实际出现的记录为准。

### 文件与职责

| 文件 | 用途 |
| --- | --- |
| `scripts/build-player-index.mjs` | 扫描 `data/1997.json`–`2026.json`，生成球员库、轻量索引和初始评分 |
| `api/_data/players.json` | 完整球员库，打包到后端函数，不发布到静态网站目录 |
| `data/player-index.json` | 搜索用轻量索引，仅包含 ID、姓名、标准化姓名、slug、评分和简短区分信息 |
| `config/player-popularity.json` | 可维护的评分权重、版本和近期活跃系数 |
| `assets/player-search-core.mjs` | 名称标准化、部分拼写、关键词、轻量拼写容错和排序 |
| `assets/player-search.js` / `player-search.css` | 首页及球员主页共用的下拉搜索组件，支持上下键、回车、Esc 和手机布局 |
| `player.html` / `assets/player-profile.js` | `/player/:slug` 基础主页，目前只显示球员名、头像与内容占位 |
| `api/player.js` | 按 slug 读取一个球员，返回 400/404/405 等明确状态 |
| `scripts/build-site.mjs` | 仅把页面、浏览器资源与公开索引/赛季数据输出到 `public/` |
| `tests/player-search.test.mjs` | 索引覆盖、同名去重、搜索排序、拼写与 API 验证 |

`index.html`、`vercel.json` 和更新工作流同步接入搜索与主页路由；`.gitignore` 排除生成的 `public/` 目录。排行榜原有脚本、RAPTOR 自动接续和生涯对比行为保持原样。

### 球员库结构

每个球员记录包含：

```json
{
  "player_id": "2544",
  "full_name": "LeBron James",
  "normalized_name": "lebron james",
  "slug": "lebron-james",
  "aliases": [],
  "team_history": [{ "team": "CLE", "seasons": ["2003-04"] }],
  "career_range": { "first_season": "2003-04", "last_season": "2025-26", "scope": "observed_archive" },
  "position": null,
  "last_team": "LAL",
  "popularity_score": 461.013,
  "popularity_components": { "historical": 157.838, "peak": 99.24, "playoffs": 136.735, "recent": 67.2 }
}
```

上例的球队历史只展示一项作为结构示例；生成文件保存档案中全部已观察到的球队和赛季。位置字段在源记录提供时填写，否则为 `null`。已有 slug 在重建时保留，同名球员的初始 slug 添加 ID 后缀以避免冲突。

### 搜索与评分

搜索框首次获得焦点时下载一次轻量索引；后续输入在浏览器内匹配，不下载全部球员库或 30 个赛季。匹配忽略大小写、重音符号和标点，支持姓名关键词、词序变化、部分拼写。先查完整姓名及直接匹配，未找到时才启用少量拼写容错；每组匹配按 `popularity_score` 降序，最多展示 8 项。同名结果显示最后收录赛季及球队用于区分。

评分是可解释的历史影响力与近期活跃度代理值，来源为现有 Basketball Reference 衍生数据；不是实时外网搜索次数。权重统一写在配置中，没有逐人手工录入：

- 历史贡献：`20 × ln(1 + 常规赛 VORP)` 加 `10 × ln(1 + 常规赛 WS)`。
- 巅峰表现：`6 × 巅峰 BPM` 加 `1.2 × (巅峰 PER − 15)`，使用至少 30 场且场均至少 20 分钟的常规赛记录。
- 季后赛贡献：`24 × ln(1 + 季后赛 VORP)` 加 `12 × ln(1 + 季后赛 WS)`。
- 近期活跃：最近三个赛季的系数为 `1 / 0.55 / 0.2`；活跃奖励 48 分，近期至少 20 场且场均至少 15 分钟时，加入 `3 × BPM` 与 `1.5 × (PER − 15)`。

公式中负贡献和低于均值的奖励按零处理。评分总值及分项都保存到球员库；未来可在生成步骤中并入可靠的全明星、MVP、总得分或搜索频次来源，更新评分版本。

### 自动更新与扩展

```sh
node scripts/build-player-index.mjs
node --test tests/player-search.test.mjs
node scripts/build-site.mjs
```

GitHub Actions 在赛季指标更新后重建并验证索引，再一起提交；Vercel 部署时也重建索引和静态输出。生成数据无变化时不会因时间戳制造额外提交。

后续在 `api/player.js` 中按 `player_id` 加载独立资料或赛季数据，在 `player.html` 中扩展资料卡与生涯模块即可；搜索组件继续只使用轻量索引。主页路由示例：`/player/lebron-james`，单球员接口：`/api/player?slug=lebron-james`。
