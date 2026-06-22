import type { HanCodeTool } from "../agent/types";
import { limitOutput } from "../security/outputLimit";
import { resolveWorkspacePath } from "../security/paths";
import { matchesGlob } from "../utils/glob";
import { walkFiles } from "../utils/walk";
import { listFilesInput } from "./schemas";

export const listFilesTool: HanCodeTool = {
  definition: {
    name: "list_files",
    description: "List files in the workspace using a glob-like pattern. Use this to discover relevant files before reading them.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string", description: "Workspace-relative directory to search from. Defaults to ." },
        pattern: { type: "string", description: "Glob pattern such as **/* or src/**/*.ts. Defaults to **/*." },
        max_results: { type: "integer", description: "Maximum number of files to return. Defaults to 200." },
      },
      required: [],
    },
  },
  async execute(input, ctx) {
    const parsed = listFilesInput.parse(input);
    const base = await resolveWorkspacePath(ctx.workspaceRoot, parsed.path ?? ".", { mustExist: true });
    const pattern = parsed.pattern ?? "**/*";
    const maxResults = parsed.max_results ?? 200;
    const results: string[] = [];

    for await (const file of walkFiles(ctx.workspaceRoot, base.absolutePath)) {
      if (matchesGlob(file.relativePath, pattern) || matchesGlob(file.relativePath.split("/").pop() ?? file.relativePath, pattern)) {
        results.push(file.relativePath);
        if (results.length >= maxResults) break;
      }
    }

    results.sort();
    const suffix = results.length >= maxResults ? `\n[truncated at ${maxResults} results]` : "";
    return { content: limitOutput(results.join("\n") + suffix) };
  },
};
