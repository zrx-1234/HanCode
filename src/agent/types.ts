import type Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages";
import type { WebConfig } from "../config";
import type { SkillRegistry } from "../skills/registry";

export type ReadState = {
  relativePath: string;
  mtimeMs: number;
  sha256: string;
  fullyRead: boolean;
};

export type UsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
};

export type AgentSession = {
  messages: MessageParam[];
  readState: Map<string, ReadState>;
  usage: UsageTotals;
};

export function createAgentSession(): AgentSession {
  return {
    messages: [],
    readState: new Map(),
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
  };
}

export type ConfirmationRequest = {
  title: string;
  message: string;
  command?: string[];
  commandText?: string;
};

export type AuditLogger = {
  log(entry: CommandAuditEntry): Promise<void>;
};

export type CommandAuditEntry = {
  time: string;
  command: string;
  args: string[];
  commandText?: string;
  cwd: string;
  decision: "allow" | "confirm" | "refuse" | "deny";
  reason: string;
  warning?: string;
  exitCode?: number | null;
  durationMs?: number;
  timedOut?: boolean;
  stdoutBytes?: number;
  stderrBytes?: number;
  outputPath?: string;
};

export type AgentEvent =
  | { type: "run.started"; taskId: string; workspaceRoot: string; model: string }
  | { type: "turn.started"; taskId: string; turn: number }
  | { type: "thinking.started"; taskId: string }
  | { type: "thinking.delta"; taskId: string; text: string }
  | { type: "thinking.finished"; taskId: string }
  | { type: "output.delta"; taskId: string; text: string }
  | { type: "tool.started"; taskId: string; toolUseId: string; name: string; input: unknown }
  | { type: "tool.finished"; taskId: string; toolUseId: string; name: string; isError: boolean; contentPreview: string }
  | { type: "confirmation.requested"; taskId: string; confirmationId: string; request: ConfirmationRequest }
  | { type: "confirmation.resolved"; taskId: string; confirmationId: string; allowed: boolean }
  | { type: "usage.updated"; taskId: string; taskUsage: UsageTotals; sessionUsage: UsageTotals }
  | { type: "run.refused"; taskId: string }
  | { type: "run.max_turns"; taskId: string; maxTurns: number }
  | { type: "run.stopped"; taskId: string }
  | { type: "run.error"; taskId: string; message: string }
  | { type: "run.completed"; taskId: string };

export type AgentEventSink = (event: AgentEvent) => void | Promise<void>;

export type PermissionMode = "safe" | "normal" | "super";

export type SubAgentConfig = {
  id?: string;
  prompt: string;
  max_turns?: number;
  effort?: "auto" | "low" | "medium" | "high" | "xhigh" | "max";
  model?: string;
};

export type SubAgentResult = {
  id: string;
  success: boolean;
  output?: string;
  error?: string;
  usage: UsageTotals;
};

export type ToolContext = {
  workspaceRoot: string;
  readState: Map<string, ReadState>;
  confirm: (request: ConfirmationRequest) => Promise<boolean>;
  audit: AuditLogger;
  signal: AbortSignal;
  web: WebConfig;
  permissionMode: PermissionMode;
  /** If set, restricts which tools are visible/executable in this context. */
  allowedTools?: string[];
  /** Factory for spawning sub-agents. Present in normal runs; tests may omit. */
  runSubAgent?: (config: SubAgentConfig) => Promise<SubAgentResult>;
  /** Skill registry; lets the `skill` tool load bundled workflow guides. */
  skills?: SkillRegistry;
  /** External directories (e.g. bundled skill dirs) trusted for script execution. */
  trustedDirs?: string[];
};

export type ToolExecutionResult = {
  content: string;
  isError?: boolean;
};

export type HanCodeTool = {
  definition: Anthropic.Tool;
  execute(input: unknown, ctx: ToolContext): Promise<ToolExecutionResult>;
};
