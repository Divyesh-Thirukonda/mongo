import type {
  HarnessMessage,
  HarnessState,
  HarnessTask,
  MemoryRecall,
} from "./harness-types";
import type { AgentId, SimulationEvent, SimulationRun } from "./types";
import { getScenario } from "./scenarios";

export const MAX_HARNESS_MESSAGES = 72;
export const MAX_HARNESS_SUMMARY_CHARS = 2400;
export const MAX_RECALL_CONTEXT_CHARS = 6000;
export const ROLE_TOOL_PERMISSIONS: Readonly<
  Record<AgentId, readonly string[]>
> = {
  sentinel: ["scan", "monitor"],
  cipher: ["monitor"],
  trace: ["monitor"],
  bastion: ["isolate", "monitor"],
  nexus: ["monitor"],
};

function emptyRecall(): MemoryRecall {
  return {
    matches: [],
    watchNodeIds: [],
    anticipate: false,
    context: "No prior incident memory recalled.",
    contextChars: 34,
    maxContextChars: MAX_RECALL_CONTEXT_CHARS,
    considered: 0,
  };
}

export function ensureHarness(
  run: SimulationRun,
  recall?: MemoryRecall,
): HarnessState {
  if (run.harness) return run.harness;
  const memory = structuredClone(recall ?? emptyRecall());
  memory.maxContextChars = Math.min(
    MAX_RECALL_CONTEXT_CHARS,
    Math.max(100, memory.maxContextChars),
  );
  memory.context = memory.context.slice(0, memory.maxContextChars);
  memory.contextChars = memory.context.length;
  memory.matches = memory.matches
    .slice(0, 5)
    .map((match) => ({
      ...match,
      summary: match.summary.slice(0, 600),
      reason: match.reason.slice(0, 300),
    }));
  memory.watchNodeIds = [...new Set(memory.watchNodeIds)]
    .filter((id) => run.nodes.some((node) => node.id === id))
    .slice(0, 12);
  run.harness = {
    version: 1,
    phase: "monitor",
    recall: memory,
    messages: [],
    tasks: [],
    contextCompactions: 0,
    compactedSummary: "",
    guardrailRejections: 0,
  };
  if (memory.anticipate && memory.matches.length) {
    send(run, {
      from: "nexus",
      to: "sentinel",
      kind: "recall",
      content: `Recall ${memory.matches.map((match) => match.memoryId).join(", ")}: prioritize telemetry on ${memory.watchNodeIds.join(", ") || "known intrusion paths"}. Memory is a watchlist, not proof of compromise.`,
      evidenceIds: [],
    });
  }
  return run.harness;
}

function send(
  run: SimulationRun,
  input: Omit<HarnessMessage, "id" | "tick">,
  source: SimulationEvent["source"] = "simulation",
): HarnessMessage {
  const harness = ensureHarness(run);
  const message: HarnessMessage = {
    ...input,
    content: input.content.slice(0, 420),
    evidenceIds: [...new Set(input.evidenceIds)].slice(0, 12),
    id: `${run.id}:msg:${run.events.length}:${run.tick}`,
    tick: run.tick,
  };
  harness.messages.push(message);
  const eventKind =
    input.kind === "observation"
      ? "detection"
      : input.kind === "execution"
        ? "defense"
        : ["approval", "proposal", "recall"].includes(input.kind)
          ? "decision"
          : "analysis";
  run.events.push({
    id: `${run.id}:${run.tick}:${run.events.length}`,
    tick: run.tick,
    agentId: input.from,
    kind: eventKind,
    message: `${input.from.toUpperCase()} → ${input.to.toUpperCase()}: ${message.content}`,
    nodeId: input.nodeId,
    source,
    confidence: input.kind === "approval" ? 99 : 95,
  });
  const agent = run.agents.find((entry) => entry.id === input.from);
  if (agent) {
    agent.task = message.content;
    agent.targetNodeId = input.nodeId;
    agent.status = input.kind === "execution" ? "defending" : "analyzing";
    agent.actions += 1;
  }
  compactHarnessContext(run);
  return message;
}

function currentTask(
  run: SimulationRun,
  nodeId: string,
): HarnessTask | undefined {
  return ensureHarness(run).tasks.find(
    (task) =>
      task.id ===
      `${run.id}:task:${nodeId}:${run.nodes.find((node) => node.id === nodeId)?.compromisedAt ?? "unknown"}`,
  );
}

function latest(
  run: SimulationRun,
  task: HarnessTask,
  kind: HarnessMessage["kind"],
  actor?: AgentId,
): HarnessMessage | undefined {
  return ensureHarness(run).messages.findLast(
    (message) =>
      message.nodeId === task.nodeId &&
      message.kind === kind &&
      (!actor || message.from === actor) &&
      message.evidenceIds.some((id) => task.evidenceIds.includes(id)),
  );
}

export function isAnticipatedAsset(
  run: SimulationRun,
  nodeId: string,
): boolean {
  const recall = ensureHarness(run).recall;
  return (
    recall.anticipate &&
    recall.matches.length > 0 &&
    recall.watchNodeIds.includes(nodeId)
  );
}

/** Proactive scans consume recalled watchlists but do not mark healthy assets as threats. */
export function anticipateKnownPaths(run: SimulationRun): void {
  const harness = ensureHarness(run);
  if (!harness.recall.anticipate || !harness.recall.matches.length) return;
  for (const nodeId of harness.recall.watchNodeIds) {
    const node = run.nodes.find((entry) => entry.id === nodeId)!;
    if (node.status === "isolated") continue;
    if (run.tick === 1 || (node.status === "compromised" && !node.detected)) {
      send(run, {
        from: "sentinel",
        to: "team",
        kind: "recall",
        nodeId,
        content: `Proactive watchlist scan of ${node.label}: ${node.status === "compromised" ? "fresh malicious behavior observed; collect current evidence" : "no confirmed compromise; keep asset online"}.`,
        evidenceIds: [],
      });
      if (node.status === "compromised") node.detected = true;
    }
  }
}

/** Every stage consumes the prior stage's message and immutable incident event IDs. */
export function progressThreatCollaboration(
  run: SimulationRun,
  nodeId: string,
): boolean {
  const harness = ensureHarness(run);
  const node = run.nodes.find((entry) => entry.id === nodeId);
  if (!node || node.status !== "compromised" || !node.detected) return false;
  harness.phase = "triage";
  const attackEvidence = run.events
    .filter(
      (event) =>
        event.kind === "attack" &&
        event.nodeId === nodeId &&
        event.tick === node.compromisedAt,
    )
    .map((event) => event.id);
  if (!attackEvidence.length) return false;
  let task = currentTask(run, nodeId);
  if (!task) {
    task = {
      id: `${run.id}:task:${nodeId}:${node.compromisedAt}`,
      nodeId,
      owner: "cipher",
      status: "investigating",
      evidenceIds: attackEvidence,
    };
    harness.tasks.push(task);
    const retained = harness.tasks.filter(
      (entry) => entry.status !== "contained",
    );
    harness.tasks = [
      ...harness.tasks
        .filter((entry) => entry.status === "contained")
        .slice(-(24 - retained.length)),
      ...retained,
    ];
    send(run, {
      from: "sentinel",
      to: "cipher",
      kind: "observation",
      nodeId,
      content: `Current telemetry confirms malicious behavior on ${node.label}; handing evidence to CIPHER for classification.`,
      evidenceIds: task.evidenceIds,
    });
  }
  const observation = latest(run, task, "observation", "sentinel");
  if (
    !observation ||
    !observation.evidenceIds.every((id) => attackEvidence.includes(id))
  )
    return false;
  const age = run.tick - (node.compromisedAt ?? run.tick);
  if (age < (isAnticipatedAsset(run, nodeId) ? 0 : 1)) return false;
  let assessment = latest(run, task, "assessment", "cipher");
  if (!assessment) {
    const scenario = getScenario(run.scenarioId);
    task.assessment = `${scenario.technique}; current evidence supports ${scenario.attackName}, independent of prior memory.`;
    task.owner = "trace";
    assessment = send(run, {
      from: "cipher",
      to: "trace",
      kind: "assessment",
      nodeId,
      content: task.assessment,
      evidenceIds: task.evidenceIds,
      inReplyTo: observation.id,
    });
  }
  let handoff = latest(run, task, "handoff", "trace");
  if (!handoff) {
    task.owner = "bastion";
    handoff = send(run, {
      from: "trace",
      to: "bastion",
      kind: "handoff",
      nodeId,
      content: `Evidence chain verified for ${node.label}. ${node.connections.length} adjacent assets could be reached; hand off containment with preserved provenance.`,
      evidenceIds: task.evidenceIds,
      inReplyTo: assessment.id,
    });
  }
  const effectiveDelay = Math.max(
    1,
    run.policy.isolationDelay - (isAnticipatedAsset(run, nodeId) ? 1 : 0),
  );
  if (age < effectiveDelay) return false;
  let proposal = latest(run, task, "proposal", "bastion");
  if (!proposal) {
    task.owner = "nexus";
    proposal = send(run, {
      from: "bastion",
      to: "nexus",
      kind: "proposal",
      nodeId,
      content: `Request isolation of ${node.label}. Current evidence is confirmed; policy v${run.policy.version} threshold met. Availability cost: one asset offline.`,
      evidenceIds: task.evidenceIds,
      inReplyTo: handoff.id,
    });
  }
  if (!run.autoDefend) return false;
  if (!latest(run, task, "approval", "nexus")) {
    task.owner = "bastion";
    task.status = "approved";
    task.approvedBy = "nexus";
    send(run, {
      from: "nexus",
      to: "bastion",
      kind: "approval",
      nodeId,
      content: `Approved: isolate ${node.label}. SENTINEL observation, CIPHER classification, and TRACE provenance agree. Preserve forensic evidence.`,
      evidenceIds: task.evidenceIds,
      inReplyTo: proposal.id,
    });
  }
  harness.phase = "contain";
  return canExecuteContainment(run, nodeId, "bastion").allowed;
}

export function canExecuteContainment(
  run: SimulationRun,
  nodeId: string,
  actor: AgentId,
): { allowed: boolean; reason: string } {
  if (actor !== "bastion")
    return { allowed: false, reason: "Only BASTION has the isolation tool." };
  if (!run.autoDefend)
    return {
      allowed: false,
      reason: "Commander paused autonomous containment.",
    };
  const node = run.nodes.find((entry) => entry.id === nodeId);
  if (!node || node.status !== "compromised" || !node.detected)
    return {
      allowed: false,
      reason:
        "Isolation requires a currently detected compromise, not a memory match.",
    };
  const task = currentTask(run, nodeId);
  if (!task || task.status !== "approved" || task.approvedBy !== "nexus")
    return {
      allowed: false,
      reason: "NEXUS has not approved the evidence-backed containment task.",
    };
  const chain: Array<[HarnessMessage["kind"], AgentId]> = [
    ["observation", "sentinel"],
    ["assessment", "cipher"],
    ["handoff", "trace"],
    ["proposal", "bastion"],
    ["approval", "nexus"],
  ];
  let previous: HarnessMessage | undefined;
  for (const [kind, agent] of chain) {
    const message = latest(run, task, kind, agent);
    if (
      !message ||
      (previous && message.inReplyTo !== previous.id) ||
      !message.evidenceIds.length ||
      !message.evidenceIds.every(
        (id) =>
          task.evidenceIds.includes(id) &&
          run.events.some(
            (event) =>
              event.id === id &&
              event.kind === "attack" &&
              event.nodeId === nodeId &&
              event.tick === node.compromisedAt,
          ),
      )
    )
      return {
        allowed: false,
        reason: "Incomplete or invalid cross-agent evidence handoff.",
      };
    previous = message;
  }
  return {
    allowed: true,
    reason: "NEXUS approved a complete evidence chain for BASTION execution.",
  };
}

export function recordContainmentExecution(
  run: SimulationRun,
  nodeId: string,
  source: SimulationEvent["source"] = "simulation",
): void {
  const task = currentTask(run, nodeId);
  if (!task || task.approvedBy !== "nexus" || task.status !== "approved")
    return;
  const approval = latest(run, task, "approval", "nexus");
  if (!approval) return;
  task.status = "contained";
  task.executedBy = "bastion";
  task.owner = "bastion";
  send(
    run,
    {
      from: "bastion",
      to: "nexus",
      kind: "execution",
      nodeId,
      content: `Approved isolation executed on ${nodeId}. Network paths closed; evidence chain retained for the after-action report.`,
      evidenceIds: task.evidenceIds,
      inReplyTo: approval.id,
    },
    source,
  );
}

export function validateRoleRecommendation(
  run: SimulationRun,
  agentId: AgentId,
  action: "isolate" | "scan" | "monitor",
  nodeId: string | null,
): { allowed: boolean; reason: string } {
  if (!ROLE_TOOL_PERMISSIONS[agentId].includes(action))
    return {
      allowed: false,
      reason: `${agentId.toUpperCase()} is not authorized to use ${action}.`,
    };
  if (action === "monitor")
    return { allowed: true, reason: "Analysis is permitted." };
  if (!nodeId || !run.nodes.some((node) => node.id === nodeId))
    return {
      allowed: false,
      reason: "The action requires a known synthetic asset.",
    };
  return action === "isolate"
    ? canExecuteContainment(run, nodeId, agentId)
    : { allowed: true, reason: "SENTINEL may collect current telemetry." };
}

export function recordGuardrailRejection(
  run: SimulationRun,
  agentId: AgentId,
  reason: string,
  nodeId?: string,
): void {
  ensureHarness(run).guardrailRejections += 1;
  send(
    run,
    {
      from: agentId,
      to: "nexus",
      kind: "assessment",
      nodeId,
      content: `Tool request rejected: ${reason}`,
      evidenceIds: [],
    },
    "openrouter",
  );
}

export function recordAgentReasoning(
  run: SimulationRun,
  agentId: AgentId,
  content: string,
  nodeId?: string,
): void {
  // Model commentary is not a signed stage in the deterministic evidence approval chain.
  send(
    run,
    {
      from: agentId,
      to: "team",
      kind: "assessment",
      content,
      nodeId,
      evidenceIds: [],
    },
    "openrouter",
  );
}

/** Preserve pending causal chains; compact completed chatter into a bounded evidence summary. */
export function compactHarnessContext(run: SimulationRun): void {
  const harness = run.harness;
  if (!harness || harness.messages.length <= MAX_HARNESS_MESSAGES) return;
  const activeTasks = harness.tasks.filter(
    (task) => task.status !== "contained",
  );
  const required = harness.messages.filter(
    (message) =>
      message.nodeId &&
      activeTasks.some(
        (task) =>
          task.nodeId === message.nodeId &&
          message.evidenceIds.some((id) => task.evidenceIds.includes(id)),
      ) &&
      message.kind !== "execution",
  );
  const keep = new Set(
    required.slice(-MAX_HARNESS_MESSAGES).map((message) => message.id),
  );
  for (const message of [...harness.messages].reverse()) {
    if (keep.size >= MAX_HARNESS_MESSAGES) break;
    keep.add(message.id);
  }
  const removed = harness.messages.filter((message) => !keep.has(message.id));
  const lines = removed.map(
    (message) =>
      `${message.id} t${message.tick} ${message.from}>${message.to} ${message.kind} ${message.nodeId ?? "team"} [${message.evidenceIds.join(",")}]${message.inReplyTo ? ` reply:${message.inReplyTo}` : ""}`,
  );
  const resolutions = harness.tasks
    .filter((task) => task.status === "contained")
    .map(
      (task) =>
        `${task.nodeId}: evidence[${task.evidenceIds.join(",")}] → ${task.executedBy === "bastion" ? "Sentinel observation → Cipher assessment → Trace handoff → Bastion proposal → Nexus approved → Bastion executed" : "commander containment"}.`,
    );
  harness.compactedSummary =
    `${lines.join("\n")}\nResolved causal chains:\n${resolutions.join("\n")}`.slice(
      -MAX_HARNESS_SUMMARY_CHARS,
    );
  harness.messages = harness.messages.filter((message) => keep.has(message.id));
  harness.contextCompactions += 1;
}
