import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getJson, postJson } from "../api";
import { useServers } from "../context/ServersContext";
import { formToConnectionBody, type ServerForm } from "../types";

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
};

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

  const startCopy = async () => {
    setJobErr(null);
    let folders: unknown;
    try {
      folders = JSON.parse(foldersJson) as unknown;
    } catch {
      setJobErr("Folder map must be valid JSON.");
      return;
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
        <h2>Folder map (JSON)</h2>
        <p className="hint">
          Array of <code>{"{ \"source\": \"path\", \"destination\": \"path\" }"}</code>. Destination
          folders must already exist on the new server.
        </p>
        <textarea
          className="folders-json"
          rows={8}
          value={foldersJson}
          onChange={(e) => setFoldersJson(e.target.value)}
          spellCheck={false}
        />
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
              {poll?.failures && poll.failures.reasons.length > 0 ? (
                <>
                  <p className="hint">
                    Errors are stored per message on the server. Fix the cause (wrong folder, quota,
                    TLS, etc.), then run a new job or adjust the store via CLI if you are retrying the
                    same job.
                  </p>
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
                  {poll.failures.samples.length > 0 && (
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
                  )}
                </>
              ) : (
                <p className="hint">
                  Failure details are loading or unavailable. Click <strong>Refresh now</strong>.
                </p>
              )}
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
