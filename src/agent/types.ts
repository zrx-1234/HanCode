import type Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages";
import type { WebConfig } from "../config";

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

export type ToolContext = {
  workspaceRoot: string;
  readState: Map<string, ReadState>;
  confirm: (request: ConfirmationRequest) => Promise<boolean>;
  audit: AuditLogger;
  signal: AbortSignal;
  web: WebConfig;
};

export type ToolExecutionResult = {
  content: string;
  isError?: boolean;
};

export type HanCodeTool = {
  definition: Anthropic.Tool;
  execute(input: unknown, ctx: ToolContext): Promise<ToolExecutionResult>;
};
