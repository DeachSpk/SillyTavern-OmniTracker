# Omni API Tracker（修改版）

基于 [ymf2317-tech 的原项目](https://github.com/ymf2317-tech/SillyTavern-OmniTracker)，由 DeachSpk 维护本 Fork；保留 @黎吧啦 的活跃时长与 RPG 系统署名，沿用 [MIT 许可证](LICENSE)。

本 Fork 的改动：

- 接入 [models.dev](https://models.dev/) 价格，在模型总览、通道明细、实时流水和悬浮窗显示估算美元费用；支持价格缓存与手动刷新，无法匹配的调用标记为“未计价”。
- 修复悬浮窗不显示的问题，支持鼠标和触屏拖动、记住位置、点击打开面板，并增加美元费用显示。
- 修复按钮竖排及窄屏排版问题，保留 SillyTavern 扩展安装结构和原有统计数据兼容。

在酒馆“扩展 → 安装扩展”中使用[本仓库链接](https://github.com/DeachSpk/SillyTavern-OmniTracker)，分支选择 `main`，安装后刷新页面。美元金额仅供估算，实际支出以服务商账单为准。
