# Tutorial Recorder

一个基于 Chrome Extension Manifest V3 的教程自动录制插件。它可以在浏览器里边操作边录制，自动或手动截图，采集视频和麦克风讲解，并在结束后导出一个可直接分享的 ZIP 教程包。

## 现在支持的能力

- 自动截图和手动截图
- 真实视频录制 + 麦克风录音
- 基于火山方舟、硅基流动、阿里云百炼、OpenRouter、Google Gemini、Claude、OpenAI 或任意 OpenAI 兼容视觉端点生成步骤说明
- 导出单个 `ZIP`，内含 `Markdown + PDF + 音频 WebM + 视频 WebM + PNG`
- 历史记录查看、编辑、重新导出和删除
- 自定义下载子目录，或为 ZIP 弹出一次保存位置选择

## 项目结构

```text
tutorial-recorder/
├── background/          # service worker 编排、导出、AI 调用
├── content/             # 页面内录制反馈
├── offscreen/           # 屏幕/标签页录制、麦克风录音、定时截图、PDF 生成
├── popup/               # 扩展 UI、设置、历史记录
├── icons/               # 扩展图标
├── lib/                 # 第三方前端库
├── scripts/e2e/         # 本地真实浏览器验证脚本
├── output/playwright/   # e2e 运行产物
├── manifest.json
├── package.json
└── README.md
```

## 本地使用

1. 打开 `chrome://extensions`
2. 开启“开发者模式”
3. 选择“加载已解压的扩展程序”
4. 选中项目根目录 `/Volumes/My_data/dev/tutorial-recorder`

打开插件 popup 后，可以配置：

- 画面录制方式：
  - `共享屏幕 / 标签页（推荐）`：开始录制时会弹出真实共享授权，再请求麦克风权限
  - `直接录制当前标签页（兼容模式）`：适合自动化验证或不想走共享面板的场景
- `Provider 预设`、`API 风格`、`API Base URL`
- `API Key`、`模型 / Endpoint ID`
- `附加请求头 JSON`
- 自动截图间隔
- 导出目录
- 是否在导出时为 ZIP 弹出保存位置

说明：

- `导出目录` 只能是系统下载目录下的相对子目录，例如 `tutorial-recorder/runs`
- 如果开启“导出时询问保存位置”，Chrome 只会对 ZIP 文件弹出一次保存对话框
- 历史记录面板支持查看教程详情、修改标题和步骤说明，然后重新导出新的 ZIP
- 未配置 AI 时，插件仍然可以录制和导出，只是步骤说明会回退到默认文案
- `API Base URL` 只需要填到版本根路径，例如 `https://ark.cn-beijing.volces.com/api/v3` 或 `https://api.openai.com/v1`，插件会按 `Chat Completions / Responses` 自动补齐路径
- `附加请求头 JSON` 适合 OpenAI 兼容网关，例如：

```json
{
  "HTTP-Referer": "https://example.com",
  "X-Title": "Tutorial Recorder"
}
```

## 开发与验证

安装验证脚本依赖：

```bash
npm install
```

基础语法检查：

```bash
npm run check
```

跑一轮真实浏览器验证：

```bash
npm run validate:e2e
```

可选环境变量：

- `PW_HEADLESS=0`：以有界面模式运行验证
- `PW_OUTPUT_SUBDIR=foo/bar`：覆盖 e2e 中写入插件设置的导出目录
- `PW_FIXTURE_PORT=48123`：覆盖本地验证页端口

验证产物会写到：

- `output/playwright/report.json`
- `output/playwright/popup.png`
- `output/playwright/downloads/`
- `output/playwright/profile/`

## AI 端点接入

当前内置了这些常用接入方式：

- `火山方舟`：默认基地址 `https://ark.cn-beijing.volces.com/api/v3`，推荐 `Chat Completions`
- `硅基流动`：默认基地址 `https://api.siliconflow.com/v1`
- `阿里云百炼`：默认基地址 `https://dashscope.aliyuncs.com/compatible-mode/v1`
- `OpenRouter`：默认基地址 `https://openrouter.ai/api/v1`
- `Google Gemini`：默认基地址 `https://generativelanguage.googleapis.com/v1beta/openai`
- `Claude`：默认基地址 `https://api.anthropic.com/v1`，直接走原生 `Messages`
- `OpenAI`：默认基地址 `https://api.openai.com/v1`，推荐 `Responses`
- `OpenAI Compatible`：适合各类兼容 OpenAI 的模型网关
- `自定义`：完全手填 `Base URL + API 风格 + Model`

这套配置方式是按类似 Vercel AI SDK 的思路做的：把服务商预设、基础 URL、API 风格和模型 ID 解耦。这样你既可以用默认预设，也可以直接指向任意 OpenAI 兼容代理或企业内部网关。

建议仅将这套扩展用于“自己填自己的 Key”的本地使用场景，不要把正式密钥硬编码进仓库或打包产物。
