<div align="center">

# ⚡ Omni API Tracker for SillyTavern

**酒馆全量 API 审计与冒险者公会手账**  
*Full-Spectrum API Call Tracker & Adventurer Guild Companion for SillyTavern*

[![Version](https://img.shields.io/badge/version-v1.4.0-emerald.svg)](https://github.com/ymf2317-tech/SillyTavern-OmniTracker)
[![SillyTavern](https://img.shields.io/badge/SillyTavern-Extension-blue.svg)](https://github.com/SillyTavern/SillyTavern)
[![License](https://img.shields.io/badge/license-MIT-purple.svg)](LICENSE)

[**中文说明**](#-中文说明) | [**English Documentation**](#-english-documentation)

</div>

---

<a name="-中文说明"></a>
## 🇨🇳 中文说明

### 🌟 为什么诞生这个插件？

许多重度折腾酒馆的玩家都遇到过类似困扰：**“中转站余额飞速扣费，但翻看聊天记录，字数根本对不上账？到底有哪几个后台插件在暗中跑大模型？各自烧了多少 Token？今天又在酒馆陪伴了纸片人多久？”**

现有统计插件大多依赖聊天框的“消息渲染事件”，导致后台静默发起的 **Smart Context（上下文浓缩）**、**SP 数据库 / 记忆库**、**自动总结（Summarize）**、**LittlewhiteBox（小白盒意图判断）**、**JS-Slash-Runner 宏脚本** 以及 **TTS 语音朗读** 被 100% 漏报！

**Omni API Tracker v1.4.0 带来了终极合体解决方案**：
1. **双层哨兵流量审计**：
   - **上层业务哨兵**：接入酒馆官方生成生命周期（`normal` vs `quiet`），彻底穿透小白盒、Slash-Runner 等拦截器的“套娃马甲”，还聊天正文以清白！
   - **底层网络哨兵**：全局代理 `window.fetch`，利用 `ReadableStream.tee()` 无损镜像打字机流，0 延迟、0 阻塞捕获发往大模型或音频端点的真实 Usage！
2. **冒险者公会陪伴手账（融合 @黎吧啦 活跃心跳与 RPG 成就系统）**：
   - 15 秒精准心跳感知（页面可见且聚焦才打卡，挂起不虚增时长）；
   - RPG 10 阶冒险者称号与等级（迷途旅人 ➔ 奇点见证者，带经验进度条）；
   - 10 大勋章成就图鉴与历史肝帝 Top 5 排行榜；
   - 原生 SVG 7 天活跃趋势柱状图（零外部 CDN 依赖，离线秒开）。

---

### ✨ 核心特性

- 🎯 **四大家族，泾渭分明**：
  - 💬 **正文主聊**：剥离各种拦截器外壳，还原真正的角色对话消耗；
  - 🔊 **语音朗读 (TTS)**：**独立专属分类（青绿徽章）**，单独统计 MiMo-TTS、Edge-TTS 等语音调用，不再稀释聊天数据；
  - 🧠 **记忆/总结/SP**：精准捕获 Smart-Context、SP 数据库、自动摘要等后台浓缩消耗；
  - ⚙️ **预设/工具/脚本**：统计单句意图判定、模板宏运算与翻译插件开销；
  - 🔍 **向量检索**：捕获知识库与 Embeddings 向量嵌入计算。
- 🏰 **RPG 冒险者公会手账**：
  - 在线活跃时长自动按天归档，自动兼容并迁移历史活跃时长数据；
  - 冒险者称号、等级、经验条、成就勋章、肝帝排行榜。
- 📊 **黑曜石高对比度暗黑 UI**：强制深色卡片（#151520）与纯白加粗字体，告别浅色主题“白底黄字”，移动端与 PC 完美自适应。
- 📜 **实时调用流水日志**：精确到秒，查看每次请求的发起源、模型名称、Prompt、Completion 与网络耗时（ms）。
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
   https://github.com/ymf2317-tech/SillyTavern-OmniTracker
   ```
4. 点击 **“安装 / 保存”**，提示安装成功后在浏览器按 **F5** 刷新页面即可！

#### 方式二：终端直投
```bash
cd SillyTavern/public/scripts/extensions/third-party/
git clone https://github.com/ymf2317-tech/SillyTavern-OmniTracker.git
```
刷新浏览器即可使用。

---

<a name="-english-documentation"></a>
## 🇬🇧 English Documentation

### 🌟 Why Omni API Tracker?

Most token counters in the SillyTavern ecosystem rely solely on UI message rendering events (`MESSAGE_RECEIVED`). This leaves silent background calls from **Smart Context**, **Memory/Summarization**, **SP Databases**, **LittlewhiteBox / Preset scripts**, and **TTS models (MiMo, Edge-TTS)** completely unrecorded.

**Omni API Tracker v1.4.0 brings the ultimate combo**:
1. **Two-Tier Sentry Traffic Auditing**:
   - **Upper-Tier Lifecycle Sentinel**: Distinguishes chat turns (`normal`) from background quiet tasks (`quiet`), unwrapping interceptors like Slash-Runner or LittlewhiteBox to correctly attribute dialogue.
   - **Lower-Tier Network Sentinel**: Transparently proxies `window.fetch` and splits SSE streams via `ReadableStream.tee()`, extracting official usage with zero latency and zero interference.
2. **Adventurer Guild Active Companion**:
   - 15-second visibility-aware heartbeat tracking (only ticks when the tab is focused and active);
   - RPG Title & Level Progression (Novice Traveler ➔ Singularity Witness, 10 hours per Level);
   - 10 unlockable achievements and historical Top 5 Marathon sessions;
   - Zero-dependency SVG 7-day activity bar chart (offline-ready).

---

### ✨ Key Features

- 🎯 **Accurate Categorization**:
  - 💬 **Main Chat**: Unwraps extension wrappers and attributes true conversation turns.
  - 🔊 **Voice Synthesis (TTS)**: Dedicated category for MiMo-TTS, Edge-TTS, and audio generation.
  - 🧠 **Memory & Summary**: Tracks Smart-Context, SP databases, and auto-summaries.
  - ⚙️ **Presets & Tools**: Records standalone intent extraction and script macros.
  - 🔍 **Vector Embeddings**: Tracks knowledge base embedding queries.
- 🏰 **Adventurer Guild Companion**:
  - Daily active time accumulation with auto-migration from legacy tracker files;
  - RPG Titles, Level Progress, Achievement Showcase, and Top 5 Grinder Records.
- 📊 **Studio Dark High-Contrast Dashboard**: Crafted `#151520` dark studio theme with crisp white typography, immune to theme color glitches.
- 📜 **Real-time Request Log**: Inspect exact timestamps, caller extensions, model names, prompt/completion tokens, and network latency.
- ⚡ **Flexible Topbar Pill**: Displays `⚡ Tokens | Duration`; toggle on/off from extension settings or long-press the badge to hide.
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