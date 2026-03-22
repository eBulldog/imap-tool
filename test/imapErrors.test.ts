import { describe, expect, it } from "vitest";
import { errorText, formatImapFlowError } from "../src/copy/imapErrors.js";

describe("imapErrors", () => {
  it("errorText falls back when empty string", () => {
    expect(errorText("")).toMatch(/no message/);
  });

  it("formatImapFlowError uses responseText and status", () => {
    const e = new Error("Command failed") as Error & {
      responseStatus: string;
      responseText: string;
      executedCommand: string;
    };
    e.responseStatus = "NO";
    e.responseText = "[OVERQUOTA] Mailbox full";
    e.executedCommand = "A001 APPEND INBOX {123}";
    expect(formatImapFlowError(e)).toContain("NO");
    expect(formatImapFlowError(e)).toContain("OVERQUOTA");
    expect(formatImapFlowError(e)).toContain("APPEND");
  });

  it("formatImapFlowError handles ETHROTTLE", () => {
    const e = new Error("throttle") as Error & { code: string; throttleReset: number };
    e.code = "ETHROTTLE";
    e.throttleReset = 5000;
    expect(formatImapFlowError(e)).toContain("Throttled");
    expect(formatImapFlowError(e)).toContain("5");
  });
});
