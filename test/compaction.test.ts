import { describe, expect, test } from "bun:test";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages";
import {
  COMPACTION_KEEP_TAIL_MESSAGES,
  DEFAULT_COMPACTION_THRESHOLD_TOKENS,
  buildCompactionMessages,
  compactedContextMessage,
  estimateContextTokens,
  planCompaction,
} from "../src/agent/compaction";

function textMessage(role: "user" | "assistant", text: string): MessageParam {
  return { role, content: text };
}

/** Alternating user/assistant conversation of the given length. */
function conversation(length: number): MessageParam[] {
  return Array.from({ length }, (_, i) => textMessage(i % 2 === 0 ? "user" : "assistant", `m${i}`));
}

describe("planCompaction", () => {
  test("cuts at the highest assistant message that keeps the tail", () => {
    const messages = conversation(30);
    // earliest cut = 30 - 10 = 20; messages[19] is assistant → cut there.
    expect(planCompaction(messages)).toBe(19);
  });

  test("respects the configured tail length", () => {
    const messages = conversation(30);
    expect(planCompaction(messages, 4)).toBe(25);
  });

  test("never cuts below the minimum summarized part", () => {
    // Short conversation: no valid cut point.
    expect(planCompaction(conversation(10))).toBeUndefined();
    expect(planCompaction(conversation(13))).toBeUndefined();
    expect(planCompaction(conversation(14))).toBeUndefined();
    // 16 messages with tail 10: cut at the highest assistant index (5).
    expect(planCompaction(conversation(16))).toBe(5);
  });

  test("returns undefined for empty or tiny histories", () => {
    expect(planCompaction([])).toBeUndefined();
    expect(planCompaction(conversation(2))).toBeUndefined();
  });
});

describe("estimateContextTokens", () => {
  test("sums input, output and cache tokens", () => {
    expect(estimateContextTokens({ inputTokens: 100, outputTokens: 50, cacheCreationInputTokens: 10, cacheReadInputTokens: 40 })).toBe(200);
  });

  test("default threshold is a sane value", () => {
    expect(DEFAULT_COMPACTION_THRESHOLD_TOKENS).toBeGreaterThan(10_000);
  });
});

describe("compaction prompt", () => {
  test("builds a single summarization request embedding the transcript", () => {
    const messages = [textMessage("user", "do a thing"), textMessage("assistant", "did it")];
    const request = buildCompactionMessages(messages);
    expect(request).toHaveLength(1);
    expect(request[0].role).toBe("user");
    const content = String(request[0].content);
    expect(content).toContain("Summarize");
    expect(content).toContain("do a thing");
    expect(content).toContain("did it");
  });

  test("summary message is a user message marked as compacted context", () => {
    const message = compactedContextMessage("summary text");
    expect(message.role).toBe("user");
    expect(String(message.content)).toContain("[HanCode compacted context]");
    expect(String(message.content)).toContain("summary text");
  });
});
