import { describe, expect, test } from "bun:test";
import { globToRegExp, matchesGlob } from "../src/utils/glob";

describe("globToRegExp", () => {
  test("matches literal path", () => {
    const re = globToRegExp("src/index.ts");
    expect(re.test("src/index.ts")).toBe(true);
    expect(re.test("src/other.ts")).toBe(false);
  });

  test("matches single star in segment", () => {
    const re = globToRegExp("src/*.ts");
    expect(re.test("src/index.ts")).toBe(true);
    expect(re.test("src/utils.ts")).toBe(true);
    expect(re.test("src/a/b.ts")).toBe(false);
  });

  test("matches double star across directories", () => {
    const re = globToRegExp("src/**/*.ts");
    expect(re.test("src/a.ts")).toBe(true);
    expect(re.test("src/a/b.ts")).toBe(true);
    expect(re.test("src/a/b/c.ts")).toBe(true);
    expect(re.test("test/a.ts")).toBe(false);
  });

  test("matches question mark", () => {
    const re = globToRegExp("file?.txt");
    expect(re.test("file1.txt")).toBe(true);
    expect(re.test("fileA.txt")).toBe(true);
    expect(re.test("file12.txt")).toBe(false);
  });

  test("escapes regex special chars", () => {
    const re = globToRegExp("file.name.txt");
    expect(re.test("file.name.txt")).toBe(true);
    expect(re.test("fileXname.txt")).toBe(false);
  });
});

describe("matchesGlob", () => {
  test("uses forward-slash normalization", () => {
    expect(matchesGlob("src\\index.ts", "src/*.ts")).toBe(true);
  });

  test("double star without slash matches any depth", () => {
    expect(matchesGlob("a/b/c/d.ts", "**/*.ts")).toBe(true);
  });
});
