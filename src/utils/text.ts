export function withLineNumbers(text: string, offset = 0): string {
  const lines = text.split(/\r?\n/);
  return lines.map((line, index) => `${String(offset + index + 1).padStart(6, " ")}\t${line}`).join("\n");
}

export function normalizeInsertedLineEndings(original: string, inserted: string): string {
  const crlfCount = (original.match(/\r\n/g) ?? []).length;
  const lfCount = (original.match(/(?<!\r)\n/g) ?? []).length;
  if (crlfCount > lfCount) return inserted.replace(/\r?\n/g, "\r\n");
  return inserted.replace(/\r\n/g, "\n");
}
