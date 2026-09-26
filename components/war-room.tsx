"use client";

import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  AudioLines,
  Box,
  BrainCircuit,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Crosshair,
  Database,
  Fingerprint,
  Focus,
  GitBranch,
  Layers3,
  LockKeyhole,
  Maximize2,
  Network,
  Pause,
  Play,
  Radio,
  RotateCcw,
  ScanLine,
  Shield,
  ShieldCheck,
  ShieldX,
  Siren,
  Sparkles,
  Swords,
  Terminal,
  Timer,
  TriangleAlert,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import { createInitialRun } from "@/lib/simulation";
import type { Run, ScenarioId, DefensePolicy } from "@/lib/types";

const Scene = dynamic(() => import("./war-room-scene"), {
  ssr: false,
  loading: () => (
    <div className="scene-loading">
      <Box size={30} />
      <span>Initializing the cyber range</span>
      <div className="loader-line" />
    </div>
  ),
});
type Panel = "room" | "history" | "memory";
type Storage = { mode: string; persisted: boolean };
type Health = {
  database: { mode: string; connected: boolean };
  ai: { configured: boolean; model: string };
};
type ApiRun = { run: Run; storage: Storage };
const agentIcons = [ScanLine, Fingerprint, Shield, GitBranch, BrainCircuit];
const scenarioMeta: Record<
  string,
  {
    title: string;
    tag: string;
    description: string;
    icon: typeof Shield;
    duration: string;
  }
> = {
  ransomware: {
    title: "Ransomware outbreak",
    tag: "LATERAL MOVEMENT",
    description:
      "A compromised workstation is patient zero. Stop the infection before it reaches your data vault.",
    icon: LockKeyhole,
    duration: "~90 seconds",
  },
  "supply-chain": {
    title: "Supply chain breach",
    tag: "TRUST EXPLOITATION",
    description:
      "A poisoned deployment slips through the perimeter. Trace the dependency and isolate the source.",
    icon: GitBranch,
    duration: "~90 seconds",
  },
  exfiltration: {
    title: "Silent exfiltration",
    tag: "DATA THEFT",
    description:
      "An insider is moving sensitive data through a trusted gateway. Find the signal in the noise.",
    icon: Database,
    duration: "~90 seconds",
  },
};

class SceneBoundary extends Component<
  { children: ReactNode; nodes: Run["nodes"]; onSelect: (id: string) => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="fallback-map">
        <p>Network topology · compatibility view</p>
        {this.props.nodes.map((n) => (
          <button
            key={n.id}
            onClick={() => this.props.onSelect(n.id)}
            className={`fallback-node ${n.status}`}
          >
            <Database />
            <span>{n.label}</span>
            <small>{n.status}</small>
          </button>
        ))}
      </div>
    ) : (
      this.props.children
    );
  }
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}
function time(tick: number) {
  return `${String(Math.floor((tick * 2) / 60)).padStart(2, "0")}:${String((tick * 2) % 60).padStart(2, "0")}`;
}
function shortTime(date: string) {
  return new Date(date).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function WarRoom() {
  const [run, setRun] = useState<Run>(() =>
    createInitialRun("ransomware", 42, {
      id: "preview",
      createdAt: "2026-09-26T12:00:00.000Z",
    }),
  );
  const [panel, setPanel] = useState<Panel>("room");
  const [scenarioId, setScenarioId] = useState<ScenarioId>("ransomware");
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [view, setView] = useState<"network" | "threat">("network");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [storage, setStorage] = useState<Storage | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [useLearnedPolicy, setUseLearnedPolicy] = useState(true);
  const [sound, setSound] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [history, setHistory] = useState<Run[]>([]);
  const [memory, setMemory] = useState<unknown>(null);
  const [replayTick, setReplayTick] = useState<number | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const pending = useRef(false);
  const runRef = useRef(run);
  const soundRef = useRef(sound);
  const audioRef = useRef<AudioContext | null>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDialogElement>(null);
  const helpRef = useRef<HTMLDialogElement>(null);
  const isPreview = run.id === "preview";
  const isRunning = run.status === "running" && !paused && replayTick === null;
  const isFinished = run.status === "contained" || run.status === "breached";
  useEffect(() => {
    runRef.current = run;
  }, [run]);
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);
  useEffect(() => {
    api<Health>("/api/health")
      .then(setHealth)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (scenarioOpen) modalRef.current?.showModal();
    else modalRef.current?.close();
  }, [scenarioOpen]);
  useEffect(() => {
    if (helpOpen) helpRef.current?.showModal();
    else helpRef.current?.close();
  }, [helpOpen]);

  const accept = useCallback((result: ApiRun) => {
    runRef.current = result.run;
    setRun(result.run);
    setStorage(result.storage);
    setError(null);
  }, []);
  const chirp = useCallback(() => {
    if (!soundRef.current) return;
    try {
      const ctx = audioRef.current;
      if (!ctx) return;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.frequency.setValueAtTime(520, ctx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(
        780,
        ctx.currentTime + 0.09,
      );
      gain.gain.setValueAtTime(0.035, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.15);
    } catch {}
  }, []);
  useEffect(() => {
    if (!isRunning || isPreview || replayTick !== null) return;
    const timer = setInterval(async () => {
      if (pending.current) return;
      pending.current = true;
      const current = runRef.current;
      try {
        const result = await api<ApiRun>(`/api/runs/${current.id}/step`, {
          method: "POST",
          body: JSON.stringify({ expectedTick: current.tick }),
        });
        if (runRef.current.id === current.id) {
          accept(result);
          chirp();
        }
      } catch (e) {
        if (runRef.current.id === current.id) {
          try {
            const latest = await api<ApiRun>(`/api/runs/${current.id}`);
            if (runRef.current.id === current.id) accept(latest);
          } catch {}
          setError((e as Error).message);
          setPaused(true);
        }
      } finally {
        pending.current = false;
      }
    }, 2200 / speed);
    return () => {
      clearInterval(timer);
    };
  }, [isRunning, isPreview, replayTick, run.id, speed, accept, chirp]);

  async function launch(id = scenarioId, learnedPolicy = useLearnedPolicy) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setScenarioOpen(false);
    try {
      const result = await api<ApiRun>("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          scenarioId: id,
          seed: 42,
          autoDefend: run.autoDefend,
          aiEnabled,
          useLearnedPolicy: learnedPolicy,
        }),
      });
      accept(result);
      setPaused(false);
      setPanel("room");
      setReplayTick(null);
      setSelectedNodeId(null);
      setSelectedAgent(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function action(type: string, nodeId?: string, enabled?: boolean) {
    if (pending.current || busy) return;
    pending.current = true;
    setBusy(true);
    try {
      const result = await api<ApiRun>(`/api/runs/${run.id}/action`, {
        method: "POST",
        body: JSON.stringify({ type, nodeId, enabled }),
      });
      accept(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function changePanel(next: Panel) {
    setPanel(next);
    setHistoryLoading(true);
    try {
      if (next === "history") {
        const body = await api<{ runs: Run[] }>("/api/runs");
        setHistory(body.runs || []);
      }
      if (next === "memory") setMemory(await api("/api/memory"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setHistoryLoading(false);
    }
  }
  async function openRun(id: string) {
    if (busy) return;
    setPaused(true);
    setBusy(true);
    try {
      const body = await api<ApiRun>(`/api/runs/${id}`);
      accept(body);
      setPaused(true);
      setReplayTick(null);
      setPanel("room");
      setScenarioId(body.run.scenarioId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function reset() {
    setPaused(true);
    const preview = createInitialRun(scenarioId, 42, {
      id: "preview",
      createdAt: "2026-09-26T12:00:00.000Z",
      autoDefend: run.autoDefend,
    });
    runRef.current = preview;
    setRun(preview);
    setStorage(null);
    setSelectedNodeId(null);
    setReplayTick(null);
    setError(null);
  }
  function exportRun() {
    const blob = new Blob([JSON.stringify(run, null, 2)], {
      type: "application/json",
    });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `aegis-${run.scenarioId}-${run.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(href);
  }
  function toggleSound() {
    if (!sound) {
      audioRef.current ??= new AudioContext();
      void audioRef.current.resume();
    }
    setSound(!sound);
  }

  const snapshots = (
    run as Run & {
      snapshots?: {
        tick: number;
        nodes: Run["nodes"];
        metrics: Run["metrics"];
      }[];
    }
  ).snapshots;
  const snapshot =
    replayTick !== null ? snapshots?.find((s) => s.tick === replayTick) : null;
  const nodes = snapshot?.nodes || run.nodes;
  const metrics = snapshot?.metrics || run.metrics;
  const shownTick = replayTick ?? run.tick;
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const selectedAgentData = run.agents.find((a) => a.id === selectedAgent);
  const events = run.events
    .filter(
      (e) =>
        (!selectedAgent || e.agentId === selectedAgent) &&
        (replayTick === null || e.tick <= replayTick),
    )
    .slice(-18)
    .reverse();
  const atlasConnected =
    health?.database.connected && health.database.mode === "atlas";
  const statusText =
    replayTick !== null
      ? "INCIDENT REPLAY"
      : isPreview
        ? "RANGE READY"
        : run.status === "contained"
          ? "THREAT CONTAINED"
          : run.status === "breached"
            ? "BREACH CONFIRMED"
            : replayTick !== null
              ? "INCIDENT REPLAY"
              : paused
                ? "SIMULATION PAUSED"
                : "SIMULATION LIVE";

  return (
    <div className="app-shell">
      <aside className="rail">
        <a href="/" className="brand-mark" aria-label="Aegis home">
          <Shield size={25} strokeWidth={1.6} />
          <span>A</span>
        </a>
        <div className="rail-links">
          <button
            title="War room"
            aria-label="War room"
            className={panel === "room" ? "active" : ""}
            onClick={() => setPanel("room")}
          >
            <Network size={21} />
          </button>
          <button
            title="Incident archive"
            aria-label="Incident archive"
            className={panel === "history" ? "active" : ""}
            onClick={() => changePanel("history")}
          >
            <Layers3 size={21} />
          </button>
          <button
            title="Agent memory"
            aria-label="Agent memory"
            className={panel === "memory" ? "active" : ""}
            onClick={() => changePanel("memory")}
          >
            <BrainCircuit size={21} />
          </button>
        </div>
        <div className="rail-bottom">
          <button
            onClick={() => setHelpOpen(true)}
            aria-label="How it works"
            title="How it works"
          >
            <CircleHelp size={20} />
          </button>
          <div className="avatar">DT</div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="wordmark">
            AEGIS
            <span className="wordmark-separator" />
            <span className="workspace-label">Defense workspace</span>
            <ChevronDown size={13} />
          </div>
          <div className="topbar-right">
            <span className="sandbox-pill">
              <span className="dot" />
              SANDBOX
            </span>
            <span className="topbar-separator" />
            <button className="subtle-button" onClick={() => setHelpOpen(true)}>
              Mission briefing
              <ArrowUpRightIcon />
            </button>
            <span className="version">v.01</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">AUTONOMOUS CYBER DEFENSE</div>
              <h1>
                {panel === "room"
                  ? "The war room."
                  : panel === "history"
                    ? "Incident archive."
                    : "A defense that remembers."}
              </h1>
              <p>
                {panel === "room"
                  ? "One network. Five agents. No second chances."
                  : panel === "history"
                    ? "Every decision, every response. Revisit the full chain of events."
                    : "Lessons from the last incident become the next line of defense."}
              </p>
            </div>
            <div className="heading-actions">
              <span className="small-label">
                {isPreview
                  ? "YOUR NEXT EXERCISE"
                  : `EXERCISE ${run.id.slice(0, 6).toUpperCase()}`}
              </span>
              <button
                className="scenario-picker"
                onClick={() => setScenarioOpen(true)}
              >
                <Swords size={16} />
                {scenarioMeta[scenarioId]?.title}
                <ChevronDown size={14} />
              </button>
            </div>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <TriangleAlert size={16} />
              <span>{error}</span>
              <button onClick={() => setError(null)} aria-label="Dismiss error">
                <X size={15} />
              </button>
            </div>
          )}
          {panel === "room" ? (
            <>
              <section className="metrics" aria-label="Simulation metrics">
                <Metric
                  label="Network integrity"
                  value={`${Math.round(metrics.integrity)}%`}
                  icon={<ShieldCheck size={17} />}
                  detail={
                    isPreview
                      ? "All systems operational"
                      : `${nodes.filter((n) => n.status === "healthy").length} assets healthy`
                  }
                  color="green"
                  spark={
                    run.history.length > 1
                      ? run.history.slice(-12).map((h) => h.integrity / 7)
                      : [14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14]
                  }
                />
                <Metric
                  label="Active threats"
                  value={String(
                    nodes.filter(
                      (n) =>
                        n.status === "compromised" || n.status === "exposed",
                    ).length,
                  ).padStart(2, "0")}
                  icon={<Crosshair size={17} />}
                  detail={
                    isPreview
                      ? "Awaiting attack injection"
                      : `${metrics.threatsBlocked} attack attempts blocked`
                  }
                  color="orange"
                  spark={
                    run.history.length > 1
                      ? run.history.slice(-12).map((h) => h.compromised * 2 + 1)
                      : [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
                  }
                />
                <Metric
                  label="Agents online"
                  value="05"
                  icon={<BrainCircuit size={17} />}
                  detail="Specialists working as one"
                  color="purple"
                  avatars
                />
                <Metric
                  label="Time elapsed"
                  value={time(shownTick)}
                  icon={<Timer size={17} />}
                  detail={
                    isPreview
                      ? "Ready when you are"
                      : isFinished
                        ? "Exercise complete"
                        : `${speed}× simulation speed`
                  }
                  color="neutral"
                  spark={Array.from(
                    { length: 12 },
                    (_, i) => Math.min(shownTick, i) / 2 + 1,
                  )}
                />
              </section>
              <div className="command-grid">
                <section className="network-panel" ref={sceneRef}>
                  <div className="panel-bar">
                    <div className="panel-title">
                      <span className="dot lime" />
                      Live network
                      <span className="count-tag">{nodes.length} ASSETS</span>
                    </div>
                    <div className="view-tabs">
                      <button
                        className={view === "network" ? "selected" : ""}
                        onClick={() => setView("network")}
                      >
                        <Box size={13} />
                        Topology
                      </button>
                      <button
                        className={view === "threat" ? "selected" : ""}
                        onClick={() => setView("threat")}
                      >
                        <Crosshair size={13} />
                        Threat map
                      </button>
                    </div>
                  </div>
                  <div
                    className={`scene-wrap ${view === "threat" ? "threat-view" : ""}`}
                  >
                    <div className="scene-corner">
                      <span
                        className={`live-label ${run.status === "breached" ? "danger" : ""}`}
                      >
                        <Radio size={12} />
                        {statusText}
                      </span>
                      <span className="scene-subline">
                        NORTHSTAR / PRODUCTION MIRROR
                      </span>
                      <span className="policy-chip">
                        <BrainCircuit size={10} />
                        DEFENSE POLICY V{run.policy.version}
                        {run.policy.version > 1 ? " · ADAPTED" : ""}
                      </span>
                    </div>
                    <SceneBoundary nodes={nodes} onSelect={setSelectedNodeId}>
                      <Scene
                        nodes={nodes}
                        tick={shownTick}
                        running={isRunning}
                        selectedNodeId={selectedNodeId}
                        onSelectNode={setSelectedNodeId}
                        view={view}
                        resetKey={resetKey}
                      />
                    </SceneBoundary>
                    <div className="scene-tools">
                      <button
                        aria-label="Reset camera"
                        title="Reset camera"
                        onClick={() => setResetKey((v) => v + 1)}
                      >
                        <Focus size={16} />
                      </button>
                      <button
                        aria-label="Fullscreen network"
                        title="Fullscreen network"
                        onClick={() => {
                          if (document.fullscreenElement)
                            void document.exitFullscreen();
                          else void sceneRef.current?.requestFullscreen?.();
                        }}
                      >
                        <Maximize2 size={15} />
                      </button>
                    </div>
                    <div className="scene-legend">
                      <span>
                        <i className="healthy" />
                        Healthy
                      </span>
                      <span>
                        <i className="exposed" />
                        At risk
                      </span>
                      <span>
                        <i className="compromised" />
                        Compromised
                      </span>
                      <span>
                        <i className="isolated" />
                        Isolated
                      </span>
                    </div>
                    <span className="scene-hint">
                      DRAG TO ORBIT · SCROLL TO ZOOM
                    </span>
                    {selectedNode && (
                      <div className="node-popover">
                        <div className="node-popover-top">
                          <Database size={18} />
                          <strong>{selectedNode.label}</strong>
                          <button
                            aria-label="Close asset details"
                            onClick={() => setSelectedNodeId(null)}
                          >
                            <X size={15} />
                          </button>
                        </div>
                        <div className="node-details">
                          <span>{selectedNode.zone}</span>
                          <span
                            className={`node-status ${selectedNode.status}`}
                          >
                            {selectedNode.status}
                          </span>
                        </div>
                        <div className="node-health">
                          <span>Asset health</span>
                          <b>{selectedNode.health}%</b>
                        </div>
                        <div className="progress">
                          <i style={{ width: `${selectedNode.health}%` }} />
                        </div>
                        <div className="node-actions">
                          <button
                            disabled={
                              isPreview ||
                              isFinished ||
                              busy ||
                              replayTick !== null
                            }
                            onClick={() => action("scan", selectedNode.id)}
                          >
                            <ScanLine size={13} />
                            Scan
                          </button>
                          <button
                            disabled={
                              isPreview ||
                              isFinished ||
                              busy ||
                              replayTick !== null
                            }
                            onClick={() =>
                              action(
                                selectedNode.status === "isolated"
                                  ? "restore"
                                  : "isolate",
                                selectedNode.id,
                              )
                            }
                          >
                            <Shield size={13} />
                            {selectedNode.status === "isolated"
                              ? "Restore"
                              : "Isolate"}
                          </button>
                        </div>
                        {isPreview && (
                          <small>Launch an exercise to take action.</small>
                        )}
                      </div>
                    )}
                    {isFinished && replayTick === null && !selectedNode && (
                      <div className={`result-overlay ${run.status}`}>
                        <div className="result-icon">
                          {run.status === "contained" ? (
                            <ShieldCheck size={24} />
                          ) : (
                            <ShieldX size={24} />
                          )}
                        </div>
                        <div>
                          <span className="eyebrow">EXERCISE COMPLETE</span>
                          <h3>
                            {run.status === "contained"
                              ? "Threat neutralized."
                              : "The perimeter fell."}
                          </h3>
                          <p>
                            {run.status === "contained"
                              ? "The network held. The agents learned."
                              : "A new lesson for the next defense."}
                          </p>
                        </div>
                        <button
                          onClick={() => {
                            setUseLearnedPolicy(true);
                            void launch(scenarioId, true);
                          }}
                          title="Rerun with learned policy"
                        >
                          <RotateCcw size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="simulation-controls">
                    <div className="playback">
                      <button
                        className="play-button"
                        disabled={busy}
                        onClick={() =>
                          isPreview || isFinished
                            ? launch()
                            : (() => {
                                if (replayTick !== null) {
                                  setReplayTick(null);
                                  setPaused(false);
                                } else setPaused(!paused);
                              })()
                        }
                      >
                        {busy ? (
                          <span className="tiny-spinner" />
                        ) : isRunning ? (
                          <Pause size={15} fill="currentColor" />
                        ) : (
                          <Play size={15} fill="currentColor" />
                        )}
                        {isPreview
                          ? "Launch attack"
                          : isFinished
                            ? "Run again"
                            : isRunning
                              ? "Pause"
                              : "Resume"}
                      </button>
                      <button
                        className="icon-button"
                        title="Reset exercise"
                        aria-label="Reset exercise"
                        disabled={busy || pending.current}
                        onClick={reset}
                      >
                        <RotateCcw size={15} />
                      </button>
                      <span className="control-divider" />
                      <button
                        className="speed-button"
                        onClick={() =>
                          setSpeed((s) => (s === 1 ? 2 : s === 2 ? 4 : 1))
                        }
                        title="Change simulation speed"
                      >
                        {speed}×
                      </button>
                      <span className="mono timer">{time(shownTick)}</span>
                    </div>
                    <div className="automation-control">
                      <span>Autonomous defense</span>
                      <button
                        role="switch"
                        aria-checked={run.autoDefend}
                        aria-label="Autonomous defense"
                        className={`switch ${run.autoDefend ? "on" : ""}`}
                        disabled={busy || isFinished}
                        onClick={() =>
                          isPreview
                            ? setRun({ ...run, autoDefend: !run.autoDefend })
                            : action("auto-defend", undefined, !run.autoDefend)
                        }
                      >
                        <i />
                      </button>
                    </div>
                  </div>
                </section>
                <section className="activity-panel">
                  <div className="panel-bar">
                    <div className="panel-title">
                      <AudioLines size={16} />
                      Agent comms<span className="count-tag">LIVE</span>
                    </div>
                    <button
                      className="icon-button"
                      onClick={toggleSound}
                      title={
                        sound ? "Mute event sounds" : "Enable event sounds"
                      }
                      aria-label={
                        sound ? "Mute event sounds" : "Enable event sounds"
                      }
                    >
                      {sound ? <Volume2 size={15} /> : <VolumeX size={15} />}
                    </button>
                  </div>
                  <div className="comms-intro">
                    <div className="comms-pulse">
                      <Radio size={17} />
                    </div>
                    <div>
                      <strong>
                        {selectedAgentData
                          ? `${selectedAgentData.name} channel`
                          : "A shared mind. A clear mission."}
                      </strong>
                      <p>
                        {selectedAgentData
                          ? "Showing this agent’s decisions"
                          : "Every observation becomes collective intelligence."}
                      </p>
                    </div>
                    {selectedAgent && (
                      <button
                        className="icon-button"
                        onClick={() => setSelectedAgent(null)}
                        aria-label="Show all agents"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  <div
                    className="event-feed"
                    aria-live="polite"
                    aria-relevant="additions"
                  >
                    {events.length ? (
                      events.map((event) => {
                        const agent = run.agents.find(
                          (a) => a.id === event.agentId,
                        );
                        const hostile =
                          event.agentId === "attacker" ||
                          event.kind === "attack";
                        return (
                          <article
                            key={event.id}
                            className={`event ${hostile ? "hostile" : ""}`}
                          >
                            <div
                              className="event-avatar"
                              style={{
                                color:
                                  agent?.color ||
                                  (hostile ? "#ed917a" : "#b1c9b7"),
                              }}
                            >
                              {hostile ? (
                                <Crosshair size={13} />
                              ) : event.agentId === "system" ? (
                                <Terminal size={13} />
                              ) : (
                                <Shield size={13} />
                              )}
                            </div>
                            <div className="event-content">
                              <div className="event-byline">
                                <strong style={{ color: agent?.color }}>
                                  {agent?.name ||
                                    (hostile ? "Adversary" : "System")}
                                </strong>
                                <span>{time(event.tick)}</span>
                              </div>
                              <p>{event.message}</p>
                              <div className="event-footer">
                                <span>
                                  {event.source === "openrouter"
                                    ? "AI · " + event.kind
                                    : event.kind.replaceAll("-", " ")}
                                </span>
                                {typeof event.confidence === "number" && (
                                  <span>
                                    <CheckCheck size={10} />
                                    {Math.round(
                                      event.confidence <= 1
                                        ? event.confidence * 100
                                        : event.confidence,
                                    )}
                                    % confidence
                                  </span>
                                )}
                              </div>
                            </div>
                          </article>
                        );
                      })
                    ) : (
                      <div className="comms-empty">
                        <Radio size={29} />
                        <h3>Listening to the network.</h3>
                        <p>
                          Launch an attack to watch the team investigate,
                          coordinate, and respond.
                        </p>
                        <div className="listening-bars">
                          {Array.from({ length: 20 }, (_, i) => (
                            <i
                              key={i}
                              style={{
                                height: `${7 + ((i * 7) % 17)}px`,
                                animationDelay: `${i * 0.09}s`,
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="comms-bottom">
                    <span className="dot lime" />
                    <span>
                      {run.ai.mode === "openrouter"
                        ? "Live AI coordination"
                        : run.ai.error
                          ? "AI unavailable · policy fallback"
                          : run.ai.enabled
                            ? "AI reasoning armed"
                            : "Deterministic agent coordination"}
                    </span>
                    <span className="mono">5 / 5</span>
                  </div>
                </section>
              </div>
              <section className="agents-section">
                <div className="section-heading">
                  <div>
                    <h2>Your defense team</h2>
                    <span>Different instincts. One objective.</span>
                  </div>
                  <button
                    className={`ai-toggle ${aiEnabled ? "enabled" : ""}`}
                    onClick={() => setAiEnabled(!aiEnabled)}
                    disabled={!isPreview && isRunning}
                    title="Applies to the next exercise"
                  >
                    <Sparkles size={13} />
                    {aiEnabled ? "AI reasoning enabled" : "Enable AI reasoning"}
                    <span className={`mini-dot ${aiEnabled ? "on" : ""}`} />
                  </button>
                </div>
                <div className="agent-grid">
                  {run.agents.map((agent, index) => {
                    const Icon = agentIcons[index % agentIcons.length];
                    return (
                      <button
                        key={agent.id}
                        onClick={() =>
                          setSelectedAgent(
                            selectedAgent === agent.id ? null : agent.id,
                          )
                        }
                        className={`agent-card ${selectedAgent === agent.id ? "selected" : ""}`}
                        style={
                          {
                            "--agent-color": agent.color,
                          } as React.CSSProperties
                        }
                      >
                        <div className="agent-card-top">
                          <div className="agent-icon">
                            <Icon size={20} strokeWidth={1.5} />
                          </div>
                          <span className="agent-state">
                            <i />
                            {isPreview ? "Standby" : agent.status}
                          </span>
                          <ChevronRight size={13} />
                        </div>
                        <div className="agent-name">
                          {agent.name}
                          <span>{String(index + 1).padStart(2, "0")}</span>
                        </div>
                        <p className="agent-role">{agent.role}</p>
                        <div className="agent-card-bottom">
                          <span>
                            {isPreview
                              ? [
                                  "Watching the perimeter",
                                  "Connecting the evidence",
                                  "Holding the line",
                                  "Following the signal",
                                  "Orchestrating the response",
                                ][index]
                              : agent.task}
                          </span>
                          <span className="agent-activity">▁▃▂▅▃</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
              <section className="timeline">
                <div className="timeline-label">
                  <Activity size={15} />
                  <strong>Incident timeline</strong>
                  <span>{run.events.length} events</span>
                </div>
                <div className="timeline-track">
                  <div className="timeline-line" />
                  {run.events
                    .filter((e) => e.tick > 0)
                    .slice(-45)
                    .map((event, index) => (
                      <button
                        key={event.id}
                        title={`${time(event.tick)} — ${event.message}`}
                        disabled={!snapshots?.length}
                        onClick={() => {
                          setPaused(true);
                          setReplayTick(event.tick);
                        }}
                        style={{
                          left: `${Math.max(1, Math.min(97, (event.tick / Math.max(run.tick, 30)) * 96))}%`,
                          height: `${12 + (index % 3) * 5}px`,
                        }}
                        className={
                          event.kind === "attack" ? "attack" : "defense"
                        }
                        aria-label={`Replay at ${time(event.tick)}`}
                      />
                    ))}
                  {isPreview && (
                    <span className="timeline-placeholder">
                      Your story starts with an attack.
                    </span>
                  )}
                </div>
                <button
                  className="subtle-button"
                  disabled={isPreview}
                  onClick={() => {
                    if (replayTick !== null) {
                      setReplayTick(null);
                    } else exportRun();
                  }}
                >
                  {replayTick !== null ? "Back to live" : "Export log"}
                  {replayTick !== null ? (
                    <Radio size={12} />
                  ) : (
                    <ArrowDownToLine size={12} />
                  )}
                </button>
              </section>
            </>
          ) : panel === "history" ? (
            <section className="archive-panel">
              <div className="section-heading">
                <h2>Recorded exercises</h2>
                <button
                  className="subtle-button"
                  onClick={() => changePanel("history")}
                >
                  <RotateCcw size={14} />
                  Refresh
                </button>
              </div>
              {historyLoading ? (
                <div className="empty-panel">Loading incident records…</div>
              ) : history.length ? (
                <div className="run-list">
                  {history.map((item) => (
                    <button
                      key={item.id}
                      className="run-row"
                      onClick={() => openRun(item.id)}
                    >
                      <div className={`run-status-icon ${item.status}`}>
                        <Shield size={22} />
                      </div>
                      <div>
                        <strong>
                          {scenarioMeta[item.scenarioId]?.title ||
                            item.scenarioId}
                        </strong>
                        <span>
                          {shortTime(item.createdAt)} · {item.id.slice(0, 8)}
                        </span>
                      </div>
                      <span className={`status-badge ${item.status}`}>
                        {item.status}
                      </span>
                      <div className="run-stat">
                        <b>{item.metrics.integrity}%</b>
                        <span>integrity</span>
                      </div>
                      <div className="run-stat">
                        <b>{time(item.tick)}</b>
                        <span>elapsed</span>
                      </div>
                      <ChevronRight size={18} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty-panel">
                  <Layers3 size={36} />
                  <h3>A clean slate.</h3>
                  <p>
                    Complete an exercise to start building your incident
                    archive.
                  </p>
                  <button
                    className="play-button"
                    onClick={() => setPanel("room")}
                  >
                    Enter the war room
                    <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </section>
          ) : (
            <MemoryPanel
              memory={memory}
              loading={historyLoading}
              atlas={!!atlasConnected}
              onLaunch={() => {
                setPanel("room");
                setUseLearnedPolicy(true);
                void launch(scenarioId, true);
              }}
            />
          )}
          <footer className="statusbar">
            <div className="footer-brand">
              <Shield size={13} />
              <span>AEGIS</span>
              <span className="footer-muted">Built to hold the line.</span>
            </div>
            <div>
              <span className={`dot ${atlasConnected ? "lime" : "amber"}`} />
              <span>
                {atlasConnected
                  ? "Atlas connected"
                  : health
                    ? "Atlas not connected"
                    : "Checking Atlas…"}
              </span>
              <span className="footer-separator">/</span>
              <span>
                {storage?.persisted
                  ? "Incident saved"
                  : storage?.mode === "memory"
                    ? "Session memory only"
                    : "Simulation environment"}
              </span>
              <span className="footer-separator">/</span>
              <span className="mono">100% SYNTHETIC</span>
            </div>
          </footer>
        </main>
      </div>
      <dialog
        ref={modalRef}
        className="modal scenario-modal"
        onCancel={() => setScenarioOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setScenarioOpen(false);
        }}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">CHOOSE YOUR ADVERSARY</span>
            <h2>Pressure makes better defenses.</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close scenarios"
            onClick={() => setScenarioOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <p className="modal-description">
          Each exercise is a contained, synthetic attack. Same seed. Different
          decisions. A measurable outcome.
        </p>
        <div className="scenario-options">
          {Object.entries(scenarioMeta).map(([id, item]) => {
            const Icon = item.icon;
            return (
              <button
                key={id}
                className={`scenario-option ${scenarioId === id ? "selected" : ""}`}
                onClick={() => setScenarioId(id as ScenarioId)}
              >
                <div className="scenario-option-icon">
                  <Icon size={22} />
                </div>
                <div>
                  <span className="eyebrow">{item.tag}</span>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                  <span className="scenario-duration">
                    <Timer size={11} />
                    {item.duration}
                  </span>
                </div>
                <span className="radio-choice">
                  {scenarioId === id && <Check size={12} />}
                </span>
              </button>
            );
          })}
        </div>
        <div className="memory-setting">
          <div>
            <BrainCircuit size={16} />
            <span>
              Use learned defense policy
              <small>Turn off to compare against the original baseline.</small>
            </span>
          </div>
          <button
            role="switch"
            aria-label="Use learned defense policy"
            aria-checked={useLearnedPolicy}
            className={`switch ${useLearnedPolicy ? "on" : ""}`}
            onClick={() => setUseLearnedPolicy(!useLearnedPolicy)}
          >
            <i />
          </button>
        </div>
        <div className="modal-footer">
          <span>
            <ShieldCheck size={14} />
            No real systems are targeted.
          </span>
          <button
            className="play-button"
            disabled={busy}
            onClick={() => launch(scenarioId)}
          >
            <Play size={14} fill="currentColor" />
            Launch exercise
          </button>
        </div>
      </dialog>
      <dialog
        ref={helpRef}
        className="modal help-modal"
        onCancel={() => setHelpOpen(false)}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">THE MISSION</span>
            <h2>Train the defense. Trust the evidence.</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close briefing"
            onClick={() => setHelpOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <p className="modal-description">
          AEGIS is an agent cyber range: a safe place to study how an autonomous
          defense team behaves under pressure.
        </p>
        <div className="briefing-steps">
          <div>
            <span>01</span>
            <h3>Introduce an adversary</h3>
            <p>
              Choose ransomware, a supply chain breach, or silent exfiltration.
              Launch the same seeded scenario to compare strategies.
            </p>
          </div>
          <div>
            <span>02</span>
            <h3>Watch decisions become action</h3>
            <p>
              Five specialists scan, correlate, trace, isolate, and coordinate.
              Select any asset to intervene. Toggle autonomous defense to see
              the cost of waiting.
            </p>
          </div>
          <div>
            <span>03</span>
            <h3>Give the next team an advantage</h3>
            <p>
              Completed incidents inform a revised defense policy. Atlas stores
              the evidence, decisions, and memory for the next exercise.
            </p>
          </div>
        </div>
        <div className="briefing-note">
          <Sparkles size={18} />
          <p>
            Enable AI reasoning for live OpenRouter analysis. The simulation
            labels model advice and uses deterministic defense policies if the
            model is unavailable.
          </p>
        </div>
        <button className="play-button" onClick={() => setHelpOpen(false)}>
          Enter the war room
          <ArrowRight size={14} />
        </button>
      </dialog>
    </div>
  );
}

function ArrowUpRightIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path d="M4 12 12 4M4 4h8v8" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
function Metric({
  label,
  value,
  detail,
  icon,
  color,
  spark,
  avatars,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  color: string;
  spark?: number[];
  avatars?: boolean;
}) {
  return (
    <div className={`metric ${color}`}>
      <div className="metric-label">
        {label}
        {icon}
      </div>
      <div className="metric-main">
        <span>{value}</span>
        {spark ? (
          <svg viewBox="0 0 110 35" className="sparkline" aria-hidden="true">
            <path
              d={`M ${spark.map((v, i) => `${i * 10} ${32 - v * 1.7}`).join(" L ")}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d={`M 0 35 L ${spark.map((v, i) => `${i * 10} ${32 - v * 1.7}`).join(" L ")} L 110 35 Z`}
              fill="currentColor"
              opacity=".04"
            />
          </svg>
        ) : avatars ? (
          <div className="metric-agents">
            {[ScanLine, Fingerprint, Shield, GitBranch, BrainCircuit].map(
              (Icon, i) => (
                <span key={i}>
                  <Icon size={12} />
                </span>
              ),
            )}
          </div>
        ) : null}
      </div>
      <div className="metric-detail">
        <span className="metric-tiny-dot" />
        {detail}
      </div>
    </div>
  );
}
function MemoryPanel({
  memory,
  loading,
  atlas,
  onLaunch,
}: {
  memory: unknown;
  loading: boolean;
  atlas: boolean;
  onLaunch: () => void;
}) {
  const data = memory as { policies?: DefensePolicy[] } | null;
  const policies = (data?.policies || []).filter(
    (policy) => policy.learnedFrom.length > 0,
  );
  return (
    <section className="memory-panel">
      <div className="memory-hero">
        <div className="memory-symbol">
          <BrainCircuit size={47} strokeWidth={1} />
        </div>
        <span className="eyebrow">PERSISTENT AGENT MEMORY</span>
        <h2>Every incident leaves an advantage.</h2>
        <p>
          AEGIS closes the loop between outcome and strategy. Evidence from
          completed exercises becomes a versioned defense policy for the next
          run.
        </p>
        <div className="memory-flow">
          <span>
            <Activity size={16} />
            Observe
          </span>
          <ChevronRight size={14} />
          <span>
            <BrainCircuit size={16} />
            Learn
          </span>
          <ChevronRight size={14} />
          <span>
            <ShieldCheck size={16} />
            Adapt
          </span>
        </div>
      </div>
      {loading ? (
        <p className="empty-panel">Reading defense memory…</p>
      ) : policies.length ? (
        <div className="policy-list">
          {policies.map((policy, i) => (
            <article key={i} className="policy-card">
              <div>
                <span className="eyebrow">
                  POLICY V{String(policy.version || 1)}
                </span>
                <h3>
                  {scenarioMeta[String(policy.scenarioId)]?.title ||
                    String(policy.scenarioId || "Defense policy")}
                </h3>
              </div>
              <p>
                {String(
                  policy.lesson ||
                    "Response policy updated from observed incident outcomes.",
                )}
              </p>
              <div className="policy-details">
                {Object.entries(policy)
                  .filter(
                    ([k, v]) =>
                      [
                        "isolationDelay",
                        "scanCadence",
                        "runsCompleted",
                        "isolateAfter",
                        "responseDelay",
                        "trainingRuns",
                      ].includes(k) && typeof v !== "object",
                  )
                  .map(([k, v]) => (
                    <span key={k}>
                      {k.replace(/([A-Z])/g, " $1")}
                      <b>{String(v)}</b>
                    </span>
                  ))}
              </div>
              {policy.evidence?.evaluation && (
                <div className="policy-evaluation">
                  <span className="eyebrow">
                    SAME-SEED COUNTERFACTUAL · {policy.evidence.evaluation.seed}
                  </span>
                  <div>
                    <span>Original policy</span>
                    <div className="eval-bar baseline">
                      <i
                        style={{
                          width: `${policy.evidence.evaluation.baselineIntegrity}%`,
                        }}
                      />
                    </div>
                    <b>{policy.evidence.evaluation.baselineIntegrity}%</b>
                  </div>
                  <div>
                    <span>Adapted policy</span>
                    <div className="eval-bar">
                      <i
                        style={{
                          width: `${policy.evidence.evaluation.candidateIntegrity}%`,
                        }}
                      />
                    </div>
                    <b>{policy.evidence.evaluation.candidateIntegrity}%</b>
                  </div>
                  <p>
                    <CheckCheck size={12} />
                    Integrity retained ·{" "}
                    {policy.evidence.evaluation.accepted
                      ? "Improvement verified"
                      : "Original policy retained"}
                  </p>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="memory-empty">
          <Database size={21} />
          <div>
            <h3>No learned policies yet.</h3>
            <p>
              {atlas
                ? "Complete an exercise to store the first lesson in Atlas."
                : "Connect Atlas for durable memory. You can still explore the simulation in this session."}
            </p>
          </div>
        </div>
      )}
      <button className="play-button" onClick={onLaunch}>
        <Play size={14} fill="currentColor" />
        Run a training exercise
      </button>
    </section>
  );
}
