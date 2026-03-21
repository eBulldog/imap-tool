import type { ImapFlow } from "imapflow";

export class FetchRawError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchRawError";
  }
}

/**
 * Returns raw RFC822 bytes for a UID in the given mailbox (opens read-only, then closes).
 */
export async function fetchRawRfc822ByUid(
  client: ImapFlow,
  mailboxPath: string,
  uid: number
): Promise<{ raw: Buffer; rfc822Size: number }> {
  await client.mailboxOpen(mailboxPath, { readOnly: true });
  try {
    let buf: Buffer | undefined;
    for await (const msg of client.fetch(
      uid,
      { source: true, size: true, uid: true },
      { uid: true }
    )) {
      if (!msg.source) {
        throw new FetchRawError(`UID ${uid}: empty source in FETCH response`);
      }
      buf = msg.source;
      break;
    }
    if (!buf) {
      throw new FetchRawError(`UID ${uid}: not found in ${mailboxPath}`);
    }
    return { raw: buf, rfc822Size: buf.length };
  } finally {
    await client.mailboxClose();
  }
}
