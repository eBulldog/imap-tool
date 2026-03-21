import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { postJson } from "../api";
import { useServers } from "../context/ServersContext";
import {
  formToConnectionBody,
  type CapEntry,
  type ListMb,
  type ComparePairResult,
} from "../types";

function statusLabel(s: ListMb["status"]): string {
  if ("error" in s) return `Error: ${s.error}`;
  const p: string[] = [];
  if (s.messages != null) p.push(`${s.messages} msgs`);
  if (s.unseen != null) p.push(`${s.unseen} unseen`);
  if (s.uidValidity != null) p.push(`uidv ${s.uidValidity}`);
  return p.join(" · ") || "—";
}

function ServerBlock({
  label,
  which,
}: {
  label: string;
  which: "A" | "B";
}) {
  const { serverA, serverB, setServerA, setServerB } = useServers();
  const f = which === "A" ? serverA : serverB;
  const set = which === "A" ? setServerA : setServerB;

  const [capsOpen, setCapsOpen] = useState(false);
  const [pingBusy, setPingBusy] = useState(false);
  const [pingErr, setPingErr] = useState<string | null>(null);
  const [detailed, setDetailed] = useState<CapEntry[] | null>(null);

  const ping = async () => {
    setPingErr(null);
    setPingBusy(true);
    setDetailed(null);
    try {
      const j = await postJson<{
        capabilitiesDetailed: CapEntry[];
      }>("/api/session/ping", formToConnectionBody(f));
      setDetailed(j.capabilitiesDetailed);
    } catch (e) {
      setPingErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPingBusy(false);
    }
  };

  return (
    <div className="server-block">
      <h2>{label}</h2>
      <div className="form-grid">
        <label>
          Host
          <input
            value={f.host}
            onChange={(e) => set({ ...f, host: e.target.value })}
            autoComplete="off"
          />
        </label>
        <label>
          Port
          <input
            value={f.port}
            onChange={(e) => set({ ...f, port: e.target.value })}
            autoComplete="off"
          />
        </label>
        <label className="span-2">
          Username
          <input
            value={f.user}
            onChange={(e) => set({ ...f, user: e.target.value })}
            autoComplete="username"
          />
        </label>
        <label className="span-2">
          Password
          <input
            type="password"
            value={f.pass}
            onChange={(e) => set({ ...f, pass: e.target.value })}
            autoComplete="current-password"
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={f.secure}
            onChange={(e) => set({ ...f, secure: e.target.checked })}
          />
          TLS / SSL (typical port 993)
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={f.tlsRejectUnauthorized}
            onChange={(e) => set({ ...f, tlsRejectUnauthorized: e.target.checked })}
          />
          Verify TLS certificate
        </label>
      </div>
      <div className="row-actions">
        <button type="button" className="primary" disabled={pingBusy} onClick={() => void ping()}>
          Ping &amp; load capabilities
        </button>
        <button type="button" onClick={() => setCapsOpen((o) => !o)} disabled={!detailed?.length}>
          {capsOpen ? "Hide" : "Show"} capability list ({detailed?.length ?? 0})
        </button>
      </div>
      {pingErr && <p className="err-box">{pingErr}</p>}
      {capsOpen && detailed && (
        <div className="caps-panel">
          <p className="hint">
            Advertised by this server. Unknown atoms use a generic note — see{" "}
            <Link to="/capabilities">full reference</Link>.
          </p>
          <ul className="cap-list">
            {detailed.map((c) => (
              <li key={c.name}>
                <span className="cap-name">{c.name}</span>
                <span className="cap-desc">{c.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function ComparePage() {
  const { serverA, serverB, setViewerPreset } = useServers();
  const navigate = useNavigate();

  const [folderBusy, setFolderBusy] = useState(false);
  const [folderErr, setFolderErr] = useState<string | null>(null);
  const [folderData, setFolderData] = useState<{
    analysis: { inBoth: string[]; onlyInA: string[]; onlyInB: string[] };
    ma: Map<string, ListMb>;
    mb: Map<string, ListMb>;
  } | null>(null);

  const [mbPathA, setMbPathA] = useState("INBOX");
  const [mbPathB, setMbPathB] = useState("INBOX");
  const [msgLimit, setMsgLimit] = useState(10);
  const [msgBusy, setMsgBusy] = useState(false);
  const [msgErr, setMsgErr] = useState<string | null>(null);
  const [msgCompare, setMsgCompare] = useState<ComparePairResult | null>(null);

  const loadFolders = async () => {
    setFolderErr(null);
    setFolderBusy(true);
    setFolderData(null);
    try {
      const j = await postJson<{
        serverA: { mailboxes: ListMb[] };
        serverB: { mailboxes: ListMb[] };
        analysis: { inBoth: string[]; onlyInA: string[]; onlyInB: string[] };
      }>("/api/compare/folders", {
        a: formToConnectionBody(serverA),
        b: formToConnectionBody(serverB),
      });
      const ma = new Map(j.serverA.mailboxes.map((m) => [m.path, m]));
      const mb = new Map(j.serverB.mailboxes.map((m) => [m.path, m]));
      setFolderData({ analysis: j.analysis, ma, mb });
    } catch (e) {
      setFolderErr(e instanceof Error ? e.message : String(e));
    } finally {
      setFolderBusy(false);
    }
  };

  const compareMessages = async () => {
    setMsgErr(null);
    setMsgCompare(null);
    setMsgBusy(true);
    try {
      const j = await postJson<{ compare: ComparePairResult }>("/api/compare/messages", {
        a: formToConnectionBody(serverA),
        b: formToConnectionBody(serverB),
        mailboxPathA: mbPathA.trim(),
        mailboxPathB: mbPathB.trim() || mbPathA.trim(),
        limit: msgLimit,
      });
      setMsgCompare(j.compare);
    } catch (e) {
      setMsgErr(e instanceof Error ? e.message : String(e));
    } finally {
      setMsgBusy(false);
    }
  };

  const openViewer = () => {
    const preset = {
      mailboxPathA: mbPathA.trim(),
      mailboxPathB: (mbPathB.trim() || mbPathA.trim()) || "INBOX",
      limit: msgLimit,
    };
    setViewerPreset(preset);
    navigate("/viewer");
  };

  const allPaths = folderData
    ? [
        ...new Set([
          ...folderData.analysis.inBoth,
          ...folderData.analysis.onlyInA,
          ...folderData.analysis.onlyInB,
        ]),
      ].sort((a, b) => a.localeCompare(b))
    : [];

  return (
    <div className="page-compare">
      <header className="page-head">
        <h1>Server compare</h1>
        <p className="sub">
          Two IMAP accounts side by side: capabilities, folders (STATUS), and a bounded UID slice for
          message-set comparison. Credentials are sent to this app over HTTP — prefer a trusted LAN
          or terminate TLS in front of the UI server when you can.
        </p>
      </header>

      <div className="two-servers">
        <ServerBlock label="Server A" which="A" />
        <ServerBlock label="Server B" which="B" />
      </div>

      <section className="panel">
        <h2>Folder comparison</h2>
        <p className="hint">
          Loads LIST+STATUS on both servers, then shows paths present on one or both sides.
        </p>
        <button type="button" className="primary" disabled={folderBusy} onClick={() => void loadFolders()}>
          {folderBusy ? "Loading…" : "Compare folder lists"}
        </button>
        {folderErr && <p className="err-box">{folderErr}</p>}
        {folderData && (
          <>
            <div className="analysis-chips">
              <span className="chip">Both: {folderData.analysis.inBoth.length}</span>
              <span className="chip warn">A only: {folderData.analysis.onlyInA.length}</span>
              <span className="chip warn">B only: {folderData.analysis.onlyInB.length}</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Path</th>
                    <th>Server A</th>
                    <th>Server B</th>
                  </tr>
                </thead>
                <tbody>
                  {allPaths.map((path) => {
                    const a = folderData.ma.get(path);
                    const b = folderData.mb.get(path);
                    return (
                      <tr key={path}>
                        <td className="mono">
                          <button
                            type="button"
                            className="linkish"
                            onClick={() => {
                              setMbPathA(path);
                              setMbPathB(path);
                            }}
                          >
                            {path}
                          </button>
                        </td>
                        <td>{a ? statusLabel(a.status) : <em className="muted">—</em>}</td>
                        <td>{b ? statusLabel(b.status) : <em className="muted">—</em>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <h2>Message comparison (UID slice)</h2>
        <p className="hint">
          Fetches the <strong>highest UIDs</strong> per mailbox (usually newest messages), then
          compares <code>fingerprintWeak</code> multisets — same idea as CLI{" "}
          <code>compare</code>. Use this to contrast what Thunderbird shows vs the server: run a
          small limit here, then open the <strong>Message viewer</strong> for a sortable,
          side-by-side table.
        </p>
        <div className="row-actions wrap">
          <label>
            Mailbox path (A)
            <input value={mbPathA} onChange={(e) => setMbPathA(e.target.value)} />
          </label>
          <label>
            Mailbox path (B)
            <input
              value={mbPathB}
              onChange={(e) => setMbPathB(e.target.value)}
              placeholder="default = same as A"
            />
          </label>
          <label>
            UID limit
            <input
              type="number"
              min={1}
              max={500}
              value={msgLimit}
              onChange={(e) => setMsgLimit(Number(e.target.value) || 10)}
            />
          </label>
          <button type="button" className="primary" disabled={msgBusy} onClick={() => void compareMessages()}>
            {msgBusy ? "Scanning…" : "Compare messages"}
          </button>
          <button type="button" disabled={msgBusy} onClick={openViewer}>
            Open message viewer with these paths
          </button>
        </div>
        {msgErr && <p className="err-box">{msgErr}</p>}
        {msgCompare && (
          <div className="compare-summary">
            <p>
              <strong>UIDVALIDITY</strong> A: {msgCompare.sourceUidValidity ?? "—"} · B:{" "}
              {msgCompare.destUidValidity ?? "—"}{" "}
              {msgCompare.uidValidityMatch ? "(match)" : <span className="warn">(differ)</span>}
            </p>
            <p>
              Messages A: {msgCompare.sourceMessageCount} · B: {msgCompare.destMessageCount} · Bytes A:{" "}
              {msgCompare.sourceByteTotal} · B: {msgCompare.destByteTotal}
            </p>
            {msgCompare.uidValidityNote && (
              <p className="hint">{msgCompare.uidValidityNote}</p>
            )}
            <p>
              Missing fingerprints in B (vs A): {msgCompare.missingInDest.length} · Unexpected in B:{" "}
              {msgCompare.unexpectedInDest.length}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
