const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string })?.error ?? `HTTP ${r.status}`);
  return j as T;
}
export function satsToBtc(sats: number): string {
  return (sats / 100_000_000).toFixed(8).replace(/\.?0+$/, "");
}
