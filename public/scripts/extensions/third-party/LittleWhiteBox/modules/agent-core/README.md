# Agent Core

`agent-core` 是小白X里所有 Agent App 共用的无 UI 能力层。

可以放这里：

- 模型配置、provider 预设、adapter factory
- Agent App 共用的配置表单逻辑与基础 markup，例如 API 配置面板
- provider adapters
- `Plan*` 账本算法和 `[Current plans]` 上下文构造
- `DelegateRun` 子任务执行器
- Agent 协议账本：provider history 映射、`tool_calls`/`tool` 结果落账、provider payload replay、Google session tool loop 辅助、思考块标准化与流式消息控制
- Agent App 通用工具原语，例如补丁解析/执行、文本文件类型判断
- 不绑定具体 App 的工具循环/压缩算法，只有在完全去掉 App 耦合后才能迁入

不要放这里：

- DOM、iframe、host overlay、设置页 UI
- 小白助手专属的 `local/` 工作区、Skills、Identity、Worklog、Slash、JS API
- 电纸书专属的 `book/...` 书库、阅读器、导入素材、创作台 UI
- 任何反向 import `modules/assistant/` 或 `modules/ebook/` 的逻辑

`tools/` 只放“无作用域”的工具原语。它可以解析 patch、验证文本扩展名、执行由调用方提供的内存态文件变更，但不能知道 `local/...`、`book/...`、IndexedDB 或宿主 UI。

具体 App 需要持久化表时，必须显式传入，例如：

```js
createPlanLedger({ plansTable });
```

不要让 `agent-core` 默认绑定某个 App 的数据库。
