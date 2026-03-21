import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { postJson } from "../api";
import { useServers } from "../context/ServersContext";
import {
  formToConnectionBody,
  type MsgRow,
  type MbSnapshot,
  type ComparePairResult,
} from "../types";

type PairedRow =
  | { kind: "pair"; a: MsgRow; b: MsgRow }
  | { kind: "a"; a: MsgRow }
  | { kind: "b"; b: MsgRow };

function pairRows(aIn: MsgRow[], bIn: MsgRow[]): PairedRow[] {
  const pool = [...bIn];
  const rows: PairedRow[] = [];
  for (const a of aIn) {
    const i = pool.findIndex((x) => x.fingerprintWeak === a.fingerprintWeak);
    if (i >= 0) {
      const b = pool.splice(i, 1)[0]!;
      rows.push({ kind: "pair", a, b });
    } else {
      rows.push({ kind: "a", a });
    }
  }
  for (const b of pool) {
    rows.push({ kind: "b", b });
  }
  return rows;
}

function sortMessages(rows: MsgRow[], desc: boolean): MsgRow[] {
  const out = [...rows];
  out.sort((x, y) => {
    const ax = x.internalDate ?? "";
    const ay = y.internalDate ?? "";
    const c = ay.localeCompare(ax);
    return desc ? c : -c;
  });
  return out;
}

export default function MessageViewerPage() {
  const { serverA, serverB, viewerPreset, setViewerPreset } = useServers();
  const [pathA, setPathA] = useState("INBOX");
  const [pathB, setPathB] = useState("INBOX");
  const [limit, setLimit] = useState(10);
  const [sortDesc, setSortDesc] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [snapA, setSnapA] = useState<MbSnapshot | null>(null);
  const [snapB, setSnapB] = useState<MbSnapshot | null>(null);
  const [compare, setCompare] = useState<ComparePairResult | null>(null);

  const [rawOpen, setRawOpen] = useState(false);
  const [rawText, setRawText] = useState("");
  const [rawTitle, setRawTitle] = useState("");

  useEffect(() => {
    if (viewerPreset) {
      setPathA(viewerPreset.mailboxPathA);
      setPathB(viewerPreset.mailboxPathB);
      setLimit(viewerPreset.limit);
      setViewerPreset(null);
    }
  }, [viewerPreset, setViewerPreset]);

  const load = useCallback(async () => {
    setErr(null);
    setBusy(true);
    setSnapA(null);
    setSnapB(null);
    setCompare(null);
    try {
      const j = await postJson<{
        serverA: { snapshot: MbSnapshot };
        serverB: { snapshot: MbSnapshot };
        compare: ComparePairResult;
      }>("/api/compare/messages", {
        a: formToConnectionBody(serverA),
        b: formToConnectionBody(serverB),
        mailboxPathA: pathA.trim(),
        mailboxPathB: pathB.trim() || pathA.trim(),
        limit,
      });
      setSnapA(j.serverA.snapshot);
      setSnapB(j.serverB.snapshot);
      setCompare(j.compare);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [serverA, serverB, pathA, pathB, limit]);

  const messagesA = useMemo(
    () => sortMessages(snapA?.messages ?? [], sortDesc),
    [snapA, sortDesc]
  );
  const messagesB = useMemo(
    () => sortMessages(snapB?.messages ?? [], sortDesc),
    [snapB, sortDesc]
  );

  const paired = useMemo(() => pairRows(messagesA, messagesB), [messagesA, messagesB]);

  const fetchRaw = async (side: "A" | "B", mailbox: string, uid: number) => {
    try {
      const conn = formToConnectionBody(side === "A" ? serverA : serverB);
      const j = await postJson<{
        contentBase64: string;
        truncated: boolean;
        byteLength: number;
      }>("/api/session/raw", {
        ...conn,
        mailbox,
        uid,
        maxBytes: 512_000,
      });
      const buf = Uint8Array.from(atob(j.contentBase64), (c) => c.charCodeAt(0));
      const dec = new TextDecoder("utf-8", { fatal: false });
      setRawText(dec.decode(buf) + (j.truncated ? "\n\n… truncated …" : ""));
      setRawTitle(`${side} ${mailbox} UID ${uid} (${j.byteLength} bytes)`);
      setRawOpen(true);
    } catch (e) {
      setRawText(e instanceof Error ? e.message : String(e));
      setRawTitle("Fetch error");
      setRawOpen(true);
    }
  };

  return (
    <div className="page-viewer">
      <header className="page-head viewer-head">
        <div>
          <h1>Message viewer</h1>
          <p className="sub">
            Full-width comparison of the latest UID slice on both servers, sorted by internal date.
            Align rows by <code>fingerprintWeak</code> when it matches. Compare mentally to
            Thunderbird’s sort order, or use this to spot server-side drift after moves.{" "}
            <Link to="/">← Server compare</Link>
          </p>
        </div>
        <div className="viewer-controls">
          <label>
            Path A
            <input value={pathA} onChange={(e) => setPathA(e.target.value)} />
          </label>
          <label>
            Path B
            <input value={pathB} onChange={(e) => setPathB(e.target.value)} />
          </label>
          <label>
            Limit
            <input
              type="number"
              min={1}
              max={200}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value) || 10)}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={sortDesc}
              onChange={(e) => setSortDesc(e.target.checked)}
            />
            Newest first
          </label>
          <button type="button" className="primary" disabled={busy} onClick={() => void load()}>
            {busy ? "Loading…" : "Load / refresh"}
          </button>
        </div>
      </header>

      {err && <p className="err-box">{err}</p>}

      {compare && (
        <p className="hint banner">
          UIDVALIDITY A {compare.sourceUidValidity ?? "—"} · B {compare.destUidValidity ?? "—"} ·
          missing-in-B fingerprints: {compare.missingInDest.length} · extra-in-B:{" "}
          {compare.unexpectedInDest.length}
        </p>
      )}

      <div className="viewer-wide">
        <table className="viewer-unified">
          <thead>
            <tr>
              <th colSpan={5} className="host-a">
                Server A — {serverA.host || "?"}
              </th>
              <th className="sep" aria-hidden />
              <th colSpan={5} className="host-b">
                Server B — {serverB.host || "?"}
              </th>
            </tr>
            <tr>
              <th>UID</th>
              <th>Date</th>
              <th>Subject</th>
              <th>Match</th>
              <th />
              <th className="sep" aria-hidden />
              <th>UID</th>
              <th>Date</th>
              <th>Subject</th>
              <th>Match</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {paired.map((row) => {
              const isPair = row.kind === "pair";
              const key =
                isPair
                  ? `p-${row.a.uid}-${row.b.uid}`
                  : row.kind === "a"
                    ? `a-${row.a.uid}`
                    : `b-${row.b.uid}`;
              return (
                <tr
                  key={key}
                  className={
                    isPair ? "row-pair" : row.kind === "a" ? "row-orphan-a" : "row-orphan-b"
                  }
                >
                  {row.kind === "b" ? (
                    <td colSpan={5} className="empty-side" />
                  ) : (
                    <>
                      <td className="mono">{row.a.uid}</td>
                      <td className="mono narrow">{row.a.internalDate?.slice(0, 19) ?? "—"}</td>
                      <td className="subj">{row.a.subject ?? "—"}</td>
                      <td className="mono narrow">{isPair ? "✓" : "—"}</td>
                      <td>
                        <button
                          type="button"
                          className="tiny"
                          onClick={() => void fetchRaw("A", pathA, row.a.uid)}
                        >
                          Raw
                        </button>
                      </td>
                    </>
                  )}
                  <td className="sep" aria-hidden />
                  {row.kind === "a" ? (
                    <td colSpan={5} className="empty-side" />
                  ) : (
                    <>
                      <td className="mono">{row.b.uid}</td>
                      <td className="mono narrow">{row.b.internalDate?.slice(0, 19) ?? "—"}</td>
                      <td className="subj">{row.b.subject ?? "—"}</td>
                      <td className="mono narrow">{isPair ? "✓" : "—"}</td>
                      <td>
                        <button
                          type="button"
                          className="tiny"
                          onClick={() => void fetchRaw("B", pathB, row.b.uid)}
                        >
                          Raw
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rawOpen && (
        <div className="modal-back" role="presentation" onClick={() => setRawOpen(false)}>
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <header>
              <h3>{rawTitle}</h3>
              <button type="button" onClick={() => setRawOpen(false)}>
                Close
              </button>
            </header>
            <pre className="raw-pre">{rawText}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
