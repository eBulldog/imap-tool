import { describe, expect, it } from "vitest";
import { ConfigError } from "../src/imap/config.js";
import {
  assertValidCopyJobId,
  isValidCopyJobId,
} from "../src/ui-server/copyJobId.js";

describe("copyJobId", () => {
  const sample = "550e8400-e29b-41d4-a716-446655440000";

  it("accepts RFC4122 UUID strings", () => {
    expect(isValidCopyJobId(sample)).toBe(true);
    expect(isValidCopyJobId(sample.toUpperCase())).toBe(true);
    expect(assertValidCopyJobId(sample)).toBe(sample);
    expect(assertValidCopyJobId(" " + sample.toUpperCase() + " ")).toBe(sample);
  });

  it("rejects traversal and non-UUID", () => {
    expect(isValidCopyJobId("../etc/passwd")).toBe(false);
    expect(isValidCopyJobId("not-a-uuid")).toBe(false);
    expect(isValidCopyJobId("")).toBe(false);
    expect(() => assertValidCopyJobId("../x")).toThrow(ConfigError);
  });
});
