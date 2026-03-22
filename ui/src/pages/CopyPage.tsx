import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getJson, postJson } from "../api";
import { useServers } from "../context/ServersContext";
import { formToConnectionBody, type ListMb, type ServerForm } from "../types";

const defaultFoldersJson = `[
  { "source": "INBOX", "destination": "INBOX" }
]`;

type CopyStats = {
  pending: number;
  inProgress: number;
  appended: number;
  done: number;
  failed: number;
  skipped: number;
  total: number;
};

type FailureDetails = {
  reasons: { reason: string; count: number }[];
  samples: { sourceMailbox: string; sourceUid: number; failReason: string }[];
  failedRowCount?: number;
  failedJobIds?: string[];
};

type JobPoll = {
  jobId: string;
  phase: string;
  running: boolean;
  stopRequested: boolean;
  paused: boolean;
  error?: string;
  stats: CopyStats | null;
  createdAt: string;
  jobsDir?: string;
  dataDir?: string;
  lastRunFinishedAt?: string;
  failures: FailureDetails | null;
  failureQueryError?: string;
};

type FolderMapRow = { source: string; dest: string; include: boolean };

function statLine(label: string, n: number, total: number): string {
  if (total <= 0) return `${label}: ${n}`;
  const pct = Math.round((n / total) * 1000) / 10;
  return `${label}: ${n} (${pct}%)`;
}

function TestImapConnection({ form, label }: { form: ServerForm; label: string }) {
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setOk(null);
    setErr(null);
    try {
      const j = await postJson<{ capabilities?: string[]; host?: string; user?: string }>(
        "/api/session/ping",
        formToConnectionBody(form)
      );
      const n = j.capabilities?.length ?? 0;
      setOk(`Connected as ${j.user} @ ${j.host} — ${n} capabilities advertised.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="copy-connection-test">
      <button type="button" disabled={busy} onClick={() => void run()}>
        Test connection — {label}
      </button>
      {ok && <p className="ok-box">{ok}</p>}
      {err && <p className="err-box copy-err-tight">{err}</p>}
    </div>
  );
}

export default function CopyPage() {
  const { serverA, serverB, setServerA, setServerB } = useServers();
  const [searchParams, setSearchParams] = useSearchParams();
  const [foldersJson, setFoldersJson] = useState(defaultFoldersJson);
  const [folderMapMode, setFolderMapMode] = useState<"picker" | "json">("picker");
  const [folderRows, setFolderRows] = useState<FolderMapRow[]>([]);
  const [mbLoadBusy, setMbLoadBusy] = useState(false);
  const [mbLoadErr, setMbLoadErr] = useState<string | null>(null);
  const [concurrency, setConcurrency] = useState("2");
  const [maxRetries, setMaxRetries] = useState("5");
  const [jobId, setJobId] = useState<string | null>(() => searchParams.get("job"));
  const [poll, setPoll] = useState<JobPoll | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [jobErr, setJobErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [jobList, setJobList] = useState<{ jobId: string; phase: string; running: boolean }[]>([]);

  const syncJobQuery = useCallback(
    (id: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set("job", id);
          else next.delete("job");
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  useEffect(() => {
    const j = searchParams.get("job");
    if (j && j !== jobId) setJobId(j);
  }, [searchParams, jobId]);

  const fetchJob = useCallback(async (id: string) => {
    const j = await getJson<JobPoll>(`/api/copy/jobs/${encodeURIComponent(id)}`);
    setPoll(j);
  }, []);

  useEffect(() => {
    if (!jobId) {
      setPoll(null);
      return;
    }
    void fetchJob(jobId);
    const t = window.setInterval(() => void fetchJob(jobId), 1500);
    return () => window.clearInterval(t);
  }, [jobId, fetchJob]);

  const loadSourceMailboxes = async () => {
    setMbLoadErr(null);
    setMbLoadBusy(true);
    try {
      const j = await postJson<{ mailboxes: ListMb[] }>(
        "/api/session/mailboxes",
        formToConnectionBody(serverA)
      );
      const paths = j.mailboxes.map((m) => m.path).sort((a, b) => a.localeCompare(b));
      setFolderRows(paths.map((source) => ({ source, dest: source, include: false })));
    } catch (e) {
      setMbLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setMbLoadBusy(false);
    }
  };

  const startCopy = async () => {
    setJobErr(null);
    let folders: Array<{ source: string; destination: string }>;
    if (folderMapMode === "json") {
      try {
        const parsed = JSON.parse(foldersJson) as unknown;
        if (!Array.isArray(parsed) || parsed.length === 0) {
          setJobErr("Folder map JSON must be a non-empty array.");
          return;
        }
        folders = [];
        for (const item of parsed) {
          if (!item || typeof item !== "object") {
            setJobErr("Each folder entry must be an object with source and destination.");
            return;
          }
          const o = item as Record<string, unknown>;
          const source = typeof o.source === "string" ? o.source.trim() : "";
          const destination = typeof o.destination === "string" ? o.destination.trim() : "";
          if (!source || !destination) {
            setJobErr("Each folder entry needs non-empty source and destination strings.");
            return;
          }
          folders.push({ source, destination });
        }
      } catch {
        setJobErr("Folder map must be valid JSON.");
        return;
      }
    } else {
      folders = folderRows
        .filter((r) => r.include && r.source.trim() && r.dest.trim())
        .map((r) => ({ source: r.source.trim(), destination: r.dest.trim() }));
      if (folders.length === 0) {
        setJobErr("Select at least one folder to copy, or switch to JSON mode.");
        return;
      }
    }
    setBusy(true);
    try {
      const body = {
        source: formToConnectionBody(serverA),
        destination: formToConnectionBody(serverB),
        folders,
        concurrency: Math.max(1, Math.min(32, Math.floor(Number(concurrency) || 2))),
        maxRetries: Math.max(1, Math.min(100, Math.floor(Number(maxRetries) || 5))),
      };
      const res = await postJson<{ jobId: string }>("/api/copy/jobs", body);
      setJobId(res.jobId);
      syncJobQuery(res.jobId);
    } catch (e) {
      setJobErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const postJobAction = async (path: string) => {
    if (!jobId) return;
    setJobErr(null);
    try {
      await postJson(`/api/copy/jobs/${encodeURIComponent(jobId)}${path}`, {});
      await fetchJob(jobId);
    } catch (e) {
      setJobErr(e instanceof Error ? e.message : String(e));
    }
  };

  const loadJobList = async () => {
    setListErr(null);
    try {
      const res = await getJson<{ jobs: { jobId: string; phase: string; running: boolean }[] }>(
        "/api/copy/jobs"
      );
      setJobList(res.jobs);
    } catch (e) {
      setListErr(e instanceof Error ? e.message : String(e));
      setJobList([]);
    }
  };

  const s = poll?.stats;
  const total = s?.total ?? 0;

  return (
    <div className="copy-page">
      <h1>Copy (verified migrate)</h1>
      <p className="sub">
        Two-host <strong>FETCH → SHA-256 → APPEND → verify</strong> with SQLite checkpoints. Uses the
        same connection forms as Compare (A = source / old, B = destination / new). See{" "}
        <Link to="/">Compare</Link> for folder names.
      </p>

      <div className="panel hint-panel">
        <strong>Security:</strong> credentials are sent to this imap-tool process only (not to the
        browser’s origin unless you use the dev proxy). Use a trusted network or TLS in front. Job
        state and spec files are stored under <code>IMAP_COPY_JOB_DIR</code> (default: system temp).
        Use <strong>Test connection</strong> on each server before starting a copy.
      </div>

      <div className="copy-grid">
        <section className="panel">
          <h2>Source (old server)</h2>
          <div className="form-grid">
            <label>
              Host
              <input
                value={serverA.host}
                onChange={(e) => setServerA({ ...serverA, host: e.target.value })}
                autoComplete="off"
              />
            </label>
            <label>
              Port
              <input
                value={serverA.port}
                onChange={(e) => setServerA({ ...serverA, port: e.target.value })}
                autoComplete="off"
              />
            </label>
            <label className="span-2">
              Username
              <input
                value={serverA.user}
                onChange={(e) => setServerA({ ...serverA, user: e.target.value })}
                autoComplete="username"
              />
            </label>
            <label className="span-2">
              Password
              <input
                type="password"
                value={serverA.pass}
                onChange={(e) => setServerA({ ...serverA, pass: e.target.value })}
                autoComplete="current-password"
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={serverA.secure}
                onChange={(e) => setServerA({ ...serverA, secure: e.target.checked })}
              />
              TLS (993)
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={serverA.tlsRejectUnauthorized}
                onChange={(e) =>
                  setServerA({ ...serverA, tlsRejectUnauthorized: e.target.checked })
                }
              />
              Verify TLS cert
            </label>
          </div>
          <TestImapConnection form={serverA} label="source" />
        </section>

        <section className="panel">
          <h2>Destination (new server)</h2>
          <div className="form-grid">
            <label>
              Host
              <input
                value={serverB.host}
                onChange={(e) => setServerB({ ...serverB, host: e.target.value })}
                autoComplete="off"
              />
            </label>
            <label>
              Port
              <input
                value={serverB.port}
                onChange={(e) => setServerB({ ...serverB, port: e.target.value })}
                autoComplete="off"
              />
            </label>
            <label className="span-2">
              Username
              <input
                value={serverB.user}
                onChange={(e) => setServerB({ ...serverB, user: e.target.value })}
                autoComplete="username"
              />
            </label>
            <label className="span-2">
              Password
              <input
                type="password"
                value={serverB.pass}
                onChange={(e) => setServerB({ ...serverB, pass: e.target.value })}
                autoComplete="current-password"
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={serverB.secure}
                onChange={(e) => setServerB({ ...serverB, secure: e.target.checked })}
              />
              TLS (993)
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={serverB.tlsRejectUnauthorized}
                onChange={(e) =>
                  setServerB({ ...serverB, tlsRejectUnauthorized: e.target.checked })
                }
              />
              Verify TLS cert
            </label>
          </div>
          <TestImapConnection form={serverB} label="destination" />
        </section>
      </div>

      <section className="panel">
        <h2>Folder map</h2>
        <p className="hint">
          Map each <strong>source</strong> folder (old server) to a <strong>destination</strong> path
          on the new server — edit the destination column to rename. Folders must exist on the
          destination unless your host creates them on upload.
        </p>
        <div className="folder-map-mode-toggle">
          <label className="check-inline">
            <input
              type="radio"
              name="copyMapMode"
              checked={folderMapMode === "picker"}
              onChange={() => setFolderMapMode("picker")}
            />
            Pick from source
          </label>
          <label className="check-inline">
            <input
              type="radio"
              name="copyMapMode"
              checked={folderMapMode === "json"}
              onChange={() => setFolderMapMode("json")}
            />
            JSON (advanced)
          </label>
        </div>

        {folderMapMode === "picker" ? (
          <>
            <div className="row-actions wrap" style={{ marginBottom: "0.75rem" }}>
              <button type="button" disabled={mbLoadBusy} onClick={() => void loadSourceMailboxes()}>
                Load folders from source
              </button>
              <button
                type="button"
                disabled={folderRows.length === 0}
                onClick={() => setFolderRows((rows) => rows.map((r) => ({ ...r, include: true })))}
              >
                Select all
              </button>
              <button
                type="button"
                disabled={folderRows.length === 0}
                onClick={() => setFolderRows((rows) => rows.map((r) => ({ ...r, include: false })))}
              >
                Clear all
              </button>
              <button
                type="button"
                disabled={folderRows.length === 0}
                onClick={() =>
                  setFolderRows((rows) =>
                    rows.map((r) =>
                      r.source.toUpperCase() === "INBOX" ? { ...r, include: true } : { ...r, include: false }
                    )
                  )
                }
              >
                INBOX only
              </button>
            </div>
            {mbLoadErr && <p className="err-box">{mbLoadErr}</p>}
            {folderRows.length > 0 ? (
              <div className="copy-map-table-wrap">
                <table className="copy-map-table">
                  <thead>
                    <tr>
                      <th>Copy</th>
                      <th>Source path</th>
                      <th>Destination path</th>
                    </tr>
                  </thead>
                  <tbody>
                    {folderRows.map((row, i) => (
                      <tr key={`${row.source}-${i}`}>
                        <td>
                          <input
                            type="checkbox"
                            checked={row.include}
                            onChange={(e) => {
                              const v = e.target.checked;
                              setFolderRows((rows) =>
                                rows.map((r, j) => (j === i ? { ...r, include: v } : r))
                              );
                            }}
                          />
                        </td>
                        <td className="mono">{row.source}</td>
                        <td>
                          <input
                            className="copy-dest-input"
                            type="text"
                            value={row.dest}
                            onChange={(e) => {
                              const v = e.target.value;
                              setFolderRows((rows) =>
                                rows.map((r, j) => (j === i ? { ...r, dest: v } : r))
                              );
                            }}
                            aria-label={`Destination path for ${row.source}`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="hint">Load folders from the source account, then tick the ones to copy.</p>
            )}
          </>
        ) : (
          <>
            <p className="hint">
              Array of <code>{"{ \"source\": \"path\", \"destination\": \"path\" }"}</code>.
            </p>
            <textarea
              className="folders-json"
              rows={8}
              value={foldersJson}
              onChange={(e) => setFoldersJson(e.target.value)}
              spellCheck={false}
            />
          </>
        )}
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <label>
            Concurrency
            <input
              type="number"
              min={1}
              max={32}
              value={concurrency}
              onChange={(e) => setConcurrency(e.target.value)}
            />
          </label>
          <label>
            Max retries / message
            <input
              type="number"
              min={1}
              max={100}
              value={maxRetries}
              onChange={(e) => setMaxRetries(e.target.value)}
            />
          </label>
        </div>
        <div className="row-actions" style={{ marginTop: "0.75rem" }}>
          <button type="button" className="primary" disabled={busy} onClick={() => void startCopy()}>
            Start copy job
          </button>
        </div>
        {jobErr && <p className="err-box">{jobErr}</p>}
      </section>

      {jobId && (
        <section className="panel">
          <h2>Job {jobId}</h2>
          <p className="hint mono wrap-break">
            Poll: <code>GET /api/copy/jobs/{jobId}</code>
            {poll?.dataDir && (
              <>
                <br />
                Data: <code>{poll.dataDir}</code>
              </>
            )}
          </p>
          <div className="copy-job-meta">
            <span>Phase: {poll?.phase ?? "…"}</span>
            <span>{poll?.running ? "Running" : "Idle"}</span>
            <span>{poll?.paused ? "Queue paused" : "Queue active"}</span>
            {poll?.stopRequested ? <span>Stop requested</span> : null}
            {poll?.error ? <span className="err-inline">{poll.error}</span> : null}
          </div>
          {s && (
            <ul className="copy-stats">
              <li>{statLine("Done", s.done, total)}</li>
              <li>{statLine("Pending", s.pending, total)}</li>
              <li>{statLine("Appended (verify pending)", s.appended, total)}</li>
              <li>{statLine("In progress", s.inProgress, total)}</li>
              <li>{statLine("Failed", s.failed, total)}</li>
              <li>Total: {s.total}</li>
            </ul>
          )}
          {s && s.failed > 0 && (
            <div className="copy-failures">
              <h3>Why messages failed</h3>
              {poll?.failureQueryError ? (
                <p className="err-box">
                  Could not read failure details from the job database: {poll.failureQueryError}
                </p>
              ) : null}
              {poll?.failures?.failedJobIds && poll.failures.failedJobIds.length > 1 ? (
                <p className="hint mono wrap-break">
                  Debug: failed rows reference job_ids: {poll.failures.failedJobIds.join(", ")}
                </p>
              ) : null}
              {poll?.failures &&
              (poll.failures.reasons.length > 0 || poll.failures.samples.length > 0) ? (
                <>
                  <p className="hint">
                    Errors are stored per message. Fix the cause (missing destination folder, quota,
                    APPEND limits, etc.), then start a new job or retry after fixing the server.
                  </p>
                  {poll.failures.reasons.length > 0 ? (
                    <table className="copy-fail-table">
                      <thead>
                        <tr>
                          <th scope="col">Count</th>
                          <th scope="col">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {poll.failures.reasons.map((r, i) => (
                          <tr key={i}>
                            <td>{r.count}</td>
                            <td className="mono wrap-break fail-reason-cell">{r.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                  {poll.failures.samples.length > 0 ? (
                    <>
                      <h4>Sample rows</h4>
                      <table className="copy-fail-table">
                        <thead>
                          <tr>
                            <th scope="col">Source folder</th>
                            <th scope="col">UID</th>
                            <th scope="col">Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {poll.failures.samples.map((r, i) => (
                            <tr key={i}>
                              <td className="mono">{r.sourceMailbox}</td>
                              <td>{r.sourceUid}</td>
                              <td className="mono wrap-break fail-reason-cell">{r.failReason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  ) : null}
                </>
              ) : !poll?.failureQueryError ? (
                <p className="hint">
                  No failure breakdown returned yet. Click <strong>Refresh now</strong> after upgrading
                  imap-tool. If this persists, failed rows in DB:{" "}
                  <strong>{poll?.failures?.failedRowCount ?? "—"}</strong>.
                </p>
              ) : null}
            </div>
          )}
          <div className="row-actions wrap">
            <button type="button" onClick={() => void postJobAction("/pause")}>
              Pause queue
            </button>
            <button type="button" onClick={() => void postJobAction("/resume")}>
              Resume queue
            </button>
            <button type="button" className="danger-outline" onClick={() => void postJobAction("/stop")}>
              Stop workers
            </button>
            <button
              type="button"
              className="primary"
              disabled={poll?.running}
              onClick={() => void postJobAction("/run")}
            >
              Start / resume run
            </button>
            <button type="button" onClick={() => void fetchJob(jobId)}>
              Refresh now
            </button>
          </div>
        </section>
      )}

      <section className="panel">
        <h2>Jobs on disk</h2>
        <p className="hint">After a server restart, pick a job and press &quot;Start / resume run&quot;.</p>
        <button type="button" onClick={() => void loadJobList()}>
          List jobs
        </button>
        {listErr && <p className="err-box">{listErr}</p>}
        <ul className="copy-job-list">
          {jobList.map((j) => (
            <li key={j.jobId}>
              <button
                type="button"
                className="linkish"
                onClick={() => {
                  setJobId(j.jobId);
                  syncJobQuery(j.jobId);
                }}
              >
                {j.jobId.slice(0, 8)}… — {j.phase}
                {j.running ? " (running)" : ""}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
