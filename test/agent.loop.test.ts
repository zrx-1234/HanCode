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
    effort: "auto" as const,
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

  test("aborts between tool calls and keeps the session history valid", async () => {
    mockStreamConfigs = [
      {
        toolUses: [
          { id: "tool_1", name: "list_files", input: { pattern: "*.txt" } },
          { id: "tool_2", name: "list_files", input: { pattern: "*.md" } },
          { id: "tool_3", name: "list_files", input: { pattern: "*.json" } },
        ],
      },
    ];

    const controller = new AbortController();
    const session = { messages: [] as any[], readState: new Map(), usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 } };
    const events: AgentEvent[] = [];
    const opts = await createOptions({
      signal: controller.signal,
      session,
      emit: mock(async (event: AgentEvent) => {
        events.push(event);
        // Abort as soon as the first tool starts; the other two must be skipped.
        if (event.type === "tool.started" && event.toolUseId === "tool_1") controller.abort();
      }),
    });

    await runAgent(opts);

    // Only the first tool actually started; tool_2/tool_3 were never executed.
    const startedIds = events.filter((e) => e.type === "tool.started").map((e) => (e as any).toolUseId);
    expect(startedIds).toEqual(["tool_1"]);
    expect(events.some((e) => e.type === "run.stopped")).toBe(true);
    // No second API request: the run stopped before the next turn could stream.
    expect(streamCallIndex).toBe(1);

    // History stays valid for the next task in this session: every tool_use
    // from the assistant message has a paired tool_result in the next message.
    const assistant = session.messages.find((m: any) => m.role === "assistant")!;
    const toolUseIds = assistant.content.filter((b: any) => b.type === "tool_use").map((b: any) => b.id);
    const toolResultIds = session.messages
      .filter((m: any) => m.role === "user" && Array.isArray(m.content))
      .flatMap((m: any) => m.content.filter((b: any) => b.type === "tool_result").map((b: any) => b.tool_use_id));
    expect(toolResultIds.sort()).toEqual([...toolUseIds].sort());

    // The skipped tools report that they never ran.
    const skipped = session.messages
      .flatMap((m: any) => (Array.isArray(m.content) ? m.content : []))
      .filter((b: any) => b.type === "tool_result" && b.is_error && typeof b.content === "string" && b.content.includes("stopped by the user"));
    expect(skipped.map((b: any) => b.tool_use_id).sort()).toEqual(["tool_2", "tool_3"]);
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

  describe("sub-agents", () => {
    test("parent can spawn a sub-agent and receive its result", async () => {
      mockStreamConfigs = [
        {
          toolUses: [
            {
              id: "tool_agent",
              name: "agent",
              input: { agents: [{ id: "worker", prompt: "say hello" }] },
            },
          ],
        },
        { text: "hello from sub-agent" },
        { text: "parent done" },
      ];

      const opts = await createOptions();
      await runAgent(opts);

      const events = getEvents(opts);
      expect(events.some((e) => e.type === "output.delta" && "text" in e && e.text === "hello from sub-agent")).toBe(true);
      expect(events.some((e) => e.type === "output.delta" && "text" in e && e.text === "parent done")).toBe(true);
      expect(events.some((e) => e.type === "run.completed")).toBe(true);
    });

    test("sub-agent cannot call the agent tool (recursion guard)", async () => {
      mockStreamConfigs = [
        {
          toolUses: [
            {
              id: "tool_agent",
              name: "agent",
              input: { agents: [{ id: "nested", prompt: "spawn another" }] },
            },
          ],
        },
        {
          toolUses: [
            {
              id: "tool_nested_agent",
              name: "agent",
              input: { agents: [{ prompt: "this should fail" }] },
            },
          ],
        },
        { text: "sub-agent failed recursion" },
        { text: "parent done" },
      ];

      const opts = await createOptions();
      await runAgent(opts);

      const events = getEvents(opts);
      const nestedToolFinished = events.find(
        (e) => e.type === "tool.finished" && "name" in e && e.name === "agent" && e.taskId !== opts.taskId,
      );
      expect(nestedToolFinished).toBeTruthy();
      expect((nestedToolFinished as any).isError).toBe(true);
    });

    test("parent abort propagates to sub-agent", async () => {
      mockStreamConfigs = [
        {
          toolUses: [
            {
              id: "tool_agent",
              name: "agent",
              input: { agents: [{ id: "worker", prompt: "long task" }] },
            },
          ],
        },
        { text: "sub should be aborted" },
      ];

      const controller = new AbortController();
      const opts = await createOptions({ signal: controller.signal });

      // Start the run and abort immediately while it is still in its first async step.
      const runPromise = runAgent(opts);
      controller.abort();
      await runPromise;

      const events = getEvents(opts);
      expect(events.some((e) => e.type === "run.stopped")).toBe(true);
    });

    test("sub-agent usage is merged into parent session", async () => {
      mockStreamConfigs = [
        {
          toolUses: [
            {
              id: "tool_agent",
              name: "agent",
              input: { agents: [{ id: "worker", prompt: "say hello" }] },
            },
          ],
        },
        { text: "hello" },
        { text: "parent done" },
      ];

      const session = { messages: [], readState: new Map(), usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 } };
      const opts = await createOptions({ session });
      await runAgent(opts);

      // Parent turn (10 in + 20 out) + sub-agent turn (10 in + 20 out) + parent final turn (10 in + 20 out) = 90 total.
      expect(session.usage.inputTokens).toBe(30);
      expect(session.usage.outputTokens).toBe(60);
    });
  });
});
