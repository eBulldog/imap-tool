export {
  SCHEMA_VERSION,
  REPORT_TYPE_ACCOUNT_SCAN,
  normalizeMessageId,
  internalDateToIso,
  computeFingerprintWeak,
  assertAccountScanReport,
  ReportValidationError,
  type AccountScanReport,
  type MailboxSnapshot,
  type MessageRow,
  type ConnectionMeta,
  type ScanOptionsRecord,
} from "./report/schema.js";
export { stringifyReport, jsonReplacer } from "./report/jsonSerialize.js";
export {
  resolveImapConfig,
  resolvedConfigFromInput,
  ConfigError,
  type ResolvedImapConfig,
  type ImapConnectionInput,
} from "./imap/config.js";
export { createImapClient } from "./imap/createClient.js";
export { listMailboxesWithStatus } from "./scan/listMailboxes.js";
export { scanMailboxMetadata, type ScanMailboxOptions } from "./scan/scanMailbox.js";
export { scanAllMailboxes } from "./scan/scanAll.js";
export { fetchRawRfc822ByUid, FetchRawError } from "./fetch/rawMessage.js";
export {
  compareAccountScans,
  compareMailboxSnapshots,
  compareReportDeterministicHash,
  COMPARE_REPORT_TYPE,
  type CompareReport,
  type ComparePairResult,
  type FolderMapping,
} from "./compare/compareReports.js";
export { analyzeFolderPaths } from "./compare/folderAnalysis.js";
export {
  buildMessageIdIndex,
  mailboxesForMessageId,
  type MessageIdIndex,
} from "./compare/indexMessageIds.js";
export * from "./copy/index.js";
