export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) {
    throw new Error(j.error || `${r.status} ${r.statusText}`);
  }
  return j as T;
}

export async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(path);
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) {
    throw new Error(j.error || `${r.status} ${r.statusText}`);
  }
  return j as T;
}
