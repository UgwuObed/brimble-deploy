import { db } from "../db";
import { Deployment, DeploymentStatus, LogEntry } from "../types";

export const DeploymentService = {
  create(data: Pick<Deployment, "id" | "name" | "source_type" | "source_url">): Deployment {
    const stmt = db.prepare(`
      INSERT INTO deployments (id, name, source_type, source_url)
      VALUES (@id, @name, @source_type, @source_url)
    `);
    stmt.run(data);
    return this.findById(data.id)!;
  },

  findAll(): Deployment[] {
    return db.prepare(`
      SELECT * FROM deployments ORDER BY created_at DESC
    `).all() as Deployment[];
  },

  findById(id: string): Deployment | undefined {
    return db.prepare(`SELECT * FROM deployments WHERE id = ?`).get(id) as Deployment | undefined;
  },

  updateStatus(
    id: string,
    status: DeploymentStatus,
    extra: Partial<Pick<Deployment, "image_tag" | "container_id" | "container_port" | "caddy_route" | "error_message">> = {}
  ): void {
    const fields = ["status = @status", "updated_at = datetime('now')"];
    const params: Record<string, unknown> = { id, status };

    for (const [key, val] of Object.entries(extra)) {
      if (val !== undefined) {
        fields.push(`${key} = @${key}`);
        params[key] = val;
      }
    }

    db.prepare(`UPDATE deployments SET ${fields.join(", ")} WHERE id = @id`).run(params);
  },

  delete(id: string): void {
    db.prepare(`DELETE FROM deployments WHERE id = ?`).run(id);
  },
};

export const LogService = {
  append(deploymentId: string, message: string, stream: LogEntry["stream"] = "stdout"): void {
    db.prepare(`
      INSERT INTO deployment_logs (deployment_id, stream, message)
      VALUES (?, ?, ?)
    `).run(deploymentId, stream, message);
  },

  findByDeployment(deploymentId: string): LogEntry[] {
    return db.prepare(`
      SELECT * FROM deployment_logs
      WHERE deployment_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(deploymentId) as LogEntry[];
  },
};