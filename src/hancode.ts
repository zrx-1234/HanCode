#!/usr/bin/env bun
import Anthropic from "@anthropic-ai/sdk";
import { createInterface } from "node:readline/promises";
import { buildSystemPrompt } from "./agent/prompt";
import { runAgent } from "./agent/loop";
import { loadConfig } from "./config";

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("HanCode interactive mode");
    const workspaceInput = await rl.question("Workspace path (press Enter for current directory): ");
    const config = loadConfig(workspaceInput || ".");
    const system = buildSystemPrompt(config.workspaceRoot);

    console.log(`HanCode workspace: ${config.workspaceRoot}`);
    console.log(`HanCode model: ${config.model}`);
    console.log(`HanCode base URL: ${config.baseURL}`);
    if (!config.apiKey) console.log("HanCode API key: not set in hancode.config.json; SDK fallback auth will be used if available.");
    console.log("Type exit or quit to leave.\n");

    while (true) {
      const input = (await rl.question("HanCode > ")).trim();
      if (!input) continue;
      if (input === "exit" || input === "quit") break;
      await runOnce(input, config, system);
    }
  } finally {
    rl.close();
  }
}

async function runOnce(prompt: string, config: ReturnType<typeof loadConfig>, system: string): Promise<void> {
  try {
    await runAgent({
      prompt,
      workspaceRoot: config.workspaceRoot,
      apiKey: config.apiKey,
      model: config.model,
      baseURL: config.baseURL,
      maxTurns: config.maxTurns,
      system,
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
