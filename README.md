# imap-tool

TypeScript CLI and library for **IMAP metadata** (counts, sizes, UIDs, envelopes), **migration-style comparison**, and optional **verified provider-to-provider copy** (FETCH → SHA-256 → APPEND → re-FETCH → hash match, with SQLite checkpoints). It does not render email; it produces JSON reports you can diff.

See `PLAN.md` for architecture and goals.

## Requirements

- Node.js **20+**

## Install

```bash
npm install
npm run build
```

Run via `npx imap-tool` from this directory after build, or `npm link` for a global command.

### Web UI (dual-server dashboard)

React + Fastify. **Default bind `0.0.0.0`** (all IPv4); stderr lists LAN URLs. **Main page:** two independent connection forms (Server A / B), expandable **IMAP capabilities** with descriptions, **folder comparison** (LIST+STATUS), and **message comparison** (highest-UID slice + fingerprint multiset diff). **Copy** route (`/copy`): start a **verified two-host copy** (same proof model as CLI `copy`), poll progress, pause/resume queue, stop workers, re-run after interrupt. **Message viewer** route: full-width aligned rows, sort by internal date, **Raw** RFC822 preview. **Capabilities** route: static glossary (`GET /api/capabilities/reference`).

Interactive flows use **`POST /api/session/*`**, **`POST /api/compare/*`**, and **`/api/copy/jobs*`** with JSON bodies (host, user, pass, TLS flags). Passwords are sent to your imap-tool process over **HTTP** unless you terminate TLS in front — use a trusted LAN or put nginx/Caddy in front for HTTPS.

Copy jobs persist under **`IMAP_COPY_JOB_DIR`** (default: a subdirectory of the system temp dir, e.g. `/tmp/imap-tool-copy-jobs` on Linux). Each job is a UUID folder with `spec.json` and `job.sqlite`. **`GET /api/copy/jobs/:id`** includes **`failures`** (grouped reasons + sample rows) when `stats.failed > 0`. Use **Test connection** on `/copy` before starting a job; CLI: `copy status --store … --verbose` prints failure groups and samples.

```bash
npm run build:all
node bin/imap-tool.js ui
```

Optional **CLI-style env** still powers `GET /api/ping`, `GET /api/mailboxes`, `GET /api/scan` when `IMAP_HOST` / `IMAP_USER` / `IMAP_PASS` are set.

- **`IMAP_UI_PORT`** — port (default `3847`).
- **`IMAP_UI_HOST=127.0.0.1`** — loopback-only bind.
- **`IMAP_COPY_JOB_DIR`** — directory for UI/HTTP copy job files (`spec.json`, `job.sqlite` per job UUID).

LAN exposure includes **`/api/*`**; firewall or `IMAP_UI_HOST` if needed.

**Dev:** terminal 1 `imap-tool ui`; terminal 2 `cd ui && npm run dev` (Vite proxies `/api` → `127.0.0.1:3847`).

**CLI:** `scan` / `scan-all` **`--limit N`** = same “highest N UIDs” semantics as the UI message compare.

## Configuration

Connection settings are read from the environment (and optional `--password-env` for a custom secret variable name).

| Variable | Meaning |
|----------|---------|
| `IMAP_HOST` | Server hostname |
| `IMAP_PORT` | Port (default `993` if secure, else `143`) |
| `IMAP_SECURE` | `true` / `false` / `1` / `0` |
| `IMAP_USER` | Login user |
| `IMAP_PASS` | Password (avoid shell history; prefer env file) |
| `IMAP_TLS_REJECT_UNAUTHORIZED` | Default `1`; set `0` only for testing with bad certs |

## Commands

### `ping`

Verify TLS, login, and capabilities.

```bash
IMAP_HOST=... IMAP_USER=... IMAP_PASS=... npx imap-tool ping
```

### `mailboxes`

List folders with `STATUS` (messages, unseen, recent, uidnext, uidvalidity). JSON on stdout.

```bash
npx imap-tool mailboxes
```

### `scan <mailbox>`

`EXAMINE` + batched `UID FETCH` (flags, size, internal date, envelope). Progress on stderr.

```bash
npx imap-tool scan INBOX --batch 200
npx imap-tool scan INBOX --jsonl
npx imap-tool scan INBOX --content-sha256
```

### `scan-all`

Same as `scan` for every listed mailbox (can be slow and large).

```bash
npx imap-tool scan-all --batch 200 -o baseline.json
```

### `fetch <mailbox> <uid>`

Raw RFC822 to stdout or `--output file.eml`. Uses peek-style fetch where supported.

```bash
npx imap-tool fetch INBOX 42 -o msg.eml
```

### `find <message-id fragment>`

Server-side `SEARCH` for `Message-ID` (substring). With `--all-mailboxes`, opens each folder (slow).

```bash
npx imap-tool find "<abc@host>" --mailbox INBOX
npx imap-tool find "abc@host" --all-mailboxes
```

### `compare <source.json> <dest.json>`

Compare two account-scan reports. Optional folder map:

```json
{ "INBOX": "INBOX", "Old/Arch": "Archive" }
```

```bash
npx imap-tool compare source.json dest.json --map folders.json
```

### `index-message-ids <report.json>`

Build a `messageIdNormalized → mailbox paths[]` index from an existing `scan-all` report (UC-1 helper).

### `copy` — verified two-host migration (CLI)

Copies messages **from one IMAP account to another** with per-message **SHA-256** proof: full raw message on the source, **APPEND** on the destination, then full raw **FETCH** on the destination and a hash match. State lives in a **SQLite** file (`--store`) so you can stop and resume; use **`copy pause` / `copy resume`** from another terminal while **`copy run`** is active (the runner polls a flag in the DB).

**Spec JSON** holds **both** connections and the folder map (passwords are in this file — use strict permissions, e.g. `chmod 600 migrate.json`).

```bash
npx imap-tool copy run --spec migrate.json --store job.sqlite --concurrency 2
npx imap-tool copy status --store job.sqlite --pretty
npx imap-tool copy pause --store job.sqlite
npx imap-tool copy resume --store job.sqlite
```

Example `migrate.json`:

```json
{
  "version": 1,
  "source": { "host": "old.example.com", "user": "you", "pass": "secret" },
  "destination": { "host": "new.example.com", "user": "you", "pass": "secret" },
  "folders": [{ "source": "INBOX", "destination": "INBOX" }],
  "concurrency": 2,
  "maxRetries": 5
}
```

- **First run** needs `--spec`; later runs on the same `--store` reuse the embedded spec (omit `--spec` or pass the same file).
- **Destination mailboxes** must exist (or be created by your host) before `APPEND`; the tool does not create folders yet.
- **Interrupt:** `SIGINT` finishes in-flight messages then exits; run `copy run` again to continue from the store.
- **Duplicates:** if the destination already has the same **Message-ID** and **RFC822.SIZE**, the row is verified and marked done without a second append when possible.

Library entrypoints: `runCopyJob`, `readCopyStatus`, `openCopyCheckpointStore`, etc. — see `src/copy/` and `src/index.ts`.

## Migration runbook (summary)

**Metadata-only verification**

1. **Baseline:** `imap-tool scan-all -o source.json` on the old server.
2. Migrate with your tool of choice.
3. **Destination:** `imap-tool scan-all -o dest.json` on the new server.
4. **Compare:** `imap-tool compare source.json dest.json --map map.json`.

**Verified copy inside this tool**

1. **CLI:** prepare `migrate.json` (source, destination, `folders` map), then `imap-tool copy run --spec migrate.json --store job.sqlite` (repeat until all rows are `done` or review `failed` via `copy status`).
2. **UI:** `npm run build:all`, `imap-tool ui`, open **`/copy`** — Server A = source, Server B = destination. Use **Load folders from source**, tick folders, edit **destination path** to rename on the new server (or switch to **JSON** for a raw map). **Start copy job**. Failed jobs show grouped IMAP/error text from SQLite; use **List jobs** after restart, then **Start / resume run**.
3. Optionally still run **`scan-all` + `compare`** on both sides for a mailbox-level diff.

Fingerprints use `messageId` + `rfc822Size` + `internalDate` (see `fingerprintWeak` in JSON). Duplicate `Message-ID` headers are possible; use `--content-sha256` on scans when you need byte-level identity from reports alone (expensive). The **`copy`** command always hashes full RFC822 for each migrated message.

## Copy feature status (vs. `PLAN.md` §10)

| Phase | Status |
|-------|--------|
| **F** — Library + CLI + SQLite checkpoints + bulletproof profile | **Done** (unit tests cover the store; use a real lab for end-to-end kill/resume). |
| **G** — Streaming hash (lower peak memory per message), explicit **APPENDLIMIT** handling, tuned stress on huge folders | **Partial** — APPEND size/limit errors get a clearer message; peak memory is still ~`concurrency × largest message` (ImapFlow returns full `source` buffers). |
| **H** — Web UI `/copy` + copy job HTTP API | **Done** — `POST /api/copy/jobs`, `GET /api/copy/jobs`, `GET /api/copy/jobs/:id`, `POST .../run`, `pause`, `resume`, `stop`. |

## Integration tests

If `IMAP_TEST_HOST`, `IMAP_TEST_USER`, and `IMAP_TEST_PASS` are set, additional tests can be enabled (see `test/`).

## Library

Import from `imap-tool` after build:

```ts
import { SCHEMA_VERSION } from "imap-tool";
```

Public exports are intentionally small; see `src/index.ts`.
