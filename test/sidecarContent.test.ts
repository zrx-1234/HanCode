import { describe, expect, test } from "bun:test";
import { buildUserContent, MAX_ATTACHED_IMAGES } from "../src/desktop/sidecarContent";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages/messages";

// Minimal base64 payload whose decoded size is deterministic.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNAAQEAAAABIwD+V9twAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_DATA = PNG_BYTES.toString("base64");

function image(mediaType = "image/png", data = PNG_DATA): { mediaType: string; data: string } {
  return { mediaType, data };
}

function asBlocks(content: string | ContentBlockParam[]): ContentBlockParam[] {
  expect(Array.isArray(content)).toBe(true);
  return content as ContentBlockParam[];
}

describe("buildUserContent", () => {
  test("returns the plain prompt when no images are attached", () => {
    expect(buildUserContent("hello")).toBe("hello");
    expect(buildUserContent("hello", [])).toBe("hello");
    expect(buildUserContent("hello", undefined)).toBe("hello");
  });

  test("builds a text block followed by image blocks", () => {
    const content = buildUserContent("describe this", [image(), image("image/jpeg")]);
    const blocks = asBlocks(content);
    expect(blocks.length).toBe(3);
    expect(blocks[0]).toEqual({ type: "text", text: "describe this" });
    expect(blocks[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: PNG_DATA } });
    expect(blocks[2]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: PNG_DATA } });
  });

  test("empty prompt with images yields image blocks only", () => {
    const content = buildUserContent("", [image()]);
    const blocks = asBlocks(content);
    expect(blocks.length).toBe(1);
    expect(blocks[0].type).toBe("image");
  });

  test("whitespace-only prompt is treated as empty", () => {
    const content = buildUserContent("   ", [image()]);
    const blocks = asBlocks(content);
    expect(blocks.length).toBe(1);
    expect(blocks[0].type).toBe("image");
  });

  test("rejects unsupported media types", () => {
    expect(() => buildUserContent("hi", [image("image/bmp")])).toThrow("Unsupported image media type");
    expect(() => buildUserContent("hi", [image("text/plain")])).toThrow("Unsupported image media type");
  });

  test("rejects oversized images", () => {
    const big = Buffer.alloc(4_000_001, 1).toString("base64");
    expect(() => buildUserContent("hi", [image("image/png", big)])).toThrow("too large");
  });

  test("rejects empty image data", () => {
    expect(() => buildUserContent("hi", [image("image/png", "")])).toThrow("empty");
  });

  test("rejects more than the attachment limit", () => {
    const images = Array.from({ length: MAX_ATTACHED_IMAGES + 1 }, () => image());
    expect(() => buildUserContent("hi", images)).toThrow("Too many images");
  });
});
