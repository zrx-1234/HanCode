import { z } from "zod";

export const readFileInput = z.object({
  path: z.string(),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
});

export const listFilesInput = z.object({
  path: z.string().optional(),
  pattern: z.string().optional(),
  max_results: z.number().int().positive().optional(),
});

export const searchTextInput = z.object({
  pattern: z.string(),
  path: z.string().optional(),
  glob: z.string().optional(),
  case_sensitive: z.boolean().optional(),
  max_results: z.number().int().positive().optional(),
  context_lines: z.number().int().nonnegative().optional(),
});

export const editFileInput = z.object({
  path: z.string(),
  old_text: z.string(),
  new_text: z.string(),
});

export const writeFileInput = z.object({
  path: z.string(),
  content: z.string(),
  overwrite: z.boolean().optional(),
});

export const runCommandInput = z.object({
  command: z.string().trim().min(1, "Command cannot be empty."),
  args: z.array(z.string()).default([]),
  timeout_ms: z.number().int().positive().optional(),
  reason: z.string().trim().optional(),
});

export const bashInput = z.object({
  command: z.string().trim().min(1, "Command cannot be empty."),
  timeout_ms: z.number().int().positive().optional(),
  description: z.string().trim().optional(),
});
