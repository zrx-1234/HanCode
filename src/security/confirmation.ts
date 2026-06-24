import { createInterface } from "node:readline/promises";
import type { ConfirmationRequest } from "../agent/types";

export type QuestionFn = (query: string) => Promise<string>;

export function createTerminalConfirmation(question: QuestionFn): (request: ConfirmationRequest) => Promise<boolean> {
  return async request => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return false;

    console.log(`\n${request.title}`);
    console.log(request.message);
    if (request.commandText) console.log(`Command: ${request.commandText}`);
    else if (request.command) console.log(`Command: ${request.command.join(" ")}`);

    const answer = await question("Allow? [y/N] ");
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  };
}

export async function confirmInTerminal(request: ConfirmationRequest): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await createTerminalConfirmation(query => rl.question(query))(request);
  } finally {
    rl.close();
  }
}
