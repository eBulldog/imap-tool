import type { ImapFlow } from "imapflow";
import type { MailboxSnapshot } from "../report/schema.js";
import { scanMailboxMetadata, type ScanMailboxOptions } from "./scanMailbox.js";

/**
 * Runs a metadata scan for every mailbox in `list` (sorted by path). Preserves `listed` / `subscribed` / `specialUse` from the list pass when the scan omits them.
 */
export async function scanAllMailboxes(
  client: ImapFlow,
  list: MailboxSnapshot[],
  options: ScanMailboxOptions
): Promise<MailboxSnapshot[]> {
  const sorted = [...list].sort((a, b) => a.path.localeCompare(b.path));
  const out: MailboxSnapshot[] = [];

  for (const snap of sorted) {
    const scanned = await scanMailboxMetadata(client, snap.path, options);
    out.push({
      ...scanned,
      specialUse: scanned.specialUse ?? snap.specialUse,
      listed: snap.listed,
      subscribed: snap.subscribed,
    });
  }

  return out;
}
