# Tutorial Recorder

一个基于 Chrome Extension Manifest V3 的教程自动录制插件。它可以在浏览器里边操作边录制，自动或手动截图，采集视频和麦克风讲解，并在结束后导出一个可直接分享的 ZIP 教程包。

## 现在支持的能力

- 自动截图和手动截图
- 真实视频录制 + 麦克风录音（音频/视频直接落盘 IndexedDB，分别带 100MB/400MB 体积熔断保护）
- 基于 15 个 Provider 预设生成步骤说明：国产（火山方舟、智谱 GLM、硅基流动、阿里云百炼、月之暗面 Kimi）、海外（OpenAI、Claude、Google Gemini、Groq、Mistral）、中转与网关（OpenRouter、Azure OpenAI、One API / New API 自建中转、OpenAI Compatible、自定义），并支持一键"测试连接"验证全链路
- 敏感信息防护：密码/验证码/卡号输入永不上报，手机号/身份证/银行卡号自动打码后才进入 AI 提示词
- 导出单个 `ZIP`，内含 `Markdown + 单文件 HTML + PDF + 音频 WebM + 视频 WebM + PNG`
- popup 负责录制与快速入口，独立工作台负责历史记录查看、编辑、重新导出和删除
- 教程详情支持对每一步截图做增删改查：查看原图、标注（箭头/方框/马赛克/文字）、替换截图、插入新步骤、删除步骤、拖拽或上下移动重排步骤
- popup 只保留录制和快速设置，并提供独立完整设置页与历史工作台
- 自定义下载子目录，或为 ZIP 弹出一次保存位置选择
- 可选 CDP 精确截图模式，支持目标标签页非前台时继续截图，并可设置像素裁切区域
- 可选实时 AI 建议，录制中异步生成最新步骤文案并允许立即覆盖
- AI 自动录制：输入教程目标后由 AI 通过 CDP 执行单步浏览器动作，支持暂停、接管和停止导出

## 项目结构

```text
tutorial-recorder/
├── background/          # service worker：background.js 仅做消息路由，20+ 个生命周期模块
│                        # （录制/截图/AI Agent/导出/历史/媒体编排等，单文件 ≤500 行）
├── content/             # 页面内录制反馈（录制期间按需注入）
├── offscreen/           # 屏幕/标签页录制、麦克风录音、定时截图、PDF 生成
├── popup/               # 扩展 UI、设置、历史记录、截图标注编辑器
├── settings/            # 独立完整设置页
├── icons/               # 扩展图标
├── lib/                 # 第三方前端库
├── docs/                # 隐私政策、商店上架素材
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

打开插件 popup 后，可以直接改：

- 画面录制方式：
  - `共享屏幕 / 标签页（推荐）`：开始录制时会弹出真实共享授权，再请求麦克风权限
  - `直接录制当前标签页（兼容模式）`：适合自动化验证或不想走共享面板的场景
- 自动截图间隔
- 是否自动截图
- 是否显示实时 AI 建议
- `AI 录制`：填写教程目标后启动自动录制，执行中可暂停 AI、接管操作或停止导出
- AI Agent 支持 `click_at_xy / type_text / scroll / press_key / navigate / hover / wait / finish` 八种工具；决策截图会按视口 CSS 像素对齐，点击坐标更精准

点击 `完整设置` 后，可以在独立设置页继续配置：

- `Provider 预设`（按国产 / 海外 / 中转与网关分组）、`API Key`、`模型 / Endpoint ID`
- `测试连接`：用当前配置发送一次最小视觉请求，验证 Base URL、Key、模型与 API 风格是否全链路可用，并显示响应延迟与排错提示
- 是否显示实时 AI 建议
- `高级 AI 选项` 里可展开 `API 风格`、`API Base URL`、`附加请求头 JSON` 和 Prompt 编辑器
- `默认（平衡）/ 动作优先 / 控件定位 / 简洁短句 / 自定义` 提示词版本
- 导出目录
- 是否在导出时为 ZIP 弹出保存位置

说明：

- `导出目录` 只能是系统下载目录下的相对子目录，例如 `tutorial-recorder/runs`
- 如果开启“导出时询问保存位置”，Chrome 只会对 ZIP 文件弹出一次保存对话框
- 如果开启 `CDP 精确截图`，Chrome 会显示调试提示条；录制停止或失败后插件会立即解除调试附加
- popup 里的历史区只保留最近记录和“继续编辑”入口；完整编辑放到独立工作台里
- 工作台支持查看教程详情、修改标题和步骤说明，然后重新导出新的 ZIP
- 教程详情里可以直接对步骤截图做增删改查和重排顺序，不必为了补一张图或换顺序重录整条教程
- 未配置 AI 时，插件仍然可以录制和导出，只是步骤说明会回退到默认文案
- 截图分析会附带页面标题、地址和最近一次交互动作，帮助视觉模型更准确地判断“用户正在做什么”
- 开启 `实时 AI 建议` 后，每次截图保存完成会异步排队生成当前步骤建议；录制不会等待模型返回，连续快速截图时只保留最新待分析截图
- popup 里的实时建议文本框可直接编辑，保存后的文案会优先用于最终 Markdown、PDF 和 ZIP 导出
- `AI 录制` 会自动使用 CDP 模式并显示调试提示；默认最多执行 50 步或 10 分钟，到达限制后会保留已完成步骤并导出
- AI Agent 失败时不会丢失已录制截图，可接管为人工录制或直接停止生成教程
- 单张截图的 AI 识别默认带超时保护；如果模型响应过慢，会自动回退到默认说明并继续导出
- AI 提示词支持 4 个内置版本和 1 个自定义版本；自定义模板可使用 `{{stepIndex}}`、`{{totalSteps}}`、`{{pageTitle}}`、`{{pageUrl}}`、`{{pageUrlLine}}`、`{{interactionSummary}}`、`{{previousDescription}}`
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

本地打包 Chrome 扩展：

```bash
npm run package
```

打包产物会写到：

- `dist/tutorial-recorder-v版本号.zip`
- `dist/tutorial-recorder-v版本号.zip.sha256`

ZIP 只包含扩展运行所需文件：`manifest.json`、`background/`、`content/`、`offscreen/`、`popup/`、`settings/`、`icons/`、`lib/`。不会包含 `.env`、`node_modules/`、`output/`、`memory/` 或测试脚本。

跑一轮真实浏览器验证：

```bash
npm run validate:e2e
```

可选环境变量：

- `PW_HEADLESS=0`：以有界面模式运行验证
- `PW_OUTPUT_SUBDIR=foo/bar`：覆盖 e2e 中写入插件设置的导出目录
- `PW_FIXTURE_PORT=48123`：覆盖本地验证页端口
- `PW_PROVIDER_PRESET=siliconFlow`：用指定 provider 预设跑真实模型回归
- `PW_MODEL_ID=Qwen/Qwen3-VL-32B-Instruct`：指定视觉模型
- `PW_API_KEY=...`：从环境变量注入 API Key，不落到源码和报告文件
- `PW_API_BASE_URL=https://api.siliconflow.cn`：可选覆盖 provider 默认基地址
- `PW_API_STYLE=chatCompletions`：可选覆盖 API 风格
- `PW_EXTRA_HEADERS_JSON='{\"HTTP-Referer\":\"https://example.com\"}'`：可选附加请求头

验证产物会写到：

- `output/playwright/report.json`
- `output/playwright/popup.png`
- `output/playwright/workspace.png`
- `output/playwright/downloads/`
- `output/playwright/profile/`

例如用硅基流动跑一轮真实模型验证：

```bash
PW_PROVIDER_PRESET=siliconFlow \
PW_MODEL_ID=Qwen/Qwen3-VL-32B-Instruct \
PW_API_BASE_URL=https://api.siliconflow.cn \
PW_API_KEY=你的密钥 \
PW_HEADLESS=0 \
npm run validate:e2e
```

验证脚本会把 `API Key` 和附加请求头从控制台输出与 `report.json` 中自动脱敏。

## GitHub CI/CD

仓库包含 `.github/workflows/release.yml`：

- push 到 `main`、PR、手动触发：运行 `npm ci`、`npm run check`、`npm run package`，并上传 ZIP 与 sha256 为 workflow artifact
- push `v*` 标签：在通过检查和打包后创建 GitHub Release，并上传 `dist/*.zip` 与 `dist/*.sha256`

发布步骤：

```bash
git tag v版本号
git push origin main
git push origin v版本号
```

GitHub Release 会自动使用 tag 名作为标题，并附带可安装的扩展 ZIP。

## AI 端点接入

当前内置了这些常用接入方式（预设下拉按国产 / 海外 / 中转与网关分组）：

国产模型：

- `火山方舟`：默认基地址 `https://ark.cn-beijing.volces.com/api/v3`，推荐 `Chat Completions`
- `智谱 GLM`：默认基地址 `https://open.bigmodel.cn/api/paas/v4`，填 `glm-4.5v` 等视觉模型
- `硅基流动`：默认基地址 `https://api.siliconflow.cn/v1`
- `阿里云百炼`：默认基地址 `https://dashscope.aliyuncs.com/compatible-mode/v1`
- `月之暗面 Kimi`：默认基地址 `https://api.moonshot.cn/v1`，填 `moonshot-v1-8k-vision-preview` 等视觉模型

海外模型：

- `OpenAI`：默认基地址 `https://api.openai.com/v1`，推荐 `Responses`
- `Claude`：默认基地址 `https://api.anthropic.com/v1`，直接走原生 `Messages`
- `Google Gemini`：默认基地址 `https://generativelanguage.googleapis.com/v1beta/openai`
- `Groq`：默认基地址 `https://api.groq.com/openai/v1`，超低延迟推理
- `Mistral`：默认基地址 `https://api.mistral.ai/v1`

中转与网关：

- `OpenRouter`：默认基地址 `https://openrouter.ai/api/v1`，可路由全球数百个模型
- `Azure OpenAI`：填 `https://<你的资源名>.openai.azure.com/openai/v1`（v1 兼容层免部署路径），Key 用资源密钥
- `One API / 中转站`：One API、New API 等自建中转填站点基地址（通常以 `/v1` 结尾），Key 用中转站令牌
- `OpenAI Compatible`：适合各类兼容 OpenAI 的模型网关
- `自定义`：完全手填 `Base URL + API 风格 + Model`

配置完任意接入方式后，点击设置页的 `测试连接` 按钮即可一键验证链路并查看响应延迟与排错提示。

这套配置方式是按类似 Vercel AI SDK 的思路做的：把服务商预设、基础 URL、API 风格和模型 ID 解耦。这样你既可以用默认预设，也可以直接指向任意 OpenAI 兼容代理或企业内部网关。

建议仅将这套扩展用于“自己填自己的 Key”的本地使用场景，不要把正式密钥硬编码进仓库或打包产物。
