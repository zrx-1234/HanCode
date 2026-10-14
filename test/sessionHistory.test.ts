import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages";
import {
  HISTORY_MAX_MESSAGES,
  clearSessionHistory,
  historyPath,
  loadSessionHistory,
  saveSessionHistory,
  sanitizeHistory,
} from "../src/sessionHistory";

async function tempWorkspace(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "hancode-history-"));
}

function textMessage(role: "user" | "assistant", text: string): MessageParam {
  return { role, content: text };
}

function toolExchange(): [MessageParam, MessageParam] {
  return [
    { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "a.ts" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }] },
  ];
}

describe("sessionHistory", () => {
  test("round-trips a plain conversation", async () => {
    const root = await tempWorkspace();
    const messages = [textMessage("user", "hello"), textMessage("assistant", "hi there")];

    saveSessionHistory(root, messages);
    const loaded = loadSessionHistory(root);

    expect(loaded).toEqual(messages);
    await rm(root, { recursive: true, force: true });
  });

  test("round-trips tool_use / tool_result blocks unchanged", async () => {
    const root = await tempWorkspace();
    const [toolUse, toolResult] = toolExchange();
    const messages = [textMessage("user", "read the file"), toolUse, toolResult, textMessage("assistant", "done")];

    saveSessionHistory(root, messages);
    const loaded = loadSessionHistory(root);

    expect(loaded).toEqual(messages);
    await rm(root, { recursive: true, force: true });
  });

  test("writes one JSONL record per message under .hancode/", async () => {
    const root = await tempWorkspace();
    saveSessionHistory(root, [textMessage("user", "a"), textMessage("assistant", "b")]);

    const text = await readFile(historyPath(root), "utf8");
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ v: 1, role: "user", content: "a" });
    await rm(root, { recursive: true, force: true });
  });

  test("truncates persisted history to the last HISTORY_MAX_MESSAGES entries", async () => {
    const root = await tempWorkspace();
    const messages: MessageParam[] = [];
    for (let i = 0; i < HISTORY_MAX_MESSAGES + 50; i++) {
      messages.push(textMessage(i % 2 === 0 ? "user" : "assistant", `msg ${i}`));
    }

    saveSessionHistory(root, messages);
    const loaded = loadSessionHistory(root);

    expect(loaded).toHaveLength(HISTORY_MAX_MESSAGES);
    expect(loaded[0]).toEqual(textMessage("user", `msg 50`));
    await rm(root, { recursive: true, force: true });
  });

  test("skips malformed lines but keeps the rest of the file", async () => {
    const root = await tempWorkspace();
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(root, ".hancode"), { recursive: true });
    // Good line, corrupt middle line, good line: only the bad one is skipped.
    writeFileSync(
      historyPath(root),
      [
        JSON.stringify({ v: 1, role: "user", content: "first" }),
        "not-json{{{",
        JSON.stringify({ v: 1, role: "assistant", content: "third" }),
      ].join("\n") + "\n",
      "utf8",
    );

    const loaded = loadSessionHistory(root);
    expect(loaded).toEqual([textMessage("user", "first"), textMessage("assistant", "third")]);
    await rm(root, { recursive: true, force: true });
  });

  test("ignores records with unknown version or invalid role", async () => {
    const root = await tempWorkspace();
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(root, ".hancode"), { recursive: true });
    writeFileSync(
      historyPath(root),
      [
        JSON.stringify({ v: 2, role: "user", content: "future version" }),
        JSON.stringify({ v: 1, role: "system", content: "bad role" }),
        JSON.stringify({ v: 1, role: "user", content: "good" }),
      ].join("\n") + "\n",
      "utf8",
    );

    expect(loadSessionHistory(root)).toEqual([textMessage("user", "good")]);
    await rm(root, { recursive: true, force: true });
  });

  test("returns empty array when no history file exists", async () => {
    const root = await tempWorkspace();
    expect(loadSessionHistory(root)).toEqual([]);
    await rm(root, { recursive: true, force: true });
  });

  test("sanitizeHistory drops an unanswered trailing tool_use", async () => {
    const [toolUse] = toolExchange();
    const messages = [textMessage("user", "go"), toolUse];

    // A tool_use without its tool_result must not survive into API context.
    expect(sanitizeHistory(messages)).toEqual([textMessage("user", "go")]);
  });

  test("sanitizeHistory drops the unanswered tool_use but keeps the fully answered exchange", async () => {
    const [toolUse, toolResult] = toolExchange();
    const danglingUse = { role: "assistant", content: [{ type: "tool_use", id: "toolu_2", name: "bash", input: { command: "ls" } }] } as MessageParam;
    const messages = [textMessage("user", "go"), toolUse, toolResult, danglingUse];

    expect(sanitizeHistory(messages)).toEqual([textMessage("user", "go"), toolUse, toolResult]);
  });

  test("sanitizeHistory keeps a complete conversation intact", async () => {
    const [toolUse, toolResult] = toolExchange();
    const messages = [textMessage("user", "go"), toolUse, toolResult, textMessage("assistant", "all done")];

    expect(sanitizeHistory(messages)).toEqual(messages);
  });

  test("clearSessionHistory removes the file", async () => {
    const root = await tempWorkspace();
    saveSessionHistory(root, [textMessage("user", "hello")]);
    expect(loadSessionHistory(root)).toHaveLength(1);

    clearSessionHistory(root);
    expect(loadSessionHistory(root)).toEqual([]);

    // Clearing again (already absent) must not throw.
    clearSessionHistory(root);
    await rm(root, { recursive: true, force: true });
  });

  test("saving an empty session writes an empty file", async () => {
    const root = await tempWorkspace();
    saveSessionHistory(root, [textMessage("user", "x")]);
    saveSessionHistory(root, []);
    expect(await readFile(historyPath(root), "utf8")).toBe("");
    expect(loadSessionHistory(root)).toEqual([]);
    await rm(root, { recursive: true, force: true });
  });
});
