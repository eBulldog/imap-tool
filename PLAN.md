# IMAP metadata tool — living plan

**Status:** Active (inception)  
**Owner:** PLANNER (this file is the single source of truth for intent, architecture, structure, and delivery order.)

---

## 1. Intent

Build a **TypeScript** tool that treats IMAP as a **telemetry and reconciliation surface**, not an email reader.

### In scope

- **Discover** mailboxes (folder tree, namespaces as needed).
- **Summarize** per-mailbox facts: message counts, unseen/recent where meaningful, `UIDNEXT`, `UIDVALIDITY`, and aggregate or per-message **sizes** and **metadata** available without downloading full bodies.
- **Enumerate** messages efficiently (UIDs + selected FETCH items) for large mailboxes.
- **Optionally fetch** one or more full raw messages (bytes) for inspection, hashing, or spot comparison.
- **Foundation for migration comparison:** repeatable, machine-readable reports from two servers (or two points in time) that can be diffed or analyzed.
- **Optional verified copy (planned, §10):** a **separate** track from read-only inspection — **provider-to-provider** (or any **two IMAP hosts**): the tool **bridges** **FETCH** → **APPEND** → **re-FETCH + hash** on the destination; **pausable/resumable** so **very large folders** (hundreds of thousands of messages / multi-GB) can run over hours or days without holding the whole mailbox in RAM; does not remove or change existing CLI/UI compare flows.

### Explicit non-goals (initial phases)

- Rendering or parsing MIME for human reading (no “email client” UI).
- Sending mail (SMTP), calendar, or contacts.
- Guaranteeing identical UIDs across migrations (IMAP does not promise this); comparison logic must be explicit about identifiers.

**Clarification:** The **Web UI** is an **operational dashboard** (tables of metadata, capability glossary, raw RFC822 preview for inspection). It is not a general-purpose mail reader; it does not replace Thunderbird but helps compare **server-reported** state to what a client shows.

### Driving use cases

These scenarios shape **what “done” means** beyond generic IMAP introspection.

**UC-1 — Cross-client inconsistency (“moved in Thunderbird, still on iOS”)**  
You need to decide whether the problem is **server state**, **client cache/UI**, or **two different views of the same account** (e.g. different folders, namespaces, or provider-specific “All Mail” behavior).

- **Ground truth** for this product means: **what the IMAP server reports** when the tool lists mailboxes, runs `STATUS`, and (when needed) locates messages by **stable headers** (typically `Message-ID` from `ENVELOPE`) across candidate folders.
- **Planned capabilities:** Per-folder metadata scans (UID, `RFC822.SIZE`, `INTERNALDATE`, `FLAGS`, `ENVELOPE`); optional targeted `SEARCH` / `UID SEARCH` by header where the server supports it; optional raw fetch of one message to compare octets. **Compare two snapshots** of the same server (time T₀ vs T₁) or **query “which mailboxes contain Message-ID X?”** once multi-mailbox search or scan aggregation exists.
- **Out of scope for the tool:** Fixing Mail.app cache, Thunderbird offline store, or push/IMAP IDLE behavior — but reports can **supply evidence** (“message still present in mailbox A with UID n,” “not present in B”) to escalate to the client or hoster.

**UC-2 — Provider migration, large mailboxes, zero tolerance for loss**  
You are moving an account **from one provider to another** (different host, quotas, and IMAP quirks). Some folders are **very large** (message count and/or total bytes); the job may run for a long time and must survive **pause, resume, and restarts** without re-copying what already verified.

- **Planned workflow:** (1) **Baseline report** on source: every mailbox, counts, sizes, per-message fingerprints (cheap heuristic and/or expensive hash per policy in §2). (2) Perform migration (§10 copy engine and/or external tool). (3) **Destination report** with the same options and **explicit folder mapping** (source name → destination name). (4) **Diff:** per-mailbox missing/extra messages, count and byte totals, flag/date deltas where fetched, and `UIDVALIDITY` notes where UIDs cannot be compared.
- **Large folders:** copy and verify must be **incremental** (UID-ordered work queues, per-message or per-batch checkpoints, streaming bodies) — never assume a folder fits in memory or finishes in one session.
- **Metadata:** “Clean copy” includes **flags** (`\Seen`, `\Flagged`, etc.) and **internal dates** only if they appear in IMAP `FETCH` on the destination; the plan does not assume a particular migration tool preserves them — **verification is always against what IMAP returns**, not what the migration software claims.

---

## 2. Problem framing

### What IMAP exposes (conceptual)

| Capability | Typical use for this product |
|------------|-------------------------------|
| `LIST` / `LSUB` | Folder tree |
| `NAMESPACE` | Interpret folder naming (shared vs personal) |
| `STATUS` | Counts and UID metadata without selecting |
| `SELECT` / `EXAMINE` | Open mailbox for UID-scoped operations; prefer `EXAMINE` when mutation must be avoided |
| `UID SEARCH` / `SEARCH` | Bounded UID sets for batching |
| `UID FETCH` | Per-message metadata (`FLAGS`, `RFC822.SIZE`, `INTERNALDATE`, `ENVELOPE`, `BODYSTRUCTURE`, etc.); `BODY.PEEK[]` or `RFC822` for raw bytes without setting `\Seen` where possible |

### Migration comparison (principles)

- **`UIDVALIDITY`:** If it changes for a mailbox, UIDs are not comparable to a prior snapshot for that mailbox name.
- **UIDs** are server-scoped and may change after migration; treat as **opaque handles within a session/snapshot**, not as global identity.
- **Practical identity keys** for cross-server diff (choose per operational need, document assumptions):
  - Strong: **hash of raw message bytes** (after fetch) — expensive but precise for “same octets.”
  - Weaker but cheaper: **`Message-ID` + size + internal date** — good for heuristics, not cryptographic proof.
- **Folder mapping:** Source and destination may use different delimiters or root prefixes; comparison should allow **configurable folder aliasing** or normalization rules (open question: see §7).

---

## 3. Architecture

### High-level components

1. **Core library (TypeScript)**  
   - Connection lifecycle (TLS, login, capability check).  
   - Typed operations: list mailboxes, status, select/examine, search, fetch metadata, fetch raw.  
   - **Streaming / batching** abstractions so large mailboxes do not require holding full result sets in memory.  
   - **Structured errors** (auth, TLS, protocol, timeout) for automation.

2. **CLI**  
   - Thin layer over the library: subcommands, JSON/text output, exit codes suitable for scripts and CI.  
   - Reads credentials and connection options from **environment variables** and/or a **local config file** that is **gitignored** by default.

3. **Report formats**  
   - **JSON Lines** or **JSON** for scans (deterministic field order optional) to support `diff`, `jq`, and custom analyzers.  
   - Version field in each report: `schemaVersion` for forward compatibility.

4. **Web UI (`ui/` + `ui-server/`)**  
   - **Dual-server main page:** independent connection forms (host, port, user, password, TLS options) for **Server A** and **Server B**; no dependency on `IMAP_*` env for interactive use.  
   - **Capabilities:** after ping, list server-advertised atoms with **human descriptions** from a maintained catalog; separate **reference page** lists all catalog entries (`GET /api/capabilities/reference`).  
   - **Folder compare:** parallel LIST+STATUS on both servers; table of paths with STATUS columns; summary of paths only on A / only on B / both. Click path to pre-fill message-compare fields.  
   - **Message compare:** bounded **UID slice** (highest UIDs, same semantics as CLI `--limit`) on chosen mailbox path(s); server runs `compareMailboxSnapshots` and returns summary (UIDVALIDITY, multiset fingerprint diff).  
   - **Message viewer (separate route):** full-width **aligned rows** by `fingerprintWeak`, sortable by internal date, **Raw** button per row (RFC822 snippet via API). **Navigation:** “Open message viewer” from main page passes mailbox paths + limit through **React context** (`viewerPreset`) so the viewer reuses the same two connections without retyping.  
   - **Security:** credentials travel **browser → imap-tool API → IMAP**; **HTTPS termination** in front of the UI server is recommended when not on a fully trusted LAN (documented; implementation TBD per deployment).  
   - **CLI fallback:** `GET /api/ping`, `GET /api/mailboxes`, `GET /api/scan` remain available when `IMAP_*` env is set (automation); primary UI flow uses **`POST /api/session/*`** and **`POST /api/compare/*`** with JSON bodies.
   - **Copy engine (planned §10):** new library module + optional **UI route** (e.g. `/copy`) and/or CLI `copy` subcommand; **must not** replace or break Compare / Viewer / Capabilities. UI server orchestrates jobs; **durable checkpoint state** lives on disk (not in browser alone).

### Dependency direction

- CLI → library only.  
- UI server → library only (no business logic duplicated beyond thin HTTP adapters).  
- Library → IMAP client dependency + minimal utilities (no UI framework in `src/` outside `ui/`).  
- Future “compare” command or script may live in CLI or a separate `scripts/` entrypoint; it **consumes** reports, it does not embed provider-specific hacks in the core without documenting them.
- **Copy engine (planned):** `src/copy/` (or `src/migrate/`) depends on `imap/`, `fetch/`, `report/` types; CLI and ui-server **orchestrate** only; no duplicate hash/append logic in React.

### Runtime assumptions

- **Node.js 20+** (LTS) as the primary runtime: TLS and long-lived TCP are first-class.  
- **IMAP client:** **ImapFlow** (`imapflow` npm package).

### Security and operations

- **Secrets:** passwords/app-passwords only via env or local config; never logged; redact in debug traces.  
- **TLS:** default secure; optional certificate pinning or CA bundle configuration documented for self-hosted servers.  
- **Least surprise:** prefer `EXAMINE` and `BODY.PEEK[]` for read-only inspection. **Copy jobs (§10)** intentionally use **APPEND**, optional **CREATE** mailboxes, and **VERIFY FETCH** on the destination — operators must opt in per job; defaults should not mutate without an explicit run ID / confirmation in UI.

---

## 4. Repository structure (target)

```
imap-tool/
├── PLAN.md                 # This document (canonical)
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts            # Library public exports (minimal surface)
│   ├── imap/               # Connection, session, low-level command wrappers
│   ├── scan/               # Mailbox listing, status, batched metadata scans
│   ├── fetch/              # Optional full-message fetch helpers
│   ├── report/             # Schema types, serialization, schemaVersion
│   ├── copy/               # (planned §10) Verified copy job engine, checkpoint I/O, workers
│   ├── ui-server/          # Local Fastify API + static UI (default bind all IPv4; optional loopback)
│   └── cli/                # CLI entrypoint and commands
├── ui/                     # Vite + React (routes: /, /viewer, /capabilities; + /copy planned §10)
├── test/                   # Unit + integration (integration behind opt-in env flags)
└── .env.example            # Documented variables, no real secrets
```

Adjustments require updating this section of **PLAN.md** so other agents do not drift.

---

## 5. Delivery phases and acceptance criteria

### Phase A — Project skeleton and connection

- [x] TypeScript build, lint, and test runner wired; `npm test` / `npm run build` documented in README (README is allowed as user-facing operator doc; keep it short).
- [x] Connect to IMAP over TLS, login, log capabilities, clean disconnect.
- **Acceptance:** Against a test mailbox (Dockerized or real), a CLI command prints “connected” and exits 0; connection failures exit non-zero with a clear error code/message.

### Phase B — Mailbox discovery and status

- [x] Implement `LIST` (+ `NAMESPACE` if required for correct interpretation).
- [x] Implement `STATUS` for each mailbox (or selected set): `MESSAGES`, `UNSEEN`, `RECENT`, `UIDNEXT`, `UIDVALIDITY` as supported.
- **Acceptance:** JSON report listing all mailboxes with status fields; handles empty mailboxes and permission-denied mailboxes gracefully (skip + annotate in report).

### Phase C — Metadata scan (no body)

- [x] `EXAMINE` + batched `UID FETCH` for: `UID`, `FLAGS`, `RFC822.SIZE`, `INTERNALDATE`, `ENVELOPE` (and optionally `BODYSTRUCTURE`).
- [x] **Message identity in reports:** Persist `messageId` (from `ENVELOPE`) and normalized form where practical so UC-1 and UC-2 can correlate across folders and servers without fetching bodies.
- [x] Configurable batch size; progress on stderr; memory stable on a mailbox with at least **N** messages (N to be chosen in implementation notes, e.g. 10k+).
- **Acceptance:** Completes without OOM; output validates against a documented JSON schema or TypeScript type with `schemaVersion`.

### Phase D — Optional raw fetch

- [x] Fetch one or more UIDs’ raw bytes via `BODY.PEEK[]` (or equivalent), write to stdout or file; optional SHA-256 in report.
- **Acceptance:** Octet length matches `RFC822.SIZE` for a sample message on a reference server (documented tolerance if compression/transcoding is N/A — IMAP raw should match).

### Phase E — Migration comparison (MVP)

- [x] Input: two reports (or two live endpoints with same scan options). Output: per-mailbox diff summary — counts, UIDVALIDITY changes, set differences of chosen fingerprint (e.g. hash or Message-ID heuristic).
- [x] **UC-2:** Support **folder mapping file** (source mailbox path → destination path) and totals: messages and bytes per mailbox + global sums; list **missing** and **unexpected** fingerprints per mapped pair.
- [x] **UC-1 (lightweight):** Same-server **two reports** (before/after move) compared, or aggregated index built from scans: “mailboxes containing `messageId` X” (exact design left to CODER within report schema constraints).
- **Acceptance:** Deterministic output for the same inputs; documented limitations when `UIDVALIDITY` differs or folder names differ; migration diff runbook documented in README (baseline → migrate → destination scan → compare).

---

## 6. Testing strategy

- **Unit tests:** Parsing of responses, report serialization, batching logic, error mapping (mocked transport where feasible).
- **Integration tests:** Optional, gated by env vars (e.g. `IMAP_TEST_HOST`, `IMAP_TEST_USER`, `IMAP_TEST_PASS`); not run in untrusted CI without secrets. Document in README.
- **Fixture recordings:** If used, redact credentials and keep fixtures minimal.

---

## 7. Open questions and risks

| Item | Notes |
|------|--------|
| IMAP client library choice | **Resolved:** ImapFlow (see §8 decision log). |
| Provider quirks (Gmail, Exchange/O365, Dovecot) | May need documented “profiles” or capability flags; avoid baking undocumented behavior into core types. |
| Folder aliasing for migration | Need explicit config format for mapping source→destination mailbox names. |
| Rate limiting / throttling | Some hosts throttle aggressive FETCH; batch size and backoff policy. |
| Binary parts and `BINARY` extension | Optional later for more accurate sizes without full fetch; not required for MVP. |
| UC-1 interpretation | Same **credentials** and server as both clients? If yes, server-side presence is decisive. If clients use different accounts or “All Mail” vs folder views, reports must label **which mailbox** was scanned. |
| Duplicate `Message-ID` | Rare but possible; fingerprint + size + internal date reduces ambiguity; document collision handling in report schema. |
| Copy job durability | SQLite vs JSONL job file; corruption recovery; multi-process lock (single-writer assumption may be OK for v1). |
| Same-server optimization | **Secondary:** if source and dest are the **same** host/session, **UID COPY** + verify may be added later; **primary design is two-host** FETCH→APPEND→verify (no reliance on server-side cross-mailbox copy across accounts). |
| Legal / policy | Copying mail may be regulated; tool is technical only — operator responsibility; no cloud exfiltration by default (direct IMAP→IMAP). |
| Provider pair behavior | Source vs dest may differ in **rate limits**, **max connections**, **APPENDLIMIT**, timeouts; copy engine should expose per-side tuning and backoff. |
| Huge single folder | Progress UX: **per-folder** counts (done / total / failed), ETA optional; checkpoint must allow resume **mid-folder** after crash. |

---

## 8. Decision log

| Date | Decision | Rationale |
|------|----------|-----------|
| (inception) | Node.js + TypeScript for IMAP tooling | TLS/TCP maturity, automation-friendly. |
| (inception) | Library + CLI split | Reuse in scripts and future services; testable core. |
| (inception) | Read-oriented defaults (`EXAMINE`, `BODY.PEEK[]`) | Minimize accidental state changes on production mailboxes. |
| 2026-03-21 | Driving use cases UC-1 / UC-2 formalized | Cross-client debugging vs server truth; migration verification with folder mapping and fingerprint diff. |
| 2026-03-21 | **ImapFlow** for IMAP; **Node.js ≥ 20** | Promise/async API, maintained; LTS baseline for TLS and tooling. |
| 2026-03-21 | Web UI v2: dual-server forms, capability catalog, live folder/message compare, message viewer + `viewerPreset` link | Supports UC-1/UC-2 visually; HTTPS front-end deferred to deployment. |
| 2026-03-21 | **Bulletproof copy** as additive track (§10): **two-host** pipeline hash→APPEND→verify, checkpointed jobs, `/copy` UI + CLI; does not replace read-only compare. | UC-2 demands octet-level proof across **separate** servers; pause/resume and parallelism are operational requirements. |
| 2026-03-21 | Copy scoped for **provider migration** + **very large folders** | Two-host bridge; incremental checkpoints and streaming so big folders are first-class, not a special case. |

---

## 9. Guidance for other agents

- **CODER:** Implement within §3–§4; **copy work** follows **§10** and `src/copy/` layout. Extend §8 when making stack choices (Node version, IMAP library). Do not expand scope beyond phases without PLANNER updating this file.
- **DEBUGGER:** Diagnose within current architecture; if a fix requires a new component or dependency, request a PLAN update first.
- **GIT_MANAGER:** Commits follow repo conventions once established; exclude agent-generated markdown per policy (this **PLAN.md** is human-directed canonical planning, not ad-hoc agent notes — it is intended to be committed unless the repository owner decides otherwise).

---

## 10. Bulletproof copy engine (planned)

**Primary topology:** **two distinct IMAP hosts** — typically **old provider ↔ new provider** (different hostnames, limits, and capabilities). The tool holds **two connections** (or pools): read **source**, write **destination**. The source never talks to the destination; **this process** is the only pipe.

**Large folders:** A single mailbox may hold **very many** messages or **multi‑GB** of mail. The design assumes jobs run **for a long time**, may be **paused** (operator, maintenance, rate limits), and **restarted**; state on disk must record progress **per folder and per message** (or batch) so a 500k-message `Archive` does not restart from zero.

**Goal:** **Pausable**, **resumable** migration with strong **evidence** per message: **host A** `FETCH` → **hash** → **host B** `APPEND` → **host B** `FETCH` → **hash** → compare. **Throughput** is “as fast as both providers and the link allow” via tunable **parallelism** and **streaming**, without dropping verify in the default **bulletproof** profile.

**Non-breaking:** Phases A–E and current UI routes stay. Copy is a **separate** surface: **`/copy`** tab + **`imap-tool copy`** CLI; connection JSON is **two** independent host blocks (same shape as dual-server UI today).

### 10.1 Proof model (“bulletproof” default)

| Step | Action | Evidence in job store |
|------|--------|------------------------|
| 1 | Source `UID FETCH` full raw (`BODY.PEEK[]` / RFC822) | `sourceSha256`, `rfc822Size`, source `(mailbox, uid)` |
| 2 | Dest `APPEND` (+ `INTERNALDATE` / flags if supported) | Dest UID from **UIDPLUS** where available; else locate with explicit fallback policy |
| 3 | Dest `FETCH` that UID | `destSha256` **must equal** `sourceSha256` else `failed` + reason |
| 4 | Idempotency | Dedupe key = `sourceSha256` (no double-APPEND on resume unless `force` flag) |

**Optional “fast” profile:** skip step 3 when `fingerprintWeak` already matches on dest — **not** default; document collision risk.

**Semantics:** “Same file” = **same octets the server returns on FETCH** pre- and post-copy; rewriting at the server is a **detected** mismatch, not a false negative.

### 10.2 Performance

- **Two TCP sessions** (source + dest); worker pool (**N** concurrent *messages*, each: fetch A → append B → fetch B), **stream** body through the hasher and APPEND — **O(1) memory per message** for the payload path (not O(folder size)).
- Honor **APPENDLIMIT** on **destination**; backoff on rate limits / `NO` on **either** provider.
- Work queue **per mapped folder**, stable **UID order** on source; parallelism **within** a folder up to **N** (tune down if the **destination** provider throttles APPEND).
- **Later / niche:** same **IMAP session** on one host → optional **`UID COPY`** + verify — **not** the default; tests and UX assume **two providers** first.

### 10.3 Pause / resume (critical for huge folders)

- Durable **checkpoint** (SQLite or JSONL per **job ID**): include **folder path pair** + per-row state `pending | appending | verifying | done | failed | skipped`.
- **Granularity:** at least **per message** (or per small batch with explicit batch id) so resume never skips unverified work inside a 100k+ folder.
- **Pause:** drain in-flight messages, flush checkpoint (safe to kill process after pause).
- **Resume:** skip `done`; retry `failed` (bounded); CLI `copy … pause|resume|status`.
- **UI / logs:** show **per-folder** progress (e.g. done/total for current folder) so operators can see movement on multi-hour jobs.

### 10.4 UI (`/copy` tab)

- **Two host panels** (source host vs destination host) — same mental model as Compare; folder map **source path → destination path**; concurrency; profile selector; Start / Pause / Resume; progress poll **`GET /api/copy/jobs/:id`**.
- **Job runner in Node** (ui-server v1) maintains **both** IMAP connections — browser never talks to IMAP directly.

### 10.5 Suggested modules

- `src/copy/jobTypes.ts`, `checkpointStore.ts`, `copyWorker.ts`, `jobRunner.ts` — see §4.

### 10.6 Phases F–H (copy)

| Phase | Scope | Acceptance (summary) |
|-------|--------|-------------------------|
| **F** | Library + CLI; checkpoint; single-folder map; bulletproof profile only | N-message test: all verified; corrupt verify fails; kill/resume completes without dup APPEND |
| **G** | Pool + streaming; dest **APPENDLIMIT**; tune **N** for two-host latency; stress **one huge folder** in tests | Memory stable on **large-folder** run (e.g. 10k+ msgs); throughput scales until **either** provider or network saturates |
| **H** | UI `/copy` + APIs | Full job from UI; pause/resume survives refresh; zero regression on `/`, `/viewer`, `/capabilities` |

### 10.7 Product acceptance

- Default profile = verified hash match or explicit failure per message.
- No mutation without explicit job start + job id in logs.
- Read-only test suite (A–E) unchanged.

---

*Last updated: 2026-03-21 (PLANNER: provider migration + large folders in §10 / UC-2).*
