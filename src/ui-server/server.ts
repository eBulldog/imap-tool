import fs from "fs";
import os from "os";
import path from "path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { compareMailboxSnapshots } from "../compare/compareReports.js";
import { analyzeFolderPaths } from "../compare/folderAnalysis.js";
import { ConfigError, resolveImapConfig, type ResolvedImapConfig } from "../imap/config.js";
import { createImapClient } from "../imap/createClient.js";
import { fetchRawRfc822ByUid } from "../fetch/rawMessage.js";
import { listMailboxesWithStatus } from "../scan/listMailboxes.js";
import { scanMailboxMetadata } from "../scan/scanMailbox.js";
import { allCatalogEntries, enrichCapabilities } from "./capabilitiesCatalog.js";
import { resolvedFromBody } from "./connBody.js";
import { registerCopyRoutes } from "./copyRoutes.js";

export interface UiServerOptions {
  passwordEnv?: string;
  port?: number;
  host?: string;
}

function resolveUiPort(explicit?: number): number {
  if (explicit != null && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  const raw = process.env.IMAP_UI_PORT?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 3847;
}

function resolveUiHost(explicit?: string): string {
  if (explicit != null && explicit.trim() !== "") {
    return explicit.trim();
  }
  const raw = process.env.IMAP_UI_HOST?.trim();
  if (raw) return raw;
  return "0.0.0.0";
}

function logListenHints(port: number, host: string, passwordEnv: string): void {
  if (host === "0.0.0.0") {
    const nets = os.networkInterfaces();
    const ips: string[] = [];
    for (const addrs of Object.values(nets)) {
      if (!addrs) continue;
      for (const a of addrs) {
        const fam = a.family as string | number;
        const v4 = fam === "IPv4" || fam === 4;
        if (v4 && !a.internal) {
          ips.push(a.address);
        }
      }
    }
    const uniq = [...new Set(ips)].sort();
    const lines =
      uniq.length === 0
        ? [`  http://127.0.0.1:${port}/`]
        : uniq.map((ip) => `  http://${ip}:${port}/`);
    process.stderr.write(`imap-tool UI (LAN) — try from other devices:\n${lines.join("\n")}\n`);
  } else {
    process.stderr.write(`imap-tool UI → http://${host}:${port}/\n`);
  }
  process.stderr.write(
    `CLI fallback env: ${passwordEnv} + IMAP_HOST / IMAP_USER. Web UI uses POST body credentials (use HTTPS when exposed beyond trusted LAN).\n`
  );
}

function staticRoot(): string {
  return path.join(__dirname, "..", "..", "ui", "dist");
}

async function withClient<T>(cfg: ResolvedImapConfig, fn: (c: ReturnType<typeof createImapClient>) => Promise<T>): Promise<T> {
  const client = createImapClient(cfg);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout();
  }
}

/**
 * Serves the React UI and JSON API. Defaults to **0.0.0.0** (all IPv4 interfaces).
 */
export async function startUiServer(options: UiServerOptions = {}): Promise<void> {
  const passwordEnv = options.passwordEnv ?? "IMAP_PASS";
  const port = resolveUiPort(options.port);
  const host = resolveUiHost(options.host);
  const root = staticRoot();

  if (!fs.existsSync(path.join(root, "index.html"))) {
    throw new Error(
      "Web UI is not built. Run: npm run build:ui (from the imap-tool project root)."
    );
  }

  const app = Fastify({ logger: false });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ConfigError) {
      return reply.status(400).send({ error: err.message });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return reply.status(500).send({ error: msg });
  });

  app.get("/api/health", async () => ({ ok: true }));

  /** Static reference of known capability descriptions (for browsing). */
  app.get("/api/capabilities/reference", async () => ({
    entries: allCatalogEntries(),
  }));

  function envConfigOrNull(): ResolvedImapConfig | null {
    try {
      return resolveImapConfig(passwordEnv);
    } catch {
      return null;
    }
  }

  app.get("/api/ping", async (_req, reply) => {
    const cfg = envConfigOrNull();
    if (!cfg) {
      return reply.status(400).send({
        error:
          "No CLI env config. Use POST /api/session/ping with JSON { host, user, pass, ... } or set IMAP_* env vars.",
      });
    }
    return withClient(cfg, async (client) => ({
      ok: true,
      host: cfg.host,
      user: cfg.user,
      capabilities: [...client.capabilities.keys()].sort(),
      capabilitiesDetailed: enrichCapabilities([...client.capabilities.keys()]),
    }));
  });

  app.get("/api/mailboxes", async (_req, reply) => {
    const cfg = envConfigOrNull();
    if (!cfg) {
      return reply.status(400).send({ error: "No CLI env config. Use POST /api/session/mailboxes." });
    }
    return withClient(cfg, async (client) => ({
      mailboxes: await listMailboxesWithStatus(client),
    }));
  });

  app.get<{
    Querystring: { mailbox?: string; limit?: string; batch?: string };
  }>("/api/scan", async (req, reply) => {
    const cfg = envConfigOrNull();
    if (!cfg) {
      return reply.status(400).send({ error: "No CLI env config. Use POST /api/session/scan." });
    }
    const mailbox = req.query.mailbox?.trim();
    if (!mailbox) {
      return reply.status(400).send({ error: "query parameter mailbox is required" });
    }
    const limitRaw = req.query.limit?.trim();
    const limitUids =
      limitRaw != null && limitRaw !== ""
        ? Math.min(1_000_000, Math.max(1, Math.floor(Number(limitRaw) || 0)))
        : undefined;
    const batchRaw = req.query.batch?.trim();
    const batchSize = Math.max(1, Math.min(5000, Math.floor(Number(batchRaw) || 200) || 200));

    return withClient(cfg, async (client) => {
      const snapshot = await scanMailboxMetadata(client, mailbox, {
        batchSize,
        includeBodyStructure: false,
        includeContentSha256: false,
        limitUids,
      });
      return reply.send({ mailbox: snapshot });
    });
  });

  app.post("/api/session/ping", async (req) => {
    const cfg = resolvedFromBody(req.body, "body");
    return withClient(cfg, async (client) => {
      const caps = [...client.capabilities.keys()];
      return {
        ok: true,
        host: cfg.host,
        user: cfg.user,
        capabilities: caps.sort(),
        capabilitiesDetailed: enrichCapabilities(caps),
      };
    });
  });

  app.post("/api/session/mailboxes", async (req) => {
    const cfg = resolvedFromBody(req.body, "body");
    return withClient(cfg, async (client) => ({
      mailboxes: await listMailboxesWithStatus(client),
    }));
  });

  app.post<{
    Body: {
      mailbox?: string;
      limit?: number;
      batch?: number;
    };
  }>("/api/session/scan", async (req, reply) => {
    const cfg = resolvedFromBody(req.body, "body");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const mailbox = typeof body.mailbox === "string" ? body.mailbox.trim() : "";
    if (!mailbox) {
      return reply.status(400).send({ error: "mailbox is required in JSON body" });
    }
    const limitUids =
      typeof body.limit === "number" && body.limit > 0
        ? Math.min(1_000_000, Math.floor(body.limit))
        : undefined;
    const batchSize = Math.max(
      1,
      Math.min(5000, Math.floor(Number(body.batch) || 200) || 200)
    );

    return withClient(cfg, async (client) => {
      const snapshot = await scanMailboxMetadata(client, mailbox, {
        batchSize,
        includeBodyStructure: false,
        includeContentSha256: false,
        limitUids,
      });
      return { mailbox: snapshot };
    });
  });

  app.post<{
    Body: { maxBytes?: number };
  }>("/api/session/raw", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const resolved = resolvedFromBody(body.connection ?? body, "connection");
    const mailbox = typeof body.mailbox === "string" ? body.mailbox.trim() : "";
    const uid = typeof body.uid === "number" ? body.uid : Number(body.uid);
    if (!mailbox) {
      return reply.status(400).send({ error: "mailbox is required" });
    }
    if (!Number.isFinite(uid)) {
      return reply.status(400).send({ error: "uid is required (number)" });
    }
    const maxBytes =
      typeof body.maxBytes === "number" && body.maxBytes > 0
        ? Math.min(50_000_000, Math.floor(body.maxBytes))
        : 2_000_000;

    return withClient(resolved, async (client) => {
      const { raw } = await fetchRawRfc822ByUid(client, mailbox, uid);
      const truncated = raw.length > maxBytes;
      const buf = truncated ? raw.subarray(0, maxBytes) : raw;
      return {
        mailbox,
        uid,
        byteLength: raw.length,
        truncated,
        maxBytes,
        contentBase64: buf.toString("base64"),
        encoding: "base64",
      };
    });
  });

  app.post("/api/compare/folders", async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const a = resolvedFromBody(body.a, "a");
    const b = resolvedFromBody(body.b, "b");

    const [listA, listB] = await Promise.all([
      withClient(a, async (c) => listMailboxesWithStatus(c)),
      withClient(b, async (c) => listMailboxesWithStatus(c)),
    ]);

    const pathsA = listA.map((m) => m.path);
    const pathsB = listB.map((m) => m.path);
    const analysis = analyzeFolderPaths(pathsA, pathsB);

    return {
      serverA: { host: a.host, user: a.user, mailboxes: listA },
      serverB: { host: b.host, user: b.user, mailboxes: listB },
      analysis,
    };
  });

  app.post("/api/compare/messages", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const a = resolvedFromBody(body.a, "a");
    const b = resolvedFromBody(body.b, "b");
    const pathA = typeof body.mailboxPathA === "string" ? body.mailboxPathA.trim() : "";
    const pathB =
      typeof body.mailboxPathB === "string" && body.mailboxPathB.trim() !== ""
        ? body.mailboxPathB.trim()
        : pathA;
    if (!pathA) {
      return reply.status(400).send({ error: "mailboxPathA is required" });
    }

    const limitUids =
      typeof body.limit === "number" && body.limit > 0
        ? Math.min(10_000, Math.floor(body.limit))
        : 50;
    const batchSize = Math.max(
      1,
      Math.min(5000, Math.floor(Number(body.batch) || 200) || 200)
    );

    const [snapA, snapB] = await Promise.all([
      withClient(a, async (c) =>
        scanMailboxMetadata(c, pathA, {
          batchSize,
          includeBodyStructure: false,
          includeContentSha256: false,
          limitUids,
        })
      ),
      withClient(b, async (c) =>
        scanMailboxMetadata(c, pathB, {
          batchSize,
          includeBodyStructure: false,
          includeContentSha256: false,
          limitUids,
        })
      ),
    ]);

    const compare = compareMailboxSnapshots(snapA, snapB, pathA, pathB);

    return {
      serverA: { host: a.host, mailbox: pathA, snapshot: snapA },
      serverB: { host: b.host, mailbox: pathB, snapshot: snapB },
      compare,
    };
  });

  registerCopyRoutes(app);

  await app.register(fastifyStatic, {
    root,
    prefix: "/",
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.method === "GET" && !req.url.startsWith("/api")) {
      return reply.sendFile("index.html");
    }
    return reply.status(404).send({ error: "not found" });
  });

  await app.listen({ port, host });
  logListenHints(port, host, passwordEnv);
}
