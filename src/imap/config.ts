export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface ResolvedImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  tlsRejectUnauthorized: boolean;
}

/** Connection fields from the Web UI or JSON API (not env). */
export interface ImapConnectionInput {
  host: string;
  port?: number;
  user: string;
  pass: string;
  secure?: boolean;
  tlsRejectUnauthorized?: boolean;
}

function parseBool(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined || raw === "") return defaultValue;
  const v = raw.toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return defaultValue;
}

function parseBoolish(raw: boolean | undefined, defaultValue: boolean): boolean {
  if (raw === undefined) return defaultValue;
  return Boolean(raw);
}

/**
 * Builds a resolved config from explicit fields (UI / POST body). Password must be non-empty.
 */
export function resolvedConfigFromInput(input: ImapConnectionInput): ResolvedImapConfig {
  const host = input.host?.trim();
  if (!host) {
    throw new ConfigError("host is required");
  }
  const user = input.user?.trim();
  if (!user) {
    throw new ConfigError("user is required");
  }
  const pass = input.pass ?? "";
  if (pass === "") {
    throw new ConfigError("password is required (non-empty)");
  }

  const secure = parseBoolish(input.secure, true);
  const port =
    input.port != null && Number.isFinite(input.port) && input.port > 0
      ? Math.floor(input.port)
      : secure
        ? 993
        : 143;

  const tlsRejectUnauthorized = parseBoolish(input.tlsRejectUnauthorized, true);

  return {
    host,
    port,
    secure,
    user,
    pass,
    tlsRejectUnauthorized,
  };
}

/**
 * Loads IMAP connection settings from the environment.
 * @param passwordEnv - Name of the env var holding the password (default IMAP_PASS).
 */
export function resolveImapConfig(passwordEnv = "IMAP_PASS"): ResolvedImapConfig {
  const host = process.env.IMAP_HOST?.trim();
  if (!host) {
    throw new ConfigError("IMAP_HOST is required");
  }
  const user = process.env.IMAP_USER?.trim();
  if (!user) {
    throw new ConfigError("IMAP_USER is required");
  }
  const pass = process.env[passwordEnv]?.trim() ?? "";
  if (!pass) {
    throw new ConfigError(`${passwordEnv} is required (non-empty)`);
  }

  const secure = parseBool(process.env.IMAP_SECURE, true);
  const portRaw = process.env.IMAP_PORT?.trim();
  const port = portRaw
    ? Number(portRaw)
    : secure
      ? 993
      : 143;
  if (!Number.isFinite(port) || port <= 0) {
    throw new ConfigError("IMAP_PORT must be a positive number");
  }

  const tlsRejectUnauthorized = parseBool(process.env.IMAP_TLS_REJECT_UNAUTHORIZED, true);

  return {
    host,
    port,
    secure,
    user,
    pass,
    tlsRejectUnauthorized,
  };
}
