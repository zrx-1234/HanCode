export const DEFAULT_OUTPUT_LIMIT = 60_000;

export function limitOutput(text: string, maxChars = DEFAULT_OUTPUT_LIMIT): string {
  if (text.length <= maxChars) return text;
  const firstLength = Math.floor(maxChars / 2);
  const lastLength = maxChars - firstLength;
  return `${text.slice(0, firstLength)}\n\n[Output truncated: showing first ${firstLength} and last ${lastLength} chars]\n\n${text.slice(text.length - lastLength)}`;
}
