import { createInterface } from "node:readline/promises";
import type { ConfirmationRequest } from "../agent/types";

export async function confirmInTerminal(request: ConfirmationRequest): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;

  console.log(`\n${request.title}`);
  console.log(request.message);
  if (request.command) console.log(`Command: ${request.command.join(" ")}`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("Allow? [y/N] ");
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}
