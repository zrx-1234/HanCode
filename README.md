# HanCode

HanCode 是一个 Coding Agent，使用 Bun + TypeScript + Anthropic Claude API tool use 实现。支持**终端 CLI**和 **Electron 桌面端**两种使用方式。

## 功能

当前内置 9 个工具：

| 工具 | 作用 |
|---|---|
| `read_file` | 读取 workspace 内文本文件 |
| `list_files` | 使用 glob 风格模式查找文件 |
| `search_text` | 使用正则搜索代码文本 |
| `edit_file` | 对已读取文件执行一次精确替换 |
| `write_file` | 创建或覆盖文件 |
| `run_command` | 使用 argv 风格运行受策略限制的测试、git、构建命令 |
| `bash` | 运行 Bash 命令字符串；安全命令自动执行，危险/未知命令需确认 |
| `web_search` | 联网检索公开网页，返回标题、URL 和摘要；需要启用 web 并配置搜索 API Key |
| `web_fetch` | 抓取公开 HTTP/HTTPS URL 并提取可读文本；不支持认证、Cookie 或 JavaScript 渲染 |

## 使用场景

### 1. 接手新项目，快速摸清结构

你说：
> "我刚 clone 了这个项目，帮我看看 src 目录下有哪些核心模块，找到入口文件并写份报告。"

HanCode 会：
1. `list_files` 列出 `src/**/*.ts`
2. `read_file` 读取主入口和配置文件
3. 给你一份项目结构摘要

---

### 2. 加一个新功能并跑测试

你说：
> "在 src/utils/ 下加一个 formatDate 函数，支持 ISO 和本地格式两种输出，然后给它们写测试并跑一下。"

HanCode 会：
1. `read_file` 先看看现有代码风格
2. `write_file` 创建 `src/utils/date.ts`
3. `write_file` 创建对应的测试文件
4. `run_command` 执行 `bun test`
5. 如果测试挂了，`read_file` 看报错，用 `edit_file` 修复，再跑一次

---

### 3. 排查 Bug

你说：
> "测试报错了，说是 formatDate 传入 null 时会崩溃，帮我找到问题并修复。"

HanCode 会：
1. `search_text` 找到 `formatDate` 的定义位置
2. `read_file` 读取函数实现
3. `edit_file` 加上空值保护
4. `run_command` 跑测试确认修复成功

---

### 4. 查外部技术文档（需开启 web）

你说：
> "Bun 的测试断言有哪些 API？帮我搜一下官方文档的用法。"

HanCode 会：
1. `web_search` 搜索 "Bun test expect API"
2. `web_fetch` 抓取官方文档页面
3. 把关键用法整理给你

---

### 5. 批量重构

你说：
> "把项目里所有的 `console.log` 改成 `logger.debug`，改完后跑 typecheck 确认没报错。"

HanCode 会：
1. `search_text` 找到所有 `console.log` 出现的位置
2. 逐个 `read_file` → `edit_file` 替换
3. `run_command` 跑 `bun run typecheck`
4. 如有报错继续定位修复

## 安装

```bash
cd E:\ZZZProjects\HanCode
bun install
```

配置自己的 API Key、模型和 Base URL，以及search相关配置：

复制`hancode.config.example.json`为`hancode.config.json`，然后编辑项目根目录的 `hancode.config.json`：

```json
{
  "apiKey": "sk-ant-...",
  "model": "claude-opus-4-8",
  "baseURL": "https://api.anthropic.com",
  "maxTurns": 20,
  "effort": "auto",
  "web": {
    "enabled": false,
    "allowedDomains": [],
    "blockedDomains": [],
    "search": {
      "enabled": true,
      "adapter": "searxng",
      "maxResults": 8,
      "tavilyApiKey": "",
      "braveApiKey": "",
      "searxngEndpointUrl": "https://your-searxng.example.com/search"
    },
    "fetch": {
      "enabled": true,
      "adapter": "http",
      "timeoutMs": 30000,
      "maxBytes": 1000000,
      "maxChars": 60000,
      "cacheTtlMs": 900000
    }
  }
}
```

以后修改模型、API Key、代理 / 中转地址或思考深度时，只改这个配置文件，不需要在终端设置环境变量。

`effort` 控制 Claude 的推理/输出努力程度，可选值为 `auto`、`low`、`medium`、`high`、`xhigh`、`max`。默认 `auto` 表示不显式传 `output_config.effort`，由模型/API 使用自动或默认深度；其他值会作为 `output_config.effort` 传入请求。

`web.enabled` 默认关闭。开启后会向模型暴露 `web_search` 和 `web_fetch`：

- `web_search` 支持 `searxng`、`tavily` 和 `brave` 适配器。`searxng` 不需要商业 API Key，但需要配置可访问的 `searxngEndpointUrl`，也可通过环境变量 `SEARXNG_ENDPOINT_URL` 提供；Tavily/Brave 的 API Key 可写在配置中，也可通过环境变量 `TAVILY_API_KEY` 或 `BRAVE_SEARCH_API_KEY` 提供。
- `web_fetch` 默认使用直接 HTTP 抓取；也可配置为 `tavily` 提取模式并提供 Tavily Key。
- Web 工具只访问公开网页：拒绝 URL 中的用户名/密码、localhost、私有网段、link-local/multicast 地址和被 blocklist 命中的域名。
- `http://` 会自动升级为 `https://`；跨主机重定向不会被静默跟随。
- 不支持认证、Cookie、自定义请求头、POST、表单提交或 JavaScript 渲染。
- `allowedDomains` 和 `blockedDomains` 是全局域名 allow/block 策略。

## 运行

### CLI 模式

推荐入口：启动后会在终端中持续对话，直到输入 `exit` 或 `quit`：

```bash
bun run chat
# 或开发热重载
bun run dev
```

等价于：

```bash
bun run src/hancode.ts
```

如果通过包的 bin 方式安装或链接，也可以直接执行：

```bash
hancode
```

一次性任务入口：

```bash
bun run once "Create src/hello.ts that exports a hello function"
```

进入程序后会先提示输入工作区路径：

```text
Workspace path (press Enter for current directory): E:\ZZZProjects\YourProject
```

HanCode 后续的文件读写、搜索、编辑和命令执行都会固定在这个工作区内。直接按 Enter 则使用当前目录。

退出：输入 `exit` 或 `quit`。

### Desktop 模式

启动 Electron 桌面应用（开发模式）：

```bash
bun run desktop:dev
```

构建桌面应用：

```bash
bun run desktop:build
```

Desktop 模式下通过 GUI 选择工作区、输入任务，Agent 在后台 Sidecar 进程中运行，结果实时展示在界面中。


## 架构

项目采用双模式 + Sidecar 架构：

- **CLI 模式**：直接在终端运行，通过 `bun run chat` 或 `bun run once` 启动。
- **Desktop 模式**：基于 Electron + React 的 GUI 应用。Agent 核心逻辑运行在 Bun Sidecar 子进程中，通过 JSONL 协议与 Electron 主进程通信。

```
src/
├── hancode.ts          # CLI 交互入口
├── cli.ts              # CLI 一次性任务入口
├── desktop/sidecar.ts  # Desktop Sidecar 入口（Bun 子进程）
├── agent/              # Agent 核心（Loop、Prompt、类型）
├── tools/              # 工具实现（文件、搜索、命令、Web、Bash）
├── security/           # 安全层（路径策略、命令策略、权限模式、审计）
├── utils/              # 通用工具
└── apps/desktop/       # Electron 桌面应用（React 前端 + Electron 主进程）
```


## 安全边界

HanCode 做了这些限制：

- 启动时由用户输入 workspace 路径，之后固定在该目录。
- 文件路径会 canonicalize，并拒绝路径穿越、UNC/network path、workspace 外路径。
- Web 工具默认关闭；开启后仍只允许公开 HTTP/HTTPS 网页，拒绝 localhost、私有网段、URL 凭据和跨主机静默重定向。
- `run_command` 不接受 shell 字符串，只接受 `command + args`，使用 `Bun.spawn([...], { cwd, shell: false })` 的 argv 风格执行。
- `bash` 接受 Bash 命令字符串，并通过固定 Bash 可执行程序以 `--noprofile --norc -lc` 执行；Windows 下需要 Git Bash，或设置 `HANCODE_BASH`。
- `bash` 会先解析/分类命令：明确安全的 read/test 命令可自动执行，修改 workspace、删除、安装依赖、未知或过于复杂的命令会交互确认。
- `bash` 会拒绝明显绕过/外部风险模式，例如 download-and-execute、嵌套 shell wrapper、全局安装、workspace 外路径、系统路径、命令替换。
- 命令默认 30s 超时，最大 5min。
- stdout/stderr 输出有长度限制，过大输出会保存到 `.hancode/command-output/`。
- 命令写入 `.hancode/commands.jsonl` 审计日志。
- 对未知或会修改 workspace 的命令进行交互确认；非 TTY 下默认拒绝。
- 权限模式（Permission Mode）：支持 `safe` / `normal` / `super` 三档。
  - `safe`：所有命令都需确认；
  - `normal`：安全命令自动执行，危险/未知命令需确认（默认）；
  - `super`：自动批准大部分命令，但 destructive 命令（如 `rm`、`git reset --hard`）永远需确认。

示例：

```json
{ "command": "git status" }
{ "command": "rg \"TODO\" src | head -20" }
{ "command": "npm install", "description": "install project dependencies" }
```

目前没有真正的 OS/container sandbox。允许的命令仍可能修改 workspace 内文件。后续可以接 Docker、WSL 或其他 sandbox runner。

## 开发检查

```bash
bun run typecheck
bun test
```
