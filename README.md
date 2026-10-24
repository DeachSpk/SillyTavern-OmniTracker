<div align="center">

# ⚡ Omni API Tracker for SillyTavern

**酒馆通用全量模型账本与冒险者公会手账**  
*Model-First Universal API Call Tracker & Adventurer Guild Companion for SillyTavern*

[![Version](https://img.shields.io/badge/version-v1.6.0-emerald.svg)](https://github.com/DeachSpk/SillyTavern-OmniTracker)
[![SillyTavern](https://img.shields.io/badge/SillyTavern-Extension-blue.svg)](https://github.com/SillyTavern/SillyTavern)
[![License](https://img.shields.io/badge/license-MIT-purple.svg)](LICENSE)

[**中文说明**](#-中文说明) | [**English Documentation**](#-english-documentation)

</div>

---

## 本 Fork 的改动（v1.6.0）

本项目基于 [ymf2317-tech/SillyTavern-OmniTracker](https://github.com/ymf2317-tech/SillyTavern-OmniTracker)，原作者 **ymf2317-tech**；保留原代码中 **@黎吧啦** 的活跃时长与 RPG 系统署名。本 Fork 由 **DeachSpk** 维护，沿用上游 README 声明的 **MIT License**，完整条款见 [LICENSE](LICENSE)。

- **美元费用**：从 [models.dev](https://models.dev/) 的公开 API 获取单价，在模型总览、通道明细、实时流水和悬浮窗显示估算 USD。价格在浏览器中缓存 24 小时，可在「设置维护」手动刷新；更新失败保留缓存。请求仅拉取公开价格，不上传聊天、用量或 API 密钥。
- **计价说明**：优先匹配服务商和模型；未知中转采用可识别的原厂参考价。支持输入/输出 Token、响应提供的缓存读写用量与长上下文价格档位。新调用保存匹配时的单价；旧数据及价格加载前的调用按可获得的基础单价回估，无法还原旧调用的缓存或上下文档位。今日旧统计缺少模型信息时显示未计价；历史模型明细可按模型回估。
- **未计价说明**：无法匹配、价格不可用，以及语音/图片/时长/按次等非文本 Token 计费项目均显示「未计价」，不当作免费。合计有遗漏时标明未计价次数，悬浮窗以 `+` 提示。USD 是参考估算，未包含中转倍率、折扣、税费或额外工具费用，实际支出以服务商账单为准。
- **悬浮窗**：独立于酒馆顶栏挂载，修复部分主题下不显示的问题。支持鼠标/触屏自由拖动、保存位置、点击或键盘打开账本；扩展设置和维护面板均可切换显示及重置位置。沿用原有暗色和绿色徽章风格，展示「今日 Token | 估算 USD | 活跃时长」。
- **排版修复**：为扩展按钮限定横排和宽度规则，修复「打开通用模型账本」被主题压成竖排的问题，并适配窄屏。

### 安装本 Fork

在 SillyTavern「扩展 → 安装扩展」中粘贴，分支使用 `main`：

```text
https://github.com/DeachSpk/SillyTavern-OmniTracker
```

安装后刷新页面。如果已经安装上游版本，请先停用或移除上游扩展，避免两份插件同时拦截请求；操作前可在「设置维护」导出数据备份。本 Fork 保留原设置键，兼容已有统计与手账数据。

根目录保留 `manifest.json`、`index.js`、`pricing.js`、`style.css`；使用插件不需要 npm 安装或构建。开发验证可运行 `npm ci`、`npm test` 和 `npm run test:browser`（浏览器测试默认使用本机 Chrome；可通过 `OMNI_BROWSER_CHANNEL=msedge` 使用 Edge）。浏览器测试在本地模拟酒馆模块和 API 响应，不调用真实付费模型。

**Fork changes (v1.6.0):** models.dev USD estimates with cached prices, a persistent draggable floating indicator, corrected settings-button layout, and usage parsing for cached/streamed responses. Original project: **ymf2317-tech**; active-time/RPG credit: **@黎吧啦**. Fork maintained by **DeachSpk**, under the upstream-declared **MIT License**. Unmatched/non-token charges are explicitly excluded from estimates. The original documentation follows.

---

<a name="-中文说明"></a>
## 🇨🇳 中文说明

### 🌟 为什么诞生这个插件？

许多重度折腾酒馆的玩家都遇到过类似困扰：**“API 额度扣得飞快，但翻看聊天记录，字数根本对不上账？到底有哪几个后台脚本在暗中调模型？各调了什么模型、烧了多少 Token？今天又在酒馆陪伴了纸片人多久？”**

现有统计插件大多只能捕获聊天框里的“正文气泡”，导致后台静默发起的各种预设脚本、意图判断、世界书宏、以及 TTS 语音朗读被大量漏报；而粗暴的拦截器又容易误把酒馆本地做文本正则修剪的内部数据传输当成大模型调用，导致账目虚增。

**Omni API Tracker v1.5.2 带来了终极通用解决方案**：
1. **以模型资产为第一核心（Model-First Universal Ledger）**：
   - 彻底告别对具体插件名字的死板硬编码，以**客观模型名**为单位建账；
   - 每一个调用过的模型独立卡片核算，内部清晰展示：`💬 主聊对话` vs `⚡ 扩展/预设/后台` 的比例与消耗，预设是独立配模型还是偷用了主模型，一目了然！
2. **生成出口纯净化过滤（严防虚假传输）**：
   - 严格锁定 `/generate`、`/chat/completions`、向量与语音端点；
   - 坚决剔除酒馆本地的 `/process`（正则修剪）、`/bias`（偏置）、`/status`（探活）以及插件内部存储通道，绝不虚增 1 个 Token！
3. **内置智能去水清洗功能（老用户一键修复）**：
   - 在「设置维护」中提供一键去水清洗：自动识别并剔除旧版本误抓的本地正则预处理虚假输入，**100% 保留全部真实回复 (Completion)、全部语音 (TTS) 与 RPG 冒险者时长成就**，让历史虚高的账本瞬间回归真实！
3. **彻底根治 Unknown 与 Token 变 0**：
   - 结合响应头 `Content-Type: text/event-stream` 精准判流；
   - 非流式读取采用弹性兜底，即使返回纯文本也绝不抛异常进 catch 记 0；
   - 宽进探针，自建向量端点、小主机 Ollama `11434` 100% 捕获。
4. **冒险者公会陪伴手账（融合 @黎吧啦 活跃心跳与 RPG 成就系统）**：
   - 15 秒精准心跳感知（页面可见且聚焦才打卡，锁屏/挂起不虚增时长）；
   - RPG 10 阶冒险者称号与等级（迷途旅人 ➔ 奇点见证者，10h/级，带金色进度条）；
   - 10 大勋章成就图鉴与历史肝帝 Top 5 排行榜；
   - 原生 SVG 7 天活跃趋势柱状图（零外部 CDN 依赖，离线秒开）。

---

### ✨ 核心特性

- 🤖 **模型资产大账本**：打开看板第一眼即见所有模型的调用次数、输入/输出 Token、总消耗及全域占比。
- 🎯 **4 大客观通用通道**：
  - 💬 **主聊对话**：聊天框主流程生成；
  - ⚡ **扩展/预设/后台**：预设脚本、意图分析、总结与后台任务；
  - 🔊 **语音合成 (TTS)**：独立统计音频生成调用；
  - 🔍 **向量与重排**：捕获 Embeddings 向量嵌入与 Rerank 计算。
- 🏰 **RPG 冒险者公会手账**：
  - 在线活跃时长自动按天归档，自动兼容并迁移历史活跃时长数据；
  - 冒险者称号、等级、经验条、成就勋章、肝帝排行榜。
- 📊 **黑曜石高对比度暗黑 UI**：强制深色卡片（#151520）与纯白加粗字体，告别浅色主题“白底黄字”，移动端与 PC 完美自适应。
- 📜 **实时调用流水日志**：精确到秒，查看每次请求的时间戳、通道、模型名称、Prompt、Completion 与网络耗时（ms）。
- ⚡ **顶栏开关自由控制**：顶栏徽章显示 `⚡ Token | 时长`；支持在扩展设置中一键隐藏、或长按徽章快捷隐藏，清爽不遮挡。
- 🛡️ **100% 零侵入与零残留**：纯前端扩展，不改酒馆任何核心源码，删掉文件夹即彻底恢复。

---

### 🚀 极简安装教程（免后台配置）

本插件为**纯前端插件**，不需要配 Node.js 服务端、不需要装 npm 库、不需要改 `config.yaml`。

#### 方式一：酒馆原生 UI 链接安装（推荐）
1. 打开酒馆，点击右上角菜单栏的 **“扩展插件”（四个小方块拼成的图标）**。
2. 展开 **“安装扩展”**。
3. 在 Git 仓库链接输入框中粘贴：
   ```text
   https://github.com/DeachSpk/SillyTavern-OmniTracker
   ```
4. 点击 **“安装 / 保存”**，提示安装成功后在浏览器按 **F5** 刷新页面即可！

#### 方式二：终端直投
```bash
cd SillyTavern/public/scripts/extensions/third-party/
git clone https://github.com/DeachSpk/SillyTavern-OmniTracker.git
```
刷新浏览器即可使用。

---

<a name="-english-documentation"></a>
## 🇬🇧 English Documentation

### 🌟 Why Omni API Tracker?

Most token counters in the SillyTavern ecosystem only capture dialogue bubbles rendered into the chat box, missing asynchronous background calls from preset scripts, intent extractors, auto-summaries, and TTS speech synthesis. Conversely, naive fetch interceptors often mistakenly count local prompt post-processing transfers (`/process`) as model generations, artificially inflating prompt usage.

**Omni API Tracker v1.5.1 delivers the universal solution**:
1. **Model-First Universal Ledger**:
   - Abandons brittle hardcoded extension name heuristics; accounts by objective model entities.
   - Each model gets a dedicated dashboard card detailing the breakdown between `💬 Main Chat` and `⚡ Extensions/Presets/Background`. Instantly reveals whether a preset is using an independent model or consuming your main chat quota.
2. **Strict Generation Endpoint Filtering**:
   - Only intercepts authentic generation exits (`/generate`, `/chat/completions`, vector, and audio endpoints).
   - Firmly excludes internal local text regex formatting (`/process`), token counting (`/tokenizers`), and internal plugin storage routes, preventing fake token inflation.
3. **Resilient Parsing (Zero Unknown & Zero Token Glitches)**:
   - Header-aware SSE detection via `Content-Type: text/event-stream`.
   - Safe `text()` fallback for non-streaming responses, ensuring raw texts or non-standard payloads never throw SyntaxError or record 0 tokens.
4. **Adventurer Guild Active Companion**:
   - 15-second visibility-aware heartbeat tracking (only ticks when active and focused);
   - RPG Title & Level Progression (Novice Traveler ➔ Singularity Witness, 10 hours per Level);
   - 10 unlockable achievements and historical Top 5 Marathon sessions;
   - Zero-dependency SVG 7-day activity bar chart (offline-ready).

---

### 🚀 Quick Installation

#### Method 1: SillyTavern UI (Recommended)
1. In SillyTavern, click the **Extensions** icon (stacked squares in the top-right menu).
2. Expand **Install Extension**.
3. Paste the repository URL:
   ```text
   https://github.com/DeachSpk/SillyTavern-OmniTracker
   ```
4. Click **Install / Save**.
5. Press **F5** to reload your browser!

#### Method 2: Git Clone
```bash
cd SillyTavern/public/scripts/extensions/third-party/
git clone https://github.com/DeachSpk/SillyTavern-OmniTracker.git
```
Reload your browser to start auditing!

---

## 📄 License
Released under the [MIT License](LICENSE).
