import Anthropic from "@anthropic-ai/sdk";
import type { ToolResultBlockParam, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages/messages";
import type { EffortConfig, WebConfig } from "../config";
import { JsonlAuditLogger } from "../security/auditLog";
import { confirmInTerminal } from "../security/confirmation";
import { executeTool, getToolDefinitions } from "../tools/index";
import { renderRunning, renderToolEnd, renderToolStart, renderUsageSummary } from "./render";
import { addUsage, createUsageTotals } from "./usage";
import { createAgentSession } from "./types";
import type { AgentSession, ConfirmationRequest, ToolContext } from "./types";

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
  signal?: AbortSignal;
  session?: AgentSession;
  confirm?: (request: ConfirmationRequest) => Promise<boolean>;
};

export async function runAgent(options: RunAgentOptions): Promise<void> {
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

  const ctx: ToolContext = {
    workspaceRoot: options.workspaceRoot,
    readState: session.readState,
    confirm: options.confirm ?? confirmInTerminal,
    audit: new JsonlAuditLogger(options.workspaceRoot),
    signal,
    web: options.web,
  };

  messages.push({ role: "user", content: options.prompt });

  let running: ReturnType<typeof renderRunning> | undefined;
  const stopRunning = (): void => {
    running?.stop();
    running = undefined;
  };

  try {
    for (let turn = 0; turn < options.maxTurns; turn++) {
      if (!softLimitWarningSent && turn >= Math.floor(options.maxTurns * 0.8)) {
        messages.push({
          role: "user",
          content: "[HanCode system reminder] You are near the tool-turn limit. Do not call more tools unless strictly necessary. If you have enough information, provide the final answer now.",
        });
        softLimitWarningSent = true;
      }

      running = renderRunning();
      const stream = client.messages.stream({
        model: options.model,
        max_tokens: 64_000,
        thinking: { type: "adaptive" },
        output_config: options.effort === "auto" ? undefined : { effort: options.effort },
        system: options.system,
        tools: getToolDefinitions(options.web),
        messages,
      }, { signal });

      stream.on("text", delta => {
        stopRunning();
        process.stdout.write(delta);
      });
      const message = await stream.finalMessage();
      stopRunning();
      addUsage(runUsage, message.usage);
      addUsage(session.usage, message.usage);
      messages.push({ role: "assistant", content: message.content });

      if (message.stop_reason === "refusal") {
        renderUsageSummary(runUsage, session.usage);
        return;
      }

      const toolUses = message.content.filter((block): block is ToolUseBlock => block.type === "tool_use");
      if (toolUses.length === 0) {
        renderUsageSummary(runUsage, session.usage);
        return;
      }

      const toolResults: ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        const signature = toolCallSignature(toolUse);
        const repeatedCount = recentToolCallSignatures.filter(item => item === signature).length;
        rememberToolCall(recentToolCallSignatures, signature);

        if (repeatedCount >= REPEATED_TOOL_CALL_LIMIT) {
          const content = "Repeated tool call refused: this exact tool call was already executed recently. Use the previous result already in context, choose a genuinely different necessary tool call, or provide the final answer now.";
          renderToolStart(toolUse.name, toolUse.input);
          renderToolEnd(toolUse.name, true, content);
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content,
            is_error: true,
          });
          continue;
        }

        renderToolStart(toolUse.name, toolUse.input);
        const result = await executeTool(toolUse.name, toolUse.input, ctx);
        renderToolEnd(toolUse.name, Boolean(result.isError), result.content);
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result.content,
          is_error: result.isError,
        });
      }

      messages.push({ role: "user", content: toolResults });
    }

    console.log(`\n[HanCode] Stopped after reaching max turns (${options.maxTurns}).`);
    renderUsageSummary(runUsage, session.usage);
  } catch (error) {
    stopRunning();
    if (messages.length === turnStart + 1) messages.splice(turnStart);
    throw error;
  }
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
