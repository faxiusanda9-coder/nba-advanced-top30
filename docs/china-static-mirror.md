# 国内静态部署准备

## 当前状态

正式站点仍是 `nba-advanced-top30.vercel.app`。根据 [Vercel 的中国大陆访问说明](https://vercel.com/kb/guide/accessing-vercel-hosted-sites-from-mainland-china)，`.vercel.app` 在中国大陆可能慢或无法连接，Vercel 不保证大陆可用性。域名或网络问题不能通过改页面文案修复。

仓库已加入独立的静态镜像构建；**尚未发布国内网址**，也未宣称用户无需 VPN 即可访问。正式的中国大陆节点入口需要域名、ICP备案和可用的托管账号。腾讯云 [EdgeOne Pages 域名说明](https://pages.edgeone.ai/document/domain-overview)指出：大陆节点的自定义域名需要备案，平台默认项目域名在大陆仅能通过有效期 3 小时的预览链接访问。腾讯云 [CloudBase 默认域名说明](https://docs.cloudbase.net/service/alias)也把默认域名限定为开发测试，并提示生产访问可能受限。

## 镜像构建

`edgeone.json` 配置了 Node 22 构建命令和 `dist-cn` 输出目录。它沿用 Vercel 已有的数据构建步骤，随后运行 `scripts/build-static-mirror.mjs`。该脚本：

- 复制现有网页、赛季档案和每日比赛 JSON；
- 为现有 2860 名球员生成逐人 JSON 和对应静态页面；
- 为已收录比赛生成独立静态路径；
- 将运行时球员请求从 `/api/player` 改为同域名 JSON；
- 将首页和球员页的运行时 NBA CDN 头像改为已缓存的本站图片，缺少头像时使用现有首字母占位。

GitHub Actions 仍从 NBA 官方公开来源抓取数据并提交 JSON；镜像只负责向访问者提供已保存的数据。它不需要新数据库或云服务器。托管平台接入 Git 后，仍需实际验证 Actions 的数据提交能触发镜像重新部署。

本地生成和核验：

```sh
node scripts/add-player-basic.mjs
node scripts/add-estimated-raptor-playoffs.mjs
node scripts/build-player-index.mjs
node scripts/build-player-profiles.mjs
node scripts/build-player-honors.mjs
node scripts/build-site.mjs
node scripts/build-static-mirror.mjs
node scripts/verify-static-mirror.mjs
```

本次本地构建结果：2860 份逐人档案、174 个比赛路径、6645 个文件、总计 83.2 MB，单文件最大 0.85 MB；低于 [EdgeOne Pages 免费版当前的 20000 文件、25 MB 单文件限制](https://pages.edgeone.ai/document/billing-plan-comparison)。镜像在 320、390、1280 像素浏览器视口通过首页、每日比赛、单场比赛检查；LeBron James 静态球员档案在 390 像素视口成功打开。正式部署后还必须从真实中国大陆网络分别验证首页、球员页、每日比赛、历史数据和自动更新。

## 接入前提

需要一个自有域名和符合托管区域要求的ICP备案，再用该域名绑定中国大陆节点。没有这些条件时，可以测试其他境外平台或腾讯云的开发预览地址，但不能把其作为长期稳定、无需 VPN 的国内正式入口。构建本身不产生国内公网网址。
