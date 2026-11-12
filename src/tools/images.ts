import type { ImageBlockParam, TextBlockParam } from "@anthropic-ai/sdk/resources/messages/messages";

/**
 * Shared helpers for turning binary images into Anthropic image content blocks.
 * Used by read_file (workspace images), web_fetch (image URLs) and screenshot.
 */

/** Blocks a tool may return (see ToolResultContent in agent/types.ts). */
export type ToolResultContentBlock = TextBlockParam | ImageBlockParam;

export const IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

/** Anthropic image blocks are rejected above ~5MB base64; keep raw bytes well under that. */
export const MAX_IMAGE_BYTES = 4_000_000;

const EXT_TO_MEDIA_TYPE: Record<string, ImageMediaType> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** Maps a file extension (case-insensitive, with or without dot) to a supported media type. */
export function extToMediaType(ext: string): ImageMediaType | undefined {
  const normalized = ext.toLowerCase().startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return EXT_TO_MEDIA_TYPE[normalized];
}

/** Maps a HTTP content-type header (e.g. `image/png; charset=binary`) to a supported media type. */
export function contentTypeToMediaType(contentType: string): ImageMediaType | undefined {
  const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return (IMAGE_MEDIA_TYPES as readonly string[]).includes(mime) ? (mime as ImageMediaType) : undefined;
}

/**
 * Builds the standard content-block pair returned by image-capable tools:
 * a short text label followed by the base64 image block.
 */
export function buildImageContentBlocks(opts: {
  label: string;
  bytes: Buffer;
  mediaType: ImageMediaType;
}): Array<ToolResultContentBlock> {
  if (opts.bytes.length === 0) throw new Error("Image is empty.");
  if (opts.bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`Image is too large (${opts.bytes.length} bytes, max ${MAX_IMAGE_BYTES}).`);
  }
  return [
    { type: "text", text: opts.label },
    {
      type: "image",
      source: { type: "base64", media_type: opts.mediaType, data: opts.bytes.toString("base64") },
    },
  ];
}
