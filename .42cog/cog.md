# Tutorial Recorder - 认知模型文档

<meta>
  <document-id>tutorial-recorder-cog</document-id>
  <version>1.0.0</version>
  <project>Tutorial Recorder</project>
  <type>认知模型</type>
  <created>2026-04-30</created>
  <depends>real.md</depends>
</meta>

## 文档说明

基于"智能体 + 信息 + 上下文"框架，描述 Tutorial Recorder 的核心认知模型。该系统支持两种录制模式：人工操作录制（人点）和 AI 驱动录制（AI 点），最终产出相同结构的教程包。

---

## 一、智能体（Agents）

<agents>

### 1.1 人类智能体

<agent type="human" id="A1">
<name>录制者</name>
<identifier>Chrome 浏览器当前登录用户，无独立账号体系</identifier>
<classification>
  <by-role>教程作者</by-role>
</classification>
<capabilities>手动操作浏览器、手动截图、配置录制参数、编辑步骤说明和截图、选择 AI Provider</capabilities>
<goals>以最低成本产出一个可分享的操作教程</goals>
</agent>

<agent type="human" id="A2">
<name>教程读者</name>
<identifier>收到 ZIP 包或分享链接的人</identifier>
<classification>
  <by-channel>直接收到 ZIP；通过分享链接在线查看</by-channel>
</classification>
<capabilities>查看 Markdown/PDF、播放音视频、按步骤复现操作</capabilities>
<goals>快速理解并复现教程中的操作流程</goals>
</agent>

### 1.2 人工智能体

<agent type="ai" id="A3">
<name>视觉分析 AI</name>
<identifier>用户配置的 Provider + Model（如 OpenAI gpt-4.1-mini、Claude sonnet、火山方舟 endpoint）</identifier>
<classification>
  <by-function>截图描述生成（现有能力）</by-function>
</classification>
<interaction-pattern>输入：截图 base64 + 页面上下文 + 交互记录 → 输出：1 句中文步骤说明</interaction-pattern>
</agent>

<agent type="ai" id="A4">
<name>操作 AI（Agent）</name>
<identifier>支持 function calling / tool use 的视觉模型</identifier>
<classification>
  <by-function>浏览器操控（新增能力，Phase 3）</by-function>
</classification>
<interaction-pattern>多轮循环：截图 → 分析 → 决定动作（click/type/scroll）→ 执行 → 再截图，直到任务完成。每一步同时生成步骤说明</interaction-pattern>
</agent>

</agents>

---

## 二、信息（Information）

<information>

### 2.1 核心实体

<cog>
本系统包括以下关键实体：
- recording：录制会话，一次录制产出一条
- screenshot：步骤截图，隶属于 recording
- tutorial-bundle：导出产物，由 recording 生成
- ai-session：AI 录制会话，Agent 多轮交互的完整上下文（新增）
</cog>

<recording>
- 唯一编码：以录制启动时间戳生成的 ID，如 `1745000000000`
- 常见分类：手动录制（displayMedia / tabCapture）；AI 录制（agent-driven）；状态（recording / ready / failed）
</recording>

<screenshot>
- 唯一编码：截图时的时间戳 ID，如 `1745000005123`，隶属于父 recording
- 常见分类：initial（首帧）；auto（定时截图）；manual（手动截图）；final（结束帧）；agent（AI 操作后截图，新增）
</screenshot>

<tutorial-bundle>
- 唯一编码：导出路径 + 时间戳，如 `tutorial-recorder/tutorial-20260430-143000-1745000000000.zip`
- 常见分类：完整包（ZIP 含全部媒体）；Markdown only；PDF only（未来可选格式）
</tutorial-bundle>

<ai-session>
- 唯一编码：与 recording 共享 ID，一对一绑定
- 常见分类：进行中；已完成；中断（用户接管）；失败（步数/超时限制）
</ai-session>

### 2.2 信息流动

<information-flow>
<flow id="F1" name="手动录制流程">
  录制者 → 点击开始 → background 创建 recording → offscreen 启动媒体采集 → content script 采集交互 → background 定时截图 + 调用视觉分析AI → 录制者点击停止 → background 生成 tutorial-bundle → 录制者查看/编辑/导出
</flow>

<flow id="F2" name="AI 录制流程">
  录制者 → 输入教程目标（如"在 GitHub 上创建 PR"）→ background 创建 recording + ai-session → chrome.debugger attach → 操作AI 循环：截图→分析→执行动作→记录 screenshot→ 直到完成 → chrome.debugger detach → 生成 tutorial-bundle → 录制者查看/编辑/导出
</flow>

<flow id="F3" name="混合接管流程">
  操作AI 执行中 → 录制者点击"接管操作" → chrome.debugger 保持 → 转入手动录制模式（F1 后半段） → 录制者手动完成后点击停止 → 合并 AI 步骤 + 手动步骤 → 生成 tutorial-bundle
</flow>

<flow id="F4" name="编辑与重新导出">
  录制者 → 打开工作台 → 修改 recording（标题、步骤说明、截图增删排）→ 保存 → 触发重新导出 → 生成新 tutorial-bundle
</flow>
</information-flow>

</information>

---

## 三、上下文（Context）

<context>

### 3.1 应用上下文
Chrome 浏览器扩展。Popup 承担录制控制和快速设置，独立工作台页承担历史管理和步骤编辑，Settings 页承担完整配置。

### 3.2 技术上下文
- Manifest V3 service worker 架构，无持久后台进程
- 录制状态通过 chrome.storage.session 跨 popup 生命周期保持
- 大体量媒体数据（截图 base64、音视频 blob）存 IndexedDB，设置和历史索引存 chrome.storage.local
- AI 调用由 background 直接发起 fetch，不经过 content script
- CDP 通过 chrome.debugger API 访问，仅 AI 录制模式使用
- 导出依赖 Offscreen Document 做 PDF Canvas 渲染

### 3.3 用户体验上下文
- 录制者期望"打开就能用"，不愿花时间配置 AI
- 教程质量的关键指标：步骤说明是否准确描述了"用户在做什么"而非"页面长什么样"
- AI 录制模式下用户希望"说一句话就能出教程"，但仍保留随时接管的控制感
- 录制过程中页面反馈要轻量不干扰（右上角小浮层 + 微弱提示音）

</context>

---

## 四、权重矩阵

<weights>
| 实体/交互 | 重要度 | 说明 |
|-----------|--------|------|
| recording 核心录制流程 | P0 | 产品存在的基础 |
| screenshot 截图采集 | P0 | 教程的核心素材 |
| 视觉分析AI 步骤说明 | P1 | 关键差异化能力 |
| tutorial-bundle 导出 | P0 | 用户最终拿到的作品 |
| ai-session AI 录制 | P1 | 未来核心演进方向 |
| 步骤编辑 CRUD | P1 | 教程质量的保障 |
| 多 Provider 配置 | P2 | 灵活性需求 |
</weights>

---

## 五、验收检查

- [ ] 所有实体定义了唯一编码
- [ ] 所有实体有人类定义的分类方式
- [ ] F1-F4 四条信息流覆盖了现有和未来功能
- [ ] AI 智能体区分了"分析"和"操控"两种角色
- [ ] 权重矩阵反映了优先级共识
- [ ] XML 语义闭合标签使用正确
