import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages";

/**
 * Automatic context compaction: when the conversation grows past a token
 * threshold, the older part of the history is replaced by a model-generated
 * summary so long sessions stay within the context window (and cheap).
 *
 * Compaction only ever cuts at an assistant message boundary, so the kept
 * tail is always valid API history (it never starts with an orphan
 * tool_result, and every tool_use in it keeps its tool_result).
 */

/**
 * Context size (tokens) at which compaction kicks in. Estimated from the
 * last API response: input + cache read/creation + output tokens.
 */
export const DEFAULT_COMPACTION_THRESHOLD_TOKENS = 100_000;

/**
 * Minimum number of messages kept verbatim after compaction. The tail must be
 * long enough for the model to still "see" its most recent work in full.
 */
export const COMPACTION_KEEP_TAIL_MESSAGES = 10;

/** Minimum messages that must end up in the summarized part. */
const COMPACTION_MIN_SUMMARIZED = 4;

/**
 * Pick the compaction cut point: the highest index `a` such that
 * `messages[a]` is an assistant message, at least `COMPACTION_MIN_SUMMARIZED`
 * messages before it and at least `keepTail` messages after it exist.
 * Returns undefined when the conversation is too short to compact.
 */
export function planCompaction(messages: MessageParam[], keepTail = COMPACTION_KEEP_TAIL_MESSAGES): number | undefined {
  const earliest = Math.max(1, messages.length - keepTail);
  for (let a = earliest - 1; a >= COMPACTION_MIN_SUMMARIZED; a--) {
    if (messages[a].role === "assistant") return a;
  }
  return undefined;
}

/**
 * Context-size estimate for the *next* request, derived from one API
 * response's usage: everything the model saw (input, cache read/creation)
 * plus what it produced (output).
 */
export function estimateContextTokens(usage: { inputTokens: number; outputTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number }): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
}

/** Build the summarization request for the messages being compacted away. */
export function buildCompactionMessages(messages: MessageParam[]): MessageParam[] {
  const transcript = messages.map(message => JSON.stringify(message)).join("\n");
  return [
    {
      role: "user",
      content:
        "Summarize the following conversation history so work can continue with this summary alone. " +
        "Preserve: the user's goals and requirements, decisions made, file paths and key code locations touched, " +
        "commands run and their outcomes, unresolved problems, and the current next step. " +
        "Be dense and factual; skip pleasantries and tool-call boilerplate. Reply with the summary only.\n\n" +
        `<conversation>\n${transcript}\n</conversation>`,
    },
  ];
}

/** The message that replaces the compacted part of the history. */
export function compactedContextMessage(summary: string): MessageParam {
  return {
    role: "user",
    content:
      "[HanCode compacted context] The earlier conversation was summarized to save context space. " +
      `Summary of everything before this point:\n\n${summary}`,
  };
}
