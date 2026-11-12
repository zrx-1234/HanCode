import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import type { HanCodeTool } from "../agent/types";
import { buildImageContentBlocks, extToMediaType } from "./images";
import { limitOutput } from "../security/outputLimit";
import { isDirectory, resolveWorkspacePath } from "../security/paths";
import { sha256 } from "../utils/fs";
import { withLineNumbers } from "../utils/text";
import { readFileInput } from "./schemas";

const MAX_READ_BYTES = 1_000_000;
const MAX_OUTPUT_CHARS = 60_000;

export const readFileTool: HanCodeTool = {
  definition: {
    name: "read_file",
    description:
      "Read a UTF-8 text file inside the fixed workspace. Call this before editing a file. " +
      "Image files (png/jpg/jpeg/webp/gif) are returned as image content blocks so the model can see them.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string", description: "Workspace-relative file path." },
        offset: { type: "integer", description: "Optional zero-based line offset." },
        limit: { type: "integer", description: "Optional maximum number of lines to return." },
      },
      required: ["path"],
    },
  },
  async execute(input, ctx) {
    const parsed = readFileInput.parse(input);
    const resolved = await resolveWorkspacePath(ctx.workspaceRoot, parsed.path, { mustExist: true });
    if (await isDirectory(resolved.absolutePath)) throw new Error("read_file cannot read a directory.");

    const s = await stat(resolved.absolutePath);
    const mediaType = extToMediaType(extname(resolved.absolutePath));
    if (mediaType) {
      // Images are returned as image blocks; line offsets make no sense for binary data,
      // and readState is skipped because edit_file works on utf8 text only.
      if (parsed.offset !== undefined || parsed.limit !== undefined) {
        throw new Error("offset/limit are not supported for image files.");
      }
      const bytes = await readFile(resolved.absolutePath);
      return {
        content: buildImageContentBlocks({
          label: `Image file ${resolved.relativePath} (${s.size} bytes, ${mediaType}).`,
          bytes,
          mediaType,
        }),
      };
    }

    if (s.size > MAX_READ_BYTES && parsed.offset === undefined) {
      throw new Error(`File is too large (${s.size} bytes). Use offset/limit or a narrower file.`);
    }

    const content = await readFile(resolved.absolutePath, "utf8");
    const lines = content.split(/\r?\n/);
    const offset = parsed.offset ?? 0;
    const selected = lines.slice(offset, parsed.limit ? offset + parsed.limit : undefined).join("\n");
    const fullyRead = offset === 0 && (parsed.limit === undefined || parsed.limit >= lines.length);

    if (fullyRead) {
      ctx.readState.set(resolved.absolutePath, {
        relativePath: resolved.relativePath,
        mtimeMs: s.mtimeMs,
        sha256: sha256(content),
        fullyRead: true,
      });
    }

    return {
      content: limitOutput(withLineNumbers(selected, offset), MAX_OUTPUT_CHARS),
    };
  },
};
