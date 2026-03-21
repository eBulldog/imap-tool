import { describe, expect, it } from "vitest";
import {
  SCHEMA_VERSION,
  assertAccountScanReport,
  computeFingerprintWeak,
  normalizeMessageId,
  ReportValidationError,
  REPORT_TYPE_ACCOUNT_SCAN,
} from "../src/report/schema.js";

describe("normalizeMessageId", () => {
  it("trims angle brackets and whitespace", () => {
    expect(normalizeMessageId("  <foo@bar>  ")).toBe("foo@bar");
    expect(normalizeMessageId("a  b@c.d")).toBe("a b@c.d");
  });

  it("returns null for empty", () => {
    expect(normalizeMessageId("")).toBeNull();
    expect(normalizeMessageId(null)).toBeNull();
  });
});

describe("computeFingerprintWeak", () => {
  it("is stable for same inputs", () => {
    const a = computeFingerprintWeak("id@x", 42, "2020-01-01T00:00:00.000Z");
    const b = computeFingerprintWeak("id@x", 42, "2020-01-01T00:00:00.000Z");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when size changes", () => {
    const a = computeFingerprintWeak("id@x", 42, null);
    const b = computeFingerprintWeak("id@x", 43, null);
    expect(a).not.toBe(b);
  });
});

describe("assertAccountScanReport", () => {
  it("accepts a minimal valid report", () => {
    const r = {
      schemaVersion: SCHEMA_VERSION,
      reportType: REPORT_TYPE_ACCOUNT_SCAN,
      generatedAt: "x",
      connection: { host: "h", user: "u" },
      scanOptions: {
        batchSize: 1,
        includeBodyStructure: false,
        includeContentSha256: false,
      },
      mailboxes: [],
    };
    expect(assertAccountScanReport(r)).toBe(r);
  });

  it("rejects wrong schema", () => {
    expect(() =>
      assertAccountScanReport({
        schemaVersion: 999,
        reportType: REPORT_TYPE_ACCOUNT_SCAN,
        mailboxes: [],
      })
    ).toThrow(ReportValidationError);
  });
});
