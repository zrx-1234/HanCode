import { describe, expect, test, mock } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeScreenshot, screenshotTool } from "../src/tools/screenshot";
import type { PermissionMode, ToolContext } from "../src/agent/types";
import { testWebConfig } from "./helpers";

// Minimal valid 1x1 PNG.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNAAQEAAAABIwD+V9twAAAABJRU5ErkJggg==",
  "base64",
);

function createContext(mode: PermissionMode, confirmResult: boolean): { ctx: ToolContext; confirm: ReturnType<typeof mock> } {
  const confirm = mock(async () => confirmResult);
  const ctx: ToolContext = {
    workspaceRoot: process.cwd(),
    readState: new Map(),
    confirm: confirm as unknown as ToolContext["confirm"],
    audit: { log: async () => undefined },
    signal: new AbortController().signal,
    web: testWebConfig,
    permissionMode: mode,
  };
  return { ctx, confirm };
}

async function writeTempPng(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hancode-shot-"));
  const path = join(root, "shot.png");
  await writeFile(path, PNG_1X1);
  return path;
}

describe("screenshot tool", () => {
  test("definition exposes no parameters", () => {
    expect(screenshotTool.definition.name).toBe("screenshot");
    expect(screenshotTool.definition.input_schema.required).toEqual([]);
  });

  test("returns image blocks and deletes the temp file", async () => {
    const pngPath = await writeTempPng();
    const capture = mock(async () => pngPath);
    const { ctx } = createContext("super", true);

    const result = await executeScreenshot({}, ctx, capture as unknown as () => Promise<string>);

    expect(result.isError).toBeUndefined();
    const blocks = result.content as unknown as Array<Record<string, unknown>>;
    expect(blocks.length).toBe(2);
    expect(blocks[0].type).toBe("text");
    const image = blocks[1] as { type: string; source: { type: string; media_type: string; data: string } };
    expect(image.type).toBe("image");
    expect(image.source.media_type).toBe("image/png");
    expect(image.source.data).toBe(PNG_1X1.toString("base64"));
    // The temp file is read into memory and removed right away.
    expect(existsSync(pngPath)).toBe(false);
  });

  test("asks for confirmation in normal mode and runs when allowed", async () => {
    const pngPath = await writeTempPng();
    const capture = mock(async () => pngPath);
    const { ctx, confirm } = createContext("normal", true);

    const result = await executeScreenshot({}, ctx, capture as unknown as () => Promise<string>);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeUndefined();
    expect(capture).toHaveBeenCalledTimes(1);
  });

  test("safe mode also asks for confirmation", async () => {
    const pngPath = await writeTempPng();
    const capture = mock(async () => pngPath);
    const { ctx, confirm } = createContext("safe", true);

    await executeScreenshot({}, ctx, capture as unknown as () => Promise<string>);

    expect(confirm).toHaveBeenCalledTimes(1);
  });

  test("super mode skips confirmation", async () => {
    const pngPath = await writeTempPng();
    const capture = mock(async () => pngPath);
    const { ctx, confirm } = createContext("super", true);

    await executeScreenshot({}, ctx, capture as unknown as () => Promise<string>);

    expect(confirm).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledTimes(1);
  });

  test("denied confirmation returns an error without capturing", async () => {
    const capture = mock(async () => {
      throw new Error("capture must not run");
    });
    const { ctx, confirm } = createContext("normal", false);

    const result = await executeScreenshot({}, ctx, capture as unknown as () => Promise<string>);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("denied by user");
    expect(capture).not.toHaveBeenCalled();
  });

  test("capture failure propagates as an error", async () => {
    const capture = mock(async () => {
      throw new Error("capture failed");
    });
    const { ctx } = createContext("super", true);

    await expect(executeScreenshot({}, ctx, capture as unknown as () => Promise<string>)).rejects.toThrow("capture failed");
  });

  test("rejects unexpected parameters", async () => {
    const { ctx } = createContext("super", true);

    const result = await executeScreenshot({ monitor: 1 }, ctx, async () => {
      throw new Error("capture must not run");
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("takes no parameters");
  });
});
