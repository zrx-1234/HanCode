export function renderToolStart(name: string, input: unknown): void {
  console.log(`\n[tool] ${name} ${JSON.stringify(input)}`);
}

export function renderToolEnd(name: string, isError: boolean, content?: string): void {
  console.log(`[tool] ${name} ${isError ? "failed" : "done"}`);
  if (isError && content) console.log(`\n${content}`);
  console.log();
}
