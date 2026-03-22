import { describe, expect, it } from "vitest";
import { ConfigError } from "../src/imap/config.js";
import { parseCopySpecJson } from "../src/copy/spec.js";

describe("parseCopySpecJson", () => {
  const minimal = {
    version: 1,
    source: { host: "a.example", user: "u", pass: "p" },
    destination: { host: "b.example", user: "u", pass: "p" },
    folders: [{ source: "INBOX", destination: "INBOX" }],
  };

  it("accepts a valid v1 spec", () => {
    const s = parseCopySpecJson(minimal);
    expect(s.version).toBe(1);
    expect(s.folders).toHaveLength(1);
    expect(s.concurrency).toBeUndefined();
  });

  it("clamps concurrency and maxRetries", () => {
    const s = parseCopySpecJson({
      ...minimal,
      concurrency: 999,
      maxRetries: 9999,
    });
    expect(s.concurrency).toBe(32);
    expect(s.maxRetries).toBe(100);
  });

  it("rejects wrong version and bad folders", () => {
    expect(() => parseCopySpecJson({ ...minimal, version: 2 })).toThrow(ConfigError);
    expect(() => parseCopySpecJson({ ...minimal, folders: [] })).toThrow(ConfigError);
    expect(() =>
      parseCopySpecJson({
        ...minimal,
        folders: [{ source: "", destination: "X" }],
      })
    ).toThrow(ConfigError);
  });
});
