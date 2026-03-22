import { readFileSync } from "fs";
import { createImapClient } from "../imap/createClient.js";
import { ConfigError, resolvedConfigFromInput, type ResolvedImapConfig } from "../imap/config.js";
import { openCopyCheckpointStore, type CopyCheckpointStore } from "./checkpointStore.js";
import { processCopyItem } from "./copyMessage.js";
import { parseCopySpecJson } from "./spec.js";
import { DEFAULT_JOB_ID, type CopyJobStats, type CopySpecFileV1 } from "./jobTypes.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Inserts pending rows from the source mailbox UID space (idempotent per UID).
 */
export async function populateCopyItemsFromSource(
  store: CopyCheckpointStore,
  jobId: string,
  spec: CopySpecFileV1,
  sourceCfg: ResolvedImapConfig
): Promise<void> {
  if (store.itemCount(jobId) > 0) return;

  const client = createImapClient(sourceCfg);
  await client.connect();
  try {
    const batch: Array<{
      sourceMailbox: string;
      destMailbox: string;
      sourceUid: number;
    }> = [];

    for (const pair of spec.folders) {
      await client.mailboxOpen(pair.source, { readOnly: true });
      try {
        const uidResult = await client.search({ all: true }, { uid: true });
        const uids =
          uidResult === false ? [] : [...uidResult].sort((a, b) => a - b);
        for (const uid of uids) {
          batch.push({
            sourceMailbox: pair.source,
            destMailbox: pair.destination,
            sourceUid: uid,
          });
        }
      } finally {
        await client.mailboxClose();
      }
    }

    store.insertPendingItems(jobId, batch);
  } finally {
    await client.logout();
  }
}

export interface RunCopyJobOptions {
  storePath: string;
  /** Required when the store has no items yet. */
  specPath?: string;
  jobId?: string;
  /** Overrides spec.concurrency when set. */
  concurrency?: number;
  onProgress?: (stats: CopyJobStats) => void;
  isStopped?: () => boolean;
}

function workRemaining(s: CopyJobStats): boolean {
  return s.pending + s.appended + s.inProgress > 0;
}

async function copyWorkerLoop(
  store: CopyCheckpointStore,
  jobId: string,
  maxRetries: number,
  sourceCfg: ResolvedImapConfig,
  destCfg: ResolvedImapConfig,
  isStopped: () => boolean
): Promise<void> {
  const source = createImapClient(sourceCfg);
  const dest = createImapClient(destCfg);
  await source.connect();
  await dest.connect();
  try {
    while (!isStopped()) {
      while (store.isPaused(jobId) && !isStopped()) {
        await sleep(400);
      }
      if (isStopped()) break;

      const row = store.claimNext(jobId);
      if (!row) {
        await sleep(150);
        const s = store.stats(jobId);
        if (!workRemaining(s)) return;
        continue;
      }

      await processCopyItem(row, { store, maxRetries, source, dest });
    }
  } finally {
    await dest.logout().catch(() => undefined);
    await source.logout().catch(() => undefined);
  }
}

/**
 * Runs a bulletproof two-host copy until the queue is drained or `isStopped` is true.
 */
export async function runCopyJob(options: RunCopyJobOptions): Promise<CopyJobStats> {
  const jobId = options.jobId ?? DEFAULT_JOB_ID;
  const store = openCopyCheckpointStore(options.storePath);

  let spec: CopySpecFileV1;
  try {
    const existing = store.getJob(jobId);
    const count = store.itemCount(jobId);

    if (!existing && count === 0) {
      if (!options.specPath) {
        throw new ConfigError("copy run: --spec is required when the store is new or empty");
      }
      const raw = readFileSync(options.specPath, "utf8");
      spec = parseCopySpecJson(JSON.parse(raw));
      store.upsertJob(jobId, spec);
    } else if (existing) {
      spec = existing.spec;
    } else {
      throw new ConfigError("copy store has items but no job metadata (corrupt?)");
    }

    const sourceCfg = resolvedConfigFromInput(spec.source);
    const destCfg = resolvedConfigFromInput(spec.destination);

    await populateCopyItemsFromSource(store, jobId, spec, sourceCfg);
    store.resetStaleInProgress(jobId);

    const maxRetries = spec.maxRetries ?? 5;
    const n = Math.max(
      1,
      Math.min(
        32,
        options.concurrency ?? spec.concurrency ?? 2
      )
    );

    const isStopped = options.isStopped ?? (() => false);
    await Promise.all(
      Array.from({ length: n }, () =>
        copyWorkerLoop(store, jobId, maxRetries, sourceCfg, destCfg, isStopped)
      )
    );

    return store.stats(jobId);
  } finally {
    store.close();
  }
}

export interface CopyStatusSnapshot {
  stats: CopyJobStats;
  paused: boolean;
  createdAt: string;
}

/**
 * Reads checkpoint state for status / monitoring.
 */
export function readCopyStatus(
  storePath: string,
  jobId = DEFAULT_JOB_ID
): CopyStatusSnapshot {
  const store = openCopyCheckpointStore(storePath);
  try {
    const meta = store.getJob(jobId);
    if (!meta) {
      throw new ConfigError("no copy job in store");
    }
    return {
      stats: store.stats(jobId),
      paused: meta.paused,
      createdAt: meta.createdAt,
    };
  } finally {
    store.close();
  }
}

export function setCopyPaused(
  storePath: string,
  paused: boolean,
  jobId = DEFAULT_JOB_ID
): void {
  const store = openCopyCheckpointStore(storePath);
  try {
    if (!store.getJob(jobId)) {
      throw new ConfigError("no copy job in store");
    }
    store.setPaused(jobId, paused);
  } finally {
    store.close();
  }
}

export interface CopyFailureReasonRow {
  reason: string;
  count: number;
}

export interface CopyFailureSampleRow {
  sourceMailbox: string;
  sourceUid: number;
  failReason: string;
}

export interface CopyFailureDetails {
  reasons: CopyFailureReasonRow[];
  samples: CopyFailureSampleRow[];
}

/**
 * Reads grouped failure messages and sample rows for UI / CLI diagnostics.
 */
export function readCopyFailureDetails(
  storePath: string,
  jobId = DEFAULT_JOB_ID,
  opts?: { maxReasonGroups?: number; sampleLimit?: number }
): CopyFailureDetails {
  const store = openCopyCheckpointStore(storePath);
  try {
    if (!store.getJob(jobId)) {
      throw new ConfigError("no copy job in store");
    }
    return {
      reasons: store.failureReasonSummary(jobId, opts?.maxReasonGroups ?? 25),
      samples: store.failureSamples(jobId, opts?.sampleLimit ?? 50),
    };
  } finally {
    store.close();
  }
}
