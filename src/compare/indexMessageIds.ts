import { SCHEMA_VERSION, assertAccountScanReport } from "../report/schema.js";

export interface MessageIdIndex {
  schemaVersion: typeof SCHEMA_VERSION;
  reportType: "imap-tool.message-id-index";
  generatedAt: string;
  /** Normalized Message-ID → mailbox paths where at least one message carries that id. */
  index: Record<string, string[]>;
}

/**
 * Builds a normalized Message-ID → mailbox paths map from an account scan (UC-1: “where does this id appear?”).
 */
export function buildMessageIdIndex(report: unknown): MessageIdIndex {
  const r = assertAccountScanReport(report);
  const map = new Map<string, Set<string>>();

  for (const mb of r.mailboxes) {
    if (!mb.messages) continue;
    for (const msg of mb.messages) {
      const id = msg.messageIdNormalized;
      if (!id) continue;
      let set = map.get(id);
      if (!set) {
        set = new Set();
        map.set(id, set);
      }
      set.add(mb.path);
    }
  }

  const index: Record<string, string[]> = {};
  for (const [id, paths] of [...map.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    index[id] = [...paths].sort();
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    reportType: "imap-tool.message-id-index",
    generatedAt: new Date().toISOString(),
    index,
  };
}

export function mailboxesForMessageId(index: MessageIdIndex, needle: string): string[] {
  const trimmed = needle.trim();
  if (trimmed === "") return [];
  const direct = index.index[trimmed];
  if (direct) return direct;

  const lower = trimmed.toLowerCase();
  const hits: string[] = [];
  for (const [id, paths] of Object.entries(index.index)) {
    if (id.toLowerCase().includes(lower)) {
      hits.push(...paths);
    }
  }
  return [...new Set(hits)].sort();
}
