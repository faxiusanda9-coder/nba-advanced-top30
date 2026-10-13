# NBA 球员生涯荣誉

## 交付范围

本次只增加生涯荣誉卡片、其他指定荣誉折叠列表、逐赛季奖杯及相关数据获取/构建/更新。没有改变高阶计算、TOP30、搜索排序、生涯趋势、球员对比或原赛季自动更新流程。

截至本次核验：本站 2,860 个 NBA 球员 ID 均读取了官方 PlayerAwards，15 个指定荣誉分类共有 2,725 条记录。三类统计王使用 1969–70 至 2025–26 共 57 季 NBA.com 官方 Season Leaders 名单。各分类在本次来源口径内均已覆盖，没有待补的来源类别；不把“完整读取官方记录”解释为独立审计证明官方数据库从不遗漏。

核心卡片固定为总冠军、FMVP、常规赛 MVP，手机仍是一行三张。官方记录证实没有获奖时显示 0；源未读取或不完整时显示数据暂缺，部分记录只显示“已确认 N 次”。其他荣誉默认折叠，没有添加任何荣誉分数、历史排名或主观权重。

## 来源与身份关联

| 内容 | 官方来源 | 处理 |
| --- | --- | --- |
| 总冠军、FMVP、常规赛 MVP、最佳阵容、最佳防守阵容、DPOY、ROY、全明星、全明星赛 MVP | `https://stats.nba.com/stats/playerawards?PlayerID={NBA_ID}`；[接口结构文档](https://github.com/swar/nba_api/blob/master/docs/nba_api/stats/endpoints/playerawards.md) | 校验响应 PlayerID、逐行 PERSON_ID、表头；只接受精确获奖名称与 Award 类型，区分阵容等级；冠军只来自明确 NBA Champion 记录 |
| 得分王、助攻王、篮板王 | [NBA.com 官方赛季回顾索引](https://www.nba.com/news/history-season-recaps-index)链接的每季 Season Leaders | 收录官方名单，不从项目的球员数据计算最大值；姓名只做唯一的精确标准化匹配，无法可靠关联时不分配 ID |
| 生涯范围核验 | NBA Stats CommonAllPlayers | 按 PERSON_ID 获取 FROM_YEAR/TO_YEAR，只用于统计王名单覆盖验证，不改现有个人资料 |

三大核心奖项也对照了 [NBA MVP 历史名单](https://www.nba.com/news/history-mvp-award-winners)及 [NBA Finals MVP 历史名单](https://www.nba.com/news/history-finals-mvp-winners)。MVP 投票排名、Sporting News MVP、NBA Cup MVP、东西部决赛 MVP、月最佳等均没有当作指定奖项收录。

常规赛 MVP、阵容、DPOY、ROY、全明星和统计王记录归属 REG；总冠军、FMVP 归属结束当年的 PST。例如 2019–20 赛季总冠军标在 2020 的季后赛表，常规赛表不会显示该冠军。两种表都保留原数据、排序与横向滚动，没有新增荣誉列；奖杯附在原赛季单元格内，点击打开当季本赛制的真实获奖名称和来源。

本次官方索引的 1999–00 地址有拼写错误，已使用核验可访问的同一官方文章 URL；1994–95 标题为 Season Winners，2008–09 得分项使用 PPG，解析器支持这两种格式。索引 2025–26 的 MVP 摘要与专门获奖名单不一致，未使用该摘要生成 MVP 记录；PlayerAwards 和专门 MVP 名单一致。

## 存储

- `sources/honors/player-awards.json`：每个 ID 保存一次官方来源、核验截止年份、更新时间及本次要求的原始荣誉字段；保留 NBA ID、描述、阵容级别、赛季和球队用于核验。
- `sources/honors/statistical-titles.json`：每季保存官方获奖者、可确认的 NBA ID、来源 URL、源更新时间、对应官方统计王行。
- `sources/honors/player-career-coverage.json`：官方 ID 与生涯覆盖范围的精简快照。
- `api/_data/honors/{player_id}.json`：构建生成，不提交 Git，不发布到静态目录。包含 `player_id`、各类别 `coverage` 和记录；每条有 `award_type`、`season`、`award_year`、`award_level`、`phase`、`source`、`updated_at`。
- 现有 `/api/player?slug=...` 返回单个球员的 `honors`，不下载全联盟荣誉库。荣誉文件缺失或 ID 不符时返回缺失状态，原球员统计仍可显示。

## 更新

独立 `.github/workflows/update-honors.yml` 每年 7 月 5 日 UTC 10:00（北京时间 18:00）运行。自动刷新档案中最近一季球员并补缺失 ID，更新当年官方统计王名单。没有加入每周赛季更新工作流，不会抓取或修改赛季统计文件。

手动：Actions → **Update NBA player honors** → Run workflow。`scope` 可选 active / all / missing；`through` 填已完成赛季的结束年份，如 2026，留空使用最近已完成的赛季年份。all 会刷新全部球员；missing 仅补缺；active 刷新最近一季并补新 ID。

两个获取步骤均限时、降速、保存来源快照。连续访问失败停止抓取，保留以前已核验数据；不会清零。年度流程会在摘要提示刷新失败，仍可由快照构建。Vercel 构建只读取已保存 JSON，不向 NBA 发实时请求。

```sh
# 从已保存来源离线构建
node scripts/build-player-honors.mjs
node --test tests/player-search.test.mjs tests/player-profile.test.mjs tests/player-honors.test.mjs

# 必要时手动刷新官方来源
node scripts/fetch-player-honors.mjs --all --refresh --through=2026
node scripts/fetch-honor-leaders.mjs --refresh --through=2026
```

NBA 数据不是由 nba_api 的代码许可证授权的数据集。保留 NBA.com 显著署名和逐项来源；没有复制新闻正文或增加图片。NBA 的统计使用限制见 [官方使用条款第 9 节](https://www.nba.com/termsofuse)，不能将公开访问理解为取得开放数据或商业再分发许可；完整且持续更新的统计数据库涉及原运营方授权要求。原站统计库的授权状态没有在本任务中变更。

## 文件变更

新增：`assets/player-honors-core.mjs`、`player-honors.js`、`player-honors.css`；`scripts/fetch-player-honors.mjs`、`fetch-honor-leaders.mjs`、`build-player-honors.mjs`；三份来源 JSON；`tests/player-honors.test.mjs`；独立荣誉工作流；本说明。

修改：`player.html`（荣誉容器与对话框）、`assets/player-profile.js`（荣誉渲染和赛季标记）、`api/player.js`（单人荣誉读取与失败回退）、`vercel.json`（离线构建步骤）、`.gitignore`（忽略生成文件）、`README.md`（文档入口）。

## 验收

| 球员 | 总冠军 | FMVP | 常规赛 MVP | 重点 |
| --- | --- | --- | --- | --- |
| Michael Jordan | 6 | 6 | 5 | 包含 1991/1992/1993 等覆盖期以前荣誉；一阵 10、二阵 1、防守一阵 9、得分王 10 |
| LeBron James | 4 | 4 | 4 | 最佳阵容 13/4/4、防守阵容 5/1；2020 助攻王；2020 MVP 投票第二没有标为 MVP |
| Stephen Curry | 4 | 1 | 2 | 2022 FMVP；2016、2021 得分王；NBA Cup/全明星 MVP 不替代三大核心 |
| Doug McDermott | 0 | 0 | 0 | 普通球员零次卡片仍显示，未造出奖杯或荣誉 |

13 项 Node 自动测试通过：对所有荣誉逐条核对原始来源、ID、年份与赛制；验证同名 Patrick Ewing、阵容等级、去重、未知值及 API 荣誉缺失/串档的安全回退。

Edge/Chromium 桌面 1280×900 和 Android 触屏尺寸 390×844 四位球员全部通过：搜索跳转、核心数值、展开年份、其他荣誉折叠、多个同季奖项、常规赛/季后赛奖杯分离、排序及图表兼容。320、360、390、412 像素下三张核心卡片仍为一行，页面没有横向溢出；模拟荣誉数据缺失时显示暂缺，统计仍正常。

原球员主页完整浏览器回归（含 Alex Caruso）通过；TOP30、RAPTOR 自动接续仍正常。首页、30 个赛季 JSON、指标模块和原更新工作流均与开发前相同。
