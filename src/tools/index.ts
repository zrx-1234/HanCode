import type Anthropic from "@anthropic-ai/sdk";
import type { WebConfig } from "../config";
import type { ToolContext, ToolExecutionResult } from "../agent/types";
import { errorToMessage } from "../utils/errors";
import { agentTool } from "./agent";
import { bashTool } from "./bash";
import { editFileTool } from "./editFile";
import { listFilesTool } from "./listFiles";
import { readFileTool } from "./readFile";
import { runCommandTool } from "./runCommand";
import { searchTextTool } from "./searchText";
import { webFetchTool } from "./webFetch";
import { webSearchTool } from "./webSearch";
import { writeFileTool } from "./writeFile";

const baseTools = [agentTool, readFileTool, listFilesTool, searchTextTool, editFileTool, writeFileTool, runCommandTool, bashTool];
const webTools = [webSearchTool, webFetchTool];

function filterByAllowedTools(tools: typeof baseTools, allowedTools?: string[]) {
  if (!allowedTools) return tools;
  const allowed = new Set(allowedTools);
  return tools.filter(tool => allowed.has(tool.definition.name));
}

export function getTools(web: WebConfig, allowedTools?: string[]) {
  const tools = web.enabled ? [...baseTools, ...webTools] : baseTools;
  return filterByAllowedTools(tools, allowedTools);
}

export function getAllToolNames(web: WebConfig): string[] {
  return getTools(web).map(tool => tool.definition.name);
}

export function getToolDefinitions(web: WebConfig, allowedTools?: string[]): Anthropic.Tool[] {
  return getTools(web, allowedTools).map(tool => tool.definition);
}

export async function executeTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolExecutionResult> {
  const tool = getTools(ctx.web, ctx.allowedTools).find(candidate => candidate.definition.name === name);
  if (!tool) return { content: `Unknown or disabled tool: ${name}`, isError: true };

  try {
    return await tool.execute(input, ctx);
  } catch (error) {
    return { content: errorToMessage(error), isError: true };
  }
}
