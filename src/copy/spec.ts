import { ConfigError, resolvedConfigFromInput, type ImapConnectionInput } from "../imap/config.js";
import { COPY_SPEC_VERSION, type CopyFolderPair, type CopySpecFileV1 } from "./jobTypes.js";

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function parseConnection(label: string, raw: unknown): ImapConnectionInput {
  if (!isRecord(raw)) {
    throw new ConfigError(`${label} must be an object`);
  }
  return {
    host: String(raw.host ?? ""),
    port: raw.port != null ? Number(raw.port) : undefined,
    user: String(raw.user ?? ""),
    pass: String(raw.pass ?? ""),
    secure: raw.secure != null ? Boolean(raw.secure) : undefined,
    tlsRejectUnauthorized:
      raw.tlsRejectUnauthorized != null ? Boolean(raw.tlsRejectUnauthorized) : undefined,
  };
}

function parseFolders(raw: unknown): CopyFolderPair[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ConfigError("folders must be a non-empty array");
  }
  const out: CopyFolderPair[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      throw new ConfigError("each folder map entry must be an object");
    }
    const source = String(entry.source ?? "").trim();
    const destination = String(entry.destination ?? "").trim();
    if (!source || !destination) {
      throw new ConfigError("each folder map needs non-empty source and destination");
    }
    out.push({ source, destination });
  }
  return out;
}

/**
 * Parses and normalizes a copy spec JSON object.
 */
export function parseCopySpecJson(data: unknown): CopySpecFileV1 {
  if (!isRecord(data)) {
    throw new ConfigError("copy spec must be a JSON object");
  }
  const version = data.version;
  if (version !== COPY_SPEC_VERSION) {
    throw new ConfigError(`copy spec version must be ${COPY_SPEC_VERSION}`);
  }
  const spec: CopySpecFileV1 = {
    version: COPY_SPEC_VERSION,
    source: parseConnection("source", data.source),
    destination: parseConnection("destination", data.destination),
    folders: parseFolders(data.folders),
    concurrency:
      data.concurrency != null && Number.isFinite(Number(data.concurrency))
        ? Math.max(1, Math.min(32, Math.floor(Number(data.concurrency))))
        : undefined,
    maxRetries:
      data.maxRetries != null && Number.isFinite(Number(data.maxRetries))
        ? Math.max(1, Math.min(100, Math.floor(Number(data.maxRetries))))
        : undefined,
  };
  resolvedConfigFromInput(spec.source);
  resolvedConfigFromInput(spec.destination);
  return spec;
}
