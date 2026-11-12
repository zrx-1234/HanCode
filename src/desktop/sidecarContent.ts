import type { ImageBlockParam, TextBlockParam } from "@anthropic-ai/sdk/resources/messages/messages";
import { IMAGE_MEDIA_TYPES, MAX_IMAGE_BYTES } from "../tools/images";
import type { ImageMediaType } from "../tools/images";

/** Image attached to a user message: bare base64 payload plus its media type. */
export type ImageAttachment = { mediaType: string; data: string };

/** Upper bound on images per message, mirroring common vision-model limits. */
export const MAX_ATTACHED_IMAGES = 6;

/**
 * Builds the user-message content for a task: plain text when no images are
 * attached (legacy behavior), otherwise a text block followed by image blocks.
 * An empty prompt with images yields image blocks only.
 */
export function buildUserContent(prompt: string, images?: ImageAttachment[]): string | Array<TextBlockParam | ImageBlockParam> {
  if (!images || images.length === 0) return prompt;
  if (images.length > MAX_ATTACHED_IMAGES) {
    throw new Error(`Too many images attached (${images.length}, max ${MAX_ATTACHED_IMAGES}).`);
  }

  const blocks: Array<TextBlockParam | ImageBlockParam> = [];
  if (prompt.trim() !== "") blocks.push({ type: "text", text: prompt });
  for (const image of images) {
    if (!(IMAGE_MEDIA_TYPES as readonly string[]).includes(image.mediaType)) {
      throw new Error(`Unsupported image media type: ${image.mediaType}.`);
    }
    const bytes = Buffer.from(image.data, "base64");
    if (bytes.length === 0) throw new Error("Attached image is empty.");
    if (bytes.length > MAX_IMAGE_BYTES) {
      throw new Error(`Attached image is too large (${bytes.length} bytes, max ${MAX_IMAGE_BYTES}).`);
    }
    blocks.push({
      type: "image",
      source: { type: "base64", media_type: image.mediaType as ImageMediaType, data: image.data },
    });
  }
  return blocks;
}
