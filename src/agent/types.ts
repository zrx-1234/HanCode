import type Anthropic from "@anthropic-ai/sdk";

export type ReadState = {
  relativePath: string;
  mtimeMs: number;
  sha256: string;
  fullyRead: boolean;
};

export type ConfirmationRequest = {
  title: string;
  message: string;
  command?: string[];
};

export type AuditLogger = {
  log(entry: CommandAuditEntry): Promise<void>;
};

export type CommandAuditEntry = {
  time: string;
  command: string;
  args: string[];
  cwd: string;
  decision: "allow" | "confirm" | "refuse" | "deny";
  reason: string;
  exitCode?: number | null;
  durationMs?: number;
  timedOut?: boolean;
};

export type ToolContext = {
  workspaceRoot: string;
  readState: Map<string, ReadState>;
  confirm: (request: ConfirmationRequest) => Promise<boolean>;
  audit: AuditLogger;
  signal: AbortSignal;
};

export type ToolExecutionResult = {
  content: string;
  isError?: boolean;
};

export type HanCodeTool = {
  definition: Anthropic.Tool;
  execute(input: unknown, ctx: ToolContext): Promise<ToolExecutionResult>;
};
