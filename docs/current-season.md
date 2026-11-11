# 本赛季高阶追踪

生产入口：<https://faxiusanda9-coder.github.io/nba-advanced-top30/current-season/>。

本栏目独立于历史赛季菜单，固定展示正在进行的 **2026–27 常规赛**。它表示来源统计截止时的赛季累计统计或效率指标，不是当天单场 BPM / EPM。原历史榜单、58 场门槛、生涯比较、球员档案、荣誉和 RAPTOR / LAKER 数据不变。沿用此前已经迁好的 GitHub Pages；Vercel 自动部署保持关闭，但兼容路由已登记在配置中。

## 实际来源与截止时间

以下是首次上线核验结果，统计截止使用 NBA 官方比赛日期（美东），收录日期使用北京时间；后续状态以页面显示为准。

| 来源 | 指标 | 截止 | 说明 |
| --- | --- | --- | --- |
| Basketball Reference 衍生公开档案 / Sumitro Datta Kaggle，版本57 | BPM、OBPM、DBPM、WS、OWS、DWS、WS/48、VORP、PER | 2026-10-31 | 441 人；衍生档案发布于11月1日，**明显滞后**，页面显示等待来源更新。BRef 原页直接请求实测403，没有绕过挑战。 |
| NBA Stats / SportsDataverse 球员及球队赛季档案 | TS%、USG% | 2026-11-10 | 462 人，采用原始 advanced / pergame / regular-season / 2027 字段。没有用 NBA 的 DEF_WS 冒充 BRef DWS。 |
| Dunks & Threes | Actual EPM、Expected EPM | 未接入 | 方法页与 Actual 公开页面实测200，但完整可归档评级尚不可可靠取得，作者的程序化 API 要求订阅。没有购买、登录或推算替代值。 |

EPM 的 Actual 用本季已赛结果描述赛季，**以季前 Expected EPM 为起点**；Expected 是预测型，作者说明评级不包含评级当天比赛。两类的完整含义、用途、局限和作者链接在统一解释库中分别维护。

来源声明：[Kaggle 原始衍生档案与 CC0 说明](https://www.kaggle.com/datasets/sumitrodatta/nba-aba-baa-stats)、[SportsDataverse 球员档案](https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/nba_stats_player_season_stats)、[SportsDataverse 球队档案](https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/nba_stats_team_season_stats)、[作者当前 EPM 方法](https://dunksandthrees.com/about/epm)。

截止日期由同批 **30 队已赛场次逐队匹配 NBA 官方已结束赛程**，再用本站已归档的完整官方 Box Score 校验所有能匹配 NBA ID 的球员出场场次。无法完整验证时标为“尚未确认”。首次核验：NBA 462 人全部匹配；BRef 427 人匹配，14 人保持原始 BRef ID，不强行合并。BRef 88 场、NBA 160 场官方比赛档案可供交叉核验。`fetched_at` 始终是抓取时间，不当作统计截止。

## 三队球员抽查

| 球员 | 球队 | BRef 已赛 / BPM（截至10月31日） | NBA 已赛 / TS% / USG%（截至11月10日） |
| --- | --- | --- | --- |
| Stephen Curry | GSW | 5 / 14.8 | 9 / 72.2% / 33.2% |
| Nikola Jokić | DEN | 5 / 3.8 | 9 / 56.2% / 27.4% |
| Victor Wembanyama | SAS | 6 / 9.6 | 11 / 62.2% / 36.1% |

这些数值直接对应各来源保存的原始字段，不能把同一球员在不同截止日期的场次混用。来源检查报告由 GitHub Actions 保存为 `current-season-source-check` artifact，包含实际 HTTP 状态、发布日期、资格门槛、截止验证及三名球员样本。

## 身份、排名及变化

NBA 数据使用其稳定数字 ID；BRef 使用稳定的 BRef slug。仅在 **本赛季唯一、完整姓名精确相同且球队对应**时关联 NBA ID；已经核实的来源 ID 可随转队延续。重音不相同、模糊姓名或同名不唯一时不强合并；页面显示来源身份和真实数据。转队使用来源的2TM／3TM合计，禁止把各段的效率或排名直接相加。

每个来源使用同批30队场次：场均至少20分钟；最低出场 `max(1, ceil(30队平均已赛 × 58 / 82))`。这是本站规则。上线时 BRef 门槛5场，NBA门槛8场；BPM177人、TS%及USG%192人参与排名。只有具备该项真实数值的合格球员参与；并列使用竞争排名（1、2、2、4）。筛选和搜索只影响显示，不重新计算联盟排名。未达标仍能查看数据。

数值变化 = 本次 − 上一次同来源、同模型、同赛季、同赛制及同规则版本快照。排名变化 = 上次排名 − 本次排名。TS%、USG% 的差值为百分点。首次收录、新入榜、未达门槛、已离榜、无数据和不可比较分别显示。值为0、负值与缺失值严格区分。

实施过程中实际保存了两次 NBA release：北京时间11月11日22:50左右抓取的版本统计到11月9日；23:01左右抓取的版本统计到11月10日。原始首次捕获证明在 `sources/current-season/2026-27/`。两份是**实际获取的不同版本**，并非根据当前值倒推。TS%有134人数值变化，155名具备两次合格排名的球员名次发生变化；自动测试对全表重新独立复算。BRef只有一份真实观察，不能生成涨跌。

## 归档与按需加载

独立目录 `data/current-season/2026-27/`：

- `config.json`：赛季、来源、资格规则、EPM接入状态。
- `manifest.json`：来源状态、最新有效指针、实际快照目录和每日有效核验索引。
- `snapshots/{source}/{snapshot_id}.json`：不可变的完整快照，含原始字段、身份、模型、资格和逐指标血缘记录。
- `latest/{metric}.json`：默认只加载所选指标的轻量排名及比较结果。
- `series/{source}/{player_id}.json`：点击某个球员后才读取其已保存曲线。

每个实际统计版本独立保存，不覆盖历史。数据不变不复制快照、不改原始抓取时间。每天首次成功核验保存一个真实的日期索引；同日无变化重复运行不提交。同一天新版本更新该日索引，并保留全部版本。查询日期是北京时间实际核验／收录日，不是来源统计截止日；没保存过的日期明确显示未收录。

## 自动更新与失败恢复

独立工作流 `.github/workflows/update-current-season.yml`：UTC **01:23、07:23、13:23、19:23**，北京时间 **09:23、15:23、21:23、次日03:23**。支持 `workflow_dispatch` 选 `all / bbref / nba / epm` 补抓。来源可能只每天或更慢发布，任务排队及发布也有延迟。

抓取超时20秒、最多2次尝试、并发最多2；403、401、404、429不反复重试。不绕过 BRef 挑战、登录或订阅。校验赛季、字段、稳定ID、完整性、同批球队和版本后才保存。来源失效保留最后快照、记录失败状态。NBA 网络失效时，BRef仍可使用已核验的 NBA **身份表**匹配，不会把旧 NBA 统计当作新数据。

所有数据写入与现有任务共用 `nba-archive-writer` 锁。Pages 通过 `workflow_run` 接收本任务结束事件，覆盖 Actions bot 数据提交不会触发 `push` 的情况；已发布且没有新数据／日索引时跳过。有效来源可部分成功发布，失败来源不覆盖成功来源。抓取报告可在对应 Actions run 的 artifact 中下载。

本地检查：

```sh
node scripts/update-current-season.mjs --dry-run
node scripts/update-current-season.mjs --source=bbref
node scripts/update-current-season.mjs --source=nba
node --test tests/*.test.mjs
node scripts/build-github-pages.mjs
```

## 验收

包含真实赛季及三队样本、两份实际 NBA release 的数值及排名复算、并列／负数／零／缺失、首次收录及入榜、失去资格、跨来源及模型隔离、转队及同名、延迟／失败／修正／重复执行、每日核验索引及未收录日期。浏览器检查320、390、1280像素布局、球员搜索、真实数值与联盟排名、触控曲线、EPM缺失状态及既有历史功能。新栏目不请求境外运行时图片或API，均加载新站同域静态档案。
