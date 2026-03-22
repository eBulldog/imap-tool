/**
 * Normal fallback when an error has no usable message.
 */
export function errorText(e: unknown): string {
  if (e instanceof Error && e.message.trim() !== "") {
    return e.message.trim();
  }
  const s = String(e);
  if (s.trim() !== "") return s.trim();
  return "(error had no message — check server/IMAP logs)";
}

type ImapFlowLikeError = Error & {
  responseText?: string;
  responseStatus?: string;
  executedCommand?: string;
  code?: string;
  throttleReset?: number;
};

function truncateOneLine(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * ImapFlow rejects with `message === "Command failed"` while the useful text lives on
 * `responseText` / `responseStatus` / `executedCommand` (see imapflow imap-flow.js ~724+).
 */
export function formatImapFlowError(e: unknown): string {
  if (!(e instanceof Error)) {
    return errorText(e);
  }

  const ex = e as ImapFlowLikeError;

  if (ex.code === "ETHROTTLE" && typeof ex.throttleReset === "number") {
    return `Throttled (server asked to wait ~${Math.ceil(ex.throttleReset / 1000)}s)`;
  }

  const status = ex.responseStatus?.trim();
  const txt = ex.responseText?.trim();
  const cmd = ex.executedCommand?.replace(/\s+/g, " ").trim();

  if (txt || status) {
    const head = [status, txt].filter(Boolean).join(": ");
    if (cmd) {
      return `${head} — ${truncateOneLine(cmd, 240)}`;
    }
    return head;
  }

  if (ex.message === "Command failed" && cmd) {
    return `IMAP NO/BAD — ${truncateOneLine(cmd, 280)}`;
  }

  return errorText(e);
}
