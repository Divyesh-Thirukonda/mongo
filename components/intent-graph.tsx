"use client";

import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";
import { ArrowDownToLine, Check, ChevronDown, Crosshair, GitBranch, GitMerge, Loader2, Minus, Plus, RotateCcw, Send, X } from "lucide-react";
import type { MemoryCheckpoint, SessionSnapshot } from "@/lib/types";
import { buildIntentGraph, graphEdgePath, graphHistoryTarget, type GraphKind, type IntentGraphNode } from "@/lib/intent-graph";
import styles from "./intent-graph.module.css";

type HistoryRequest = { signature: string; requestId: string; expectedRevision: number };
type HistoryDraft = { text: string; request?: HistoryRequest; error?: string; notice?: string };
const EMPTY_DRAFT: HistoryDraft = { text: "" };


const KIND_LABEL: Record<GraphKind, string> = { intent: "Intent", turn: "Coding turn", steer: "Live amendment", resume: "Resumed", agent: "Agent", tool: "Tool call", checkpoint: "Checkpoint", verification: "Verification", routing: "Plan update", conflict: "Conflict", system: "Activity", connected: "Connected update", "reported-tool": "Reported tool call", revision: "Correction", restore: "Checkpoint restore" };
function time(value: string, full = false) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : full ? date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }) : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function shorten(value: string, length: number) { return value.length > length ? `${value.slice(0, length - 1).trimEnd()}…` : value; }
function NodeMark({ node, selected }: { node: IntentGraphNode; selected: boolean }) {
  const solid = node.kind === "turn" || node.kind === "steer";
  return <g>
    {selected && <circle r="15" fill={node.color} opacity=".11" />}
    {node.source === "connected-agent" && <circle r="10" fill="none" stroke={node.color} strokeWidth="1" strokeDasharray="2 2" opacity=".6" />}
    {node.kind === "checkpoint" ? <rect x="-6" y="-6" width="12" height="12" rx="2" transform="rotate(45)" fill="#fbfaf7" stroke={node.color} strokeWidth="2" /> : <circle r={node.kind === "intent" ? 7 : 6} fill={solid ? node.color : "#fbfaf7"} stroke={node.color} strokeWidth="2" />}
    {node.kind === "steer" && <path d="m-2-2 4 2-4 2" fill="none" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />}
    {node.status === "fulfilled" && <path d="m-3 0 2 2 4-4" fill="none" stroke={node.color} strokeWidth="1.5" strokeLinecap="round" />}
    {node.status === "blocked" && <path d="m-2-2 4 4m0-4-4 4" stroke="#b47c61" strokeWidth="1.5" strokeLinecap="round" />}
  </g>;
}

export function IntentGraph({ snapshot, disabled = false, onRefresh }: { snapshot: SessionSnapshot; disabled?: boolean; onRefresh: () => void | Promise<void> }) {
  const [compact, setCompact] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<IntentGraphNode | null>(null);
  const [checkpointRecord, setCheckpointRecord] = useState<MemoryCheckpoint | undefined>(undefined);
  const [zoom, setZoom] = useState(1);
  const [following, setFollowing] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, HistoryDraft>>({});
  const [historyBusy, setHistoryBusy] = useState<{ nodeId: string; action: "revise" | "restore" } | null>(null);
  const historyInFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const patternId = `graph-grid-${useId().replace(/:/g, "")}`;
  const graph = useMemo(() => buildIntentGraph(snapshot, { compact }), [snapshot, compact]);
  const nodeMap = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const selected = selectedId ? nodeMap.get(selectedId) ?? (selectedRecord?.id === selectedId ? selectedRecord : undefined) : undefined;
  const relatedIds = useMemo(() => new Set(graph.edges.filter((edge) => edge.kind !== "timeline" && (edge.from === selectedId || edge.to === selectedId)).flatMap((edge) => [edge.from, edge.to])), [graph.edges, selectedId]);
  const running = ["planning", "running", "review"].includes(snapshot.session.status);
  const latestId = graph.nodes.at(-1)?.id;
  const history = graph.history;
  const selectedDraft = selected ? drafts[selected.id] ?? EMPTY_DRAFT : EMPTY_DRAFT;
  const selectedCheckpoint = selected?.id.startsWith("checkpoint:") ? snapshot.checkpoints.find((checkpoint) => checkpoint.id === selected.sourceId) ?? (checkpointRecord?.id === selected.sourceId ? checkpointRecord : undefined) : undefined;
  const restorable = selectedCheckpoint?.restorable === true;
  const historyDisabled = disabled || Boolean(historyBusy) || Boolean(snapshot.session.historyRequest);
  const setDraft = (nodeId: string, patch: Partial<HistoryDraft>) => setDrafts((current) => ({ ...current, [nodeId]: { ...(current[nodeId] ?? EMPTY_DRAFT), ...patch } }));

  const submitHistory = async (action: "revise" | "restore") => {
    if (!selected || disabled || historyInFlight.current || snapshot.session.historyRequest) return;
    if (action === "restore" && !restorable) return;
    const target = graphHistoryTarget(selected), nodeId = selected.id, text = selectedDraft.text.trim();
    if (action === "revise" && (text.length < 2 || text.length > 2000)) { setDraft(nodeId, { error: "Describe the change in 2–2,000 characters. Your draft is unchanged.", notice: undefined }); return; }
    const signature = JSON.stringify({ action, target, ...(action === "revise" ? { text } : {}) });
    const previous = selectedDraft.request;
    const request = previous?.signature === signature ? previous : { signature, requestId: crypto.randomUUID(), expectedRevision: snapshot.session.revision };
    setDraft(nodeId, { request, error: undefined, notice: undefined });
    historyInFlight.current = true; setHistoryBusy({ nodeId, action });
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(snapshot.session.id)}/history`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, target, ...(action === "revise" ? { text } : {}), expectedRevision: request.expectedRevision, requestId: request.requestId }),
      });
      const result = await response.json().catch(() => null);
      if (!mounted.current) return;
      if (response.status === 409) {
        setDraft(nodeId, { request: undefined, error: `${typeof result?.error === "string" ? result.error : "The session changed."} The latest state is being loaded. Review it and retry; your draft is unchanged.` });
        await onRefresh(); return;
      }
      if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : `The change could not be saved (${response.status}). Please retry.`);
      if (result?.ok !== true || !Number.isInteger(result.revision)) throw new Error("The server response was incomplete. Retry with the same request to check whether it was saved.");
      if (result.status === "failed") {
        setDraft(nodeId, { request: undefined, error: "That restore stopped before it could finish. Review the session error and retry; your draft is unchanged." });
        await onRefresh(); return;
      }
      setDraft(nodeId, {
        ...(action === "revise" ? { text: "" } : {}), request: undefined, error: undefined,
        notice: action === "restore" ? result.status === "queued" ? "Restore queued. The worker will restore the saved files and request decisions, then pause." : `Checkpoint restored as revision ${result.revision}. Work is paused.` : `Change saved as revision ${result.revision}. The coding worker will apply it.`,
      });
      await onRefresh();
    } catch (cause) { if (mounted.current) setDraft(nodeId, { error: cause instanceof Error ? cause.message : "Could not save the change. Your draft is unchanged." }); }
    finally { historyInFlight.current = false; if (mounted.current) setHistoryBusy(null); }
  };

  useEffect(() => {
    setSelectedId(null); setSelectedRecord(null); setCheckpointRecord(undefined); setZoom(1); setFollowing(true); setDrafts({});
    viewport.current?.scrollTo({ top: 0, left: 0 });
  }, [snapshot.session.id, snapshot.currentUserId]);
  useEffect(() => {
    if (following && running) viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: "smooth" });
  }, [latestId, following, running, zoom]);

  const selectNode = (node: IntentGraphNode, reveal = false) => {
    setSelectedId(node.id); setSelectedRecord(node); setCheckpointRecord(node.id.startsWith("checkpoint:") ? snapshot.checkpoints.find((checkpoint) => checkpoint.id === node.sourceId) : undefined); setFollowing(false);
    if (reveal && viewport.current) viewport.current.scrollTo({ top: Math.max(0, node.y * zoom - viewport.current.clientHeight / 2), behavior: "smooth" });
  };
  const changeZoom = (value: number) => {
    const next = Math.max(.5, Math.min(1.8, Number(value.toFixed(2))));
    const element = viewport.current;
    const center = element ? { x: (element.scrollLeft + element.clientWidth / 2) / zoom, y: (element.scrollTop + element.clientHeight / 2) / zoom } : null;
    setFollowing(false); setZoom(next);
    requestAnimationFrame(() => { if (element && center) element.scrollTo({ left: center.x * next - element.clientWidth / 2, top: center.y * next - element.clientHeight / 2 }); });
  };
  const recenter = () => {
    setFollowing(false); setZoom(Math.max(.5, Math.min(1, ((viewport.current?.clientWidth ?? graph.width) - 10) / graph.width)));
    viewport.current?.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  };
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as Element).closest("[data-graph-node]")) return;
    const element = event.currentTarget;
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
    element.setPointerCapture(event.pointerId); setDragging(true); setFollowing(false);
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    event.currentTarget.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
    event.currentTarget.scrollTop = drag.current.top - (event.clientY - drag.current.y);
  };
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null; setDragging(false);
  };
  const jumpLatest = () => { setFollowing(true); viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: "smooth" }); };

  return <section className={styles.graph} aria-label="Shared intent graph">
    <div className={styles.heading}>
      <div><span className={styles.eyebrow}><GitBranch size={12} /> ACTIVITY</span><h2>Intent and execution</h2></div>
      <span className={`${styles.live} ${running ? styles.running : ""}`}><i />{running ? "Live" : snapshot.session.status === "complete" ? "Verified" : snapshot.session.status}</span>
    </div>
    <div className={styles.toolbar}>
      <div className={styles.segmented} aria-label="Graph activity filter">
        <button type="button" aria-pressed={compact} onClick={() => setCompact(true)}>Overview</button>
        <button type="button" aria-pressed={!compact} onClick={() => setCompact(false)}>All activity{history.filteredEvents > 0 && compact ? <span>{history.filteredEvents}</span> : null}</button>
      </div>
      <div className={styles.zoomControls}>
        <button type="button" onClick={() => changeZoom(zoom - .15)} disabled={zoom <= .5} aria-label="Zoom out"><Minus size={13} /></button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => changeZoom(zoom + .15)} disabled={zoom >= 1.8} aria-label="Zoom in"><Plus size={13} /></button>
        <button type="button" onClick={recenter} aria-label="Recenter graph" title="Fit width and return to the beginning"><Crosshair size={14} /></button>
      </div>
    </div>
    <div className={styles.legend} aria-label="Graph lanes">
      {graph.lanes.map((lane) => <span key={lane.id} title={lane.name}><i style={{ background: lane.color }} />{lane.id.startsWith("author:") ? lane.name.split(" ")[0] : lane.name}</span>)}
    </div>
    <div ref={viewport} className={`${styles.viewport} ${dragging ? styles.dragging : ""}`} tabIndex={0} aria-label="Graph canvas. Drag to pan, use zoom controls, or select a node."
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onWheel={() => setFollowing(false)}>
      {graph.nodes.length ? <svg className={styles.canvas} width={graph.width * zoom} height={graph.height * zoom} viewBox={`0 0 ${graph.width} ${graph.height}`} role="group" aria-label="Chronological graph of recorded intents and execution">
        <defs><pattern id={patternId} width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".65" fill="#dddfd5" /></pattern></defs>
        <rect width={graph.width} height={graph.height} fill={`url(#${patternId})`} />
        {graph.lanes.map((lane) => <line key={lane.id} x1={lane.x} x2={lane.x} y1="10" y2={graph.height - 8} stroke={lane.color} opacity=".09" strokeDasharray="2 5" />)}
        {graph.edges.map((edge) => {
          const from = nodeMap.get(edge.from), to = nodeMap.get(edge.to);
          if (!from || !to) return null;
          const highlighted = selectedId === edge.from || selectedId === edge.to;
          // Source and same-turn links are shown on selection. The unselected view
          // retains dependency branches and acknowledged amendment joins.
          const always = edge.kind === "timeline" || edge.kind === "history" || edge.kind === "dependency" || (edge.kind === "intent" && (to.kind === "steer" || to.kind === "turn"));
          if (!always && !highlighted) return null;
          return <path key={edge.id} d={edge.kind === "history" && from.x === to.x ? `M ${from.x} ${from.y} C ${from.x - 26} ${from.y}, ${to.x - 26} ${to.y}, ${to.x} ${to.y}` : graphEdgePath(from, to)} fill="none" stroke={edge.kind === "history" ? "#9d8657" : edge.kind === "timeline" ? from.color : edge.kind === "turn" ? "#788769" : from.color}
            strokeWidth={highlighted ? 2.5 : edge.kind === "history" ? 2.2 : edge.kind === "timeline" ? 1.7 : 1.8} opacity={highlighted ? .9 : selected ? .16 : edge.kind === "history" ? .8 : edge.kind === "timeline" ? .37 : .55}
            strokeDasharray={edge.kind === "source" || edge.kind === "turn" || edge.kind === "reported" || to.y < from.y ? "4 4" : undefined}><title>{edge.label}</title></path>;
        })}
        {graph.nodes.map((node) => {
          const isSelected = node.id === selectedId;
          const faded = Boolean(selected && !isSelected && !relatedIds.has(node.id));
          const subtitle = node.kind === "intent" ? `${node.actor.split(" ")[0]} · ${node.relation ?? "pending routing"} · r${node.revision}` : `${KIND_LABEL[node.kind]}${node.source === "connected-agent" ? " · self-reported" : node.historyAction ? ` · r${node.historyAction.fromRevision} → r${node.historyAction.toRevision}` : node.turnId ? ` · ${shorten(node.turnId, 12)}` : node.sequence ? ` · #${node.sequence}` : ""}`;
          const labelLength = Math.floor((graph.width - graph.labelX - 42) / 6.1);
          return <g key={node.id} role="button" tabIndex={0} data-graph-node="true" className={styles.node} aria-pressed={isSelected} aria-label={`${KIND_LABEL[node.kind]}: ${node.title}. ${time(node.createdAt, true)}`}
            onClick={() => selectNode(node)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectNode(node); } }} opacity={faded ? .48 : 1}>
            <title>{node.title}</title>
            <rect className={styles.nodeCard} x={graph.labelX - 12} y={node.y - 24} width={graph.width - graph.labelX - 6} height="50" rx="8" fill={isSelected ? "#f3f5ed" : node.kind === "intent" ? "#fffefa" : "#fbfaf7"} stroke={isSelected ? node.color : node.kind === "intent" ? "#e4e6dc" : "transparent"} />
            <line x1={node.x + 11} x2={graph.labelX - 17} y1={node.y} y2={node.y} stroke={node.color} opacity=".13" />
            <g transform={`translate(${node.x},${node.y})`}><NodeMark node={node} selected={isSelected} /></g>
            <text x={graph.labelX} y={node.y - 4} className={styles.nodeTitle}>{shorten(node.title, labelLength)}</text>
            <text x={graph.labelX} y={node.y + 13} className={styles.nodeMeta}>{shorten(subtitle, labelLength - 9)}</text>
            <text x={graph.width - 31} y={node.y + 13} textAnchor="end" className={styles.nodeTime}>{time(node.createdAt)}</text>
            {node.warnings.length > 0 && <circle cx={graph.width - 19} cy={node.y - 8} r="3" fill="#ba9670"><title>Some source relationships need attention</title></circle>}
          </g>;
        })}
      </svg> : <div className={styles.empty}>
        <div className={styles.emptyMark}><GitBranch size={30} /><span /></div>
        <h3>No activity yet</h3><p>Send an intent to see its author, dependencies, and execution history.</p>
      </div>}
    </div>
    <div className={styles.graphFoot}>
      <span>{graph.nodes.length ? "Drag to pan · select a node to trace it" : "Source-backed intent & execution history"}</span>
      <button type="button" className={following ? styles.following : ""} onClick={following ? () => setFollowing(false) : jumpLatest} aria-pressed={following} title="Follow the latest activity"><ArrowDownToLine size={12} />{following ? "Following" : "Latest"}</button>
    </div>
    {selected && <aside className={styles.detail} aria-label="Selected graph node">
      <div className={styles.detailHeading}><span style={{ color: selected.color }}>{selected.kind === "steer" ? <GitMerge size={13} /> : <GitBranch size={13} />}{KIND_LABEL[selected.kind]}{selected.status && <b>{selected.status}</b>}</span><button type="button" onClick={() => setSelectedId(null)} aria-label="Close node details"><X size={14} /></button></div>
      <h3>{selected.title}</h3><div className={styles.detailByline}>{selected.actor}<span>·</span><time dateTime={selected.createdAt}>{time(selected.createdAt, true)}</time></div>
      {selected.source === "connected-agent" && <p className={styles.reported}>Self-reported by connected Codex. These updates do not certify execution or verification.</p>}
      {!nodeMap.has(selected.id) && <p className={styles.warning}>This selected record is outside the current activity view. Its saved details and your draft remain available here.</p>}
      <p>{selected.detail}</p>
      {selected.acceptance.length > 0 && <ul className={styles.acceptance}>{selected.acceptance.map((text, index) => <li key={`${index}:${text}`}><Check size={11} /><span>{text}</span></li>)}</ul>}
      {selected.warnings.map((warning) => <p className={styles.warning} key={warning}>{warning}</p>)}
      <div className={styles.historyActions}>
        {snapshot.session.historyRequest && <p className={styles.actionPending}><Loader2 size={12} className="spin"/>A restore is queued. Changes are available after the worker finishes restoring and pauses.</p>}
        <details className={styles.actionDisclosure} key={`revise:${selected.id}`}>
          <summary><Send size={12}/>Change this step<ChevronDown size={12}/></summary>
          <p>Describe the correction. This adds a new revision and preserves the earlier history.</p>
          <form onSubmit={(event) => { event.preventDefault(); void submitHistory("revise"); }}>
            <label className={styles.actionLabel} htmlFor={`${patternId}-revision`}>Requested change</label>
            <textarea id={`${patternId}-revision`} value={selectedDraft.text} onChange={(event) => setDraft(selected.id, { text: event.target.value, error: undefined, notice: undefined })} placeholder="What should change about this step?" maxLength={2000} rows={3} disabled={historyDisabled}/>
            <div className={styles.actionFooter}><span>{selectedDraft.text.length}/2,000</span><button type="submit" disabled={historyDisabled || selectedDraft.text.trim().length < 2 || selectedDraft.text.trim().length > 2000}>{historyBusy?.nodeId === selected.id && historyBusy.action === "revise" ? <Loader2 size={12} className="spin"/> : <Send size={12}/>}Request change</button></div>
          </form>
        </details>
        {selectedCheckpoint && <details className={styles.actionDisclosure} key={`restore:${selected.id}`}>
          <summary><RotateCcw size={12}/>Restore this checkpoint<ChevronDown size={12}/></summary>
          <p>Restore saved files and request decisions from revision {selectedCheckpoint.revision} as a new revision. Later history stays visible. Work pauses after restore. Use Resume when you are ready to continue.</p>
          {!restorable && <p className={styles.restoreUnavailable}>This checkpoint does not have both saved files and request decisions, so it cannot be restored exactly. Use “Change this step” to request a new direction.</p>}
          <button type="button" className={styles.restoreButton} disabled={historyDisabled || !restorable} onClick={() => void submitHistory("restore")}>{historyBusy?.nodeId === selected.id && historyBusy.action === "restore" ? <Loader2 size={12} className="spin"/> : <RotateCcw size={12}/>}Restore checkpoint · r{selectedCheckpoint.revision}</button>
        </details>}
        {selectedDraft.error && <p className={styles.actionError} role="alert">{selectedDraft.error}</p>}
        {selectedDraft.notice && <p className={styles.actionNotice} role="status"><Check size={12}/>{selectedDraft.notice}</p>}
      </div>
      <details className={styles.sources}><summary><ChevronDown size={12} />Source references{selected.references.length ? ` · ${selected.references.length}` : ""}</summary><dl><dt>Record ID</dt><dd>{selected.sourceId}</dd>{selected.turnId && <><dt>Turn ID</dt><dd>{selected.turnId}</dd></>}{selected.externalTrajectoryId && <><dt>Report group</dt><dd>{selected.externalTrajectoryId}</dd></>}{selected.actorUserId && <><dt>Connected by</dt><dd>{selected.actorUserId}</dd></>}{selected.sequence !== undefined && <><dt>Event sequence</dt><dd>{selected.sequence}</dd></>}{selected.historyAction && <><dt>Revision change</dt><dd>r{selected.historyAction.fromRevision} → r{selected.historyAction.toRevision}</dd><dt>Action request</dt><dd>{selected.historyAction.requestId}</dd></>}</dl>
        <div className={styles.referenceList}>{selected.references.map((reference) => <button type="button" key={`${reference.type}:${reference.id}`} disabled={!reference.available} onClick={() => { const node = nodeMap.get(`${reference.type}:${reference.id}`); if (node) selectNode(node, true); }}><span>{reference.type}</span><code>{reference.id}</code>{!reference.available && <small>outside view</small>}</button>)}</div>
      </details>
    </aside>}
    <div className={styles.history} aria-live="polite">
      <span>{history.shownEvents} of {history.loadedEvents} loaded events · {history.totalEvents} stored</span>
      <span>{history.loadedCheckpoints} checkpoints{history.totalEvents > history.loadedEvents ? " · latest history window" : ""}</span>
      {(history.omittedEvents + history.omittedIntents + history.omittedCheckpoints > 0) && <span>View limit: {history.omittedEvents} events, {history.omittedIntents} intents, {history.omittedCheckpoints} checkpoints omitted.</span>}
    </div>
  </section>;
}
