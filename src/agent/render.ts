export function renderToolStart(name: string, input: unknown): void {
  console.log(`\n[tool] ${name} ${JSON.stringify(input)}`);
}

export function renderToolEnd(name: string, isError: boolean): void {
  console.log(`[tool] ${name} ${isError ? "failed" : "done"}\n`);
}
