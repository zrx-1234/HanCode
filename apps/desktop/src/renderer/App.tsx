import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { AgentEvent, ConfirmationRequest, PermissionMode, UsageTotals } from "../../../../src/agent/types";
import type { HanCodeDesktopApi } from "../preload";

declare global {
  interface Window {
    hancode: HanCodeDesktopApi;
  }
}

type ToolItem = {
  id: string;
  name: string;
  input: unknown;
  status: "running" | "done" | "failed";
  result?: string;
};

type ConfirmationState = {
  confirmationId: string;
  request: ConfirmationRequest;
};

type WorkspaceInfo = {
  workspaceRoot?: string;
  model?: string;
  baseURL?: string;
  effort?: string;
  maxTurns?: number;
  webEnabled?: boolean;
};

type Locale = "zh" | "en";
type Theme = "dark" | "light";

type ConversationMessage =
  | { id: string; taskId: string; role: "user"; text: string }
  | { id: string; taskId: string; role: "assistant"; text: string; thinking: string; thinkingOpen: boolean; status: "streaming" | "done" | "error" | "stopped" };

const emptyUsage: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};

const dictionary = {
  zh: {
    title: "HanCode 桌面端",
    selectWorkspace: "请选择工作区开始",
    pickWorkspace: "选择工作区",
    workspacePath: "工作区路径",
    openInExplorer: "在文件管理器中打开",
    model: "模型",
    effort: "深度",
    maxTurns: "最大轮次",
    web: "联网",
    enabled: "已启用",
    disabled: "已关闭",
    askPlaceholder: "让 HanCode 处理这个项目…（Enter 发送，Shift+Enter 换行）",
    run: "运行",
    stop: "停止",
    tools: "工具",
    noTools: "暂无工具调用。",
    resultPreview: "结果预览",
    task: "本次任务",
    session: "当前会话",
    tokens: "tokens",
    input: "输入",
    output: "输出",
    cache: "缓存 读/写",
    thinkingSummary: "思考摘要",
    emptyChat: "对话内容会显示在这里…",
    deny: "拒绝",
    allow: "允许",
    language: "语言",
    theme: "主题",
    dark: "深色",
    light: "浅色",
    permission: "权限",
    safeMode: "安全模式",
    normalMode: "常规模式",
    superMode: "超级模式",
    superModeWarning: "超级模式：命令将自动执行，但硬拒绝的危险命令仍会被阻止。",
  },
  en: {
    title: "HanCode Desktop",
    selectWorkspace: "Select a workspace to begin",
    pickWorkspace: "Pick Workspace",
    workspacePath: "Workspace path",
    openInExplorer: "Open in Explorer",
    model: "Model",
    effort: "Effort",
    maxTurns: "Max turns",
    web: "Web",
    enabled: "enabled",
    disabled: "disabled",
    askPlaceholder: "Ask HanCode to work on this project… (Enter to send, Shift+Enter for newline)",
    run: "Run",
    stop: "Stop",
    tools: "Tools",
    noTools: "No tools yet.",
    resultPreview: "Result preview",
    task: "Task",
    session: "Session",
    tokens: "tokens",
    input: "in",
    output: "out",
    cache: "cache r/w",
    thinkingSummary: "Thinking summary",
    emptyChat: "Conversation will appear here…",
    deny: "Deny",
    allow: "Allow",
    language: "Language",
    theme: "Theme",
    dark: "Dark",
    light: "Light",
    permission: "Permission",
    safeMode: "Safe mode",
    normalMode: "Normal mode",
    superMode: "Super mode",
    superModeWarning: "Super mode: commands run automatically, but hard-refused dangerous commands are still blocked.",
  },
} satisfies Record<Locale, Record<string, string>>;

export default function App() {
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo | null>(null);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [status, setStatus] = useState<"idle" | "running" | "stopping" | "error">("idle");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);
  const [taskUsage, setTaskUsage] = useState<UsageTotals>(emptyUsage);
  const [sessionUsage, setSessionUsage] = useState<UsageTotals>(emptyUsage);
  const [locale, setLocale] = useState<Locale>(() => initialLocale());
  const [theme, setTheme] = useState<Theme>(() => initialTheme());
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => initialPermissionMode());
  const conversationEndRef = useRef<HTMLDivElement | null>(null);

  const t = (key: keyof typeof dictionary.en) => dictionary[locale][key];

  useEffect(() => {
    return window.hancode.onAgentEvent(handleAgentEvent);
  }, []);

  useEffect(() => {
    localStorage.setItem("hancode.locale", locale);
  }, [locale]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("hancode.theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("hancode.permissionMode", permissionMode);
    if (!workspaceInfo) return;
    void window.hancode.setPermissionMode(permissionMode).catch(err => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [permissionMode, workspaceInfo]);

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const canRun = useMemo(() => Boolean(workspaceInfo && prompt.trim() && status !== "running" && status !== "stopping"), [workspaceInfo, prompt, status]);

  async function pickWorkspace() {
    const picked = await window.hancode.pickWorkspace();
    if (picked) {
      setWorkspacePath(picked);
      await openWorkspace(picked);
    }
  }

  async function openWorkspace(path = workspacePath) {
    if (!path.trim()) return;
    setError("");
    try {
      const info = await window.hancode.openWorkspace(path) as WorkspaceInfo;
      setWorkspaceInfo(info);
      await window.hancode.setPermissionMode(permissionMode);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function showWorkspaceInFolder() {
    const path = workspaceInfo?.workspaceRoot || workspacePath;
    if (!path.trim()) return;
    setError("");
    try {
      await window.hancode.showWorkspaceInFolder(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function startTask() {
    if (!canRun) return;
    const text = prompt.trim();
    if (!text) return;
    setTools([]);
    setTaskUsage(emptyUsage);
    setError("");
    setStatus("running");
    try {
      const result = await window.hancode.startTask(text);
      setTaskId(result.taskId);
      setMessages(items => [
        ...items,
        { id: `${result.taskId}-user`, taskId: result.taskId, role: "user", text },
        { id: `${result.taskId}-assistant`, taskId: result.taskId, role: "assistant", text: "", thinking: "", thinkingOpen: false, status: "streaming" },
      ]);
      setPrompt("");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function stopTask() {
    if (!taskId) return;
    setStatus("stopping");
    await window.hancode.stopTask(taskId);
  }

  async function answerConfirmation(allowed: boolean) {
    if (!confirmation) return;
    await window.hancode.respondConfirmation(confirmation.confirmationId, allowed);
    setConfirmation(null);
  }

  function handlePromptKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void startTask();
  }

  function handleAgentEvent(event: AgentEvent) {
    switch (event.type) {
      case "output.delta":
        updateAssistant(event.taskId, message => ({ ...message, text: message.text + event.text }));
        break;
      case "thinking.delta":
        updateAssistant(event.taskId, message => ({ ...message, thinking: message.thinking + event.text }));
        break;
      case "tool.started":
        setTools(items => [...items, { id: event.toolUseId, name: event.name, input: event.input, status: "running" }]);
        break;
      case "tool.finished":
        setTools(items => items.map(item => item.id === event.toolUseId ? { ...item, status: event.isError ? "failed" : "done", result: event.contentPreview } : item));
        break;
      case "confirmation.requested":
        setConfirmation({ confirmationId: event.confirmationId, request: event.request });
        break;
      case "usage.updated":
        setTaskUsage(event.taskUsage);
        setSessionUsage(event.sessionUsage);
        break;
      case "run.completed":
        finishTask(event.taskId, "done");
        break;
      case "run.refused":
      case "run.max_turns":
      case "run.stopped":
        finishTask(event.taskId, "stopped");
        break;
      case "run.error":
        finishTask(event.taskId, "error");
        setError(event.message);
        break;
    }
  }

  function updateAssistant(taskId: string, updater: (message: Extract<ConversationMessage, { role: "assistant" }>) => ConversationMessage) {
    setMessages(items => items.map(item => item.role === "assistant" && item.taskId === taskId ? updater(item) : item));
  }

  function finishTask(finishedTaskId: string, nextStatus: "done" | "error" | "stopped") {
    updateAssistant(finishedTaskId, message => ({ ...message, status: nextStatus }));
    setStatus(nextStatus === "error" ? "error" : "idle");
    setTaskId(null);
  }

  function toggleThinking(messageId: string) {
    setMessages(items => items.map(item => item.role === "assistant" && item.id === messageId ? { ...item, thinkingOpen: !item.thinkingOpen } : item));
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>{t("title")}</h1>
          <p>{workspaceInfo?.workspaceRoot ?? t("selectWorkspace")}</p>
        </div>
        <div className="topbar-actions">
          <label>{t("permission")}
            <select value={permissionMode} onChange={event => setPermissionMode(event.target.value as PermissionMode)}>
              <option value="safe">{t("safeMode")}</option>
              <option value="normal">{t("normalMode")}</option>
              <option value="super">{t("superMode")}</option>
            </select>
          </label>
          <label>{t("language")}
            <select value={locale} onChange={event => setLocale(event.target.value as Locale)}>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>{t("theme")}
            <select value={theme} onChange={event => setTheme(event.target.value as Theme)}>
              <option value="dark">{t("dark")}</option>
              <option value="light">{t("light")}</option>
            </select>
          </label>
          <button onClick={pickWorkspace}>{t("pickWorkspace")}</button>
        </div>
      </header>

      <section className="workspace-row">
        <input value={workspacePath} onChange={event => setWorkspacePath(event.target.value)} placeholder={t("workspacePath")} />
        <button disabled={!workspacePath.trim() && !workspaceInfo?.workspaceRoot} onClick={() => void showWorkspaceInFolder()}>{t("openInExplorer")}</button>
      </section>

      {workspaceInfo && (
        <section className="status-row">
          <span>{t("model")}: {workspaceInfo.model}</span>
          <span>{t("effort")}: {workspaceInfo.effort}</span>
          <span>{t("maxTurns")}: {workspaceInfo.maxTurns}</span>
          <span>{t("web")}: {workspaceInfo.webEnabled ? t("enabled") : t("disabled")}</span>
        </section>
      )}

      {permissionMode === "super" && <section className="warning-banner">{t("superModeWarning")}</section>}

      {error && <section className="error-banner">{error}</section>}

      <section className="main-grid">
        <section className="chat-panel">
          <div className="conversation-box">
            {messages.length === 0 && <span className="placeholder">{t("emptyChat")}</span>}
            {messages.map(message => <ConversationBubble key={message.id} message={message} t={t} onToggleThinking={toggleThinking} />)}
            <div ref={conversationEndRef} />
          </div>
          <div className="composer">
            <textarea value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={handlePromptKeyDown} placeholder={t("askPlaceholder")} />
            <div className="composer-actions">
              <button disabled={!canRun} onClick={() => void startTask()}>{t("run")}</button>
              <button disabled={status !== "running" || !taskId} onClick={() => void stopTask()}>{t("stop")}</button>
            </div>
          </div>
        </section>

        <aside className="side-panel">
          <UsageBar label={t("task")} usage={taskUsage} t={t} />
          <UsageBar label={t("session")} usage={sessionUsage} t={t} />
          <h2>{t("tools")}</h2>
          <div className="tool-list">
            {tools.length === 0 && <p className="placeholder">{t("noTools")}</p>}
            {tools.map(tool => <ToolCard key={tool.id} tool={tool} t={t} />)}
          </div>
        </aside>
      </section>

      {confirmation && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>{confirmation.request.title}</h2>
            <p>{confirmation.request.message}</p>
            {confirmation.request.commandText && <pre>{confirmation.request.commandText}</pre>}
            {confirmation.request.command && <pre>{confirmation.request.command.join(" ")}</pre>}
            <div className="modal-actions">
              <button onClick={() => void answerConfirmation(false)}>{t("deny")}</button>
              <button className="primary" onClick={() => void answerConfirmation(true)}>{t("allow")}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function ConversationBubble({ message, t, onToggleThinking }: { message: ConversationMessage; t: (key: keyof typeof dictionary.en) => string; onToggleThinking: (id: string) => void }) {
  if (message.role === "user") return <article className="message-bubble user"><div>{message.text}</div></article>;
  return (
    <article className={`message-bubble assistant ${message.status}`}>
      {message.thinking && (
        <section className="thinking-panel">
          <button className="thinking-toggle" onClick={() => onToggleThinking(message.id)}>{message.thinkingOpen ? "▾" : "▸"} {t("thinkingSummary")}</button>
          {message.thinkingOpen && <pre>{message.thinking}</pre>}
        </section>
      )}
      <MarkdownContent text={message.text || "…"} />
    </article>
  );
}

function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a({ href, children }) {
            return <a href={href} onClick={event => handleMarkdownLinkClick(event, href)}>{children}</a>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function handleMarkdownLinkClick(event: React.MouseEvent<HTMLAnchorElement>, href: string | undefined): void {
  if (!href) return;
  event.preventDefault();
  void window.hancode.openExternal(href);
}

function ToolCard({ tool, t }: { tool: ToolItem; t: (key: keyof typeof dictionary.en) => string }) {
  return (
    <article className={`tool-card ${tool.status}`}>
      <header>
        <strong>{tool.name}</strong>
        <span>{tool.status}</span>
      </header>
      <pre>{JSON.stringify(tool.input, null, 2)}</pre>
      {tool.result && <details><summary>{t("resultPreview")}</summary><pre>{tool.result}</pre></details>}
    </article>
  );
}

function UsageBar({ label, usage, t }: { label: string; usage: UsageTotals; t: (key: keyof typeof dictionary.en) => string }) {
  const total = usage.inputTokens + usage.outputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
  return (
    <div className="usage-card">
      <strong>{label}</strong>
      <span>{total.toLocaleString()} {t("tokens")}</span>
      <small>{t("input")} {usage.inputTokens.toLocaleString()} · {t("output")} {usage.outputTokens.toLocaleString()} · {t("cache")} {usage.cacheReadInputTokens.toLocaleString()}/{usage.cacheCreationInputTokens.toLocaleString()}</small>
    </div>
  );
}

function initialLocale(): Locale {
  const saved = localStorage.getItem("hancode.locale");
  if (saved === "zh" || saved === "en") return saved;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function initialTheme(): Theme {
  const saved = localStorage.getItem("hancode.theme");
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function initialPermissionMode(): PermissionMode {
  const saved = localStorage.getItem("hancode.permissionMode");
  if (saved === "safe" || saved === "normal" || saved === "super") return saved;
  return "normal";
}
