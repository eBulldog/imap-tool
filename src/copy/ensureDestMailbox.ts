import type { ImapFlow } from "imapflow";

const delimiterByClient = new WeakMap<ImapFlow, string>();

/**
 * Returns hierarchy segments for a mailbox path using the server's LIST delimiter.
 * If the path does not contain that delimiter, it is treated as a single mailbox name.
 */
export function mailboxPathSegments(fullPath: string, delimiter: string): string[] {
  const trimmed = fullPath.trim();
  if (!trimmed) return [];
  if (!trimmed.includes(delimiter)) return [trimmed];
  return trimmed
    .split(delimiter)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Builds cumulative paths (e.g. ["a", "a.b", "a.b.c"]) for CREATE from segments.
 */
export function cumulativeMailboxPaths(segments: string[], delimiter: string): string[] {
  if (segments.length === 0) return [];
  const out: string[] = [];
  let acc = "";
  for (let i = 0; i < segments.length; i++) {
    acc = i === 0 ? segments[0]! : acc + delimiter + segments[i]!;
    out.push(acc);
  }
  return out;
}

async function listDelimiter(client: ImapFlow): Promise<string> {
  const cached = delimiterByClient.get(client);
  if (cached) return cached;
  const entries = await client.list();
  let d = ".";
  for (const e of entries) {
    if (e.delimiter && e.delimiter.length > 0) {
      d = e.delimiter;
      break;
    }
  }
  delimiterByClient.set(client, d);
  return d;
}

/**
 * Ensures each hierarchy level of the destination mailbox exists (IMAP CREATE).
 * Skips CREATE for the special name INBOX alone; creates children under INBOX as needed.
 * ImapFlow treats ALREADYEXISTS as success (no throw).
 */
export async function ensureDestinationMailbox(client: ImapFlow, mailboxPath: string): Promise<void> {
  const trimmed = mailboxPath.trim();
  if (!trimmed) return;

  const delimiter = await listDelimiter(client);
  const segments = mailboxPathSegments(trimmed, delimiter);
  const paths = cumulativeMailboxPaths(segments, delimiter);

  for (const path of paths) {
    if (path.toUpperCase() === "INBOX") continue;
    await client.mailboxCreate(path);
  }
}

/**
 * Calls {@link ensureDestinationMailbox} at most once per `mailboxPath` per worker (shared Set).
 */
export async function ensureDestinationMailboxCached(
  client: ImapFlow,
  mailboxPath: string,
  seen: Set<string>
): Promise<void> {
  if (seen.has(mailboxPath)) return;
  await ensureDestinationMailbox(client, mailboxPath);
  seen.add(mailboxPath);
}
