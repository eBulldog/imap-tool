# imap-tool

**imap-tool** helps you **inspect**, **compare**, and **move** mail over IMAP when you care about **correctness and repeatability**. It is aimed at operators and developers doing mailbox migrations, audits, or troubleshooting—not at reading mail like a desktop client.

You get a **command-line tool**, an optional **local web dashboard**, and a **small TypeScript library** you can import in your own scripts.

---

## What it does

### Explore an account

- **Check connectivity** — TLS, login, and server capabilities (`ping`).
- **List folders** — mailbox tree plus IMAP `STATUS` (message counts, unseen, UID state) (`mailboxes`).
- **Scan messages** — per-folder metadata in batches: UIDs, flags, sizes, internal dates, envelope fields (`scan`, `scan-all`). Output is **JSON** you can archive or diff.
- **Pull one message** — raw RFC822 to a file or stdout, using peek-style fetch where the server allows it (`fetch`).
- **Find by Message-ID** — server-side search in one folder or across all folders (`find`).

### Compare two accounts (metadata)

- Run **`scan-all`** (or large **`scan`** runs) on the **old** and **new** servers, save two JSON reports, then **`compare`** them with an optional folder rename map.
- The compare view explains **which mailboxes and fingerprints** differ—useful to see if a migration “looks complete” before you trust it blindly.

### Copy mail between two servers (verified)

- **Verified copy** means: read the full message on the source, **APPEND** to the destination, read it back on the destination, and **SHA-256** the bytes so you know the copy matches.
- Progress is stored in **SQLite** so you can **stop, resume, and retry**; you can **pause** and **resume** while a run is active.
- **Destination folders** are **created automatically** when the server allows it (IMAP `CREATE` for each missing level). If the server forbids that, fix ACLs or create folders yourself.
- **Duplicates** are handled when possible: if the destination already has the same **Message-ID** and **RFC822.SIZE**, the tool can verify and skip a second append.
- Failures record **readable IMAP errors** (not just a generic “command failed”), grouped in status output and in the UI.

### Web UI (optional)

After **`npm run build:all`**, **`imap-tool ui`** serves a small React app plus a JSON API:

| Area | What you get |
|------|----------------|
| **Home / compare** | Connect to **two servers** (A and B), compare **folder lists** and **message fingerprints** for a chosen pair of mailboxes. |
| **Capabilities** | Browse what common IMAP extensions mean. |
| **Message viewer** | Pick a mailbox, browse rows, open a **raw RFC822** preview. |
| **Copy** | Same verified copy model as the CLI: map folders, start a job, watch progress, **pause / resume / stop**, and inspect **failure summaries** backed by SQLite. |

Credentials for interactive flows are sent in **POST bodies** to your local server. Treat the bind address like any admin tool: use **`IMAP_UI_HOST=127.0.0.1`** on shared machines, or put **HTTPS + auth** in front if you expose it beyond a trusted LAN.

---

## What it is not

- **Not an email client** — no threads, rendering, or compose.
- **Not a full sync engine** — copy is **one-directional** and job-oriented (source → destination with a clear folder map).
- **No built-in login on the HTTP API** — see **Security** below.

---

## Requirements

- **Node.js 20+**

## Install and sanity check

```bash
npm install
npm run build
```

Run the CLI (from this directory after build):

```bash
# If npx complains about Permission denied, use: chmod +x bin/imap-tool.js
# or: node bin/imap-tool.js …
IMAP_HOST=… IMAP_USER=… IMAP_PASS=… npx imap-tool ping
```

**Developer check:** `npm test` or **`npm run check`** (build + tests).

**Environment file:** **`.env.example`** documents `IMAP_*`. The CLI does **not** auto-load `.env`; export variables in your shell (e.g. `set -a && source ./.env && set +a`) or use your own secret manager.

---

## Web UI quick start

```bash
npm run build:all
node bin/imap-tool.js ui
```

Then open the URL printed on stderr (by default the server listens on **all IPv4 interfaces**—see **Security**).

Useful environment variables:

| Variable | Purpose |
|----------|---------|
| `IMAP_UI_PORT` | HTTP port (default **3847**). |
| `IMAP_UI_HOST` | Bind address; use **`127.0.0.1`** to stay on loopback. |
| `IMAP_COPY_JOB_DIR` | Where copy jobs store **`spec.json`** + **`job.sqlite`** (default: under the system temp directory). |

Optional: set **`IMAP_HOST`**, **`IMAP_USER`**, **`IMAP_PASS`** so legacy **`GET /api/ping`**, **`GET /api/mailboxes`**, and **`GET /api/scan`** work without posting credentials.

**UI development:** terminal 1 — `imap-tool ui`; terminal 2 — `cd ui && npm run dev` (Vite proxies `/api` to the Fastify port).

---

## Security (operators)

- **No authentication** on the HTTP API or static files. Anyone who can reach the bind address can use posted credentials against IMAP, see copy job status, and list job IDs under `IMAP_COPY_JOB_DIR`. Prefer **`IMAP_UI_HOST=127.0.0.1`**, a firewall, or a reverse proxy with TLS and your own auth.
- **Secrets on disk:** each copy job writes **`spec.json`** (includes passwords) next to **`job.sqlite`**. New job directories use mode **0700** on POSIX where supported; point **`IMAP_COPY_JOB_DIR`** at a private directory on shared hosts.
- **Copy job IDs** in URLs must be **UUIDs** (guards against odd path segments).
- **TLS verification** for IMAP defaults to **on**; turn it off only for deliberate lab work (`tlsRejectUnauthorized` in JSON / `IMAP_TLS_REJECT_UNAUTHORIZED` for CLI env).

---

## CLI environment (shared commands)

Used by `ping`, `mailboxes`, `scan`, `scan-all`, `fetch`, `find`, and optional `GET` routes in the UI. Override the password variable name with **`--password-env`**.

| Variable | Meaning |
|----------|---------|
| `IMAP_HOST` | Server hostname |
| `IMAP_PORT` | Port (default **993** if secure, else **143**) |
| `IMAP_SECURE` | `true` / `false` / `1` / `0` |
| `IMAP_USER` | Login user |
| `IMAP_PASS` | Password (avoid shell history where possible) |
| `IMAP_TLS_REJECT_UNAUTHORIZED` | Default **on**; set `0` only for broken lab certs |

---

## CLI commands

### `ping`

Verify TLS, login, and capabilities.

```bash
IMAP_HOST=… IMAP_USER=… IMAP_PASS=… npx imap-tool ping
```

### `mailboxes`

List folders with `STATUS` (messages, unseen, recent, uidnext, uidvalidity). JSON on stdout.

```bash
npx imap-tool mailboxes
```

### `scan <mailbox>`

Read-only open + batched `UID FETCH` (flags, size, internal date, envelope). Progress on stderr.

```bash
npx imap-tool scan INBOX --batch 200
npx imap-tool scan INBOX --jsonl
npx imap-tool scan INBOX --content-sha256
```

`--limit N` matches the UI: **highest N UIDs** in that folder.

### `scan-all`

Same as `scan` for every listed mailbox (can be slow and produce large JSON).

```bash
npx imap-tool scan-all --batch 200 -o baseline.json
```

### `fetch <mailbox> <uid>`

Raw RFC822 to stdout or `-o` file.

```bash
npx imap-tool fetch INBOX 42 -o msg.eml
```

### `find <message-id fragment>`

Server-side `SEARCH` on Message-ID (substring). `--all-mailboxes` opens each folder (slow).

```bash
npx imap-tool find "<abc@host>" --mailbox INBOX
npx imap-tool find "abc@host" --all-mailboxes
```

### `compare <source.json> <dest.json>`

Compare two account-scan reports. Optional folder map, e.g.:

```json
{ "INBOX": "INBOX", "Old/Arch": "Archive" }
```

```bash
npx imap-tool compare source.json dest.json --map folders.json
```

### `index-message-ids <report.json>`

Build `messageIdNormalized → mailbox paths[]` from a `scan-all` report.

### `copy` — verified migration

Copies from **source** to **destination** IMAP with per-message SHA-256 verification; state in **`--store`** SQLite.

```bash
npx imap-tool copy run --spec migrate.json --store job.sqlite --concurrency 2
npx imap-tool copy status --store job.sqlite --pretty
npx imap-tool copy pause --store job.sqlite
npx imap-tool copy resume --store job.sqlite
```

Example **`migrate.json`** (treat like a secret—`chmod 600`):

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

Notes:

- First run needs **`--spec`**; later runs on the same **`--store`** reuse the job metadata (you can omit **`--spec`** or pass the same file).
- **Ctrl+C** finishes in-flight work then exits; run **`copy run`** again to continue.
- Library entrypoints: **`runCopyJob`**, **`readCopyStatus`**, **`openCopyCheckpointStore`**, etc.—see **`src/index.ts`** and **`src/copy/`**.

### `ui`

Start the web dashboard (see **Web UI quick start**).

---

## Typical workflows

**1. Metadata-only “did everything move?”**

1. `scan-all -o source.json` on the old server.
2. Migrate with whatever tool you use.
3. `scan-all -o dest.json` on the new server.
4. `compare source.json dest.json --map map.json`.

**2. Verified copy inside imap-tool**

1. **CLI:** edit **`migrate.json`**, then **`copy run`** until stats show **done** or you inspect **failed** via **`copy status`**.
2. **UI:** open **`/copy`**, map folders, start the job, use pause/resume/stop as needed; failures show grouped reasons from SQLite.

**3. Optional sanity pass**

Still run **`scan-all` + `compare`** after a copy if you want a second, mailbox-level view.

Fingerprints in compare use **Message-ID**, **RFC822.SIZE**, and **internal date** (see `fingerprintWeak` in the JSON). For byte-level identity from scans alone you can use **`--content-sha256`** on **`scan`** (expensive). The **`copy`** path always hashes **full RFC822** per message.

---

## Copy feature status (see `PLAN.md` §10)

| Topic | Status |
|-------|--------|
| CLI + library + SQLite checkpoints + hash verify | **Done** (unit tests cover the store; exercise kill/resume against a lab server). |
| Lower peak memory per message, heavy-folder tuning | **Partial** — clearer **APPEND** limit errors; memory is still roughly **concurrency × largest message** (full buffers from the client library). |
| Web UI `/copy` + HTTP job API | **Done** |

---

## Tests

Unit tests live in **`test/`** (checkpoint store, copy spec, IMAP error text, comparisons, report schema). There are **no live IMAP tests in CI**; use a test mailbox when you change protocol behavior.

---

## Library

After **`npm run build`**, import from **`imap-tool`**:

```ts
import { SCHEMA_VERSION, runCopyJob, type CopySpecFileV1 } from "imap-tool";
```

Full public exports: **`src/index.ts`**.

---

## Architecture

For design goals, module layout, and history, see **`PLAN.md`**.
