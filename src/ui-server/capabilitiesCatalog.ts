/**
 * Human-oriented IMAP CAPABILITY descriptions for operators (not RFC abstracts).
 * Wording assumes a typical **Dovecot-class** server as reference; other hosts may differ slightly.
 * Unknown atoms still fall back to a generic line in the UI.
 */
const CATALOG: Record<string, string> = {
  IMAP4: "Old protocol label from before IMAP4rev1; you can ignore it if IMAP4rev1 is also listed.",

  IMAP4REV1: "Modern IMAP: the command set this tool and most clients expect (folders, FETCH, SEARCH, UID commands, etc.).",
  "IMAP4rev1": "Modern IMAP: the command set this tool and most clients expect (folders, FETCH, SEARCH, UID commands, etc.).",

  STARTTLS: "Allows upgrading a plain TCP session to TLS before login — use it if you connect on port 143 without implicit TLS.",

  LOGINDISABLED: "Plain LOGIN is refused until the session is encrypted (STARTTLS or implicit TLS). Good for forcing TLS.",

  AUTH: "Prefix for SASL mechanisms the server accepts (e.g. PLAIN). The client picks one supported on both sides.",
  "AUTH=PLAIN": "Username+password authentication in one SASL step — safe only over TLS.",
  "AUTH=LOGIN": "Older two-step password style; still seen for compatibility; prefer PLAIN over TLS.",

  ID: "Optional handshake where client and server exchange software name/version strings — useful for support, not required for mail access.",

  IDLE: "After you SELECT a mailbox, the server can notify you when new mail arrives instead of the client polling constantly — better for battery and latency.",

  NAMESPACE: "Tells the client where “your” folders live vs shared/other namespaces — fixes folder path prefixes (e.g. who owns INBOX vs public trees).",

  "LITERAL+": "Lets the client send large chunks (e.g. message bodies) without extra wait/sync round trips — faster uploads and some FETCH patterns.",

  "SASL-IR": "Allows sending the first SASL response in the first packet — fewer round trips on login (common with PLAIN).",
  SASL_IR: "Same as SASL-IR (alternate spelling in some listings).",

  CHILDREN: "LIST can mark folders with \\HasChildren / \\HasNoChildren so UIs can show expand/collapse without probing every subfolder.",

  UIDPLUS: "After APPEND, COPY, or MOVE the server can tell you the new UID (and sometimes UIDVALIDITY) — clients use this to sync without rescanning everything.",

  UNSELECT: "Close the current mailbox without EXPUNGE side effects — handy for scripts and for dropping back to no mailbox selected.",

  MULTIAPPEND: "Upload several messages in one APPEND sequence — fewer round trips when importing mail.",

  BINARY: "FETCH/APPEND can carry raw 8-bit body data without binary→text encoding (BINARY / BINARY.SIZE) — cleaner for some parts than BASE64 in the wire format.",

  CATENATE: "Build one uploaded message from several pieces (e.g. concatenate buffers) in a single APPEND-style operation — niche; migration tools may use it.",

  CONDSTORE: "Each message/mailbox has a modification sequence (modseq). STORE and FETCH can be conditional on modseq so clients don’t overwrite newer changes — essential for solid two-way sync.",

  QRESYNC: "After reconnect, resync using stored modseq/UID state instead of full folder reload — pairs with CONDSTORE for efficient offline clients.",

  ESEARCH: "SEARCH replies can return counts, min/max UID, or ALL (not just a huge UID list) — saves bandwidth when you only need “how many” or bounds.",

  SEARCHRES: "Store the result of a SEARCH under a name and reuse it in the next command — avoids resending giant UID sets.",

  "CONTEXT=SEARCH": "SEARCH can be run in a limited UID or modseq window so huge mailboxes don’t always scan from scratch — improves performance on incremental search.",

  LISTEXTENDED: "LIST accepts richer filters (subscribed-only, recursive, remote) and return options — Thunderbird-style folder trees depend on this family.",
  "LIST-EXTENDED": "LIST accepts richer filters (subscribed-only, recursive, remote) and return options — Thunderbird-style folder trees depend on this family.",

  LISTSTATUS: "LIST can include STATUS (counts, UIDNEXT, etc.) in the same response — one round trip instead of LIST+STATUS per folder.",
  "LIST-STATUS": "LIST can include STATUS (counts, UIDNEXT, etc.) in the same response — one round trip instead of LIST+STATUS per folder.",

  MOVE: "Move messages between folders in one step (server does copy+delete semantics). Prefer over COPY+STORE \\Deleted+EXPUNGE when available.",

  "UTF8=ACCEPT": "Server accepts UTF-8 mailbox names and related internationalization — fewer “mojibake” folder names.",
  "UTF8=ONLY": "Internationalized-only mode: strings are treated as UTF-8 end to end.",

  SPECIALUSE: "LIST exposes standard roles: \\Sent, \\Trash, \\Drafts, \\Junk, etc., so the client maps folders to UI roles without guessing names.",
  "SPECIAL-USE": "Same as SPECIALUSE: standard folder roles (Sent, Trash, …) advertised on mailboxes.",

  "XLIST": "Legacy Gmail-style folder roles; modern servers use SPECIAL-USE instead.",

  QUOTA: "Server can report storage or message count limits per mailbox or tree — admin-facing; some clients show “mailbox full” hints.",

  ACL: "Per-mailbox permission bits (who may read/post/delete) — relevant on shared servers, not typical single-user Dovecot.",

  METADATA: "Annotations/keys on mailboxes (comments, sieve location, etc.) — rarely surfaced in desktop mail clients.",

  OBJECTID: "Stable server-assigned IDs for messages or mailboxes — newer than UIDs for sync; not universally supported.",

  PREVIEW: "FETCH can return a short text snippet of the message body without downloading the full part — faster thread lists.",
  "PREVIEW=FUZZY": "Preview text may be fuzzy/generated (implementation-defined) rather than a strict fixed slice — still for list/snippets only.",

  "COMPRESS=DEFLATE": "Optional zlib compression on the IMAP stream — cuts bandwidth on slow links; client and server must both enable it.",

  ENABLE: "Explicitly turn on extensions (CONDSTORE, QRESYNC, UTF8, etc.) after login — required on some servers before those features work.",

  THREAD: "Server can group SEARCH results into conversation threads (algorithms vary).",

  "THREAD=ORDEREDSUBJECT": "Thread by subject base (ordered) — common “flat” thread view.",
  "THREAD=REFERENCES": "Thread using References/In-Reply-To headers — closer to real reply chains.",
  "THREAD=REFS": "Alias/sibling for REFERENCES-style threading on some servers.",

  SORT: "Server sorts SEARCH results by date, size, etc., without the client downloading headers for everything.",
  "SORT=DISPLAY": "Sort uses display-oriented collation (e.g. human-friendly order for subjects/from) — depends on server locale tables.",
  ESORT: "Extended SORT: richer sort keys or combined with ESEARCH-style summaries (server-dependent).",

  WITHIN: "SEARCH criteria like OLDER/YOUNGER than N days relative to “now” — handy for “last 30 days” queries.",

  NOTIFY: "Subscribe to mailbox events (exists, expunge, metadata changes) beyond IDLE’s scope — advanced sync; not all clients implement it.",

  FILTERS: "Server-side mail filtering hooks (often tied to Sieve) — capability name varies by vendor.",

  "APPENDLIMIT": "Advertises maximum size of a single uploaded message — clients should respect it before APPEND.",

  CREATE_SPECIAL_USE: "CREATE can set a special-use flag (e.g. mark a folder as \\Sent) when the folder is created.",

  STATUS: "STATUS command exists (counts, UIDNEXT, UIDVALIDITY, etc.); often implied by IMAP4rev1 — redundant if listed alone.",

  "STATUS=SIZE": "STATUS can return total storage used by the mailbox (RFC 8438) — useful for “folder size” without scanning every message.",

  ACL2: "Updated ACL model (vendor-specific); treat as “newer ACL” if you use shared folders with fine-grained rights.",

  "X-GM-EXT-1": "Gmail-only: labels, Gmail message id, thread id in FETCH — not used on Dovecot.",
  "X-GM-MSGID": "Gmail numeric message id in FETCH.",
  "X-GM-THRID": "Gmail thread id.",

  ANNOTATEEXPERIMENT: "Experimental per-message or per-mailbox annotations — obscure in production mail clients.",

  LOGIN_REFERRALS: "Login might redirect you to another host/port (LDAP-style referrals) — rare in simple Dovecot setups.",
  "LOGIN-REFERRALS": "Same: login may refer to another server — uncommon for single-host IMAP.",

  SAVEDATE: "FETCH can expose when the message was saved on the server (distinct from internal date) — useful for backup/audit semantics.",

  SNIPPET: "Short searchable text excerpt for a message (vendor extension); may pair with SEARCH.",
  "SNIPPET=FUZZY": "Snippet is fuzzy-matched or ranked — implementation-specific; aimed at search UIs.",

  I18NLEVEL: "Internationalization profile for SEARCH/SORT collation (levels 1–2).",
  "I18NLEVEL=1": "Basic UTF-8 collation for SEARCH/SORT — non-ASCII folder and header handling without full locale tables.",

  URLPARTIAL: "Partial FETCH by URL or byte range — rarely used; most clients ignore it.",
  "URL-PARTIAL": "Partial FETCH by URL or byte range — rarely used; most clients ignore it.",
};

const GENERIC =
  "The server advertises this token; exact behavior depends on the daemon build and config — check server docs if you rely on it.";

function normalizeKey(raw: string): string {
  return raw.trim().toUpperCase();
}

export function describeCapability(atom: string): string {
  const k = normalizeKey(atom);
  if (CATALOG[k]) return CATALOG[k];
  if (CATALOG[atom]) return CATALOG[atom];
  const base = k.split("=")[0];
  if (CATALOG[base]) return CATALOG[base];
  return GENERIC;
}

export function enrichCapabilities(atoms: string[]): Array<{ name: string; description: string }> {
  return [...atoms]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map((name) => ({ name, description: describeCapability(name) }));
}

/** Full catalog for “browse all known” in the UI (dedupe by uppercase). */
export function allCatalogEntries(): Array<{ name: string; description: string }> {
  const seen = new Set<string>();
  const out: Array<{ name: string; description: string }> = [];
  for (const name of Object.keys(CATALOG)) {
    const u = name.toUpperCase();
    if (seen.has(u)) continue;
    seen.add(u);
    out.push({ name, description: CATALOG[name]! });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
