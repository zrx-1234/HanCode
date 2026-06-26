import type Anthropic from "@anthropic-ai/sdk";
import type { WebConfig } from "../config";
import type { ToolContext, ToolExecutionResult } from "../agent/types";
import { errorToMessage } from "../utils/errors";
import { bashTool } from "./bash";
import { editFileTool } from "./editFile";
import { listFilesTool } from "./listFiles";
import { readFileTool } from "./readFile";
import { runCommandTool } from "./runCommand";
import { searchTextTool } from "./searchText";
import { webFetchTool } from "./webFetch";
import { webSearchTool } from "./webSearch";
import { writeFileTool } from "./writeFile";

const baseTools = [readFileTool, listFilesTool, searchTextTool, editFileTool, writeFileTool, runCommandTool, bashTool];
const webTools = [webSearchTool, webFetchTool];

export function getTools(web: WebConfig) {
  return web.enabled ? [...baseTools, ...webTools] : baseTools;
}

export function getToolDefinitions(web: WebConfig): Anthropic.Tool[] {
  return getTools(web).map(tool => tool.definition);
}

export async function executeTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolExecutionResult> {
  const tool = getTools(ctx.web).find(candidate => candidate.definition.name === name);
  if (!tool) return { content: `Unknown or disabled tool: ${name}`, isError: true };

  try {
    return await tool.execute(input, ctx);
  } catch (error) {
    return { content: errorToMessage(error), isError: true };
  }
}
