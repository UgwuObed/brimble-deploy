export type DeploymentStatus =
  | "pending"
  | "building"
  | "deploying"
  | "running"
  | "failed";

export interface Deployment {
  id: string;
  name: string;
  source_type: "git" | "zip";
  source_url: string | null;
  status: DeploymentStatus;
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

export interface CreateDeploymentBody {
  gitUrl?: string;
  name?: string;
}

// SSE client map: deploymentId → list of response objects
export type SSEClients = Map<string, Set<import("express").Response>>;