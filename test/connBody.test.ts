import { describe, expect, it } from "vitest";
import { ConfigError } from "../src/imap/config.js";
import {
  parseImapConnectionBody,
  resolvedFromBody,
} from "../src/ui-server/connBody.js";

describe("connBody", () => {
  it("parseImapConnectionBody maps fields", () => {
    const c = parseImapConnectionBody({
      host: "imap.example",
      user: "a@b.c",
      pass: "secret",
      port: 993,
      secure: true,
      tlsRejectUnauthorized: false,
    });
    expect(c).toMatchObject({
      host: "imap.example",
      user: "a@b.c",
      pass: "secret",
      port: 993,
      secure: true,
      tlsRejectUnauthorized: false,
    });
  });

  it("rejects non-object body", () => {
    expect(() => parseImapConnectionBody(null)).toThrow(ConfigError);
    expect(() => parseImapConnectionBody("x")).toThrow(ConfigError);
  });

  it("resolvedFromBody requires host, user, non-empty pass", () => {
    expect(() =>
      resolvedFromBody({ host: "", user: "u", pass: "p" }, "x")
    ).toThrow(ConfigError);
    expect(() =>
      resolvedFromBody({ host: "h", user: "", pass: "p" }, "x")
    ).toThrow(ConfigError);
    expect(() =>
      resolvedFromBody({ host: "h", user: "u", pass: "" }, "x")
    ).toThrow(ConfigError);
  });
});
