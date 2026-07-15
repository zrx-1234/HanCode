import Anthropic from "@anthropic-ai/sdk";
import type { ToolResultBlockParam, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages/messages";
import type { EffortConfig, WebConfig } from "../config";
import { JsonlAuditLogger } from "../security/auditLog";
import { confirmInTerminal } from "../security/confirmation";
import { executeTool, getAllToolNames, getToolDefinitions } from "../tools/index";
import { addUsage, createUsageTotals, mergeUsage } from "./usage";
import { createAgentSession } from "./types";
import type { AgentEvent, AgentEventSink, AgentSession, ConfirmationRequest, PermissionMode, SubAgentConfig, SubAgentResult, ToolContext, UsageTotals } from "./types";

const RECENT_TOOL_CALL_WINDOW = 20;
const REPEATED_TOOL_CALL_LIMIT = 1;

/** Options for running an agent. */
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
  allowedTools?: string[];
};

/**
 * Core agent execution loop.
 *
 * High-level flow:
 * 1. Initialise the API client, session, message history, tool context, etc.
 * 2. Append the user prompt to the message list and emit "run.started".
 * 3. Enter a loop of at most `maxTurns` turns.
 * 4. Each turn:
 *    a. Check if the run was cancelled externally (`signal.aborted`).
 *    b. When we hit 80 % of the turn limit, inject a system reminder so the
 *       model knows to wrap up soon.
 *    c. Emit "turn.started" so the UI knows a new turn began.
 *    d. Stream a request to the Anthropic API, forwarding text and thinking
 *       deltas to the outside world in real time.
 *    e. Once the stream finishes, accumulate token usage for this run and the
 *       overall session.
 *    f. If the model refused to answer (`stop_reason === "refusal"`), end.
 *    g. If the response contains no `tool_use` blocks, the model gave a final
 *       answer — emit "run.completed" and return.
 *    h. Otherwise execute each requested tool:
 *       - Detect repeated identical tool calls inside a sliding window and
 *         reject them to prevent loops.
 *       - Call `executeTool()` to perform the actual work.
 *       - Collect every result as a `tool_result` block.
 *    i. Push all `tool_result` blocks back into the message history as a
 *       single `user` message so the model can reason over them next turn.
 * 5. If the loop exhausts `maxTurns` without finishing, emit "run.max_turns".
 * 6. Error handling: cancellation emits "run.stopped"; anything else emits
 *    "run.error" and re-throws.
 */
export async function runAgent(options: RunAgentOptions): Promise<void> {
  // Generate a unique task id when the caller didn't supply one.
  const taskId = options.taskId ?? `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // Set up the Anthropic API client.
  const client = new Anthropic({
    apiKey: options.apiKey || undefined,
    baseURL: options.baseURL,
  });

  // Cancellation: prefer the caller's signal, otherwise create our own.
  const controller = new AbortController();
  const signal = options.signal ?? controller.signal;

  // Re-use an existing session or create a fresh one, then grab its message history.
  const session = options.session ?? createAgentSession();
  const messages = session.messages;

  // Remember how many messages existed before this run so we can roll back on error.
  const turnStart = messages.length;

  // Token-usage counters for this run and for the whole session.
  const runUsage = createUsageTotals();

  // Sliding window of recent tool-call signatures used to detect duplicate calls.
  const recentToolCallSignatures: string[] = [];

  // Tracks whether we already warned the model that it is nearing the turn limit.
  let softLimitWarningSent = false;

  // Tracks whether we are currently receiving a thinking stream so we can emit
  // the "thinking.started" event exactly once per stream.
  let thinkingStarted = false;

  // Build the context object that every tool executor receives (workspace path,
  // confirmation callback, audit logger, abort signal, etc.).
  const allowedTools = options.allowedTools ?? getAllToolNames(options.web);
  const ctx: ToolContext = {
    workspaceRoot: options.workspaceRoot,
    readState: session.readState,
    confirm: options.confirm ?? confirmInTerminal,
    audit: new JsonlAuditLogger(options.workspaceRoot),
    signal,
    web: options.web,
    permissionMode: options.permissionMode ?? "normal",
    allowedTools,
    runSubAgent,
  };

  // Factory used by the agent tool to spawn concurrent sub-agents.
  async function runSubAgent(config: SubAgentConfig): Promise<SubAgentResult> {
    const subId = config.id ?? `sub-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const subTaskId = `${taskId}/${subId}`;
    const subSession: AgentSession = {
      messages: [...session.messages],
      readState: new Map(session.readState),
      usage: createUsageTotals(),
    };

    const outputParts: string[] = [];
    const subEmit: AgentEventSink = event => {
      if (event.type === "output.delta") outputParts.push(event.text);
      return options.emit?.(event);
    };

    const childController = new AbortController();
    const onParentAbort = () => childController.abort();
    if (signal.aborted) {
      childController.abort();
    } else {
      signal.addEventListener("abort", onParentAbort);
    }

    let completed = false;
    let errorMessage: string | undefined;

    try {
      await runAgent({
        prompt: config.prompt,
        workspaceRoot: options.workspaceRoot,
        apiKey: options.apiKey,
        model: config.model ?? options.model,
        baseURL: options.baseURL,
        maxTurns: config.max_turns ?? options.maxTurns,
        effort: config.effort ?? options.effort,
        web: options.web,
        system: options.system,
        taskId: subTaskId,
        signal: childController.signal,
        session: subSession,
        confirm: options.confirm ?? confirmInTerminal,
        emit: subEmit,
        permissionMode: options.permissionMode,
        allowedTools: allowedTools.filter(name => name !== "agent"),
      });
      completed = true;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      signal.removeEventListener("abort", onParentAbort);
      mergeUsage(session.usage, subSession.usage);
    }

    return {
      id: subId,
      success: completed,
      output: completed ? outputParts.join("") : undefined,
      error: completed ? undefined : errorMessage,
      usage: subSession.usage,
    };
  }

  // === Step 1: seed the conversation with the user prompt and notify observers. ===
  messages.push({ role: "user", content: options.prompt });
  await emit(options, { type: "run.started", taskId, workspaceRoot: options.workspaceRoot, model: options.model });

  try {
    // === Step 2: main turn loop (at most maxTurns iterations). ===
    for (let turn = 0; turn < options.maxTurns; turn++) {
      // 2a. Abort immediately if the caller cancelled the run.
      if (signal.aborted) {
        await emit(options, { type: "run.stopped", taskId });
        return;
      }

      // 2b. Nudge the model to start wrapping up once we pass 80 % of the budget.
      if (!softLimitWarningSent && turn >= Math.floor(options.maxTurns * 0.8)) {
        messages.push({
          role: "user",
          content: "[HanCode system reminder] You are near the tool-turn limit. Do not call more tools unless strictly necessary. If you have enough information, provide the final answer now.",
        });
        softLimitWarningSent = true;
      }

      // 2c. Let the UI know a new turn has started.
      await emit(options, { type: "turn.started", taskId, turn: turn + 1 });

      // 2d. Stream the next model response from the Anthropic API.
      const stream = client.messages.stream({
        model: options.model,
        max_tokens: 64_000,
        thinking: { type: "adaptive", display: "summarized" },
        output_config: options.effort === "auto" ? undefined : { effort: options.effort },
        system: options.system,
        tools: getToolDefinitions(options.web, options.allowedTools),
        messages,
      }, { signal });

      // Forward text deltas to observers as they arrive.
      stream.on("text", delta => {
        void emit(options, { type: "output.delta", taskId, text: delta });
      });

      // Forward thinking deltas to observers as they arrive.
      stream.on("thinking", delta => {
        if (!thinkingStarted) {
          thinkingStarted = true;
          void emit(options, { type: "thinking.started", taskId });
        }
        void emit(options, { type: "thinking.delta", taskId, text: delta });
      });

      // Wait for the stream to finish and obtain the complete Message object.
      const message = await stream.finalMessage();

      // Emit the matching "thinking.finished" if we previously emitted "thinking.started".
      if (thinkingStarted) {
        thinkingStarted = false;
        await emit(options, { type: "thinking.finished", taskId });
      }

      // 2e. Accumulate token usage for this run and the whole session.
      addUsage(runUsage, message.usage);
      addUsage(session.usage, message.usage);

      // Append the assistant's full response to the conversation history.
      messages.push({ role: "assistant", content: message.content });
      await emitUsage(options, taskId, runUsage, session.usage);

      // 2f. If the model refused to answer, stop the run right away.
      if (message.stop_reason === "refusal") {
        await emit(options, { type: "run.refused", taskId });
        return;
      }

      // 2g. Extract every tool_use block from the model's response.
      const toolUses = message.content.filter((block): block is ToolUseBlock => block.type === "tool_use");

      // No tools requested → the model provided a final answer.
      if (toolUses.length === 0) {
        await emit(options, { type: "run.completed", taskId });
        return;
      }

      // 2h. Execute each requested tool, collecting the results.
      const toolResults: ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        const signature = toolCallSignature(toolUse);

        // Check how many times this exact call appeared in the recent window.
        const repeatedCount = recentToolCallSignatures.filter(item => item === signature).length;
        rememberToolCall(recentToolCallSignatures, signature);

        // Reject the call if it exceeds the repeat limit; feed back an error result instead.
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

        // Normal path: actually run the tool.
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

      // 2i. Feed all tool results back into the conversation as a single user message.
      messages.push({ role: "user", content: toolResults });
    }

    // === Step 3: loop finished without returning → we hit the maxTurns cap. ===
    await emit(options, { type: "run.max_turns", taskId, maxTurns: options.maxTurns });
  } catch (error) {
    // === Step 4: error handling ===
    if (signal.aborted) {
      await emit(options, { type: "run.stopped", taskId });
      return;
    }
    // If the run produced no meaningful conversation, roll back the initial user prompt
    // so the history stays clean.
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
