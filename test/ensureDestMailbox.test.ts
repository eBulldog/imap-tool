import { describe, expect, it } from "vitest";
import {
  cumulativeMailboxPaths,
  mailboxPathSegments,
} from "../src/copy/ensureDestMailbox.js";

describe("ensureDestMailbox helpers", () => {
  it("mailboxPathSegments splits on delimiter", () => {
    expect(mailboxPathSegments("INBOX/InboxNew", "/")).toEqual(["INBOX", "InboxNew"]);
    expect(mailboxPathSegments("INBOX.Sent", ".")).toEqual(["INBOX", "Sent"]);
  });

  it("mailboxPathSegments keeps single segment when delimiter absent", () => {
    expect(mailboxPathSegments("Archive", ".")).toEqual(["Archive"]);
  });

  it("cumulativeMailboxPaths builds prefixes", () => {
    expect(cumulativeMailboxPaths(["INBOX", "InboxNew"], "/")).toEqual([
      "INBOX",
      "INBOX/InboxNew",
    ]);
  });
});
