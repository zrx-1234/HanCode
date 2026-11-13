import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  taskId: string;
  toolUseId: string;
  name: string;
  input: unknown;
  status: "running" | "done" | "failed";
  result?: string;
};

type SubAgentItem = {
  taskId: string;
  subId: string;
  status: "running" | "done" | "error" | "stopped";
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
  /** Persisted conversation restored from .hancode/conversation.jsonl (API message format). */
  history?: HistoryMessage[];
};

type HistoryMessage = {
  role: "user" | "assistant";
  content: string | Array<Record<string, unknown>>;
};

type Locale = "zh" | "en";
type Theme = "dark" | "light";

type ConfigDraft = {
  apiKey: string;
  model: string;
  baseURL: string;
  maxTurns: string;
  effort: string;
  thinkingMode: string;
  webEnabled: boolean;
  visionModel: string;
  visionBaseURL: string;
  visionApiKey: string;
};

type ProfileSummary = { name: string; active: boolean };

type ConversationMessage =
  | { id: string; taskId: string; role: "user"; text: string; images?: string[] }
  | { id: string; taskId: string; role: "assistant"; text: string; thinking: string; thinkingOpen: boolean; status: "streaming" | "done" | "error" | "stopped"; taskStartMs?: number; taskEndMs?: number | null }
  | { id: string; taskId: string; role: "system"; kind: "compacted"; removedMessages?: number };

/** Image attached to the composer: bare base64 payload plus its media type. */
type Attachment = { id: string; name: string; mediaType: string; data: string };

const SUPPORTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_BYTES = 4_000_000;

/** Chunked base64 encoding so large images do not blow the argument limit. */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const emptyUsage: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};

/**
 * Convert restored API-format history into display bubbles. Tool plumbing
 * (tool_result user messages, system reminders) is skipped — only the actual
 * conversation text is shown.
 */
function historyToMessages(history: HistoryMessage[] | undefined): ConversationMessage[] {
  if (!history) return [];
  const out: ConversationMessage[] = [];
  for (const [index, message] of history.entries()) {
    if (message.role === "user") {
      const blocks = Array.isArray(message.content) ? message.content : [];
      const text = typeof message.content === "string"
        ? message.content
        : blocks.filter(block => block.type === "text").map(block => String(block.text ?? "")).join("");
      // Attached images become data URLs so restored bubbles show thumbnails.
      const images = typeof message.content === "string"
        ? []
        : blocks
            .filter(block => block.type === "image")
            .map(block => {
              const source = (block as { source?: { media_type?: string; data?: string } }).source;
              return source?.data ? `data:${source.media_type};base64,${source.data}` : undefined;
            })
            .filter((url): url is string => url !== undefined);
      // Compaction replaced older history with a summary marker — render it as
      // a divider instead of a fake user bubble.
      if (text.startsWith("[HanCode compacted context]")) {
        out.push({ id: `history-${index}`, taskId: "history", role: "system", kind: "compacted" });
        continue;
      }
      if ((!text || text.startsWith("[HanCode system reminder]")) && images.length === 0) continue;
      out.push({ id: `history-${index}`, taskId: "history", role: "user", text, images: images.length > 0 ? images : undefined });
    } else {
      const blocks = Array.isArray(message.content) ? message.content : [];
      const text = blocks.filter(block => block.type === "text").map(block => String(block.text ?? "")).join("");
      const thinking = blocks.filter(block => block.type === "thinking").map(block => String(block.thinking ?? "")).join("");
      if (!text && !thinking) continue;
      out.push({ id: `history-${index}`, taskId: "history", role: "assistant", text, thinking, thinkingOpen: false, status: "done" });
    }
  }
  return out;
}

const dictionary = {
  zh: {
    selectWorkspace: "请选择工作区开始",
    pickWorkspace: "选择工作区",
    openInExplorer: "在文件管理器中打开",
    model: "模型",
    effort: "深度",
    thinkingMode: "思考模式",
    maxTurns: "最大轮次",
    web: "联网",
    enabled: "已启用",
    disabled: "已关闭",
    askPlaceholder: "让 HanCode 处理这个项目…（Enter 发送，Shift+Enter 换行）",
    run: "运行",
    stop: "停止",
    newChat: "新对话",
    historyFolded: "▸ 展开历史对话（{count} 条消息）",
    contextCompacted: "✦ 已压缩上下文：{count} 条早期消息已摘要",
    contextCompactedNoCount: "✦ 已压缩上下文（早期对话已摘要）",
    tools: "工具",
    noTools: "暂无工具调用。",
    subAgents: "子 Agent",
    runningSubAgents: "运行中子 Agent",
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
    settings: "设置",
    editConfig: "编辑配置文件",
    settingsTitle: "模型与运行配置",
    configFile: "配置文件",
    apiKey: "API Key",
    modelLabel: "模型",
    baseURL: "Base URL",
    visionModel: "视觉模型",
    visionBaseURL: "视觉模型 Base URL",
    visionApiKey: "视觉模型 API Key",
    visionHint: "Base URL / API Key 留空则沿用主配置；视觉模型留空时图片请求仍走主模型。",
    save: "保存",
    cancel: "取消",
    webToggle: "启用联网（web_search / web_fetch）",
    saveFailed: "保存失败",
    profileSection: "配置方案",
    profileDefault: "默认（当前配置文件）",
    profileSaveAs: "另存为方案",
    profileSaveAsConfirm: "保存并切换",
    profileSaveAsPlaceholder: "新方案名称",
    profileDelete: "删除",
    sidePanelCollapse: "收起信息栏",
    sidePanelExpand: "展开信息栏",
    attachHint: "粘贴或拖入图片（PNG/JPEG/WebP/GIF，最多 6 张，单张 ≤ 4MB）",
    removeAttachment: "移除图片",
    attachTooMany: "最多只能附 6 张图片",
    attachTooLarge: "图片过大（单张最多 4MB）",
    attachUnsupported: "仅支持 PNG / JPEG / WebP / GIF 图片",
  },
  en: {
    selectWorkspace: "Select a workspace to begin",
    pickWorkspace: "Pick Workspace",
    openInExplorer: "Open in Explorer",
    model: "Model",
    effort: "Effort",
    thinkingMode: "Thinking",
    maxTurns: "Max turns",
    web: "Web",
    enabled: "enabled",
    disabled: "disabled",
    askPlaceholder: "Ask HanCode to work on this project… (Enter to send, Shift+Enter for newline)",
    run: "Run",
    stop: "Stop",
    newChat: "New Chat",
    historyFolded: "▸ Show earlier conversation ({count} messages)",
    contextCompacted: "✦ Context compacted: {count} earlier messages summarized",
    contextCompactedNoCount: "✦ Context compacted (earlier conversation summarized)",
    tools: "Tools",
    noTools: "No tools yet.",
    subAgents: "Sub-agents",
    runningSubAgents: "Running sub-agents",
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
    settings: "Settings",
    editConfig: "Edit config file",
    settingsTitle: "Model & runtime settings",
    configFile: "Config file",
    apiKey: "API Key",
    modelLabel: "Model",
    baseURL: "Base URL",
    visionModel: "Vision model",
    visionBaseURL: "Vision base URL",
    visionApiKey: "Vision API key",
    visionHint: "Leave base URL / API key blank to reuse the main settings; an empty vision model keeps image requests on the main model.",
    save: "Save",
    cancel: "Cancel",
    webToggle: "Enable web tools (web_search / web_fetch)",
    saveFailed: "Save failed",
    profileSection: "Profiles",
    profileDefault: "Default (current config file)",
    profileSaveAs: "Save as profile",
    profileSaveAsConfirm: "Save & switch",
    profileSaveAsPlaceholder: "New profile name",
    profileDelete: "Delete",
    sidePanelCollapse: "Hide info panel",
    sidePanelExpand: "Show info panel",
    attachHint: "Paste or drop images (PNG/JPEG/WebP/GIF, up to 6, each ≤ 4MB)",
    removeAttachment: "Remove image",
    attachTooMany: "Too many images (max 6)",
    attachTooLarge: "Image too large (max 4MB each)",
    attachUnsupported: "Only PNG / JPEG / WebP / GIF images are supported",
  },
} satisfies Record<Locale, Record<string, string>>;

export default function App() {
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo | null>(null);
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [subAgents, setSubAgents] = useState<SubAgentItem[]>([]);
  const [status, setStatus] = useState<"idle" | "running" | "stopping" | "error">("idle");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);
  const [taskUsage, setTaskUsage] = useState<UsageTotals>(emptyUsage);
  const [sessionUsage, setSessionUsage] = useState<UsageTotals>(emptyUsage);
  const [locale, setLocale] = useState<Locale>(() => initialLocale());
  const [theme, setTheme] = useState<Theme>(() => initialTheme());
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => initialPermissionMode());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<ConfigDraft | null>(null);
  const [settingsError, setSettingsError] = useState("");
  const [settingsPath, setSettingsPath] = useState("");
  const [sidePanelOpen, setSidePanelOpen] = useState(() => localStorage.getItem("hancode.sidePanel") !== "collapsed");
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [activeProfile, setActiveProfile] = useState("default");
  const [profileSaveAsName, setProfileSaveAsName] = useState("");
  const [profileSaveAsOpen, setProfileSaveAsOpen] = useState(false);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const conversationBoxRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  // Buffered stream deltas per task, flushed on a short timer so a fast token
  // stream does not re-render the whole conversation per delta.
  const pendingDeltasRef = useRef(new Map<string, { text: string; thinking: string }>());
  const flushTimerRef = useRef<number | null>(null);

  const t = useCallback((key: keyof typeof dictionary.en) => dictionary[locale][key], [locale]);

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
    localStorage.setItem("hancode.sidePanel", sidePanelOpen ? "open" : "collapsed");
  }, [sidePanelOpen]);

  useEffect(() => {
    localStorage.setItem("hancode.permissionMode", permissionMode);
    if (!workspaceInfo) return;
    void window.hancode.setPermissionMode(permissionMode).catch(err => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [permissionMode, workspaceInfo]);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    conversationEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [messages]);

  /** First index of the newest task's messages; everything before folds away. */
  const foldIndex = useMemo(() => {
    if (historyExpanded || messages.length === 0) return 0;
    const lastTaskId = messages[messages.length - 1].taskId;
    const index = messages.findIndex(message => message.taskId === lastTaskId);
    return index > 0 ? index : 0;
  }, [messages, historyExpanded]);
  const visibleMessages = useMemo(() => (foldIndex > 0 ? messages.slice(foldIndex) : messages), [messages, foldIndex]);

  function handleConversationScroll() {
    const el = conversationBoxRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
  }

  const canRun = useMemo(() => Boolean(workspaceInfo && (prompt.trim() || attachments.length > 0) && status !== "running" && status !== "stopping"), [workspaceInfo, prompt, attachments, status]);

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
      // Replay the persisted conversation so previous records stay visible.
      setMessages(historyToMessages(info.history));
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

  async function openConfigFile() {
    setError("");
    try {
      await window.hancode.openConfigFile();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function startTask() {
    if (!canRun) return;
    const text = prompt.trim();
    const images = attachments.map(({ mediaType, data }) => ({ mediaType, data }));
    if (!text && images.length === 0) return;
    setTools([]);
    setSubAgents([]);
    setTaskUsage(emptyUsage);
    setError("");
    setStatus("running");
    stickToBottomRef.current = true;
    // New task: fold previous conversation back behind the history banner.
    setHistoryExpanded(false);
    try {
      const result = await window.hancode.startTask(text, images.length > 0 ? images : undefined);
      setTaskId(result.taskId);
      const dataUrls = attachments.map(({ mediaType, data }) => `data:${mediaType};base64,${data}`);
      setMessages(items => [
        ...items,
        { id: `${result.taskId}-user`, taskId: result.taskId, role: "user", text, images: dataUrls.length > 0 ? dataUrls : undefined },
        { id: `${result.taskId}-assistant`, taskId: result.taskId, role: "assistant", text: "", thinking: "", thinkingOpen: false, status: "streaming", taskStartMs: Date.now() },
      ]);
      setPrompt("");
      setAttachments([]);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  /** Turns pasted/dropped image files into composer attachments (validated). */
  async function addImageFiles(files: File[]) {
    let added = 0;
    for (const file of files) {
      if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
        setError(`${t("attachUnsupported")}: ${file.name}`);
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setError(`${t("attachTooLarge")}: ${file.name}`);
        continue;
      }
      if (attachments.length + added >= MAX_ATTACHMENTS) {
        setError(t("attachTooMany"));
        break;
      }
      const data = arrayBufferToBase64(await file.arrayBuffer());
      setAttachments(items => [...items, { id: `att-${Date.now()}-${Math.random().toString(36).slice(2)}`, name: file.name, mediaType: file.type, data }]);
      added += 1;
    }
  }

  function handleComposerPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length === 0) return; // plain-text paste falls through untouched
    event.preventDefault();
    void addImageFiles(files);
  }

  function handleChatPanelDrop(event: React.DragEvent<HTMLElement>) {
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    void addImageFiles(files);
  }

  function handleChatPanelDragOver(event: React.DragEvent<HTMLElement>) {
    if (Array.from(event.dataTransfer?.types ?? []).includes("Files")) event.preventDefault();
  }

  async function stopTask() {
    if (!taskId) return;
    setStatus("stopping");
    await window.hancode.stopTask(taskId);
  }

  async function newConversation() {
    setError("");
    try {
      const info = await window.hancode.clearSession() as WorkspaceInfo;
      setWorkspaceInfo(info);
      setMessages([]);
      setTools([]);
      setSubAgents([]);
      setTaskUsage(emptyUsage);
      setSessionUsage(emptyUsage);
      setTaskId(null);
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function answerConfirmation(allowed: boolean) {
    if (!confirmation) return;
    await window.hancode.respondConfirmation(confirmation.confirmationId, allowed);
    setConfirmation(null);
  }

  /** Builds a settings draft from the raw config object. */
  function draftFromConfig(config: Record<string, unknown>): ConfigDraft {
    const vision = config.vision as { model?: unknown; baseURL?: unknown; apiKey?: unknown } | undefined;
    return {
      apiKey: typeof config.apiKey === "string" ? config.apiKey : "",
      model: typeof config.model === "string" ? config.model : "",
      baseURL: typeof config.baseURL === "string" ? config.baseURL : "",
      maxTurns: typeof config.maxTurns === "number" ? String(config.maxTurns) : "",
      effort: typeof config.effort === "string" ? config.effort : "auto",
      thinkingMode: typeof config.thinkingMode === "string" ? config.thinkingMode : "auto",
      webEnabled: Boolean((config.web as { enabled?: boolean } | undefined)?.enabled),
      visionModel: typeof vision?.model === "string" ? vision.model : "",
      visionBaseURL: typeof vision?.baseURL === "string" ? vision.baseURL : "",
      visionApiKey: typeof vision?.apiKey === "string" ? vision.apiKey : "",
    };
  }

  /** Merges the edited draft into the raw config object (preserving unknown fields). */
  function buildNextConfig(config: Record<string, unknown>, draft: ConfigDraft): Record<string, unknown> {
    const next = { ...config };
    if (draft.apiKey.trim()) next.apiKey = draft.apiKey.trim();
    else delete next.apiKey;
    if (draft.model.trim()) next.model = draft.model.trim();
    else delete next.model;
    if (draft.baseURL.trim()) next.baseURL = draft.baseURL.trim();
    else delete next.baseURL;
    const maxTurns = Number(draft.maxTurns);
    if (draft.maxTurns.trim() !== "" && Number.isInteger(maxTurns) && maxTurns > 0) next.maxTurns = maxTurns;
    else delete next.maxTurns;
    if (draft.effort !== "auto") next.effort = draft.effort;
    else delete next.effort;
    if (draft.thinkingMode !== "auto") next.thinkingMode = draft.thinkingMode;
    else delete next.thinkingMode;
    next.web = { ...(next.web as object | undefined), enabled: draft.webEnabled };
    // Vision section: an empty vision model removes routing entirely; blank
    // baseURL/apiKey keys are omitted so config.ts falls back to the main values.
    const visionModel = draft.visionModel.trim();
    if (visionModel) {
      const vision: Record<string, unknown> = { model: visionModel };
      if (draft.visionBaseURL.trim()) vision.baseURL = draft.visionBaseURL.trim();
      if (draft.visionApiKey.trim()) vision.apiKey = draft.visionApiKey.trim();
      next.vision = vision;
    } else {
      delete next.vision;
    }
    return next;
  }

  async function openSettings() {
    setSettingsError("");
    setProfileSaveAsOpen(false);
    setProfileSaveAsName("");
    try {
      const [{ path, config }, { profiles: list }] = await Promise.all([window.hancode.getConfig(), window.hancode.listProfiles()]);
      setSettingsPath(path);
      setSettingsDraft(draftFromConfig(config));
      setProfiles(list);
      setActiveProfile(list.find(profile => profile.active)?.name ?? "default");
      setSettingsOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveSettings() {
    if (!settingsDraft) return;
    setSettingsError("");
    try {
      const { path, config } = await window.hancode.getConfig();
      const next = buildNextConfig(config, settingsDraft);
      const result = await window.hancode.updateConfig(next);
      setSettingsPath(result.path);
      if (result.workspace) setWorkspaceInfo(result.workspace as WorkspaceInfo);
      // Keep the active profile file in sync with the main config.
      if (activeProfile !== "default") {
        const profileResult = await window.hancode.saveProfile(activeProfile, next);
        setProfiles(profileResult.profiles);
        if (profileResult.workspace) setWorkspaceInfo(profileResult.workspace as WorkspaceInfo);
      }
      setSettingsOpen(false);
    } catch (err) {
      setSettingsError(`${t("saveFailed")}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Activates another profile and refreshes the draft from the new config. */
  async function switchProfile(name: string) {
    if (name === activeProfile) return;
    setSettingsError("");
    try {
      const result = await window.hancode.activateProfile(name);
      setProfiles(result.profiles);
      setActiveProfile(name);
      setSettingsDraft(draftFromConfig(result.config));
      if (result.workspace) setWorkspaceInfo(result.workspace as WorkspaceInfo);
    } catch (err) {
      setSettingsError(`${t("saveFailed")}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Saves the currently edited draft as a new profile and switches to it. */
  async function saveAsProfile() {
    if (!settingsDraft) return;
    const name = profileSaveAsName.trim();
    if (!name) return;
    setSettingsError("");
    try {
      const { config } = await window.hancode.getConfig();
      const next = buildNextConfig(config, settingsDraft);
      await window.hancode.saveProfile(name, next);
      const result = await window.hancode.activateProfile(name);
      setProfiles(result.profiles);
      setActiveProfile(name);
      setSettingsDraft(draftFromConfig(result.config));
      if (result.workspace) setWorkspaceInfo(result.workspace as WorkspaceInfo);
      setProfileSaveAsName("");
      setProfileSaveAsOpen(false);
    } catch (err) {
      setSettingsError(`${t("saveFailed")}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Deletes the active (non-default) profile and falls back to "default". */
  async function removeProfile() {
    if (activeProfile === "default") return;
    setSettingsError("");
    try {
      const result = await window.hancode.deleteProfile(activeProfile);
      setProfiles(result.profiles);
      setActiveProfile("default");
    } catch (err) {
      setSettingsError(`${t("saveFailed")}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function handlePromptKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void startTask();
  }

  /** Append a stream delta to the per-task buffer, starting the flush timer. */
  function bufferDelta(taskId: string, kind: "text" | "thinking", text: string) {
    const pending = pendingDeltasRef.current.get(taskId) ?? { text: "", thinking: "" };
    pending[kind] += text;
    pendingDeltasRef.current.set(taskId, pending);
    if (flushTimerRef.current === null) {
      flushTimerRef.current = window.setTimeout(() => {
        flushTimerRef.current = null;
        flushDeltas();
      }, 80);
    }
  }

  /** Apply all buffered deltas in one state update per task. */
  function flushDeltas() {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const pending = pendingDeltasRef.current;
    if (pending.size === 0) return;
    pendingDeltasRef.current = new Map();
    for (const [taskId, { text, thinking }] of pending) {
      if (!text && !thinking) continue;
      updateAssistant(taskId, message => ({ ...message, text: message.text + text, thinking: message.thinking + thinking }));
    }
  }

  function handleAgentEvent(event: AgentEvent) {
    switch (event.type) {
      case "run.started":
        trackSubAgentStart(event.taskId);
        break;
      case "output.delta":
        bufferDelta(event.taskId, "text", event.text);
        break;
      case "thinking.delta":
        bufferDelta(event.taskId, "thinking", event.text);
        break;
      case "tool.started": {
        flushDeltas();
        const toolId = `${event.taskId}/${event.toolUseId}`;
        setTools(items => [...items, { id: toolId, taskId: event.taskId, toolUseId: event.toolUseId, name: event.name, input: event.input, status: "running" }]);
        break;
      }
      case "tool.finished":
        setTools(items => items.map(item => item.taskId === event.taskId && item.toolUseId === event.toolUseId ? { ...item, status: event.isError ? "failed" : "done", result: event.contentPreview } : item));
        break;
      case "confirmation.requested":
        setConfirmation({ confirmationId: event.confirmationId, request: event.request });
        break;
      case "usage.updated":
        setTaskUsage(event.taskUsage);
        setSessionUsage(event.sessionUsage);
        break;
      case "context.compacted":
        flushDeltas();
        setMessages(items => [
          ...items,
          // Attribute the divider to the main task (sub-agent taskIds carry a
          // "/sub" suffix that would break per-task folding).
          { id: `compacted-${event.taskId}-${items.length}`, taskId: event.taskId.split("/")[0], role: "system", kind: "compacted", removedMessages: event.removedMessages },
        ]);
        break;
      case "run.completed":
        trackSubAgentFinish(event.taskId, "done");
        finishTask(event.taskId, "done");
        break;
      case "run.refused":
      case "run.max_turns":
      case "run.stopped":
        trackSubAgentFinish(event.taskId, "stopped");
        finishTask(event.taskId, "stopped");
        break;
      case "run.error":
        trackSubAgentFinish(event.taskId, "error");
        finishTask(event.taskId, "error");
        setError(event.message);
        break;
    }
  }

  function trackSubAgentStart(taskId: string) {
    const subId = extractSubAgentId(taskId);
    if (!subId) return;
    setSubAgents(items => {
      if (items.some(item => item.taskId === taskId)) return items;
      return [...items, { taskId, subId, status: "running" }];
    });
  }

  function trackSubAgentFinish(taskId: string, status: SubAgentItem["status"]) {
    const subId = extractSubAgentId(taskId);
    if (!subId) return;
    setSubAgents(items => items.map(item => item.taskId === taskId ? { ...item, status } : item));
  }

  function extractSubAgentId(taskId: string): string | undefined {
    const index = taskId.indexOf("/");
    if (index < 0) return undefined;
    return taskId.slice(index + 1);
  }

  function updateAssistant(taskId: string, updater: (message: Extract<ConversationMessage, { role: "assistant" }>) => ConversationMessage) {
    setMessages(items => items.map(item => item.role === "assistant" && item.taskId === taskId ? updater(item) : item));
  }

  function finishTask(finishedTaskId: string, nextStatus: "done" | "error" | "stopped") {
    flushDeltas();
    updateAssistant(finishedTaskId, message => ({ ...message, status: nextStatus, taskEndMs: message.taskEndMs ?? Date.now() }));
    setStatus(nextStatus === "error" ? "error" : "idle");
    setTaskId(null);
  }

  const toggleThinking = useCallback((messageId: string) => {
    setMessages(items => items.map(item => item.role === "assistant" && item.id === messageId ? { ...item, thinkingOpen: !item.thinkingOpen } : item));
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="icon-button" onClick={() => void pickWorkspace()} title={t("pickWorkspace")} aria-label={t("pickWorkspace")}>
          <FolderIcon />
        </button>
        {workspaceInfo && <span className="workspace-dot" title={workspaceInfo.workspaceRoot} aria-hidden="true" />}
        <input
          className="workspace-input"
          value={workspacePath}
          onChange={event => setWorkspacePath(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter") void openWorkspace(); }}
          placeholder={t("selectWorkspace")}
          spellCheck={false}
          title={workspaceInfo?.workspaceRoot}
        />
        <select className="ghost-select" value={permissionMode} onChange={event => setPermissionMode(event.target.value as PermissionMode)} title={t("permission")} aria-label={t("permission")}>
          <option value="safe">{t("safeMode")}</option>
          <option value="normal">{t("normalMode")}</option>
          <option value="super">{t("superMode")}</option>
        </select>
        <select className="ghost-select" value={locale} onChange={event => setLocale(event.target.value as Locale)} title={t("language")} aria-label={t("language")}>
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
        <select className="ghost-select" value={theme} onChange={event => setTheme(event.target.value as Theme)} title={t("theme")} aria-label={t("theme")}>
          <option value="dark">{t("dark")}</option>
          <option value="light">{t("light")}</option>
        </select>
        <button
          className="icon-button"
          disabled={!workspacePath.trim() && !workspaceInfo?.workspaceRoot}
          onClick={() => void showWorkspaceInFolder()}
          title={t("openInExplorer")}
          aria-label={t("openInExplorer")}
        >
          <ExternalIcon />
        </button>
        <button
          className="icon-button"
          onClick={() => void openSettings()}
          title={t("settings")}
          aria-label={t("settings")}
        >
          <GearIcon />
        </button>
        <button
          className="icon-button"
          onClick={() => void openConfigFile()}
          title={t("editConfig")}
          aria-label={t("editConfig")}
        >
          <ConfigIcon />
        </button>
      </header>

      {permissionMode === "super" && <section className="warning-banner"><span className="warning-icon" aria-hidden="true">⚠</span>{t("superModeWarning")}</section>}

      {error && <section className="error-banner">{error}</section>}

      <section className={`main-grid ${sidePanelOpen ? "" : "collapsed"}`}>
        <section className="chat-panel" onDrop={handleChatPanelDrop} onDragOver={handleChatPanelDragOver}>
          <div className="conversation-box" ref={conversationBoxRef} onScroll={handleConversationScroll}>
            {messages.length === 0 && <span className="placeholder">{t("emptyChat")}</span>}
            {foldIndex > 0 && (
              <button className="history-fold-banner" onClick={() => setHistoryExpanded(true)}>
                {t("historyFolded").replace("{count}", String(foldIndex))}
              </button>
            )}
            {visibleMessages.map(message => <ConversationBubble key={message.id} message={message} t={t} onToggleThinking={toggleThinking} />)}
            <div ref={conversationEndRef} />
          </div>
          <div className="composer">
            {attachments.length > 0 && (
              <div className="attachment-strip">
                {attachments.map(attachment => (
                  <span key={attachment.id} className="attachment-chip" title={attachment.name}>
                    <img src={`data:${attachment.mediaType};base64,${attachment.data}`} alt={attachment.name} />
                    <button
                      className="attachment-remove"
                      onClick={() => setAttachments(items => items.filter(item => item.id !== attachment.id))}
                      title={t("removeAttachment")}
                      aria-label={t("removeAttachment")}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <span className="attachment-hint">{t("attachHint")}</span>
              </div>
            )}
            <textarea
              value={prompt}
              onChange={event => setPrompt(event.target.value)}
              onKeyDown={handlePromptKeyDown}
              onPaste={handleComposerPaste}
              placeholder={t("askPlaceholder")}
            />
            <div className="composer-footer">
              <span className="composer-meta">
                {workspaceInfo && `${workspaceInfo.model} · ${t("effort")} ${workspaceInfo.effort} · ${t("maxTurns")} ${workspaceInfo.maxTurns} · ${t("web")} ${workspaceInfo.webEnabled ? t("enabled") : t("disabled")}`}
              </span>
              <div className="composer-actions">
                <button className="primary" disabled={!canRun} onClick={() => void startTask()}>{t("run")}</button>
                <button disabled={status !== "running" || !taskId} onClick={() => void stopTask()}>{t("stop")}</button>
                <button
                  disabled={status === "running" || status === "stopping" || !workspaceInfo}
                  onClick={() => void newConversation()}
                >
                  {t("newChat")}
                </button>
              </div>
            </div>
          </div>
        </section>

        {sidePanelOpen ? (
          <aside className="side-panel">
            <button className="side-collapse-button" onClick={() => setSidePanelOpen(false)} title={t("sidePanelCollapse")} aria-label={t("sidePanelCollapse")}>
              <ChevronRightIcon />
            </button>
            <UsageBar label={t("task")} usage={taskUsage} t={t} />
            <UsageBar label={t("session")} usage={sessionUsage} t={t} />

            <div className="usage-card">
              <strong>{t("subAgents")}</strong>
              <span>{subAgents.filter(a => a.status === "running").length} {t("runningSubAgents")}</span>
            </div>
            <div className="tool-list">
              {subAgents.length === 0 && <p className="placeholder">{t("noTools")}</p>}
              {subAgents.map(agent => (
                <article key={agent.taskId} className={`tool-card ${agent.status}`}>
                  <header>
                    <strong>{agent.subId}</strong>
                    <span>{agent.status}</span>
                  </header>
                </article>
              ))}
            </div>

            <h2 className="side-heading">{t("tools")}</h2>
            <div className="tool-list">
              {tools.length === 0 && <p className="placeholder">{t("noTools")}</p>}
              {tools.map(tool => <ToolCard key={tool.id} tool={tool} t={t} />)}
            </div>
          </aside>
        ) : (
          <aside className="side-rail">
            <button className="icon-button" onClick={() => setSidePanelOpen(true)} title={t("sidePanelExpand")} aria-label={t("sidePanelExpand")}>
              <ChevronLeftIcon />
            </button>
          </aside>
        )}
      </section>

      {confirmation && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-scroll">
              <h2>{confirmation.request.title}</h2>
              <p>{confirmation.request.message}</p>
              {confirmation.request.commandText && <pre>{confirmation.request.commandText}</pre>}
              {confirmation.request.command && <pre>{confirmation.request.command.join(" ")}</pre>}
            </div>
            <div className="modal-actions">
              <button onClick={() => void answerConfirmation(false)}>{t("deny")}</button>
              <button className="primary" onClick={() => void answerConfirmation(true)}>{t("allow")}</button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && settingsDraft && (
        <div className="modal-backdrop">
          <div className="modal settings-modal">
            <div className="modal-scroll">
              <h2>{t("settingsTitle")}</h2>
              <label className="settings-field">
                <span>{t("profileSection")}</span>
                <div className="profile-row">
                  <select
                    className="settings-select"
                    value={activeProfile}
                    onChange={event => void switchProfile(event.target.value)}
                  >
                    {profiles.map(profile => (
                      <option key={profile.name} value={profile.name}>
                        {profile.name === "default" ? t("profileDefault") : profile.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={() => setProfileSaveAsOpen(open => !open)}>{t("profileSaveAs")}</button>
                  <button type="button" disabled={activeProfile === "default"} onClick={() => void removeProfile()}>{t("profileDelete")}</button>
                </div>
                {profileSaveAsOpen && (
                  <div className="profile-row">
                    <input
                      value={profileSaveAsName}
                      onChange={event => setProfileSaveAsName(event.target.value)}
                      placeholder={t("profileSaveAsPlaceholder")}
                      spellCheck={false}
                    />
                    <button type="button" className="primary" disabled={!profileSaveAsName.trim()} onClick={() => void saveAsProfile()}>
                      {t("profileSaveAsConfirm")}
                    </button>
                  </div>
                )}
              </label>
              <label className="settings-field">
                <span>{t("apiKey")}</span>
                <input
                  type="password"
                  value={settingsDraft.apiKey}
                  onChange={event => setSettingsDraft({ ...settingsDraft, apiKey: event.target.value })}
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              <label className="settings-field">
                <span>{t("modelLabel")}</span>
                <input
                  value={settingsDraft.model}
                  onChange={event => setSettingsDraft({ ...settingsDraft, model: event.target.value })}
                  placeholder="claude-opus-4-8"
                  spellCheck={false}
                />
              </label>
              <label className="settings-field">
                <span>{t("visionModel")}</span>
                <input
                  value={settingsDraft.visionModel}
                  onChange={event => setSettingsDraft({ ...settingsDraft, visionModel: event.target.value })}
                  placeholder="doubao-seed-2.1-pro"
                  spellCheck={false}
                />
              </label>
              <label className="settings-field">
                <span>{t("visionBaseURL")}</span>
                <input
                  value={settingsDraft.visionBaseURL}
                  onChange={event => setSettingsDraft({ ...settingsDraft, visionBaseURL: event.target.value })}
                  placeholder="https://api.anthropic.com"
                  spellCheck={false}
                />
              </label>
              <label className="settings-field">
                <span>{t("visionApiKey")}</span>
                <input
                  type="password"
                  value={settingsDraft.visionApiKey}
                  onChange={event => setSettingsDraft({ ...settingsDraft, visionApiKey: event.target.value })}
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              <p className="settings-hint">{t("visionHint")}</p>
              <label className="settings-field">
                <span>{t("baseURL")}</span>
                <input
                  value={settingsDraft.baseURL}
                  onChange={event => setSettingsDraft({ ...settingsDraft, baseURL: event.target.value })}
                  placeholder="https://api.anthropic.com"
                  spellCheck={false}
                />
              </label>
              <label className="settings-field">
                <span>{t("maxTurns")}</span>
                <input
                  type="number"
                  min={1}
                  value={settingsDraft.maxTurns}
                  onChange={event => setSettingsDraft({ ...settingsDraft, maxTurns: event.target.value })}
                  placeholder="100"
                />
              </label>
              <label className="settings-field">
                <span>{t("effort")}</span>
                <select
                  className="settings-select"
                  value={settingsDraft.effort}
                  onChange={event => setSettingsDraft({ ...settingsDraft, effort: event.target.value })}
                >
                  <option value="auto">auto</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="xhigh">xhigh</option>
                  <option value="max">max</option>
                </select>
              </label>
              <label className="settings-field">
                <span>{t("thinkingMode")}</span>
                <select
                  className="settings-select"
                  value={settingsDraft.thinkingMode}
                  onChange={event => setSettingsDraft({ ...settingsDraft, thinkingMode: event.target.value })}
                >
                  <option value="auto">auto</option>
                  <option value="adaptive">adaptive</option>
                  <option value="budget">budget</option>
                </select>
              </label>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={settingsDraft.webEnabled}
                  onChange={event => setSettingsDraft({ ...settingsDraft, webEnabled: event.target.checked })}
                />
                <span>{t("webToggle")}</span>
              </label>
              {settingsError && <p className="settings-error">{settingsError}</p>}
              {settingsPath && <p className="settings-path">{t("configFile")}: {settingsPath}</p>}
            </div>
            <div className="modal-actions">
              <button onClick={() => setSettingsOpen(false)}>{t("cancel")}</button>
              <button className="primary" onClick={() => void saveSettings()}>{t("save")}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

type AssistantMessage = Extract<ConversationMessage, { role: "assistant" }>;

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(Math.floor(ms / 100) / 10).toFixed(1)}s`;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

const ConversationBubble = memo(function ConversationBubble({ message, t, onToggleThinking }: { message: ConversationMessage; t: (key: keyof typeof dictionary.en) => string; onToggleThinking: (id: string) => void }) {
  if (message.role === "system") {
    const text = message.removedMessages !== undefined
      ? t("contextCompacted").replace("{count}", String(message.removedMessages))
      : t("contextCompactedNoCount");
    return <div className="context-divider">{text}</div>;
  }
  if (message.role === "user") {
    return (
      <article className="message-bubble user">
        {message.text && <div>{message.text}</div>}
        {message.images && message.images.length > 0 && (
          <div className="bubble-images">
            {message.images.map((url, index) => <img key={index} src={url} alt="" />)}
          </div>
        )}
      </article>
    );
  }
  return <AssistantBubble message={message} t={t} onToggleThinking={onToggleThinking} />;
});

function AssistantBubble({ message, t, onToggleThinking }: { message: AssistantMessage; t: (key: keyof typeof dictionary.en) => string; onToggleThinking: (id: string) => void }) {
  const streaming = message.status === "streaming";
  const [, tick] = useState(0);
  useEffect(() => {
    if (!streaming) return;
    const id = setInterval(() => tick(n => n + 1), 200);
    return () => clearInterval(id);
  }, [streaming]);

  const startMs = message.taskStartMs ?? Date.now();
  const elapsedMs = (message.taskEndMs ?? Date.now()) - startMs;

  return (
    <article className={`message-bubble assistant ${message.status}`}>
      {message.thinking && (
        <section className="thinking-panel">
          <button className="thinking-toggle" onClick={() => onToggleThinking(message.id)}>
            {message.thinkingOpen ? "▾" : "▸"} {t("thinkingSummary")} <span className="thinking-duration">({formatDuration(elapsedMs)})</span>
          </button>
          {message.thinkingOpen && <pre>{message.thinking}</pre>}
        </section>
      )}
      <MarkdownContent text={message.text || "…"} highlight={!streaming} />
    </article>
  );
}

const MarkdownContent = memo(function MarkdownContent({ text, highlight = true }: { text: string; highlight?: boolean }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        rehypePlugins={highlight ? [rehypeHighlight] : []}
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
});

function handleMarkdownLinkClick(event: React.MouseEvent<HTMLAnchorElement>, href: string | undefined): void {
  if (!href) return;
  event.preventDefault();
  void window.hancode.openExternal(href);
}

function FolderIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M1.5 3.75c0-.69.56-1.25 1.25-1.25h3.03l1.5 2h6.47c.69 0 1.25.56 1.25 1.25v6.5c0 .69-.56 1.25-1.25 1.25h-11A1.25 1.25 0 0 1 1.5 12.25v-8.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6.5 3H3.75C2.78 3 2 3.78 2 4.75v7.5c0 .97.78 1.75 1.75 1.75h7.5c.97 0 1.75-.78 1.75-1.75V9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M9.5 2.5H14V7M13.75 2.75 8 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M10 3 5.5 8l4.5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 3l4.5 5L6 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ConfigIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 1.5h5.2L13.5 5.8V13a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 13V3A1.5 1.5 0 0 1 4 1.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M9 1.7V6h4.3" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M5.5 8.5h5M5.5 11h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
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
