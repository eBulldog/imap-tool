import { ConfigError } from "../imap/config.js";

/** Matches RFC 4122 UUID string (hex + hyphens; case-insensitive). */
const COPY_JOB_ID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

export function isValidCopyJobId(id: string): boolean {
  return COPY_JOB_ID_RE.test(id.trim());
}

/**
 * Validates a route or filesystem segment so it cannot escape the jobs root via `..` or odd paths.
 * @returns Normalized lowercase UUID for stable `path.join` with dirs created by `randomUUID()`.
 * @throws ConfigError when the id is not a UUID
 */
export function assertValidCopyJobId(id: string): string {
  const trimmed = id.trim();
  if (!isValidCopyJobId(trimmed)) {
    throw new ConfigError("job id must be a UUID returned by POST /api/copy/jobs");
  }
  return trimmed.toLowerCase();
}
