import { useEffect, useRef, useState } from "react";
import { openLogStream } from "./api";

export interface LogLine {
  stream: "stdout" | "stderr" | "system";
  message: string;
  ts: string;
}

export function useLogStream(deploymentId: string | null) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [done, setDone] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!deploymentId) return;

    setLines([]);
    setDone(false);

    const es = openLogStream(deploymentId);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data) as LogLine;
        setLines((prev) => [...prev, parsed]);
      } catch {
        // ignore malformed frames
      }
    };

    es.addEventListener("done", () => {
      setDone(true);
      es.close();
    });

    es.onerror = () => {
      // Connection dropped — mark done so UI stops showing spinner
      setDone(true);
      es.close();
    };

    return () => {
      es.close();
    };
  }, [deploymentId]);

  return { lines, done };
}
