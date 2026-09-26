"use client";

import { useEffect, useRef, useState } from "react";
import { Globe, RefreshCw, LoaderCircle } from "lucide-react";
import type { WebsitePreview as Preview } from "@/lib/website-preview";
import styles from "./website-preview.module.css";

export function WebsitePreview({ sessionId, active, revision }: { sessionId: string; active: boolean; revision: number }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const currentSession = useRef(sessionId);
  useEffect(() => {
    if (currentSession.current !== sessionId) { currentSession.current = sessionId; setPreview(null); setLoading(true); setError(""); }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const response = await fetch(`/api/sessions/${sessionId}/preview`, { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Preview could not load.");
        if (controller.signal.aborted) return;
        setPreview(result.preview ?? null); setError("");
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Preview could not load.");
      } finally {
        if (!controller.signal.aborted) { setLoading(false); if (active) timer = setTimeout(read, 3000); }
      }
    };
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [sessionId, active, revision, refresh]);
  const ready = preview?.status === "ready" && preview.html;
  return <section className={styles.preview} aria-label="Generated website preview">
    <header className={styles.toolbar}>
      <div><Globe size={13} /><span>Website preview</span>{preview && <small>r{preview.revision}</small>}</div>
      <button type="button" onClick={() => { setLoading(true); setRefresh(value => value + 1); }} aria-label="Refresh website preview" title="Refresh preview"><RefreshCw size={13} className={loading ? styles.spin : ""} /></button>
    </header>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {ready ? <div className={styles.viewport}>
      <iframe key={`${sessionId}:${preview.sourceHash}:${refresh}`} title="Generated website" srcDoc={preview.html} sandbox="allow-scripts" referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'" />
    </div> : <div className={styles.empty}>
      {loading ? <LoaderCircle size={25} className={styles.spin} /> : <Globe size={27} />}
      <h3>{loading ? "Loading preview" : preview?.status === "error" ? "Preview needs an update" : "Your website will appear here"}</h3>
      <p>{loading ? "Retrieving the latest generated files." : preview?.message ?? "Ask the agent to build a website. Its index.html and local JavaScript will appear here as it writes the code."}</p>
    </div>}
    <footer className={styles.footer}><span>{ready ? "Latest generated code · click inside to interact" : "Preview updates as the agent writes files"}</span><span>Isolated preview</span></footer>
  </section>;
}
