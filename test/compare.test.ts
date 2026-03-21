import { describe, expect, it } from "vitest";
import {
  REPORT_TYPE_ACCOUNT_SCAN,
  SCHEMA_VERSION,
  type AccountScanReport,
} from "../src/report/schema.js";
import { compareAccountScans } from "../src/compare/compareReports.js";

function row(
  uid: number,
  fp: string,
  size: number
): import("../src/report/schema.js").MessageRow {
  return {
    uid,
    flags: [],
    rfc822Size: size,
    internalDate: "2020-01-01T00:00:00.000Z",
    messageId: null,
    messageIdNormalized: null,
    subject: null,
    fingerprintWeak: fp,
  };
}

describe("compareAccountScans", () => {
  it("finds missing and unexpected with multiset counts", () => {
    const source: AccountScanReport = {
      schemaVersion: SCHEMA_VERSION,
      reportType: REPORT_TYPE_ACCOUNT_SCAN,
      generatedAt: "t",
      connection: { host: "a", user: "u" },
      scanOptions: {
        batchSize: 1,
        includeBodyStructure: false,
        includeContentSha256: false,
      },
      mailboxes: [
        {
          path: "INBOX",
          delimiter: "/",
          listed: true,
          subscribed: true,
          status: { messages: 2 },
          uidValidity: "1",
          messages: [row(1, "fp-a", 10), row(2, "fp-b", 20)],
        },
      ],
    };
    const dest: AccountScanReport = {
      ...source,
      mailboxes: [
        {
          path: "INBOX",
          delimiter: "/",
          listed: true,
          subscribed: true,
          status: { messages: 2 },
          uidValidity: "2",
          messages: [row(9, "fp-a", 10), row(10, "fp-c", 30)],
        },
      ],
    };
    const c = compareAccountScans(source, dest, null);
    const p = c.pairs[0];
    expect(p.missingInDest).toEqual(["fp-b"]);
    expect(p.unexpectedInDest).toEqual(["fp-c"]);
    expect(p.uidValidityMatch).toBe(false);
  });

  it("uses folder mapping", () => {
    const source: AccountScanReport = {
      schemaVersion: SCHEMA_VERSION,
      reportType: REPORT_TYPE_ACCOUNT_SCAN,
      generatedAt: "t",
      connection: { host: "a", user: "u" },
      scanOptions: {
        batchSize: 1,
        includeBodyStructure: false,
        includeContentSha256: false,
      },
      mailboxes: [
        {
          path: "A",
          delimiter: "/",
          listed: true,
          subscribed: true,
          status: {},
          uidValidity: "1",
          messages: [row(1, "x", 1)],
        },
      ],
    };
    const dest: AccountScanReport = {
      ...source,
      mailboxes: [
        {
          path: "B",
          delimiter: "/",
          listed: true,
          subscribed: true,
          status: {},
          uidValidity: "1",
          messages: [row(1, "x", 1)],
        },
      ],
    };
    const c = compareAccountScans(source, dest, { A: "B" });
    expect(c.pairs).toHaveLength(1);
    expect(c.pairs[0].missingInDest).toEqual([]);
  });
});
