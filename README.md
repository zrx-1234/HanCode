# HanCode

HanCode 是一个最小可运行 Coding Agent MVP，使用 Bun + TypeScript + Anthropic Claude API tool use 实现。

## 功能

当前内置 6 个工具：

| 工具 | 作用 |
|---|---|
| `read_file` | 读取 workspace 内文本文件 |
| `list_files` | 使用 glob 风格模式查找文件 |
| `search_text` | 使用正则搜索代码文本 |
| `edit_file` | 对已读取文件执行一次精确替换 |
| `write_file` | 创建或覆盖文件 |
| `run_command` | 运行受策略限制的测试、git、构建命令 |

## 安装

```bash
cd E:\ZZZProjects\HanCode
bun install
```

配置 API Key、模型和 Base URL：

复制或直接编辑项目根目录的 `hancode.config.json`：

```json
{
  "apiKey": "sk-ant-...",
  "model": "claude-opus-4-8",
  "baseURL": "https://api.anthropic.com",
  "maxTurns": 20
}
```

以后修改模型、API Key 或代理 / 中转地址时，只改这个配置文件，不需要在终端设置环境变量。

## 运行

推荐入口：启动后会一直在终端中对话，直到输入 `exit` 或 `quit`：

```bash
bun run chat
```

等价于：

```bash
bun run src/hancode.ts
```

如果通过包的 bin 方式安装或链接，也可以直接执行：

```bash
hancode
```

一次性任务入口仍然保留：

```bash
bun run once "Create src/hello.ts that exports a hello function"
```

进入程序后会先提示输入工作区路径：

```text
Workspace path (press Enter for current directory): E:\ZZZProjects\YourProject
```

HanCode 后续的文件读写、搜索、编辑和命令执行都会固定在这个工作区内。直接按 Enter 则使用当前目录。

退出：输入 `exit` 或 `quit`。

## 安全边界

HanCode MVP 做了这些限制：

- 启动时由用户输入 workspace 路径，之后固定在该目录。
- 文件路径会 canonicalize，并拒绝路径穿越、UNC/network path、workspace 外路径。
- `run_command` 不接受 shell 字符串，只接受 `command + args`。
- `run_command` 使用 `Bun.spawn([...], { cwd, shell: false })` 的 argv 风格执行。
- 命令默认 30s 超时，最大 5min。
- stdout/stderr 输出有长度限制，避免大日志灌入上下文。
- 命令写入 `.hancode/commands.jsonl` 审计日志。
- 拒绝 `rm -rf`、`git push`、`git reset --hard`、全局安装、shell、系统目录修改等危险操作。
- 对未知或会修改 workspace 的命令进行交互确认；非 TTY 下默认拒绝。

MVP 没有真正 OS/container sandbox。允许的可执行程序仍可能修改 workspace 内文件。后续可以接 Docker、WSL 或其他 sandbox runner。

## 开发检查

```bash
bun run typecheck
bun test
```
