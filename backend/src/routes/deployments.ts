import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import multer from "multer";
import path from "path";
import fs from "fs";
import os from "os";
import { DeploymentService, LogService } from "../services/deployment.service";
import { SSEManager } from "../services/sse.service";
import { runPipeline } from "../workers/pipeline.worker";

const router = Router();
const upload = multer({ dest: path.join(os.tmpdir(), "brimble-uploads") });

router.get("/", (_req: Request, res: Response) => {
  const deployments = DeploymentService.findAll();
  res.json({ data: deployments });
});

router.get("/:id", (req: Request, res: Response) => {
  const deployment = DeploymentService.findById(req.params.id);
  if (!deployment) {
    res.status(404).json({ error: "Deployment not found" });
    return;
  }
  res.json({ data: deployment });
});

router.post("/", upload.single("zipFile"), (req: Request, res: Response) => {
  const { gitUrl, name } = req.body as { gitUrl?: string; name?: string };
  const file = req.file;

  if (!gitUrl && !file) {
    res.status(400).json({ error: "Provide either gitUrl or a zip file upload" });
    return;
  }

  const id = uuidv4();
  const deploymentName =
    name ||
    (gitUrl ? gitUrl.split("/").pop()?.replace(".git", "") : file?.originalname) ||
    `deploy-${id.slice(0, 8)}`;

  const deployment = DeploymentService.create({
    id,
    name: deploymentName,
    source_type: gitUrl ? "git" : "zip",
    source_url: gitUrl || file?.path || null,
  });

  runPipeline(id).catch((err) => {
    console.error(`[pipeline] unhandled error for ${id}:`, err);
  });

  res.status(201).json({ data: deployment });
});

router.delete("/:id", async (req: Request, res: Response) => {
  const deployment = DeploymentService.findById(req.params.id);
  if (!deployment) {
    res.status(404).json({ error: "Deployment not found" });
    return;
  }

  if (deployment.container_id) {
    const { execSync } = await import("child_process");
    try {
      execSync(`docker stop brimble-${deployment.id} && docker rm brimble-${deployment.id}`, {
        stdio: "ignore",
      });
    } catch { /* container may already be stopped */ }
  }

  const { CaddyService } = await import("../services/caddy.service");
  await CaddyService.removeRoute(deployment.id).catch(() => {});

  DeploymentService.delete(deployment.id);
  res.json({ success: true });
});

router.get("/:id/logs", (req: Request, res: Response) => {
  const deployment = DeploymentService.findById(req.params.id);
  if (!deployment) {
    res.status(404).json({ error: "Deployment not found" });
    return;
  }

  const logs = LogService.findByDeployment(req.params.id);
  res.json({ data: logs });
});

router.get("/:id/logs/stream", (req: Request, res: Response) => {
  const { id } = req.params;
  const deployment = DeploymentService.findById(id);

  if (!deployment) {
    res.status(404).json({ error: "Deployment not found" });
    return;
  }

  // Must flush headers immediately or the browser won't treat this as SSE.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  if (deployment.status === "running" || deployment.status === "failed") {
    const logs = LogService.findByDeployment(id);
    logs.forEach((entry) => {
      const payload = JSON.stringify({
        stream: entry.stream,
        message: entry.message,
        ts: entry.created_at,
      });
      res.write(`data: ${payload}\n\n`);
    });
    res.write(`event: done\ndata: {}\n\n`);
    res.end();
    return;
  }

  SSEManager.add(id, res);

  const existingLogs = LogService.findByDeployment(id);
  existingLogs.forEach((entry) => {
    const payload = JSON.stringify({
      stream: entry.stream,
      message: entry.message,
      ts: entry.created_at,
    });
    res.write(`data: ${payload}\n\n`);
  });

  // Heartbeat keeps the connection alive through proxies and load balancers.
  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 15_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    SSEManager.remove(id, res);
  });
});

export default router;
