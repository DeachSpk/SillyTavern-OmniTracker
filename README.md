<div align="center">

# ⚡ Omni API Tracker for SillyTavern

**酒馆全量 API 调用审计与统计插件**  
*Full-Spectrum API Call Tracker & Usage Auditor for SillyTavern*

[![Version](https://img.shields.io/badge/version-v1.3.0-emerald.svg)](https://github.com/ymf2317-tech/SillyTavern-OmniTracker)
[![SillyTavern](https://img.shields.io/badge/SillyTavern-Extension-blue.svg)](https://github.com/SillyTavern/SillyTavern)
[![License](https://img.shields.io/badge/license-MIT-purple.svg)](LICENSE)

[**中文说明**](#-中文说明) | [**English Documentation**](#-english-documentation)

</div>

---

<a name="-中文说明"></a>
## 🇨🇳 中文说明

### 🌟 痛点：为什么市面上的统计插件全在“假统计”？

许多酒馆玩家都遇到过类似困扰：**“中转站余额飞速扣费，但看酒馆统计插件，明明才聊了几千 Token，到底是谁在暗中烧钱？！”**

现有统计插件（如 Token Counter 等）走的是**“消息事件监听”**路线：
* ❌ **只能记录正文**：只有聊天框里真正渲染生成了一条新气泡，它才会计数。
* ❌ **暗箱消耗彻底漏光**：**Smart Context（上下文浓缩）**、**SP 数据库 / 记忆库**、**自动总结（Summarize）**、**LittlewhiteBox（小白盒意图判断）**、**JS-Slash-Runner 宏脚本** 以及 **TTS 语音合成** 在后台独立发起的 API 调用，被现有插件 100% 漏报！

**Omni API Tracker 终极破局：双层哨兵（Two-Tier Sentry）架构**
1. **上层业务哨兵**：直接接入酒馆核心状态机，监听官方生成周期（`normal` 正文 vs `quiet` 后台静默），彻底识破小白盒、Slash-Runner 等拦截器的“套娃马甲”，还聊天正文以清白！
2. **底层网络哨兵**：在浏览器最底层代理全局 `fetch`，使用 `ReadableStream.tee()` 无损镜像打字机数据流，0 延迟、0 阻塞，暗中拦截并审计发往大模型或音频接口的每一笔消耗！

---

### ✨ 核心特性

- 🎯 **四大家族，泾渭分明**：
  - 💬 **正文主聊**：剥离所有扩展插件的代理外壳，精准统计真正的聊天正文。
  - 🔊 **语音朗读 (TTS)**：独立专属分类！对齐 MiMo-TTS、Edge-TTS 等语音模型，避免海量小额朗读请求稀释大模型数据。
  - 🧠 **记忆/总结/SP**：精准归因 Smart-Context、SP 数据库、长程记忆与自动摘要。
  - ⚙️ **预设/工具/脚本**：统计后台独立执行的意图提取、模板运算与宏脚本。
  - 🔍 **向量检索**：捕获 Embeddings 向量嵌入计算。
- 📊 **黑曜石高对比度看板**：强制深色卡片（#161622），告别受宿主主题污染的“白底黄字”，手机/PC 双端完美自适应。
- 📜 **实时调用流水日志**：精确到秒，查看每次请求的发起源、模型名称、Prompt、Completion 与网络耗时（ms）。
- ⚡ **顶栏开关自由控制**：提供右上角/左上角胶囊徽章；支持在扩展设置中一键隐藏、或长按徽章快捷隐藏，清爽不遮挡。
- 🛡️ **100% 零侵入与零残留**：纯前端扩展，不改酒馆任何核心源码，删掉文件夹即彻底恢复。

---

### 🚀 极简安装教程（无需后台配置）

本插件为**纯前端插件**，不需要配 Node.js 服务端、不需要装 npm 库、不需要改 `config.yaml`。

#### 方式一：酒馆原生 UI 链接安装（推荐）
1. 打开酒馆，点击右上角的 **扩展插件（四个小方块图标）**。
2. 展开 **“安装扩展”** 区域。
3. 在 Git 仓库链接输入框中粘贴：
   ```text
   https://github.com/ymf2317-tech/SillyTavern-OmniTracker
   ```
4. 点击 **“安装 / 保存”**。
5. 提示安装成功后，在浏览器中**按 F5 刷新页面**即可！

#### 方式二：终端直投
进入你的酒馆扩展目录克隆：
```bash
cd SillyTavern/public/scripts/extensions/third-party/
git clone https://github.com/ymf2317-tech/SillyTavern-OmniTracker.git
```
刷新浏览器即可使用。

---

<a name="-english-documentation"></a>
## 🇬🇧 English Documentation

### 🌟 Why Omni API Tracker?

Almost all existing token counters in the SillyTavern ecosystem rely on UI-level message events (`MESSAGE_RECEIVED`). This introduces critical blind spots:
* ❌ **Main Chat Only**: They only record tokens when a dialogue bubble is rendered into the chat log.
* ❌ **Invisible Background Leaks**: Background calls triggered by **Smart Context**, **Memory/Summarization**, **Vector Embeddings**, **LittlewhiteBox / Preset scripts**, and **TTS models (e.g. MiMo, Edge-TTS)** are completely ignored, resulting in 40%–70% of unaccounted API billing.

**Omni API Tracker Solves This with a Two-Tier Sentry Architecture**:
1. **Upper-Tier State Sentinel**: Hooks into SillyTavern's core lifecycle (`GENERATION_STARTED`), distinguishing official chat generations (`normal`) from background quiet tasks (`quiet`). It unwraps multi-layer interceptors (like Slash-Runner or LittlewhiteBox) to accurately attribute true chat dialogue.
2. **Lower-Tier Network Sentinel**: Proxies `window.fetch` transparently at the network layer and bifurcates SSE stream via `ReadableStream.tee()`. Zero latency, zero interference with the streaming typewriter, while extracting 100% accurate usage data.

---

### ✨ Key Features

- 🎯 **Accurate Categorization**:
  - 💬 **Main Chat**: Unwraps extension wrappers and attributes true conversation turns.
  - 🔊 **Voice Synthesis (TTS)**: Dedicated category for MiMo-TTS, Edge-TTS, and audio generation.
  - 🧠 **Memory & Summary**: Tracks Smart-Context, SP databases, and auto-summaries.
  - ⚙️ **Presets & Tools**: Records standalone intent extraction and script macros.
  - 🔍 **Vector Embeddings**: Tracks knowledge base embedding queries.
- 📊 **Studio Dark High-Contrast Dashboard**: Hand-crafted `#161622` dark studio theme with crisp white typography, immune to light/translucent theme glitches.
- 📜 **Real-time Request Log**: Inspect exact timestamps, caller extensions, model names, prompt/completion tokens, and network latency.
- ⚡ **Flexible Topbar Badge**: Toggle the topbar pill on/off from the extension settings or long-press the badge to hide.
- 🛡️ **Zero Host Mutation**: 100% client-side extension. Zero backend configuration, zero dependencies, completely reversible.

---

### 🚀 Quick Installation

#### Method 1: SillyTavern UI (Recommended)
1. In SillyTavern, click the **Extensions** icon (stacked squares in the top-right menu).
2. Expand **Install Extension**.
3. Paste the repository URL:
   ```text
   https://github.com/ymf2317-tech/SillyTavern-OmniTracker
   ```
4. Click **Install / Save**.
5. Press **F5** to reload your browser!

#### Method 2: Git Clone
```bash
cd SillyTavern/public/scripts/extensions/third-party/
git clone https://github.com/ymf2317-tech/SillyTavern-OmniTracker.git
```
Reload your browser to start auditing!

---

## 📄 License
Released under the [MIT License](LICENSE).
EOF