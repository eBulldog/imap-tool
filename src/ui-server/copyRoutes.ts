import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import type { FastifyInstance } from "fastify";
import { ConfigError } from "../imap/config.js";
import { parseCopySpecJson } from "../copy/spec.js";
import { readCopyStatus, runCopyJob, setCopyPaused } from "../copy/jobRunner.js";
import type { CopySpecFileV1 } from "../copy/jobTypes.js";
import { parseImapConnectionBody } from "./connBody.js";

export type CopyJobPhase = "idle" | "running" | "stopped" | "completed" | "failed";

export type CopyJobEntry = {
  id: string;
  dir: string;
  storePath: string;
  specPath: string;
  phase: CopyJobPhase;
  error?: string;
  stopRequested: boolean;
  running: boolean;
  startedAt: string;
  lastRunFinishedAt?: string;
};

const activeJobs = new Map<string, CopyJobEntry>();

export function resolveCopyJobsDir(): string {
  const env = process.env.IMAP_COPY_JOB_DIR?.trim();
  if (env) return env;
  return path.join(os.tmpdir(), "imap-tool-copy-jobs");
}

const jobsDir = resolveCopyJobsDir();

function ensureJobsDir(): void {
  fs.mkdirSync(jobsDir, { recursive: true });
}

function parseFolders(body: Record<string, unknown>): CopySpecFileV1["folders"] {
  const raw = body.folders;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ConfigError("folders must be a non-empty array of { source, destination }");
  }
  const out: CopySpecFileV1["folders"] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      throw new ConfigError("invalid folder map entry");
    }
    const o = item as Record<string, unknown>;
    const s = typeof o.source === "string" ? o.source.trim() : "";
    const d = typeof o.destination === "string" ? o.destination.trim() : "";
    if (!s || !d) {
      throw new ConfigError("each folder entry needs non-empty source and destination");
    }
    out.push({ source: s, destination: d });
  }
  return out;
}

function buildSpecFromBody(body: Record<string, unknown>): CopySpecFileV1 {
  const source = parseImapConnectionBody(body.source, "source");
  const destination = parseImapConnectionBody(body.destination, "destination");
  const folders = parseFolders(body);
  let concurrency: number | undefined;
  if (body.concurrency != null) {
    const n = Math.floor(Number(body.concurrency));
    if (Number.isFinite(n)) {
      concurrency = Math.max(1, Math.min(32, n));
    }
  }
  let maxRetries: number | undefined;
  if (body.maxRetries != null) {
    const n = Math.floor(Number(body.maxRetries));
    if (Number.isFinite(n)) {
      maxRetries = Math.max(1, Math.min(100, n));
    }
  }
  const spec: CopySpecFileV1 = {
    version: 1,
    source,
    destination,
    folders,
    ...(concurrency != null ? { concurrency } : {}),
    ...(maxRetries != null ? { maxRetries } : {}),
  };
  parseCopySpecJson(spec);
  return spec;
}

function getOrCreateJobEntry(id: string): CopyJobEntry | null {
  const existing = activeJobs.get(id);
  if (existing) return existing;
  const storePath = path.join(jobsDir, id, "job.sqlite");
  if (!fs.existsSync(storePath)) return null;
  const dir = path.join(jobsDir, id);
  const rec: CopyJobEntry = {
    id,
    dir,
    storePath,
    specPath: path.join(dir, "spec.json"),
    phase: "idle",
    stopRequested: false,
    running: false,
    startedAt: "",
  };
  activeJobs.set(id, rec);
  return rec;
}

async function runJobLoop(rec: CopyJobEntry): Promise<void> {
  if (rec.running) return;
  rec.running = true;
  rec.stopRequested = false;
  rec.phase = "running";
  rec.error = undefined;
  try {
    await runCopyJob({
      storePath: rec.storePath,
      specPath: fs.existsSync(rec.specPath) ? rec.specPath : undefined,
      isStopped: () => rec.stopRequested,
    });
    rec.phase = rec.stopRequested ? "stopped" : "completed";
  } catch (e) {
    rec.phase = "failed";
    rec.error = e instanceof Error ? e.message : String(e);
  } finally {
    rec.running = false;
    rec.lastRunFinishedAt = new Date().toISOString();
  }
}

/**
 * Registers verified-copy job HTTP API (§10): create job, poll status, pause / stop / re-run.
 */
export function registerCopyRoutes(app: FastifyInstance): void {
  ensureJobsDir();

  app.post("/api/copy/jobs", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const spec = buildSpecFromBody(body);
    const id = randomUUID();
    const dir = path.join(jobsDir, id);
    fs.mkdirSync(dir, { recursive: true });
    const specPath = path.join(dir, "spec.json");
    const storePath = path.join(dir, "job.sqlite");
    fs.writeFileSync(specPath, JSON.stringify(spec, null, 2), "utf8");

    const rec: CopyJobEntry = {
      id,
      dir,
      storePath,
      specPath,
      phase: "idle",
      stopRequested: false,
      running: false,
      startedAt: new Date().toISOString(),
    };
    activeJobs.set(id, rec);
    void runJobLoop(rec);

    return reply.send({
      jobId: id,
      jobsDir,
      message: "Copy job started in background. Poll GET /api/copy/jobs/:id",
    });
  });

  app.get("/api/copy/jobs", async () => {
    ensureJobsDir();
    const ids = fs.existsSync(jobsDir)
      ? fs
          .readdirSync(jobsDir)
          .filter((id) => fs.existsSync(path.join(jobsDir, id, "job.sqlite")))
      : [];

    const jobs = ids.map((id) => {
      const rec = activeJobs.get(id);
      let snapshot: ReturnType<typeof readCopyStatus> | null = null;
      try {
        snapshot = readCopyStatus(path.join(jobsDir, id, "job.sqlite"));
      } catch {
        /* store not initialized yet */
      }
      return {
        jobId: id,
        phase: rec?.phase ?? "unknown",
        running: rec?.running ?? false,
        paused: snapshot?.paused ?? false,
        createdAt: snapshot?.createdAt ?? null,
        stats: snapshot?.stats ?? null,
      };
    });

    return { jobsDir, jobs };
  });

  app.get<{ Params: { id: string } }>("/api/copy/jobs/:id", async (req, reply) => {
    const id = req.params.id;
    const storePath = path.join(jobsDir, id, "job.sqlite");
    if (!fs.existsSync(storePath)) {
      return reply.status(404).send({ error: "job not found" });
    }
    const rec = getOrCreateJobEntry(id);

    let snapshot: ReturnType<typeof readCopyStatus> | null = null;
    try {
      snapshot = readCopyStatus(storePath);
    } catch {
      /* */
    }

    return {
      jobId: id,
      jobsDir,
      phase: rec?.phase ?? "unknown",
      running: rec?.running ?? false,
      stopRequested: rec?.stopRequested ?? false,
      error: rec?.error,
      startedAt: rec?.startedAt,
      lastRunFinishedAt: rec?.lastRunFinishedAt,
      dataDir: path.join(jobsDir, id),
      paused: snapshot?.paused ?? false,
      createdAt: snapshot?.createdAt ?? "",
      stats: snapshot?.stats ?? null,
    };
  });

  app.post<{ Params: { id: string } }>("/api/copy/jobs/:id/run", async (req, reply) => {
    const id = req.params.id;
    const rec = getOrCreateJobEntry(id);
    if (!rec) {
      return reply.status(404).send({ error: "job not found" });
    }
    if (rec.running) {
      return reply.status(409).send({ error: "job already running" });
    }
    void runJobLoop(rec);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/copy/jobs/:id/pause", async (req, reply) => {
    const id = req.params.id;
    const storePath = path.join(jobsDir, id, "job.sqlite");
    if (!fs.existsSync(storePath)) {
      return reply.status(404).send({ error: "job not found" });
    }
    getOrCreateJobEntry(id);
    setCopyPaused(storePath, true);
    return { ok: true, paused: true };
  });

  app.post<{ Params: { id: string } }>("/api/copy/jobs/:id/resume", async (req, reply) => {
    const id = req.params.id;
    const storePath = path.join(jobsDir, id, "job.sqlite");
    if (!fs.existsSync(storePath)) {
      return reply.status(404).send({ error: "job not found" });
    }
    getOrCreateJobEntry(id);
    setCopyPaused(storePath, false);
    return { ok: true, paused: false };
  });

  app.post<{ Params: { id: string } }>("/api/copy/jobs/:id/stop", async (req, reply) => {
    const id = req.params.id;
    const rec = getOrCreateJobEntry(id);
    if (!rec) {
      return reply.status(404).send({ error: "job not found" });
    }
    rec.stopRequested = true;
    return { ok: true, stopRequested: true };
  });
}
