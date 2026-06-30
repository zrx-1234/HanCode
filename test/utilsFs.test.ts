import { describe, expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWriteFile, sha256 } from "../src/utils/fs";

describe("sha256", () => {
  test("produces consistent hex digest", () => {
    const a = sha256("hello");
    const b = sha256("hello");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  test("different inputs produce different digests", () => {
    expect(sha256("a")).not.toBe(sha256("b"));
  });
});

describe("atomicWriteFile", () => {
  test("writes file atomically via temp + rename", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hancode-atomic-"));
    const target = join(dir, "target.txt");

    await atomicWriteFile(target, "content");

    expect(await readFile(target, "utf8")).toBe("content");
  });

  test("creates nested directories automatically", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hancode-atomic-"));
    const target = join(dir, "a", "b", "c.txt");

    await atomicWriteFile(target, "nested");

    expect(await readFile(target, "utf8")).toBe("nested");
  });

  test("overwrites existing file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hancode-atomic-"));
    const target = join(dir, "exist.txt");
    await Bun.write(target, "old");

    await atomicWriteFile(target, "new");

    expect(await readFile(target, "utf8")).toBe("new");
  });

  test("does not leave temp file behind", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hancode-atomic-"));
    const target = join(dir, "clean.txt");

    await atomicWriteFile(target, "data");

    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    expect(files).toEqual(["clean.txt"]);
  });
});
