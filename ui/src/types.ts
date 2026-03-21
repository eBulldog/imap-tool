export type ServerForm = {
  host: string;
  port: string;
  user: string;
  pass: string;
  secure: boolean;
  tlsRejectUnauthorized: boolean;
};

export function defaultServerForm(): ServerForm {
  return {
    host: "",
    port: "993",
    user: "",
    pass: "",
    secure: true,
    tlsRejectUnauthorized: true,
  };
}

export function formToConnectionBody(f: ServerForm): Record<string, unknown> {
  const port = f.port.trim() === "" ? undefined : Number(f.port);
  return {
    host: f.host.trim(),
    user: f.user.trim(),
    pass: f.pass,
    ...(port != null && Number.isFinite(port) ? { port } : {}),
    secure: f.secure,
    tlsRejectUnauthorized: f.tlsRejectUnauthorized,
  };
}

export type CapEntry = { name: string; description: string };

export type StatusSnap = {
  messages?: number;
  recent?: number;
  uidNext?: number;
  uidValidity?: string;
  unseen?: number;
};

export type StatusErr = { error: string };

export type ListMb = {
  path: string;
  delimiter: string;
  listed: boolean;
  subscribed: boolean;
  specialUse?: string;
  status: StatusSnap | StatusErr;
};

export type MsgRow = {
  uid: number;
  internalDate: string | null;
  subject: string | null;
  messageId: string | null;
  rfc822Size: number;
  flags: string[];
  fingerprintWeak: string;
};

export type MbSnapshot = {
  path: string;
  uidValidity?: string;
  exists?: number;
  status: StatusSnap | StatusErr;
  messages?: MsgRow[];
  scanError?: string;
};

export type ComparePairResult = {
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
};
