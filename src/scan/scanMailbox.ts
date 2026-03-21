import { createHash } from "crypto";
import type { FetchMessageObject, FetchQueryObject, ImapFlow } from "imapflow";
import {
  computeFingerprintWeak,
  internalDateToIso,
  normalizeMessageId,
  type MessageRow,
  type MailboxSnapshot,
} from "../report/schema.js";

export interface ScanMailboxOptions {
  batchSize: number;
  includeBodyStructure: boolean;
  includeContentSha256: boolean;
  /**
   * When set, only this many UIDs are fetched: the **numerically largest** UIDs
   * in the mailbox (often the most recently added messages).
   */
  limitUids?: number;
  /** Called after each batch; use for progress. */
  onBatch?: (done: number, total: number) => void;
}

function flagsToArray(flags: Set<string> | undefined): string[] {
  if (!flags) return [];
  return [...flags].sort();
}

function fetchRow(msg: FetchMessageObject, includeContentSha256: boolean): MessageRow {
  const env = msg.envelope;
  const messageId = env?.messageId?.trim() ?? null;
  const messageIdNormalized = normalizeMessageId(messageId);
  const internalDate = internalDateToIso(msg.internalDate);
  const rfc822Size = msg.size ?? 0;
  const fingerprintWeak = computeFingerprintWeak(messageIdNormalized, rfc822Size, internalDate);

  const row: MessageRow = {
    uid: msg.uid,
    flags: flagsToArray(msg.flags),
    rfc822Size,
    internalDate,
    messageId,
    messageIdNormalized,
    subject: env?.subject ?? null,
    fingerprintWeak,
  };

  if (msg.emailId) {
    row.providerMessageId = msg.emailId;
  }

  if (includeContentSha256 && msg.source) {
    row.contentSha256 = createHash("sha256").update(msg.source).digest("hex");
  }

  return row;
}

/**
 * Opens the mailbox read-only, fetches all UIDs, then UID FETCHes metadata in batches.
 */
export async function scanMailboxMetadata(
  client: ImapFlow,
  mailboxPath: string,
  options: ScanMailboxOptions
): Promise<MailboxSnapshot> {
  const effectiveBatch =
    options.includeContentSha256 && options.batchSize > 25
      ? 25
      : options.batchSize;

  const base: MailboxSnapshot = {
    path: mailboxPath,
    delimiter: "/",
    listed: true,
    subscribed: true,
    status: { error: "not_fetched" },
  };

  let mb;
  try {
    mb = await client.mailboxOpen(mailboxPath, { readOnly: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ...base,
      scanError: msg,
      status: { error: msg },
    };
  }

  base.delimiter = mb.delimiter;
  base.uidValidity = String(mb.uidValidity);
  base.uidNext = mb.uidNext;
  base.exists = mb.exists;
  base.readOnly = mb.readOnly ?? true;

  const messages: MessageRow[] = [];

  try {
    try {
      const st = await client.status(mailboxPath, {
        messages: true,
        recent: true,
        uidNext: true,
        uidValidity: true,
        unseen: true,
      });
      base.status = {
        messages: st.messages,
        recent: st.recent,
        uidNext: st.uidNext,
        uidValidity: st.uidValidity !== undefined ? String(st.uidValidity) : undefined,
        unseen: st.unseen,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      base.status = { error: msg };
    }

    const uidResult = await client.search({ all: true }, { uid: true });
    let uids = uidResult === false ? [] : [...uidResult].sort((a, b) => a - b);
    const lim = options.limitUids;
    if (lim != null && lim > 0 && uids.length > lim) {
      uids = uids.slice(-lim);
    }
    const total = uids.length;

    const query: FetchQueryObject = {
      uid: true,
      flags: true,
      envelope: true,
      internalDate: true,
      size: true,
    };
    if (options.includeBodyStructure) query.bodyStructure = true;
    if (options.includeContentSha256) query.source = true;

    for (let i = 0; i < uids.length; i += effectiveBatch) {
      const chunk = uids.slice(i, i + effectiveBatch);
      for await (const msg of client.fetch(chunk, query, { uid: true })) {
        messages.push(fetchRow(msg, options.includeContentSha256));
      }
      options.onBatch?.(Math.min(i + effectiveBatch, total), total);
    }
  } finally {
    try {
      await client.mailboxClose();
    } catch {
      /* ignore close errors after a failed scan */
    }
  }

  base.messages = messages;
  return base;
}
