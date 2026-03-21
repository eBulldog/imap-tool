import { createHash } from "crypto";

/** Bump when JSON report shape changes incompatibly. */
export const SCHEMA_VERSION = 1 as const;

export const REPORT_TYPE_ACCOUNT_SCAN = "imap-tool.account-scan" as const;

export interface ConnectionMeta {
  host: string;
  user: string;
}

export interface ScanOptionsRecord {
  batchSize: number;
  includeBodyStructure: boolean;
  includeContentSha256: boolean;
  /** If set, only the highest-N UIDs are fetched (typical “newest” slice). */
  limitUids?: number;
}

export interface StatusSnapshot {
  messages?: number;
  recent?: number;
  uidNext?: number;
  uidValidity?: string;
  unseen?: number;
  highestModseq?: string;
}

export interface StatusError {
  error: string;
}

export type StatusResult = StatusSnapshot | StatusError;

export interface MessageRow {
  uid: number;
  flags: string[];
  rfc822Size: number;
  internalDate: string | null;
  messageId: string | null;
  messageIdNormalized: string | null;
  subject: string | null;
  /**
   * SHA-256 hex over `${messageIdNormalized}\0${rfc822Size}\0${internalDate}`.
   * Collisions are still theoretically possible; use contentSha256 when you need octet identity.
   */
  fingerprintWeak: string;
  contentSha256?: string;
  /** Gmail OBJECTID / X-GM-MSGID style id when the server sends it. */
  providerMessageId?: string;
}

export interface MailboxSnapshot {
  path: string;
  delimiter: string;
  listed: boolean;
  subscribed: boolean;
  specialUse?: string;
  status: StatusResult;
  uidValidity?: string;
  uidNext?: number;
  exists?: number;
  readOnly?: boolean;
  messages?: MessageRow[];
  scanError?: string;
}

export interface AccountScanReport {
  schemaVersion: typeof SCHEMA_VERSION;
  reportType: typeof REPORT_TYPE_ACCOUNT_SCAN;
  generatedAt: string;
  connection: ConnectionMeta;
  scanOptions: ScanOptionsRecord;
  mailboxes: MailboxSnapshot[];
}

export class ReportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportValidationError";
  }
}

export function normalizeMessageId(raw: string | undefined | null): string | null {
  if (raw == null || raw === "") return null;
  let s = raw.trim();
  if (s.startsWith("<") && s.endsWith(">")) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

export function internalDateToIso(value: Date | string | undefined | null): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function computeFingerprintWeak(
  messageIdNormalized: string | null,
  rfc822Size: number,
  internalDateIso: string | null
): string {
  const payload = `${messageIdNormalized ?? ""}\0${rfc822Size}\0${internalDateIso ?? ""}`;
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function assertAccountScanReport(data: unknown): AccountScanReport {
  if (data === null || typeof data !== "object") {
    throw new ReportValidationError("Report root must be an object");
  }
  const o = data as Record<string, unknown>;
  if (o.schemaVersion !== SCHEMA_VERSION) {
    throw new ReportValidationError(`Unsupported schemaVersion: ${String(o.schemaVersion)}`);
  }
  if (o.reportType !== REPORT_TYPE_ACCOUNT_SCAN) {
    throw new ReportValidationError(`Unexpected reportType: ${String(o.reportType)}`);
  }
  if (!Array.isArray(o.mailboxes)) {
    throw new ReportValidationError("mailboxes must be an array");
  }
  return data as AccountScanReport;
}
