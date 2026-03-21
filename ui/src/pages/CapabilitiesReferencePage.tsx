import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getJson } from "../api";
import type { CapEntry } from "../types";

export default function CapabilitiesReferencePage() {
  const [entries, setEntries] = useState<CapEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const j = await getJson<{ entries: CapEntry[] }>("/api/capabilities/reference");
        setEntries(j.entries);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  return (
    <div className="page-capref">
      <header className="page-head">
        <h1>Capability reference</h1>
        <p className="sub">
          Static glossary of common IMAP CAPABILITY atoms. Your server may advertise others — those
          still appear on the compare page with a generic description. <Link to="/">← Back</Link>
        </p>
      </header>
      {err && <p className="err-box">{err}</p>}
      <ul className="cap-list ref-list">
        {entries.map((c) => (
          <li key={c.name}>
            <span className="cap-name">{c.name}</span>
            <span className="cap-desc">{c.description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
