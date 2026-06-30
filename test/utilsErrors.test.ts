import { describe, expect, test } from "bun:test";
import { errorToMessage, UserVisibleError } from "../src/utils/errors";

describe("UserVisibleError", () => {
  test("sets name and message", () => {
    const err = new UserVisibleError("something went wrong");
    expect(err.name).toBe("UserVisibleError");
    expect(err.message).toBe("something went wrong");
  });

  test("is instanceof Error", () => {
    expect(new UserVisibleError("x")).toBeInstanceOf(Error);
  });
});

describe("errorToMessage", () => {
  test("extracts message from Error", () => {
    expect(errorToMessage(new Error("oops"))).toBe("oops");
  });

  test("extracts message from UserVisibleError", () => {
    expect(errorToMessage(new UserVisibleError("visible"))).toBe("visible");
  });

  test("stringifies non-Error values", () => {
    expect(errorToMessage(42)).toBe("42");
    expect(errorToMessage(null)).toBe("null");
    expect(errorToMessage(undefined)).toBe("undefined");
  });
});
