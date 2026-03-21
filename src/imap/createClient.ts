import { ImapFlow } from "imapflow";
import type { ResolvedImapConfig } from "./config.js";

/**
 * Creates a quiet ImapFlow client (library logging disabled; no credentials logged by this wrapper).
 */
export function createImapClient(cfg: ResolvedImapConfig): ImapFlow {
  return new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
    tls:
      cfg.tlsRejectUnauthorized === false
        ? { rejectUnauthorized: false }
        : undefined,
  });
}
