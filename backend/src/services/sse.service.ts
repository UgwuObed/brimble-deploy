import { Response } from "express";

const clients = new Map<string, Set<Response>>();

export const SSEManager = {
  add(deploymentId: string, res: Response): void {
    if (!clients.has(deploymentId)) {
      clients.set(deploymentId, new Set());
    }
    clients.get(deploymentId)!.add(res);
  },

  remove(deploymentId: string, res: Response): void {
    clients.get(deploymentId)?.delete(res);
    if (clients.get(deploymentId)?.size === 0) {
      clients.delete(deploymentId);
    }
  },

  push(deploymentId: string, message: string, stream: "stdout" | "stderr" | "system" = "stdout"): void {
    const payload = JSON.stringify({ stream, message, ts: new Date().toISOString() });
    const sseData = `data: ${payload}\n\n`;

    clients.get(deploymentId)?.forEach((res) => {
      try {
        res.write(sseData);
      } catch {
        // Client disconnected mid-stream; cleaned up on the close event.
      }
    });
  },

  pushDone(deploymentId: string): void {
    const sseData = `event: done\ndata: {}\n\n`;
    clients.get(deploymentId)?.forEach((res) => {
      try {
        res.write(sseData);
      } catch { /* ignore */ }
    });
  },

  clientCount(deploymentId: string): number {
    return clients.get(deploymentId)?.size ?? 0;
  },
};
