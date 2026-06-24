import type Anthropic from "@anthropic-ai/sdk";
import type { ToolContext, ToolExecutionResult } from "../agent/types";
import { errorToMessage } from "../utils/errors";
import { bashTool } from "./bash";
import { editFileTool } from "./editFile";
import { listFilesTool } from "./listFiles";
import { readFileTool } from "./readFile";
import { runCommandTool } from "./runCommand";
import { searchTextTool } from "./searchText";
import { writeFileTool } from "./writeFile";

const tools = [readFileTool, listFilesTool, searchTextTool, editFileTool, writeFileTool, runCommandTool, bashTool];

export const toolDefinitions: Anthropic.Tool[] = tools.map(tool => tool.definition);

export async function executeTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolExecutionResult> {
  const tool = tools.find(candidate => candidate.definition.name === name);
  if (!tool) return { content: `Unknown tool: ${name}`, isError: true };

  try {
    return await tool.execute(input, ctx);
  } catch (error) {
    return { content: errorToMessage(error), isError: true };
  }
}
