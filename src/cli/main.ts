import { readFileSync, writeFileSync } from "fs";
import { createImapClient } from "../imap/createClient.js";
import { ConfigError, resolveImapConfig } from "../imap/config.js";
import { listMailboxesWithStatus } from "../scan/listMailboxes.js";
import { scanMailboxMetadata, type ScanMailboxOptions } from "../scan/scanMailbox.js";
import { scanAllMailboxes } from "../scan/scanAll.js";
import { fetchRawRfc822ByUid } from "../fetch/rawMessage.js";
import {
  REPORT_TYPE_ACCOUNT_SCAN,
  SCHEMA_VERSION,
  type AccountScanReport,
  type ConnectionMeta,
} from "../report/schema.js";
import { jsonReplacer, stringifyReport } from "../report/jsonSerialize.js";
import { compareAccountScans, type FolderMapping } from "../compare/compareReports.js";
import { buildMessageIdIndex } from "../compare/indexMessageIds.js";
import { cmdCopy } from "./copyCli.js";

async function cmdUi(passwordEnv: string): Promise<void> {
  const { startUiServer } = await import("../ui-server/server.js");
  await startUiServer({ passwordEnv });
}

function usage(): void {
  console.error(`imap-tool — IMAP metadata & migration helper

Usage:
  imap-tool ping [--password-env NAME]
  imap-tool mailboxes [--pretty]
  imap-tool scan <mailbox> [--batch N] [--limit N] [--jsonl] [--body-structure] [--content-sha256] [--pretty]
  imap-tool scan-all [-o file] [--batch N] [--limit N] [--body-structure] [--content-sha256] [--pretty]
  imap-tool ui [--password-env NAME]
  imap-tool fetch <mailbox> <uid> [-o file]
  imap-tool find <message-id-fragment> [--mailbox PATH] [--all-mailboxes]
  imap-tool compare <source.json> <dest.json> [--map mapping.json] [--pretty]
  imap-tool index-message-ids <report.json> [--pretty]
  imap-tool copy run --spec <migrate.json> --store <job.sqlite> [--concurrency N] [--verbose]
  imap-tool copy status --store <job.sqlite> [--pretty]
  imap-tool copy pause|resume --store <job.sqlite>

Environment: IMAP_HOST, IMAP_USER, IMAP_PASS (or --password-env), IMAP_PORT, IMAP_SECURE, IMAP_TLS_REJECT_UNAUTHORIZED
`);
}

function argvFlags(argv: string[]): {
  rest: string[];
  flags: Set<string>;
  opts: Map<string, string>;
} {
  const rest: string[] = [];
  const flags = new Set<string>();
  const opts = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue;
    if (a.startsWith("-") && a !== "-") {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        const key = a.slice(0, eq);
        const val = a.slice(eq + 1);
        opts.set(key, val);
        continue;
      }
      if (a === "-o" || a === "--output") {
        opts.set("output", argv[++i] ?? "");
        continue;
      }
      if (a === "--batch") {
        opts.set("--batch", argv[++i] ?? "");
        continue;
      }
      if (a === "--password-env") {
        opts.set("--password-env", argv[++i] ?? "");
        continue;
      }
      if (a === "--map") {
        opts.set("--map", argv[++i] ?? "");
        continue;
      }
      if (a === "--mailbox") {
        opts.set("--mailbox", argv[++i] ?? "");
        continue;
      }
      if (a === "--limit") {
        opts.set("--limit", argv[++i] ?? "");
        continue;
      }
      if (a === "--spec") {
        opts.set("--spec", argv[++i] ?? "");
        continue;
      }
      if (a === "--store") {
        opts.set("--store", argv[++i] ?? "");
        continue;
      }
      if (a === "--concurrency") {
        opts.set("--concurrency", argv[++i] ?? "");
        continue;
      }
      flags.add(a);
    } else {
      rest.push(a);
    }
  }
  return { rest, flags, opts };
}

function scanOptionsFrom(flags: Set<string>, opts: Map<string, string>): ScanMailboxOptions {
  const batchRaw = opts.get("--batch") ?? "200";
  const batch = Math.max(1, Math.min(5000, Number(batchRaw) || 200));
  const limitRaw = opts.get("--limit");
  const limitParsed = limitRaw != null ? Number(limitRaw) : NaN;
  const limitUids =
    limitRaw != null && Number.isFinite(limitParsed) && limitParsed > 0
      ? Math.min(1_000_000, Math.floor(limitParsed))
      : undefined;
  return {
    batchSize: batch,
    includeBodyStructure: flags.has("--body-structure"),
    includeContentSha256: flags.has("--content-sha256"),
    limitUids,
  };
}

function connectionMeta(cfg: ReturnType<typeof resolveImapConfig>): ConnectionMeta {
  return { host: cfg.host, user: cfg.user };
}

async function cmdPing(passwordEnv: string): Promise<void> {
  const cfg = resolveImapConfig(passwordEnv);
  const client = createImapClient(cfg);
  await client.connect();
  try {
    const caps = [...client.capabilities.keys()].sort();
    console.log(
      stringifyReport(
        {
          ok: true,
          host: cfg.host,
          user: cfg.user,
          capabilities: caps,
        },
        false
      ).trimEnd()
    );
  } finally {
    await client.logout();
  }
}

async function cmdMailboxes(passwordEnv: string, pretty: boolean): Promise<void> {
  const cfg = resolveImapConfig(passwordEnv);
  const client = createImapClient(cfg);
  await client.connect();
  try {
    const mailboxes = await listMailboxesWithStatus(client);
    const report: AccountScanReport = {
      schemaVersion: SCHEMA_VERSION,
      reportType: REPORT_TYPE_ACCOUNT_SCAN,
      generatedAt: new Date().toISOString(),
      connection: connectionMeta(cfg),
      scanOptions: {
        batchSize: 0,
        includeBodyStructure: false,
        includeContentSha256: false,
      },
      mailboxes,
    };
    process.stdout.write(stringifyReport(report, pretty));
  } finally {
    await client.logout();
  }
}

async function cmdScan(
  passwordEnv: string,
  mailbox: string,
  flags: Set<string>,
  opts: Map<string, string>,
  pretty: boolean
): Promise<void> {
  const cfg = resolveImapConfig(passwordEnv);
  const client = createImapClient(cfg);
  const scanOpts = scanOptionsFrom(flags, opts);
  await client.connect();
  try {
    const mb = await scanMailboxMetadata(client, mailbox, {
      ...scanOpts,
      onBatch: (done, total) => {
        console.error(`scan ${mailbox}: ${done}/${total} uids`);
      },
    });

    if (flags.has("--jsonl") && mb.messages) {
      for (const row of mb.messages) {
        process.stdout.write(
          JSON.stringify({ mailbox: mb.path, ...row }, jsonReplacer) + "\n"
        );
      }
      return;
    }

    const report: AccountScanReport = {
      schemaVersion: SCHEMA_VERSION,
      reportType: REPORT_TYPE_ACCOUNT_SCAN,
      generatedAt: new Date().toISOString(),
      connection: connectionMeta(cfg),
      scanOptions: {
        batchSize: scanOpts.batchSize,
        includeBodyStructure: scanOpts.includeBodyStructure,
        includeContentSha256: scanOpts.includeContentSha256,
        ...(scanOpts.limitUids != null ? { limitUids: scanOpts.limitUids } : {}),
      },
      mailboxes: [mb],
    };
    process.stdout.write(stringifyReport(report, pretty));
  } finally {
    await client.logout();
  }
}

async function cmdScanAll(
  passwordEnv: string,
  flags: Set<string>,
  opts: Map<string, string>,
  pretty: boolean
): Promise<void> {
  const cfg = resolveImapConfig(passwordEnv);
  const client = createImapClient(cfg);
  const scanOpts = scanOptionsFrom(flags, opts);
  await client.connect();
  try {
    const list = await listMailboxesWithStatus(client);
    const mailboxes = await scanAllMailboxes(client, list, {
      ...scanOpts,
      onBatch: (done, total) => {
        console.error(`batch progress: ${done}/${total} uids in current mailbox`);
      },
    });
    const report: AccountScanReport = {
      schemaVersion: SCHEMA_VERSION,
      reportType: REPORT_TYPE_ACCOUNT_SCAN,
      generatedAt: new Date().toISOString(),
      connection: connectionMeta(cfg),
      scanOptions: {
        batchSize: scanOpts.batchSize,
        includeBodyStructure: scanOpts.includeBodyStructure,
        includeContentSha256: scanOpts.includeContentSha256,
        ...(scanOpts.limitUids != null ? { limitUids: scanOpts.limitUids } : {}),
      },
      mailboxes,
    };
    const out = stringifyReport(report, pretty);
    const file = opts.get("output");
    if (file) {
      writeFileSync(file, out, "utf8");
      console.error(`wrote ${file}`);
    } else {
      process.stdout.write(out);
    }
  } finally {
    await client.logout();
  }
}

async function cmdFetch(
  passwordEnv: string,
  mailbox: string,
  uidStr: string,
  outPath: string | undefined
): Promise<void> {
  const uid = Number(uidStr);
  if (!Number.isFinite(uid)) {
    throw new ConfigError("uid must be a number");
  }
  const cfg = resolveImapConfig(passwordEnv);
  const client = createImapClient(cfg);
  await client.connect();
  try {
    const { raw } = await fetchRawRfc822ByUid(client, mailbox, uid);
    if (outPath) {
      writeFileSync(outPath, raw);
      console.error(`wrote ${outPath} (${raw.length} bytes)`);
    } else {
      process.stdout.write(raw);
    }
  } finally {
    await client.logout();
  }
}

async function cmdFind(
  passwordEnv: string,
  fragment: string,
  flags: Set<string>,
  opts: Map<string, string>
): Promise<void> {
  const cfg = resolveImapConfig(passwordEnv);
  const client = createImapClient(cfg);
  await client.connect();
  try {
    const results: { mailbox: string; uids: number[] }[] = [];
    const singleMb = opts.get("--mailbox");

    async function searchOne(path: string): Promise<void> {
      await client.mailboxOpen(path, { readOnly: true });
      try {
        const uids = await client.search(
          { header: { "message-id": fragment } },
          { uid: true }
        );
        if (uids && uids.length > 0) {
          results.push({ mailbox: path, uids: [...uids].sort((a, b) => a - b) });
        }
      } finally {
        await client.mailboxClose();
      }
    }

    if (singleMb) {
      await searchOne(singleMb);
    } else if (flags.has("--all-mailboxes")) {
      const list = await listMailboxesWithStatus(client);
      const paths = list.map((l) => l.path).sort((a, b) => a.localeCompare(b));
      for (const p of paths) {
        try {
          await searchOne(p);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`find: skip ${p}: ${msg}`);
        }
      }
    } else {
      throw new ConfigError("find requires --mailbox PATH or --all-mailboxes");
    }

    console.log(stringifyReport({ fragment, results }, false).trimEnd());
  } finally {
    await client.logout();
  }
}

function cmdCompare(
  sourcePath: string,
  destPath: string,
  mapPath: string | undefined,
  pretty: boolean
): void {
  const src = JSON.parse(readFileSync(sourcePath, "utf8"));
  const dst = JSON.parse(readFileSync(destPath, "utf8"));
  let mapping: FolderMapping | undefined;
  if (mapPath) {
    mapping = JSON.parse(readFileSync(mapPath, "utf8")) as FolderMapping;
  }
  const report = compareAccountScans(src, dst, mapping ?? null);
  process.stdout.write(stringifyReport(report, pretty));
}

function cmdIndexMessageIds(reportPath: string, pretty: boolean): void {
  const raw = JSON.parse(readFileSync(reportPath, "utf8"));
  const index = buildMessageIdIndex(raw);
  process.stdout.write(stringifyReport(index, pretty));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    usage();
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const { rest, flags, opts } = argvFlags(argv);
  const pretty = flags.has("--pretty");
  const passwordEnv = opts.get("--password-env") ?? "IMAP_PASS";

  const cmd = rest[0];
  try {
    switch (cmd) {
      case "ping":
        await cmdPing(passwordEnv);
        break;
      case "mailboxes":
        await cmdMailboxes(passwordEnv, pretty);
        break;
      case "scan": {
        const mb = rest[1];
        if (!mb) throw new ConfigError("scan requires <mailbox>");
        await cmdScan(passwordEnv, mb, flags, opts, pretty);
        break;
      }
      case "scan-all":
        await cmdScanAll(passwordEnv, flags, opts, pretty);
        break;
      case "fetch": {
        const m = rest[1];
        const u = rest[2];
        if (!m || !u) throw new ConfigError("fetch requires <mailbox> <uid>");
        await cmdFetch(passwordEnv, m, u, opts.get("output"));
        break;
      }
      case "find": {
        const frag = rest[1];
        if (!frag) throw new ConfigError("find requires <message-id-fragment>");
        await cmdFind(passwordEnv, frag, flags, opts);
        break;
      }
      case "compare": {
        const a = rest[1];
        const b = rest[2];
        if (!a || !b) throw new ConfigError("compare requires <source.json> <dest.json>");
        cmdCompare(a, b, opts.get("--map"), pretty);
        break;
      }
      case "index-message-ids": {
        const p = rest[1];
        if (!p) throw new ConfigError("index-message-ids requires <report.json>");
        cmdIndexMessageIds(p, pretty);
        break;
      }
      case "ui":
        await cmdUi(passwordEnv);
        break;
      case "copy": {
        const sub = rest[1];
        if (!sub) {
          throw new ConfigError("copy requires a subcommand: run|status|pause|resume");
        }
        await cmdCopy(sub, flags, opts);
        break;
      }
      default:
        usage();
        process.exit(1);
    }
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`config: ${e.message}`);
      process.exit(2);
    }
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

void main();
