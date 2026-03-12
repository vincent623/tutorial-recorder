# Tutorial Recorder

一个基于 Chrome Extension Manifest V3 的教程自动录制插件。它可以在浏览器里边操作边录制，自动或手动截图，采集麦克风讲解，并在结束后导出 Markdown、PDF、音频和原始截图。

## 现在支持的能力

- 自动截图和手动截图
- 麦克风录音
- 基于火山方舟视觉模型生成步骤说明
- 导出 `Markdown + PDF + WebM + PNG`
- 历史记录查看、重新导出和删除
- 自定义下载子目录，或逐文件弹出保存位置

## 项目结构

```text
tutorial-recorder/
├── background/          # service worker 编排、导出、AI 调用
├── content/             # 页面内录制反馈
├── offscreen/           # 麦克风录音、定时截图、PDF 生成
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

- `API Key` 和 `Endpoint ID`
- 自动截图间隔
- 导出目录
- 是否在导出时逐文件询问保存位置

说明：

- `导出目录` 只能是系统下载目录下的相对子目录，例如 `tutorial-recorder/runs`
- 如果开启“导出时询问保存位置”，Chrome 会对每个导出文件单独弹窗
- 未配置火山方舟时，插件仍然可以录制和导出，只是步骤说明会回退到默认文案

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

## 火山方舟配置

插件使用的模型调用基地址默认是：

- `https://ark.cn-beijing.volces.com/api/v3/chat/completions`

你需要在自己的火山方舟控制台创建：

- `API Key`
- 视觉模型 `Endpoint ID`

建议仅将这套扩展用于“自己填自己的 Key”的本地使用场景，不要把正式密钥硬编码进仓库或打包产物。
