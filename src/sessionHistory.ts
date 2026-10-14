import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages";

/**
 * Per-workspace conversation history, persisted as JSONL under
 * `<workspace>/.hancode/conversation.jsonl` so the context survives app
 * restarts. Each line is `{ v, role, content }` in Anthropic API message
 * format; malformed lines are skipped so one bad line cannot disable the
 * whole history.
 */

const HISTORY_VERSION = 1;
const HISTORY_FILE = "conversation.jsonl";

/** Cap on restored messages so an ever-growing history cannot blow the context window. */
export const HISTORY_MAX_MESSAGES = 200;

type HistoryRecord = {
  v: 1;
  role: "user" | "assistant";
  content: MessageParam["content"];
};

export function historyPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".hancode", HISTORY_FILE);
}

/**
 * Load the persisted conversation for a workspace, sanitized so the result is
 * always valid API history (every tool_use answered, capped in length).
 */
export function loadSessionHistory(workspaceRoot: string): MessageParam[] {
  return sanitizeHistory(readHistoryFile(workspaceRoot).slice(-HISTORY_MAX_MESSAGES));
}

/** Persist the session messages, keeping only the most recent entries. */
export function saveSessionHistory(workspaceRoot: string, messages: MessageParam[]): void {
  const trimmed = messages.slice(-HISTORY_MAX_MESSAGES);
  const lines = trimmed.map(message => JSON.stringify({ v: HISTORY_VERSION, role: message.role, content: message.content } as HistoryRecord));
  try {
    mkdirSync(join(workspaceRoot, ".hancode"), { recursive: true });
    writeFileSync(historyPath(workspaceRoot), lines.length ? `${lines.join("\n")}\n` : "", "utf8");
  } catch (error) {
    // History is best-effort: never let a write failure break the agent run.
    console.error(`[hancode] failed to save conversation history: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Delete the persisted conversation (New Chat). */
export function clearSessionHistory(workspaceRoot: string): void {
  try {
    rmSync(historyPath(workspaceRoot), { force: true });
  } catch {
    // Ignore: a missing/unremovable history file must not break the app.
  }
}

function readHistoryFile(workspaceRoot: string): MessageParam[] {
  const file = historyPath(workspaceRoot);
  if (!existsSync(file)) return [];
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }

  const messages: MessageParam[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let record: HistoryRecord;
    try {
      record = JSON.parse(trimmed) as HistoryRecord;
    } catch {
      continue; // Skip malformed line; keep the rest of the history.
    }
    if (record?.v !== HISTORY_VERSION) continue;
    if (record.role !== "user" && record.role !== "assistant") continue;
    if (record.content == null) continue;
    messages.push({ role: record.role, content: record.content });
  }
  return messages;
}

/**
 * Drop the trailing incomplete part of a conversation: the Anthropic API
 * requires a tool_result for every tool_use, so history that ends with (or
 * contains) an unanswered tool call must be cut back to the last complete
 * exchange before it can be replayed as context.
 */
export function sanitizeHistory(messages: MessageParam[]): MessageParam[] {
  const valid: MessageParam[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role === "assistant" && hasUnansweredToolUse(messages, i)) break;
    valid.push(message);
  }
  return valid;
}

/** True when the assistant message at `index` has tool_use blocks without matching tool_result blocks in the immediately following user message. */
function hasUnansweredToolUse(messages: MessageParam[], index: number): boolean {
  const useIds = contentBlocks(messages[index]).filter(block => block.type === "tool_use").map(block => block.id);
  if (useIds.length === 0) return false;

  const next = messages[index + 1];
  if (!next || next.role !== "user") return true;

  const resultIds = new Set(contentBlocks(next).filter(block => block.type === "tool_result").map(block => block.tool_use_id));
  return useIds.some(id => !resultIds.has(id));
}

/** Content blocks of a message; string content has no blocks. */
function contentBlocks(message: MessageParam): Array<{ type: string; id?: string; tool_use_id?: string }> {
  if (typeof message.content === "string") return [];
  return message.content as Array<{ type: string; id?: string; tool_use_id?: string }>;
}
