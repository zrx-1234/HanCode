#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import { loadConfig } from "./config";
import { buildSystemPrompt } from "./agent/prompt";
import { runAgent } from "./agent/loop";
import { createAgentSession } from "./agent/types";
import type { AgentSession, ConfirmationRequest } from "./agent/types";
import { createTerminalConfirmation } from "./security/confirmation";
import Anthropic from "@anthropic-ai/sdk";

async function main(): Promise<void> {
  const prompt = process.argv.slice(2).join(" ").trim();
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const workspaceInput = await rl.question("Workspace path (press Enter for current directory): ");
    const config = loadConfig(workspaceInput || ".");
    const system = buildSystemPrompt(config.workspaceRoot);

    console.log(`HanCode workspace: ${config.workspaceRoot}`);
    console.log(`HanCode model: ${config.model}`);
    console.log(`HanCode effort: ${config.effort}`);
    console.log(`HanCode base URL: ${config.baseURL}`);
    console.log(`HanCode web: ${config.web.enabled ? "enabled" : "disabled"}`);
    if (!config.apiKey) console.log("HanCode API key: not set in hancode.config.json; SDK fallback auth will be used if available.");

    if (prompt) {
      await runOnce(prompt, config, system);
      return;
    }

    const session = createAgentSession();
    const confirm = createTerminalConfirmation(query => rl.question(query));

    while (true) {
      const input = (await rl.question("HanCode > ")).trim();
      if (!input) continue;
      if (input === "exit" || input === "quit") break;
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
  session?: AgentSession,
  confirm?: (request: ConfirmationRequest) => Promise<boolean>,
): Promise<void> {
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
  }
}

await main();
