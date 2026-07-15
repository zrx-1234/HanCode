import type { HanCodeTool, SubAgentResult, ToolContext } from "../agent/types";
import { agentToolInput } from "./schemas";

export const AGENT_TOOL_NAME = "agent";

export const agentTool: HanCodeTool = {
  definition: {
    name: AGENT_TOOL_NAME,
    description: "Spawn one or more sub-agents to work on independent sub-tasks concurrently. Each sub-agent receives a self-contained prompt and returns its result. Sub-agents cannot spawn further sub-agents.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        agents: {
          type: "array",
          description: "List of independent sub-agents to run in parallel. The main agent decides how many to spawn based on the task.",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string", description: "Optional identifier for this sub-agent, used to map results back to sub-tasks." },
              prompt: { type: "string", description: "Self-contained task description for the sub-agent." },
              max_turns: { type: "integer", description: "Optional per-sub-agent turn limit. Defaults to the parent run's limit." },
              effort: { type: "string", enum: ["auto", "low", "medium", "high", "xhigh", "max"], description: "Optional output effort override." },
              model: { type: "string", description: "Optional model override for this sub-agent." },
            },
            required: ["prompt"],
          },
        },
      },
      required: ["agents"],
    },
  },
  async execute(input, ctx: ToolContext) {
    const parsed = agentToolInput.parse(input);
    const runSubAgent = ctx.runSubAgent;
    if (!runSubAgent) {
      return { content: "Sub-agent spawning is not available in this context.", isError: true };
    }

    const settled = await Promise.allSettled(
      parsed.agents.map(async agentConfig => {
        const result = await runSubAgent(agentConfig);
        return result;
      }),
    );

    const results: SubAgentResult[] = settled.map(item =>
      item.status === "fulfilled"
        ? item.value
        : {
            id: "unknown",
            success: false,
            error: item.reason instanceof Error ? item.reason.message : String(item.reason),
            usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
          },
    );

    const allFailed = results.every(r => !r.success);
    const content = formatResults(results);
    return { content, isError: allFailed };
  },
};

function formatResults(results: SubAgentResult[]): string {
  const lines = [`Completed ${results.length} sub-agent(s):`, ""];
  for (const result of results) {
    lines.push(`--- ${result.id} ---`);
    if (result.success && result.output !== undefined) {
      lines.push(result.output);
    } else {
      lines.push(result.error ?? "No output returned.");
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}
