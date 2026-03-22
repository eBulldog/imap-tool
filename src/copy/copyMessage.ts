import { createHash } from "crypto";
import type { ImapFlow } from "imapflow";
import type { CopyCheckpointStore } from "./checkpointStore.js";
import { ensureDestinationMailboxCached } from "./ensureDestMailbox.js";
import { formatImapFlowError } from "./imapErrors.js";
import type { CopyItemRow } from "./jobTypes.js";

export class CopyVerifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CopyVerifyError";
  }
}

export interface ProcessCopyItemOptions {
  store: CopyCheckpointStore;
  maxRetries: number;
  source: ImapFlow;
  dest: ImapFlow;
  /** Per-worker cache so each destination folder is ensured once per connection. */
  destMailboxesEnsured: Set<string>;
}

function flagsForAppend(flags: Set<string> | undefined): string[] | undefined {
  if (!flags?.size) return undefined;
  return [...flags];
}

async function fetchFromSource(
  client: ImapFlow,
  mailbox: string,
  uid: number
): Promise<{
  raw: Buffer;
  sourceSha256: string;
  rfc822Size: number;
  internalDate: Date | string | undefined;
  flags: Set<string> | undefined;
  messageId: string | null;
}> {
  await client.mailboxOpen(mailbox, { readOnly: true });
  try {
    for await (const msg of client.fetch(
      uid,
      {
        source: true,
        uid: true,
        flags: true,
        internalDate: true,
        envelope: true,
        size: true,
      },
      { uid: true }
    )) {
      if (!msg.source) {
        throw new Error(`UID ${uid}: empty source`);
      }
      const raw = msg.source;
      const sourceSha256 = createHash("sha256").update(raw).digest("hex");
      return {
        raw,
        sourceSha256,
        rfc822Size: raw.length,
        internalDate: msg.internalDate,
        flags: msg.flags,
        messageId: msg.envelope?.messageId?.trim() ?? null,
      };
    }
    throw new Error(`UID ${uid}: not found in ${mailbox}`);
  } finally {
    await client.mailboxClose();
  }
}

async function findDestUidByMessageId(
  client: ImapFlow,
  destMailbox: string,
  messageId: string | null,
  expectedSize: number
): Promise<number | null> {
  if (!messageId) return null;
  await client.mailboxOpen(destMailbox, { readOnly: true });
  try {
    const uids = await client.search({ header: { "message-id": messageId } }, { uid: true });
    if (!uids || uids.length === 0) return null;
    const list = [...uids];
    if (list.length === 1) {
      for await (const msg of client.fetch(list[0], { uid: true, size: true }, { uid: true })) {
        if (msg.size === expectedSize) return list[0];
      }
      return null;
    }
    let match: number | null = null;
    for await (const msg of client.fetch(list, { uid: true, size: true }, { uid: true })) {
      if (msg.size !== expectedSize) continue;
      if (match != null) return null;
      match = msg.uid;
    }
    return match;
  } finally {
    await client.mailboxClose();
  }
}

async function verifyDest(
  client: ImapFlow,
  destMailbox: string,
  destUid: number,
  expectedSha256: string
): Promise<void> {
  await client.mailboxOpen(destMailbox, { readOnly: true });
  try {
    for await (const msg of client.fetch(
      destUid,
      { source: true, uid: true },
      { uid: true }
    )) {
      if (!msg.source) {
        throw new CopyVerifyError(`dest UID ${destUid}: empty source`);
      }
      const h = createHash("sha256").update(msg.source).digest("hex");
      if (h !== expectedSha256) {
        throw new CopyVerifyError(
          `dest UID ${destUid}: sha256 mismatch (expected ${expectedSha256}, got ${h})`
        );
      }
      return;
    }
    throw new CopyVerifyError(`dest UID ${destUid}: not found in ${destMailbox}`);
  } finally {
    await client.mailboxClose();
  }
}

/**
 * Runs bulletproof copy for one checkpoint row: FETCH source → APPEND dest → FETCH dest → hash match.
 */
export async function processCopyItem(
  row: CopyItemRow,
  opts: ProcessCopyItemOptions
): Promise<void> {
  const { store, maxRetries, source, dest } = opts;
  const verifyOnly = row.destUid != null && row.sourceSha256 != null;

  if (verifyOnly) {
    try {
      await verifyDest(dest, row.destMailbox, row.destUid!, row.sourceSha256!);
      store.markDone(row.id);
    } catch (e) {
      const msg = formatImapFlowError(e);
      if (e instanceof CopyVerifyError) {
        store.markTerminalFailure(row.id, `verify: ${msg}`);
      } else {
        store.requeueAppended(row.id, `verify: ${msg}`);
      }
    }
    return;
  }

  let stage: "before_append" | "after_append" = "before_append";

  try {
    const fetched = await fetchFromSource(source, row.sourceMailbox, row.sourceUid);

    await ensureDestinationMailboxCached(dest, row.destMailbox, opts.destMailboxesEnsured);

    let destUid = await findDestUidByMessageId(
      dest,
      row.destMailbox,
      fetched.messageId,
      fetched.rfc822Size
    );

    if (destUid != null) {
      await verifyDest(dest, row.destMailbox, destUid, fetched.sourceSha256);
      store.markAppended(row.id, {
        sourceSha256: fetched.sourceSha256,
        rfc822Size: fetched.rfc822Size,
        messageId: fetched.messageId,
        destUid,
      });
      store.markDone(row.id);
      return;
    }

    let appendRes: Awaited<ReturnType<ImapFlow["append"]>>;
    try {
      appendRes = await dest.append(
        row.destMailbox,
        fetched.raw,
        flagsForAppend(fetched.flags),
        fetched.internalDate
      );
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (/APPENDLIMIT|too large|maximum.*append|literal.*big/i.test(m)) {
        throw new Error(`APPEND rejected (provider size/limit): ${m}`);
      }
      throw e;
    }

    if (!appendRes || appendRes.uid == null) {
      const found = await findDestUidByMessageId(
        dest,
        row.destMailbox,
        fetched.messageId,
        fetched.rfc822Size
      );
      if (found == null) {
        throw new Error("APPEND did not return UID and message not found by Message-ID");
      }
      destUid = found;
    } else {
      destUid = appendRes.uid;
    }

    store.markAppended(row.id, {
      sourceSha256: fetched.sourceSha256,
      rfc822Size: fetched.rfc822Size,
      messageId: fetched.messageId,
      destUid,
    });
    stage = "after_append";

    await verifyDest(dest, row.destMailbox, destUid, fetched.sourceSha256);
    store.markDone(row.id);
  } catch (e) {
    const msg = formatImapFlowError(e);
    if (e instanceof CopyVerifyError) {
      store.markTerminalFailure(row.id, msg);
      return;
    }
    if (stage === "after_append") {
      store.requeueAppended(row.id, msg);
    } else {
      store.markFailed(row.id, msg, maxRetries);
    }
  }
}
