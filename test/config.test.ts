import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";

// loadConfig resolves hancode.config.json from HANCODE_CONFIG_DIR; point it at
// a fresh temp dir per test so real project config never leaks in.
let dir: string;
let prevConfigDir: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hancode-config-"));
  prevConfigDir = process.env.HANCODE_CONFIG_DIR;
  process.env.HANCODE_CONFIG_DIR = dir;
});

afterEach(() => {
  if (prevConfigDir === undefined) delete process.env.HANCODE_CONFIG_DIR;
  else process.env.HANCODE_CONFIG_DIR = prevConfigDir;
});

describe("loadConfig", () => {
  test("defaults when no config file exists", () => {
    const config = loadConfig(dir);
    expect(config.maxTurns).toBe(100);
    expect(config.effort).toBe("auto");
    expect(config.thinkingMode).toBe("auto");
    expect(config.baseURL).toBe("https://api.anthropic.com");
    expect(config.compactionThresholdTokens).toBe(100_000);
  });

  test("reads explicit values from the config file", async () => {
    await writeFile(join(dir, "hancode.config.json"), JSON.stringify({
      model: "glm-latest",
      baseURL: "https://ark.cn-beijing.volces.com/api/coding",
      maxTurns: 50,
      effort: "xhigh",
      thinkingMode: "budget",
    }), "utf8");
    const config = loadConfig(dir);
    expect(config.model).toBe("glm-latest");
    expect(config.maxTurns).toBe(50);
    expect(config.effort).toBe("xhigh");
    expect(config.thinkingMode).toBe("budget");
  });

  test("rejects an invalid thinkingMode", async () => {
    await writeFile(join(dir, "hancode.config.json"), JSON.stringify({ thinkingMode: "nope" }), "utf8");
    expect(() => loadConfig(dir)).toThrow("thinkingMode must be one of");
  });
});
