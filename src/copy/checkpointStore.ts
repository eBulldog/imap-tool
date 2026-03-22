import Database from "better-sqlite3";
import type {
  CopyItemRow,
  CopyItemStatus,
  CopyJobMeta,
  CopyJobStats,
  CopySpecFileV1,
} from "./jobTypes.js";
import { DEFAULT_JOB_ID } from "./jobTypes.js";

function rowToItem(r: {
  id: number;
  job_id: string;
  source_mailbox: string;
  dest_mailbox: string;
  source_uid: number;
  status: string;
  attempts: number;
  source_sha256: string | null;
  rfc822_size: number | null;
  dest_uid: number | null;
  message_id: string | null;
  fail_reason: string | null;
}): CopyItemRow {
  return {
    id: r.id,
    jobId: r.job_id,
    sourceMailbox: r.source_mailbox,
    destMailbox: r.dest_mailbox,
    sourceUid: r.source_uid,
    status: r.status as CopyItemStatus,
    attempts: r.attempts,
    sourceSha256: r.source_sha256,
    rfc822Size: r.rfc822_size,
    destUid: r.dest_uid,
    messageId: r.message_id,
    failReason: r.fail_reason,
  };
}

/**
 * SQLite-backed durable state for a verified two-host copy job.
 */
export class CopyCheckpointStore {
  readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.ensureSchema();
  }

  close(): void {
    this.db.close();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS copy_job (
        id TEXT PRIMARY KEY,
        spec_json TEXT NOT NULL,
        paused INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS copy_item (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        source_mailbox TEXT NOT NULL,
        dest_mailbox TEXT NOT NULL,
        source_uid INTEGER NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        source_sha256 TEXT,
        rfc822_size INTEGER,
        dest_uid INTEGER,
        message_id TEXT,
        fail_reason TEXT,
        UNIQUE(job_id, source_mailbox, source_uid)
      );

      CREATE INDEX IF NOT EXISTS idx_copy_item_claim
        ON copy_item (job_id, status, source_mailbox, source_uid);
    `);
  }

  getJob(jobId = DEFAULT_JOB_ID): CopyJobMeta | null {
    const row = this.db
      .prepare(`SELECT id, spec_json, paused, created_at FROM copy_job WHERE id = ?`)
      .get(jobId) as
      | { id: string; spec_json: string; paused: number; created_at: string }
      | undefined;
    if (!row) return null;
    const spec = JSON.parse(row.spec_json) as CopySpecFileV1;
    return {
      jobId: row.id,
      spec,
      paused: row.paused !== 0,
      createdAt: row.created_at,
    };
  }

  upsertJob(jobId: string, spec: CopySpecFileV1): void {
    const now = new Date().toISOString();
    const specJson = JSON.stringify(spec);
    this.db
      .prepare(
        `INSERT INTO copy_job (id, spec_json, paused, created_at)
         VALUES (@id, @spec_json, 0, @created_at)
         ON CONFLICT(id) DO UPDATE SET spec_json = excluded.spec_json`
      )
      .run({ id: jobId, spec_json: specJson, created_at: now });
  }

  insertPendingItems(
    jobId: string,
    rows: Array<{ sourceMailbox: string; destMailbox: string; sourceUid: number }>
  ): void {
    const ins = this.db.prepare(
      `INSERT OR IGNORE INTO copy_item
        (job_id, source_mailbox, dest_mailbox, source_uid, status, attempts)
       VALUES (?, ?, ?, ?, 'pending', 0)`
    );
    const tx = this.db.transaction(() => {
      for (const r of rows) {
        ins.run(jobId, r.sourceMailbox, r.destMailbox, r.sourceUid);
      }
    });
    tx();
  }

  itemCount(jobId = DEFAULT_JOB_ID): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS c FROM copy_item WHERE job_id = ?`)
      .get(jobId) as { c: number };
    return row.c;
  }

  setPaused(jobId: string, paused: boolean): void {
    this.db.prepare(`UPDATE copy_job SET paused = ? WHERE id = ?`).run(paused ? 1 : 0, jobId);
  }

  isPaused(jobId = DEFAULT_JOB_ID): boolean {
    const row = this.db
      .prepare(`SELECT paused FROM copy_job WHERE id = ?`)
      .get(jobId) as { paused: number } | undefined;
    return row ? row.paused !== 0 : false;
  }

  /** Recover rows left mid-flight by a dead worker. */
  resetStaleInProgress(jobId = DEFAULT_JOB_ID): number {
    const info = this.db
      .prepare(
        `UPDATE copy_item SET status = 'pending', fail_reason = 'recovered stale in_progress'
         WHERE job_id = ? AND status = 'in_progress'`
      )
      .run(jobId);
    return info.changes;
  }

  /**
   * Claims the next unit of work: pending, retriable failed, or appended (verify pending).
   */
  claimNext(jobId: string): CopyItemRow | null {
    const row = this.db
      .prepare(
        `UPDATE copy_item SET status = 'in_progress'
         WHERE id = (
           SELECT id FROM copy_item
           WHERE job_id = @job_id
             AND (status = 'pending' OR status = 'appended')
           ORDER BY CASE WHEN status = 'appended' THEN 0 ELSE 1 END,
             source_mailbox, source_uid
           LIMIT 1
         )
         RETURNING id, job_id, source_mailbox, dest_mailbox, source_uid, status, attempts,
           source_sha256, rfc822_size, dest_uid, message_id, fail_reason`
      )
      .get({ job_id: jobId }) as
      | {
          id: number;
          job_id: string;
          source_mailbox: string;
          dest_mailbox: string;
          source_uid: number;
          status: string;
          attempts: number;
          source_sha256: string | null;
          rfc822_size: number | null;
          dest_uid: number | null;
          message_id: string | null;
          fail_reason: string | null;
        }
      | undefined;
    return row ? rowToItem(row) : null;
  }

  markAppended(
    id: number,
    fields: {
      sourceSha256: string;
      rfc822Size: number;
      messageId: string | null;
      destUid: number;
    }
  ): void {
    this.db
      .prepare(
        `UPDATE copy_item SET
          status = 'appended',
          source_sha256 = @sha,
          rfc822_size = @size,
          message_id = @mid,
          dest_uid = @duid,
          fail_reason = NULL
         WHERE id = @id`
      )
      .run({
        id,
        sha: fields.sourceSha256,
        size: fields.rfc822Size,
        mid: fields.messageId,
        duid: fields.destUid,
      });
  }

  markDone(id: number): void {
    this.db
      .prepare(`UPDATE copy_item SET status = 'done', fail_reason = NULL WHERE id = ?`)
      .run(id);
  }

  markFailed(id: number, reason: string, maxRetries: number): void {
    const row = this.db
      .prepare(`SELECT attempts FROM copy_item WHERE id = ?`)
      .get(id) as { attempts: number } | undefined;
    const nextAttempts = (row?.attempts ?? 0) + 1;
    const terminal = nextAttempts >= maxRetries;
    if (terminal) {
      this.db
        .prepare(
          `UPDATE copy_item SET attempts = ?, status = 'failed', fail_reason = ? WHERE id = ?`
        )
        .run(nextAttempts, reason, id);
    } else {
      this.db
        .prepare(
          `UPDATE copy_item SET
            attempts = ?,
            status = 'pending',
            fail_reason = ?,
            dest_uid = NULL,
            source_sha256 = NULL,
            rfc822_size = NULL,
            message_id = NULL
           WHERE id = ?`
        )
        .run(nextAttempts, reason, id);
    }
  }

  markSkipped(id: number, reason: string): void {
    this.db
      .prepare(
        `UPDATE copy_item SET status = 'skipped', fail_reason = @reason WHERE id = @id`
      )
      .run({ id, reason });
  }

  /** Hard failure (e.g. verify hash mismatch); keeps dest_uid / sha for inspection. */
  markTerminalFailure(id: number, reason: string): void {
    this.db
      .prepare(`UPDATE copy_item SET status = 'failed', fail_reason = ? WHERE id = ?`)
      .run(reason, id);
  }

  /** After APPEND persisted, verify failed transiently — return row to appended queue. */
  requeueAppended(id: number, reason: string): void {
    this.db
      .prepare(`UPDATE copy_item SET status = 'appended', fail_reason = ? WHERE id = ?`)
      .run(reason, id);
  }

  stats(jobId = DEFAULT_JOB_ID): CopyJobStats {
    const rows = this.db
      .prepare(
        `SELECT status, COUNT(*) AS c FROM copy_item WHERE job_id = ? GROUP BY status`
      )
      .all(jobId) as { status: string; c: number }[];
    const s: CopyJobStats = {
      pending: 0,
      inProgress: 0,
      appended: 0,
      done: 0,
      failed: 0,
      skipped: 0,
      total: 0,
    };
    for (const r of rows) {
      s.total += r.c;
      switch (r.status) {
        case "pending":
          s.pending += r.c;
          break;
        case "in_progress":
          s.inProgress += r.c;
          break;
        case "appended":
          s.appended += r.c;
          break;
        case "done":
          s.done += r.c;
          break;
        case "failed":
          s.failed += r.c;
          break;
        case "skipped":
          s.skipped += r.c;
          break;
        default:
          break;
      }
    }
    return s;
  }

  /**
   * Groups failed rows by `fail_reason` for the whole store (one migration job per file).
   * Intentionally **not** filtered by `job_id` so diagnostics match rows even if `job_id` drifted.
   */
  failureReasonSummary(maxGroups = 25): { reason: string; count: number }[] {
    const rows = this.db
      .prepare(
        `SELECT fail_reason, COUNT(*) AS c
         FROM copy_item
         WHERE status = 'failed'
         GROUP BY fail_reason
         ORDER BY c DESC
         LIMIT ?`
      )
      .all(maxGroups) as { fail_reason: string | null; c: number }[];
    return rows.map((r) => ({
      reason: r.fail_reason?.trim() ? r.fail_reason : "(no reason recorded)",
      count: r.c,
    }));
  }

  /**
   * Example failed rows (stable order by row id), all failed rows in the file.
   */
  failureSamples(limit = 50): { sourceMailbox: string; sourceUid: number; failReason: string }[] {
    const rows = this.db
      .prepare(
        `SELECT source_mailbox, source_uid, fail_reason
         FROM copy_item
         WHERE status = 'failed'
         ORDER BY id
         LIMIT ?`
      )
      .all(limit) as {
        source_mailbox: string;
        source_uid: number;
        fail_reason: string | null;
      }[];
    return rows.map((r) => ({
      sourceMailbox: r.source_mailbox,
      sourceUid: r.source_uid,
      failReason: r.fail_reason?.trim() ? r.fail_reason : "(no reason recorded)",
    }));
  }

  /** Count failed rows in file (ignores job_id). */
  countFailedRowsUnscoped(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS c FROM copy_item WHERE status = 'failed'`)
      .get() as { c: number };
    return row.c;
  }

  /** Distinct job_id on failed rows (debugging). */
  distinctFailedJobIds(): string[] {
    const rows = this.db
      .prepare(
        `SELECT job_id FROM copy_item WHERE status = 'failed' GROUP BY job_id ORDER BY COUNT(*) DESC`
      )
      .all() as { job_id: string }[];
    return rows.map((r) => r.job_id);
  }
}

/**
 * Opens (and creates) a checkpoint database at the given path.
 */
export function openCopyCheckpointStore(path: string): CopyCheckpointStore {
  return new CopyCheckpointStore(path);
}
