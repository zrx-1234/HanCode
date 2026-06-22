import { stat } from "node:fs/promises";
import type { HanCodeTool } from "../agent/types";
import { resolveWorkspacePath } from "../security/paths";
import { atomicWriteFile, sha256 } from "../utils/fs";
import { writeFileInput } from "./schemas";

const MAX_WRITE_CHARS = 2_000_000;

export const writeFileTool: HanCodeTool = {
  definition: {
    name: "write_file",
    description: "Write a UTF-8 file inside the workspace. Defaults to creating new files; set overwrite true to replace an existing file.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string", description: "Workspace-relative file path." },
        content: { type: "string", description: "Full file content." },
        overwrite: { type: "boolean", description: "Whether to overwrite an existing file. Defaults to false." },
      },
      required: ["path", "content"],
    },
  },
  async execute(input, ctx) {
    const parsed = writeFileInput.parse(input);
    if (parsed.content.length > MAX_WRITE_CHARS) throw new Error(`Content too large (${parsed.content.length} chars).`);
    const resolved = await resolveWorkspacePath(ctx.workspaceRoot, parsed.path, { forWrite: true });
    const exists = await stat(resolved.absolutePath).then(() => true).catch(() => false);
    if (exists && !parsed.overwrite) throw new Error("File already exists. Set overwrite=true to replace it.");

    await atomicWriteFile(resolved.absolutePath, parsed.content);
    const s = await stat(resolved.absolutePath);
    ctx.readState.set(resolved.absolutePath, {
      relativePath: resolved.relativePath,
      mtimeMs: s.mtimeMs,
      sha256: sha256(parsed.content),
      fullyRead: true,
    });
    return { content: `${exists ? "Overwrote" : "Created"} ${resolved.relativePath} (${Buffer.byteLength(parsed.content, "utf8")} bytes).` };
  },
};
