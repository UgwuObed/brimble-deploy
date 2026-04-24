import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import simpleGit from "simple-git";
import extractZip from "extract-zip";
import { DeploymentService, LogService } from "../services/deployment.service";
import { CaddyService } from "../services/caddy.service";
import { SSEManager } from "../services/sse.service";
import { allocatePort } from "../services/port.service";

const LOGS_DIR = process.env.LOGS_DIR || path.join(__dirname, "../../data/logs");

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function log(
  deploymentId: string,
  message: string,
  stream: "stdout" | "stderr" | "system" = "stdout"
) {
  const line = `[${new Date().toISOString()}] ${message}`;
  LogService.append(deploymentId, message, stream);
  SSEManager.push(deploymentId, message, stream);

  const logFile = path.join(LOGS_DIR, `${deploymentId}.log`);
  fs.appendFileSync(logFile, line + "\n");
}

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  deploymentId: string
): Promise<number> {
  return new Promise((resolve) => {
    log(deploymentId, `$ ${cmd} ${args.join(" ")}`, "system");

    const proc = spawn(cmd, args, { cwd, shell: false });

    proc.stdout.on("data", (chunk: Buffer) => {
      chunk
        .toString()
        .split("\n")
        .filter(Boolean)
        .forEach((line) => log(deploymentId, line, "stdout"));
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      chunk
        .toString()
        .split("\n")
        .filter(Boolean)
        .forEach((line) => log(deploymentId, line, "stderr"));
    });

    proc.on("close", (code) => resolve(code ?? 1));
    proc.on("error", (err) => {
      log(deploymentId, `Process error: ${err.message}`, "stderr");
      resolve(1);
    });
  });
}

export async function runPipeline(deploymentId: string): Promise<void> {
  const deployment = DeploymentService.findById(deploymentId);
  if (!deployment) return;

  const workDir = path.join(os.tmpdir(), `brimble-${deploymentId}`);

  try {
    DeploymentService.updateStatus(deploymentId, "building");
    log(deploymentId, `Starting pipeline for deployment ${deploymentId}`, "system");

    fs.mkdirSync(workDir, { recursive: true });

    if (deployment.source_type === "zip") {
      if (!deployment.source_url) throw new Error("Zip deployment missing source path");
      log(deploymentId, `Extracting zip: ${deployment.source_url} ...`, "system");
      await extractZip(deployment.source_url, { dir: workDir });
      log(deploymentId, "Extraction complete.", "system");
      fs.rmSync(deployment.source_url, { force: true });
    } else {
      log(deploymentId, `Cloning ${deployment.source_url} ...`, "system");
      const git = simpleGit();
      await git.clone(deployment.source_url!, workDir, ["--depth=1"]);
      log(deploymentId, "Clone complete.", "system");
    }

    const imageTag = `brimble-deploy-${deploymentId}:latest`;
    log(deploymentId, `Building image with Railpack: ${imageTag}`, "system");

    const buildCode = await runCommand(
      "railpack",
      ["build", "--name", imageTag, "."],
      workDir,
      deploymentId
    );

    if (buildCode !== 0) {
      throw new Error(`Railpack build failed with exit code ${buildCode}`);
    }

    log(deploymentId, `Image built successfully: ${imageTag}`, "system");
    DeploymentService.updateStatus(deploymentId, "deploying", { image_tag: imageTag });

    const port = allocatePort();
    log(deploymentId, `Deploying container on host port ${port} ...`, "system");

    const runCode = await runCommand(
      "docker",
      [
        "run",
        "-d",
        "--name", `brimble-${deploymentId}`,
        "-p", `${port}:3000`,
        "-e", `DEPLOYMENT_ID=${deploymentId}`,
        "--restart", "unless-stopped",
        imageTag,
      ],
      workDir,
      deploymentId
    );

    if (runCode !== 0) {
      throw new Error(`docker run failed with exit code ${runCode}`);
    }

    const { execSync } = await import("child_process");
    const containerId = execSync(
      `docker inspect --format='{{.Id}}' brimble-${deploymentId}`
    )
      .toString()
      .trim()
      .slice(0, 12);

    log(deploymentId, `Container started: ${containerId}`, "system");

    DeploymentService.updateStatus(deploymentId, "running", {
      image_tag: imageTag,
      container_id: containerId,
      container_port: port,
    });

    log(deploymentId, `Registering Caddy route for /deploy/${deploymentId} → :${port}`, "system");
    await CaddyService.addRoute(deploymentId, port);

    const publicUrl = CaddyService.getPublicUrl(deploymentId);
    DeploymentService.updateStatus(deploymentId, "running", {
      caddy_route: publicUrl,
    });

    log(deploymentId, `🎉 Deployment live at: ${publicUrl}`, "system");

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log(deploymentId, `Pipeline failed: ${message}`, "stderr");
    DeploymentService.updateStatus(deploymentId, "failed", { error_message: message });
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch { /* ignore */ }

    SSEManager.pushDone(deploymentId);
  }
}
