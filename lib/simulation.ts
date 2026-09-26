import { AGENT_DEFINITIONS, createNetwork, getScenario } from "./scenarios";
import type {
  AgentId,
  DefensePolicy,
  NetworkNode,
  RunAction,
  ScenarioId,
  SimulationEvent,
  SimulationRun,
} from "./types";

const MAX_TICKS = 42;

export function baselinePolicy(scenarioId: ScenarioId): DefensePolicy {
  return {
    scenarioId,
    version: 1,
    isolationDelay: 5,
    scanCadence: 2,
    learnedFrom: [],
    lesson:
      "Baseline protocol: confirm malicious activity for five ticks before automated isolation.",
  };
}

export function derivePolicy(
  run: SimulationRun,
  current: DefensePolicy = run.policy,
): DefensePolicy {
  if (
    current.learnedFrom.includes(run.id) ||
    !["contained", "breached"].includes(run.status)
  )
    return structuredClone(current);
  const infected = run.nodes.filter(
    (node) => node.compromisedAt !== undefined,
  ).length;
  const isolationDelay = Math.max(
    1,
    current.isolationDelay - (current.version === 1 ? 3 : 1),
  );
  const candidate = { ...current, isolationDelay, scanCadence: 1 };
  const baselineReplay = evaluatePolicy(run.scenarioId, run.seed, current);
  const candidateReplay = evaluatePolicy(run.scenarioId, run.seed, candidate);
  const accepted = candidateReplay.score > baselineReplay.score;
  const selected = accepted ? candidate : current;
  return {
    scenarioId: run.scenarioId,
    version: current.version + 1,
    isolationDelay: selected.isolationDelay,
    scanCadence: selected.scanCadence,
    learnedFrom: [...current.learnedFrom, run.id].slice(-50),
    updatedAt: run.updatedAt,
    lesson: accepted
      ? `${infected} assets were reached. Counterfactual replay improved integrity ${baselineReplay.integrity}% → ${candidateReplay.integrity}%. Adopt ${selected.isolationDelay}-tick isolation and scan every tick.`
      : `Counterfactual replay did not improve the current policy. Retain ${current.isolationDelay}-tick isolation; evidence from this exercise was recorded.`,
    evidence: {
      previousIntegrity: run.metrics.integrity,
      compromisedNodes: infected,
      ticks: run.tick,
      evaluation: {
        seed: run.seed,
        baselineScore: baselineReplay.score,
        candidateScore: candidateReplay.score,
        accepted,
        baselineIntegrity: baselineReplay.integrity,
        candidateIntegrity: candidateReplay.integrity,
      },
    },
  };
}

/** A bounded counterfactual harness promotes policies only after a reproducible improvement. */
function evaluatePolicy(
  scenarioId: ScenarioId,
  seed: number,
  policy: DefensePolicy,
): { score: number; integrity: number } {
  let evaluation = createInitialRun(scenarioId, seed, {
    id: "policy-evaluation",
    policy,
    aiEnabled: false,
    autoDefend: true,
  });
  for (
    let index = 0;
    index < MAX_TICKS && !["contained", "breached"].includes(evaluation.status);
    index++
  ) {
    evaluation = stepRun(evaluation);
    // The evaluator needs metrics, not cinematic replay snapshots.
    evaluation.snapshots = [];
    evaluation.history = [];
  }
  return {
    score:
      Math.round(
        (evaluation.metrics.integrity * 0.65 +
          evaluation.metrics.uptime * 0.35 -
          evaluation.metrics.exfiltratedMB * 0.1 -
          (evaluation.status === "breached" ? 30 : 0)) *
          100,
      ) / 100,
    integrity: evaluation.metrics.integrity,
  };
}

/** Counter-based random numbers keep the same seed and action sequence reproducible. */
function random(seed: number, tick: number, salt: number): number {
  let value =
    (seed ^
      Math.imul(tick + 1, 0x45d9f3b) ^
      Math.imul(salt + 1, 0x27d4eb2d)) >>>
    0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

export function createInitialRun(
  scenarioId: ScenarioId = "ransomware",
  seed = 42,
  options: {
    id?: string;
    createdAt?: string;
    autoDefend?: boolean;
    aiEnabled?: boolean;
    policy?: DefensePolicy;
  } = {},
): SimulationRun {
  const scenario = getScenario(scenarioId);
  const createdAt = options.createdAt ?? "2026-01-01T00:00:00.000Z";
  const run: SimulationRun = {
    id: options.id ?? `preview-${scenarioId}-${seed}`,
    scenarioId,
    seed,
    status: "ready",
    tick: 0,
    revision: 0,
    nodes: createNetwork(),
    agents: structuredClone(AGENT_DEFINITIONS),
    events: [],
    metrics: {
      containment: 0,
      integrity: 100,
      threatsBlocked: 0,
      compromised: 0,
      uptime: 100,
      elapsedSeconds: 0,
      responseTime: 0,
      exfiltratedMB: 0,
    },
    autoDefend: options.autoDefend ?? true,
    createdAt,
    updatedAt: createdAt,
    ai: {
      enabled: options.aiEnabled ?? false,
      mode: "simulation",
      requests: 0,
      tokens: 0,
      lastTick: -1,
    },
    attack: { stage: 0, wavesSpawned: 0, lastSpreadTick: 0 },
    history: [],
    snapshots: [],
    policy: structuredClone(options.policy ?? baselinePolicy(scenarioId)),
  };
  addEvent(run, {
    agentId: "nexus",
    kind: "system",
    message: `${scenario.name} armed. Five defenders online. Defense policy v${run.policy.version} loaded.`,
  });
  addEvent(run, {
    agentId: "system",
    kind: "system",
    message:
      "Synthetic cyber range. All attacks and defensive actions operate on simulated assets only.",
  });
  snapshot(run);
  return run;
}

export function addEvent(
  run: SimulationRun,
  event: Omit<SimulationEvent, "id" | "tick" | "source"> & {
    source?: SimulationEvent["source"];
  },
): void {
  run.events.push({
    ...event,
    id: `${run.id}:${run.tick}:${run.events.length}`,
    tick: run.tick,
    source: event.source ?? "simulation",
  });
}

function directAgent(
  run: SimulationRun,
  id: AgentId,
  task: string,
  nodeId?: string,
  status: "analyzing" | "defending" = "analyzing",
): void {
  const agent = run.agents.find((entry) => entry.id === id)!;
  agent.status = status;
  agent.task = task;
  agent.targetNodeId = nodeId;
  agent.actions += 1;
  agent.confidence = Math.round(
    88 + random(run.seed, run.tick, agent.actions) * 11,
  );
}

function compromise(
  run: SimulationRun,
  node: NetworkNode,
  message: string,
): void {
  node.status = "compromised";
  node.compromisedAt = run.tick;
  node.health = Math.max(1, node.health - 8);
  node.risk = 94;
  addEvent(run, {
    agentId: "attacker",
    kind: "attack",
    message,
    nodeId: node.id,
  });
  for (const neighbor of run.nodes.filter(
    (entry) =>
      node.connections.includes(entry.id) && entry.status === "healthy",
  )) {
    neighbor.status = "exposed";
    neighbor.risk = 35;
  }
}

function isolate(
  run: SimulationRun,
  node: NetworkNode,
  agentId: AgentId | "commander",
  source: SimulationEvent["source"] = "simulation",
): void {
  const wasThreat = node.status === "compromised" || node.status === "exposed";
  node.status = "isolated";
  node.isolatedAt = run.tick;
  node.risk = 0;
  node.detected = true;
  if (wasThreat) run.metrics.threatsBlocked += 1;
  addEvent(run, {
    agentId,
    kind: "defense",
    message: `${node.label} isolated. Inbound and outbound paths severed; evidence preserved.`,
    nodeId: node.id,
    source,
    confidence: 99,
  });
  if (agentId !== "commander")
    directAgent(
      run,
      agentId,
      `Quarantined ${node.label}`,
      node.id,
      "defending",
    );
}

function updateMetrics(run: SimulationRun): void {
  const compromised = run.nodes.filter((node) => node.status === "compromised");
  const isolated = run.nodes.filter((node) => node.status === "isolated");
  const touched = run.nodes.filter((node) => node.compromisedAt !== undefined);
  run.metrics.compromised = compromised.length;
  run.metrics.integrity = Math.round(
    run.nodes.reduce((total, node) => total + node.health, 0) /
      run.nodes.length,
  );
  run.metrics.uptime = Math.round(
    (100 * (run.nodes.length - isolated.length - compromised.length * 0.35)) /
      run.nodes.length,
  );
  run.metrics.containment =
    run.status === "contained"
      ? 100
      : touched.length
        ? Math.min(
            99,
            Math.round(
              (100 *
                touched.filter(
                  (node) =>
                    node.status === "isolated" || node.status === "healthy",
                ).length) /
                touched.length,
            ),
          )
        : 0;
  run.metrics.elapsedSeconds = run.tick * 2;
  const firstIsolation = run.nodes
    .map((node) => node.isolatedAt)
    .filter((value): value is number => value !== undefined);
  if (firstIsolation.length)
    run.metrics.responseTime = Math.max(0, Math.min(...firstIsolation) - 1) * 2;
  for (const node of run.nodes.filter((entry) => entry.status === "exposed")) {
    if (
      !compromised.some((infected) => infected.connections.includes(node.id))
    ) {
      node.status = "healthy";
      node.risk = 0;
    }
  }
}

function snapshot(run: SimulationRun): void {
  const historyEntry = {
    tick: run.tick,
    integrity: run.metrics.integrity,
    containment: run.metrics.containment,
    compromised: run.metrics.compromised,
  };
  const snapshotEntry = {
    tick: run.tick,
    nodes: structuredClone(run.nodes),
    metrics: { ...run.metrics },
  };
  if (run.history.at(-1)?.tick === run.tick)
    run.history[run.history.length - 1] = historyEntry;
  else run.history.push(historyEntry);
  if (run.snapshots.at(-1)?.tick === run.tick)
    run.snapshots[run.snapshots.length - 1] = snapshotEntry;
  else run.snapshots.push(snapshotEntry);
  run.history = run.history.slice(-50);
  run.snapshots = run.snapshots.slice(-50);
}

/** Pure transition function: never sends traffic or executes host commands. */
export function stepRun(previous: SimulationRun): SimulationRun {
  if (previous.status === "contained" || previous.status === "breached")
    return structuredClone(previous);
  const run = structuredClone(previous);
  const scenario = getScenario(run.scenarioId);
  run.status = "running";
  run.tick += 1;
  run.revision += 1;
  run.updatedAt = new Date(
    new Date(run.createdAt).getTime() + run.tick * 2000,
  ).toISOString();
  for (const agent of run.agents) {
    agent.status = "monitoring";
    agent.targetNodeId = undefined;
  }

  // Three staged entry attempts create a full incident arc. Quarantined paths stop reinfection.
  if ([1, 8, 15].includes(run.tick)) {
    run.attack.wavesSpawned += 1;
    const secondaryId =
      run.scenarioId === "supply-chain"
        ? "workstation-02"
        : run.scenarioId === "exfiltration"
          ? "web-server"
          : "workstation-02";
    const entry = run.nodes.find(
      (node) =>
        node.id === (run.tick === 1 ? scenario.entryNodeId : secondaryId),
    )!;
    if (
      entry.status === "isolated" ||
      (run.tick === 15 && run.metrics.threatsBlocked >= 2)
    ) {
      run.metrics.threatsBlocked += 1;
      addEvent(run, {
        agentId: "bastion",
        kind: "defense",
        message: `${scenario.attackName} retry blocked at the established containment boundary.`,
        nodeId: entry.id,
        confidence: 99,
      });
    } else if (entry.status !== "compromised") {
      compromise(
        run,
        entry,
        `${scenario.attackName}: ${run.tick === 1 ? "initial intrusion" : "secondary foothold"} on ${entry.label}.`,
      );
    }
  }

  const infectedAtTickStart = run.nodes.filter(
    (node) => node.status === "compromised",
  );
  for (const [index, node] of infectedAtTickStart.entries()) {
    const age = run.tick - (node.compromisedAt ?? run.tick);
    node.health = Math.max(0, node.health - scenario.damagePerTick);
    node.risk = Math.min(100, node.risk + 1);
    if (age >= 1 && run.tick % run.policy.scanCadence === 0 && !node.detected) {
      node.detected = true;
      addEvent(run, {
        agentId: "sentinel",
        kind: "detection",
        message: `Behavioral anomaly confirmed on ${node.label}. Correlating host and network signals.`,
        nodeId: node.id,
        confidence: 95,
      });
      directAgent(run, "sentinel", `Threat detected on ${node.label}`, node.id);
    }
    if (age === 2) {
      addEvent(run, {
        agentId: "cipher",
        kind: "analysis",
        message: `${scenario.technique}. Signature matches ${scenario.attackName}; containment recommended.`,
        nodeId: node.id,
        confidence: 97,
      });
      directAgent(
        run,
        "cipher",
        `Classified ${scenario.attackName} behavior`,
        node.id,
      );
    }
    // Adapted policies act before the next spread interval. This is an actual policy change, not a label.
    if (run.autoDefend && node.detected && age >= run.policy.isolationDelay) {
      isolate(run, node, "bastion");
      continue;
    }
    if (age > 0 && age % scenario.spreadInterval === 0) {
      const candidates = run.nodes.filter(
        (next) =>
          node.connections.includes(next.id) &&
          ["healthy", "exposed"].includes(next.status),
      );
      candidates.sort((a, b) => {
        const priority = (value: NetworkNode) =>
          value.id === scenario.targetNodeId
            ? 4
            : value.zone === "core"
              ? 3
              : value.zone === "operations"
                ? 2
                : 1;
        return priority(b) - priority(a) || a.id.localeCompare(b.id);
      });
      const candidate =
        candidates.length > 1 && random(run.seed, run.tick, index) < 0.2
          ? candidates[1]
          : candidates[0];
      if (candidate) {
        if (run.autoDefend && run.metrics.threatsBlocked > 0) {
          run.metrics.threatsBlocked += 1;
          addEvent(run, {
            agentId: "bastion",
            kind: "defense",
            message: `Shared indicator blocked ${node.label} → ${candidate.label}. The first quarantine rule now protects peer assets.`,
            nodeId: candidate.id,
            confidence: 97,
          });
          directAgent(
            run,
            "bastion",
            `Blocked movement to ${candidate.label}`,
            candidate.id,
            "defending",
          );
          continue;
        }
        compromise(
          run,
          candidate,
          `Lateral movement: ${node.label} → ${candidate.label}. Trust boundary crossed.`,
        );
        run.attack.lastSpreadTick = run.tick;
        addEvent(run, {
          agentId: "trace",
          kind: "analysis",
          message: `Reconstructed propagation edge ${node.label} → ${candidate.label}; evidence linked to the incident graph.`,
          nodeId: candidate.id,
          confidence: 94,
        });
        directAgent(run, "trace", `Tracing ${candidate.label}`, candidate.id);
      }
    }
  }

  if (run.tick % 4 === 0) {
    const active = run.nodes.filter(
      (node) => node.status === "compromised",
    ).length;
    addEvent(run, {
      agentId: "nexus",
      kind: "decision",
      message: active
        ? `${active} active ${active === 1 ? "threat" : "threats"}. ${run.autoDefend ? `Executing policy v${run.policy.version}: isolate after ${run.policy.isolationDelay} ticks.` : "Autonomous containment paused. Awaiting commander intervention."}`
        : "No active compromise. Maintain perimeter watch through the remaining attack waves.",
      confidence: 98,
    });
    directAgent(
      run,
      "nexus",
      active
        ? "Coordinating containment priorities"
        : "Verifying containment boundary",
      undefined,
      active ? "defending" : "analyzing",
    );
  }

  const vault = run.nodes.find((node) => node.id === scenario.targetNodeId)!;
  if (run.scenarioId === "exfiltration" && vault.status === "compromised")
    run.metrics.exfiltratedMB += 16;
  run.attack.stage = Math.min(4, Math.floor(run.tick / 5));
  updateMetrics(run);
  if (
    (vault.status === "compromised" && vault.health <= 25) ||
    run.tick >= MAX_TICKS
  ) {
    run.status = "breached";
    addEvent(run, {
      agentId: "system",
      kind: "system",
      message:
        "Exercise complete: containment objective missed. Incident evidence is ready for policy improvement.",
    });
  } else if (run.tick >= 17 && run.metrics.compromised === 0) {
    run.status = "contained";
    run.metrics.containment = 100;
    addEvent(run, {
      agentId: "nexus",
      kind: "defense",
      message: `${scenario.attackName} contained. ${run.metrics.threatsBlocked} threat paths blocked. ${run.metrics.integrity}% data integrity preserved.`,
      confidence: 100,
    });
  }
  if (run.status !== "running")
    for (const agent of run.agents) {
      agent.status = "complete";
      agent.task = "Incident evidence archived for review";
    }
  snapshot(run);
  return run;
}

export function applyAction(
  previous: SimulationRun,
  action: RunAction,
): SimulationRun {
  const run = structuredClone(previous);
  if (run.status === "contained" || run.status === "breached")
    throw new Error(
      "This exercise has ended. Start a new run to test another strategy.",
    );
  run.revision += 1;
  if (action.type === "auto-defend") {
    run.autoDefend = action.enabled;
    addEvent(run, {
      agentId: "commander",
      kind: "decision",
      message: `Autonomous defense ${action.enabled ? "enabled" : "paused"} by the commander.`,
      source: "human",
    });
    return run;
  }
  const node = run.nodes.find((entry) => entry.id === action.nodeId);
  if (!node) throw new Error("Unknown network asset");
  if (action.type === "isolate") {
    if (node.status === "isolated")
      throw new Error("This asset is already isolated");
    isolate(run, node, "commander", "human");
  } else if (action.type === "scan") {
    node.detected = true;
    addEvent(run, {
      agentId: "sentinel",
      kind: "analysis",
      message: `Commander-requested scan: ${node.label} is ${node.status}. Risk score ${node.risk}/100.`,
      nodeId: node.id,
      source: "human",
      confidence: 100,
    });
    directAgent(
      run,
      "sentinel",
      `Completed deep scan on ${node.label}`,
      node.id,
    );
  } else {
    if (node.status !== "isolated")
      throw new Error("Only isolated assets can be restored");
    node.status = "healthy";
    node.health = Math.min(100, node.health + 24);
    node.risk = 0;
    node.detected = false;
    addEvent(run, {
      agentId: "commander",
      kind: "recovery",
      message: `${node.label} restored from a clean checkpoint and reconnected.`,
      nodeId: node.id,
      source: "human",
    });
  }
  updateMetrics(run);
  snapshot(run);
  return run;
}

export function applyAgentRecommendation(
  run: SimulationRun,
  action: "isolate" | "scan" | "monitor",
  nodeId: string | null,
  message: string,
  agentId: AgentId,
  confidence: number,
): void {
  const node = run.nodes.find((entry) => entry.id === nodeId);
  addEvent(run, {
    agentId,
    kind: "decision",
    message,
    nodeId: node?.id,
    confidence,
    source: "openrouter",
  });
  directAgent(run, agentId, message, node?.id, "analyzing");
  // Model actions are constrained to known, actually compromised synthetic assets.
  if (
    action === "isolate" &&
    run.autoDefend &&
    node?.status === "compromised" &&
    node.detected
  )
    isolate(run, node, agentId, "openrouter");
  if (action === "scan" && node) node.detected = true;
  updateMetrics(run);
  snapshot(run);
}
