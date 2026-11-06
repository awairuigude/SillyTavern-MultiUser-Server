# SillyTavern · 服务器多用户配置版

这是从服务器当前运行目录整理出来的 SillyTavern 多用户版本，面向个人部署和小范围邀请使用。

## 这个版本改了什么

- 多用户账号、邀请码注册和用户数据隔离。
- 管理员角色与普通用户分开；管理员可以管理角色广场。
- 角色广场支持 SFW/NSFW 分类、公开状态、简介、详细介绍、导入注意事项和管理员编辑。
- 角色卡支持上架、下架、删除、拖动排序；各分类独立编号，新增卡默认追加到末尾。
- 角色卡保留 PNG 内嵌的世界书、正则和脚本等内容，导入后由用户独立使用。
- 新用户默认界面与配置：Dark Lite 主题、页面宽度 60、聊天补全优先，以及预设/文风等默认项。
- 非管理员新用户默认关闭 `st-chatu8` 与 `NarraMem（叙忆）`，其他设置不随意改动。
- 简单配置入口、首次提示、可收起的底部面板，以及登录/注册界面优化。

## 数据边界

本仓库只保留程序代码、默认配置和角色广场公开资源。

不会提交：

- 管理员账号目录；
- 其他用户目录、聊天记录、角色卡、世界书和个人设置；
- API Key、密码、Cookie、`secrets.json`；
- 邀请码、备份、日志和运行缓存。

角色广场公开资源位于 `data/_community/`。用户运行数据仍应放在服务器自己的 `data/` 目录中；不要把它们提交到 GitHub。

## 部署提示

1. 克隆仓库并安装依赖：`npm ci`。
2. 根据服务器环境修改 `config.yaml`，至少设置监听地址、端口、域名白名单和登录安全策略。
3. 在服务器上单独建立用户数据目录，设置管理员账号、密码和邀请码。
4. 使用反向代理和 HTTPS 对外提供访问；不要把 API Key 写进仓库文件。
5. 启动：`node server.js --configPath ./config.yaml`。

仓库中的 `config.yaml` 是已清理敏感值的模板，不包含线上服务器密码。

## 目录说明

- `src/community/`：多用户与角色广场服务端逻辑。
- `public/community.html`、`public/css/community.css`、`public/scripts/community.js`：角色广场页面。
- `community-config/`：新用户默认配置和默认世界书。
- `data/_community/`：角色广场公开索引、封面和角色卡。
- [SERVER-DEPLOYMENT.md](SERVER-DEPLOYMENT.md)：发布范围与数据安全说明。

## 上游项目

本项目基于 [SillyTavern](https://github.com/SillyTavern/SillyTavern)，保留其原项目许可证与版权信息；本仓库中的多用户和角色广场改动用于本服务器版本。
