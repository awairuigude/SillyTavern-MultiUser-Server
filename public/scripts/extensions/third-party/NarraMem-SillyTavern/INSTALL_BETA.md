# NarraMem 酒馆内测版安装说明

版本：`0.4.0-beta.75`

最低 SillyTavern：`1.18.0`

这是一个可由 SillyTavern 扩展管理器直接安装的标准前端扩展。无需复制 Server Plugin，无需修改 `config.yaml`，也无需把 API Key 发给 NarraMem 发布者。

## 从酒馆安装

1. 先确认 SillyTavern 已升级到 `1.18.0` 或更高版本，并建议备份当前用户的 `data` 目录。
2. 打开“扩展”→“安装扩展”。
3. Git URL 只填写 `https://github.com/sanmingyue/NarraMem-SillyTavern`。
4. Branch or tag name 保持空白。
5. 点击“Install just for me”。安装成功后刷新酒馆页面。
6. 点击聊天输入框上方的“叙忆”按钮，或在扩展设置中打开“NarraMem 叙忆（内测 0.4.0-beta.75）”。记忆中心分为总览、记忆、当前任务、设置、日志与数据五页；手机上以底部面板显示。选择一个独立 API 配置：Custom 按酒馆自定义 Chat Completion 的习惯填写 URL 与 Key；DeepSeek 使用酒馆 1.18 原生 DeepSeek 适配，只填 Key。
7. 首次使用只需填写地址和 Key，再点一次“连接并读取模型”：扩展会依次保存当前配置、保存独立 Key、检查 Key 状态并读取模型列表；已有已保存 Key 时输入框留空即可复用。选择模型后会自动保存；接口只返回一个模型时会自动选择并保存。整个连接过程不消耗生成调用。
8. 默认按模型名自动匹配已验证的 NarraMem Prompt。无法识别时，页面会明确提示，并仅允许在“附加参数与高级设置”中手动选择兼容 Prompt。

后续更新使用酒馆扩展管理器的“更新”功能；始终跟踪独立仓库默认 `main`，不需要填写分支。

## 从 TauriTavern（TT 酒馆）安装

1. 打开 TT 的第三方扩展安装入口，Git URL 同样只填写 `https://github.com/sanmingyue/NarraMem-SillyTavern`，Branch／Tag 保持空白。
2. 安装后刷新或重启 TT，进入一个角色聊天；看到输入区“叙忆”按钮后，按上面的同一套独立 Memory API 步骤配置即可。
3. beta.72 会自动探测 TT 宿主，并通过 TT 官方分页历史 API 读取完整聊天；分页或聊天身份暂态不一致会有限本地重读，仍未同步时显示“等待 TT 同步”，用户可在记忆中心点击“刷新状态”重新读取。TT 历史中当前可见正文与选中 swipe 不一致时，只在 NarraMem 的只读缓存克隆内以前者为准，不修改用户聊天或其他 swipe。首个 Checkpoint 建立前不会预热或插入 Recall。它不再要求用户切换“全量加载”，也不会拿旧缓存或当前窗口片段继续抽取、Recall Source 判断或隐藏。

NarraMem 是纯前端扩展，不需要也不包含 SillyTavern Node-only 后端插件。TT 与标准酒馆继续共用同一扩展包、Memory Core、世界书格式、Prompt 和更新分支；不会产生第二套 TT 专版数据。

任务失败时，页面会显示阶段、错误类型、错误码和失败时间，并出现“重新抽取”。每次手动点击会开启一个新的有界轮次；轮内自动调用次数由“自动重试次数”决定，不会无限调用。

“导出诊断日志”不包含 API Key 或 Prompt 正文；“导出核心数据”可能包含聊天记录、角色经历、世界状态与其他隐私，发送给维护者前请先自行检查。

## 独立 API 与 Key

- 当前支持使用 Bearer Key 的 OpenAI-compatible `/v1/models` 与 `/v1/chat/completions`，接口需支持 Structured Outputs／JSON Schema。
- API 地址可填写服务根地址、`/v1`，或完整 `/v1/chat/completions`；扩展会规范化为同一服务根地址。
- 这是 NarraMem 自己的 endpoint、Key 和 model，不读取或跟随酒馆当前聊天 API、当前模型和预设；角色卡、Persona、世界书与聊天记录只作为记忆资料输入。
- Key 作为带独立 ID 的“NarraMem Memory API”条目保存在当前 SillyTavern 用户目录的 `secrets.json`。保存后扩展会恢复用户原本启用的 Custom API Key；以后只按 NarraMem 自己的 ID 取用。
- Key 原值不会写入扩展设置、世界书、日志或导出，也不会从 secrets 接口读回前端。设置页可替换或删除 NarraMem 自己的 Key 条目。
- “连接并读取模型”会先安全保存页面中填写的新 Key，再访问 `/models`；已有 Key 可留空复用，不会触发模型生成。
- 若连接失败，页面会区分“尚未保存 Key”“本地 Key 保存失败”“Key 被接口拒绝（401/403）”和一般接口失败；单独替换／删除 Key 收在折叠管理区，不是首次配置的必经步骤。

## 调用边界

- 记忆任务不调用酒馆前端 `generateRaw()`。扩展把自己组装的 messages 与 Schema 直接交给酒馆本地 custom chat-completions 传输；没有填写 `custom_prompt_post_processing`，因此不拼接当前预设或角色资料。
- 并发数和重试次数默认都是 `1`。重试次数 `1` 表示首次失败后再试一次；客户端传输本身不额外重试。
- 并发和失败重试均可设置，默认值都是 `1`。现代浏览器使用同源 Web Locks 约束多个酒馆标签页；缺少 Web Locks 时至少保证当前页面内的队列上限。
- 不设会话总调用次数上限，也不额外设置每分钟调用上限或最小请求间隔。
- NarraMem 不发送最大上下文或最大回复参数，使用模型／服务端默认值。
- 记忆任务利用后台空闲窗口运行；正常一问一答不等待 Memory API 完成。
- 新聊天首次累计到 14 个有效 AI 楼层后才启动记忆：处理最早 10 个并始终保留最新 4 个用于衔接；之后每新增 10 个有效 AI 楼层形成下一批。每批依次处理人物实体、场景篇章、经历事件、状态变化、认知秘密、因果链、伏笔与长期影响七个小模块。
- 任务运行时聊天页会显示可点击关闭的进度提示；关闭只影响显示，不会取消后台任务。

每个小模块的实际消息顺序固定为：

1. `system`：可编辑身份头部＋现有 NarraMem 模型专属任务正文。
2. `assistant`：可编辑身份确认。
3. `system`：当前小模块的专属任务正文。
4. `system`：角色卡、Persona、世界书、目标聊天片段及已完成前置模块组成的结构化资料。
5. `assistant`：可编辑“资料已收到”确认；关闭预填充后，同一正文改为 `system`。
6. `user`：当前小模块的固定结构化输出规则。

六段消息与响应 Schema 由 NarraMem 自己维护；不会发送已删除的免责声明。

## 自动记忆空间与楼层隐藏

- 打开或切换聊天时，以酒馆聊天记录 ID 自动选择唯一 Memory Set，并自动读取当前角色卡身份；设置页没有手动绑定流程。
- edit／delete／reroll 会触发可信重处理。只有抽取和叙事生命周期成功持久化后，才隐藏已经完成记忆处理的旧楼层。
- 删除一份聊天记录时，扩展会按 Registry 精确删除该聊天对应的 NarraMem Memory Set 世界书；同名聊天无法唯一识别时拒绝删除，避免误伤其他角色的记忆。
- 最新 4 个 AI 楼层具有最高保护优先级，永远保持可见；从第 4 个最新 AI 楼层开始的连续上下文也不会被旧楼层隐藏越过，以保留格式统一与内容衔接所需前文。

## 数据与隐私

NarraMem 使用酒馆世界书保存 Memory Set、Evidence、事件、状态、认知、因果、NarrativeThread 和 FutureImpact。设置页可下载两类文件：

- 诊断日志：不包含核心记忆正文，用于报告运行状态和错误。
- 核心数据 + 日志：可能包含聊天原文、角色身份、世界状态、因果证据和会话标识，下载前有两道隐私确认。

两类导出都不包含 API 地址、API Key、secret ID、Prompt 正文或其他凭据值。导出文件只保存在用户点击下载的位置，不会由 NarraMem 自动上传。SillyTavern 本机服务自身可能按其日志级别记录 API 请求；共享酒馆日志前也应按可能含聊天隐私处理。

## 内测反馈

反馈时请提供版本号、SillyTavern 版本、API 类型、复现步骤和“诊断日志”文件。只有在理解隐私风险并愿意提供剧情内容时，才发送“核心数据 + 日志”。不要在公开 Issue 中粘贴 API Key、`secrets.json`、Cookie 或完整聊天。

建议第一轮只做短聊天：确认设置页状态、后台抽取、Recall、刷新后恢复，以及 edit／delete／reroll 后重新处理。不要自行启动 1000+ 长跑。

## 停用与卸载

1. 在 NarraMem 设置页关闭扩展；如需清除 Key，点击“删除 Key”。
2. 在酒馆扩展管理器中停用或删除 NarraMem。

卸载扩展不会自动删除世界书中的 NarraMem 记忆数据，以免误删用户内容。需要彻底清理时，先导出并确认目标 Memory Set；当前内测版不提供未经真实宿主验证的全量删除按钮。
