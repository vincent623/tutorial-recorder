# Tutorial Recorder - UI 设计规格

<meta>
  <document-id>tutorial-recorder-ui</document-id>
  <version>1.0.0</version>
  <project>Tutorial Recorder</project>
  <type>UI 设计</type>
  <created>2026-04-30</created>
  <depends>real.md, cog.md, spec-prd.md, spec-userstory.md, sys.md</depends>
</meta>

---

## 1. 智能分析

### 1.1 应用类型

**判断：多上下文 Chrome 扩展（非 SPA / MPA）**

本产品有三个独立 UI 上下文，各自有独立的窗口和生命周期：

| 上下文 | 窗口类型 | 尺寸 | 交互特征 |
|--------|---------|------|---------|
| Popup | 弹出小窗口 | 固定 390px 宽 | 快速操作，录制控制 |
| Workspace | 独立标签页 | 全屏 | 深度编辑，历史管理 |
| Settings | 独立标签页（options_ui） | 全屏 | 配置管理 |

当前 v2.0.1 实现中，每个上下文独立加载原生 HTML/CSS/JS，共享 background service worker 作为数据层。React / Plasmo 仍作为后续 UI 重构方向，不作为 v1.4.0-v2.0.0 已交付能力的前置条件。

### 1.2 导航结构

**无传统导航**。三个上下文通过以下方式切换：
- Popup → Workspace：点击"管理记录"打开新标签页
- Popup → Settings：点击"完整设置"打开 options_ui
- Workspace 和 Settings 之间无直接导航

Popup 内部通过条件渲染切换视图区域（录制控制区 / 历史列表区），无路由。

### 1.3 配色方案

沿用 v1.3.0 已建立的设计语言，当前通过原生 CSS 变量和样式表维护；后续 Plasmo / React 迁移时可再映射到 Tailwind 自定义主题。

**品牌色相：220°（蓝色）** — 生产力工具定位，专业高效。

---

## 2. 设计系统

### 2.1 设计令牌

```css
@theme inline {
  /* 品牌色 */
  --color-primary: #1677ff;
  --color-primary-strong: #0f5ecb;
  --color-primary-light: #e8f1ff;
  --color-primary-bg: #f8fbff;

  /* 语义色 */
  --color-danger: #ff4d4f;
  --color-danger-light: #ffe3e4;
  --color-warning: #faad14;
  --color-warning-light: #fff5db;
  --color-success: #52c41a;
  --color-success-light: #eef7ea;
  --color-info: #1677ff;

  /* 中性色 */
  --color-bg: #f4f7fb;
  --color-panel: #ffffff;
  --color-text: #0f172a;
  --color-muted: #64748b;
  --color-line: #dbe4f0;
  --color-hover: #edf4ff;

  /* AI 专属色 */
  --color-ai: #7c3aed;
  --color-ai-light: #f3f0ff;
  --color-ai-strong: #5b21b6;
}
```

### 2.2 字体

```css
--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
--font-mono: ui-monospace, "SFMono-Regular", "SF Mono", Monaco, Consolas, monospace;
```

不使用 Google Fonts，纯系统字体栈。

### 2.3 圆角系统

| Token | 值 | 用途 |
|-------|------|------|
| `--radius-sm` | 10px | 小按钮、内联按钮 |
| `--radius-md` | 12px | 输入框、文本框、小卡片 |
| `--radius-lg` | 14px | 历史卡片、字段容器 |
| `--radius-xl` | 18-22px | 面板、大卡片 |
| `--radius-full` | 999px | 状态胶囊、Badge |

### 2.4 阴影系统

| Token | 值 | 用途 |
|-------|------|------|
| `--shadow-sm` | `0 4px 12px rgba(15,23,42,0.06)` | 轻微浮起 |
| `--shadow-md` | `0 12px 28px rgba(15,23,42,0.08)` | 面板卡片 |
| `--shadow-primary` | `0 12px 24px rgba(22,119,255,0.25)` | 主按钮 |

### 2.5 间距系统

基于 2px 基数，常用值：6px / 8px / 10px / 12px / 14px / 16px / 18px / 22px / 24px。

### 2.6 动效

| 场景 | 时长 | 缓动 |
|------|------|------|
| 按钮悬停位移 | 150ms | ease |
| 焦点环出现 | 150ms | ease |
| 拖拽透明度 | 120ms | ease |
| 截图反馈浮层淡出 | 220ms | ease |
| 截图反馈浮层停留 | 1800ms | — |

---

## 3. 页面布局

### 3.1 Popup 布局（390px 固定宽度）

```
┌─────────────────────────────────────────────┐
│  Eyebrow: TUTORIAL RECORDER                 │
│  Title: 教程自动录制                         │
│                        [状态胶囊 ● 等待开始]  │
├─────────────────────────────────────────────┤
│  [开始] [暂停] [停止] [截图]                  │
├─────────────────────────────────────────────┤
│  截图数量: 0  │ 录制时长: 00:00 │ 媒体: 待启动 │
├─────────────────────────────────────────────┤
│  快速设置                        [完整设置]  │
│  画面录制方式: [共享屏幕/标签页 ▾]            │
│  自动截图间隔: [5] 秒                         │
│  ☑ 自动截图                                  │
│  ─────────────────────────────────────────   │
│  AI Provider: 火山方舟  提示词: 默认（平衡）   │
│  导出目录: tutorial-recorder                  │
├─────────────────────────────────────────────┤
│  AI 录制                    [v2.0.0 已落地] │
│  ┌─────────────────────────────────────┐     │
│  │ 描述你想要的教程...                   │     │
│  └─────────────────────────────────────┘     │
│  [AI 录制]                                    │
├─────────────────────────────────────────────┤
│  历史记录                        [管理记录]  │
│  ┌─────────────────────────────────────┐     │
│  │ 在 GitHub 创建 PR                    │     │
│  │ 2026/4/30 14:30 · 12张 · 02:30      │     │
│  │                    [编辑] [导出]      │     │
│  └─────────────────────────────────────┘     │
│  ┌─────────────────────────────────────┐     │
│  │ 飞书多维表格操作                      │     │
│  │ 2026/4/29 10:15 · 8张 · 01:45       │     │
│  │                    [编辑] [导出]      │     │
│  └─────────────────────────────────────┘     │
├─────────────────────────────────────────────┤
│  快捷键：Ctrl/Command + Shift + S            │
└─────────────────────────────────────────────┘
```

### 3.2 Workspace 布局（独立标签页，全屏）

```
┌─────────────────────────────────────────────────────────────────┐
│  TUTORIAL RECORDER                                              │
│  教程工作台                                                     │
│  在更宽的工作台里查看历史教程、编辑每一步截图和文案... [完整设置]  │
│                                            [状态胶囊 ● 空闲]    │
├──────────────────────┬──────────────────────────────────────────┤
│  全部记录            │  教程详情                                │
│  选中一条记录后即可   │  ┌────────────────────────────────────┐  │
│  在这里修改标题、     │  │ 教程标题: [在 GitHub 创建 PR     ] │  │
│  步骤文案和截图顺序   │  │                                    │  │
│                      │  │ 创建: 2026/4/30  时长: 02:30       │  │
│  ┌────────────────┐  │  │ 步骤: 12  模式: 共享屏幕            │  │
│  │ ● 在 GitHub    │  │  │                                    │  │
│  │   创建 PR ★    │  │  │ 上次导出: tutorial-...zip          │  │
│  │   12张 02:30   │  │  └────────────────────────────────────┘  │
│  └────────────────┘  │                                          │
│  ┌────────────────┐  │  步骤 1                    [拖动] 00:05 │
│  │   飞书多维表格  │  │  ┌──────────────────────────────────┐   │
│  │   8张 01:45    │  │  │ [截图缩略图]                      │   │
│  │                │  │  └──────────────────────────────────┘   │
│  │   [编辑][导出] │  │  ┌──────────────────────────────────┐   │
│  └────────────────┘  │  │ 打开 github.com 首页              │   │
│  ┌────────────────┐  │  └──────────────────────────────────┘   │
│  │   ...更多      │  │  [上移] [下移] [查看原图]               │
│  └────────────────┘  │  [替换截图] [在后面添加] [删除]          │
│                      │                                          │
│                      │  步骤 2                    [拖动] 00:15 │
│                      │  ...                                      │
│                      │                                          │
│                      │  [开头添加]                               │
│                      │  [保存修改]          [导出 ZIP]           │
└──────────────────────┴──────────────────────────────────────────┘
```

**Workspace 响应式断点：**

| 断点 | 宽度 | 布局 |
|------|------|------|
| 桌面 | >960px | 双栏：左侧历史列表（300-360px）+ 右侧详情面板 |
| 窄屏 | ≤960px | 单栏：历史列表和详情上下排列 |

### 3.3 Settings 布局（独立标签页，全屏）

```
┌─────────────────────────────────────────────┐
│  TUTORIAL RECORDER                           │
│  完整设置                                     │
│  这里放完整录制、导出和 AI 配置...  [已保存 ✓]  │
├─────────────────────────────────────────────┤
│  ┌─ 录制设置 ──────────────────────────────┐ │
│  │ 画面录制方式: [共享屏幕/标签页 ▾]         │ │
│  │ 自动截图间隔: [5] 秒                     │ │
│  │ ☑ 自动截图                               │ │
│  └──────────────────────────────────────────┘ │
│  ┌─ 导出设置 ──────────────────────────────┐ │
│  │ 导出目录: [tutorial-recorder] [默认]     │ │
│  │ 预览: Downloads/.../tutorial-xxx.zip     │ │
│  │ ☐ 导出时询问保存位置                     │ │
│  └──────────────────────────────────────────┘ │
│  ┌─ 截图引擎 [v1.4.0 已落地] ───────────────┐ │
│  │ 截图引擎: [标准 / CDP] ▾                 │ │
│  │ CDP 模式说明...                          │ │
│  │ 裁切区域: [未设置] [设置裁切区域]         │ │
│  └──────────────────────────────────────────┘ │
│  ┌─ AI 设置 ───────────────────────────────┐ │
│  │ Provider: [火山方舟 ▾]                   │ │
│  │ API Key: [••••••]                        │ │
│  │ 模型: [ep-xxxx]                          │ │
│  │ 提示词版本: [默认（平衡）▾]               │ │
│  │                                          │ │
│  │ ▸ 高级 AI 选项                           │ │
│  │   API 风格 / Base URL / 附加请求头       │ │
│  │   系统提示词 / 用户提示词模板             │ │
│  └──────────────────────────────────────────┘ │
│  ┌─ AI 录制设置 [v2.0.0 MVP] ──────────────┐ │
│  │ 最大步数: 当前固定 50（后续可配置）        │ │
│  │ 最大时间: 当前固定 10 分钟（后续可配置）   │ │
│  │ ☐ 显示实时 AI 建议                       │ │
│  └──────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

---

## 4. 组件规格

### 4.1 基础组件

| 组件 | 来源 | 规格要点 |
|------|------|---------|
| Button | 手写（后续可替换为 Plasmo/shadcn） | 44px min-height, 12px border-radius, 600 weight |
| StatusPill | 自定义 | pill 形态，内含彩色圆点 + 状态文字 |
| Panel | 自定义 | 白色半透明背景，18px radius，shadow-md |
| FieldLabel | 自定义 | 12px muted 色，6px gap |
| TextInput | 自定义 | 44px min-height, 12px radius, 蓝色焦点环 |
| SelectInput | 自定义 | 同 TextInput 规范 |
| TextareaInput | 自定义 | 88px min-height, monospace 字体（prompt 编辑器用） |
| Checkbox | 自定义 | 20px 方块, accent-color primary |
| MiniButton | 自定义 | 44px min-height, 浅色背景 + primary 文字, 轻边框 |

### 4.2 业务组件

#### StatusPill（状态胶囊）

```
输入状态: { status: 'idle' | 'recording' | 'paused' | 'processing' | 'ai-recording' }

视觉：
  ● 等待开始     灰色圆点 (#94a3b8)
  ● 录制中       红色圆点 + 红色光晕 (#ff4d4f)
  ● 已暂停       黄色圆点 (#faad14)
  ● 处理中       蓝色圆点 (#1677ff)
  ● AI 录制中    紫色圆点 + 脉冲动画 (#7c3aed) [v2.0.0]
```

#### RecordingControls（录制控制按钮组）

```
输入状态: { isRecording, isPaused, isGenerating, onStart, onPause, onResume, onStop, onCapture }

布局：4 等分 grid

按钮状态映射：
  开始: primary 渐变, disabled when recording/generating
  暂停/继续: warning 色, disabled when !recording
  停止: danger 色, disabled when !recording
  截图: secondary 色, disabled when !recording || generating；暂停时仍允许手动截图
```

#### RecordingStats（录制统计卡片）

```
输入状态: { screenshotCount, recordTime, mediaStatus }

布局：3 等分 grid, 每格一个 stat-card
  截图数量: 数字, 实时递增
  录制时长: MM:SS 格式, 每秒更新
  媒体状态: 文字（待启动/音频+视频/仅视频/仅音频）
```

#### HistoryList（历史记录列表）

```
输入状态: { items, isCompact, onSelect, onExport, onDelete }

compact 模式（Popup）: 显示最近 3 条, 2 列按钮（编辑 + 导出）
完整模式（Workspace）: 显示全部, 3 列按钮（编辑 + 导出 + 删除）, 选中高亮

每个 history item：
  标题 (13px bold)
  元信息行 (11px muted): 时间 · 截图数 · 时长 · 媒体类型
  导出路径行 (11px primary, 有导出记录时显示)
  操作按钮行
```

#### StepCard（步骤卡片 — Workspace）

```
输入状态: { step, index, isDragging, isDropTarget, isBusy,
         onMoveUp, onMoveDown, onPreview, onReplace, onInsertAfter, onDelete }

结构：
  [拖动按钮] 步骤 N           时间偏移 (primary-strong 11px)
  [截图缩略图] (全宽, 12px radius, 点击可预览原图)
  [说明文本框] (88px min-height, 可编辑)
  [上移] [下移] [查看原图] [替换截图] [在后面添加] [删除]

拖拽状态：
  is-dragging: opacity 0.68
  is-drop-target: 蓝色边框 + inset shadow
```

#### AiRecordingPanel（AI 录制面板 — v2.0.0 已落地）

```
输入状态: { isAiRecording, agentSteps, currentStep, onTakeover, onPause, onResume }

状态 1（空闲）：目标输入框 + "AI 录制"按钮
状态 2（AI 执行中）：
  实时步骤列表（滚动）
  每步：✓/●/○ 标记 + 描述文字 + 缩略图
  底部：[接管操作] [暂停 AI] 按钮
状态 3（用户接管）：显示"已接管，手动操作中" + [停止] 按钮
```

#### CdpStatusBanner（CDP 状态提示 — v1.4.0 已落地）

```
输入状态: { isActive }

黄色横幅：
  "录制中使用 CDP 精确截图，Chrome 可能显示调试提示，录制结束后会自动消失"
  首次显示完整文案，后续可折叠为图标 + 简短提示
```

#### RealtimeSuggestion（AI 实时建议 — v1.5.0 已落地）

```
输入状态: { suggestion, isLoading, onEdit }

Popup 内嵌面板：
  标签: "AI 建议" (紫色标识)
  加载中: Skeleton 占位
  已生成: 可编辑文本框，预填 AI 建议
  用户可修改文本覆盖 AI 建议
```

---

## 5. 状态管理

### 5.1 Store 架构

当前 v2.0.1 实现不使用 Zustand，也未引入 Plasmo / React。Popup 和 Settings 通过原生 DOM 状态、`chrome.runtime.sendMessage`、`chrome.storage.local`、IndexedDB 与 background service worker 同步。

**当前等价状态接口：**

```typescript
// 录制运行时状态（chrome.storage.session）
function getRecordingState(): {
  isRecording, isPaused, isGenerating,
  screenshotCount, recordTime, mediaStatus,
  startRecording, pauseRecording, resumeRecording, stopRecording,
  manualCapture,
  startAiRecording, takeoverRecording, pauseAiAgent, resumeAiAgent
}

// 设置读写（chrome.storage.local）
function getSettingsState(): {
  settings: Settings,
  updateSettings: (partial) => Promise<Settings>
}

// 历史记录（chrome.storage.local 索引 + IndexedDB 详情）
function getHistoryState(): {
  items: HistoryItem[],
  openDetail: (id) => Promise<RecordingDetail>,
  exportRecording: (id) => Promise<void>,
  deleteRecording: (id) => Promise<void>
}

// 教程详情编辑（IndexedDB）
function getTutorialDetailState(id: string): {
  detail: RecordingDetail | null,
  isLoading, isDirty,
  updateTitle, updateStepDescription,
  moveStep, insertStep, replaceScreenshot, deleteStep,
  save, exportZip
}

// Chrome 消息通信
function listenChromeMessage(handler: (message) => void): void
```

### 5.2 数据流

```
用户操作 → 原生 DOM 事件处理 → chrome.runtime.sendMessage
  → background service worker 处理
    → chrome.storage / IndexedDB 写入
    → chrome.runtime.sendMessage 推送通知
      → popup/settings 监听消息 → 更新 DOM
```

---

## 6. 功能独立

### 6.1 降级策略

| 功能 | 依赖缺失时 | 降级行为 |
|------|-----------|---------|
| 录制和导出 | 无依赖 | 始终可用 |
| AI 步骤分析 | 未配置 Provider/Key | 使用默认说明（交互摘要或页面标题） |
| 音视频录制 | 用户拒绝授权 | 仅截图录制，媒体状态显示降级提示 |
| CDP 截图 | debugger attach 失败 | 自动回退到 captureVisibleTab |
| AI 实时建议 | AI 未配置 | 不显示建议面板 |
| AI 录制 | AI 未配置 | 输入框旁提示"请先在设置中配置 AI Provider" |

### 6.2 无 Mock 模式

与 Web 应用不同，Chrome 扩展的所有功能基于浏览器原生 API 和 chrome.storage，无需模拟数据。首次安装后用户即可直接使用录制和导出功能。

---

## 7. 交互模式

### 7.1 加载状态

| 场景 | 表现 |
|------|------|
| Popup 初始化 | status pill 显示"加载中..." |
| 教程详情加载 | detailStatus 区域显示"正在加载教程详情..." |
| AI 步骤分析 | status pill 显示"正在分析步骤 N/M..." + 蓝色状态 |
| AI 录制执行 | 步骤列表逐条出现，当前步骤显示脉冲动画 |
| 保存修改 | 按钮文字不变，状态提示"正在保存修改..." |
| 导出 ZIP | status pill 显示"正在导出..." |

### 7.2 反馈层次

| 层次 | 实现 | 示例 |
|------|------|------|
| 页面内反馈浮层 | content.js 注入的 fixed div | "已截图 (5)" 蓝色浮层 |
| Popup 状态更新 | status pill + 计数器 | REC / 截图数递增 |
| Chrome Badge | 扩展图标文字 | REC / II / ... |
| 操作按钮状态 | disabled + opacity | 录制中"开始"灰显 |
| 文本提示 | detailStatus 区域 | "已修改，记得保存后再导出" |
| 警告弹窗 | window.alert / confirm | "确定删除这条历史记录吗？" |

### 7.3 空状态

| 场景 | 表现 |
|------|------|
| 历史列表为空 | 居中文字"暂无录制记录" (12px muted) |
| 工作台未选中记录 | "从左侧选择一条记录后，即可在这里修改标题、步骤文案和截图顺序" |
| AI 未配置 | AI 录制面板显示"请先在设置中配置 AI Provider 和 API Key" |

---

## 8. UI 组件状态（Phase 1-3）

### Phase 1 已落地（v1.4.0）

| 组件 | 位置 | 说明 |
|------|------|------|
| CdpSettings | Settings 页 | 截图引擎选择器（标准/CDP）+ 裁切区域配置 |
| CdpStatusBanner | Popup | CDP 模式录制时的黄色调试提示横幅 |

### Phase 2 已落地（v1.5.0）

| 组件 | 位置 | 说明 |
|------|------|------|
| RealtimeSuggestion | Popup | 录制中 AI 实时建议面板，可编辑覆盖 |
| SuggestionToggle | Popup | 实时建议开关 |

### Phase 3 MVP 已落地（v2.0.0）

| 组件 | 位置 | 说明 |
|------|------|------|
| AiRecordingPanel | Popup | 目标输入框 + AI 录制按钮 |
| AgentStepList | Popup (内嵌于 AiRecordingPanel) | AI 执行进度实时列表 |
| AgentStepItem | Popup (内嵌于 AgentStepList) | 单步：状态标记 + 描述 + 缩略图 |
| TakeoverButton | Popup (内嵌于 AiRecordingPanel) | 醒目的"接管操作"按钮 |
| AgentSettings | Settings 页 | 后续加固项：最大步数/超时配置；当前实现使用固定 50 步 / 10 分钟上限 |

### AI 步骤列表视觉设计

```
AI 录制进度:
  ✓ 步骤 1: 打开 github.com                00:03  [img]
  ✓ 步骤 2: 点击 Sign in 按钮              00:08  [img]
  ● 步骤 3: 输入用户名和密码...             00:15  [分析中...]
  ○ 步骤 4: ...（等待中）

  [接管操作]  [暂停 AI]

标记说明：
  ✓ 已完成 — 绿色 check + 完整描述 + 缩略图
  ● 进行中 — 紫色圆点 + 脉冲动画 + "分析中..."
  ○ 等待中 — 灰色空心圆
```

---

## 9. 无障碍性

### 9.1 WCAG AA 检查清单

- [ ] 所有交互元素可通过键盘访问（Tab / Enter / Space）
- [ ] focus-visible 样式：蓝色焦点环 `0 0 0 4px rgba(22,119,255,0.12)`
- [ ] 按钮和输入框 min-height 44px（触摸目标）
- [ ] aria-live="polite" 用于状态更新区域（status pill、detailStatus）
- [ ] aria-label 用于图标按钮（拖动手柄、查看原图）
- [ ] 颜色对比度：文字 #0f172a 在 #ffffff 上 ≥ 7:1；#64748b 在 #ffffff 上 ≥ 4.5:1
- [ ] 拖拽排序有替代方案（上移/下移按钮）
- [ ] 确认对话框使用 window.confirm（原生可访问）
- [ ] 表单控件有关联 label（使用 field > span + input 模式）

---

## 10. 扩展点

### 10.1 未来组件迁移路径

| 当前 | 未来 | 触发条件 |
|------|------|---------|
| 自定义 Button | shadcn/ui Button | 如果项目引入 shadcn/ui |
| 自定义 TextInput | shadcn/ui Input | 同上 |
| 自定义 Panel | shadcn/ui Card | 同上 |
| window.alert / confirm | shadcn/ui AlertDialog | 同上 |
| innerHTML 拼接步骤列表 | React 组件 | 后续 Plasmo / React 迁移 |

### 10.2 截图批注编辑器（未来）

预留 `src/workspace/components/AnnotationCanvas.tsx` 组件位置。设计约束：
- 全屏 Canvas 覆盖在截图上
- 工具栏：矩形、箭头、高亮、文字标注
- 输出带标注的新截图替换原始截图
- 依赖 fabric.js 或 Konva（待评估）

---

## 11. 质量检查清单

- [x] 应用类型判断（多上下文 Chrome 扩展）
- [x] 配色方案沿袭 v1.3.0 设计语言
- [x] 设计令牌完整（颜色、字体、圆角、阴影、间距、动效）
- [x] 三个上下文的 ASCII 布局图
- [x] 基础组件和业务组件规格
- [x] Phase 1-3 新增组件清单
- [x] 当前状态管理使用原生 DOM + chrome.runtime + chrome.storage / IndexedDB，Plasmo hooks 迁移已延期
- [x] 降级策略覆盖所有功能
- [x] 加载、反馈、空状态定义
- [x] WCAG AA 无障碍检查清单
- [x] AI 步骤列表视觉设计含状态标记
