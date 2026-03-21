import { ConfigError, type ImapConnectionInput, resolvedConfigFromInput } from "../imap/config.js";
import type { ResolvedImapConfig } from "../imap/config.js";

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Parses a JSON body object into connection input (Web UI / API).
 */
export function parseImapConnectionBody(body: unknown, label = "connection"): ImapConnectionInput {
  if (body === null || typeof body !== "object") {
    throw new ConfigError(`${label} must be a JSON object`);
  }
  const o = body as Record<string, unknown>;
  const host = typeof o.host === "string" ? o.host : "";
  const user = typeof o.user === "string" ? o.user : "";
  const pass = typeof o.pass === "string" ? o.pass : "";
  const port = isNum(o.port) ? o.port : undefined;
  const secure = typeof o.secure === "boolean" ? o.secure : undefined;
  const tlsRejectUnauthorized =
    typeof o.tlsRejectUnauthorized === "boolean" ? o.tlsRejectUnauthorized : undefined;

  return {
    host,
    user,
    pass,
    port,
    secure,
    tlsRejectUnauthorized,
  };
}

export function resolvedFromBody(body: unknown, label?: string): ResolvedImapConfig {
  return resolvedConfigFromInput(parseImapConnectionBody(body, label));
}
