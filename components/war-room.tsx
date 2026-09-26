"use client";

import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Box,
  BrainCircuit,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Crosshair,
  Database,
  Eye,
  Fingerprint,
  Focus,
  GitBranch,
  Layers3,
  LockKeyhole,
  Maximize2,
  MousePointer2,
  Move3D,
  Network,
  Pause,
  Play,
  Radio,
  RotateCcw,
  ScanLine,
  Shield,
  ShieldCheck,
  ShieldX,
  SkipForward,
  Sparkles,
  Swords,
  TriangleAlert,
  Users,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useWarRoom } from "@/hooks/use-war-room";
import { FLOOR_DEFS, getPlacement } from "@/lib/building-layout";
import { SCENARIOS } from "@/lib/scenarios";
import type {
  DefensePolicy,
  NetworkNode,
  ScenarioId,
  SimulationEvent,
} from "@/lib/types";

const World = dynamic(() => import("./war-room-scene"), {
  ssr: false,
  loading: () => (
    <div className="world-loading">
      <Box size={30} strokeWidth={1} />
      <span>Preparing the operations center</span>
      <i />
    </div>
  ),
});
type SideTab = "simulation" | "inspect" | "agents";
type PageMode = "room" | "history" | "memory";
type Layer = "all" | "network" | "agents" | "threats";
const AGENT_ICONS = [ScanLine, Fingerprint, Shield, GitBranch, BrainCircuit];
const SCENARIO_NAMES: Record<ScenarioId, string> = {
  ransomware: "Ransomware outbreak",
  "supply-chain": "Supply chain intrusion",
  exfiltration: "Silent exfiltration",
};
const LAYERS: { id: Layer; label: string; icon: typeof Network }[] = [
  { id: "all", label: "All systems", icon: Layers3 },
  { id: "network", label: "Network", icon: Network },
  { id: "agents", label: "Defense team", icon: Users },
  { id: "threats", label: "Threat paths", icon: Crosshair },
];
function clock(tick: number) {
  return `${String(Math.floor((tick * 2) / 60)).padStart(2, "0")}:${String((tick * 2) % 60).padStart(2, "0")}`;
}
function readable(text: string) {
  return text
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace("Api", "API");
}

class WorldBoundary extends Component<
  { children: ReactNode; nodes: NetworkNode[]; onSelect: (id: string) => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="world-fallback">
        <Box size={30} />
        <h2>Operations center</h2>
        <p>
          The 3D renderer is unavailable. Select an asset to continue the
          exercise.
        </p>
        <div>
          {this.props.nodes.map((node) => (
            <button key={node.id} onClick={() => this.props.onSelect(node.id)}>
              <Database size={17} />
              {readable(node.label)}
              <span className={`status-dot ${node.status}`} />
            </button>
          ))}
        </div>
      </div>
    ) : (
      this.props.children
    );
  }
}

export default function WarRoom() {
  const sim = useWarRoom();
  const [pageMode, setPageMode] = useState<PageMode>("room");
  const [sideTab, setSideTab] = useState<SideTab>("simulation");
  const [exploded, setExploded] = useState(true);
  const [cutaway, setCutaway] = useState(true);
  const [cameraMode, setCameraMode] = useState<"orbit" | "top">("orbit");
  const [activeFloor, setActiveFloor] = useState<number | null>(null);
  const [layer, setLayer] = useState<Layer>("all");
  const [resetKey, setResetKey] = useState(0);
  const [briefing, setBriefing] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const worldRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (briefing) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [briefing]);
  useEffect(() => {
    const sync = () => setFullScreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const selectedNode = sim.nodes.find((node) => node.id === sim.selectedNodeId);
  const selectedAgent = sim.run.agents.find(
    (agent) => agent.id === sim.selectedAgentId,
  );
  const scenario = SCENARIOS.find((item) => item.id === sim.scenarioId)!;
  const status =
    sim.replayTick !== null
      ? "Replay"
      : sim.isPreview
        ? "Ready"
        : sim.isFinished
          ? sim.run.status === "contained"
            ? "Contained"
            : "Breached"
          : sim.isRunning
            ? "Running"
            : "Paused";
  const threats = sim.nodes.filter(
    (node) => node.status === "compromised" || node.status === "exposed",
  ).length;
  const policies = (sim.memory?.policies || []).filter(
    (policy: DefensePolicy) => policy.learnedFrom.length > 0,
  );
  const previewFloor = activeFloor ?? 0;
  const floorNodes = sim.nodes.filter(
    (node) => getPlacement(node.id).floor === previewFloor,
  );
  const events = sim.filteredEvents;
  const latestEvent = events[0];

  function pickNode(id: string) {
    sim.setSelectedNodeId(id);
    sim.setSelectedAgentId(null);
    setSideTab("inspect");
    setPageMode("room");
  }
  function pickAgent(id: string) {
    sim.setSelectedAgentId(sim.selectedAgentId === id ? null : id);
    sim.setSelectedNodeId(null);
    setSideTab("agents");
    setPageMode("room");
  }
  function resetView() {
    setResetKey((value) => value + 1);
    setCameraMode("orbit");
    setActiveFloor(null);
    setExploded(true);
    setCutaway(true);
  }
  function navigate(mode: PageMode) {
    setPageMode(mode);
    if (mode === "history") void sim.loadHistory();
    if (mode === "memory") void sim.loadMemory();
  }
  function play() {
    if (sim.isPreview || sim.isFinished) {
      setPageMode("room");
      void sim.launch();
    } else sim.pauseResume();
  }
  async function fullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await worldRef.current?.requestFullscreen?.();
  }
  function showFloor(floor: number | null) {
    setActiveFloor(floor);
    if (floor !== null) setCutaway(true);
  }

  return (
    <div className="aegis-app">
      <header className="app-header">
        <a className="brand" href="/" aria-label="AEGIS home">
          <span className="brand-emblem">
            <Shield size={27} strokeWidth={1.4} />
            <span>A</span>
          </span>
          <strong>AEGIS</strong>
        </a>
        <nav className="main-nav" aria-label="Workspace">
          <button
            className={pageMode === "room" ? "active" : ""}
            onClick={() => navigate("room")}
          >
            War room
          </button>
          <button
            className={pageMode === "history" ? "active" : ""}
            onClick={() => navigate("history")}
          >
            Incidents
          </button>
          <button
            className={pageMode === "memory" ? "active" : ""}
            onClick={() => navigate("memory")}
          >
            Agent memory
          </button>
        </nav>
        <div className="header-right">
          <span className="workspace-state">
            <i />
            Synthetic training range
          </span>
          <button
            className="help-button"
            aria-label="Mission briefing"
            title="Mission briefing"
            onClick={() => setBriefing(true)}
          >
            <CircleHelp size={20} />
          </button>
          <div className="operator">
            <span>AD</span>
            <div>
              <strong>Defense team</strong>
              <small>Northstar workspace</small>
            </div>
          </div>
        </div>
      </header>
      <div className="workspace">
        <section
          className={`world ${fullScreen ? "full-screen" : ""}`}
          ref={worldRef}
          aria-label="Interactive operations center"
        >
          <div className="world-canvas">
            <WorldBoundary nodes={sim.nodes} onSelect={pickNode}>
              <World
                nodes={sim.nodes}
                agents={sim.replayTick === null ? sim.run.agents : []}
                tick={sim.shownTick}
                running={sim.isRunning}
                selectedNodeId={sim.selectedNodeId}
                onSelectNode={pickNode}
                selectedAgentId={sim.selectedAgentId}
                onSelectAgent={pickAgent}
                exploded={exploded}
                cutaway={cutaway}
                activeFloor={activeFloor}
                layer={layer}
                cameraMode={cameraMode}
                resetKey={resetKey}
              />
            </WorldBoundary>
          </div>
          <div className="world-intro">
            <div className="eyebrow">
              <span>NORTHSTAR HQ · DEFENSE SIMULATION</span>
              <i />
              <span>
                {cameraMode === "top" ? "FLOOR PLAN" : "BUILDING VIEW"}
              </span>
            </div>
            <h1>Keep the network standing.</h1>
            <p>Watch your agents work. See every decision take shape.</p>
            <div className="view-actions">
              <button
                className={exploded ? "on" : ""}
                aria-pressed={exploded}
                onClick={() => setExploded(!exploded)}
              >
                <Layers3 size={15} />
                Exploded floors
              </button>
              <button
                className={cutaway ? "on" : ""}
                aria-pressed={cutaway}
                onClick={() => setCutaway(!cutaway)}
              >
                <Eye size={15} />
                Cutaway
              </button>
              <button onClick={resetView}>
                <RotateCcw size={14} />
                Reset view
              </button>
            </div>
          </div>
          <div className="camera-tools">
            <div className="camera-toggle">
              <button
                aria-label="Orbit camera"
                title="Orbit camera"
                className={cameraMode === "orbit" ? "active" : ""}
                onClick={() => setCameraMode("orbit")}
              >
                <Move3D size={18} />
              </button>
              <button
                aria-label="Top-down camera"
                title="Top-down camera"
                className={cameraMode === "top" ? "active" : ""}
                onClick={() => setCameraMode("top")}
              >
                <ScanLine size={18} />
              </button>
            </div>
            <button
              className="fullscreen-button"
              aria-label={fullScreen ? "Exit fullscreen" : "Fullscreen scene"}
              title="Fullscreen scene"
              onClick={() => void fullscreen()}
            >
              <Maximize2 size={18} />
            </button>
          </div>
          <div className="world-status">
            <span
              className={`status-dot ${sim.isRunning ? "live" : sim.run.status === "breached" ? "compromised" : "healthy"}`}
            />
            <span>
              {sim.isPreview
                ? "All systems operational"
                : sim.replayTick !== null
                  ? `Replaying ${clock(sim.shownTick)}`
                  : sim.isFinished
                    ? `Exercise ${status.toLowerCase()}`
                    : `${threats} active threat${threats === 1 ? "" : "s"} · ${sim.isRunning ? "Agents responding" : "Simulation paused"}`}
            </span>
            <b>{clock(sim.shownTick)}</b>
          </div>
          {sim.replayTick !== null && (
            <button className="return-live" onClick={sim.exitReplay}>
              <Radio size={13} />
              Return to present
            </button>
          )}
          <div className="floor-plan">
            <div className="minimap-title">
              <span>
                {activeFloor === null
                  ? "CAMPUS PLAN"
                  : FLOOR_DEFS.find((f) => f.id === activeFloor)?.label}
              </span>
              <span>N ↑</span>
            </div>
            <div className="minimap-grid">
              {floorNodes.map((node) => (
                <button
                  key={node.id}
                  className={`map-room ${node.status} ${node.id === sim.selectedNodeId ? "selected" : ""}`}
                  aria-label={`Inspect ${readable(node.label)}`}
                  title={readable(node.label)}
                  onClick={() => pickNode(node.id)}
                >
                  <span />
                  <span />
                  <span />
                  <i className={`status-dot ${node.status}`} />
                </button>
              ))}
            </div>
            <div className="floor-picker" aria-label="Choose building floor">
              <button
                className={activeFloor === null ? "active" : ""}
                onClick={() => showFloor(null)}
              >
                All
              </button>
              {FLOOR_DEFS.map((floor) => (
                <button
                  key={floor.id}
                  className={activeFloor === floor.id ? "active" : ""}
                  onClick={() => showFloor(floor.id)}
                  title={floor.label}
                >
                  {floor.short}
                </button>
              ))}
            </div>
            <span className="minimap-caption">
              <i />
              {activeFloor === null
                ? "Three connected levels"
                : "Viewing selected level"}
            </span>
          </div>
          <div className="systems-overlay">
            <div className="systems-caption">
              <span>REVEAL DEFENSE SYSTEMS</span>
              <i />
              <button
                onClick={() => {
                  setLayer("all");
                  sim.setSelectedNodeId(null);
                  sim.setSelectedAgentId(null);
                }}
              >
                Clear selection
              </button>
            </div>
            <div className="systems-dock">
              {LAYERS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    className={layer === item.id ? "active" : ""}
                    aria-pressed={layer === item.id}
                    onClick={() => {
                      setLayer(item.id);
                      if (item.id === "agents") {
                        setPageMode("room");
                        setSideTab("agents");
                      }
                    }}
                  >
                    <Icon size={23} strokeWidth={1.4} />
                    <span>{item.label}</span>
                    {item.id === "threats" && threats > 0 && <b>{threats}</b>}
                  </button>
                );
              })}
              <span className="dock-divider" />
              <button
                className={pageMode === "memory" ? "active" : ""}
                onClick={() => navigate("memory")}
              >
                <BrainCircuit size={23} strokeWidth={1.4} />
                <span>Learned defense</span>
                <small>v{sim.run.policy.version}</small>
              </button>
            </div>
          </div>
          <div className="world-help">
            <MousePointer2 size={12} />
            <span>Drag to orbit</span>
            <i />
            Scroll to zoom
            <i />
            <span>Click a room or agent to inspect</span>
          </div>
          <span className="world-coordinate">NORTHSTAR / 40.7° N</span>
        </section>

        <aside className="operations-panel" aria-label="Defense controls">
          <div className="panel-identity">
            <span>
              <i />
              DEFENSE OPERATIONS
            </span>
            <ShieldCheck size={15} />
          </div>
          {sim.error && (
            <div className="error-notice" role="alert">
              <TriangleAlert size={16} />
              <p>{sim.error}</p>
              <button
                aria-label="Dismiss error"
                onClick={() => sim.setError(null)}
              >
                <X size={14} />
              </button>
            </div>
          )}
          {pageMode === "room" ? (
            <>
              <div
                className="side-tabs"
                role="tablist"
                aria-label="Defense panel"
              >
                <button
                  role="tab"
                  aria-selected={sideTab === "simulation"}
                  className={sideTab === "simulation" ? "active" : ""}
                  onClick={() => setSideTab("simulation")}
                >
                  <Clock3 size={16} />
                  Simulation
                </button>
                <button
                  role="tab"
                  aria-selected={sideTab === "inspect"}
                  className={sideTab === "inspect" ? "active" : ""}
                  onClick={() => setSideTab("inspect")}
                >
                  <Focus size={16} />
                  Inspect
                </button>
                <button
                  role="tab"
                  aria-selected={sideTab === "agents"}
                  className={sideTab === "agents" ? "active" : ""}
                  onClick={() => setSideTab("agents")}
                >
                  <Users size={16} />
                  Agents<span>5</span>
                </button>
              </div>
              <div className="panel-content" role="tabpanel">
                {sideTab === "simulation" ? (
                  <>
                    <section className="clock-section">
                      <div className="section-overline">
                        <span>AN EXERCISE IN RESILIENCE</span>
                        <span className={`state-badge ${status.toLowerCase()}`}>
                          {status}
                        </span>
                      </div>
                      <div className="incident-clock">
                        <strong>{clock(sim.shownTick)}</strong>
                        <div>
                          <span>Incident clock</span>
                          <small>
                            {sim.isPreview
                              ? "Ready to begin"
                              : `${sim.speed}× simulated time`}
                          </small>
                        </div>
                      </div>
                      <div className="time-scrubber">
                        <input
                          type="range"
                          min={0}
                          max={Math.max(sim.run.tick, 1)}
                          value={sim.shownTick}
                          disabled={sim.isPreview}
                          aria-label="Replay incident timeline"
                          onChange={(event) =>
                            sim.replayAt(Number(event.target.value))
                          }
                        />
                        <div>
                          <span>00:00</span>
                          <span>
                            {sim.run.tick
                              ? clock(Math.floor(sim.run.tick / 2))
                              : "00:30"}
                          </span>
                          <span>
                            {sim.run.tick ? clock(sim.run.tick) : "01:00"}
                          </span>
                        </div>
                      </div>
                      <div className="playback-controls">
                        <button
                          className="transport-play"
                          onClick={play}
                          disabled={sim.busy}
                          aria-label={
                            sim.isPreview
                              ? "Launch attack"
                              : sim.isFinished
                                ? "Run again"
                                : sim.isRunning
                                  ? "Pause simulation"
                                  : "Resume simulation"
                          }
                          title={
                            sim.isPreview
                              ? "Launch attack"
                              : sim.isRunning
                                ? "Pause"
                                : "Play"
                          }
                        >
                          {sim.busy ? (
                            <span className="spinner" />
                          ) : sim.isRunning ? (
                            <Pause size={19} fill="currentColor" />
                          ) : (
                            <Play size={19} fill="currentColor" />
                          )}
                        </button>
                        <label className="speed-select">
                          <select
                            aria-label="Playback speed"
                            value={sim.speed}
                            onChange={(event) =>
                              sim.setSpeed(Number(event.target.value))
                            }
                          >
                            <option value={1}>1×</option>
                            <option value={2}>2×</option>
                            <option value={4}>4×</option>
                          </select>
                          <ChevronDown size={13} />
                        </label>
                        <button
                          className="step-button"
                          disabled={
                            sim.isPreview ||
                            sim.isFinished ||
                            sim.busy ||
                            sim.replayTick !== null
                          }
                          onClick={() => void sim.stepOnce()}
                        >
                          <SkipForward size={16} />
                          +2 sec
                        </button>
                        <button
                          className="reset-exercise"
                          aria-label="Reset exercise"
                          title="Reset exercise"
                          disabled={sim.busy}
                          onClick={sim.reset}
                        >
                          <RotateCcw size={17} />
                        </button>
                      </div>
                    </section>
                    <section className="scenario-section">
                      <div className="section-overline">
                        <span>CHOOSE A DISRUPTION</span>
                        <Swords size={13} />
                      </div>
                      <h2>Give your agents a challenge.</h2>
                      <p>
                        One intrusion. A team of specialists. Watch them find
                        the threat and hold the line.
                      </p>
                      <label className="scenario-select">
                        <span className="scenario-icon">
                          {sim.scenarioId === "ransomware" ? (
                            <LockKeyhole size={19} />
                          ) : sim.scenarioId === "supply-chain" ? (
                            <GitBranch size={19} />
                          ) : (
                            <Database size={19} />
                          )}
                        </span>
                        <span>
                          <select
                            aria-label="Attack scenario"
                            value={sim.scenarioId}
                            disabled={
                              sim.busy || (!sim.isPreview && !sim.isFinished)
                            }
                            onChange={(event) =>
                              sim.setScenarioId(
                                event.target.value as ScenarioId,
                              )
                            }
                          >
                            {SCENARIOS.map((item) => (
                              <option key={item.id} value={item.id}>
                                {SCENARIO_NAMES[item.id]}
                              </option>
                            ))}
                          </select>
                          <small>
                            {scenario.name} ·{" "}
                            {scenario.difficulty.toLowerCase()} intensity
                          </small>
                        </span>
                        <ChevronDown size={15} />
                      </label>
                      {sim.isPreview && (
                        <button
                          className="launch-button"
                          onClick={() => void sim.launch()}
                          disabled={sim.busy}
                        >
                          <Play size={14} fill="currentColor" />
                          Launch attack
                          <ArrowRight size={15} />
                        </button>
                      )}
                    </section>
                    <section className="autonomy-section">
                      <div className="section-overline">
                        <span>AGENTS → ACTION</span>
                        <span className="subtle-pill">
                          Policy v{sim.run.policy.version}
                        </span>
                      </div>
                      <h2>See the defense respond.</h2>
                      <p>
                        Let the team act on its findings, or take command and
                        approve your own response.
                      </p>
                      <div className="mode-buttons" aria-label="Defense mode">
                        <button
                          className={!sim.run.autoDefend ? "active" : ""}
                          aria-pressed={!sim.run.autoDefend}
                          disabled={
                            sim.isFinished ||
                            sim.busy ||
                            sim.replayTick !== null
                          }
                          onClick={() =>
                            void sim.action("auto-defend", undefined, false)
                          }
                        >
                          Manual
                        </button>
                        <button
                          className={sim.run.autoDefend ? "active" : ""}
                          aria-pressed={sim.run.autoDefend}
                          disabled={
                            sim.isFinished ||
                            sim.busy ||
                            sim.replayTick !== null
                          }
                          onClick={() =>
                            void sim.action("auto-defend", undefined, true)
                          }
                        >
                          Autonomous
                          <ShieldCheck size={14} />
                        </button>
                      </div>
                      <div className="preference-row">
                        <div>
                          <Sparkles size={14} />
                          <span>Live AI reasoning</span>
                        </div>
                        <button
                          className={`toggle ${sim.aiEnabled ? "on" : ""}`}
                          role="switch"
                          aria-checked={sim.aiEnabled}
                          aria-label="Live AI reasoning"
                          disabled={sim.isRunning}
                          onClick={() => sim.setAiEnabled(!sim.aiEnabled)}
                        >
                          <i />
                        </button>
                      </div>
                      <div className="preference-row">
                        <div>
                          <BrainCircuit size={14} />
                          <span>Use learned policy</span>
                        </div>
                        <button
                          className={`toggle ${sim.useLearnedPolicy ? "on" : ""}`}
                          role="switch"
                          aria-checked={sim.useLearnedPolicy}
                          aria-label="Use learned policy"
                          disabled={sim.isRunning}
                          onClick={() =>
                            sim.setUseLearnedPolicy(!sim.useLearnedPolicy)
                          }
                        >
                          <i />
                        </button>
                      </div>
                      <small className="preference-note">
                        Reasoning and memory settings apply to the next
                        exercise.
                      </small>
                    </section>
                    <section
                      className={`integrity-card ${sim.run.status === "breached" ? "breached" : ""}`}
                    >
                      <div className="integrity-heading">
                        <span>
                          {sim.isFinished
                            ? "Integrity retained in this exercise"
                            : "Protected in this simulation"}
                        </span>
                        <ShieldCheck size={16} />
                      </div>
                      <strong>
                        {Math.round(sim.metrics.integrity)}
                        <span>%</span>
                      </strong>
                      <div className="integrity-stats">
                        <span>
                          <b>{sim.metrics.threatsBlocked}</b> threat paths
                          blocked
                        </span>
                        <span>
                          <b>{Math.round(sim.metrics.uptime)}%</b> availability
                        </span>
                      </div>
                      <IntegrityChart history={sim.run.history} />
                      <p>
                        {sim.isPreview
                          ? "12 synthetic assets. No real systems at risk."
                          : sim.isFinished
                            ? "Evidence captured. The next defense starts here."
                            : `${sim.nodes.filter((node) => node.status === "healthy").length} assets healthy · ${threats} active threats`}
                      </p>
                      {sim.isFinished && (
                        <button onClick={() => navigate("memory")}>
                          Review what the team learned
                          <ArrowUpRight size={14} />
                        </button>
                      )}
                    </section>
                    {latestEvent && (
                      <section className="field-note">
                        <div className="section-overline">
                          <span>FROM THE FLOOR</span>
                          <AudioLines size={15} />
                        </div>
                        <div>
                          <span
                            className={`status-dot ${latestEvent.kind === "attack" ? "compromised" : "healthy"}`}
                          />
                          <strong>{readable(latestEvent.agentId)}</strong>
                          <time>{clock(latestEvent.tick)}</time>
                        </div>
                        <p>{latestEvent.message}</p>
                        <button onClick={() => setSideTab("agents")}>
                          Open agent communications
                          <ArrowRight size={12} />
                        </button>
                      </section>
                    )}
                  </>
                ) : sideTab === "inspect" ? (
                  <>
                    <div className="inspect-heading">
                      <div className="section-overline">
                        <span>ASSET INSPECTOR</span>
                        <span>
                          {selectedNode
                            ? `LEVEL ${getPlacement(selectedNode.id).floor + 1}`
                            : "12 ASSETS"}
                        </span>
                      </div>
                      <h2>
                        {selectedNode
                          ? readable(selectedNode.label)
                          : "A closer look."}
                      </h2>
                      <p>
                        {selectedNode
                          ? "A room in the building. A node in the network."
                          : "Select a room in the building to see its health, connections, and available responses."}
                      </p>
                    </div>
                    {selectedNode ? (
                      <>
                        <div
                          className={`asset-status-card ${selectedNode.status}`}
                        >
                          <div>
                            <span
                              className={`status-dot ${selectedNode.status}`}
                            />
                            <strong>{readable(selectedNode.status)}</strong>
                            <span>{selectedNode.health}% health</span>
                          </div>
                          <div className="health-track">
                            <i style={{ width: `${selectedNode.health}%` }} />
                          </div>
                          <p>
                            {selectedNode.status === "compromised"
                              ? "Suspicious activity is damaging this asset. Isolate it to cut its network paths."
                              : selectedNode.status === "isolated"
                                ? "Network paths are severed. This room is contained and unavailable to peers."
                                : selectedNode.status === "exposed"
                                  ? "This asset is adjacent to a compromise. Inspect its telemetry before the threat spreads."
                                  : "No active compromise detected on this asset."}
                          </p>
                        </div>
                        <div className="asset-facts">
                          <div>
                            <span>System type</span>
                            <strong>{readable(selectedNode.type)}</strong>
                          </div>
                          <div>
                            <span>Network zone</span>
                            <strong>{readable(selectedNode.zone)}</strong>
                          </div>
                          <div>
                            <span>Risk level</span>
                            <strong>{selectedNode.risk}%</strong>
                          </div>
                          <div>
                            <span>Connections</span>
                            <strong>
                              {selectedNode.connections.length} linked assets
                            </strong>
                          </div>
                        </div>
                        <div className="asset-actions">
                          <button
                            disabled={
                              sim.isPreview ||
                              sim.isFinished ||
                              sim.busy ||
                              sim.replayTick !== null
                            }
                            onClick={() =>
                              void sim.action("scan", selectedNode.id)
                            }
                          >
                            <ScanLine size={16} />
                            Scan asset
                          </button>
                          <button
                            className="primary"
                            disabled={
                              sim.isPreview ||
                              sim.isFinished ||
                              sim.busy ||
                              sim.replayTick !== null
                            }
                            onClick={() =>
                              void sim.action(
                                selectedNode.status === "isolated"
                                  ? "restore"
                                  : "isolate",
                                selectedNode.id,
                              )
                            }
                          >
                            <Shield size={16} />
                            {selectedNode.status === "isolated"
                              ? "Restore access"
                              : "Isolate room"}
                          </button>
                        </div>
                        {sim.isPreview && (
                          <p className="inline-hint">
                            Launch an exercise to act on this asset.
                          </p>
                        )}
                        <button
                          className="focus-room"
                          onClick={() => {
                            showFloor(getPlacement(selectedNode.id).floor);
                            setCameraMode("top");
                          }}
                        >
                          <Focus size={15} />
                          Focus this floor
                          <ArrowUpRight size={13} />
                        </button>
                        <div className="linked-assets">
                          <div className="section-overline">
                            <span>CONNECTED ROOMS</span>
                            <Network size={14} />
                          </div>
                          {selectedNode.connections.map((id) => {
                            const node = sim.nodes.find(
                              (item) => item.id === id,
                            );
                            return node ? (
                              <button key={id} onClick={() => pickNode(id)}>
                                <Database size={15} />
                                <span>{readable(node.label)}</span>
                                <i className={`status-dot ${node.status}`} />
                                <ChevronRight size={14} />
                              </button>
                            ) : null;
                          })}
                        </div>
                      </>
                    ) : (
                      <div className="asset-directory">
                        {FLOOR_DEFS.map((floor) => (
                          <div key={floor.id}>
                            <div className="section-overline">
                              <span>
                                {floor.short} / {floor.label}
                              </span>
                            </div>
                            {sim.nodes
                              .filter(
                                (node) =>
                                  getPlacement(node.id).floor === floor.id,
                              )
                              .map((node) => (
                                <button
                                  key={node.id}
                                  onClick={() => pickNode(node.id)}
                                >
                                  <Database size={15} />
                                  <span>{readable(node.label)}</span>
                                  <i className={`status-dot ${node.status}`} />
                                  <ChevronRight size={14} />
                                </button>
                              ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="agents-heading">
                      <div className="section-overline">
                        <span>FIVE SPECIALISTS. ONE MISSION.</span>
                        <button
                          aria-label={
                            sim.sound
                              ? "Mute event sounds"
                              : "Enable event sounds"
                          }
                          title="Toggle event sounds"
                          onClick={sim.toggleSound}
                        >
                          {sim.sound ? (
                            <Volume2 size={15} />
                          ) : (
                            <VolumeX size={15} />
                          )}
                        </button>
                      </div>
                      <h2>Your team on the ground.</h2>
                      <p>
                        Select an agent in the building or below to follow its
                        observations and decisions.
                      </p>
                    </div>
                    {sim.replayTick !== null && (
                      <p className="replay-note">
                        Reviewing recorded communications. Agent positions and
                        assignments are available in the current view.
                      </p>
                    )}
                    <div className="agent-roster">
                      {sim.run.agents.map((agent, index) => {
                        const Icon = AGENT_ICONS[index];
                        return (
                          <button
                            key={agent.id}
                            className={
                              sim.selectedAgentId === agent.id ? "selected" : ""
                            }
                            onClick={() => pickAgent(agent.id)}
                          >
                            <span className={`agent-symbol agent-${agent.id}`}>
                              <Icon size={19} />
                            </span>
                            <span>
                              <strong>{readable(agent.name)}</strong>
                              <small>{agent.role}</small>
                            </span>
                            <span className="agent-work">
                              <i />
                              {sim.replayTick !== null
                                ? "Replay"
                                : sim.isPreview
                                  ? "Standby"
                                  : agent.status}
                            </span>
                            <ChevronRight size={14} />
                          </button>
                        );
                      })}
                    </div>
                    {selectedAgent && sim.replayTick === null && (
                      <div className="agent-detail">
                        <div className="section-overline">
                          <span>
                            {readable(selectedAgent.name)} / CURRENT ASSIGNMENT
                          </span>
                          <button
                            aria-label="Show all agent communications"
                            onClick={() => sim.setSelectedAgentId(null)}
                          >
                            <X size={13} />
                          </button>
                        </div>
                        <p>{selectedAgent.task}</p>
                        <div>
                          <span>
                            <b>{selectedAgent.actions}</b> actions taken
                          </span>
                          <span>
                            <b>{selectedAgent.confidence}%</b> confidence
                          </span>
                        </div>
                        {selectedAgent.targetNodeId && (
                          <button
                            onClick={() =>
                              pickNode(selectedAgent.targetNodeId!)
                            }
                          >
                            Inspect assigned room
                            <ArrowUpRight size={12} />
                          </button>
                        )}
                      </div>
                    )}
                    <div className="comms-heading">
                      <span>
                        <Radio size={14} />
                        {selectedAgent
                          ? `${readable(selectedAgent.name)} channel`
                          : "Team communications"}
                      </span>
                      <small>
                        {sim.run.ai.error
                          ? "POLICY FALLBACK"
                          : sim.run.ai.mode === "openrouter"
                            ? "LIVE AI"
                            : "POLICY ENGINE"}
                      </small>
                    </div>
                    <div
                      className="communications"
                      aria-live="polite"
                      aria-relevant="additions"
                    >
                      {events.map((event) => (
                        <EventItem key={event.id} event={event} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="panel-content secondary-panel">
              <button className="back-link" onClick={() => navigate("room")}>
                <ChevronLeft size={14} />
                Back to operations
              </button>
              {pageMode === "history" ? (
                <>
                  <div className="section-overline">
                    <span>THE EVIDENCE TRAIL</span>
                    <button
                      aria-label="Refresh incident archive"
                      onClick={() => void sim.loadHistory()}
                    >
                      <RotateCcw size={15} />
                    </button>
                  </div>
                  <h2>Every incident tells a story.</h2>
                  <p>
                    Reopen an exercise. Follow each decision. Find the moment
                    that changed the outcome.
                  </p>
                  {sim.historyLoading ? (
                    <div className="panel-empty">
                      <span className="spinner" />
                      Loading exercises…
                    </div>
                  ) : sim.history.length ? (
                    <div className="history-list">
                      {sim.history.map((run) => (
                        <button
                          key={run.id}
                          disabled={sim.busy}
                          onClick={async () => {
                            await sim.openRun(run.id);
                            setPageMode("room");
                            setSideTab("simulation");
                          }}
                        >
                          <div className={`history-icon ${run.status}`}>
                            <Shield size={19} />
                          </div>
                          <div>
                            <strong>{SCENARIO_NAMES[run.scenarioId]}</strong>
                            <small>
                              {new Date(run.createdAt).toLocaleString(
                                undefined,
                                {
                                  month: "short",
                                  day: "numeric",
                                  hour: "numeric",
                                  minute: "2-digit",
                                },
                              )}
                            </small>
                            <span>
                              {run.metrics.integrity}% integrity ·{" "}
                              {clock(run.tick)} · Policy v{run.policy.version}
                            </span>
                          </div>
                          <ChevronRight size={15} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="panel-empty">
                      <Layers3 size={30} strokeWidth={1} />
                      <h3>A clean slate.</h3>
                      <p>
                        Launch your first exercise to start the incident
                        archive.
                      </p>
                      <button
                        className="launch-button"
                        onClick={() => navigate("room")}
                      >
                        Start an exercise
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  )}
                  <button
                    className="download-log"
                    disabled={sim.isPreview}
                    onClick={sim.exportRun}
                  >
                    <ArrowDownToLine size={15} />
                    Export current incident
                  </button>
                </>
              ) : (
                <>
                  <div className="section-overline">
                    <span>AGENT MEMORY</span>
                    <BrainCircuit size={16} />
                  </div>
                  <h2>The next defense starts here.</h2>
                  <p>
                    Each incident is replayed against a proposed policy. Only
                    measured improvements become the next line of defense.
                  </p>
                  <div className="learning-loop">
                    <span>
                      <Activity size={15} />
                      Observe
                    </span>
                    <ChevronRight size={12} />
                    <span>
                      <BrainCircuit size={15} />
                      Learn
                    </span>
                    <ChevronRight size={12} />
                    <span>
                      <ShieldCheck size={15} />
                      Adapt
                    </span>
                  </div>
                  {sim.historyLoading ? (
                    <div className="panel-empty">Reading defense memory…</div>
                  ) : policies.length ? (
                    <div className="memory-policies">
                      {policies.map((policy: DefensePolicy) => (
                        <PolicyCard key={policy.scenarioId} policy={policy} />
                      ))}
                    </div>
                  ) : (
                    <div className="panel-empty">
                      <BrainCircuit size={34} strokeWidth={1} />
                      <h3>Experience is the advantage.</h3>
                      <p>
                        Complete an exercise to generate the first
                        evidence-backed policy.
                      </p>
                    </div>
                  )}
                  <button
                    className="launch-button"
                    disabled={sim.busy}
                    onClick={() => {
                      sim.setUseLearnedPolicy(true);
                      void sim.launch(sim.scenarioId, true);
                      setPageMode("room");
                      setSideTab("simulation");
                    }}
                  >
                    <Play size={14} fill="currentColor" />
                    Run with agent memory
                    <ArrowRight size={14} />
                  </button>
                </>
              )}
            </div>
          )}
          <footer className="panel-footer">
            <span>
              <i
                className={`status-dot ${sim.atlasConnected ? "healthy" : "exposed"}`}
              />
              {sim.healthError
                ? "Connection check failed"
                : !sim.health
                  ? "Checking Atlas…"
                  : sim.atlasConnected
                    ? "Atlas connected"
                    : "Atlas not connected"}
            </span>
            <span>
              {sim.storage?.persisted
                ? "Incident saved"
                : sim.storage
                  ? "Session memory"
                  : "Synthetic environment"}
            </span>
          </footer>
        </aside>
      </div>
      <dialog
        ref={dialogRef}
        className="briefing-dialog"
        onCancel={() => setBriefing(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setBriefing(false);
        }}
      >
        <button
          className="dialog-close"
          aria-label="Close mission briefing"
          onClick={() => setBriefing(false)}
        >
          <X size={19} />
        </button>
        <span className="eyebrow">WELCOME TO NORTHSTAR</span>
        <h2>A living operations center.</h2>
        <p>
          AEGIS turns a cyber incident into a place you can explore. Your five
          specialist agents work across a three-level digital twin.
        </p>
        <div className="briefing-list">
          <div>
            <Move3D size={22} />
            <section>
              <h3>Explore the building</h3>
              <p>
                Drag to orbit and scroll to zoom. Separate the floors, remove
                the facade, or switch to a floor plan.
              </p>
            </section>
          </div>
          <div>
            <MousePointer2 size={22} />
            <section>
              <h3>Go where the action is</h3>
              <p>
                Select a room to inspect its health and network connections.
                Follow an agent to understand its assignment.
              </p>
            </section>
          </div>
          <div>
            <ShieldCheck size={22} />
            <section>
              <h3>Change the outcome</h3>
              <p>
                Launch a simulated attack. Scan and isolate rooms yourself, or
                let the team respond. Replay the incident and use its lessons in
                the next exercise.
              </p>
            </section>
          </div>
        </div>
        <p className="briefing-note">
          All attacks and defensive actions operate on synthetic assets.
          Optional AI decisions run through OpenRouter; policy decisions keep
          the exercise running when AI is unavailable.
        </p>
        <button className="launch-button" onClick={() => setBriefing(false)}>
          Enter the operations center
          <ArrowRight size={15} />
        </button>
      </dialog>
    </div>
  );
}

function EventItem({ event }: { event: SimulationEvent }) {
  return (
    <article
      className={`comm-event ${event.kind === "attack" ? "attack" : ""}`}
    >
      <span className={`event-icon ${event.agentId}`}>
        {event.kind === "attack" ? (
          <Crosshair size={14} />
        ) : event.agentId === "system" ? (
          <Activity size={14} />
        ) : (
          <Shield size={14} />
        )}
      </span>
      <div>
        <div className="event-meta">
          <strong>{readable(event.agentId)}</strong>
          <time>{clock(event.tick)}</time>
        </div>
        <p>{event.message}</p>
        <span className="event-kind">
          {event.source === "openrouter"
            ? "AI decision"
            : event.source === "human"
              ? "Your action"
              : event.kind}
          {event.confidence !== undefined && (
            <>
              <i /> {event.confidence}% confidence
            </>
          )}
        </span>
      </div>
    </article>
  );
}
function IntegrityChart({
  history,
}: {
  history: { tick: number; integrity: number }[];
}) {
  const values =
    history.length > 1 ? history.map((point) => point.integrity) : [100, 100];
  const path = values
    .map((v, i) => `${(i / (values.length - 1)) * 280},${34 - (v - 50) * 0.5}`)
    .join(" ");
  return (
    <svg
      className="integrity-chart"
      viewBox="0 0 280 40"
      preserveAspectRatio="none"
      role="img"
      aria-label="Network integrity over the exercise"
    >
      <path d="M0 35H280" stroke="currentColor" opacity=".18" strokeWidth="1" />
      <polyline
        points={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
function PolicyCard({ policy }: { policy: DefensePolicy }) {
  const evaluation = policy.evidence?.evaluation;
  return (
    <article className="policy-card">
      <div className="section-overline">
        <span>POLICY V{policy.version}</span>
        <span className="verified">
          <CheckCheck size={12} />
          Verified
        </span>
      </div>
      <h3>{SCENARIO_NAMES[policy.scenarioId]}</h3>
      <p>{policy.lesson}</p>
      {evaluation && (
        <div className="policy-comparison">
          <div>
            <span>Original</span>
            <i>
              <b style={{ width: `${evaluation.baselineIntegrity}%` }} />
            </i>
            <strong>{evaluation.baselineIntegrity}%</strong>
          </div>
          <div>
            <span>Adapted</span>
            <i>
              <b style={{ width: `${evaluation.candidateIntegrity}%` }} />
            </i>
            <strong>{evaluation.candidateIntegrity}%</strong>
          </div>
          <small>Integrity retained · same attack seed {evaluation.seed}</small>
        </div>
      )}
      <div className="policy-facts">
        <span>
          <strong>{policy.isolationDelay * 2}s</strong>isolation delay
        </span>
        <span>
          <strong>{policy.scanCadence * 2}s</strong>scan interval
        </span>
      </div>
    </article>
  );
}
