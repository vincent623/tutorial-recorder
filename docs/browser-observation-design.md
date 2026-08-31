# Browser Observation 设计规格

状态：设计已接受；Slice 1-3 已实现并通过测试环境能力矩阵，尚未接入正式 Agent 动作链
目标版本建议：2.9.0
相关决定：[ADR-0001](./adr/0001-browser-observation-seam.md)
领域语言：[CONTEXT.md](../CONTEXT.md)

## 1. 目标

把当前分散在 `agent-targeting.js`、`agent-action-guard.js`、`page-automation.js` 和 `agent-loop.js` 的页面事实读取集中到一个深 module，使 AI 录制从“截图 + 文字精确匹配 + 坐标”升级为“同步浏览器观察 + 观察元素引用 + 执行前复验”。

完成后应获得：

- 普通 DOM、SPA、开放 Shadow DOM、同源 iframe 的共同能力基线；
- CDP 与 chrome.scripting 两个 adapter 的显式能力差异；
- 教程截图、决策截图和远程观察投影的清晰隐私关系；
- 元素引用优先、坐标安全降级的动作输入；
- 可通过 module interface 验证的行为测试，而不是继续依赖源码字符串断言。

## 2. 非目标

- 不在本阶段引入新的浏览器 Agent 框架或云浏览器运行时。
- 不允许模型执行任意 JavaScript。
- 不关闭 Web 安全、站点隔离或浏览器安全策略。
- 不在目标网页写入 `data-agent-id`、覆盖层或其他标识。
- 不在本阶段保证跨域 iframe、封闭 Shadow DOM、Canvas 或 WebGL 的语义定位。
- 不把风险策略、人工确认、动作派发或教程持久化并入 Browser Observation。
- 不在正式客户版本中运行新旧观察双轨比较。

## 3. Module seam

Browser Observation 的目标 interface 对调用者提供三个行为：

1. 产生一次浏览器观察；
2. 对被截断的观察窗口进行有限细化；
3. 在动作执行前复验观察元素引用。

调用者无需知道 DOM selector、iframe 注入、Shadow DOM 遍历、元素去重、指纹、截图标注或 adapter 差异。module 不返回 DOM 节点、CDP node id、selector 或可跨观察复用的定位器。

当前 Slice 1-2 已开放 `observe` 与有限 `refine`。执行前复验将在后续 slice 通过同一 module seam 开放；元素指纹、frame/Shadow 路径、完整目标地址和短命元素映射保留在 module 内部，不属于外部观察结果。

建议的内部文件形状：

```text
background/browser-observation/
├── index.js                 # 唯一外部 interface
├── observation-cycle.js     # 同步截图、页面结构与重试
├── page-probe.js            # 只读、可注入的页面语义提取
├── element-ranking.js       # 可见性、去重、排序、截断
├── projection.js            # 远程脱敏投影
├── decision-annotation.js   # 临时决策截图
├── receipt.js               # 最小观察收据
└── adapters/
    ├── cdp-observation.js
    └── scripting-observation.js
```

这些是 implementation 内部 seam，不应被 Agent loop 或测试逐个调用。

## 4. 观察结果

外部 interface 返回判别明确的结果：

### `ready`

- 干净截图与元素事实属于同一观察周期；
- 观察窗口、页面来源、滚动位置和 adapter 能力已记录；
- 可以产生和复验观察元素引用。

### `degraded`

- 干净截图仍可用于视觉决策；
- 必须列出能力缺失、截断或不可访问区域；
- 不可靠区域不能产生元素动作，只能观察细化或进入视觉降级；
- 视觉降级动作继续经过单次动作确认。

### `unavailable`

- 截图失败、目标标签页不可录制、AI 数据共享授权撤回或无法得到自洽观察；
- Agent loop 暂停，并提供重试、人工接管和停止导出。

页面在观察周期内变化时先进行有限本地重试。不得把旧截图与新元素清单拼成一次观察。

## 5. 浏览器观察内容

一次本地浏览器观察包含：

- 短命观察 ID、时间和目标 tab/document 信息；
- 干净教程截图候选；
- 当前页面来源、标题、视口、缩放和滚动位置；
- 观察能力与不可访问区域；
- 当前观察窗口内经过排序的可交互目标；
- 截断状态和可细化区域；
- module 内部的短命元素映射；
- 临时决策截图；
- 可发送的远程观察投影；
- 可持久化的最小观察收据。

完整观察、决策截图和元素映射不得进入 IndexedDB、`chrome.storage.local`、教程 ZIP、CI artifact 或日志。MV3 worker 内存丢失时，旧引用直接失效并重新观察，不把完整映射持久化来换取恢复。

## 6. 可交互目标

识别顺序采用语义优先、多信号补充：

1. 可访问性角色和原生控件语义；
2. 关联 label、ARIA、可见文字、title、placeholder；
3. `tabindex`、`contenteditable`、`summary` 等明确行为信号；
4. 可见性、遮挡、禁用状态、视口命中和最近活动弹窗限制；
5. 嵌套目标去重，保留能代表用户意图的最小操作对象。

禁止从输入值生成名称。密码、验证码、卡号等字段的值在本地提取阶段即排除，不能先采集再依赖远程投影删除。

第一阶段共同能力：

- 主文档；
- 开放 Shadow DOM；
- 同源 iframe，包括嵌套 iframe；
- SPA 局部更新；
- 活动弹窗、焦点、遮挡和元素位移；
- 通过滚动后重新观察处理虚拟列表；
- 通过语义上下文区分重复文字目标。

第一阶段显式降级：

- 跨域 iframe；
- 封闭 Shadow DOM；
- Canvas/WebGL 自绘控件；
- 浏览器或站点阻止访问的区域。

## 7. 元素引用和复验

观察元素引用是随机、不透明、观察内有效的标识。模型只能看到引用及其脱敏语义，不能看到 selector、DOM 路径、CDP node id 或完整链接。

执行前 Browser Observation 复验：

- 元素身份、角色、类型、名称和可用状态；
- 表单方法及本地完整目标地址的风险语义；
- 页面来源和 document 身份；
- 可见性、遮挡、命中结果；
- 当前矩形与视口。

仅发生位移时返回新的矩形，Action Transaction 可以继续。身份、语义、风险、来源、可见性或 document 发生变化时，引用失效并重新观察。纯视觉坐标确认在视口或页面明显变化后直接失效。

## 8. 远程观察投影

远程投影必须经过现有 AI 数据共享授权，并与截图共享同一撤回、请求中止和重试前复查机制。

允许发送：

- 临时决策截图；
- 观察窗口、滚动状态、截断状态；
- 数量受限的观察元素引用；
- 角色、脱敏名称、状态和矩形；
- `GET`/`POST` 等方法；
- 同站/跨站分类，以及移除凭据、query 和 hash 后的主机名与路径。

禁止发送：

- 输入值、密码、验证码、卡号；
- 隐藏元素、屏幕外元素清单；
- 原始 HTML、DOM、Cookie、Storage；
- 完整链接、表单原始地址、URL 参数；
- module 内部定位信息和节点映射。

决策截图只在内存中存在。它在干净截图副本上绘制与观察元素引用对应的编号，不向真实网页插入覆盖层。

## 9. 观察细化

元素清单因数量上限截断时，模型不能直接把遗漏目标当作视觉降级。它先请求对一个视口区域或元素类别进行观察细化：

- 细化产生新的观察和新引用，旧引用全部失效；
- 不修改页面、不增加教程步骤、不需要用户确认；
- 次数和总耗时受限；
- 超过限制后暂停并建议人工接管，不能无限调用模型。

坐标降级只用于确实无法建立网页语义的区域。

## 10. Adapter 规则

### chrome.scripting adapter

- 默认在 `ISOLATED` world 运行只读 probe；
- 使用 frame/document 结果分别收集页面事实，不依赖顶层页面跨 frame 访问；
- 每次返回 JSON 可序列化数据，不返回 DOM 对象；
- 注入函数不得修改网页节点或依赖宿主页脚本状态。

### CDP adapter

- 仅在用户主动开始 AI 录制并成功 attach 后使用；
- debugger detach、DevTools 抢占或协议调用失败会使能力立即变化；
- CDP 节点信息仅作为内部 implementation 细节，不能成为长期引用；
- 不为提高可访问性而关闭 Web 安全或站点隔离。

共同基线必须在两个 adapter 上通过相同 interface 测试。CDP 的额外能力只能以观察能力声明暴露，不能改变风险策略含义。

## 11. 动作协议迁移

正式路径：

- `click`、`type_text`、`hover` 引用观察 ID和元素引用；
- `targetText` 仅用于教程说明和审计；
- `type_text + submit` 保留，但由本地元素语义和风险策略授权；
- 坐标动作必须携带视觉降级原因。

迁移期保留旧模型输出解析 adapter，把 `targetText/x/y` 归一化为旧式视觉候选，但不允许其绕过新复验和确认规则。

## 12. 观察收据与用户提示

观察收据只记录：结果、adapter、能力、元素数量、截断、耗时、降级原因、动作路径和复验结果类型。它不包含能还原页面内容的数据，随教程删除，只有用户主动导出诊断包时才可离开设备。

用户提示：

- `ready` 不额外打扰；
- `degraded` 在录制状态区持续提示能力限制；
- 确认框解释本次视觉降级的具体原因；
- `unavailable` 暂停并提供重试、接管、停止导出；
- 工程术语只出现在本地诊断详情。

## 13. 渐进迁移

### Slice 1：interface 与确定性夹具

- 建立 Browser Observation 外部 interface 和两个 adapter；
- 普通 DOM 行为与现有路径等价；
- 开发/测试环境运行影子观察；
- 不改变模型请求或正式动作执行。

实现状态：完成。测试专用 extension harness 会在同一普通 DOM 夹具上分别并行运行旧 scripting/CDP 文字定位与新观察，比较目标中心点；该 harness 不进入正式打包产物。Slice 1 检查点只声明并实现主文档共同基线，后续能力由 Slice 2 独立扩展。

### Slice 2：页面结构共同基线

- 开放 Shadow DOM、同源嵌套 iframe、活动弹窗、重复文字、元素位移；
- 统一元素排序、去重、指纹和能力声明；
- 建立观察细化。

实现状态：完成。两个 adapter 现在共享开放 Shadow DOM 与同源嵌套 iframe 的只读遍历、顶层视口坐标换算、活动模态范围、重复目标语义上下文和按角色/区域的有限细化。跨域 iframe、Canvas 自绘区域和封闭 Shadow DOM 仍保持显式能力缺失；跨域 iframe 与 Canvas 在真实 Chromium 夹具中返回 `degraded`。元素位移后的新观察会生成全新引用，旧观察引用不会跨观察复用。

### Slice 3：远程投影与元素动作

- 生成决策截图和脱敏投影；
- 更新授权文案、隐私政策和商店数据使用声明；
- 更新模型工具 schema，以元素引用为主；
- 扩展 DeepSeek provider smoke。

实现状态：完成。Browser Observation 现在只在显式 AI 数据共享授权下生成带编号的临时决策截图和脱敏远程投影；实际模型请求会重新读取持久化授权并受配置 epoch 与可撤回请求控制器约束。观察模式工具 schema 以短期元素引用为主，坐标点击必须声明视觉降级原因；同一 module seam 已提供执行前复验并区分原位可用、仅位移、页面变化与目标语义变化。DeepSeek 隔离 smoke 会逐一验证搜索、普通站内导航、同源 iframe 和开放 Shadow DOM 都命中指定动作类型与指定元素引用。正式 Agent loop 仍保持旧协议，切流与旧实现删除属于 Slice 4。

### Slice 4：正式切流和删除旧实现

- Action Transaction 使用观察复验；
- CDP 与兼容路径通过相同能力矩阵；
- 删除重复 DOM 指纹、文字定位和源码字符串测试；
- 正式构建不包含影子比较路径。

每个 slice 独立通过门禁后才能进入下一个，不以保留两套永久实现换取兼容。

## 14. 商业验收矩阵

发布阻断条件：

- 确定性能力矩阵在 CDP 和 scripting adapter 的共同基线上全部通过；
- 错误目标执行为 0；
- 高风险动作确认绕过为 0；
- 禁止字段进入远程观察投影为 0；
- 固定 CI 夹具中完整本地观察 p95 不超过 500ms；超预算返回显式截断或降级；
- DeepSeek smoke 至少覆盖搜索、普通站内导航、Shadow DOM/iframe 三类任务；
- 干净教程截图不含决策标注；
- 决策截图、完整观察和元素映射不出现在存储、日志、ZIP 或 artifact；
- 撤回 AI 数据共享授权会中止进行中的远程观察请求，并阻止重试；
- DevTools 抢占 debugger 后能力正确降级，录制仍可接管或停止导出。

公共网站验证作为非阻塞、定期人工证据，不把第三方页面波动引入确定性发布门禁。

## 15. Chrome 官方能力依据

- `chrome.scripting.executeScript` 支持按 tab、frame 或 document 注入，`allFrames` 与指定 `frameIds` 互斥；结果包含 `frameId` 和 `documentId`。
- `chrome.scripting` 默认运行于 `ISOLATED` world，注入函数及参数需要可序列化，适合只读 probe。
- Manifest V3 service worker 不能直接访问 DOM，因此页面事实必须通过 frame 注入结果或 CDP 获取。
- `chrome.debugger` attach 可能失败；打开 DevTools 或关闭标签页会触发 detach，CDP 能力必须可动态降级。

官方参考：

- https://developer.chrome.com/docs/extensions/reference/api/scripting
- https://developer.chrome.com/docs/extensions/reference/api/debugger
- https://developer.chrome.com/docs/extensions/develop/migrate/known-issues
