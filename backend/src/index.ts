import express from "express";
import cors from "cors";
import { migrate } from "./db";
import deploymentsRouter from "./routes/deployments";
import { CaddyService } from "./services/caddy.service";

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept"],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

app.use("/api/deployments", deploymentsRouter);

migrate();

app.listen(PORT, "0.0.0.0", async () => {
  console.log(`[server] Brimble backend running on port ${PORT}`);
  await CaddyService.init().catch((e) =>
    console.error("[caddy] init failed:", e)
  );
});

export default app;