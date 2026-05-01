# Tutorial Recorder - 现实约束文档

<meta>
  <document-id>tutorial-recorder-real</document-id>
  <version>1.0.0</version>
  <project>Tutorial Recorder</project>
  <type>现实约束</type>
  <created>2026-04-30</created>
</meta>

## 文档说明

本文档定义 Tutorial Recorder 浏览器扩展（含 AI 驱动录制能力）必须遵守的现实约束。该扩展是一个 Chrome Manifest V3 扩展，支持人工录制和 AI 自动录制两种模式，最终导出包含截图、音视频、Markdown、PDF 的教程 ZIP 包。

<real>
- 用户 API Key 仅存储于本地 chrome.storage，不得明文写入 IndexedDB、日志、导出文件或任何外部请求；所有 AI 调用必须由 background service worker 直接发起，不得经过 content script 或第三方中转
- AI 录制模式通过 chrome.debugger 控制浏览器时，必须在 UI 上明确告知用户当前处于调试录制状态，且录制结束后必须立即 detach debugger；不得在非录制状态下保持 debugger 附加
- 截图数据可能包含用户隐私信息（密码、个人资料、内部系统界面），导出 ZIP 时不得自动上传到任何外部服务；任何涉及"分享"功能的设计必须由用户主动触发并确认
- AI Agent 多轮操作循环必须设置单次任务最大步数上限（默认 50 步）和总体超时（默认 10 分钟），防止 AI 陷入无限循环消耗用户 API 配额
</real>

## 可选约束

<real-optional>
- 录制产生的所有媒体数据（截图 base64、音视频 WebM）已拆分进 IndexedDB `assets` store；后续仍应提供存储用量提示和批量清理能力
- AI 调用失败（超时、配额耗尽、模型拒绝）时必须优雅降级到默认说明，不得阻塞导出流程
</real-optional>

## 技术环境

<environment>
<stack>
- 平台：Chrome Extension Manifest V3
- 前端：原生 JavaScript（ES Module），无框架无构建工具
- 存储：chrome.storage.local（设置、历史索引）+ chrome.storage.session（运行时状态）+ IndexedDB `recordings`/`assets`（轻量录制元数据与截图/音视频大 payload 分离）
- 媒体：Offscreen Document + MediaRecorder API（屏幕录制、麦克风录音）
- 截图：chrome.tabs.captureVisibleTab / chrome.debugger CDP Page.captureScreenshot
- AI 接入：多 Provider 视觉模型（OpenAI/Claude/Gemini/火山方舟/硅基流动/阿里云百炼/OpenRouter/兼容接口），支持 Chat Completions / Responses / Anthropic Messages 三种 API 风格
- 导出：fflate streaming ZIP 压缩 + jsPDF（PDF 生成）+ 手写 Canvas 渲染；超大录制可跳过 PDF 但仍导出 Markdown 和全部素材
- 测试：Playwright e2e 验证脚本
- 已落地演进：v1.4.0 引入 CDP 截图增强，v1.5.0 引入实时 AI 建议，v2.0.0 引入 AI 驱动录制 MVP，v2.1.0 引入录制资产分片存储，v2.1.1 引入流式 ZIP 导出和超大 PDF 保护
</stack>
</environment>

## 约束检查清单

- [x] API Key 不出现在 IndexedDB、日志、导出文件中
- [x] chrome.debugger 在录制停止后立即 detach
- [x] 导出 ZIP 不自动上传
- [x] AI Agent 循环有步数和超时上限
- [x] AI 失败时不阻塞导出，已录制步骤保留并可接管或停止导出
- [ ] 存储用量可见可清理

## 后续加固约束

- [x] AI Agent 单轮决策失败后自动重试 1 次，再进入接管/停止分支
- [x] AI Agent 页面导航异常检测和提示分支
- [x] AI Agent 步数和超时时间提供设置项
