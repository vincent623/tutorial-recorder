# Tutorial Recorder - 系统架构文档

<meta>
  <document-id>tutorial-recorder-sys</document-id>
  <version>1.0.0</version>
  <project>Tutorial Recorder</project>
  <type>系统架构</type>
  <created>2026-04-30</created>
  <depends>real.md, cog.md, spec-prd.md</depends>
</meta>

---

## 1. 架构概述

**模式：** 事件驱动分层架构（Chrome Extension Manifest V3）

**部署：** 纯客户端 Chrome 扩展，无后端服务。所有数据存储在用户本地浏览器，所有 AI 调用由 background service worker 直接发起。

**架构特点：**
- 无构建工具、无打包、无框架 — 原生 JS ES Module
- Service Worker 作为唯一编排中枢，所有业务逻辑集中处理
- 多个 Chrome 上下文（Popup / Content Script / Offscreen / Settings）通过消息传递与 background 通信
- CDP 调用通过 chrome.debugger API，仅 AI 录制模式使用

---

## 2. 系统图

```
┌─────────────────────────────────────────────────────────────────┐
│                       Chrome Extension                          │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │  Popup   │  │ Settings │  │Workspace │  │    Content    │   │
│  │ (录制控制)│  │ (完整设置)│  │(工作台UI)│  │  (页面反馈)   │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘   │
│       │              │              │               │           │
│       │ chrome.runtime.sendMessage  │               │           │
│       └──────────────┴──────────────┘               │           │
│                      │                              │           │
│                      ▼                              │           │
│  ┌───────────────────────────────────────────────────┐          │
│  │              Background Service Worker             │          │
│  │                                                   │          │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────┐ │          │
│  │  │ Recording   │  │ AI Analysis  │  │ Export    │ │          │
│  │  │ Controller  │  │ & Agent Loop │  │ Pipeline  │ │          │
│  │  └──────┬──────┘  └──────┬───────┘  └─────┬────┘ │          │
│  │         │                │                 │      │          │
│  │  ┌──────┴──────┐  ┌──────┴───────┐  ┌─────┴────┐ │          │
│  │  │ Screenshot  │  │ Vision API   │  │ ZIP/PDF  │ │          │
│  │  │ Engine      │  │ Gateway      │  │ Builder  │ │          │
│  │  │(standard/   │  │(multi-       │  │          │ │          │
│  │  │ CDP)        │  │ provider)    │  │          │ │          │
│  │  └─────────────┘  └──────────────┘  └──────────┘ │          │
│  │                                                   │          │
│  │  ┌─────────────┐  ┌──────────────┐                │          │
│  │  │ Asset Store │  │ Settings     │                │          │
│  │  │ (IndexedDB) │  │ Manager      │                │          │
│  │  └─────────────┘  └──────────────┘                │          │
│  └───────────────────────────────────────────────────┘          │
│                      │                              │           │
│       chrome.runtime.sendMessage                    │           │
│                      │                              │           │
│                      ▼                              │           │
│  ┌───────────────────────────────────┐              │           │
│  │     Offscreen Document            │              │           │
│  │  ┌─────────────┐  ┌────────────┐ │              │           │
│  │  │ Media       │  │ Screenshot │ │              │           │
│  │  │ Capture     │  │ Timer      │ │              │           │
│  │  │(video/audio)│  │ (interval) │ │              │           │
│  │  └─────────────┘  └────────────┘ │              │           │
│  │  ┌─────────────┐                 │              │           │
│  │  │ PDF Renderer│                 │              │           │
│  │  │ (Canvas)    │                 │              │           │
│  │  └─────────────┘                 │              │           │
│  └───────────────────────────────────┘              │           │
│                                                     │           │
│  ┌─────────────────────────────────────────────────┐│           │
│  │              CDP Layer (Phase 1+)                ││           │
│  │  chrome.debugger ──► Page.captureScreenshot     ││           │
│  │                    ──► DOM.getNodeForLocation    ││           │
│  │                    ──► Input.dispatchMouseEvent  ││           │
│  │                    ──► Input.insertText          ││           │
│  └─────────────────────────────────────────────────┘│           │
│                                                     │           │
│  ┌──────────────────── Storage ─────────────────────┐│           │
│  │  chrome.storage.local  → 设置、历史索引          ││           │
│  │  chrome.storage.session → 录制运行时状态         ││           │
│  │  IndexedDB             → 录制数据（截图、媒体）   ││           │
│  └──────────────────────────────────────────────────┘│          │
└─────────────────────────────────────────────────────────────────┘
                              │
                    直接 fetch（由 background 发起）
                              │
                              ▼
              ┌───────────────────────────────┐
              │     External AI Providers      │
              │  OpenAI / Claude / Gemini /    │
              │  火山方舟 / 硅基流动 / 百炼 /   │
              │  OpenRouter / Compatible       │
              └───────────────────────────────┘
```

---

## 3. 子系统

### 3.1 Recording Controller（录制控制器）

**职责：** 管理录制会话的完整生命周期 — 创建、暂停、继续、停止、状态持久化。

**组件：**
- RecordingStateMachine：录制状态机（idle → recording → paused → generating → idle）
- RuntimeStateManager：通过 chrome.storage.session 持久化运行时状态，service worker 重启后可恢复
- BadgeManager：更新扩展图标 Badge（REC / II / ...）
- TakeoverHandler：AI → 手动模式的无缝切换（Phase 3）

**接口：**
- 输入：startRecording / pauseRecording / resumeRecording / stopRecording / startAiRecording / takeoverRecording
- 输出：recording 对象（含 screenshots 数组）、runtime state、通知消息

**依赖：** Screenshot Engine、Asset Store、Settings Manager

### 3.2 Screenshot Engine（截图引擎）

**职责：** 捕获目标标签页的视觉快照，支持两种模式。

**组件：**
- StandardCapture：使用 `chrome.tabs.captureVisibleTab`，要求标签页前台可见（现有）
- CdpCapture：使用 `chrome.debugger` + `Page.captureScreenshot`，支持后台截图和区域裁切（Phase 1 新增）
- InteractionTracker：采集用户交互事件（click/change/submit/keydown），关联到截图的 pageContext
- CdpElementLocator：通过 `DOM.getNodeForLocation` 精确定位交互元素（Phase 1 新增）

**接口：**
- 输入：captureScreenshot({ trigger, allowWhenPaused, clip? })
- 输出：screenshot 对象（id, data, timestamp, timeOffsetMs, trigger, pageContext）

**截图模式选择策略：**
```
settings.screenshotEngine === 'cdp' && recording.isCdpAvailable
  ? CdpCapture.capture(tabId, clip?)
  : StandardCapture.capture(windowId)
```

**降级策略：** CDP attach 失败时自动回退 StandardCapture，通知 Popup。

### 3.3 AI Analysis & Agent Loop（AI 分析与 Agent 循环）

**职责：** 与外部视觉模型交互，包含单轮分析和多轮 Agent 两种模式。

**组件：**
- VisionApiGateway：统一的 AI 调用入口，支持 9 家 Provider、3 种 API 风格
- PromptRenderer：渲染提示词模板（内置 4 版 + 自定义），注入页面上下文变量
- AnalysisRunner：录制停止后逐图分析，串行调用 VisionApiGateway（现有）
- AgentLoop：多轮浏览器操控循环（Phase 3 新增）
- ToolExecutor：将 AI 决策转化为 CDP 操作（click_at_xy / type_text / scroll / finish）（Phase 3 新增）

**VisionApiGateway 调用流程：**
```
resolveVisionUrl(apiBaseUrl, apiStyle)
  → buildVisionRequest(screenshot, settings, index, screenshots)
    → fetch(url, { headers, body, signal: AbortController })
      → extractVisionText(response, apiStyle)
```

**AgentLoop 循环流程（Phase 3）：**
```
while (!done && stepCount < maxSteps && !timeout) {
  screenshot = CdpCapture.capture(tabId)
  decision = VisionApiGateway.chat(screenshot, context, toolDefinitions)
  if (decision.tool === 'finish') break
  ToolExecutor.execute(decision)
  recordStep(screenshot, decision.description)
  notifyPopup('agentStep', { step: stepCount, description })
}
```

**接口：**
- 输入（分析模式）：analyzeImage(screenshot, settings, index, screenshots)
- 输入（Agent 模式）：startAgentLoop(targetDescription, settings, tabId)（Phase 3）
- 输出：步骤说明文本 / Agent 执行步骤列表

**约束：** 单步超时 45 秒；Agent 循环最大 50 步 / 10 分钟（real.md C4）

### 3.4 Export Pipeline（导出管道）

**职责：** 将 recording 转化为可下载的教程 ZIP 包。

**组件：**
- MarkdownBuilder：生成 tutorial.md，含元信息头 + 每步骤截图引用 + 描述
- PdfRenderer：在 Offscreen Document 中通过 Canvas 渲染封面页和步骤页，使用 jsPDF 输出
- PdfGuard：对超大录制按截图数量和图片体积阈值跳过 PDF，保留非 PDF 素材导出
- ZipBundler：使用 fflate `Zip` / `ZipDeflate` 逐条写入 MD + PDF + 音视频 + 截图，并向 Popup 报告打包进度
- DownloadManager：通过 chrome.downloads API 触发下载，支持自定义目录和 saveAs 弹窗

**ZIP 结构（普通规模含 PDF；超大录制可能跳过 PDF）：**
```
tutorial-YYYYMMDD-HHMMSS-<id>/
├── tutorial.md
├── tutorial.pdf
├── audio/
│   └── tutorial-audio.webm
├── video/
│   └── tutorial-video.webm
└── screenshots/
    ├── step-01.png
    ├── step-02.png
    └── ...
```

**接口：**
- 输入：downloadRecordingBundle(recording, markdown, pdfDataUrl, outputDir, promptForSaveAs)
- 输出：ZIP 文件下载到用户指定目录

### 3.5 Asset Store（资产存储）

**职责：** 管理录制数据的持久化，分离大体量媒体和轻量索引。

**组件：**
- RecordingStore：存储轻量 recording 元数据、步骤顺序、说明、提交状态与 asset 引用，对象仓库 `recordings`，keyPath `id`
- AssetStore：存储截图、音频、视频的大体量 data URL payload，对象仓库 `assets`，keyPath `id`，按 `recordingId` 建索引
- HistoryIndex：在 chrome.storage.local 维护历史索引数组（最多 20 条），仅含摘要字段
- StorageQuotaManager：监控存储用量，提供清理能力（未来）

**存储分层：**
```
┌─────────────────────────────────────────┐
│ chrome.storage.local                    │
│   settings: { provider, apiKey, ... }   │  ~2KB
│   recordings: [{ id, title, count }]    │  ~20KB
├─────────────────────────────────────────┤
│ chrome.storage.session                  │
│   recordingRuntime: { state, tabId }    │  ~1KB
├─────────────────────────────────────────┤
│ IndexedDB (tutorialRecorder)            │
│   recordings store:                     │  ~10KB-1MB
│     { id, screenshots[].assetId, ... }  │
│   assets store by recordingId:          │  ~50-500MB
│     { id, recordingId, kind, dataUrl }  │
└─────────────────────────────────────────┘
```

### 3.6 Settings Manager（设置管理器）

**职责：** 管理、校验和持久化用户配置。

**组件：**
- SettingsNormalizer：输入验证 + 默认值填充 + Provider 预设解析
- ProviderPresetResolver：9 家 Provider 的 Base URL / API Style / Label 映射
- PromptPresetResolver：4 个内置提示词版本 + 自定义模板的解析和渲染

---

## 4. 消息协议

扩展内各上下文通过 `chrome.runtime.sendMessage` 和 `chrome.tabs.sendMessage` 通信。

### 4.1 Popup → Background（主要通信方向）

| Action | Payload | Response | 说明 |
|--------|---------|----------|------|
| `getPopupState` | — | `{ ok, settings, runtime, history }` | Popup 初始化时加载全部状态 |
| `saveSettings` | `{ settings }` | `{ ok, settings }` | 保存设置变更 |
| `startRecording` | `{ tabId }` | `{ ok }` | 开始手动录制 |
| `startAiRecording` | `{ tabId, targetDescription }` | `{ ok }` | 开始 AI 录制（Phase 3） |
| `pauseRecording` | — | `{ ok }` | 暂停录制 |
| `resumeRecording` | — | `{ ok }` | 继续录制 |
| `stopRecording` | — | `{ ok }` | 停止录制 |
| `takeoverRecording` | — | `{ ok }` | AI → 手动接管（Phase 3） |
| `pauseAiAgent` | — | `{ ok }` | 暂停 AI Agent（Phase 3） |
| `resumeAiAgent` | — | `{ ok }` | 继续 AI Agent（Phase 3） |
| `manualCapture` | — | `{ ok, captured, count }` | 手动截图 |
| `downloadRecording` | `{ id }` | `{ ok }` | 导出指定录制 |
| `getRecordingDetail` | `{ id }` | `{ ok, recording }` | 获取教程详情 |
| `updateRecording` | `{ id, updates }` | `{ ok, recording, history }` | 保存编辑 |
| `deleteRecording` | `{ id }` | `{ ok }` | 删除录制 |

### 4.2 Background → Popup（推送通知）

| Action | Payload | 说明 |
|--------|---------|------|
| `started` | `{ startTime, recordingId, count, ... }` | 录制开始 |
| `screenshot` | `{ count, elapsedMs }` | 新截图 |
| `paused` | — | 已暂停 |
| `resumed` | — | 已继续 |
| `stopped` | — | 已停止 |
| `mediaUpdated` | `{ audioStarted, videoStarted, mediaStatus }` | 媒体状态变化 |
| `generating` | `{ message }` | 生成进度提示 |
| `agentStep` | `{ step, description }` | AI Agent 新步骤（Phase 3） |
| `complete` | `{ history }` | 教程生成完成 |
| `exported` | `{ history }` | 导出完成 |
| `historyUpdated` | `{ history }` | 历史变更 |
| `warning` | `{ message }` | 警告提示 |
| `error` | `{ message }` | 错误提示 |

### 4.3 Content Script → Background

| Action | Payload | 说明 |
|--------|---------|------|
| `recordInteraction` | `{ type, summary, target, timestamp }` | 上报用户交互事件 |

### 4.4 Offscreen ↔ Background

| Type（offscreen target） | Payload | Response | 说明 |
|--------------------------|---------|----------|------|
| `startSession` | `{ captureMode, captureStreamId?, tabId, ... }` | `{ ok, audioStarted, videoStarted }` | 启动媒体采集 |
| `pauseSession` | — | `{ ok }` | 暂停媒体 |
| `resumeSession` | `{ intervalMs, autoCapture }` | `{ ok }` | 恢复媒体 |
| `updateSession` | `{ intervalMs, autoCapture, paused }` | `{ ok }` | 更新参数 |
| `stopSession` | — | `{ ok, audioDataUrl, videoDataUrl, ... }` | 停止并返回媒体数据 |
| `generatePdf` | `{ recording }` | `{ ok, pdfDataUrl }` | 生成 PDF |

---

## 5. 目录结构

### 5.1 现有结构

```
tutorial-recorder/
├── manifest.json                  # 扩展清单，权限声明
├── background/
│   ├── background.js              # Service Worker：编排中枢（~3825 行）
│   └── asset-store.js             # IndexedDB recordings/assets 存储层（~164 行）
├── content/
│   └── content.js                 # 内容脚本：交互采集 + 视觉反馈（~260 行）
├── offscreen/
│   ├── offscreen.html             # Offscreen Document 入口
│   └── offscreen.js               # 媒体录制 + 定时器 + PDF 渲染（~730 行）
├── popup/
│   ├── popup.html                 # Popup + 工作台（双模式）UI
│   ├── popup.css                  # 样式
│   └── popup.js                   # Popup 逻辑 + 工作台编辑逻辑（~1280 行）
├── settings/
│   ├── settings.html              # 独立设置页 UI
│   ├── settings.css               # 设置页样式
│   └── settings.js                # 设置页逻辑
├── lib/
│   ├── fflate.js                  # ZIP 压缩库
│   ├── html2canvas.min.js         # HTML Canvas 截图（备用）
│   └── jspdf.min.js               # PDF 生成库
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   ├── icon128.png
│   └── icon.svg
├── scripts/
│   └── e2e/
│       ├── validate-extension.mjs # Playwright e2e 验证
│       └── fixture.html           # 测试用本地页面
├── package.json
├── package-lock.json
├── README.md
└── .gitignore
```

### 5.2 Plasmo 重构后的目录结构（后续迁移目标）

```
tutorial-recorder/                   # Plasmo 项目根目录
├── package.json                     # 含 plasmo 依赖 + scripts
├── tsconfig.json                    # TypeScript 配置
├── assets/
│   └── icon.svg                     # Plasmo 图标源（自动生成多尺寸 PNG）
├── src/
│   ├── background/
│   │   ├── index.ts                 # Service Worker 入口：消息路由
│   │   ├── recording-controller.ts  # 录制状态机
│   │   ├── screenshot-engine.ts     # 截图引擎（standard + CDP）
│   │   ├── cdp-manager.ts           # chrome.debugger 生命周期
│   │   ├── ai-gateway.ts            # AI 调用统一入口
│   │   ├── agent-loop.ts            # AI Agent 循环（Phase 3）
│   │   ├── tool-executor.ts         # CDP 操作执行器（Phase 3）
│   │   ├── prompt-renderer.ts       # 提示词模板渲染
│   │   ├── export-pipeline.ts       # 导出管道（MD + PDF + ZIP）
│   │   ├── settings-manager.ts      # 设置校验和管理
│   │   └── asset-store.ts           # IndexedDB 存储层
│   ├── popup/
│   │   ├── index.tsx                # Popup 入口（Plasmo 自动识别）
│   │   ├── Popup.tsx                # Popup 主组件
│   │   ├── components/
│   │   │   ├── RecordingControls.tsx    # 开始/暂停/停止/截图按钮
│   │   │   ├── QuickSettings.tsx        # 快速设置区
│   │   │   ├── RecordingStats.tsx       # 截图计数 + 时长 + 媒体状态
│   │   │   ├── HistoryList.tsx          # 历史记录列表
│   │   │   ├── AiRecordingPanel.tsx     # AI 录制入口 + 进度（Phase 3）
│   │   │   ├── RealtimeSuggestion.tsx   # AI 实时建议（Phase 2）
│   │   │   └── CdpStatusBanner.tsx      # 调试状态提示（Phase 1）
│   │   └── hooks/
│   │       ├── useRecording.ts          # 录制状态 hook
│   │       ├── useSettings.ts           # 设置读写 hook
│   │       └── useChromeMessage.ts      # 消息通信 hook
│   ├── workspace/
│   │   ├── index.tsx                # 工作台入口（独立标签页）
│   │   ├── Workspace.tsx            # 工作台主组件
│   │   └── components/
│   │       ├── FullHistoryList.tsx      # 全部历史记录
│   │       ├── TutorialDetail.tsx       # 教程详情编辑器
│   │       ├── StepEditor.tsx           # 单步编辑（截图 + 说明 + 操作）
│   │       ├── StepCard.tsx             # 步骤卡片（含拖拽）
│   │       └── ImageUploader.tsx        # 截图替换/插入的文件选择
│   ├── settings/
│   │   ├── index.tsx                # 独立设置页入口
│   │   ├── Settings.tsx             # 设置主组件
│   │   └── components/
│   │       ├── AiProviderForm.tsx       # Provider/Key/Model 配置
│   │       ├── PromptEditor.tsx         # 提示词版本选择和编辑
│   │       ├── ExportSettings.tsx       # 导出目录和 saveAs 设置
│   │       └── CdpSettings.tsx          # CDP 截图引擎配置（Phase 1）
│   ├── contents/
│   │   └── interaction-tracker.ts  # Plasmo CS2 内容脚本（交互采集 + 反馈）
│   ├── offscreen/
│   │   ├── index.html              # Offscreen Document（Plasmo static）
│   │   └── offscreen.ts            # 媒体录制 + 定时器 + PDF 渲染
│   ├── lib/
│   │   ├── fflate.ts               # ZIP 压缩（npm 包或内联）
│   │   └── jspdf.ts                # PDF 生成（npm 包或内联）
│   ├── types/
│   │   ├── recording.ts            # Recording / Screenshot 类型
│   │   ├── settings.ts             # Settings 类型
│   │   ├── messages.ts             # 消息协议类型
│   │   └── ai.ts                   # AI 请求/响应类型
│   └── shared/
│       ├── constants.ts            # Provider 预设、提示词预设等常量
│       ├── formatters.ts           # formatDuration、escapeHtml 等工具
│       └── validators.ts           # sanitize*、normalize* 校验函数
├── scripts/
│   └── e2e/
│       └── validate-extension.mjs
├── README.md
├── .gitignore
└── .42cog/                         # 规约文档
```

**Plasmo 约定说明：**
- `src/background/index.ts` — 自动识别为 service worker
- `src/popup/index.tsx` — 自动识别为 popup 入口
- `src/settings/index.tsx` — 自动识别为 options_ui 页面
- `src/contents/interaction-tracker.ts` — Plasmo CS2 内容脚本，自动注入
- `assets/icon.svg` — Plasmo 自动生成 16/48/128 PNG
- manifest.json 由 Plasmo 根据 `package.json` 和代码注解自动生成，不再手动维护

### 5.3 代码迁移策略（后续：原生 JS → Plasmo）

**迁移顺序：**

**第一步：项目初始化（~0.5 天）**
```
create-plasmo → 迁移 assets/icon.svg → 配置 permissions → 验证空壳能加载
```

**第二步：background/ 迁移（~1 天）**
- 现有 background.js + asset-store.js 拆分为 `src/background/` 下的子系统模块
- 保持原生 TypeScript（service worker 不需要 React）
- 新增类型定义到 `src/types/`
- 提取常量和工具到 `src/shared/`

**第三步：popup/ 迁移（~1.5 天）**
- popup.js (1280 行) → 拆分为 React 组件
- `Popup.tsx` + 6 个子组件 + 3 个 hooks
- 工作台模式（workspace）独立为 `src/workspace/`

**第四步：settings/ 迁移（~0.5 天）**
- settings.js → `AiProviderForm.tsx` + `PromptEditor.tsx` + `ExportSettings.tsx`

**第五步：content/ 和 offscreen/ 迁移（~0.5 天）**
- content.js → `src/contents/interaction-tracker.ts`（Plasmo CS2 格式）
- offscreen/ 保持 HTML + JS 原生结构（非 UI 层，无需 React）

**总计约 4 天。** 迁移期间功能不变，只是代码组织从 vanilla JS 变为 Plasmo + React + TypeScript。

---

## 6. 安全架构

```
┌─────────────────────────────────────────────────┐
│              Extension Permission Layer          │
│  activeTab, tabs, scripting, storage, downloads,│
│  offscreen, tabCapture, unlimitedStorage        │
│  + debugger（Phase 1 新增）                      │
├─────────────────────────────────────────────────┤
│              API Key Protection                  │
│  • 仅存 chrome.storage.local                    │
│  • 不写入 IndexedDB、日志、导出文件              │
│  • AI fetch 由 background 直接发起              │
│  • 不经过 content script                        │
├─────────────────────────────────────────────────┤
│              CDP Lifecycle Control               │
│  • debugger 仅在录制期间附加                     │
│  • 停止/异常时立即 detach                        │
│  • UI 明确告知调试状态                           │
├─────────────────────────────────────────────────┤
│              Data Privacy                        │
│  • 截图可能含敏感信息（密码、个人资料）          │
│  • ZIP 仅下载到本地，不自动上传                  │
│  • 分享功能必须用户主动触发并确认                │
├─────────────────────────────────────────────────┤
│              AI Agent Guard Rails                │
│  • 单次最多 50 步 / 10 分钟                     │
│  • 步数和超时可配置                              │
│  • 达到限制后优雅停止                            │
│  • 用户可随时接管                                │
└─────────────────────────────────────────────────┘
```

**安全需求矩阵：**

| 层 | 需求 | 实现 |
|------|------|------|
| 权限 | 最小权限集 | 仅申请必要 permission + host_permissions |
| 密钥 | API Key 保护 | chrome.storage.local 加密存储，不外泄 |
| 调试 | CDP 生命周期 | 录制开始 attach，结束/异常立即 detach |
| 隐私 | 截图数据保护 | ZIP 仅本地下载，不自动上传 |
| Agent | 循环控制 | 步数上限 + 超时 + 用户接管 |
| 输入 | 参数校验 | SettingsManager 统一校验（URL/interval/dir/title） |

---

## 7. 技术决策

### ADR-001：Plasmo + React 框架迁移

**状态：** 已延期（v1.4.0-v2.0.0 未执行）

**背景：**
v1.3.0 用原生 JS 实现，popup.js 已达 1280 行，使用 innerHTML 拼接 + dataset 事件委托模式维护 UI。Phase 2/3 新增的 AI 实时建议面板、AI 录制进度列表、接管模式切换、混合步骤显示等 UI 需求，用 vanilla JS 实现将使 popup.js 膨胀到 2000+ 行且非常脆弱。截图批注 Canvas 编辑器（未来）用原生 JS 几乎不可行。

**当前决策：**
v1.4.0-v2.0.0 为降低迁移风险，继续沿用原生 JS / HTML / CSS 结构完成 CDP、实时建议和 AI 录制能力。Plasmo + React 迁移仍可作为后续重构项，但不再作为 Phase 1-3 的前置条件。

**后续迁移策略：**
1. 后续重构开始时先用 `create-plasmo` 初始化项目骨架
2. 将 popup/ 和 settings/ 的 HTML+JS 迁移为 React 组件（最高优先级）
3. background/ 的 JS 保持原生 ES Module（service worker 不需要 React）
4. offscreen/ 和 content/ 的 JS 保持原生（它们不是 UI 层）
5. manifest.json 由 Plasmo 自动生成，不再手动维护

**后果：**
- 更容易：组件化 UI 开发、hot reload 调试、TypeScript 类型安全、状态管理
- 更困难：引入 Node 构建工具链、团队需熟悉 Plasmo 约定、迁移期间双重维护

### ADR-002：CDP 通过 chrome.debugger API，不启动独立 Chrome

**状态：** 已接受

**背景：**
AI 录制需要 CDP 能力。方案 A：chrome.debugger（扩展内），方案 B：启动带 --remote-debugging-port 的 Chrome，方案 C：后端 Puppeteer。

**决策：**
使用方案 A chrome.debugger API。用户已经在用 Chrome 扩展，零额外步骤。黄色调试警告条通过 UI 引导缓解。

**后果：**
- 更容易：零部署成本，用户无需特殊操作
- 更困难：黄色警告条体验，chrome.debugger API 有并发限制（每个扩展只能附加一个 target）

### ADR-003：AI Agent 使用 function calling / tool use 模式

**状态：** 已接受（Phase 3 实现）

**背景：**
AI 驱动录制需要 AI 决定下一步浏览器操作。方案 A：纯文本指令（让 AI 输出"click 100 200"），方案 B：function calling（结构化工具调用）。

**决策：**
使用 function calling / tool use。定义 `click_at_xy`、`type_text`、`scroll`、`finish` 四个工具，AI 返回结构化的工具调用请求，由 ToolExecutor 执行。这是业界验证过的 Agent 模式，可靠性高于文本解析。

**后果：**
- 更容易：决策解析确定性强，不需要正则匹配
- 更困难：要求模型支持 function calling（OpenAI、Claude、Gemini 支持，部分国产模型可能不支持）

### ADR-004：background.js 拆分为 ES Module 子系统

**状态：** 已延期（Phase 1-3 先在现有 background.js 内落地）

**背景：**
background.js 已达 3800+ 行，混合了录制控制、AI 调用、导出、设置管理、消息路由等职责。CDP、实时建议、AI Agent 和资产分片陆续落地后，模块拆分的维护收益更明确。

**当前决策：**
v1.4.0-v2.0.0 先在现有 `background/background.js` 中落地 CDP、实时建议和 AI Agent。拆分为子系统文件仍是必要的后续维护任务，但未作为功能交付阻塞项。

**后果：**
- 更容易：每个文件职责清晰，开发和审查更容易
- 更困难：需要确保 ES Module 在 service worker 中正确加载（Manifest V3 已支持 `"type": "module"`）

### ADR-005：截图引擎可切换，CDP 为可选增强

**状态：** 已接受（Phase 1 实现）

**背景：**
CDP 截图需要 chrome.debugger 权限和调试附加，不是所有用户都接受。同时 captureVisibleTab 已能满足基本需求。

**决策：**
截图引擎设计为可切换模式。默认使用标准模式（captureVisibleTab），用户可在设置中切换为 CDP 模式。AI 录制模式下自动使用 CDP 模式。CDP attach 失败时自动降级到标准模式。

**后果：**
- 更容易：向后兼容，不强制用户接受调试提示条
- 更困难：需要维护两条截图路径，测试矩阵翻倍

### ADR-006：AI Agent 循环在 background service worker 中执行

**状态：** 已接受（Phase 3 实现）

**背景：**
AI Agent 的多轮循环需要持续运行。Manifest V3 service worker 有生命周期限制，可能在 30 秒无活动后休眠。

**决策：**
利用 chrome.debugger 的活跃连接保持 service worker 唤醒。每次 CDP 交互（截图、点击）都重置 service worker 的空闲计时器。录制状态通过 chrome.storage.session 持久化，即使 service worker 被杀也能恢复。

**后果：**
- 更容易：不引入额外的保活机制
- 更困难：需要处理 service worker 重启后的状态恢复

---

## 8. Phase 实施影响

### 当前实现结果（v1.4.0-v2.0.0）

Phase 1-3 已在现有原生扩展目录中落地，未执行 Plasmo / React / TypeScript 迁移：

- `background/background.js`：新增 CDP 截图引擎、实时建议队列、AI Agent 循环、CDP 工具执行、暂停/接管/失败处理。
- `content/content.js`：增强点击坐标采集，供 CDP 元素定位使用。
- `popup/popup.html` / `popup/popup.js` / `popup/popup.css`：新增 CDP 状态横幅、实时建议面板、AI 录制入口、Agent 状态和步骤列表。
- `settings/settings.html` / `settings/settings.js`：新增截图引擎、CDP 裁切和实时建议配置。
- `manifest.json`：新增 `debugger` 权限。
- `scripts/regression/`：新增 v1.4.0、v1.5.0、v2.0.0 静态回归检查。

### Phase 0 — Plasmo 迁移（后续重构项）

**目标：** 后续将原生 JS 项目迁移到 Plasmo + React + TypeScript，功能不变。

**新增文件：**
- `src/background/` 下 10 个子系统 TypeScript 模块（从 background.js 拆分）
- `src/popup/` 下 React 组件和 hooks（从 popup.js 迁移）
- `src/workspace/` 下 React 组件（从 popup.js 工作台模式拆分）
- `src/settings/` 下 React 组件（从 settings.js 迁移）
- `src/types/` 下 TypeScript 类型定义
- `src/shared/` 下常量和工具函数

**删除/替换文件：**
- `popup/popup.html` + `popup.js` + `popup.css` → React 组件
- `settings/settings.html` + `settings.js` + `settings.css` → React 组件
- `manifest.json` → Plasmo 自动生成
- `background/background.js` → 拆分为多个 TypeScript 模块

**保持不变：**
- `offscreen/` — HTML + JS 原生结构（非 UI 层）
- `lib/` — 第三方库（可逐步替换为 npm 包）
- `scripts/e2e/` — 验证脚本

### Phase 1 — CDP 截图增强（v1.4.0 已完成）

**当前实际改动：**
- `background/background.js`：新增 `chrome.debugger` attach/detach、`Page.captureScreenshot`、CDP 裁切、失败回退、`DOM.getNodeForLocation` / `DOM.describeNode` 元素定位。
- `content/content.js`：交互事件增加坐标与目标上下文，供 CDP 元素定位补强描述。
- `popup/popup.html` / `popup/popup.js` / `popup/popup.css`：新增 CDP 状态提示。
- `settings/settings.html` / `settings/settings.js`：新增截图引擎与数值裁切配置。
- `manifest.json`：新增 `debugger` 权限。

### Phase 2 — AI 实时建议（v1.5.0 已完成）

**当前实际改动：**
- `background/background.js`：复用现有 AI 调用入口，新增截图完成后的异步实时建议队列；队列策略为 1 个 active + 1 个 latest pending。
- `popup/popup.html` / `popup/popup.js` / `popup/popup.css`：新增实时建议面板、Popup 快捷开关和编辑保存逻辑。
- `settings/settings.html` / `settings/settings.js`：新增全量设置页实时建议开关。
- `scripts/regression/check-v1.5.0.mjs`：覆盖开关、队列、Popup 编辑和最终导出优先级。

### Phase 3 — AI 驱动录制（v2.0.0 MVP 已完成）

**当前实际改动：**
- `background/background.js`：新增 AI Agent 循环、工具 schema、CDP 工具执行、`startAiRecording` / `pauseAiAgent` / `resumeAiAgent` / `takeoverRecording` 消息路由、50 步和 10 分钟固定上限、失败保留步骤与接管分支。
- `popup/popup.html` / `popup/popup.js` / `popup/popup.css`：新增 AI 录制目标输入、启动按钮、接管按钮、Agent 状态和步骤列表。
- `scripts/regression/check-v2.0.0.mjs`：覆盖 AI UI、消息路由、Agent 循环、CDP 工具、固定限制、失败接管和导出标签。

**后续加固：**
- 单轮 AI 决策失败重试 1 次。
- 页面导航异常检测和提示分支。
- Agent 步数与超时时间配置项。

---

## 9. 质量检查清单

- [x] 架构模式（事件驱动分层）适合 Chrome 扩展需求
- [x] 6 个子系统职责清晰，无重叠
- [x] 消息协议覆盖所有交互场景（Popup ↔ Background ↔ Offscreen ↔ Content）
- [x] 目录结构支持模块化拆分
- [x] 安全架构映射 real.md 的全部 4 条必选约束 + 2 条可选约束
- [x] 7 条技术决策（ADR）有明确的背景、决策和后果分析
- [ ] Phase 0（Plasmo 迁移）后续执行，不再作为 Phase 1-3 前置步骤
- [x] Phase 1-3 的当前原生 JS 文件级改动影响已明确
- [ ] background.js 拆分策略后续执行，未与 Phase 1-3 功能交付合并
