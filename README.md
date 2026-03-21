# imap-tool

TypeScript CLI and library for **IMAP metadata** (counts, sizes, UIDs, envelopes) and **migration-style comparison**. It does not render email; it produces JSON reports you can diff.

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

React + Fastify. **Default bind `0.0.0.0`** (all IPv4); stderr lists LAN URLs. **Main page:** two independent connection forms (Server A / B), expandable **IMAP capabilities** with descriptions, **folder comparison** (LIST+STATUS), and **message comparison** (highest-UID slice + fingerprint multiset diff). **Message viewer** route: full-width aligned rows, sort by internal date, **Raw** RFC822 preview. **Capabilities** route: static glossary (`GET /api/capabilities/reference`).

Interactive flows use **`POST /api/session/*`** and **`POST /api/compare/*`** with JSON bodies (host, user, pass, TLS flags). Passwords are sent to your imap-tool process over **HTTP** unless you terminate TLS in front — use a trusted LAN or put nginx/Caddy in front for HTTPS.

```bash
npm run build:all
node bin/imap-tool.js ui
```

Optional **CLI-style env** still powers `GET /api/ping`, `GET /api/mailboxes`, `GET /api/scan` when `IMAP_HOST` / `IMAP_USER` / `IMAP_PASS` are set.

- **`IMAP_UI_PORT`** — port (default `3847`).
- **`IMAP_UI_HOST=127.0.0.1`** — loopback-only bind.

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

## Migration runbook (summary)

1. **Baseline:** `imap-tool scan-all -o source.json` on the old server.
2. Migrate with your tool of choice.
3. **Destination:** `imap-tool scan-all -o dest.json` on the new server.
4. **Compare:** `imap-tool compare source.json dest.json --map map.json`.

Fingerprints use `messageId` + `rfc822Size` + `internalDate` (see `fingerprintWeak` in JSON). Duplicate `Message-ID` headers are possible; use `--content-sha256` on scans when you need byte-level identity (expensive).

## Integration tests

If `IMAP_TEST_HOST`, `IMAP_TEST_USER`, and `IMAP_TEST_PASS` are set, additional tests can be enabled (see `test/`).

## Library

Import from `imap-tool` after build:

```ts
import { SCHEMA_VERSION } from "imap-tool";
```

Public exports are intentionally small; see `src/index.ts`.
