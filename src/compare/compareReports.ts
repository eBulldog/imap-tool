import { createHash } from "crypto";
import {
  SCHEMA_VERSION,
  assertAccountScanReport,
  type AccountScanReport,
  type MailboxSnapshot,
} from "../report/schema.js";
import { stringifyReport } from "../report/jsonSerialize.js";

export const COMPARE_REPORT_TYPE = "imap-tool.compare-result" as const;

export interface FolderMapping {
  [sourceMailboxPath: string]: string;
}

export interface ComparePairResult {
  sourcePath: string;
  destPath: string;
  sourceUidValidity?: string;
  destUidValidity?: string;
  uidValidityMatch: boolean;
  uidValidityNote?: string;
  sourceMessageCount: number;
  destMessageCount: number;
  sourceByteTotal: number;
  destByteTotal: number;
  missingInDest: string[];
  unexpectedInDest: string[];
  duplicateFingerprintsInSource: string[];
  duplicateFingerprintsInDest: string[];
}

export interface CompareReport {
  schemaVersion: typeof SCHEMA_VERSION;
  reportType: typeof COMPARE_REPORT_TYPE;
  generatedAt: string;
  fingerprintKind: "fingerprintWeak";
  pairs: ComparePairResult[];
}

function mailboxMap(report: AccountScanReport): Map<string, MailboxSnapshot> {
  const m = new Map<string, MailboxSnapshot>();
  for (const mb of report.mailboxes) {
    m.set(mb.path, mb);
  }
  return m;
}

function byteTotal(mb: MailboxSnapshot): number {
  if (!mb.messages?.length) return 0;
  return mb.messages.reduce((s, r) => s + r.rfc822Size, 0);
}

function fingerprintHistogram(mb: MailboxSnapshot): Map<string, number> {
  const h = new Map<string, number>();
  if (!mb.messages) return h;
  for (const r of mb.messages) {
    h.set(r.fingerprintWeak, (h.get(r.fingerprintWeak) ?? 0) + 1);
  }
  return h;
}

function multisetDiffFingerprints(
  srcHist: Map<string, number>,
  dstHist: Map<string, number>
): { missingInDest: string[]; unexpectedInDest: string[] } {
  const missing: string[] = [];
  const unexpected: string[] = [];

  const keys = new Set([...srcHist.keys(), ...dstHist.keys()]);
  for (const k of [...keys].sort()) {
    const a = srcHist.get(k) ?? 0;
    const b = dstHist.get(k) ?? 0;
    if (a > b) {
      for (let i = 0; i < a - b; i++) missing.push(k);
    } else if (b > a) {
      for (let i = 0; i < b - a; i++) unexpected.push(k);
    }
  }

  return { missingInDest: missing, unexpectedInDest: unexpected };
}

function duplicateKeys(hist: Map<string, number>): string[] {
  return [...hist.entries()]
    .filter(([, n]) => n > 1)
    .map(([k]) => k)
    .sort();
}

/**
 * Compares source and destination account scans. When `mapping` is omitted, only mailboxes with the **same path** on both sides are paired.
 */
export function compareAccountScans(
  source: unknown,
  destination: unknown,
  mapping?: FolderMapping | null
): CompareReport {
  const src = assertAccountScanReport(source);
  const dst = assertAccountScanReport(destination);
  const srcM = mailboxMap(src);
  const dstM = mailboxMap(dst);

  const pairs: ComparePairResult[] = [];
  const map = mapping && Object.keys(mapping).length > 0 ? mapping : null;

  if (map) {
    const entries = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
    for (const [srcPath, destPath] of entries) {
      const sm = srcM.get(srcPath);
      const dm = dstM.get(destPath);
      if (!sm) {
        pairs.push({
          sourcePath: srcPath,
          destPath,
          uidValidityMatch: false,
          uidValidityNote: "source_mailbox_missing",
          sourceMessageCount: 0,
          destMessageCount: dm?.messages?.length ?? 0,
          sourceByteTotal: 0,
          destByteTotal: dm ? byteTotal(dm) : 0,
          missingInDest: [],
          unexpectedInDest: [],
          duplicateFingerprintsInSource: [],
          duplicateFingerprintsInDest: dm ? duplicateKeys(fingerprintHistogram(dm)) : [],
        });
        continue;
      }
      if (!dm) {
        pairs.push({
          sourcePath: srcPath,
          destPath,
          uidValidityMatch: false,
          uidValidityNote: "destination_mailbox_missing",
          sourceMessageCount: sm.messages?.length ?? 0,
          destMessageCount: 0,
          sourceByteTotal: byteTotal(sm),
          destByteTotal: 0,
          missingInDest: [...new Set((sm.messages ?? []).map((m) => m.fingerprintWeak))].sort(),
          unexpectedInDest: [],
          duplicateFingerprintsInSource: duplicateKeys(fingerprintHistogram(sm)),
          duplicateFingerprintsInDest: [],
        });
        continue;
      }

      pairs.push(compareMailboxSnapshots(sm, dm, srcPath, destPath));
    }
  } else {
    const paths = [...srcM.keys()].filter((p) => dstM.has(p)).sort();
    for (const p of paths) {
      pairs.push(compareMailboxSnapshots(srcM.get(p)!, dstM.get(p)!, p, p));
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    reportType: COMPARE_REPORT_TYPE,
    generatedAt: new Date().toISOString(),
    fingerprintKind: "fingerprintWeak",
    pairs,
  };
}

/**
 * Compares two mailbox snapshots (same logic as report file diff for one folder pair).
 */
export function compareMailboxSnapshots(
  sm: MailboxSnapshot,
  dm: MailboxSnapshot,
  sourcePath: string,
  destPath: string
): ComparePairResult {
  const srcHist = fingerprintHistogram(sm);
  const dstHist = fingerprintHistogram(dm);
  const { missingInDest, unexpectedInDest } = multisetDiffFingerprints(srcHist, dstHist);

  const suv = sm.uidValidity;
  const duv = dm.uidValidity;
  const uidValidityMatch = suv !== undefined && duv !== undefined && suv === duv;

  let uidValidityNote: string | undefined;
  if (suv === undefined || duv === undefined) {
    uidValidityNote = "uidvalidity_missing_on_one_side";
  } else if (!uidValidityMatch) {
    uidValidityNote = "uidvalidity_differs_uids_not_comparable_across_snapshots";
  }

  return {
    sourcePath,
    destPath,
    sourceUidValidity: suv,
    destUidValidity: duv,
    uidValidityMatch,
    uidValidityNote,
    sourceMessageCount: sm.messages?.length ?? 0,
    destMessageCount: dm.messages?.length ?? 0,
    sourceByteTotal: byteTotal(sm),
    destByteTotal: byteTotal(dm),
    missingInDest,
    unexpectedInDest,
    duplicateFingerprintsInSource: duplicateKeys(srcHist),
    duplicateFingerprintsInDest: duplicateKeys(dstHist),
  };
}

export function compareReportDeterministicHash(report: CompareReport): string {
  const stable = stringifyReport(report, false);
  return createHash("sha256").update(stable, "utf8").digest("hex");
}
