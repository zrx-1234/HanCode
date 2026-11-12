import { describe, expect, test, beforeEach, mock } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages/messages";
import type { AgentEvent } from "../src/agent/types";
import type { WebConfig } from "../src/config";

type MockStreamConfig = {
  text?: string;
  thinking?: string;
  toolUses?: Array<{ id: string; name: string; input?: unknown; badInput?: string }>;
  usage?: { input_tokens: number; output_tokens: number };
};

// Minimal valid 1x1 PNG used by multimodal tests.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNAAQEAAAABIwD+V9twAAAABJRU5ErkJggg==",
  "base64",
);

let mockStreamConfigs: MockStreamConfig[] = [];
let streamCallIndex = 0;
/** Constructor calls of every MockAnthropic instance, for vision-routing assertions. */
let constructorCalls: Array<{ client: unknown; args: unknown }> = [];
/** Params of every non-streaming create() call (compaction summaries). */
let createCalls: unknown[] = [];
/** Params of every streaming messages.stream() call. */
let streamParams: unknown[] = [];
/** Client instance per streaming call, for vision-routing assertions. */
let streamClients: unknown[] = [];

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
          ...(config.toolUses ?? []).map(tu => {
            const block: Record<string, unknown> = { type: "tool_use", id: tu.id, name: tu.name };
            if (tu.badInput) {
              // Simulate the SDK's lazy input getter when the model streamed
              // malformed JSON: every access of `.input` throws.
              Object.defineProperty(block, "input", {
                enumerable: true,
                configurable: true,
                get() {
                  throw new SyntaxError(tu.badInput);
                },
              });
            } else {
              block.input = tu.input;
            }
            return block;
          }),
        ],
        model: "claude-test",
        stop_reason: (config.toolUses ?? []).length ? "tool_use" : "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: config.usage?.input_tokens ?? 10,
          output_tokens: config.usage?.output_tokens ?? 20,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      };
    },
  };
}

// Mock Anthropic SDK before any code imports it transitively.
mock.module("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      constructor(constructorArgs: unknown) {
        // Recorded so tests can assert which client (main vs vision) made a call.
        constructorCalls.push({ client: this, args: constructorArgs });
      }
      messages = {
        stream: mock((params: unknown) => {
          streamParams.push(params);
          streamClients.push(this);
          const config = mockStreamConfigs[streamCallIndex++] ?? { text: "Done" };
          return createMockStream(config);
        }),
        create: mock(async (params: unknown) => {
          createCalls.push(params);
          return {
            content: [{ type: "text", text: "SUMMARY: earlier work on the project." }],
            usage: { input_tokens: 5, output_tokens: 7, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          };
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
    createCalls = [];
    streamParams = [];
    streamClients = [];
    constructorCalls = [];
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

  test("accepts a content-block prompt (multimodal user input)", async () => {
    mockStreamConfigs = [{ text: "I see the image." }];
    const promptBlocks: ContentBlockParam[] = [
      { type: "text", text: "describe this" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_1X1.toString("base64") } },
    ];

    const opts = await createOptions({ prompt: promptBlocks });
    await runAgent(opts);

    const first = (streamParams[0] as { messages: Array<{ role: string; content: unknown }> }).messages[0];
    expect(first.role).toBe("user");
    expect(first.content).toEqual(promptBlocks);
  });

  describe("vision model routing", () => {
    const VISION = { model: "glm-4.6v", baseURL: "https://vision.example.com/api", apiKey: "vision-key" };
    const imagePrompt: ContentBlockParam[] = [
      { type: "text", text: "describe this" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_1X1.toString("base64") } },
    ];

    test("image prompts go to the vision model and client", async () => {
      mockStreamConfigs = [{ text: "Vision reply." }];

      const opts = await createOptions({ prompt: imagePrompt, vision: VISION });
      await runAgent(opts);

      expect((streamParams[0] as { model: string }).model).toBe("glm-4.6v");
      // thinking syntax is chosen for the vision endpoint, not the main one
      expect((streamParams[0] as { thinking: { type: string; budget_tokens?: number } }).thinking.type).toBe("enabled");
      // a second client was constructed with the vision baseURL/key
      const visionConstructor = constructorCalls.find(call =>
        (call.args as { baseURL?: string })?.baseURL === VISION.baseURL,
      );
      expect(visionConstructor).toBeDefined();
      expect(streamClients[0]).toBe(visionConstructor?.client);
    });

    test("text-only prompts keep using the main model", async () => {
      mockStreamConfigs = [{ text: "Text reply." }];

      const opts = await createOptions({ vision: VISION });
      await runAgent(opts);

      expect((streamParams[0] as { model: string }).model).toBe("claude-test");
      expect(streamClients[0]).toBe(constructorCalls[0]?.client);
    });

    test("image tool results switch subsequent turns to the vision model", async () => {
      mockStreamConfigs = [
        { toolUses: [{ id: "tool_1", name: "read_file", input: { path: "shot.png" } }] },
        { text: "Described the image." },
      ];

      const opts = await createOptions({ vision: VISION });
      await writeFile(join(opts.workspaceRoot, "shot.png"), PNG_1X1);
      await runAgent(opts);

      // first request: text-only prompt → main model
      expect((streamParams[0] as { model: string }).model).toBe("claude-test");
      // second request carries the image tool_result → vision model
      expect((streamParams[1] as { model: string }).model).toBe("glm-4.6v");
    });

    test("without vision config image prompts keep using the main model", async () => {
      mockStreamConfigs = [{ text: "Ok." }];

      const opts = await createOptions({ prompt: imagePrompt });
      await runAgent(opts);

      expect((streamParams[0] as { model: string }).model).toBe("claude-test");
      expect(constructorCalls.length).toBe(1);
    });
  });

  test("image tool results are previewed with a placeholder and fed back as blocks", async () => {
    mockStreamConfigs = [
      { toolUses: [{ id: "tool_1", name: "read_file", input: { path: "shot.png" } }] },
      { text: "Described the image." },
    ];

    const opts = await createOptions();
    await writeFile(join(opts.workspaceRoot, "shot.png"), PNG_1X1);
    await runAgent(opts);

    const events = getEvents(opts);
    const finished = events.find((e): e is Extract<AgentEvent, { type: "tool.finished" }> => e.type === "tool.finished" && e.name === "read_file");
    expect(finished?.contentPreview).toContain("[image: image/png]");

    // The tool_result fed back into the conversation carries the image block.
    // (streamParams stores a live array reference, so locate the tool_result
    // message instead of assuming it is still the last one.)
    const second = (streamParams[1] as { messages: Array<{ role: string; content: unknown }> }).messages;
    const toolResultMessage = second.find(message =>
      message.role === "user" && Array.isArray(message.content)
      && (message.content as Array<{ type: string }>)[0]?.type === "tool_result",
    ) as { role: string; content: Array<{ type: string; content: Array<Record<string, unknown>> }> };
    expect(toolResultMessage).toBeDefined();
    const image = toolResultMessage.content[0].content[1] as { type: string; source: { media_type: string } };
    expect(image.type).toBe("image");
    expect(image.source.media_type).toBe("image/png");
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

  test("malformed streamed tool input becomes a recoverable tool error", async () => {
    // The model streams a write_file call whose JSON input is invalid; the run
    // must survive with an is_error tool_result so the model can retry.
    mockStreamConfigs = [
      { toolUses: [{ id: "tool_bad", name: "write_file", badInput: "JSON Parse error: Invalid number" }] },
      { toolUses: [{ id: "tool_retry", name: "write_file", input: { path: "a.txt", content: "hello" } }] },
      { text: "Retried and wrote the file." },
    ];

    const workspaceRoot = await mkdtemp(join(tmpdir(), "hancode-loop-"));
    const session = { messages: [] as any[], readState: new Map(), usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 } };
    const opts = await createOptions({ workspaceRoot, session, prompt: "write a.txt" });
    await runAgent(opts);

    const events = getEvents(opts);
    expect(events.some((e) => e.type === "run.error")).toBe(false);
    expect(events.some((e) => e.type === "run.completed")).toBe(true);

    // The bad call is reported as a failed tool, not a failed run.
    const bad = events.find((e) => e.type === "tool.finished" && (e as any).isError && String((e as any).contentPreview).includes("could not be parsed"));
    expect(bad).toBeTruthy();

    // The retry ran normally.
    const retried = events.find((e) => e.type === "tool.finished" && (e as any).toolUseId === "tool_retry" && !(e as any).isError);
    expect(retried).toBeTruthy();

    // History stays serializable for the next API request: the broken lazy
    // input getter was replaced with a plain value.
    expect(() => JSON.stringify(session.messages)).not.toThrow();
    const assistant = session.messages.find((m: any) => m.role === "assistant")!;
    const badBlock = assistant.content.find((b: any) => b.type === "tool_use" && b.id === "tool_bad")!;
    expect(badBlock.input).toEqual({});

    // tool_use / tool_result pairing stays intact for the API.
    const toolUseIds = session.messages
      .filter((m: any) => m.role === "assistant")
      .flatMap((m: any) => m.content.filter((b: any) => b.type === "tool_use").map((b: any) => b.id));
    const toolResultIds = session.messages
      .filter((m: any) => m.role === "user" && Array.isArray(m.content))
      .flatMap((m: any) => m.content.filter((b: any) => b.type === "tool_result").map((b: any) => b.tool_use_id));
    expect(toolResultIds.sort()).toEqual(toolUseIds.sort());
  });

  test("compacts long context when the token estimate passes the threshold", async () => {
    // 16 pre-existing session messages plus this task's exchange give the
    // compaction planner room; the first turn reports a huge context size.
    const session = {
      messages: Array.from({ length: 16 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `older ${i}` })) as any[],
      readState: new Map(),
      usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    };
    mockStreamConfigs = [
      { toolUses: [{ id: "tool_1", name: "list_files", input: { pattern: "*" } }], usage: { input_tokens: 150_000, output_tokens: 500 } },
      { text: "done after compaction" },
    ];

    const opts = await createOptions({ session, compactionThresholdTokens: 100_000 });
    await runAgent(opts);

    const events = getEvents(opts);
    expect(events.some((e) => e.type === "run.error")).toBe(false);
    expect(events.some((e) => e.type === "run.completed")).toBe(true);

    // Compaction fired: older messages were replaced by a summary.
    const compacted = events.find((e) => e.type === "context.compacted");
    expect(compacted).toBeTruthy();
    expect((compacted as any).removedMessages).toBeGreaterThan(0);

    // The summarization went through the non-streaming API.
    expect(createCalls.length).toBe(1);
    const summaryRequest = (createCalls[0] as any);
    expect(String(summaryRequest.messages[0].content)).toContain("Summarize");

    // History now starts with the compacted-context marker and shrank.
    const first = session.messages[0] as any;
    expect(first.role).toBe("user");
    expect(String(first.content)).toContain("[HanCode compacted context]");
    expect(session.messages.length).toBeLessThan(19);

    // The kept tail stays valid API history: every tool_use has its result.
    const toolUseIds = session.messages
      .filter((m: any) => m.role === "assistant")
      .flatMap((m: any) => (Array.isArray(m.content) ? m.content.filter((b: any) => b.type === "tool_use").map((b: any) => b.id) : []));
    const toolResultIds = session.messages
      .filter((m: any) => m.role === "user" && Array.isArray(m.content))
      .flatMap((m: any) => m.content.filter((b: any) => b.type === "tool_result").map((b: any) => b.tool_use_id));
    expect(toolResultIds.sort()).toEqual(toolUseIds.sort());
  });

  test("does not compact below the configured threshold", async () => {
    const session = {
      messages: Array.from({ length: 16 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `older ${i}` })) as any[],
      readState: new Map(),
      usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    };
    mockStreamConfigs = [{ text: "small turn" }];

    const opts = await createOptions({ session, compactionThresholdTokens: 100_000 });
    await runAgent(opts);

    expect(createCalls.length).toBe(0);
    expect((session.messages[0] as any).content).toBe("older 0");
  });

  test("sends adaptive thinking to the official Anthropic endpoint", async () => {
    mockStreamConfigs = [{ text: "ok" }];
    const opts = await createOptions({ baseURL: "https://api.anthropic.com" });
    await runAgent(opts);

    expect(streamParams.length).toBe(1);
    const thinking = (streamParams[0] as any).thinking;
    expect(thinking).toEqual({ type: "adaptive", display: "summarized" });
  });

  test("sends budget thinking to a third-party compatible gateway", async () => {
    mockStreamConfigs = [{ text: "ok" }];
    const opts = await createOptions({ baseURL: "https://ark.cn-beijing.volces.com/api/coding", effort: "high" });
    await runAgent(opts);

    expect(streamParams.length).toBe(1);
    const thinking = (streamParams[0] as any).thinking;
    expect(thinking.type).toBe("enabled");
    expect(thinking.budget_tokens).toBeGreaterThan(0);
    expect(thinking.budget_tokens).toBeLessThan((streamParams[0] as any).max_tokens);
    expect(thinking.display).toBe("summarized");
  });

  test("explicit thinkingMode overrides endpoint detection", async () => {
    mockStreamConfigs = [{ text: "ok" }];
    const opts = await createOptions({ baseURL: "https://api.anthropic.com", thinkingMode: "budget", effort: "low" });
    await runAgent(opts);

    const thinking = (streamParams[0] as any).thinking;
    expect(thinking.type).toBe("enabled");
    expect(thinking.budget_tokens).toBe(4_096);
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
