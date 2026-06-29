import Anthropic from "@anthropic-ai/sdk";
import type { ToolResultBlockParam, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages/messages";
import type { EffortConfig, WebConfig } from "../config";
import { JsonlAuditLogger } from "../security/auditLog";
import { confirmInTerminal } from "../security/confirmation";
import { executeTool, getToolDefinitions } from "../tools/index";
import { addUsage, createUsageTotals } from "./usage";
import { createAgentSession } from "./types";
import type { AgentEvent, AgentEventSink, AgentSession, ConfirmationRequest, PermissionMode, ToolContext, UsageTotals } from "./types";

const RECENT_TOOL_CALL_WINDOW = 20;
const REPEATED_TOOL_CALL_LIMIT = 1;

export type RunAgentOptions = {
  prompt: string;
  workspaceRoot: string;
  apiKey: string;
  model: string;
  baseURL: string;
  maxTurns: number;
  effort: EffortConfig;
  web: WebConfig;
  system: string;
  taskId?: string;
  signal?: AbortSignal;
  session?: AgentSession;
  confirm?: (request: ConfirmationRequest) => Promise<boolean>;
  emit?: AgentEventSink;
  permissionMode?: PermissionMode;
};

export async function runAgent(options: RunAgentOptions): Promise<void> {
  const taskId = options.taskId ?? `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const client = new Anthropic({
    apiKey: options.apiKey || undefined,
    baseURL: options.baseURL,
  });
  const controller = new AbortController();
  const signal = options.signal ?? controller.signal;
  const session = options.session ?? createAgentSession();
  const messages = session.messages;
  const turnStart = messages.length;
  const runUsage = createUsageTotals();
  const recentToolCallSignatures: string[] = [];
  let softLimitWarningSent = false;
  let thinkingStarted = false;

  const ctx: ToolContext = {
    workspaceRoot: options.workspaceRoot,
    readState: session.readState,
    confirm: options.confirm ?? confirmInTerminal,
    audit: new JsonlAuditLogger(options.workspaceRoot),
    signal,
    web: options.web,
    permissionMode: options.permissionMode ?? "normal",
  };

  messages.push({ role: "user", content: options.prompt });
  await emit(options, { type: "run.started", taskId, workspaceRoot: options.workspaceRoot, model: options.model });

  try {
    for (let turn = 0; turn < options.maxTurns; turn++) {
      if (signal.aborted) {
        await emit(options, { type: "run.stopped", taskId });
        return;
      }

      if (!softLimitWarningSent && turn >= Math.floor(options.maxTurns * 0.8)) {
        messages.push({
          role: "user",
          content: "[HanCode system reminder] You are near the tool-turn limit. Do not call more tools unless strictly necessary. If you have enough information, provide the final answer now.",
        });
        softLimitWarningSent = true;
      }

      await emit(options, { type: "turn.started", taskId, turn: turn + 1 });
      const stream = client.messages.stream({
        model: options.model,
        max_tokens: 64_000,
        thinking: { type: "adaptive", display: "summarized" },
        output_config: options.effort === "auto" ? undefined : { effort: options.effort },
        system: options.system,
        tools: getToolDefinitions(options.web),
        messages,
      }, { signal });

      stream.on("text", delta => {
        void emit(options, { type: "output.delta", taskId, text: delta });
      });
      stream.on("thinking", delta => {
        if (!thinkingStarted) {
          thinkingStarted = true;
          void emit(options, { type: "thinking.started", taskId });
        }
        void emit(options, { type: "thinking.delta", taskId, text: delta });
      });
      const message = await stream.finalMessage();
      if (thinkingStarted) {
        thinkingStarted = false;
        await emit(options, { type: "thinking.finished", taskId });
      }
      addUsage(runUsage, message.usage);
      addUsage(session.usage, message.usage);
      messages.push({ role: "assistant", content: message.content });
      await emitUsage(options, taskId, runUsage, session.usage);

      if (message.stop_reason === "refusal") {
        await emit(options, { type: "run.refused", taskId });
        return;
      }

      const toolUses = message.content.filter((block): block is ToolUseBlock => block.type === "tool_use");
      if (toolUses.length === 0) {
        await emit(options, { type: "run.completed", taskId });
        return;
      }

      const toolResults: ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        const signature = toolCallSignature(toolUse);
        const repeatedCount = recentToolCallSignatures.filter(item => item === signature).length;
        rememberToolCall(recentToolCallSignatures, signature);

        if (repeatedCount >= REPEATED_TOOL_CALL_LIMIT) {
          const content = "Repeated tool call refused: this exact tool call was already executed recently. Use the previous result already in context, choose a genuinely different necessary tool call, or provide the final answer now.";
          await emit(options, { type: "tool.started", taskId, toolUseId: toolUse.id, name: toolUse.name, input: toolUse.input });
          await emit(options, { type: "tool.finished", taskId, toolUseId: toolUse.id, name: toolUse.name, isError: true, contentPreview: content });
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content,
            is_error: true,
          });
          continue;
        }

        await emit(options, { type: "tool.started", taskId, toolUseId: toolUse.id, name: toolUse.name, input: toolUse.input });
        const result = await executeTool(toolUse.name, toolUse.input, ctx);
        await emit(options, { type: "tool.finished", taskId, toolUseId: toolUse.id, name: toolUse.name, isError: Boolean(result.isError), contentPreview: preview(result.content) });
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result.content,
          is_error: result.isError,
        });
      }

      messages.push({ role: "user", content: toolResults });
    }

    await emit(options, { type: "run.max_turns", taskId, maxTurns: options.maxTurns });
  } catch (error) {
    if (signal.aborted) {
      await emit(options, { type: "run.stopped", taskId });
      return;
    }
    if (messages.length === turnStart + 1) messages.splice(turnStart);
    const message = error instanceof Error ? error.message : String(error);
    await emit(options, { type: "run.error", taskId, message });
    throw error;
  }
}

async function emit(options: RunAgentOptions, event: AgentEvent): Promise<void> {
  await options.emit?.(event);
}

async function emitUsage(options: RunAgentOptions, taskId: string, taskUsage: UsageTotals, sessionUsage: UsageTotals): Promise<void> {
  await emit(options, {
    type: "usage.updated",
    taskId,
    taskUsage: { ...taskUsage },
    sessionUsage: { ...sessionUsage },
  });
}

function preview(content: string, maxLength = 4_000): string {
  if (content.length <= maxLength) return content;
  return `${content.slice(0, maxLength)}\n\n[preview truncated]`;
}

function toolCallSignature(toolUse: ToolUseBlock): string {
  return `${toolUse.name}:${stableStringify(toolUse.input)}`;
}

function rememberToolCall(recentToolCallSignatures: string[], signature: string): void {
  recentToolCallSignatures.push(signature);
  if (recentToolCallSignatures.length > RECENT_TOOL_CALL_WINDOW) recentToolCallSignatures.shift();
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}
