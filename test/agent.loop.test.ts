import { describe, expect, test, beforeEach, mock } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "../src/agent/types";
import type { WebConfig } from "../src/config";

type MockStreamConfig = {
  text?: string;
  thinking?: string;
  toolUses?: Array<{ id: string; name: string; input: unknown }>;
};

let mockStreamConfigs: MockStreamConfig[] = [];
let streamCallIndex = 0;

function createMockStream(config: MockStreamConfig) {
  let textHandler: ((delta: string) => void) | undefined;
  let thinkingHandler: ((delta: string) => void) | undefined;

  return {
    on(event: string, handler: (data: string) => void) {
      if (event === "text") textHandler = handler;
      if (event === "thinking") thinkingHandler = handler;
    },
    async finalMessage() {
      if (config.thinking && thinkingHandler) thinkingHandler(config.thinking);
      if (config.text && textHandler) textHandler(config.text);

      return {
        id: "msg-test",
        type: "message",
        role: "assistant",
        content: [
          ...(config.text ? [{ type: "text" as const, text: config.text }] : []),
          ...(config.toolUses ?? []).map(tu => ({
            type: "tool_use" as const,
            id: tu.id,
            name: tu.name,
            input: tu.input,
          })),
        ],
        model: "claude-test",
        stop_reason: (config.toolUses ?? []).length ? "tool_use" : "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      };
    },
  };
}

// Mock Anthropic SDK before any code imports it transitively.
mock.module("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = {
        stream: mock(() => {
          const config = mockStreamConfigs[streamCallIndex++] ?? { text: "Done" };
          return createMockStream(config);
        }),
      };
    },
    AuthenticationError: class extends Error {},
    RateLimitError: class extends Error {},
    APIError: class extends Error {},
  };
});

const { runAgent } = await import("../src/agent/loop");

const defaultWeb: WebConfig = {
  enabled: false,
  allowedDomains: [],
  blockedDomains: [],
  search: {
    enabled: false,
    adapter: "tavily",
    maxResults: 8,
    tavilyApiKey: "",
    tavilyEndpointUrl: "https://api.tavily.com/search",
    braveApiKey: "",
    searxngEndpointUrl: "",
  },
  fetch: {
    enabled: false,
    adapter: "http",
    timeoutMs: 30_000,
    maxBytes: 1_000_000,
    maxChars: 60_000,
    cacheTtlMs: 900_000,
    tavilyApiKey: "",
    tavilyEndpointUrl: "https://api.tavily.com/extract",
  },
};

async function createOptions(overrides: Partial<Parameters<typeof runAgent>[0]> = {}) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "hancode-loop-"));
  const events: AgentEvent[] = [];
  const emitMock = mock(async (event: AgentEvent) => {
    events.push(event);
  });

  return {
    prompt: "Hello",
    workspaceRoot,
    apiKey: "test-key",
    model: "claude-test",
    baseURL: "https://api.anthropic.test",
    maxTurns: 10,
    effort: "auto",
    web: defaultWeb,
    system: "You are HanCode.",
    emit: emitMock,
    confirm: async () => true,
    ...overrides,
  };
}

function getEvents(opts: Awaited<ReturnType<typeof createOptions>>): AgentEvent[] {
  return (opts.emit as ReturnType<typeof mock>).mock.calls.map((c: unknown[]) => c[0] as AgentEvent);
}

describe("agent loop end-to-end", () => {
  beforeEach(() => {
    mockStreamConfigs = [];
    streamCallIndex = 0;
  });

  test("single-turn conversation without tools", async () => {
    mockStreamConfigs = [{ text: "Hello! How can I help you today?" }];

    const opts = await createOptions();
    await runAgent(opts);

    const events = getEvents(opts);

    expect(events.some((e) => e.type === "run.started")).toBe(true);
    expect(events.some((e) => e.type === "run.completed")).toBe(true);
    expect(events.some((e) => e.type === "turn.started")).toBe(true);
    expect(events.some((e) => e.type === "output.delta" && "text" in e && e.text === "Hello! How can I help you today?")).toBe(true);
  });

  test("tool_use followed by final answer", async () => {
    mockStreamConfigs = [
      {
        toolUses: [{ id: "tool_1", name: "list_files", input: { pattern: "**/*" } }],
      },
      { text: "I found the files." },
    ];

    const opts = await createOptions();
    await runAgent(opts);

    const events = getEvents(opts);

    expect(events.some((e) => e.type === "tool.started" && "name" in e && e.name === "list_files")).toBe(true);
    expect(events.some((e) => e.type === "tool.finished" && "name" in e && e.name === "list_files")).toBe(true);
    expect(events.some((e) => e.type === "run.completed")).toBe(true);
    expect(events.filter((e) => e.type === "turn.started").length).toBe(2);
  });

  test("stops after max turns", async () => {
    mockStreamConfigs = Array.from({ length: 15 }, () => ({
      toolUses: [{ id: "tool_repeat", name: "list_files", input: { pattern: "**/*" } }],
    }));

    const opts = await createOptions({ maxTurns: 3 });
    await runAgent(opts);

    const events = getEvents(opts);

    expect(events.some((e) => e.type === "run.max_turns")).toBe(true);
  });

  test("aborts on signal", async () => {
    mockStreamConfigs = [{ text: "This should not finish." }];

    const controller = new AbortController();
    const opts = await createOptions({ signal: controller.signal });

    // Abort immediately before runAgent starts
    controller.abort();

    await runAgent(opts);

    const events = getEvents(opts);

    expect(events.some((e) => e.type === "run.stopped")).toBe(true);
  });

  test("rejects repeated identical tool calls", async () => {
    mockStreamConfigs = [
      {
        toolUses: [{ id: "tool_a", name: "read_file", input: { path: "a.txt" } }],
      },
      {
        toolUses: [{ id: "tool_b", name: "read_file", input: { path: "a.txt" } }],
      },
      { text: "Got it." },
    ];

    const workspaceRoot = await mkdtemp(join(tmpdir(), "hancode-loop-"));
    await writeFile(join(workspaceRoot, "a.txt"), "hello", "utf8");

    const opts = await createOptions({ workspaceRoot, prompt: "read a.txt" });
    await runAgent(opts);

    const events = getEvents(opts);

    const toolFinished = events.filter((e) => e.type === "tool.finished");
    const repeated = toolFinished.find((e: any) => e.isError && e.contentPreview?.includes("Repeated tool call refused"));
    expect(repeated).toBeTruthy();
  });
});
