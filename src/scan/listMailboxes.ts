import type { ImapFlow } from "imapflow";
import type { ListResponse } from "imapflow";
import type { MailboxSnapshot, StatusResult } from "../report/schema.js";

function statusFromStatusObject(s: {
  messages?: number;
  recent?: number;
  uidNext?: number;
  uidValidity?: bigint;
  unseen?: number;
  highestModseq?: bigint;
}): StatusResult {
  return {
    messages: s.messages,
    recent: s.recent,
    uidNext: s.uidNext,
    uidValidity: s.uidValidity !== undefined ? String(s.uidValidity) : undefined,
    unseen: s.unseen,
    highestModseq: s.highestModseq !== undefined ? String(s.highestModseq) : undefined,
  };
}

function listEntryToSnapshot(entry: ListResponse): MailboxSnapshot {
  const status: StatusResult = entry.status
    ? statusFromStatusObject(entry.status)
    : { error: "status_not_in_list_response" };

  return {
    path: entry.path,
    delimiter: entry.delimiter,
    listed: entry.listed,
    subscribed: entry.subscribed,
    specialUse: entry.specialUse,
    status,
  };
}

/**
 * Lists all mailboxes and requests STATUS for each (single LIST+STATUS pattern via imapflow).
 */
export async function listMailboxesWithStatus(client: ImapFlow): Promise<MailboxSnapshot[]> {
  const entries = await client.list({
    statusQuery: {
      messages: true,
      recent: true,
      uidNext: true,
      uidValidity: true,
      unseen: true,
      highestModseq: true,
    },
  });

  const snapshots = entries.map(listEntryToSnapshot);

  for (const snap of snapshots) {
    if ("error" in snap.status && snap.status.error === "status_not_in_list_response") {
      try {
        const st = await client.status(snap.path, {
          messages: true,
          recent: true,
          uidNext: true,
          uidValidity: true,
          unseen: true,
          highestModseq: true,
        });
        snap.status = statusFromStatusObject(st);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        snap.status = { error: msg };
      }
    }
  }

  return snapshots;
}
