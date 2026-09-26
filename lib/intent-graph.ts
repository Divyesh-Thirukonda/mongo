import { PEOPLE, type Intent, type Participant, type SessionSnapshot, type TrajectoryEvent } from "./types";

export type GraphKind = "intent" | "turn" | "steer" | "resume" | "agent" | "tool" | "checkpoint" | "verification" | "routing" | "conflict" | "system" | "connected" | "reported-tool" | "revision" | "restore";
export interface GraphReference { type: "intent" | "event" | "checkpoint"; id: string; available: boolean }
export interface IntentGraphNode {
  id: string; sourceId: string; kind: GraphKind; laneId: string; title: string; detail: string;
  createdAt: string; actor: string; color: string; status?: string; revision?: number;
  turnId?: string; sequence?: number; relation?: string; references: GraphReference[];
  source?: TrajectoryEvent["source"]; externalTrajectoryId?: string; actorUserId?: string; historyAction?: TrajectoryEvent["historyAction"];
  warnings: string[]; acceptance: string[]; x: number; y: number;
}
export interface GraphHistoryTarget { type: "intent" | "event" | "checkpoint"; id: string }
/** Display kinds can overlap; mutations must address the original record collection. */
export function graphHistoryTarget(node: Pick<IntentGraphNode, "id" | "sourceId">): GraphHistoryTarget {
  const type = node.id.startsWith("intent:") ? "intent" : node.id.startsWith("checkpoint:") ? "checkpoint" : "event";
  if (node.id !== `${type}:${node.sourceId}`) throw new Error("Graph history target has no matching source record.");
  return { type, id: node.sourceId };
}

export interface IntentGraphEdge {
  id: string; from: string; to: string; kind: "dependency" | "intent" | "turn" | "source" | "timeline" | "reported" | "history"; label: string;
}
export interface IntentGraphLane { id: string; name: string; initials: string; color: string; x: number }
export interface IntentGraphData {
  nodes: IntentGraphNode[]; edges: IntentGraphEdge[]; lanes: IntentGraphLane[];
  width: number; height: number; labelX: number;
  history: { loadedEvents: number; totalEvents: number; shownEvents: number; filteredEvents: number; omittedEvents: number; omittedIntents: number; loadedCheckpoints: number; omittedCheckpoints: number };
}
const EXECUTION_COLOR = "#70805c";
const CONNECTED_COLOR = "#9380a5";
const FALLBACK_COLORS = ["#6579b1", "#b0805e", "#7e6d9e", "#527e88", "#a07684"];
const timestamp = (value: string) => { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : 0; };
const compareEvents = (a: TrajectoryEvent, b: TrajectoryEvent) => a.sequence - b.sequence || timestamp(a.createdAt) - timestamp(b.createdAt) || a.id.localeCompare(b.id);
const compareIntents = (a: Intent, b: Intent) => a.revision - b.revision || timestamp(a.createdAt) - timestamp(b.createdAt) || a.id.localeCompare(b.id);
const unique = <T extends { id: string }>(values: T[]) => [...new Map(values.map((value) => [value.id, value])).values()];
const limit = (value: number | undefined, fallback: number, ceiling: number) => Number.isFinite(value) ? Math.max(1, Math.min(ceiling, Math.floor(value!))) : fallback;

function participant(authorId: string, people: Participant[]): Pick<Participant, "id" | "name" | "initials" | "color"> {
  const known = people.find((person) => person.id === authorId) ?? PEOPLE.find((person) => person.id === authorId);
  if (known) return known;
  const hash = [...authorId].reduce((value, char) => ((value * 31 + char.charCodeAt(0)) >>> 0), 0);
  return { id: authorId, name: `Contributor ${authorId.slice(0, 6)}`, initials: "?", color: FALLBACK_COLORS[hash % FALLBACK_COLORS.length] };
}

function externalTrajectory(event: TrajectoryEvent): string | undefined {
  // Older connected reports used a synthetic external-* value in turnId.
  // Preserve grouping without promoting those IDs to observed execution IDs.
  return event.externalTrajectoryId ?? (event.turnId?.startsWith("external-") ? event.turnId : undefined);
}
function isConnected(event: TrajectoryEvent): boolean { return event.source === "connected-agent" || Boolean(externalTrajectory(event)) || event.actor === "Codex · connected"; }
function group(event: TrajectoryEvent): string | undefined {
  if (isConnected(event)) { const id = externalTrajectory(event); return id ? `reported:${id}` : undefined; }
  return event.turnId ? `turn:${event.turnId}` : undefined;
}
function eventKind(event: TrajectoryEvent): GraphKind {
  if (isConnected(event)) return event.kind === "tool" ? "reported-tool" : "connected";
  if (event.historyAction) return event.historyAction.action === "restore" ? "restore" : "revision";
  if (event.kind === "merge") return event.turnId ? "steer" : "routing";
  if (event.kind === "intent") return "routing";
  if (event.kind === "agent" && /^(Working from the shared plan|Repairing against measured checks)$/.test(event.title)) return "turn";
  if (event.kind === "system" && /\b(resumed|restored|recovering)\b/i.test(event.title)) return "resume";
  return event.kind;
}

/** Build only source-backed nodes. Lines show recorded relationships or lane chronology, never inferred forks. */
export function buildIntentGraph(snapshot: SessionSnapshot, options: { compact?: boolean; maxEvents?: number; maxIntents?: number } = {}): IntentGraphData {
  const compact = options.compact ?? true;
  const sessionId = snapshot.session.id;
  const allIntents = unique(snapshot.intents.filter((intent) => intent.sessionId === sessionId)).sort(compareIntents);
  const intents = allIntents.slice(-limit(options.maxIntents, 128, 256));
  const allEvents = unique(snapshot.events.filter((event) => event.sessionId === sessionId)).sort(compareEvents);
  const recentEvents = allEvents.slice(-limit(options.maxEvents, 100, 300));
  const checkpoints = unique(snapshot.checkpoints.filter((checkpoint) => checkpoint.sessionId === sessionId)).sort((a, b) => timestamp(a.createdAt) - timestamp(b.createdAt) || a.id.localeCompare(b.id));
  const shownCheckpoints = checkpoints.slice(-16);
  const anchors = new Map<string, string>();
  for (const event of recentEvents) { const key = group(event); if (key && !anchors.has(key)) anchors.set(key, event.id); }
  const historyEventTargets = new Set(recentEvents.filter((event) => !isConnected(event) && event.historyAction?.target.type === "event").map((event) => event.historyAction!.target.id));
  const events = recentEvents.filter((event) => {
    if (!compact || historyEventTargets.has(event.id)) return true;
    const key = group(event);
    if (key && anchors.get(key) === event.id) return true;
    const kind = eventKind(event);
    return !["tool", "reported-tool", "routing", "agent"].includes(kind) && !(kind === "checkpoint" && shownCheckpoints.length);
  });
  const authorIds = [...new Set(intents.map((intent) => intent.authorId))];
  const hasConnected = events.some(isConnected);
  const lanes: IntentGraphLane[] = [{ id: "execution", name: "Shared thread", initials: "↗", color: EXECUTION_COLOR, x: 38 }, ...(hasConnected ? [{ id: "connected", name: "Connected reports", initials: "C", color: CONNECTED_COLOR, x: 76 }] : []), ...authorIds.map((id, index) => {
    const author = participant(id, snapshot.participants ?? []);
    return { id: `author:${id}`, name: author.name, initials: author.initials, color: author.color, x: (hasConnected ? 108 : 76) + index * 32 };
  })];
  const laneMap = new Map(lanes.map((lane) => [lane.id, lane]));
  const nodes: IntentGraphNode[] = [];
  const edges: IntentGraphEdge[] = [];
  const intentIds = new Set(intents.map((intent) => intent.id));
  const eventIds = new Set(events.map((event) => event.id));
  const checkpointIds = new Set(shownCheckpoints.map((checkpoint) => checkpoint.id));
  const reference = (type: GraphReference["type"], id: string): GraphReference => ({ type, id, available: (type === "intent" ? intentIds : type === "checkpoint" ? checkpointIds : eventIds).has(id) });
  for (const intent of intents) {
    const lane = laneMap.get(`author:${intent.authorId}`)!;
    const parents = [...new Set(intent.decision?.parentIntentIds ?? [])];
    nodes.push({ id: `intent:${intent.id}`, sourceId: intent.id, kind: "intent", laneId: lane.id, title: intent.decision?.summary || intent.text, detail: intent.text,
      createdAt: intent.createdAt, actor: lane.name, color: lane.color, status: intent.status, revision: intent.revision,
      relation: intent.decision?.relation, acceptance: intent.decision?.acceptance ?? [],
      references: parents.map((id) => reference("intent", id)), warnings: [], x: lane.x, y: 0 });
    for (const parent of parents) if (intentIds.has(parent)) edges.push({ id: `dependency:${parent}:${intent.id}`, from: `intent:${parent}`, to: `intent:${intent.id}`, kind: "dependency", label: intent.decision?.relation ?? "related" });
  }
  for (const event of events) {
    const kind = eventKind(event);
    const connected = isConnected(event);
    const reporter = connected && event.actorUserId ? participant(event.actorUserId, snapshot.participants ?? []).name : undefined;
    const references = [...new Set(event.intentIds)].map((id) => reference("intent", id));
    const historyAction = connected ? undefined : event.historyAction;
    if (historyAction && !references.some((item) => item.type === historyAction.target.type && item.id === historyAction.target.id)) references.push(reference(historyAction.target.type, historyAction.target.id));
    nodes.push({ id: `event:${event.id}`, sourceId: event.id, kind, laneId: connected ? "connected" : "execution", title: event.title, detail: event.detail,
      createdAt: event.createdAt, actor: reporter ? `Connected Codex · ${reporter}` : event.actor, color: connected ? CONNECTED_COLOR : kind === "conflict" ? "#b47c61" : EXECUTION_COLOR,
      turnId: connected ? undefined : event.turnId, source: connected ? "connected-agent" : event.source,
      externalTrajectoryId: connected ? externalTrajectory(event) : undefined, actorUserId: event.actorUserId, historyAction,
      sequence: event.sequence, acceptance: [], references, warnings: [], x: connected ? 76 : 38, y: 0 });
    for (const ref of references) if (ref.type === "intent" && ref.available) edges.push({ id: `intent-event:${ref.id}:${event.id}`, from: `intent:${ref.id}`, to: `event:${event.id}`, kind: "intent", label: kind === "steer" ? "included in acknowledged steer" : "referenced intent" });
    if (historyAction) {
      const target = references.find((item) => item.type === historyAction.target.type && item.id === historyAction.target.id);
      if (target?.available) edges.push({ id: `history:${target.type}:${target.id}:${event.id}`, from: `${target.type}:${target.id}`, to: `event:${event.id}`, kind: "history", label: `${historyAction.action === "restore" ? "restores" : "revises"} selected ${target.type} · r${historyAction.fromRevision} → r${historyAction.toRevision}` });
    }
    const key = group(event), anchor = key ? anchors.get(key) : undefined;
    if (anchor && anchor !== event.id && eventIds.has(anchor)) edges.push({ id: `${connected ? "reported" : "turn"}:${anchor}:${event.id}`, from: `event:${anchor}`, to: `event:${event.id}`, kind: connected ? "reported" : "turn", label: connected ? `self-reported group · ${externalTrajectory(event)}` : `same turn · ${event.turnId}` });
  }
  for (const checkpoint of shownCheckpoints) {
    const refs = [...new Set(checkpoint.intentIds)].map((id) => reference("intent", id));
    refs.push(...[...new Set(checkpoint.sourceEventIds ?? [])].map((id) => reference("event", id)));
    nodes.push({ id: `checkpoint:${checkpoint.id}`, sourceId: checkpoint.id, kind: "checkpoint", laneId: "execution", title: `Checkpoint · revision ${checkpoint.revision}`, detail: checkpoint.summary,
      createdAt: checkpoint.createdAt, actor: "Memory", color: "#879372", revision: checkpoint.revision,
      references: refs, acceptance: [], warnings: [], x: 38, y: 0 });
    for (const ref of refs) if (ref.available) edges.push({ id: `checkpoint-source:${ref.type}:${ref.id}:${checkpoint.id}`, from: `${ref.type}:${ref.id}`, to: `checkpoint:${checkpoint.id}`, kind: "source", label: "checkpoint source" });
  }
  for (const node of nodes) {
    const missing = node.references.filter((ref) => !ref.available);
    if (missing.length) node.warnings.push(`${missing.length} referenced ${missing.length === 1 ? "source is" : "sources are"} outside this view. Select All activity to reveal filtered events; older or unavailable records have no invented nodes.`);
    if (!timestamp(node.createdAt)) node.warnings.push("This record has no valid timestamp; source ordering is used.");
  }

  // Stable topological order preserves explicit dependencies and stored event
  // sequence even if clocks disagree. Original timestamps remain visible.
  const baseOrder = [...nodes].sort((a, b) => timestamp(a.createdAt) - timestamp(b.createdAt) || (a.kind === "intent" ? 0 : 1) - (b.kind === "intent" ? 0 : 1) || (a.sequence ?? a.revision ?? 0) - (b.sequence ?? b.revision ?? 0) || a.id.localeCompare(b.id));
  const rank = new Map(baseOrder.map((node, index) => [node.id, index]));
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const prerequisites = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of edges) if (edge.from !== edge.to) prerequisites.get(edge.to)!.add(edge.from);
  for (let index = 1; index < events.length; index++) prerequisites.get(`event:${events[index].id}`)!.add(`event:${events[index - 1].id}`);
  const pending = new Set(nodes.map((node) => node.id));
  const ordered: IntentGraphNode[] = [];
  while (pending.size) {
    const ready = [...pending].filter((id) => [...prerequisites.get(id)!].every((parent) => !pending.has(parent))).sort((a, b) => rank.get(a)! - rank.get(b)!);
    const id = ready[0] ?? [...pending].sort((a, b) => rank.get(a)! - rank.get(b)!)[0];
    const node = nodeMap.get(id)!;
    if (!ready.length) node.warnings.push("Recorded relationships contain a cycle or disagree with event sequence. This position uses stable source order.");
    pending.delete(id); ordered.push(node);
  }
  const lastByLane = new Map<string, string>();
  ordered.forEach((node, index) => {
    node.y = 44 + index * 72;
    const previous = lastByLane.get(node.laneId);
    if (previous) edges.push({ id: `timeline:${previous}:${node.id}`, from: previous, to: node.id, kind: "timeline", label: "later activity in this lane" });
    lastByLane.set(node.laneId, node.id);
  });
  const labelX = 110 + Math.max(0, lanes.length - 2) * 32;
  return { nodes: ordered, edges, lanes, labelX, width: Math.max(480, labelX + 340), height: Math.max(270, ordered.length * 72 + 26),
    history: { loadedEvents: allEvents.length, totalEvents: Math.max(snapshot.session.metrics.archivedEvents, allEvents.length), shownEvents: events.length,
      filteredEvents: recentEvents.length - events.length, omittedEvents: allEvents.length - recentEvents.length,
      omittedIntents: allIntents.length - intents.length, loadedCheckpoints: shownCheckpoints.length, omittedCheckpoints: checkpoints.length - shownCheckpoints.length } };
}

export function graphEdgePath(from: Pick<IntentGraphNode, "x" | "y">, to: Pick<IntentGraphNode, "x" | "y">): string {
  if (from.x === to.x) return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  const middle = from.y + (to.y - from.y) * 0.5;
  return `M ${from.x} ${from.y} C ${from.x} ${middle}, ${to.x} ${middle}, ${to.x} ${to.y}`;
}
