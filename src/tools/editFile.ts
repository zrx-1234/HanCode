import { readFile, stat } from "node:fs/promises";
import type { HanCodeTool } from "../agent/types";
import { resolveWorkspacePath } from "../security/paths";
import { atomicWriteFile, sha256 } from "../utils/fs";
import { normalizeInsertedLineEndings } from "../utils/text";
import { editFileInput } from "./schemas";

export const editFileTool: HanCodeTool = {
  definition: {
    name: "edit_file",
    description: "Perform one exact string replacement in an existing workspace file. Requires read_file first and old_text must match exactly once.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string", description: "Workspace-relative file path." },
        old_text: { type: "string", description: "Exact existing text to replace. Must be unique." },
        new_text: { type: "string", description: "Replacement text." },
      },
      required: ["path", "old_text", "new_text"],
    },
  },
  async execute(input, ctx) {
    const parsed = editFileInput.parse(input);
    if (parsed.old_text === parsed.new_text) throw new Error("old_text and new_text are identical.");

    const resolved = await resolveWorkspacePath(ctx.workspaceRoot, parsed.path, { mustExist: true, forWrite: true });
    const prior = ctx.readState.get(resolved.absolutePath);
    if (!prior?.fullyRead) throw new Error("Refusing edit: call read_file on the full file first.");

    const content = await readFile(resolved.absolutePath, "utf8");
    const s = await stat(resolved.absolutePath);
    if (prior.mtimeMs !== s.mtimeMs || prior.sha256 !== sha256(content)) {
      throw new Error("Refusing stale edit: file changed since it was read. Call read_file again.");
    }

    const occurrences = content.split(parsed.old_text).length - 1;
    if (occurrences === 0) throw new Error("old_text not found.");
    if (occurrences > 1) throw new Error("old_text is not unique; include more surrounding context.");

    const newText = normalizeInsertedLineEndings(content, parsed.new_text);
    const updated = content.replace(parsed.old_text, newText);
    await atomicWriteFile(resolved.absolutePath, updated);
    const after = await stat(resolved.absolutePath);
    ctx.readState.set(resolved.absolutePath, {
      relativePath: resolved.relativePath,
      mtimeMs: after.mtimeMs,
      sha256: sha256(updated),
      fullyRead: true,
    });

    return { content: `Edited ${resolved.relativePath}: replaced 1 occurrence.` };
  },
};
