import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchDeployments,
  fetchDeployment,
  createDeploymentFromGit,
  createDeploymentFromZip,
  deleteDeployment,
  type Deployment,
} from "./api";
import { useLogStream, type LogLine } from "./useLogStream";

const STATUS_COLOR: Record<Deployment["status"], string> = {
  pending:   "#94a3b8",
  building:  "#f59e0b",
  deploying: "#3b82f6",
  running:   "#22c55e",
  failed:    "#ef4444",
};

const ACTIVE_STATUSES = new Set<Deployment["status"]>(["pending", "building", "deploying"]);

// ── Styles ─────────────────────────────────────────────────────────────────

const s = {
  root: { display: "flex", height: "100vh", overflow: "hidden" },

  // Left panel
  left: { width: 420, minWidth: 320, display: "flex", flexDirection: "column" as const,
          borderRight: "1px solid #1e293b", background: "#0f172a" },
  header: { padding: "16px 20px", borderBottom: "1px solid #1e293b",
            fontSize: 16, fontWeight: 700, letterSpacing: 1, color: "#7c3aed" },
  form: { padding: 16, borderBottom: "1px solid #1e293b" },
  formTitle: { fontSize: 11, textTransform: "uppercase" as const, letterSpacing: 1,
               color: "#64748b", marginBottom: 10 },
  tabs: { display: "flex", gap: 4, marginBottom: 12 },
  tab: (active: boolean): React.CSSProperties => ({
    padding: "4px 12px", border: "1px solid #1e293b", borderRadius: 4,
    background: active ? "#1e293b" : "transparent",
    color: active ? "#e2e8f0" : "#64748b", cursor: "pointer", fontSize: 12,
  }),
  input: { width: "100%", padding: "8px 10px", background: "#1e293b", border: "1px solid #334155",
           borderRadius: 4, color: "#e2e8f0", fontSize: 13, outline: "none" },
  btn: { marginTop: 10, width: "100%", padding: "8px 0", background: "#7c3aed",
         border: "none", borderRadius: 4, color: "#fff", fontSize: 13, cursor: "pointer" },
  btnDanger: { padding: "2px 8px", background: "transparent", border: "1px solid #ef4444",
               borderRadius: 3, color: "#ef4444", fontSize: 11, cursor: "pointer" },
  err: { marginTop: 8, fontSize: 12, color: "#ef4444" },
  list: { flex: 1, overflowY: "auto" as const, padding: "8px 0" },
  row: (active: boolean): React.CSSProperties => ({
    padding: "12px 20px", cursor: "pointer", borderBottom: "1px solid #0d1526",
    background: active ? "#1e293b" : "transparent",
    transition: "background 0.1s",
  }),
  rowName: { fontWeight: 600, fontSize: 13, color: "#e2e8f0", marginBottom: 4 },
  rowMeta: { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" as const },
  badge: (status: Deployment["status"]): React.CSSProperties => ({
    fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const,
    letterSpacing: 0.5, color: STATUS_COLOR[status],
    border: `1px solid ${STATUS_COLOR[status]}`, borderRadius: 3, padding: "1px 5px",
  }),
  tag: { fontSize: 11, color: "#64748b" },
  url: { fontSize: 11, color: "#7c3aed", textDecoration: "none" },

  // Right panel
  right: { flex: 1, display: "flex", flexDirection: "column" as const, background: "#0d0d0d" },
  logHeader: { padding: "12px 20px", borderBottom: "1px solid #1e293b",
               display: "flex", justifyContent: "space-between", alignItems: "center" },
  logTitle: { fontSize: 13, color: "#94a3b8" },
  logBody: { flex: 1, overflowY: "auto" as const, padding: 16, fontSize: 12, lineHeight: 1.7 },
  empty: { color: "#334155", padding: 20, textAlign: "center" as const },
};

const STREAM_COLOR: Record<LogLine["stream"], string> = {
  stdout: "#e2e8f0",
  stderr: "#f87171",
  system: "#7c3aed",
};

// ── Components ────────────────────────────────────────────────────────────

function DeployForm({ onCreated }: { onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"git" | "zip">("git");
  const [gitUrl, setGitUrl] = useState("");
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");

  const mut = useMutation({
    mutationFn: () =>
      tab === "git"
        ? createDeploymentFromGit(gitUrl.trim(), name.trim() || undefined)
        : createDeploymentFromZip(file!, name.trim() || undefined),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["deployments"] });
      onCreated(d.id);
      setGitUrl(""); setName(""); setFile(null); setError("");
    },
    onError: (e: Error) => setError(e.message),
  });

  const canSubmit = tab === "git" ? gitUrl.trim().length > 0 : file !== null;

  return (
    <div style={s.form}>
      <div style={s.formTitle}>New Deployment</div>
      <div style={s.tabs}>
        <button style={s.tab(tab === "git")} onClick={() => setTab("git")}>Git URL</button>
        <button style={s.tab(tab === "zip")} onClick={() => setTab("zip")}>Zip Upload</button>
      </div>
      {tab === "git" ? (
        <input
          style={s.input} placeholder="https://github.com/user/repo"
          value={gitUrl} onChange={(e) => setGitUrl(e.target.value)}
        />
      ) : (
        <input
          style={s.input} type="file" accept=".zip"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      )}
      <input
        style={{ ...s.input, marginTop: 8 }} placeholder="Name (optional)"
        value={name} onChange={(e) => setName(e.target.value)}
      />
      <button
        style={{ ...s.btn, opacity: canSubmit && !mut.isPending ? 1 : 0.5 }}
        disabled={!canSubmit || mut.isPending}
        onClick={() => mut.mutate()}
      >
        {mut.isPending ? "Deploying…" : "Deploy"}
      </button>
      {error && <div style={s.err}>{error}</div>}
    </div>
  );
}

function DeploymentRow({
  d,
  selected,
  onClick,
  onDelete,
}: {
  d: Deployment;
  selected: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  // Poll individual deployment while active so status updates even without SSE
  useQuery({
    queryKey: ["deployment", d.id],
    queryFn: () => fetchDeployment(d.id),
    enabled: ACTIVE_STATUSES.has(d.status),
    refetchInterval: 2_000,
    select: (fresh) => {
      // Merge into the list query
      return fresh;
    },
  });

  return (
    <div style={s.row(selected)} onClick={onClick}>
      <div style={{ ...s.rowName, display: "flex", justifyContent: "space-between" }}>
        <span>{d.name}</span>
        <button
          style={s.btnDanger}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
        >
          ✕
        </button>
      </div>
      <div style={s.rowMeta}>
        <span style={s.badge(d.status)}>{d.status}</span>
        {d.image_tag && <span style={s.tag}>{d.image_tag}</span>}
        {d.caddy_route && (
          <a style={s.url} href={d.caddy_route} target="_blank" rel="noreferrer">
            {d.caddy_route}
          </a>
        )}
      </div>
      {d.error_message && (
        <div style={{ fontSize: 11, color: "#ef4444", marginTop: 4 }}>{d.error_message}</div>
      )}
    </div>
  );
}

function LogPanel({ deploymentId }: { deploymentId: string | null }) {
  const { lines, done } = useLogStream(deploymentId);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines.length]);

  if (!deploymentId) {
    return (
      <div style={s.right}>
        <div style={s.empty}>Select a deployment to view logs</div>
      </div>
    );
  }

  return (
    <div style={s.right}>
      <div style={s.logHeader}>
        <span style={s.logTitle}>
          Logs — <span style={{ color: "#7c3aed" }}>{deploymentId.slice(0, 8)}</span>
        </span>
        <span style={{ fontSize: 11, color: done ? "#22c55e" : "#f59e0b" }}>
          {done ? "● done" : "● streaming"}
        </span>
      </div>
      <div style={s.logBody}>
        {lines.length === 0 && (
          <div style={{ color: "#334155" }}>Waiting for logs…</div>
        )}
        {lines.map((l, i) => (
          <div key={i} style={{ color: STREAM_COLOR[l.stream] }}>
            <span style={{ color: "#334155", userSelect: "none" }}>
              {new Date(l.ts).toLocaleTimeString()}{" "}
            </span>
            {l.message}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}


export function App() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: deployments = [] } = useQuery({
    queryKey: ["deployments"],
    queryFn: fetchDeployments,
    refetchInterval: 5_000,
  });

  const deleteMut = useMutation({
    mutationFn: deleteDeployment,
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["deployments"] });
      if (selectedId === id) setSelectedId(null);
    },
  });

  return (
    <div style={s.root}>
      <div style={s.left}>
        <div style={s.header}>⬡ Brimble Deploy</div>
        <DeployForm onCreated={setSelectedId} />
        <div style={s.list}>
          {deployments.length === 0 && (
            <div style={s.empty}>No deployments yet</div>
          )}
          {deployments.map((d) => (
            <DeploymentRow
              key={d.id}
              d={d}
              selected={d.id === selectedId}
              onClick={() => setSelectedId(d.id)}
              onDelete={() => deleteMut.mutate(d.id)}
            />
          ))}
        </div>
      </div>
      <LogPanel deploymentId={selectedId} />
    </div>
  );
}
