import type { ImapConnectionInput } from "../imap/config.js";

export const COPY_SPEC_VERSION = 1 as const;

export type CopyItemStatus =
  | "pending"
  | "in_progress"
  | "appended"
  | "done"
  | "failed"
  | "skipped";

export interface CopyFolderPair {
  source: string;
  destination: string;
}

/** On-disk / API migration spec (passwords live here — protect file permissions). */
export interface CopySpecFileV1 {
  version: typeof COPY_SPEC_VERSION;
  source: ImapConnectionInput;
  destination: ImapConnectionInput;
  folders: CopyFolderPair[];
  /** Parallel in-flight messages (default 2). */
  concurrency?: number;
  /** Failed rows are retried until this many attempts (default 5). */
  maxRetries?: number;
}

export interface CopyJobMeta {
  jobId: string;
  spec: CopySpecFileV1;
  paused: boolean;
  createdAt: string;
}

export interface CopyItemRow {
  id: number;
  jobId: string;
  sourceMailbox: string;
  destMailbox: string;
  sourceUid: number;
  status: CopyItemStatus;
  attempts: number;
  sourceSha256: string | null;
  rfc822Size: number | null;
  destUid: number | null;
  messageId: string | null;
  failReason: string | null;
}

export interface CopyJobStats {
  pending: number;
  inProgress: number;
  appended: number;
  done: number;
  failed: number;
  skipped: number;
  total: number;
}

export const DEFAULT_JOB_ID = "default";
