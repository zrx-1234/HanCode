#!/usr/bin/env bun
import Anthropic from "@anthropic-ai/sdk";
import { createInterface } from "node:readline/promises";
import { buildSystemPrompt } from "./agent/prompt";
import { runAgent } from "./agent/loop";
import { createTerminalEventSink } from "./agent/render";
import { createAgentSession } from "./agent/types";
import type { AgentSession, ConfirmationRequest } from "./agent/types";
import { loadConfig } from "./config";
import { clearSessionHistory, loadSessionHistory, saveSessionHistory } from "./sessionHistory";
import { createTerminalConfirmation } from "./security/confirmation";

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("HanCode interactive mode");
    const workspaceInput = await rl.question("Workspace path (press Enter for current directory): ");
    const config = loadConfig(workspaceInput || ".");
    const system = buildSystemPrompt(config.workspaceRoot);
    const session = createAgentSession();
    const confirm = createTerminalConfirmation(query => rl.question(query));

    // Restore the persisted conversation so context survives restarts.
    const history = loadSessionHistory(config.workspaceRoot);
    if (history.length > 0) {
      session.messages.push(...history);
      console.log(`HanCode restored ${history.length} messages from .hancode/conversation.jsonl (type new to start over).`);
    }

    console.log(`HanCode workspace: ${config.workspaceRoot}`);
    console.log(`HanCode model: ${config.model}`);
    console.log(`HanCode effort: ${config.effort}`);
    console.log(`HanCode base URL: ${config.baseURL}`);
    console.log(`HanCode web: ${config.web.enabled ? "enabled" : "disabled"}`);
    if (!config.apiKey) console.log("HanCode API key: not set in hancode.config.json; SDK fallback auth will be used if available.");
    console.log("Type exit or quit to leave.\n");

    while (true) {
      const input = (await rl.question("HanCode > ")).trim();
      if (!input) continue;
      if (input === "exit" || input === "quit") break;
      if (input === "new") {
        session.messages.length = 0;
        clearSessionHistory(config.workspaceRoot);
        console.log("Started a new conversation.");
        continue;
      }
      await runOnce(input, config, system, session, confirm);
    }
  } finally {
    rl.close();
  }
}

async function runOnce(
  prompt: string,
  config: ReturnType<typeof loadConfig>,
  system: string,
  session: AgentSession,
  confirm: (request: ConfirmationRequest) => Promise<boolean>,
): Promise<void> {
  const eventSink = createTerminalEventSink();

  try {
    await runAgent({
      prompt,
      workspaceRoot: config.workspaceRoot,
      apiKey: config.apiKey,
      model: config.model,
      baseURL: config.baseURL,
      maxTurns: config.maxTurns,
      effort: config.effort,
      web: config.web,
      system,
      emit: eventSink,
      session,
      confirm,
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      console.error("Missing or invalid Anthropic credentials. Set apiKey in hancode.config.json.");
    } else if (error instanceof Anthropic.RateLimitError) {
      console.error("Anthropic rate limit reached. Try again later.");
    } else if (error instanceof Anthropic.APIError) {
      console.error(`Anthropic API error ${error.status}: ${error.message}`);
    } else if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
  } finally {
    // Persist the conversation after every task end (completed or failed).
    saveSessionHistory(config.workspaceRoot, session.messages);
  }
}

await main();
