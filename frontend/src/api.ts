const BASE = "/api";

export interface Deployment {
  id: string;
  name: string;
  source_type: "git" | "zip";
  source_url: string | null;
  status: "pending" | "building" | "deploying" | "running" | "failed";
  image_tag: string | null;
  container_id: string | null;
  container_port: number | null;
  caddy_route: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface LogEntry {
  id: number;
  deployment_id: string;
  stream: "stdout" | "stderr" | "system";
  message: string;
  created_at: string;
}

export async function fetchDeployments(): Promise<Deployment[]> {
  const res = await fetch(`${BASE}/deployments`);
  if (!res.ok) throw new Error("Failed to fetch deployments");
  const json = await res.json();
  return json.data;
}

export async function fetchDeployment(id: string): Promise<Deployment> {
  const res = await fetch(`${BASE}/deployments/${id}`);
  if (!res.ok) throw new Error("Failed to fetch deployment");
  const json = await res.json();
  return json.data;
}

export async function createDeploymentFromGit(gitUrl: string, name?: string): Promise<Deployment> {
  const res = await fetch(`${BASE}/deployments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gitUrl, name }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? "Failed to create deployment");
  }
  const json = await res.json();
  return json.data;
}

export async function createDeploymentFromZip(file: File, name?: string): Promise<Deployment> {
  const form = new FormData();
  form.append("zipFile", file);
  if (name) form.append("name", name);

  const res = await fetch(`${BASE}/deployments`, { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? "Failed to create deployment");
  }
  const json = await res.json();
  return json.data;
}

export async function deleteDeployment(id: string): Promise<void> {
  const res = await fetch(`${BASE}/deployments/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete deployment");
}

export async function fetchLogs(id: string): Promise<LogEntry[]> {
  const res = await fetch(`${BASE}/deployments/${id}/logs`);
  if (!res.ok) throw new Error("Failed to fetch logs");
  const json = await res.json();
  return json.data;
}

export function openLogStream(id: string): EventSource {
  return new EventSource(`${BASE}/deployments/${id}/logs/stream`);
}
