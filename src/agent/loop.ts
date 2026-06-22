import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ToolResultBlockParam, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages/messages";
import { JsonlAuditLogger } from "../security/auditLog";
import { confirmInTerminal } from "../security/confirmation";
import { executeTool, toolDefinitions } from "../tools/index";
import { renderToolEnd, renderToolStart } from "./render";
import type { ReadState, ToolContext } from "./types";

export type RunAgentOptions = {
  prompt: string;
  workspaceRoot: string;
  apiKey: string;
  model: string;
  baseURL: string;
  maxTurns: number;
  system: string;
  signal?: AbortSignal;
};

export async function runAgent(options: RunAgentOptions): Promise<void> {
  const client = new Anthropic({
    apiKey: options.apiKey || undefined,
    baseURL: options.baseURL,
  });
  const controller = new AbortController();
  const signal = options.signal ?? controller.signal;
  const readState = new Map<string, ReadState>();
  const ctx: ToolContext = {
    workspaceRoot: options.workspaceRoot,
    readState,
    confirm: confirmInTerminal,
    audit: new JsonlAuditLogger(options.workspaceRoot),
    signal,
  };

  const messages: MessageParam[] = [{ role: "user", content: options.prompt }];

  for (let turn = 0; turn < options.maxTurns; turn++) {
    const stream = client.messages.stream({
      model: options.model,
      max_tokens: 64_000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: options.system,
      tools: toolDefinitions,
      messages,
    }, { signal });

    stream.on("text", delta => process.stdout.write(delta));
    const message = await stream.finalMessage();
    messages.push({ role: "assistant", content: message.content });

    if (message.stop_reason === "refusal") {
      console.log("\n[HanCode] Claude refused this request.");
      return;
    }

    const toolUses = message.content.filter((block): block is ToolUseBlock => block.type === "tool_use");
    if (toolUses.length === 0) {
      if (!process.stdout.write("\n")) await new Promise(resolve => process.stdout.once("drain", resolve));
      return;
    }

    const toolResults: ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      renderToolStart(toolUse.name, toolUse.input);
      const result = await executeTool(toolUse.name, toolUse.input, ctx);
      renderToolEnd(toolUse.name, Boolean(result.isError));
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
}
