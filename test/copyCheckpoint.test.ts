import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { openCopyCheckpointStore } from "../src/copy/checkpointStore.js";
import { readCopyFailureDetails, readCopyFailureDiagnostics } from "../src/copy/jobRunner.js";
import { DEFAULT_JOB_ID, type CopySpecFileV1 } from "../src/copy/jobTypes.js";

let dir: string;
afterEach(() => {
  if (dir) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    dir = "";
  }
});

describe("CopyCheckpointStore", () => {
  it("round-trips job, items, claim, done", () => {
    dir = mkdtempSync(join(tmpdir(), "imap-copy-"));
    const path = join(dir, "job.sqlite");
    const spec: CopySpecFileV1 = {
      version: 1,
      source: {
        host: "a.example",
        user: "u",
        pass: "p",
      },
      destination: {
        host: "b.example",
        user: "u",
        pass: "p",
      },
      folders: [{ source: "INBOX", destination: "INBOX" }],
    };

    const store = openCopyCheckpointStore(path);
    try {
      store.upsertJob(DEFAULT_JOB_ID, spec);
      store.insertPendingItems(DEFAULT_JOB_ID, [
        { sourceMailbox: "INBOX", destMailbox: "INBOX", sourceUid: 1 },
        { sourceMailbox: "INBOX", destMailbox: "INBOX", sourceUid: 2 },
      ]);

      const row = store.claimNext(DEFAULT_JOB_ID);
      expect(row?.sourceUid).toBe(1);
      store.markAppended(row!.id, {
        sourceSha256: "aa",
        rfc822Size: 10,
        messageId: "<m@x>",
        destUid: 99,
      });
      store.markDone(row!.id);

      const row2 = store.claimNext(DEFAULT_JOB_ID);
      expect(row2?.sourceUid).toBe(2);

      const s = store.stats(DEFAULT_JOB_ID);
      expect(s.done).toBe(1);
      expect(s.pending).toBe(0);
      expect(s.inProgress).toBe(1);
    } finally {
      store.close();
    }
  });

  it("markFailed retries then terminal", () => {
    dir = mkdtempSync(join(tmpdir(), "imap-copy-"));
    const path = join(dir, "job.sqlite");
    const spec: CopySpecFileV1 = {
      version: 1,
      source: { host: "a", user: "u", pass: "p" },
      destination: { host: "b", user: "u", pass: "p" },
      folders: [{ source: "A", destination: "B" }],
    };
    const store = openCopyCheckpointStore(path);
    try {
      store.upsertJob(DEFAULT_JOB_ID, spec);
      store.insertPendingItems(DEFAULT_JOB_ID, [
        { sourceMailbox: "A", destMailbox: "B", sourceUid: 5 },
      ]);
      const row = store.claimNext(DEFAULT_JOB_ID)!;
      store.markFailed(row.id, "e1", 2);
      expect(store.stats(DEFAULT_JOB_ID).pending).toBe(1);
      const row2 = store.claimNext(DEFAULT_JOB_ID)!;
      expect(row2.sourceUid).toBe(5);
      store.markFailed(row2.id, "e2", 2);
      expect(store.stats(DEFAULT_JOB_ID).failed).toBe(1);
    } finally {
      store.close();
    }
  });

  it("failureReasonSummary and readCopyFailureDetails group by message", () => {
    dir = mkdtempSync(join(tmpdir(), "imap-copy-"));
    const path = join(dir, "job.sqlite");
    const spec: CopySpecFileV1 = {
      version: 1,
      source: { host: "a", user: "u", pass: "p" },
      destination: { host: "b", user: "u", pass: "p" },
      folders: [{ source: "X", destination: "Y" }],
    };
    const store = openCopyCheckpointStore(path);
    try {
      store.upsertJob(DEFAULT_JOB_ID, spec);
      store.insertPendingItems(DEFAULT_JOB_ID, [
        { sourceMailbox: "X", destMailbox: "Y", sourceUid: 1 },
        { sourceMailbox: "X", destMailbox: "Y", sourceUid: 2 },
        { sourceMailbox: "X", destMailbox: "Y", sourceUid: 3 },
      ]);
      const a = store.claimNext(DEFAULT_JOB_ID)!;
      store.markTerminalFailure(a.id, "quota");
      const b = store.claimNext(DEFAULT_JOB_ID)!;
      store.markTerminalFailure(b.id, "quota");
      const c = store.claimNext(DEFAULT_JOB_ID)!;
      store.markTerminalFailure(c.id, "no mailbox");

      const summary = store.failureReasonSummary();
      expect(summary).toEqual(
        expect.arrayContaining([
          { reason: "quota", count: 2 },
          { reason: "no mailbox", count: 1 },
        ])
      );
    } finally {
      store.close();
    }

    const details = readCopyFailureDetails(path);
    expect(details.reasons.length).toBe(2);
    expect(details.samples.length).toBe(3);
    expect(details.failedRowCount).toBe(3);
    expect(details.failedJobIds).toContain("default");

    const diag = readCopyFailureDiagnostics(path);
    expect(diag.failedRowCount).toBe(3);
    expect(diag.readException).toBeUndefined();

    const store2 = openCopyCheckpointStore(path);
    try {
      const br = store2.copyItemStatusBreakdown();
      expect(br.some((x) => x.status === "failed" && x.count === 3)).toBe(true);
    } finally {
      store2.close();
    }
  });
});
