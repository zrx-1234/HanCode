# Changelog

本文件记录 HanCode 的所有重要变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，并遵循
[语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2026-07-15

首个稳定版本。在 MVP 基础上补齐 Bash 工具、联网能力、桌面端与权限模式，并完善测试与文档。

### 新增

- **`bash` 工具**：运行 Bash 命令字符串，通过固定 Bash 以 `--noprofile --norc -lc` 执行；
  解析并分类命令——只读/测试命令自动放行，修改 workspace、删除、安装依赖、未知或复杂命令交互确认；
  拒绝 download-and-execute、嵌套 shell wrapper、全局安装、workspace 外/系统路径、命令替换等绕过模式。
- **Web 工具**：
  - `web_search` 支持 `searxng`、`tavily`、`brave` 三种适配器；searxng 无需商业 Key，
    仅需配置 `searxngEndpointUrl`（也可用 `SEARXNG_ENDPOINT_URL` 环境变量）。
  - `web_fetch` 默认直接 HTTP 抓取，也可配置为 `tavily` 提取模式。
  - SSRF 防护：拒绝 URL 凭据、localhost、私有网段、link-local/multicast 地址及 blocklist 域名；
    `http://` 自动升级为 `https://`；不静默跟随跨主机重定向。
- **Desktop 应用**：基于 Electron + React 的 GUI，Agent 核心运行在 Bun Sidecar 子进程中，
  通过 JSONL 协议与主进程通信；支持 `desktop:dev` 开发与 `desktop:build` 构建。
- **权限模式**：`safe`（全部确认）、`normal`（安全自动、危险确认，默认）、
  `super`（自动批准大部分命令，但 `rm`、`git reset --hard` 等 destructive 命令永远需确认）。
- **用量统计**：记录并展示 token 用量。
- **综合测试**：覆盖 agent loop、权限模式、命令策略、web 工具等，用例扩充至 124 个。
- **文档**：README 补充使用场景、架构说明与权限模式介绍。
- **配置增强**：`hancode.config.json` 新增 `web` 配置段（搜索/抓取适配器、域名 allow/block）。

### 变更

- Desktop 端 electron 导入由默认导入 + 解构改为 ES 命名导入。

### 已知限制

- 目前无真正的 OS/container sandbox，允许的命令仍可能修改 workspace 内文件；
  后续可接入 Docker、WSL 或其他 sandbox runner。
- Web 工具不支持认证、Cookie、自定义请求头、POST、表单提交或 JavaScript 渲染。

## [0.1.0] - 2026-06-22

初始 MVP 版本。基于 Bun + TypeScript + Anthropic Claude API tool use 的 Coding Agent，
提供终端 CLI 与 6 个内置工具。

### 新增

- **Agent 核心**：基于 Claude tool use 的对话循环（`agent/loop.ts`）、系统提示词构造、
  事件渲染与类型定义。
- **6 个内置工具**：`read_file`、`list_files`（glob 风格）、`search_text`（正则）、
  `edit_file`（精确替换）、`write_file`、`run_command`（argv 风格，策略受限）。
- **安全层**：
  - workspace 路径固定 + canonicalize，拒绝路径穿越、UNC/network path、workspace 外路径。
  - `run_command` 仅接受 `command + args`，以 `shell: false` 的 argv 方式执行，不接受 shell 字符串。
  - 命令写入 `.hancode/commands.jsonl` 审计日志。
  - stdout/stderr 长度受限；对未知或会修改 workspace 的命令交互确认，非 TTY 下默认拒绝。
- **CLI**：`bun run chat` 持续对话、`bun run once` 一次性任务；启动时输入 workspace 路径。
- **配置系统**：`hancode.config.json` 管理 API Key、模型、Base URL、`maxTurns`、`effort`。
- **初始测试**：覆盖 commandPolicy、editFile、outputLimit、paths。

[1.0.0]: https://github.com/zrx-1234/HanCode/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/zrx-1234/HanCode/releases/tag/v0.1.0
