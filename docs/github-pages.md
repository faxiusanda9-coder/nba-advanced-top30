# GitHub Pages 部署

新站入口：<https://faxiusanda9-coder.github.io/nba-advanced-top30/>。

整个新站使用 GitHub Pages 提供网页、球员档案、生涯荣誉、赛季 JSON、每日比赛、Box Score、指标解释、球队标志和已缓存头像。访问新站不经过 Vercel，也不调用 Vercel 的 `/api/player`。旧 Vercel 配置保留用于迁移期间回退；停用旧项目不影响新站。

## 自动更新

`.github/workflows/deploy-pages.yml` 在主分支代码提交后构建和发布。每日比赛、赛季数据和荣誉工作流结束后，它也会通过 `workflow_run` 检查最新主分支，自动发布这些任务保存的数据。这个入口覆盖 `GITHUB_TOKEN` 数据提交不触发 `push` 工作流的情况。

每日比赛仍按 UTC 每小时 07、37 分（北京时间加 8 小时）检查，不承诺准点或实时。抓取、排队、构建和 Pages 发布都有延迟。若当前提交已成功发布，定时数据检查未产生新提交时，发布任务直接跳过。数据任务仍使用现有写入锁，发布任务仅读取文件，使用独立发布锁。赛季全量回填仅由手动 `backfill=true` 启动。

手动重新发布：在 Actions 选择 **Deploy NBA Advanced to GitHub Pages → Run workflow**。每日比赛补抓仍在 **Update NBA daily games and Game Score** 输入北京时间 `date` 或 `game_id`；任务完成后自动重新发布。无需托管平台 Token 或新数据库。

## 本地构建与整站打包

```powershell
node scripts/build-github-pages.mjs
node --test tests/*.test.mjs
$env:STATIC_ROOT='dist-cn'
$env:SITE_BASE_PATH='/nba-advanced-top30'
node scripts/serve-static.mjs
```

访问 `http://127.0.0.1:4173/nba-advanced-top30/`。`dist-cn/` 包含全部部署文件和每名球员／每场比赛的物理目录页面。`SITE_BASE_PATH` 可以设为其他项目路径；设为空字符串可构建独立域名的根路径版本。`deployment.json` 记录实际构建的源码提交，供上线核验。GitHub Actions 的 Pages 产物提供完整压缩包。

## 网络验证

GitHub Pages 提供免费平台域名，不需要购买自定义域名。它属于境外托管；国内不同网络的连接结果可能不同，需要使用者关闭 VPN 实测，不能把部署成功等同于全国网络均可直连。迁移验收包括新站首页、手机布局、搜索、球员档案、荣誉、指标解释、每日比赛、比赛明细和一次自动更新发布。
